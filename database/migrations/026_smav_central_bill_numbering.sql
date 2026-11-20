-- ============================================================================
-- Migration 026: SMAV Central Bill Numbering & Legacy Bill Preservation
-- ============================================================================
-- SAFETY GUARANTEES:
-- 1. Strictly additive / non-destructive. Preserves ALL historical orders,
--    payments, and legacy bill numbers. NEVER renumbers historical bills.
-- 2. Marks pre-existing bills (without smav_reservation_id) as legacy records
--    so legacy and central bills coexist cleanly in Payment Ledger & Reports.
-- 3. Enforces immutability of orders.bill_number via BEFORE UPDATE trigger so
--    neither legacy nor SMAV central bill numbers can ever be overwritten.
-- 4. Maps canonical SMAV branch codes (GACHI = Gachibowli, KONDA = Kondapur)
--    without overwriting existing branch codes or branch IDs.
-- ============================================================================

BEGIN;

-- 1. Canonical SMAV branch code column on public.branches
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS smav_branch_code text;

UPDATE public.branches
SET smav_branch_code = 'GACHI'
WHERE smav_branch_code IS NULL
  AND (
    id = 'tgl-gachibowli-main'
    OR UPPER(COALESCE(code, '')) IN ('GACHI', 'GCB-01', 'GCB')
    OR LOWER(COALESCE(name, '')) LIKE '%gachibowli%'
  );

UPDATE public.branches
SET smav_branch_code = 'KONDA'
WHERE smav_branch_code IS NULL
  AND (
    id = 'brn-1793346038689'
    OR UPPER(COALESCE(code, '')) IN ('KONDA', 'KND-02', 'KND')
    OR LOWER(COALESCE(name, '')) LIKE '%kondapur%'
  );

-- 2. Central bill numbering & SMAV reconciliation metadata on public.orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS branch_code text,
  ADD COLUMN IF NOT EXISTS branch_name text,
  ADD COLUMN IF NOT EXISTS smav_reservation_id text,
  ADD COLUMN IF NOT EXISTS smav_sale_id text,
  ADD COLUMN IF NOT EXISTS smav_bill_status text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS smav_finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS smav_finalize_error text,
  ADD COLUMN IF NOT EXISTS smav_last_event_id text,
  ADD COLUMN IF NOT EXISTS smav_last_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_legacy_bill boolean NOT NULL DEFAULT false;

-- Mark pre-existing historical bills as legacy WITHOUT altering bill_number
UPDATE public.orders
SET
  is_legacy_bill = true,
  smav_bill_status = CASE
    WHEN COALESCE(NULLIF(BTRIM(smav_bill_status), ''), 'legacy') = 'legacy' THEN 'legacy'
    ELSE smav_bill_status
  END
WHERE smav_reservation_id IS NULL
  AND is_legacy_bill = false;

-- Populate branch_code / branch_name for legacy rows where blank (non-destructive)
UPDATE public.orders
SET
  branch_code = CASE
    WHEN COALESCE(branch_id, '') = 'brn-1793346038689' THEN 'KONDA'
    ELSE 'GACHI'
  END,
  branch_name = CASE
    WHEN COALESCE(branch_id, '') = 'brn-1793346038689' THEN 'Kondapur'
    ELSE 'Gachibowli'
  END
WHERE branch_code IS NULL;

-- 3. Branch code on public.payments for fast reporting/reconciliation
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS branch_code text;

UPDATE public.payments p
SET branch_code = o.branch_code
FROM public.orders o
WHERE p.branch_code IS NULL
  AND (p.order_id = o.id OR (p.bill_number IS NOT NULL AND p.bill_number = o.bill_number));

-- 4. Indexes (unique on central bills; non-unique lookup index covers legacy & central bills)
CREATE INDEX IF NOT EXISTS idx_orders_bill_number
  ON public.orders (bill_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_central_bill_number
  ON public.orders (bill_number)
  WHERE is_legacy_bill = false AND bill_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_smav_reservation_id
  ON public.orders (smav_reservation_id)
  WHERE smav_reservation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_smav_finalize_pending
  ON public.orders (smav_bill_status, created_at)
  WHERE smav_bill_status = 'finalize_pending';

-- 5. Enforce immutability of orders.bill_number at the database layer
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
