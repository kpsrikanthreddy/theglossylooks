-- ============================================================================
-- Migration 024: Durable Idempotent Outbox & Authoritative SMAV User Sync
-- Target Database: The Glossy Looks Supabase (public.users is authoritative)
--
-- Production Schema Compatibility & Safety Guarantees:
-- 1. Non-destructive & safely rerunnable (idempotent). Preserves all existing
--    users, staff, UUIDs, roles, emails, password_hash, login, POS, billing,
--    WhatsApp, and operational staff records.
-- 2. Respects pre-existing Central Auth columns already present in production
--    (central_auth_id, central_auth_status, central_auth_linked_at,
--     central_outlet_code, central_sync_version, central_last_synced_at,
--     central_sync_origin) without altering their existing values or types.
-- 3. Does NOT auto-mark existing rows as SYNCED based solely on a legacy UUID
--    and timestamp; all existing rows default to PENDING until verified by an
--    actual SMAV synchronization or reconciliation run.
-- 4. Protects ALL central_auth_id writes (including NULL -> UUID and UUID -> UUID
--    on both public.users and public.staff, preserving Renuka's UUID and all
--    existing links):
--    - Ordinary UPDATEs (including smav_update_user_and_enqueue_sync) CANNOT
--      assign, modify, or clear central_auth_id, even when currently NULL.
--    - Only two privileged SECURITY DEFINER RPCs may assign or reconcile
--      central_auth_id:
--        (a) public.smav_link_verified_central_auth_id(...) for initial linking
--            backed by verified Central SMAV ownership evidence, and
--        (b) public.smav_admin_reconcile_central_auth_id(...) for audited
--            compare-and-swap manual reconciliation.
--    - Both triggers verify PG_CONTEXT (actual server call stack) AND a
--      transaction-scoped (txid_current) matching row in
--      public.smav_central_auth_reconciliation_audit.
-- 5. Append-Only Tamper-Resistant Reconciliation Audit:
--    - service_role has SELECT ONLY (NO INSERT/UPDATE/DELETE/TRUNCATE).
--    - BEFORE UPDATE/DELETE/TRUNCATE triggers unconditionally block tampering.
--    - BEFORE INSERT trigger verifies PG_CONTEXT so ONLY the approved
--      reconciliation/verified-link RPCs can insert audit records.
-- 6. Audit-Preserving Outbox Deletion Policy:
--    - Replaces ON DELETE CASCADE with ON DELETE SET NULL on local_user_id +
--      immutable audit_local_user_id UUID NOT NULL snapshot column.
--    - Blocks DELETE/TRUNCATE on public.smav_user_sync_outbox so historical
--      sync evidence is permanently preserved on deactivation or deletion.
-- 7. Safe Create/Update Idempotency without Secret Persistence:
--    - Acquires transaction-scoped advisory locks BEFORE mutations.
--    - Includes non-secret credential_mode ('explicit' | 'generated') in create
--      fingerprint (NEVER persists plaintext passwords or password hashes in
--      payload or request_fingerprint).
--    - Replays identical requests without mutation; rejects payload mismatch
--      with SQLSTATE 23505 (IDEMPOTENCY_KEY_CONFLICT).
-- 8. Atomic Staff Mirroring without Fabricated Defaults:
--    - NEVER fabricates operational staff profiles (title/salary/skills).
--    - Mirrors ONLY changed identity/sync fields onto existing linked staff
--      rows and NEVER silently swallows database exceptions.
-- 9. Unified Claim-Time Attempt Counting:
--    - Every transition to PROCESSING (single claim, batch claim, stale-lock
--      recovery) increments attempts by +1, enforces attempts <= max_attempts,
--      fails exhausted stale locks & orphaned deleted-user rows cleanly, and
--      never auto-retries 409 conflicts or synchronous reset_password events.
-- 10. Leaves public.vw_smav_staff_auth_status completely unchanged; creates
--     separate service_role-only view public.vw_smav_user_sync_status.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Additive Sync Tracking Columns on public.users & public.staff
--    (Never alters existing rows' emails, roles, passwords, statuses, or UUIDs)
-- ============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS central_auth_id UUID,
  ADD COLUMN IF NOT EXISTS central_auth_status TEXT DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS central_auth_linked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS central_outlet_code TEXT DEFAULT 'glossylooks',
  ADD COLUMN IF NOT EXISTS central_sync_version BIGINT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS central_last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS central_sync_origin TEXT DEFAULT 'outlet_admin',
  ADD COLUMN IF NOT EXISTS central_sync_status TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS central_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS central_sync_last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS central_sync_outbox_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'chk_users_central_sync_status'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT chk_users_central_sync_status
      CHECK (central_sync_status IN ('SYNCED', 'PENDING', 'FAILED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_central_auth_id
  ON public.users (central_auth_id);

CREATE INDEX IF NOT EXISTS idx_users_central_sync_status
  ON public.users (central_sync_status);

-- Enforce 1:1 Central Auth UUID uniqueness ONLY if no legacy duplicates exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public' AND indexname = 'uq_users_central_auth_id'
  ) THEN
    IF NOT EXISTS (
      SELECT central_auth_id
      FROM public.users
      WHERE central_auth_id IS NOT NULL
      GROUP BY central_auth_id
      HAVING COUNT(*) > 1
    ) THEN
      CREATE UNIQUE INDEX uq_users_central_auth_id
        ON public.users (central_auth_id)
        WHERE central_auth_id IS NOT NULL;
    ELSE
      RAISE NOTICE 'Skipped uq_users_central_auth_id because duplicate central_auth_id values exist in public.users; run read-only reconciliation audit first.';
    END IF;
  END IF;
END $$;

-- Mirror missing sync status columns onto public.staff if the table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'staff'
  ) THEN
    ALTER TABLE public.staff
      ADD COLUMN IF NOT EXISTS username TEXT,
      ADD COLUMN IF NOT EXISTS central_auth_id UUID,
      ADD COLUMN IF NOT EXISTS central_auth_status TEXT DEFAULT 'ACTIVE',
      ADD COLUMN IF NOT EXISTS central_auth_linked_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS central_outlet_code TEXT DEFAULT 'glossylooks',
      ADD COLUMN IF NOT EXISTS central_sync_version BIGINT DEFAULT 1,
      ADD COLUMN IF NOT EXISTS central_last_synced_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS central_sync_origin TEXT DEFAULT 'outlet_admin',
      ADD COLUMN IF NOT EXISTS central_sync_status TEXT NOT NULL DEFAULT 'PENDING',
      ADD COLUMN IF NOT EXISTS central_sync_error TEXT,
      ADD COLUMN IF NOT EXISTS central_sync_last_attempt_at TIMESTAMPTZ;

    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conname = 'chk_staff_central_sync_status'
        AND conrelid = 'public.staff'::regclass
    ) THEN
      ALTER TABLE public.staff
        ADD CONSTRAINT chk_staff_central_sync_status
        CHECK (central_sync_status IN ('SYNCED', 'PENDING', 'FAILED'));
    END IF;
  END IF;
END $$;

-- ============================================================================
-- 2. Service-Role Authorization Helper (Blocks anon/authenticated)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.smav_assert_service_role()
RETURNS VOID
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_jwt_role TEXT;
  v_claims_raw TEXT;
BEGIN
  v_jwt_role := NULLIF(pg_catalog.current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role IS NULL THEN
    v_claims_raw := NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '');
    IF v_claims_raw IS NOT NULL THEN
      v_jwt_role := NULLIF(v_claims_raw::jsonb ->> 'role', '');
    END IF;
  END IF;

  -- When invoked via PostgREST, strictly require service_role JWT claim.
  -- When invoked directly in a DBA SQL session with no JWT claim, allow only privileged DB admin roles.
  IF v_jwt_role IS NOT NULL THEN
    IF v_jwt_role <> 'service_role' THEN
      RAISE EXCEPTION 'Forbidden: service_role authorization required (got %)', v_jwt_role
        USING ERRCODE = '42501';
    END IF;
  ELSIF SESSION_USER NOT IN ('postgres', 'supabase_admin', 'service_role') THEN
    RAISE EXCEPTION 'Forbidden: service_role authorization required'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.smav_assert_service_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.smav_assert_service_role() TO service_role;

-- ============================================================================
-- 3. Recursive Secret-Key & Credential Leak Guards (Top-Level + Nested JSONB)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.smav_jsonb_contains_secret_key(p_val JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_key TEXT;
  v_elem JSONB;
BEGIN
  IF p_val IS NULL THEN
    RETURN FALSE;
  END IF;

  IF pg_catalog.jsonb_typeof(p_val) = 'object' THEN
    FOR v_key, v_elem IN SELECT * FROM pg_catalog.jsonb_each(p_val)
    LOOP
      IF v_key ~* '(pass(word|wd)?|pwd|secret|token|hash|credential|api[_-]?key|authorization|bearer|jwt|private[_-]?key|access[_-]?key|session[_-]?id|refresh)' THEN
        RETURN TRUE;
      END IF;
      IF public.smav_jsonb_contains_secret_key(v_elem) THEN
        RETURN TRUE;
      END IF;
    END LOOP;
  ELSIF pg_catalog.jsonb_typeof(p_val) = 'array' THEN
    FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_val)
    LOOP
      IF public.smav_jsonb_contains_secret_key(v_elem) THEN
        RETURN TRUE;
      END IF;
    END LOOP;
  END IF;

  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.smav_text_contains_secret(p_text TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_cleaned TEXT;
BEGIN
  IF p_text IS NULL OR pg_catalog.btrim(p_text) = '' THEN
    RETURN FALSE;
  END IF;

  -- Ignore already-redacted markers ([REDACTED], [REDACTED_JWT], etc.) before scanning
  v_cleaned := pg_catalog.regexp_replace(p_text, '\[REDACTED(?:_[A-Z0-9]+)?\]', '', 'gi');

  -- Reject raw JWTs
  IF v_cleaned ~ 'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}' THEN
    RETURN TRUE;
  END IF;

  -- Reject raw Bearer credentials
  IF v_cleaned ~* 'Bearer[[:space:]]+[A-Za-z0-9._~+/=-]{8,}' THEN
    RETURN TRUE;
  END IF;

  -- Reject key=value or key:value credential assignments
  IF v_cleaned ~* '(new_?password|initial_?password|password_hash|password|passwd|reset_?token|token|x-integration-key|apikey|api_key|secret_key|secret)[[:space:]]*[:=][[:space:]]*[^[:space:],;}"'']{4,}' THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- ============================================================================
-- 4. Durable, Audit-Preserving SMAV User Synchronization Outbox Table
--    - Replaces ON DELETE CASCADE with ON DELETE SET NULL + immutable
--      audit_local_user_id UUID NOT NULL snapshot column.
--    - Preserves all historical sync evidence when users are deactivated or deleted.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.smav_user_sync_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT,
  local_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  audit_local_user_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'USER_CREATED',
    'USER_UPDATED',
    'EMAIL_CHANGED',
    'ROLE_CHANGED',
    'USER_ACTIVATED',
    'USER_DEACTIVATED',
    'PASSWORD_RESET',
    'RECONCILE_USER'
  )),
  action TEXT NOT NULL CHECK (action IN (
    'upsert_user',
    'update_user',
    'set_status',
    'reset_password'
  )),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'SYNCED', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 6,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  last_http_status INTEGER,
  last_error TEXT,
  conflict BOOLEAN NOT NULL DEFAULT FALSE,
  response_central_auth_id UUID,
  performed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at TIMESTAMPTZ,
  CONSTRAINT chk_smav_outbox_audit_user_match CHECK (local_user_id IS NULL OR local_user_id = audit_local_user_id),
  CONSTRAINT chk_smav_outbox_bounded_attempts CHECK (attempts >= 0 AND max_attempts BETWEEN 1 AND 20 AND attempts <= max_attempts),
  CONSTRAINT chk_smav_outbox_reset_pwd_sync_only CHECK (action <> 'reset_password' OR (max_attempts = 1 AND status <> 'PENDING')),
  CONSTRAINT chk_smav_outbox_conflict_not_pending CHECK (NOT conflict OR status = 'FAILED'),
  CONSTRAINT chk_smav_outbox_no_plaintext_secrets CHECK (NOT public.smav_jsonb_contains_secret_key(payload)),
  CONSTRAINT chk_smav_outbox_no_secret_in_error CHECK (NOT public.smav_text_contains_secret(last_error))
);

ALTER TABLE public.smav_user_sync_outbox
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS audit_local_user_id UUID;

-- Safely migrate an existing smav_user_sync_outbox from any earlier draft:
-- replace ON DELETE CASCADE with ON DELETE SET NULL + backfill immutable audit_local_user_id
DO $$
DECLARE
  v_fk RECORD;
  v_has_set_null_fk BOOLEAN := FALSE;
BEGIN
  -- Backfill audit_local_user_id for any pre-existing rows before setting NOT NULL
  UPDATE public.smav_user_sync_outbox
  SET audit_local_user_id = local_user_id
  WHERE audit_local_user_id IS NULL AND local_user_id IS NOT NULL;

  -- Allow local_user_id to become NULL on user deletion (while audit_local_user_id preserves history)
  ALTER TABLE public.smav_user_sync_outbox
    ALTER COLUMN local_user_id DROP NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM public.smav_user_sync_outbox WHERE audit_local_user_id IS NULL
  ) THEN
    ALTER TABLE public.smav_user_sync_outbox
      ALTER COLUMN audit_local_user_id SET NOT NULL;
  END IF;

  -- Drop any ON DELETE CASCADE (or non-SET-NULL) FK on local_user_id referencing public.users
  FOR v_fk IN
    SELECT c.conname, c.confdeltype
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.smav_user_sync_outbox'::regclass
      AND c.contype = 'f'
      AND c.confrelid = 'public.users'::regclass
  LOOP
    IF v_fk.confdeltype = 'n' THEN
      v_has_set_null_fk := TRUE;
    ELSE
      EXECUTE format(
        'ALTER TABLE public.smav_user_sync_outbox DROP CONSTRAINT %I',
        v_fk.conname
      );
    END IF;
  END LOOP;

  IF NOT v_has_set_null_fk THEN
    ALTER TABLE public.smav_user_sync_outbox
      ADD CONSTRAINT fk_smav_outbox_local_user_id
      FOREIGN KEY (local_user_id)
      REFERENCES public.users(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'chk_smav_outbox_audit_user_match'
      AND conrelid = 'public.smav_user_sync_outbox'::regclass
  ) THEN
    ALTER TABLE public.smav_user_sync_outbox
      ADD CONSTRAINT chk_smav_outbox_audit_user_match
      CHECK (local_user_id IS NULL OR local_user_id = audit_local_user_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'chk_smav_outbox_no_plaintext_secrets'
      AND conrelid = 'public.smav_user_sync_outbox'::regclass
  ) THEN
    ALTER TABLE public.smav_user_sync_outbox
      DROP CONSTRAINT chk_smav_outbox_no_plaintext_secrets;
  END IF;
  ALTER TABLE public.smav_user_sync_outbox
    ADD CONSTRAINT chk_smav_outbox_no_plaintext_secrets
    CHECK (NOT public.smav_jsonb_contains_secret_key(payload));

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'chk_smav_outbox_bounded_attempts'
      AND conrelid = 'public.smav_user_sync_outbox'::regclass
  ) THEN
    ALTER TABLE public.smav_user_sync_outbox
      DROP CONSTRAINT chk_smav_outbox_bounded_attempts;
  END IF;
  ALTER TABLE public.smav_user_sync_outbox
    ADD CONSTRAINT chk_smav_outbox_bounded_attempts
    CHECK (attempts >= 0 AND max_attempts BETWEEN 1 AND 20 AND attempts <= max_attempts);

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'chk_smav_outbox_reset_pwd_sync_only'
      AND conrelid = 'public.smav_user_sync_outbox'::regclass
  ) THEN
    ALTER TABLE public.smav_user_sync_outbox
      ADD CONSTRAINT chk_smav_outbox_reset_pwd_sync_only
      CHECK (action <> 'reset_password' OR (max_attempts = 1 AND status <> 'PENDING'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'chk_smav_outbox_conflict_not_pending'
      AND conrelid = 'public.smav_user_sync_outbox'::regclass
  ) THEN
    ALTER TABLE public.smav_user_sync_outbox
      ADD CONSTRAINT chk_smav_outbox_conflict_not_pending
      CHECK (NOT conflict OR status = 'FAILED');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'chk_smav_outbox_no_secret_in_error'
      AND conrelid = 'public.smav_user_sync_outbox'::regclass
  ) THEN
    ALTER TABLE public.smav_user_sync_outbox
      ADD CONSTRAINT chk_smav_outbox_no_secret_in_error
      CHECK (NOT public.smav_text_contains_secret(last_error));
  END IF;
END $$;

-- Automatically populate & lock immutable audit_local_user_id on smav_user_sync_outbox
CREATE OR REPLACE FUNCTION public.smav_outbox_enforce_audit_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.audit_local_user_id IS NULL THEN
      NEW.audit_local_user_id := NEW.local_user_id;
    END IF;
    IF NEW.audit_local_user_id IS NULL THEN
      RAISE EXCEPTION 'audit_local_user_id is required on smav_user_sync_outbox' USING ERRCODE = '23502';
    END IF;
    IF NEW.local_user_id IS NOT NULL AND NEW.local_user_id <> NEW.audit_local_user_id THEN
      RAISE EXCEPTION 'audit_local_user_id must match local_user_id' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.audit_local_user_id IS DISTINCT FROM OLD.audit_local_user_id THEN
      RAISE EXCEPTION 'Forbidden: audit_local_user_id on smav_user_sync_outbox is immutable.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_smav_outbox_enforce_audit_user ON public.smav_user_sync_outbox;
CREATE TRIGGER trg_smav_outbox_enforce_audit_user
  BEFORE INSERT OR UPDATE ON public.smav_user_sync_outbox
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_outbox_enforce_audit_user();

-- Preserve historical sync evidence: prohibit DELETE and TRUNCATE on smav_user_sync_outbox
CREATE OR REPLACE FUNCTION public.smav_outbox_preserve_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION
    'Forbidden: public.smav_user_sync_outbox preserves historical sync evidence; DELETE and TRUNCATE are prohibited.'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_smav_outbox_no_delete ON public.smav_user_sync_outbox;
CREATE TRIGGER trg_smav_outbox_no_delete
  BEFORE DELETE ON public.smav_user_sync_outbox
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_outbox_preserve_history();

DROP TRIGGER IF EXISTS trg_smav_outbox_no_truncate ON public.smav_user_sync_outbox;
CREATE TRIGGER trg_smav_outbox_no_truncate
  BEFORE TRUNCATE ON public.smav_user_sync_outbox
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.smav_outbox_preserve_history();

CREATE INDEX IF NOT EXISTS idx_smav_user_sync_outbox_due
  ON public.smav_user_sync_outbox (status, next_retry_at)
  WHERE status IN ('PENDING', 'PROCESSING') AND conflict = FALSE AND action <> 'reset_password';

CREATE INDEX IF NOT EXISTS idx_smav_user_sync_outbox_user
  ON public.smav_user_sync_outbox (local_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_smav_user_sync_outbox_audit_user
  ON public.smav_user_sync_outbox (audit_local_user_id, created_at DESC);

ALTER TABLE public.smav_user_sync_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.smav_user_sync_outbox FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.smav_user_sync_outbox TO service_role;

-- ============================================================================
-- 5. Hardened Tamper-Resistant Central Auth Reconciliation Audit & Triggers
--    - Append-only audit table: service_role gets SELECT ONLY (NO INSERT/UPDATE/DELETE)
--    - BEFORE UPDATE/DELETE/TRUNCATE triggers unconditionally block tampering
--    - BEFORE INSERT trigger verifies PG_CONTEXT so ONLY the two approved
--      SECURITY DEFINER functions can create audit records:
--        1. public.smav_link_verified_central_auth_id(...)
--        2. public.smav_admin_reconcile_central_auth_id(...)
--    - BEFORE UPDATE trigger on public.users & public.staff blocks ALL
--      unapproved central_auth_id changes — INCLUDING NULL -> UUID!
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.smav_central_auth_reconciliation_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL DEFAULT 'MANUAL_RECONCILE' CHECK (action_type IN ('MANUAL_RECONCILE', 'VERIFIED_LINK')),
  target_table TEXT NOT NULL CHECK (target_table IN ('users', 'staff')),
  target_row_id UUID NOT NULL,
  previous_central_auth_id UUID,
  new_central_auth_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (pg_catalog.char_length(pg_catalog.btrim(reason)) >= 12),
  ticket_ref TEXT,
  performed_by TEXT NOT NULL CHECK (pg_catalog.char_length(pg_catalog.btrim(performed_by)) >= 2),
  db_session_user TEXT NOT NULL DEFAULT SESSION_USER,
  xact_id BIGINT NOT NULL DEFAULT pg_catalog.txid_current(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.smav_central_auth_reconciliation_audit
  ADD COLUMN IF NOT EXISTS action_type TEXT NOT NULL DEFAULT 'MANUAL_RECONCILE',
  ADD COLUMN IF NOT EXISTS xact_id BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'chk_smav_reconcile_audit_action_type'
      AND conrelid = 'public.smav_central_auth_reconciliation_audit'::regclass
  ) THEN
    ALTER TABLE public.smav_central_auth_reconciliation_audit
      ADD CONSTRAINT chk_smav_reconcile_audit_action_type
      CHECK (action_type IN ('MANUAL_RECONCILE', 'VERIFIED_LINK'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_smav_reconcile_audit_target
  ON public.smav_central_auth_reconciliation_audit (target_table, target_row_id, created_at DESC);

ALTER TABLE public.smav_central_auth_reconciliation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.smav_central_auth_reconciliation_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.smav_central_auth_reconciliation_audit TO service_role;

-- 5A. Block ALL UPDATE, DELETE, and TRUNCATE on reconciliation audit table
CREATE OR REPLACE FUNCTION public.smav_immutable_reconciliation_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION
    'Forbidden: public.smav_central_auth_reconciliation_audit is strictly append-only; UPDATE, DELETE, and TRUNCATE are prohibited.'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.smav_immutable_reconciliation_audit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_smav_reconcile_audit_immutable ON public.smav_central_auth_reconciliation_audit;
CREATE TRIGGER trg_smav_reconcile_audit_immutable
  BEFORE UPDATE OR DELETE ON public.smav_central_auth_reconciliation_audit
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_immutable_reconciliation_audit();

DROP TRIGGER IF EXISTS trg_smav_reconcile_audit_no_truncate ON public.smav_central_auth_reconciliation_audit;
CREATE TRIGGER trg_smav_reconcile_audit_no_truncate
  BEFORE TRUNCATE ON public.smav_central_auth_reconciliation_audit
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.smav_immutable_reconciliation_audit();

-- 5B. Block direct INSERTs into reconciliation audit table; allow ONLY the two approved RPCs via PG_CONTEXT
CREATE OR REPLACE FUNCTION public.smav_guard_reconciliation_audit_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_stack TEXT;
BEGIN
  GET DIAGNOSTICS v_stack = PG_CONTEXT;

  IF v_stack IS NULL OR v_stack !~ 'PL/pgSQL function (?:public\.)?(?:smav_admin_reconcile_central_auth_id|smav_link_verified_central_auth_id)\(' THEN
    RAISE EXCEPTION
      'Forbidden: audit entries in public.smav_central_auth_reconciliation_audit may only be created by public.smav_admin_reconcile_central_auth_id(...) or public.smav_link_verified_central_auth_id(...).'
      USING ERRCODE = '42501';
  END IF;

  NEW.xact_id := pg_catalog.txid_current();
  NEW.db_session_user := SESSION_USER;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.smav_guard_reconciliation_audit_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_smav_reconcile_audit_insert_gate ON public.smav_central_auth_reconciliation_audit;
CREATE TRIGGER trg_smav_reconcile_audit_insert_gate
  BEFORE INSERT ON public.smav_central_auth_reconciliation_audit
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_guard_reconciliation_audit_insert();

-- 5C. Protect ALL central_auth_id changes (INCLUDING NULL -> UUID and UUID -> UUID)
--     Requires BOTH server-verified PG_CONTEXT AND a current-transaction matching audit row
CREATE OR REPLACE FUNCTION public.smav_protect_central_auth_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_stack TEXT;
  v_audit_id_text TEXT;
  v_audit_id UUID;
  v_verified BOOLEAN := FALSE;
BEGIN
  IF NEW.central_auth_id IS DISTINCT FROM OLD.central_auth_id THEN

    -- Clearing an existing non-NULL central_auth_id is never permitted
    IF OLD.central_auth_id IS NOT NULL AND NEW.central_auth_id IS NULL THEN
      RAISE EXCEPTION
        'Protected Central Auth link: cannot clear existing central_auth_id (%) on %.% (row id=%).',
        OLD.central_auth_id, TG_TABLE_SCHEMA, TG_TABLE_NAME, OLD.id
        USING ERRCODE = '23514';
    END IF;

    -- 1. Verify actual server-side PL/pgSQL call stack (cannot be spoofed by session settings)
    GET DIAGNOSTICS v_stack = PG_CONTEXT;
    IF v_stack IS NULL OR v_stack !~ 'PL/pgSQL function (?:public\.)?(?:smav_admin_reconcile_central_auth_id|smav_link_verified_central_auth_id)\(' THEN
      RAISE EXCEPTION
        'Protected Central Auth link: ordinary updates cannot assign or modify central_auth_id on %.% (row id=%). Use public.smav_link_verified_central_auth_id(...) for verified SMAV linking or public.smav_admin_reconcile_central_auth_id(...) for audited manual reconciliation.',
        TG_TABLE_SCHEMA, TG_TABLE_NAME, OLD.id
        USING ERRCODE = '23514';
    END IF;

    -- 2. Verify a matching audit entry created inside THIS EXACT transaction (txid_current)
    v_audit_id_text := NULLIF(pg_catalog.current_setting('app.smav_reconcile_audit_id', true), '');
    IF v_audit_id_text IS NOT NULL THEN
      BEGIN
        v_audit_id := v_audit_id_text::uuid;
        SELECT EXISTS (
          SELECT 1
          FROM public.smav_central_auth_reconciliation_audit a
          WHERE a.id = v_audit_id
            AND a.xact_id = pg_catalog.txid_current()
            AND a.target_table = TG_TABLE_NAME
            AND a.target_row_id = OLD.id
            AND a.previous_central_auth_id IS NOT DISTINCT FROM OLD.central_auth_id
            AND a.new_central_auth_id = NEW.central_auth_id
        ) INTO v_verified;
      EXCEPTION WHEN invalid_text_representation THEN
        v_verified := FALSE;
      END;
    END IF;

    IF NOT v_verified THEN
      RAISE EXCEPTION
        'Protected Central Auth link: missing verified transaction audit record for central_auth_id change on %.% (row id=%).',
        TG_TABLE_SCHEMA, TG_TABLE_NAME, OLD.id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.smav_protect_central_auth_id() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_users_protect_central_auth_id ON public.users;
CREATE TRIGGER trg_users_protect_central_auth_id
  BEFORE UPDATE OF central_auth_id ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_protect_central_auth_id();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'staff'
  ) THEN
    DROP TRIGGER IF EXISTS trg_staff_protect_central_auth_id ON public.staff;
    CREATE TRIGGER trg_staff_protect_central_auth_id
      BEFORE UPDATE OF central_auth_id ON public.staff
      FOR EACH ROW
      EXECUTE FUNCTION public.smav_protect_central_auth_id();
  END IF;
END $$;

-- 5D. Privileged, Verified, Audited Central Auth Linking RPC (NULL -> Verified UUID only)
--     Requires verified Central SMAV ownership evidence:
--       - 'smav_sync_response': MUST match a SYNCED outbox row for (p_local_user_id, p_verified_central_auth_id)
--       Webhook-originated UUIDs are deliberately not accepted here until
--       durable signature-verified, replay-protected evidence is available.
--     NEVER overwrites a different existing central_auth_id (fail closed with 23514).
CREATE OR REPLACE FUNCTION public.smav_link_verified_central_auth_id(
  p_local_user_id UUID,
  p_verified_central_auth_id UUID,
  p_verification_source TEXT,
  p_evidence_ref TEXT,
  p_performed_by TEXT DEFAULT 'SMAV Sync'
)
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.now();
  v_source TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_verification_source, '')));
  v_evidence TEXT := pg_catalog.btrim(COALESCE(p_evidence_ref, ''));
  v_actor TEXT := COALESCE(NULLIF(pg_catalog.btrim(COALESCE(p_performed_by, '')), ''), 'SMAV Sync');
  v_user public.users;
  v_staff_id UUID;
  v_staff_cid UUID;
  v_audit_id UUID;
  v_evidence_uuid UUID;
  v_has_sync_evidence BOOLEAN := FALSE;
BEGIN
  PERFORM public.smav_assert_service_role();

  IF p_local_user_id IS NULL OR p_verified_central_auth_id IS NULL THEN
    RAISE EXCEPTION 'p_local_user_id and p_verified_central_auth_id are required' USING ERRCODE = '22023';
  END IF;

  IF v_source <> 'smav_sync_response' THEN
    RAISE EXCEPTION 'Invalid verification_source: only smav_sync_response is accepted for Central Auth identity linking' USING ERRCODE = '42501';
  END IF;

  IF pg_catalog.char_length(v_evidence) < 6 THEN
    RAISE EXCEPTION 'Verified SMAV ownership evidence reference (>= 6 chars) is required' USING ERRCODE = '22023';
  END IF;

  -- Prove ownership against the committed SYNCED outbox record.
  BEGIN
    v_evidence_uuid := v_evidence::uuid;
    SELECT EXISTS (
      SELECT 1
      FROM public.smav_user_sync_outbox o
      WHERE o.id = v_evidence_uuid
        AND o.local_user_id = p_local_user_id
        AND o.status = 'SYNCED'
        AND o.response_central_auth_id = p_verified_central_auth_id
    ) INTO v_has_sync_evidence;
  EXCEPTION WHEN invalid_text_representation THEN
    v_has_sync_evidence := FALSE;
  END;

  IF NOT v_has_sync_evidence THEN
    RAISE EXCEPTION
      'Unverified Central Auth link rejected: no matching SYNCED outbox evidence (%) for user % and UUID %.',
      v_evidence, p_local_user_id, p_verified_central_auth_id
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_user
  FROM public.users
  WHERE id = p_local_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target public.users row % not found', p_local_user_id USING ERRCODE = 'P0002';
  END IF;

  -- Never reassign an existing different central_auth_id here (requires manual reconciliation RPC)
  IF v_user.central_auth_id IS NOT NULL AND v_user.central_auth_id <> p_verified_central_auth_id THEN
    RAISE EXCEPTION
      'Protected Central Auth link: user % is already linked to % (cannot link %). Use smav_admin_reconcile_central_auth_id for manual reconciliation.',
      p_local_user_id, v_user.central_auth_id, p_verified_central_auth_id
      USING ERRCODE = '23514';
  END IF;

  -- Enforce 1:1 ownership across public.users
  IF EXISTS (
    SELECT 1 FROM public.users
    WHERE central_auth_id = p_verified_central_auth_id AND id <> p_local_user_id
  ) THEN
    RAISE EXCEPTION
      'Central Auth UUID % is already assigned to another public.users row',
      p_verified_central_auth_id
      USING ERRCODE = '23505';
  END IF;

  -- Link public.users.central_auth_id if currently NULL
  IF v_user.central_auth_id IS NULL THEN
    INSERT INTO public.smav_central_auth_reconciliation_audit (
      action_type,
      target_table,
      target_row_id,
      previous_central_auth_id,
      new_central_auth_id,
      reason,
      ticket_ref,
      performed_by,
      created_at
    )
    VALUES (
      'VERIFIED_LINK',
      'users',
      p_local_user_id,
      NULL,
      p_verified_central_auth_id,
      'Verified Central SMAV identity link via ' || v_source || ' (evidence: ' || v_evidence || ')',
      v_evidence,
      v_actor,
      v_now
    )
    RETURNING id INTO v_audit_id;

    PERFORM pg_catalog.set_config('app.smav_reconcile_audit_id', v_audit_id::text, true);

    UPDATE public.users
    SET
      central_auth_id = p_verified_central_auth_id,
      central_auth_linked_at = COALESCE(central_auth_linked_at, v_now),
      updated_at = v_now
    WHERE id = p_local_user_id
    RETURNING * INTO v_user;

    PERFORM pg_catalog.set_config('app.smav_reconcile_audit_id', '', true);
  END IF;

  -- Also link existing linked public.staff row ONLY if its central_auth_id is currently NULL
  -- and p_verified_central_auth_id is not owned by another staff row (never overwrites existing staff UUID)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'staff'
  ) THEN
    SELECT s.id, s.central_auth_id INTO v_staff_id, v_staff_cid
    FROM public.staff s
    WHERE s.user_id = p_local_user_id
    FOR UPDATE;

    IF FOUND AND v_staff_cid IS NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.staff
        WHERE central_auth_id = p_verified_central_auth_id AND id <> v_staff_id
      ) THEN
        INSERT INTO public.smav_central_auth_reconciliation_audit (
          action_type,
          target_table,
          target_row_id,
          previous_central_auth_id,
          new_central_auth_id,
          reason,
          ticket_ref,
          performed_by,
          created_at
        )
        VALUES (
          'VERIFIED_LINK',
          'staff',
          v_staff_id,
          NULL,
          p_verified_central_auth_id,
          'Verified Central SMAV identity link mirrored via ' || v_source || ' (evidence: ' || v_evidence || ')',
          v_evidence,
          v_actor,
          v_now
        )
        RETURNING id INTO v_audit_id;

        PERFORM pg_catalog.set_config('app.smav_reconcile_audit_id', v_audit_id::text, true);

        UPDATE public.staff
        SET
          central_auth_id = p_verified_central_auth_id,
          central_auth_linked_at = COALESCE(central_auth_linked_at, v_now)
        WHERE id = v_staff_id;

        PERFORM pg_catalog.set_config('app.smav_reconcile_audit_id', '', true);
      END IF;
    END IF;
  END IF;

  RETURN v_user;
END;
$$;

REVOKE ALL ON FUNCTION public.smav_link_verified_central_auth_id(UUID, UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.smav_link_verified_central_auth_id(UUID, UUID, TEXT, TEXT, TEXT)
  TO service_role;

-- 5E. Privileged, Compare-and-Swap, Audited Manual Reconciliation RPC
CREATE OR REPLACE FUNCTION public.smav_admin_reconcile_central_auth_id(
  p_target_table TEXT,
  p_target_row_id UUID,
  p_expected_old_central_auth_id UUID,
  p_new_central_auth_id UUID,
  p_reason TEXT,
  p_performed_by TEXT,
  p_ticket_ref TEXT DEFAULT NULL
)
RETURNS public.smav_central_auth_reconciliation_audit
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.now();
  v_table TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_target_table, '')));
  v_current_cid UUID;
  v_audit public.smav_central_auth_reconciliation_audit;
BEGIN
  PERFORM public.smav_assert_service_role();

  IF v_table NOT IN ('users', 'staff') THEN
    RAISE EXCEPTION 'Invalid target table: expected users or staff' USING ERRCODE = '22023';
  END IF;

  IF p_new_central_auth_id IS NULL THEN
    RAISE EXCEPTION 'p_new_central_auth_id is required' USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.char_length(pg_catalog.btrim(COALESCE(p_reason, ''))) < 12 THEN
    RAISE EXCEPTION 'A detailed reconciliation reason (>= 12 characters) is required' USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.char_length(pg_catalog.btrim(COALESCE(p_performed_by, ''))) < 2 THEN
    RAISE EXCEPTION 'performed_by actor identity is required' USING ERRCODE = '22023';
  END IF;

  IF v_table = 'users' THEN
    SELECT central_auth_id INTO v_current_cid
    FROM public.users
    WHERE id = p_target_row_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target public.users row % not found', p_target_row_id USING ERRCODE = 'P0002';
    END IF;

    IF v_current_cid IS DISTINCT FROM p_expected_old_central_auth_id THEN
      RAISE EXCEPTION
        'Compare-and-swap failed on public.users (%): expected central_auth_id %, found %',
        p_target_row_id, p_expected_old_central_auth_id, v_current_cid
        USING ERRCODE = '40001';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.users
      WHERE central_auth_id = p_new_central_auth_id AND id <> p_target_row_id
    ) THEN
      RAISE EXCEPTION
        'Central Auth UUID % is already assigned to another public.users row',
        p_new_central_auth_id
        USING ERRCODE = '23505';
    END IF;
  ELSE
    SELECT central_auth_id INTO v_current_cid
    FROM public.staff
    WHERE id = p_target_row_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target public.staff row % not found', p_target_row_id USING ERRCODE = 'P0002';
    END IF;

    IF v_current_cid IS DISTINCT FROM p_expected_old_central_auth_id THEN
      RAISE EXCEPTION
        'Compare-and-swap failed on public.staff (%): expected central_auth_id %, found %',
        p_target_row_id, p_expected_old_central_auth_id, v_current_cid
        USING ERRCODE = '40001';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.staff
      WHERE central_auth_id = p_new_central_auth_id AND id <> p_target_row_id
    ) THEN
      RAISE EXCEPTION
        'Central Auth UUID % is already assigned to another public.staff row',
        p_new_central_auth_id
        USING ERRCODE = '23505';
    END IF;
  END IF;

  -- 1. Record immutable audit entry FIRST (enforced by trg_smav_reconcile_audit_insert_gate)
  INSERT INTO public.smav_central_auth_reconciliation_audit (
    action_type,
    target_table,
    target_row_id,
    previous_central_auth_id,
    new_central_auth_id,
    reason,
    ticket_ref,
    performed_by,
    created_at
  )
  VALUES (
    'MANUAL_RECONCILE',
    v_table,
    p_target_row_id,
    v_current_cid,
    p_new_central_auth_id,
    pg_catalog.btrim(p_reason),
    NULLIF(pg_catalog.btrim(COALESCE(p_ticket_ref, '')), ''),
    pg_catalog.btrim(p_performed_by),
    v_now
  )
  RETURNING * INTO v_audit;

  -- 2. Bind this exact transaction-local audit ID so trigger verifies PG_CONTEXT + txid_current()
  PERFORM pg_catalog.set_config('app.smav_reconcile_audit_id', v_audit.id::text, true);

  -- 3. Apply reconciled UUID and reset central_sync_status to PENDING for live verification
  IF v_table = 'users' THEN
    UPDATE public.users
    SET
      central_auth_id = p_new_central_auth_id,
      central_auth_linked_at = COALESCE(central_auth_linked_at, v_now),
      central_sync_status = 'PENDING',
      central_sync_error = NULL,
      updated_at = v_now
    WHERE id = p_target_row_id;
  ELSE
    UPDATE public.staff
    SET
      central_auth_id = p_new_central_auth_id,
      central_auth_linked_at = COALESCE(central_auth_linked_at, v_now),
      central_sync_status = 'PENDING',
      central_sync_error = NULL
    WHERE id = p_target_row_id;
  END IF;

  PERFORM pg_catalog.set_config('app.smav_reconcile_audit_id', '', true);

  RETURN v_audit;
END;
$$;

REVOKE ALL ON FUNCTION public.smav_admin_reconcile_central_auth_id(
  TEXT, UUID, UUID, UUID, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.smav_admin_reconcile_central_auth_id(
  TEXT, UUID, UUID, UUID, TEXT, TEXT, TEXT
) TO service_role;

-- ============================================================================
-- 6. Hardened Service-Role-Only Transactional RPCs (SECURITY DEFINER)
-- ============================================================================

-- 6A. Atomic Single-Transaction RPC: Create Admin User + Enqueue Outbox
--     - Locks idempotency_key BEFORE any mutation
--     - Includes non-secret p_credential_mode ('explicit' | 'generated') in
--       request_fingerprint (NEVER persists plaintext passwords or password hashes)
--     - Replays identical key without mutating users; rejects mismatched payload (23505)
--     - Backend additionally verifies supplied password against user.password_hash on replay
--     - Adapts cleanly to production public.users columns (user_id, branch_id)
--     - Does NOT fabricate default operational public.staff records (salary/skills/title)
CREATE OR REPLACE FUNCTION public.smav_create_user_and_enqueue_sync(
  p_user_code TEXT,
  p_name TEXT,
  p_email TEXT,
  p_phone TEXT,
  p_role TEXT,
  p_password_hash TEXT,
  p_username TEXT DEFAULT NULL,
  p_branch_id TEXT DEFAULT 'tgl-gachibowli-main',
  p_is_active BOOLEAN DEFAULT TRUE,
  p_idempotency_key TEXT DEFAULT NULL,
  p_event_type TEXT DEFAULT 'USER_CREATED',
  p_action TEXT DEFAULT 'upsert_user',
  p_performed_by TEXT DEFAULT 'Owner',
  p_max_attempts INTEGER DEFAULT 6,
  p_credential_mode TEXT DEFAULT 'generated'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.now();
  v_clean_name TEXT := pg_catalog.btrim(COALESCE(p_name, ''));
  v_clean_email TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, '')));
  v_clean_phone TEXT := pg_catalog.btrim(COALESCE(p_phone, ''));
  v_clean_role TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_role, '')));
  v_clean_code TEXT := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_user_code, '')));
  v_clean_username TEXT := NULLIF(pg_catalog.lower(pg_catalog.btrim(COALESCE(p_username, p_user_code, ''))), '');
  v_clean_branch TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_branch_id, '')), '');
  v_is_active BOOLEAN := COALESCE(p_is_active, TRUE);
  v_cred_mode TEXT := CASE WHEN pg_catalog.lower(pg_catalog.btrim(COALESCE(p_credential_mode, ''))) = 'explicit' THEN 'explicit' ELSE 'generated' END;
  v_smav_role TEXT := CASE WHEN v_clean_role IN ('owner', 'manager') THEN 'ADMIN' ELSE 'POS_BILLING' END;
  v_idem_key TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_idempotency_key, '')), '');
  v_fingerprint TEXT;
  v_user public.users;
  v_outbox public.smav_user_sync_outbox;
  v_payload JSONB;
  v_has_user_id_col BOOLEAN;
  v_has_branch_col BOOLEAN;
BEGIN
  PERFORM public.smav_assert_service_role();

  IF v_clean_name = '' OR v_clean_email = '' OR pg_catalog.strpos(v_clean_email, '@') = 0 THEN
    RAISE EXCEPTION 'Valid name and email address are required' USING ERRCODE = '22023';
  END IF;

  IF p_action = 'reset_password' THEN
    RAISE EXCEPTION 'reset_password must execute synchronously and cannot be enqueued here' USING ERRCODE = '22023';
  END IF;

  -- Canonical non-secret request fingerprint (NEVER includes plaintext password or password_hash)
  v_fingerprint := pg_catalog.md5(jsonb_build_object(
    'op', 'create_user',
    'user_code', v_clean_code,
    'name', v_clean_name,
    'email', v_clean_email,
    'phone', v_clean_phone,
    'role', v_clean_role,
    'username', v_clean_username,
    'branch_id', v_clean_branch,
    'is_active', v_is_active,
    'credential_mode', v_cred_mode,
    'event_type', p_event_type,
    'action', p_action
  )::text);

  -- 1. Pre-mutation idempotency lock & duplicate/mismatch detection
  IF v_idem_key IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_idem_key, 0));

    SELECT * INTO v_outbox
    FROM public.smav_user_sync_outbox
    WHERE idempotency_key = v_idem_key
    FOR UPDATE;

    IF FOUND THEN
      IF v_outbox.event_type <> p_event_type
         OR v_outbox.action <> p_action
         OR (v_outbox.request_fingerprint IS NOT NULL AND v_outbox.request_fingerprint <> v_fingerprint)
         OR (v_outbox.request_fingerprint IS NULL AND COALESCE(v_outbox.payload ->> 'email', '') <> v_clean_email) THEN
        RAISE EXCEPTION
          'IDEMPOTENCY_KEY_CONFLICT: idempotency_key "%" was already used with a different request payload.',
          v_idem_key
          USING ERRCODE = '23505';
      END IF;

      IF v_outbox.local_user_id IS NULL THEN
        RAISE EXCEPTION
          'IDEMPOTENCY_KEY_CONFLICT: existing idempotency_key "%" references a deleted user.',
          v_idem_key
          USING ERRCODE = '23505';
      END IF;

      SELECT * INTO v_user
      FROM public.users
      WHERE id = v_outbox.local_user_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'IDEMPOTENCY_KEY_CONFLICT: existing idempotency_key "%" references a deleted user.',
          v_idem_key
          USING ERRCODE = '23505';
      END IF;

      RETURN jsonb_build_object(
        'user', to_jsonb(v_user),
        'outbox', to_jsonb(v_outbox),
        'created', FALSE,
        'idempotent_replay', TRUE
      );
    END IF;
  END IF;

  -- 2. Inspect actual public.users columns before INSERT (compatible with both schema.sql and supabase_schema.sql)
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'user_id'
  ) INTO v_has_user_id_col;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'branch_id'
  ) INTO v_has_branch_col;

  IF v_has_user_id_col AND v_has_branch_col THEN
    INSERT INTO public.users (
      user_id, name, email, phone, role, password_hash, username, branch_id,
      is_active, central_auth_status, central_outlet_code, central_sync_status,
      central_sync_error, created_at, updated_at
    )
    VALUES (
      v_clean_code, v_clean_name, v_clean_email, v_clean_phone,
      v_clean_role, p_password_hash, v_clean_username, COALESCE(v_clean_branch, 'tgl-gachibowli-main'),
      v_is_active,
      CASE WHEN v_is_active THEN 'ACTIVE' ELSE 'DISABLED' END,
      'glossylooks', 'PENDING', NULL, v_now, v_now
    )
    RETURNING * INTO v_user;
  ELSIF v_has_user_id_col THEN
    INSERT INTO public.users (
      user_id, name, email, phone, role, password_hash, username,
      is_active, central_auth_status, central_outlet_code, central_sync_status,
      central_sync_error, created_at, updated_at
    )
    VALUES (
      v_clean_code, v_clean_name, v_clean_email, v_clean_phone,
      v_clean_role, p_password_hash, v_clean_username,
      v_is_active,
      CASE WHEN v_is_active THEN 'ACTIVE' ELSE 'DISABLED' END,
      'glossylooks', 'PENDING', NULL, v_now, v_now
    )
    RETURNING * INTO v_user;
  ELSE
    INSERT INTO public.users (
      name, email, phone, role, password_hash, username,
      is_active, central_auth_status, central_outlet_code, central_sync_status,
      central_sync_error, created_at, updated_at
    )
    VALUES (
      v_clean_name, v_clean_email, v_clean_phone,
      v_clean_role, p_password_hash, v_clean_username,
      v_is_active,
      CASE WHEN v_is_active THEN 'ACTIVE' ELSE 'DISABLED' END,
      'glossylooks', 'PENDING', NULL, v_now, v_now
    )
    RETURNING * INTO v_user;
  END IF;

  IF v_idem_key IS NULL THEN
    v_idem_key := 'gl_' || pg_catalog.lower(p_event_type) || '_' || v_user.id::text || '_' || (EXTRACT(EPOCH FROM v_now) * 1000)::bigint::text;
  END IF;

  -- 3. Insert sanitized outbox row atomically in the same transaction
  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'externalStaffId', v_user.id::text,
    'email', v_clean_email,
    'fullName', v_user.name,
    'username', v_clean_username,
    'phone', COALESCE(v_user.phone, ''),
    'role', v_smav_role,
    'isActive', COALESCE(v_user.is_active, TRUE)
  ));

  INSERT INTO public.smav_user_sync_outbox (
    idempotency_key, request_fingerprint, local_user_id, audit_local_user_id, event_type, action, payload,
    status, attempts, max_attempts, next_retry_at, performed_by, created_at, updated_at
  )
  VALUES (
    v_idem_key, v_fingerprint, v_user.id, v_user.id, p_event_type, p_action, v_payload,
    'PENDING', 0, LEAST(GREATEST(COALESCE(p_max_attempts, 6), 1), 20), v_now,
    COALESCE(p_performed_by, 'Owner'), v_now, v_now
  )
  RETURNING * INTO v_outbox;

  UPDATE public.users
  SET central_sync_outbox_id = v_outbox.id, updated_at = v_now
  WHERE id = v_user.id
  RETURNING * INTO v_user;

  -- Operational staff profiles (job title, salary, commission, skills) are NOT fabricated here;
  -- they are created explicitly via Staff Management when operational scheduling is configured.

  RETURN jsonb_build_object(
    'user', to_jsonb(v_user),
    'outbox', to_jsonb(v_outbox),
    'created', TRUE,
    'idempotent_replay', FALSE
  );
END;
$$;

-- Safely remove legacy 14-arg overload ONLY if it exists AND has zero dependent DB objects
DO $$
DECLARE
  v_legacy_oid OID;
  v_dep_count INTEGER := 0;
BEGIN
  v_legacy_oid := to_regprocedure(
    'public.smav_create_user_and_enqueue_sync(text,text,text,text,text,text,text,text,boolean,text,text,text,text,integer)'
  );
  IF v_legacy_oid IS NOT NULL THEN
    SELECT COUNT(*) INTO v_dep_count
    FROM pg_catalog.pg_depend
    WHERE refobjid = v_legacy_oid
      AND deptype IN ('n', 'a');
    IF v_dep_count = 0 THEN
      DROP FUNCTION public.smav_create_user_and_enqueue_sync(
        TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, INTEGER
      );
    ELSE
      RAISE NOTICE 'Preserved legacy 14-arg smav_create_user_and_enqueue_sync because % dependent objects reference it.', v_dep_count;
    END IF;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.smav_create_user_and_enqueue_sync(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.smav_create_user_and_enqueue_sync(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT
) TO service_role;

-- 6B. Atomic Single-Transaction RPC: Update Admin User + Mirror Existing Staff + Enqueue Outbox
--     - Locks idempotency_key BEFORE mutating public.users or public.staff
--     - Replays identical key without mutating users; rejects mismatched payload (23505)
--     - STRICTLY FORBIDS assigning or modifying central_auth_id (even when currently NULL!)
--     - Mirrors ONLY changed identity/sync fields onto linked public.staff row (if one exists)
--       WITHOUT touching role/job title, salary, commission, skills, or central_auth_id
--     - Does NOT swallow staff-mirror failures (full transactional rollback on DB error)
CREATE OR REPLACE FUNCTION public.smav_update_user_and_enqueue_sync(
  p_local_user_id UUID,
  p_updates JSONB,
  p_idempotency_key TEXT,
  p_event_type TEXT,
  p_action TEXT,
  p_performed_by TEXT DEFAULT 'Owner',
  p_max_attempts INTEGER DEFAULT 6
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.now();
  v_idem_key TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_idempotency_key, '')), '');
  v_updates JSONB := COALESCE(p_updates, '{}'::jsonb);
  v_fingerprint TEXT;
  v_existing public.users;
  v_user public.users;
  v_outbox public.smav_user_sync_outbox;
  v_smav_role TEXT;
  v_clean_email TEXT;
  v_clean_username TEXT;
  v_payload JSONB;
  v_next_active BOOLEAN;
  v_has_user_id_col BOOLEAN;
  v_has_staff_table BOOLEAN;
  v_staff_set_clauses TEXT[] := ARRAY[]::TEXT[];
  v_has_staff_email BOOLEAN;
  v_has_staff_admin_uid BOOLEAN;
  v_has_staff_branch BOOLEAN;
BEGIN
  PERFORM public.smav_assert_service_role();

  IF v_idem_key IS NULL THEN
    RAISE EXCEPTION 'p_idempotency_key is required' USING ERRCODE = '22023';
  END IF;

  IF p_action = 'reset_password' THEN
    RAISE EXCEPTION 'reset_password must execute synchronously and cannot be enqueued here' USING ERRCODE = '22023';
  END IF;

  -- Strictly forbid ordinary Admin User updates from assigning or modifying central_auth_id (even when NULL)
  IF v_updates ? 'central_auth_id' THEN
    RAISE EXCEPTION
      'CENTRAL_AUTH_LINK_FORBIDDEN: ordinary user updates cannot assign or modify central_auth_id. Use verified SMAV linking or audited manual reconciliation.'
      USING ERRCODE = '42501';
  END IF;

  -- Canonical request fingerprint over target user, event metadata, and sanitized update fields
  v_fingerprint := pg_catalog.md5(jsonb_build_object(
    'op', 'update_user',
    'local_user_id', p_local_user_id::text,
    'event_type', p_event_type,
    'action', p_action,
    'updates', v_updates
  )::text);

  -- 1. Pre-mutation idempotency lock & duplicate/mismatch detection (BEFORE mutating public.users)
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_idem_key, 0));

  SELECT * INTO v_outbox
  FROM public.smav_user_sync_outbox
  WHERE idempotency_key = v_idem_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_outbox.local_user_id IS DISTINCT FROM p_local_user_id
       OR v_outbox.event_type <> p_event_type
       OR v_outbox.action <> p_action
       OR (v_outbox.request_fingerprint IS NOT NULL AND v_outbox.request_fingerprint <> v_fingerprint) THEN
      RAISE EXCEPTION
        'IDEMPOTENCY_KEY_CONFLICT: idempotency_key "%" was already used with a different request payload.',
        v_idem_key
        USING ERRCODE = '23505';
    END IF;

    SELECT * INTO v_user
    FROM public.users
    WHERE id = p_local_user_id;

    IF NOT FOUND THEN
      RETURN NULL;
    END IF;

    RETURN jsonb_build_object(
      'user', to_jsonb(v_user),
      'outbox', to_jsonb(v_outbox),
      'created', FALSE,
      'idempotent_replay', TRUE,
      'previous_name', v_user.name
    );
  END IF;

  -- 2. Lock authoritative user row
  SELECT * INTO v_existing
  FROM public.users
  WHERE id = p_local_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_next_active := CASE
    WHEN v_updates ? 'is_active' THEN (v_updates ->> 'is_active')::boolean
    ELSE COALESCE(v_existing.is_active, TRUE)
  END;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'user_id'
  ) INTO v_has_user_id_col;

  IF v_has_user_id_col THEN
    UPDATE public.users
    SET
      name = CASE WHEN v_updates ? 'name' THEN pg_catalog.btrim(v_updates ->> 'name') ELSE name END,
      email = CASE WHEN v_updates ? 'email' THEN pg_catalog.lower(pg_catalog.btrim(v_updates ->> 'email')) ELSE email END,
      phone = CASE WHEN v_updates ? 'phone' THEN pg_catalog.btrim(COALESCE(v_updates ->> 'phone', '')) ELSE phone END,
      role = CASE WHEN v_updates ? 'role' THEN pg_catalog.lower(pg_catalog.btrim(v_updates ->> 'role')) ELSE role END,
      user_id = CASE WHEN v_updates ? 'user_id' THEN pg_catalog.upper(pg_catalog.btrim(v_updates ->> 'user_id')) ELSE user_id END,
      username = CASE WHEN v_updates ? 'username' THEN NULLIF(pg_catalog.lower(pg_catalog.btrim(v_updates ->> 'username')), '') ELSE username END,
      is_active = v_next_active,
      central_auth_status = CASE WHEN v_next_active THEN 'ACTIVE' ELSE 'DISABLED' END,
      central_sync_status = 'PENDING',
      central_sync_error = NULL,
      updated_at = v_now
    WHERE id = p_local_user_id
    RETURNING * INTO v_user;
  ELSE
    UPDATE public.users
    SET
      name = CASE WHEN v_updates ? 'name' THEN pg_catalog.btrim(v_updates ->> 'name') ELSE name END,
      email = CASE WHEN v_updates ? 'email' THEN pg_catalog.lower(pg_catalog.btrim(v_updates ->> 'email')) ELSE email END,
      phone = CASE WHEN v_updates ? 'phone' THEN pg_catalog.btrim(COALESCE(v_updates ->> 'phone', '')) ELSE phone END,
      role = CASE WHEN v_updates ? 'role' THEN pg_catalog.lower(pg_catalog.btrim(v_updates ->> 'role')) ELSE role END,
      username = CASE WHEN v_updates ? 'username' THEN NULLIF(pg_catalog.lower(pg_catalog.btrim(v_updates ->> 'username')), '') ELSE username END,
      is_active = v_next_active,
      central_auth_status = CASE WHEN v_next_active THEN 'ACTIVE' ELSE 'DISABLED' END,
      central_sync_status = 'PENDING',
      central_sync_error = NULL,
      updated_at = v_now
    WHERE id = p_local_user_id
    RETURNING * INTO v_user;
  END IF;

  v_clean_email := pg_catalog.lower(pg_catalog.btrim(COALESCE(v_user.email, '')));
  v_clean_username := NULLIF(pg_catalog.lower(pg_catalog.btrim(COALESCE(v_user.username, ''))), '');
  v_smav_role := CASE WHEN pg_catalog.lower(pg_catalog.btrim(COALESCE(v_user.role, ''))) IN ('owner', 'manager') THEN 'ADMIN' ELSE 'POS_BILLING' END;

  IF p_action = 'set_status' THEN
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'userId', v_user.central_auth_id::text,
      'externalStaffId', v_user.id::text,
      'email', v_clean_email,
      'role', v_smav_role,
      'isActive', COALESCE(v_user.is_active, TRUE)
    ));
  ELSE
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'userId', v_user.central_auth_id::text,
      'externalStaffId', v_user.id::text,
      'email', v_clean_email,
      'fullName', v_user.name,
      'username', v_clean_username,
      'phone', COALESCE(v_user.phone, ''),
      'role', v_smav_role,
      'isActive', COALESCE(v_user.is_active, TRUE)
    ));
  END IF;

  INSERT INTO public.smav_user_sync_outbox (
    idempotency_key, request_fingerprint, local_user_id, audit_local_user_id, event_type, action, payload,
    status, attempts, max_attempts, next_retry_at, performed_by, created_at, updated_at
  )
  VALUES (
    v_idem_key, v_fingerprint, v_user.id, v_user.id, p_event_type, p_action, v_payload,
    'PENDING', 0, LEAST(GREATEST(COALESCE(p_max_attempts, 6), 1), 20), v_now,
    COALESCE(p_performed_by, 'Owner'), v_now, v_now
  )
  RETURNING * INTO v_outbox;

  UPDATE public.users
  SET central_sync_outbox_id = v_outbox.id, updated_at = v_now
  WHERE id = v_user.id
  RETURNING * INTO v_user;

  -- 3. Atomically mirror ONLY actually-changed identity/sync fields onto linked public.staff row (if one exists)
  --    NEVER overwrites staff.role (job title), salary, commission, skills, working_hours, or staff.central_auth_id.
  --    NEVER swallows errors: any failure rolls back the entire transaction cleanly.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'staff'
  ) INTO v_has_staff_table;

  IF v_has_staff_table AND EXISTS (SELECT 1 FROM public.staff WHERE user_id = p_local_user_id) THEN
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'staff' AND column_name = 'email'
    ) INTO v_has_staff_email;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'staff' AND column_name = 'admin_user_id'
    ) INTO v_has_staff_admin_uid;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'staff' AND column_name = 'branch_id'
    ) INTO v_has_staff_branch;

    v_staff_set_clauses := array_append(
      v_staff_set_clauses,
      format('central_auth_status = %L', CASE WHEN COALESCE(v_user.is_active, TRUE) THEN 'ACTIVE' ELSE 'DISABLED' END)
    );
    v_staff_set_clauses := array_append(v_staff_set_clauses, 'central_sync_status = ''PENDING''');
    v_staff_set_clauses := array_append(v_staff_set_clauses, 'central_sync_error = NULL');

    IF v_updates ? 'name' THEN
      v_staff_set_clauses := array_append(v_staff_set_clauses, format('name = %L', v_user.name));
    END IF;
    IF v_updates ? 'phone' THEN
      v_staff_set_clauses := array_append(v_staff_set_clauses, format('phone = %L', COALESCE(v_user.phone, '')));
    END IF;
    IF v_updates ? 'email' AND v_has_staff_email THEN
      v_staff_set_clauses := array_append(v_staff_set_clauses, format('email = %L', v_clean_email));
    END IF;
    IF v_updates ? 'user_id' AND v_has_user_id_col AND v_has_staff_admin_uid THEN
      v_staff_set_clauses := array_append(v_staff_set_clauses, format('admin_user_id = %L', pg_catalog.upper(pg_catalog.btrim(v_updates ->> 'user_id'))));
    END IF;
    IF v_updates ? 'username' THEN
      v_staff_set_clauses := array_append(v_staff_set_clauses, format('username = %L', v_user.username));
    END IF;
    IF v_updates ? 'is_active' THEN
      v_staff_set_clauses := array_append(v_staff_set_clauses, format('is_active = %L::boolean', COALESCE(v_user.is_active, TRUE)));
    END IF;
    IF v_updates ? 'branch_id' AND v_has_staff_branch THEN
      v_staff_set_clauses := array_append(v_staff_set_clauses, format('branch_id = %L', NULLIF(pg_catalog.btrim(v_updates ->> 'branch_id'), '')));
    END IF;

    EXECUTE format(
      'UPDATE public.staff SET %s WHERE user_id = $1',
      array_to_string(v_staff_set_clauses, ', ')
    ) USING p_local_user_id;
  END IF;

  RETURN jsonb_build_object(
    'user', to_jsonb(v_user),
    'outbox', to_jsonb(v_outbox),
    'created', TRUE,
    'idempotent_replay', FALSE,
    'previous_name', v_existing.name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.smav_update_user_and_enqueue_sync(
  UUID, JSONB, TEXT, TEXT, TEXT, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.smav_update_user_and_enqueue_sync(
  UUID, JSONB, TEXT, TEXT, TEXT, TEXT, INTEGER
) TO service_role;

-- 6C. Atomic Enqueue RPC for Retry Sync & Safe Reconciliation
--     - Locks idempotency_key BEFORE insert
--     - Rejects key reuse with different user/action/payload (23505)
--     - Returns JSONB { outbox, created, idempotent_replay } atomically (eliminates client pre-read race)
DO $$
DECLARE
  v_oid OID;
  v_rettype REGTYPE;
  v_dep_count INTEGER := 0;
BEGIN
  v_oid := to_regprocedure('public.smav_enqueue_user_sync_event(text,uuid,text,text,jsonb,text,integer)');
  IF v_oid IS NOT NULL THEN
    SELECT prorettype INTO v_rettype FROM pg_catalog.pg_proc WHERE oid = v_oid;
    IF v_rettype <> 'jsonb'::regtype THEN
      SELECT COUNT(*) INTO v_dep_count
      FROM pg_catalog.pg_depend
      WHERE refobjid = v_oid AND deptype IN ('n', 'a');
      IF v_dep_count = 0 THEN
        DROP FUNCTION public.smav_enqueue_user_sync_event(TEXT, UUID, TEXT, TEXT, JSONB, TEXT, INTEGER);
      ELSE
        RAISE EXCEPTION 'Cannot upgrade smav_enqueue_user_sync_event return type to JSONB because % dependent objects reference it.', v_dep_count;
      END IF;
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.smav_enqueue_user_sync_event(
  p_idempotency_key TEXT,
  p_local_user_id UUID,
  p_event_type TEXT,
  p_action TEXT,
  p_payload JSONB,
  p_performed_by TEXT DEFAULT 'System',
  p_max_attempts INTEGER DEFAULT 6
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_row public.smav_user_sync_outbox;
  v_now TIMESTAMPTZ := pg_catalog.now();
  v_idem_key TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_idempotency_key, '')), '');
  v_payload JSONB := COALESCE(p_payload, '{}'::jsonb);
  v_fingerprint TEXT;
BEGIN
  PERFORM public.smav_assert_service_role();

  IF v_idem_key IS NULL THEN
    RAISE EXCEPTION 'p_idempotency_key is required' USING ERRCODE = '22023';
  END IF;

  IF p_local_user_id IS NULL THEN
    RAISE EXCEPTION 'p_local_user_id is required' USING ERRCODE = '22023';
  END IF;

  IF p_action = 'reset_password' THEN
    RAISE EXCEPTION 'reset_password must execute synchronously and cannot be enqueued as PENDING'
      USING ERRCODE = '22023';
  END IF;

  v_fingerprint := pg_catalog.md5(jsonb_build_object(
    'op', 'enqueue',
    'local_user_id', p_local_user_id::text,
    'event_type', p_event_type,
    'action', p_action,
    'payload', v_payload
  )::text);

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_idem_key, 0));

  SELECT * INTO v_row
  FROM public.smav_user_sync_outbox
  WHERE idempotency_key = v_idem_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_row.local_user_id IS DISTINCT FROM p_local_user_id
       OR v_row.event_type <> p_event_type
       OR v_row.action <> p_action
       OR (v_row.request_fingerprint IS NOT NULL AND v_row.request_fingerprint <> v_fingerprint) THEN
      RAISE EXCEPTION
        'IDEMPOTENCY_KEY_CONFLICT: idempotency_key "%" was already used with a different request payload.',
        v_idem_key
        USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'outbox', to_jsonb(v_row),
      'created', FALSE,
      'idempotent_replay', TRUE
    );
  END IF;

  INSERT INTO public.smav_user_sync_outbox (
    idempotency_key,
    request_fingerprint,
    local_user_id,
    audit_local_user_id,
    event_type,
    action,
    payload,
    status,
    attempts,
    max_attempts,
    next_retry_at,
    performed_by,
    created_at,
    updated_at
  )
  VALUES (
    v_idem_key,
    v_fingerprint,
    p_local_user_id,
    p_local_user_id,
    p_event_type,
    p_action,
    v_payload,
    'PENDING',
    0,
    LEAST(GREATEST(COALESCE(p_max_attempts, 6), 1), 20),
    v_now,
    p_performed_by,
    v_now,
    v_now
  )
  RETURNING * INTO v_row;

  UPDATE public.users
  SET
    central_sync_status = 'PENDING',
    central_sync_error = NULL,
    central_sync_outbox_id = v_row.id,
    updated_at = v_now
  WHERE id = p_local_user_id;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'staff'
  ) THEN
    UPDATE public.staff
    SET
      central_sync_status = 'PENDING',
      central_sync_error = NULL
    WHERE user_id = p_local_user_id;
  END IF;

  RETURN jsonb_build_object(
    'outbox', to_jsonb(v_row),
    'created', TRUE,
    'idempotent_replay', FALSE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.smav_enqueue_user_sync_event(TEXT, UUID, TEXT, TEXT, JSONB, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.smav_enqueue_user_sync_event(TEXT, UUID, TEXT, TEXT, JSONB, TEXT, INTEGER)
  TO service_role;

-- 6D. Atomic Single-Event Claim RPC (Unified Claim-Time Attempt Increment)
CREATE OR REPLACE FUNCTION public.smav_claim_single_user_sync_event(
  p_outbox_id UUID
)
RETURNS SETOF public.smav_user_sync_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.now();
BEGIN
  PERFORM public.smav_assert_service_role();

  RETURN QUERY
  UPDATE public.smav_user_sync_outbox o
  SET
    status = 'PROCESSING',
    attempts = o.attempts + 1,
    locked_at = v_now,
    updated_at = v_now
  WHERE o.id = p_outbox_id
    AND o.local_user_id IS NOT NULL
    AND o.status = 'PENDING'
    AND o.conflict = FALSE
    AND o.action <> 'reset_password'
    AND o.attempts < o.max_attempts
    AND o.next_retry_at <= v_now
  RETURNING o.*;
END;
$$;

REVOKE ALL ON FUNCTION public.smav_claim_single_user_sync_event(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.smav_claim_single_user_sync_event(UUID)
  TO service_role;

-- 6E. Concurrency-Safe Bounded Batch Claim RPC (Unified Claim-Time Attempt Counting)
CREATE OR REPLACE FUNCTION public.smav_claim_due_user_sync_events(
  p_limit INTEGER DEFAULT 20,
  p_stale_lock_minutes INTEGER DEFAULT 5
)
RETURNS SETOF public.smav_user_sync_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.now();
  v_stale_mins INTEGER := LEAST(GREATEST(COALESCE(p_stale_lock_minutes, 5), 1), 60);
  v_stale_cutoff TIMESTAMPTZ := v_now - pg_catalog.make_interval(mins => v_stale_mins);
  v_failed_user_ids UUID[];
BEGIN
  PERFORM public.smav_assert_service_role();

  -- 1. Mark any orphaned rows whose local_user_id was deleted (ON DELETE SET NULL) as FAILED
  --    while preserving the historical outbox row and audit_local_user_id.
  UPDATE public.smav_user_sync_outbox o
  SET
    status = 'FAILED',
    locked_at = NULL,
    last_error = 'Local admin user was deleted; historical sync record preserved.',
    updated_at = v_now
  WHERE o.local_user_id IS NULL
    AND o.status IN ('PENDING', 'PROCESSING');

  -- 2. Permanently fail any stale PROCESSING locks that have already reached max_attempts
  WITH exhausted_stale AS (
    UPDATE public.smav_user_sync_outbox o
    SET
      status = 'FAILED',
      locked_at = NULL,
      last_error = 'Worker lock timed out after maximum retry attempts.',
      updated_at = v_now
    WHERE o.local_user_id IS NOT NULL
      AND o.status = 'PROCESSING'
      AND o.locked_at IS NOT NULL
      AND o.locked_at < v_stale_cutoff
      AND o.attempts >= o.max_attempts
    RETURNING o.id, o.local_user_id
  ),
  upd_users AS (
    UPDATE public.users u
    SET
      central_sync_status = 'FAILED',
      central_sync_error = 'Worker lock timed out after maximum retry attempts.',
      central_sync_last_attempt_at = v_now,
      updated_at = v_now
    FROM exhausted_stale es
    WHERE u.id = es.local_user_id
      AND u.central_sync_outbox_id = es.id
    RETURNING u.id
  )
  SELECT array_agg(id) INTO v_failed_user_ids FROM upd_users;

  IF v_failed_user_ids IS NOT NULL AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'staff'
  ) THEN
    UPDATE public.staff
    SET
      central_sync_status = 'FAILED',
      central_sync_error = 'Worker lock timed out after maximum retry attempts.',
      central_sync_last_attempt_at = v_now
    WHERE user_id = ANY(v_failed_user_ids);
  END IF;

  -- 3. Claim bounded due PENDING rows & recoverable stale PROCESSING locks
  --    (Both increment attempts by +1 for the newly claimed execution attempt)
  RETURN QUERY
  WITH due AS (
    SELECT o.id
    FROM public.smav_user_sync_outbox o
    WHERE o.local_user_id IS NOT NULL
      AND o.conflict = FALSE
      AND o.action <> 'reset_password'
      AND o.attempts < o.max_attempts
      AND (
        (o.status = 'PENDING' AND o.next_retry_at <= v_now)
        OR (
          o.status = 'PROCESSING'
          AND o.locked_at IS NOT NULL
          AND o.locked_at < v_stale_cutoff
        )
      )
    ORDER BY o.next_retry_at ASC, o.created_at ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.smav_user_sync_outbox o
  SET
    status = 'PROCESSING',
    attempts = o.attempts + 1,
    locked_at = v_now,
    updated_at = v_now
  FROM due
  WHERE o.id = due.id
  RETURNING o.*;
END;
$$;

-- Safely remove legacy 1-arg overload ONLY if it exists AND has zero dependent DB objects
DO $$
DECLARE
  v_legacy_oid OID;
  v_dep_count INTEGER := 0;
BEGIN
  v_legacy_oid := to_regprocedure('public.smav_claim_due_user_sync_events(integer)');
  IF v_legacy_oid IS NOT NULL THEN
    SELECT COUNT(*) INTO v_dep_count
    FROM pg_catalog.pg_depend
    WHERE refobjid = v_legacy_oid
      AND deptype IN ('n', 'a');
    IF v_dep_count = 0 THEN
      DROP FUNCTION public.smav_claim_due_user_sync_events(INTEGER);
    ELSE
      RAISE NOTICE 'Preserved legacy public.smav_claim_due_user_sync_events(integer) because % dependent database objects reference it.', v_dep_count;
    END IF;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.smav_claim_due_user_sync_events(INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.smav_claim_due_user_sync_events(INTEGER, INTEGER)
  TO service_role;

-- ============================================================================
-- 7. Safe Authoritative Status View (Non-Destructive: Preserves Existing View)
--    NOTE: Existing public.vw_smav_staff_auth_status is intentionally NOT
--    modified or replaced. public.vw_smav_user_sync_status is anchored on
--    public.users (RBAC source of truth) and inspects user_id existence safely.
-- ============================================================================

DO $$
DECLARE
  v_has_user_id_col BOOLEAN;
  v_staff_code_expr TEXT;
  v_username_expr TEXT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'user_id'
  ) INTO v_has_user_id_col;

  v_staff_code_expr := CASE WHEN v_has_user_id_col THEN 'u.user_id::text' ELSE 'NULL::text' END;
  v_username_expr := CASE
    WHEN v_has_user_id_col THEN 'COALESCE(u.username, pg_catalog.lower(u.user_id))'
    ELSE 'u.username'
  END;

  EXECUTE format($view$
    CREATE OR REPLACE VIEW public.vw_smav_user_sync_status
    WITH (security_invoker = true) AS
    SELECT
      u.id AS local_user_id,
      %s AS staff_code,
      u.name,
      %s AS username,
      u.email,
      u.phone,
      u.role AS rbac_role,
      CASE
        WHEN pg_catalog.lower(u.role) IN ('owner', 'manager') THEN 'ADMIN'
        ELSE 'POS_BILLING'
      END AS mapped_smav_role,
      s.id AS staff_profile_id,
      s.role AS staff_job_title,
      COALESCE(u.is_active, TRUE) AS is_active,
      u.central_auth_id,
      s.central_auth_id AS staff_central_auth_id,
      (u.central_auth_id IS DISTINCT FROM s.central_auth_id AND s.id IS NOT NULL) AS has_staff_uuid_mismatch,
      u.central_auth_status,
      u.central_auth_linked_at,
      u.central_outlet_code,
      u.central_sync_version,
      u.central_last_synced_at,
      u.central_sync_origin,
      u.central_sync_status,
      u.central_sync_error,
      u.central_sync_last_attempt_at,
      u.central_sync_outbox_id,
      CASE
        WHEN u.central_sync_status = 'FAILED' THEN 'SYNC_FAILED'
        WHEN u.central_auth_id IS NOT NULL
             AND u.central_sync_status = 'SYNCED'
             AND COALESCE(u.is_active, TRUE) = TRUE THEN 'SYNCED_READY'
        WHEN u.central_auth_id IS NOT NULL
             AND u.central_sync_status = 'SYNCED'
             AND COALESCE(u.is_active, TRUE) = FALSE THEN 'DISABLED_SYNCED'
        ELSE 'NEEDS_VERIFICATION_OR_SYNC'
      END AS smav_access_status
    FROM public.users u
    LEFT JOIN public.staff s ON s.user_id = u.id
  $view$, v_staff_code_expr, v_username_expr);
END $$;

REVOKE ALL ON public.vw_smav_user_sync_status FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_smav_user_sync_status TO service_role;

COMMENT ON VIEW public.vw_smav_user_sync_status IS
  'Authoritative SMAV sync status anchored on public.users (RBAC source of truth). Does not auto-mark legacy rows SYNCED and leaves legacy vw_smav_staff_auth_status intact.';

COMMIT;
