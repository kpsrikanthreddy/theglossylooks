/**
 * Server-only Glossy Looks <-> SMAV bidirectional identity gateway.
 * Integrates GlossyLooksSmavAuthAdapter / SmavOutletUserAdapter with salonRepository.
 * No SMAV service_role key or plaintext password persistence is used here.
 */

import crypto from 'crypto';
import { salonRepository } from './db.ts';
import { GlossyLooksSmavAuthAdapter } from './smav/glossylooks_smav_auth_adapter.ts';
import type { AdminRole, User } from '../types/salon.ts';

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
  outletCode: 'glossylooks';
  status: string;
  centralAuthId?: string;
  email?: string;
  username?: string;
  role?: string;
  isNewUser?: boolean;
  mustChangePassword?: boolean;
  conflict?: boolean;
  error?: string;
};

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
  });
}

function mapLocalRoleToSmavRole(role?: string): string {
  const clean = String(role || 'stylist').trim().toLowerCase();
  if (clean === 'owner') return 'OWNER';
  if (clean === 'manager') return 'MANAGER';
  if (clean === 'receptionist') return 'RECEPTIONIST';
  if (clean === 'inventory_staff') return 'STAFF';
  if (clean === 'stylist') return 'STYLIST';
  if (clean === 'admin') return 'ADMIN';
  return clean.toUpperCase() || 'STAFF';
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
    // Preserve fine-grained staff sub-role when Central SMAV sends generic 'STAFF'
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
    owner: 'OWN',
    manager: 'MGR',
    receptionist: 'REC',
    stylist: 'STY',
    inventory_staff: 'INV',
  };
  const prefix = rolePrefix[role] || 'STF';
  return `TGL-${prefix}${Math.floor(100 + Math.random() * 900)}`;
}

async function persistCentralMetadata(
  user: User,
  params: {
    centralAuthId?: string;
    isActive: boolean;
    syncOrigin: 'outlet_admin' | 'smav_portal';
    username?: string;
    syncVersion?: number;
    performedBy?: string;
  }
): Promise<User | null> {
  const now = new Date().toISOString();
  const nextCentralAuthId = user.central_auth_id || params.centralAuthId;

  // Never overwrite an already-linked Central Auth UUID with a different UUID
  if (
    user.central_auth_id &&
    params.centralAuthId &&
    user.central_auth_id.toLowerCase() !== params.centralAuthId.toLowerCase()
  ) {
    console.warn(
      `[SMAV Sync] Preserved existing central_auth_id ${user.central_auth_id} for user ${user.id}; ignored mismatched ${params.centralAuthId}`
    );
  }

  const updatePayload: Partial<User> = {
    ...(nextCentralAuthId ? { central_auth_id: nextCentralAuthId } : {}),
    ...(nextCentralAuthId && !user.central_auth_linked_at ? { central_auth_linked_at: now } : {}),
    ...(params.username && !user.username ? { username: params.username } : {}),
    central_auth_status: params.isActive ? 'ACTIVE' : 'DISABLED',
    central_outlet_code: 'glossylooks',
    central_sync_version:
      typeof params.syncVersion === 'number'
        ? params.syncVersion
        : (typeof user.central_sync_version === 'number' ? user.central_sync_version : 0) + 1,
    central_last_synced_at: now,
    central_sync_origin: params.syncOrigin,
  };

  return salonRepository.updateUser(user.id, updatePayload, params.performedBy || 'SMAV Sync');
}

export async function syncSmavStaff(
  _outletCode: 'glossylooks' | 'mozz',
  staff: SyncStaff,
  options?: { idempotencyKey?: string }
): Promise<SmavSyncResult> {
  if (!staff.sourceId || !staff.email?.includes('@')) {
    throw new Error('SMAV sync requires a staff source ID and valid email');
  }

  const adapter = getGlossyLooksSmavAdapter();
  const normalizedEmail = staff.email.trim().toLowerCase();
  const normalizedUsername = (staff.username || '').trim().toLowerCase() || undefined;

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
      role: mapLocalRoleToSmavRole(staff.role),
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
    outletCode: 'glossylooks',
    status: res.isNewUser ? 'created' : 'synced',
    centralAuthId: res.userId || staff.centralAuthId,
    email: res.email || normalizedEmail,
    username: res.username || normalizedUsername,
    role: res.role,
    isNewUser: res.isNewUser,
    mustChangePassword: res.mustChangePassword,
    conflict: res.conflict,
  };
}

export async function syncUserToSmavAndPersist(
  user: User,
  options?: { initialPassword?: string; idempotencyKey?: string; performedBy?: string }
): Promise<SmavSyncResult> {
  try {
    if (!user.id || !user.email?.includes('@')) {
      return {
        synced: false,
        outletCode: 'glossylooks',
        status: 'skipped',
        error: 'Valid staff ID and email are required for SMAV sync.',
      };
    }

    if (options?.initialPassword && options.initialPassword.length < 8) {
      return {
        synced: false,
        outletCode: 'glossylooks',
        status: 'skipped',
        error: 'Central SMAV initial password must be at least 8 characters.',
      };
    }

    const adapter = getGlossyLooksSmavAdapter();
    const res = await adapter.syncStaffMember(
      {
        userId: user.central_auth_id || undefined,
        externalStaffId: String(user.id),
        email: user.email.trim().toLowerCase(),
        fullName: user.name.trim(),
        username: (user.username || user.user_id || '').trim().toLowerCase() || undefined,
        phone: user.phone?.trim() || '',
        role: mapLocalRoleToSmavRole(user.role),
        isActive: user.is_active,
        ...(options?.initialPassword ? { initialPassword: options.initialPassword } : {}),
      },
      options?.idempotencyKey
    );

    if (!res.success) {
      return {
        synced: false,
        outletCode: 'glossylooks',
        status: res.conflict ? 'conflict' : 'failed',
        centralAuthId: user.central_auth_id,
        conflict: res.conflict,
        error: res.message,
      };
    }

    await persistCentralMetadata(user, {
      centralAuthId: res.userId,
      isActive: user.is_active,
      syncOrigin: 'outlet_admin',
      username: res.username || user.username || (user.user_id ? user.user_id.toLowerCase() : undefined),
      performedBy: options?.performedBy,
    }).catch((err) => {
      console.warn('[SMAV Sync] Failed to persist central auth metadata locally:', err?.message);
    });

    return {
      synced: true,
      outletCode: 'glossylooks',
      status: res.isNewUser ? 'created' : 'synced',
      centralAuthId: user.central_auth_id || res.userId,
      email: res.email || user.email,
      username: res.username || user.username || user.user_id,
      role: res.role,
      isNewUser: res.isNewUser,
      mustChangePassword: res.mustChangePassword,
    };
  } catch (err: any) {
    return {
      synced: false,
      outletCode: 'glossylooks',
      status: 'failed',
      centralAuthId: user.central_auth_id,
      error: err?.message || 'SMAV sync failed',
    };
  }
}

export async function setSmavUserStatusAndPersist(
  user: User,
  isActive: boolean,
  options?: { idempotencyKey?: string; performedBy?: string }
): Promise<SmavSyncResult> {
  try {
    const adapter = getGlossyLooksSmavAdapter();
    const res = await adapter.setUserStatus(
      {
        userId: user.central_auth_id || undefined,
        externalStaffId: String(user.id),
        email: user.email?.trim().toLowerCase(),
        isActive,
      },
      options?.idempotencyKey
    );

    if (!res.success) {
      return {
        synced: false,
        outletCode: 'glossylooks',
        status: res.conflict ? 'conflict' : 'failed',
        centralAuthId: user.central_auth_id,
        conflict: res.conflict,
        error: res.message,
      };
    }

    await persistCentralMetadata(user, {
      centralAuthId: res.userId,
      isActive,
      syncOrigin: 'outlet_admin',
      performedBy: options?.performedBy,
    }).catch((err) => {
      console.warn('[SMAV Sync] Failed to persist status metadata locally:', err?.message);
    });

    return {
      synced: true,
      outletCode: 'glossylooks',
      status: isActive ? 'enabled' : 'disabled',
      centralAuthId: user.central_auth_id || res.userId,
      email: res.email || user.email,
    };
  } catch (err: any) {
    return {
      synced: false,
      outletCode: 'glossylooks',
      status: 'failed',
      centralAuthId: user.central_auth_id,
      error: err?.message || 'SMAV status update failed',
    };
  }
}

export async function resetSmavUserPasswordAndPersist(
  user: User,
  newPassword: string,
  options?: { idempotencyKey?: string; performedBy?: string }
): Promise<SmavSyncResult> {
  const cleanPassword = String(newPassword || '').trim();
  if (cleanPassword.length < 8) {
    return {
      synced: false,
      outletCode: 'glossylooks',
      status: 'skipped',
      centralAuthId: user.central_auth_id,
      error: 'Central SMAV password must be at least 8 characters.',
    };
  }

  try {
    const adapter = getGlossyLooksSmavAdapter();
    const res = await adapter.resetStaffPassword(
      {
        userId: user.central_auth_id || undefined,
        externalStaffId: String(user.id),
        email: user.email?.trim().toLowerCase(),
        newPassword: cleanPassword,
      },
      options?.idempotencyKey
    );

    if (!res.success) {
      return {
        synced: false,
        outletCode: 'glossylooks',
        status: res.conflict ? 'conflict' : 'failed',
        centralAuthId: user.central_auth_id,
        conflict: res.conflict,
        error: res.message,
      };
    }

    await persistCentralMetadata(user, {
      centralAuthId: res.userId,
      isActive: user.is_active,
      syncOrigin: 'outlet_admin',
      performedBy: options?.performedBy,
    }).catch((err) => {
      console.warn('[SMAV Sync] Failed to persist password-reset metadata locally:', err?.message);
    });

    return {
      synced: true,
      outletCode: 'glossylooks',
      status: 'password_reset',
      centralAuthId: user.central_auth_id || res.userId,
      email: res.email || user.email,
      mustChangePassword: res.mustChangePassword ?? true,
    };
  } catch (err: any) {
    return {
      synced: false,
      outletCode: 'glossylooks',
      status: 'failed',
      centralAuthId: user.central_auth_id,
      error: err?.message || 'SMAV password reset failed',
    };
  }
}

// In-flight idempotency lock to prevent concurrent duplicate webhook executions
const inFlightSmavWebhooks = new Set<string>();

export async function handleIncomingSmavWebhook(params: {
  headers: Record<string, string | string[] | undefined>;
  body: any;
  hashPassword: (password: string) => string;
}): Promise<{
  status: number;
  body: Record<string, any>;
}> {
  const { headers, body, hashPassword } = params;
  const adapter = getGlossyLooksSmavAdapter();

  // 1. Secure webhook authentication + outlet scope check + echo loop prevention
  const verification = adapter.verifyIncomingSmavWebhook(headers, body);
  if (!verification.authorized) {
    const isUnconfigured = !process.env.GLOSSYLOOKS_INTEGRATION_KEY;
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

  // 2. Idempotency check
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
    const alreadyProcessed = await salonRepository.isWebhookEventProcessed(eventRecordId);
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

    // 3. Deterministic identity matching (UUID -> externalStaffId -> exact email), fail closed on ambiguity
    const users = await salonRepository.getUsers();
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

    // Preserve Central Auth UUID: refuse mismatched UUID overwrite
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

    // Prevent email collision with another local user
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

    // Reject stale out-of-order sync versions
    if (
      existingUser &&
      syncVersion !== undefined &&
      typeof existingUser.central_sync_version === 'number' &&
      syncVersion < existingUser.central_sync_version
    ) {
      if (eventRecordId) {
        await salonRepository.recordProcessedWebhookEvent(eventRecordId, `smav_${rawAction}_stale`);
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

    const now = new Date().toISOString();
    const nextSyncVersion =
      syncVersion !== undefined
        ? syncVersion
        : (existingUser && typeof existingUser.central_sync_version === 'number'
            ? existingUser.central_sync_version
            : 0) + 1;

    // 4. Dispatch webhook action locally (NEVER calling outbound SMAV sync -> zero echo loop)
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

      if (transientNewPassword && transientNewPassword.length >= 4) {
        await salonRepository.resetUserPassword(
          existingUser.id,
          hashPassword(transientNewPassword),
          'SMAV Central Portal'
        );
      }

      const updated = await salonRepository.updateUser(
        existingUser.id,
        {
          ...(centralAuthId && !existingUser.central_auth_id
            ? { central_auth_id: centralAuthId, central_auth_linked_at: now }
            : {}),
          central_outlet_code: 'glossylooks',
          central_sync_version: nextSyncVersion,
          central_last_synced_at: now,
          central_sync_origin: 'smav_portal',
        },
        'SMAV Central Portal'
      );

      await salonRepository.logAudit(
        'SMAV_WEBHOOK_PASSWORD_RESET',
        'User',
        existingUser.id,
        'SMAV Central Portal',
        `Synchronized Central Auth password reset notification for ${existingUser.email}`
      );

      if (eventRecordId) {
        await salonRepository.recordProcessedWebhookEvent(eventRecordId, `smav_${rawAction}`);
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

      const updated = await salonRepository.updateUser(
        existingUser.id,
        {
          is_active: nextActive,
          ...(centralAuthId && !existingUser.central_auth_id
            ? { central_auth_id: centralAuthId, central_auth_linked_at: now }
            : {}),
          central_auth_status: nextActive ? 'ACTIVE' : 'DISABLED',
          central_outlet_code: 'glossylooks',
          central_sync_version: nextSyncVersion,
          central_last_synced_at: now,
          central_sync_origin: 'smav_portal',
        },
        'SMAV Central Portal'
      );

      if (eventRecordId) {
        await salonRepository.recordProcessedWebhookEvent(eventRecordId, `smav_${rawAction}`);
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

    // Create or update user (`upsert_user`, `create_user`, `update_user`, etc.)
    if (existingUser) {
      const nextActive = isActive !== undefined ? isActive : existingUser.is_active;
      const nextRole = rawRole !== undefined ? mapSmavRoleToLocalRole(rawRole, existingUser.role) : existingUser.role;

      const updated = await salonRepository.updateUser(
        existingUser.id,
        {
          ...(fullName ? { name: fullName } : {}),
          ...(email ? { email } : {}),
          ...(phone !== undefined ? { phone } : {}),
          ...(username ? { username } : {}),
          ...(rawRole !== undefined ? { role: nextRole } : {}),
          ...(isActive !== undefined ? { is_active: nextActive } : {}),
          ...(centralAuthId && !existingUser.central_auth_id
            ? { central_auth_id: centralAuthId, central_auth_linked_at: now }
            : {}),
          central_auth_status: nextActive ? 'ACTIVE' : 'DISABLED',
          central_outlet_code: 'glossylooks',
          central_sync_version: nextSyncVersion,
          central_last_synced_at: now,
          central_sync_origin: 'smav_portal',
        },
        'SMAV Central Portal'
      );

      if (eventRecordId) {
        await salonRepository.recordProcessedWebhookEvent(eventRecordId, `smav_${rawAction}`);
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

    // Not found locally: fail on explicit update-only action, otherwise create new staff user
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

    const createdUser = await salonRepository.createUser(
      {
        user_id: generatedUserId,
        email,
        name: fullName,
        phone: phone || '',
        role: mappedRole,
        branch_id: 'tgl-gachibowli-main',
        password_hash: hashPassword(transientNewPassword || crypto.randomBytes(24).toString('base64url')),
        is_active: nextActive,
        username: username || generatedUserId.toLowerCase(),
        ...(centralAuthId ? { central_auth_id: centralAuthId, central_auth_linked_at: now } : {}),
        central_auth_status: nextActive ? 'ACTIVE' : 'DISABLED',
        central_outlet_code: 'glossylooks',
        central_sync_version: nextSyncVersion,
        central_last_synced_at: now,
        central_sync_origin: 'smav_portal',
      },
      'SMAV Central Portal'
    );

    if (eventRecordId) {
      await salonRepository.recordProcessedWebhookEvent(eventRecordId, `smav_${rawAction}`);
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
