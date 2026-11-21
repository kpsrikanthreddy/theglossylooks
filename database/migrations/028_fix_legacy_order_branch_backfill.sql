-- ============================================================================
-- Migration 028: Safe Join-Only Correction for Legacy Order Branch Backfill
-- ============================================================================
-- PURPOSE:
-- Migration 026 is preserved unmodified (in case it was already applied in
-- Supabase). Its historical backfill defaulted unknown or NULL orders.branch_id
-- rows to 'GACHI' / 'Gachibowli' via `ELSE 'GACHI'`.
--
-- This strictly additive, idempotent migration corrects ONLY legacy order rows
-- (is_legacy_bill = true) and their linked payment rows:
-- 1. Never defaults any unknown or NULL branch_id to 'GACHI'.
-- 2. Populates/corrects orders.branch_code and orders.branch_name ONLY by
--    joining public.orders.branch_id = public.salon_branches.id, using
--    COALESCE(NULLIF(BTRIM(sb.smav_branch_code), ''), NULLIF(BTRIM(sb.code), ''))
--    and NULLIF(BTRIM(sb.name), '').
-- 3. If a legacy order has NULL/blank branch_id OR no matching row in
--    public.salon_branches, clears any wrongly backfilled default branch_code
--    and branch_name back to NULL for manual review and reports the count via
--    RAISE NOTICE.
-- 4. Syncs public.payments.branch_code and public.payments.branch_name to match
--    the corrected legacy orders (or joined public.salon_branches), leaving
--    unmatched rows NULL for manual review.
-- 5. NEVER modifies orders.bill_number, payments.bill_number, or non-legacy
--    SMAV central bills (is_legacy_bill = false).
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_realigned_orders bigint := 0;
  v_cleared_unmatched_orders bigint := 0;
  v_realigned_payments bigint := 0;
  v_cleared_unmatched_payments bigint := 0;
BEGIN
  -- 1. Correct legacy orders whose branch_id matches a real row in public.salon_branches
  UPDATE public.orders o
  SET
    branch_code = COALESCE(NULLIF(BTRIM(sb.smav_branch_code), ''), NULLIF(BTRIM(sb.code), '')),
    branch_name = NULLIF(BTRIM(sb.name), '')
  FROM public.salon_branches sb
  WHERE o.is_legacy_bill = true
    AND o.branch_id = sb.id
    AND (
      o.branch_code IS DISTINCT FROM COALESCE(NULLIF(BTRIM(sb.smav_branch_code), ''), NULLIF(BTRIM(sb.code), ''))
      OR o.branch_name IS DISTINCT FROM NULLIF(BTRIM(sb.name), '')
    );
  GET DIAGNOSTICS v_realigned_orders = ROW_COUNT;

  -- 2. Clear wrongly defaulted branch_code/branch_name on legacy orders that have
  --    NULL/blank branch_id or NO matching row in public.salon_branches
  UPDATE public.orders o
  SET
    branch_code = NULL,
    branch_name = NULL
  WHERE o.is_legacy_bill = true
    AND (
      o.branch_id IS NULL
      OR BTRIM(o.branch_id) = ''
      OR NOT EXISTS (
        SELECT 1
        FROM public.salon_branches sb
        WHERE sb.id = o.branch_id
      )
    )
    AND (
      o.branch_code IS NOT NULL
      OR o.branch_name IS NOT NULL
    );
  GET DIAGNOSTICS v_cleared_unmatched_orders = ROW_COUNT;

  -- 3. Realign linked payments for legacy orders whose branch_id matches public.salon_branches
  UPDATE public.payments p
  SET
    branch_code = o.branch_code,
    branch_name = o.branch_name
  FROM public.orders o
  WHERE o.is_legacy_bill = true
    AND (p.order_id = o.id OR (p.bill_number IS NOT NULL AND p.bill_number = o.bill_number))
    AND o.branch_code IS NOT NULL
    AND (
      p.branch_code IS DISTINCT FROM o.branch_code
      OR p.branch_name IS DISTINCT FROM o.branch_name
    );
  GET DIAGNOSTICS v_realigned_payments = ROW_COUNT;

  -- 4. Clear wrongly defaulted branch_code/branch_name on payments linked to
  --    unmatched legacy orders (when payment itself also has no valid salon_branches match)
  UPDATE public.payments p
  SET
    branch_code = NULL,
    branch_name = NULL
  FROM public.orders o
  WHERE o.is_legacy_bill = true
    AND (p.order_id = o.id OR (p.bill_number IS NOT NULL AND p.bill_number = o.bill_number))
    AND o.branch_code IS NULL
    AND o.branch_name IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.salon_branches sb
      WHERE sb.id = p.branch_id
    )
    AND (
      p.branch_code IS NOT NULL
      OR p.branch_name IS NOT NULL
    );
  GET DIAGNOSTICS v_cleared_unmatched_payments = ROW_COUNT;

  RAISE NOTICE 'Migration 028: Legacy orders aligned from public.salon_branches = %, unmatched legacy orders cleared to NULL for manual review = %, payments aligned = %, unmatched payments cleared to NULL = %.',
    v_realigned_orders,
    v_cleared_unmatched_orders,
    v_realigned_payments,
    v_cleared_unmatched_payments;
END $$;

COMMIT;
