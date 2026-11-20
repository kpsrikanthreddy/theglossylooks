-- =============================================================================
-- Migration 025: Appointments & Payments Ledger Soft Delete, Atomic Bill
--                Soft-Delete/Restore RPCs, Linked WhatsApp Template Tracking,
--                and Role-Scoped Supabase RLS (Asia/Kolkata Today Enforcement)
-- =============================================================================
-- Safety guarantees:
--   1. Non-destructive & idempotent (ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE).
--   2. Preserves all existing appointments, orders, order_items, payments,
--      customers, staff, users, WhatsApp history, and SMAV sync tables.
--   3. Atomic soft-delete & restore RPCs ensure a bill/order and all linked
--      order_items and payments are deleted/restored together (no partial deletes).
--   4. Supabase RLS enforces that STAFF roles (RECEPTIONIST, STYLIST, POS_BILLING,
--      MANAGER, etc.) can only SELECT today's (Asia/Kolkata 00:00 - 23:59:59.999)
--      active Payment Ledger records for their assigned branch, and cannot
--      UPDATE or DELETE payment ledger or appointment records.
--   5. Only OWNER, ADMIN, and SUPERADMIN have full Payment Ledger access and
--      soft-delete / view-deleted / restore permissions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Soft-delete metadata columns on Appointments, Orders, Order Items, Payments
-- -----------------------------------------------------------------------------
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(255),
  ADD COLUMN IF NOT EXISTS deleted_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT,
  ADD COLUMN IF NOT EXISTS restored_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS restored_by VARCHAR(255);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(255),
  ADD COLUMN IF NOT EXISTS deleted_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT,
  ADD COLUMN IF NOT EXISTS restored_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS restored_by VARCHAR(255);

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(255),
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(255),
  ADD COLUMN IF NOT EXISTS deleted_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT,
  ADD COLUMN IF NOT EXISTS restored_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS restored_by VARCHAR(255);

-- Performance indexes for active/deleted filtering and IST branch-day queries
CREATE INDEX IF NOT EXISTS idx_appointments_active_created
  ON public.appointments (created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_deleted_at
  ON public.appointments (deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_active_branch_created
  ON public.orders (branch_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_deleted_at
  ON public.orders (deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_order_active
  ON public.order_items (order_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_active_branch_created
  ON public.payments (branch_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_order_id
  ON public.payments (order_id);

CREATE INDEX IF NOT EXISTS idx_payments_deleted_at
  ON public.payments (deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. Linked Appointment / Bill / Order Columns on Permanent WhatsApp History
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.whatsapp_messages') IS NOT NULL THEN
    ALTER TABLE public.whatsapp_messages
      ADD COLUMN IF NOT EXISTS appointment_id TEXT,
      ADD COLUMN IF NOT EXISTS order_id TEXT,
      ADD COLUMN IF NOT EXISTS bill_number TEXT,
      ADD COLUMN IF NOT EXISTS payment_id TEXT,
      ADD COLUMN IF NOT EXISTS delivery_status TEXT;

    CREATE INDEX IF NOT EXISTS idx_wa_msg_appointment_id
      ON public.whatsapp_messages (appointment_id)
      WHERE appointment_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_wa_msg_order_id
      ON public.whatsapp_messages (order_id)
      WHERE order_id IS NOT NULL;
  END IF;

  IF to_regclass('public.whatsapp_message_logs') IS NOT NULL THEN
    ALTER TABLE public.whatsapp_message_logs
      ADD COLUMN IF NOT EXISTS bill_number TEXT,
      ADD COLUMN IF NOT EXISTS payment_id TEXT,
      ADD COLUMN IF NOT EXISTS sent_by_user_id TEXT,
      ADD COLUMN IF NOT EXISTS sent_by_user_name TEXT,
      ADD COLUMN IF NOT EXISTS conversation_id UUID,
      ADD COLUMN IF NOT EXISTS whatsapp_message_id UUID;

    CREATE INDEX IF NOT EXISTS idx_wa_logs_order_id
      ON public.whatsapp_message_logs (order_id)
      WHERE order_id IS NOT NULL;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Atomic Soft-Delete & Restore RPCs (Service Role Only)
-- -----------------------------------------------------------------------------

-- 3A. Soft-delete an Appointment and cancel pending auto-feedback jobs
CREATE OR REPLACE FUNCTION public.tgl_soft_delete_appointment(
  p_appointment_id UUID,
  p_deleted_by TEXT,
  p_deleted_by_user_id TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT 'Removed by authorized admin'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_apt public.appointments%ROWTYPE;
  v_reason TEXT := COALESCE(NULLIF(BTRIM(p_reason), ''), 'Removed by authorized admin');
BEGIN
  SELECT * INTO v_apt
  FROM public.appointments
  WHERE id = p_appointment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_apt.deleted_at IS NULL THEN
    UPDATE public.appointments
    SET deleted_at = v_now,
        deleted_by = p_deleted_by,
        deleted_by_user_id = p_deleted_by_user_id,
        deletion_reason = v_reason,
        updated_at = v_now
    WHERE id = p_appointment_id
    RETURNING * INTO v_apt;

    IF to_regclass('public.scheduled_feedback_jobs') IS NOT NULL THEN
      UPDATE public.scheduled_feedback_jobs
      SET status = 'cancelled',
          updated_at = v_now
      WHERE appointment_id = p_appointment_id::text
        AND status IN ('pending', 'processing');
    END IF;

    INSERT INTO public.audit_logs (action, entity, entity_id, performed_by, details, timestamp)
    VALUES (
      'SOFT_DELETE',
      'Appointment',
      p_appointment_id::text,
      COALESCE(NULLIF(BTRIM(p_deleted_by), ''), 'Owner'),
      pg_catalog.jsonb_build_object(
        'record_type', 'Appointment',
        'appointment_id', p_appointment_id::text,
        'booking_reference', v_apt.booking_reference,
        'customer_name', v_apt.customer_name,
        'customer_phone', v_apt.customer_phone,
        'deleted_by', p_deleted_by,
        'deleted_by_user_id', p_deleted_by_user_id,
        'reason', v_reason,
        'deleted_at', v_now
      )::text,
      v_now
    );
  END IF;

  RETURN to_jsonb(v_apt);
END;
$$;

-- 3B. Restore a soft-deleted Appointment
CREATE OR REPLACE FUNCTION public.tgl_restore_appointment(
  p_appointment_id UUID,
  p_restored_by TEXT,
  p_restored_by_user_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_apt public.appointments%ROWTYPE;
BEGIN
  SELECT * INTO v_apt
  FROM public.appointments
  WHERE id = p_appointment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.appointments
  SET deleted_at = NULL,
      restored_at = v_now,
      restored_by = p_restored_by,
      updated_at = v_now
  WHERE id = p_appointment_id
  RETURNING * INTO v_apt;

  INSERT INTO public.audit_logs (action, entity, entity_id, performed_by, details, timestamp)
  VALUES (
    'RESTORE',
    'Appointment',
    p_appointment_id::text,
    COALESCE(NULLIF(BTRIM(p_restored_by), ''), 'Owner'),
    pg_catalog.jsonb_build_object(
      'record_type', 'Appointment',
      'appointment_id', p_appointment_id::text,
      'booking_reference', v_apt.booking_reference,
      'customer_name', v_apt.customer_name,
      'restored_by', p_restored_by,
      'restored_by_user_id', p_restored_by_user_id,
      'restored_at', v_now
    )::text,
    v_now
  );

  RETURN to_jsonb(v_apt);
END;
$$;

-- 3C. Atomically soft-delete a complete Bill/Order transaction + related order_items + ALL payments
CREATE OR REPLACE FUNCTION public.tgl_soft_delete_order_transaction(
  p_order_id UUID,
  p_deleted_by TEXT,
  p_deleted_by_user_id TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT 'Removed from ledger by authorized admin'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_order public.orders%ROWTYPE;
  v_payments_count INT := 0;
  v_items_count INT := 0;
  v_reason TEXT := COALESCE(NULLIF(BTRIM(p_reason), ''), 'Removed from ledger by authorized admin');
BEGIN
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_order.deleted_at IS NULL THEN
    UPDATE public.orders
    SET deleted_at = v_now,
        deleted_by = p_deleted_by,
        deleted_by_user_id = p_deleted_by_user_id,
        deletion_reason = v_reason
    WHERE id = p_order_id
    RETURNING * INTO v_order;

    UPDATE public.order_items
    SET deleted_at = v_now,
        deleted_by = p_deleted_by,
        deletion_reason = v_reason
    WHERE order_id = p_order_id
      AND deleted_at IS NULL;
    GET DIAGNOSTICS v_items_count = ROW_COUNT;

    UPDATE public.payments
    SET deleted_at = v_now,
        deleted_by = p_deleted_by,
        deleted_by_user_id = p_deleted_by_user_id,
        deletion_reason = v_reason
    WHERE (order_id = p_order_id OR bill_number = v_order.bill_number)
      AND deleted_at IS NULL;
    GET DIAGNOSTICS v_payments_count = ROW_COUNT;

    IF to_regclass('public.scheduled_feedback_jobs') IS NOT NULL THEN
      UPDATE public.scheduled_feedback_jobs
      SET status = 'cancelled',
          updated_at = v_now
      WHERE order_id = p_order_id::text
        AND status IN ('pending', 'processing');
    END IF;

    INSERT INTO public.audit_logs (action, entity, entity_id, performed_by, details, timestamp)
    VALUES (
      'SOFT_DELETE',
      'PaymentLedgerBill',
      p_order_id::text,
      COALESCE(NULLIF(BTRIM(p_deleted_by), ''), 'Owner'),
      pg_catalog.jsonb_build_object(
        'record_type', 'OrderAndPayments',
        'order_id', p_order_id::text,
        'bill_number', v_order.bill_number,
        'customer_name', v_order.customer_name,
        'customer_phone', v_order.customer_phone,
        'amount', v_order.grand_total,
        'affected_payments', v_payments_count,
        'affected_order_items', v_items_count,
        'deleted_by', p_deleted_by,
        'deleted_by_user_id', p_deleted_by_user_id,
        'reason', v_reason,
        'deleted_at', v_now
      )::text,
      v_now
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'order', to_jsonb(v_order),
    'affected_payments', v_payments_count,
    'affected_order_items', v_items_count
  );
END;
$$;

-- 3D. Atomically restore a soft-deleted Bill/Order transaction + order_items + payments
CREATE OR REPLACE FUNCTION public.tgl_restore_order_transaction(
  p_order_id UUID,
  p_restored_by TEXT,
  p_restored_by_user_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_order public.orders%ROWTYPE;
  v_payments_count INT := 0;
  v_items_count INT := 0;
BEGIN
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.orders
  SET deleted_at = NULL,
      restored_at = v_now,
      restored_by = p_restored_by
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  UPDATE public.order_items
  SET deleted_at = NULL
  WHERE order_id = p_order_id;
  GET DIAGNOSTICS v_items_count = ROW_COUNT;

  UPDATE public.payments
  SET deleted_at = NULL,
      restored_at = v_now,
      restored_by = p_restored_by
  WHERE order_id = p_order_id OR bill_number = v_order.bill_number;
  GET DIAGNOSTICS v_payments_count = ROW_COUNT;

  INSERT INTO public.audit_logs (action, entity, entity_id, performed_by, details, timestamp)
  VALUES (
    'RESTORE',
    'PaymentLedgerBill',
    p_order_id::text,
    COALESCE(NULLIF(BTRIM(p_restored_by), ''), 'Owner'),
    pg_catalog.jsonb_build_object(
      'record_type', 'OrderAndPayments',
      'order_id', p_order_id::text,
      'bill_number', v_order.bill_number,
      'customer_name', v_order.customer_name,
      'amount', v_order.grand_total,
      'restored_payments', v_payments_count,
      'restored_order_items', v_items_count,
      'restored_by', p_restored_by,
      'restored_by_user_id', p_restored_by_user_id,
      'restored_at', v_now
    )::text,
    v_now
  );

  RETURN pg_catalog.jsonb_build_object(
    'order', to_jsonb(v_order),
    'restored_payments', v_payments_count,
    'restored_order_items', v_items_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.tgl_soft_delete_appointment(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tgl_restore_appointment(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tgl_soft_delete_order_transaction(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tgl_restore_order_transaction(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.tgl_soft_delete_appointment(UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.tgl_restore_appointment(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.tgl_soft_delete_order_transaction(UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.tgl_restore_order_transaction(UUID, TEXT, TEXT) TO service_role;

-- -----------------------------------------------------------------------------
-- 4. Asia/Kolkata Today & Role-Scoped Supabase RLS Policies
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tgl_ist_today_start()
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
AS $$
  SELECT (date_trunc('day', timezone('Asia/Kolkata', now())) AT TIME ZONE 'Asia/Kolkata');
$$;

CREATE OR REPLACE FUNCTION public.tgl_ist_today_end()
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
AS $$
  SELECT ((date_trunc('day', timezone('Asia/Kolkata', now())) + interval '1 day' - interval '1 millisecond') AT TIME ZONE 'Asia/Kolkata');
$$;

CREATE OR REPLACE FUNCTION public.tgl_current_user_role()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid UUID;
  v_role TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NOT NULL THEN
    SELECT UPPER(u.role) INTO v_role
    FROM public.users u
    WHERE u.is_active = TRUE
      AND (u.id = v_uid OR u.central_auth_id = v_uid)
    LIMIT 1;
    IF v_role IS NOT NULL THEN
      RETURN v_role;
    END IF;
  END IF;

  RETURN UPPER(COALESCE(
    auth.jwt() -> 'app_metadata' ->> 'role',
    auth.jwt() -> 'user_metadata' ->> 'role',
    ''
  ));
END;
$$;

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
    SELECT COALESCE(NULLIF(BTRIM(u.branch_id), ''), 'tgl-gachibowli-main') INTO v_branch
    FROM public.users u
    WHERE u.is_active = TRUE
      AND (u.id = v_uid OR u.central_auth_id = v_uid)
    LIMIT 1;
    IF v_branch IS NOT NULL THEN
      RETURN v_branch;
    END IF;
  END IF;

  RETURN COALESCE(
    NULLIF(BTRIM(auth.jwt() -> 'app_metadata' ->> 'branch_id'), ''),
    'tgl-gachibowli-main'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.tgl_is_ledger_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT public.tgl_current_user_role() IN ('OWNER', 'ADMIN', 'SUPERADMIN');
$$;

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Service role retains full access for server-side RBAC-enforced backend API
DROP POLICY IF EXISTS tgl_service_role_all_appointments ON public.appointments;
CREATE POLICY tgl_service_role_all_appointments
  ON public.appointments FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS tgl_service_role_all_orders ON public.orders;
CREATE POLICY tgl_service_role_all_orders
  ON public.orders FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS tgl_service_role_all_order_items ON public.order_items;
CREATE POLICY tgl_service_role_all_order_items
  ON public.order_items FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS tgl_service_role_all_payments ON public.payments;
CREATE POLICY tgl_service_role_all_payments
  ON public.payments FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated Payment Ledger SELECT:
--   - OWNER / ADMIN / SUPERADMIN: full access (active + deleted, all branches, all dates)
--   - STAFF (RECEPTIONIST, STYLIST, POS_BILLING, MANAGER, etc.):
--       ONLY today's (Asia/Kolkata 12:00 AM - 11:59:59.999 PM) active records
--       for their assigned branch.
DROP POLICY IF EXISTS tgl_auth_select_payments ON public.payments;
CREATE POLICY tgl_auth_select_payments
  ON public.payments FOR SELECT TO authenticated
  USING (
    public.tgl_is_ledger_admin()
    OR (
      deleted_at IS NULL
      AND created_at >= public.tgl_ist_today_start()
      AND created_at <= public.tgl_ist_today_end()
      AND COALESCE(NULLIF(BTRIM(branch_id), ''), 'tgl-gachibowli-main') = public.tgl_current_user_branch_id()
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
      AND COALESCE(NULLIF(BTRIM(branch_id), ''), 'tgl-gachibowli-main') = public.tgl_current_user_branch_id()
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
          AND COALESCE(NULLIF(BTRIM(o.branch_id), ''), 'tgl-gachibowli-main') = public.tgl_current_user_branch_id()
      )
    )
  );

-- Authenticated Payment Ledger UPDATE/DELETE strictly restricted to OWNER / ADMIN / SUPERADMIN
DROP POLICY IF EXISTS tgl_auth_modify_payments_admin_only ON public.payments;
CREATE POLICY tgl_auth_modify_payments_admin_only
  ON public.payments FOR UPDATE TO authenticated
  USING (public.tgl_is_ledger_admin())
  WITH CHECK (public.tgl_is_ledger_admin());

DROP POLICY IF EXISTS tgl_auth_delete_payments_admin_only ON public.payments;
CREATE POLICY tgl_auth_delete_payments_admin_only
  ON public.payments FOR DELETE TO authenticated
  USING (public.tgl_is_ledger_admin());

DROP POLICY IF EXISTS tgl_auth_modify_orders_admin_only ON public.orders;
CREATE POLICY tgl_auth_modify_orders_admin_only
  ON public.orders FOR UPDATE TO authenticated
  USING (public.tgl_is_ledger_admin())
  WITH CHECK (public.tgl_is_ledger_admin());

DROP POLICY IF EXISTS tgl_auth_delete_orders_admin_only ON public.orders;
CREATE POLICY tgl_auth_delete_orders_admin_only
  ON public.orders FOR DELETE TO authenticated
  USING (public.tgl_is_ledger_admin());

-- Authenticated Appointments SELECT: active rows visible to staff; deleted rows ONLY to OWNER/ADMIN/SUPERADMIN
DROP POLICY IF EXISTS tgl_auth_select_appointments ON public.appointments;
CREATE POLICY tgl_auth_select_appointments
  ON public.appointments FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    OR public.tgl_is_ledger_admin()
  );

DROP POLICY IF EXISTS tgl_auth_delete_appointments_admin_only ON public.appointments;
CREATE POLICY tgl_auth_delete_appointments_admin_only
  ON public.appointments FOR DELETE TO authenticated
  USING (public.tgl_is_ledger_admin());

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
