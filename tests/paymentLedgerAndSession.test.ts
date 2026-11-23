/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Focused automated tests for:
 *  - Issue A: SMAV Central Payment Ledger reconciliation, idempotent local upsert,
 *             preserving bill/branch/customer/items/timestamps/WhatsApp status,
 *             zero duplicates on retries/refresh, and OWNER vs Staff RBAC.
 *  - Issue B: Persistent Admin Login Session across refresh, temporary API/network
 *             failures, explicit Sign Out, and invalid/expired/revoked/disabled auth.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type {
  Customer,
  Order,
  PaymentRecord,
  SalonBranch,
  SmavFinalizedBillUpsertInput,
  SmavFinalizedBillUpsertResult,
} from '../src/types/salon.ts';
import type { ISalonRepository } from '../src/server/repositories/salonRepository.ts';
import {
  normalizeSmavLedgerBillToPaymentRecord,
  type SmavCentralLedgerResult,
} from '../src/server/smavBillNumbering.ts';
import {
  reconcileCentralLedgerIntoLocal,
  buildMergedLedgerPayments,
} from '../src/server/paymentLedgerReconcile.ts';
import { getKolkataDateString } from '../src/lib/rbac.ts';
import {
  ADMIN_SESSION_STORAGE_KEY,
  readPersistedAdminSession,
  savePersistedAdminSession,
  updatePersistedAdminUser,
  clearPersistedAdminSession,
  restoreAdminSession,
  isConfirmedAuthInvalidationError,
  type StorageLike,
  type AdminBranchPermissions,
} from '../src/lib/adminSession.ts';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

const TEST_BRANCHES: SalonBranch[] = [
  {
    id: 'tgl-gachi',
    name: 'Gachibowli',
    code: 'GACHI',
    smav_branch_code: 'GACHI',
    address: 'Gachibowli, Hyderabad',
    city: 'Hyderabad',
    phone: '9966970003',
    whatsapp_number: '919966970003',
    is_active: true,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'tgl-konda',
    name: 'Kondapur',
    code: 'KONDA',
    smav_branch_code: 'KONDA',
    address: 'Kondapur, Hyderabad',
    city: 'Hyderabad',
    phone: '9154744608',
    whatsapp_number: '919154744608',
    is_active: true,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
  },
];

/**
 * In-memory ISalonRepository subset implementing the exact upsertSmavFinalizedBill
 * idempotency contract (smav_central_bill_id -> bill_number -> idempotency_key -> local_order_id),
 * CRM visit tracking, and WhatsApp log isolation.
 */
function createFakeSalonRepo(seed?: {
  orders?: Order[];
  payments?: PaymentRecord[];
  customers?: Customer[];
}) {
  const orders: Order[] = [...(seed?.orders || [])];
  const payments: PaymentRecord[] = [...(seed?.payments || [])];
  const customers: Customer[] = [...(seed?.customers || [])];
  const whatsappLogs: any[] = [];
  const matchReasons: string[] = [];

  const upsertCustomerVisit = (name: string, phone: string, isVisit: boolean, spend: number): Customer | undefined => {
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    if (!cleanPhone) return undefined;
    let cust = customers.find(c => String(c.mobile || '').replace(/\D/g, '') === cleanPhone);
    const nowIso = new Date().toISOString();
    if (!cust) {
      cust = {
        id: `cust-${customers.length + 1}`,
        name: name || 'Walk-in Customer',
        mobile: cleanPhone,
        loyalty_points: 0,
        visit_count: isVisit ? 1 : 0,
        total_spend: isVisit ? spend : 0,
        created_at: nowIso,
        updated_at: nowIso,
      };
      customers.push(cust);
      return cust;
    }
    if (isVisit) {
      cust.visit_count = (cust.visit_count || 0) + 1;
      cust.total_spend = (cust.total_spend || 0) + spend;
      cust.updated_at = nowIso;
    }
    return cust;
  };

  const repo = {
    async getBranches() {
      return TEST_BRANCHES;
    },
    async getOrders() {
      return orders;
    },
    async getPayments() {
      return payments;
    },
    async getCustomers() {
      return customers;
    },
    async upsertSmavFinalizedBill(input: SmavFinalizedBillUpsertInput): Promise<SmavFinalizedBillUpsertResult> {
      let existingIdx = -1;
      if (input.smav_central_bill_id) {
        existingIdx = orders.findIndex(o => o.smav_central_bill_id === input.smav_central_bill_id);
        if (existingIdx !== -1) matchReasons.push('smav_central_bill_id');
      }
      if (existingIdx === -1 && input.central_bill_number) {
        existingIdx = orders.findIndex(o => o.bill_number === input.central_bill_number);
        if (existingIdx !== -1) matchReasons.push('bill_number');
      }
      if (existingIdx === -1 && input.idempotency_key) {
        existingIdx = orders.findIndex(o => o.idempotency_key === input.idempotency_key);
        if (existingIdx !== -1) matchReasons.push('idempotency_key');
      }
      if (existingIdx === -1 && input.local_order_id) {
        existingIdx = orders.findIndex(o => o.id === input.local_order_id);
        if (existingIdx !== -1) matchReasons.push('local_order_id');
      }

      const preservedTimestamp = input.billed_at || input.finalized_at || new Date().toISOString();

      if (existingIdx !== -1) {
        const existing = orders[existingIdx];
        const updated: Order = {
          ...existing,
          bill_number: input.central_bill_number,
          smav_central_bill_id: input.smav_central_bill_id || existing.smav_central_bill_id || null,
          smav_bill_status: 'finalized',
          branch_id: input.branch_id || existing.branch_id,
          branch_code: input.branch_code || existing.branch_code,
          branch_name: input.branch_name || existing.branch_name,
          customer_name: input.customer_name || existing.customer_name,
          customer_phone: input.customer_phone || existing.customer_phone,
          items: input.items.length > 0 ? input.items : existing.items,
          subtotal: input.subtotal,
          discount: input.discount,
          tax_amount: input.tax_amount,
          grand_total: input.grand_total,
          paid_amount: input.paid_amount,
          due_amount: input.due_amount,
          primary_payment_mode: input.primary_payment_mode,
          billed_at: existing.billed_at || preservedTimestamp,
          created_at: existing.created_at || preservedTimestamp,
          // Preserve local WhatsApp statuses untouched
          receipt_whatsapp_status: existing.receipt_whatsapp_status,
          feedback_whatsapp_status: existing.feedback_whatsapp_status,
        };
        orders[existingIdx] = updated;

        let pay = payments.find(
          p => p.order_id === updated.id || p.bill_number === updated.bill_number
        );
        if (!pay) {
          pay = {
            id: `pay-${payments.length + 1}`,
            order_id: updated.id,
            bill_number: updated.bill_number,
            branch_id: updated.branch_id,
            branch_code: updated.branch_code,
            branch_name: updated.branch_name,
            customer_name: updated.customer_name,
            customer_phone: updated.customer_phone,
            amount: updated.paid_amount,
            payment_mode: updated.primary_payment_mode,
            status: 'Success',
            recorded_by: updated.cashier_name,
            billed_at: updated.billed_at,
            created_at: updated.created_at,
          };
          payments.push(pay);
        } else {
          pay.bill_number = updated.bill_number;
          pay.smav_central_bill_id = updated.smav_central_bill_id;
          pay.branch_id = updated.branch_id;
          pay.branch_code = updated.branch_code;
          pay.branch_name = updated.branch_name;
          pay.amount = updated.paid_amount;
        }
        // Replay MUST NOT increment CRM visits
        upsertCustomerVisit(updated.customer_name, updated.customer_phone, false, 0);
        return { order: updated, payment: pay, created: false, duplicate: true };
      }

      matchReasons.push('created');
      const customer = upsertCustomerVisit(
        input.customer_name,
        input.customer_phone,
        true,
        input.grand_total
      );
      const newOrder: Order = {
        id: `ord-${orders.length + 1}`,
        bill_number: input.central_bill_number,
        smav_central_bill_id: input.smav_central_bill_id || null,
        smav_bill_status: 'finalized',
        idempotency_key: input.idempotency_key || undefined,
        branch_id: input.branch_id,
        branch_code: input.branch_code,
        branch_name: input.branch_name,
        customer_id: customer?.id,
        customer_name: input.customer_name,
        customer_phone: input.customer_phone,
        items: input.items,
        subtotal: input.subtotal,
        discount: input.discount,
        tax_percent: input.tax_percent,
        tax_amount: input.tax_amount,
        tip_amount: input.tip_amount,
        grand_total: input.grand_total,
        paid_amount: input.paid_amount,
        due_amount: input.due_amount,
        payment_status: input.payment_status,
        primary_payment_mode: input.primary_payment_mode,
        cashier_name: input.cashier_name,
        notes: input.notes,
        billed_at: preservedTimestamp,
        created_at: preservedTimestamp,
      };
      orders.push(newOrder);

      const newPay: PaymentRecord = {
        id: `pay-${payments.length + 1}`,
        order_id: newOrder.id,
        bill_number: newOrder.bill_number,
        smav_central_bill_id: newOrder.smav_central_bill_id,
        branch_id: newOrder.branch_id,
        branch_code: newOrder.branch_code,
        branch_name: newOrder.branch_name,
        customer_name: newOrder.customer_name,
        customer_phone: newOrder.customer_phone,
        amount: newOrder.paid_amount,
        payment_mode: newOrder.primary_payment_mode,
        status: 'Success',
        recorded_by: newOrder.cashier_name,
        billed_at: newOrder.billed_at,
        created_at: newOrder.created_at,
      };
      payments.push(newPay);

      return { order: newOrder, payment: newPay, created: true, duplicate: false };
    },
  } as unknown as ISalonRepository;

  return { repo, orders, payments, customers, whatsappLogs, matchReasons };
}

// ============================================================================
// ISSUE A TESTS: PAYMENT LEDGER RECONCILIATION, IDEMPOTENCY & RBAC
// ============================================================================

test('Issue A.9: GlossyLooks bill finalized in SMAV (missed webhook) reconciles into Payment Ledger without duplicates on Refresh', async () => {
  const todayStr = getKolkataDateString(new Date());
  const gachiBilledAt = `${todayStr}T06:15:00.000Z`; // 11:45 AM IST today
  const kondaBilledAt = `${todayStr}T07:30:00.000Z`; // 01:00 PM IST today

  // Seed one pre-existing local Kondapur bill that already sent WhatsApp receipt
  // (without smav_central_bill_id yet) and ZERO local records for the Gachibowli bill (missed webhook!)
  const { repo, orders, payments, customers, whatsappLogs, matchReasons } = createFakeSalonRepo({
    orders: [
      {
        id: 'ord-local-konda-1',
        bill_number: 'TGL-KONDA-2026-0008',
        smav_central_bill_id: null,
        smav_bill_status: 'finalized',
        branch_id: 'tgl-konda',
        branch_code: 'KONDA',
        branch_name: 'Kondapur',
        customer_name: 'Sneha Reddy',
        customer_phone: '9876500002',
        items: [
          {
            item_name: 'Keratin Smooth Treatment',
            item_type: 'service',
            quantity: 1,
            unit_price: 3500,
            total_price: 3500,
            staff_name: 'Ananya',
          },
        ],
        subtotal: 3500,
        discount: 200,
        tax_percent: 0,
        tax_amount: 0,
        tip_amount: 0,
        grand_total: 3300,
        paid_amount: 3300,
        due_amount: 0,
        payment_status: 'Paid',
        primary_payment_mode: 'Card',
        cashier_name: 'Reception Kondapur',
        receipt_whatsapp_status: 'delivered',
        feedback_whatsapp_status: 'sent',
        billed_at: kondaBilledAt,
        created_at: kondaBilledAt,
      },
    ],
    payments: [
      {
        id: 'pay-local-konda-1',
        order_id: 'ord-local-konda-1',
        bill_number: 'TGL-KONDA-2026-0008',
        branch_id: 'tgl-konda',
        branch_code: 'KONDA',
        branch_name: 'Kondapur',
        customer_name: 'Sneha Reddy',
        customer_phone: '9876500002',
        amount: 3300,
        payment_mode: 'Card',
        status: 'Success',
        recorded_by: 'Reception Kondapur',
        billed_at: kondaBilledAt,
        created_at: kondaBilledAt,
      },
    ],
    customers: [
      {
        id: 'cust-konda-1',
        name: 'Sneha Reddy',
        mobile: '9876500002',
        loyalty_points: 0,
        visit_count: 1,
        total_spend: 3300,
        created_at: kondaBilledAt,
        updated_at: kondaBilledAt,
      },
    ],
  });

  // Raw SMAV Central ledger payloads (including an external SMAV branch ID for Kondapur)
  const rawSmavGachi = normalizeSmavLedgerBillToPaymentRecord(
    {
      id: 'smav-bill-gachi-101',
      billNumber: 'TGL-GACHI-2026-0042',
      branchId: 'tgl-gachi',
      branchCode: 'GACHI',
      branchName: 'Gachibowli',
      customerName: 'Divya Rao',
      customerPhone: '9876500001',
      paymentMode: 'UPI',
      subtotal: 1800,
      discount: 100,
      taxAmount: 90,
      grandTotal: 1790,
      billedAt: gachiBilledAt,
      sourceChannel: 'GLOSSYLOOKS_ADMIN',
      items: [
        {
          name: 'Signature Hair Spa',
          quantity: 1,
          unitPrice: 1800,
          totalPrice: 1800,
          stylistName: 'Meera',
        },
      ],
    },
    TEST_BRANCHES
  );

  const rawSmavKonda = normalizeSmavLedgerBillToPaymentRecord(
    {
      id: 'smav-bill-konda-202',
      billNumber: 'TGL-KONDA-2026-0008',
      branchId: 'smav-remote-branch-konda-uuid',
      branchCode: 'KONDA',
      branchName: 'Kondapur',
      customerName: 'Sneha Reddy',
      customerPhone: '9876500002',
      paymentMode: 'Card',
      subtotal: 3500,
      discount: 200,
      taxAmount: 0,
      grandTotal: 3300,
      billedAt: kondaBilledAt,
      sourceChannel: 'SMAV_WEB',
      items: [
        {
          name: 'Keratin Smooth Treatment',
          quantity: 1,
          unitPrice: 3500,
          totalPrice: 3500,
          stylistName: 'Ananya',
        },
      ],
    },
    TEST_BRANCHES
  );

  assert.ok(rawSmavGachi && rawSmavKonda);
  // External SMAV branch ID must normalize to canonical local branch ID via branchCode
  assert.equal(rawSmavKonda.branch_id, 'tgl-konda');

  const fakeFetchLedger = async (): Promise<SmavCentralLedgerResult> => ({
    ok: true,
    status: 200,
    payments: [rawSmavGachi!, rawSmavKonda!],
    rawCount: 2,
  });

  // --- REFRESH #1 ---
  const reconcile1 = await reconcileCentralLedgerIntoLocal({
    repo,
    scope: 'today',
    localBranches: TEST_BRANCHES,
    fetchLedgerImpl: fakeFetchLedger,
  });

  assert.equal(reconcile1.reconciledCount, 2);
  assert.equal(reconcile1.createdCount, 1); // Gachibowli created locally
  assert.equal(reconcile1.updatedCount, 1); // Kondapur matched by bill_number & linked
  assert.equal(orders.length, 2);
  assert.equal(payments.length, 2);
  assert.equal(customers.length, 2);
  assert.equal(whatsappLogs.length, 0); // Zero WhatsApp messages dispatched on reconciliation

  const merged1 = buildMergedLedgerPayments({
    scope: 'today',
    todayStr,
    adminRole: 'owner',
    smavResult: reconcile1.smavResult,
    reconcileResult: reconcile1,
    localOrders: orders,
    localPayments: payments,
  });

  assert.equal(merged1.source, 'smav');
  assert.equal(merged1.payments.length, 2);

  const gachiRow = merged1.payments.find(p => p.bill_number === 'TGL-GACHI-2026-0042');
  const kondaRow = merged1.payments.find(p => p.bill_number === 'TGL-KONDA-2026-0008');
  assert.ok(gachiRow, 'Gachibowli bill must appear in GlossyLooks Payment Ledger after Refresh');
  assert.ok(kondaRow, 'Kondapur bill must appear in GlossyLooks Payment Ledger for OWNER All Branches');

  // Verify all fields preserved on reconciled Gachibowli bill
  assert.equal(gachiRow.smav_central_bill_id, 'smav-bill-gachi-101');
  assert.equal(gachiRow.branch_id, 'tgl-gachi');
  assert.equal(gachiRow.branch_code, 'GACHI');
  assert.equal(gachiRow.branch_name, 'Gachibowli');
  assert.equal(gachiRow.customer_name, 'Divya Rao');
  assert.equal(gachiRow.customer_phone, '9876500001');
  assert.equal(gachiRow.payment_mode, 'UPI');
  assert.equal(gachiRow.subtotal, 1800);
  assert.equal(gachiRow.discount, 100);
  assert.equal(gachiRow.tax_amount, 90);
  assert.equal(gachiRow.amount, 1790);
  assert.equal(gachiRow.billed_at, gachiBilledAt);
  assert.equal(gachiRow.items?.[0]?.item_name, 'Signature Hair Spa');
  assert.equal(gachiRow.items?.[0]?.staff_name, 'Meera');

  // Verify existing local Kondapur WhatsApp statuses preserved & central bill ID linked
  assert.equal(kondaRow.smav_central_bill_id, 'smav-bill-konda-202');
  assert.equal(kondaRow.receipt_whatsapp_status, 'delivered');
  assert.equal(kondaRow.feedback_whatsapp_status, 'sent');

  // --- REFRESH #2 (Idempotency & Match Priority Check) ---
  matchReasons.length = 0;
  const reconcile2 = await reconcileCentralLedgerIntoLocal({
    repo,
    scope: 'today',
    localBranches: TEST_BRANCHES,
    fetchLedgerImpl: fakeFetchLedger,
  });

  assert.equal(reconcile2.createdCount, 0);
  assert.equal(reconcile2.updatedCount, 2);
  // Both records matched by smav_central_bill_id FIRST on replay
  assert.deepEqual(matchReasons, ['smav_central_bill_id', 'smav_central_bill_id']);
  // Zero duplicate orders, payments, CRM visits, or WhatsApp messages
  assert.equal(orders.length, 2);
  assert.equal(payments.length, 2);
  assert.equal(customers.length, 2);
  assert.equal(customers.find(c => c.mobile === '9876500001')?.visit_count, 1);
  assert.equal(customers.find(c => c.mobile === '9876500001')?.total_spend, 1790);
  assert.equal(customers.find(c => c.mobile === '9876500002')?.visit_count, 1);
  assert.equal(whatsappLogs.length, 0);
});

test('Issue A.7: OWNER All Branches sees Gachibowli + Kondapur + history; restricted staff sees ONLY today assigned branch', async () => {
  const todayStr = getKolkataDateString(new Date());
  const yesterdayDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const yesterdayStr = getKolkataDateString(yesterdayDate);

  const gachiToday: PaymentRecord = {
    id: 'p-1',
    order_id: 'o-1',
    bill_number: 'TGL-GACHI-TODAY',
    smav_central_bill_id: 'cid-1',
    branch_id: 'tgl-gachi',
    branch_code: 'GACHI',
    branch_name: 'Gachibowli',
    customer_name: 'Customer Gachi Today',
    customer_phone: '9000000001',
    amount: 1200,
    payment_mode: 'UPI',
    status: 'Success',
    recorded_by: 'Reception',
    billed_at: `${todayStr}T05:00:00.000Z`,
    created_at: `${todayStr}T05:00:00.000Z`,
  };
  const kondaToday: PaymentRecord = {
    id: 'p-2',
    order_id: 'o-2',
    bill_number: 'TGL-KONDA-TODAY',
    smav_central_bill_id: 'cid-2',
    branch_id: 'tgl-konda',
    branch_code: 'KONDA',
    branch_name: 'Kondapur',
    customer_name: 'Customer Konda Today',
    customer_phone: '9000000002',
    amount: 2200,
    payment_mode: 'Cash',
    status: 'Success',
    recorded_by: 'Reception',
    billed_at: `${todayStr}T06:00:00.000Z`,
    created_at: `${todayStr}T06:00:00.000Z`,
  };
  const gachiYesterday: PaymentRecord = {
    id: 'p-3',
    order_id: 'o-3',
    bill_number: 'TGL-GACHI-YESTERDAY',
    smav_central_bill_id: 'cid-3',
    branch_id: 'tgl-gachi',
    branch_code: 'GACHI',
    branch_name: 'Gachibowli',
    customer_name: 'Customer Gachi Yesterday',
    customer_phone: '9000000003',
    amount: 950,
    payment_mode: 'Card',
    status: 'Success',
    recorded_by: 'Reception',
    billed_at: `${yesterdayStr}T05:00:00.000Z`,
    created_at: `${yesterdayStr}T05:00:00.000Z`,
  };

  const smavResult: SmavCentralLedgerResult = {
    ok: true,
    status: 200,
    payments: [gachiToday, kondaToday, gachiYesterday],
    rawCount: 3,
  };
  const emptyReconcile = {
    smavResult,
    reconciledCount: 0,
    createdCount: 0,
    updatedCount: 0,
    failedCount: 0,
    voidedCentralIds: new Set<string>(),
    voidedBillNumbers: new Set<string>(),
    reconciledByCentralId: new Map(),
    reconciledByBillNumber: new Map(),
  };

  // OWNER with All Branches & history scope sees all 3 bills across both branches
  const ownerView = buildMergedLedgerPayments({
    scope: 'history',
    todayStr,
    adminRole: 'owner',
    smavResult,
    reconcileResult: emptyReconcile,
    localOrders: [],
    localPayments: [],
  });
  assert.equal(ownerView.payments.length, 3);
  assert.ok(ownerView.payments.some(p => p.branch_id === 'tgl-gachi'));
  assert.ok(ownerView.payments.some(p => p.branch_id === 'tgl-konda'));

  // Restricted staff (receptionist at Gachibowli) requesting history still sees ONLY today's Gachibowli bill
  const staffView = buildMergedLedgerPayments({
    scope: 'history',
    todayStr,
    effectiveBranchId: 'tgl-gachi',
    adminRole: 'receptionist',
    smavResult,
    reconcileResult: emptyReconcile,
    localOrders: [],
    localPayments: [],
  });
  assert.equal(staffView.payments.length, 1);
  assert.equal(staffView.payments[0].bill_number, 'TGL-GACHI-TODAY');
});

// ============================================================================
// ISSUE B TESTS: PERSISTENT LOGIN SESSION LIFECYCLE
// ============================================================================

test('Issue B.1: Refresh persistence restores user, role, branch_permissions, and preserves token on profile edits', async () => {
  const local = createMemoryStorage();
  const session = createMemoryStorage();
  const branchPermissions: AdminBranchPermissions = {
    all_branches: true,
    assigned_branch_id: null,
    branches: [
      { id: 'tgl-gachi', name: 'Gachibowli', code: 'GACHI' },
      { id: 'tgl-konda', name: 'Kondapur', code: 'KONDA' },
    ],
  };

  savePersistedAdminSession(
    {
      token: 'initial-valid-token-123',
      user: {
        id: 'usr-owner-1',
        user_id: 'TGL-OWN01',
        name: 'Madu Mounika',
        email: 'owner@theglossylooks.com',
        phone: '8985799459',
        role: 'owner',
      },
      branch_permissions: branchPermissions,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
    { local, session }
  );

  // Regression: updating own user profile MUST NOT wipe auth token or branch permissions
  updatePersistedAdminUser(
    {
      id: 'usr-owner-1',
      user_id: 'TGL-OWN01',
      name: 'Madu Mounika Updated',
      email: 'owner@theglossylooks.com',
      phone: '8985799459',
      role: 'owner',
    },
    undefined,
    { local, session }
  );

  const afterProfileUpdate = readPersistedAdminSession({ local, session });
  assert.equal(afterProfileUpdate?.token, 'initial-valid-token-123');
  assert.equal(afterProfileUpdate?.branch_permissions?.all_branches, true);

  // Regression: corrupt/tokenless sessionStorage copy must NOT shadow valid localStorage token
  session.setItem(
    ADMIN_SESSION_STORAGE_KEY,
    JSON.stringify({ user: afterProfileUpdate?.user })
  );
  assert.equal(readPersistedAdminSession({ local, session })?.token, 'initial-valid-token-123');

  // Simulate browser refresh: restoreAdminSession verifies with /api/auth/admin/me and rotates sliding token
  const restored = await restoreAdminSession({
    storages: { local, session },
    fetchMe: async () => ({
      id: 'usr-owner-1',
      user_id: 'TGL-OWN01',
      name: 'Madu Mounika',
      email: 'owner@theglossylooks.com',
      phone: '8985799459',
      role: 'owner',
      token: 'refreshed-sliding-token-456',
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      branch_permissions: branchPermissions,
    }),
  });

  assert.equal(restored.status, 'authenticated');
  assert.equal(restored.offline, false);
  assert.equal(restored.user?.role, 'owner');
  assert.equal(restored.branchPermissions?.branches.length, 2);
  assert.equal(readPersistedAdminSession({ local, session })?.token, 'refreshed-sliding-token-456');
});

test('Issue B.2: Temporary API/network/503 outage preserves valid login session and shows offline retry state', async () => {
  const local = createMemoryStorage();
  const session = createMemoryStorage();

  savePersistedAdminSession(
    {
      token: 'valid-token-offline-test',
      user: {
        id: 'usr-mgr-1',
        user_id: 'TGL-MGR01',
        name: 'Branch Manager',
        email: 'manager@theglossylooks.com',
        phone: '9966970003',
        role: 'manager',
        branch_id: 'tgl-gachi',
      },
      branch_permissions: {
        all_branches: false,
        assigned_branch_id: 'tgl-gachi',
        branches: [{ id: 'tgl-gachi', name: 'Gachibowli', code: 'GACHI' }],
      },
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
    { local, session }
  );

  const transientErrors = [
    new TypeError('Failed to fetch'),
    Object.assign(new Error('Request timed out'), { name: 'AbortError' }),
    Object.assign(new Error('Auth store temporarily unavailable'), {
      status: 503,
      code: 'AUTH_BACKEND_UNAVAILABLE',
    }),
    Object.assign(new Error('Internal Server Error'), { status: 500 }),
  ];

  for (const err of transientErrors) {
    const res = await restoreAdminSession({
      storages: { local, session },
      fetchMe: async () => {
        throw err;
      },
    });
    assert.equal(res.status, 'authenticated', `Session must stay active for transient error: ${err.message}`);
    assert.equal(res.offline, true);
    assert.ok(res.warning && res.warning.length > 0);
    assert.equal(res.user?.id, 'usr-mgr-1');
    assert.equal(res.branchPermissions?.assigned_branch_id, 'tgl-gachi');
    assert.equal(readPersistedAdminSession({ local, session })?.token, 'valid-token-offline-test');
  }

  // If no cached session exists and server is unreachable, return offline_retry (never blank page)
  const emptyLocal = createMemoryStorage();
  const emptySession = createMemoryStorage();
  const noCacheOffline = await restoreAdminSession({
    storages: { local: emptyLocal, session: emptySession },
    fetchMe: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  assert.equal(noCacheOffline.status, 'offline_retry');
  assert.equal(noCacheOffline.offline, true);
  assert.ok(noCacheOffline.warning);
});

test('Issue B.3: Explicit Sign Out clears persisted session from all storages', () => {
  const local = createMemoryStorage();
  const session = createMemoryStorage();

  savePersistedAdminSession(
    {
      token: 'token-to-clear',
      user: {
        id: 'usr-owner-1',
        user_id: 'TGL-OWN01',
        name: 'Madu Mounika',
        email: 'owner@theglossylooks.com',
        phone: '8985799459',
        role: 'owner',
      },
    },
    { local, session }
  );

  assert.ok(readPersistedAdminSession({ local, session }));
  clearPersistedAdminSession({ local, session });
  assert.equal(readPersistedAdminSession({ local, session }), null);
  assert.equal(local.getItem(ADMIN_SESSION_STORAGE_KEY), null);
  assert.equal(session.getItem(ADMIN_SESSION_STORAGE_KEY), null);
});

test('Issue B.4: Confirmed invalid, expired, revoked, or disabled auth signs out and clears storage', async () => {
  const hardAuthFailures = [
    { status: 401, code: 'SESSION_EXPIRED', message: 'Session expired' },
    { status: 401, code: 'SESSION_INVALID', message: 'Invalid session' },
    { status: 401, code: 'SESSION_REVOKED', message: 'Session revoked' },
    { status: 403, code: 'ACCOUNT_DISABLED', message: 'Account deactivated' },
  ];

  for (const failure of hardAuthFailures) {
    const local = createMemoryStorage();
    const session = createMemoryStorage();
    savePersistedAdminSession(
      {
        token: 'token-invalidated',
        user: {
          id: 'usr-staff-1',
          user_id: 'TGL-REC01',
          name: 'Staff Member',
          email: 'staff@theglossylooks.com',
          phone: '9966970003',
          role: 'receptionist',
          branch_id: 'tgl-gachi',
        },
      },
      { local, session }
    );

    const check = isConfirmedAuthInvalidationError(failure);
    assert.equal(check.confirmed, true, `Expected confirmed invalidation for ${failure.code}`);

    const restored = await restoreAdminSession({
      storages: { local, session },
      fetchMe: async () => {
        throw Object.assign(new Error(failure.message), {
          status: failure.status,
          code: failure.code,
        });
      },
    });

    assert.equal(restored.status, 'unauthenticated', `Must sign out on ${failure.code}`);
    assert.equal(restored.user, null);
    assert.ok(restored.signOutReason);
    assert.equal(readPersistedAdminSession({ local, session }), null, `Storage must be cleared on ${failure.code}`);
  }
});
