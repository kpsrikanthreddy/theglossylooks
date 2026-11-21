/**
 * Offline verification tests for Dynamic SMAV Branch Architecture & Central Bill Numbering:
 * 1. Migration 026 & 027 safety invariants (public.salon_branches only, legacy mapping, ref checks before delete, no renumbering)
 * 2. Dynamic SMAV branch loader: no duplicate active dropdown entries, disabled branch filtering vs historical preservation, fail-closed on error
 * 3. POS branch selection rules (1 active -> auto-select, >1 -> mandatory selection, 0 -> block billing)
 * 4. Local bill-number generation removed (fail-closed CENTRAL_BILL_NUMBER_REQUIRED)
 * 5. Reserve -> Local Commit -> Finalize sequencing with a brand-new dynamic future branch (zero code changes)
 * 6. Dual authentication on POST /api/integrations/smav/sale-event (GLOSSYLOOKS_INTEGRATION_KEY + SMAV_DISPATCH_SECRET rawBody HMAC)
 * 7. central_bill_finalized webhook idempotency & replay protection + immediate Payment Ledger visibility
 * 8. Thermal receipt & desktop print agent compliance (dynamic branch, no street address/city/PIN/GSTIN)
 * 9. Static source scan asserting ZERO hard-coded branch IDs/names/codes/fallbacks in server.ts, src/, print-agent/
 *
 * Strictly offline — zero production DB writes or live SMAV HTTP calls.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  resolveCanonicalBranchCode,
  resolveLocalBranchIdForCode,
  getCleanReceiptBranchName,
  normalizeDynamicSmavBranches,
  fetchSmavPermittedBranches,
  reserveSmavCentralBillNumber,
  finalizeSmavCentralBillNumber,
  signSmavPayload,
  verifySmavSaleEventRequest,
} from '../src/server/smavBillNumbering';
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

function collectSourceFiles(dir: string, exts = ['.ts', '.tsx']): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full, exts));
    } else if (exts.some(ext => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/** Pure mirror of POS branch selection rules implemented in AdminPortal.tsx */
function resolvePosSelectionState(
  activeAuthorizedBranches: Array<{ id: string; is_active: boolean; is_authorized?: boolean }>,
  prevSelectedBranchId = ''
): { selectedBranchId: string; billingBlocked: boolean; requiresExplicitSelection: boolean } {
  const eligible = activeAuthorizedBranches.filter(b => b.is_active !== false && b.is_authorized !== false);
  if (eligible.length === 0) {
    return { selectedBranchId: '', billingBlocked: true, requiresExplicitSelection: false };
  }
  if (eligible.length === 1) {
    return { selectedBranchId: eligible[0].id, billingBlocked: false, requiresExplicitSelection: false };
  }
  const preserved = prevSelectedBranchId && eligible.some(b => b.id === prevSelectedBranchId) ? prevSelectedBranchId : '';
  return { selectedBranchId: preserved, billingBlocked: false, requiresExplicitSelection: !preserved };
}

async function run() {
  const prevEnv = {
    SMAV_GATEWAY_URL: process.env.SMAV_GATEWAY_URL,
    GLOSSYLOOKS_INTEGRATION_KEY: process.env.GLOSSYLOOKS_INTEGRATION_KEY,
    SMAV_DISPATCH_SECRET: process.env.SMAV_DISPATCH_SECRET,
    SMAV_SALON_OUTLET_ID: process.env.SMAV_SALON_OUTLET_ID,
  };

  process.env.SMAV_GATEWAY_URL = 'https://smav-test.example.internal';
  process.env.GLOSSYLOOKS_INTEGRATION_KEY = 'test_glossy_integration_key_1234567890';
  process.env.SMAV_DISPATCH_SECRET = 'test_smav_dispatch_secret_at_least_32_characters_long';
  process.env.SMAV_SALON_OUTLET_ID = '11111111-2222-4333-8444-555555555555';

  try {
    // 1. Migration 026 & 027 invariants (public.salon_branches ONLY, explicit allow-list, no tenant updates, no deletes, outlet-scoped uniqueness)
    await test('Migration 026 & 027 enforce public.salon_branches only, explicit branch_id allow-list, no tenant updates, no deletes, and outlet-scoped code uniqueness', () => {
      const sql026 = fs.readFileSync(
        path.join(process.cwd(), 'database/migrations/026_smav_central_bill_numbering.sql'),
        'utf8'
      );
      const sql027 = fs.readFileSync(
        path.join(process.cwd(), 'database/migrations/027_smav_central_bill_finalized_receiver.sql'),
        'utf8'
      );

      // Strip SQL line comments before checking executable SQL
      const sql026NoComments = sql026.replace(/--.*$/gm, '');
      const sql027NoComments = sql027.replace(/--.*$/gm, '');
      assert.equal(/\bpublic\.branches\b/i.test(sql026NoComments), false, 'Migration 026 must NEVER reference public.branches');
      assert.equal(/\bpublic\.branches\b/i.test(sql027NoComments), false, 'Migration 027 must NEVER reference public.branches');
      assert.ok(sql026NoComments.includes('public.salon_branches'), 'Migration 026 must use public.salon_branches');
      assert.ok(sql027NoComments.includes('public.salon_branches'), 'Migration 027 must use public.salon_branches');

      // Explicit allow-list only; ZERO generic updates to tenant/business or generic branch text columns
      assert.ok(sql027NoComments.includes('v_allowed_branch_id_tables'), 'Migration 027 must use an explicit allow-list of verified branch_id tables');
      for (const forbiddenCol of ['salon_id', 'business_id', 'tenant_id', 'default_branch_id']) {
        assert.equal(
          new RegExp(`\\b${forbiddenCol}\\b`, 'i').test(sql027NoComments),
          false,
          `Migration 027 executable SQL must NEVER touch ${forbiddenCol}`
        );
      }
      assert.equal(/\bprint_devices\b/i.test(sql027NoComments), false, 'Migration 027 must NEVER touch print_devices.branch');
      assert.equal(/\bwhatsapp_integrations\b/i.test(sql027NoComments), false, 'Migration 027 must NEVER touch whatsapp_integrations.salon_id');
      assert.equal(
        /\bSET\s+outlet_id\s*=/i.test(sql027NoComments),
        false,
        'Migration 027 must NEVER overwrite outlet_id'
      );

      // Legacy -> canonical standardization in Migration 027 (non-destructive; NO deletes)
      assert.ok(sql027NoComments.includes('tgl-gachibowli-main'), 'Migration 027 must migrate legacy tgl-gachibowli-main');
      assert.ok(sql027NoComments.includes('tgl-gachi'), 'Migration 027 must standardize canonical tgl-gachi');
      assert.ok(sql027NoComments.includes('brn-1793346038689'), 'Migration 027 must migrate legacy brn-1793346038689');
      assert.ok(sql027NoComments.includes('tgl-konda'), 'Migration 027 must standardize canonical tgl-konda');
      assert.equal(/\bDELETE\s+FROM\b/i.test(sql027NoComments), false, 'Migration 027 must NEVER delete rows (mark legacy branches inactive only)');
      assert.ok(sql027NoComments.includes('is_active = false'), 'Migration 027 must mark legacy/duplicate branches inactive');
      assert.ok(sql027NoComments.includes('RAISE NOTICE'), 'Migration 027 must log notices for migrated/deactivated branches');

      // Outlet-scoped branch code uniqueness (NOT global)
      assert.ok(sql027NoComments.includes('uq_salon_branches_outlet_active_smav_code'), 'Migration 027 must enforce outlet-scoped active smav_branch_code uniqueness');
      assert.ok(sql027NoComments.includes('uq_salon_branches_outlet_active_code'), 'Migration 027 must enforce outlet-scoped active code uniqueness');
      assert.equal(
        /CREATE\s+UNIQUE\s+INDEX[^;]*\buq_salon_branches_active_smav_code\b/i.test(sql027NoComments),
        false,
        'Migration 027 must NOT create a globally unique smav_branch_code index'
      );

      // Central bill metadata & indexes
      assert.ok(sql027NoComments.includes('smav_central_bill_id'), 'Migration 027 must add smav_central_bill_id');
      assert.ok(sql027NoComments.includes('uq_orders_central_bill_number'), 'Migration 027 must add unique central bill number index');
      assert.ok(sql027NoComments.includes('uq_payments_smav_central_bill_id'), 'Migration 027 must add unique SMAV payment index');

      // Never renumber finalized bills
      assert.equal(
        /UPDATE\s+public\.orders\b[^;]*\bSET\b[^;]*\bbill_number\s*=/i.test(sql026NoComments),
        false,
        'Migration 026 must NEVER renumber historical bills'
      );
      assert.equal(
        /UPDATE\s+public\.orders\b[^;]*\bSET\b[^;]*\bbill_number\s*=/i.test(sql027NoComments),
        false,
        'Migration 027 must NEVER renumber historical bills'
      );
    });

    // 2. Dynamic SMAV branch normalization: zero duplicates, disabled hidden from active POS list, preserved in allBranches
    await test('Dynamic SMAV branches deduplicate active options, hide disabled branches for new bills, and preserve historical metadata', async () => {
      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};
      const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedHeaders = (init?.headers || {}) as Record<string, string>;
        return new Response(
          JSON.stringify({
            branches: [
              { branch_id: 'tgl-alpha', branch_code: 'ALPHA', branch_name: 'Alpha Studio', is_active: true, is_authorized: true },
              // Duplicate entry with different casing — must NOT produce duplicate dropdown option
              { branch_id: 'tgl-alpha', branch_code: 'alpha', branch_name: 'Alpha Studio Branch', is_active: true, is_authorized: true },
              // Future dynamic branch — works with ZERO code changes
              { branch_id: 'tgl-jubilee', branch_code: 'JUBIL', branch_name: 'Jubilee Hills', is_active: true, is_authorized: true },
              // Disabled branch — hidden from POS active list, preserved in allBranches for historical ledger/reports
              { branch_id: 'tgl-legacy-closed', branch_code: 'CLOSD', branch_name: 'Closed Studio', is_active: false, is_authorized: true },
              // Unauthorized branch — excluded from active POS list
              { branch_id: 'tgl-restricted', branch_code: 'RSTRC', branch_name: 'Restricted Studio', is_active: true, is_authorized: false },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const res = await fetchSmavPermittedBranches({
        admin: { id: 'usr-1', role: 'owner', central_auth_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
        localBranches: [],
        fetchImpl: mockFetch,
      });

      assert.equal(res.source, 'smav');
      assert.ok(capturedUrl.startsWith('https://smav-test.example.internal/api/integrations/glossylooks/branches'));
      assert.equal(capturedHeaders['X-Integration-Key'], process.env.GLOSSYLOOKS_INTEGRATION_KEY);
      assert.equal(capturedHeaders['X-Business-Source'], 'glossylooks');
      assert.ok(capturedHeaders['X-SMAV-Timestamp']);
      assert.ok(capturedHeaders['X-SMAV-Signature']);

      // Strictly 2 active authorized deduplicated branches in POS dropdown
      assert.equal(res.branches.length, 2);
      assert.deepEqual(
        res.branches.map(b => `${b.id}:${b.name}:${b.smav_branch_code}`),
        ['tgl-alpha:Alpha Studio:ALPHA', 'tgl-jubilee:Jubilee Hills:JUBIL']
      );

      // Disabled branch preserved in allBranches for historical reporting/ledger
      const disabledHistorical = res.allBranches.find(b => b.id === 'tgl-legacy-closed');
      assert.ok(disabledHistorical, 'Disabled branch must remain preserved in allBranches');
      assert.equal(disabledHistorical!.is_active, false);

      // Direct unit check on normalizeDynamicSmavBranches + dynamic helpers
      const normalized = normalizeDynamicSmavBranches([
        { branch_id: 'tgl-banjara', branch_code: 'BANJA', branch_name: 'Banjara Hills Branch', is_active: true },
      ]);
      assert.equal(normalized.branches.length, 1);
      assert.equal(normalized.branches[0].name, 'Banjara Hills');
      assert.equal(resolveCanonicalBranchCode({ branchCode: 'BANJA' }), 'BANJA');
      assert.equal(
        resolveLocalBranchIdForCode('BANJA', [
          {
            id: 'tgl-banjara',
            name: 'Banjara Hills',
            code: 'BANJA',
            smav_branch_code: 'BANJA',
            address: '',
            city: '',
            phone: '',
            whatsapp_number: '',
            is_active: true,
            created_at: '',
            updated_at: '',
          },
        ]),
        'tgl-banjara'
      );
      assert.equal(getCleanReceiptBranchName({ branchName: 'Banjara Hills Branch', branchCode: 'BANJA' }), 'Banjara Hills');
    });

    // 3. SMAV branch API failure fails closed with ZERO hard-coded fallback branches
    await test('SMAV branch API failure returns empty branch list (smav_error) with zero hard-coded fallbacks', async () => {
      const failingFetch = async () => new Response('Service Unavailable', { status: 503 });
      const res = await fetchSmavPermittedBranches({
        admin: { id: 'usr-1', role: 'owner' },
        localBranches: [],
        fetchImpl: failingFetch,
      });
      assert.equal(res.source, 'smav_error');
      assert.equal(res.branches.length, 0);
      assert.ok(res.error && res.error.length > 0);
    });

    // 4. POS branch selection rules (1 -> auto-select, >1 -> mandatory, 0 -> block)
    await test('POS branch selection rules enforce auto-select (1), mandatory selection (>1), and block (0)', () => {
      const single = resolvePosSelectionState([{ id: 'tgl-jubilee', is_active: true, is_authorized: true }]);
      assert.equal(single.selectedBranchId, 'tgl-jubilee');
      assert.equal(single.billingBlocked, false);
      assert.equal(single.requiresExplicitSelection, false);

      const multi = resolvePosSelectionState([
        { id: 'tgl-alpha', is_active: true, is_authorized: true },
        { id: 'tgl-jubilee', is_active: true, is_authorized: true },
      ]);
      assert.equal(multi.selectedBranchId, '');
      assert.equal(multi.billingBlocked, false);
      assert.equal(multi.requiresExplicitSelection, true);

      const none = resolvePosSelectionState([
        { id: 'tgl-closed', is_active: false, is_authorized: true },
      ]);
      assert.equal(none.selectedBranchId, '');
      assert.equal(none.billingBlocked, true);
    });

    // 5. Local bill-number generation removed (strictly in-memory; never mutates data/salon_store.json)
    const db = new SalonDatabase();
    (db as any).save = () => {};

    await test('Local bill number generation is removed: createOrder fails closed without central bill_number', async () => {
      await assert.rejects(
        () =>
          db.createOrder(
            {
              bill_number: '',
              branch_id: 'tgl-jubilee',
              branch_code: 'JUBIL',
              branch_name: 'Jubilee Hills',
              customer_name: 'Test Client',
              customer_phone: '+919848012345',
              items: [{ item_name: 'Haircut', item_type: 'service', quantity: 1, unit_price: 500, total_price: 500 }],
              subtotal: 500,
              discount: 0,
              tax_percent: 5,
              tax_amount: 25,
              tip_amount: 0,
              grand_total: 525,
              paid_amount: 525,
              due_amount: 0,
              payment_status: 'Paid',
              primary_payment_mode: 'UPI',
            },
            'Cashier'
          ),
        /CENTRAL_BILL_NUMBER_REQUIRED/
      );
    });

    // 6. Reserve -> Local Commit -> Finalize sequencing with a future dynamic SMAV branch
    await test('Reserve API -> Local Commit -> Finalize API works dynamically for any future SMAV branch and enforces immutability', async () => {
      const callSequence: string[] = [];
      let finalizeBody: any = null;

      const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (url.endsWith('/api/integrations/glossylooks/bill-numbers/reserve')) {
          callSequence.push('reserve');
          assert.equal(body.branchCode, 'JUBIL');
          assert.equal(body.branch_code, 'JUBIL');
          return new Response(
            JSON.stringify({
              success: true,
              reservationId: 'resv-future-9001',
              billNumber: 'TGL-JUBIL-20261120-0001',
              branchCode: 'JUBIL',
              branchName: 'Jubilee Hills',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.endsWith('/api/integrations/glossylooks/bill-numbers/finalize')) {
          callSequence.push('finalize');
          finalizeBody = body;
          return new Response(
            JSON.stringify({
              success: true,
              billNumber: body.billNumber,
              reservationId: body.reservationId,
              saleId: 'smav-sale-jubil-777',
              finalizedAt: '2026-11-20T10:00:00.000Z',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify({ error: 'unexpected url' }), { status: 404 });
      };

      const reserved = await reserveSmavCentralBillNumber(
        {
          branchId: 'tgl-jubilee',
          branchCode: 'JUBIL',
          branchName: 'Jubilee Hills',
          idempotencyKey: 'idem-jubil-001',
          requestedBy: 'Madu Mounika',
        },
        { fetchImpl: mockFetch }
      );
      assert.equal(reserved.ok, true);
      assert.equal(reserved.billNumber, 'TGL-JUBIL-20261120-0001');

      const committedOrder = await db.createOrder(
        {
          bill_number: reserved.billNumber!,
          idempotency_key: 'idem-jubil-001',
          branch_id: 'tgl-jubilee',
          branch_code: 'JUBIL',
          branch_name: 'Jubilee Hills',
          smav_reservation_id: reserved.reservationId,
          smav_bill_status: 'reserved',
          is_legacy_bill: false,
          customer_name: 'Divya Sharma',
          customer_phone: '+919848055443',
          items: [{ item_name: 'Bridal Makeup', item_type: 'service', quantity: 1, unit_price: 5000, total_price: 5000 }],
          subtotal: 5000,
          discount: 0,
          tax_percent: 5,
          tax_amount: 250,
          tip_amount: 0,
          grand_total: 5250,
          paid_amount: 5250,
          due_amount: 0,
          payment_status: 'Paid',
          primary_payment_mode: 'UPI',
          cashier_name: 'Madu Mounika',
        },
        'Madu Mounika'
      );
      callSequence.push('local_commit');

      const finalized = await finalizeSmavCentralBillNumber(
        {
          reservationId: reserved.reservationId,
          billNumber: committedOrder.bill_number,
          branchId: committedOrder.branch_id!,
          branchCode: committedOrder.branch_code!,
          branchName: committedOrder.branch_name!,
          localOrderId: committedOrder.id,
          idempotencyKey: 'idem-jubil-001',
          order: committedOrder,
          finalizedBy: 'Madu Mounika',
        },
        { fetchImpl: mockFetch }
      );
      assert.equal(finalized.ok, true);
      assert.deepEqual(callSequence, ['reserve', 'local_commit', 'finalize']);
      assert.equal(finalizeBody.billNumber, 'TGL-JUBIL-20261120-0001');
      assert.equal(finalizeBody.localOrderId, committedOrder.id);

      const payments = await db.getPayments({ deleted: 'active' });
      const matchingPay = payments.find(p => p.order_id === committedOrder.id);
      assert.ok(matchingPay);
      assert.equal(matchingPay!.bill_number, 'TGL-JUBIL-20261120-0001');
      assert.equal(matchingPay!.branch_code, 'JUBIL');
      assert.equal(matchingPay!.branch_name, 'Jubilee Hills');

      await assert.rejects(
        () => db.updateOrder(committedOrder.id, { bill_number: 'TGL-2026-9999' }),
        /IMMUTABLE_BILL_NUMBER/
      );
    });

    // 7. Dual Auth Verification & strict SMAV_DISPATCH_SECRET + rawBody enforcement
    await test('POST /api/integrations/smav/sale-event enforces X-Integration-Key + SMAV_DISPATCH_SECRET rawBody HMAC and zero frontend secret leakage', () => {
      const payloadStr = JSON.stringify({
        event_id: '22222222-3333-4444-8555-666666666666',
        event_type: 'central_bill_finalized',
        outlet_code: 'glossylooks',
        payload: {
          central_bill_number: 'TGL-JUBIL-20261120-0009',
          branch_id: 'tgl-jubilee',
          branch_code: 'JUBIL',
          branch_name: 'Jubilee Hills',
        },
      });
      const signed = signSmavPayload(payloadStr, process.env.SMAV_DISPATCH_SECRET!);

      const validReq: any = {
        headers: {
          'x-integration-key': process.env.GLOSSYLOOKS_INTEGRATION_KEY,
          'x-smav-timestamp': signed.timestamp,
          'x-smav-signature': signed.signature,
        },
        rawBody: Buffer.from(payloadStr, 'utf8'),
        body: JSON.parse(payloadStr),
      };
      assert.equal(verifySmavSaleEventRequest(validReq).ok, true);

      // sha256= prefixed signature
      assert.equal(
        verifySmavSaleEventRequest({
          ...validReq,
          headers: { ...validReq.headers, 'x-smav-signature': `sha256=${signed.signature}` },
        }).ok,
        true
      );

      // Missing key -> 401
      const noKeyReq: any = {
        ...validReq,
        headers: { 'x-smav-timestamp': signed.timestamp, 'x-smav-signature': signed.signature },
      };
      assert.equal(verifySmavSaleEventRequest(noKeyReq).status, 401);

      // Wrong HMAC -> 401
      const badHmacReq: any = {
        ...validReq,
        headers: { ...validReq.headers, 'x-smav-signature': '0'.repeat(64) },
      };
      assert.equal(verifySmavSaleEventRequest(badHmacReq).status, 401);

      // Missing rawBody -> 401
      const noRawBodyReq: any = { headers: validReq.headers, body: JSON.parse(payloadStr) };
      assert.equal(verifySmavSaleEventRequest(noRawBodyReq).status, 401);

      // Expired timestamp (>300s) -> 401
      const oldSigned = signSmavPayload(payloadStr, process.env.SMAV_DISPATCH_SECRET!, Math.floor(Date.now() / 1000) - 600);
      assert.equal(
        verifySmavSaleEventRequest({
          ...validReq,
          headers: {
            'x-integration-key': process.env.GLOSSYLOOKS_INTEGRATION_KEY,
            'x-smav-timestamp': oldSigned.timestamp,
            'x-smav-signature': oldSigned.signature,
          },
        }).status,
        401
      );

      // Frontend React code must NEVER reference either server secret
      const frontendFiles = [
        ...collectSourceFiles(path.join(process.cwd(), 'src/components')),
        ...collectSourceFiles(path.join(process.cwd(), 'src/lib')),
        path.join(process.cwd(), 'src/App.tsx'),
      ];
      for (const file of frontendFiles) {
        const content = fs.readFileSync(file, 'utf8');
        for (const secretName of ['GLOSSYLOOKS_INTEGRATION_KEY', 'SMAV_DISPATCH_SECRET']) {
          assert.equal(content.includes(secretName), false, `${file} must never reference ${secretName}`);
        }
      }
    });

    // 8. central_bill_finalized replay idempotency & immediate Payment Ledger visibility (including future & disabled branches)
    await test('central_bill_finalized persists dynamic future branch bill idempotently and exposes it immediately in Payment Ledger', async () => {
      const centralBillNo = 'TGL-BANJA-20261120-0042';
      const centralBillId = 'smav-cb-banja-998877';
      const idemKey = 'smav-finalized-idem-banja-0042';
      const billedAt = '2026-11-20T11:30:00.000Z';

      const baseInput = {
        event_id: 'evt-finalized-banja-0042',
        central_bill_number: centralBillNo,
        smav_central_bill_id: centralBillId,
        smav_sale_id: centralBillId,
        idempotency_key: idemKey,
        branch_id: 'tgl-banjara',
        branch_code: 'BANJA',
        branch_name: 'Banjara Hills',
        customer_name: 'Ananya Reddy',
        customer_phone: '+919848099112',
        items: [
          {
            item_name: 'Keratin Hair Spa',
            item_type: 'service' as const,
            quantity: 1,
            unit_price: 2500,
            total_price: 2500,
            staff_name: 'Renuka',
          },
          {
            item_name: 'Global Hair Color',
            item_type: 'service' as const,
            quantity: 1,
            unit_price: 1500,
            total_price: 1500,
            staff_name: 'Swathi',
          },
        ],
        subtotal: 4000,
        discount: 200,
        tax_percent: 5,
        tax_amount: 190,
        tip_amount: 0,
        grand_total: 3990,
        paid_amount: 3990,
        due_amount: 0,
        payment_status: 'Paid' as const,
        primary_payment_mode: 'UPI' as const,
        transaction_ref: 'UPI-REF-4200',
        cashier_name: 'SMAV Desk',
        billed_at: billedAt,
        finalized_at: billedAt,
      };

      const first = await db.upsertSmavFinalizedBill(baseInput);
      assert.equal(first.created, true);
      assert.equal(first.duplicate, false);
      assert.equal(first.order.bill_number, centralBillNo);
      assert.equal(first.order.branch_id, 'tgl-banjara');
      assert.equal(first.order.branch_code, 'BANJA');
      assert.equal(first.order.branch_name, 'Banjara Hills');
      assert.equal(first.order.smav_central_bill_id, centralBillId);
      assert.equal(first.order.idempotency_key, idemKey);
      assert.equal(first.order.items.length, 2);

      // Lookup by central bill number MUST work via getOrderByBillNumber (never getOrderById)
      const lookedUp = await db.getOrderByBillNumber(centralBillNo);
      assert.ok(lookedUp);
      assert.equal(lookedUp!.id, first.order.id);
      assert.equal(await db.getOrderById(centralBillNo), null);

      // Replay with updated payment_mode -> zero duplicates across orders, items, payments, CRM visits
      const replay = await db.upsertSmavFinalizedBill({
        ...baseInput,
        event_id: 'evt-finalized-banja-0042-replay',
        primary_payment_mode: 'Card',
      });
      assert.equal(replay.created, false);
      assert.equal(replay.duplicate, true);
      assert.equal(replay.order.id, first.order.id);
      assert.equal(replay.order.bill_number, centralBillNo);
      assert.equal(replay.payment.id, first.payment.id);
      assert.equal(replay.payment.payment_mode, 'Card');

      const allOrdersForBill = (await db.getOrders({ deleted: 'all' })).filter(o => o.bill_number === centralBillNo);
      assert.equal(allOrdersForBill.length, 1, 'Replay must never create duplicate orders');
      assert.equal(allOrdersForBill[0].items.length, 2, 'Replay must never duplicate order_items');

      const allPaymentsForBill = (await db.getPayments({ deleted: 'active' })).filter(p => p.bill_number === centralBillNo);
      assert.equal(allPaymentsForBill.length, 1, 'Replay must never create duplicate payments');
      const ledgerRow = allPaymentsForBill[0];
      assert.equal(ledgerRow.bill_number, centralBillNo);
      assert.equal(ledgerRow.branch_id, 'tgl-banjara');
      assert.equal(ledgerRow.branch_code, 'BANJA');
      assert.equal(ledgerRow.branch_name, 'Banjara Hills');
      assert.equal(ledgerRow.customer_name, 'Ananya Reddy');
      assert.equal(ledgerRow.payment_mode, 'Card');
      assert.equal(ledgerRow.amount, 3990);
      assert.equal(ledgerRow.created_at, billedAt);
      assert.equal(ledgerRow.items?.length, 2);
      assert.equal(ledgerRow.items?.[0].item_name, 'Keratin Hair Spa');
      assert.equal(ledgerRow.items?.[0].staff_name, 'Renuka');

      const custAfterReplay = await db.getCustomerByMobile('9848099112');
      assert.equal(custAfterReplay!.visit_count, 1, 'Replay must never double-count CRM visits');
      assert.equal(custAfterReplay!.total_spend, 3990, 'Replay must never double-count CRM spend');

      // Server route static guards
      const serverSrc = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
      assert.equal(serverSrc.includes('getOrderById(centralBillNumber)'), false);
      assert.ok(serverSrc.includes('getOrderByBillNumber(centralBillNumber)'));
      assert.ok(serverSrc.includes("'central_bill_finalized'"));
      assert.ok(serverSrc.includes('Missing required dynamic branch metadata'));
    });

    // 9. Thermal receipt & print agent compliance
    await test('Thermal receipts & desktop print agent exclude street address, city, PIN, GSTIN and display dynamic Branch + Bill No', () => {
      const receiptSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/common/ThermalReceipt.tsx'), 'utf8');
      const printAgentSrc = fs.readFileSync(path.join(process.cwd(), 'print-agent/agent.ts'), 'utf8');

      for (const forbidden of ['Vinayak Nagar', 'Hyderabad', '500032', '500084', 'GSTIN', 'gstin', 'GST (5%)']) {
        assert.equal(receiptSrc.includes(forbidden), false, `ThermalReceipt.tsx must not contain "${forbidden}"`);
        assert.equal(printAgentSrc.includes(forbidden), false, `print-agent/agent.ts must not contain "${forbidden}"`);
      }

      assert.ok(receiptSrc.includes('Branch:'), 'ThermalReceipt.tsx must display Branch:');
      assert.ok(receiptSrc.includes('Bill No:'), 'ThermalReceipt.tsx must display Bill No:');
      assert.ok(printAgentSrc.includes('Branch:'), 'print-agent/agent.ts must print Branch:');
      assert.ok(printAgentSrc.includes('Bill No:'), 'print-agent/agent.ts must print Bill No:');
    });

    // 10. Static source scan: ZERO hard-coded branch IDs/names/codes or fallback arrays anywhere in source code
    await test('Static source check confirms ZERO hard-coded branch IDs, names, codes, or fallback lists in server.ts, src/, and print-agent/', () => {
      const sourceFiles = [
        path.join(process.cwd(), 'server.ts'),
        ...collectSourceFiles(path.join(process.cwd(), 'src')),
        ...collectSourceFiles(path.join(process.cwd(), 'print-agent')),
      ];

      const forbiddenTokens = [
        'tgl-gachi',
        'tgl-konda',
        'Gachibowli',
        'Kondapur',
        'GACHI',
        'KONDA',
        'tgl-gachibowli-main',
        'brn-1793346038689',
        'defaultBranchFallback',
        'defaultBranchesFallback',
        'defaultKondapurBranch',
        'CANONICAL_BRANCH_DIRECTORY',
        'local_fallback',
      ];

      const violations: string[] = [];
      for (const file of sourceFiles) {
        const content = fs.readFileSync(file, 'utf8');
        for (const token of forbiddenTokens) {
          if (content.includes(token)) {
            violations.push(`${path.relative(process.cwd(), file)} contains "${token}"`);
          }
        }
      }

      assert.deepEqual(violations, [], `Hard-coded branch references found:\n${violations.join('\n')}`);
    });
  } finally {
    process.env.SMAV_GATEWAY_URL = prevEnv.SMAV_GATEWAY_URL;
    process.env.GLOSSYLOOKS_INTEGRATION_KEY = prevEnv.GLOSSYLOOKS_INTEGRATION_KEY;
    process.env.SMAV_DISPATCH_SECRET = prevEnv.SMAV_DISPATCH_SECRET;
    process.env.SMAV_SALON_OUTLET_ID = prevEnv.SMAV_SALON_OUTLET_ID;
  }

  console.log(`\nAll ${passed} offline Dynamic SMAV Branch & Central Bill Numbering tests passed.`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
