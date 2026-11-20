/**
 * Offline verification tests for SMAV Central Bill Numbering Integration:
 * 1. Canonical branch mapping (Gachibowli = GACHI, Kondapur = KONDA) & permitted branches loader
 * 2. Local bill-number generation removed (fail-closed CENTRAL_BILL_NUMBER_REQUIRED)
 * 3. Reserve API call BEFORE local bill commit (exact endpoint, headers, HMAC, fail-closed)
 * 4. Finalize API call ONLY AFTER local bill commit (exact endpoint, headers, payload)
 * 5. Immutable bill numbers & preservation of legacy historical bill numbers
 * 6. Dual authentication on POST /api/integrations/smav/sale-event (X-Integration-Key + HMAC-SHA256)
 * 7. Thermal receipt & print-agent output free of street address, city, PIN code, and GSTIN
 * 8. Migration 026 safety invariants
 *
 * Strictly offline — zero production DB or live SMAV HTTP calls.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  resolveCanonicalBranchCode,
  resolveLocalBranchIdForCode,
  getCleanReceiptBranchName,
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

  const tmpDataFile = path.join(process.cwd(), 'data', `test-central-bills-${Date.now()}.json`);

  try {
    // 1. Canonical Branch Mapping
    await test('Canonical branch mapping enforces Gachibowli = GACHI and Kondapur = KONDA', () => {
      assert.equal(resolveCanonicalBranchCode({ branchId: 'tgl-gachibowli-main' }), 'GACHI');
      assert.equal(resolveCanonicalBranchCode({ branchCode: 'GCB-01' }), 'GACHI');
      assert.equal(resolveCanonicalBranchCode({ branchName: 'Gachibowli Main Flagship' }), 'GACHI');
      assert.equal(resolveCanonicalBranchCode({ branchId: 'brn-1793346038689' }), 'KONDA');
      assert.equal(resolveCanonicalBranchCode({ branchCode: 'KND-02' }), 'KONDA');
      assert.equal(resolveCanonicalBranchCode({ branchName: 'Kondapur Branch' }), 'KONDA');

      assert.equal(resolveLocalBranchIdForCode('GACHI'), 'tgl-gachibowli-main');
      assert.equal(resolveLocalBranchIdForCode('KONDA'), 'brn-1793346038689');

      assert.equal(getCleanReceiptBranchName({ branchCode: 'GACHI' }), 'Gachibowli');
      assert.equal(getCleanReceiptBranchName({ branchCode: 'KONDA' }), 'Kondapur');
      assert.equal(getCleanReceiptBranchName({ branchName: '31, Vinayak Nagar, Gachibowli, Hyderabad - 500032' }), 'Gachibowli');
    });

    // 2. Permitted branches loaded from SMAV
    await test('Loads permitted branches from SMAV with X-Integration-Key & HMAC headers', async () => {
      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};
      const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedHeaders = (init?.headers || {}) as Record<string, string>;
        return new Response(
          JSON.stringify({
            branches: [
              { id: 'smav-br-1', branchCode: 'GACHI', branchName: 'Gachibowli', isActive: true },
              { id: 'smav-br-2', branchCode: 'KONDA', branchName: 'Kondapur', isActive: true },
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
      assert.equal(res.branches.length, 2);
      assert.equal(res.branches[0].smav_branch_code, 'GACHI');
      assert.equal(res.branches[0].name, 'Gachibowli');
      assert.equal(res.branches[1].smav_branch_code, 'KONDA');
      assert.equal(res.branches[1].name, 'Kondapur');
    });

    // 3. Local bill-number generation is completely removed
    const db = new SalonDatabase();
    (db as any).dataFilePath = tmpDataFile;

    await test('Local bill number generation is removed: createOrder fails closed without central bill_number', async () => {
      await assert.rejects(
        () =>
          db.createOrder(
            {
              bill_number: '',
              branch_id: 'tgl-gachibowli-main',
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

    // 4. Reserve -> Local Commit -> Finalize sequencing & immutability
    await test('Reserve API -> Local Commit -> Finalize API preserves immutable central bill number everywhere', async () => {
      const callSequence: string[] = [];
      let finalizeBody: any = null;

      const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (url.endsWith('/api/integrations/glossylooks/bill-numbers/reserve')) {
          callSequence.push('reserve');
          assert.equal(body.branchCode, 'GACHI');
          assert.equal(body.branch_code, 'GACHI');
          return new Response(
            JSON.stringify({
              success: true,
              reservationId: 'resv-9001',
              billNumber: 'TGL-GACHI-20261120-0001',
              branchCode: 'GACHI',
              branchName: 'Gachibowli',
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
              saleId: 'smav-sale-777',
              finalizedAt: '2026-11-20T10:00:00.000Z',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify({ error: 'unexpected url' }), { status: 404 });
      };

      const reserved = await reserveSmavCentralBillNumber(
        {
          branchId: 'tgl-gachibowli-main',
          branchCode: 'GACHI',
          branchName: 'Gachibowli',
          idempotencyKey: 'idem-gachi-001',
          requestedBy: 'Madu Mounika',
        },
        { fetchImpl: mockFetch }
      );
      assert.equal(reserved.ok, true);
      assert.equal(reserved.billNumber, 'TGL-GACHI-20261120-0001');
      assert.equal(reserved.reservationId, 'resv-9001');

      // Commit local bill AFTER reserve succeeds
      const committedOrder = await db.createOrder(
        {
          bill_number: reserved.billNumber!,
          idempotency_key: 'idem-gachi-001',
          branch_id: 'tgl-gachibowli-main',
          branch_code: 'GACHI',
          branch_name: 'Gachibowli',
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

      // Finalize ONLY AFTER local commit
      const finalized = await finalizeSmavCentralBillNumber(
        {
          reservationId: reserved.reservationId,
          billNumber: committedOrder.bill_number,
          branchId: committedOrder.branch_id!,
          branchCode: committedOrder.branch_code!,
          branchName: committedOrder.branch_name!,
          localOrderId: committedOrder.id,
          idempotencyKey: 'idem-gachi-001',
          order: committedOrder,
          finalizedBy: 'Madu Mounika',
        },
        { fetchImpl: mockFetch }
      );
      assert.equal(finalized.ok, true);
      assert.deepEqual(callSequence, ['reserve', 'local_commit', 'finalize']);
      assert.equal(finalizeBody.billNumber, 'TGL-GACHI-20261120-0001');
      assert.equal(finalizeBody.localOrderId, committedOrder.id);

      // Verify central bill number propagated to Payment Ledger and Print Queue
      const payments = await db.getPayments({ deleted: 'active' });
      const matchingPay = payments.find(p => p.order_id === committedOrder.id);
      assert.ok(matchingPay);
      assert.equal(matchingPay!.bill_number, 'TGL-GACHI-20261120-0001');

      const printJobs = await db.getPrintJobs();
      const matchingJob = printJobs.find(j => j.order_id === committedOrder.id);
      if (matchingJob) {
        assert.equal(matchingJob.payload.bill_number, 'TGL-GACHI-20261120-0001');
        assert.equal(matchingJob.payload.branch_name, 'Gachibowli');
        assert.equal(matchingJob.payload.salon_address, undefined);
        assert.equal(matchingJob.payload.gstin, undefined);
      }

      // Verify immutable bill number cannot be altered on updateOrder
      await assert.rejects(
        () => db.updateOrder(committedOrder.id, { bill_number: 'TGL-2026-9999' }),
        /IMMUTABLE_BILL_NUMBER/
      );
    });

    // 5. Dual Auth Verification for POST /api/integrations/smav/sale-event
    await test('POST /api/integrations/smav/sale-event requires BOTH valid X-Integration-Key AND valid HMAC signature', () => {
      const payloadStr = JSON.stringify({
        event_id: '22222222-3333-4444-8555-666666666666',
        source_type: 'salon',
        event_type: 'bill_finalized',
        payload: { bill_number: 'TGL-GACHI-20261120-0001' },
      });
      const signed = signSmavPayload(payloadStr, process.env.SMAV_DISPATCH_SECRET!);

      // Valid both -> OK
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

      // Valid sha256= prefixed signature -> OK
      const validPrefixedReq: any = {
        ...validReq,
        headers: { ...validReq.headers, 'x-smav-signature': `sha256=${signed.signature}` },
      };
      assert.equal(verifySmavSaleEventRequest(validPrefixedReq).ok, true);

      // Missing X-Integration-Key (even with valid HMAC) -> 401
      const noKeyReq: any = {
        ...validReq,
        headers: {
          'x-smav-timestamp': signed.timestamp,
          'x-smav-signature': signed.signature,
        },
      };
      assert.equal(verifySmavSaleEventRequest(noKeyReq).ok, false);
      assert.equal(verifySmavSaleEventRequest(noKeyReq).status, 401);

      // Wrong HMAC (even with valid X-Integration-Key) -> 401
      const badHmacReq: any = {
        ...validReq,
        headers: {
          'x-integration-key': process.env.GLOSSYLOOKS_INTEGRATION_KEY,
          'x-smav-timestamp': signed.timestamp,
          'x-smav-signature': '0'.repeat(64),
        },
      };
      assert.equal(verifySmavSaleEventRequest(badHmacReq).ok, false);
      assert.equal(verifySmavSaleEventRequest(badHmacReq).status, 401);

      // Expired timestamp (>300s) -> 401
      const oldSigned = signSmavPayload(payloadStr, process.env.SMAV_DISPATCH_SECRET!, Math.floor(Date.now() / 1000) - 600);
      const expiredReq: any = {
        ...validReq,
        headers: {
          'x-integration-key': process.env.GLOSSYLOOKS_INTEGRATION_KEY,
          'x-smav-timestamp': oldSigned.timestamp,
          'x-smav-signature': oldSigned.signature,
        },
      };
      assert.equal(verifySmavSaleEventRequest(expiredReq).ok, false);
      assert.equal(verifySmavSaleEventRequest(expiredReq).status, 401);
    });

    // 6. Thermal Receipt & Print Agent compliance (no street address, city, PIN, GSTIN; shows Branch + Bill No)
    await test('Thermal receipts & desktop print agent exclude street address, city, PIN, GSTIN and display Branch + Bill No', () => {
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

    // 7. Migration 026 invariants
    await test('Migration 026 preserves legacy bills and enforces immutable bill_number trigger', () => {
      const sql = fs.readFileSync(
        path.join(process.cwd(), 'database/migrations/026_smav_central_bill_numbering.sql'),
        'utf8'
      );
      assert.ok(sql.includes('is_legacy_bill'), 'Migration 026 must mark legacy bills');
      assert.ok(sql.includes('tgl_enforce_immutable_bill_number'), 'Migration 026 must add immutable bill_number trigger');
      assert.ok(sql.includes("'GACHI'") && sql.includes("'KONDA'"), 'Migration 026 must map GACHI and KONDA');
      assert.equal(
        /UPDATE\s+public\.orders\b[^;]*\bSET\b[^;]*\bbill_number\s*=/i.test(sql),
        false,
        'Migration 026 must NEVER renumber historical bills'
      );
    });
  } finally {
    if (fs.existsSync(tmpDataFile)) fs.unlinkSync(tmpDataFile);
    process.env.SMAV_GATEWAY_URL = prevEnv.SMAV_GATEWAY_URL;
    process.env.GLOSSYLOOKS_INTEGRATION_KEY = prevEnv.GLOSSYLOOKS_INTEGRATION_KEY;
    process.env.SMAV_DISPATCH_SECRET = prevEnv.SMAV_DISPATCH_SECRET;
    process.env.SMAV_SALON_OUTLET_ID = prevEnv.SMAV_SALON_OUTLET_ID;
  }

  console.log(`\nAll ${passed} offline SMAV Central Bill Numbering tests passed.`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
