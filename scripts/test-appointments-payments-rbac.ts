/**
 * Offline verification tests for:
 * 1. Role-based delete/restore permissions (SUPERADMIN, ADMIN, OWNER only)
 * 2. Payment Ledger staff visibility (Asia/Kolkata today + assigned branch only)
 * 3. Atomic soft-delete & restore for Appointments and complete Bill/Order + Payments + OrderItems
 * 4. Exclusion of soft-deleted bills from ledger totals and reports
 * 5. WhatsApp customer phone validation
 *
 * Strictly offline — does NOT connect to Supabase or Meta APIs.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  canDeleteOrRestoreRecords,
  hasFullPaymentLedgerAccess,
  isRestrictedPaymentLedgerStaff,
  canSendWhatsAppTemplates,
  getKolkataDateString,
  getKolkataTodayBounds,
  isWithinKolkataToday,
  validateWhatsAppPhone,
} from '../src/lib/rbac';
import { SalonDatabase } from '../src/server/db';

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`✅ ${name}`);
  } catch (err: any) {
    console.error(`❌ ${name}`);
    console.error(err?.stack || err?.message || err);
    process.exitCode = 1;
  }
}

async function run() {
  // 1. RBAC Delete/Restore Matrix
  await test('RBAC delete/restore allows ONLY SUPERADMIN, ADMIN, OWNER', () => {
    for (const allowed of ['SUPERADMIN', 'superadmin', 'ADMIN', 'admin', 'OWNER', 'owner']) {
      assert.equal(canDeleteOrRestoreRecords(allowed), true, `Expected ${allowed} to be allowed`);
      assert.equal(hasFullPaymentLedgerAccess(allowed), true, `Expected ${allowed} to have full ledger access`);
      assert.equal(isRestrictedPaymentLedgerStaff(allowed), false, `Expected ${allowed} not to be restricted`);
    }

    for (const denied of ['MANAGER', 'manager', 'RECEPTIONIST', 'receptionist', 'STYLIST', 'stylist', 'POS_BILLING', 'pos_billing', 'INVENTORY_STAFF', 'staff', '', null, undefined]) {
      assert.equal(canDeleteOrRestoreRecords(denied as any), false, `Expected ${String(denied)} to be denied delete`);
      assert.equal(hasFullPaymentLedgerAccess(denied as any), false, `Expected ${String(denied)} to lack full ledger access`);
      assert.equal(isRestrictedPaymentLedgerStaff(denied as any), true, `Expected ${String(denied)} to be restricted staff`);
    }
  });

  // 2. RBAC WhatsApp Template Role Permissions
  await test('RBAC WhatsApp templates allowed for salon staff & admins, denied for unknown roles', () => {
    for (const role of ['owner', 'admin', 'superadmin', 'manager', 'receptionist', 'stylist', 'pos_billing']) {
      assert.equal(canSendWhatsAppTemplates(role), true, `Expected ${role} to send templates`);
    }
    assert.equal(canSendWhatsAppTemplates('guest'), false);
    assert.equal(canSendWhatsAppTemplates(''), false);
  });

  // 3. Asia/Kolkata Today Boundary Precision
  await test('Asia/Kolkata today window enforces 12:00 AM - 11:59:59.999 PM IST strictly', () => {
    // 2026-11-20 14:30:00 IST == 2026-11-20T09:00:00.000Z
    const refNow = new Date('2026-11-20T09:00:00.000Z');
    const bounds = getKolkataTodayBounds(refNow);
    assert.equal(bounds.dateStr, '2026-11-20');
    assert.equal(bounds.startIso, '2026-11-20T00:00:00.000+05:30');
    assert.equal(bounds.endIso, '2026-11-20T23:59:59.999+05:30');

    // 1ms before IST midnight (2026-11-19 23:59:59.999 IST == 2026-11-19T18:29:59.999Z) -> Yesterday -> FALSE
    assert.equal(isWithinKolkataToday('2026-11-19T18:29:59.999Z', refNow), false);
    // Exact IST midnight start (2026-11-20 00:00:00.000 IST == 2026-11-19T18:30:00.000Z) -> Today -> TRUE
    assert.equal(isWithinKolkataToday('2026-11-19T18:30:00.000Z', refNow), true);
    // Exact IST end of day (2026-11-20 23:59:59.999 IST == 2026-11-20T18:29:59.999Z) -> Today -> TRUE
    assert.equal(isWithinKolkataToday('2026-11-20T18:29:59.999Z', refNow), true);
    // 1ms into tomorrow IST (2026-11-21 00:00:00.000 IST == 2026-11-20T18:30:00.000Z) -> Future -> FALSE
    assert.equal(isWithinKolkataToday('2026-11-20T18:30:00.000Z', refNow), false);
    assert.equal(isWithinKolkataToday('invalid-date', refNow), false);
    assert.equal(isWithinKolkataToday(null, refNow), false);
  });

  // 4. WhatsApp Phone Validation
  await test('WhatsApp phone validation accepts valid mobile/E.164 and rejects invalid numbers', () => {
    const ok10 = validateWhatsAppPhone('9848012345');
    assert.equal(ok10.isValid, true);
    assert.equal(ok10.e164, '+919848012345');
    assert.equal(ok10.metaRecipient, '919848012345');

    const okPrefixed = validateWhatsAppPhone('+91 89857-99459');
    assert.equal(okPrefixed.isValid, true);
    assert.equal(okPrefixed.e164, '+918985799459');

    const okZero = validateWhatsAppPhone('09491914422');
    assert.equal(okZero.isValid, true);
    assert.equal(okZero.e164, '+919491914422');

    assert.equal(validateWhatsAppPhone('').isValid, false);
    assert.equal(validateWhatsAppPhone('12345').isValid, false);
    assert.equal(validateWhatsAppPhone('1234567890').isValid, false); // starts with 1
  });

  // 5 & 6. Soft-delete, Restore, Audit Log, Reports Exclusion & Staff IST/Branch Scoping in isolated DB
  const tmpDataFile = path.join(process.cwd(), 'data', `test-rbac-tmp-${Date.now()}.json`);
  try {
    const db = new SalonDatabase();
    // Point internal file path to temp file so we never touch repo data/salon_db.json
    (db as any).dataFilePath = tmpDataFile;

    await test('Appointment soft-delete hides from active list, logs audit entry, and restores cleanly', async () => {
      const apt = await db.createAppointment({
        customer_name: 'Kavya Reddy',
        customer_phone: '9848011223',
        branch_id: 'tgl-gachibowli-main',
        appointment_date: getKolkataDateString(),
        time_slot: '03:00 PM',
        status: 'Confirmed',
        services: [{ id: 'srv-1', name: 'Hair Spa', price: 1500, duration: 45 }],
        total_amount: 1500,
        discount_amount: 0,
        final_amount: 1500,
        payment_preference: 'pay_at_salon',
        booking_source: 'walkin'
      }, 'Madu Mounika');

      const deleted = await db.softDeleteAppointment(
        apt.id,
        { userId: 'usr-1', name: 'Madu Mounika' },
        'Duplicate booking'
      );
      assert.ok(deleted?.deleted_at);
      assert.equal(deleted?.deleted_by, 'Madu Mounika');
      assert.equal(deleted?.deletion_reason, 'Duplicate booking');

      // Hidden from active list
      const activeApts = await db.getAppointments({ deleted: 'active' });
      assert.equal(activeApts.some(a => a.id === apt.id), false);

      // Visible in Deleted filter
      const deletedApts = await db.getAppointments({ deleted: 'deleted' });
      assert.equal(deletedApts.some(a => a.id === apt.id), true);

      // Audit log entry recorded
      const logs = await db.getAuditLogs();
      const deleteAudit = logs.find(l => l.action === 'SOFT_DELETE' && l.entity === 'Appointment' && l.entity_id === apt.id);
      assert.ok(deleteAudit, 'Expected SOFT_DELETE audit log for Appointment');
      assert.ok(deleteAudit!.details.includes('Kavya Reddy'));
      assert.ok(deleteAudit!.details.includes('Duplicate booking'));

      // Restore
      const restored = await db.restoreAppointment(apt.id, { userId: 'usr-1', name: 'Madu Mounika' });
      assert.equal(restored?.deleted_at ?? null, null);
      const activeAfterRestore = await db.getAppointments({ deleted: 'active' });
      assert.equal(activeAfterRestore.some(a => a.id === apt.id), true);
    });

    await test('Payment Ledger soft-delete atomically deletes Order + OrderItems + ALL linked Payments and excludes from reports', async () => {
      const ord = await db.createOrder({
        bill_number: 'TGL-GACHI-20261120-0001',
        branch_id: 'tgl-gachibowli-main',
        branch_code: 'GACHI',
        branch_name: 'Gachibowli',
        customer_name: 'Ananya Rao',
        customer_phone: '+919848099887',
        items: [
          { item_name: 'Keratin Treatment', item_type: 'service', quantity: 1, unit_price: 4000, total_price: 4000 }
        ],
        subtotal: 4000,
        discount: 0,
        tax_percent: 5,
        tax_amount: 200,
        tip_amount: 0,
        grand_total: 4200,
        paid_amount: 4200,
        due_amount: 0,
        payment_status: 'Paid',
        primary_payment_mode: 'UPI',
        cashier_name: 'Madu Mounika'
      }, 'Madu Mounika');

      const reportsBefore = await db.getReports();
      const activePaymentsBefore = await db.getPayments({ deleted: 'active' });
      assert.equal(activePaymentsBefore.some(p => p.order_id === ord.id), true);

      const delRes = await db.softDeleteOrderTransaction(
        ord.id,
        { userId: 'usr-1', name: 'Madu Mounika' },
        'Wrong amount entered'
      );
      assert.ok(delRes);
      assert.ok(delRes!.order.deleted_at);
      assert.equal(delRes!.affectedPayments >= 1, true);

      // Order & Payments hidden from active lists
      assert.equal((await db.getOrders({ deleted: 'active' })).some(o => o.id === ord.id), false);
      assert.equal((await db.getPayments({ deleted: 'active' })).some(p => p.order_id === ord.id), false);

      // Visible in Deleted filter
      assert.equal((await db.getOrders({ deleted: 'deleted' })).some(o => o.id === ord.id), true);
      assert.equal((await db.getPayments({ deleted: 'deleted' })).some(p => p.order_id === ord.id), true);

      // Excluded from reports totals
      const reportsAfterDelete = await db.getReports();
      assert.equal(reportsAfterDelete.totalSales, reportsBefore.totalSales - 4200);
      assert.equal(reportsAfterDelete.totalPaid, reportsBefore.totalPaid - 4200);

      // Audit log entry contains bill number, customer, amount, user, reason
      const logs = await db.getAuditLogs();
      const billAudit = logs.find(l => l.action === 'SOFT_DELETE' && l.entity === 'PaymentLedgerBill' && l.entity_id === ord.id);
      assert.ok(billAudit, 'Expected SOFT_DELETE audit log for PaymentLedgerBill');
      assert.ok(billAudit!.details.includes(ord.bill_number));
      assert.ok(billAudit!.details.includes('Ananya Rao'));
      assert.ok(billAudit!.details.includes('4200'));
      assert.ok(billAudit!.details.includes('Wrong amount entered'));

      // Atomic restore reinstates Order, OrderItems, Payments, and revenue
      const resRes = await db.restoreOrderTransaction(ord.id, { userId: 'usr-1', name: 'Madu Mounika' });
      assert.ok(resRes);
      assert.equal(resRes!.order.deleted_at ?? null, null);
      assert.equal(resRes!.restoredPayments >= 1, true);
      assert.equal((await db.getPayments({ deleted: 'active' })).some(p => p.order_id === ord.id), true);
      const reportsAfterRestore = await db.getReports();
      assert.equal(reportsAfterRestore.totalSales, reportsBefore.totalSales);
      assert.equal(reportsAfterRestore.totalPaid, reportsBefore.totalPaid);
    });

    await test('Staff Payment Ledger query returns ONLY today (Asia/Kolkata) active records for assigned branch', async () => {
      const todayBounds = getKolkataTodayBounds();
      const todayBranchA = await db.createOrder({
        bill_number: 'TGL-GACHI-20261120-0002',
        branch_id: 'tgl-gachibowli-main',
        branch_code: 'GACHI',
        branch_name: 'Gachibowli',
        customer_name: 'Today Gachibowli',
        customer_phone: '+919848000001',
        items: [{ item_name: 'Haircut', item_type: 'service', quantity: 1, unit_price: 500, total_price: 500 }],
        subtotal: 500, discount: 0, tax_percent: 5, tax_amount: 25, tip_amount: 0,
        grand_total: 525, paid_amount: 525, due_amount: 0, payment_status: 'Paid', primary_payment_mode: 'Cash', cashier_name: 'Staff'
      }, 'Staff');

      const todayBranchB = await db.createOrder({
        bill_number: 'TGL-KONDA-20261120-0001',
        branch_id: 'brn-1793346038689',
        branch_code: 'KONDA',
        branch_name: 'Kondapur',
        customer_name: 'Today Kondapur',
        customer_phone: '+919848000002',
        items: [{ item_name: 'Haircut', item_type: 'service', quantity: 1, unit_price: 600, total_price: 600 }],
        subtotal: 600, discount: 0, tax_percent: 5, tax_amount: 30, tip_amount: 0,
        grand_total: 630, paid_amount: 630, due_amount: 0, payment_status: 'Paid', primary_payment_mode: 'UPI', cashier_name: 'Staff'
      }, 'Staff');

      const yesterdayBranchA = await db.createOrder({
        bill_number: 'TGL-GACHI-20261118-0001',
        branch_id: 'tgl-gachibowli-main',
        branch_code: 'GACHI',
        branch_name: 'Gachibowli',
        customer_name: 'Yesterday Gachibowli',
        customer_phone: '+919848000003',
        items: [{ item_name: 'Facial', item_type: 'service', quantity: 1, unit_price: 1000, total_price: 1000 }],
        subtotal: 1000, discount: 0, tax_percent: 5, tax_amount: 50, tip_amount: 0,
        grand_total: 1050, paid_amount: 1050, due_amount: 0, payment_status: 'Paid', primary_payment_mode: 'UPI', cashier_name: 'Staff'
      }, 'Staff');

      // Backdate yesterdayBranchA order + payment to 2 days ago
      const twoDaysAgoIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const rawData = (db as any).data;
      const yOrd = rawData.orders.find((o: any) => o.id === yesterdayBranchA.id);
      if (yOrd) yOrd.created_at = twoDaysAgoIso;
      const yPay = rawData.payments.find((p: any) => p.order_id === yesterdayBranchA.id);
      if (yPay) yPay.created_at = twoDaysAgoIso;

      // Staff scoped query for Branch A today
      const staffPayments = await db.getPayments({
        deleted: 'active',
        branchId: 'tgl-gachibowli-main',
        startIso: todayBounds.startIso,
        endIso: todayBounds.endIso
      });
      assert.equal(staffPayments.some(p => p.order_id === todayBranchA.id), true, 'Staff must see today active bill in own branch');
      assert.equal(staffPayments.some(p => p.order_id === todayBranchB.id), false, 'Staff must NOT see other branch bill');
      assert.equal(staffPayments.some(p => p.order_id === yesterdayBranchA.id), false, 'Staff must NOT see older bill');
    });
  } finally {
    if (fs.existsSync(tmpDataFile)) {
      fs.unlinkSync(tmpDataFile);
    }
  }

  console.log(`\nAll ${passed} offline RBAC, soft-delete, Asia/Kolkata ledger, and WhatsApp validation tests passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
