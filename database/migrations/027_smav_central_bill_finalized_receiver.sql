-- ============================================================================
-- Migration 027: GlossyLooks dynamic branch standardization + SMAV bill fields
-- Safe to run once in the GlossyLooks Supabase project after reviewing precheck.
-- ============================================================================
BEGIN;

-- Canonical SMAV code is additive. This statement intentionally targets the
-- actual master table: public.salon_branches (never public.branches).
ALTER TABLE public.salon_branches
  ADD COLUMN IF NOT EXISTS smav_branch_code text;

-- Central-SMAV metadata. Existing records are legacy by default; only the
-- signed SMAV finalized-sale receiver should create non-legacy central bills.
ALTER TABLE public.orders
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
  ADD COLUMN IF NOT EXISTS is_legacy_bill boolean NOT NULL DEFAULT true;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS branch_id text,
  ADD COLUMN IF NOT EXISTS branch_code text,
  ADD COLUMN IF NOT EXISTS branch_name text,
  ADD COLUMN IF NOT EXISTS smav_central_bill_id text;

DO $$
DECLARE
  v_map record;
  v_target record;
  v_source_exists boolean;
  v_target_exists boolean;
BEGIN
  -- Only the two verified legacy IDs are standardized. Other businesses,
  -- salons, tenant IDs, outlet IDs and generic text fields are untouched.
  FOR v_map IN
    SELECT * FROM (VALUES
      ('tgl-gachibowli-main'::text, 'tgl-gachi'::text, 'Gachibowli'::text, 'GACHI'::text),
      ('brn-1793346038689'::text,   'tgl-konda'::text, 'Kondapur'::text,   'KONDA'::text)
    ) AS m(old_id, new_id, new_name, new_code)
  LOOP
    SELECT EXISTS (SELECT 1 FROM public.salon_branches WHERE id = v_map.old_id)
      INTO v_source_exists;
    SELECT EXISTS (SELECT 1 FROM public.salon_branches WHERE id = v_map.new_id)
      INTO v_target_exists;

    -- Park the old code before touching the canonical row. This avoids a
    -- unique-code collision if a previous partial/manual setup created both
    -- rows. The legacy row remains available for the clone and for audit.
    IF v_source_exists AND v_map.old_id <> v_map.new_id THEN
      UPDATE public.salon_branches
      SET code = 'LEGACY_' || upper(substr(md5(id), 1, 12)),
          smav_branch_code = 'LEGACY_' || upper(substr(md5(id), 1, 12)),
          is_active = false
      WHERE id = v_map.old_id;
    END IF;

    -- If the canonical row does not yet exist, clone the real legacy branch
    -- row and replace only the canonical branch attributes. This retains any
    -- required salon-specific columns without assuming their names.
    IF v_source_exists AND NOT v_target_exists THEN
      INSERT INTO public.salon_branches
      SELECT (jsonb_populate_record(
        src,
        jsonb_build_object(
          'id', v_map.new_id,
          'name', v_map.new_name,
          'code', v_map.new_code,
          'smav_branch_code', v_map.new_code,
          'is_active', true
        )
      )).*
      FROM public.salon_branches AS src
      WHERE src.id = v_map.old_id;
    END IF;

    -- Canonical master values are enforced only on the canonical rows.
    UPDATE public.salon_branches
    SET name = v_map.new_name,
        code = v_map.new_code,
        smav_branch_code = v_map.new_code,
        is_active = true
    WHERE id = v_map.new_id;

    -- Update only reviewed branch_id references, and only when the table and
    -- branch_id column actually exist in this project.
    FOR v_target IN
      SELECT * FROM (VALUES
        ('users'), ('staff'), ('customers'), ('appointments'), ('orders'),
        ('payments'), ('branch_whatsapp_integrations'), ('whatsapp_message_logs'),
        ('appointment_feedback'), ('scheduled_feedback_jobs'), ('daily_sales_reports'),
        ('whatsapp_conversations'), ('whatsapp_messages'), ('smav_inbound_sales')
      ) AS t(table_name)
    LOOP
      IF to_regclass('public.' || v_target.table_name) IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = v_target.table_name
             AND column_name = 'branch_id'
         ) THEN
        EXECUTE format('UPDATE public.%I SET branch_id = $1 WHERE branch_id = $2', v_target.table_name)
          USING v_map.new_id, v_map.old_id;
      END IF;
    END LOOP;

    -- Preserve legacy branch rows for audit/history; never delete them.
  END LOOP;
END
$$;

-- Fill branch display metadata only by joining the actual branch master.
UPDATE public.orders AS o
SET branch_code = coalesce(nullif(btrim(sb.smav_branch_code), ''), nullif(btrim(sb.code), '')),
    branch_name = nullif(btrim(sb.name), '')
FROM public.salon_branches AS sb
WHERE o.branch_id = sb.id
  AND (o.branch_code IS NULL OR o.branch_name IS NULL);

UPDATE public.payments AS p
SET branch_id = coalesce(p.branch_id, o.branch_id),
    branch_code = coalesce(p.branch_code, o.branch_code),
    branch_name = coalesce(p.branch_name, o.branch_name),
    smav_central_bill_id = coalesce(p.smav_central_bill_id, o.smav_central_bill_id)
FROM public.orders AS o
WHERE (p.order_id = o.id OR (p.bill_number IS NOT NULL AND p.bill_number = o.bill_number));

-- Fail before adding a unique central-bill constraint if the current data is
-- not safe. Legacy historical bills are excluded from this unique index.
DO $$
DECLARE v_duplicates text;
BEGIN
  SELECT string_agg(bill_number, ', ' ORDER BY bill_number)
  INTO v_duplicates
  FROM (
    SELECT bill_number
    FROM public.orders
    WHERE is_legacy_bill = false AND bill_number IS NOT NULL
    GROUP BY bill_number
    HAVING count(*) > 1
    LIMIT 20
  ) AS d;
  IF v_duplicates IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT_DUPLICATE_CENTRAL_BILL_NUMBER: %', v_duplicates;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_orders_bill_number ON public.orders (bill_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_central_bill_number
  ON public.orders (bill_number)
  WHERE is_legacy_bill = false AND bill_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_smav_central_bill_id
  ON public.orders (smav_central_bill_id)
  WHERE smav_central_bill_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_idempotency_key
  ON public.orders (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON public.payments (order_id);
CREATE INDEX IF NOT EXISTS idx_payments_bill_number ON public.payments (bill_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_smav_central_bill_id
  ON public.payments (smav_central_bill_id)
  WHERE smav_central_bill_id IS NOT NULL;

COMMIT;
