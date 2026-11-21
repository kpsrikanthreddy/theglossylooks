-- Controlled backdated billing for GlossyLooks.
-- created_at remains the real record-entry time; billed_at/billing_date drive the ledger and reports.
-- This migration never changes an existing bill number.

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS billing_date date,
  ADD COLUMN IF NOT EXISTS billed_at timestamptz,
  ADD COLUMN IF NOT EXISTS backdated_by text,
  ADD COLUMN IF NOT EXISTS backdated_at timestamptz;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS billing_date date,
  ADD COLUMN IF NOT EXISTS billed_at timestamptz,
  ADD COLUMN IF NOT EXISTS backdated_by text,
  ADD COLUMN IF NOT EXISTS backdated_at timestamptz;

-- Existing records are historical normal bills. Preserve their creation time as their billing time.
UPDATE public.orders
SET billed_at = COALESCE(billed_at, created_at),
    billing_date = COALESCE(billing_date, (COALESCE(billed_at, created_at) AT TIME ZONE 'Asia/Kolkata')::date)
WHERE billed_at IS NULL OR billing_date IS NULL;

UPDATE public.payments
SET billed_at = COALESCE(billed_at, created_at),
    billing_date = COALESCE(billing_date, (COALESCE(billed_at, created_at) AT TIME ZONE 'Asia/Kolkata')::date)
WHERE billed_at IS NULL OR billing_date IS NULL;

ALTER TABLE public.orders
  ALTER COLUMN billed_at SET DEFAULT now();
ALTER TABLE public.payments
  ALTER COLUMN billed_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_orders_billed_at_active
  ON public.orders (billed_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payments_billed_at_active
  ON public.payments (billed_at DESC)
  WHERE deleted_at IS NULL;

COMMIT;
