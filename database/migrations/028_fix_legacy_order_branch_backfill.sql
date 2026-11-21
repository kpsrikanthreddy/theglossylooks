-- Safe join-only repair for legacy orders after Migration 027.
BEGIN;

UPDATE public.orders AS o
SET branch_code = coalesce(nullif(btrim(sb.smav_branch_code), ''), nullif(btrim(sb.code), '')),
    branch_name = nullif(btrim(sb.name), '')
FROM public.salon_branches AS sb
WHERE o.is_legacy_bill = true
  AND o.branch_id = sb.id
  AND (
    o.branch_code IS DISTINCT FROM coalesce(nullif(btrim(sb.smav_branch_code), ''), nullif(btrim(sb.code), ''))
    OR o.branch_name IS DISTINCT FROM nullif(btrim(sb.name), '')
  );

UPDATE public.orders AS o
SET branch_code = NULL, branch_name = NULL
WHERE o.is_legacy_bill = true
  AND (o.branch_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.salon_branches AS sb WHERE sb.id = o.branch_id
  ));

UPDATE public.payments AS p
SET branch_code = o.branch_code,
    branch_name = o.branch_name,
    branch_id = coalesce(p.branch_id, o.branch_id)
FROM public.orders AS o
WHERE o.is_legacy_bill = true
  AND (p.order_id = o.id OR (p.bill_number IS NOT NULL AND p.bill_number = o.bill_number));

COMMIT;
