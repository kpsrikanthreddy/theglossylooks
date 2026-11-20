/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SMAV Central Bill Numbering & Sale Event Integration Client
 *
 * Implements the GlossyLooks <-> SMAV central bill numbering flow:
 * 1. Loads permitted branches from SMAV (Gachibowli = GACHI, Kondapur = KONDA).
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
  id: string; // Local GlossyLooks branch_id (e.g. 'tgl-gachibowli-main')
  local_branch_id: string;
  smav_branch_id?: string;
  code: string; // Canonical SMAV branch code ('GACHI' | 'KONDA' | ...)
  smav_branch_code: string;
  name: string; // Clean receipt display name ('Gachibowli' | 'Kondapur' | ...)
  full_name: string;
  is_active: boolean;
  source: 'smav' | 'local';
}

export interface SmavBillReserveRequest {
  branchId: string;
  branchCode: string;
  branchName: string;
  idempotencyKey: string;
  requestedBy: string;
  requestedByUserId?: string;
  centralAuthId?: string;
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

const DEFAULT_TIMEOUT_MS = 15000;
const TIMESTAMP_TOLERANCE_SECONDS = 300;

export const CANONICAL_BRANCH_DIRECTORY = [
  {
    localBranchId: 'tgl-gachibowli-main',
    smavBranchCode: 'GACHI',
    displayName: 'Gachibowli',
    fullName: 'Gachibowli',
    legacyCodes: ['GACHI', 'GCB-01', 'GCB', 'GACHIBOWLI', 'TGL-01'],
  },
  {
    localBranchId: 'brn-1793346038689',
    smavBranchCode: 'KONDA',
    displayName: 'Kondapur',
    fullName: 'Kondapur',
    legacyCodes: ['KONDA', 'KND-02', 'KND', 'KONDAPUR', 'TGL-02'],
  },
] as const;

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
    // Ignore malformed JSON map and fall back to canonical directory
  }
  return {};
}

export function resolveCanonicalBranchCode(input: {
  branchId?: string | null;
  branchCode?: string | null;
  branchName?: string | null;
  localBranch?: Partial<SalonBranch> | null;
}): string | null {
  const candidates = [
    input.branchCode,
    input.localBranch?.smav_branch_code,
    input.localBranch?.code,
    input.branchId,
    input.localBranch?.id,
    input.branchName,
    input.localBranch?.name,
  ]
    .map(v => String(v || '').trim())
    .filter(Boolean);

  if (candidates.length === 0) return null;

  // Check reverse env map first (code -> localBranchId)
  const envMap = parseBranchMapEnv();
  for (const [code, mappedBranchId] of Object.entries(envMap)) {
    if (
      (input.branchId && input.branchId.trim() === mappedBranchId) ||
      (input.localBranch?.id && input.localBranch.id.trim() === mappedBranchId) ||
      (input.branchCode && input.branchCode.trim().toUpperCase() === code)
    ) {
      return code;
    }
  }

  for (const raw of candidates) {
    const upper = raw.toUpperCase();
    for (const entry of CANONICAL_BRANCH_DIRECTORY) {
      if (
        raw === entry.localBranchId ||
        upper === entry.smavBranchCode ||
        (entry.legacyCodes as readonly string[]).includes(upper) ||
        upper.includes(entry.displayName.toUpperCase())
      ) {
        return entry.smavBranchCode;
      }
    }
  }

  // If SMAV passed an explicit custom uppercase alphanumeric branch code (e.g. MADHA)
  if (input.branchCode && /^[A-Z0-9_-]{2,20}$/i.test(input.branchCode.trim())) {
    return input.branchCode.trim().toUpperCase();
  }
  if (input.localBranch?.smav_branch_code && /^[A-Z0-9_-]{2,20}$/i.test(input.localBranch.smav_branch_code.trim())) {
    return input.localBranch.smav_branch_code.trim().toUpperCase();
  }

  return null;
}

export function resolveLocalBranchIdForCode(branchCode?: string | null, localBranches?: SalonBranch[]): string | null {
  const cleanCode = String(branchCode || '').trim().toUpperCase();
  if (!cleanCode) return null;

  const envMap = parseBranchMapEnv();
  if (envMap[cleanCode]) {
    return envMap[cleanCode];
  }

  const canonical = CANONICAL_BRANCH_DIRECTORY.find(
    e => e.smavBranchCode === cleanCode || (e.legacyCodes as readonly string[]).includes(cleanCode)
  );
  if (canonical) {
    if (localBranches && localBranches.length > 0) {
      const matched = localBranches.find(
        b =>
          b.id === canonical.localBranchId ||
          String(b.smav_branch_code || '').toUpperCase() === canonical.smavBranchCode ||
          String(b.code || '').toUpperCase() === canonical.smavBranchCode ||
          b.name.toLowerCase().includes(canonical.displayName.toLowerCase())
      );
      if (matched) return matched.id;
    }
    return canonical.localBranchId;
  }

  if (localBranches && localBranches.length > 0) {
    const matched = localBranches.find(
      b =>
        String(b.smav_branch_code || '').toUpperCase() === cleanCode ||
        String(b.code || '').toUpperCase() === cleanCode ||
        b.id.toUpperCase() === cleanCode
    );
    if (matched) return matched.id;
  }

  return null;
}

/**
 * Returns a clean thermal-receipt-safe branch name (e.g. "Gachibowli" or "Kondapur")
 * with zero street address, city, PIN code, or GSTIN.
 */
export function getCleanReceiptBranchName(input: {
  branchId?: string | null;
  branchCode?: string | null;
  branchName?: string | null;
  localBranch?: Partial<SalonBranch> | null;
}): string {
  const code = resolveCanonicalBranchCode(input);
  if (code) {
    const canonical = CANONICAL_BRANCH_DIRECTORY.find(e => e.smavBranchCode === code);
    if (canonical) return canonical.displayName;
  }

  const rawName = String(input.branchName || input.localBranch?.name || '').trim();
  if (rawName) {
    if (/gachibowli/i.test(rawName)) return 'Gachibowli';
    if (/kondapur/i.test(rawName)) return 'Kondapur';
    // Strip any trailing "Main Flagship", "Branch", or street/city suffixes after comma/dash
    const cleaned = rawName
      .split(',')[0]
      .replace(/\s*(Main\s+Flagship|Flagship|Branch)\s*$/i, '')
      .trim();
    if (cleaned) return cleaned;
  }

  return code || 'Gachibowli';
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

export function getSmavHmacSecret(): string {
  return (
    process.env.SMAV_DISPATCH_SECRET ||
    process.env.GLOSSYLOOKS_HMAC_SECRET ||
    process.env.SMAV_HMAC_SECRET ||
    ''
  ).trim();
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
  const hmacSecret = getSmavHmacSecret();
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
 * 1. Validates X-Integration-Key against GLOSSYLOOKS_INTEGRATION_KEY (timing-safe).
 * 2. Validates HMAC-SHA256 signature (X-SMAV-Timestamp + X-SMAV-Signature) over `${timestamp}.${rawBody}`
 *    using SMAV_DISPATCH_SECRET (or GLOSSYLOOKS_HMAC_SECRET), with ±300s replay protection.
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

  const secret = getSmavHmacSecret();
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

  if (!/^\d{10}$/.test(ts) || !/^[a-f0-9]{64}$/i.test(suppliedHex)) {
    return {
      ok: false,
      status: 401,
      error: 'Invalid or missing SMAV HMAC signature headers (X-SMAV-Timestamp / X-SMAV-Signature)',
    };
  }

  if (Math.abs(Date.now() / 1000 - Number(ts)) > TIMESTAMP_TOLERANCE_SECONDS) {
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
  } else if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    try {
      rawText = JSON.stringify(req.body);
    } catch {
      rawText = null;
    }
  }

  if (!rawText) {
    return {
      ok: false,
      status: 401,
      error: 'Empty or unreadable request body for HMAC verification',
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
 * Loads permitted branches from SMAV for POS billing, normalized against local GlossyLooks branches
 * so Gachibowli = GACHI and Kondapur = KONDA.
 */
export async function fetchSmavPermittedBranches(params: {
  admin?: Partial<User | AdminUser> | null;
  localBranches: SalonBranch[];
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<{
  branches: SmavPermittedBranch[];
  source: 'smav' | 'local_fallback';
  warning?: string;
}> {
  const fetchImpl = params.fetchImpl || fetch;
  const timeoutMs = params.timeoutMs || DEFAULT_TIMEOUT_MS;
  const baseUrl = getSmavGatewayBaseUrl();
  const integrationKey = getSmavIntegrationKey();
  const explicitBranchesUrl = (process.env.SMAV_BRANCHES_URL || '').trim();

  const buildLocalFallback = (warning?: string): {
    branches: SmavPermittedBranch[];
    source: 'local_fallback';
    warning?: string;
  } => {
    const activeLocal = (params.localBranches || []).filter(b => b.is_active !== false);
    const mapped: SmavPermittedBranch[] = [];
    const seenCodes = new Set<string>();

    for (const local of activeLocal) {
      const code = resolveCanonicalBranchCode({ localBranch: local });
      if (!code || seenCodes.has(code)) continue;
      seenCodes.add(code);
      mapped.push({
        id: local.id,
        local_branch_id: local.id,
        code,
        smav_branch_code: code,
        name: getCleanReceiptBranchName({ localBranch: local, branchCode: code }),
        full_name: local.name,
        is_active: true,
        source: 'local',
      });
    }

    // Ensure canonical GACHI & KONDA exist if local branches were minimal
    for (const entry of CANONICAL_BRANCH_DIRECTORY) {
      if (!seenCodes.has(entry.smavBranchCode)) {
        mapped.push({
          id: entry.localBranchId,
          local_branch_id: entry.localBranchId,
          code: entry.smavBranchCode,
          smav_branch_code: entry.smavBranchCode,
          name: entry.displayName,
          full_name: entry.fullName,
          is_active: true,
          source: 'local',
        });
      }
    }

    return { branches: mapped, source: 'local_fallback', warning };
  };

  if ((!baseUrl && !explicitBranchesUrl) || !integrationKey) {
    return buildLocalFallback(
      'SMAV_GATEWAY_URL or GLOSSYLOOKS_INTEGRATION_KEY is not configured; displaying canonical GlossyLooks branches.'
    );
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
      return buildLocalFallback(
        `SMAV branches API returned HTTP ${res.status}: ${data?.error || data?.message || 'Unable to load permitted branches'}`
      );
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

    const normalized: SmavPermittedBranch[] = [];
    const seenCodes = new Set<string>();

    for (const item of rawList) {
      if (item?.isActive === false || item?.is_active === false || item?.active === false) continue;

      const rawCode = String(
        item?.branchCode || item?.branch_code || item?.code || item?.shortCode || item?.short_code || ''
      ).trim();
      const rawName = String(
        item?.branchName || item?.branch_name || item?.name || item?.label || ''
      ).trim();
      const smavBranchId = item?.id || item?.branchId || item?.branch_id || undefined;

      const canonicalCode = resolveCanonicalBranchCode({
        branchCode: rawCode,
        branchName: rawName,
        branchId: item?.externalBranchId || item?.external_branch_id || item?.localBranchId || item?.local_branch_id,
      });

      if (!canonicalCode || seenCodes.has(canonicalCode)) continue;
      seenCodes.add(canonicalCode);

      const localBranchId =
        item?.externalBranchId ||
        item?.external_branch_id ||
        item?.localBranchId ||
        item?.local_branch_id ||
        resolveLocalBranchIdForCode(canonicalCode, params.localBranches) ||
        `branch-${canonicalCode.toLowerCase()}`;

      const localBranch = (params.localBranches || []).find(b => b.id === localBranchId);
      const cleanName = getCleanReceiptBranchName({
        branchCode: canonicalCode,
        branchName: rawName,
        localBranch,
      });

      normalized.push({
        id: localBranchId,
        local_branch_id: localBranchId,
        smav_branch_id: smavBranchId ? String(smavBranchId) : undefined,
        code: canonicalCode,
        smav_branch_code: canonicalCode,
        name: cleanName,
        full_name: rawName || localBranch?.name || cleanName,
        is_active: true,
        source: 'smav',
      });
    }

    if (normalized.length === 0) {
      return {
        branches: [],
        source: 'smav',
        warning: 'No permitted branches were returned by SMAV for your account.',
      };
    }

    return { branches: normalized, source: 'smav' };
  } catch (err: any) {
    const isAbort = err?.name === 'AbortError';
    return buildLocalFallback(
      isAbort
        ? `SMAV permitted branches request timed out after ${Math.round(timeoutMs / 1000)}s`
        : `SMAV permitted branches request failed: ${err?.message || 'Network error'}`
    );
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
      error: 'A valid SMAV branch code (GACHI or KONDA) is required before reserving a bill number.',
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
    billedAt: input.order.created_at,
    billed_at: input.order.created_at,
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
