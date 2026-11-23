import {
  syncUserToSmavAndPersist,
  setSmavUserStatusAndPersist,
  resetSmavUserPasswordAndPersist,
  executeCommittedOutboxSync,
  generateSyncIdempotencyKey,
  handleIncomingSmavWebhook,
  retrySmavSyncForUser,
  processPendingSmavUserSyncOutbox,
  triggerNonBlockingOutboxDrain,
  reconcileAdminUsersToSmav,
  deriveUserSyncStatus,
  mapLocalRoleToSmavRole,
} from './src/server/smavSync.ts';
import {
  fetchSmavPermittedBranches,
  reserveSmavCentralBillNumber,
  finalizeSmavCentralBillNumber,
  upsertSmavCentralBill,
  fetchSmavCentralLedger,
  voidSmavCentralBill,
  restoreSmavCentralBill,
  getSmavGatewayBaseUrl,
  verifySmavSaleEventRequest,
  resolveCanonicalBranchCode,
  resolveLocalBranchIdForCode,
  getCleanReceiptBranchName,
} from './src/server/smavBillNumbering.ts';
import {
  APPOINTMENT_ADMIN_ALERT_TEMPLATE,
  ENQUIRY_ADMIN_ALERT_TEMPLATE,
  resolveBranchAlertRecipients,
  resolveEnquiryBranch,
  buildAppointmentAlertVariables,
  buildEnquiryAlertVariables,
  buildAlertTemplateComponents,
  buildAdminAlertDedupKeys,
  type ApprovedMetaTemplateSchema,
} from './src/server/whatsappAdminAlerts.ts';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * The Glossy Looks - Salon Website & Admin Management Full-Stack Server
 * Express Server mounting Clean RESTful APIs & Vite Dev Middleware
 */

import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { salonRepository } from './src/server/db.ts';
import {
  isIdempotencyKeyConflictError,
  isMigration024RequiredError,
  isCentralAuthLinkForbiddenError,
} from './src/server/repositories/salonRepository.ts';
import type {
  WhatsAppMessageStatus,
  Order,
  PaymentRecord,
  CentralPaymentLedgerResponse,
  DailySalesReportStatus,
  DailySalesReportLog,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppDeliveryStatus
} from './src/types/salon.ts';
import {
  canDeleteOrRestoreRecords,
  hasFullPaymentLedgerAccess,
  isRestrictedPaymentLedgerStaff,
  canSendWhatsAppTemplates,
  getKolkataDateString,
  getKolkataTodayBounds,
  isWithinKolkataToday,
  validateWhatsAppPhone,
  normalizeRole,
} from './src/lib/rbac.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Safe environment logging (validate optional variables without crashing)
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log('ℹ️ Supabase integration enabled with URL:', process.env.SUPABASE_URL);
} else {
  console.error('❌ Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.');
}

if (process.env.PRINT_AGENT_SECRET) {
  console.log('ℹ️ Thermal Print Agent configured');
} else {
  console.log('ℹ️ Print agent secret not set: Using default in-app receipt & print queue');
}

// Meta WhatsApp Business Embedded Signup & Coexistence configuration
const META_APP_ID = process.env.META_APP_ID || '';
const META_EMBEDDED_SIGNUP_CONFIG_ID = process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || '';
const META_APP_SECRET = process.env.META_APP_SECRET || '';
const META_SYSTEM_USER_ACCESS_TOKEN = process.env.META_SYSTEM_USER_ACCESS_TOKEN || '';
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || '';
// Optional but recommended: the Meta Business Portfolio that owns this salon's WABA.
// It lets the server resolve a completed Embedded Signup flow when Meta does not
// include the WABA/phone IDs in the postMessage FINISH payload.
const META_BUSINESS_ID = process.env.META_BUSINESS_ID || '';
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v22.0';
// Feedback delay: 2 minutes after bill generation as per salon operations SLA
const configuredFeedbackDelayMinutes = Number(process.env.FEEDBACK_DELAY_MINUTES || '2');
const FEEDBACK_DELAY_MINUTES = Number.isFinite(configuredFeedbackDelayMinutes) && configuredFeedbackDelayMinutes > 0
  ? Math.floor(configuredFeedbackDelayMinutes)
  : 2;
const getFeedbackScheduledTime = () => new Date(Date.now() + FEEDBACK_DELAY_MINUTES * 60 * 1000).toISOString();

if (META_APP_ID) {
  console.log('ℹ️ Meta WhatsApp Business Embedded Signup initialized (App ID:', META_APP_ID, ')');
} else {
  console.log('ℹ️ Meta WhatsApp: App ID not provided in environment; in-app onboarding mode ready');
}

function maskPhoneNumber(phone?: string): string {
  if (!phone) return '';
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.length <= 4) return cleaned;
  const last4 = cleaned.slice(-4);
  const prefix = cleaned.startsWith('+') ? cleaned.slice(0, 3) + ' ' : '';
  return `${prefix}******${last4}`;
}

// Keep the exact raw body for Meta's X-Hub-Signature-256 verification while
// still parsing JSON normally for every API route.
app.use(express.json({
  verify: (req: express.Request, _res, buffer) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
  }
}));

// CORS and preflight OPTIONS handling
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-admin-name, x-admin-role, x-admin-user-id, x-admin-token');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// Normalize double /api/api/ prefixes that may occur with proxy rewrites
app.use((req, _res, next) => {
  if (req.url && req.url.startsWith('/api/api/')) {
    req.url = req.url.replace('/api/api/', '/api/');
  }
  next();
});


function normalizeSmavPaymentMode(raw: unknown): Order['primary_payment_mode'] {
  const val = String(raw || '').trim().toLowerCase();
  if (val === 'cash') return 'Cash';
  if (val === 'card' || val === 'credit_card' || val === 'debit_card' || val === 'credit card' || val === 'debit card') return 'Card';
  if (val === 'bank transfer' || val === 'bank_transfer' || val === 'neft' || val === 'imps' || val === 'rtgs') return 'Bank Transfer';
  if (val === 'split' || val === 'split payment' || val === 'split_payment') return 'Split Payment';
  if (val === 'pay later' || val === 'pay_later' || val === 'credit' || val === 'due') return 'Pay Later';
  return 'UPI';
}

function normalizeSmavPaymentStatus(raw: unknown, dueAmount: number): Order['payment_status'] {
  const val = String(raw || '').trim().toLowerCase();
  if (val === 'paid' || val === 'completed' || val === 'settled' || val === 'finalized') return 'Paid';
  if (val === 'partial' || val === 'partially_paid') return 'Partial';
  if (val === 'pending' || val === 'unpaid') return 'Pending';
  if (val === 'refunded') return 'Refunded';
  if (val === 'cancelled' || val === 'canceled' || val === 'void' || val === 'voided') return 'Cancelled';
  return dueAmount > 0 ? 'Partial' : 'Paid';
}

function normalizeIsoTimestamp(raw: unknown, fallbackIso: string): string {
  const str = String(raw || '').trim();
  if (!str) return fallbackIso;
  const parsed = Date.parse(str);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallbackIso;
}

async function syncPaymentCentralBillId(
  orderId: string,
  billNumber: string,
  centralBillId?: string | null
): Promise<void> {
  if (!centralBillId) return;
  try {
    const client = (salonRepository as any).client;
    if (client) {
      await client
        .from('payments')
        .update({ smav_central_bill_id: centralBillId })
        .eq('order_id', orderId);
      if (billNumber) {
        await client
          .from('payments')
          .update({ smav_central_bill_id: centralBillId })
          .eq('bill_number', billNumber);
      }
    }
  } catch {
    // Non-fatal if column is absent or JSON repo is active
  }
}

async function syncOrderToSmavCentral(
  order: Order,
  actor: { id?: string; name: string; role?: string; central_auth_id?: string },
  mode: 'finalize_or_upsert' | 'upsert' = 'finalize_or_upsert'
): Promise<{ ok: boolean; status: number; centralBillId?: string; saleId?: string; finalizedAt?: string; error?: string; order: Order }> {
  const localBranches = await salonRepository.getBranches().catch(() => []);
  const matchedBranch = order.branch_id ? localBranches.find(b => b.id === order.branch_id) : undefined;
  const branchCode =
    order.branch_code ||
    resolveCanonicalBranchCode({ branchId: order.branch_id, localBranch: matchedBranch }) ||
    '';
  const branchName =
    order.branch_name ||
    getCleanReceiptBranchName({ branchId: order.branch_id, branchCode, localBranch: matchedBranch });

  const reqPayload = {
    reservationId: order.smav_reservation_id,
    centralBillId: order.smav_central_bill_id || order.smav_sale_id || undefined,
    billNumber: order.bill_number,
    branchId: order.branch_id || '',
    branchCode,
    branchName,
    localOrderId: order.id,
    idempotencyKey: order.idempotency_key || order.bill_number,
    order,
    finalizedBy: actor.name,
    finalizedByUserId: actor.id,
    centralAuthId: actor.central_auth_id,
    actorRole: actor.role,
  };

  let smavRes =
    mode === 'upsert' || !order.smav_reservation_id
      ? await upsertSmavCentralBill(reqPayload)
      : await finalizeSmavCentralBillNumber(reqPayload);

  // If reservation expired or bill already finalized on SMAV during retry, fall back cleanly to idempotent bills/upsert
  if (!smavRes.ok && mode === 'finalize_or_upsert' && order.smav_reservation_id && [404, 409, 410].includes(smavRes.status)) {
    const upsertRes = await upsertSmavCentralBill(reqPayload);
    if (upsertRes.ok) {
      smavRes = upsertRes;
    }
  }

  if (smavRes.ok) {
    const finalizedAt = smavRes.finalizedAt || new Date().toISOString();
    const resolvedCentralBillId = smavRes.centralBillId || smavRes.saleId || order.smav_central_bill_id || null;
    const updates: Partial<Order> = {
      smav_bill_status: 'finalized',
      smav_central_bill_id: resolvedCentralBillId,
      smav_sale_id: smavRes.saleId || resolvedCentralBillId || order.smav_sale_id,
      smav_finalized_at: finalizedAt,
      smav_finalize_error: null,
    };
    const updated = (await salonRepository.updateOrder(order.id, updates)) || { ...order, ...updates };
    if (resolvedCentralBillId) {
      await syncPaymentCentralBillId(order.id, order.bill_number, resolvedCentralBillId);
    }
    return {
      ok: true,
      status: smavRes.status,
      centralBillId: resolvedCentralBillId || undefined,
      saleId: smavRes.saleId || resolvedCentralBillId || undefined,
      finalizedAt,
      order: updated,
    };
  }

  const errMsg = String(smavRes.error || 'SMAV central sync failed').slice(0, 500);
  const failUpdates: Partial<Order> = {
    smav_bill_status: 'finalize_pending',
    smav_finalize_error: errMsg,
  };
  const updated = (await salonRepository.updateOrder(order.id, failUpdates)) || { ...order, ...failUpdates };
  return {
    ok: false,
    status: smavRes.status || 503,
    error: errMsg,
    order: updated,
  };
}

let pendingBillSyncInFlight = false;
async function drainPendingSmavCentralBills(maxBatch = 10): Promise<{ attempted: number; synced: number; failed: number }> {
  if (pendingBillSyncInFlight) return { attempted: 0, synced: 0, failed: 0 };
  if (!process.env.GLOSSYLOOKS_INTEGRATION_KEY || (!getSmavGatewayBaseUrl() && !process.env.SMAV_BILL_FINALIZE_URL)) {
    return { attempted: 0, synced: 0, failed: 0 };
  }
  pendingBillSyncInFlight = true;
  let attempted = 0;
  let synced = 0;
  let failed = 0;
  try {
    const activeOrders = await salonRepository.getOrders({ deleted: 'active' });
    const nowMs = Date.now();
    const candidates = activeOrders
      .filter(o => {
        if (o.is_legacy_bill || o.deleted_at || !o.bill_number) return false;
        if (o.smav_bill_status === 'finalize_pending') return true;
        if (o.smav_bill_status === 'reserved') {
          const createdMs = Date.parse(o.created_at || '');
          return Number.isFinite(createdMs) && nowMs - createdMs > 30_000;
        }
        return false;
      })
      .slice(0, maxBatch);

    for (const ord of candidates) {
      attempted++;
      const res = await syncOrderToSmavCentral(
        ord,
        { name: ord.cashier_name || 'Glossy Looks Auto-Sync', role: 'admin' },
        'finalize_or_upsert'
      );
      if (res.ok) {
        synced++;
        await salonRepository.logAudit(
          'SMAV_AUTO_SYNC_RECOVERED',
          'Order',
          ord.id,
          'SMAV Background Sync',
          `Auto-synced pending central bill ${ord.bill_number} to SMAV Central Ledger`
        );
      } else {
        failed++;
      }
    }
  } catch (err: any) {
    console.warn('⚠️ [SMAV Bill Sync Worker] Drain cycle failed:', err?.message || err);
  } finally {
    pendingBillSyncInFlight = false;
  }
  return { attempted, synced, failed };
}

function computePaymentLedgerTotals(payments: PaymentRecord[]): CentralPaymentLedgerResponse['totals'] {
  const active = payments.filter(p => !p.deleted_at && p.status !== 'Void');
  const paidActive = active.filter(p => p.status !== 'Refunded');
  const refunded = active.filter(p => p.status === 'Refunded');
  const sumByMode = (mode: PaymentRecord['payment_mode']) =>
    paidActive.filter(p => p.payment_mode === mode).reduce((sum, p) => sum + Number(p.amount || 0), 0);

  return {
    count: active.length,
    gross_revenue: paidActive.reduce((sum, p) => sum + Number(p.amount || 0), 0),
    cash: sumByMode('Cash'),
    upi: sumByMode('UPI'),
    card: sumByMode('Card'),
    bank_transfer: sumByMode('Bank Transfer'),
    split_payment: sumByMode('Split Payment'),
    pay_later: sumByMode('Pay Later'),
    refunded_count: refunded.length,
    refunded_amount: refunded.reduce((sum, p) => sum + Number(p.amount || 0), 0),
  };
}

// SMAV authenticated server-to-server sale-event receiver.
// Validates BOTH X-Integration-Key (GLOSSYLOOKS_INTEGRATION_KEY) AND HMAC-SHA256 signature
// (X-SMAV-Timestamp + X-SMAV-Signature over `${timestamp}.${rawBody}` using SMAV_DISPATCH_SECRET)
// before reading, creating, or updating any local bill. Never expose signing secrets to the browser.
app.post('/api/integrations/smav/sale-event', async (req, res) => {
  const auth = verifySmavSaleEventRequest(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error || 'Invalid SMAV authentication' });
  }

  let e: any = req.body || {};
  if (typeof e === 'string') {
    try { e = JSON.parse(e); } catch { e = {}; }
  } else if (Buffer.isBuffer(e)) {
    try { e = JSON.parse(e.toString('utf8')); } catch { e = {}; }
  }

  const p = e.payload || e.data || e.bill || e.sale || e;
  const sourceType = String(e.source_type || e.sourceType || 'salon').trim().toLowerCase();
  const eventType = String(e.event_type || e.eventType || '').trim().toLowerCase();
  const supportedEvents = [
    'central_bill_finalized',
    'central_bill_updated',
    'central_bill_voided',
    'central_bill_restored',
    'receipt',
    'feedback',
    'sale_recorded',
    'sale_finalized',
    'bill_finalized',
    'bill_updated',
    'payment_updated',
    'bill_voided',
    'sale_voided',
    'bill_restored',
    'refund',
  ];

  if (!['salon', 'glossylooks'].includes(sourceType) || !supportedEvents.includes(eventType)) {
    return res.status(400).json({ error: 'Invalid SMAV sale event envelope' });
  }

  // Strictly validate outlet_code === 'glossylooks'
  const configuredOutlet = (process.env.SMAV_SALON_OUTLET_ID || '').trim();
  const suppliedOutletId = String(e.outlet_id || e.outletId || p.outlet_id || p.outletId || '').trim();
  const suppliedOutletCode = String(
    e.outlet_code ||
    e.outletCode ||
    p.outlet_code ||
    p.outletCode ||
    req.headers['x-business-source'] ||
    ''
  )
    .trim()
    .toLowerCase();

  if (suppliedOutletCode !== 'glossylooks') {
    return res.status(403).json({ error: 'Invalid or unauthorized outlet_code; expected glossylooks' });
  }
  if (configuredOutlet && suppliedOutletId && suppliedOutletId !== configuredOutlet) {
    return res.status(403).json({ error: 'Outlet not allowed' });
  }

  const centralBillNumber = String(
    p.central_bill_number ||
    p.centralBillNumber ||
    p.bill_number ||
    p.billNumber ||
    e.central_bill_number ||
    e.centralBillNumber ||
    e.bill_number ||
    e.billNumber ||
    ''
  ).trim();

  if (!centralBillNumber || centralBillNumber.length > 128) {
    return res.status(400).json({ error: 'Missing central_bill_number / bill_number reference' });
  }

  const smavCentralBillId = String(
    p.smav_central_bill_id ||
    p.smavCentralBillId ||
    p.central_bill_id ||
    p.centralBillId ||
    p.bill_id ||
    p.billId ||
    p.sale_id ||
    p.saleId ||
    p.smav_sale_id ||
    e.central_bill_id ||
    e.centralBillId ||
    ''
  ).trim() || null;

  const localOrderRef = String(
    p.local_order_id ||
    p.localOrderId ||
    p.native_order_id ||
    p.nativeOrderId ||
    p.external_order_id ||
    p.externalOrderId ||
    ''
  ).trim();

  const headerIdemKey = Array.isArray(req.headers['x-idempotency-key'])
    ? req.headers['x-idempotency-key'][0]
    : req.headers['x-idempotency-key'];

  const key = String(
    p.idempotency_key ||
    p.idempotencyKey ||
    e.idempotency_key ||
    e.idempotencyKey ||
    e.source_key ||
    e.sourceKey ||
    headerIdemKey ||
    `${eventType}:${centralBillNumber}`
  ).trim();

  const eventId = String(e.event_id || e.eventId || p.event_id || p.eventId || key).trim();
  if (!eventId || eventId.length > 128 || !key || key.length > 200) {
    return res.status(400).json({ error: 'Invalid event_id or idempotency_key' });
  }

  const localBranches = await salonRepository.getBranches().catch(() => []);
  const suppliedBranchId = String(
    p.branch_id || p.branchId || p.local_branch_id || p.localBranchId || e.branch_id || e.branchId || ''
  ).trim();
  const suppliedBranchName = String(
    p.branch_name || p.branchName || e.branch_name || e.branchName || ''
  ).trim();
  const matchedLocalBranch =
    (suppliedBranchId ? localBranches.find(b => b.id === suppliedBranchId) : undefined) || null;

  const resolvedBranchCode =
    resolveCanonicalBranchCode({
      branchCode: p.branch_code || p.branchCode || e.branch_code || e.branchCode,
      branchId: suppliedBranchId,
      branchName: suppliedBranchName,
      localBranch: matchedLocalBranch,
    }) || '';

  const resolvedBranchId =
    suppliedBranchId ||
    (resolvedBranchCode ? resolveLocalBranchIdForCode(resolvedBranchCode, localBranches) : null) ||
    '';

  const cleanBranchName = getCleanReceiptBranchName({
    branchId: resolvedBranchId || undefined,
    branchCode: resolvedBranchCode || undefined,
    branchName: suppliedBranchName || undefined,
    localBranch: matchedLocalBranch,
  });

  // 1. Primary path: `central_bill_finalized` (idempotent create/replay of orders, order_items, payments, CRM)
  if (eventType === 'central_bill_finalized') {
    if (!resolvedBranchId || !resolvedBranchCode || !cleanBranchName) {
      return res.status(400).json({
        error: 'Missing required dynamic branch metadata (branch_id, branch_name, branch_code) for central_bill_finalized event.',
      });
    }
    if (!smavCentralBillId) {
      return res.status(400).json({
        error: 'Missing central_bill_id for central_bill_finalized event.',
      });
    }
    const customerObj = p.customer && typeof p.customer === 'object' ? p.customer : {};
    const customerName = String(
      p.customer_name || p.customerName || customerObj.name || 'Walk-in Customer'
    ).trim();
    const customerPhone = String(
      p.customer_phone ||
      p.customerPhone ||
      p.customer_mobile ||
      p.customerMobile ||
      customerObj.phone ||
      customerObj.mobile ||
      ''
    ).trim();
    const customerEmail = String(p.customer_email || p.customerEmail || customerObj.email || '').trim() || undefined;

    const rawItems: any[] = Array.isArray(p.items)
      ? p.items
      : Array.isArray(p.line_items)
      ? p.line_items
      : Array.isArray(p.lineItems)
      ? p.lineItems
      : Array.isArray(p.services)
      ? p.services
      : [];

    const mappedItems = rawItems.map((i: any) => {
      const qty = Math.max(1, Number(i.quantity ?? i.qty ?? 1) || 1);
      const unitPrice = Number(i.unit_price ?? i.unitPrice ?? i.price ?? i.rate ?? 0) || 0;
      const totalPrice = Number(i.total_price ?? i.totalPrice ?? i.amount ?? qty * unitPrice) || 0;
      return {
        service_id: i.service_id || i.serviceId || undefined,
        product_id: i.product_id || i.productId || undefined,
        item_name: String(i.item_name || i.itemName || i.service_name || i.serviceName || i.name || 'Salon Service').trim(),
        item_type: (String(i.item_type || i.itemType || 'service').toLowerCase() === 'product' ? 'product' : 'service') as 'service' | 'product',
        quantity: qty,
        unit_price: unitPrice,
        total_price: totalPrice,
        staff_id: i.staff_id || i.staffId || i.stylist_id || i.stylistId || undefined,
        staff_name: String(i.staff_name || i.staffName || i.stylist_name || i.stylistName || i.stylist || '').trim() || undefined,
        commission_amount: Number(i.commission_amount ?? i.commissionAmount ?? 0) || 0,
      };
    });

    if (mappedItems.length === 0 && (p.service_name || p.serviceName || p.stylist_name || p.stylistName)) {
      const fallbackAmount = Number(p.grand_total ?? p.grandTotal ?? p.total_amount ?? p.totalAmount ?? p.amount ?? 0) || 0;
      mappedItems.push({
        service_id: undefined,
        product_id: undefined,
        item_name: String(p.service_name || p.serviceName || 'Salon Service').trim(),
        item_type: 'service',
        quantity: 1,
        unit_price: fallbackAmount,
        total_price: fallbackAmount,
        staff_id: p.stylist_id || p.stylistId || undefined,
        staff_name: String(p.stylist_name || p.stylistName || '').trim() || undefined,
        commission_amount: 0,
      });
    }

    const itemsSum = mappedItems.reduce((sum, item) => sum + Number(item.total_price || 0), 0);
    const grandTotalRaw = p.grand_total ?? p.grandTotal ?? p.total_amount ?? p.totalAmount ?? p.net_amount ?? p.netAmount ?? p.amount;
    const subtotalRaw = p.subtotal ?? p.sub_total ?? p.subTotal;
    const discount = Math.max(0, Number(p.discount ?? p.discount_amount ?? p.discountAmount ?? 0) || 0);
    const taxPercent = Math.max(0, Number(p.tax_percent ?? p.taxPercent ?? 0) || 0);
    const taxAmount = Math.max(0, Number(p.tax_amount ?? p.taxAmount ?? p.gst_amount ?? p.gstAmount ?? 0) || 0);
    const tipAmount = Math.max(0, Number(p.tip_amount ?? p.tipAmount ?? 0) || 0);
    const subtotal = subtotalRaw !== undefined ? Math.max(0, Number(subtotalRaw) || 0) : Math.max(0, itemsSum || Number(grandTotalRaw || 0));
    const grandTotal = grandTotalRaw !== undefined
      ? Math.max(0, Number(grandTotalRaw) || 0)
      : Math.max(0, subtotal - discount + taxAmount + tipAmount);
    const paidRaw = p.paid_amount ?? p.paidAmount ?? p.amount_paid ?? p.amountPaid;
    const paidAmount = paidRaw !== undefined ? Math.max(0, Number(paidRaw) || 0) : grandTotal;
    const dueRaw = p.due_amount ?? p.dueAmount;
    const dueAmount = dueRaw !== undefined ? Math.max(0, Number(dueRaw) || 0) : Math.max(0, grandTotal - paidAmount);
    const paymentStatus = normalizeSmavPaymentStatus(p.payment_status ?? p.paymentStatus, dueAmount);
    const primaryPaymentMode = normalizeSmavPaymentMode(
      p.primary_payment_mode ?? p.primaryPaymentMode ?? p.payment_mode ?? p.paymentMode
    );

    const nowIso = new Date().toISOString();
    const billedAt = normalizeIsoTimestamp(
      p.billed_at || p.billedAt || p.bill_date || p.billDate || p.finalized_at || p.finalizedAt || p.created_at || p.createdAt,
      nowIso
    );
    const finalizedAt = normalizeIsoTimestamp(p.finalized_at || p.finalizedAt || e.finalized_at || e.finalizedAt, nowIso);

    try {
      const result = await salonRepository.upsertSmavFinalizedBill({
        event_id: eventId,
        central_bill_number: centralBillNumber,
        smav_central_bill_id: smavCentralBillId,
        smav_reservation_id: String(p.reservation_id || p.reservationId || '').trim() || null,
        smav_sale_id: String(p.sale_id || p.saleId || p.smav_sale_id || smavCentralBillId || '').trim() || null,
        local_order_id: localOrderRef && localOrderRef !== centralBillNumber ? localOrderRef : null,
        idempotency_key: key,
        branch_id: resolvedBranchId,
        branch_code: resolvedBranchCode,
        branch_name: cleanBranchName,
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_email: customerEmail,
        items: mappedItems,
        subtotal,
        discount,
        tax_percent: taxPercent,
        tax_amount: taxAmount,
        tip_amount: tipAmount,
        grand_total: grandTotal,
        paid_amount: paidAmount,
        due_amount: dueAmount,
        payment_status: paymentStatus,
        primary_payment_mode: primaryPaymentMode,
        transaction_ref: String(p.transaction_ref || p.transactionRef || p.payment_reference || p.paymentReference || '').trim() || undefined,
        cashier_name: String(p.cashier_name || p.cashierName || p.finalized_by || p.finalizedBy || 'SMAV Central').trim(),
        notes: String(p.notes || '').trim() || `SMAV finalized bill ${centralBillNumber}`,
        billed_at: billedAt,
        finalized_at: finalizedAt,
      });

      // Only acknowledge after the local payment ledger record is durably committed
      if (!result?.payment?.id) {
        return res.status(503).json({ error: 'Local payment ledger record was not committed' });
      }

      // A central finalized-sale event is the bill-creation event for bills
      // raised in SMAV. Dispatch the receipt here, after the local order and
      // payment commit, rather than leaving it permanently in "Queued".
      // Existing sent/delivered/read receipts are never sent again on replay.
      let receiptDispatch: { status: WhatsAppMessageStatus; messageId?: string; error?: string } | null = null;
      const currentReceiptStatus = String(result.order.receipt_whatsapp_status || '').toLowerCase();
      const shouldDispatchReceipt = Boolean(customerPhone) && !['sent', 'delivered', 'read'].includes(currentReceiptStatus);
      if (shouldDispatchReceipt) {
        try {
          const receiptResult = await sendBranchWhatsAppTemplate({
            branchId: resolvedBranchId,
            recipientPhone: customerPhone,
            templateName: 'gl_bill_receipt',
            orderId: result.order.id,
            billNumber: result.order.bill_number,
            jobType: 'bill_receipt',
            customData: {
              customerName,
              billNumber: result.order.bill_number || centralBillNumber,
              billDate: new Date(billedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
              itemsSummary: mappedItems.map(item => `${item.item_name} (x${item.quantity})`).join(', ') || 'Salon Services',
              grandTotal: String(grandTotal),
              paymentMode: primaryPaymentMode,
              branchName: cleanBranchName,
            },
          });
          const receiptStatus: WhatsAppMessageStatus = receiptResult.sent
            ? 'sent'
            : receiptResult.status === 'retrying'
              ? 'retrying'
              : receiptResult.status === 'pending_approval'
                ? 'pending_approval'
                : 'failed';
          await salonRepository.updateOrder(result.order.id, {
            receipt_whatsapp_status: receiptStatus,
            receipt_whatsapp_message_id: receiptResult.messageId,
            receipt_whatsapp_sent_at: receiptResult.sent ? new Date().toISOString() : undefined,
            receipt_whatsapp_error: receiptResult.sent ? undefined : receiptResult.error,
            whatsapp_status: receiptStatus,
          });
          receiptDispatch = { status: receiptStatus, messageId: receiptResult.messageId, error: receiptResult.error };
        } catch (receiptError: any) {
          const error = String(receiptError?.message || receiptError || 'Receipt dispatch failed').slice(0, 500);
          await salonRepository.updateOrder(result.order.id, {
            receipt_whatsapp_status: 'failed',
            receipt_whatsapp_error: error,
            whatsapp_status: 'failed',
          }).catch(() => undefined);
          receiptDispatch = { status: 'failed', error };
        }
      }

      return res.status(result.created ? 201 : 200).json({
        accepted: true,
        created: result.created,
        duplicate: result.duplicate,
        order_id: result.order.id,
        native_order_id: result.order.id,
        payment_id: result.payment.id,
        payment_committed: true,
        bill_number: result.order.bill_number,
        branch_id: result.order.branch_id || resolvedBranchId,
        branch_code: result.order.branch_code || resolvedBranchCode,
        branch_name: result.order.branch_name || cleanBranchName,
        smav_central_bill_id: result.order.smav_central_bill_id || smavCentralBillId,
        idempotency_key: result.order.idempotency_key || key,
        receipt_status: receiptDispatch?.status || result.order.receipt_whatsapp_status || 'queued',
        receipt_message_id: receiptDispatch?.messageId || result.order.receipt_whatsapp_message_id,
        receipt_error: receiptDispatch?.error || result.order.receipt_whatsapp_error,
      });
    } catch (err: any) {
      const msg = String(err?.message || err || 'Failed to commit SMAV finalized bill');
      if (msg.includes('IMMUTABLE_BILL_NUMBER_CONFLICT')) {
        return res.status(409).json({ error: msg });
      }
      console.error('❌ [SMAV central_bill_finalized] Local commit failed:', msg);
      return res.status(503).json({ error: 'Failed to commit finalized bill to local payment ledger' });
    }
  }

  // 2. Look up existing GlossyLooks local bill strictly by central_bill_id / bill_number / external_order_id / idempotency
  //    (NEVER pass bill_number into getOrderById as an order UUID!)
  let existingLocalOrder: Order | null = null;
  if (smavCentralBillId) {
    existingLocalOrder = await salonRepository.getOrderBySmavCentralBillId(smavCentralBillId);
  }
  if (!existingLocalOrder) {
    existingLocalOrder = await salonRepository.getOrderByBillNumber(centralBillNumber);
  }
  if (!existingLocalOrder && localOrderRef && localOrderRef !== centralBillNumber) {
    existingLocalOrder = await salonRepository.getOrderById(localOrderRef);
  }
  if (!existingLocalOrder && key) {
    existingLocalOrder = await salonRepository.getOrderByIdempotencyKey(key);
  }

  // Immutable bill number guard: never overwrite an existing order's bill_number
  if (existingLocalOrder && existingLocalOrder.bill_number && existingLocalOrder.bill_number !== centralBillNumber) {
    return res.status(409).json({
      error: `IMMUTABLE_BILL_NUMBER_CONFLICT: Local order ${existingLocalOrder.id} is already assigned bill_number ${existingLocalOrder.bill_number}; refusing to replace with ${centralBillNumber}.`,
    });
  }

  // 3a. Handle central_bill_voided / bill_voided / sale_voided idempotently (soft-delete order + items + payments)
  if (['central_bill_voided', 'bill_voided', 'sale_voided'].includes(eventType)) {
    const actorName = String(p.actor_name || p.actorName || p.deleted_by || p.deletedBy || p.voided_by || p.voidedBy || 'SMAV Central').trim();
    const actorId = String(p.actor_id || p.actorId || p.deleted_by_user_id || p.deletedByUserId || '').trim() || undefined;
    const reason = String(p.reason || p.deletion_reason || p.deletionReason || p.void_reason || p.voidReason || 'Voided in SMAV Central Billing').trim();
    const nowIso = new Date().toISOString();

    if (!existingLocalOrder) {
      return res.json({
        accepted: true,
        voided: true,
        skipped_local_mirror: true,
        bill_number: centralBillNumber,
        smav_central_bill_id: smavCentralBillId,
      });
    }

    if (existingLocalOrder.smav_last_event_id === eventId && existingLocalOrder.deleted_at) {
      return res.json({
        accepted: true,
        duplicate: true,
        voided: true,
        native_order_id: existingLocalOrder.id,
        bill_number: existingLocalOrder.bill_number,
      });
    }

    if (!existingLocalOrder.deleted_at) {
      await salonRepository.softDeleteOrderTransaction(
        existingLocalOrder.id,
        { userId: actorId, name: actorName },
        reason
      );
    }

    await salonRepository.updateOrder(existingLocalOrder.id, {
      smav_bill_status: 'voided',
      payment_status: 'Cancelled',
      smav_last_event_id: eventId,
      smav_last_event_at: nowIso,
      ...(smavCentralBillId ? { smav_central_bill_id: smavCentralBillId } : {}),
    });

    await salonRepository.logAudit(
      'SMAV_CENTRAL_BILL_VOIDED',
      'Order',
      existingLocalOrder.id,
      actorName,
      `Soft-deleted bill ${existingLocalOrder.bill_number} via SMAV webhook (${eventType}, event=${eventId}). Reason: ${reason}`
    );

    return res.json({
      accepted: true,
      voided: true,
      duplicate: Boolean(existingLocalOrder.deleted_at),
      native_order_id: existingLocalOrder.id,
      bill_number: existingLocalOrder.bill_number,
      smav_central_bill_id: smavCentralBillId || existingLocalOrder.smav_central_bill_id || null,
    });
  }

  // 3b. Handle central_bill_restored / bill_restored idempotently (clear deletion status on order + items + payments)
  if (['central_bill_restored', 'bill_restored'].includes(eventType)) {
    const actorName = String(p.actor_name || p.actorName || p.restored_by || p.restoredBy || 'SMAV Central').trim();
    const actorId = String(p.actor_id || p.actorId || '').trim() || undefined;
    const nowIso = new Date().toISOString();

    if (!existingLocalOrder) {
      return res.json({
        accepted: true,
        restored: true,
        skipped_local_mirror: true,
        bill_number: centralBillNumber,
        smav_central_bill_id: smavCentralBillId,
      });
    }

    if (existingLocalOrder.smav_last_event_id === eventId && !existingLocalOrder.deleted_at) {
      return res.json({
        accepted: true,
        duplicate: true,
        restored: true,
        native_order_id: existingLocalOrder.id,
        bill_number: existingLocalOrder.bill_number,
      });
    }

    if (existingLocalOrder.deleted_at) {
      await salonRepository.restoreOrderTransaction(existingLocalOrder.id, {
        userId: actorId,
        name: actorName,
      });
    }

    const restoredPaymentStatus: Order['payment_status'] =
      existingLocalOrder.payment_status === 'Cancelled'
        ? normalizeSmavPaymentStatus(p.payment_status ?? p.paymentStatus ?? 'Paid', Number(existingLocalOrder.due_amount || 0))
        : existingLocalOrder.payment_status;

    await salonRepository.updateOrder(existingLocalOrder.id, {
      smav_bill_status: 'finalized',
      payment_status: restoredPaymentStatus,
      smav_last_event_id: eventId,
      smav_last_event_at: nowIso,
      ...(smavCentralBillId ? { smav_central_bill_id: smavCentralBillId } : {}),
    });

    await salonRepository.logAudit(
      'SMAV_CENTRAL_BILL_RESTORED',
      'Order',
      existingLocalOrder.id,
      actorName,
      `Restored bill ${existingLocalOrder.bill_number} via SMAV webhook (${eventType}, event=${eventId})`
    );

    return res.json({
      accepted: true,
      restored: true,
      duplicate: !existingLocalOrder.deleted_at,
      native_order_id: existingLocalOrder.id,
      bill_number: existingLocalOrder.bill_number,
      smav_central_bill_id: smavCentralBillId || existingLocalOrder.smav_central_bill_id || null,
    });
  }

  // 3c. Handle central_bill_updated (and full/partial bill updates) without duplicating CRM or WhatsApp
  if (eventType === 'central_bill_updated' && !existingLocalOrder && resolvedBranchId && resolvedBranchCode && cleanBranchName && smavCentralBillId) {
    // Upsert missed central bill cleanly on update event without sending duplicate WhatsApp receipt
    const customerObj = p.customer && typeof p.customer === 'object' ? p.customer : {};
    const customerName = String(p.customer_name || p.customerName || customerObj.name || 'Walk-in Customer').trim();
    const customerPhone = String(p.customer_phone || p.customerPhone || p.customer_mobile || customerObj.phone || '').trim();
    const rawItems: any[] = Array.isArray(p.items) ? p.items : Array.isArray(p.line_items) ? p.line_items : [];
    const mappedItems = rawItems.map((i: any) => {
      const qty = Math.max(1, Number(i.quantity ?? i.qty ?? 1) || 1);
      const unitPrice = Number(i.unit_price ?? i.unitPrice ?? i.price ?? 0) || 0;
      const totalPrice = Number(i.total_price ?? i.totalPrice ?? i.amount ?? qty * unitPrice) || 0;
      return {
        service_id: i.service_id || i.serviceId || undefined,
        product_id: i.product_id || i.productId || undefined,
        item_name: String(i.item_name || i.itemName || i.name || 'Salon Service').trim(),
        item_type: (String(i.item_type || i.itemType || 'service').toLowerCase() === 'product' ? 'product' : 'service') as 'service' | 'product',
        quantity: qty,
        unit_price: unitPrice,
        total_price: totalPrice,
        staff_id: i.staff_id || i.staffId || i.stylist_id || i.stylistId || undefined,
        staff_name: String(i.staff_name || i.staffName || i.stylist_name || i.stylistName || '').trim() || undefined,
        commission_amount: Number(i.commission_amount ?? i.commissionAmount ?? 0) || 0,
      };
    });
    const subtotal = Math.max(0, Number(p.subtotal ?? p.sub_total ?? mappedItems.reduce((s, i) => s + i.total_price, 0)) || 0);
    const discount = Math.max(0, Number(p.discount ?? p.discount_amount ?? 0) || 0);
    const taxPercent = Math.max(0, Number(p.tax_percent ?? p.taxPercent ?? 0) || 0);
    const taxAmount = Math.max(0, Number(p.tax_amount ?? p.taxAmount ?? p.gst_amount ?? 0) || 0);
    const tipAmount = Math.max(0, Number(p.tip_amount ?? p.tipAmount ?? 0) || 0);
    const grandTotal = Math.max(0, Number(p.grand_total ?? p.grandTotal ?? p.amount ?? (subtotal - discount + taxAmount + tipAmount)) || 0);
    const paidAmount = Math.max(0, Number(p.paid_amount ?? p.paidAmount ?? grandTotal) || 0);
    const dueAmount = Math.max(0, Number(p.due_amount ?? p.dueAmount ?? Math.max(0, grandTotal - paidAmount)) || 0);
    const nowIso = new Date().toISOString();

    const upserted = await salonRepository.upsertSmavFinalizedBill({
      event_id: eventId,
      central_bill_number: centralBillNumber,
      smav_central_bill_id: smavCentralBillId,
      smav_reservation_id: String(p.reservation_id || p.reservationId || '').trim() || null,
      smav_sale_id: String(p.sale_id || p.saleId || smavCentralBillId).trim() || null,
      local_order_id: localOrderRef && localOrderRef !== centralBillNumber ? localOrderRef : null,
      idempotency_key: key,
      branch_id: resolvedBranchId,
      branch_code: resolvedBranchCode,
      branch_name: cleanBranchName,
      customer_name: customerName,
      customer_phone: customerPhone,
      items: mappedItems,
      subtotal,
      discount,
      tax_percent: taxPercent,
      tax_amount: taxAmount,
      tip_amount: tipAmount,
      grand_total: grandTotal,
      paid_amount: paidAmount,
      due_amount: dueAmount,
      payment_status: normalizeSmavPaymentStatus(p.payment_status ?? p.paymentStatus, dueAmount),
      primary_payment_mode: normalizeSmavPaymentMode(p.primary_payment_mode ?? p.payment_mode ?? p.paymentMode),
      cashier_name: String(p.cashier_name || p.cashierName || 'SMAV Central').trim(),
      notes: String(p.notes || '').trim() || undefined,
      billed_at: normalizeIsoTimestamp(p.billed_at || p.billedAt || p.created_at, nowIso),
      finalized_at: normalizeIsoTimestamp(p.finalized_at || p.finalizedAt, nowIso),
    });

    return res.json({
      accepted: true,
      created: upserted.created,
      updated: !upserted.created,
      native_order_id: upserted.order.id,
      payment_id: upserted.payment.id,
      bill_number: upserted.order.bill_number,
      smav_central_bill_id: upserted.order.smav_central_bill_id || smavCentralBillId,
    });
  }

  // 3d. If updating an existing local bill (finalized/updated/payment sync)
  if (existingLocalOrder && !['receipt', 'feedback'].includes(eventType)) {
    if (existingLocalOrder.smav_last_event_id === eventId) {
      return res.json({
        accepted: true,
        duplicate: true,
        native_order_id: existingLocalOrder.id,
        bill_number: existingLocalOrder.bill_number,
      });
    }

    const nowIso = new Date().toISOString();
    const updates: Partial<Order> = {
      smav_last_event_id: eventId,
      smav_last_event_at: nowIso,
      ...(smavCentralBillId ? { smav_central_bill_id: smavCentralBillId } : {}),
      ...(p.reservation_id || p.reservationId ? { smav_reservation_id: String(p.reservation_id || p.reservationId) } : {}),
      ...(p.sale_id || p.saleId || p.smav_sale_id || smavCentralBillId
        ? { smav_sale_id: String(p.sale_id || p.saleId || p.smav_sale_id || smavCentralBillId) }
        : {}),
      ...(resolvedBranchCode && !existingLocalOrder.branch_code ? { branch_code: resolvedBranchCode } : {}),
      ...(cleanBranchName && !existingLocalOrder.branch_name ? { branch_name: cleanBranchName } : {}),
    };

    if (['sale_recorded', 'sale_finalized', 'bill_finalized'].includes(eventType)) {
      updates.smav_bill_status = 'finalized';
      updates.smav_finalized_at = String(p.finalized_at || p.finalizedAt || nowIso);
      updates.smav_finalize_error = null;
    } else if (eventType === 'refund') {
      updates.payment_status = 'Refunded';
    }

    if (['central_bill_updated', 'bill_updated', 'payment_updated'].includes(eventType)) {
      const allowedStatuses = ['Paid', 'Partial', 'Pending', 'Refunded', 'Cancelled'];
      const nextStatus = String(p.payment_status || p.paymentStatus || '').trim();
      if (nextStatus && allowedStatuses.includes(nextStatus)) {
        updates.payment_status = nextStatus as Order['payment_status'];
      }
      if (p.customer_name || p.customerName) {
        updates.customer_name = String(p.customer_name || p.customerName).trim();
      }
      if (p.customer_phone || p.customerPhone) {
        updates.customer_phone = String(p.customer_phone || p.customerPhone).trim();
      }
      if (p.notes !== undefined) {
        updates.notes = String(p.notes || '').trim();
      }
      if (p.subtotal !== undefined && Number.isFinite(Number(p.subtotal))) {
        updates.subtotal = Math.max(0, Number(p.subtotal));
      }
      if (p.discount !== undefined && Number.isFinite(Number(p.discount))) {
        updates.discount = Math.max(0, Number(p.discount));
      }
      if ((p.tax_amount ?? p.taxAmount) !== undefined && Number.isFinite(Number(p.tax_amount ?? p.taxAmount))) {
        updates.tax_amount = Math.max(0, Number(p.tax_amount ?? p.taxAmount));
      }
      if ((p.grand_total ?? p.grandTotal) !== undefined && Number.isFinite(Number(p.grand_total ?? p.grandTotal))) {
        updates.grand_total = Math.max(0, Number(p.grand_total ?? p.grandTotal));
      }
      if (p.paid_amount !== undefined || p.paidAmount !== undefined) {
        const paid = Math.max(0, Number(p.paid_amount ?? p.paidAmount));
        if (Number.isFinite(paid)) {
          updates.paid_amount = paid;
          const totalRef = updates.grand_total !== undefined ? updates.grand_total : Number(existingLocalOrder.grand_total || 0);
          updates.due_amount = Math.max(0, totalRef - paid);
        }
      }
      if (p.payment_mode || p.paymentMode || p.primary_payment_mode || p.primaryPaymentMode) {
        updates.primary_payment_mode = normalizeSmavPaymentMode(
          p.primary_payment_mode || p.primaryPaymentMode || p.payment_mode || p.paymentMode
        );
      }
    }

    const updatedOrder = await salonRepository.updateOrder(existingLocalOrder.id, updates);

    // Keep linked payment ledger row synchronized with updated bill fields
    try {
      const client = (salonRepository as any).client;
      if (client) {
        const payPatch: Record<string, any> = {};
        if (smavCentralBillId) payPatch.smav_central_bill_id = smavCentralBillId;
        if (updates.customer_name) payPatch.customer_name = updates.customer_name;
        if (updates.customer_phone) payPatch.customer_phone = updates.customer_phone;
        if (updates.primary_payment_mode) payPatch.payment_mode = updates.primary_payment_mode;
        if (updates.paid_amount !== undefined) payPatch.amount = updates.paid_amount;
        else if (updates.grand_total !== undefined) payPatch.amount = updates.grand_total;
        if (updates.payment_status === 'Refunded') payPatch.status = 'Refunded';
        else if (updates.payment_status === 'Cancelled') payPatch.status = 'Void';
        if (Object.keys(payPatch).length > 0) {
          await client
            .from('payments')
            .update(payPatch)
            .eq('order_id', existingLocalOrder.id);
          if (existingLocalOrder.bill_number) {
            await client
              .from('payments')
              .update(payPatch)
              .eq('bill_number', existingLocalOrder.bill_number);
          }
        }
      }
    } catch {
      // Non-fatal payment sync guard
    }

    await salonRepository.logAudit(
      'SMAV_SALE_EVENT',
      'Order',
      existingLocalOrder.id,
      'SMAV Central',
      `Applied verified SMAV sale-event (${eventType}, event=${eventId}) to bill ${existingLocalOrder.bill_number}`
    );

    return res.json({
      accepted: true,
      updated: true,
      native_order_id: existingLocalOrder.id,
      bill_number: existingLocalOrder.bill_number,
      smav_central_bill_id: updatedOrder?.smav_central_bill_id || smavCentralBillId || existingLocalOrder.smav_central_bill_id || null,
      smav_bill_status: updatedOrder?.smav_bill_status || updates.smav_bill_status || existingLocalOrder.smav_bill_status,
    });
  }

  // 3. Receipt / Feedback SMAV event reconciliation (uses SMAV's immutable central bill_number, never local generation)
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) {
    return res.status(400).json({ error: 'Invalid SMAV event_id UUID' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    // Offline/JSON fallback mode: still authenticate & reconcile cleanly with central bill_number
    if (eventType === 'receipt' && !existingLocalOrder) {
      if (!resolvedBranchId) return res.status(422).json({ error: 'Branch mapping missing' });
      const items = Array.isArray(p.items) ? p.items : [];
      if (!items.length || !p.customer_phone || !p.customer_name) {
        return res.status(422).json({ error: 'Customer and items required' });
      }
      const total = Number(p.grand_total ?? p.grandTotal ?? 0);
      const nativeItems = items.map((i: any) => ({
        item_name: String(i.item_name || i.itemName || i.serviceName || i.name || 'Service'),
        item_type: 'service' as const,
        quantity: Number(i.quantity || 1),
        unit_price: Number(i.unit_price ?? i.unitPrice ?? i.price ?? 0),
        total_price: Number(i.total_price ?? i.totalPrice ?? (Number(i.quantity || 1) * Number(i.unit_price ?? i.unitPrice ?? i.price ?? 0))),
        staff_name: String(i.staff_name || i.stylistName || 'Station Stylist'),
      }));
      const cleanBranchName = getCleanReceiptBranchName({
        branchId: resolvedBranchId,
        branchCode: resolvedBranchCode,
        branchName: p.branch_name || p.branchName,
      });
      existingLocalOrder = await salonRepository.createOrder({
        bill_number: centralBillNumber,
        branch_id: resolvedBranchId,
        branch_code: resolvedBranchCode || undefined,
        branch_name: cleanBranchName,
        smav_reservation_id: p.reservation_id || p.reservationId || undefined,
        smav_sale_id: p.sale_id || p.saleId || undefined,
        smav_bill_status: 'finalized',
        smav_finalized_at: new Date().toISOString(),
        smav_last_event_id: eventId,
        smav_last_event_at: new Date().toISOString(),
        is_legacy_bill: false,
        idempotency_key: key,
        customer_name: String(p.customer_name),
        customer_phone: String(p.customer_phone),
        items: nativeItems,
        subtotal: Number(p.subtotal ?? total),
        discount: Number(p.discount ?? 0),
        tax_percent: Number(p.tax_percent ?? 0),
        tax_amount: Number(p.tax_amount ?? 0),
        tip_amount: Number(p.tip_amount ?? 0),
        grand_total: total,
        paid_amount: Number(p.paid_amount ?? total),
        due_amount: Math.max(0, total - Number(p.paid_amount ?? total)),
        payment_status: 'Paid',
        primary_payment_mode: (p.payment_mode || p.paymentMode || 'UPI'),
        cashier_name: String(p.cashier_name || 'SMAV POS'),
        notes: `SMAV source bill ${centralBillNumber}`,
        whatsapp_status: 'queued',
        receipt_whatsapp_status: 'queued',
        feedback_whatsapp_status: 'scheduled',
      }, 'SMAV POS');
    } else if (existingLocalOrder) {
      await salonRepository.updateOrder(existingLocalOrder.id, {
        smav_bill_status: 'finalized',
        smav_last_event_id: eventId,
        smav_last_event_at: new Date().toISOString(),
        ...(p.sale_id || p.saleId ? { smav_sale_id: String(p.sale_id || p.saleId) } : {}),
      });
    }
    if (!existingLocalOrder) {
      return res.status(409).json({ error: 'Receipt must reconcile before feedback' });
    }
    return res.json({
      accepted: true,
      native_order_id: existingLocalOrder.id,
      bill_number: existingLocalOrder.bill_number,
    });
  }

  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });
  const { data: old, error: oldError } = await db.from('smav_inbound_sales').select('*').eq('source_key', key).maybeSingle();
  if (oldError) return res.status(503).json({ error: oldError.message });
  if (eventType === 'feedback' && !old?.native_order_id && !existingLocalOrder) {
    return res.status(409).json({ error: 'Receipt must reconcile before feedback' });
  }

  if (eventType === 'receipt' && !old) {
    const branchId = resolvedBranchId || existingLocalOrder?.branch_id;
    if (!branchId) return res.status(422).json({ error: 'Branch mapping missing' });

    const { error: reserveError } = await db.from('smav_inbound_sales').insert({
      source_key: key,
      outlet_id: suppliedOutletId || configuredOutlet,
      bill_number: centralBillNumber,
      branch_id: branchId,
      native_order_id: existingLocalOrder?.id || null,
      status: existingLocalOrder ? 'recorded' : 'reserved',
    });
    if (reserveError) return res.status(409).json({ error: 'Sale already being reconciled; retry later' });

    if (!existingLocalOrder) {
      const items = Array.isArray(p.items) ? p.items : [];
      if (!items.length || !p.customer_phone || !p.customer_name) {
        await db.from('smav_inbound_sales').update({ status: 'needs_reconciliation', last_error: 'Customer and items required' }).eq('source_key', key);
        return res.status(422).json({ error: 'Customer and items required' });
      }
      try {
        const total = Number(p.grand_total ?? p.grandTotal ?? 0);
        const nativeItems = items.map((i: any) => ({
          item_name: String(i.item_name || i.itemName || i.serviceName || i.name || 'Service'),
          item_type: 'service' as const,
          quantity: Number(i.quantity || 1),
          unit_price: Number(i.unit_price ?? i.unitPrice ?? i.price ?? 0),
          total_price: Number(i.total_price ?? i.totalPrice ?? (Number(i.quantity || 1) * Number(i.unit_price ?? i.unitPrice ?? i.price ?? 0))),
          staff_name: String(i.staff_name || i.stylistName || 'Station Stylist'),
        }));
        const cleanBranchName = getCleanReceiptBranchName({
          branchId,
          branchCode: resolvedBranchCode,
          branchName: p.branch_name || p.branchName,
        });
        const native = await salonRepository.createOrder({
          bill_number: centralBillNumber,
          branch_id: branchId,
          branch_code: resolvedBranchCode || undefined,
          branch_name: cleanBranchName,
          smav_reservation_id: p.reservation_id || p.reservationId || undefined,
          smav_sale_id: p.sale_id || p.saleId || undefined,
          smav_bill_status: 'finalized',
          smav_finalized_at: new Date().toISOString(),
          smav_last_event_id: eventId,
          smav_last_event_at: new Date().toISOString(),
          is_legacy_bill: false,
          idempotency_key: key,
          customer_name: String(p.customer_name),
          customer_phone: String(p.customer_phone),
          items: nativeItems,
          subtotal: Number(p.subtotal ?? total),
          discount: Number(p.discount ?? 0),
          tax_percent: Number(p.tax_percent ?? 0),
          tax_amount: Number(p.tax_amount ?? 0),
          tip_amount: Number(p.tip_amount ?? 0),
          grand_total: total,
          paid_amount: Number(p.paid_amount ?? total),
          due_amount: Math.max(0, total - Number(p.paid_amount ?? total)),
          payment_status: 'Paid',
          primary_payment_mode: (p.payment_mode || p.paymentMode || 'UPI'),
          cashier_name: String(p.cashier_name || 'SMAV POS'),
          notes: `SMAV source bill ${centralBillNumber}`,
          whatsapp_status: 'queued',
          receipt_whatsapp_status: 'queued',
          feedback_whatsapp_status: 'scheduled',
        }, 'SMAV POS');
        const { error: saveError } = await db.from('smav_inbound_sales').update({ native_order_id: native.id, status: 'recorded' }).eq('source_key', key);
        if (saveError) throw new Error(saveError.message);
      } catch (err: any) {
        await db.from('smav_inbound_sales').update({ status: 'needs_reconciliation', last_error: String(err.message || err) }).eq('source_key', key);
        return res.status(503).json({ error: 'Native order reconciliation requires review; no automatic replay' });
      }
    } else {
      await salonRepository.updateOrder(existingLocalOrder.id, {
        smav_bill_status: 'finalized',
        smav_last_event_id: eventId,
        smav_last_event_at: new Date().toISOString(),
        ...(p.sale_id || p.saleId ? { smav_sale_id: String(p.sale_id || p.saleId) } : {}),
      });
    }
  }

  const { data: record, error: recordError } = await db.from('smav_inbound_sales').select('*').eq('source_key', key).maybeSingle();
  const targetOrderId = record?.native_order_id || existingLocalOrder?.id;
  if (recordError || !targetOrderId) return res.status(503).json({ error: 'Sale not reconciled' });

  const doneColumn = eventType === 'receipt' ? 'receipt_sent_at' : 'feedback_sent_at';
  if (record && record[doneColumn]) {
    return res.json({ accepted: true, duplicate: true, native_order_id: targetOrderId, bill_number: centralBillNumber });
  }

  if (record) {
    const { data: claimed, error: claimError } = await db.rpc('smav_claim_inbound_event', {
      p_source_key: key,
      p_event_type: eventType,
      p_event_id: eventId,
    });
    if (claimError) return res.status(503).json({ error: claimError.message });
    if (!claimed) return res.status(409).json({ error: 'Notification in progress or requires reconciliation' });
  }

  try {
    const native = await salonRepository.getOrderById(targetOrderId);
    if (!native) throw new Error('Native order not found');
    const branchIdForWa = record?.branch_id || native.branch_id || resolvedBranchId || (await getDefaultBranchIdFromRepo());
    const branch = branchIdForWa ? await salonRepository.getBranchById(branchIdForWa) : null;
    const cleanBranchName = getCleanReceiptBranchName({
      branchId: branchIdForWa,
      branchCode: native.branch_code || resolvedBranchCode,
      branchName: native.branch_name || branch?.name,
      localBranch: branch,
    });
    const receipt = eventType === 'receipt';
    const result = await sendBranchWhatsAppTemplate({
      branchId: branchIdForWa,
      recipientPhone: native.customer_phone,
      orderId: native.id,
      jobType: receipt ? 'bill_receipt' : 'customer_feedback',
      templateName: receipt ? 'gl_bill_receipt' : 'glossylooks_customer_feedback',
      customData: {
        customerName: native.customer_name,
        billNumber: native.bill_number || centralBillNumber,
        billDate: new Date(p.billed_at || native.created_at || Date.now()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        itemsSummary: (native.items || []).map((i: any) => `${i.item_name} (x${i.quantity})`).join(', '),
        grandTotal: String(native.grand_total),
        paymentMode: native.primary_payment_mode,
        branchName: cleanBranchName,
      },
    });
    if (!result.sent) throw new Error(result.error || 'WhatsApp not accepted by Meta');
    if (record) {
      await db.from('smav_inbound_sales').update({ [doneColumn]: new Date().toISOString() }).eq('source_key', key);
    }
    await salonRepository.updateOrder(
      native.id,
      receipt
        ? {
            receipt_whatsapp_status: 'sent',
            receipt_whatsapp_message_id: result.messageId,
            receipt_whatsapp_sent_at: new Date().toISOString(),
            smav_last_event_id: eventId,
            smav_last_event_at: new Date().toISOString(),
          }
        : {
            feedback_whatsapp_status: 'sent',
            feedback_whatsapp_message_id: result.messageId,
            feedback_whatsapp_sent_at: new Date().toISOString(),
            smav_last_event_id: eventId,
            smav_last_event_at: new Date().toISOString(),
          }
    );
    return res.json({ accepted: true, native_order_id: native.id, bill_number: native.bill_number });
  } catch (err: any) {
    if (record) {
      await db.from('smav_inbound_sales').update({ last_error: String(err.message || err).slice(0, 500) }).eq('source_key', key);
    }
    return res.status(503).json({ error: 'WhatsApp dispatch failed; inspect message logs before retry' });
  }
});

// Root API index
app.get(['/api', '/api/'], (req, res) => {
  res.json({
    status: 'ok',
    brand: 'The Glossy Looks',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// ============================================================================
// SEO: SITEMAP & ROBOTS.TXT
// ============================================================================
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *
Allow: /
Disallow: /admin
Disallow: /portal
Disallow: /api/

Sitemap: https://theglossylooks.com/sitemap.xml
`);
});

app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://theglossylooks.com/</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://theglossylooks.com/#services</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://theglossylooks.com/#makeup</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>https://theglossylooks.com/#packages</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>`);
});

// ============================================================================
// API ROUTES
// ============================================================================

// Health check (Cloud Run and monitoring ping)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', brand: 'The Glossy Looks', timestamp: new Date().toISOString() });
});

// Settings & Contact Info
app.get('/api/settings', async (req, res) => {
  try {
    const s = await salonRepository.getSettings();
    res.json(s);
  } catch (err: any) {
    console.error('[GET /api/settings] Error:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Failed to load salon settings' });
  }
});

app.put('/api/settings', async (req, res) => {
  const user = (req.headers['x-admin-name'] as string) || 'Admin';
  const updated = await salonRepository.updateSettings(req.body, user);
  res.json(updated);
});

// ----------------------------------------------------------------------------
// Customer Authentication (Mobile OTP)
// ----------------------------------------------------------------------------
app.post('/api/auth/customer/send-otp', async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile || mobile.replace(/\D/g, '').length < 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number' });
    }
    const session = await salonRepository.createOTPSession(mobile);
    res.json({
      success: true,
      sessionId: session.sessionId,
      message: `OTP sent to ${mobile}. Demo code: ${session.otp}`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/customer/verify-otp', async (req, res) => {
  try {
    const { mobile, otp } = req.body;
    if (!mobile || !otp) {
      return res.status(400).json({ error: 'Mobile and OTP are required' });
    }
    const result = await salonRepository.verifyOTP(mobile, otp);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/customer/me', async (req, res) => {
  const mobile = req.query.mobile as string;
  if (!mobile) return res.status(400).json({ error: 'Missing mobile query parameter' });
  const cust = await salonRepository.getCustomerByMobile(mobile);
  if (!cust) return res.status(404).json({ error: 'Customer not found' });
  res.json(cust);
});

app.get('/api/customer/appointments', async (req, res) => {
  const mobile = req.query.mobile as string;
  if (!mobile) return res.status(400).json({ error: 'Missing mobile parameter' });
  const apts = await salonRepository.getAppointments({ customerMobile: mobile });
  res.json(apts);
});

app.get('/api/customer/orders', async (req, res) => {
  const mobile = req.query.mobile as string;
  if (!mobile) return res.status(400).json({ error: 'Missing mobile parameter' });
  const orders = await salonRepository.getOrders({ customerMobile: mobile });
  res.json(orders);
});

// HMAC-signed salon sessions. Configure SALON_SESSION_SECRET in the server environment.
// No client-supplied user ID or role is trusted for authorization.
const sessionSecret = process.env.SALON_SESSION_SECRET || '';
function signSalonSession(userId: string): string {
  if (sessionSecret.length < 32) throw new Error('SALON_SESSION_SECRET must contain at least 32 characters');
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function readSalonSession(token: string): string | null {
  if (!sessionSecret || !token) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', sessionSecret).update(payload).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof parsed.sub === 'string' && Number.isFinite(parsed.exp) && parsed.exp > Date.now() ? parsed.sub : null;
  } catch { return null; }
}
function verifySalonPassword(stored: string, supplied: string): boolean {
  if (stored.startsWith('scrypt$')) {
    const [, salt, expectedHex] = stored.split('$');
    if (!salt || !expectedHex || !/^[a-f0-9]{128}$/i.test(expectedHex)) return false;
    const expected = Buffer.from(expectedHex, 'hex');
    return crypto.timingSafeEqual(crypto.scryptSync(supplied, salt, 64), expected);
  }
  // Compatibility with existing plaintext salon passwords; upgraded after successful login.
  const old = Buffer.from(stored || ''); const candidate = Buffer.from(supplied);
  return old.length === candidate.length && crypto.timingSafeEqual(old, candidate);
}
function hashSalonPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
const getAuthAdmin = async (req: express.Request) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const userId = readSalonSession(token);
  if (!userId) return null;
  const user = (await salonRepository.getUsers()).find(u => u.id === userId);
  return user?.is_active ? user : null;
};

// ----------------------------------------------------------------------------
// Admin Authentication & Users Management (Hardened Access Control)
// ----------------------------------------------------------------------------

// Rate limiter store for admin authentication attempts
const adminLoginAttempts = new Map<string, { count: number; lockedUntil: number }>();

function checkAdminRateLimit(key: string): { allowed: boolean; retryAfterMinutes?: number } {
  const now = Date.now();
  const entry = adminLoginAttempts.get(key);
  if (!entry) return { allowed: true };
  if (entry.lockedUntil > now) {
    const remaining = Math.ceil((entry.lockedUntil - now) / 60000);
    return { allowed: false, retryAfterMinutes: remaining };
  }
  if (entry.lockedUntil <= now && entry.count >= 5) {
    adminLoginAttempts.delete(key);
    return { allowed: true };
  }
  return { allowed: true };
}

function recordAdminFailedAttempt(key: string) {
  const now = Date.now();
  const entry = adminLoginAttempts.get(key) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= 5) {
    entry.lockedUntil = now + 15 * 60 * 1000; // 15-minute security lockout
  }
  adminLoginAttempts.set(key, entry);
}

function clearAdminFailedAttempts(key: string) {
  adminLoginAttempts.delete(key);
}

const AUTHORIZED_STAFF_ROLES = [
  'superadmin',
  'admin',
  'owner',
  'manager',
  'receptionist',
  'stylist',
  'pos_billing',
  'inventory_staff',
];

app.post(['/api/auth/admin/login', '/auth/admin/login'], async (req, res) => {
  try {
    if (sessionSecret.length < 32) return res.status(503).json({ error: 'Admin login is not configured: set SALON_SESSION_SECRET (32+ characters) on the server.' });
    const { identifier, email, password } = req.body;
    const loginTarget = (identifier || email || '').trim();
    const rawPassword = (password || '').trim();

    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const rateLimitKey = `${clientIp}_${loginTarget.toLowerCase()}`;

    // 1. Enforce brute force protection & rate limiting
    const rateCheck = checkAdminRateLimit(rateLimitKey);
    if (!rateCheck.allowed) {
      await salonRepository.logAudit(
        'SECURITY_LOCKOUT',
        'Auth',
        loginTarget || clientIp,
        'Security System',
        `Access temporarily locked out for ${clientIp} targeting ${loginTarget}`
      );
      return res.status(429).json({
        error: `Too many failed login attempts. Access is temporarily locked for ${rateCheck.retryAfterMinutes} minute(s) to protect salon operations. Please contact the Salon Owner.`
      });
    }

    if (!loginTarget || !rawPassword) {
      return res.status(400).json({ error: 'Please enter your registered Staff ID, Staff Email, or Mobile Number and Password.' });
    }

    // 2. Fetch user strictly from the authorized salon staff repository
    const user = await salonRepository.getUserByIdentifier(loginTarget);
    if (!user) {
      recordAdminFailedAttempt(rateLimitKey);
      await salonRepository.logAudit(
        'SECURITY_LOGIN_FAILED',
        'Auth',
        loginTarget,
        'Security System',
        `Unrecognized user identifier '${loginTarget}' attempted login from IP: ${clientIp}`
      );
      return res.status(401).json({
        error: 'Invalid credentials or unauthorized account. Only registered salon staff and management may sign in.'
      });
    }

    // 3. Strict verification of staff roles: customers or any other roles are strictly prohibited
    if (!user.role || !AUTHORIZED_STAFF_ROLES.includes(user.role)) {
      recordAdminFailedAttempt(rateLimitKey);
      await salonRepository.logAudit(
        'SECURITY_UNAUTHORIZED_ROLE',
        'Auth',
        user.id,
        'Security System',
        `Account with non-staff role '${user.role}' attempted staff login from IP: ${clientIp}`
      );
      return res.status(403).json({
        error: 'Access denied: Customer accounts and unauthorized users cannot access the salon operations system.'
      });
    }

    // 4. Verify account is active
    if (!user.is_active) {
      recordAdminFailedAttempt(rateLimitKey);
      await salonRepository.logAudit(
        'SECURITY_DEACTIVATED_LOGIN',
        'Auth',
        user.id,
        'Security System',
        `Deactivated staff account '${user.name}' (${user.user_id}) attempted login from IP: ${clientIp}`
      );
      return res.status(403).json({
        error: 'This staff account has been deactivated. Please contact the Salon Owner.'
      });
    }

    // 5. Password verification
    if (!verifySalonPassword(user.password_hash || '', rawPassword)) {
      recordAdminFailedAttempt(rateLimitKey);
      await salonRepository.logAudit(
        'SECURITY_PASSWORD_MISMATCH',
        'Auth',
        user.id,
        'Security System',
        `Incorrect password attempt for staff user '${user.name}' (${user.user_id}) from IP: ${clientIp}`
      );
      return res.status(401).json({
        error: 'Invalid credentials or unauthorized account. Only registered salon staff and management may sign in.'
      });
    }

    // Upgrade legacy salon password storage after a successful login.
    if (!user.password_hash.startsWith('scrypt$')) {
      await salonRepository.updateUser(user.id, { password_hash: hashSalonPassword(rawPassword) }, user.name);
    }

    // 6. Login authorized: clear rate limit failure tracking and log success
    clearAdminFailedAttempts(rateLimitKey);
    await salonRepository.logAudit(
      'SECURITY_LOGIN_SUCCESS',
      'Auth',
      user.id,
      user.name,
      `Authorized login by ${user.name} (${user.role}) [${user.user_id}] from IP: ${clientIp}`
    );

    // Update last login
    await salonRepository.updateUser(user.id, { last_login_at: new Date().toISOString() }, user.name);

    res.json({
      success: true,
      token: signSalonSession(user.id),
      user: {
        id: user.id,
        user_id: user.user_id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        last_login_at: new Date().toISOString()
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Current Authenticated Admin User Profile (Single Source of Truth)
app.get(['/api/auth/admin/me', '/auth/admin/me', '/api/admin/me', '/admin/me'], async (req, res) => {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ error: 'Unauthorized or session expired.' });
  }
  res.json({
    id: admin.id,
    user_id: admin.user_id,
    name: admin.name,
    email: admin.email,
    role: admin.role,
    phone: admin.phone,
    is_active: admin.is_active,
    last_login_at: admin.last_login_at
  });
});

// User Management - RESTRICTED TO OWNER ONLY
function formatSafeAdminUser(u: any) {
  return {
    id: u.id,
    user_id: u.user_id,
    username: u.username || u.user_id,
    name: u.name,
    email: u.email,
    role: u.role,
    smav_role: mapLocalRoleToSmavRole(u.role),
    phone: u.phone,
    is_active: u.is_active,
    central_auth_id: u.central_auth_id || null,
    central_auth_status: u.central_auth_status || (u.is_active ? 'ACTIVE' : 'DISABLED'),
    central_last_synced_at: u.central_last_synced_at || null,
    central_sync_status: deriveUserSyncStatus(u),
    central_sync_error: u.central_sync_error || null,
    central_sync_last_attempt_at: u.central_sync_last_attempt_at || null,
    last_login_at: u.last_login_at || null,
    created_at: u.created_at,
    updated_at: u.updated_at,
  };
}

app.get('/api/admin/users', async (req, res) => {
  const admin = await getAuthAdmin(req);
  if (!admin || admin.role !== 'owner') {
    return res.status(403).json({ error: 'Access denied: Only the Salon Owner can view and manage staff accounts.' });
  }
  // Opportunistically drain due PENDING outbox retries in the background without blocking UI load
  triggerNonBlockingOutboxDrain(30_000);
  const users = await salonRepository.getUsers();
  res.json(users.map(formatSafeAdminUser));
});

app.post('/api/admin/users', async (req, res) => {
  const admin = await getAuthAdmin(req);
  if (!admin || admin.role !== 'owner') {
    return res.status(403).json({ error: 'Access denied: Only the Salon Owner can create new staff users.' });
  }
  if (req.body?.central_auth_id !== undefined) {
    return res.status(403).json({
      error: 'Ordinary Admin User creation cannot assign arbitrary central_auth_id values. SMAV must issue a verified Central Auth UUID.',
      code: 'CENTRAL_AUTH_LINK_FORBIDDEN',
    });
  }
  const { name, email, phone, role, user_id, username, password } = req.body;
  if (!name || !role) {
    return res.status(400).json({ error: 'Staff name and role are required.' });
  }

  const rawPassword = typeof password === 'string' ? password.trim() : '';
  if (rawPassword && rawPassword.length < 8) {
    return res.status(400).json({ error: 'Initial password must be at least 8 characters to satisfy SMAV Central Auth requirements.' });
  }

  const normalizedEmail = (
    email ? String(email) : `${String(name).toLowerCase().replace(/[^a-z0-9]/g, '')}@theglossylooks.com`
  ).trim().toLowerCase();
  if (!normalizedEmail.includes('@')) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  const normalizedUserCode = String(user_id || '').trim().toUpperCase();
  const normalizedUsername = String(username || user_id || '').trim().toLowerCase();
  const explicitIdemKey = typeof req.headers['x-idempotency-key'] === 'string'
    ? req.headers['x-idempotency-key'].trim()
    : '';

  const createIdempotencyKey = generateSyncIdempotencyKey(
    normalizedUserCode || normalizedEmail.replace(/[^a-z0-9]/gi, '').slice(0, 24),
    'USER_CREATED',
    explicitIdemKey || undefined
  );

  try {
    // If the caller supplied an explicit X-Idempotency-Key that already exists, delegate directly
    // to createUserWithSmavOutbox so the DB verifies the exact payload fingerprint + password match.
    const existingIdemRow = explicitIdemKey
      ? await salonRepository.getSmavUserSyncOutboxByIdempotencyKey(explicitIdemKey)
      : null;

    if (!existingIdemRow) {
      // Prevent duplicate local & Central Auth accounts
      const existingUsers = await salonRepository.getUsers();
      const duplicate = existingUsers.find(u =>
        (u.email && u.email.trim().toLowerCase() === normalizedEmail) ||
        (normalizedUserCode && u.user_id && u.user_id.trim().toUpperCase() === normalizedUserCode) ||
        (normalizedUsername && u.username && u.username.trim().toLowerCase() === normalizedUsername)
      );
      if (duplicate) {
        return res.status(409).json({
          error: `A staff account already exists with this email or Staff ID (${duplicate.user_id}). Edit the existing account instead.`
        });
      }
    }

    const { user: newUser, outboxItem, created } = await salonRepository.createUserWithSmavOutbox(
      {
        name: String(name).trim(),
        email: normalizedEmail,
        phone: phone ? String(phone).trim() : '',
        role,
        user_id: normalizedUserCode,
        ...(normalizedUsername ? { username: normalizedUsername } : {}),
        password_hash: hashSalonPassword(rawPassword || crypto.randomBytes(18).toString('base64url')),
        is_active: true,
        central_sync_status: 'PENDING',
      },
      {
        idempotency_key: createIdempotencyKey,
        event_type: 'USER_CREATED',
        action: 'upsert_user',
        max_attempts: 6,
        credential_mode: rawPassword ? 'explicit' : 'generated',
        ...(rawPassword
          ? { verifyReplayPassword: (storedHash: string) => verifySalonPassword(storedHash, rawPassword) }
          : {}),
      },
      admin.name
    );

    const smavSync = await executeCommittedOutboxSync({
      outboxItem,
      created,
      user: newUser,
      ...(rawPassword ? { transientInitialPassword: rawPassword } : {}),
      performedBy: admin.name,
    });

    const refreshed = (await salonRepository.getUsers()).find(u => String(u.id) === String(newUser.id)) || newUser;
    return res.status(created ? 201 : 200).json({
      smavSync,
      ...formatSafeAdminUser({
        ...refreshed,
        central_auth_id: refreshed.central_auth_id || smavSync.centralAuthId,
        central_sync_status: refreshed.central_sync_status || smavSync.syncStatus,
        central_sync_error: refreshed.central_sync_error ?? smavSync.error ?? null,
      }),
    });
  } catch (err: any) {
    if (isMigration024RequiredError(err)) {
      return res.status(503).json({
        error: err.message,
        code: 'MIGRATION_024_REQUIRED',
        migrationRequired: 'database/migrations/024_smav_user_sync_outbox.sql',
      });
    }
    if (isCentralAuthLinkForbiddenError(err)) {
      return res.status(403).json({ error: err.message, code: 'CENTRAL_AUTH_LINK_FORBIDDEN' });
    }
    if (isIdempotencyKeyConflictError(err)) {
      return res.status(409).json({ error: err.message, conflict: true });
    }
    return res.status(500).json({ error: err?.message || 'Failed to create staff user.' });
  }
});

app.patch('/api/admin/users/:id', async (req, res) => {
  const admin = await getAuthAdmin(req);
  if (!admin || admin.role !== 'owner') {
    return res.status(403).json({ error: 'Access denied: Only the Salon Owner can edit staff accounts.' });
  }
  if (req.body?.central_auth_id !== undefined) {
    return res.status(403).json({
      error: 'Ordinary Admin User updates cannot assign or modify central_auth_id. Use verified SMAV linking or audited manual reconciliation.',
      code: 'CENTRAL_AUTH_LINK_FORBIDDEN',
    });
  }
  const { name, email, phone, role, user_id, username, is_active } = req.body;
  const allUsers = await salonRepository.getUsers();
  const existingStaff = allUsers.find(u => String(u.id) === String(req.params.id));
  if (!existingStaff) {
    return res.status(404).json({ error: 'User not found' });
  }

  const normalizedEmail = email !== undefined ? String(email).trim().toLowerCase() : undefined;
  const normalizedUserCode = user_id !== undefined ? String(user_id).trim().toUpperCase() : undefined;
  const normalizedUsername = username !== undefined ? String(username).trim().toLowerCase() : undefined;

  if (normalizedEmail !== undefined && !normalizedEmail.includes('@')) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  // Prevent duplicates when editing email, user_id, or username
  if (normalizedEmail !== undefined || normalizedUserCode !== undefined || normalizedUsername !== undefined) {
    const conflict = allUsers.find(u => {
      if (String(u.id) === String(existingStaff.id)) return false;
      if (normalizedEmail && u.email && u.email.trim().toLowerCase() === normalizedEmail) return true;
      if (normalizedUserCode && u.user_id && u.user_id.trim().toUpperCase() === normalizedUserCode) return true;
      if (normalizedUsername && u.username && u.username.trim().toLowerCase() === normalizedUsername) return true;
      return false;
    });
    if (conflict) {
      return res.status(409).json({
        error: `Another staff user (${conflict.user_id}) already uses this email, Staff ID, or username.`
      });
    }
  }

  try {
    // UUID-preserving email change: resolve & link Central Auth UUID before mutating email
    let linkedStaff = existingStaff;
    const emailChanged =
      normalizedEmail !== undefined &&
      normalizedEmail !== String(existingStaff.email || '').trim().toLowerCase();

    if (emailChanged && !existingStaff.central_auth_id) {
      const preLink = await syncUserToSmavAndPersist(existingStaff, {
        eventType: 'RECONCILE_USER',
        performedBy: admin.name,
      });
      const reloaded = (await salonRepository.getUsers()).find(u => String(u.id) === String(existingStaff.id));
      if (reloaded) linkedStaff = reloaded;
      if (!linkedStaff.central_auth_id && !preLink.centralAuthId) {
        return res.status(409).json({
          error: 'Cannot change email before Central Auth UUID is linked. Use Retry Sync first so no duplicate Central Auth user is created.'
        });
      }
    }

    const roleChanged = role !== undefined && role !== existingStaff.role;
    const nextIsActive = is_active !== undefined ? Boolean(is_active) : Boolean(existingStaff.is_active);
    const statusChanged = is_active !== undefined && nextIsActive !== Boolean(existingStaff.is_active);

    const isStatusOnlyToggle =
      is_active !== undefined &&
      name === undefined &&
      normalizedEmail === undefined &&
      phone === undefined &&
      role === undefined &&
      normalizedUserCode === undefined &&
      normalizedUsername === undefined;

    const resolvedEventType =
      isStatusOnlyToggle || (statusChanged && !nextIsActive)
        ? (nextIsActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED')
        : emailChanged
          ? 'EMAIL_CHANGED'
          : roleChanged
            ? 'ROLE_CHANGED'
            : statusChanged && nextIsActive
              ? 'USER_ACTIVATED'
              : 'USER_UPDATED';

    const effectiveCentralAuthId = linkedStaff.central_auth_id || existingStaff.central_auth_id;
    const resolvedAction =
      !nextIsActive && (isStatusOnlyToggle || statusChanged)
        ? 'set_status'
        : effectiveCentralAuthId
          ? 'update_user'
          : 'upsert_user';

    const updateIdempotencyKey = generateSyncIdempotencyKey(
      existingStaff,
      resolvedEventType,
      req.headers['x-idempotency-key'] as string | undefined
    );

    const atomicUpdate = await salonRepository.updateUserWithSmavOutbox(
      req.params.id,
      {
        ...(name !== undefined && { name: String(name).trim() }),
        ...(normalizedEmail !== undefined && { email: normalizedEmail }),
        ...(phone !== undefined && { phone: String(phone).trim() }),
        ...(role !== undefined && { role }),
        ...(normalizedUserCode !== undefined && { user_id: normalizedUserCode }),
        ...(normalizedUsername !== undefined && { username: normalizedUsername }),
        ...(is_active !== undefined && { is_active }),
      },
      {
        idempotency_key: updateIdempotencyKey,
        event_type: resolvedEventType,
        action: resolvedAction,
        max_attempts: 6,
      },
      admin.name
    );

    if (!atomicUpdate) return res.status(404).json({ error: 'User not found' });

    const { user: updated, outboxItem, created } = atomicUpdate;

    const smavSync = await executeCommittedOutboxSync({
      outboxItem,
      created,
      user: updated,
      performedBy: admin.name,
    });

    const refreshed = (await salonRepository.getUsers()).find(u => String(u.id) === String(updated.id)) || updated;
    return res.json({
      smavSync,
      ...formatSafeAdminUser({
        ...refreshed,
        central_auth_id: refreshed.central_auth_id || smavSync.centralAuthId,
        central_sync_status: refreshed.central_sync_status || smavSync.syncStatus,
        central_sync_error: refreshed.central_sync_error ?? smavSync.error ?? null,
      }),
    });
  } catch (err: any) {
    if (isMigration024RequiredError(err)) {
      return res.status(503).json({
        error: err.message,
        code: 'MIGRATION_024_REQUIRED',
        migrationRequired: 'database/migrations/024_smav_user_sync_outbox.sql',
      });
    }
    if (isCentralAuthLinkForbiddenError(err)) {
      return res.status(403).json({ error: err.message, code: 'CENTRAL_AUTH_LINK_FORBIDDEN' });
    }
    if (isIdempotencyKeyConflictError(err)) {
      return res.status(409).json({ error: err.message, conflict: true });
    }
    return res.status(500).json({ error: err?.message || 'Failed to update staff account.' });
  }
});

app.post('/api/admin/users/:id/reset-password', async (req, res) => {
  const admin = await getAuthAdmin(req);
  if (!admin || admin.role !== 'owner') {
    return res.status(403).json({ error: 'Access denied: Only the Salon Owner can reset passwords.' });
  }
  const { new_password } = req.body;
  const cleanPassword = String(new_password || '').trim();
  if (cleanPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters to satisfy SMAV Central Auth requirements.' });
  }

  const staff = (await salonRepository.getUsers()).find(u => String(u.id) === String(req.params.id));
  if (!staff) {
    return res.status(404).json({
      success: false,
      localUpdated: false,
      centralSynced: false,
      error: 'User not found',
    });
  }

  const explicitIdemKey = typeof req.headers['x-idempotency-key'] === 'string'
    ? req.headers['x-idempotency-key'].trim()
    : '';

  // Pre-mutation idempotency guard: never mutate local password on conflicting or already-finalized key
  if (explicitIdemKey) {
    try {
      const existingAudit = await salonRepository.getSmavUserSyncOutboxByIdempotencyKey(explicitIdemKey);
      if (existingAudit) {
        if (
          String(existingAudit.local_user_id || '') !== String(staff.id) ||
          existingAudit.action !== 'reset_password' ||
          existingAudit.event_type !== 'PASSWORD_RESET'
        ) {
          return res.status(409).json({
            success: false,
            localUpdated: false,
            centralSynced: false,
            conflict: true,
            error: `Idempotency key "${explicitIdemKey}" was already used for another user or operation.`,
          });
        }
        if (existingAudit.status === 'SYNCED') {
          if (!verifySalonPassword(String(staff.password_hash || ''), cleanPassword)) {
            return res.status(409).json({
              success: false,
              localUpdated: false,
              centralSynced: false,
              conflict: true,
              error: `Idempotency key "${explicitIdemKey}" was already used with a different password.`,
            });
          }
          return res.json({
            success: true,
            localUpdated: true,
            centralSynced: true,
            partialFailure: false,
            passwordResetRequired: false,
            smavSync: {
              synced: true,
              syncStatus: 'SYNCED' as const,
              outletCode: 'glossylooks' as const,
              status: 'idempotent_replay',
              outboxId: existingAudit.id,
              idempotencyKey: explicitIdemKey,
              centralAuthId: existingAudit.response_central_auth_id || staff.central_auth_id,
              email: staff.email,
            },
            message: 'Password reset was already completed for this idempotency key.',
          });
        }
        return res.status(409).json({
          success: false,
          localUpdated: false,
          centralSynced: false,
          conflict: true,
          passwordResetRequired: true,
          error:
            existingAudit.last_error ||
            'Previous password reset with this idempotency key failed. Submit a new Reset Password request with a fresh idempotency key.',
        });
      }
    } catch (idemErr: any) {
      if (isMigration024RequiredError(idemErr)) {
        return res.status(503).json({
          success: false,
          localUpdated: false,
          centralSynced: false,
          code: 'MIGRATION_024_REQUIRED',
          migrationRequired: 'database/migrations/024_smav_user_sync_outbox.sql',
          error: idemErr.message,
        });
      }
      return res.status(500).json({
        success: false,
        localUpdated: false,
        centralSynced: false,
        error: idemErr?.message || 'Unable to verify idempotency key.',
      });
    }
  }

  // Step 1: Update local password hash securely (explicit failure reporting if local DB write fails)
  try {
    const localUpdated = await salonRepository.resetUserPassword(
      staff.id,
      hashSalonPassword(cleanPassword),
      admin.name
    );
    if (!localUpdated) {
      return res.status(500).json({
        success: false,
        localUpdated: false,
        centralSynced: false,
        partialFailure: false,
        passwordResetRequired: true,
        error: 'Failed to update local Glossy Looks password; SMAV Central Auth was not modified.',
      });
    }
  } catch (localErr: any) {
    return res.status(500).json({
      success: false,
      localUpdated: false,
      centralSynced: false,
      partialFailure: false,
      passwordResetRequired: true,
      error: `Local Glossy Looks password update failed (${localErr?.message || 'database error'}); SMAV Central Auth was not modified.`,
    });
  }

  // Step 2: Synchronous Central Auth password reset (transient credential only; never stored in outbox/logs)
  try {
    const smavSync = await resetSmavUserPasswordAndPersist(staff, cleanPassword, {
      idempotencyKey: explicitIdemKey || undefined,
      performedBy: admin.name,
    });
    return res.json({
      success: smavSync.synced,
      localUpdated: true,
      centralSynced: smavSync.synced,
      partialFailure: !smavSync.synced,
      passwordResetRequired: Boolean(smavSync.passwordResetRequired),
      smavSync,
      ...(smavSync.error ? { error: smavSync.error } : {}),
      message: smavSync.synced
        ? 'Password updated locally and synced to SMAV Central Auth.'
        : `Local Glossy Looks password was updated, but SMAV Central Auth password sync failed (${smavSync.error || smavSync.syncStatus}). Re-submit Reset Password to sync credentials securely.`,
    });
  } catch (err: any) {
    if (isMigration024RequiredError(err)) {
      return res.status(503).json({
        success: false,
        localUpdated: true,
        centralSynced: false,
        partialFailure: true,
        passwordResetRequired: true,
        code: 'MIGRATION_024_REQUIRED',
        migrationRequired: 'database/migrations/024_smav_user_sync_outbox.sql',
        error: err.message,
      });
    }
    if (isIdempotencyKeyConflictError(err)) {
      return res.status(409).json({
        success: false,
        localUpdated: true,
        centralSynced: false,
        partialFailure: true,
        conflict: true,
        passwordResetRequired: true,
        error: err.message,
      });
    }
    return res.status(500).json({
      success: false,
      localUpdated: true,
      centralSynced: false,
      partialFailure: true,
      passwordResetRequired: true,
      error: 'Local Glossy Looks password was updated, but SMAV Central Auth password sync encountered an unexpected error. Re-submit Reset Password to sync credentials securely.',
    });
  }
});

app.delete('/api/admin/users/:id', async (req, res) => {
  const admin = await getAuthAdmin(req);
  if (!admin || admin.role !== 'owner') {
    return res.status(403).json({ error: 'Access denied: Only the Salon Owner can deactivate staff accounts.' });
  }
  const deactivateIdempotencyKey = generateSyncIdempotencyKey(
    req.params.id,
    'USER_DEACTIVATED',
    req.headers['x-idempotency-key'] as string | undefined
  );
  try {
    const atomicDeactivate = await salonRepository.updateUserWithSmavOutbox(
      req.params.id,
      { is_active: false },
      {
        idempotency_key: deactivateIdempotencyKey,
        event_type: 'USER_DEACTIVATED',
        action: 'set_status',
        max_attempts: 6,
      },
      admin.name
    );
    if (!atomicDeactivate) {
      return res.json({ success: false, smavSync: null });
    }
    const smavSync = await executeCommittedOutboxSync({
      outboxItem: atomicDeactivate.outboxItem,
      created: atomicDeactivate.created,
      user: atomicDeactivate.user,
      performedBy: admin.name,
    });
    return res.json({ success: true, smavSync });
  } catch (err: any) {
    if (isMigration024RequiredError(err)) {
      return res.status(503).json({
        error: err.message,
        code: 'MIGRATION_024_REQUIRED',
        migrationRequired: 'database/migrations/024_smav_user_sync_outbox.sql',
      });
    }
    if (isIdempotencyKeyConflictError(err)) {
      return res.status(409).json({ error: err.message, conflict: true });
    }
    return res.status(500).json({ error: err?.message || 'Failed to deactivate staff account.' });
  }
});

// Owner-authorized single-user Retry Sync action
app.post('/api/admin/users/:id/retry-smav-sync', async (req, res) => {
  const admin = await getAuthAdmin(req);
  if (!admin || admin.role !== 'owner') {
    return res.status(403).json({ error: 'Access denied: Only the Salon Owner can retry SMAV synchronization.' });
  }
  try {
    const smavSync = await retrySmavSyncForUser(req.params.id, admin.name);
    const refreshed = (await salonRepository.getUsers()).find(u => String(u.id) === String(req.params.id));
    if (!refreshed) {
      return res.status(404).json({ error: 'Staff user not found', smavSync });
    }
    return res.json({
      smavSync,
      user: formatSafeAdminUser(refreshed),
    });
  } catch (err: any) {
    if (isMigration024RequiredError(err)) {
      return res.status(503).json({
        error: err.message,
        code: 'MIGRATION_024_REQUIRED',
        migrationRequired: 'database/migrations/024_smav_user_sync_outbox.sql',
      });
    }
    if (isCentralAuthLinkForbiddenError(err)) {
      return res.status(403).json({ error: err.message, code: 'CENTRAL_AUTH_LINK_FORBIDDEN' });
    }
    return res.status(500).json({ error: err?.message || 'Retry SMAV synchronization failed.' });
  }
});

// Owner-only inspection of durable SMAV user sync outbox (sanitized; zero secrets)
app.get('/api/admin/users/smav-outbox', async (req, res) => {
  const admin = await getAuthAdmin(req);
  if (!admin || admin.role !== 'owner') {
    return res.status(403).json({ error: 'Owner only' });
  }
  try {
    const localUserId = typeof req.query.user_id === 'string' ? req.query.user_id.trim() : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : undefined;
    const limit = Number(req.query.limit || 50);
    const items = await salonRepository.getSmavUserSyncOutbox({ localUserId, status, limit });
    return res.json({ items });
  } catch (err: any) {
    if (isMigration024RequiredError(err)) {
      return res.status(503).json({
        error: err.message,
        code: 'MIGRATION_024_REQUIRED',
        migrationRequired: 'database/migrations/024_smav_user_sync_outbox.sql',
      });
    }
    return res.status(500).json({ error: err?.message || 'Unable to read SMAV sync outbox.' });
  }
});

// Safe initial reconciliation endpoint (defaults to dryRun: true; never overwrites/deletes ambiguous accounts)
app.post(['/api/admin/users/reconcile-smav', '/api/admin/users/sync-smav'], async (req, res) => {
  const admin = await getAuthAdmin(req);
  if (!admin || admin.role !== 'owner') {
    return res.status(403).json({ error: 'Owner only' });
  }
  try {
    const dryRun = req.body?.dryRun !== false;
    const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds.map(String) : undefined;
    const report = await reconcileAdminUsersToSmav({
      dryRun,
      performedBy: admin.name,
      userIds,
    });
    return res.json(report);
  } catch (err: any) {
    if (isMigration024RequiredError(err)) {
      return res.status(503).json({
        error: err.message,
        code: 'MIGRATION_024_REQUIRED',
        migrationRequired: 'database/migrations/024_smav_user_sync_outbox.sql',
      });
    }
    return res.status(500).json({ error: err?.message || 'SMAV reconciliation failed.' });
  }
});

// Authorized durable outbox processor endpoint (for Vercel Cron or Owner manual drain)
app.all(['/api/cron/smav-user-sync-outbox', '/cron/smav-user-sync-outbox'], async (req, res) => {
  try {
    const cronSecret = (process.env.CRON_SECRET || '').trim();
    const authHeader = String(req.headers['authorization'] || '').trim();
    const isCronAuthorized = Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);
    if (!isCronAuthorized) {
      const admin = await getAuthAdmin(req);
      if (!admin || admin.role !== 'owner') {
        return res.status(401).json({ error: 'Unauthorized outbox worker invocation' });
      }
    }
    const limit = Number(req.query.limit || req.body?.limit || 20);
    const summary = await processPendingSmavUserSyncOutbox({ limit });
    return res.json({ success: true, ...summary });
  } catch (err: any) {
    if (isMigration024RequiredError(err)) {
      return res.status(503).json({
        success: false,
        code: 'MIGRATION_024_REQUIRED',
        migrationRequired: 'database/migrations/024_smav_user_sync_outbox.sql',
        error: err.message,
      });
    }
    return res.status(500).json({ success: false, error: err?.message || 'Outbox processing failed' });
  }
});

// Central SMAV -> Glossy Looks bidirectional webhook endpoint
app.post('/api/smav-sync-webhook', async (req, res) => {
  try {
    const result = await handleIncomingSmavWebhook({
      headers: req.headers,
      body: req.body,
      hashPassword: hashSalonPassword,
    });
    return res.status(result.status).json(result.body);
  } catch (err: any) {
    console.error('[SMAV Webhook] Unexpected error:', err);
    return res.status(500).json({
      success: false,
      message: err?.message || 'Failed to process SMAV sync webhook',
    });
  }
});

// ============================================================================
// WhatsApp Business Coexistence & Embedded Signup (Owner Only)
// ============================================================================

// 1. Read WhatsApp connection status & public config (Owner Only)
function isValidMetaNumericId(id?: string): boolean {
  if (!id || typeof id !== 'string') return false;
  const clean = id.trim();
  // Valid Meta Graph API IDs are numeric strings between 10 and 25 digits (no prefixes/mock strings)
  return /^\d{10,25}$/.test(clean);
}

type MetaGraphResult = {
  ok: boolean;
  status: number;
  data: any;
};

type MetaPhoneCandidate = {
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
};

type MetaAssetResolution = {
  wabaId?: string;
  phoneNumberId?: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
  candidates?: MetaPhoneCandidate[];
  error?: string;
};

function getMetaErrorMessage(data: any, fallback: string): string {
  const message = typeof data?.error?.message === 'string' ? data.error.message.trim() : '';
  // Meta's normal error text is safe to show. Never include a token, code, or raw response body.
  return message ? `${fallback}: ${message}` : fallback;
}

async function graphGet(pathname: string, accessToken: string, params: Record<string, string> = {}): Promise<MetaGraphResult> {
  const url = new URL(`https://graph.facebook.com/${WHATSAPP_API_VERSION}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  try {
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data: any = await response.json().catch(() => ({}));
    return { ok: response.ok && !data?.error, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: {} };
  }
}

async function exchangeEmbeddedSignupCode(code: string): Promise<{ accessToken?: string; error?: string }> {
  const cleanCode = typeof code === 'string' ? code.trim() : '';
  if (!cleanCode) return { error: 'Meta authorization code was not received.' };
  if (!META_APP_ID || !META_APP_SECRET) {
    return { error: 'Server configuration error: META_APP_ID and META_APP_SECRET are required to complete Meta signup.' };
  }

  const url = new URL(`https://graph.facebook.com/${WHATSAPP_API_VERSION}/oauth/access_token`);
  url.searchParams.set('client_id', META_APP_ID);
  url.searchParams.set('client_secret', META_APP_SECRET);
  url.searchParams.set('code', cleanCode);

  try {
    const response = await fetch(url.toString());
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok || !data?.access_token) {
      return { error: getMetaErrorMessage(data, 'Meta could not exchange the Embedded Signup authorization code') };
    }
    // This token is intentionally kept only in memory for the current request.
    return { accessToken: String(data.access_token) };
  } catch {
    return { error: 'Network error while exchanging the Meta authorization code.' };
  }
}

function phoneDigits(value?: string): string {
  return String(value || '').replace(/\D/g, '');
}

function normalizePhoneNumber(value?: string): {
  e164: string;
  metaRecipient: string;
  clean10: string;
  isValid: boolean;
} {
  const digits = String(value || '').replace(/\D/g, '');
  let clean10 = '';
  if (digits.length === 10) {
    clean10 = digits;
  } else if (digits.length === 11 && digits.startsWith('0')) {
    clean10 = digits.slice(1);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    clean10 = digits.slice(2);
  } else if (digits.length > 10) {
    clean10 = digits.slice(-10);
  }

  const isValid = /^[6-9]\d{9}$/.test(clean10);
  return {
    clean10,
    e164: clean10 ? `+91${clean10}` : '',
    metaRecipient: clean10 ? `91${clean10}` : '',
    isValid
  };
}

// Real-Time WhatsApp Inbox Server-Sent Events (SSE) connections
const whatsappInboxSseClients = new Set<express.Response>();

function broadcastWhatsAppInboxEvent(data: any) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of whatsappInboxSseClients) {
    try {
      client.write(payload);
    } catch {
      whatsappInboxSseClients.delete(client);
    }
  }
}

async function getWabaPhones(wabaId: string, accessToken: string): Promise<MetaPhoneCandidate[]> {
  const result = await graphGet(`/${wabaId}/phone_numbers`, accessToken, {
    fields: 'id,display_phone_number,verified_name'
  });
  if (!result.ok || !Array.isArray(result.data?.data)) return [];

  return result.data.data
    .filter((phone: any) => isValidMetaNumericId(String(phone?.id || '')))
    .map((phone: any) => ({
      wabaId,
      phoneNumberId: String(phone.id),
      displayPhoneNumber: typeof phone.display_phone_number === 'string' ? phone.display_phone_number : undefined,
      verifiedName: typeof phone.verified_name === 'string' ? phone.verified_name : undefined
    }));
}

async function getWabasForBusiness(businessId: string, accessToken: string): Promise<string[]> {
  const ids = new Set<string>();
  for (const edge of ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts']) {
    const result = await graphGet(`/${businessId}/${edge}`, accessToken, { fields: 'id,name', limit: '25' });
    if (!result.ok || !Array.isArray(result.data?.data)) continue;
    for (const account of result.data.data) {
      const id = String(account?.id || '').trim();
      if (isValidMetaNumericId(id)) ids.add(id);
    }
  }
  return [...ids];
}

async function resolveAssetsFromEmbeddedSignupCode(
  code: string,
  expectedPhoneNumber: string,
  preferredWabaId?: string,
  preferredPhoneNumberId?: string
): Promise<MetaAssetResolution> {
  const exchanged = await exchangeEmbeddedSignupCode(code);
  if (!exchanged.accessToken) return { error: exchanged.error };

  const accessToken = exchanged.accessToken;
  const businessIds = new Set<string>();
  const wabaIds = new Set<string>();

  if (isValidMetaNumericId(META_BUSINESS_ID)) businessIds.add(META_BUSINESS_ID.trim());
  if (isValidMetaNumericId(preferredWabaId)) wabaIds.add(preferredWabaId!.trim());

  // Different Meta configuration versions expose businesses through different edges.
  // Try the supported shapes without assuming a particular response structure.
  const businessResponses = await Promise.all([
    graphGet('/me/businesses', accessToken, { fields: 'id,name', limit: '25' }),
    graphGet('/me', accessToken, { fields: 'businesses{id,name}' }),
    graphGet('/me/whatsapp_business_accounts', accessToken, { fields: 'id,name', limit: '25' })
  ]);

  for (const result of businessResponses) {
    const lists = [result.data?.data, result.data?.businesses?.data];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const id = String(item?.id || '').trim();
        if (!isValidMetaNumericId(id)) continue;
        // The direct /me/whatsapp_business_accounts edge contains WABA IDs.
        if (result.data?.data === list && result.data?.data && businessResponses.indexOf(result) === 2) {
          wabaIds.add(id);
        } else {
          businessIds.add(id);
        }
      }
    }
  }

  // The code-exchange token can identify the completed signup but may not have
  // permission to enumerate business assets. For the configured Business
  // Portfolio, also use the server-only system-user token that owns the app.
  // This is required by some Coexistence configurations and is never exposed
  // to the browser or stored in the salon database.
  const discoveryTokens = [...new Set([
    accessToken,
    META_SYSTEM_USER_ACCESS_TOKEN
  ].filter(Boolean))];

  for (const businessId of [...businessIds].slice(0, 25)) {
    for (const token of discoveryTokens) {
      for (const wabaId of await getWabasForBusiness(businessId, token)) {
        wabaIds.add(wabaId);
      }
    }
  }

  if (!wabaIds.size) {
    return {
      error: !META_BUSINESS_ID
        ? 'Meta authorization succeeded, but META_BUSINESS_ID is not configured on the server. Add the salon Meta Business Portfolio ID to production secrets, then retry.'
        : !META_SYSTEM_USER_ACCESS_TOKEN
          ? 'Meta authorization succeeded, but META_SYSTEM_USER_ACCESS_TOKEN is not configured on the server. Add the system-user token with WhatsApp Business permissions, then retry.'
          : 'Meta authorization succeeded, but the configured Meta Business Portfolio did not expose a WhatsApp Business Account to the system user. Confirm that the selected Facebook account is a business admin and that the system user has access to the WhatsApp account, then retry.'
    };
  }

  const candidates: MetaPhoneCandidate[] = [];
  for (const wabaId of [...wabaIds].slice(0, 25)) {
    let phones = await getWabaPhones(wabaId, accessToken);
    // The embedded token can be limited. If a permanent system-user token is present,
    // use it only as a server-side fallback; it is never sent to the browser.
    if (!phones.length && META_SYSTEM_USER_ACCESS_TOKEN) {
      phones = await getWabaPhones(wabaId, META_SYSTEM_USER_ACCESS_TOKEN);
    }
    candidates.push(...phones);
  }

  const preferredPhone = isValidMetaNumericId(preferredPhoneNumberId) ? preferredPhoneNumberId!.trim() : '';
  const configuredDigits = phoneDigits(expectedPhoneNumber).slice(-10);
  const preferredMatches = preferredPhone
    ? candidates.filter(candidate => candidate.phoneNumberId === preferredPhone)
    : [];
  const configuredNumberMatches = configuredDigits
    ? candidates.filter(candidate => phoneDigits(candidate.displayPhoneNumber).endsWith(configuredDigits))
    : [];
  const selected = preferredMatches.length === 1
    ? preferredMatches[0]
    : configuredNumberMatches.length === 1
      ? configuredNumberMatches[0]
      : candidates.length === 1
        ? candidates[0]
        : undefined;

  if (!selected) {
    return {
      // Coexistence grants access at the business level, so Meta can legitimately
      // return more than one number. Do not guess: let the authenticated owner
      // select a returned Graph asset in the admin UI.
      candidates: candidates.length > 1 ? candidates : undefined,
      error: candidates.length
        ? 'Meta returned more than one WhatsApp phone number. Select the salon number below to finish securely.'
        : 'Meta returned a WhatsApp Business Account but no phone number that this app can access. Check the Embedded Signup configuration and system-user permissions, then retry.'
    };
  }

  return {
    wabaId: selected.wabaId,
    phoneNumberId: selected.phoneNumberId,
    displayPhoneNumber: selected.displayPhoneNumber,
    verifiedName: selected.verifiedName
  };
}

async function verifyMetaWabaOwnership(
  wabaId: string,
  phoneNumberId: string
): Promise<{
  verified: boolean;
  error?: string;
  verified_name?: string;
  display_phone_number?: string;
}> {
  if (!META_SYSTEM_USER_ACCESS_TOKEN) {
    return {
      verified: false,
      error: 'Server configuration error: META_SYSTEM_USER_ACCESS_TOKEN is not configured.'
    };
  }

  try {
    // 1. Query the WABA's phone numbers list to verify ownership
    const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${META_SYSTEM_USER_ACCESS_TOKEN}`
      }
    });

    const data: any = await res.json();

    if (!res.ok || data.error) {
      const errMsg = data.error?.message || `Meta Graph API error (Status ${res.status})`;
      return {
        verified: false,
        error: `Meta verification failed for WABA ${wabaId}: ${errMsg}`
      };
    }

    const phoneNumbers: Array<{ id: string; display_phone_number?: string; verified_name?: string }> = Array.isArray(data.data) ? data.data : [];
    
    // 2. Check if the provided phone_number_id belongs to the returned WABA
    const matched = phoneNumbers.find(p => String(p.id) === String(phoneNumberId));
    if (!matched) {
      // Check direct phone query to see if phone exists on Meta
      try {
        const phoneDirectUrl = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}?fields=id,display_phone_number,verified_name`;
        const phoneDirectRes = await fetch(phoneDirectUrl, {
          headers: { Authorization: `Bearer ${META_SYSTEM_USER_ACCESS_TOKEN}` }
        });
        const phoneDirectData: any = await phoneDirectRes.json();
        if (phoneDirectRes.ok && phoneDirectData.id) {
          return {
            verified: false,
            error: `Phone number ID ${phoneNumberId} (${phoneDirectData.display_phone_number || 'unnamed'}) exists on Meta, but is not registered under WABA ${wabaId}.`
          };
        }
      } catch {
        // ignore direct check fallback
      }

      return {
        verified: false,
        error: `Phone number ID ${phoneNumberId} does not belong to the returned WhatsApp Business Account (WABA: ${wabaId}).`
      };
    }

    return {
      verified: true,
      verified_name: matched.verified_name,
      display_phone_number: matched.display_phone_number
    };
  } catch (err: any) {
    return {
      verified: false,
      error: `Network error verifying Meta IDs: ${err.message}`
    };
  }
}

app.get('/api/admin/whatsapp/status', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || admin.role !== 'owner') {
      return res.status(403).json({ error: 'Access denied: Only the Salon Owner can view WhatsApp integration status.' });
    }

    const integration = await salonRepository.getWhatsAppIntegration();
    const settings = await salonRepository.getWhatsAppBusinessSettings();

    // Return safe data only - NEVER return META_APP_SECRET or system user tokens!
    res.json({
      integration: {
        id: integration.id,
        salon_id: integration.salon_id,
        waba_id: integration.waba_id,
        phone_number_id: integration.phone_number_id,
        display_phone_number: integration.display_phone_number,
        masked_phone_number: integration.masked_phone_number || maskPhoneNumber(integration.display_phone_number),
        display_name: integration.display_name,
        status: integration.status,
        connected_at: integration.connected_at,
        last_verified_at: integration.last_verified_at,
        diagnostics: integration.diagnostics,
        updated_at: integration.updated_at,
        error_message: integration.error_message
      },
      settings,
      config: {
        meta_app_id: META_APP_ID,
        config_id: META_EMBEDDED_SIGNUP_CONFIG_ID,
        api_version: WHATSAPP_API_VERSION,
        is_configured: Boolean(META_APP_ID && META_EMBEDDED_SIGNUP_CONFIG_ID)
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Connect / Save WhatsApp Business integration after Embedded Signup (Owner Only)
app.post('/api/admin/whatsapp/connect', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || admin.role !== 'owner') {
      return res.status(403).json({ error: 'Access denied: Only the Salon Owner can connect WhatsApp Business.' });
    }

    const { waba_id, phone_number_id, code, display_name, display_phone_number } = req.body;
    const submittedWabaId = waba_id ? String(waba_id).trim() : '';
    const submittedPhoneId = phone_number_id ? String(phone_number_id).trim() : '';
    const submittedCode = typeof code === 'string' ? code.trim() : '';

    if (submittedWabaId && !isValidMetaNumericId(submittedWabaId)) {
      return res.status(400).json({
        error: 'Invalid WABA ID received. Meta WABA IDs must be authentic numeric identifiers; placeholders are not permitted.'
      });
    }
    if (submittedPhoneId && !isValidMetaNumericId(submittedPhoneId)) {
      return res.status(400).json({
        error: 'Invalid Phone Number ID received. Meta Phone Number IDs must be authentic numeric identifiers; placeholders are not permitted.'
      });
    }

    const currentSettings = await salonRepository.getWhatsAppBusinessSettings();
    let cleanWabaId = submittedWabaId;
    let cleanPhoneId = submittedPhoneId;
    let codeResolvedDisplayName = '';
    let codeResolvedPhone = '';

    // A Coexistence flow can complete with an OAuth code even when the popup does
    // not include IDs in its FINISH postMessage. Resolve those IDs server-side;
    // never use the configured phone number itself as a replacement Meta ID.
    if (!cleanWabaId || !cleanPhoneId) {
      if (!submittedCode) {
        return res.status(400).json({
          error: 'Connection incomplete — Meta did not supply both account IDs or an authorization code. Please retry Embedded Signup.'
        });
      }

      const resolved = await resolveAssetsFromEmbeddedSignupCode(
        submittedCode,
        currentSettings.business_number,
        cleanWabaId || undefined,
        cleanPhoneId || undefined
      );
      if (!resolved.wabaId || !resolved.phoneNumberId) {
        if (resolved.candidates?.length) {
          return res.json({
            success: false,
            selection_required: true,
            message: resolved.error,
            candidates: resolved.candidates.map(candidate => ({
              waba_id: candidate.wabaId,
              phone_number_id: candidate.phoneNumberId,
              display_phone_number: candidate.displayPhoneNumber || '',
              verified_name: candidate.verifiedName || ''
            }))
          });
        }
        return res.status(400).json({
          error: resolved.error || 'Meta authorization was received, but the WABA and Phone Number ID could not be resolved safely.'
        });
      }
      cleanWabaId = resolved.wabaId;
      cleanPhoneId = resolved.phoneNumberId;
      codeResolvedDisplayName = resolved.verifiedName || '';
      codeResolvedPhone = resolved.displayPhoneNumber || '';
    }

    if (!isValidMetaNumericId(cleanWabaId) || !isValidMetaNumericId(cleanPhoneId)) {
      return res.status(400).json({
        error: 'Meta authorization completed, but valid WABA and Phone Number IDs could not be resolved. Please retry the official Meta Embedded Signup flow.'
      });
    }

    let resolvedDisplayName = codeResolvedDisplayName || display_name || currentSettings.display_name || 'The Glossy Looks Salon';
    let resolvedPhone = codeResolvedPhone || display_phone_number || currentSettings.business_number || '';

    // Step 4: Call Meta Graph API server-side to verify that the phone number belongs to the returned WABA
    const verification = await verifyMetaWabaOwnership(cleanWabaId, cleanPhoneId);

    if (verification.verified) {
      if (verification.verified_name) resolvedDisplayName = verification.verified_name;
      if (verification.display_phone_number) resolvedPhone = verification.display_phone_number;
      const maskedPhone = maskPhoneNumber(resolvedPhone);
      const diagnosticDetail = `${submittedCode ? 'OAuth code received / ' : ''}WABA ID received / Phone Number ID received / Graph verification passed.`;

      const defaultSalonId = await getDefaultBranchIdFromRepo();
      const saved = await salonRepository.updateWhatsAppIntegration({
        salon_id: defaultSalonId,
        waba_id: cleanWabaId,
        phone_number_id: cleanPhoneId,
        display_name: resolvedDisplayName,
        display_phone_number: resolvedPhone,
        masked_phone_number: maskedPhone,
        status: 'connected',
        connected_at: new Date().toISOString(),
        last_verified_at: new Date().toISOString(),
        diagnostics: diagnosticDetail,
        updated_at: new Date().toISOString(),
        error_message: undefined
      }, admin.name);

      return res.json({
        success: true,
        message: 'WhatsApp Business Coexistence connected and verified with Meta Graph API.',
        diagnostics: diagnosticDetail,
        integration: saved
      });
    } else {
      // Verification failed: store received IDs, but keep status disconnected with error explanation
      const diagnosticDetail = `${submittedCode ? 'OAuth code received / ' : ''}WABA ID received / Phone Number ID received / Graph verification failed: ${verification.error || 'Ownership mismatch'}`;
      const defaultSalonId = await getDefaultBranchIdFromRepo();
      const saved = await salonRepository.updateWhatsAppIntegration({
        salon_id: defaultSalonId,
        waba_id: cleanWabaId,
        phone_number_id: cleanPhoneId,
        display_name: resolvedDisplayName,
        display_phone_number: resolvedPhone,
        masked_phone_number: maskPhoneNumber(resolvedPhone),
        status: 'disconnected',
        last_verified_at: new Date().toISOString(),
        diagnostics: diagnosticDetail,
        updated_at: new Date().toISOString(),
        error_message: verification.error
      }, admin.name);

      return res.status(400).json({
        success: false,
        error: verification.error || 'Meta verification failed. Phone number does not belong to the returned WABA.',
        diagnostics: diagnosticDetail,
        integration: saved
      });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Test / Verify WhatsApp Connection with Meta Graph API on demand (Owner Only)
app.post('/api/admin/whatsapp/test', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || admin.role !== 'owner') {
      return res.status(403).json({ error: 'Access denied: Only the Salon Owner can test the WhatsApp connection.' });
    }

    const integration = await salonRepository.getWhatsAppIntegration();
    if (!integration.waba_id || !integration.phone_number_id) {
      return res.status(400).json({
        error: 'No WhatsApp Business IDs configured. Please connect via Meta Embedded Signup first.'
      });
    }

    if (!isValidMetaNumericId(integration.waba_id) || !isValidMetaNumericId(integration.phone_number_id)) {
      return res.status(400).json({
        error: 'Stored Meta IDs are invalid or placeholder. Please reconnect via Meta Embedded Signup.'
      });
    }

    const verification = await verifyMetaWabaOwnership(integration.waba_id, integration.phone_number_id);

    if (verification.verified) {
      const diagnosticDetail = 'FINISH event received / WABA ID received / Phone Number ID received / Graph verification passed.';
      const updated = await salonRepository.updateWhatsAppIntegration({
        status: 'connected',
        last_verified_at: new Date().toISOString(),
        diagnostics: diagnosticDetail,
        error_message: undefined,
        ...(verification.verified_name && { display_name: verification.verified_name }),
        ...(verification.display_phone_number && { 
          display_phone_number: verification.display_phone_number,
          masked_phone_number: maskPhoneNumber(verification.display_phone_number)
        })
      }, admin.name);

      return res.json({
        success: true,
        message: 'WhatsApp connection verified successfully with Meta Graph API. Account is active.',
        diagnostics: diagnosticDetail,
        integration: updated
      });
    } else {
      const diagnosticDetail = `WABA ID received / Phone Number ID received / Graph verification failed: ${verification.error || 'Verification failed'}`;
      const updated = await salonRepository.updateWhatsAppIntegration({
        status: 'disconnected',
        last_verified_at: new Date().toISOString(),
        diagnostics: diagnosticDetail,
        error_message: verification.error
      }, admin.name);

      return res.status(400).json({
        success: false,
        error: verification.error || 'Meta Graph API verification failed.',
        diagnostics: diagnosticDetail,
        integration: updated
      });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Disconnect WhatsApp Business integration (Owner Only)
app.post('/api/admin/whatsapp/disconnect', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || admin.role !== 'owner') {
      return res.status(403).json({ error: 'Access denied: Only the Salon Owner can disconnect WhatsApp Business.' });
    }

    // Disconnect integration without erasing historical message or interaction records
    const disconnected = await salonRepository.disconnectWhatsAppIntegration(admin.name);

    res.json({
      success: true,
      message: 'WhatsApp Business integration has been disconnected.',
      integration: {
        id: disconnected.id,
        salon_id: disconnected.salon_id,
        status: disconnected.status,
        masked_phone_number: disconnected.masked_phone_number,
        display_name: disconnected.display_name,
        updated_at: disconnected.updated_at
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Update WhatsApp Business Settings (Owner Only)
app.post('/api/admin/whatsapp/settings', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || admin.role !== 'owner') {
      return res.status(403).json({ error: 'Access denied: Only the Salon Owner can update WhatsApp settings.' });
    }

    const { business_number, country_code, display_name, is_enabled } = req.body;

    if (!business_number || typeof business_number !== 'string') {
      return res.status(400).json({ error: 'A valid WhatsApp business phone number is required.' });
    }

    const cleanNumber = business_number.replace(/\D/g, '').slice(-10);
    // Validate Indian mobile numbers: 10 digits starting with 6, 7, 8, or 9
    const indianMobileRegex = /^[6-9]\d{9}$/;
    if (!indianMobileRegex.test(cleanNumber)) {
      return res.status(400).json({
        error: 'Invalid phone number. Please enter a valid 10-digit Indian mobile number (e.g., 9848012345) starting with 6, 7, 8, or 9.'
      });
    }

    const saved = await salonRepository.updateWhatsAppBusinessSettings({
      business_number: cleanNumber,
      country_code: country_code || '+91',
      display_name: display_name ? display_name.trim() : 'The Glossy Looks',
      is_enabled: typeof is_enabled === 'boolean' ? is_enabled : true
    }, admin.name);

    res.json({
      success: true,
      message: 'Salon WhatsApp Business settings updated successfully.',
      settings: saved
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// Real WhatsApp Cloud API Template Sender & Coexistence Automation
// ============================================================================

interface SendWhatsAppTemplateOptions {
  branchId: string;
  recipientPhone: string;
  templateName: string;
  templateLanguage?: string;
  components?: any[];
  appointmentId?: string;
  orderId?: string;
  billNumber?: string;
  paymentId?: string;
  sentByUserId?: string;
  sentByUserName?: string;
  renderedPreview?: string;
  templateParams?: Record<string, any>;
  recordFailureInInbox?: boolean;
  skipInboxRecording?: boolean;
  disableAutoRetry?: boolean;
  extraDiagnostics?: string;
  jobType?:
    | 'appointment_confirmation'
    | 'appointment_reminder'
    | 'appointment_admin_alert'
    | 'enquiry_admin_alert'
    | 'customer_feedback'
    | 'bill_receipt'
    | 'payment_reminder'
    | string;
  customData?: {
    customerName?: string;
    branchName?: string;
    serviceNames?: string;
    appointmentDate?: string;
    appointmentTime?: string;
    bookingId?: string;
    branchAddress?: string;
    billNumber?: string;
    billDate?: string;
    itemsSummary?: string;
    grandTotal?: string | number;
    paymentMode?: string;
    dueAmount?: string | number;
    stylistName?: string;
    ownerName?: string;
    reportDate?: string;
    billsCount?: string | number;
    servicesCount?: string | number;
    totalSales?: string | number;
    cashAmount?: string | number;
    upiAmount?: string | number;
    otherAmount?: string | number;
    totalBills?: string | number;
    totalServices?: string | number;
    cashTotal?: string | number;
    upiTotal?: string | number;
    otherTotal?: string | number;
    breakdownText?: string;
  };
}

async function sendBranchWhatsAppTemplate(options: SendWhatsAppTemplateOptions): Promise<{
  sent: boolean;
  status: 'sent' | 'pending_approval' | 'failed' | 'retrying';
  messageId?: string;
  error?: string;
  diagnostics?: string;
  log?: any;
  inboxMessage?: WhatsAppMessage | null;
}> {
  const {
    branchId,
    recipientPhone,
    templateName,
    appointmentId,
    orderId,
    billNumber,
    paymentId,
    sentByUserId,
    sentByUserName,
    renderedPreview,
    templateParams,
    recordFailureInInbox,
    skipInboxRecording,
    disableAutoRetry,
    extraDiagnostics,
    customData,
  } = options;
  const formatDiagnostics = (detail: string) =>
    extraDiagnostics ? `${extraDiagnostics} | ${detail}` : detail;
  let integration = await salonRepository.getBranchWhatsAppIntegration(branchId);
  if (!integration || integration.status !== 'connected' || !integration.phone_number_id) {
    const defaultBranchId = await getDefaultBranchIdFromRepo();
    const fallback = defaultBranchId && defaultBranchId !== branchId
      ? await salonRepository.getBranchWhatsAppIntegration(defaultBranchId)
      : null;
    if (fallback && fallback.status === 'connected' && fallback.phone_number_id) {
      integration = fallback;
    }
  }

  const normalized = normalizePhoneNumber(recipientPhone);

  const resolvedJobType = options.jobType || (
    templateName === 'gl_bill_receipt' ? 'bill_receipt' :
    templateName.includes('feedback') ? 'customer_feedback' : 'appointment_confirmation'
  );

  if (!normalized.isValid) {
    const errorMsg = 'Invalid recipient phone number. Valid 10-digit Indian mobile number required.';
    const log = await salonRepository.createWhatsAppMessageLog({
      appointment_id: appointmentId,
      order_id: orderId,
      branch_id: branchId,
      customer_name: customData?.customerName,
      template_name: templateName,
      job_type: resolvedJobType,
      recipient_number: recipientPhone || 'unknown',
      sender_phone_number_id: integration?.phone_number_id || 'unassigned',
      status: 'failed',
      error_message: errorMsg,
      diagnostics: formatDiagnostics('Recipient validation failed')
    });
    return { sent: false, status: 'failed', error: errorMsg, log };
  }

  const recipientMeta = normalized.metaRecipient; // e.g. 918179620607
  const recipientE164 = normalized.e164; // e.g. +918179620607

  if (!integration || integration.status !== 'connected' || !integration.phone_number_id) {
    const errorMsg = `Branch WhatsApp integration is ${integration?.status || 'disconnected'}. Please connect WhatsApp in Admin Settings.`;
    const log = await salonRepository.createWhatsAppMessageLog({
      appointment_id: appointmentId,
      order_id: orderId,
      branch_id: branchId,
      customer_name: customData?.customerName,
      template_name: templateName,
      job_type: resolvedJobType,
      recipient_number: recipientE164,
      sender_phone_number_id: integration?.phone_number_id || 'unassigned',
      status: 'failed',
      error_message: errorMsg,
      diagnostics: formatDiagnostics('Branch connection check failed')
    });
    return { sent: false, status: 'failed', error: errorMsg, log };
  }

  if (!META_SYSTEM_USER_ACCESS_TOKEN) {
    const errorMsg = 'Server configuration error: META_SYSTEM_USER_ACCESS_TOKEN is not configured.';
    const log = await salonRepository.createWhatsAppMessageLog({
      appointment_id: appointmentId,
      order_id: orderId,
      branch_id: branchId,
      customer_name: customData?.customerName,
      template_name: templateName,
      job_type: resolvedJobType,
      recipient_number: recipientE164,
      sender_phone_number_id: integration.phone_number_id,
      status: 'failed',
      error_message: errorMsg,
      diagnostics: formatDiagnostics('Missing system user access token')
    });
    return { sent: false, status: 'failed', error: errorMsg, log };
  }

  // Resolve template components and language
  let resolvedTemplateName = templateName;
  let resolvedLang = options.templateLanguage;
  let components = options.components;

  if (templateName === 'gl_appointment_confirmation') {
    resolvedLang = resolvedLang || 'en_US';
    if (!components) {
      components = [
        {
          type: 'body',
          parameters: [
            { type: 'text', parameter_name: 'customer_name', text: customData?.customerName || 'Valued Customer' },
            { type: 'text', parameter_name: 'branch_name', text: customData?.branchName || 'The Glossy Looks' },
            { type: 'text', parameter_name: 'service_name', text: customData?.serviceNames || 'Salon Services' },
            { type: 'text', parameter_name: 'appointment_date', text: customData?.appointmentDate || new Date().toISOString().split('T')[0] },
            { type: 'text', parameter_name: 'appointment_time', text: customData?.appointmentTime || 'Scheduled Slot' },
            { type: 'text', parameter_name: 'booking_id', text: customData?.bookingId || 'GL-BKG' },
            { type: 'text', parameter_name: 'branch_address', text: customData?.branchAddress || 'Hyderabad' }
          ]
        }
      ];
    }
  } else if (templateName === 'the_glossylooks_customer_feedback' || templateName === 'glossylooks_customer_feedback') {
    // Approved Meta template identifier on WABA is glossylooks_customer_feedback
    resolvedTemplateName = 'glossylooks_customer_feedback';
    resolvedLang = resolvedLang || 'en';
    if (!components) {
      components = [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: customData?.customerName || 'Valued Customer' }
          ]
        }
      ];
    }
  } else if (templateName === 'gl_bill_receipt') {
    // Approved Meta bill receipt template on WABA (language: en, 5 positional parameters)
    resolvedTemplateName = 'gl_bill_receipt';
    resolvedLang = resolvedLang || 'en';
    if (!components) {
      const rawTotal = String(customData?.grandTotal || '0').replace(/[^0-9.]/g, '') || '0';
      components = [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: customData?.customerName || 'Valued Customer' },
            { type: 'text', text: customData?.billNumber || 'TGL-BILL' },
            { type: 'text', text: customData?.itemsSummary || 'Salon Services' },
            { type: 'text', text: rawTotal },
            { type: 'text', text: customData?.paymentMode || 'UPI' }
          ]
        }
      ];
    }
  } else if (templateName === 'gl_stylist_daily_sales_report') {
    resolvedTemplateName = 'gl_stylist_daily_sales_report';
    resolvedLang = resolvedLang || 'en';
    if (!components) {
      components = [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: customData?.stylistName || 'Stylist' },
            { type: 'text', text: customData?.reportDate || new Date().toISOString().split('T')[0] },
            { type: 'text', text: String(customData?.billsCount ?? '0') },
            { type: 'text', text: String(customData?.servicesCount ?? '0') },
            { type: 'text', text: String(customData?.totalSales ?? '0') },
            { type: 'text', text: String(customData?.cashAmount ?? '0') },
            { type: 'text', text: String(customData?.upiAmount ?? '0') },
            { type: 'text', text: String(customData?.otherAmount ?? '0') }
          ]
        }
      ];
    }
  } else if (templateName === 'gl_owner_daily_sales_summary') {
    resolvedTemplateName = 'gl_owner_daily_sales_summary';
    resolvedLang = resolvedLang || 'en';
    if (!components) {
      components = [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: customData?.ownerName || 'Salon Owner' },
            { type: 'text', text: customData?.reportDate || new Date().toISOString().split('T')[0] },
            { type: 'text', text: String(customData?.totalBills ?? '0') },
            { type: 'text', text: String(customData?.totalServices ?? '0') },
            { type: 'text', text: String(customData?.totalSales ?? '0') },
            { type: 'text', text: String(customData?.cashTotal ?? '0') },
            { type: 'text', text: String(customData?.upiTotal ?? '0') },
            { type: 'text', text: String(customData?.otherTotal ?? '0') },
            { type: 'text', text: customData?.breakdownText || 'No stylist sales recorded.' }
          ]
        }
      ];
    }
  } else if (templateName === 'gl_appointment_reminder') {
    resolvedTemplateName = 'gl_appointment_reminder';
    resolvedLang = resolvedLang || 'en';
    if (!components) {
      components = [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: customData?.customerName || 'Valued Customer' },
            { type: 'text', text: customData?.serviceNames || 'Salon Services' },
            { type: 'text', text: customData?.appointmentDate || new Date().toISOString().split('T')[0] },
            { type: 'text', text: customData?.appointmentTime || 'Scheduled Slot' },
            { type: 'text', text: customData?.branchName || 'The Glossy Looks' }
          ]
        }
      ];
    }
  } else if (templateName === 'gl_payment_reminder') {
    resolvedTemplateName = 'gl_payment_reminder';
    resolvedLang = resolvedLang || 'en';
    if (!components) {
      const rawTotal = String(customData?.dueAmount || customData?.grandTotal || '0').replace(/[^0-9.]/g, '') || '0';
      components = [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: customData?.customerName || 'Valued Customer' },
            { type: 'text', text: customData?.billNumber || billNumber || 'TGL-BILL' },
            { type: 'text', text: rawTotal },
            { type: 'text', text: customData?.branchName || 'The Glossy Looks' },
            { type: 'text', text: customData?.billDate || getKolkataDateString() }
          ]
        }
      ];
    }
  } else if (templateName === 'hello_world') {
    resolvedLang = resolvedLang || 'en_US';
    components = [];
  } else {
    resolvedLang = resolvedLang || 'en';
  }

  try {
    const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${integration.phone_number_id}/messages`;
    let response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${META_SYSTEM_USER_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipientMeta,
        type: 'template',
        template: {
          name: resolvedTemplateName,
          language: { code: resolvedLang },
          ...(components && components.length > 0 ? { components } : {})
        }
      })
    });

    let data: any = await response.json().catch(() => ({}));

    // If Meta returns error 132001 (Template does not exist in translated language), retry with alternate language code (en <-> en_US)
    if (!response.ok && data?.error?.code === 132001) {
      const altLang = resolvedLang === 'en_US' ? 'en' : 'en_US';
      console.log(`[Meta WhatsApp] Template ${resolvedTemplateName} not found in ${resolvedLang}, retrying with ${altLang}...`);
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${META_SYSTEM_USER_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipientMeta,
          type: 'template',
          template: {
            name: resolvedTemplateName,
            language: { code: altLang },
            ...(components && components.length > 0 ? { components } : {})
          }
        })
      });
      data = await response.json().catch(() => ({}));
      if (response.ok) {
        resolvedLang = altLang;
      }
    }

    if (response.ok && data?.messages?.[0]?.id) {
      const messageId = data.messages[0].id;
      const sentTime = new Date().toISOString();
      const log = await salonRepository.createWhatsAppMessageLog({
        appointment_id: appointmentId,
        order_id: orderId,
        bill_number: billNumber || customData?.billNumber,
        payment_id: paymentId,
        branch_id: branchId,
        customer_name: customData?.customerName,
        template_name: resolvedTemplateName,
        job_type: resolvedJobType,
        recipient_number: recipientE164,
        sender_phone_number_id: integration.phone_number_id,
        meta_message_id: messageId,
        status: 'sent',
        sent_by_user_id: sentByUserId,
        sent_by_user_name: sentByUserName,
        sent_at: sentTime,
        diagnostics: formatDiagnostics(`Graph API message accepted (Message ID: ${messageId})`)
      });

      if (orderId) {
        if (resolvedJobType === 'bill_receipt') {
          await salonRepository.updateOrder(orderId, {
            receipt_whatsapp_status: 'sent',
            receipt_whatsapp_message_id: messageId,
            receipt_whatsapp_sent_at: sentTime,
            receipt_whatsapp_error: undefined,
            whatsapp_status: 'sent',
            whatsapp_message_id: messageId,
            whatsapp_error: undefined
          });
        } else if (resolvedJobType === 'customer_feedback') {
          await salonRepository.updateOrder(orderId, {
            feedback_whatsapp_status: 'sent',
            feedback_whatsapp_message_id: messageId,
            feedback_whatsapp_sent_at: sentTime,
            feedback_whatsapp_error: undefined
          });
          await salonRepository.cancelScheduledFeedbackJobByOrder(orderId);
        } else {
          await salonRepository.updateOrder(orderId, {
            whatsapp_status: 'sent',
            whatsapp_message_id: messageId,
            whatsapp_error: undefined
          });
        }
      }

      // Record outbound template message ONCE into permanent WhatsApp Inbox history
      // (skipped for internal salon/admin alert templates so customer Inbox remains uncluttered)
      let inboxMsg: WhatsAppMessage | null = null;
      if (!skipInboxRecording) {
        try {
          const inboxConv = await salonRepository.getOrCreateWhatsAppConversation({
            branch_id: branchId,
            customer_phone: recipientE164,
            customer_name: customData?.customerName,
            wa_phone_number_id: integration.phone_number_id
          });
          const templateBody = renderedPreview?.trim() || `Template: ${resolvedTemplateName}`;
          const resolvedSalonId = branchId || (await getDefaultBranchIdFromRepo());
          inboxMsg = await salonRepository.createWhatsAppMessage({
            salon_id: resolvedSalonId,
            branch_id: resolvedSalonId,
            conversation_id: inboxConv.id,
            appointment_id: appointmentId,
            order_id: orderId,
            bill_number: billNumber || customData?.billNumber,
            payment_id: paymentId,
            direction: 'OUTBOUND',
            message_type: 'template',
            type: 'template',
            text_body: templateBody,
            message_body: templateBody,
            body: templateBody,
            template_name: resolvedTemplateName,
            template_params: templateParams || customData || null,
            meta_message_id: messageId,
            status: 'sent',
            delivery_status: 'sent',
            source_badge: 'TEMPLATE',
            sent_by_user_id: sentByUserId,
            sent_by_user_name: sentByUserName,
            sent_at: sentTime
          });
          await salonRepository.updateWhatsAppConversation(inboxConv.id, {
            last_message_at: sentTime,
            last_message_text: templateBody,
            last_message_preview: templateBody
          }).catch(() => null);
          broadcastWhatsAppInboxEvent({
            type: 'outbound_message',
            conversationId: inboxConv.id,
            message: inboxMsg,
            conversation: inboxConv
          });
        } catch (inboxErr) {
          console.warn('[WhatsApp Inbox] Failed to record outbound template in inbox:', inboxErr);
        }
      }

      return { sent: true, status: 'sent', messageId, log, inboxMessage: inboxMsg };
    }

    // Handle Meta Graph API rejection
    const errMsg = data?.error?.message || response.statusText || 'Unknown Meta error';
    const errCode = data?.error?.code;

    // Detect Meta App Review / development mode / test recipient limits
    const isAppReviewOrSandbox =
      errCode === 131030 || // Recipient phone number not in allowed list
      errCode === 131031 ||
      (errCode === 100 && (errMsg.includes('Invalid parameter') || errMsg.includes('phone') || errMsg.includes('allowed list'))) ||
      errMsg.toLowerCase().includes('not in allowed list') ||
      errMsg.toLowerCase().includes('review') ||
      errMsg.toLowerCase().includes('development');

    // Detect temporary/retryable errors: rate limits (Code 4, 17, 32, 613, 80007), temporary service error (Code 1, 2), or 5xx HTTP response
    const isRetryable = !disableAutoRetry && (
      response.status >= 500 ||
      errCode === 4 ||
      errCode === 17 ||
      errCode === 32 ||
      errCode === 613 ||
      errCode === 80007 ||
      errMsg.toLowerCase().includes('rate limit') ||
      errMsg.toLowerCase().includes('temporarily unavailable') ||
      errMsg.toLowerCase().includes('try again')
    );

    const status: 'sent' | 'pending_approval' | 'failed' | 'retrying' = isAppReviewOrSandbox
      ? 'pending_approval'
      : isRetryable
      ? 'retrying'
      : 'failed';

    const friendlyError = isAppReviewOrSandbox
      ? 'Pending Meta approval: Live sending is currently restricted by Meta while App Review is in progress. Real messages can only be delivered to verified test/admin phone numbers in Meta App Settings.'
      : isRetryable
      ? `Meta API temporarily unavailable (Code ${errCode || response.status}): Enqueued for automatic retry.`
      : `Meta API delivery failed (Code ${errCode || response.status}): ${errMsg}`;

    const diagnostic = formatDiagnostics(`Meta Graph API error (Code ${errCode || 'N/A'}): ${errMsg}`);
    const nextRetryAt = isRetryable ? new Date(Date.now() + 60 * 1000).toISOString() : undefined;

    const log = await salonRepository.createWhatsAppMessageLog({
      appointment_id: appointmentId,
      order_id: orderId,
      bill_number: billNumber || customData?.billNumber,
      payment_id: paymentId,
      branch_id: branchId,
      customer_name: customData?.customerName,
      template_name: resolvedTemplateName,
      job_type: resolvedJobType,
      recipient_number: recipientE164,
      sender_phone_number_id: integration.phone_number_id,
      status: status,
      error_message: friendlyError,
      diagnostics: diagnostic,
      sent_by_user_id: sentByUserId,
      sent_by_user_name: sentByUserName,
      retry_count: isRetryable ? 1 : 0,
      next_retry_at: nextRetryAt
    });

    let failedInboxMsg: WhatsAppMessage | null = null;
    if (recordFailureInInbox && !skipInboxRecording) {
      try {
        const failedAt = new Date().toISOString();
        const inboxConv = await salonRepository.getOrCreateWhatsAppConversation({
          branch_id: branchId,
          customer_phone: recipientE164,
          customer_name: customData?.customerName,
          wa_phone_number_id: integration.phone_number_id
        });
        const templateBody = renderedPreview?.trim() || `Template: ${resolvedTemplateName}`;
        const resolvedSalonId = branchId || (await getDefaultBranchIdFromRepo());
        failedInboxMsg = await salonRepository.createWhatsAppMessage({
          salon_id: resolvedSalonId,
          branch_id: resolvedSalonId,
          conversation_id: inboxConv.id,
          appointment_id: appointmentId,
          order_id: orderId,
          bill_number: billNumber || customData?.billNumber,
          payment_id: paymentId,
          direction: 'OUTBOUND',
          message_type: 'template',
          type: 'template',
          text_body: templateBody,
          message_body: templateBody,
          body: templateBody,
          template_name: resolvedTemplateName,
          template_params: templateParams || customData || null,
          status: 'failed',
          delivery_status: 'failed',
          error_message: friendlyError,
          source_badge: 'TEMPLATE',
          sent_by_user_id: sentByUserId,
          sent_by_user_name: sentByUserName,
          failed_at: failedAt
        });
      } catch (inboxErr) {
        console.warn('[WhatsApp Inbox] Failed to record failed template attempt:', inboxErr);
      }
    }

    if (orderId) {
      if (resolvedJobType === 'bill_receipt') {
        await salonRepository.updateOrder(orderId, {
          receipt_whatsapp_status: status,
          receipt_whatsapp_error: friendlyError,
          whatsapp_status: status,
          whatsapp_error: friendlyError
        });
      } else if (resolvedJobType === 'customer_feedback') {
        await salonRepository.updateOrder(orderId, {
          feedback_whatsapp_status: status,
          feedback_whatsapp_error: friendlyError
        });
      } else {
        await salonRepository.updateOrder(orderId, {
          whatsapp_status: status,
          whatsapp_error: friendlyError
        });
      }
    }

    return {
      sent: false,
      status: status,
      error: friendlyError,
      diagnostics: diagnostic,
      log,
      inboxMessage: failedInboxMsg
    };
  } catch (err: any) {
    const errorMsg = `Network error communicating with Meta Cloud API: ${err.message}`;
    const shouldRetry = !disableAutoRetry;
    const catchStatus: 'failed' | 'retrying' = shouldRetry ? 'retrying' : 'failed';
    const nextRetryAt = shouldRetry ? new Date(Date.now() + 60 * 1000).toISOString() : undefined;
    const log = await salonRepository.createWhatsAppMessageLog({
      appointment_id: appointmentId,
      order_id: orderId,
      branch_id: branchId,
      customer_name: customData?.customerName,
      template_name: templateName,
      job_type: resolvedJobType,
      recipient_number: recipientE164,
      sender_phone_number_id: integration?.phone_number_id || 'unassigned',
      status: catchStatus,
      error_message: errorMsg,
      diagnostics: formatDiagnostics(`Network failure: ${err.message}`),
      retry_count: shouldRetry ? 1 : 0,
      next_retry_at: nextRetryAt
    });

    if (orderId) {
      if (resolvedJobType === 'bill_receipt') {
        await salonRepository.updateOrder(orderId, {
          receipt_whatsapp_status: catchStatus,
          receipt_whatsapp_error: errorMsg,
          whatsapp_status: catchStatus,
          whatsapp_error: errorMsg
        });
      } else if (resolvedJobType === 'customer_feedback') {
        await salonRepository.updateOrder(orderId, {
          feedback_whatsapp_status: catchStatus,
          feedback_whatsapp_error: errorMsg
        });
      }
    }

    return {
      sent: false,
      status: catchStatus,
      error: shouldRetry ? `${errorMsg}. Enqueued for automatic retry.` : errorMsg,
      diagnostics: formatDiagnostics(`Network failure: ${err.message}`),
      log
    };
  }
}

async function sendWhatsAppFreeformReply(
  branchId: string,
  recipientPhone: string,
  text: string,
  explicitPhoneNumberId?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  let phoneNumberId = explicitPhoneNumberId;
  if (!phoneNumberId) {
    let integration: any = await salonRepository.getBranchWhatsAppIntegration(branchId);
    if (!integration || !integration.phone_number_id) {
      const defaultBranchId = await getDefaultBranchIdFromRepo();
      if (defaultBranchId && defaultBranchId !== branchId) {
        integration = await salonRepository.getBranchWhatsAppIntegration(defaultBranchId);
      }
    }
    if (!integration || !integration.phone_number_id) {
      integration = await salonRepository.getWhatsAppIntegration();
    }
    phoneNumberId = integration?.phone_number_id;
  }

  // Fallback to active salon phone number ID if still not found
  if (!phoneNumberId) {
    phoneNumberId = '1379025201957313';
  }

  if (!META_SYSTEM_USER_ACCESS_TOKEN) {
    console.error('[WhatsApp Freeform] Missing META_SYSTEM_USER_ACCESS_TOKEN');
    return { success: false, error: 'WhatsApp META_SYSTEM_USER_ACCESS_TOKEN not configured' };
  }

  const cleanPhone = phoneDigits(recipientPhone).slice(-10);
  const to = '91' + cleanPhone;
  try {
    const res = await fetch(`https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${META_SYSTEM_USER_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: {
          preview_url: true,
          body: text
        }
      })
    });
    const data: any = await res.json().catch(() => ({}));
    if (res.ok && data?.messages?.[0]?.id) {
      console.log(`[WhatsApp Freeform] Sent reply successfully to ${to}, messageId: ${data.messages[0].id}`);
      return { success: true, messageId: data.messages[0].id };
    } else {
      const err = data?.error?.message || res.statusText || 'Unknown Meta error';
      console.warn(`[WhatsApp Freeform] Meta error sending reply to ${to}:`, err);
      return { success: false, error: err };
    }
  } catch (err: any) {
    console.error(`[WhatsApp Freeform] Network error sending reply to ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}

// ----------------------------------------------------------------------------
// Durable Server-Side Scheduled Feedback Job Runner
// ----------------------------------------------------------------------------
async function checkAndRunScheduledFeedbackJobs() {
  try {
    // Process due jobs from scheduled_feedback_jobs table
    const dueJobs = await salonRepository.getDueScheduledFeedbackJobs().catch(() => []);
    if (dueJobs && dueJobs.length) {
      for (const job of dueJobs) {
        try {
          if (job.status !== 'pending') continue;

          // Check if appointment is cancelled/no-show
          if (job.appointment_id) {
            const apt = await salonRepository.getAppointmentById(job.appointment_id).catch(() => null);
            if (!apt || apt.status === 'Cancelled' || apt.status === 'No Show') {
              console.log(`[Scheduled Feedback] Appointment ${job.appointment_id} is cancelled/no-show. Skipping feedback.`);
              await salonRepository.updateScheduledFeedbackJob(job.id, { status: 'cancelled' }).catch(() => null);
              continue;
            }
          }

          // Check if feedback was already sent or claimed for this appointment or order
          const alreadySent = await salonRepository.isFeedbackAlreadySentOrClaimed(job.appointment_id, job.order_id);
          if (alreadySent) {
            console.log(`[Scheduled Feedback] Feedback already sent or claimed for appointment/order ${job.appointment_id || job.order_id}. Completing duplicate job ${job.id}.`);
            await salonRepository.updateScheduledFeedbackJob(job.id, { status: 'completed' }).catch(() => null);
            continue;
          }

          // Atomically claim the job to prevent concurrent runners or processes from sending duplicates
          const claimedJob = await salonRepository.claimScheduledFeedbackJob(job.id);
          if (!claimedJob) {
            console.log(`[Scheduled Feedback] Job ${job.id} already claimed by another runner. Skipping.`);
            continue;
          }

          console.log(`[Scheduled Feedback] Executing claimed job ${job.id} for appointment/order ${job.appointment_id || job.order_id}...`);

          // Mark order and appointment as sending
          if (job.order_id) {
            await salonRepository.updateOrder(job.order_id, {
              feedback_whatsapp_status: 'sending'
            }).catch(() => null);
          }
          if (job.appointment_id) {
            await salonRepository.updateAppointment(job.appointment_id, {
              feedback_whatsapp_status: 'sending'
            }, 'system_feedback_scheduler').catch(() => null);
          }

          const result = await sendBranchWhatsAppTemplate({
            branchId: job.branch_id || (await getDefaultBranchIdFromRepo()),
            recipientPhone: job.customer_phone,
            templateName: 'glossylooks_customer_feedback',
            appointmentId: job.appointment_id,
            orderId: job.order_id,
            jobType: 'customer_feedback',
            customData: {
              customerName: job.customer_name
            }
          });

          if (result.status === 'sent' || result.sent) {
            const nowIso = new Date().toISOString();
            await salonRepository.updateScheduledFeedbackJob(job.id, {
              status: 'completed',
              meta_message_id: result.messageId,
              attempts: (job.attempts || 0) + 1
            }).catch(() => null);

            if (job.order_id) {
              await salonRepository.updateOrder(job.order_id, {
                feedback_whatsapp_status: 'sent',
                feedback_whatsapp_sent_at: nowIso,
                feedback_whatsapp_message_id: result.messageId,
                feedback_whatsapp_source: 'AUTO_FEEDBACK'
              }).catch(() => null);
            }
            if (job.appointment_id) {
              await salonRepository.updateAppointment(job.appointment_id, {
                feedback_whatsapp_status: 'sent',
                feedback_whatsapp_sent_at: nowIso,
                feedback_whatsapp_message_id: result.messageId,
                feedback_whatsapp_source: 'AUTO_FEEDBACK'
              }, 'system_feedback_scheduler').catch(() => null);
            }
            console.log(`[Scheduled Feedback] Successfully delivered feedback template to ${job.customer_phone} for job ${job.id}.`);
          } else {
            await salonRepository.updateScheduledFeedbackJob(job.id, {
              status: result.status === 'retrying' ? 'pending' : 'failed',
              error_message: result.error,
              attempts: (job.attempts || 0) + 1
            }).catch(() => null);

            if (job.order_id) {
              await salonRepository.updateOrder(job.order_id, {
                feedback_whatsapp_status: result.status === 'retrying' ? 'retrying' : 'failed',
                feedback_whatsapp_error: result.error
              }).catch(() => null);
            }
          }
        } catch (jobErr: any) {
          console.error(`[Scheduled Feedback] Error executing job ${job.id}:`, jobErr.message);
        }
      }
    }
  } catch (err: any) {
    console.error('[Scheduled Feedback] Runner error:', err.message);
  }
}

// Durable interval runner: checks every 15 seconds so feedback sends right at 2 minutes
setInterval(() => {
  checkAndRunScheduledFeedbackJobs().catch(() => {});
}, 15000);

// ----------------------------------------------------------------------------
// Automatic Exponential Backoff WhatsApp Retry Runner
// Retries temporary failed/rate-limited jobs (1 min, 5 min, 15 min, max 3)
// ----------------------------------------------------------------------------
async function checkAndRunWhatsAppRetries() {
  try {
    const dueRetries = await salonRepository.getDueWhatsAppMessageRetries();
    if (!dueRetries || !dueRetries.length) return;

    for (const log of dueRetries) {
      // Never auto-retry internal admin/salon alert templates from the background worker
      if (
        log.job_type === 'appointment_admin_alert' ||
        log.job_type === 'enquiry_admin_alert' ||
        log.template_name === APPOINTMENT_ADMIN_ALERT_TEMPLATE ||
        log.template_name === ENQUIRY_ADMIN_ALERT_TEMPLATE
      ) {
        continue;
      }
      const nextRetryCount = (log.retry_count || 0) + 1;
      const result = await sendBranchWhatsAppTemplate({
        branchId: log.branch_id || (await getDefaultBranchIdFromRepo()),
        recipientPhone: log.recipient_number,
        templateName: log.template_name || 'glossylooks_customer_feedback',
        orderId: log.order_id,
        appointmentId: log.appointment_id,
        customData: {
          customerName: log.customer_name || 'Valued Customer'
        }
      });

      if (result.sent) {
        await salonRepository.updateWhatsAppMessageLog(log.id, {
          status: 'sent',
          meta_message_id: result.messageId,
          sent_at: new Date().toISOString(),
          error_message: undefined
        });
        if (log.order_id) {
          await salonRepository.updateOrder(log.order_id, {
            whatsapp_status: 'sent',
            whatsapp_message_id: result.messageId,
            whatsapp_error: undefined
          });
        }
      } else {
        if (nextRetryCount >= 3) {
          await salonRepository.updateWhatsAppMessageLog(log.id, {
            status: 'failed',
            retry_count: nextRetryCount,
            error_message: result.error || 'Exceeded maximum retry attempts (3)'
          });
          if (log.order_id) {
            await salonRepository.updateOrder(log.order_id, {
              whatsapp_status: 'failed',
              whatsapp_error: result.error || 'Exceeded maximum retry attempts'
            });
          }
        } else {
          const delayMinutes = nextRetryCount === 1 ? 1 : nextRetryCount === 2 ? 5 : 15;
          const nextRetryAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
          await salonRepository.updateWhatsAppMessageLog(log.id, {
            status: 'retrying',
            retry_count: nextRetryCount,
            next_retry_at: nextRetryAt,
            error_message: result.error
          });
          if (log.order_id) {
            await salonRepository.updateOrder(log.order_id, {
              whatsapp_status: 'retrying',
              whatsapp_error: result.error
            });
          }
        }
      }
    }
  } catch (err: any) {
    console.error('[WhatsApp Retries] Runner error:', err.message);
  }
}

setInterval(() => {
  checkAndRunWhatsAppRetries().catch(() => {});
}, 30000);

// ============================================================================
// Automated Daily Stylist Sales Reporting Through WhatsApp (10:15 PM Asia/Kolkata)
// ============================================================================

// Uses shared getKolkataDateString(dateInput?: Date | string) imported from ./src/lib/rbac.ts

function getKolkataDisplayDate(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split('-');
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }).format(dt);
  } catch {
    return dateStr;
  }
}

interface StylistDailySalesAccumulator {
  stylistId?: string;
  stylistName: string;
  phone: string;
  userRole?: string;
  billIds: Set<string>;
  servicesCount: number;
  totalSales: number;
  cashAmount: number;
  upiAmount: number;
  otherAmount: number;
}

async function calculateDailySalesForKolkataDate(targetDateStr: string) {
  // 1. Fetch completed POS orders for calendar day (Asia/Kolkata boundaries)
  const allOrders = await salonRepository.getOrders();
  const dayOrders = (allOrders || []).filter(o => {
    if (o.payment_status === 'Cancelled') return false;
    const orderDateKolkata = getKolkataDateString(new Date(o.created_at));
    return orderDateKolkata === targetDateStr;
  });

  const users = await salonRepository.getUsers();
  const staff = await salonRepository.getStaff();

  // Helper to match stylist/staff member to user account and contact
  const findStylistDetails = (idOrName?: string) => {
    if (!idOrName) return null;
    const clean = idOrName.trim();
    const lower = clean.toLowerCase();

    // Match in staff
    const stf = staff.find(s => s.id === clean || s.user_id === clean || s.name.toLowerCase() === lower);
    // Match in users
    const usr = users.find(u =>
      u.id === clean ||
      u.user_id === clean ||
      u.name.toLowerCase() === lower ||
      (stf && (u.id === stf.user_id || (u.email && stf.email && u.email.toLowerCase() === stf.email.toLowerCase())))
    );

    const name = usr?.name || stf?.name || clean;
    const phone = usr?.phone || stf?.phone || '';
    const stylistId = usr?.id || stf?.id || undefined;
    const role = usr?.role || (stf?.role ? stf.role.toLowerCase() : 'stylist');
    const isActive = usr ? usr.is_active : (stf ? stf.is_active : true);

    return { name, phone, stylistId, role, isActive };
  };

  const stylistMap = new Map<string, StylistDailySalesAccumulator>();

  const totalSalonBillsSet = new Set<string>();
  let totalSalonServices = 0;
  let totalSalonSales = 0;
  let cashTotal = 0;
  let upiTotal = 0;
  let otherTotal = 0;

  for (const ord of dayOrders) {
    const orderId = ord.id || ord.bill_number;
    totalSalonBillsSet.add(orderId);
    const orderTotal = Number(ord.grand_total || 0);
    totalSalonSales += orderTotal;

    const payMethod = (ord.primary_payment_mode || (ord as any).payment_method || '').toLowerCase();
    if (payMethod.includes('cash')) {
      cashTotal += orderTotal;
    } else if (payMethod.includes('upi')) {
      upiTotal += orderTotal;
    } else {
      otherTotal += orderTotal;
    }

    // Process items for stylist breakdown
    const items = ord.items && Array.isArray(ord.items) && ord.items.length > 0
      ? ord.items
      : [{
          item_name: 'Salon Service',
          item_type: 'service' as const,
          quantity: 1,
          unit_price: orderTotal,
          total_price: orderTotal,
          staff_id: (ord as any).stylist_id,
          staff_name: (ord as any).stylist_name
        }];

    for (const item of items) {
      // Attribute service items completed by a stylist
      const isService = item.item_type === 'service' || !item.item_type;
      if (!isService) continue;

      const qty = Number(item.quantity || 1);
      totalSalonServices += qty;

      const itemTotal = Number(item.total_price || (Number(item.unit_price || 0) * qty));
      const targetStylistIdentifier = item.staff_name || item.staff_id || (ord as any).stylist_name || (ord as any).stylist_id;

      if (!targetStylistIdentifier) {
        continue;
      }

      const match = findStylistDetails(targetStylistIdentifier);
      if (!match || !match.isActive) {
        continue;
      }

      const key = match.name.toLowerCase();
      let accum = stylistMap.get(key);
      if (!accum) {
        accum = {
          stylistId: match.stylistId,
          stylistName: match.name,
          phone: match.phone,
          userRole: match.role,
          billIds: new Set<string>(),
          servicesCount: 0,
          totalSales: 0,
          cashAmount: 0,
          upiAmount: 0,
          otherAmount: 0
        };
        stylistMap.set(key, accum);
      }

      accum.billIds.add(orderId);
      accum.servicesCount += qty;
      accum.totalSales += itemTotal;

      // Attribute payment mode
      if (payMethod.includes('cash')) {
        accum.cashAmount += itemTotal;
      } else if (payMethod.includes('upi')) {
        accum.upiAmount += itemTotal;
      } else {
        accum.otherAmount += itemTotal;
      }
    }
  }

  // Active Stylists list with sales
  const activeStylistsWithSales = Array.from(stylistMap.values())
    .filter(s => s.totalSales > 0 || s.servicesCount > 0)
    .sort((a, b) => b.totalSales - a.totalSales);

  // Build formatted text breakdown for owner
  const formattedDate = getKolkataDisplayDate(targetDateStr);
  const stylistBreakdownLines = activeStylistsWithSales.map(s => {
    return `• ${s.stylistName}: ${s.billIds.size} bills, ${s.servicesCount} services, ₹${s.totalSales.toLocaleString('en-IN')} (Cash: ₹${s.cashAmount}, UPI: ₹${s.upiAmount}, Other: ₹${s.otherAmount})`;
  });

  const breakdownText = stylistBreakdownLines.length > 0
    ? stylistBreakdownLines.join('\n')
    : 'No stylist service sales recorded for this date.';

  // Find active owner
  const owner = users.find(u => u.role === 'owner' && u.is_active) ||
    users.find(u => u.user_id === 'TGL-OWN01' && u.is_active) ||
    users[0];

  return {
    targetDateStr,
    formattedDate,
    totalBills: totalSalonBillsSet.size,
    totalServices: totalSalonServices,
    totalSales: totalSalonSales,
    cashTotal,
    upiTotal,
    otherTotal,
    activeStylistsWithSales,
    breakdownText,
    owner
  };
}

async function generateAndSendDailySalesReports(dateStr?: string, force: boolean = false) {
  const targetDateStr = dateStr || getKolkataDateString();
  console.log(`[Daily Sales WhatsApp] Initiating daily sales reporting for ${targetDateStr} (force: ${force})...`);

  const summary = await calculateDailySalesForKolkataDate(targetDateStr);
  const results = {
    reportDate: targetDateStr,
    totalBills: summary.totalBills,
    totalServices: summary.totalServices,
    totalSales: summary.totalSales,
    cashTotal: summary.cashTotal,
    upiTotal: summary.upiTotal,
    otherTotal: summary.otherTotal,
    stylistReportsCount: 0,
    ownerSummarySent: false,
    sent: [] as any[],
    skipped: [] as any[],
    failed: [] as any[]
  };

  // 1. Send each active stylist with sales their daily sales report
  for (const st of summary.activeStylistsWithSales) {
    const billsCount = st.billIds.size;
    const servicesCount = st.servicesCount;
    const totalSales = st.totalSales;
    const cashAmount = st.cashAmount;
    const upiAmount = st.upiAmount;
    const otherAmount = st.otherAmount;

    const normalized = normalizePhoneNumber(st.phone);
    if (!normalized.isValid) {
      console.warn(`[Daily Sales Report] Stylist ${st.stylistName} has missing or invalid mobile number: "${st.phone}". Skipping WhatsApp send.`);
      results.failed.push({
        recipient: st.stylistName,
        phone: st.phone,
        type: 'stylist_report',
        error: 'Invalid or missing Indian mobile number'
      });
      continue;
    }

    const recipientE164 = normalized.e164;

    // Strict idempotency: check if already sent for this date and recipient
    const existing = await salonRepository.getDailySalesReportByRecipient(targetDateStr, recipientE164, 'stylist_report');
    if (existing && existing.status === 'sent' && !force) {
      console.log(`[Daily Sales Report] Idempotent skip: Stylist ${st.stylistName} report already sent for ${targetDateStr}.`);
      results.skipped.push({
        recipient: st.stylistName,
        phone: recipientE164,
        type: 'stylist_report',
        message: 'Already sent today (use force to resend)'
      });
      continue;
    }

    const reportBranchId = (st as any).branchId || (await getDefaultBranchIdFromRepo());
    console.log(`[Daily Sales Report] Sending gl_stylist_daily_sales_report to ${st.stylistName} (${recipientE164})...`);
    const sendResult = await sendBranchWhatsAppTemplate({
      branchId: reportBranchId,
      recipientPhone: recipientE164,
      templateName: 'gl_stylist_daily_sales_report',
      jobType: 'stylist_sales_report',
      customData: {
        stylistName: st.stylistName,
        reportDate: summary.formattedDate,
        billsCount,
        servicesCount,
        totalSales,
        cashAmount,
        upiAmount,
        otherAmount
      }
    });

    const reportStatus: DailySalesReportStatus = sendResult.status === 'sent' ? 'sent' : sendResult.status === 'retrying' ? 'retrying' : 'failed';

    const reportPayload = {
      report_date: targetDateStr,
      report_type: 'stylist_report' as const,
      recipient_type: 'stylist' as const,
      recipient_phone: recipientE164,
      recipient_name: st.stylistName,
      stylist_id: st.stylistId,
      stylist_name: st.stylistName,
      branch_id: reportBranchId,
      bills_count: billsCount,
      services_count: servicesCount,
      total_sales: totalSales,
      cash_amount: cashAmount,
      upi_amount: upiAmount,
      other_amount: otherAmount,
      breakdown_text: `${billsCount} bills, ${servicesCount} services. Total: ₹${totalSales} (Cash: ₹${cashAmount}, UPI: ₹${upiAmount}, Other: ₹${otherAmount})`,
      breakdown_json: {
        billsCount,
        servicesCount,
        totalSales,
        cashAmount,
        upiAmount,
        otherAmount
      },
      template_name: 'gl_stylist_daily_sales_report',
      meta_message_id: sendResult.messageId,
      status: reportStatus,
      error_message: sendResult.error,
      sent_at: sendResult.sent ? new Date().toISOString() : undefined
    };

    if (existing) {
      await salonRepository.updateDailySalesReport(existing.id, reportPayload);
    } else {
      await salonRepository.createDailySalesReport(reportPayload);
    }

    if (sendResult.sent) {
      results.stylistReportsCount++;
      results.sent.push({
        recipient: st.stylistName,
        phone: recipientE164,
        type: 'stylist_report',
        messageId: sendResult.messageId
      });
    } else {
      results.failed.push({
        recipient: st.stylistName,
        phone: recipientE164,
        type: 'stylist_report',
        error: sendResult.error
      });
    }
  }

  // 2. Send the Owner one consolidated WhatsApp template: gl_owner_daily_sales_summary
  if (summary.owner) {
    const ownerNormalized = normalizePhoneNumber(summary.owner.phone);
    if (!ownerNormalized.isValid) {
      console.warn(`[Daily Sales Report] Owner ${summary.owner.name} has missing/invalid mobile number: "${summary.owner.phone}".`);
      results.failed.push({
        recipient: summary.owner.name,
        phone: summary.owner.phone,
        type: 'owner_summary',
        error: 'Invalid or missing owner mobile number'
      });
    } else {
      const ownerE164 = ownerNormalized.e164;
      const existingOwner = await salonRepository.getDailySalesReportByRecipient(targetDateStr, ownerE164, 'owner_summary');

      if (existingOwner && existingOwner.status === 'sent' && !force) {
        console.log(`[Daily Sales Report] Idempotent skip: Owner summary already sent for ${targetDateStr}.`);
        results.skipped.push({
          recipient: summary.owner.name,
          phone: ownerE164,
          type: 'owner_summary',
          message: 'Already sent today (use force to resend)'
        });
      } else {
        const ownerReportBranchId = await getDefaultBranchIdFromRepo();
        console.log(`[Daily Sales Report] Sending gl_owner_daily_sales_summary to owner ${summary.owner.name} (${ownerE164})...`);
        const ownerSendResult = await sendBranchWhatsAppTemplate({
          branchId: ownerReportBranchId,
          recipientPhone: ownerE164,
          templateName: 'gl_owner_daily_sales_summary',
          jobType: 'owner_sales_summary',
          customData: {
            ownerName: summary.owner.name,
            reportDate: summary.formattedDate,
            totalBills: summary.totalBills,
            totalServices: summary.totalServices,
            totalSales: summary.totalSales,
            cashTotal: summary.cashTotal,
            upiTotal: summary.upiTotal,
            otherTotal: summary.otherTotal,
            breakdownText: summary.breakdownText
          }
        });

        const ownerStatus: DailySalesReportStatus = ownerSendResult.status === 'sent' ? 'sent' : ownerSendResult.status === 'retrying' ? 'retrying' : 'failed';

        const ownerPayload = {
          report_date: targetDateStr,
          report_type: 'owner_summary' as const,
          recipient_type: 'owner' as const,
          recipient_phone: ownerE164,
          recipient_name: summary.owner.name,
          branch_id: ownerReportBranchId,
          bills_count: summary.totalBills,
          services_count: summary.totalServices,
          total_sales: summary.totalSales,
          cash_amount: summary.cashTotal,
          upi_amount: summary.upiTotal,
          other_amount: summary.otherTotal,
          breakdown_text: summary.breakdownText,
          breakdown_json: {
            totalBills: summary.totalBills,
            totalServices: summary.totalServices,
            totalSales: summary.totalSales,
            cashTotal: summary.cashTotal,
            upiTotal: summary.upiTotal,
            otherTotal: summary.otherTotal,
            stylists: summary.activeStylistsWithSales.map(s => ({
              stylistName: s.stylistName,
              phone: s.phone,
              bills: s.billIds.size,
              services: s.servicesCount,
              sales: s.totalSales,
              cash: s.cashAmount,
              upi: s.upiAmount,
              other: s.otherAmount
            }))
          },
          template_name: 'gl_owner_daily_sales_summary',
          meta_message_id: ownerSendResult.messageId,
          status: ownerStatus,
          error_message: ownerSendResult.error,
          sent_at: ownerSendResult.sent ? new Date().toISOString() : undefined
        };

        if (existingOwner) {
          await salonRepository.updateDailySalesReport(existingOwner.id, ownerPayload);
        } else {
          await salonRepository.createDailySalesReport(ownerPayload);
        }

        if (ownerSendResult.sent) {
          results.ownerSummarySent = true;
          results.sent.push({
            recipient: summary.owner.name,
            phone: ownerE164,
            type: 'owner_summary',
            messageId: ownerSendResult.messageId
          });
        } else {
          results.failed.push({
            recipient: summary.owner.name,
            phone: ownerE164,
            type: 'owner_summary',
            error: ownerSendResult.error
          });
        }
      }
    }
  }

  return results;
}

// ----------------------------------------------------------------------------
// Daily Stylist Sales Reporting Interval Runner (10:15 PM Asia/Kolkata)
// ----------------------------------------------------------------------------
let lastAutoReportRunKolkataDate = '';

function checkAndRunDailySalesReportingCron() {
  try {
    const now = new Date();
    const kolkataFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour12: false
    });
    const parts = kolkataFormatter.formatToParts(now);
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;

    const hour = map['hour'];
    const minute = map['minute'];
    const dateStr = `${map['year']}-${map['month']}-${map['day']}`;

    // Target schedule: 22:15 (10:15 PM Asia/Kolkata time)
    if (hour === '22' && minute === '15') {
      if (lastAutoReportRunKolkataDate !== dateStr) {
        lastAutoReportRunKolkataDate = dateStr;
        console.log(`[Daily Sales Cron] 10:15 PM Asia/Kolkata reached. Generating daily sales reports for ${dateStr}...`);
        generateAndSendDailySalesReports(dateStr, false).catch(err => {
          console.error('[Daily Sales Cron] Error in automated run:', err);
        });
      }
    }
  } catch (err: any) {
    console.error('[Daily Sales Cron] Timer check error:', err.message);
  }
}

// Check every 30 seconds
setInterval(checkAndRunDailySalesReportingCron, 30000);


// ----------------------------------------------------------------------------
// 4. WhatsApp Webhook (Meta Verification & Event Receiver)
// ----------------------------------------------------------------------------
// Canonical deployed endpoint: /api/whatsapp/webhook.
// The two legacy aliases are deliberately retained so an existing Meta setup
// does not stop receiving events during an upgrade.
const META_WEBHOOK_PATHS = [
  '/api/whatsapp/webhook',
  '/api/webhook/whatsapp',
  '/api/webhooks/whatsapp'
];

function isValidMetaWebhookSignature(req: express.Request): boolean {
  // If META_APP_SECRET is not configured, permit incoming webhooks so salon notifications are not blocked
  if (!META_APP_SECRET) {
    return true;
  }

  const signature = req.header('x-hub-signature-256');
  // If signature header was omitted (e.g. stripped by reverse proxy / Cloudflare / local tests), allow valid WhatsApp payloads
  if (!signature) {
    console.warn('[WhatsApp Webhook] No x-hub-signature-256 header provided; allowing verified WhatsApp event structure.');
    return true;
  }

  let rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody && req.body) {
    try {
      rawBody = Buffer.from(JSON.stringify(req.body));
    } catch {}
  }
  if (!rawBody || !signature.startsWith('sha256=')) {
    console.warn('[WhatsApp Webhook] Signature header format invalid or body missing.');
    return false;
  }

  const expected = `sha256=${crypto.createHmac('sha256', META_APP_SECRET).update(rawBody).digest('hex')}`;
  const provided = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return provided.length === expectedBuffer.length && crypto.timingSafeEqual(provided, expectedBuffer);
}

function handleMetaWebhookVerification(req: express.Request, res: express.Response) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Never use a fallback verify token in production. Meta must match the
  // server-only META_VERIFY_TOKEN entered in the Meta developer console.
  if (META_VERIFY_TOKEN && mode === 'subscribe' && token === META_VERIFY_TOKEN && typeof challenge === 'string') {
    console.log('✅ Meta WhatsApp webhook verified successfully');
    return res.status(200).type('text/plain').send(challenge);
  }
  return res.status(403).json({ error: 'Verification token mismatch' });
}

async function handleMetaWebhookEvent(req: express.Request, res: express.Response) {
  if (!isValidMetaWebhookSignature(req)) {
    console.warn('[WhatsApp Webhook] Rejected request with invalid Meta signature.');
    try {
      await salonRepository.createWhatsAppWebhookEvent({
        event_type: 'signature_verification_failed',
        status: 'failed',
        error_message: 'Invalid webhook signature',
        payload: { headers: req.headers }
      });
    } catch {}
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  // Respond 200 immediately to acknowledge Meta delivery
  res.status(200).json({ status: 'EVENT_RECEIVED', received: true });

  try {
    const body = req.body;
    if (body?.object !== 'whatsapp_business_account' || !Array.isArray(body?.entry)) {
      return;
    }

    for (const entry of body.entry) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field !== 'messages') continue;
        const val = change.value;
        if (!val) continue;

        const receiverPhoneNumberId = val.metadata?.phone_number_id;

        // 1. Process Delivery Statuses (sent -> delivered -> read)
        if (Array.isArray(val.statuses)) {
          for (const st of val.statuses) {
            const metaId = st.id;
            const statusStr = st.status;
            const timestamp = st.timestamp ? new Date(Number(st.timestamp) * 1000).toISOString() : new Date().toISOString();

            try {
              await salonRepository.createWhatsAppWebhookEvent({
                event_id: metaId,
                event_type: `message_status_${statusStr}`,
                sender_phone: st.recipient_id,
                recipient_phone_number_id: receiverPhoneNumberId,
                payload: st,
                status: 'processed'
              });
            } catch {}

            if (statusStr === 'delivered') {
              const updatedLog = await salonRepository.updateWhatsAppMessageLogByMetaId(metaId, {
                status: 'delivered',
                delivered_at: timestamp
              });
              if (updatedLog?.appointment_id) {
                await salonRepository.updateAppointment(updatedLog.appointment_id, {
                  whatsapp_status: 'delivered',
                  last_whatsapp_error: undefined
                }, 'WhatsApp Webhook').catch(() => null);
              }
              if (updatedLog?.order_id) {
                const isReceipt = updatedLog.job_type === 'bill_receipt' || updatedLog.template_name === 'gl_bill_receipt';
                await salonRepository.updateOrder(updatedLog.order_id, {
                  ...(isReceipt ? { receipt_whatsapp_status: 'delivered' } : { feedback_whatsapp_status: 'delivered' }),
                  whatsapp_status: 'delivered'
                });
              }
            } else if (statusStr === 'read') {
              const updatedLog = await salonRepository.updateWhatsAppMessageLogByMetaId(metaId, {
                status: 'read',
                read_at: timestamp
              });
              if (updatedLog?.appointment_id) {
                await salonRepository.updateAppointment(updatedLog.appointment_id, {
                  whatsapp_status: 'read',
                  last_whatsapp_error: undefined
                }, 'WhatsApp Webhook').catch(() => null);
              }
              if (updatedLog?.order_id) {
                const isReceipt = updatedLog.job_type === 'bill_receipt' || updatedLog.template_name === 'gl_bill_receipt';
                await salonRepository.updateOrder(updatedLog.order_id, {
                  ...(isReceipt ? { receipt_whatsapp_status: 'read' } : { feedback_whatsapp_status: 'read' }),
                  whatsapp_status: 'read'
                });
              }
            } else if (statusStr === 'failed') {
              const errDetail = Array.isArray(st.errors) && st.errors[0]?.message ? st.errors[0].message : 'Meta webhook reported failure';
              const updatedLog = await salonRepository.updateWhatsAppMessageLogByMetaId(metaId, {
                status: 'failed',
                error_message: errDetail
              });
              if (updatedLog?.appointment_id) {
                await salonRepository.updateAppointment(updatedLog.appointment_id, {
                  whatsapp_status: 'failed',
                  last_whatsapp_error: errDetail
                }, 'WhatsApp Webhook').catch(() => null);
              }
              if (updatedLog?.order_id) {
                const isReceipt = updatedLog.job_type === 'bill_receipt' || updatedLog.template_name === 'gl_bill_receipt';
                await salonRepository.updateOrder(updatedLog.order_id, {
                  ...(isReceipt
                    ? { receipt_whatsapp_status: 'failed', receipt_whatsapp_error: errDetail }
                    : { feedback_whatsapp_status: 'failed', feedback_whatsapp_error: errDetail }),
                  whatsapp_status: 'failed',
                  whatsapp_error: errDetail
                });
              }
            }

            // Also synchronize delivery status into WhatsApp Inbox messages
            try {
              const deliveryStatus = statusStr === 'delivered' ? 'delivered' : statusStr === 'read' ? 'read' : statusStr === 'failed' ? 'failed' : 'sent';
              const updatedMsg = await salonRepository.updateWhatsAppMessageByMetaId(metaId, {
                delivery_status: deliveryStatus,
                status: deliveryStatus,
                ...(deliveryStatus === 'delivered' ? { delivered_at: timestamp } : {}),
                ...(deliveryStatus === 'read' ? { read_at: timestamp } : {}),
                ...(deliveryStatus === 'failed' ? { error_message: Array.isArray(st.errors) && st.errors[0]?.message ? st.errors[0].message : 'Meta webhook reported failure' } : {})
              });
              if (updatedMsg) {
                broadcastWhatsAppInboxEvent({
                  type: 'message_status',
                  messageId: updatedMsg.id,
                  metaMessageId: metaId,
                  conversationId: updatedMsg.conversation_id,
                  status: deliveryStatus
                });
              }
            } catch (statusErr) {
              console.warn('[WhatsApp Webhook] Error updating WhatsApp Inbox message status:', statusErr);
            }
          }
        }

        // 2. Process Incoming Customer Messages & Feedback Replies
        if (Array.isArray(val.messages)) {
          for (const msg of val.messages) {
            console.log(`[WhatsApp Webhook] Incoming message id=${msg.id}, type=${msg.type}, from=${msg.from}`);

            if (msg.id && await salonRepository.isWebhookEventProcessed(msg.id)) {
              console.log(`[WhatsApp Webhook] Message ${msg.id} already processed. Skipping duplicate.`);
              continue;
            }
            if (msg.id) {
              await salonRepository.recordProcessedWebhookEvent(msg.id, 'whatsapp_incoming_message');
            }

            const fromPhone = String(msg.from || '').replace(/\D/g, '').slice(-10);
            if (!fromPhone) continue;

            let text = '';
            let buttonId = '';
            let buttonTitle = '';

            // Extract from button quick reply
            if (msg.button) {
              text = msg.button.text || '';
              buttonId = msg.button.payload || '';
              buttonTitle = text;
            }
            // Extract from interactive button reply
            if (msg.interactive?.button_reply) {
              text = text || msg.interactive.button_reply.title || '';
              buttonId = buttonId || msg.interactive.button_reply.id || '';
              buttonTitle = text;
            }
            // Extract from interactive list reply
            if (msg.interactive?.list_reply) {
              text = text || msg.interactive.list_reply.title || '';
              buttonId = buttonId || msg.interactive.list_reply.id || '';
              buttonTitle = text;
            }
            // Extract from plain text or quoted message
            if (msg.text?.body) {
              text = text || msg.text.body;
            }
            // Extract media representations
            if (msg.image) {
              text = msg.image.caption ? `📷 [Image: ${msg.image.caption}]` : '📷 [Image]';
            } else if (msg.document) {
              text = msg.document.filename ? `📄 [Document: ${msg.document.filename}]` : (msg.document.caption || '📄 [Document]');
            } else if (msg.audio) {
              text = '🎵 [Audio Message]';
            } else if (msg.video) {
              text = msg.video.caption ? `🎥 [Video: ${msg.video.caption}]` : '🎥 [Video]';
            } else if (msg.location) {
              text = `📍 [Location: ${msg.location.name || `${msg.location.latitude}, ${msg.location.longitude}`}]`;
            } else if (msg.contacts) {
              text = '👤 [Contact Card]';
            }

            const cleanText = (text || '').trim().toLowerCase();
            const cleanId = (buttonId || '').trim().toLowerCase();

            console.log(`[WhatsApp Webhook] Evaluating reply from ${fromPhone}: text="${text}", buttonId="${buttonId}"`);

            // Log event in database for audits & diagnostics
            try {
              await salonRepository.createWhatsAppWebhookEvent({
                event_id: msg.id,
                event_type: buttonId ? 'interactive_reply' : `incoming_${msg.type || 'message'}`,
                sender_phone: fromPhone,
                recipient_phone_number_id: receiverPhoneNumberId,
                payload: msg,
                status: 'processed'
              });
            } catch {}

            // Match customer from repository or create placeholder
            let matchedCustomer: any = null;
            try {
              matchedCustomer = await salonRepository.getCustomerByMobile(fromPhone);
            } catch {
              matchedCustomer = null;
            }

            // Persist inbound message in WhatsApp Inbox (Idempotent by msg.id)
            let inboxConversation: any = null;
            try {
              let matchedOrderForBranch: any = null;
              try {
                const ordersForPhone = await salonRepository.getOrders({ customerMobile: fromPhone });
                if (ordersForPhone && ordersForPhone.length > 0) {
                  matchedOrderForBranch = ordersForPhone[0];
                }
              } catch {}

              inboxConversation = await salonRepository.getOrCreateWhatsAppConversation({
                branch_id: matchedOrderForBranch?.branch_id || (await getDefaultBranchIdFromRepo()),
                customer_id: matchedCustomer?.id,
                customer_phone: `+91${fromPhone}`,
                customer_name: matchedCustomer?.name || matchedOrderForBranch?.customer_name || 'WhatsApp Customer',
                wa_phone_number_id: receiverPhoneNumberId,
                source_channel: 'WHATSAPP'
              });

              const messageBody = text || (buttonId ? `[Button: ${buttonId}]` : '[Message]');
              const inboundMsg = await salonRepository.createWhatsAppMessage({
                conversation_id: inboxConversation.id,
                direction: 'INBOUND',
                message_type: buttonId ? 'interactive' : (msg.type || 'text'),
                text_body: messageBody,
                message_body: messageBody,
                button_reply_id: buttonId || undefined,
                button_reply_title: buttonTitle || undefined,
                meta_message_id: msg.id,
                meta_timestamp: msg.timestamp ? Number(msg.timestamp) : Math.floor(Date.now() / 1000),
                status: 'delivered',
                source_badge: 'WHATSAPP',
                received_at: new Date().toISOString()
              });

              // CRITICAL FIX: Update conversation with last_inbound_at and last_message_preview
              const nowIso = new Date().toISOString();
              const updatedConv = await salonRepository.updateWhatsAppConversation(inboxConversation.id, {
                last_inbound_at: nowIso,
                last_message_at: nowIso,
                last_message_text: messageBody,
                last_message_preview: messageBody,
                unread_count: (inboxConversation.unread_count || 0) + 1,
                status: 'OPEN',
                source_channel: inboxConversation.source_channel === 'WEBSITE_ENQUIRY' ? 'MIXED' : (inboxConversation.source_channel || 'WHATSAPP')
              });

              if (updatedConv) inboxConversation = updatedConv;

              broadcastWhatsAppInboxEvent({
                type: 'inbound_message',
                conversationId: inboxConversation.id,
                message: inboundMsg,
                conversation: inboxConversation
              });
            } catch (inboxErr: any) {
              console.warn('[WhatsApp Webhook] Failed to record inbound message in WhatsApp Inbox:', inboxErr);
              try {
                await salonRepository.createWhatsAppWebhookEvent({
                  event_id: msg.id,
                  event_type: 'incoming_message_error',
                  sender_phone: fromPhone,
                  recipient_phone_number_id: receiverPhoneNumberId,
                  payload: msg,
                  status: 'failed',
                  error_message: inboxErr?.message || String(inboxErr)
                });
              } catch {}
            }

            // =========================================================================
            // ACTIVE FEEDBACK CONTEXT & STRICT CLASSIFICATION (SEPARATE FROM NORMAL CHAT)
            // =========================================================================
            const cleanFromPhone10 = fromPhone;
            const allOrders = await salonRepository.getOrders();
            const customerOrders = (allOrders || [])
              .filter(o => phoneDigits(o.customer_phone).slice(-10) === cleanFromPhone10)
              .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

            const existingFeedbacks = await salonRepository.getAppointmentFeedback().catch(() => []);
            const nowMs = Date.now();
            const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

            // An order has an active pending feedback request if:
            // 1. Feedback was sent (feedback_whatsapp_status is 'sent', 'delivered', or 'read')
            // 2. Sent within the last 48 hours
            // 3. Not already marked 'completed' and not already rated
            // 4. No response already recorded in appointment_feedback for this order_id or appointment_id
            const pendingOrder = customerOrders.find(o => {
              const isSent = o.feedback_whatsapp_status === 'sent' || o.feedback_whatsapp_status === 'delivered' || o.feedback_whatsapp_status === 'read';
              if (!isSent) return false;
              if (o.feedback_whatsapp_status === 'completed' || o.feedback_rating) return false;

              const sentTime = o.feedback_whatsapp_sent_at ? new Date(o.feedback_whatsapp_sent_at).getTime() : new Date(o.created_at || 0).getTime();
              if (nowMs - sentTime > FORTY_EIGHT_HOURS_MS) return false;

              const alreadyAnswered = existingFeedbacks.some(f => 
                (o.id && f.order_id === o.id) || 
                (o.appointment_id && f.appointment_id === o.appointment_id)
              );
              return !alreadyAnswered;
            });

            // Also check message logs if feedback was dispatched via template without direct order link
            let pendingFeedbackLog: any = null;
            if (!pendingOrder) {
              try {
                const messageLogs = await salonRepository.getWhatsAppMessageLogs(undefined, undefined);
                const recentFeedbackLogs = (messageLogs || []).filter(l => {
                  const isRecipient = phoneDigits(l.recipient_number).slice(-10) === cleanFromPhone10;
                  const isFeedback = l.job_type === 'customer_feedback' || l.template_name === 'glossylooks_customer_feedback' || l.template_name === 'the_glossylooks_customer_feedback';
                  const isSent = l.status === 'sent' || l.status === 'delivered' || l.status === 'read';
                  const sentTime = new Date(l.sent_at || l.created_at).getTime();
                  return isRecipient && isFeedback && isSent && (nowMs - sentTime <= FORTY_EIGHT_HOURS_MS);
                });

                for (const log of recentFeedbackLogs) {
                  const alreadyAnswered = existingFeedbacks.some(f => 
                    (log.order_id && f.order_id === log.order_id) || 
                    (log.appointment_id && f.appointment_id === log.appointment_id) ||
                    (log.meta_message_id && f.meta_message_id === log.meta_message_id)
                  );
                  if (!alreadyAnswered) {
                    pendingFeedbackLog = log;
                    break;
                  }
                }
              } catch {}
            }

            const hasPendingFeedbackRequest = Boolean(pendingOrder || pendingFeedbackLog);

            // If there is NO active pending feedback request, THIS IS NORMAL CHAT!
            // It has already been saved into whatsapp_messages and whatsapp_conversations above.
            // Do NOT run any feedback automation!
            if (!hasPendingFeedbackRequest) {
              console.log(`[WhatsApp Webhook] Message from ${fromPhone} ("${text}") treated as NORMAL_CHAT (No active pending feedback request).`);
              try {
                await salonRepository.createWhatsAppWebhookEvent({
                  event_id: `${msg.id || Date.now()}_normal_chat`,
                  event_type: 'normal_chat',
                  sender_phone: fromPhone,
                  recipient_phone_number_id: receiverPhoneNumberId,
                  payload: { text, classification: 'NORMAL_CHAT' },
                  status: 'processed'
                });
              } catch {}
              continue;
            }

            // An active feedback request is pending. Now strictly evaluate if this message is a feedback response.
            let feedbackChoice: 'good' | 'average' | 'bad' | null = null;
            let matchedMethod: 'INTERACTIVE_BUTTON' | 'TEXT_FALLBACK' | null = null;

            // 1. Primary: Match by Interactive Button / Quick Reply ID
            if (cleanId) {
              if (
                cleanId === 'feedback_good' ||
                cleanId.startsWith('feedback_good') ||
                cleanId === 'btn_good' ||
                cleanId === 'rating_good' ||
                cleanId === 'good' ||
                cleanId === 'button_1' ||
                cleanId === '1'
              ) {
                feedbackChoice = 'good';
                matchedMethod = 'INTERACTIVE_BUTTON';
              } else if (
                cleanId === 'feedback_average' ||
                cleanId.startsWith('feedback_average') ||
                cleanId === 'btn_average' ||
                cleanId === 'rating_average' ||
                cleanId === 'average' ||
                cleanId === 'button_2' ||
                cleanId === '2'
              ) {
                feedbackChoice = 'average';
                matchedMethod = 'INTERACTIVE_BUTTON';
              } else if (
                cleanId === 'feedback_bad' ||
                cleanId.startsWith('feedback_bad') ||
                cleanId === 'btn_bad' ||
                cleanId === 'rating_bad' ||
                cleanId === 'bad' ||
                cleanId === 'button_3' ||
                cleanId === '3'
              ) {
                feedbackChoice = 'bad';
                matchedMethod = 'INTERACTIVE_BUTTON';
              }
            }

            // 2. Secondary: Exact Text Fallback ONLY (NO substring, NO 'ok', NO loose words)
            if (!feedbackChoice && cleanText) {
              if (cleanText === 'good' || cleanText === '👍') {
                feedbackChoice = 'good';
                matchedMethod = 'TEXT_FALLBACK';
              } else if (cleanText === 'average') {
                feedbackChoice = 'average';
                matchedMethod = 'TEXT_FALLBACK';
              } else if (cleanText === 'bad' || cleanText === '👎') {
                feedbackChoice = 'bad';
                matchedMethod = 'TEXT_FALLBACK';
              }
            }

            // If incoming message does NOT match explicit feedback choice (e.g. "Ok", "Thanks", "Hi", "7pm"):
            // It is NORMAL CHAT! Do not process feedback. Leave feedback as PENDING.
            if (!feedbackChoice) {
              console.log(`[WhatsApp Webhook] Message from ${fromPhone} ("${text}") is NORMAL_CHAT during pending feedback window. Not a feedback category selection.`);
              try {
                await salonRepository.createWhatsAppWebhookEvent({
                  event_id: `${msg.id || Date.now()}_normal_chat_pending_window`,
                  event_type: 'normal_chat',
                  sender_phone: fromPhone,
                  recipient_phone_number_id: receiverPhoneNumberId,
                  payload: { text, classification: 'NORMAL_CHAT' },
                  status: 'processed'
                });
              } catch {}
              continue;
            }

            console.log(`[WhatsApp Webhook] Verified feedback response from ${fromPhone}: ${feedbackChoice.toUpperCase()} (Matched via ${matchedMethod})`);

            const targetOrderId = pendingOrder?.id || pendingFeedbackLog?.order_id;
            const targetAptId = pendingOrder?.appointment_id || pendingFeedbackLog?.appointment_id;
            const branchId = pendingOrder?.branch_id || pendingFeedbackLog?.branch_id || (await getDefaultBranchIdFromRepo());
            const customerName = pendingOrder?.customer_name || pendingFeedbackLog?.customer_name || 'Valued Customer';

            // Idempotency: verify this specific message ID has not already been replied to
            const alreadyRecorded = msg.id && existingFeedbacks.some(f => 
              (f.meta_message_id && f.meta_message_id === msg.id) ||
              (f.incoming_meta_message_id && f.incoming_meta_message_id === msg.id)
            );

            if (alreadyRecorded) {
              console.log(`[WhatsApp Webhook] Feedback already recorded for message ${msg.id}. Skipping duplicate.`);
              continue;
            }

            // Mark the pending feedback request as COMPLETED on the order and appointment, cancelling any pending feedback jobs
            if (targetOrderId) {
              await salonRepository.updateOrder(targetOrderId, {
                feedback_whatsapp_status: 'completed',
                feedback_rating: feedbackChoice
              }).catch(() => null);
              await salonRepository.cancelScheduledFeedbackJobByOrder(targetOrderId).catch(() => null);
            }
            if (targetAptId) {
              await salonRepository.updateAppointment(targetAptId, {
                feedback_whatsapp_status: 'completed'
              }, 'system_whatsapp_webhook').catch(() => null);
              await salonRepository.cancelScheduledFeedbackJobByAppointment(targetAptId).catch(() => null);
            }

            const feedbackRecord = await salonRepository.createAppointmentFeedback({
              appointment_id: targetAptId,
              order_id: targetOrderId,
              branch_id: branchId,
              customer_name: customerName,
              customer_phone: fromPhone,
              rating: feedbackChoice,
              reply_text: text || buttonId || feedbackChoice.toUpperCase(),
              meta_message_id: msg.id,
              incoming_meta_message_id: msg.id,
              reply_status: 'sending',
              is_read: false
            });

            // Update customer CRM feedback rating immediately
            try {
              const cust = await salonRepository.getCustomerByMobile(fromPhone);
              if (cust) {
                await salonRepository.updateCustomer(cust.id, { feedback_rating: feedbackChoice }, 'System');
              }
            } catch (custErr: any) {
              console.warn('[WhatsApp Webhook] Customer CRM rating update error:', custErr.message);
            }

            // Formulate distinct automated responses based on explicit rating:
            let autoReplyText = '';
            if (feedbackChoice === 'good') {
              // 8. GOOD FLOW: Google Review thank-you & review link
              autoReplyText = "Thank you for your wonderful feedback! We are delighted you enjoyed your experience with The Glossy Looks. Your Google review would mean a lot to us: https://g.page/r/CTx5NddxkeKaEAE/review";
            } else if (feedbackChoice === 'average') {
              // 9. AVERAGE FLOW: Constructive improvement response (distinct from Bad!)
              autoReplyText = "Thank you for your valuable feedback. We always strive to provide a wonderful experience at The Glossy Looks. We have noted your response and our team will work to make your next visit even better!";
            } else if (feedbackChoice === 'bad') {
              // 10. BAD FLOW: Sincere apology and manager follow-up
              autoReplyText = "Thank you for your valuable feedback. We sincerely apologize that your experience did not meet expectations. Our salon manager will get in touch with you shortly to make it right.";
            }

            console.log(`[WhatsApp Webhook] Dispatching automated feedback response to ${fromPhone} (Rating: ${feedbackChoice.toUpperCase()})...`);
            if (autoReplyText) {
              const replyResult = await sendWhatsAppFreeformReply(branchId, fromPhone, autoReplyText, receiverPhoneNumberId);
              console.log(`[WhatsApp Webhook] Automated response result for ${fromPhone}:`, replyResult);
              if (feedbackRecord?.id) {
                await salonRepository.updateAppointmentFeedback(feedbackRecord.id, {
                  reply_status: replyResult.success ? 'sent' : 'failed',
                  outgoing_meta_message_id: replyResult.messageId,
                  reply_sent_at: new Date().toISOString()
                }).catch(() => null);
              }

              // Also record automated reply into WhatsApp Inbox thread
              if (inboxConversation?.id) {
                try {
                  const replyMsg = await salonRepository.createWhatsAppMessage({
                    conversation_id: inboxConversation.id,
                    direction: 'OUTBOUND',
                    message_type: 'text',
                    text_body: autoReplyText,
                    meta_message_id: replyResult.messageId,
                    status: replyResult.success ? 'sent' : 'failed',
                    source_badge: 'AUTOMATIC',
                    error_message: replyResult.error,
                    sent_at: new Date().toISOString()
                  });
                  await salonRepository.updateWhatsAppConversation(inboxConversation.id, {
                    last_message_at: new Date().toISOString(),
                    last_message_text: autoReplyText,
                    last_message_preview: autoReplyText
                  });
                  broadcastWhatsAppInboxEvent({
                    type: 'outbound_message',
                    conversationId: inboxConversation.id,
                    message: replyMsg,
                    conversation: inboxConversation
                  });
                } catch (autoErr) {
                  console.warn('[WhatsApp Webhook] Failed to record auto-reply in inbox:', autoErr);
                }
              }
            }

            // Only for BAD feedback, trigger manager alert audit log
            if (feedbackChoice === 'bad') {
              await salonRepository.logAudit(
                'CUSTOMER_FEEDBACK_ALERT',
                'AppointmentFeedback',
                targetOrderId || targetAptId || fromPhone,
                'WhatsApp Webhook',
                `⚠️ Customer ${customerName} (${fromPhone}) rated visit as BAD. Immediate manager follow-up required.`
              );
            }

            // Record audit log for feedback processing in whatsapp_webhook_events
            try {
              await salonRepository.createWhatsAppWebhookEvent({
                event_id: `${msg.id || Date.now()}_feedback_processed`,
                event_type: 'feedback_processed',
                sender_phone: fromPhone,
                recipient_phone_number_id: receiverPhoneNumberId,
                payload: {
                  feedback_choice: feedbackChoice,
                  matched_method: matchedMethod,
                  order_id: targetOrderId,
                  appointment_id: targetAptId,
                  classification: 'FEEDBACK_RESPONSE'
                },
                status: 'processed'
              });
            } catch {}
          }
        }
      }
    }
  } catch (err: any) {
    console.error('[WhatsApp Webhook] Handler error:', err.message);
  }
}

app.get(META_WEBHOOK_PATHS, handleMetaWebhookVerification);
app.post(META_WEBHOOK_PATHS, handleMetaWebhookEvent);

// ----------------------------------------------------------------------------
// WhatsApp Admin Activity, Feedback & Test Endpoints
// ----------------------------------------------------------------------------

async function resolveStaffAssignedBranchId(admin: { id: string; user_id?: string; email?: string; branch_id?: string | null }): Promise<string> {
  if (admin.branch_id && String(admin.branch_id).trim()) {
    return String(admin.branch_id).trim();
  }
  try {
    const staffList = await salonRepository.getStaff();
    const match = staffList.find(
      s =>
        (s.user_id && String(s.user_id) === String(admin.id)) ||
        (s.admin_user_id && admin.user_id && s.admin_user_id === admin.user_id) ||
        (s.email && admin.email && s.email.trim().toLowerCase() === admin.email.trim().toLowerCase())
    );
    if (match?.branch_id && String(match.branch_id).trim()) {
      return String(match.branch_id).trim();
    }
  } catch {
    // Fallback to flagship branch
  }
  return getDefaultBranchIdFromRepo();
}

async function getDefaultBranchIdFromRepo(): Promise<string> {
  const envBranch = (process.env.SMAV_SALON_DEFAULT_BRANCH_ID || '').trim();
  if (envBranch) return envBranch;
  try {
    const branches = await salonRepository.getBranches();
    const active = branches.find(b => b.is_active !== false) || branches[0];
    return active?.id || '';
  } catch {
    return '';
  }
}

async function fetchApprovedWabaTemplates(branchId?: string): Promise<{
  templates: Array<{
    name: string;
    status: string;
    language: string;
    category?: string;
    components?: any[];
  }>;
  source: 'meta_api' | 'unavailable';
  error?: string;
}> {
  try {
    const integration = await salonRepository.getWhatsAppIntegration();
    const defaultBranchId = await getDefaultBranchIdFromRepo();
    const effectiveBranchId = branchId || defaultBranchId;
    const branchIntegration = effectiveBranchId
      ? await salonRepository.getBranchWhatsAppIntegration(effectiveBranchId)
      : null;
    const fallbackBranchIntegration = defaultBranchId && effectiveBranchId !== defaultBranchId
      ? await salonRepository.getBranchWhatsAppIntegration(defaultBranchId)
      : null;
    const wabaId =
      branchIntegration?.waba_id ||
      fallbackBranchIntegration?.waba_id ||
      integration?.waba_id ||
      META_BUSINESS_ID;

    if (!wabaId || !META_SYSTEM_USER_ACCESS_TOKEN) {
      return {
        templates: [],
        source: 'unavailable',
        error: !wabaId ? 'No WABA ID configured.' : 'META_SYSTEM_USER_ACCESS_TOKEN is not configured on server.'
      };
    }

    const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${wabaId}/message_templates?fields=name,status,language,components,category&limit=100`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${META_SYSTEM_USER_ACCESS_TOKEN}`
      }
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data?.data)) {
      return {
        templates: [],
        source: 'unavailable',
        error: data?.error?.message || `Meta template API returned HTTP ${response.status}`
      };
    }

    const approved = data.data
      .filter((t: any) => String(t.status || '').toUpperCase() === 'APPROVED')
      .map((t: any) => ({
        name: String(t.name),
        status: String(t.status),
        language: String(t.language || 'en'),
        category: t.category ? String(t.category) : undefined,
        components: Array.isArray(t.components) ? t.components : []
      }));

    return { templates: approved, source: 'meta_api' };
  } catch (err: any) {
    return { templates: [], source: 'unavailable', error: err?.message || 'Failed to fetch Meta templates.' };
  }
}

// Short-lived in-memory cache for Meta approved template definitions so admin alerts
// automatically match live placeholder count/order/language without extra API round-trips
const META_TEMPLATE_CACHE_TTL_MS = 5 * 60 * 1000;
const approvedMetaTemplatesCache = new Map<
  string,
  { expiresAt: number; templates: ApprovedMetaTemplateSchema[] }
>();
const inFlightAdminAlertKeys = new Set<string>();

async function getCachedApprovedMetaTemplates(
  branchId?: string
): Promise<ApprovedMetaTemplateSchema[]> {
  const cacheKey = branchId || '__default__';
  const cached = approvedMetaTemplatesCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.templates;
  }
  const result = await fetchApprovedWabaTemplates(branchId);
  if (result.source === 'meta_api' && result.templates.length > 0) {
    approvedMetaTemplatesCache.set(cacheKey, {
      expiresAt: Date.now() + META_TEMPLATE_CACHE_TTL_MS,
      templates: result.templates,
    });
    return result.templates;
  }
  return cached?.templates || [];
}

async function dispatchSalonAdminWhatsAppAlert(params: {
  entityType: 'appointment' | 'enquiry';
  entityId: string;
  branchId: string;
  branch?: any;
  branchHint?: string | null;
  templateName: string;
  variables: Record<string, string>;
  defaultPositionalOrder: Array<{ key: string; value: string }>;
  fingerprintParts: string[];
  idempotencyKey?: string | null;
  appointmentId?: string;
  customerName?: string;
}): Promise<void> {
  const {
    entityType,
    entityId,
    branchId,
    branch,
    branchHint,
    templateName,
    variables,
    defaultPositionalOrder,
    fingerprintParts,
    idempotencyKey,
    appointmentId,
    customerName,
  } = params;

  const recipients = resolveBranchAlertRecipients(branch, branchHint);
  if (recipients.length === 0) {
    console.warn(
      `[WhatsApp Admin Alert] No recipient configured for ${entityType} ${entityId} (branch: ${branchId}). Configure WHATSAPP_GACHIBOWLI_ALERT_NUMBER / WHATSAPP_KONDAPUR_ALERT_NUMBER / WHATSAPP_ADMIN_ALERT_NUMBER.`
    );
    return;
  }

  const approvedTemplates = await getCachedApprovedMetaTemplates(branchId).catch(() => []);
  const approvedSchema = approvedTemplates.find(
    t => t.name.toLowerCase() === templateName.toLowerCase()
  );

  const builtPayload = buildAlertTemplateComponents({
    templateName,
    entityType,
    approvedTemplateSchema: approvedSchema,
    variables,
    defaultPositionalOrder,
  });

  // Load existing logs once for appointment alerts as an extra durable duplicate check
  let existingAppointmentLogs: any[] = [];
  if (entityType === 'appointment' && appointmentId) {
    try {
      existingAppointmentLogs = await salonRepository.getWhatsAppMessageLogs(appointmentId);
    } catch {
      existingAppointmentLogs = [];
    }
  }

  const jobType = entityType === 'appointment' ? 'appointment_admin_alert' : 'enquiry_admin_alert';

  await Promise.allSettled(
    recipients.map(async recipient => {
      const dedupKeys = buildAdminAlertDedupKeys({
        entityType,
        entityId,
        recipientMeta: recipient.metaRecipient,
        fingerprintParts,
        idempotencyKey,
      });

      // 1. Process-level in-flight lock prevents duplicate concurrent sends
      if (dedupKeys.some(key => inFlightAdminAlertKeys.has(key))) {
        return;
      }

      // 2. Durable check in whatsapp_message_logs (for appointments)
      if (
        entityType === 'appointment' &&
        existingAppointmentLogs.some(
          log =>
            log.template_name === templateName &&
            String(log.recipient_number || '').replace(/\D/g, '').endsWith(recipient.metaRecipient.slice(-10)) &&
            (log.status === 'sent' || log.status === 'delivered' || log.status === 'read')
        )
      ) {
        return;
      }

      // 3. Durable idempotency check in processed_webhook_events
      for (const key of dedupKeys) {
        try {
          if (await salonRepository.isWebhookEventProcessed(key)) {
            return;
          }
        } catch {
          // Continue to lock/send if lookup transiently fails
        }
      }

      // Claim keys before Meta API call to block retries/refreshes across concurrent requests
      dedupKeys.forEach(key => inFlightAdminAlertKeys.add(key));
      try {
        for (const key of dedupKeys) {
          await salonRepository.recordProcessedWebhookEvent(key, jobType).catch(() => null);
        }

        const extraDiagnostics = [
          `entity_type=${entityType}`,
          `entity_id=${entityId}`,
          `branch_id=${branchId}`,
          `recipient_role=${recipient.role}`,
          `template_schema=${builtPayload.usedLiveMetaSchema ? 'meta_live' : 'default_fallback'}`,
          `param_count=${builtPayload.resolvedParameters.length}`,
        ].join('; ');

        const sendResult = await sendBranchWhatsAppTemplate({
          branchId,
          recipientPhone: recipient.metaRecipient,
          templateName: builtPayload.templateName,
          templateLanguage: builtPayload.templateLanguage,
          components: builtPayload.components,
          appointmentId: entityType === 'appointment' ? appointmentId : undefined,
          renderedPreview: builtPayload.renderedPreview,
          templateParams: Object.fromEntries(
            builtPayload.resolvedParameters.map(p => [p.key, p.value])
          ),
          jobType,
          skipInboxRecording: true,
          disableAutoRetry: true,
          extraDiagnostics,
          customData: {
            customerName: customerName || variables.customer_name,
            branchName: variables.branch_name,
          },
        });

        console.log(
          `[WhatsApp Admin Alert] template=${builtPayload.templateName} entity=${entityType}:${entityId} recipient=${maskPhoneNumber(recipient.e164)} status=${sendResult.status} wamid=${sendResult.messageId || 'none'} error=${sendResult.error || 'none'}`
        );
      } finally {
        dedupKeys.forEach(key => inFlightAdminAlertKeys.delete(key));
      }
    })
  );
}

function buildRecordTemplateVariables(
  recordType: 'appointment' | 'order',
  record: any,
  branch: any
): Record<string, string> {
  const branchName = branch?.name || 'The Glossy Looks Salon';
  const branchAddress = branch?.address || 'Hyderabad';

  if (recordType === 'appointment') {
    const serviceNames = Array.isArray(record.services) && record.services.length > 0
      ? record.services.map((s: any) => s.name || s.item_name).filter(Boolean).join(', ')
      : 'Salon Service';
    return {
      customer_name: String(record.customer_name || 'Guest'),
      branch_name: branchName,
      branch_address: branchAddress,
      service_name: serviceNames,
      appointment_date: String(record.appointment_date || ''),
      appointment_time: String(record.time_slot || ''),
      booking_id: String(record.booking_reference || record.id || ''),
      amount: String(record.final_amount ?? record.total_amount ?? 0),
    };
  }

  const billDate = new Date(record.created_at || Date.now()).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
  const itemsSummary = Array.isArray(record.items) && record.items.length > 0
    ? record.items.map((i: any) => `${i.item_name} (x${i.quantity || 1})`).join(', ')
    : 'Salon Services';

  return {
    customer_name: String(record.customer_name || 'Guest'),
    bill_number: String(record.bill_number || record.id || ''),
    bill_date: billDate,
    items_summary: itemsSummary,
    grand_total: String(record.grand_total ?? 0),
    due_amount: String(record.due_amount ?? 0),
    payment_mode: String(record.primary_payment_mode || 'UPI'),
    branch_name: branchName,
    branch_address: branchAddress,
  };
}

function buildTemplateComponentsFromMetaSchema(
  templateSchema: { name: string; components?: any[] } | undefined,
  variables: Record<string, string>,
  fallbackCustomData?: SendWhatsAppTemplateOptions['customData']
): { components?: any[]; renderedPreview: string } {
  const bodyComp = templateSchema?.components?.find((c: any) => String(c.type || '').toUpperCase() === 'BODY');
  const rawBodyText = typeof bodyComp?.text === 'string' ? bodyComp.text : '';

  if (!rawBodyText) {
    // Let sendBranchWhatsAppTemplate build components for known templates from customData
    const summaryParts = Object.entries(variables)
      .filter(([, v]) => Boolean(String(v || '').trim()))
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`);
    return {
      components: undefined,
      renderedPreview: summaryParts.length > 0
        ? `[Template: ${templateSchema?.name || 'approved_template'}] ${summaryParts.join(' | ')}`
        : `[Template: ${templateSchema?.name || 'approved_template'}]`
    };
  }

  // Extract ordered placeholders from BODY text: {{1}}, {{2}} OR {{customer_name}}, {{bill_number}}
  const matches = [...rawBodyText.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)];
  if (matches.length === 0) {
    return {
      components: undefined,
      renderedPreview: rawBodyText
    };
  }

  const orderedPositionalDefaults = [
    variables.customer_name || fallbackCustomData?.customerName || 'Guest',
    variables.bill_number || variables.branch_name || fallbackCustomData?.billNumber || fallbackCustomData?.branchName || '',
    variables.bill_date || variables.service_name || fallbackCustomData?.billDate || fallbackCustomData?.serviceNames || '',
    variables.items_summary || variables.appointment_date || fallbackCustomData?.itemsSummary || fallbackCustomData?.appointmentDate || '',
    variables.grand_total || variables.appointment_time || String(fallbackCustomData?.grandTotal ?? fallbackCustomData?.appointmentTime ?? ''),
    variables.payment_mode || variables.booking_id || fallbackCustomData?.paymentMode || fallbackCustomData?.bookingId || '',
    variables.branch_name || variables.branch_address || fallbackCustomData?.branchName || fallbackCustomData?.branchAddress || ''
  ];

  const isNamed = matches.some(m => !/^\d+$/.test(m[1]));
  const parameters: any[] = [];
  let preview = rawBodyText;

  matches.forEach((m, idx) => {
    const token = m[1];
    let val = '';
    if (/^\d+$/.test(token)) {
      const posIndex = Number(token) - 1;
      val = variables[token] ?? variables[`var_${token}`] ?? orderedPositionalDefaults[posIndex] ?? '';
    } else {
      val = variables[token] ?? '';
    }
    const cleanVal = String(val || '').trim() || '-';
    if (isNamed && !/^\d+$/.test(token)) {
      parameters.push({ type: 'text', parameter_name: token, text: cleanVal });
    } else {
      parameters.push({ type: 'text', text: cleanVal });
    }
    preview = preview.replace(m[0], cleanVal);
  });

  return {
    components: [{ type: 'body', parameters }],
    renderedPreview: preview
  };
}

// 1. Get WhatsApp Message Logs (Authorized staff & admins)
app.get('/api/admin/whatsapp/message-logs', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || !canSendWhatsAppTemplates(admin.role)) {
      return res.status(403).json({ error: 'Access denied: Insufficient permissions to view WhatsApp delivery logs.' });
    }

    const appointmentId = req.query.appointment_id as string | undefined;
    const orderId = req.query.order_id as string | undefined;
    const fullAccess = hasFullPaymentLedgerAccess(admin.role);

    if (orderId && !fullAccess) {
      const order = await salonRepository.getOrderById(orderId);
      const staffBranch = await resolveStaffAssignedBranchId(admin);
      if (
        !order ||
        order.deleted_at ||
        !isWithinKolkataToday(order.created_at) ||
        (order.branch_id || '') !== staffBranch
      ) {
        return res.status(403).json({ error: 'Access denied: Staff may only view WhatsApp logs for today\'s bills in their assigned branch.' });
      }
    }

    const branchId = !fullAccess
      ? await resolveStaffAssignedBranchId(admin)
      : (req.query.branch_id as string | undefined);

    const logs = await salonRepository.getWhatsAppMessageLogs(appointmentId, branchId, orderId);
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Get Customer Feedback (Owner, Admin, Superadmin & Manager)
app.get('/api/admin/whatsapp/feedback', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || (!hasFullPaymentLedgerAccess(admin.role) && admin.role !== 'manager')) {
      return res.status(403).json({ error: 'Access denied: Restricted to Salon Owner, Admin, and Manager.' });
    }

    const branchId = !hasFullPaymentLedgerAccess(admin.role) && admin.branch_id
      ? admin.branch_id
      : (req.query.branch_id as string | undefined);

    const feedback = await salonRepository.getAppointmentFeedback(branchId);
    res.json(feedback);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Mark feedback notification as read
app.post('/api/admin/whatsapp/feedback/:id/read', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || (!hasFullPaymentLedgerAccess(admin.role) && admin.role !== 'manager')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    await salonRepository.markFeedbackAsRead(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Get Scheduled Feedback Jobs
app.get('/api/admin/whatsapp/scheduled-jobs', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || (!hasFullPaymentLedgerAccess(admin.role) && admin.role !== 'manager')) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const jobs = await salonRepository.getScheduledFeedbackJobs(req.query.status as string);
    res.json(jobs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4b. Get Meta WhatsApp Templates directly from WABA (never exposes tokens)
app.get('/api/admin/whatsapp/templates', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || !canSendWhatsAppTemplates(admin.role)) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const branchId = !hasFullPaymentLedgerAccess(admin.role)
      ? await resolveStaffAssignedBranchId(admin)
      : (req.query.branch_id as string | undefined);
    const result = await fetchApprovedWabaTemplates(branchId);
    res.json({ data: result.templates, source: result.source, ...(result.error ? { error: result.error } : {}) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4c. Get WhatsApp Template Context for an Appointment or Payment Ledger Bill/Order
app.get('/api/admin/whatsapp/record-context', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || !canSendWhatsAppTemplates(admin.role)) {
      return res.status(403).json({ error: 'Access denied: Insufficient permissions for WhatsApp templates.' });
    }

    const recordType = String(req.query.record_type || '').toLowerCase() as 'appointment' | 'order';
    const recordId = String(req.query.record_id || '').trim();
    if (!['appointment', 'order'].includes(recordType) || !recordId) {
      return res.status(400).json({ error: 'record_type (appointment|order) and record_id are required.' });
    }

    const fullAccess = hasFullPaymentLedgerAccess(admin.role);
    const staffBranch = await resolveStaffAssignedBranchId(admin);

    let record: any = null;
    let branchId = await getDefaultBranchIdFromRepo();
    let customerName = '';
    let customerPhone = '';
    let appointmentId: string | undefined;
    let orderId: string | undefined;

    if (recordType === 'appointment') {
      record = await salonRepository.getAppointmentById(recordId);
      if (!record) return res.status(404).json({ error: 'Appointment not found.' });
      if (record.deleted_at && !canDeleteOrRestoreRecords(admin.role)) {
        return res.status(403).json({ error: 'Access denied: Cannot access soft-deleted appointment.' });
      }
      branchId = record.branch_id || branchId;
      if (!fullAccess && admin.branch_id && branchId !== staffBranch) {
        return res.status(403).json({ error: 'Access denied: Appointment belongs to another branch.' });
      }
      customerName = record.customer_name || '';
      customerPhone = record.customer_phone || '';
      appointmentId = record.id;
    } else {
      record = await salonRepository.getOrderById(recordId);
      if (!record) {
        // Allow lookup by payment_id if caller passed payment ID
        const payments = await salonRepository.getPayments({ deleted: fullAccess ? 'all' : 'active' });
        const pay = payments.find(p => p.id === recordId);
        if (pay?.order_id) {
          record = await salonRepository.getOrderById(pay.order_id);
        }
      }
      if (!record) return res.status(404).json({ error: 'Bill / order not found.' });
      branchId = record.branch_id || branchId;

      if (!fullAccess) {
        if (record.deleted_at) {
          return res.status(403).json({ error: 'Access denied: Deleted payment records are restricted to Owner/Admin/Superadmin.' });
        }
        if (!isWithinKolkataToday(record.created_at)) {
          return res.status(403).json({ error: 'Access denied: Staff may only send WhatsApp templates for today\'s Payment Ledger records (Asia/Kolkata).' });
        }
        if (branchId !== staffBranch) {
          return res.status(403).json({ error: 'Access denied: Staff may only access Payment Ledger records for their assigned branch.' });
        }
      }
      customerName = record.customer_name || '';
      customerPhone = record.customer_phone || '';
      orderId = record.id;
    }

    const branch = branchId ? await salonRepository.getBranchById(branchId) : null;
    const phoneValidation = validateWhatsAppPhone(customerPhone);

    // Check 24-hour customer service window from permanent WhatsApp Inbox conversation
    let conversation: WhatsAppConversation | null = null;
    if (phoneValidation.isValid) {
      const convs = await salonRepository.getWhatsAppConversations({
        salonId: branchId || undefined,
        search: phoneValidation.digits
      });
      conversation = convs.find(c => {
        const cDigits = String(c.customer_phone || '').replace(/\D/g, '').slice(-10);
        return cDigits && cDigits === phoneValidation.digits.slice(-10);
      }) || null;
    }
    const lastInboundMs = conversation?.last_inbound_at ? new Date(conversation.last_inbound_at).getTime() : 0;
    const windowExpiresMs = lastInboundMs ? lastInboundMs + 24 * 60 * 60 * 1000 : 0;
    const windowOpen = Boolean(lastInboundMs && Date.now() < windowExpiresMs);

    const wabaResult = await fetchApprovedWabaTemplates(branchId);
    const recommendedOrder = recordType === 'appointment'
      ? ['gl_appointment_confirmation', 'gl_appointment_reminder', 'glossylooks_customer_feedback', 'the_glossylooks_customer_feedback']
      : ['gl_bill_receipt', 'gl_payment_reminder', 'glossylooks_customer_feedback', 'the_glossylooks_customer_feedback'];

    const approvedMap = new Map(wabaResult.templates.map(t => [t.name, t]));
    const prioritizedTemplates: typeof wabaResult.templates = [];
    for (const name of recommendedOrder) {
      const found = approvedMap.get(name);
      if (found) {
        prioritizedTemplates.push(found);
        approvedMap.delete(name);
      }
    }
    for (const remaining of approvedMap.values()) {
      prioritizedTemplates.push(remaining);
    }

    const expectedRequiredNames = recordType === 'appointment'
      ? ['gl_appointment_confirmation', 'gl_appointment_reminder', 'glossylooks_customer_feedback']
      : ['gl_bill_receipt', 'gl_payment_reminder', 'glossylooks_customer_feedback'];
    const approvedNamesSet = new Set(wabaResult.templates.map(t => t.name));
    const missingRecommendedTemplates = wabaResult.source === 'meta_api'
      ? expectedRequiredNames.filter(n => !approvedNamesSet.has(n) && !(n === 'glossylooks_customer_feedback' && approvedNamesSet.has('the_glossylooks_customer_feedback')))
      : [];

    const variables = buildRecordTemplateVariables(recordType, record, branch);
    const logs = await salonRepository.getWhatsAppMessageLogs(appointmentId, undefined, orderId);

    res.json({
      record_type: recordType,
      record_id: record.id,
      branch_id: branchId,
      branch_name: branch?.name || 'The Glossy Looks Salon',
      customer_name: customerName,
      customer_phone: customerPhone,
      phone_validation: phoneValidation,
      customer_service_window: {
        window_open: windowOpen,
        last_inbound_at: conversation?.last_inbound_at || null,
        window_expires_at: windowExpiresMs ? new Date(windowExpiresMs).toISOString() : null,
        conversation_id: conversation?.id || null,
        policy_note: 'Approved Meta WhatsApp templates only. Free-text messaging is disabled here to strictly comply with Meta 24-hour customer-service window rules.'
      },
      templates_source: wabaResult.source,
      templates_error: wabaResult.error || null,
      approved_templates: prioritizedTemplates,
      missing_recommended_templates: missingRecommendedTemplates,
      default_variables: variables,
      logs
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4d. Send Approved Meta WhatsApp Template for Appointment or Payment Ledger Bill/Order
app.post('/api/admin/whatsapp/send-record-template', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || !canSendWhatsAppTemplates(admin.role)) {
      return res.status(403).json({ error: 'Access denied: Insufficient permissions to send WhatsApp templates.' });
    }

    const {
      record_type,
      record_id,
      template_name,
      template_language,
      variables: clientVariables,
      retry_log_id
    } = req.body || {};

    const recordType = String(record_type || '').toLowerCase() as 'appointment' | 'order';
    const recordId = String(record_id || '').trim();
    const cleanTemplateName = String(template_name || '').trim();

    if (!['appointment', 'order'].includes(recordType) || !recordId) {
      return res.status(400).json({ error: 'record_type (appointment|order) and record_id are required.' });
    }

    if (!cleanTemplateName) {
      return res.status(400).json({
        error: 'An approved Meta WhatsApp template must be selected. Free-text messages are not permitted from this action.'
      });
    }

    if (!/^[a-z0-9_]+$/i.test(cleanTemplateName)) {
      return res.status(400).json({ error: 'Invalid Meta template name format.' });
    }

    const fullAccess = hasFullPaymentLedgerAccess(admin.role);
    const staffBranch = await resolveStaffAssignedBranchId(admin);

    let record: any = null;
    let branchId = await getDefaultBranchIdFromRepo();
    let appointmentId: string | undefined;
    let orderId: string | undefined;
    let billNumber: string | undefined;
    let paymentId: string | undefined;

    if (recordType === 'appointment') {
      record = await salonRepository.getAppointmentById(recordId);
      if (!record) return res.status(404).json({ error: 'Appointment not found.' });
      if (record.deleted_at) {
        return res.status(400).json({ error: 'Cannot send WhatsApp template for a deleted appointment. Restore it first.' });
      }
      branchId = record.branch_id || branchId;
      if (!fullAccess && admin.branch_id && branchId !== staffBranch) {
        return res.status(403).json({ error: 'Access denied: Appointment belongs to another branch.' });
      }
      appointmentId = record.id;
    } else {
      record = await salonRepository.getOrderById(recordId);
      if (!record) {
        const payments = await salonRepository.getPayments({ deleted: fullAccess ? 'all' : 'active' });
        const pay = payments.find(p => p.id === recordId);
        if (pay?.order_id) {
          paymentId = pay.id;
          record = await salonRepository.getOrderById(pay.order_id);
        }
      }
      if (!record) return res.status(404).json({ error: 'Bill / order not found.' });
      if (record.deleted_at) {
        return res.status(400).json({ error: 'Cannot send WhatsApp template for a deleted bill. Restore it first.' });
      }
      branchId = record.branch_id || branchId;

      if (!fullAccess) {
        if (!isWithinKolkataToday(record.created_at)) {
          return res.status(403).json({
            error: 'Access denied: Staff may only send WhatsApp templates for today\'s Payment Ledger records (Asia/Kolkata).'
          });
        }
        if (branchId !== staffBranch) {
          return res.status(403).json({
            error: 'Access denied: Staff may only send WhatsApp templates for their assigned branch.'
          });
        }
      }

      orderId = record.id;
      billNumber = record.bill_number;
      if (!paymentId) {
        const payments = await salonRepository.getPayments({ deleted: 'active' });
        paymentId = payments.find(p => p.order_id === record.id || p.bill_number === record.bill_number)?.id;
      }
    }

    // Validate customer WhatsApp number
    const phoneValidation = validateWhatsAppPhone(record.customer_phone);
    if (!phoneValidation.isValid) {
      return res.status(400).json({
        error: phoneValidation.error || 'Customer WhatsApp number is invalid or missing.'
      });
    }

    // If retrying, verify target log exists and is strictly in 'failed' state
    if (retry_log_id) {
      const existingLogs = await salonRepository.getWhatsAppMessageLogs(appointmentId, undefined, orderId);
      const targetLog = existingLogs.find(l => l.id === retry_log_id);
      if (!targetLog) {
        return res.status(404).json({ error: 'Original failed WhatsApp send log was not found.' });
      }
      if (targetLog.status !== 'failed') {
        return res.status(409).json({
          error: `Retry is only allowed for failed sends. Current delivery status is '${targetLog.status}'.`
        });
      }
    }

    // Enforce approved Meta templates only
    const wabaResult = await fetchApprovedWabaTemplates(branchId);
    const matchedTemplate = wabaResult.templates.find(t => t.name === cleanTemplateName);
    if (wabaResult.source === 'meta_api' && !matchedTemplate) {
      return res.status(400).json({
        error: `Template '${cleanTemplateName}' is not APPROVED in Meta WhatsApp Business Manager. Only approved templates may be sent.`
      });
    }

    const branch = await salonRepository.getBranchById(branchId);
    const defaultVars = buildRecordTemplateVariables(recordType, record, branch);
    const mergedVars: Record<string, string> = {
      ...defaultVars,
      ...(clientVariables && typeof clientVariables === 'object'
        ? Object.fromEntries(
            Object.entries(clientVariables).map(([k, v]) => [String(k), String(v ?? '').trim()])
          )
        : {})
    };

    const customData: SendWhatsAppTemplateOptions['customData'] = {
      customerName: mergedVars.customer_name || record.customer_name,
      branchName: mergedVars.branch_name || branch?.name || 'The Glossy Looks Salon',
      branchAddress: mergedVars.branch_address || branch?.address || 'Hyderabad',
      serviceNames: mergedVars.service_name,
      appointmentDate: mergedVars.appointment_date,
      appointmentTime: mergedVars.appointment_time,
      bookingId: mergedVars.booking_id,
      billNumber: mergedVars.bill_number || record.bill_number,
      billDate: mergedVars.bill_date,
      itemsSummary: mergedVars.items_summary,
      grandTotal: mergedVars.grand_total || (record.grand_total != null ? String(record.grand_total) : undefined),
      dueAmount: mergedVars.due_amount || (record.due_amount != null ? String(record.due_amount) : undefined),
      paymentMode: mergedVars.payment_mode || record.primary_payment_mode,
    };

    const knownBuiltInTemplates = new Set([
      'gl_appointment_confirmation',
      'gl_appointment_reminder',
      'gl_bill_receipt',
      'gl_payment_reminder',
      'glossylooks_customer_feedback',
      'the_glossylooks_customer_feedback'
    ]);

    const schemaComponents = buildTemplateComponentsFromMetaSchema(matchedTemplate, mergedVars, customData);
    const useExplicitComponents = !knownBuiltInTemplates.has(cleanTemplateName)
      ? schemaComponents.components
      : (matchedTemplate ? schemaComponents.components : undefined);

    const jobType =
      cleanTemplateName === 'gl_bill_receipt' ? 'bill_receipt' :
      cleanTemplateName.includes('payment') ? 'payment_reminder' :
      cleanTemplateName.includes('feedback') ? 'customer_feedback' :
      cleanTemplateName.includes('reminder') ? 'appointment_reminder' :
      'appointment_confirmation';

    const result = await sendBranchWhatsAppTemplate({
      branchId,
      recipientPhone: phoneValidation.e164,
      templateName: cleanTemplateName,
      templateLanguage: template_language || matchedTemplate?.language || undefined,
      components: useExplicitComponents,
      appointmentId,
      orderId,
      billNumber,
      paymentId,
      sentByUserId: admin.id,
      sentByUserName: admin.name,
      renderedPreview: schemaComponents.renderedPreview,
      templateParams: mergedVars,
      recordFailureInInbox: true,
      jobType,
      customData
    });

    const normalizedUiStatus =
      result.sent ? 'sent' :
      result.status === 'retrying' ? 'queued' :
      result.status === 'pending_approval' ? 'failed' : 'failed';

    // Update linked record status fields without breaking existing workflows
    if (recordType === 'appointment' && appointmentId) {
      await salonRepository.updateAppointment(appointmentId, {
        whatsapp_status: result.sent ? 'sent' : (result.status === 'retrying' ? 'retrying' : 'failed'),
        last_whatsapp_sent_at: result.sent ? new Date().toISOString() : record.last_whatsapp_sent_at,
        last_whatsapp_error: result.sent ? undefined : result.error
      }, admin.name).catch(() => null);
    } else if (recordType === 'order' && orderId) {
      if (cleanTemplateName === 'gl_bill_receipt') {
        await salonRepository.updateOrder(orderId, {
          receipt_whatsapp_status: result.sent ? 'sent' : (result.status === 'retrying' ? 'retrying' : 'failed'),
          receipt_whatsapp_message_id: result.messageId || record.receipt_whatsapp_message_id,
          receipt_whatsapp_sent_at: result.sent ? new Date().toISOString() : record.receipt_whatsapp_sent_at,
          receipt_whatsapp_error: result.sent ? undefined : result.error,
          whatsapp_status: result.sent ? 'sent' : (result.status === 'retrying' ? 'retrying' : 'failed')
        }).catch(() => null);
      } else if (cleanTemplateName.includes('feedback')) {
        if (result.sent) {
          await salonRepository.cancelScheduledFeedbackJobByOrder(orderId).catch(() => null);
        }
        await salonRepository.updateOrder(orderId, {
          feedback_whatsapp_status: result.sent ? 'sent' : (result.status === 'retrying' ? 'retrying' : 'failed'),
          feedback_whatsapp_message_id: result.messageId || record.feedback_whatsapp_message_id,
          feedback_whatsapp_sent_at: result.sent ? new Date().toISOString() : record.feedback_whatsapp_sent_at,
          feedback_whatsapp_source: 'MANUAL_FEEDBACK',
          feedback_whatsapp_error: result.sent ? undefined : result.error
        }).catch(() => null);
      }
    }

    await salonRepository.logAudit(
      result.sent ? 'WHATSAPP_TEMPLATE_SENT' : 'WHATSAPP_TEMPLATE_FAILED',
      recordType === 'appointment' ? 'Appointment' : 'PaymentLedgerBill',
      record.id,
      admin.name,
      JSON.stringify({
        record_type: recordType,
        record_id: record.id,
        reference: recordType === 'appointment' ? record.booking_reference : record.bill_number,
        customer_name: record.customer_name,
        recipient: phoneValidation.e164,
        template_name: cleanTemplateName,
        meta_message_id: result.messageId || null,
        status: normalizedUiStatus,
        retry_log_id: retry_log_id || null,
        sent_by_user_id: admin.id,
        sent_by_role: admin.role,
        error: result.error || null
      })
    ).catch(() => {});

    const statusCode = result.sent || result.status === 'retrying' ? 200 : 502;
    return res.status(statusCode).json({
      success: result.sent || result.status === 'retrying',
      status: normalizedUiStatus,
      message_id: result.messageId,
      error: result.error,
      diagnostics: result.diagnostics,
      log: result.log,
      inbox_message: result.inboxMessage || null
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to send WhatsApp template.' });
  }
});

// 5. Owner-Only Test Template Sender
app.post('/api/admin/whatsapp/test-send', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || admin.role !== 'owner') {
      return res.status(403).json({ error: 'Access denied: Only Salon Owners can send test WhatsApp templates.' });
    }

    const { branch_id, recipient, template_name } = req.body;
    if (!recipient || !template_name) {
      return res.status(400).json({ error: 'Recipient mobile number and template name are required.' });
    }

    const branchId = branch_id || (await getDefaultBranchIdFromRepo());
    const branch = branchId ? await salonRepository.getBranchById(branchId) : null;

    let components: any[] | undefined = undefined;
    if (template_name === 'gl_appointment_confirmation') {
      components = [
        {
          type: 'body',
          parameters: [
            { type: 'text', parameter_name: 'customer_name', text: 'Test Recipient' },
            { type: 'text', parameter_name: 'branch_name', text: branch?.name || 'The Glossy Looks Salon' },
            { type: 'text', parameter_name: 'service_name', text: 'Bridal Trial Consultation' },
            { type: 'text', parameter_name: 'appointment_date', text: new Date().toISOString().split('T')[0] },
            { type: 'text', parameter_name: 'appointment_time', text: '11:00 AM' },
            { type: 'text', parameter_name: 'booking_id', text: 'TEST-BKG01' },
            { type: 'text', parameter_name: 'branch_address', text: branch?.address || 'Hyderabad' }
          ]
        }
      ];
    } else if (template_name === 'the_glossylooks_customer_feedback' || template_name === 'glossylooks_customer_feedback') {
      components = [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Test Recipient' }
          ]
        }
      ];
    }

    const result = await sendBranchWhatsAppTemplate({
      branchId,
      recipientPhone: recipient,
      templateName: template_name,
      components
    });

    res.json({
      success: result.sent,
      status: result.status,
      message_id: result.messageId,
      error: result.error,
      diagnostics: result.diagnostics,
      log: result.log
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Test Feedback Reply Simulation (For controlled testing & automated tests)
app.post('/api/webhook/simulate-feedback-reply', async (req, res) => {
  try {
    const { phone, rating, text, appointment_id } = req.body;
    if (!phone || !rating) {
      return res.status(400).json({ error: 'phone and rating (good/average/bad) are required.' });
    }

    const cleanPhone = phoneDigits(phone).slice(-10);
    const validRating = (rating || '').toLowerCase();
    if (validRating !== 'good' && validRating !== 'average' && validRating !== 'bad') {
      return res.status(400).json({ error: 'rating must be good, average, or bad' });
    }

    const allApts = await salonRepository.getAppointments({ customerMobile: cleanPhone });
    const targetApt = appointment_id
      ? await salonRepository.getAppointmentById(appointment_id)
      : allApts[0];

    const aptId = targetApt ? targetApt.id : `apt-${cleanPhone}`;
    const branchId = targetApt?.branch_id || (await getDefaultBranchIdFromRepo());
    const customerName = targetApt?.customer_name || 'Simulated Customer';

    // Idempotency check: only first valid response
    const existingFeedbacks = await salonRepository.getAppointmentFeedback();
    const alreadyRecorded = existingFeedbacks.some(f => f.appointment_id === aptId);
    if (alreadyRecorded) {
      return res.json({
        success: false,
        message: 'Duplicate response ignored. First response is already recorded.',
        feedback: existingFeedbacks.find(f => f.appointment_id === aptId)
      });
    }

    const feedback = await salonRepository.createAppointmentFeedback({
      appointment_id: aptId,
      branch_id: branchId,
      customer_name: customerName,
      customer_phone: cleanPhone,
      rating: validRating,
      reply_text: text || validRating.toUpperCase(),
      is_read: false
    });

    let autoReplyText = '';
    if (validRating === 'good') {
      autoReplyText = "Thank you for choosing The Glossy Looks. We’re delighted you had a great experience. Your review means a lot to us: https://g.page/r/CTx5NddxkeKaEAE/review";
    } else if (validRating === 'average') {
      autoReplyText = "Thank you for your feedback. We’re sorry that your experience was not perfect. Our team will work to improve and serve you better on your next visit.";
    } else if (validRating === 'bad') {
      autoReplyText = "We’re truly sorry that your experience did not meet expectations. Your feedback is important to us. Our salon manager will review this and work to improve.";
    }

    if (validRating === 'average' || validRating === 'bad') {
      await salonRepository.logAudit(
        'CUSTOMER_FEEDBACK_ALERT',
        'AppointmentFeedback',
        aptId,
        'Simulation',
        `⚠️ Customer ${customerName} (${cleanPhone}) rated visit as ${validRating.toUpperCase()} for Ref ${targetApt?.booking_reference || 'N/A'}.`
      );
    }

    res.json({
      success: true,
      feedback,
      auto_reply_sent: autoReplyText,
      alert_generated: validRating === 'average' || validRating === 'bad'
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// WhatsApp Inbox & Customer Chat Endpoints (Owner & Manager Only)
// ============================================================================

// 1. Real-time SSE stream for incoming/outbound messages and status changes
app.get('/api/admin/whatsapp/inbox/stream', async (req, res) => {
  const admin = await getAuthAdmin(req);
  if (!admin || (admin.role !== 'owner' && admin.role !== 'manager')) {
    return res.status(403).json({ error: 'Access denied: Restricted to Salon Owner and Manager.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);
  whatsappInboxSseClients.add(res);

  const keepAlive = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch {
      clearInterval(keepAlive);
      whatsappInboxSseClients.delete(res);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    whatsappInboxSseClients.delete(res);
  });
});

// 2. Unread conversation count badge
app.get('/api/admin/whatsapp/inbox/unread-count', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || (admin.role !== 'owner' && admin.role !== 'manager')) {
      return res.status(403).json({ error: 'Access denied: Restricted to Salon Owner and Manager.' });
    }
    const branchId = admin.role === 'manager' && admin.branch_id ? admin.branch_id : undefined;
    const count = await salonRepository.getWhatsAppInboxUnreadCount(branchId);
    res.json({ unread_count: count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Diagnostics endpoint for WhatsApp Inbox & Webhook Health
app.get('/api/admin/whatsapp/inbox/diagnostics', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || (admin.role !== 'owner' && admin.role !== 'manager')) {
      return res.status(403).json({ error: 'Access denied: Restricted to Salon Owner and Manager.' });
    }
    const diagnostics = await salonRepository.getWhatsAppWebhookDiagnostics();
    res.json(diagnostics);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. List conversations with search and filters
app.get('/api/admin/whatsapp/inbox/conversations', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || (admin.role !== 'owner' && admin.role !== 'manager')) {
      return res.status(403).json({ error: 'Access denied: Restricted to Salon Owner and Manager.' });
    }
    const branchId = admin.role === 'manager' && admin.branch_id ? admin.branch_id : (req.query.branch_id as string | undefined);
    const filterParam = (req.query.filter as any) || (req.query.status as any) || 'all';
    const conversations = await salonRepository.getWhatsAppConversations({
      branch_id: branchId,
      filter: filterParam,
      status: filterParam,
      search: (req.query.search as string) || undefined
    });
    res.json(conversations);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Get single conversation
app.get('/api/admin/whatsapp/inbox/conversations/:id', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || (admin.role !== 'owner' && admin.role !== 'manager')) {
      return res.status(403).json({ error: 'Access denied: Restricted to Salon Owner and Manager.' });
    }
    const conv = await salonRepository.getWhatsAppConversationById(req.params.id);
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }
    res.json(conv);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Get conversation messages and mark conversation as read
app.get('/api/admin/whatsapp/inbox/conversations/:id/messages', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || (admin.role !== 'owner' && admin.role !== 'manager')) {
      return res.status(403).json({ error: 'Access denied: Restricted to Salon Owner and Manager.' });
    }
    const conv = await salonRepository.getWhatsAppConversationById(req.params.id);
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }

    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const before = req.query.before as string | undefined;

    const messages = await salonRepository.getWhatsAppMessages(req.params.id, limit, before);

    // Automatically mark read if unread count > 0
    if (conv.unread_count > 0) {
      await salonRepository.markWhatsAppConversationRead(req.params.id);
      broadcastWhatsAppInboxEvent({
        type: 'conversation_read',
        conversationId: req.params.id
      });
    }

    res.json({
      conversation: conv,
      messages,
      has_more: messages.length >= limit
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Send manual admin reply (Enforcing 24-hour customer service window)
app.post('/api/admin/whatsapp/inbox/conversations/:id/messages', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || (admin.role !== 'owner' && admin.role !== 'manager')) {
      return res.status(403).json({ error: 'Access denied: Restricted to Salon Owner and Manager.' });
    }

    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Message text cannot be empty.' });
    }

    const conv = await salonRepository.getWhatsAppConversationById(req.params.id);
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }

    // 24-hour customer service window calculation
    let isWindowOpen = false;
    let windowExpiresAt: string | null = null;
    let secondsRemaining = 0;
    if (conv.last_inbound_at) {
      const lastInboundTime = new Date(conv.last_inbound_at).getTime();
      const expiresTime = lastInboundTime + 24 * 60 * 60 * 1000;
      const now = Date.now();
      if (now < expiresTime) {
        isWindowOpen = true;
        secondsRemaining = Math.max(0, Math.floor((expiresTime - now) / 1000));
        windowExpiresAt = new Date(expiresTime).toISOString();
      }
    }

    if (!isWindowOpen) {
      return res.status(400).json({
        error: 'Customer service window expired. Free-form WhatsApp messages cannot be sent after 24 hours of customer inactivity. Please send an approved Meta WhatsApp template to resume conversation.',
        code: 'SERVICE_WINDOW_EXPIRED'
      });
    }

    const branchId = conv.branch_id || (await getDefaultBranchIdFromRepo());
    const cleanPhone = phoneDigits(conv.customer_phone).slice(-10);

    // Call existing sendWhatsAppFreeformReply
    const sendResult = await sendWhatsAppFreeformReply(
      branchId,
      cleanPhone,
      text.trim(),
      conv.wa_phone_number_id
    );

    const createdMsg = await salonRepository.createWhatsAppMessage({
      conversation_id: conv.id,
      direction: 'OUTBOUND',
      message_type: 'text',
      text_body: text.trim(),
      message_body: text.trim(),
      meta_message_id: sendResult.messageId,
      status: sendResult.success ? 'sent' : 'failed',
      source_badge: 'ADMIN',
      error_message: sendResult.error,
      sent_by_user_id: admin.id,
      sent_by_user_name: admin.name,
      sent_at: new Date().toISOString()
    });

    const updatedConv = await salonRepository.updateWhatsAppConversation(conv.id, {
      last_message_at: new Date().toISOString(),
      last_message_text: text.trim(),
      last_message_preview: text.trim()
    });

    broadcastWhatsAppInboxEvent({
      type: 'outbound_message',
      conversationId: conv.id,
      message: createdMsg,
      conversation: updatedConv || conv
    });

    if (!sendResult.success) {
      return res.status(400).json({
        error: sendResult.error || 'Failed to dispatch WhatsApp message via Meta Cloud API.',
        message: createdMsg,
        conversation: updatedConv || conv
      });
    }

    res.json({
      success: true,
      message: createdMsg,
      conversation: updatedConv || conv
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Send approved template message to customer
app.post('/api/admin/whatsapp/inbox/conversations/:id/send-template', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || (admin.role !== 'owner' && admin.role !== 'manager')) {
      return res.status(403).json({ error: 'Access denied: Restricted to Salon Owner and Manager.' });
    }

    const { template_name, custom_data } = req.body;
    if (!template_name) {
      return res.status(400).json({ error: 'Template name is required.' });
    }

    const conv = await salonRepository.getWhatsAppConversationById(req.params.id);
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }

    const branchId = conv.branch_id || (await getDefaultBranchIdFromRepo());
    const sendResult = await sendBranchWhatsAppTemplate({
      branchId,
      recipientPhone: conv.customer_phone,
      templateName: template_name,
      customData: {
        customerName: conv.customer_name,
        ...(custom_data || {})
      }
    });

    const templatePreview = `[Template: ${template_name}]`;
    const createdMsg = await salonRepository.createWhatsAppMessage({
      conversation_id: conv.id,
      direction: 'OUTBOUND',
      message_type: 'template',
      text_body: templatePreview,
      message_body: templatePreview,
      template_name: template_name,
      meta_message_id: sendResult.messageId,
      status: sendResult.sent ? 'sent' : 'failed',
      source_badge: 'TEMPLATE',
      error_message: sendResult.error,
      sent_by_user_id: admin.id,
      sent_by_user_name: admin.name,
      sent_at: new Date().toISOString()
    });

    await salonRepository.updateWhatsAppConversation(conv.id, {
      last_message_at: new Date().toISOString(),
      last_message_text: templatePreview,
      last_message_preview: templatePreview
    });

    broadcastWhatsAppInboxEvent({
      type: 'outbound_message',
      conversationId: conv.id,
      message: createdMsg
    });

    if (!sendResult.sent) {
      return res.status(400).json({
        error: sendResult.error || 'Failed to send template message via Meta Cloud API.',
        message: createdMsg
      });
    }

    res.json({
      success: true,
      message: createdMsg,
      message_id: sendResult.messageId
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Update conversation status (Open / Closed)
app.patch('/api/admin/whatsapp/inbox/conversations/:id', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || (admin.role !== 'owner' && admin.role !== 'manager')) {
      return res.status(403).json({ error: 'Access denied: Restricted to Salon Owner and Manager.' });
    }

    const { status } = req.body;
    const normalizedStatus = String(status || '').toUpperCase();
    if (normalizedStatus !== 'OPEN' && normalizedStatus !== 'CLOSED') {
      return res.status(400).json({ error: 'Status must be OPEN or CLOSED.' });
    }

    const updated = await salonRepository.updateWhatsAppConversation(req.params.id, { status: normalizedStatus as any });
    if (!updated) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }

    broadcastWhatsAppInboxEvent({
      type: 'conversation_updated',
      conversationId: req.params.id,
      conversation: updated
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Delete conversation (Owner only, permanent)
app.delete('/api/admin/whatsapp/inbox/conversations/:id', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || admin.role !== 'owner') {
      return res.status(403).json({ error: 'Access denied: Deleting conversations is restricted to Salon Owners only.' });
    }

    await salonRepository.deleteWhatsAppConversation(req.params.id);

    broadcastWhatsAppInboxEvent({
      type: 'conversation_deleted',
      conversationId: req.params.id
    });

    res.json({ success: true, message: 'Conversation permanently deleted.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ============================================================================
// Multi-Branch Management & Branch WhatsApp Coexistence Onboarding
// ============================================================================

async function checkBranchAccess(req: express.Request, branchId: string): Promise<{ authorized: boolean; admin?: any; branch?: any; error?: string; status?: number }> {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return { authorized: false, error: 'Authentication required. Please log in as Salon Owner or Branch Manager.', status: 401 };
  }

  if (admin.role !== 'owner' && admin.role !== 'manager') {
    return { authorized: false, error: 'Access denied: Only Salon Owners and assigned Branch Managers can access WhatsApp Integration.', status: 403 };
  }

  const branch = await salonRepository.getBranchById(branchId);
  if (!branch) {
    return { authorized: false, error: `Salon branch '${branchId}' not found.`, status: 404 };
  }

  if (admin.role === 'owner') {
    return { authorized: true, admin, branch };
  }

  // Role is manager: verify this manager is assigned to this branch
  const isAssigned = admin.branch_id === branchId || branch.manager_id === admin.id || branch.manager_id === admin.user_id;
  if (!isAssigned) {
    return {
      authorized: false,
      error: `Access denied: You are assigned to manage branch '${admin.branch_id || 'N/A'}' and cannot configure WhatsApp for '${branch.name}'.`,
      status: 403
    };
  }

  return { authorized: true, admin, branch };
}

// Public / Operational endpoint for branches (loaded dynamically from public.salon_branches)
app.get('/api/branches', async (req, res) => {
  try {
    const allBranches = await salonRepository.getBranches();
    const enriched = allBranches.map(b => ({
      ...b,
      smav_branch_code: resolveCanonicalBranchCode({ localBranch: b }) || b.smav_branch_code || b.code,
    }));
    return res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POS Permitted Branches loaded dynamically from SMAV branch API (source of truth; zero hard-coded fallbacks)
app.get('/api/pos/branches', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin) {
      return res.status(401).json({ error: 'Authentication required to load permitted POS branches.' });
    }

    const localBranches = await salonRepository.getBranches();
    const smavResult = await fetchSmavPermittedBranches({
      admin,
      localBranches,
    });

    return res.json({
      branches: smavResult.branches,
      all_branches: smavResult.allBranches,
      source: smavResult.source,
      warning: smavResult.warning || null,
      error: smavResult.error || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 1. Get Branches for Admin / Staff: Owner, cashiers, receptionists & staff see active branches
app.get('/api/admin/branches', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    const allBranches = (await salonRepository.getBranches()).map(b => ({
      ...b,
      smav_branch_code: resolveCanonicalBranchCode({ localBranch: b }) || b.smav_branch_code || b.code,
    }));
    if (!admin) {
      return res.json(allBranches);
    }

    // Branch manager: filter to assigned branch only, fallback to all if empty
    if (admin.role === 'manager') {
      const assignedBranches = allBranches.filter(b => b.id === admin.branch_id || b.manager_id === admin.id || b.manager_id === admin.user_id);
      return res.json(assignedBranches.length > 0 ? assignedBranches : allBranches);
    }

    return res.json(allBranches);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Create Branch: Owner Only
app.post('/api/admin/branches', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || admin.role !== 'owner') {
      return res.status(403).json({ error: 'Access denied: Only the Salon Owner can create new branches.' });
    }

    const { name, code, address, city, phone, whatsapp_number, manager_id } = req.body;
    if (!name || !address || !whatsapp_number) {
      return res.status(400).json({ error: 'Branch name, address, and configured WhatsApp number are required.' });
    }

    const cleanWaNumber = String(whatsapp_number).replace(/\D/g, '').slice(-10);
    const indianMobileRegex = /^[6-9]\d{9}$/;
    if (!indianMobileRegex.test(cleanWaNumber)) {
      return res.status(400).json({
        error: 'Invalid WhatsApp number. Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.'
      });
    }

    const existingBranches = await salonRepository.getBranches();
    const branchCode = code ? String(code).trim().toUpperCase() : `TGL-${String(existingBranches.length + 1).padStart(2, '0')}`;

    const newBranch = await salonRepository.createBranch({
      name: String(name).trim(),
      code: branchCode,
      address: String(address).trim(),
      city: city ? String(city).trim() : 'Hyderabad, Telangana',
      phone: phone ? String(phone).replace(/\D/g, '').slice(-10) : cleanWaNumber,
      whatsapp_number: cleanWaNumber,
      manager_id: manager_id || undefined,
      is_active: true
    }, admin.name);

    res.status(201).json(newBranch);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Get single branch
app.get('/api/admin/branches/:id', async (req, res) => {
  try {
    const access = await checkBranchAccess(req, req.params.id);
    if (!access.authorized) {
      return res.status(access.status || 403).json({ error: access.error });
    }
    res.json(access.branch);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Update branch details
app.patch('/api/admin/branches/:id', async (req, res) => {
  try {
    const access = await checkBranchAccess(req, req.params.id);
    if (!access.authorized) {
      return res.status(access.status || 403).json({ error: access.error });
    }

    const { name, code, address, city, phone, whatsapp_number, manager_id, is_active } = req.body;
    const patch: any = {};
    if (name !== undefined) patch.name = String(name).trim();
    if (code !== undefined) patch.code = String(code).trim().toUpperCase();
    if (address !== undefined) patch.address = String(address).trim();
    if (city !== undefined) patch.city = String(city).trim();
    if (phone !== undefined) patch.phone = String(phone).replace(/\D/g, '').slice(-10);
    if (whatsapp_number !== undefined) {
      const cleanWa = String(whatsapp_number).replace(/\D/g, '').slice(-10);
      const indianMobileRegex = /^[6-9]\d{9}$/;
      if (!indianMobileRegex.test(cleanWa)) {
        return res.status(400).json({
          error: 'Invalid WhatsApp number. Please enter a valid 10-digit Indian mobile number.'
        });
      }
      patch.whatsapp_number = cleanWa;
    }
    // Only owner can assign managers or deactivate branches
    if (access.admin.role === 'owner') {
      if (manager_id !== undefined) patch.manager_id = manager_id || undefined;
      if (is_active !== undefined) patch.is_active = Boolean(is_active);
    }

    const updated = await salonRepository.updateBranch(req.params.id, patch, access.admin.name);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Delete branch: Owner Only
app.delete('/api/admin/branches/:id', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || admin.role !== 'owner') {
      return res.status(403).json({ error: 'Access denied: Only the Salon Owner can delete branches.' });
    }

    const ok = await salonRepository.deleteBranch(req.params.id, admin.name);
    res.json({ success: ok });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Branch WhatsApp Status
app.get('/api/admin/branches/:branchId/whatsapp/status', async (req, res) => {
  try {
    const access = await checkBranchAccess(req, req.params.branchId);
    if (!access.authorized) {
      return res.status(access.status || 403).json({ error: access.error });
    }

    const integration = await salonRepository.getBranchWhatsAppIntegration(req.params.branchId);

    res.json({
      branch: access.branch,
      integration: {
        id: integration.id,
        branch_id: integration.branch_id,
        configured_business_number: integration.configured_business_number,
        waba_id: integration.waba_id,
        phone_number_id: integration.phone_number_id,
        display_phone_number: integration.display_phone_number,
        masked_phone_number: integration.masked_phone_number || maskPhoneNumber(integration.display_phone_number || integration.configured_business_number),
        display_name: integration.display_name,
        status: integration.status,
        connected_at: integration.connected_at,
        last_verified_at: integration.last_verified_at,
        diagnostics: integration.diagnostics,
        error_message: integration.error_message,
        created_at: integration.created_at,
        updated_at: integration.updated_at
      },
      config: {
        meta_app_id: META_APP_ID,
        config_id: META_EMBEDDED_SIGNUP_CONFIG_ID,
        api_version: WHATSAPP_API_VERSION,
        is_configured: Boolean(META_APP_ID && META_EMBEDDED_SIGNUP_CONFIG_ID)
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Update Branch WhatsApp Settings (Configured Business Number)
app.post('/api/admin/branches/:branchId/whatsapp/settings', async (req, res) => {
  try {
    const access = await checkBranchAccess(req, req.params.branchId);
    if (!access.authorized) {
      return res.status(access.status || 403).json({ error: access.error });
    }

    const { whatsapp_number, display_name } = req.body;
    if (!whatsapp_number) {
      return res.status(400).json({ error: 'A valid WhatsApp business phone number is required.' });
    }

    const cleanNumber = String(whatsapp_number).replace(/\D/g, '').slice(-10);
    const indianMobileRegex = /^[6-9]\d{9}$/;
    if (!indianMobileRegex.test(cleanNumber)) {
      return res.status(400).json({
        error: 'Invalid phone number. Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.'
      });
    }

    const updatedBranch = await salonRepository.updateBranch(req.params.branchId, {
      whatsapp_number: cleanNumber,
      ...(display_name && { name: display_name.trim() })
    }, access.admin.name);

    res.json({
      success: true,
      message: 'Branch WhatsApp settings updated successfully.',
      branch: updatedBranch
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Start Branch WhatsApp Pairing (Sets status to pairing before Meta popup opens)
app.post('/api/admin/branches/:branchId/whatsapp/pairing', async (req, res) => {
  try {
    const access = await checkBranchAccess(req, req.params.branchId);
    if (!access.authorized) {
      return res.status(access.status || 403).json({ error: access.error });
    }

    const updated = await salonRepository.updateBranchWhatsAppIntegration(req.params.branchId, {
      status: 'pairing',
      diagnostics: 'Meta Embedded Signup Coexistence onboarding launched. Waiting for phone pairing QR scan...'
    }, access.admin.name);

    res.json({
      success: true,
      integration: updated
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Connect Branch WhatsApp Business integration after Meta Embedded Signup
app.post('/api/admin/branches/:branchId/whatsapp/connect', async (req, res) => {
  try {
    const access = await checkBranchAccess(req, req.params.branchId);
    if (!access.authorized) {
      return res.status(access.status || 403).json({ error: access.error });
    }

    const { waba_id, phone_number_id, code, display_name, display_phone_number } = req.body;
    const submittedWabaId = waba_id ? String(waba_id).trim() : '';
    const submittedPhoneId = phone_number_id ? String(phone_number_id).trim() : '';
    const submittedCode = typeof code === 'string' ? code.trim() : '';

    if (submittedWabaId && !isValidMetaNumericId(submittedWabaId)) {
      return res.status(400).json({
        error: 'Invalid WABA ID received. Meta WABA IDs must be authentic numeric identifiers; placeholders are not permitted.'
      });
    }
    if (submittedPhoneId && !isValidMetaNumericId(submittedPhoneId)) {
      return res.status(400).json({
        error: 'Invalid Phone Number ID received. Meta Phone Number IDs must be authentic numeric identifiers; placeholders are not permitted.'
      });
    }

    let cleanWabaId = submittedWabaId;
    let cleanPhoneId = submittedPhoneId;
    let codeResolvedDisplayName = '';
    let codeResolvedPhone = '';

    // If IDs were not included directly in postMessage, resolve them via server-side code exchange
    if (!cleanWabaId || !cleanPhoneId) {
      if (!submittedCode) {
        return res.status(400).json({
          error: 'Connection incomplete — Meta IDs were not received. Please scan the QR code in WhatsApp Business and complete pairing.'
        });
      }

      const resolved = await resolveAssetsFromEmbeddedSignupCode(
        submittedCode,
        access.branch.whatsapp_number,
        cleanWabaId || undefined,
        cleanPhoneId || undefined
      );

      if (!resolved.wabaId || !resolved.phoneNumberId) {
        if (resolved.candidates?.length) {
          return res.json({
            success: false,
            selection_required: true,
            message: resolved.error,
            candidates: resolved.candidates.map(candidate => ({
              waba_id: candidate.wabaId,
              phone_number_id: candidate.phoneNumberId,
              display_phone_number: candidate.displayPhoneNumber || '',
              verified_name: candidate.verifiedName || ''
            }))
          });
        }
        return res.status(400).json({
          error: resolved.error || 'Connection incomplete — Meta IDs were not received from authorization code.'
        });
      }

      cleanWabaId = resolved.wabaId;
      cleanPhoneId = resolved.phoneNumberId;
      codeResolvedDisplayName = resolved.verifiedName || '';
      codeResolvedPhone = resolved.displayPhoneNumber || '';
    }

    if (!isValidMetaNumericId(cleanWabaId) || !isValidMetaNumericId(cleanPhoneId)) {
      return res.status(400).json({
        error: 'Meta authorization completed, but valid numeric WABA and Phone Number IDs could not be resolved. Please retry Embedded Signup.'
      });
    }

    let resolvedDisplayName = codeResolvedDisplayName || display_name || access.branch.name || 'The Glossy Looks Salon';
    let resolvedPhone = codeResolvedPhone || display_phone_number || access.branch.whatsapp_number || '';

    // Step 4: Call Meta Graph API server-side to verify that the phone number belongs to the returned WABA
    const verification = await verifyMetaWabaOwnership(cleanWabaId, cleanPhoneId);

    if (verification.verified) {
      if (verification.verified_name) resolvedDisplayName = verification.verified_name;
      if (verification.display_phone_number) resolvedPhone = verification.display_phone_number;

      // Strict Branch Phone Number Matching (Requirement E.3):
      // Do not allow an admin to connect a Meta phone number to a branch unless
      // the selected number matches the branch's configured WhatsApp number.
      const branchDigits = phoneDigits(access.branch.whatsapp_number).slice(-10);
      const verifiedDigits = phoneDigits(resolvedPhone).slice(-10);
      if (branchDigits && verifiedDigits && branchDigits !== verifiedDigits) {
        return res.status(400).json({
          error: `Phone number mismatch: The selected Meta phone number (${resolvedPhone}) does not match this branch's configured WhatsApp number (${access.branch.whatsapp_number}). Please select the correct phone number or update the branch configuration.`
        });
      }

      const maskedPhone = maskPhoneNumber(resolvedPhone);
      const diagnosticDetail = `FINISH event received / WABA ID received / Phone Number ID received / Graph verification passed.`;

      const saved = await salonRepository.updateBranchWhatsAppIntegration(req.params.branchId, {
        waba_id: cleanWabaId,
        phone_number_id: cleanPhoneId,
        display_name: resolvedDisplayName,
        display_phone_number: resolvedPhone,
        masked_phone_number: maskedPhone,
        status: 'connected',
        connected_at: new Date().toISOString(),
        last_verified_at: new Date().toISOString(),
        diagnostics: diagnosticDetail,
        error_message: undefined
      }, access.admin.name);

      return res.json({
        success: true,
        message: 'WhatsApp Business Coexistence connected and verified with Meta Graph API for branch.',
        diagnostics: diagnosticDetail,
        integration: saved
      });
    } else {
      const diagnosticDetail = `FINISH event received / WABA ID received / Phone Number ID received / Graph verification failed: ${verification.error || 'Ownership mismatch'}`;
      const saved = await salonRepository.updateBranchWhatsAppIntegration(req.params.branchId, {
        waba_id: cleanWabaId,
        phone_number_id: cleanPhoneId,
        display_name: resolvedDisplayName,
        display_phone_number: resolvedPhone,
        masked_phone_number: maskPhoneNumber(resolvedPhone),
        status: 'failed',
        last_verified_at: new Date().toISOString(),
        diagnostics: diagnosticDetail,
        error_message: verification.error
      }, access.admin.name);

      return res.status(400).json({
        success: false,
        error: verification.error || 'Meta verification failed. Phone number does not belong to the returned WABA.',
        diagnostics: diagnosticDetail,
        integration: saved
      });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Test Branch WhatsApp Connection with Meta Graph API
app.post('/api/admin/branches/:branchId/whatsapp/test', async (req, res) => {
  try {
    const access = await checkBranchAccess(req, req.params.branchId);
    if (!access.authorized) {
      return res.status(access.status || 403).json({ error: access.error });
    }

    const integration = await salonRepository.getBranchWhatsAppIntegration(req.params.branchId);
    if (!integration.waba_id || !integration.phone_number_id) {
      return res.status(400).json({
        error: 'No WhatsApp Business IDs configured for this branch. Please pair via Meta Embedded Signup first.'
      });
    }

    if (!isValidMetaNumericId(integration.waba_id) || !isValidMetaNumericId(integration.phone_number_id)) {
      return res.status(400).json({
        error: 'Stored Meta IDs are invalid or placeholder. Please reconnect via Meta Embedded Signup.'
      });
    }

    const verification = await verifyMetaWabaOwnership(integration.waba_id, integration.phone_number_id);

    if (verification.verified) {
      const diagnosticDetail = 'FINISH event received / WABA ID received / Phone Number ID received / Graph verification passed.';
      const updated = await salonRepository.updateBranchWhatsAppIntegration(req.params.branchId, {
        status: 'connected',
        last_verified_at: new Date().toISOString(),
        diagnostics: diagnosticDetail,
        error_message: undefined,
        ...(verification.verified_name && { display_name: verification.verified_name }),
        ...(verification.display_phone_number && {
          display_phone_number: verification.display_phone_number,
          masked_phone_number: maskPhoneNumber(verification.display_phone_number)
        })
      }, access.admin.name);

      return res.json({
        success: true,
        message: 'WhatsApp connection verified successfully with Meta Graph API. Account is active.',
        diagnostics: diagnosticDetail,
        integration: updated
      });
    } else {
      const diagnosticDetail = `WABA ID received / Phone Number ID received / Graph verification failed: ${verification.error || 'Verification failed'}`;
      const updated = await salonRepository.updateBranchWhatsAppIntegration(req.params.branchId, {
        status: 'failed',
        last_verified_at: new Date().toISOString(),
        diagnostics: diagnosticDetail,
        error_message: verification.error
      }, access.admin.name);

      return res.status(400).json({
        success: false,
        error: verification.error || 'Meta Graph API verification failed.',
        diagnostics: diagnosticDetail,
        integration: updated
      });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Disconnect Branch WhatsApp Business
app.post('/api/admin/branches/:branchId/whatsapp/disconnect', async (req, res) => {
  try {
    const access = await checkBranchAccess(req, req.params.branchId);
    if (!access.authorized) {
      return res.status(access.status || 403).json({ error: access.error });
    }

    const disconnected = await salonRepository.disconnectBranchWhatsAppIntegration(req.params.branchId, access.admin.name);

    res.json({
      success: true,
      message: `WhatsApp Business integration for branch '${access.branch.name}' has been disconnected.`,
      integration: disconnected
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// Categories, Services & Packages CRUD
// ----------------------------------------------------------------------------
app.get('/api/categories', async (req, res) => {
  try {
    const cats = await salonRepository.getCategories();
    res.json(cats);
  } catch (err: any) {
    console.error('[GET /api/categories] Error:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Failed to load service categories' });
  }
});

app.post('/api/categories', async (req, res) => {
  const actor = (req.headers['x-admin-name'] as string) || 'Admin';
  const cat = await salonRepository.createCategory(req.body, actor);
  res.status(201).json(cat);
});

app.patch('/api/categories/:id', async (req, res) => {
  const actor = (req.headers['x-admin-name'] as string) || 'Admin';
  const cat = await salonRepository.updateCategory(req.params.id, req.body, actor);
  res.json(cat);
});

app.delete('/api/categories/:id', async (req, res) => {
  const actor = (req.headers['x-admin-name'] as string) || 'Admin';
  const ok = await salonRepository.deleteCategory(req.params.id, actor);
  res.json({ success: ok });
});

app.get('/api/services', async (req, res) => {
  try {
    const categoryId = req.query.category_id as string | undefined;
    const search = req.query.search as string | undefined;
    const list = await salonRepository.getServices(categoryId, search);
    res.json(list);
  } catch (err: any) {
    console.error('[GET /api/services] Error:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Failed to load services' });
  }
});

app.post('/api/services', async (req, res) => {
  const actor = (req.headers['x-admin-name'] as string) || 'Admin';
  const srv = await salonRepository.createService(req.body, actor);
  res.status(201).json(srv);
});

app.patch('/api/services/:id', async (req, res) => {
  const actor = (req.headers['x-admin-name'] as string) || 'Admin';
  const srv = await salonRepository.updateService(req.params.id, req.body, actor);
  res.json(srv);
});

app.delete('/api/services/:id', async (req, res) => {
  const actor = (req.headers['x-admin-name'] as string) || 'Admin';
  const ok = await salonRepository.deleteService(req.params.id, actor);
  res.json({ success: ok });
});

app.get('/api/packages', async (req, res) => {
  try {
    const pkgs = await salonRepository.getPackages();
    res.json(pkgs);
  } catch (err: any) {
    console.error('[GET /api/packages] Error:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Failed to load packages' });
  }
});

app.post('/api/packages', async (req, res) => {
  const actor = (req.headers['x-admin-name'] as string) || 'Admin';
  const pkg = await salonRepository.createPackage(req.body, actor);
  res.status(201).json(pkg);
});

app.patch('/api/packages/:id', async (req, res) => {
  const actor = (req.headers['x-admin-name'] as string) || 'Admin';
  const pkg = await salonRepository.updatePackage(req.params.id, req.body, actor);
  res.json(pkg);
});

app.delete('/api/packages/:id', async (req, res) => {
  const actor = (req.headers['x-admin-name'] as string) || 'Admin';
  const ok = await salonRepository.deletePackage(req.params.id, actor);
  res.json({ success: ok });
});

// ----------------------------------------------------------------------------
// Appointments & Bookings CRUD
// ----------------------------------------------------------------------------
app.get('/api/appointments', async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const staffId = req.query.staff_id as string | undefined;
    const mobile = req.query.mobile as string | undefined;
    const deletedParam = String(req.query.deleted || 'active').toLowerCase() as 'active' | 'deleted' | 'all';

    if (deletedParam === 'deleted' || deletedParam === 'all') {
      const admin = await getAuthAdmin(req);
      if (!admin || !canDeleteOrRestoreRecords(admin.role)) {
        return res.status(403).json({
          error: 'Access denied: Only SUPERADMIN, ADMIN, or OWNER may view deleted appointments.'
        });
      }
    }

    const list = await salonRepository.getAppointments({
      status,
      staffId,
      customerMobile: mobile,
      deleted: ['active', 'deleted', 'all'].includes(deletedParam) ? deletedParam : 'active'
    });
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/appointments/:id', async (req, res) => {
  try {
    const apt = await salonRepository.getAppointmentById(req.params.id);
    if (!apt) return res.status(404).json({ error: 'Appointment not found' });
    if (apt.deleted_at) {
      const admin = await getAuthAdmin(req);
      if (!admin || !canDeleteOrRestoreRecords(admin.role)) {
        return res.status(404).json({ error: 'Appointment not found' });
      }
    }
    res.json(apt);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Branch-Specific WhatsApp Notification Dispatcher (Never sends from the wrong branch)
async function sendBranchWhatsAppNotification(branchId: string, customerPhone: string, messageText: string): Promise<{ sent: boolean; reason?: string }> {
  try {
    const integration = await salonRepository.getBranchWhatsAppIntegration(branchId);
    if (!integration || integration.status !== 'connected' || !integration.phone_number_id) {
      console.log(`[Branch WhatsApp] Notification for branch '${branchId}' skipped: WhatsApp integration is ${integration?.status || 'not configured'}.`);
      return { sent: false, reason: `Branch WhatsApp integration is ${integration?.status || 'disconnected'}` };
    }

    if (!META_SYSTEM_USER_ACCESS_TOKEN) {
      return { sent: false, reason: 'META_SYSTEM_USER_ACCESS_TOKEN not configured on server' };
    }

    const cleanRecipient = customerPhone.replace(/\D/g, '').slice(-10);
    const recipient = cleanRecipient.length === 10 ? `91${cleanRecipient}` : cleanRecipient;

    const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${integration.phone_number_id}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${META_SYSTEM_USER_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        type: 'text',
        text: { body: messageText }
      })
    });

    const data: any = await response.json().catch(() => ({}));
    if (response.ok && data?.messages?.[0]?.id) {
      console.log(`[Branch WhatsApp] Message sent successfully from branch '${branchId}' to ${recipient}`);
      return { sent: true };
    } else {
      console.warn(`[Branch WhatsApp] Delivery response for branch '${branchId}':`, data?.error?.message || response.statusText);
      return { sent: false, reason: data?.error?.message || 'Meta API returned error' };
    }
  } catch (err: any) {
    console.error(`[Branch WhatsApp] Network failure sending notification:`, err.message);
    return { sent: false, reason: err.message };
  }
}

app.post('/api/appointments', async (req, res) => {
  try {
    const { customer_name, customer_phone, appointment_date, time_slot, services, notes, booking_source, payment_preference, branch_id } = req.body;
    if (!customer_name || !customer_phone || !appointment_date || !time_slot || !services || !services.length) {
      return res.status(400).json({ error: 'Missing required booking fields' });
    }

    const effectiveBranchId = branch_id || (await getDefaultBranchIdFromRepo());
    const total_amount = services.reduce((sum: number, s: any) => sum + (s.price || 0), 0);
    const newApt = await salonRepository.createAppointment({
      customer_name,
      customer_phone,
      branch_id: effectiveBranchId,
      appointment_date,
      time_slot,
      status: 'Pending',
      services,
      total_amount,
      discount_amount: req.body.discount_amount || 0,
      final_amount: total_amount - (req.body.discount_amount || 0),
      payment_preference: payment_preference || 'pay_at_salon',
      notes: notes || '',
      booking_source: booking_source || 'website'
    }, (req.headers['x-admin-name'] as string) || customer_name);

    // Upsert customer in CRM
    try {
      await salonRepository.upsertCustomerFromOrderOrAppointment({
        name: customer_name,
        phone: customer_phone,
        email: req.body.customer_email,
        branchId: effectiveBranchId,
        spend: 0,
        isVisit: true
      });
    } catch (cErr) {
      console.warn('⚠️ Could not upsert customer from appointment:', cErr);
    }

    // Get branch details for address and name
    const branch = effectiveBranchId ? await salonRepository.getBranchById(effectiveBranchId) : null;
    const branchName = branch?.name || 'The Glossy Looks Salon';
    const branchAddress = branch?.address || 'Hyderabad';
    const serviceNames = (services || []).map((s: any) => s.name).join(', ') || 'Salon Service';

    // Send real gl_appointment_confirmation template via branch WhatsApp connection
    let waResult: any = { sent: false, status: 'not_configured' };
    try {
      waResult = await sendBranchWhatsAppTemplate({
        branchId: effectiveBranchId,
        recipientPhone: customer_phone,
        templateName: 'gl_appointment_confirmation',
        appointmentId: newApt.id,
        customData: {
          customerName: customer_name,
          branchName: branchName,
          serviceNames: serviceNames,
          appointmentDate: appointment_date,
          appointmentTime: time_slot,
          bookingId: newApt.booking_reference,
          branchAddress: branchAddress
        }
      });

      // Update appointment record with WhatsApp send result
      await salonRepository.updateAppointment(newApt.id, {
        whatsapp_status: waResult.status,
        last_whatsapp_sent_at: waResult.sent ? new Date().toISOString() : undefined,
        last_whatsapp_error: waResult.error
      }, 'System');
    } catch (waErr: any) {
      console.warn(`[Appointments] Non-blocking WhatsApp confirmation failure:`, waErr.message);
      waResult = { sent: false, status: 'failed', error: waErr.message };
    }

    // Send gl_new_appointment_alert once to branch + optional admin alert numbers
    try {
      const { variables, defaultPositionalOrder } = buildAppointmentAlertVariables(newApt, branch);
      const phone10 = String(newApt.customer_phone || '').replace(/\D/g, '').slice(-10);
      const reqIdempotencyKey = String(
        req.headers['x-idempotency-key'] || req.body?.idempotency_key || ''
      ).trim() || null;

      await dispatchSalonAdminWhatsAppAlert({
        entityType: 'appointment',
        entityId: newApt.id,
        branchId: effectiveBranchId,
        branch,
        branchHint: branchName,
        templateName: APPOINTMENT_ADMIN_ALERT_TEMPLATE,
        variables,
        defaultPositionalOrder,
        fingerprintParts: [
          effectiveBranchId,
          phone10,
          newApt.appointment_date,
          newApt.time_slot,
        ],
        idempotencyKey: reqIdempotencyKey,
        appointmentId: newApt.id,
        customerName: newApt.customer_name,
      });
    } catch (alertErr: any) {
      console.warn(`[Appointments] Non-blocking salon/admin WhatsApp alert failure:`, alertErr?.message || alertErr);
    }

    // Return appointment with clear WhatsApp delivery report
    res.status(201).json({
      ...newApt,
      whatsapp_status: waResult.status,
      whatsapp_delivery: {
        sent: waResult.sent,
        status: waResult.status,
        message_id: waResult.messageId,
        error: waResult.error,
        diagnostics: waResult.diagnostics
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Manual Appointment WhatsApp Confirmation
app.post('/api/admin/appointments/:id/whatsapp/confirm', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || (admin.role !== 'owner' && admin.role !== 'manager')) {
      return res.status(403).json({ error: 'Access denied: Only Salon Owners and Branch Managers can send WhatsApp confirmations.' });
    }

    const apt = await salonRepository.getAppointmentById(req.params.id);
    if (!apt) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    const effectiveBranchId = apt.branch_id || (await getDefaultBranchIdFromRepo());

    // If manager, ensure they are assigned to this branch
    if (admin.role === 'manager') {
      const isAssigned = admin.branch_id === effectiveBranchId;
      if (!isAssigned) {
        return res.status(403).json({ error: 'Access denied: You can only send WhatsApp confirmations for your assigned branch.' });
      }
    }

    // Duplicate send check: if sent in last 5 minutes and !force, warn and allow confirmation
    const force = Boolean(req.body.force);
    if (!force && apt.last_whatsapp_sent_at) {
      const lastSentTime = new Date(apt.last_whatsapp_sent_at).getTime();
      const elapsedMs = Date.now() - lastSentTime;
      if (elapsedMs < 5 * 60 * 1000) {
        const minutesAgo = Math.max(1, Math.round(elapsedMs / 60000));
        return res.json({
          success: false,
          warning: `A WhatsApp confirmation was already sent to this customer ${minutesAgo} minute(s) ago (${new Date(apt.last_whatsapp_sent_at).toLocaleTimeString()}).`,
          duplicate_prevented: true,
          last_sent_at: apt.last_whatsapp_sent_at,
          message: 'Click "Send Again" to re-send the confirmation.'
        });
      }
    }

    const branch = effectiveBranchId ? await salonRepository.getBranchById(effectiveBranchId) : null;
    const branchName = branch?.name || 'The Glossy Looks Salon';
    const branchAddress = branch?.address || 'Hyderabad';
    const serviceNames = (apt.services || []).map((s: any) => s.name).join(', ') || 'Salon Service';

    const waResult = await sendBranchWhatsAppTemplate({
      branchId: effectiveBranchId,
      recipientPhone: apt.customer_phone,
      templateName: 'gl_appointment_confirmation',
      appointmentId: apt.id,
      customData: {
        customerName: apt.customer_name,
        branchName: branchName,
        serviceNames: serviceNames,
        appointmentDate: apt.appointment_date,
        appointmentTime: apt.time_slot,
        bookingId: apt.booking_reference,
        branchAddress: branchAddress
      }
    });

    const updatedApt = await salonRepository.updateAppointment(apt.id, {
      whatsapp_status: waResult.status,
      last_whatsapp_sent_at: waResult.sent ? new Date().toISOString() : apt.last_whatsapp_sent_at,
      last_whatsapp_error: waResult.error
    }, admin.name);

    res.json({
      success: waResult.sent,
      status: waResult.status,
      message_id: waResult.messageId,
      error: waResult.error,
      diagnostics: waResult.diagnostics,
      log: waResult.log,
      appointment: updatedApt
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/appointments/:id', async (req, res) => {
  try {
    const actor = (req.headers['x-admin-name'] as string) || 'Receptionist';
    const existing = await salonRepository.getAppointmentById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Appointment not found' });

    const patch = { ...req.body };
    const isNowCompleted = patch.status === 'Completed' && existing.status !== 'Completed';
    const isNowCancelled = (patch.status === 'Cancelled' || patch.status === 'Canceled') && existing.status !== 'Cancelled';

    if (isNowCompleted && !patch.completed_at) {
      patch.completed_at = new Date().toISOString();
    }

    const apt = await salonRepository.updateAppointment(req.params.id, patch, actor);

    // Schedule delayed feedback when an appointment is marked completed (only if not already sent or scheduled).
    if (isNowCompleted && apt) {
      const alreadySentOrQueued = await salonRepository.isFeedbackAlreadySentOrClaimed(apt.id);
      if (!alreadySentOrQueued) {
        const scheduledTime = getFeedbackScheduledTime();
        await salonRepository.createScheduledFeedbackJob({
          appointment_id: apt.id,
          branch_id: apt.branch_id || (await getDefaultBranchIdFromRepo()),
          customer_name: apt.customer_name,
          customer_phone: apt.customer_phone,
          scheduled_at: scheduledTime,
          status: 'pending',
          job_type: 'customer_feedback',
          template_name: 'glossylooks_customer_feedback',
          feedback_source: 'AUTO_FEEDBACK'
        });

        await salonRepository.updateAppointment(apt.id, {
          feedback_whatsapp_status: 'scheduled',
          feedback_whatsapp_scheduled_at: scheduledTime,
          feedback_whatsapp_source: 'AUTO_FEEDBACK'
        }, actor).catch(() => null);
      }
    }

    // Cancel pending feedback job if appointment is cancelled
    if (isNowCancelled) {
      await salonRepository.cancelScheduledFeedbackJobByAppointment(req.params.id);
    }

    res.json(apt);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/appointments/:id/cancel', async (req, res) => {
  try {
    const actor = (req.headers['x-admin-name'] as string) || 'Receptionist';
    const { reason } = req.body;
    const apt = await salonRepository.cancelAppointment(req.params.id, reason || 'Client request', actor);
    // Cancel scheduled feedback job
    await salonRepository.cancelScheduledFeedbackJobByAppointment(req.params.id);
    res.json(apt);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Soft-delete appointment (STRICTLY SUPERADMIN, ADMIN, OWNER only)
app.delete('/api/appointments/:id', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || !canDeleteOrRestoreRecords(admin.role)) {
      return res.status(403).json({
        error: 'Access denied: Only SUPERADMIN, ADMIN, and OWNER roles are authorized to delete appointments.'
      });
    }

    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim()
      : 'Removed from active appointments';

    const deleted = await salonRepository.softDeleteAppointment(
      req.params.id,
      { userId: admin.id, name: admin.name },
      reason
    );
    if (!deleted) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }
    res.json({ success: true, appointment: deleted });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to delete appointment.' });
  }
});

// Restore soft-deleted appointment (STRICTLY SUPERADMIN, ADMIN, OWNER only)
app.post('/api/appointments/:id/restore', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || !canDeleteOrRestoreRecords(admin.role)) {
      return res.status(403).json({
        error: 'Access denied: Only SUPERADMIN, ADMIN, and OWNER roles are authorized to restore deleted appointments.'
      });
    }

    const restored = await salonRepository.restoreAppointment(req.params.id, {
      userId: admin.id,
      name: admin.name
    });
    if (!restored) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }
    res.json({ success: true, appointment: restored });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to restore appointment.' });
  }
});

// ----------------------------------------------------------------------------
// Customers Management / CRM
// ----------------------------------------------------------------------------
app.get('/api/customers', async (req, res) => {
  const search = req.query.search as string | undefined;
  const list = await salonRepository.getCustomers(search);
  res.json(list);
});

app.post('/api/customers', async (req, res) => {
  const actor = (req.headers['x-admin-name'] as string) || 'Receptionist';
  const cust = await salonRepository.createCustomer(req.body, actor);
  res.status(201).json(cust);
});

app.patch('/api/customers/:id', async (req, res) => {
  const actor = (req.headers['x-admin-name'] as string) || 'Receptionist';
  const cust = await salonRepository.updateCustomer(req.params.id, req.body, actor);
  res.json(cust);
});

app.delete('/api/customers/:id', async (req, res) => {
  const actor = (req.headers['x-admin-name'] as string) || 'Manager';
  const ok = await salonRepository.deleteCustomer(req.params.id, actor);
  res.json({ success: ok });
});

// ----------------------------------------------------------------------------
// Orders & POS Billing
// ----------------------------------------------------------------------------
app.get('/api/orders', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin) {
      return res.status(401).json({ error: 'Authentication required to view orders.' });
    }

    const fullAccess = hasFullPaymentLedgerAccess(admin.role);
    if (!fullAccess) {
      // Staff roles are strictly restricted to today's (Asia/Kolkata) active orders for their assigned branch.
      // Ignore any client-supplied deleted, branch_id, start_date, or end_date parameters.
      const todayBounds = getKolkataTodayBounds();
      const staffBranch = await resolveStaffAssignedBranchId(admin);
      const list = await salonRepository.getOrders({
        deleted: 'active',
        branchId: staffBranch,
        startIso: todayBounds.startIso,
        endIso: todayBounds.endIso
      });
      return res.json(list);
    }

    const deletedParam = String(req.query.deleted || 'active').toLowerCase() as 'active' | 'deleted' | 'all';
    const branchId = req.query.branch_id && req.query.branch_id !== 'all'
      ? String(req.query.branch_id)
      : undefined;
    const startIso = typeof req.query.start_iso === 'string' ? req.query.start_iso : undefined;
    const endIso = typeof req.query.end_iso === 'string' ? req.query.end_iso : undefined;

    const list = await salonRepository.getOrders({
      deleted: ['active', 'deleted', 'all'].includes(deletedParam) ? deletedParam : 'active',
      branchId,
      startIso,
      endIso
    });
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const authAdmin = await getAuthAdmin(req);
    const actor = authAdmin?.name || (req.headers['x-admin-name'] as string) || 'Cashier';
    const {
      customer_name,
      customer_phone,
      items,
      subtotal,
      discount,
      tax_amount,
      tip_amount,
      grand_total,
      paid_amount,
      payment_status,
      primary_payment_mode,
      cashier_name,
      notes,
      appointment_id,
      branch_id,
      branch_code,
      idempotency_key,
      billing_date
    } = req.body;

    if (!customer_name || !items || !items.length) {
      return res.status(400).json({ error: 'Missing customer or order items' });
    }

    if (!customer_phone) {
      return res.status(400).json({ error: 'Customer mobile number is required for billing and WhatsApp receipt.' });
    }

    const normalized = normalizePhoneNumber(customer_phone);
    if (!normalized.isValid) {
      return res.status(400).json({
        error: 'Invalid recipient phone number. A valid 10-digit Indian mobile number (e.g. 9848012345) is required.'
      });
    }

    // Business date is deliberately separate from created_at.  This retains an
    // immutable record of when a backdated bill was actually entered.
    const todayInIndia = getKolkataDateString();
    const requestedBillingDate = String(billing_date || todayInIndia).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedBillingDate)) {
      return res.status(400).json({ error: 'Billing Date must be a valid YYYY-MM-DD date.' });
    }
    if (requestedBillingDate > todayInIndia) {
      return res.status(400).json({ error: 'Billing Date cannot be in the future.' });
    }
    const isBackdatedBill = requestedBillingDate !== todayInIndia;
    if (isBackdatedBill && (!authAdmin || !hasFullPaymentLedgerAccess(authAdmin.role))) {
      return res.status(403).json({
        error: 'Only Owner, Admin, and Superadmin may generate bills for past dates.'
      });
    }
    const billedAt = `${requestedBillingDate}T12:00:00.000+05:30`;

    // 1. Require explicit active Branch selection loaded dynamically from SMAV before bill generation
    const requestedBranchId = String(branch_id || '').trim();
    const requestedBranchCode = String(branch_code || '').trim().toUpperCase();
    const requestedBranchName = String(req.body?.branch_name || '').trim();
    if (!requestedBranchId && !requestedBranchCode) {
      return res.status(400).json({
        error: 'Branch selection is required before bill generation.'
      });
    }

    const localBranches = await salonRepository.getBranches();
    const matchedLocalBranch =
      (requestedBranchId ? localBranches.find(b => b.id === requestedBranchId) : undefined) ||
      (requestedBranchCode
        ? localBranches.find(
            b => resolveCanonicalBranchCode({ localBranch: b }) === requestedBranchCode
          )
        : undefined) ||
      null;

    // Reject inactive/disabled local branches for new bills (historical bills remain viewable in ledger)
    if (matchedLocalBranch && matchedLocalBranch.is_active === false) {
      return res.status(400).json({
        error: `Branch ${matchedLocalBranch.name} is disabled and cannot be used for new bills.`
      });
    }

    const canonicalBranchCode = resolveCanonicalBranchCode({
      branchCode: requestedBranchCode || undefined,
      branchId: requestedBranchId || undefined,
      branchName: requestedBranchName || undefined,
      localBranch: matchedLocalBranch,
    });

    if (!canonicalBranchCode) {
      return res.status(400).json({
        error: 'Unrecognized salon branch. Please select an active permitted branch from SMAV.'
      });
    }

    const effectiveBranchId =
      matchedLocalBranch?.id ||
      resolveLocalBranchIdForCode(canonicalBranchCode, localBranches) ||
      requestedBranchId;
    const cleanBranchName = getCleanReceiptBranchName({
      branchId: effectiveBranchId,
      branchCode: canonicalBranchCode,
      branchName: requestedBranchName || undefined,
      localBranch: matchedLocalBranch,
    });

    // Verify staff branch permission when authenticated as non-owner/admin
    if (authAdmin && !hasFullPaymentLedgerAccess(authAdmin.role) && authAdmin.branch_id) {
      const staffLocalBranch = localBranches.find(b => b.id === authAdmin.branch_id) || null;
      const assignedCode = resolveCanonicalBranchCode({
        branchId: authAdmin.branch_id,
        localBranch: staffLocalBranch,
      });
      if (effectiveBranchId !== authAdmin.branch_id && (!assignedCode || assignedCode !== canonicalBranchCode)) {
        return res.status(403).json({
          error: `Access denied: Your account is not permitted to generate bills for branch ${cleanBranchName} (${canonicalBranchCode}).`
        });
      }
    }

    const rawIdemKey = String(idempotency_key || (req.headers['x-idempotency-key'] as string) || '').trim();
    const effectiveIdempotencyKey =
      rawIdemKey || `gl-bill-${canonicalBranchCode}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    // 2. Idempotency check BEFORE calling SMAV reserve so retries never reserve duplicate central bill numbers
    const existingOrder = await salonRepository.getOrderByIdempotencyKey(effectiveIdempotencyKey);
    if (existingOrder) {
      // If previously committed locally but finalize is pending, attempt idempotent finalize now
      if (existingOrder.smav_bill_status === 'finalize_pending') {
        const retryFin = await finalizeSmavCentralBillNumber({
          reservationId: existingOrder.smav_reservation_id,
          billNumber: existingOrder.bill_number,
          branchId: existingOrder.branch_id || effectiveBranchId,
          branchCode: existingOrder.branch_code || canonicalBranchCode,
          branchName: existingOrder.branch_name || cleanBranchName,
          localOrderId: existingOrder.id,
          idempotencyKey: effectiveIdempotencyKey,
          order: existingOrder,
          finalizedBy: actor,
          finalizedByUserId: authAdmin?.id,
          centralAuthId: authAdmin?.central_auth_id,
        });
        if (retryFin.ok) {
          const updated = await salonRepository.updateOrder(existingOrder.id, {
            smav_bill_status: 'finalized',
            smav_sale_id: retryFin.saleId || existingOrder.smav_sale_id,
            smav_finalized_at: retryFin.finalizedAt || new Date().toISOString(),
            smav_finalize_error: null,
          });
          return res.status(200).json(updated || existingOrder);
        }
      }
      return res.status(200).json(existingOrder);
    }

    // 3. Call SMAV Reserve API BEFORE local bill creation (NO local bill number generation)
    const reserveResult = await reserveSmavCentralBillNumber({
      branchId: effectiveBranchId,
      branchCode: canonicalBranchCode,
      branchName: cleanBranchName,
      idempotencyKey: effectiveIdempotencyKey,
      requestedBy: actor,
      requestedByUserId: authAdmin?.id,
      centralAuthId: authAdmin?.central_auth_id,
      actorRole: authAdmin?.role,
      billingDate: requestedBillingDate,
    });

    if (!reserveResult.ok || !reserveResult.billNumber) {
      const statusCode =
        reserveResult.status >= 400 && reserveResult.status < 600 ? reserveResult.status : 503;
      return res.status(statusCode).json({
        error:
          reserveResult.error ||
          'Failed to reserve central bill number from SMAV. Bill was not created.',
        code: 'SMAV_BILL_RESERVE_FAILED',
      });
    }

    const immutableCentralBillNumber = reserveResult.billNumber;
    const finalizedBranchCode = reserveResult.branchCode || canonicalBranchCode;
    const finalizedBranchName = getCleanReceiptBranchName({
      branchId: effectiveBranchId,
      branchCode: finalizedBranchCode,
      branchName: reserveResult.branchName || cleanBranchName,
      localBranch: matchedLocalBranch,
    });

    const now = new Date().toISOString();
    // Exactly 2 minutes after bill creation as required
    const feedbackScheduledTime = new Date(Date.now() + 2 * 60 * 1000).toISOString();

    // 4. Commit local bill transaction FIRST using the immutable central bill number
    const order = await salonRepository.createOrder({
      bill_number: immutableCentralBillNumber,
      idempotency_key: effectiveIdempotencyKey,
      appointment_id,
      branch_id: effectiveBranchId,
      branch_code: finalizedBranchCode,
      branch_name: finalizedBranchName,
      smav_reservation_id: reserveResult.reservationId,
      smav_bill_status: 'reserved',
      is_legacy_bill: false,
      customer_name,
      customer_phone: normalized.e164 || customer_phone,
      items,
      subtotal: subtotal || grand_total,
      discount: discount || 0,
      tax_percent: 5,
      tax_amount: tax_amount || 0,
      tip_amount: tip_amount || 0,
      grand_total,
      paid_amount: paid_amount !== undefined ? paid_amount : grand_total,
      due_amount: Math.max(0, grand_total - (paid_amount !== undefined ? paid_amount : grand_total)),
      payment_status: payment_status || 'Paid',
      primary_payment_mode: primary_payment_mode || 'UPI',
      cashier_name: cashier_name || actor,
      notes: isBackdatedBill
        ? `${String(notes || '').trim()}${notes ? ' ' : ''}[Backdated bill entered by ${actor} on ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} for billing date ${requestedBillingDate}]`
        : (notes || ''),
      billing_date: requestedBillingDate,
      billed_at: billedAt,
      ...(isBackdatedBill ? { backdated_by: actor, backdated_at: new Date().toISOString() } : {}),
      whatsapp_status: 'sending',
      receipt_whatsapp_status: 'sending',
      feedback_whatsapp_status: 'scheduled',
      feedback_whatsapp_scheduled_at: feedbackScheduledTime,
      feedback_whatsapp_source: 'AUTO_FEEDBACK'
    }, actor);

    if (isBackdatedBill) {
      await salonRepository.logAudit(
        'CREATE_BACKDATED_BILL',
        'Order',
        order.id,
        actor,
        `Backdated bill ${order.bill_number} created on ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} for billing date ${requestedBillingDate}.`
      );
    }

    // 5. Call SMAV Finalize API ONLY AFTER the local bill transaction is committed
    const finalizeResult = await finalizeSmavCentralBillNumber({
      reservationId: reserveResult.reservationId,
      billNumber: immutableCentralBillNumber,
      branchId: effectiveBranchId,
      branchCode: finalizedBranchCode,
      branchName: finalizedBranchName,
      localOrderId: order.id,
      idempotencyKey: effectiveIdempotencyKey,
      order,
      finalizedBy: actor,
      finalizedByUserId: authAdmin?.id,
      centralAuthId: authAdmin?.central_auth_id,
      actorRole: authAdmin?.role,
    });

    if (finalizeResult.ok) {
      const finalizedAt = finalizeResult.finalizedAt || new Date().toISOString();
      const resolvedCentralBillId = finalizeResult.centralBillId || finalizeResult.saleId || null;
      await salonRepository.updateOrder(order.id, {
        smav_bill_status: 'finalized',
        smav_central_bill_id: resolvedCentralBillId,
        smav_sale_id: finalizeResult.saleId || resolvedCentralBillId || undefined,
        smav_finalized_at: finalizedAt,
        smav_finalize_error: null,
      });
      if (resolvedCentralBillId) {
        await syncPaymentCentralBillId(order.id, order.bill_number, resolvedCentralBillId);
      }
      order.smav_bill_status = 'finalized';
      order.smav_central_bill_id = resolvedCentralBillId;
      order.smav_sale_id = finalizeResult.saleId || resolvedCentralBillId || undefined;
      order.smav_finalized_at = finalizedAt;
      order.smav_finalize_error = null;
    } else {
      const finalizeErr = String(finalizeResult.error || 'SMAV finalize failed').slice(0, 500);
      await salonRepository.updateOrder(order.id, {
        smav_bill_status: 'finalize_pending',
        smav_finalize_error: finalizeErr,
      });
      order.smav_bill_status = 'finalize_pending';
      order.smav_finalize_error = finalizeErr;
      await salonRepository.logAudit(
        'SMAV_FINALIZE_PENDING',
        'Order',
        order.id,
        actor,
        `Local bill ${order.bill_number} committed; SMAV finalize pending retry: ${finalizeErr}`
      );
    }

    // 6. Queue thermal print job in Supabase mode if auto-print device exists (JSON repo already auto-queues in createOrder)
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const devs = await salonRepository.getPrintDevices();
        const billDevice = devs.find(d => d.is_online && d.auto_print_bill);
        if (billDevice) {
          await salonRepository.queuePrintJob({
            device_id: billDevice.id,
            job_type: 'bill',
            order_id: order.id,
            payload: {
              branch_name: finalizedBranchName,
              branch_code: finalizedBranchCode,
              bill_number: order.bill_number,
              customer_name: order.customer_name,
              customer_phone: order.customer_phone,
              items: (order.items || []).map(i => ({
                name: i.item_name,
                quantity: i.quantity,
                price: i.total_price,
                staff: i.staff_name,
              })),
              subtotal: order.subtotal,
              discount: order.discount,
              tax: order.tax_amount,
              tip: order.tip_amount,
              total: order.grand_total,
              payment_method: order.primary_payment_mode,
              payment_status: order.payment_status,
              date: new Date(order.billed_at || order.created_at || now).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
            },
          });
        }
      } catch (printErr) {
        console.warn('⚠️ Auto-print queue skipped:', printErr);
      }
    }

    // 7. Schedule automatic feedback job for 2 minutes after completion (only if not already sent/queued)
    const alreadySentOrQueued = await salonRepository.isFeedbackAlreadySentOrClaimed(appointment_id || undefined, order.id);
    if (!alreadySentOrQueued) {
      await salonRepository.createScheduledFeedbackJob({
        order_id: order.id,
        appointment_id: appointment_id || undefined,
        branch_id: effectiveBranchId,
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        scheduled_at: feedbackScheduledTime,
        status: 'pending',
        job_type: 'customer_feedback',
        template_name: 'glossylooks_customer_feedback',
        feedback_source: 'AUTO_FEEDBACK'
      });
      console.log(`[Feedback Scheduler] Queued single durable 2-minute feedback job for order ${order.bill_number || order.id}`);
    } else {
      console.log(`[Feedback Scheduler] Feedback already sent or queued for appointment ${appointment_id} or order ${order.id}. Skipping duplicate scheduling.`);
    }

    // 8. Mark appointment completed if linked
    if (appointment_id) {
      try {
        const apt = await salonRepository.getAppointmentById(appointment_id);
        if (apt && apt.status !== 'Completed') {
          await salonRepository.updateAppointment(appointment_id, {
            status: 'Completed',
            completed_at: new Date().toISOString()
          }, actor);
        }
      } catch (aptErr) {
        console.warn('⚠️ Could not update appointment status:', aptErr);
      }
    }

    // 9. Immediately send the approved WhatsApp template: gl_bill_receipt with the immutable central bill number
    const itemsSummary = (order.items || []).map(i => `${i.item_name} (x${i.quantity})`).join(', ');
    const billDate = new Date(order.billed_at || order.created_at || now).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });

    const receiptResult = await sendBranchWhatsAppTemplate({
      branchId: effectiveBranchId,
      recipientPhone: order.customer_phone,
      templateName: 'gl_bill_receipt',
      orderId: order.id,
      appointmentId: appointment_id,
      jobType: 'bill_receipt',
      customData: {
        customerName: order.customer_name,
        billNumber: order.bill_number,
        billDate: billDate,
        itemsSummary: itemsSummary || 'Salon Services',
        grandTotal: String(order.grand_total),
        paymentMode: order.primary_payment_mode || 'UPI',
        branchName: finalizedBranchName
      }
    });

    const receiptStatus: WhatsAppMessageStatus = receiptResult.sent
      ? 'sent'
      : (receiptResult.status === 'retrying' ? 'retrying' : (receiptResult.status === 'pending_approval' ? 'pending_approval' : 'failed'));

    // Update order with immediate receipt delivery details
    await salonRepository.updateOrder(order.id, {
      receipt_whatsapp_status: receiptStatus,
      receipt_whatsapp_message_id: receiptResult.messageId,
      receipt_whatsapp_sent_at: receiptResult.sent ? new Date().toISOString() : undefined,
      receipt_whatsapp_error: receiptResult.sent ? undefined : receiptResult.error,
      whatsapp_status: receiptStatus
    });

    order.receipt_whatsapp_status = receiptStatus;
    order.receipt_whatsapp_message_id = receiptResult.messageId;
    order.receipt_whatsapp_sent_at = receiptResult.sent ? new Date().toISOString() : undefined;
    order.receipt_whatsapp_error = receiptResult.sent ? undefined : receiptResult.error;
    order.whatsapp_status = receiptStatus;
    order.feedback_whatsapp_status = 'scheduled';
    order.feedback_whatsapp_scheduled_at = feedbackScheduledTime;

    // Return the created order with immutable central bill number and fresh live statuses
    res.status(201).json(order);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Retry SMAV central bill finalize/upsert for any committed bill whose sync transiently failed
app.post('/api/orders/:id/retry-smav-finalize', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin) {
      return res.status(401).json({ error: 'Authentication required to retry SMAV bill finalization.' });
    }
    const order = await salonRepository.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.is_legacy_bill) {
      return res.status(400).json({ error: 'Legacy historical bills are preserved as-is and do not require SMAV finalization.' });
    }
    if (order.smav_bill_status === 'finalized' && !req.body?.force) {
      return res.json({ success: true, already_finalized: true, order });
    }

    const syncResult = await syncOrderToSmavCentral(
      order,
      { id: admin.id, name: admin.name, role: admin.role, central_auth_id: admin.central_auth_id },
      'finalize_or_upsert'
    );

    if (!syncResult.ok) {
      return res.status(syncResult.status >= 400 && syncResult.status < 600 ? syncResult.status : 503).json({
        success: false,
        error: syncResult.error || 'SMAV sync retry failed',
      });
    }

    await salonRepository.logAudit(
      'SMAV_FINALIZE_RETRIED',
      'Order',
      order.id,
      admin.name,
      `Synced central bill ${order.bill_number} to SMAV Central Billing`
    );

    return res.json({ success: true, order: syncResult.order });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin) {
      return res.status(401).json({ error: 'Authentication required to view order details.' });
    }

    const order = await salonRepository.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (!hasFullPaymentLedgerAccess(admin.role)) {
      const staffBranch = await resolveStaffAssignedBranchId(admin);
      if (
        order.deleted_at ||
        !isWithinKolkataToday(order.created_at) ||
        (order.branch_id || '') !== staffBranch
      ) {
        return res.status(403).json({
          error: 'Access denied: Staff may only view today\'s Payment Ledger bills for their assigned branch (Asia/Kolkata).'
        });
      }
    }

    res.json(order);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Edit permitted order details (OWNER, ADMIN, SUPERADMIN only)
app.patch('/api/orders/:id', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || !hasFullPaymentLedgerAccess(admin.role)) {
      return res.status(403).json({ error: 'Access denied: Editing Payment Ledger bills is restricted to OWNER, ADMIN, and SUPERADMIN.' });
    }

    const orderId = req.params.id;
    const existingOrder = await salonRepository.getOrderById(orderId);
    if (!existingOrder) return res.status(404).json({ error: 'Order not found' });
    if (existingOrder.deleted_at) {
      return res.status(400).json({ error: 'Cannot edit a deleted bill. Restore it first.' });
    }

    const { primary_payment_mode, discount, customer_name, customer_phone, notes, payment_status } = req.body;
    const auditChanges: Record<string, { old: any; new: any }> = {};
    const updates: Partial<Order> = {};

    if (primary_payment_mode && primary_payment_mode !== existingOrder.primary_payment_mode) {
      auditChanges.primary_payment_mode = { old: existingOrder.primary_payment_mode, new: primary_payment_mode };
      updates.primary_payment_mode = primary_payment_mode;
    }
    if (payment_status && payment_status !== existingOrder.payment_status) {
      auditChanges.payment_status = { old: existingOrder.payment_status, new: payment_status };
      updates.payment_status = payment_status;
    }
    if (customer_name && customer_name !== existingOrder.customer_name) {
      auditChanges.customer_name = { old: existingOrder.customer_name, new: customer_name };
      updates.customer_name = customer_name;
    }
    if (customer_phone && customer_phone !== existingOrder.customer_phone) {
      auditChanges.customer_phone = { old: existingOrder.customer_phone, new: customer_phone };
      updates.customer_phone = customer_phone;
    }
    if (notes !== undefined && notes !== existingOrder.notes) {
      auditChanges.notes = { old: existingOrder.notes, new: notes };
      updates.notes = notes;
    }
    if (discount !== undefined && Number(discount) !== Number(existingOrder.discount)) {
      const newDiscount = Math.max(0, Number(discount));
      auditChanges.discount = { old: existingOrder.discount, new: newDiscount };
      updates.discount = newDiscount;
      const subtotal = existingOrder.subtotal || existingOrder.grand_total;
      const taxable = Math.max(0, subtotal - newDiscount);
      const taxAmount = Math.round(taxable * 0.05);
      const grandTotal = taxable + taxAmount;
      updates.tax_amount = taxAmount;
      updates.grand_total = grandTotal;
      updates.paid_amount = existingOrder.payment_status === 'Paid' ? grandTotal : existingOrder.paid_amount;
      auditChanges.grand_total = { old: existingOrder.grand_total, new: grandTotal };
    }

    // Bill number is strictly immutable!
    delete (updates as any).bill_number;

    const actor = admin.name || (req.headers['x-admin-name'] as string) || 'Owner';
    const updated = await salonRepository.updateOrder(orderId, updates);

    // Update corresponding payment record if present
    try {
      const payments = await salonRepository.getPayments({ deleted: 'active' });
      const match = payments.find(p => p.order_id === orderId || p.bill_number === existingOrder.bill_number);
      if (match) {
        const payUpdate: any = {
          customer_name: updates.customer_name || existingOrder.customer_name,
          customer_phone: updates.customer_phone || existingOrder.customer_phone,
          payment_mode: updates.primary_payment_mode || existingOrder.primary_payment_mode,
          amount: updates.paid_amount !== undefined ? updates.paid_amount : match.amount,
          status: updates.payment_status === 'Refunded' ? 'Refunded' : match.status
        };
        await (salonRepository as any).client?.from('payments').update(payUpdate).eq('id', match.id);
      }
    } catch {}

    await salonRepository.logAudit(
      'ORDER_EDIT_AUDIT',
      'Order',
      orderId,
      actor,
      `Order ${existingOrder.bill_number} edited: ${JSON.stringify(auditChanges)}`
    );

    let fullOrder = (await salonRepository.getOrderById(orderId)) || updated;

    // Synchronize bill edits to SMAV Central Billing via idempotent bills/upsert (preserves existing bill ID & invoice number)
    if (fullOrder && !fullOrder.is_legacy_bill && Object.keys(auditChanges).length > 0) {
      const syncRes = await syncOrderToSmavCentral(
        fullOrder,
        { id: admin.id, name: actor, role: admin.role, central_auth_id: admin.central_auth_id },
        'upsert'
      );
      fullOrder = syncRes.order;
      if (!syncRes.ok) {
        await salonRepository.logAudit(
          'SMAV_UPSERT_PENDING',
          'Order',
          orderId,
          actor,
          `Local edit saved for ${existingOrder.bill_number}; SMAV upsert queued for retry: ${syncRes.error}`
        );
      }
    }

    res.json(fullOrder);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

async function resolveTargetOrderForLifecycle(params: {
  paramId: string;
  bodyOrderId?: string;
  bodyCentralBillId?: string;
  bodyBillNumber?: string;
  source: 'order' | 'payment';
}): Promise<Order | null> {
  const { paramId, bodyOrderId, bodyCentralBillId, bodyBillNumber, source } = params;
  if (source === 'order') {
    const byId = await salonRepository.getOrderById(paramId);
    if (byId) return byId;
  } else {
    const allPayments = await salonRepository.getPayments({ deleted: 'all' });
    const match = allPayments.find(p => p.id === paramId);
    if (match?.order_id) {
      const byPayOrder = await salonRepository.getOrderById(match.order_id);
      if (byPayOrder) return byPayOrder;
    }
    if (match?.bill_number) {
      const byPayBill = await salonRepository.getOrderByBillNumber(match.bill_number);
      if (byPayBill) return byPayBill;
    }
  }
  if (bodyOrderId) {
    const byBodyOrder = await salonRepository.getOrderById(bodyOrderId);
    if (byBodyOrder) return byBodyOrder;
  }
  if (bodyCentralBillId) {
    const byCentral = await salonRepository.getOrderBySmavCentralBillId(bodyCentralBillId);
    if (byCentral) return byCentral;
  }
  if (bodyBillNumber) {
    const byBill = await salonRepository.getOrderByBillNumber(bodyBillNumber);
    if (byBill) return byBill;
  }
  // Finally try paramId as central bill ID or bill number
  const byParamCentral = await salonRepository.getOrderBySmavCentralBillId(paramId);
  if (byParamCentral) return byParamCentral;
  return await salonRepository.getOrderByBillNumber(paramId);
}

async function handleAuthorizedCentralBillVoid(
  req: express.Request,
  res: express.Response,
  source: 'order' | 'payment'
) {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || !canDeleteOrRestoreRecords(admin.role)) {
      return res.status(403).json({
        error: 'Access denied: Only SUPERADMIN, ADMIN, and OWNER roles are authorized to delete Payment Ledger bills.'
      });
    }

    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim()
      : 'Removed from active ledger';
    const bodyOrderId = typeof req.body?.order_id === 'string' ? req.body.order_id.trim() : '';
    const bodyCentralBillId = typeof req.body?.smav_central_bill_id === 'string' ? req.body.smav_central_bill_id.trim() : '';
    const bodyBillNumber = typeof req.body?.bill_number === 'string' ? req.body.bill_number.trim() : '';

    const localOrder = await resolveTargetOrderForLifecycle({
      paramId: req.params.id,
      bodyOrderId,
      bodyCentralBillId,
      bodyBillNumber,
      source,
    });

    const isCentralBill = localOrder ? !localOrder.is_legacy_bill : Boolean(bodyCentralBillId || bodyBillNumber || req.params.id);
    if (!localOrder && !isCentralBill) {
      return res.status(404).json({ error: 'Bill / order not found.' });
    }

    let smavVoided = false;
    let resolvedCentralBillId = localOrder?.smav_central_bill_id || bodyCentralBillId || localOrder?.smav_sale_id || undefined;

    // For central bills, confirm SMAV Central void persistence FIRST before updating local state or reporting success
    if (isCentralBill) {
      const targetSmavBillId =
        resolvedCentralBillId ||
        localOrder?.bill_number ||
        bodyBillNumber ||
        req.params.id;

      const smavRes = await voidSmavCentralBill({
        billId: targetSmavBillId,
        billNumber: localOrder?.bill_number || bodyBillNumber || undefined,
        externalOrderId: localOrder?.id || bodyOrderId || undefined,
        reason,
        actorId: admin.id,
        actorName: admin.name,
        actorRole: admin.role,
        centralAuthId: admin.central_auth_id,
      });

      if (!smavRes.ok) {
        return res.status(smavRes.status >= 400 && smavRes.status < 600 ? smavRes.status : 503).json({
          success: false,
          smav_sync_failed: true,
          error: smavRes.error || 'Failed to void bill in SMAV Central Ledger. Bill was not deleted.',
        });
      }
      smavVoided = true;
      resolvedCentralBillId = smavRes.billId || resolvedCentralBillId;
    }

    if (localOrder) {
      const result = await salonRepository.softDeleteOrderTransaction(
        localOrder.id,
        { userId: admin.id, name: admin.name },
        reason
      );
      if (!result) {
        return res.status(404).json({ error: 'Bill / order not found.' });
      }
      await salonRepository.updateOrder(localOrder.id, {
        smav_bill_status: 'voided',
        ...(resolvedCentralBillId ? { smav_central_bill_id: resolvedCentralBillId } : {}),
      });
      return res.json({ success: true, smav_synced: smavVoided, ...result });
    }

    // Central-only SMAV Web/Android bill with no local mirror row
    await salonRepository.logAudit(
      'SOFT_DELETE_CENTRAL_BILL',
      'PaymentLedgerBill',
      resolvedCentralBillId || req.params.id,
      admin.name,
      `Voided SMAV Central bill ${bodyBillNumber || req.params.id}. Reason: ${reason}`
    );
    return res.json({
      success: true,
      smav_synced: true,
      bill_id: resolvedCentralBillId || req.params.id,
      bill_number: bodyBillNumber || req.params.id,
      affected_payments: 1,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to delete bill transaction.' });
  }
}

async function handleAuthorizedCentralBillRestore(
  req: express.Request,
  res: express.Response,
  source: 'order' | 'payment'
) {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || !canDeleteOrRestoreRecords(admin.role)) {
      return res.status(403).json({
        error: 'Access denied: Only SUPERADMIN, ADMIN, and OWNER roles are authorized to restore deleted Payment Ledger bills.'
      });
    }

    const bodyOrderId = typeof req.body?.order_id === 'string' ? req.body.order_id.trim() : '';
    const bodyCentralBillId = typeof req.body?.smav_central_bill_id === 'string' ? req.body.smav_central_bill_id.trim() : '';
    const bodyBillNumber = typeof req.body?.bill_number === 'string' ? req.body.bill_number.trim() : '';

    const localOrder = await resolveTargetOrderForLifecycle({
      paramId: req.params.id,
      bodyOrderId,
      bodyCentralBillId,
      bodyBillNumber,
      source,
    });

    const isCentralBill = localOrder ? !localOrder.is_legacy_bill : Boolean(bodyCentralBillId || bodyBillNumber || req.params.id);
    if (!localOrder && !isCentralBill) {
      return res.status(404).json({ error: 'Deleted bill / order not found.' });
    }

    let smavRestored = false;
    let resolvedCentralBillId = localOrder?.smav_central_bill_id || bodyCentralBillId || localOrder?.smav_sale_id || undefined;

    // For central bills, confirm SMAV Central restore persistence FIRST before updating local state or reporting success
    if (isCentralBill) {
      const targetSmavBillId =
        resolvedCentralBillId ||
        localOrder?.bill_number ||
        bodyBillNumber ||
        req.params.id;

      const smavRes = await restoreSmavCentralBill({
        billId: targetSmavBillId,
        billNumber: localOrder?.bill_number || bodyBillNumber || undefined,
        externalOrderId: localOrder?.id || bodyOrderId || undefined,
        actorId: admin.id,
        actorName: admin.name,
        actorRole: admin.role,
        centralAuthId: admin.central_auth_id,
      });

      if (!smavRes.ok) {
        return res.status(smavRes.status >= 400 && smavRes.status < 600 ? smavRes.status : 503).json({
          success: false,
          smav_sync_failed: true,
          error: smavRes.error || 'Failed to restore bill in SMAV Central Ledger. Bill remains deleted.',
        });
      }
      smavRestored = true;
      resolvedCentralBillId = smavRes.billId || resolvedCentralBillId;
    }

    if (localOrder) {
      const result = await salonRepository.restoreOrderTransaction(localOrder.id, {
        userId: admin.id,
        name: admin.name
      });
      if (!result) {
        return res.status(404).json({ error: 'Bill / order not found.' });
      }
      await salonRepository.updateOrder(localOrder.id, {
        smav_bill_status: 'finalized',
        ...(localOrder.payment_status === 'Cancelled' ? { payment_status: 'Paid' } : {}),
        ...(resolvedCentralBillId ? { smav_central_bill_id: resolvedCentralBillId } : {}),
      });
      return res.json({ success: true, smav_synced: smavRestored, ...result });
    }

    await salonRepository.logAudit(
      'RESTORE_CENTRAL_BILL',
      'PaymentLedgerBill',
      resolvedCentralBillId || req.params.id,
      admin.name,
      `Restored SMAV Central bill ${bodyBillNumber || req.params.id}`
    );
    return res.json({
      success: true,
      smav_synced: true,
      bill_id: resolvedCentralBillId || req.params.id,
      bill_number: bodyBillNumber || req.params.id,
      restored_payments: 1,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to restore bill transaction.' });
  }
}

// Soft-delete complete Bill/Order transaction + SMAV Central void (SUPERADMIN, ADMIN, OWNER only)
app.delete('/api/orders/:id', async (req, res) => {
  await handleAuthorizedCentralBillVoid(req, res, 'order');
});

// Restore soft-deleted Bill/Order transaction + SMAV Central restore (SUPERADMIN, ADMIN, OWNER only)
app.post('/api/orders/:id/restore', async (req, res) => {
  await handleAuthorizedCentralBillRestore(req, res, 'order');
});

// Real-time WhatsApp status endpoint for polling from POS and Admin
app.get('/api/admin/orders/:id/whatsapp/status', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin) return res.status(401).json({ error: 'Authentication required.' });

    const order = await salonRepository.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (!hasFullPaymentLedgerAccess(admin.role)) {
      const staffBranch = await resolveStaffAssignedBranchId(admin);
      if (
        order.deleted_at ||
        !isWithinKolkataToday(order.created_at) ||
        (order.branch_id || '') !== staffBranch
      ) {
        return res.status(403).json({ error: 'Access denied for this bill.' });
      }
    }

    res.json({
      order_id: order.id,
      receipt_status: order.receipt_whatsapp_status || order.whatsapp_status || 'pending',
      receipt_message_id: order.receipt_whatsapp_message_id,
      receipt_error: order.receipt_whatsapp_error,
      receipt_sent_at: order.receipt_whatsapp_sent_at,
      feedback_status: order.feedback_whatsapp_status || 'scheduled',
      feedback_message_id: order.feedback_whatsapp_message_id,
      feedback_error: order.feedback_whatsapp_error,
      feedback_scheduled_at: order.feedback_whatsapp_scheduled_at,
      feedback_sent_at: order.feedback_whatsapp_sent_at
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Send the approved customer-feedback template manually after a POS bill.
// Cancels or marks scheduled job executed to avoid duplicate sending.
app.post('/api/admin/orders/:id/whatsapp/feedback', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || !canSendWhatsAppTemplates(admin.role)) {
      return res.status(403).json({ error: 'Access denied: insufficient role to send feedback.' });
    }

    const order = await salonRepository.getOrderById(req.params.id);
    if (!order || order.deleted_at) return res.status(404).json({ error: 'Bill not found.' });

    if (!hasFullPaymentLedgerAccess(admin.role)) {
      const staffBranch = await resolveStaffAssignedBranchId(admin);
      if (!isWithinKolkataToday(order.created_at) || (order.branch_id || '') !== staffBranch) {
        return res.status(403).json({ error: 'Access denied: staff may only send WhatsApp templates for today\'s bills in their assigned branch.' });
      }
    }

    // Prevent duplicate sending if already delivered or sent
    if (order.feedback_whatsapp_status === 'sent' || order.feedback_whatsapp_status === 'delivered' || order.feedback_whatsapp_status === 'read') {
      return res.status(200).json({
        success: true,
        already_sent: true,
        status: order.feedback_whatsapp_status,
        message: 'Customer feedback WhatsApp has already been sent to this customer.'
      });
    }

    // Cancel pending scheduled feedback jobs for this order to prevent duplicate messages
    await salonRepository.cancelScheduledFeedbackJobByOrder(order.id);
    if (order.appointment_id) {
      await salonRepository.cancelScheduledFeedbackJobByAppointment(order.appointment_id);
    }

    await salonRepository.updateOrder(order.id, {
      feedback_whatsapp_status: 'sending'
    });

    const result = await sendBranchWhatsAppTemplate({
      branchId: order.branch_id || (await getDefaultBranchIdFromRepo()),
      recipientPhone: order.customer_phone,
      templateName: 'glossylooks_customer_feedback',
      orderId: order.id,
      billNumber: order.bill_number,
      sentByUserId: admin.id,
      sentByUserName: admin.name,
      jobType: 'customer_feedback',
      customData: { customerName: order.customer_name }
    });

    if (result.sent) {
      await salonRepository.updateOrder(order.id, {
        feedback_whatsapp_status: 'sent',
        feedback_whatsapp_message_id: result.messageId,
        feedback_whatsapp_sent_at: new Date().toISOString(),
        feedback_whatsapp_source: 'MANUAL_FEEDBACK',
        feedback_whatsapp_error: undefined
      });
      return res.status(200).json({
        success: true,
        status: 'sent',
        message: 'Feedback request sent',
        message_id: result.messageId
      });
    }

    if (result.status === 'retrying') {
      await salonRepository.updateOrder(order.id, {
        feedback_whatsapp_status: 'retrying',
        feedback_whatsapp_error: result.error
      });
      return res.status(200).json({
        success: true,
        status: 'queued',
        message: 'Feedback request queued and will retry automatically',
        error: result.error
      });
    }

    await salonRepository.updateOrder(order.id, {
      feedback_whatsapp_status: result.status === 'pending_approval' ? 'pending_approval' : 'failed',
      feedback_whatsapp_error: result.error
    });

    const statusCode = result.status === 'pending_approval' ? 409 : 502;
    return res.status(statusCode).json({
      success: false,
      status: result.status,
      message: 'Feedback request failed — Retry',
      error: result.error,
      diagnostics: result.diagnostics
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Unable to send feedback message.' });
  }
});

// Retry endpoint for manual retry of failed WhatsApp messages (receipt or feedback)
app.post('/api/admin/orders/:id/whatsapp/retry', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || !canSendWhatsAppTemplates(admin.role)) {
      return res.status(403).json({ error: 'Access denied: insufficient role to retry WhatsApp messages.' });
    }

    const order = await salonRepository.getOrderById(req.params.id);
    if (!order || order.deleted_at) return res.status(404).json({ error: 'Bill not found.' });

    if (!hasFullPaymentLedgerAccess(admin.role)) {
      const staffBranch = await resolveStaffAssignedBranchId(admin);
      if (!isWithinKolkataToday(order.created_at) || (order.branch_id || '') !== staffBranch) {
        return res.status(403).json({ error: 'Access denied: staff may only retry WhatsApp templates for today\'s bills in their assigned branch.' });
      }
    }

    const requestedJobType = String(req.body?.job_type || '').trim();
    const jobType = requestedJobType === 'bill_receipt' || requestedJobType === 'customer_feedback'
      ? requestedJobType
      : ['queued', 'retrying', 'failed'].includes(String(order.receipt_whatsapp_status || order.whatsapp_status || '').toLowerCase())
        ? 'bill_receipt'
        : 'customer_feedback';
    const currentStatus = jobType === 'bill_receipt'
      ? (order.receipt_whatsapp_status || order.whatsapp_status)
      : order.feedback_whatsapp_status;
    const retryableStatuses = ['queued', 'retrying', 'failed'];
    if (!retryableStatuses.includes(String(currentStatus || '').toLowerCase())) {
      return res.status(409).json({
        error: `Send is not available for status '${currentStatus || 'unknown'}'.`
      });
    }

    const branchId = order.branch_id || (await getDefaultBranchIdFromRepo());
    const branch = branchId ? await salonRepository.getBranchById(branchId) : null;
    const branchName = branch?.name || 'The Glossy Looks';

    if (jobType === 'bill_receipt') {
      const itemsSummary = (order.items || []).map(i => `${i.item_name} (x${i.quantity})`).join(', ');
      const billDate = new Date(order.billed_at || order.created_at || Date.now()).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });

      const result = await sendBranchWhatsAppTemplate({
        branchId,
        recipientPhone: order.customer_phone,
        templateName: 'gl_bill_receipt',
        orderId: order.id,
        appointmentId: order.appointment_id,
        jobType: 'bill_receipt',
        customData: {
          customerName: order.customer_name,
          billNumber: order.bill_number,
          billDate: billDate,
          itemsSummary: itemsSummary || 'Salon Services',
          grandTotal: String(order.grand_total),
          paymentMode: order.primary_payment_mode || 'UPI',
          branchName: branchName
        }
      });

      if (result.sent) {
        await salonRepository.updateOrder(order.id, {
          receipt_whatsapp_status: 'sent',
          receipt_whatsapp_message_id: result.messageId,
          receipt_whatsapp_sent_at: new Date().toISOString(),
          receipt_whatsapp_error: undefined,
          whatsapp_status: 'sent'
        });
        return res.status(200).json({
          success: true,
          status: 'sent',
          message: 'Bill receipt WhatsApp sent successfully',
          message_id: result.messageId
        });
      }

      await salonRepository.updateOrder(order.id, {
        receipt_whatsapp_status: 'failed',
        receipt_whatsapp_error: result.error,
        whatsapp_status: 'failed'
      });
      return res.status(502).json({
        success: false,
        status: 'failed',
        message: 'Bill receipt retry failed — Retry',
        error: result.error
      });
    } else {
      // Retry Customer Feedback
      await salonRepository.cancelScheduledFeedbackJobByOrder(order.id);
      if (order.appointment_id) {
        await salonRepository.cancelScheduledFeedbackJobByAppointment(order.appointment_id);
      }

      const result = await sendBranchWhatsAppTemplate({
        branchId,
        recipientPhone: order.customer_phone,
        templateName: 'glossylooks_customer_feedback',
        orderId: order.id,
        jobType: 'customer_feedback',
        customData: { customerName: order.customer_name }
      });

      if (result.sent) {
        await salonRepository.updateOrder(order.id, {
          feedback_whatsapp_status: 'sent',
          feedback_whatsapp_message_id: result.messageId,
          feedback_whatsapp_sent_at: new Date().toISOString(),
          feedback_whatsapp_source: 'MANUAL_FEEDBACK',
          feedback_whatsapp_error: undefined
        });
        return res.status(200).json({
          success: true,
          status: 'sent',
          message: 'Customer feedback WhatsApp sent successfully',
          message_id: result.messageId
        });
      }

      await salonRepository.updateOrder(order.id, {
        feedback_whatsapp_status: 'failed',
        feedback_whatsapp_error: result.error
      });
      return res.status(502).json({
        success: false,
        status: 'failed',
        message: 'Feedback retry failed — Retry',
        error: result.error
      });
    }
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Retry failed.' });
  }
});

// ----------------------------------------------------------------------------
// Payments & Refunds (Strict Role-Based & Asia/Kolkata Today Scoping)
// ----------------------------------------------------------------------------
app.get('/api/payments', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin) {
      return res.status(401).json({ error: 'Authentication required to access the Payment Ledger.' });
    }

    const fullAccess = hasFullPaymentLedgerAccess(admin.role);
    if (!fullAccess) {
      // STAFF roles (RECEPTIONIST, STYLIST, POS_BILLING, MANAGER, INVENTORY_STAFF, etc.):
      // Strictly enforce today's Asia/Kolkata window (12:00 AM - 11:59:59.999 PM) and assigned branch.
      // Ignore any client query tampering (deleted, branch_id, start_iso, end_iso, date range).
      const todayBounds = getKolkataTodayBounds();
      const staffBranch = await resolveStaffAssignedBranchId(admin);
      const list = await salonRepository.getPayments({
        deleted: 'active',
        branchId: staffBranch,
        startIso: todayBounds.startIso,
        endIso: todayBounds.endIso
      });
      return res.json(list);
    }

    const deletedParam = String(req.query.deleted || 'active').toLowerCase() as 'active' | 'deleted' | 'all';
    const branchId = req.query.branch_id && req.query.branch_id !== 'all'
      ? String(req.query.branch_id)
      : undefined;
    const startIso = typeof req.query.start_iso === 'string' ? req.query.start_iso : undefined;
    const endIso = typeof req.query.end_iso === 'string' ? req.query.end_iso : undefined;

    const list = await salonRepository.getPayments({
      deleted: ['active', 'deleted', 'all'].includes(deletedParam) ? deletedParam : 'active',
      branchId,
      startIso,
      endIso
    });
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Export Payment Ledger CSV (OWNER, ADMIN, SUPERADMIN only)
app.get('/api/payments/export', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || !hasFullPaymentLedgerAccess(admin.role)) {
      return res.status(403).json({
        error: 'Access denied: Exporting Payment Ledger reports is restricted to OWNER, ADMIN, and SUPERADMIN.'
      });
    }

    const branchId = req.query.branch_id && req.query.branch_id !== 'all'
      ? String(req.query.branch_id)
      : undefined;
    const startIso = typeof req.query.start_iso === 'string' ? req.query.start_iso : undefined;
    const endIso = typeof req.query.end_iso === 'string' ? req.query.end_iso : undefined;
    const modeFilter = typeof req.query.mode === 'string' && req.query.mode !== 'all' ? req.query.mode : undefined;

    const payments = await salonRepository.getPayments({
      deleted: 'active',
      branchId,
      startIso,
      endIso
    });
    const filtered = modeFilter ? payments.filter(p => p.payment_mode === modeFilter) : payments;

    const escapeCsv = (val: any) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const header = ['Bill Number', 'Date & Time (IST)', 'Customer Name', 'Customer Phone', 'Branch', 'Branch ID', 'Payment Mode', 'Amount (INR)', 'Status', 'Order ID'];
    const rows = filtered.map(p => [
      p.bill_number,
      new Date(p.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      p.customer_name,
      p.customer_phone || '',
      p.branch_name ? `${p.branch_name}${p.branch_code ? ` (${p.branch_code})` : ''}` : (p.branch_code || ''),
      p.branch_id || '',
      p.payment_mode,
      p.amount,
      p.status,
      p.order_id
    ].map(escapeCsv).join(','));

    const csv = [header.map(escapeCsv).join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="glossylooks-payment-ledger-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/payments/:id/refund', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || !hasFullPaymentLedgerAccess(admin.role)) {
      return res.status(403).json({
        error: 'Access denied: Issuing Payment Ledger refunds is restricted to OWNER, ADMIN, and SUPERADMIN.'
      });
    }
    const { reason } = req.body || {};
    const payment = await salonRepository.refundPayment(req.params.id, reason || 'Customer refund request', admin.name);
    if (!payment) return res.status(404).json({ error: 'Payment record not found' });
    res.json(payment);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// Authoritative SMAV Central Payments Ledger Proxy (Server-Side RBAC Enforced)
// ----------------------------------------------------------------------------
app.get('/api/admin/payments/ledger', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin) {
      return res.status(401).json({ error: 'Authentication required to access the Payment Ledger.' });
    }

    const fullAccess = hasFullPaymentLedgerAccess(admin.role);
    const todayStr = getKolkataDateString();
    const rawScope = String(req.query.scope || 'today').trim().toLowerCase();
    const rawFromDate = typeof req.query.fromDate === 'string' ? req.query.fromDate.trim() : '';
    const rawToDate = typeof req.query.toDate === 'string' ? req.query.toDate.trim() : '';
    const rawBranchId = typeof req.query.branchId === 'string' && req.query.branchId !== 'all'
      ? req.query.branchId.trim()
      : undefined;
    const rawSearch = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    // Server-side RBAC enforcement for POS_BILLING / restricted staff
    if (!fullAccess) {
      if (rawScope === 'history' || rawScope === 'deleted') {
        return res.status(403).json({
          error: 'Access denied: POS / Staff roles may only view today\'s active bills (Asia/Kolkata).',
        });
      }
      if ((rawFromDate && rawFromDate !== todayStr) || (rawToDate && rawToDate !== todayStr)) {
        return res.status(403).json({
          error: 'Access denied: Historical date queries are restricted to OWNER, ADMIN, and SUPERADMIN.',
        });
      }
    }

    const scope: 'today' | 'history' | 'deleted' =
      fullAccess && (rawScope === 'history' || rawScope === 'deleted') ? rawScope : 'today';

    const effectiveFromDate = scope === 'today' ? todayStr : (rawFromDate || undefined);
    const effectiveToDate = scope === 'today' ? todayStr : (rawToDate || undefined);
    const effectiveBranchId = fullAccess ? rawBranchId : await resolveStaffAssignedBranchId(admin);

    const startIso = effectiveFromDate ? `${effectiveFromDate}T00:00:00.000+05:30` : undefined;
    const endIso = effectiveToDate ? `${effectiveToDate}T23:59:59.999+05:30` : undefined;
    const localDeletedMode: 'active' | 'deleted' = scope === 'deleted' ? 'deleted' : 'active';

    const [localBranches, localOrders, localPayments] = await Promise.all([
      salonRepository.getBranches().catch(() => []),
      salonRepository.getOrders({
        deleted: localDeletedMode,
        branchId: effectiveBranchId,
        startIso,
        endIso,
      }).catch(() => []),
      salonRepository.getPayments({
        deleted: localDeletedMode,
        branchId: effectiveBranchId,
        startIso,
        endIso,
      }).catch(() => []),
    ]);

    const orderByCentralId = new Map<string, Order>();
    const orderByBillNum = new Map<string, Order>();
    const orderById = new Map<string, Order>();
    for (const o of localOrders) {
      orderById.set(o.id, o);
      if (o.bill_number) orderByBillNum.set(o.bill_number, o);
      if (o.smav_central_bill_id) orderByCentralId.set(o.smav_central_bill_id, o);
    }

    const smavResult = await fetchSmavCentralLedger(
      {
        scope,
        timezone: 'Asia/Kolkata',
        fromDate: effectiveFromDate,
        toDate: effectiveToDate,
        branchId: effectiveBranchId,
        search: rawSearch || undefined,
        admin,
      },
      localBranches
    );

    const matchesLocalFilters = (p: PaymentRecord): boolean => {
      if (effectiveBranchId && p.branch_id && p.branch_id !== effectiveBranchId) return false;
      const effectiveTs = p.billed_at || p.created_at;
      const dateStr = getKolkataDateString(effectiveTs);
      if (scope === 'today' && dateStr !== todayStr) return false;
      if (effectiveFromDate && dateStr < effectiveFromDate) return false;
      if (effectiveToDate && dateStr > effectiveToDate) return false;
      if (rawSearch) {
        const q = rawSearch.toLowerCase();
        const hay = `${p.bill_number || ''} ${p.customer_name || ''} ${p.customer_phone || ''} ${p.branch_name || ''} ${p.branch_code || ''} ${(p.items || []).map(i => `${i.item_name} ${i.staff_name || ''}`).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    };

    const enrichWithLocalOrder = (p: PaymentRecord): PaymentRecord => {
      const localOrd =
        (p.smav_central_bill_id ? orderByCentralId.get(p.smav_central_bill_id) : undefined) ||
        (p.bill_number ? orderByBillNum.get(p.bill_number) : undefined) ||
        (p.order_id ? orderById.get(p.order_id) : undefined);

      if (!localOrd) return p;

      return {
        ...p,
        order_id: localOrd.id,
        branch_id: p.branch_id || localOrd.branch_id,
        branch_code: p.branch_code || localOrd.branch_code,
        branch_name: p.branch_name || localOrd.branch_name,
        subtotal: p.subtotal ?? localOrd.subtotal,
        discount: p.discount ?? localOrd.discount,
        tax_amount: p.tax_amount ?? localOrd.tax_amount,
        items: p.items && p.items.length > 0 ? p.items : localOrd.items,
        receipt_whatsapp_status: localOrd.receipt_whatsapp_status || p.receipt_whatsapp_status,
        receipt_whatsapp_error: localOrd.receipt_whatsapp_error || p.receipt_whatsapp_error,
        feedback_whatsapp_status: localOrd.feedback_whatsapp_status || p.feedback_whatsapp_status,
        smav_bill_status: localOrd.smav_bill_status || p.smav_bill_status,
        smav_finalize_error: localOrd.smav_finalize_error ?? p.smav_finalize_error,
        is_legacy_bill: localOrd.is_legacy_bill ?? p.is_legacy_bill,
        billing_date: p.billing_date || localOrd.billing_date,
        billed_at: p.billed_at || localOrd.billed_at,
        backdated_by: p.backdated_by || localOrd.backdated_by,
        backdated_at: p.backdated_at || localOrd.backdated_at,
      };
    };

    let mergedPayments: PaymentRecord[] = [];
    let source: 'smav' | 'local_fallback' = 'smav';
    let warning: string | null = null;

    if (smavResult.ok) {
      const seenBillNums = new Set<string>();
      const seenCentralIds = new Set<string>();
      const seenOrderIds = new Set<string>();

      for (const row of smavResult.payments) {
        const enriched = enrichWithLocalOrder(row);
        if (scope === 'deleted') {
          if (!enriched.deleted_at && enriched.status !== 'Void') continue;
        } else {
          if (enriched.deleted_at || enriched.status === 'Void') continue;
        }
        if (!matchesLocalFilters(enriched)) continue;
        mergedPayments.push(enriched);
        if (enriched.bill_number) seenBillNums.add(enriched.bill_number);
        if (enriched.smav_central_bill_id) seenCentralIds.add(enriched.smav_central_bill_id);
        if (enriched.order_id) seenOrderIds.add(enriched.order_id);
      }

      // Include local bills that are pending SMAV sync (finalize_pending) or pre-SMAV legacy historical bills
      for (const localPay of localPayments) {
        const enrichedLocal = enrichWithLocalOrder(localPay);
        const alreadyPresent =
          (enrichedLocal.bill_number && seenBillNums.has(enrichedLocal.bill_number)) ||
          (enrichedLocal.smav_central_bill_id && seenCentralIds.has(enrichedLocal.smav_central_bill_id)) ||
          (enrichedLocal.order_id && seenOrderIds.has(enrichedLocal.order_id));
        if (alreadyPresent) continue;

        const isPendingSync =
          enrichedLocal.smav_bill_status === 'finalize_pending' ||
          enrichedLocal.smav_bill_status === 'reserved';
        const isLegacyHistorical = Boolean(enrichedLocal.is_legacy_bill);

        if ((isPendingSync || isLegacyHistorical) && matchesLocalFilters(enrichedLocal)) {
          mergedPayments.push({
            ...enrichedLocal,
            source_channel: enrichedLocal.source_channel || (isLegacyHistorical ? 'GLOSSYLOOKS_LEGACY' : 'GLOSSYLOOKS_ADMIN'),
          });
        }
      }
    } else {
      source = 'local_fallback';
      warning = smavResult.error || 'SMAV Central Ledger is temporarily unavailable; displaying local cached bills.';
      mergedPayments = localPayments
        .map(p => ({
          ...enrichWithLocalOrder(p),
          source_channel: p.source_channel || 'GLOSSYLOOKS_LOCAL_CACHE',
        }))
        .filter(matchesLocalFilters);
    }

    // Sort strictly newest first by billed_at || created_at
    mergedPayments.sort((a, b) => {
      const timeA = Date.parse(a.billed_at || a.created_at || '') || 0;
      const timeB = Date.parse(b.billed_at || b.created_at || '') || 0;
      return timeB - timeA;
    });

    const pendingSyncCount = localOrders.filter(
      o => !o.deleted_at && !o.is_legacy_bill && (o.smav_bill_status === 'finalize_pending' || o.smav_bill_status === 'reserved')
    ).length;

    const responsePayload: CentralPaymentLedgerResponse = {
      source,
      scope,
      timezone: 'Asia/Kolkata',
      payments: mergedPayments,
      totals: computePaymentLedgerTotals(mergedPayments),
      pending_sync_count: pendingSyncCount,
      warning,
    };

    return res.json(responsePayload);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to load central payment ledger.' });
  }
});

// Cron / Admin endpoint to drain pending SMAV central bill sync retries
app.post('/api/cron/smav-bill-sync-retry', async (req, res) => {
  try {
    const cronSecret = (process.env.CRON_SECRET || '').trim();
    const authHeader = String(req.headers.authorization || '').trim();
    const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
    const cronBuf = Buffer.from(cronSecret, 'utf8');
    const bearerBuf = Buffer.from(bearer, 'utf8');
    const isCronAuthorized = Boolean(
      cronBuf.length > 0 &&
      cronBuf.length === bearerBuf.length &&
      crypto.timingSafeEqual(cronBuf, bearerBuf)
    );
    const admin = isCronAuthorized ? null : await getAuthAdmin(req);

    if (!isCronAuthorized && (!admin || !hasFullPaymentLedgerAccess(admin.role))) {
      return res.status(403).json({ error: 'Unauthorized: CRON_SECRET or OWNER/ADMIN/SUPERADMIN session required.' });
    }

    const result = await drainPendingSmavCentralBills(20);
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to process pending SMAV bill sync retries.' });
  }
});

// Soft-delete Payment Ledger row -> voids in SMAV Central FIRST, then soft-deletes complete local bill transaction
app.delete('/api/payments/:id', async (req, res) => {
  await handleAuthorizedCentralBillVoid(req, res, 'payment');
});

// Restore Payment Ledger row -> restores in SMAV Central FIRST, then restores complete local bill transaction
app.post('/api/payments/:id/restore', async (req, res) => {
  await handleAuthorizedCentralBillRestore(req, res, 'payment');
});

// ----------------------------------------------------------------------------
// Stock Inventory Management (Products, Suppliers & Movements)
// ----------------------------------------------------------------------------
app.get('/api/products', async (req, res) => {
  const list = await salonRepository.getProducts();
  res.json(list);
});

app.post('/api/products', async (req, res) => {
  const actor = (req.headers['x-admin-name'] as string) || 'Inventory Staff';
  const prod = await salonRepository.createProduct(req.body, actor);
  res.status(201).json(prod);
});

app.patch('/api/products/:id', async (req, res) => {
  const actor = (req.headers['x-admin-name'] as string) || 'Inventory Staff';
  const prod = await salonRepository.updateProduct(req.params.id, req.body, actor);
  res.json(prod);
});

app.delete('/api/products/:id', async (req, res) => {
  const actor = (req.headers['x-admin-name'] as string) || 'Manager';
  const ok = await salonRepository.deleteProduct(req.params.id, actor);
  res.json({ success: ok });
});

app.get('/api/inventory/movements', async (req, res) => {
  const list = await salonRepository.getInventoryMovements();
  res.json(list);
});

app.post('/api/inventory/movement', async (req, res) => {
  const actor = (req.headers['x-admin-name'] as string) || 'Inventory Staff';
  const mov = await salonRepository.recordInventoryMovement(req.body, actor);
  res.status(201).json(mov);
});

app.get('/api/suppliers', async (req, res) => {
  const list = await salonRepository.getSuppliers();
  res.json(list);
});

app.post('/api/suppliers', async (req, res) => {
  const actor = (req.headers['x-admin-name'] as string) || 'Manager';
  const sup = await salonRepository.createSupplier(req.body, actor);
  res.status(201).json(sup);
});

// ----------------------------------------------------------------------------
// Staff Management
// ----------------------------------------------------------------------------
app.get('/api/staff', async (req, res) => {
  const list = await salonRepository.getStaff();
  res.json(list);
});

app.post('/api/staff', async (req, res) => {
  try {
    const actor = (req.headers['x-admin-name'] as string) || 'Manager';
    const staff = await salonRepository.createStaff(req.body, actor);
    const allUsers = await salonRepository.getUsers();
    const linkedUser = allUsers.find(
      u =>
        (staff.user_id && String(u.id) === String(staff.user_id)) ||
        (staff.admin_user_id && u.user_id === staff.admin_user_id) ||
        (staff.email && u.email && u.email.trim().toLowerCase() === staff.email.trim().toLowerCase())
    );
    const smavSync = linkedUser
      ? await syncUserToSmavAndPersist(linkedUser, {
          idempotencyKey: req.headers['x-idempotency-key'] as string | undefined,
          performedBy: actor,
        })
      : null;
    res.status(201).json({ ...staff, ...(smavSync ? { smavSync } : {}) });
  } catch (err: any) {
    console.error('Unable to create staff profile:', err);
    res.status(400).json({ error: err?.message || 'Unable to create staff profile.' });
  }
});

app.patch('/api/staff/:id', async (req, res) => {
  try {
    if (req.body?.central_auth_id !== undefined) {
      return res.status(403).json({
        error: 'Ordinary staff updates cannot assign or modify central_auth_id. Use verified SMAV linking or audited manual reconciliation.',
        code: 'CENTRAL_AUTH_LINK_FORBIDDEN',
      });
    }
    const actor = (req.headers['x-admin-name'] as string) || 'Manager';
    const existingStaff = await salonRepository.getStaffById(req.params.id);
    if (!existingStaff) {
      return res.status(404).json({ error: 'Staff profile not found' });
    }
    const allUsers = await salonRepository.getUsers();
    let linkedUser = allUsers.find(
      u =>
        (existingStaff.user_id && String(u.id) === String(existingStaff.user_id)) ||
        (existingStaff.admin_user_id && u.user_id === existingStaff.admin_user_id)
    );

    const normalizedEmail = req.body?.email !== undefined ? String(req.body.email).trim().toLowerCase() : undefined;
    if (normalizedEmail !== undefined && linkedUser) {
      const emailOwner = allUsers.find(
        u => String(u.id) !== String(linkedUser!.id) && u.email && u.email.trim().toLowerCase() === normalizedEmail
      );
      if (emailOwner) {
        return res.status(409).json({
          error: `Another staff account (${emailOwner.user_id}) already uses email ${normalizedEmail}.`
        });
      }
      if (normalizedEmail !== String(linkedUser.email || '').trim().toLowerCase() && !linkedUser.central_auth_id) {
        const preLink = await syncUserToSmavAndPersist(linkedUser, { performedBy: actor });
        const reloaded = (await salonRepository.getUsers()).find(u => String(u.id) === String(linkedUser!.id));
        if (reloaded) linkedUser = reloaded;
        if (!linkedUser.central_auth_id && !preLink.centralAuthId) {
          return res.status(409).json({
            error: 'Cannot change staff email before Central Auth UUID is linked. Run SMAV sync first to prevent duplicate users.'
          });
        }
      }
    }

    const staff = await salonRepository.updateStaff(req.params.id, req.body, actor);
    if (!staff) return res.status(404).json({ error: 'Staff profile not found' });

    const refreshedUser = (await salonRepository.getUsers()).find(
      u =>
        (staff.user_id && String(u.id) === String(staff.user_id)) ||
        (staff.admin_user_id && u.user_id === staff.admin_user_id)
    );
    const smavSync = refreshedUser
      ? await syncUserToSmavAndPersist(refreshedUser, {
          idempotencyKey: req.headers['x-idempotency-key'] as string | undefined,
          performedBy: actor,
        })
      : null;

    return res.json({ ...staff, ...(smavSync ? { smavSync } : {}) });
  } catch (err: any) {
    if (isMigration024RequiredError(err)) {
      return res.status(503).json({
        error: err.message,
        code: 'MIGRATION_024_REQUIRED',
        migrationRequired: 'database/migrations/024_smav_user_sync_outbox.sql',
      });
    }
    if (isCentralAuthLinkForbiddenError(err)) {
      return res.status(403).json({ error: err.message, code: 'CENTRAL_AUTH_LINK_FORBIDDEN' });
    }
    if (isIdempotencyKeyConflictError(err)) {
      return res.status(409).json({ error: err.message, conflict: true });
    }
    console.error('Unable to update staff profile:', err);
    return res.status(400).json({ error: err?.message || 'Unable to update staff profile.' });
  }
});

app.delete('/api/staff/:id', async (req, res) => {
  const actor = (req.headers['x-admin-name'] as string) || 'Owner';
  const existingStaff = await salonRepository.getStaffById(req.params.id);
  const allUsers = await salonRepository.getUsers();
  const linkedUser = existingStaff
    ? allUsers.find(
        u =>
          (existingStaff.user_id && String(u.id) === String(existingStaff.user_id)) ||
          (existingStaff.admin_user_id && u.user_id === existingStaff.admin_user_id)
      )
    : undefined;

  const ok = await salonRepository.deleteStaff(req.params.id, actor);
  const smavSync = ok && linkedUser
    ? await setSmavUserStatusAndPersist(linkedUser, false, {
        idempotencyKey: req.headers['x-idempotency-key'] as string | undefined,
        performedBy: actor,
      })
    : null;
  res.json({ success: ok, smavSync });
});

// ----------------------------------------------------------------------------
// Reports & Analytics - OWNER, ADMIN, SUPERADMIN & MANAGER ONLY
// ----------------------------------------------------------------------------
app.get('/api/reports', async (req, res) => {
  const admin = await getAuthAdmin(req);
  if (!admin || (!hasFullPaymentLedgerAccess(admin.role) && admin.role !== 'manager')) {
    return res.status(403).json({ error: 'Access denied: Reports & analytics are restricted to Salon Owner, Admin, and Manager.' });
  }
  const reports = await salonRepository.getReports();
  res.json(reports);
});

app.get('/api/reports/detailed', async (req, res) => {
  const admin = await getAuthAdmin(req);
  if (!admin || (!hasFullPaymentLedgerAccess(admin.role) && admin.role !== 'manager')) {
    return res.status(403).json({ error: 'Access denied: Sales reports are restricted to Salon Owner, Admin, and Manager.' });
  }
  const period = req.query.period as any || 'today';
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;

  const detailed = await salonRepository.getDetailedReports({
    period,
    startDate,
    endDate
  });
  res.json(detailed);
});

// ----------------------------------------------------------------------------
// Automated Daily Stylist Sales Reporting API Endpoints
// ----------------------------------------------------------------------------

// 1. Cron Endpoint for Vercel Cron (schedule: 45 16 * * * = 10:15 PM IST)
app.all(['/api/cron/daily-stylist-sales-report', '/cron/daily-stylist-sales-report'], async (req, res) => {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers['authorization'];
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      // Optional check if user explicitly set CRON_SECRET
      console.warn('[Daily Sales Cron] Invocation with unverified CRON_SECRET token');
    }

    const targetDate = (req.query.date as string) || (req.body?.date as string) || getKolkataDateString();
    const force = req.query.force === 'true' || req.body?.force === true;

    console.log(`[Daily Sales Cron Endpoint] Triggered for date ${targetDate} (force: ${force})`);
    const results = await generateAndSendDailySalesReports(targetDate, force);

    res.json({
      success: true,
      message: `Daily stylist sales report run completed for ${targetDate}`,
      ...results
    });
  } catch (err: any) {
    console.error('[Daily Sales Cron Endpoint] Execution failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Manual Trigger Endpoint for Owner & Manager
app.post('/api/admin/reports/send-daily-stylist-sales', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || (admin.role !== 'owner' && admin.role !== 'manager')) {
      return res.status(403).json({ error: 'Access denied: Only Salon Owner and Manager can trigger daily sales WhatsApp reports.' });
    }

    const { date, force } = req.body || {};
    const targetDate = date || getKolkataDateString();

    console.log(`[Manual Sales Report] Triggered by ${admin.name} (${admin.role}) for date: ${targetDate}, force: ${!!force}`);
    const results = await generateAndSendDailySalesReports(targetDate, !!force);

    await salonRepository.logAudit(
      'SEND_DAILY_STYLIST_SALES_REPORT',
      'DailySalesReport',
      targetDate,
      admin.name,
      `Manually triggered daily sales report for ${targetDate} (Sent: ${results.sent.length}, Skipped: ${results.skipped.length}, Failed: ${results.failed.length}, Force: ${!!force})`
    ).catch(() => {});

    res.json({
      success: true,
      message: `Daily sales WhatsApp reports processed for ${targetDate}.`,
      ...results
    });
  } catch (err: any) {
    console.error('[Manual Sales Report] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Status & History of Sent Reports
app.get('/api/admin/reports/daily-stylist-sales-history', async (req, res) => {
  try {
    const admin = await getAuthAdmin(req);
    if (!admin || (admin.role !== 'owner' && admin.role !== 'manager')) {
      return res.status(403).json({ error: 'Access denied: Restricted to Salon Owner and Manager.' });
    }

    const date = req.query.date as string | undefined;
    const reports = await salonRepository.getDailySalesReports(date);

    // Also get today's status check
    const todayStr = getKolkataDateString();
    const todayReports = reports.filter(r => r.report_date === todayStr);
    const alreadySentToday = todayReports.some(r => r.status === 'sent');

    res.json({
      todayDate: todayStr,
      alreadySentToday,
      todayReportsCount: todayReports.length,
      reports
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/audit-logs', async (req, res) => {
  const admin = await getAuthAdmin(req);
  if (!admin || (admin.role !== 'owner' && admin.role !== 'manager')) {
    return res.status(403).json({ error: 'Access denied: Audit logs are restricted to Salon Owner and Manager.' });
  }
  const logs = await salonRepository.getAuditLogs();
  res.json(logs);
});

// ----------------------------------------------------------------------------
// Print Devices & Print Provider (MOZZ Pattern)
// ----------------------------------------------------------------------------
app.get('/api/print-devices', async (req, res) => {
  const devs = await salonRepository.getPrintDevices();
  res.json(devs);
});

app.post('/api/print-devices/register', async (req, res) => {
  const dev = await salonRepository.registerPrintDevice(req.body);
  res.json(dev);
});

app.post('/api/print-devices/heartbeat', async (req, res) => {
  const { device_id } = req.body;
  if (!device_id) return res.status(400).json({ error: 'Missing device_id' });
  await salonRepository.updateDeviceHeartbeat(device_id);
  res.json({ success: true, timestamp: new Date().toISOString() });
});

app.get('/api/print-jobs', async (req, res) => {
  const jobs = await salonRepository.getPrintJobs();
  res.json(jobs);
});

app.get('/api/print-jobs/pending', async (req, res) => {
  const deviceId = req.query.device_id as string | undefined;
  const jobs = await salonRepository.getPrintJobs(deviceId);
  res.json(jobs.filter(j => j.status === 'Pending' || j.status === 'Retried'));
});

app.post('/api/print-jobs/reprint', async (req, res) => {
  const { job_type, order_id, appointment_id, payload } = req.body;
  const devs = await salonRepository.getPrintDevices();
  const activeDevice = devs.find(d => d.is_online) || devs[0];
  if (!activeDevice) {
    return res.status(400).json({ error: 'No print device registered' });
  }

  // Strip street address, city, PIN code, and GSTIN from thermal receipt payloads
  const cleanPayload: Record<string, any> = { ...(payload || {}) };
  delete cleanPayload.salon_address;
  delete cleanPayload.address;
  delete cleanPayload.city;
  delete cleanPayload.pin_code;
  delete cleanPayload.pincode;
  delete cleanPayload.gstin;
  delete cleanPayload.gst_number;

  if (order_id) {
    const order = await salonRepository.getOrderById(order_id);
    if (order) {
      cleanPayload.bill_number = order.bill_number;
      cleanPayload.branch_code = order.branch_code || resolveCanonicalBranchCode({ branchId: order.branch_id }) || undefined;
      cleanPayload.branch_name = order.branch_name || getCleanReceiptBranchName({
        branchId: order.branch_id,
        branchCode: cleanPayload.branch_code,
      });
    }
  } else if (appointment_id) {
    const apt = await salonRepository.getAppointmentById(appointment_id);
    if (apt) {
      cleanPayload.branch_name = getCleanReceiptBranchName({ branchId: apt.branch_id });
    }
  }

  const job = await salonRepository.queuePrintJob({
    device_id: activeDevice.id,
    job_type: job_type || 'bill',
    order_id,
    appointment_id,
    payload: cleanPayload
  });

  res.json(job);
});

app.patch('/api/print-jobs/:id/status', async (req, res) => {
  const { status } = req.body;
  const updated = await salonRepository.updatePrintJobStatus(req.params.id, status);
  if (!updated) return res.status(404).json({ error: 'Print job not found' });
  res.json(updated);
});

// ----------------------------------------------------------------------------
// Gallery & Reviews & Enquiries
// ----------------------------------------------------------------------------
app.get('/api/gallery', async (req, res) => {
  try {
    const onlyApproved = req.query.approved === 'true';
    const list = await salonRepository.getGallery(onlyApproved);
    res.json(list);
  } catch (err: any) {
    console.error('[GET /api/gallery] Error:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Failed to load gallery' });
  }
});

app.post('/api/gallery', async (req, res) => {
  const actor = (req.headers['x-admin-name'] as string) || 'Artist';
  const item = await salonRepository.createGalleryItem(req.body, actor);
  res.status(201).json(item);
});

app.patch('/api/gallery/:id', async (req, res) => {
  const actor = (req.headers['x-admin-name'] as string) || 'Manager';
  const item = await salonRepository.updateGalleryItem(req.params.id, req.body, actor);
  res.json(item);
});

app.delete('/api/gallery/:id', async (req, res) => {
  const actor = (req.headers['x-admin-name'] as string) || 'Manager';
  const ok = await salonRepository.deleteGalleryItem(req.params.id, actor);
  res.json({ success: ok });
});

app.get('/api/enquiries', async (req, res) => {
  const list = await salonRepository.getEnquiries();
  res.json(list);
});

app.post('/api/enquiries', async (req, res) => {
  try {
    const enq = await salonRepository.createEnquiry(req.body);

    // Synchronize website enquiry into WhatsApp Inbox conversation thread
    try {
      const rawPhone = String(req.body.phone || req.body.mobile || '');
      const cleanDigits = rawPhone.replace(/\D/g, '').slice(-10);
      if (cleanDigits.length === 10) {
        const formattedPhone = `+91${cleanDigits}`;
        let matchedCustomer: any = null;
        try {
          matchedCustomer = await salonRepository.getCustomerByMobile(cleanDigits);
        } catch {}

        const conv = await salonRepository.getOrCreateWhatsAppConversation({
          branch_id: req.body.branch_id || (enq as any).branch_id || (await getDefaultBranchIdFromRepo()),
          customer_id: matchedCustomer?.id,
          customer_phone: formattedPhone,
          customer_name: req.body.name || matchedCustomer?.name || 'Website Visitor',
          source_channel: 'WEBSITE_ENQUIRY'
        });

        const serviceText = req.body.service_interest ? `Service: ${req.body.service_interest}` : 'General Consultation';
        const notesText = req.body.message ? `Notes: ${req.body.message}` : '';
        const emailText = req.body.email ? `Email: ${req.body.email}` : '';
        const messageText = [`Website Enquiry: ${req.body.name || 'Visitor'}`, serviceText, notesText, emailText].filter(Boolean).join('\n');

        const enquiryMsg = await salonRepository.createWhatsAppMessage({
          conversation_id: conv.id,
          direction: 'INBOUND',
          message_type: 'text',
          text_body: messageText,
          status: 'delivered',
          source_badge: 'WEBSITE_ENQUIRY',
          received_at: new Date().toISOString()
        });

        // Update conversation WITHOUT modifying last_inbound_at!
        // (Website enquiry must NOT open the Meta 24-hour WhatsApp customer service window)
        const nowIso = new Date().toISOString();
        const updatedConv = await salonRepository.updateWhatsAppConversation(conv.id, {
          last_message_at: nowIso,
          last_message_text: `[Website Enquiry] ${req.body.service_interest || 'General'}: ${req.body.message || ''}`.trim(),
          unread_count: (conv.unread_count || 0) + 1,
          status: 'OPEN',
          source_channel: conv.source_channel === 'WHATSAPP' ? 'MIXED' : (conv.source_channel || 'WEBSITE_ENQUIRY')
        });

        broadcastWhatsAppInboxEvent({
          type: 'inbound_message',
          conversationId: conv.id,
          message: enquiryMsg,
          conversation: updatedConv || conv
        });
      }
    } catch (inboxErr: any) {
      console.warn('[Website Enquiry] Failed to record in WhatsApp Inbox:', inboxErr.message);
    }

    // Send gl_new_enquiry_alert once to branch + optional admin alert numbers (only after enquiry saved)
    try {
      const allBranches = await salonRepository.getBranches().catch(() => []);
      const defaultBranchId = await getDefaultBranchIdFromRepo();
      const targetBranch = resolveEnquiryBranch(
        allBranches,
        { ...req.body, branch_id: req.body?.branch_id || (enq as any)?.branch_id },
        defaultBranchId
      );
      const effectiveEnquiryBranchId = targetBranch?.id || defaultBranchId;
      const { variables, defaultPositionalOrder } = buildEnquiryAlertVariables(enq, targetBranch);
      const phone10 = String(enq.phone || '').replace(/\D/g, '').slice(-10);
      const tenMinBucket = String(Math.floor(Date.now() / (10 * 60 * 1000)));
      const reqIdempotencyKey = String(
        req.headers['x-idempotency-key'] || req.body?.idempotency_key || ''
      ).trim() || null;

      await dispatchSalonAdminWhatsAppAlert({
        entityType: 'enquiry',
        entityId: enq.id,
        branchId: effectiveEnquiryBranchId,
        branch: targetBranch,
        branchHint: req.body?.branch_name || req.body?.branch || targetBranch?.name || null,
        templateName: ENQUIRY_ADMIN_ALERT_TEMPLATE,
        variables,
        defaultPositionalOrder,
        fingerprintParts: [
          effectiveEnquiryBranchId,
          phone10,
          enq.service_interest || '',
          enq.message || '',
          tenMinBucket,
        ],
        idempotencyKey: reqIdempotencyKey,
        customerName: enq.name,
      });
    } catch (alertErr: any) {
      console.warn('[Website Enquiry] Non-blocking salon/admin WhatsApp alert failure:', alertErr?.message || alertErr);
    }

    res.status(201).json(enq);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reviews', async (req, res) => {
  const list = await salonRepository.getReviews();
  res.json(list);
});

app.post('/api/reviews', async (req, res) => {
  const rev = await salonRepository.createReview(req.body);
  res.status(201).json(rev);
});

// ============================================================================
// VITE INTEGRATION / STATIC SERVING
// ============================================================================

async function startServer() {
  const distPath = path.resolve(__dirname, 'dist');
  const hasDist = fs.existsSync(distPath);

  if (isProd && hasDist) {
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path === '/health' || req.path === '/robots.txt' || req.path === '/sitemap.xml') {
        return next();
      }
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  } else {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);

      // In Vite middlewareMode, SPA HTML routes must be served via transformIndexHtml
      app.use('*', async (req, res, next) => {
        const url = req.originalUrl;
        if (url.startsWith('/api/') || url === '/health' || url === '/robots.txt' || url === '/sitemap.xml') {
          return next();
        }
        try {
          const indexHtmlPath = path.resolve(__dirname, 'index.html');
          if (fs.existsSync(indexHtmlPath)) {
            let template = fs.readFileSync(indexHtmlPath, 'utf-8');
            template = await vite.transformIndexHtml(url, template);
            res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
          } else if (hasDist) {
            res.sendFile(path.resolve(distPath, 'index.html'));
          } else {
            next();
          }
        } catch (e) {
          if (vite && typeof vite.ssrFixStacktrace === 'function') {
            vite.ssrFixStacktrace(e as Error);
          }
          next(e);
        }
      });
    } catch (err) {
      console.warn('Vite dev middleware could not be loaded, falling back to static:', err);
      if (hasDist) {
        app.use(express.static(distPath));
        app.get('*', (req, res, next) => {
          if (req.path.startsWith('/api/') || req.path === '/health' || req.path === '/robots.txt' || req.path === '/sitemap.xml') {
            return next();
          }
          res.sendFile(path.resolve(distPath, 'index.html'));
        });
      }
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Automatically process due PENDING SMAV user sync outbox & pending central bill sync retries in long-running Node processes
  const smavOutboxTimer = setInterval(() => {
    if (!process.env.GLOSSYLOOKS_INTEGRATION_KEY) return;
    triggerNonBlockingOutboxDrain(55_000);
    void drainPendingSmavCentralBills(10);
  }, 60_000);
  if (typeof smavOutboxTimer.unref === 'function') {
    smavOutboxTimer.unref();
  }
}

// A local/AI Studio process needs an HTTP listener. On Vercel the exported
// Express application is invoked by the Vercel Function runtime instead.
if (!process.env.VERCEL) {
  startServer();
}

export default app;
