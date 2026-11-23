/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Server-side SMAV Central Payment Ledger reconciliation and merging helpers.
 * Uses existing authenticated server-side SMAV gateway credentials via
 * fetchSmavCentralLedger and idempotently upserts finalized central bills into
 * local orders, order_items, payments, and CRM records.
 */

import type {
  Order,
  OrderItem,
  PaymentRecord,
  SalonBranch,
  SmavFinalizedBillUpsertInput,
  User,
} from '../types/salon.ts';
import type { ISalonRepository } from './repositories/salonRepository.ts';
import {
  fetchSmavCentralLedger,
  getCleanReceiptBranchName,
  type SmavCentralLedgerQuery,
  type SmavCentralLedgerResult,
} from './smavBillNumbering.ts';
import { getKolkataDateString, hasFullPaymentLedgerAccess } from '../lib/rbac.ts';

export interface ReconcileCentralLedgerParams {
  repo: ISalonRepository;
  scope: 'today' | 'history' | 'deleted';
  fromDate?: string;
  toDate?: string;
  branchId?: string;
  search?: string;
  admin?: Partial<User> | null;
  localBranches?: SalonBranch[];
  fetchLedgerImpl?: (
    query: SmavCentralLedgerQuery,
    localBranches: SalonBranch[]
  ) => Promise<SmavCentralLedgerResult>;
}

export interface ReconcileCentralLedgerResult {
  smavResult: SmavCentralLedgerResult;
  reconciledCount: number;
  createdCount: number;
  updatedCount: number;
  failedCount: number;
  voidedCentralIds: Set<string>;
  voidedBillNumbers: Set<string>;
  reconciledByCentralId: Map<string, { order: Order; payment: PaymentRecord }>;
  reconciledByBillNumber: Map<string, { order: Order; payment: PaymentRecord }>;
}

function normalizeIsoTimestamp(value: unknown, fallbackIso: string): string {
  if (!value) return fallbackIso;
  const raw = String(value).trim();
  if (!raw) return fallbackIso;
  const dt = new Date(raw);
  return Number.isNaN(dt.getTime()) ? fallbackIso : dt.toISOString();
}

function mapPaymentModeToOrderMode(mode?: string | null): Order['primary_payment_mode'] {
  const raw = String(mode || '').trim().toLowerCase();
  if (raw === 'cash') return 'Cash';
  if (raw === 'card' || raw.includes('credit') || raw.includes('debit')) return 'Card';
  if (raw.includes('split')) return 'Split Payment';
  if (raw.includes('bank') || raw.includes('neft') || raw.includes('imps') || raw.includes('netbank')) return 'Bank Transfer';
  if (raw.includes('later')) return 'Pay Later';
  return 'UPI';
}

function mapPaymentStatusToOrderPaymentStatus(
  paymentStatus?: PaymentRecord['status'],
  dueAmount = 0
): Order['payment_status'] {
  if (paymentStatus === 'Refunded') return 'Refunded';
  if (paymentStatus === 'Void') return 'Cancelled';
  if (dueAmount > 0) return 'Pending';
  return 'Paid';
}

function resolveBranchForCentralRecord(
  row: PaymentRecord,
  localBranches: SalonBranch[]
): { branchId: string; branchCode: string; branchName: string } | null {
  const rawId = String(row.branch_id || '').trim();
  const rawCode = String(row.branch_code || '').trim().toUpperCase();
  const rawName = String(row.branch_name || '').trim().toLowerCase();

  const matched =
    localBranches.find(b => rawId && b.id === rawId) ||
    localBranches.find(
      b =>
        rawCode &&
        (String(b.smav_branch_code || '').trim().toUpperCase() === rawCode ||
          String(b.code || '').trim().toUpperCase() === rawCode)
    ) ||
    localBranches.find(b => {
      if (!rawName) return false;
      const cleanLocal = getCleanReceiptBranchName({ localBranch: b }).toLowerCase();
      return Boolean(cleanLocal && (cleanLocal === rawName || rawName.includes(cleanLocal) || cleanLocal.includes(rawName)));
    }) ||
    null;

  const branchId = matched?.id || rawId;
  const branchCode =
    String(matched?.smav_branch_code || matched?.code || rawCode || '').trim().toUpperCase() ||
    (branchId ? branchId.slice(0, 12).toUpperCase() : '');
  const branchName = getCleanReceiptBranchName({
    branchId: branchId || undefined,
    branchCode: branchCode || undefined,
    branchName: row.branch_name || undefined,
    localBranch: matched,
  });

  if (!branchId) return null;
  return {
    branchId,
    branchCode: branchCode || 'MAIN',
    branchName: branchName || 'Salon Branch',
  };
}

function buildUpsertInputFromCentralRecord(
  row: PaymentRecord,
  branchMeta: { branchId: string; branchCode: string; branchName: string }
): SmavFinalizedBillUpsertInput {
  const nowIso = new Date().toISOString();
  const billedAtIso = normalizeIsoTimestamp(row.billed_at || row.created_at, nowIso);
  const items: OrderItem[] = Array.isArray(row.items)
    ? row.items.map(item => {
        const qty = Math.max(1, Number(item.quantity || 1) || 1);
        const unitPrice = Number(item.unit_price ?? 0) || 0;
        const totalPrice = Number(item.total_price ?? qty * unitPrice) || 0;
        return {
          service_id: item.service_id,
          product_id: item.product_id,
          item_name: String(item.item_name || 'Salon Service').trim(),
          item_type: item.item_type === 'product' ? 'product' : 'service',
          quantity: qty,
          unit_price: unitPrice,
          total_price: totalPrice,
          staff_id: item.staff_id,
          staff_name: item.staff_name,
          commission_amount: Number(item.commission_amount || 0) || 0,
        };
      })
    : [];

  const itemsSum = items.reduce((sum, i) => sum + Number(i.total_price || 0), 0);
  const discount = Math.max(0, Number(row.discount ?? 0) || 0);
  const taxAmount = Math.max(0, Number(row.tax_amount ?? 0) || 0);
  const paidAmount = Math.max(0, Number(row.amount ?? 0) || 0);
  const subtotal =
    row.subtotal !== undefined && Number.isFinite(Number(row.subtotal))
      ? Math.max(0, Number(row.subtotal))
      : Math.max(0, itemsSum || paidAmount);
  const grandTotal = Math.max(
    paidAmount,
    Math.max(0, subtotal - discount + taxAmount)
  );
  const dueAmount = Math.max(0, grandTotal - paidAmount);
  const centralBillId = String(row.smav_central_bill_id || '').trim() || null;
  const billNumber = String(row.bill_number || '').trim();
  const stableEventId = `ledger_reconcile:${centralBillId || billNumber}`;
  const stableIdemKey = `smav_ledger:${centralBillId || billNumber}`;

  return {
    event_id: stableEventId,
    central_bill_number: billNumber,
    smav_central_bill_id: centralBillId,
    smav_sale_id: centralBillId,
    local_order_id:
      row.order_id && row.order_id !== billNumber && row.order_id !== centralBillId
        ? row.order_id
        : null,
    idempotency_key: stableIdemKey,
    branch_id: branchMeta.branchId,
    branch_code: branchMeta.branchCode,
    branch_name: branchMeta.branchName,
    customer_name: String(row.customer_name || 'Walk-in Customer').trim(),
    customer_phone: String(row.customer_phone || '').trim(),
    items,
    subtotal,
    discount,
    tax_percent: 0,
    tax_amount: taxAmount,
    tip_amount: 0,
    grand_total: grandTotal,
    paid_amount: paidAmount,
    due_amount: dueAmount,
    payment_status: mapPaymentStatusToOrderPaymentStatus(row.status, dueAmount),
    primary_payment_mode: mapPaymentModeToOrderMode(row.payment_mode),
    transaction_ref: row.transaction_ref,
    cashier_name: String(row.recorded_by || 'SMAV Central').trim(),
    notes: row.notes || `SMAV finalized bill ${billNumber}`,
    billed_at: billedAtIso,
    finalized_at: billedAtIso,
  };
}

/**
 * Pulls finalized bills from SMAV Central Ledger and idempotently reconciles
 * missing local orders, order_items, payments, and CRM customer visits.
 * Never triggers WhatsApp dispatch or creates duplicate records on replay.
 */
export async function reconcileCentralLedgerIntoLocal(
  params: ReconcileCentralLedgerParams
): Promise<ReconcileCentralLedgerResult> {
  const localBranches =
    params.localBranches && params.localBranches.length > 0
      ? params.localBranches
      : await params.repo.getBranches().catch(() => []);

  const fetchImpl = params.fetchLedgerImpl || fetchSmavCentralLedger;
  const smavResult = await fetchImpl(
    {
      scope: params.scope,
      timezone: 'Asia/Kolkata',
      fromDate: params.fromDate,
      toDate: params.toDate,
      branchId: params.branchId,
      search: params.search,
      admin: params.admin,
    },
    localBranches
  );

  const voidedCentralIds = new Set<string>();
  const voidedBillNumbers = new Set<string>();
  const reconciledByCentralId = new Map<string, { order: Order; payment: PaymentRecord }>();
  const reconciledByBillNumber = new Map<string, { order: Order; payment: PaymentRecord }>();

  let reconciledCount = 0;
  let createdCount = 0;
  let updatedCount = 0;
  let failedCount = 0;

  if (!smavResult.ok || smavResult.payments.length === 0) {
    return {
      smavResult,
      reconciledCount,
      createdCount,
      updatedCount,
      failedCount,
      voidedCentralIds,
      voidedBillNumbers,
      reconciledByCentralId,
      reconciledByBillNumber,
    };
  }

  for (const row of smavResult.payments) {
    const isVoided = Boolean(row.deleted_at) || row.status === 'Void' || row.smav_bill_status === 'voided';
    if (isVoided) {
      if (row.smav_central_bill_id) voidedCentralIds.add(row.smav_central_bill_id);
      if (row.bill_number) voidedBillNumbers.add(row.bill_number);
      continue;
    }

    if (params.scope === 'deleted') continue;

    const billNumber = String(row.bill_number || '').trim();
    if (!billNumber) continue;

    const branchMeta = resolveBranchForCentralRecord(row, localBranches);
    if (!branchMeta) {
      // Cannot upsert without a valid branch_id; still return row in merged display
      continue;
    }

    try {
      const upsertInput = buildUpsertInputFromCentralRecord(row, branchMeta);
      const committed = await params.repo.upsertSmavFinalizedBill(upsertInput);
      reconciledCount += 1;
      if (committed.created) {
        createdCount += 1;
      } else {
        updatedCount += 1;
      }
      if (committed.order.smav_central_bill_id) {
        reconciledByCentralId.set(committed.order.smav_central_bill_id, {
          order: committed.order,
          payment: committed.payment,
        });
      }
      if (committed.order.bill_number) {
        reconciledByBillNumber.set(committed.order.bill_number, {
          order: committed.order,
          payment: committed.payment,
        });
      }
    } catch (err: any) {
      failedCount += 1;
      console.warn(
        `⚠️ [SMAV Ledger Reconcile] Non-fatal local upsert failure for bill ${billNumber}:`,
        err?.message || err
      );
    }
  }

  return {
    smavResult,
    reconciledCount,
    createdCount,
    updatedCount,
    failedCount,
    voidedCentralIds,
    voidedBillNumbers,
    reconciledByCentralId,
    reconciledByBillNumber,
  };
}

export interface MergeLedgerPaymentsParams {
  scope: 'today' | 'history' | 'deleted';
  todayStr: string;
  fromDate?: string;
  toDate?: string;
  effectiveBranchId?: string;
  search?: string;
  adminRole?: string | null;
  smavResult: SmavCentralLedgerResult;
  reconcileResult: ReconcileCentralLedgerResult;
  localOrders: Order[];
  localPayments: PaymentRecord[];
}

/**
 * Merges reconciled SMAV Central bills with local orders/payments into a single
 * deduplicated ledger list. Matches by smav_central_bill_id first, then
 * canonical bill_number, then order_id, preserving original bill timestamps,
 * branch metadata, services/stylists, totals, and local WhatsApp status.
 */
export function buildMergedLedgerPayments(params: MergeLedgerPaymentsParams): {
  payments: PaymentRecord[];
  source: 'smav' | 'local_fallback';
  warning: string | null;
} {
  const {
    scope,
    todayStr,
    fromDate,
    toDate,
    effectiveBranchId,
    search,
    adminRole,
    smavResult,
    reconcileResult,
    localOrders,
    localPayments,
  } = params;

  const fullAccess = hasFullPaymentLedgerAccess(adminRole);

  const orderByCentralId = new Map<string, Order>();
  const orderByBillNum = new Map<string, Order>();
  const orderById = new Map<string, Order>();

  for (const o of localOrders) {
    orderById.set(o.id, o);
    if (o.smav_central_bill_id) orderByCentralId.set(o.smav_central_bill_id, o);
    if (o.bill_number) orderByBillNum.set(o.bill_number, o);
  }
  for (const [cid, entry] of reconcileResult.reconciledByCentralId.entries()) {
    orderByCentralId.set(cid, entry.order);
    orderById.set(entry.order.id, entry.order);
    if (entry.order.bill_number) orderByBillNum.set(entry.order.bill_number, entry.order);
  }
  for (const [bnum, entry] of reconcileResult.reconciledByBillNumber.entries()) {
    orderByBillNum.set(bnum, entry.order);
    orderById.set(entry.order.id, entry.order);
    if (entry.order.smav_central_bill_id) orderByCentralId.set(entry.order.smav_central_bill_id, entry.order);
  }

  const matchesFilters = (p: PaymentRecord): boolean => {
    if (effectiveBranchId && p.branch_id && p.branch_id !== effectiveBranchId) return false;
    const effectiveTs = p.billed_at || p.created_at;
    const dateStr = getKolkataDateString(effectiveTs);
    if (!fullAccess || scope === 'today') {
      if (dateStr !== todayStr) return false;
    } else if (scope !== 'deleted') {
      if (fromDate && dateStr < fromDate) return false;
      if (toDate && dateStr > toDate) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      const hay = `${p.bill_number || ''} ${p.customer_name || ''} ${p.customer_phone || ''} ${p.branch_name || ''} ${p.branch_code || ''} ${(p.items || []).map(i => `${i.item_name} ${i.staff_name || ''}`).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };

  const enrichWithLocalOrder = (p: PaymentRecord): PaymentRecord => {
    // Match by smav_central_bill_id FIRST, then canonical bill_number, then order_id
    const reconciledEntry =
      (p.smav_central_bill_id ? reconcileResult.reconciledByCentralId.get(p.smav_central_bill_id) : undefined) ||
      (p.bill_number ? reconcileResult.reconciledByBillNumber.get(p.bill_number) : undefined);

    const localOrd =
      reconciledEntry?.order ||
      (p.smav_central_bill_id ? orderByCentralId.get(p.smav_central_bill_id) : undefined) ||
      (p.bill_number ? orderByBillNum.get(p.bill_number) : undefined) ||
      (p.order_id ? orderById.get(p.order_id) : undefined);

    if (!localOrd) return p;

    return {
      ...p,
      id: reconciledEntry?.payment?.id || p.id,
      order_id: localOrd.id,
      smav_central_bill_id: p.smav_central_bill_id || localOrd.smav_central_bill_id || null,
      branch_id: localOrd.branch_id || p.branch_id,
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
      billed_at: p.billed_at || localOrd.billed_at || localOrd.created_at,
      created_at: p.created_at || localOrd.created_at,
      backdated_by: p.backdated_by || localOrd.backdated_by,
      backdated_at: p.backdated_at || localOrd.backdated_at,
    };
  };

  const mergedPayments: PaymentRecord[] = [];
  const seenCentralIds = new Set<string>();
  const seenBillNums = new Set<string>();
  const seenOrderIds = new Set<string>();

  const markSeen = (p: PaymentRecord) => {
    if (p.smav_central_bill_id) seenCentralIds.add(p.smav_central_bill_id);
    if (p.bill_number) seenBillNums.add(p.bill_number);
    if (p.order_id) seenOrderIds.add(p.order_id);
  };

  const isAlreadySeen = (p: PaymentRecord): boolean => {
    return Boolean(
      (p.smav_central_bill_id && seenCentralIds.has(p.smav_central_bill_id)) ||
      (p.bill_number && seenBillNums.has(p.bill_number)) ||
      (p.order_id && seenOrderIds.has(p.order_id))
    );
  };

  let source: 'smav' | 'local_fallback' = 'smav';
  let warning: string | null = null;

  if (smavResult.ok) {
    for (const row of smavResult.payments) {
      const enriched = enrichWithLocalOrder(row);
      if (scope === 'deleted') {
        if (!enriched.deleted_at && enriched.status !== 'Void') continue;
      } else {
        if (enriched.deleted_at || enriched.status === 'Void') continue;
      }
      if (!matchesFilters(enriched)) continue;
      if (isAlreadySeen(enriched)) continue;
      mergedPayments.push(enriched);
      markSeen(enriched);
    }

    // Merge local payments that were not already emitted from SMAV (preserving finalized,
    // pending-sync, and legacy local records unless explicitly voided in SMAV)
    for (const localPay of localPayments) {
      const enrichedLocal = enrichWithLocalOrder(localPay);
      if (isAlreadySeen(enrichedLocal)) continue;

      const explicitlyVoidedInSmav = Boolean(
        (enrichedLocal.smav_central_bill_id && reconcileResult.voidedCentralIds.has(enrichedLocal.smav_central_bill_id)) ||
        (enrichedLocal.bill_number && reconcileResult.voidedBillNumbers.has(enrichedLocal.bill_number))
      );

      if (scope === 'deleted') {
        if (!enrichedLocal.deleted_at && enrichedLocal.status !== 'Void' && !explicitlyVoidedInSmav) {
          continue;
        }
      } else {
        if (enrichedLocal.deleted_at || enrichedLocal.status === 'Void' || explicitlyVoidedInSmav) {
          continue;
        }
      }

      if (!matchesFilters(enrichedLocal)) continue;

      mergedPayments.push({
        ...enrichedLocal,
        source_channel:
          enrichedLocal.source_channel ||
          (enrichedLocal.is_legacy_bill ? 'GLOSSYLOOKS_LEGACY' : 'GLOSSYLOOKS_ADMIN'),
      });
      markSeen(enrichedLocal);
    }
  } else {
    source = 'local_fallback';
    warning = smavResult.error || 'SMAV Central Ledger is temporarily unavailable; displaying local cached bills.';
    for (const localPay of localPayments) {
      const enrichedLocal = {
        ...enrichWithLocalOrder(localPay),
        source_channel: localPay.source_channel || 'GLOSSYLOOKS_LOCAL_CACHE',
      };
      if (scope === 'deleted') {
        if (!enrichedLocal.deleted_at && enrichedLocal.status !== 'Void') continue;
      } else {
        if (enrichedLocal.deleted_at || enrichedLocal.status === 'Void') continue;
      }
      if (!matchesFilters(enrichedLocal)) continue;
      if (isAlreadySeen(enrichedLocal)) continue;
      mergedPayments.push(enrichedLocal);
      markSeen(enrichedLocal);
    }
  }

  mergedPayments.sort((a, b) => {
    const timeA = Date.parse(a.billed_at || a.created_at || '') || 0;
    const timeB = Date.parse(b.billed_at || b.created_at || '') || 0;
    return timeB - timeA;
  });

  return {
    payments: mergedPayments,
    source,
    warning,
  };
}
