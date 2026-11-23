/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Persistent Admin Session management and restoration helpers.
 * Keeps authenticated admin sessions active across browser refresh, normal
 * navigation, and temporary API/network failures. Clears session ONLY on
 * explicit Sign Out, confirmed invalid/expired/revoked auth, or disabled account.
 */

import type { AdminUser } from '../types/salon';

export const ADMIN_SESSION_STORAGE_KEY = 'the_glossy_looks_admin_session';

export interface AdminBranchPermission {
  id: string;
  name: string;
  code?: string;
}

export interface AdminBranchPermissions {
  all_branches: boolean;
  assigned_branch_id?: string | null;
  branches: AdminBranchPermission[];
}

export interface PersistedAdminSession {
  token: string;
  user: AdminUser;
  branch_permissions?: AdminBranchPermissions | null;
  expires_at?: string | null;
  updated_at?: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AdminMeResponse extends AdminUser {
  is_active?: boolean;
  token?: string;
  expires_at?: string;
  branch_permissions?: AdminBranchPermissions;
}

export interface SessionRestoreResult {
  status: 'authenticated' | 'offline_retry' | 'unauthenticated';
  user: AdminUser | null;
  branchPermissions: AdminBranchPermissions | null;
  offline: boolean;
  warning: string | null;
  signOutReason?: string | null;
}

const HARD_AUTH_ERROR_CODES = new Set([
  'SESSION_EXPIRED',
  'SESSION_INVALID',
  'SESSION_REVOKED',
  'ACCOUNT_DISABLED',
  'ACCOUNT_UNAUTHORIZED',
]);

function getDefaultStorages(): { local: StorageLike | null; session: StorageLike | null } {
  if (typeof window === 'undefined') {
    return { local: null, session: null };
  }
  return {
    local: window.localStorage ?? null,
    session: window.sessionStorage ?? null,
  };
}

function parseSessionRaw(raw: string | null): PersistedAdminSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.user || !parsed.user.id) {
      return null;
    }
    return {
      token: typeof parsed.token === 'string' ? parsed.token.trim() : '',
      user: parsed.user as AdminUser,
      branch_permissions: parsed.branch_permissions ?? null,
      expires_at: typeof parsed.expires_at === 'string' ? parsed.expires_at : null,
      updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : undefined,
    };
  } catch {
    return null;
  }
}

export function isSessionLocallyExpired(session: PersistedAdminSession | null, nowMs = Date.now()): boolean {
  if (!session?.expires_at) return false;
  const expMs = Date.parse(session.expires_at);
  return Number.isFinite(expMs) && expMs <= nowMs;
}

/**
 * Reads the persisted admin session, preferring a copy with a valid token so
 * a stale/tokenless sessionStorage copy never shadows a valid localStorage copy.
 */
export function readPersistedAdminSession(storages?: {
  local?: StorageLike | null;
  session?: StorageLike | null;
}): PersistedAdminSession | null {
  const { local, session } = storages || getDefaultStorages();
  let localParsed: PersistedAdminSession | null = null;
  let sessionParsed: PersistedAdminSession | null = null;

  try {
    localParsed = parseSessionRaw(local?.getItem(ADMIN_SESSION_STORAGE_KEY) ?? null);
  } catch {
    localParsed = null;
  }
  try {
    sessionParsed = parseSessionRaw(session?.getItem(ADMIN_SESSION_STORAGE_KEY) ?? null);
  } catch {
    sessionParsed = null;
  }

  if (localParsed?.token && sessionParsed?.token) {
    const localTime = Date.parse(localParsed.updated_at || '') || 0;
    const sessionTime = Date.parse(sessionParsed.updated_at || '') || 0;
    return localTime >= sessionTime ? localParsed : sessionParsed;
  }
  if (localParsed?.token) return localParsed;
  if (sessionParsed?.token) return sessionParsed;
  return localParsed || sessionParsed || null;
}

/**
 * Persists the admin session atomically to both localStorage and sessionStorage,
 * ensuring token, user, role, branch_permissions, and expiry are always preserved.
 */
export function savePersistedAdminSession(
  input: {
    token?: string | null;
    user: AdminUser;
    branch_permissions?: AdminBranchPermissions | null;
    expires_at?: string | null;
  },
  storages?: { local?: StorageLike | null; session?: StorageLike | null }
): PersistedAdminSession {
  const { local, session } = storages || getDefaultStorages();
  const existing = readPersistedAdminSession({ local, session });

  const next: PersistedAdminSession = {
    token: (typeof input.token === 'string' && input.token.trim())
      ? input.token.trim()
      : (existing?.token || ''),
    user: {
      ...(existing?.user || {}),
      ...input.user,
    },
    branch_permissions:
      input.branch_permissions !== undefined
        ? input.branch_permissions
        : (existing?.branch_permissions ?? null),
    expires_at:
      input.expires_at !== undefined
        ? input.expires_at
        : (existing?.expires_at ?? null),
    updated_at: new Date().toISOString(),
  };

  const serialized = JSON.stringify(next);
  try {
    local?.setItem(ADMIN_SESSION_STORAGE_KEY, serialized);
  } catch {
    // Ignore storage quota / private mode failures
  }
  try {
    session?.setItem(ADMIN_SESSION_STORAGE_KEY, serialized);
  } catch {
    // Ignore storage quota / private mode failures
  }
  return next;
}

/**
 * Safely updates only the cached user profile / branch permissions without ever
 * dropping the existing auth token.
 */
export function updatePersistedAdminUser(
  updatedUser: AdminUser,
  extra?: {
    token?: string | null;
    branch_permissions?: AdminBranchPermissions | null;
    expires_at?: string | null;
  },
  storages?: { local?: StorageLike | null; session?: StorageLike | null }
): PersistedAdminSession {
  return savePersistedAdminSession(
    {
      token: extra?.token,
      user: updatedUser,
      branch_permissions: extra?.branch_permissions,
      expires_at: extra?.expires_at,
    },
    storages
  );
}

export function clearPersistedAdminSession(storages?: {
  local?: StorageLike | null;
  session?: StorageLike | null;
}): void {
  const { local, session } = storages || getDefaultStorages();
  try {
    local?.removeItem(ADMIN_SESSION_STORAGE_KEY);
  } catch {}
  try {
    session?.removeItem(ADMIN_SESSION_STORAGE_KEY);
  } catch {}
}

/**
 * Determines whether an error returned specifically by the auth verification
 * endpoint (/api/auth/admin/me) is a CONFIRMED session invalidation / disabled
 * account (sign out) versus a temporary server/network failure (keep session).
 */
export function isConfirmedAuthInvalidationError(err: any): {
  confirmed: boolean;
  reason: string | null;
} {
  if (!err || typeof err !== 'object') {
    return { confirmed: false, reason: null };
  }

  const status = Number(err.status || 0);
  const code = String(err.code || '').trim().toUpperCase();

  if (code === 'AUTH_BACKEND_UNAVAILABLE') {
    return { confirmed: false, reason: null };
  }

  if (HARD_AUTH_ERROR_CODES.has(code)) {
    if (code === 'ACCOUNT_DISABLED') {
      return {
        confirmed: true,
        reason: err.message || 'Your staff account has been deactivated. Please contact the Salon Owner.',
      };
    }
    if (code === 'SESSION_REVOKED') {
      return {
        confirmed: true,
        reason: 'Your session was signed out. Please sign in again.',
      };
    }
    if (code === 'SESSION_EXPIRED') {
      return {
        confirmed: true,
        reason: 'Your session has expired. Please sign in again.',
      };
    }
    return {
      confirmed: true,
      reason: err.message || 'Your session is no longer valid. Please sign in again.',
    };
  }

  // Confirmed 401/403 from the dedicated session verification endpoint without transient code
  if (status === 401 || status === 403) {
    return {
      confirmed: true,
      reason: err.message || (status === 403 ? 'Access denied for this account.' : 'Session expired or invalid. Please sign in again.'),
    };
  }

  // Network errors, timeouts, 500/502/503/504 are ALWAYS treated as temporary!
  return { confirmed: false, reason: null };
}

/**
 * Restores and verifies the admin session after browser refresh, navigation, or
 * temporary connection loss.
 * - Valid server confirmation -> refreshes sliding token & user/branch permissions
 * - Confirmed invalid/expired/revoked/disabled -> clears storage & signs out
 * - Temporary offline/network/5xx failure -> keeps valid persisted session active
 *   with an offline/retry warning (never logs user out!)
 */
export async function restoreAdminSession(params: {
  fetchMe: () => Promise<AdminMeResponse>;
  storages?: { local?: StorageLike | null; session?: StorageLike | null };
  nowMs?: number;
}): Promise<SessionRestoreResult> {
  const { fetchMe, storages, nowMs = Date.now() } = params;
  const persisted = readPersistedAdminSession(storages);

  try {
    const me = await fetchMe();
    if (!me || !me.id) {
      throw Object.assign(new Error('Invalid session profile'), {
        status: 401,
        code: 'SESSION_INVALID',
      });
    }

    const {
      token: refreshedToken,
      expires_at: refreshedExpiresAt,
      branch_permissions: refreshedBranchPerms,
      ...userFields
    } = me;

    const saved = savePersistedAdminSession(
      {
        token: refreshedToken || persisted?.token || '',
        user: userFields as AdminUser,
        branch_permissions: refreshedBranchPerms ?? persisted?.branch_permissions ?? null,
        expires_at: refreshedExpiresAt ?? persisted?.expires_at ?? null,
      },
      storages
    );

    return {
      status: 'authenticated',
      user: saved.user,
      branchPermissions: saved.branch_permissions ?? null,
      offline: false,
      warning: null,
    };
  } catch (err: any) {
    const check = isConfirmedAuthInvalidationError(err);
    if (check.confirmed) {
      clearPersistedAdminSession(storages);
      return {
        status: 'unauthenticated',
        user: null,
        branchPermissions: null,
        offline: false,
        warning: null,
        signOutReason: check.reason,
      };
    }

    // Temporary connection / server outage: preserve valid persisted session!
    if (persisted && persisted.user && persisted.token && !isSessionLocallyExpired(persisted, nowMs)) {
      return {
        status: 'authenticated',
        user: persisted.user,
        branchPermissions: persisted.branch_permissions ?? null,
        offline: true,
        warning: 'Server connection temporarily unavailable. Your session remains active — retry when reconnected.',
      };
    }

    // No locally persisted session to fall back to, and server is unreachable right now:
    // show retryable offline state (never blank page).
    return {
      status: 'offline_retry',
      user: null,
      branchPermissions: null,
      offline: true,
      warning: err?.message || 'Unable to reach the server to verify your session. Check your connection and retry.',
    };
  }
}
