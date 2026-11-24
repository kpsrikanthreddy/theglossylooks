/**
 * Server-only Glossy Looks <-> SMAV Authoritative Identity Synchronization Engine
 *
 * Source of truth for Glossy Looks outlet users: `public.users` (Admin Users & RBAC).
 * - Integrates with SMAV Identity Sync API: POST /api/integrations/glossylooks/users/sync
 * - Maps RBAC roles strictly from `public.users.role` (never `public.staff.role` job titles):
 *     owner / manager -> ADMIN
 *     stylist / receptionist / inventory_staff -> POS_BILLING
 * - Durable, idempotent outbox (`smav_user_sync_outbox`) with exponential backoff retries
 * - Zero password / reset token persistence in outbox payloads, logs, or API responses
 * - Strict UUID preservation & fail-closed ambiguity/conflict handling (no duplicate Central Auth users)
 */

import crypto from 'crypto';
import { salonRepository } from './db.ts';
import { IdempotencyKeyConflictError, type ISalonRepository } from './repositories/salonRepository.ts';
import { GlossyLooksSmavAuthAdapter } from './smav/glossylooks_smav_auth_adapter.ts';
import type { SmavSyncAdapterResponse } from './smav/smav_outlet_user_adapter.ts';
import type {
  AdminRole,
  SmavOutletRole,
  SmavSyncStatus,
  SmavUserSyncAction,
  SmavUserSyncEventType,
  SmavUserSyncOutboxItem,
  Staff,
  User,
} from '../types/salon.ts';

export type SyncStaff = {
  sourceId: string;
  centralAuthId?: string;
  username?: string;
  email: string;
  name: string;
  phone?: string;
  role: string;
  active: boolean;
  password?: string;
};

export type SmavSyncResult = {
  synced: boolean;
  syncStatus: SmavSyncStatus;
  outletCode: 'glossylooks';
  status: string;
  outboxId?: string;
  idempotencyKey?: string;
  centralAuthId?: string;
  email?: string;
  username?: string;
  role?: string;
  isNewUser?: boolean;
  mustChangePassword?: boolean;
  conflict?: boolean;
  retryScheduledAt?: string | null;
  passwordResetRequired?: boolean;
  error?: string;
};

export interface SmavSyncDependencies {
  repo?: ISalonRepository;
  adapter?: GlossyLooksSmavAuthAdapter;
  now?: () => number;
}

export type ReconciliationClassification =
  | 'ALREADY_SYNCED'
  | 'READY_UPDATE_BY_UUID'
  | 'READY_LINK_OR_CREATE'
  | 'NEEDS_MANUAL_REVIEW';

export interface ReconciliationUserAudit {
  localUserId: string;
  userCode: string;
  name: string;
  email: string;
  rbacRole: AdminRole;
  mappedSmavRole: SmavOutletRole;
  isActive: boolean;
  centralAuthId: string | null;
  staffProfileId: string | null;
  staffJobTitle: string | null;
  staffEmail: string | null;
  staffCentralAuthId: string | null;
  currentSyncStatus: SmavSyncStatus;
  classification: ReconciliationClassification;
  anomalies: string[];
  recommendedAction: string;
  syncResult?: SmavSyncResult;
}

export interface ReconciliationReport {
  dryRun: boolean;
  generatedAt: string;
  summary: {
    totalAdminUsers: number;
    alreadySynced: number;
    readyUpdateByUuid: number;
    readyLinkOrCreate: number;
    needsManualReview: number;
    syncedNow: number;
    pendingNow: number;
    failedNow: number;
    skippedAmbiguous: number;
  };
  users: ReconciliationUserAudit[];
}

// Backoff delays (in ms) after each transient attempt failure: 30s, 2m, 10m, 30m, 2h
export const SMAV_RETRY_BACKOFF_MS = [
  30_000,
  120_000,
  600_000,
  1_800_000,
  7_200_000,
];

const SENSITIVE_KEY_PATTERN = /(pass(word|wd)?|pwd|secret|token|hash|credential|api[_-]?key|authorization|bearer|jwt|private[_-]?key|access[_-]?key|session[_-]?id|refresh)/i;

export function sanitizeOutboxPayload(value: unknown): Record<string, any> {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(strip);
    }
    if (node && typeof node === 'object') {
      const clean: Record<string, any> = {};
      for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
        if (SENSITIVE_KEY_PATTERN.test(key)) continue;
        if (val !== undefined) {
          clean[key] = strip(val);
        }
      }
      return clean;
    }
    return node;
  };

  const result = strip(value);
  return result && typeof result === 'object' && !Array.isArray(result)
    ? (result as Record<string, any>)
    : {};
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sanitizeSyncError(
  rawError: unknown,
  sensitiveValues?: Array<string | null | undefined>
): string {
  const raw = typeof rawError === 'string'
    ? rawError
    : rawError && typeof (rawError as any).message === 'string'
      ? String((rawError as any).message)
      : 'SMAV synchronization failed';

  let redacted = raw;

  // Strip any explicit transient secrets (e.g., initialPassword / newPassword) if echoed by upstream
  if (Array.isArray(sensitiveValues)) {
    for (const secret of sensitiveValues) {
      const cleanSecret = typeof secret === 'string' ? secret.trim() : '';
      if (cleanSecret.length >= 4) {
        redacted = redacted.replace(new RegExp(escapeRegExp(cleanSecret), 'gi'), '[REDACTED]');
      }
    }
  }

  redacted = redacted
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[REDACTED_JWT]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/"(x-integration-key|apikey|api[_-]?key|pass(?:word|wd)?|newPassword|initialPassword|token|secret|authorization|credential)"\s*:\s*"[^"]*"/gi, '"$1":"[REDACTED]"')
    .replace(/(x-integration-key|apikey|api[_-]?key|pass(?:word|wd)?|newPassword|initialPassword|token|secret|authorization|credential)\s*[:=]\s*[^\s,;}"']+/gi, '$1=[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim();

  return (redacted || 'SMAV synchronization failed').slice(0, 320);
}

export function getGlossyLooksSmavAdapter(): GlossyLooksSmavAuthAdapter {
  const smavSupabaseUrl = (process.env.SMAV_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const edgeFunctionUrl =
    (process.env.SMAV_EDGE_FUNCTION_URL || '').trim() ||
    (smavSupabaseUrl ? `${smavSupabaseUrl}/functions/v1/smav-identity-admin` : undefined);

  return new GlossyLooksSmavAuthAdapter({
    outletCode: 'glossylooks',
    integrationKey: process.env.GLOSSYLOOKS_INTEGRATION_KEY || '',
    gatewayUrl: process.env.SMAV_GATEWAY_URL,
    edgeFunctionUrl,
    edgeFunctionAuthToken: process.env.SMAV_EDGE_FUNCTION_AUTH_TOKEN,
  });
}

/**
 * Authoritative RBAC role mapping (from `public.users.role`, NEVER `public.staff.role`):
 * - OWNER and MANAGER -> ADMIN
 * - STYLIST and RECEPTIONIST (and non-admin outlet staff like inventory_staff) -> POS_BILLING
 */
export function mapLocalRoleToSmavRole(role?: string): SmavOutletRole {
  const clean = String(role || 'stylist').trim().toLowerCase();
  if (clean === 'superadmin' || clean === 'owner' || clean === 'manager' || clean === 'admin') {
    return 'ADMIN';
  }
  return 'POS_BILLING';
}

export function deriveUserSyncStatus(user: Pick<User, 'central_sync_status' | 'central_auth_id' | 'central_last_synced_at' | 'central_sync_error'>): SmavSyncStatus {
  if (user.central_sync_status === 'SYNCED' || user.central_sync_status === 'PENDING' || user.central_sync_status === 'FAILED') {
    return user.central_sync_status;
  }
  if (user.central_sync_error) return 'FAILED';
  // Do NOT infer SYNCED solely from central_auth_id + central_last_synced_at;
  // require verified synchronization or explicit reconciliation.
  return 'PENDING';
}

function mapSmavRoleToLocalRole(rawRole: unknown, existingRole?: AdminRole): AdminRole {
  const clean = String(rawRole || '').trim().toLowerCase();
  if (clean === 'owner') return 'owner';
  if (clean === 'manager') return 'manager';
  if (clean === 'admin') {
    // Never downgrade an existing owner to manager when Central SMAV sends coarse 'ADMIN'
    return existingRole === 'owner' ? 'owner' : 'manager';
  }
  if (clean === 'receptionist' || clean === 'cashier') return 'receptionist';
  if (clean === 'inventory_staff' || clean === 'inventory') return 'inventory_staff';
  if (clean === 'stylist') return 'stylist';
  if (clean === 'staff' || clean === 'pos_billing') {
    if (existingRole === 'receptionist' || existingRole === 'inventory_staff' || existingRole === 'stylist') {
      return existingRole;
    }
    return 'stylist';
  }
  return existingRole || 'stylist';
}

function generateLocalUserCode(role: AdminRole, preferredUsername?: string): string {
  const cleanPreferred = String(preferredUsername || '').trim().toUpperCase();
  if (cleanPreferred && /^TGL-[A-Z0-9_-]{3,}$/.test(cleanPreferred)) {
    return cleanPreferred.slice(0, 50);
  }
  const rolePrefix: Record<AdminRole, string> = {
    superadmin: 'SUP',
    admin: 'ADM',
    owner: 'OWN',
    manager: 'MGR',
    receptionist: 'REC',
    stylist: 'STY',
    pos_billing: 'POS',
    inventory_staff: 'INV',
  };
  const prefix = rolePrefix[role] || 'STF';
  return `TGL-${prefix}${Math.floor(100 + Math.random() * 900)}`;
}

function computeNextRetryIso(attempts: number, nowMs: number): string {
  const idx = Math.max(0, Math.min(attempts - 1, SMAV_RETRY_BACKOFF_MS.length - 1));
  return new Date(nowMs + SMAV_RETRY_BACKOFF_MS[idx]).toISOString();
}

function buildSanitizedSyncPayload(user: User, action: SmavUserSyncAction): Record<string, any> {
  const normalizedEmail = String(user.email || '').trim().toLowerCase();
  const normalizedUsername = String(user.username || user.user_id || '').trim().toLowerCase() || undefined;
  const smavRole = mapLocalRoleToSmavRole(user.role);

  if (action === 'set_status') {
    return sanitizeOutboxPayload({
      ...(user.central_auth_id ? { userId: user.central_auth_id } : {}),
      externalStaffId: String(user.id),
      email: normalizedEmail,
      role: smavRole,
      isActive: Boolean(user.is_active),
    });
  }

  if (action === 'reset_password') {
    // Passwords are NEVER stored in the outbox payload!
    return sanitizeOutboxPayload({
      ...(user.central_auth_id ? { userId: user.central_auth_id } : {}),
      externalStaffId: String(user.id),
      email: normalizedEmail,
      credentialSyncOnly: true,
    });
  }

  return sanitizeOutboxPayload({
    ...(user.central_auth_id ? { userId: user.central_auth_id } : {}),
    externalStaffId: String(user.id),
    email: normalizedEmail,
    fullName: String(user.name || '').trim(),
    ...(normalizedUsername ? { username: normalizedUsername } : {}),
    phone: String(user.phone || '').trim(),
    role: smavRole,
    isActive: Boolean(user.is_active),
  });
}

export function generateSyncIdempotencyKey(
  userOrSubject: Pick<User, 'id'> | string,
  eventType: SmavUserSyncEventType,
  explicitKey?: string
): string {
  const clean = String(explicitKey || '').trim();
  if (clean) return clean.slice(0, 120);
  const subject = typeof userOrSubject === 'string' ? userOrSubject : String(userOrSubject.id);
  const nonce = crypto.randomBytes(6).toString('hex');
  return `gl_${eventType.toLowerCase()}_${subject}_${Date.now()}_${nonce}`.slice(0, 120);
}

async function persistUserSyncState(
  repo: ISalonRepository,
  user: User,
  state: {
    syncStatus: SmavSyncStatus;
    syncError: string | null;
    outboxId?: string | null;
    centralAuthId?: string;
    isActive: boolean;
    syncOrigin: 'outlet_admin' | 'smav_portal';
    username?: string;
    syncVersion?: number;
    performedBy?: string;
    nowIso: string;
    markSyncedNow?: boolean;
  }
): Promise<User | null> {
  // Never assign central_auth_id through ordinary updateUser; require verified audited linking RPC
  // backed by the persisted SYNCED outbox row.
  let effectiveUser = user;
  if (
    state.syncStatus === 'SYNCED' &&
    state.centralAuthId &&
    !user.central_auth_id &&
    state.outboxId
  ) {
    const linked = await repo.linkVerifiedCentralAuthId({
      local_user_id: String(user.id),
      verified_central_auth_id: state.centralAuthId,
      verification_source: 'smav_sync_response',
      evidence_ref: String(state.outboxId),
      performed_by: state.performedBy || 'SMAV Sync',
    });
    if (linked) effectiveUser = linked;
  }

  const nextCentralAuthId = effectiveUser.central_auth_id || user.central_auth_id;

  const updatePayload: Partial<User> = {
    ...(nextCentralAuthId && !effectiveUser.central_auth_linked_at ? { central_auth_linked_at: state.nowIso } : {}),
    ...(state.username && !effectiveUser.username ? { username: state.username } : {}),
    central_auth_status: state.isActive ? 'ACTIVE' : 'DISABLED',
    central_outlet_code: 'glossylooks',
    central_sync_status: state.syncStatus,
    central_sync_error: state.syncError,
    central_sync_last_attempt_at: state.nowIso,
    ...(state.outboxId !== undefined ? { central_sync_outbox_id: state.outboxId } : {}),
    ...(state.markSyncedNow
      ? {
          central_last_synced_at: state.nowIso,
          central_sync_version:
            typeof state.syncVersion === 'number'
              ? state.syncVersion
              : (typeof effectiveUser.central_sync_version === 'number' ? effectiveUser.central_sync_version : 0) + 1,
          central_sync_origin: state.syncOrigin,
        }
      : {}),
  };

  return repo.updateUser(user.id, updatePayload, state.performedBy || 'SMAV Sync');
}

/**
 * Execute a single outbox event against SMAV and update BOTH outbox & authoritative user state.
 * Never silently marks a failed/conflicted response as SYNCED.
 */
async function executeOutboxItem(
  outboxItem: SmavUserSyncOutboxItem,
  user: User,
  options: {
    transientInitialPassword?: string;
    transientNewPassword?: string;
    performedBy?: string;
    deps?: SmavSyncDependencies;
  } = {}
): Promise<SmavSyncResult> {
  const repo = options.deps?.repo || salonRepository;
  const adapter = options.deps?.adapter || getGlossyLooksSmavAdapter();
  const nowMs = options.deps?.now ? options.deps.now() : Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const maxAttempts = Math.max(1, Number(outboxItem.max_attempts || 6));
  // Unified claim-time attempt counting: attempts was already incremented when transitioning into PROCESSING
  const currentAttempt = Math.max(1, Number(outboxItem.attempts || 1));
  const boundedAttempts = Math.min(currentAttempt, maxAttempts);
  const sensitiveValues = [options.transientInitialPassword, options.transientNewPassword];

  // Validate basic identity prerequisites before calling SMAV
  const cleanEmail = String(user.email || '').trim().toLowerCase();
  if (!user.id || !cleanEmail || !cleanEmail.includes('@')) {
    const msg = 'Valid local user ID and email address are required before syncing to SMAV.';
    await repo.updateSmavUserSyncEvent(outboxItem.id, {
      status: 'FAILED',
      attempts: boundedAttempts,
      locked_at: null,
      last_error: msg,
      conflict: false,
    });
    await persistUserSyncState(repo, user, {
      syncStatus: 'FAILED',
      syncError: msg,
      outboxId: outboxItem.id,
      isActive: user.is_active,
      syncOrigin: 'outlet_admin',
      performedBy: options.performedBy,
      nowIso,
    });
    return {
      synced: false,
      syncStatus: 'FAILED',
      outletCode: 'glossylooks',
      status: 'failed',
      outboxId: outboxItem.id,
      idempotencyKey: outboxItem.idempotency_key,
      centralAuthId: user.central_auth_id,
      error: msg,
    };
  }

  // Enforce SMAV password minimum cleanly without skipping silently
  if (outboxItem.action === 'reset_password') {
    const cleanPwd = String(options.transientNewPassword || '').trim();
    if (cleanPwd.length < 8) {
      const msg = cleanPwd.length === 0
        ? 'Passwords are not stored in the outbox. Use Reset Password in Admin Users to push a new password to SMAV.'
        : 'SMAV Central Auth requires passwords of at least 8 characters.';
      await repo.updateSmavUserSyncEvent(outboxItem.id, {
        status: 'FAILED',
        attempts: boundedAttempts,
        locked_at: null,
        last_error: msg,
        conflict: false,
      });
      await persistUserSyncState(repo, user, {
        syncStatus: 'FAILED',
        syncError: msg,
        outboxId: outboxItem.id,
        isActive: user.is_active,
        syncOrigin: 'outlet_admin',
        performedBy: options.performedBy,
        nowIso,
      });
      return {
        synced: false,
        syncStatus: 'FAILED',
        outletCode: 'glossylooks',
        status: 'failed',
        outboxId: outboxItem.id,
        idempotencyKey: outboxItem.idempotency_key,
        centralAuthId: user.central_auth_id,
        passwordResetRequired: true,
        error: msg,
      };
    }
  }

  if (options.transientInitialPassword && options.transientInitialPassword.length < 8) {
    const msg = 'SMAV Central Auth requires initial passwords of at least 8 characters.';
    await repo.updateSmavUserSyncEvent(outboxItem.id, {
      status: 'FAILED',
      attempts: boundedAttempts,
      locked_at: null,
      last_error: msg,
      conflict: false,
    });
    await persistUserSyncState(repo, user, {
      syncStatus: 'FAILED',
      syncError: msg,
      outboxId: outboxItem.id,
      isActive: user.is_active,
      syncOrigin: 'outlet_admin',
      performedBy: options.performedBy,
      nowIso,
    });
    return {
      synced: false,
      syncStatus: 'FAILED',
      outletCode: 'glossylooks',
      status: 'failed',
      outboxId: outboxItem.id,
      idempotencyKey: outboxItem.idempotency_key,
      centralAuthId: user.central_auth_id,
      error: msg,
    };
  }

  // Dispatch exact SMAV action using authoritative public.users fields
  const smavRole = mapLocalRoleToSmavRole(user.role);
  const normalizedUsername = String(user.username || user.user_id || '').trim().toLowerCase() || undefined;

  let res: SmavSyncAdapterResponse;
  try {
    if (outboxItem.action === 'set_status') {
      res = await adapter.setUserStatus(
        {
          userId: user.central_auth_id || undefined,
          externalStaffId: String(user.id),
          email: cleanEmail,
          role: smavRole,
          isActive: Boolean(user.is_active),
        },
        outboxItem.idempotency_key
      );
    } else if (outboxItem.action === 'reset_password') {
      res = await adapter.resetStaffPassword(
        {
          userId: user.central_auth_id || undefined,
          externalStaffId: String(user.id),
          email: cleanEmail,
          newPassword: String(options.transientNewPassword || ''),
        },
        outboxItem.idempotency_key
      );
    } else {
      res = await adapter.syncStaffMember(
        {
          userId: user.central_auth_id || undefined,
          externalStaffId: String(user.id),
          email: cleanEmail,
          fullName: String(user.name || '').trim(),
          username: normalizedUsername,
          phone: String(user.phone || '').trim(),
          role: smavRole,
          isActive: Boolean(user.is_active),
          ...(options.transientInitialPassword ? { initialPassword: options.transientInitialPassword } : {}),
        },
        outboxItem.idempotency_key
      );
    }
  } catch (err: any) {
    res = {
      success: false,
      retryable: true,
      message: sanitizeSyncError(err, sensitiveValues),
    };
  }

  // Fail closed on UUID mismatch: NEVER overwrite an existing central_auth_id with a different UUID!
  if (
    res.success &&
    user.central_auth_id &&
    res.userId &&
    user.central_auth_id.toLowerCase() !== res.userId.toLowerCase()
  ) {
    const conflictMsg = `Identity conflict: SMAV returned Central Auth UUID ${res.userId} which does not match linked UUID ${user.central_auth_id}. Account was not overwritten; manual reconciliation required.`;
    await repo.updateSmavUserSyncEvent(outboxItem.id, {
      status: 'FAILED',
      attempts: boundedAttempts,
      locked_at: null,
      last_http_status: res.status || 409,
      last_error: conflictMsg,
      conflict: true,
    });
    await persistUserSyncState(repo, user, {
      syncStatus: 'FAILED',
      syncError: conflictMsg,
      outboxId: outboxItem.id,
      isActive: user.is_active,
      syncOrigin: 'outlet_admin',
      performedBy: options.performedBy,
      nowIso,
    });
    return {
      synced: false,
      syncStatus: 'FAILED',
      outletCode: 'glossylooks',
      status: 'conflict',
      outboxId: outboxItem.id,
      idempotencyKey: outboxItem.idempotency_key,
      centralAuthId: user.central_auth_id,
      conflict: true,
      error: conflictMsg,
    };
  }

  // Fail closed if SMAV reported success for an unlinked user without returning a Central Auth UUID
  const resolvedCentralAuthId = user.central_auth_id || res.userId;
  if (res.success && !resolvedCentralAuthId && (outboxItem.action === 'upsert_user' || outboxItem.action === 'update_user')) {
    const missingUuidMsg = 'SMAV accepted the request but did not return a Central Auth UUID. Marked FAILED for reconciliation.';
    await repo.updateSmavUserSyncEvent(outboxItem.id, {
      status: 'FAILED',
      attempts: boundedAttempts,
      locked_at: null,
      last_http_status: res.status || 502,
      last_error: missingUuidMsg,
      conflict: false,
    });
    await persistUserSyncState(repo, user, {
      syncStatus: 'FAILED',
      syncError: missingUuidMsg,
      outboxId: outboxItem.id,
      isActive: user.is_active,
      syncOrigin: 'outlet_admin',
      performedBy: options.performedBy,
      nowIso,
    });
    return {
      synced: false,
      syncStatus: 'FAILED',
      outletCode: 'glossylooks',
      status: 'failed',
      outboxId: outboxItem.id,
      idempotencyKey: outboxItem.idempotency_key,
      error: missingUuidMsg,
    };
  }

  // Confirmed success!
  if (res.success) {
    await repo.updateSmavUserSyncEvent(outboxItem.id, {
      status: 'SYNCED',
      attempts: boundedAttempts,
      locked_at: null,
      last_http_status: res.status || 200,
      last_error: null,
      conflict: false,
      response_central_auth_id: resolvedCentralAuthId || null,
      synced_at: nowIso,
    });

    await persistUserSyncState(repo, user, {
      syncStatus: 'SYNCED',
      syncError: null,
      outboxId: outboxItem.id,
      centralAuthId: resolvedCentralAuthId,
      isActive: user.is_active,
      syncOrigin: 'outlet_admin',
      username: res.username || user.username || normalizedUsername,
      performedBy: options.performedBy,
      nowIso,
      markSyncedNow: true,
    });

    const resultStatus =
      outboxItem.action === 'reset_password'
        ? 'password_reset'
        : outboxItem.action === 'set_status'
          ? (user.is_active ? 'enabled' : 'disabled')
          : res.isNewUser
            ? 'created'
            : 'synced';

    return {
      synced: true,
      syncStatus: 'SYNCED',
      outletCode: 'glossylooks',
      status: resultStatus,
      outboxId: outboxItem.id,
      idempotencyKey: outboxItem.idempotency_key,
      centralAuthId: resolvedCentralAuthId,
      email: res.email || cleanEmail,
      username: res.username || normalizedUsername,
      role: res.role || smavRole,
      isNewUser: res.isNewUser,
      mustChangePassword: res.mustChangePassword,
    };
  }

  // Failure handling: differentiate temporary retryable errors vs permanent/409 conflict/exhausted attempts
  const safeErr = sanitizeSyncError(res.message, sensitiveValues);
  const isPermanentConflict = Boolean(res.conflict) || res.status === 409;
  const canRetry =
    Boolean(res.retryable) &&
    !isPermanentConflict &&
    outboxItem.action !== 'reset_password' &&
    currentAttempt < maxAttempts;

  if (canRetry) {
    const nextRetryAt = computeNextRetryIso(currentAttempt, nowMs);
    const pendingError = options.transientInitialPassword
      ? `${safeErr}. Retrying user sync automatically; password was not stored—use Reset Password once synced.`
      : safeErr;
    const sanitizedPendingError = sanitizeSyncError(pendingError, sensitiveValues);

    await repo.updateSmavUserSyncEvent(outboxItem.id, {
      status: 'PENDING',
      attempts: boundedAttempts,
      locked_at: null,
      next_retry_at: nextRetryAt,
      last_http_status: res.status || null,
      last_error: sanitizedPendingError,
      conflict: false,
    });

    await persistUserSyncState(repo, user, {
      syncStatus: 'PENDING',
      syncError: sanitizedPendingError,
      outboxId: outboxItem.id,
      isActive: user.is_active,
      syncOrigin: 'outlet_admin',
      performedBy: options.performedBy,
      nowIso,
    });

    return {
      synced: false,
      syncStatus: 'PENDING',
      outletCode: 'glossylooks',
      status: 'pending_retry',
      outboxId: outboxItem.id,
      idempotencyKey: outboxItem.idempotency_key,
      centralAuthId: user.central_auth_id,
      retryScheduledAt: nextRetryAt,
      passwordResetRequired: Boolean(options.transientInitialPassword),
      error: sanitizedPendingError,
    };
  }

  // Permanent failure, 409 Conflict, max retries reached, or failed password reset (never retried automatically)
  const retryExhausted = Boolean(res.retryable) && !isPermanentConflict && currentAttempt >= maxAttempts;
  const finalError = outboxItem.action === 'reset_password'
    ? `Local password updated, but SMAV password sync failed (${safeErr}). Re-submit Reset Password to sync credentials securely.`
    : retryExhausted
      ? `${safeErr} (max retry attempts ${maxAttempts}/${maxAttempts} exhausted; manual Retry Sync required).`
      : safeErr;
  const sanitizedFinalError = sanitizeSyncError(finalError, sensitiveValues);

  await repo.updateSmavUserSyncEvent(outboxItem.id, {
    status: 'FAILED',
    attempts: boundedAttempts,
    locked_at: null,
    last_http_status: res.status || null,
    last_error: sanitizedFinalError,
    conflict: isPermanentConflict,
  });

  await persistUserSyncState(repo, user, {
    syncStatus: 'FAILED',
    syncError: sanitizedFinalError,
    outboxId: outboxItem.id,
    isActive: user.is_active,
    syncOrigin: 'outlet_admin',
    performedBy: options.performedBy,
    nowIso,
  });

  return {
    synced: false,
    syncStatus: 'FAILED',
    outletCode: 'glossylooks',
    status: isPermanentConflict ? 'conflict' : 'failed',
    outboxId: outboxItem.id,
    idempotencyKey: outboxItem.idempotency_key,
    centralAuthId: user.central_auth_id,
    conflict: isPermanentConflict,
    passwordResetRequired: outboxItem.action === 'reset_password' || Boolean(options.transientInitialPassword),
    error: sanitizedFinalError,
  };
}

/**
 * Execute an outbox item that was ALREADY enqueued atomically in the same DB transaction
 * as the local `public.users` write (via `createUserWithSmavOutbox` / `updateUserWithSmavOutbox`).
 * Uses atomic claim-time attempt incrementing so concurrent workers and replays never double-dispatch.
 */
export async function executeCommittedOutboxSync(params: {
  outboxItem: SmavUserSyncOutboxItem;
  created: boolean;
  user: User;
  transientInitialPassword?: string;
  performedBy?: string;
  deps?: SmavSyncDependencies;
}): Promise<SmavSyncResult> {
  const repo = params.deps?.repo || salonRepository;
  const nowMs = params.deps?.now ? params.deps.now() : Date.now();
  const { outboxItem, created, user } = params;

  // Strict idempotency replay handling: never double-dispatch or resurrect terminally failed keys
  if (!created) {
    if (outboxItem.status === 'SYNCED') {
      return {
        synced: true,
        syncStatus: 'SYNCED',
        outletCode: 'glossylooks',
        status: 'idempotent_replay',
        outboxId: outboxItem.id,
        idempotencyKey: outboxItem.idempotency_key,
        centralAuthId: outboxItem.response_central_auth_id || user.central_auth_id,
        email: user.email,
        role: mapLocalRoleToSmavRole(user.role),
      };
    }
    if (outboxItem.status === 'PROCESSING') {
      return {
        synced: false,
        syncStatus: 'PENDING',
        outletCode: 'glossylooks',
        status: 'processing',
        outboxId: outboxItem.id,
        idempotencyKey: outboxItem.idempotency_key,
        centralAuthId: user.central_auth_id,
      };
    }
    if (outboxItem.status === 'FAILED') {
      return {
        synced: false,
        syncStatus: 'FAILED',
        outletCode: 'glossylooks',
        status: outboxItem.conflict ? 'conflict' : 'failed',
        outboxId: outboxItem.id,
        idempotencyKey: outboxItem.idempotency_key,
        centralAuthId: user.central_auth_id,
        conflict: Boolean(outboxItem.conflict),
        error: outboxItem.last_error || 'Previous synchronization attempt with this idempotency key failed.',
      };
    }
    if (outboxItem.status === 'PENDING' && outboxItem.next_retry_at && Date.parse(outboxItem.next_retry_at) > nowMs) {
      return {
        synced: false,
        syncStatus: 'PENDING',
        outletCode: 'glossylooks',
        status: 'pending_retry',
        outboxId: outboxItem.id,
        idempotencyKey: outboxItem.idempotency_key,
        centralAuthId: user.central_auth_id,
        retryScheduledAt: outboxItem.next_retry_at,
        error: outboxItem.last_error || undefined,
      };
    }
  }

  // Atomically claim the event (transitions PENDING -> PROCESSING and increments attempts by +1)
  const claimed = await repo.claimSmavUserSyncEventById(outboxItem.id);
  if (!claimed) {
    const latest = (await repo.getSmavUserSyncOutboxById(outboxItem.id)) || outboxItem;
    if (latest.status === 'SYNCED') {
      return {
        synced: true,
        syncStatus: 'SYNCED',
        outletCode: 'glossylooks',
        status: 'idempotent_replay',
        outboxId: latest.id,
        idempotencyKey: latest.idempotency_key,
        centralAuthId: latest.response_central_auth_id || user.central_auth_id,
        email: user.email,
        role: mapLocalRoleToSmavRole(user.role),
      };
    }
    if (latest.status === 'FAILED') {
      return {
        synced: false,
        syncStatus: 'FAILED',
        outletCode: 'glossylooks',
        status: latest.conflict ? 'conflict' : 'failed',
        outboxId: latest.id,
        idempotencyKey: latest.idempotency_key,
        centralAuthId: user.central_auth_id,
        conflict: Boolean(latest.conflict),
        error: latest.last_error || 'Synchronization attempt failed.',
      };
    }
    return {
      synced: false,
      syncStatus: 'PENDING',
      outletCode: 'glossylooks',
      status: latest.status === 'PROCESSING' ? 'processing' : 'pending_retry',
      outboxId: latest.id,
      idempotencyKey: latest.idempotency_key,
      centralAuthId: user.central_auth_id,
      retryScheduledAt: latest.status === 'PENDING' ? latest.next_retry_at : undefined,
      error: latest.last_error || undefined,
    };
  }

  return executeOutboxItem(claimed, user, {
    transientInitialPassword: params.transientInitialPassword,
    performedBy: params.performedBy,
    deps: params.deps,
  });
}

/**
 * Primary entry point for enqueueing and immediately attempting SMAV synchronization
 * for existing users (e.g., Retry Sync, Reconciliation, or callers outside atomic RPCs).
 * Note: `reset_password` is strictly synchronous and never enqueued as a PENDING outbox job.
 */
export async function enqueueAndProcessUserSync(params: {
  user: User;
  eventType: SmavUserSyncEventType;
  action?: SmavUserSyncAction;
  idempotencyKey?: string;
  transientInitialPassword?: string;
  transientNewPassword?: string;
  performedBy?: string;
  deps?: SmavSyncDependencies;
}): Promise<SmavSyncResult> {
  const repo = params.deps?.repo || salonRepository;
  const user = params.user;

  const resolvedAction: SmavUserSyncAction =
    params.action ||
    (params.eventType === 'PASSWORD_RESET'
      ? 'reset_password'
      : params.eventType === 'USER_DEACTIVATED'
        ? 'set_status'
        : user.central_auth_id
          ? 'update_user'
          : 'upsert_user');

  // Password reset is ALWAYS strictly synchronous — never enqueue a PENDING retryable outbox job
  if (resolvedAction === 'reset_password') {
    return resetSmavUserPasswordAndPersist(user, String(params.transientNewPassword || ''), {
      idempotencyKey: params.idempotencyKey,
      performedBy: params.performedBy,
      deps: params.deps,
    });
  }

  const idempotencyKey = generateSyncIdempotencyKey(
    user,
    params.eventType,
    params.idempotencyKey
  );

  const sanitizedPayload = buildSanitizedSyncPayload(user, resolvedAction);

  const { item: outboxItem, created } = await repo.enqueueSmavUserSyncEvent({
    idempotency_key: idempotencyKey,
    local_user_id: String(user.id),
    event_type: params.eventType,
    action: resolvedAction,
    payload: sanitizedPayload,
    performed_by: params.performedBy || 'Owner',
    max_attempts: 6,
  });

  return executeCommittedOutboxSync({
    outboxItem,
    created,
    user,
    transientInitialPassword: params.transientInitialPassword,
    performedBy: params.performedBy,
    deps: params.deps,
  });
}

/**
 * Automatically drains due `PENDING` outbox events with bounded backoff & stale-lock recovery.
 * Safe to invoke from background timers, Vercel cron, or opportunistic triggers.
 */
let isOutboxDrainRunning = false;
let lastOpportunisticDrainMs = 0;

export async function processPendingSmavUserSyncOutbox(options?: {
  limit?: number;
  staleLockMinutes?: number;
  deps?: SmavSyncDependencies;
}): Promise<{
  claimed: number;
  synced: number;
  pending: number;
  failed: number;
  results: SmavSyncResult[];
}> {
  const repo = options?.deps?.repo || salonRepository;
  const dueEvents = await repo.claimDueSmavUserSyncEvents(
    options?.limit ?? 20,
    options?.staleLockMinutes ?? 5
  );
  if (dueEvents.length === 0) {
    return { claimed: 0, synced: 0, pending: 0, failed: 0, results: [] };
  }

  const allUsers = await repo.getUsers();
  const usersById = new Map<string, User>(allUsers.map(u => [String(u.id), u]));

  let synced = 0;
  let pending = 0;
  let failed = 0;
  const results: SmavSyncResult[] = [];

  for (const item of dueEvents) {
    // Defense-in-depth: never retry permanent conflicts, password resets, or attempts exceeding max_attempts
    // (Note: claimDueSmavUserSyncEvents already incremented attempts to 1..maxAttempts at claim time)
    const maxAttempts = Math.max(1, Number(item.max_attempts || 6));
    if (item.conflict || item.action === 'reset_password' || (item.attempts || 0) > maxAttempts) {
      await repo.updateSmavUserSyncEvent(item.id, {
        status: 'FAILED',
        locked_at: null,
        last_error: item.last_error || 'Event is not eligible for automatic retry.',
      });
      failed++;
      continue;
    }

    const user = item.local_user_id ? usersById.get(String(item.local_user_id)) : undefined;
    if (!user) {
      await repo.updateSmavUserSyncEvent(item.id, {
        status: 'FAILED',
        locked_at: null,
        last_error: 'Local admin user no longer exists in public.users; historical outbox entry preserved.',
      });
      failed++;
      continue;
    }

    const res = await executeOutboxItem(item, user, {
      performedBy: item.performed_by || 'SMAV Outbox Worker',
      deps: options?.deps,
    });
    results.push(res);
    if (res.syncStatus === 'SYNCED') synced++;
    else if (res.syncStatus === 'PENDING') pending++;
    else failed++;
  }

  return { claimed: dueEvents.length, synced, pending, failed, results };
}

export function triggerNonBlockingOutboxDrain(minIntervalMs = 30_000): void {
  const now = Date.now();
  if (isOutboxDrainRunning || now - lastOpportunisticDrainMs < minIntervalMs) return;
  lastOpportunisticDrainMs = now;
  isOutboxDrainRunning = true;
  processPendingSmavUserSyncOutbox({ limit: 10 })
    .catch((err) => {
      console.warn('[SMAV Outbox] Background drain warning:', sanitizeSyncError(err));
    })
    .finally(() => {
      isOutboxDrainRunning = false;
    });
}

/**
 * Authorized Owner Retry Sync action for a single Glossy Looks Admin User.
 */
export async function retrySmavSyncForUser(
  localUserId: string,
  performedBy: string,
  deps?: SmavSyncDependencies
): Promise<SmavSyncResult> {
  const repo = deps?.repo || salonRepository;
  const users = await repo.getUsers();
  const user = users.find(u => String(u.id) === String(localUserId));
  if (!user) {
    return {
      synced: false,
      syncStatus: 'FAILED',
      outletCode: 'glossylooks',
      status: 'not_found',
      error: 'Admin user not found.',
    };
  }

  // Guard against local identity ambiguity before dispatching to SMAV
  const cleanEmail = String(user.email || '').trim().toLowerCase();
  const duplicateEmail = users.find(
    u => String(u.id) !== String(user.id) && String(u.email || '').trim().toLowerCase() === cleanEmail
  );
  if (duplicateEmail) {
    const conflictMsg = `Local duplicate email (${cleanEmail}) shared with ${duplicateEmail.user_id}. Resolve duplicate email before syncing to SMAV.`;
    await persistUserSyncState(repo, user, {
      syncStatus: 'FAILED',
      syncError: conflictMsg,
      isActive: user.is_active,
      syncOrigin: 'outlet_admin',
      performedBy,
      nowIso: new Date(deps?.now ? deps.now() : Date.now()).toISOString(),
    });
    return {
      synced: false,
      syncStatus: 'FAILED',
      outletCode: 'glossylooks',
      status: 'conflict',
      conflict: true,
      centralAuthId: user.central_auth_id,
      error: conflictMsg,
    };
  }

  // Check if latest failure was a password reset so we inform the Owner accurately
  const recentOutbox = await repo.getSmavUserSyncOutbox({ localUserId: String(user.id), limit: 1 });
  const lastWasFailedPwdReset =
    recentOutbox[0]?.action === 'reset_password' && recentOutbox[0]?.status === 'FAILED';

  const eventType: SmavUserSyncEventType = user.is_active ? 'RECONCILE_USER' : 'USER_DEACTIVATED';
  const action: SmavUserSyncAction = user.is_active
    ? (user.central_auth_id ? 'update_user' : 'upsert_user')
    : 'set_status';

  const result = await enqueueAndProcessUserSync({
    user,
    eventType,
    action,
    performedBy,
    deps,
  });

  if (result.synced && lastWasFailedPwdReset) {
    return {
      ...result,
      passwordResetRequired: true,
    };
  }

  return result;
}

/**
 * Safe Initial Reconciliation Process for existing Glossy Looks Admin Users (`public.users`).
 * - Matches by immutable local ID (`public.users.id`) and verified `central_auth_id` / unique email.
 * - NEVER overwrites or deletes ambiguous accounts; records reconciliation errors for manual review.
 * - Defaults to `dryRun: true` (read-only audit).
 */
export async function reconcileAdminUsersToSmav(options: {
  dryRun?: boolean;
  performedBy: string;
  userIds?: string[];
  deps?: SmavSyncDependencies;
}): Promise<ReconciliationReport> {
  const repo = options.deps?.repo || salonRepository;
  const dryRun = options.dryRun !== false;
  const nowIso = new Date(options.deps?.now ? options.deps.now() : Date.now()).toISOString();

  const allUsers = await repo.getUsers();
  const allStaff = await repo.getStaff().catch(() => [] as Staff[]);

  // Index local duplicates across public.users
  const emailCounts = new Map<string, number>();
  const centralIdCounts = new Map<string, number>();
  const usernameCounts = new Map<string, number>();

  for (const u of allUsers) {
    const email = String(u.email || '').trim().toLowerCase();
    if (email) emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
    const cid = String(u.central_auth_id || '').trim().toLowerCase();
    if (cid) centralIdCounts.set(cid, (centralIdCounts.get(cid) || 0) + 1);
    const uname = String(u.username || u.user_id || '').trim().toLowerCase();
    if (uname) usernameCounts.set(uname, (usernameCounts.get(uname) || 0) + 1);
  }

  const staffByUserId = new Map<string, Staff>();
  for (const s of allStaff) {
    if (s.user_id) staffByUserId.set(String(s.user_id), s);
  }

  const targetFilter = options.userIds && options.userIds.length > 0
    ? new Set(options.userIds.map(String))
    : null;

  const audits: ReconciliationUserAudit[] = [];
  const summary = {
    totalAdminUsers: 0,
    alreadySynced: 0,
    readyUpdateByUuid: 0,
    readyLinkOrCreate: 0,
    needsManualReview: 0,
    syncedNow: 0,
    pendingNow: 0,
    failedNow: 0,
    skippedAmbiguous: 0,
  };

  for (const user of allUsers) {
    if (targetFilter && !targetFilter.has(String(user.id))) continue;
    summary.totalAdminUsers++;

    const email = String(user.email || '').trim().toLowerCase();
    const cid = String(user.central_auth_id || '').trim().toLowerCase();
    const uname = String(user.username || user.user_id || '').trim().toLowerCase();
    const staff = staffByUserId.get(String(user.id)) || null;
    const mappedSmavRole = mapLocalRoleToSmavRole(user.role);
    const currentSyncStatus = deriveUserSyncStatus(user);

    const anomalies: string[] = [];
    let isAmbiguous = false;

    if (!email || !email.includes('@')) {
      anomalies.push('Missing or invalid email address on public.users');
      isAmbiguous = true;
    } else if ((emailCounts.get(email) || 0) > 1) {
      anomalies.push(`Duplicate email (${email}) found across multiple public.users rows`);
      isAmbiguous = true;
    }

    if (cid && (centralIdCounts.get(cid) || 0) > 1) {
      anomalies.push(`Duplicate central_auth_id (${user.central_auth_id}) shared across multiple public.users rows`);
      isAmbiguous = true;
    }

    if (uname && (usernameCounts.get(uname) || 0) > 1) {
      anomalies.push(`Duplicate username/user_id (${uname}) found across multiple public.users rows`);
    }

    if (staff) {
      const staffCid = String(staff.central_auth_id || '').trim().toLowerCase();
      const staffEmail = String(staff.email || '').trim().toLowerCase();
      if (cid && staffCid && cid !== staffCid) {
        anomalies.push(
          `Central Auth UUID mismatch between public.users (${user.central_auth_id}) and public.staff (${staff.central_auth_id})`
        );
        isAmbiguous = true;
      } else if (!cid && staffCid) {
        anomalies.push(
          `public.users.central_auth_id is NULL while public.staff has central_auth_id (${staff.central_auth_id}) — verify identity before linking`
        );
        isAmbiguous = true;
      }
      if (staffEmail && email && staffEmail !== email) {
        anomalies.push(
          `Email mismatch between public.users (${email}) and public.staff (${staffEmail})`
        );
      }
      if (typeof staff.is_active === 'boolean' && staff.is_active !== user.is_active) {
        anomalies.push(
          `Status drift between public.users (${user.is_active ? 'active' : 'inactive'}) and public.staff (${staff.is_active ? 'active' : 'inactive'})`
        );
      }
    }

    if (!user.central_auth_id) {
      anomalies.push('Missing central_auth_id on public.users');
    }

    let classification: ReconciliationClassification;
    let recommendedAction: string;

    if (isAmbiguous) {
      classification = 'NEEDS_MANUAL_REVIEW';
      recommendedAction = 'Do NOT overwrite or auto-create; resolve identity/UUID conflict manually first.';
      summary.needsManualReview++;
    } else if (user.central_auth_id && currentSyncStatus === 'SYNCED' && anomalies.length === 0) {
      classification = 'ALREADY_SYNCED';
      recommendedAction = 'Verified linked Central Auth UUID; optional re-sync will update role/status idempotently.';
      summary.alreadySynced++;
    } else if (user.central_auth_id) {
      classification = 'READY_UPDATE_BY_UUID';
      recommendedAction = `Update existing SMAV Central Auth UUID (${user.central_auth_id}) with authoritative role ${mappedSmavRole}.`;
      summary.readyUpdateByUuid++;
    } else {
      classification = 'READY_LINK_OR_CREATE';
      recommendedAction = `Resolve by externalStaffId (${user.id}) or exact email (${email}) in SMAV; fail closed on 409 conflict.`;
      summary.readyLinkOrCreate++;
    }

    const auditEntry: ReconciliationUserAudit = {
      localUserId: String(user.id),
      userCode: user.user_id,
      name: user.name,
      email: user.email,
      rbacRole: user.role,
      mappedSmavRole,
      isActive: Boolean(user.is_active),
      centralAuthId: user.central_auth_id || null,
      staffProfileId: staff?.id || null,
      staffJobTitle: staff?.role || null,
      staffEmail: staff?.email || null,
      staffCentralAuthId: staff?.central_auth_id || null,
      currentSyncStatus,
      classification,
      anomalies,
      recommendedAction,
    };

    if (!dryRun) {
      if (classification === 'NEEDS_MANUAL_REVIEW') {
        summary.skippedAmbiguous++;
        const reviewError = `Reconciliation paused (ambiguous identity): ${anomalies.join('; ')}`;
        await persistUserSyncState(repo, user, {
          syncStatus: 'FAILED',
          syncError: sanitizeSyncError(reviewError),
          isActive: user.is_active,
          syncOrigin: 'outlet_admin',
          performedBy: options.performedBy,
          nowIso,
        });
        auditEntry.syncResult = {
          synced: false,
          syncStatus: 'FAILED',
          outletCode: 'glossylooks',
          status: 'manual_review_required',
          conflict: true,
          centralAuthId: user.central_auth_id,
          error: sanitizeSyncError(reviewError),
        };
      } else {
        const action: SmavUserSyncAction = user.is_active
          ? (user.central_auth_id ? 'update_user' : 'upsert_user')
          : 'set_status';
        const syncRes = await enqueueAndProcessUserSync({
          user,
          eventType: 'RECONCILE_USER',
          action,
          performedBy: options.performedBy,
          deps: options.deps,
        });
        auditEntry.syncResult = syncRes;
        if (syncRes.syncStatus === 'SYNCED') summary.syncedNow++;
        else if (syncRes.syncStatus === 'PENDING') summary.pendingNow++;
        else summary.failedNow++;
      }
    }

    audits.push(auditEntry);
  }

  return {
    dryRun,
    generatedAt: nowIso,
    summary,
    users: audits,
  };
}

// ============================================================================
// Backward-compatible wrapper exports (now backed by durable outbox)
// ============================================================================

export async function syncSmavStaff(
  _outletCode: 'glossylooks' | 'mozz',
  staff: SyncStaff,
  options?: { idempotencyKey?: string; deps?: SmavSyncDependencies }
): Promise<SmavSyncResult> {
  if (!staff.sourceId || !staff.email?.includes('@')) {
    throw new Error('SMAV sync requires a staff source ID and valid email');
  }

  const adapter = options?.deps?.adapter || getGlossyLooksSmavAdapter();
  const normalizedEmail = staff.email.trim().toLowerCase();
  const normalizedUsername = (staff.username || '').trim().toLowerCase() || undefined;
  const smavRole = mapLocalRoleToSmavRole(staff.role);

  if (staff.password !== undefined) {
    if (staff.password.length < 8) {
      throw new Error('Central SMAV password must be at least 8 characters');
    }
    if (staff.centralAuthId) {
      const resetRes = await adapter.resetStaffPassword(
        {
          userId: staff.centralAuthId,
          externalStaffId: staff.sourceId,
          email: normalizedEmail,
          newPassword: staff.password,
        },
        options?.idempotencyKey
      );
      if (!resetRes.success) {
        throw new Error(resetRes.message || 'SMAV password reset not confirmed');
      }
      return {
        synced: true,
        syncStatus: 'SYNCED',
        outletCode: 'glossylooks',
        status: 'password_reset',
        centralAuthId: resetRes.userId || staff.centralAuthId,
        email: resetRes.email || normalizedEmail,
        mustChangePassword: resetRes.mustChangePassword,
      };
    }
  }

  const res = await adapter.syncStaffMember(
    {
      userId: staff.centralAuthId || undefined,
      externalStaffId: staff.sourceId,
      email: normalizedEmail,
      fullName: staff.name.trim(),
      username: normalizedUsername,
      phone: staff.phone?.trim() || '',
      role: smavRole,
      isActive: staff.active,
      ...(staff.password ? { initialPassword: staff.password } : {}),
    },
    options?.idempotencyKey
  );

  if (!res.success) {
    throw new Error(
      res.message ||
        'SMAV sync did not confirm success. No new central account was created; check the existing identity mapping.'
    );
  }

  return {
    synced: true,
    syncStatus: 'SYNCED',
    outletCode: 'glossylooks',
    status: res.isNewUser ? 'created' : 'synced',
    centralAuthId: res.userId || staff.centralAuthId,
    email: res.email || normalizedEmail,
    username: res.username || normalizedUsername,
    role: res.role || smavRole,
    isNewUser: res.isNewUser,
    mustChangePassword: res.mustChangePassword,
    conflict: res.conflict,
  };
}

export async function syncUserToSmavAndPersist(
  user: User,
  options?: {
    eventType?: SmavUserSyncEventType;
    initialPassword?: string;
    idempotencyKey?: string;
    performedBy?: string;
    deps?: SmavSyncDependencies;
  }
): Promise<SmavSyncResult> {
  return enqueueAndProcessUserSync({
    user,
    eventType: options?.eventType || (options?.initialPassword ? 'USER_CREATED' : 'USER_UPDATED'),
    action: user.central_auth_id ? 'update_user' : 'upsert_user',
    idempotencyKey: options?.idempotencyKey,
    transientInitialPassword: options?.initialPassword,
    performedBy: options?.performedBy,
    deps: options?.deps,
  });
}

export async function setSmavUserStatusAndPersist(
  user: User,
  isActive: boolean,
  options?: { idempotencyKey?: string; performedBy?: string; deps?: SmavSyncDependencies }
): Promise<SmavSyncResult> {
  // Deactivation revokes/blocks SMAV access promptly via set_status;
  // Reactivation pushes isActive: true WITH exact mapped RBAC role so only appropriate outlet permissions are restored.
  return enqueueAndProcessUserSync({
    user: { ...user, is_active: isActive },
    eventType: isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
    action: isActive ? (user.central_auth_id ? 'update_user' : 'upsert_user') : 'set_status',
    idempotencyKey: options?.idempotencyKey,
    performedBy: options?.performedBy,
    deps: options?.deps,
  });
}

/**
 * Strictly synchronous server-side SMAV password reset.
 * - NEVER enqueues a `PENDING` outbox job
 * - NEVER persists plaintext passwords or reset tokens anywhere (payload, error, logs, DB)
 * - Records a final sanitized `SYNCED` or `FAILED` audit row (`max_attempts = 1`) and updates `public.users`
 */
export async function resetSmavUserPasswordAndPersist(
  user: User,
  newPassword: string,
  options?: { idempotencyKey?: string; performedBy?: string; deps?: SmavSyncDependencies }
): Promise<SmavSyncResult> {
  const repo = options?.deps?.repo || salonRepository;
  const adapter = options?.deps?.adapter || getGlossyLooksSmavAdapter();
  const nowMs = options?.deps?.now ? options.deps.now() : Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const performedBy = options?.performedBy || 'Owner';

  const cleanEmail = String(user.email || '').trim().toLowerCase();
  const cleanPwd = String(newPassword || '').trim();
  const sensitiveValues = [cleanPwd];
  const idempotencyKey = generateSyncIdempotencyKey(user, 'PASSWORD_RESET', options?.idempotencyKey);
  const auditPayload = buildSanitizedSyncPayload(user, 'reset_password');
  // Non-secret canonical fingerprint (NEVER includes plaintext password)
  const requestFingerprint = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        op: 'password_reset',
        local_user_id: String(user.id),
        event_type: 'PASSWORD_RESET',
        action: 'reset_password',
        credentialSyncOnly: true,
      })
    )
    .digest('hex');

  // Pre-dispatch idempotency check: prevent duplicate reset calls or cross-user key reuse
  const existingAudit = await repo.getSmavUserSyncOutboxByIdempotencyKey(idempotencyKey);
  if (existingAudit) {
    if (
      String(existingAudit.local_user_id || '') !== String(user.id) ||
      existingAudit.action !== 'reset_password' ||
      existingAudit.event_type !== 'PASSWORD_RESET'
    ) {
      throw new IdempotencyKeyConflictError(
        `Idempotency key "${idempotencyKey}" was already used for another user or operation.`
      );
    }
    if (existingAudit.status === 'SYNCED') {
      return {
        synced: true,
        syncStatus: 'SYNCED',
        outletCode: 'glossylooks',
        status: 'idempotent_replay',
        outboxId: existingAudit.id,
        idempotencyKey,
        centralAuthId: existingAudit.response_central_auth_id || user.central_auth_id,
        email: cleanEmail,
      };
    }
    return {
      synced: false,
      syncStatus: 'FAILED',
      outletCode: 'glossylooks',
      status: existingAudit.conflict ? 'conflict' : 'failed',
      outboxId: existingAudit.id,
      idempotencyKey,
      centralAuthId: user.central_auth_id,
      conflict: Boolean(existingAudit.conflict),
      passwordResetRequired: true,
      error:
        existingAudit.last_error ||
        'Previous password reset with this idempotency key failed. Re-submit Reset Password with a fresh request.',
    };
  }

  const recordOutcome = async (outcome: {
    status: 'SYNCED' | 'FAILED';
    httpStatus?: number | null;
    error?: string | null;
    conflict?: boolean;
    centralAuthId?: string | null;
    markSyncedNow?: boolean;
  }): Promise<string> => {
    const safeError = outcome.error ? sanitizeSyncError(outcome.error, sensitiveValues) : null;
    const auditRow = await repo.recordSmavSyncAuditEvent({
      idempotency_key: idempotencyKey,
      local_user_id: String(user.id),
      event_type: 'PASSWORD_RESET',
      action: 'reset_password',
      payload: auditPayload,
      status: outcome.status,
      last_http_status: outcome.httpStatus ?? null,
      last_error: safeError,
      conflict: Boolean(outcome.conflict),
      response_central_auth_id: outcome.centralAuthId || user.central_auth_id || null,
      performed_by: performedBy,
      request_fingerprint: requestFingerprint,
    });
    await persistUserSyncState(repo, user, {
      syncStatus: outcome.status,
      syncError: safeError,
      outboxId: auditRow.id,
      centralAuthId: outcome.centralAuthId || undefined,
      isActive: user.is_active,
      syncOrigin: 'outlet_admin',
      performedBy,
      nowIso,
      markSyncedNow: outcome.markSyncedNow,
    });
    return auditRow.id;
  };

  if (!user.id || !cleanEmail || !cleanEmail.includes('@')) {
    const msg = 'Valid local user ID and email address are required before resetting SMAV password.';
    const outboxId = await recordOutcome({ status: 'FAILED', error: msg });
    return {
      synced: false,
      syncStatus: 'FAILED',
      outletCode: 'glossylooks',
      status: 'failed',
      outboxId,
      idempotencyKey,
      centralAuthId: user.central_auth_id,
      passwordResetRequired: true,
      error: msg,
    };
  }

  if (cleanPwd.length < 8) {
    const msg = cleanPwd.length === 0
      ? 'A new password is required to run synchronous SMAV password reset.'
      : 'SMAV Central Auth requires passwords of at least 8 characters.';
    const outboxId = await recordOutcome({ status: 'FAILED', error: msg });
    return {
      synced: false,
      syncStatus: 'FAILED',
      outletCode: 'glossylooks',
      status: 'failed',
      outboxId,
      idempotencyKey,
      centralAuthId: user.central_auth_id,
      passwordResetRequired: true,
      error: msg,
    };
  }

  let res: SmavSyncAdapterResponse;
  try {
    res = await adapter.resetStaffPassword(
      {
        userId: user.central_auth_id || undefined,
        externalStaffId: String(user.id),
        email: cleanEmail,
        newPassword: cleanPwd,
      },
      idempotencyKey
    );
  } catch (err: any) {
    res = {
      success: false,
      retryable: false,
      message: sanitizeSyncError(err, sensitiveValues),
    };
  }

  // Fail closed on UUID mismatch: NEVER overwrite an existing central_auth_id!
  if (
    res.success &&
    user.central_auth_id &&
    res.userId &&
    user.central_auth_id.toLowerCase() !== res.userId.toLowerCase()
  ) {
    const conflictMsg = `Identity conflict: SMAV returned Central Auth UUID ${res.userId} which does not match linked UUID ${user.central_auth_id}. Password reset was not linked; manual reconciliation required.`;
    const outboxId = await recordOutcome({
      status: 'FAILED',
      httpStatus: res.status || 409,
      error: conflictMsg,
      conflict: true,
    });
    return {
      synced: false,
      syncStatus: 'FAILED',
      outletCode: 'glossylooks',
      status: 'conflict',
      outboxId,
      idempotencyKey,
      centralAuthId: user.central_auth_id,
      conflict: true,
      passwordResetRequired: true,
      error: conflictMsg,
    };
  }

  if (res.success) {
    const resolvedCentralAuthId = user.central_auth_id || res.userId;
    const outboxId = await recordOutcome({
      status: 'SYNCED',
      httpStatus: res.status || 200,
      centralAuthId: resolvedCentralAuthId || null,
      markSyncedNow: true,
    });
    return {
      synced: true,
      syncStatus: 'SYNCED',
      outletCode: 'glossylooks',
      status: 'password_reset',
      outboxId,
      idempotencyKey,
      centralAuthId: resolvedCentralAuthId,
      email: res.email || cleanEmail,
      mustChangePassword: res.mustChangePassword,
    };
  }

  const isConflict = Boolean(res.conflict) || res.status === 409;
  const safeUpstream = sanitizeSyncError(res.message, sensitiveValues);
  const failureMsg = `Local password updated, but SMAV password sync failed (${safeUpstream}). Re-submit Reset Password to sync credentials securely.`;
  const sanitizedFailureMsg = sanitizeSyncError(failureMsg, sensitiveValues);
  const outboxId = await recordOutcome({
    status: 'FAILED',
    httpStatus: res.status || null,
    error: sanitizedFailureMsg,
    conflict: isConflict,
  });

  return {
    synced: false,
    syncStatus: 'FAILED',
    outletCode: 'glossylooks',
    status: isConflict ? 'conflict' : 'failed',
    outboxId,
    idempotencyKey,
    centralAuthId: user.central_auth_id,
    conflict: isConflict,
    passwordResetRequired: true,
    error: sanitizedFailureMsg,
  };
}

// ============================================================================
// Incoming SMAV -> Glossy Looks Bidirectional Webhook (Loop-Safe & Idempotent)
// ============================================================================

const inFlightSmavWebhooks = new Set<string>();

export async function handleIncomingSmavWebhook(params: {
  headers: Record<string, string | string[] | undefined>;
  body: any;
  hashPassword: (password: string) => string;
  deps?: SmavSyncDependencies;
}): Promise<{
  status: number;
  body: Record<string, any>;
}> {
  const { headers, body, hashPassword, deps } = params;
  const repo = deps?.repo || salonRepository;
  const adapter = deps?.adapter || getGlossyLooksSmavAdapter();

  const verification = adapter.verifyIncomingSmavWebhook(headers, body);
  if (!verification.authorized) {
    const isUnconfigured = !process.env.GLOSSYLOOKS_INTEGRATION_KEY && !deps?.adapter;
    return {
      status: isUnconfigured ? 503 : 401,
      body: {
        success: false,
        message: verification.skipReason || 'Unauthorized SMAV webhook request',
      },
    };
  }

  if (!verification.shouldApply) {
    return {
      status: 200,
      body: {
        success: true,
        skipped: true,
        reason: verification.skipReason,
      },
    };
  }

  const rawIdemHeader = headers['x-idempotency-key'] || headers['X-Idempotency-Key'];
  const idempotencyKey = String(
    (Array.isArray(rawIdemHeader) ? rawIdemHeader[0] : rawIdemHeader) ||
      body?.idempotencyKey ||
      body?.idempotency_key ||
      body?.eventId ||
      body?.event_id ||
      ''
  ).trim();

  const eventRecordId = idempotencyKey ? `smav:${idempotencyKey}` : '';
  if (eventRecordId) {
    if (inFlightSmavWebhooks.has(eventRecordId)) {
      return {
        status: 200,
        body: {
          success: true,
          duplicate: true,
          skipped: true,
          reason: 'Idempotent replay: event currently processing',
        },
      };
    }
    const alreadyProcessed = await repo.isWebhookEventProcessed(eventRecordId);
    if (alreadyProcessed) {
      return {
        status: 200,
        body: {
          success: true,
          duplicate: true,
          skipped: true,
          reason: 'Idempotent replay: event already processed',
        },
      };
    }
    inFlightSmavWebhooks.add(eventRecordId);
  }

  try {
    const src =
      (body?.user && typeof body.user === 'object'
        ? body.user
        : body?.staff && typeof body.staff === 'object'
          ? body.staff
          : body?.data && typeof body.data === 'object'
            ? body.data
            : body) || {};

    const rawAction = String(body?.action || body?.event || body?.eventType || 'upsert_user')
      .trim()
      .toLowerCase()
      .replace(/[-.]/g, '_');

    const centralAuthId =
      String(
        src.userId ||
          src.centralAuthId ||
          src.central_auth_id ||
          body?.userId ||
          body?.centralAuthId ||
          body?.central_auth_id ||
          ''
      ).trim() || undefined;

    const externalStaffId =
      String(
        src.externalStaffId ||
          src.external_staff_id ||
          src.externalId ||
          src.localStaffId ||
          body?.externalStaffId ||
          body?.external_staff_id ||
          ''
      ).trim() || undefined;

    const email = String(src.email || body?.email || '').trim().toLowerCase() || undefined;
    const fullName =
      String(src.fullName || src.full_name || src.name || body?.fullName || body?.name || '').trim() || undefined;
    const username = String(src.username || body?.username || '').trim().toLowerCase() || undefined;
    const phone =
      src.phone !== undefined
        ? String(src.phone).trim()
        : body?.phone !== undefined
          ? String(body.phone).trim()
          : undefined;
    const rawRole = src.role ?? body?.role;

    const rawIsActive =
      src.isActive !== undefined
        ? src.isActive
        : src.is_active !== undefined
          ? src.is_active
          : body?.isActive !== undefined
            ? body.isActive
            : body?.is_active;
    const isActive = rawIsActive !== undefined ? Boolean(rawIsActive) : undefined;

    const syncVersionRaw =
      src.syncVersion ??
      src.central_sync_version ??
      body?.syncVersion ??
      body?.central_sync_version ??
      body?.version;
    const syncVersion = Number.isFinite(Number(syncVersionRaw)) ? Number(syncVersionRaw) : undefined;

    const transientNewPassword =
      typeof (src.newPassword || body?.newPassword) === 'string'
        ? String(src.newPassword || body?.newPassword).trim()
        : undefined;

    // Deterministic identity matching (UUID -> externalStaffId -> exact email), fail closed on ambiguity
    const users = await repo.getUsers();
    const byCentralId = centralAuthId
      ? users.filter((u) => u.central_auth_id && u.central_auth_id.toLowerCase() === centralAuthId.toLowerCase())
      : [];
    const byExternalId = externalStaffId
      ? users.filter(
          (u) =>
            String(u.id) === externalStaffId ||
            (u.user_id && u.user_id.toLowerCase() === externalStaffId.toLowerCase())
        )
      : [];
    const byEmail = email
      ? users.filter((u) => u.email && u.email.trim().toLowerCase() === email)
      : [];

    const matchedMap = new Map<string, User>();
    for (const u of [...byCentralId, ...byExternalId, ...byEmail]) {
      matchedMap.set(String(u.id), u);
    }

    if (matchedMap.size > 1) {
      return {
        status: 409,
        body: {
          success: false,
          conflict: true,
          message: 'Ambiguous identity match across central_auth_id, externalStaffId, and email.',
        },
      };
    }

    const existingUser = Array.from(matchedMap.values())[0];

    if (
      existingUser &&
      centralAuthId &&
      existingUser.central_auth_id &&
      existingUser.central_auth_id.toLowerCase() !== centralAuthId.toLowerCase()
    ) {
      return {
        status: 409,
        body: {
          success: false,
          conflict: true,
          message: `Central Auth UUID mismatch for staff ${existingUser.id}. Preserved existing UUID ${existingUser.central_auth_id}.`,
        },
      };
    }

    if (existingUser && email) {
      const emailOwner = users.find(
        (u) => String(u.id) !== String(existingUser.id) && u.email && u.email.trim().toLowerCase() === email
      );
      if (emailOwner) {
        return {
          status: 409,
          body: {
            success: false,
            conflict: true,
            message: `Email ${email} already belongs to another local staff user (${emailOwner.id}).`,
          },
        };
      }
    }

    if (
      existingUser &&
      syncVersion !== undefined &&
      typeof existingUser.central_sync_version === 'number' &&
      syncVersion < existingUser.central_sync_version
    ) {
      if (eventRecordId) {
        await repo.recordProcessedWebhookEvent(eventRecordId, `smav_${rawAction}_stale`);
      }
      return {
        status: 200,
        body: {
          success: true,
          skipped: true,
          reason: `Stale syncVersion ${syncVersion} < local ${existingUser.central_sync_version}`,
          externalStaffId: existingUser.id,
          userId: existingUser.central_auth_id || centralAuthId,
        },
      };
    }

    const now = new Date(deps?.now ? deps.now() : Date.now()).toISOString();
    const nextSyncVersion =
      syncVersion !== undefined
        ? syncVersion
        : (existingUser && typeof existingUser.central_sync_version === 'number'
            ? existingUser.central_sync_version
            : 0) + 1;

    const isPasswordResetAction =
      rawAction === 'reset_password' || rawAction === 'password_reset' || rawAction === 'user_password_reset';
    const isStatusAction =
      rawAction === 'set_status' ||
      rawAction === 'disable_user' ||
      rawAction === 'enable_user' ||
      rawAction === 'deactivate' ||
      rawAction === 'user_disabled' ||
      rawAction === 'user_enabled';

    if (isPasswordResetAction) {
      if (!existingUser) {
        return {
          status: 404,
          body: { success: false, message: 'Staff user not found for password reset sync.' },
        };
      }

      if (transientNewPassword && transientNewPassword.length >= 8) {
        await repo.resetUserPassword(
          existingUser.id,
          hashPassword(transientNewPassword),
          'SMAV Central Portal'
        );
      }

      const updated = await repo.updateUser(
        existingUser.id,
        {
          central_outlet_code: 'glossylooks',
          central_sync_version: nextSyncVersion,
          central_last_synced_at: now,
          central_sync_origin: 'smav_portal',
          central_sync_status: 'SYNCED',
          central_sync_error: null,
        },
        'SMAV Central Portal'
      );

      await repo.logAudit(
        'SMAV_WEBHOOK_PASSWORD_RESET',
        'User',
        existingUser.id,
        'SMAV Central Portal',
        `Synchronized Central Auth password reset notification for ${existingUser.email}`
      );

      if (eventRecordId) {
        await repo.recordProcessedWebhookEvent(eventRecordId, `smav_${rawAction}`);
      }

      const finalUser = updated || existingUser;
      return {
        status: 200,
        body: {
          success: true,
          action: 'reset_password',
          externalStaffId: finalUser.id,
          userId: finalUser.central_auth_id || centralAuthId,
          email: finalUser.email,
          username: finalUser.username || finalUser.user_id,
        },
      };
    }

    if (isStatusAction) {
      if (!existingUser) {
        return {
          status: 404,
          body: { success: false, message: 'Staff user not found for status sync.' },
        };
      }

      const nextActive =
        rawAction === 'disable_user' || rawAction === 'deactivate' || rawAction === 'user_disabled'
          ? false
          : rawAction === 'enable_user' || rawAction === 'user_enabled'
            ? true
            : isActive !== undefined
              ? isActive
              : existingUser.is_active;

      const updated = await repo.updateUser(
        existingUser.id,
        {
          is_active: nextActive,
          central_auth_status: nextActive ? 'ACTIVE' : 'DISABLED',
          central_outlet_code: 'glossylooks',
          central_sync_version: nextSyncVersion,
          central_last_synced_at: now,
          central_sync_origin: 'smav_portal',
          central_sync_status: 'SYNCED',
          central_sync_error: null,
        },
        'SMAV Central Portal'
      );

      if (eventRecordId) {
        await repo.recordProcessedWebhookEvent(eventRecordId, `smav_${rawAction}`);
      }

      const finalUser = updated || existingUser;
      return {
        status: 200,
        body: {
          success: true,
          action: 'set_status',
          externalStaffId: finalUser.id,
          userId: finalUser.central_auth_id || centralAuthId,
          email: finalUser.email,
          isActive: finalUser.is_active,
        },
      };
    }

    if (existingUser) {
      const nextActive = isActive !== undefined ? isActive : existingUser.is_active;
      const nextRole = rawRole !== undefined ? mapSmavRoleToLocalRole(rawRole, existingUser.role) : existingUser.role;

      const updated = await repo.updateUser(
        existingUser.id,
        {
          ...(fullName ? { name: fullName } : {}),
          ...(email ? { email } : {}),
          ...(phone !== undefined ? { phone } : {}),
          ...(username ? { username } : {}),
          ...(rawRole !== undefined ? { role: nextRole } : {}),
          ...(isActive !== undefined ? { is_active: nextActive } : {}),
          central_auth_status: nextActive ? 'ACTIVE' : 'DISABLED',
          central_outlet_code: 'glossylooks',
          central_sync_version: nextSyncVersion,
          central_last_synced_at: now,
          central_sync_origin: 'smav_portal',
          central_sync_status: 'SYNCED',
          central_sync_error: null,
        },
        'SMAV Central Portal'
      );

      if (eventRecordId) {
        await repo.recordProcessedWebhookEvent(eventRecordId, `smav_${rawAction}`);
      }

      const finalUser = updated || existingUser;
      return {
        status: 200,
        body: {
          success: true,
          action: 'update_user',
          externalStaffId: finalUser.id,
          userId: finalUser.central_auth_id || centralAuthId,
          email: finalUser.email,
          username: finalUser.username || finalUser.user_id,
          role: finalUser.role,
          isActive: finalUser.is_active,
        },
      };
    }

    if (rawAction === 'update_user' || rawAction === 'user_updated') {
      return {
        status: 404,
        body: {
          success: false,
          message: 'Staff user not found locally for update_user event.',
        },
      };
    }

    if (!email || !fullName) {
      return {
        status: 400,
        body: {
          success: false,
          message: 'email and fullName are required to provision a new staff user from SMAV.',
        },
      };
    }

    const mappedRole = mapSmavRoleToLocalRole(rawRole);
    const nextActive = isActive !== undefined ? isActive : true;
    const generatedUserId = generateLocalUserCode(mappedRole, username);

    const payloadBranchId = String(body.branchId || body.branch_id || '').trim() || undefined;
    const createdUser = await repo.createUser(
      {
        user_id: generatedUserId,
        email,
        name: fullName,
        phone: phone || '',
        role: mappedRole,
        branch_id: payloadBranchId,
        password_hash: hashPassword(transientNewPassword || crypto.randomBytes(24).toString('base64url')),
        is_active: nextActive,
        username: username || generatedUserId.toLowerCase(),
        central_auth_status: nextActive ? 'ACTIVE' : 'DISABLED',
        central_outlet_code: 'glossylooks',
        central_sync_version: nextSyncVersion,
        central_last_synced_at: now,
        central_sync_origin: 'smav_portal',
        central_sync_status: 'SYNCED',
        central_sync_error: null,
      },
      'SMAV Central Portal'
    );

    if (eventRecordId) {
      await repo.recordProcessedWebhookEvent(eventRecordId, `smav_${rawAction}`);
    }

    return {
      status: 201,
      body: {
        success: true,
        action: 'create_user',
        isNewUser: true,
        externalStaffId: createdUser.id,
        userId: createdUser.central_auth_id || centralAuthId,
        email: createdUser.email,
        username: createdUser.username || createdUser.user_id,
        role: createdUser.role,
        isActive: createdUser.is_active,
      },
    };
  } finally {
    if (eventRecordId) {
      inFlightSmavWebhooks.delete(eventRecordId);
    }
  }
}
