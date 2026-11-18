-- Glossy Looks Supabase: durable SMAV reconciliation and one-time event claims.
CREATE TABLE IF NOT EXISTS public.smav_inbound_sales (
 source_key text PRIMARY KEY, outlet_id uuid NOT NULL, bill_number text NOT NULL,
 branch_id text NOT NULL, native_order_id text, status text NOT NULL DEFAULT 'reserved',
 receipt_sent_at timestamptz, feedback_sent_at timestamptz,
 receipt_claimed_at timestamptz, feedback_claimed_at timestamptz,
 last_error text, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.smav_inbound_sales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.smav_inbound_sales FROM anon,authenticated;
CREATE OR REPLACE FUNCTION public.smav_claim_inbound_event(p_source_key text,p_event_type text,p_event_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role only'; END IF;
 IF p_event_type='receipt' THEN
 UPDATE public.smav_inbound_sales SET receipt_claimed_at=now() WHERE source_key=p_source_key AND receipt_sent_at IS NULL AND receipt_claimed_at IS NULL AND status='recorded';
 ELSIF p_event_type='feedback' THEN
 UPDATE public.smav_inbound_sales SET feedback_claimed_at=now() WHERE source_key=p_source_key AND feedback_sent_at IS NULL AND feedback_claimed_at IS NULL AND status='recorded';
 ELSE RETURN false; END IF;
 GET DIAGNOSTICS n = ROW_COUNT; RETURN n=1;
END $$;
REVOKE ALL ON FUNCTION public.smav_claim_inbound_event(text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.smav_claim_inbound_event(text,text,uuid) TO service_role;
