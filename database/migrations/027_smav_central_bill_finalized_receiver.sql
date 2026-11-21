-- ============================================================================
-- Migration 027: Safe Dynamic SMAV Branch Standardization (public.salon_branches)
--                & SMAV Finalized Bill Receiver / Payment Ledger Idempotency
-- ============================================================================
-- SAFETY & ARCHITECTURE GUARANTEES:
-- 1. Strictly uses public.salon_branches ONLY (NEVER public.branches).
-- 2. Strictly additive, non-destructive, and idempotent.
-- 3. NEVER touches tenant/business identity or generic text columns:
--      - salon_id (EXCLUDED)
--      - business_id (EXCLUDED)
--      - outlet_id (EXCLUDED)
--      - tenant_id (EXCLUDED)
--      - default_branch_id (EXCLUDED)
--      - generic branch text columns such as print_devices.branch (EXCLUDED)
-- 4. Migrates ONLY an EXPLICIT, schema-verified allow-list of 14 table.branch_id
--    columns confirmed to reference public.salon_branches(id):
--      1.  public.users.branch_id
--      2.  public.staff.branch_id
--      3.  public.customers.branch_id
--      4.  public.appointments.branch_id
--      5.  public.orders.branch_id
--      6.  public.payments.branch_id
--      7.  public.branch_whatsapp_integrations.branch_id
--      8.  public.whatsapp_message_logs.branch_id
--      9.  public.appointment_feedback.branch_id
--      10. public.scheduled_feedback_jobs.branch_id
--      11. public.daily_sales_reports.branch_id
--      12. public.whatsapp_conversations.branch_id
--      13. public.whatsapp_messages.branch_id
--      14. public.smav_inbound_sales.branch_id
-- 5. Marks superseded GlossyLooks legacy/duplicate branch rows inactive
--    (is_active = false). NEVER deletes rows from public.salon_branches.
-- 6. Scopes branch code uniqueness per outlet (outlet_id / outlet_code), NEVER
--    globally, so different salons may independently use identical branch codes
--    (e.g., MADH).
-- 7. Never alters finalized orders.bill_number or payments.bill_number.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Ensure public.salon_branches has multi-outlet & SMAV branch code columns
--    and replace global code uniqueness with outlet-scoped active uniqueness
-- ----------------------------------------------------------------------------
ALTER TABLE public.salon_branches
  ADD COLUMN IF NOT EXISTS outlet_id text,
  ADD COLUMN IF NOT EXISTS outlet_code text,
  ADD COLUMN IF NOT EXISTS smav_branch_code text,
  ADD COLUMN IF NOT EXISTS manager_name text;

-- Drop legacy global unique constraint/index so multiple salons can share codes
-- (e.g. MADH) and inactive legacy rows do not collide with canonical rows
ALTER TABLE public.salon_branches
  DROP CONSTRAINT IF EXISTS salon_branches_code_key;

DROP INDEX IF EXISTS public.uq_salon_branches_active_smav_code;

-- ----------------------------------------------------------------------------
-- 2. Standardize GlossyLooks canonical branches & migrate ONLY the explicit
--    verified branch_id allow-list (non-destructive; never deletes branch rows)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_gachi_src public.salon_branches%ROWTYPE;
  v_konda_src public.salon_branches%ROWTYPE;
  v_has_gachi_src boolean := false;
  v_has_konda_src boolean := false;
  v_map RECORD;
  v_tbl text;
  v_updated_count bigint;
  v_existing_wa_count bigint;
  v_canon_wa public.branch_whatsapp_integrations%ROWTYPE;
  v_old_wa public.branch_whatsapp_integrations%ROWTYPE;
  v_wa_has_is_active boolean := false;
  v_unknown RECORD;

  -- EXPLICIT ALLOW-LIST of schema-verified branch_id columns referencing
  -- public.salon_branches(id) (excluding branch_whatsapp_integrations, which
  -- has dedicated conflict-safe non-destructive handling below).
  v_allowed_branch_id_tables constant text[] := ARRAY[
    'users',
    'staff',
    'customers',
    'appointments',
    'orders',
    'payments',
    'whatsapp_message_logs',
    'appointment_feedback',
    'scheduled_feedback_jobs',
    'daily_sales_reports',
    'whatsapp_conversations',
    'whatsapp_messages',
    'smav_inbound_sales'
  ];
BEGIN
  -- 2a. Capture operational metadata from existing GlossyLooks rows only
  --     (never touch rows explicitly owned by another outlet)
  SELECT * INTO v_gachi_src
  FROM public.salon_branches
  WHERE (
      outlet_id IS NULL
      AND (outlet_code IS NULL OR LOWER(BTRIM(outlet_code)) = 'glossylooks')
    )
    AND (
      id = 'tgl-gachi'
      OR id = 'tgl-gachibowli-main'
      OR UPPER(COALESCE(smav_branch_code, '')) = 'GACHI'
      OR UPPER(COALESCE(code, '')) IN ('GACHI', 'GCB-01', 'GCB', 'TGL-01')
      OR LOWER(COALESCE(name, '')) LIKE '%gachibowli%'
    )
  ORDER BY
    CASE
      WHEN id = 'tgl-gachi' THEN 0
      WHEN id = 'tgl-gachibowli-main' THEN 1
      ELSE 2
    END,
    created_at ASC NULLS LAST
  LIMIT 1;
  v_has_gachi_src := FOUND;

  SELECT * INTO v_konda_src
  FROM public.salon_branches
  WHERE (
      outlet_id IS NULL
      AND (outlet_code IS NULL OR LOWER(BTRIM(outlet_code)) = 'glossylooks')
    )
    AND (
      id = 'tgl-konda'
      OR id = 'brn-1793346038689'
      OR UPPER(COALESCE(smav_branch_code, '')) = 'KONDA'
      OR UPPER(COALESCE(code, '')) IN ('KONDA', 'KND-02', 'KND', 'TGL-02')
      OR LOWER(COALESCE(name, '')) LIKE '%kondapur%'
    )
  ORDER BY
    CASE
      WHEN id = 'tgl-konda' THEN 0
      WHEN id = 'brn-1793346038689' THEN 1
      ELSE 2
    END,
    created_at ASC NULLS LAST
  LIMIT 1;
  v_has_konda_src := FOUND;

  -- 2b. Upsert canonical GlossyLooks parent rows FIRST (preserves FK integrity
  --     while migrating child branch_id references). Uses COALESCE(..., '') for
  --     columns that may carry NOT NULL constraints from older base schemas.
  INSERT INTO public.salon_branches (
    id, outlet_code, name, code, smav_branch_code,
    address, city, phone, whatsapp_number,
    manager_id, manager_name, is_active, created_at, updated_at
  )
  VALUES (
    'tgl-gachi',
    'glossylooks',
    'Gachibowli',
    'GACHI',
    'GACHI',
    COALESCE(CASE WHEN v_has_gachi_src THEN v_gachi_src.address ELSE NULL END, ''),
    COALESCE(CASE WHEN v_has_gachi_src THEN v_gachi_src.city ELSE NULL END, ''),
    COALESCE(CASE WHEN v_has_gachi_src THEN v_gachi_src.phone ELSE NULL END, ''),
    COALESCE(CASE WHEN v_has_gachi_src THEN v_gachi_src.whatsapp_number ELSE NULL END, ''),
    CASE WHEN v_has_gachi_src THEN v_gachi_src.manager_id ELSE NULL END,
    CASE WHEN v_has_gachi_src THEN v_gachi_src.manager_name ELSE NULL END,
    true,
    COALESCE(CASE WHEN v_has_gachi_src THEN v_gachi_src.created_at ELSE NULL END, NOW()),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE
  SET
    outlet_code = COALESCE(NULLIF(BTRIM(public.salon_branches.outlet_code), ''), 'glossylooks'),
    name = 'Gachibowli',
    code = 'GACHI',
    smav_branch_code = 'GACHI',
    address = COALESCE(NULLIF(public.salon_branches.address, ''), EXCLUDED.address),
    city = COALESCE(NULLIF(public.salon_branches.city, ''), EXCLUDED.city),
    phone = COALESCE(NULLIF(public.salon_branches.phone, ''), EXCLUDED.phone),
    whatsapp_number = COALESCE(NULLIF(public.salon_branches.whatsapp_number, ''), EXCLUDED.whatsapp_number),
    manager_id = COALESCE(public.salon_branches.manager_id, EXCLUDED.manager_id),
    manager_name = COALESCE(public.salon_branches.manager_name, EXCLUDED.manager_name),
    is_active = true,
    updated_at = NOW();

  INSERT INTO public.salon_branches (
    id, outlet_code, name, code, smav_branch_code,
    address, city, phone, whatsapp_number,
    manager_id, manager_name, is_active, created_at, updated_at
  )
  VALUES (
    'tgl-konda',
    'glossylooks',
    'Kondapur',
    'KONDA',
    'KONDA',
    COALESCE(CASE WHEN v_has_konda_src THEN v_konda_src.address ELSE NULL END, ''),
    COALESCE(CASE WHEN v_has_konda_src THEN v_konda_src.city ELSE NULL END, ''),
    COALESCE(CASE WHEN v_has_konda_src THEN v_konda_src.phone ELSE NULL END, ''),
    COALESCE(CASE WHEN v_has_konda_src THEN v_konda_src.whatsapp_number ELSE NULL END, ''),
    CASE WHEN v_has_konda_src THEN v_konda_src.manager_id ELSE NULL END,
    CASE WHEN v_has_konda_src THEN v_konda_src.manager_name ELSE NULL END,
    true,
    COALESCE(CASE WHEN v_has_konda_src THEN v_konda_src.created_at ELSE NULL END, NOW()),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE
  SET
    outlet_code = COALESCE(NULLIF(BTRIM(public.salon_branches.outlet_code), ''), 'glossylooks'),
    name = 'Kondapur',
    code = 'KONDA',
    smav_branch_code = 'KONDA',
    address = COALESCE(NULLIF(public.salon_branches.address, ''), EXCLUDED.address),
    city = COALESCE(NULLIF(public.salon_branches.city, ''), EXCLUDED.city),
    phone = COALESCE(NULLIF(public.salon_branches.phone, ''), EXCLUDED.phone),
    whatsapp_number = COALESCE(NULLIF(public.salon_branches.whatsapp_number, ''), EXCLUDED.whatsapp_number),
    manager_id = COALESCE(public.salon_branches.manager_id, EXCLUDED.manager_id),
    manager_name = COALESCE(public.salon_branches.manager_name, EXCLUDED.manager_name),
    is_active = true,
    updated_at = NOW();

  -- 2c. Build deterministic GlossyLooks legacy/duplicate migration map
  CREATE TEMP TABLE _tgl_branch_migration_map (
    old_id text PRIMARY KEY,
    new_id text NOT NULL,
    new_name text NOT NULL,
    new_code text NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _tgl_branch_migration_map (old_id, new_id, new_name, new_code)
  VALUES
    ('tgl-gachibowli-main', 'tgl-gachi', 'Gachibowli', 'GACHI'),
    ('brn-1793346038689', 'tgl-konda', 'Kondapur', 'KONDA')
  ON CONFLICT (old_id) DO NOTHING;

  -- Detect any additional verified duplicate GlossyLooks Gachibowli rows
  INSERT INTO _tgl_branch_migration_map (old_id, new_id, new_name, new_code)
  SELECT b.id, 'tgl-gachi', 'Gachibowli', 'GACHI'
  FROM public.salon_branches b
  WHERE b.id NOT IN ('tgl-gachi', 'tgl-konda')
    AND b.outlet_id IS NULL
    AND (b.outlet_code IS NULL OR LOWER(BTRIM(b.outlet_code)) = 'glossylooks')
    AND (
      UPPER(COALESCE(b.smav_branch_code, '')) = 'GACHI'
      OR UPPER(COALESCE(b.code, '')) IN ('GACHI', 'GCB-01', 'GCB', 'TGL-01')
      OR LOWER(COALESCE(b.name, '')) LIKE '%gachibowli%'
    )
    AND NOT (
      UPPER(COALESCE(b.smav_branch_code, '')) = 'KONDA'
      OR UPPER(COALESCE(b.code, '')) IN ('KONDA', 'KND-02', 'KND', 'TGL-02')
      OR LOWER(COALESCE(b.name, '')) LIKE '%kondapur%'
    )
  ON CONFLICT (old_id) DO NOTHING;

  -- Detect any additional verified duplicate GlossyLooks Kondapur rows
  INSERT INTO _tgl_branch_migration_map (old_id, new_id, new_name, new_code)
  SELECT b.id, 'tgl-konda', 'Kondapur', 'KONDA'
  FROM public.salon_branches b
  WHERE b.id NOT IN ('tgl-gachi', 'tgl-konda')
    AND b.outlet_id IS NULL
    AND (b.outlet_code IS NULL OR LOWER(BTRIM(b.outlet_code)) = 'glossylooks')
    AND (
      UPPER(COALESCE(b.smav_branch_code, '')) = 'KONDA'
      OR UPPER(COALESCE(b.code, '')) IN ('KONDA', 'KND-02', 'KND', 'TGL-02')
      OR LOWER(COALESCE(b.name, '')) LIKE '%kondapur%'
    )
    AND NOT (
      UPPER(COALESCE(b.smav_branch_code, '')) = 'GACHI'
      OR UPPER(COALESCE(b.code, '')) IN ('GACHI', 'GCB-01', 'GCB', 'TGL-01')
      OR LOWER(COALESCE(b.name, '')) LIKE '%gachibowli%'
    )
  ON CONFLICT (old_id) DO NOTHING;

  -- 2d. Migrate allow-listed public.branch_whatsapp_integrations.branch_id
  --     non-destructively:
  --     - If canonical branch has no row yet: reassign legacy integration to canonical branch.
  --     - If BOTH legacy and canonical branches have rows: merge missing config values
  --       into the canonical row, preserve the canonical row, and mark the old legacy
  --       integration row disconnected / legacy-inactive (never leaves a live integration
  --       attached only to an inactive legacy branch; never deletes rows).
  IF to_regclass('public.branch_whatsapp_integrations') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'branch_whatsapp_integrations'
         AND column_name = 'branch_id'
     ) THEN
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'branch_whatsapp_integrations'
        AND column_name = 'is_active'
    ) INTO v_wa_has_is_active;

    FOR v_map IN SELECT * FROM _tgl_branch_migration_map ORDER BY old_id LOOP
      SELECT COUNT(*) INTO v_existing_wa_count
      FROM public.branch_whatsapp_integrations
      WHERE branch_id = v_map.new_id;

      IF v_existing_wa_count = 0 THEN
        UPDATE public.branch_whatsapp_integrations
        SET branch_id = v_map.new_id, updated_at = NOW()
        WHERE branch_id = v_map.old_id;
        GET DIAGNOSTICS v_updated_count = ROW_COUNT;

        IF v_updated_count > 0 THEN
          RAISE NOTICE 'Migration 027: public.branch_whatsapp_integrations.branch_id | % -> % | % row(s) reassigned to canonical branch',
            v_map.old_id, v_map.new_id, v_updated_count;
        END IF;
      ELSE
        -- Canonical row already exists: pick primary canonical row & best legacy row
        SELECT * INTO v_canon_wa
        FROM public.branch_whatsapp_integrations
        WHERE branch_id = v_map.new_id
        ORDER BY
          CASE WHEN status = 'connected' THEN 0 ELSE 1 END,
          CASE WHEN NULLIF(BTRIM(COALESCE(phone_number_id, '')), '') IS NOT NULL THEN 0 ELSE 1 END,
          updated_at DESC NULLS LAST,
          created_at ASC NULLS LAST
        LIMIT 1;

        SELECT * INTO v_old_wa
        FROM public.branch_whatsapp_integrations
        WHERE branch_id = v_map.old_id
        ORDER BY
          CASE WHEN status = 'connected' THEN 0 ELSE 1 END,
          CASE WHEN NULLIF(BTRIM(COALESCE(phone_number_id, '')), '') IS NOT NULL THEN 0 ELSE 1 END,
          updated_at DESC NULLS LAST,
          created_at ASC NULLS LAST
        LIMIT 1;

        IF FOUND THEN
          -- Merge ONLY missing configuration values into the preserved canonical row
          UPDATE public.branch_whatsapp_integrations
          SET
            configured_business_number = COALESCE(NULLIF(BTRIM(configured_business_number), ''), v_old_wa.configured_business_number),
            waba_id                    = COALESCE(NULLIF(BTRIM(waba_id), ''), NULLIF(BTRIM(v_old_wa.waba_id), '')),
            phone_number_id            = COALESCE(NULLIF(BTRIM(phone_number_id), ''), NULLIF(BTRIM(v_old_wa.phone_number_id), '')),
            display_name               = COALESCE(NULLIF(BTRIM(display_name), ''), NULLIF(BTRIM(v_old_wa.display_name), '')),
            display_phone_number       = COALESCE(NULLIF(BTRIM(display_phone_number), ''), NULLIF(BTRIM(v_old_wa.display_phone_number), '')),
            masked_phone_number        = COALESCE(NULLIF(BTRIM(masked_phone_number), ''), NULLIF(BTRIM(v_old_wa.masked_phone_number), '')),
            connected_at               = COALESCE(connected_at, v_old_wa.connected_at),
            last_verified_at           = COALESCE(last_verified_at, v_old_wa.last_verified_at),
            diagnostics                = COALESCE(NULLIF(BTRIM(diagnostics), ''), v_old_wa.diagnostics),
            status = CASE
              WHEN COALESCE(NULLIF(BTRIM(status), ''), 'disconnected') = 'disconnected'
                   AND v_old_wa.status = 'connected'
                   AND COALESCE(NULLIF(BTRIM(phone_number_id), ''), NULLIF(BTRIM(v_old_wa.phone_number_id), '')) IS NOT NULL
              THEN 'connected'
              ELSE status
            END,
            updated_at = NOW()
          WHERE id = v_canon_wa.id;

          -- Mark old legacy branch integration row(s) disconnected/inactive (never delete)
          UPDATE public.branch_whatsapp_integrations
          SET
            status = 'disconnected',
            diagnostics = CASE
              WHEN COALESCE(diagnostics, '') LIKE '[LEGACY_INACTIVE_MERGED_TO:%' THEN diagnostics
              ELSE '[LEGACY_INACTIVE_MERGED_TO:' || v_map.new_id || '] ' || COALESCE(diagnostics, '')
            END,
            updated_at = NOW()
          WHERE branch_id = v_map.old_id;
          GET DIAGNOSTICS v_updated_count = ROW_COUNT;

          IF v_wa_has_is_active THEN
            EXECUTE 'UPDATE public.branch_whatsapp_integrations SET is_active = true, updated_at = NOW() WHERE id = $1'
              USING v_canon_wa.id;
            EXECUTE 'UPDATE public.branch_whatsapp_integrations SET is_active = false, updated_at = NOW() WHERE branch_id = $1'
              USING v_map.old_id;
          END IF;

          RAISE NOTICE 'Migration 027: public.branch_whatsapp_integrations | merged missing config from legacy branch "%" (row "%") into canonical branch "%" (row "%") and marked % legacy integration row(s) disconnected/inactive.',
            v_map.old_id, v_old_wa.id, v_map.new_id, v_canon_wa.id, v_updated_count;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- 2e. Migrate ONLY the explicitly allow-listed verified branch_id columns
  --     (NEVER updates salon_id, business_id, outlet_id, tenant_id,
  --      default_branch_id, or generic branch text columns)
  FOREACH v_tbl IN ARRAY v_allowed_branch_id_tables LOOP
    IF to_regclass(format('public.%I', v_tbl)) IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = v_tbl
           AND column_name = 'branch_id'
       ) THEN
      FOR v_map IN SELECT * FROM _tgl_branch_migration_map ORDER BY old_id LOOP
        EXECUTE format(
          'UPDATE public.%I SET branch_id = $1 WHERE branch_id = $2',
          v_tbl
        ) USING v_map.new_id, v_map.old_id;
        GET DIAGNOSTICS v_updated_count = ROW_COUNT;

        IF v_updated_count > 0 THEN
          RAISE NOTICE 'Migration 027: public.%.branch_id | % -> % | % row(s) updated',
            v_tbl, v_map.old_id, v_map.new_id, v_updated_count;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- 2f. Refresh denormalized customers.branch_name from public.salon_branches
  --     only for migrated GlossyLooks canonical branch rows
  IF to_regclass('public.customers') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'branch_name'
     ) THEN
    UPDATE public.customers c
    SET branch_name = sb.name
    FROM public.salon_branches sb
    WHERE c.branch_id = sb.id
      AND sb.id IN ('tgl-gachi', 'tgl-konda')
      AND (c.branch_name IS NULL OR c.branch_name <> sb.name);
  END IF;

  -- 2g. Mark legacy/duplicate GlossyLooks rows in public.salon_branches INACTIVE
  --     (DO NOT DELETE legacy rows in this migration)
  FOR v_map IN SELECT * FROM _tgl_branch_migration_map ORDER BY old_id LOOP
    UPDATE public.salon_branches
    SET
      outlet_code = COALESCE(NULLIF(BTRIM(outlet_code), ''), 'glossylooks'),
      is_active = false,
      updated_at = NOW()
    WHERE id = v_map.old_id;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    IF v_updated_count > 0 THEN
      RAISE NOTICE 'Migration 027: Marked legacy/duplicate salon_branches row "%" inactive (mapped to "%"; row preserved, not deleted).',
        v_map.old_id, v_map.new_id;
    END IF;
  END LOOP;

  -- 2h. Detect any unknown/unmappable active GlossyLooks duplicate rows and
  --     mark them inactive with a notice (never touch other outlets, never delete)
  FOR v_unknown IN
    SELECT b.id, b.name, b.code, b.smav_branch_code
    FROM public.salon_branches b
    WHERE b.id NOT IN ('tgl-gachi', 'tgl-konda')
      AND b.is_active = true
      AND b.outlet_id IS NULL
      AND (b.outlet_code IS NULL OR LOWER(BTRIM(b.outlet_code)) = 'glossylooks')
      AND (
        LOWER(BTRIM(COALESCE(b.name, ''))) IN ('gachibowli', 'kondapur')
        OR UPPER(BTRIM(COALESCE(b.smav_branch_code, ''))) IN ('GACHI', 'KONDA')
        OR UPPER(BTRIM(COALESCE(b.code, ''))) IN ('GACHI', 'KONDA')
        OR EXISTS (
          SELECT 1
          FROM public.salon_branches b2
          WHERE b2.id <> b.id
            AND b2.is_active = true
            AND COALESCE(NULLIF(BTRIM(b2.outlet_id), ''), NULLIF(BTRIM(b2.outlet_code), ''), 'glossylooks')
                = COALESCE(NULLIF(BTRIM(b.outlet_id), ''), NULLIF(BTRIM(b.outlet_code), ''), 'glossylooks')
            AND (
              (NULLIF(UPPER(BTRIM(COALESCE(b.smav_branch_code, ''))), '') IS NOT NULL
               AND UPPER(BTRIM(COALESCE(b.smav_branch_code, ''))) = UPPER(BTRIM(COALESCE(b2.smav_branch_code, ''))))
              OR (NULLIF(UPPER(BTRIM(COALESCE(b.code, ''))), '') IS NOT NULL
                  AND UPPER(BTRIM(COALESCE(b.code, ''))) = UPPER(BTRIM(COALESCE(b2.code, ''))))
            )
        )
      )
  LOOP
    UPDATE public.salon_branches
    SET is_active = false, updated_at = NOW()
    WHERE id = v_unknown.id;
    RAISE NOTICE 'Migration 027: Marked unknown/unmappable duplicate salon_branches row inactive -> id="%", name="%", code="%", smav_branch_code="%".',
      v_unknown.id, v_unknown.name, v_unknown.code, v_unknown.smav_branch_code;
  END LOOP;
END $$;

-- Outlet-scoped partial unique indexes on active branch codes:
-- Different salons/outlets may each have the same branch code (e.g. MADH),
-- while duplicate active codes within the SAME outlet are prevented.
CREATE UNIQUE INDEX IF NOT EXISTS uq_salon_branches_outlet_active_smav_code
  ON public.salon_branches (
    COALESCE(NULLIF(BTRIM(outlet_id), ''), NULLIF(BTRIM(outlet_code), ''), 'glossylooks'),
    UPPER(BTRIM(smav_branch_code))
  )
  WHERE is_active = true
    AND smav_branch_code IS NOT NULL
    AND BTRIM(smav_branch_code) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_salon_branches_outlet_active_code
  ON public.salon_branches (
    COALESCE(NULLIF(BTRIM(outlet_id), ''), NULLIF(BTRIM(outlet_code), ''), 'glossylooks'),
    UPPER(BTRIM(code))
  )
  WHERE is_active = true
    AND code IS NOT NULL
    AND BTRIM(code) <> '';

-- ----------------------------------------------------------------------------
-- 3. Drop legacy 'tgl-gachibowli-main' default ONLY on allow-listed branch_id
--    columns (NEVER touches salon_id, business_id, outlet_id, tenant_id, branch)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_tbl text;
  v_allowed_default_tables constant text[] := ARRAY[
    'users',
    'staff',
    'customers',
    'appointments',
    'orders',
    'payments',
    'branch_whatsapp_integrations',
    'whatsapp_message_logs',
    'appointment_feedback',
    'scheduled_feedback_jobs',
    'daily_sales_reports',
    'whatsapp_conversations',
    'whatsapp_messages',
    'smav_inbound_sales'
  ];
BEGIN
  FOREACH v_tbl IN ARRAY v_allowed_default_tables LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_tbl
        AND column_name = 'branch_id'
        AND column_default LIKE '%tgl-gachibowli-main%'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN branch_id DROP DEFAULT', v_tbl);
      RAISE NOTICE 'Migration 027: Dropped legacy tgl-gachibowli-main default on public.%.branch_id', v_tbl;
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 4. Update Migration 025 RLS branch helper & policies (remove legacy fallback)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tgl_current_user_branch_id()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid UUID;
  v_branch TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NOT NULL THEN
    SELECT NULLIF(BTRIM(u.branch_id), '') INTO v_branch
    FROM public.users u
    WHERE u.is_active = TRUE
      AND (u.id = v_uid OR u.central_auth_id = v_uid)
    LIMIT 1;
    IF v_branch IS NOT NULL THEN
      RETURN v_branch;
    END IF;
  END IF;

  RETURN NULLIF(BTRIM(auth.jwt() -> 'app_metadata' ->> 'branch_id'), '');
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'tgl_is_ledger_admin')
     AND EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'tgl_ist_today_start')
     AND EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'tgl_ist_today_end') THEN

    DROP POLICY IF EXISTS tgl_auth_select_payments ON public.payments;
    CREATE POLICY tgl_auth_select_payments
      ON public.payments FOR SELECT TO authenticated
      USING (
        public.tgl_is_ledger_admin()
        OR (
          deleted_at IS NULL
          AND created_at >= public.tgl_ist_today_start()
          AND created_at <= public.tgl_ist_today_end()
          AND NULLIF(BTRIM(branch_id), '') IS NOT NULL
          AND NULLIF(BTRIM(branch_id), '') = public.tgl_current_user_branch_id()
        )
      );

    DROP POLICY IF EXISTS tgl_auth_select_orders ON public.orders;
    CREATE POLICY tgl_auth_select_orders
      ON public.orders FOR SELECT TO authenticated
      USING (
        public.tgl_is_ledger_admin()
        OR (
          deleted_at IS NULL
          AND created_at >= public.tgl_ist_today_start()
          AND created_at <= public.tgl_ist_today_end()
          AND NULLIF(BTRIM(branch_id), '') IS NOT NULL
          AND NULLIF(BTRIM(branch_id), '') = public.tgl_current_user_branch_id()
        )
      );

    DROP POLICY IF EXISTS tgl_auth_select_order_items ON public.order_items;
    CREATE POLICY tgl_auth_select_order_items
      ON public.order_items FOR SELECT TO authenticated
      USING (
        public.tgl_is_ledger_admin()
        OR (
          deleted_at IS NULL
          AND EXISTS (
            SELECT 1
            FROM public.orders o
            WHERE o.id = order_items.order_id
              AND o.deleted_at IS NULL
              AND o.created_at >= public.tgl_ist_today_start()
              AND o.created_at <= public.tgl_ist_today_end()
              AND NULLIF(BTRIM(o.branch_id), '') IS NOT NULL
              AND NULLIF(BTRIM(o.branch_id), '') = public.tgl_current_user_branch_id()
          )
        )
      );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5. SMAV central bill metadata on public.orders & public.payments (never alters bill_number)
-- ----------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS branch_id text,
  ADD COLUMN IF NOT EXISTS branch_code text,
  ADD COLUMN IF NOT EXISTS branch_name text,
  ADD COLUMN IF NOT EXISTS smav_central_bill_id text,
  ADD COLUMN IF NOT EXISTS smav_reservation_id text,
  ADD COLUMN IF NOT EXISTS smav_sale_id text,
  ADD COLUMN IF NOT EXISTS smav_bill_status text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS smav_finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS smav_finalize_error text,
  ADD COLUMN IF NOT EXISTS smav_last_event_id text,
  ADD COLUMN IF NOT EXISTS smav_last_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS is_legacy_bill boolean NOT NULL DEFAULT false;

-- Mark pre-existing historical bills without SMAV metadata as legacy (NEVER alters bill_number)
UPDATE public.orders
SET is_legacy_bill = true
WHERE smav_reservation_id IS NULL
  AND smav_central_bill_id IS NULL
  AND smav_sale_id IS NULL
  AND is_legacy_bill = false
  AND COALESCE(NULLIF(BTRIM(smav_bill_status), ''), 'legacy') = 'legacy';

-- Backfill smav_central_bill_id from smav_sale_id where already populated
UPDATE public.orders
SET smav_central_bill_id = smav_sale_id
WHERE smav_central_bill_id IS NULL
  AND smav_sale_id IS NOT NULL;

-- Backfill orders.branch_code and orders.branch_name dynamically from public.salon_branches
UPDATE public.orders o
SET
  branch_code = COALESCE(NULLIF(BTRIM(o.branch_code), ''), sb.smav_branch_code, sb.code),
  branch_name = COALESCE(NULLIF(BTRIM(o.branch_name), ''), sb.name)
FROM public.salon_branches sb
WHERE o.branch_id = sb.id
  AND (
    o.branch_code IS NULL
    OR BTRIM(o.branch_code) = ''
    OR o.branch_name IS NULL
    OR BTRIM(o.branch_name) = ''
  );

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS branch_id text,
  ADD COLUMN IF NOT EXISTS branch_code text,
  ADD COLUMN IF NOT EXISTS branch_name text,
  ADD COLUMN IF NOT EXISTS smav_central_bill_id text;

-- Backfill payments metadata from public.orders and public.salon_branches (NEVER alters bill_number)
UPDATE public.payments p
SET
  branch_id = COALESCE(NULLIF(BTRIM(p.branch_id), ''), o.branch_id),
  branch_code = COALESCE(NULLIF(BTRIM(p.branch_code), ''), o.branch_code),
  branch_name = COALESCE(NULLIF(BTRIM(p.branch_name), ''), o.branch_name),
  smav_central_bill_id = COALESCE(p.smav_central_bill_id, o.smav_central_bill_id)
FROM public.orders o
WHERE (p.order_id = o.id OR (p.bill_number IS NOT NULL AND p.bill_number = o.bill_number))
  AND (
    p.branch_id IS NULL
    OR BTRIM(p.branch_id) = ''
    OR p.branch_code IS NULL
    OR BTRIM(p.branch_code) = ''
    OR p.branch_name IS NULL
    OR BTRIM(p.branch_name) = ''
    OR (p.smav_central_bill_id IS NULL AND o.smav_central_bill_id IS NOT NULL)
  );

UPDATE public.payments p
SET
  branch_code = COALESCE(NULLIF(BTRIM(p.branch_code), ''), sb.smav_branch_code, sb.code),
  branch_name = COALESCE(NULLIF(BTRIM(p.branch_name), ''), sb.name)
FROM public.salon_branches sb
WHERE p.branch_id = sb.id
  AND (
    p.branch_code IS NULL
    OR BTRIM(p.branch_code) = ''
    OR p.branch_name IS NULL
    OR BTRIM(p.branch_name) = ''
  );

-- ----------------------------------------------------------------------------
-- 6. Preflight duplicate check & replay-safety indexes on orders and payments
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_dup_groups integer := 0;
  v_dup_sample text := '';
BEGIN
  SELECT
    COUNT(*),
    COALESCE(STRING_AGG(bill_number || ' (' || cnt || ' rows)', ', ' ORDER BY bill_number), '')
  INTO v_dup_groups, v_dup_sample
  FROM (
    SELECT bill_number, COUNT(*) AS cnt
    FROM public.orders
    WHERE is_legacy_bill = false
      AND bill_number IS NOT NULL
    GROUP BY bill_number
    HAVING COUNT(*) > 1
    ORDER BY bill_number
    LIMIT 20
  ) dup;

  IF v_dup_groups > 0 THEN
    RAISE EXCEPTION
      'PREFLIGHT_DUPLICATE_CENTRAL_BILL_NUMBER: Found % duplicate non-legacy orders.bill_number group(s): %. Resolve duplicate non-legacy bill_number rows before creating uq_orders_central_bill_number.',
      v_dup_groups, v_dup_sample;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_bill_number
  ON public.orders (bill_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_central_bill_number
  ON public.orders (bill_number)
  WHERE is_legacy_bill = false AND bill_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_smav_central_bill_id
  ON public.orders (smav_central_bill_id)
  WHERE smav_central_bill_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_idempotency_key
  ON public.orders (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_smav_reservation_id
  ON public.orders (smav_reservation_id)
  WHERE smav_reservation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_smav_finalize_pending
  ON public.orders (smav_bill_status, created_at)
  WHERE smav_bill_status = 'finalize_pending';

CREATE INDEX IF NOT EXISTS idx_payments_order_id
  ON public.payments (order_id);

CREATE INDEX IF NOT EXISTS idx_payments_bill_number
  ON public.payments (bill_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_smav_central_bill_id
  ON public.payments (smav_central_bill_id)
  WHERE smav_central_bill_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 7. Enforce immutability of orders.bill_number at the database layer
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tgl_enforce_immutable_bill_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.bill_number IS NOT NULL
     AND BTRIM(OLD.bill_number) <> ''
     AND NEW.bill_number IS DISTINCT FROM OLD.bill_number THEN
    RAISE EXCEPTION 'IMMUTABLE_BILL_NUMBER: Existing bill_number (%) cannot be modified to (%).',
      OLD.bill_number, NEW.bill_number;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_immutable_bill_number ON public.orders;
CREATE TRIGGER trg_orders_immutable_bill_number
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tgl_enforce_immutable_bill_number();

COMMIT;
