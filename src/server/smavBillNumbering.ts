/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SMAV Central Bill Numbering & Dynamic Branch Integration Client
 *
 * Implements the GlossyLooks <-> SMAV dynamic branch & central bill numbering flow:
 * 1. Loads authorized active branches dynamically from SMAV (source of truth for
 *    branch_id, branch_name, branch_code, is_active, and user permissions).
 *    Never returns hard-coded fallback branch arrays.
 * 2. Reserves an immutable central bill number BEFORE local bill creation:
 *    POST /api/integrations/glossylooks/bill-numbers/reserve
 * 3. Finalizes the reserved central bill number ONLY AFTER local bill commit:
 *    POST /api/integrations/glossylooks/bill-numbers/finalize
 * 4. Authenticates inbound SMAV sale events on POST /api/integrations/smav/sale-event
 *    using BOTH X-Integration-Key AND HMAC-SHA256 signature verification.
 */

import crypto from 'crypto';
import type express from 'express';
import type { AdminUser, Order, SalonBranch, User } from '../types/salon.ts';
import { mapLocalRoleToSmavRole } from './smavSync.ts';

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface SmavPermittedBranch {
  id: string; // Canonical SMAV & GlossyLooks branch_id
  local_branch_id: string;
  smav_branch_id?: string;
  code: string; // Dynamic SMAV branch code
  smav_branch_code: string;
  name: string; // Clean receipt display name (no street address / city / PIN / GSTIN)
  full_name: string;
  is_active: boolean;
  is_authorized?: boolean;
  source: 'smav';
}

export interface SmavBillReserveRequest {
  branchId: string;
  branchCode: string;
  branchName: string;
  idempotencyKey: string;
  requestedBy: string;
  requestedByUserId?: string;
  centralAuthId?: string;
  /** YYYY-MM-DD business date. Omitted means today's Asia/Kolkata date. */
  billingDate?: string;
  actorRole?: string;
}

export interface SmavBillReserveResponse {
  ok: boolean;
  status: number;
  billNumber?: string;
  reservationId?: string;
  branchCode?: string;
  branchName?: string;
  sequenceNumber?: number;
  businessDate?: string;
  expiresAt?: string;
  error?: string;
  raw?: any;
}

export interface SmavBillFinalizeRequest {
  reservationId?: string;
  billNumber: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  localOrderId: string;
  idempotencyKey: string;
  order: Order;
  finalizedBy: string;
  finalizedByUserId?: string;
  centralAuthId?: string;
}

export interface SmavBillFinalizeResponse {
  ok: boolean;
  status: number;
  billNumber?: string;
  reservationId?: string;
  saleId?: string;
  finalizedAt?: string;
  error?: string;
  raw?: any;
}

export interface SmavInboundVerificationResult {
  ok: boolean;
  status: number;
  error?: string;
}

export interface FetchSmavBranchesResult {
  branches: SmavPermittedBranch[]; // Active + authorized branches for new POS billing
  allBranches: SmavPermittedBranch[]; // All branches returned by SMAV (including disabled for historical records)
  source: 'smav' | 'smav_error';
  warning?: string;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 15000;
const TIMESTAMP_TOLERANCE_SECONDS = 300;

function parseBranchMapEnv(): Record<string, string> {
  const raw = (process.env.SMAV_SALON_BRANCH_MAP_JSON || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const normalized: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (k && typeof v === 'string' && v.trim()) {
          normalized[k.trim().toUpperCase()] = v.trim();
        }
      }
      return normalized;
    }
  } catch {
    // Ignore malformed JSON map
  }
  return {};
}

/**
 * Strips any street/city/PIN suffixes or trailing flagship/branch descriptors
 * so receipts and compact labels display only the clean branch name.
 */
export function sanitizeBranchDisplayName(rawName?: string | null, branchCode?: string | null): string {
  const trimmed = String(rawName || '').trim();
  if (trimmed) {
    const cleaned = trimmed
      .split(',')[0]
      .replace(/\s*(Main\s+Flagship|Flagship|Branch)\s*$/i, '')
      .trim();
    if (cleaned) return cleaned;
  }
  return String(branchCode || '').trim().toUpperCase();
}

/**
 * Formats a dynamic branch label for UI dropdowns, ledgers, and receipts:
 * e.g. "Branch Name (CODE)" when both are available.
 */
export function formatDynamicBranchLabel(branchName?: string | null, branchCode?: string | null): string {
  const cleanName = sanitizeBranchDisplayName(branchName, '');
  const cleanCode = String(branchCode || '').trim().toUpperCase();
  if (cleanName && cleanCode) {
    if (cleanName.toUpperCase() === cleanCode || cleanName.toUpperCase().endsWith(`(${cleanCode})`)) {
      return cleanName;
    }
    return `${cleanName} (${cleanCode})`;
  }
  return cleanName || cleanCode || '';
}

/**
 * Resolves a branch code dynamically from request input, local public.salon_branches
 * record, or optional SMAV_SALON_BRANCH_MAP_JSON override. Never uses hard-coded branch lists.
 */
export function resolveCanonicalBranchCode(input: {
  branchId?: string | null;
  branchCode?: string | null;
  branchName?: string | null;
  localBranch?: Partial<SalonBranch> | null;
}): string | null {
  const explicitCode = String(input.branchCode || '').trim().toUpperCase();
  if (explicitCode && /^[A-Z0-9_-]{2,24}$/.test(explicitCode)) {
    return explicitCode;
  }

  const localSmavCode = String(input.localBranch?.smav_branch_code || '').trim().toUpperCase();
  if (localSmavCode && /^[A-Z0-9_-]{2,24}$/.test(localSmavCode)) {
    return localSmavCode;
  }

  const localCode = String(input.localBranch?.code || '').trim().toUpperCase();
  if (localCode && /^[A-Z0-9_-]{2,24}$/.test(localCode)) {
    return localCode;
  }

  const envMap = parseBranchMapEnv();
  const candidateBranchId = String(input.branchId || input.localBranch?.id || '').trim();
  if (candidateBranchId) {
    for (const [code, mappedBranchId] of Object.entries(envMap)) {
      if (mappedBranchId === candidateBranchId) {
        return code;
      }
    }
  }

  return null;
}

/**
 * Resolves a local public.salon_branches ID dynamically from a SMAV branch code
 * using optional SMAV_SALON_BRANCH_MAP_JSON or loaded localBranches.
 */
export function resolveLocalBranchIdForCode(branchCode?: string | null, localBranches?: SalonBranch[]): string | null {
  const cleanCode = String(branchCode || '').trim().toUpperCase();
  if (!cleanCode) return null;

  const envMap = parseBranchMapEnv();
  if (envMap[cleanCode]) {
    return envMap[cleanCode];
  }

  if (localBranches && localBranches.length > 0) {
    const matched = localBranches.find(
      b =>
        String(b.smav_branch_code || '').trim().toUpperCase() === cleanCode ||
        String(b.code || '').trim().toUpperCase() === cleanCode ||
        String(b.id || '').trim().toUpperCase() === cleanCode
    );
    if (matched) return matched.id;
  }

  return null;
}

/**
 * Returns a clean thermal-receipt-safe branch name with zero street address,
 * city, PIN code, or GSTIN. Purely dynamic — no hard-coded branch names.
 */
export function getCleanReceiptBranchName(input: {
  branchId?: string | null;
  branchCode?: string | null;
  branchName?: string | null;
  localBranch?: Partial<SalonBranch> | null;
}): string {
  const cleanedName = sanitizeBranchDisplayName(
    input.branchName || input.localBranch?.name || '',
    ''
  );
  if (cleanedName) return cleanedName;

  const code = resolveCanonicalBranchCode(input);
  if (code) return code;

  return String(input.branchId || input.localBranch?.id || '').trim();
}

export function getSmavGatewayBaseUrl(): string {
  const configured = (process.env.SMAV_GATEWAY_URL || '').trim().replace(/\/+$/, '');
  if (!configured) return '';
  // Guard against misconfigured URLs that point to /api/integrations/.../users/sync
  return configured.replace(/\/api\/integrations\/glossylooks\/users\/sync$/i, '');
}

export function getSmavIntegrationKey(): string {
  return (process.env.GLOSSYLOOKS_INTEGRATION_KEY || '').trim();
}

export function getSmavDispatchSecret(): string {
  return (process.env.SMAV_DISPATCH_SECRET || '').trim();
}

export function getSmavHmacSecret(): string {
  return getSmavDispatchSecret();
}

export function signSmavPayload(rawBody: string, secret: string, timestampSec?: number): {
  timestamp: string;
  signature: string;
} {
  const ts = String(timestampSec !== undefined ? Math.floor(timestampSec) : Math.floor(Date.now() / 1000));
  const signature = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  return { timestamp: ts, signature };
}

function buildSmavOutboundHeaders(rawBody: string, idempotencyKey?: string): Record<string, string> {
  const integrationKey = getSmavIntegrationKey();
  const hmacSecret = getSmavDispatchSecret();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Business-Source': 'glossylooks',
    'X-Integration-Key': integrationKey,
  };
  if (idempotencyKey) {
    headers['X-Idempotency-Key'] = idempotencyKey;
  }
  if (hmacSecret) {
    const signed = signSmavPayload(rawBody, hmacSecret);
    headers['X-SMAV-Timestamp'] = signed.timestamp;
    headers['X-SMAV-Signature'] = signed.signature;
  }
  return headers;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  return aBuf.length > 0 && aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Dual authentication for inbound POST /api/integrations/smav/sale-event:
 * 1. Validates X-Integration-Key strictly against GLOSSYLOOKS_INTEGRATION_KEY (timing-safe).
 * 2. Validates HMAC-SHA256 signature (X-SMAV-Timestamp + X-SMAV-Signature) over `${timestamp}.${rawBody}`
 *    strictly using SMAV_DISPATCH_SECRET, with ±300s replay protection.
 */
export function verifySmavSaleEventRequest(req: express.Request): SmavInboundVerificationResult {
  const expectedKey = getSmavIntegrationKey();
  if (!expectedKey) {
    return {
      ok: false,
      status: 503,
      error: 'GLOSSYLOOKS_INTEGRATION_KEY is not configured on GlossyLooks server',
    };
  }

  const rawKeyHeader = req.headers['x-integration-key'];
  const suppliedKey = String(Array.isArray(rawKeyHeader) ? rawKeyHeader[0] : rawKeyHeader || '').trim();
  if (!suppliedKey || !timingSafeStringEqual(expectedKey, suppliedKey)) {
    return {
      ok: false,
      status: 401,
      error: 'Invalid or missing X-Integration-Key',
    };
  }

  const secret = getSmavDispatchSecret();
  if (secret.length < 32) {
    return {
      ok: false,
      status: 503,
      error: 'SMAV_DISPATCH_SECRET is not configured (minimum 32 characters required)',
    };
  }

  const rawTs = req.headers['x-smav-timestamp'];
  const ts = String(Array.isArray(rawTs) ? rawTs[0] : rawTs || '').trim();
  const rawSig = req.headers['x-smav-signature'];
  const rawSigStr = String(Array.isArray(rawSig) ? rawSig[0] : rawSig || '').trim();
  const suppliedHex = rawSigStr.toLowerCase().startsWith('sha256=')
    ? rawSigStr.slice(7).trim()
    : rawSigStr;

  const isEpochSeconds = /^\d{10}$/.test(ts);
  const isEpochMs = /^\d{13}$/.test(ts);
  if ((!isEpochSeconds && !isEpochMs) || !/^[a-f0-9]{64}$/i.test(suppliedHex)) {
    return {
      ok: false,
      status: 401,
      error: 'Invalid or missing SMAV HMAC signature headers (X-SMAV-Timestamp / X-SMAV-Signature)',
    };
  }

  const tsSeconds = isEpochMs ? Number(ts) / 1000 : Number(ts);
  if (Math.abs(Date.now() / 1000 - tsSeconds) > TIMESTAMP_TOLERANCE_SECONDS) {
    return {
      ok: false,
      status: 401,
      error: 'SMAV request timestamp outside allowed replay window',
    };
  }

  const raw = (req as express.Request & { rawBody?: Buffer | string }).rawBody;
  let rawText: string | null = null;
  if (Buffer.isBuffer(raw)) {
    rawText = raw.toString('utf8');
  } else if (typeof raw === 'string') {
    rawText = raw;
  } else if (Buffer.isBuffer(req.body)) {
    rawText = req.body.toString('utf8');
  } else if (typeof req.body === 'string') {
    rawText = req.body;
  }

  if (!rawText) {
    return {
      ok: false,
      status: 401,
      error: 'Missing raw request body for SMAV HMAC verification',
    };
  }

  const expectedHex = crypto.createHmac('sha256', secret).update(`${ts}.${rawText}`).digest('hex');
  const suppliedBuf = Buffer.from(suppliedHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (suppliedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(suppliedBuf, expectedBuf)) {
    return {
      ok: false,
      status: 401,
      error: 'Invalid SMAV HMAC signature',
    };
  }

  return { ok: true, status: 200 };
}

/**
 * Dynamically normalizes and deduplicates branches returned by the SMAV branches API.
 * - `allBranches` preserves inactive/disabled branches for historical Payment Ledger & Reports.
 * - `branches` contains strictly active + authorized branches for new POS billing.
 */
export function normalizeDynamicSmavBranches(
  rawList: any[],
  localBranches: SalonBranch[] = []
): { branches: SmavPermittedBranch[]; allBranches: SmavPermittedBranch[] } {
  const allBranches: SmavPermittedBranch[] = [];
  const seenIds = new Set<string>();
  const seenCodes = new Set<string>();

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;

    const rawCode = String(
      item.branch_code ?? item.branchCode ?? item.smav_branch_code ?? item.code ?? item.short_code ?? item.shortCode ?? ''
    )
      .trim()
      .toUpperCase();

    const rawFullName = String(
      item.branch_name ?? item.branchName ?? item.name ?? item.label ?? ''
    ).trim();

    const explicitBranchId = String(
      item.branch_id ??
      item.branchId ??
      item.external_branch_id ??
      item.externalBranchId ??
      item.local_branch_id ??
      item.localBranchId ??
      item.id ??
      ''
    ).trim();

    const matchedLocal = localBranches.find(
      b =>
        (explicitBranchId && b.id === explicitBranchId) ||
        (rawCode && String(b.smav_branch_code || '').trim().toUpperCase() === rawCode) ||
        (rawCode && String(b.code || '').trim().toUpperCase() === rawCode)
    );

    const resolvedId = explicitBranchId || matchedLocal?.id || '';
    const resolvedCode = rawCode || String(matchedLocal?.smav_branch_code || matchedLocal?.code || '').trim().toUpperCase();
    const cleanName = sanitizeBranchDisplayName(rawFullName || matchedLocal?.name || '', resolvedCode);

    // Require at least a canonical branch ID and branch code
    if (!resolvedId || !resolvedCode) continue;

    const idKey = resolvedId.toLowerCase();
    const codeKey = resolvedCode.toUpperCase();
    if (seenIds.has(idKey) || seenCodes.has(codeKey)) continue;
    seenIds.add(idKey);
    seenCodes.add(codeKey);

    const statusLower = String(item.status || '').trim().toLowerCase();
    const isActive = !(
      item.is_active === false ||
      item.isActive === false ||
      item.active === false ||
      statusLower === 'inactive' ||
      statusLower === 'disabled' ||
      statusLower === 'archived'
    );

    const isAuthorized = !(
      item.is_authorized === false ||
      item.isAuthorized === false ||
      item.authorized === false ||
      item.permitted === false ||
      item.is_permitted === false
    );

    allBranches.push({
      id: resolvedId,
      local_branch_id: matchedLocal?.id || resolvedId,
      smav_branch_id: String(item.smav_branch_id ?? item.smavBranchId ?? item.id ?? resolvedId).trim(),
      code: codeKey,
      smav_branch_code: codeKey,
      name: cleanName || codeKey,
      full_name: rawFullName || cleanName || codeKey,
      is_active: isActive,
      is_authorized: isAuthorized,
      source: 'smav',
    });
  }

  allBranches.sort((a, b) => a.name.localeCompare(b.name));
  const activeAuthorized = allBranches.filter(b => b.is_active && b.is_authorized !== false);

  return { branches: activeAuthorized, allBranches };
}

/**
 * Loads permitted branches dynamically from SMAV for POS billing.
 * SMAV is the single source of truth for branch_id, branch_name, branch_code,
 * is_active, and user permissions. Fails closed without hard-coded fallbacks.
 */
export async function fetchSmavPermittedBranches(params: {
  admin?: Partial<User | AdminUser> | null;
  localBranches: SalonBranch[];
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<FetchSmavBranchesResult> {
  const fetchImpl = params.fetchImpl || fetch;
  const timeoutMs = params.timeoutMs || DEFAULT_TIMEOUT_MS;
  const baseUrl = getSmavGatewayBaseUrl();
  const integrationKey = getSmavIntegrationKey();
  const explicitBranchesUrl = (process.env.SMAV_BRANCHES_URL || '').trim();

  if ((!baseUrl && !explicitBranchesUrl) || !integrationKey) {
    const errMsg =
      'SMAV branches integration is not configured (SMAV_BRANCHES_URL / SMAV_GATEWAY_URL and GLOSSYLOOKS_INTEGRATION_KEY are required).';
    return {
      branches: [],
      allBranches: [],
      source: 'smav_error',
      error: errMsg,
      warning: errMsg,
    };
  }

  const targetBase = explicitBranchesUrl || `${baseUrl}/api/integrations/glossylooks/branches`;
  const url = new URL(targetBase);
  url.searchParams.set('outletCode', 'glossylooks');
  if (process.env.SMAV_SALON_OUTLET_ID) {
    url.searchParams.set('outletId', process.env.SMAV_SALON_OUTLET_ID.trim());
  }
  const adminUser = params.admin as Partial<User> | null | undefined;
  if (adminUser?.central_auth_id) {
    url.searchParams.set('userId', adminUser.central_auth_id);
  }
  if (adminUser?.id) {
    url.searchParams.set('externalStaffId', adminUser.id);
  }
  if (adminUser?.role) {
    url.searchParams.set('role', mapLocalRoleToSmavRole(adminUser.role));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: buildSmavOutboundHeaders(''),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = `SMAV branches API returned HTTP ${res.status}: ${data?.error || data?.message || 'Unable to load authorized branches'}`;
      return {
        branches: [],
        allBranches: [],
        source: 'smav_error',
        error: errMsg,
        warning: errMsg,
      };
    }

    const rawList: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.branches)
      ? data.branches
      : Array.isArray(data?.permittedBranches)
      ? data.permittedBranches
      : Array.isArray(data?.data)
      ? data.data
      : [];

    const { branches, allBranches } = normalizeDynamicSmavBranches(rawList, params.localBranches);

    if (branches.length === 0) {
      return {
        branches: [],
        allBranches,
        source: 'smav',
        warning: 'No active authorized branches were returned by SMAV for your account.',
      };
    }

    return { branches, allBranches, source: 'smav' };
  } catch (err: any) {
    const isAbort = err?.name === 'AbortError';
    const errMsg = isAbort
      ? `SMAV branches request timed out after ${Math.round(timeoutMs / 1000)}s`
      : `SMAV branches request failed: ${err?.message || 'Network error'}`;
    return {
      branches: [],
      allBranches: [],
      source: 'smav_error',
      error: errMsg,
      warning: errMsg,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reserves an immutable central bill number from SMAV BEFORE creating the local order.
 * Endpoint: POST ${SMAV_GATEWAY_URL}/api/integrations/glossylooks/bill-numbers/reserve
 * Fails closed whenever SMAV is unconfigured, unreachable, or returns a non-2xx/invalid response.
 */
export async function reserveSmavCentralBillNumber(
  input: SmavBillReserveRequest,
  options?: { fetchImpl?: FetchLike; timeoutMs?: number }
): Promise<SmavBillReserveResponse> {
  const fetchImpl = options?.fetchImpl || fetch;
  const timeoutMs = options?.timeoutMs || DEFAULT_TIMEOUT_MS;
  const baseUrl = getSmavGatewayBaseUrl();
  const integrationKey = getSmavIntegrationKey();
  const explicitUrl = (process.env.SMAV_BILL_RESERVE_URL || '').trim();

  if (!baseUrl && !explicitUrl) {
    return {
      ok: false,
      status: 503,
      error: 'SMAV_GATEWAY_URL is not configured. Cannot reserve central bill number.',
    };
  }
  if (!integrationKey) {
    return {
      ok: false,
      status: 503,
      error: 'GLOSSYLOOKS_INTEGRATION_KEY is not configured. Cannot reserve central bill number.',
    };
  }

  const branchCode = String(input.branchCode || '').trim().toUpperCase();
  if (!branchCode) {
    return {
      ok: false,
      status: 400,
      error: 'A valid authorized SMAV branch code is required before reserving a bill number.',
    };
  }

  const targetUrl = explicitUrl || `${baseUrl}/api/integrations/glossylooks/bill-numbers/reserve`;
  const outletId = (process.env.SMAV_SALON_OUTLET_ID || '').trim();
  const payload = {
    outletCode: 'glossylooks',
    outlet_code: 'glossylooks',
    ...(outletId ? { outletId, outlet_id: outletId } : {}),
    branchCode,
    branch_code: branchCode,
    branchId: input.branchId,
    branch_id: input.branchId,
    branchName: input.branchName,
    branch_name: input.branchName,
    idempotencyKey: input.idempotencyKey,
    idempotency_key: input.idempotencyKey,
    requestedBy: input.requestedBy,
    requested_by: input.requestedBy,
    ...(input.requestedByUserId ? { requestedByUserId: input.requestedByUserId, requested_by_user_id: input.requestedByUserId } : {}),
    ...(input.centralAuthId ? { centralAuthId: input.centralAuthId, central_auth_id: input.centralAuthId } : {}),
    ...(input.actorRole ? { actorRole: input.actorRole, actor_role: input.actorRole } : {}),
    ...(input.billingDate ? { billingDate: input.billingDate, billing_date: input.billingDate } : {}),
    currency: 'INR',
  };

  const rawBody = JSON.stringify(payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(targetUrl, {
      method: 'POST',
      headers: buildSmavOutboundHeaders(rawBody, input.idempotencyKey),
      body: rawBody,
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));
    const billNumber = String(
      data?.billNumber ||
      data?.bill_number ||
      data?.reservation?.billNumber ||
      data?.reservation?.bill_number ||
      data?.data?.billNumber ||
      data?.data?.bill_number ||
      ''
    ).trim();

    const reservationId = String(
      data?.reservationId ||
      data?.reservation_id ||
      data?.reservation?.id ||
      data?.data?.reservationId ||
      data?.data?.reservation_id ||
      data?.id ||
      ''
    ).trim() || undefined;

    if (!res.ok || data?.success === false) {
      return {
        ok: false,
        status: res.status || 503,
        error: data?.error || data?.message || `SMAV bill reserve API failed with HTTP ${res.status}`,
        raw: data,
      };
    }

    if (!billNumber) {
      return {
        ok: false,
        status: 502,
        error: 'SMAV bill reserve API succeeded without returning a bill_number.',
        raw: data,
      };
    }

    return {
      ok: true,
      status: res.status,
      billNumber,
      reservationId,
      branchCode: String(
        data?.branchCode || data?.branch_code || data?.reservation?.branchCode || data?.reservation?.branch_code || branchCode
      ).trim().toUpperCase(),
      branchName: String(
        data?.branchName || data?.branch_name || data?.reservation?.branchName || data?.reservation?.branch_name || input.branchName
      ).trim(),
      sequenceNumber: Number.isFinite(Number(data?.sequenceNumber ?? data?.sequence_number))
        ? Number(data?.sequenceNumber ?? data?.sequence_number)
        : undefined,
      businessDate: data?.businessDate || data?.business_date,
      expiresAt: data?.expiresAt || data?.expires_at,
      raw: data,
    };
  } catch (err: any) {
    const isAbort = err?.name === 'AbortError';
    return {
      ok: false,
      status: isAbort ? 504 : 503,
      error: isAbort
        ? `SMAV bill reserve API timed out after ${Math.round(timeoutMs / 1000)}s`
        : `SMAV bill reserve API unreachable: ${err?.message || 'Network error'}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Finalizes the reserved central bill number with SMAV ONLY AFTER the local bill transaction
 * has been durably committed in GlossyLooks.
 * Endpoint: POST ${SMAV_GATEWAY_URL}/api/integrations/glossylooks/bill-numbers/finalize
 */
export async function finalizeSmavCentralBillNumber(
  input: SmavBillFinalizeRequest,
  options?: { fetchImpl?: FetchLike; timeoutMs?: number }
): Promise<SmavBillFinalizeResponse> {
  const fetchImpl = options?.fetchImpl || fetch;
  const timeoutMs = options?.timeoutMs || DEFAULT_TIMEOUT_MS;
  const baseUrl = getSmavGatewayBaseUrl();
  const integrationKey = getSmavIntegrationKey();
  const explicitUrl = (process.env.SMAV_BILL_FINALIZE_URL || '').trim();

  if (!baseUrl && !explicitUrl) {
    return {
      ok: false,
      status: 503,
      error: 'SMAV_GATEWAY_URL is not configured. Cannot finalize central bill number.',
    };
  }
  if (!integrationKey) {
    return {
      ok: false,
      status: 503,
      error: 'GLOSSYLOOKS_INTEGRATION_KEY is not configured. Cannot finalize central bill number.',
    };
  }

  const targetUrl = explicitUrl || `${baseUrl}/api/integrations/glossylooks/bill-numbers/finalize`;
  const outletId = (process.env.SMAV_SALON_OUTLET_ID || '').trim();
  const finalizeIdempotencyKey = `finalize:${input.idempotencyKey}`;

  const payload = {
    outletCode: 'glossylooks',
    outlet_code: 'glossylooks',
    ...(outletId ? { outletId, outlet_id: outletId } : {}),
    ...(input.reservationId ? { reservationId: input.reservationId, reservation_id: input.reservationId } : {}),
    billNumber: input.billNumber,
    bill_number: input.billNumber,
    branchCode: input.branchCode,
    branch_code: input.branchCode,
    branchId: input.branchId,
    branch_id: input.branchId,
    branchName: input.branchName,
    branch_name: input.branchName,
    localOrderId: input.localOrderId,
    local_order_id: input.localOrderId,
    externalOrderId: input.localOrderId,
    external_order_id: input.localOrderId,
    idempotencyKey: input.idempotencyKey,
    idempotency_key: input.idempotencyKey,
    customerName: input.order.customer_name,
    customer_name: input.order.customer_name,
    customerPhone: input.order.customer_phone,
    customer_phone: input.order.customer_phone,
    subtotal: Number(input.order.subtotal || 0),
    discount: Number(input.order.discount || 0),
    taxAmount: Number(input.order.tax_amount || 0),
    tax_amount: Number(input.order.tax_amount || 0),
    tipAmount: Number(input.order.tip_amount || 0),
    tip_amount: Number(input.order.tip_amount || 0),
    grandTotal: Number(input.order.grand_total || 0),
    grand_total: Number(input.order.grand_total || 0),
    paidAmount: Number(input.order.paid_amount ?? input.order.grand_total ?? 0),
    paid_amount: Number(input.order.paid_amount ?? input.order.grand_total ?? 0),
    dueAmount: Number(input.order.due_amount || 0),
    due_amount: Number(input.order.due_amount || 0),
    paymentStatus: input.order.payment_status,
    payment_status: input.order.payment_status,
    paymentMode: input.order.primary_payment_mode,
    payment_mode: input.order.primary_payment_mode,
    cashierName: input.order.cashier_name || input.finalizedBy,
    cashier_name: input.order.cashier_name || input.finalizedBy,
    ...(input.finalizedByUserId ? { finalizedByUserId: input.finalizedByUserId } : {}),
    ...(input.centralAuthId ? { centralAuthId: input.centralAuthId } : {}),
    billedAt: input.order.billed_at || input.order.created_at,
    billed_at: input.order.billed_at || input.order.created_at,
    items: (input.order.items || []).map(item => ({
      serviceId: item.service_id,
      productId: item.product_id,
      itemName: item.item_name,
      item_name: item.item_name,
      itemType: item.item_type,
      item_type: item.item_type,
      quantity: Number(item.quantity || 1),
      unitPrice: Number(item.unit_price || 0),
      unit_price: Number(item.unit_price || 0),
      totalPrice: Number(item.total_price || 0),
      total_price: Number(item.total_price || 0),
      staffId: item.staff_id,
      staffName: item.staff_name,
      staff_name: item.staff_name,
    })),
  };

  const rawBody = JSON.stringify(payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(targetUrl, {
      method: 'POST',
      headers: buildSmavOutboundHeaders(rawBody, finalizeIdempotencyKey),
      body: rawBody,
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) {
      return {
        ok: false,
        status: res.status || 503,
        error: data?.error || data?.message || `SMAV bill finalize API failed with HTTP ${res.status}`,
        raw: data,
      };
    }

    return {
      ok: true,
      status: res.status,
      billNumber: String(data?.billNumber || data?.bill_number || input.billNumber).trim(),
      reservationId: String(data?.reservationId || data?.reservation_id || input.reservationId || '').trim() || undefined,
      saleId: String(data?.saleId || data?.sale_id || data?.id || '').trim() || undefined,
      finalizedAt: data?.finalizedAt || data?.finalized_at || new Date().toISOString(),
      raw: data,
    };
  } catch (err: any) {
    const isAbort = err?.name === 'AbortError';
    return {
      ok: false,
      status: isAbort ? 504 : 503,
      error: isAbort
        ? `SMAV bill finalize API timed out after ${Math.round(timeoutMs / 1000)}s`
        : `SMAV bill finalize API unreachable: ${err?.message || 'Network error'}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
