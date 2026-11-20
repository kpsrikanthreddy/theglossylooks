/**
 * Offline Mocked Verification Suite for Glossy Looks -> SMAV Authoritative Identity Sync
 *
 * SAFETY:
 * - Zero live database connections
 * - Zero live HTTP requests (uses injected mocked fetchImpl)
 * - Zero modifications to real user accounts or passwords
 *
 * Run with: npx tsx scripts/test-smav-user-sync.ts
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GlossyLooksSmavAuthAdapter } from '../src/server/smav/glossylooks_smav_auth_adapter.ts';
import type { FetchLike } from '../src/server/smav/smav_outlet_user_adapter.ts';
import {
  CentralAuthLinkForbiddenError,
  IdempotencyKeyConflictError,
  Migration024RequiredError,
  isCentralAuthLinkForbiddenError,
  isIdempotencyKeyConflictError,
  isMigration024RequiredError,
  type ISalonRepository,
} from '../src/server/repositories/salonRepository.ts';
import { SupabaseSalonRepository } from '../src/server/repositories/supabaseSalonRepository.ts';
import {
  mapLocalRoleToSmavRole,
  deriveUserSyncStatus,
  sanitizeOutboxPayload,
  sanitizeSyncError,
  syncUserToSmavAndPersist,
  setSmavUserStatusAndPersist,
  resetSmavUserPasswordAndPersist,
  executeCommittedOutboxSync,
  processPendingSmavUserSyncOutbox,
  retrySmavSyncForUser,
  reconcileAdminUsersToSmav,
  SMAV_RETRY_BACKOFF_MS,
  type SmavSyncDependencies,
} from '../src/server/smavSync.ts';
import type { SmavUserSyncOutboxItem, Staff, User } from '../src/types/salon.ts';

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, any>;
}

function createInMemoryRepo(seedUsers: User[], seedStaff: Staff[] = []) {
  const users: User[] = seedUsers.map(u => ({ ...u }));
  const staff: Staff[] = seedStaff.map(s => ({ ...s }));
  const outbox: SmavUserSyncOutboxItem[] = [];
  let seq = 1;
  let nowMs = Date.parse('2026-11-19T10:00:00.000Z');

  const getNowMs = () => nowMs;
  const setNowMs = (ms: number) => {
    nowMs = ms;
  };
  const advanceMs = (delta: number) => {
    nowMs += delta;
  };

  const canonicalize = (val: unknown): unknown => {
    if (Array.isArray(val)) return val.map(canonicalize);
    if (val && typeof val === 'object') {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        const v = (val as Record<string, unknown>)[k];
        if (v !== undefined) sorted[k] = canonicalize(v);
      }
      return sorted;
    }
    return val;
  };
  const fingerprint = (input: Record<string, unknown>): string =>
    crypto.createHash('sha256').update(JSON.stringify(canonicalize(input))).digest('hex');

  const repo = {
    async getUsers(): Promise<User[]> {
      return users.map(u => ({ ...u }));
    },
    async getStaff(): Promise<Staff[]> {
      return staff.map(s => ({ ...s }));
    },
    async updateUser(id: string, updates: Partial<User>): Promise<User | null> {
      const idx = users.findIndex(u => String(u.id) === String(id));
      if (idx === -1) return null;
      const existing = users[idx];
      // Strictly forbid ordinary user updates from assigning, changing, or clearing central_auth_id (even when NULL)
      const safeUpdates: Partial<User> = { ...updates };
      if (safeUpdates.central_auth_id !== undefined) {
        const currentCid = String(existing.central_auth_id || '').trim().toLowerCase();
        const incomingCid = String(safeUpdates.central_auth_id || '').trim().toLowerCase();
        if (incomingCid !== currentCid) {
          throw new CentralAuthLinkForbiddenError(
            'CENTRAL_AUTH_LINK_FORBIDDEN: ordinary user updates cannot assign or modify central_auth_id.'
          );
        }
        delete safeUpdates.central_auth_id;
      }
      users[idx] = { ...existing, ...safeUpdates };

      // Mirror ONLY changed identity/sync fields onto linked existing staff row (never role/salary/skills/central_auth_id)
      const staffIdx = staff.findIndex(s => String(s.user_id) === String(id));
      if (staffIdx !== -1) {
        const s = staff[staffIdx];
        staff[staffIdx] = {
          ...s,
          ...(safeUpdates.name !== undefined && { name: users[idx].name }),
          ...(safeUpdates.phone !== undefined && { phone: users[idx].phone }),
          ...(safeUpdates.email !== undefined && { email: users[idx].email }),
          ...(safeUpdates.is_active !== undefined && { is_active: users[idx].is_active }),
          ...(safeUpdates.username !== undefined && { username: users[idx].username }),
          ...(safeUpdates.central_auth_status !== undefined && { central_auth_status: users[idx].central_auth_status }),
          ...(safeUpdates.central_sync_status !== undefined && { central_sync_status: users[idx].central_sync_status }),
          ...(safeUpdates.central_sync_error !== undefined && { central_sync_error: users[idx].central_sync_error }),
        };
      }
      return { ...users[idx] };
    },
    async createUserWithSmavOutbox(
      userData: Omit<User, 'id' | 'created_at' | 'updated_at'>,
      outboxCfg: {
        idempotency_key: string;
        event_type: SmavUserSyncOutboxItem['event_type'];
        action: Exclude<SmavUserSyncOutboxItem['action'], 'reset_password'>;
        max_attempts?: number;
        credential_mode?: 'explicit' | 'generated';
        verifyReplayPassword?: (storedPasswordHash: string) => boolean;
      },
      performedBy: string
    ): Promise<{ user: User; outboxItem: SmavUserSyncOutboxItem; created: boolean; atomic: boolean; idempotentReplay?: boolean }> {
      if (userData.central_auth_id !== undefined) {
        throw new CentralAuthLinkForbiddenError('Cannot assign central_auth_id on create.');
      }
      const credentialMode: 'explicit' | 'generated' =
        outboxCfg.credential_mode === 'explicit' ? 'explicit' : 'generated';
      const fp = fingerprint({
        op: 'create_user',
        user_code: String(userData.user_id || '').trim().toUpperCase(),
        name: String(userData.name || '').trim(),
        email: String(userData.email || '').trim().toLowerCase(),
        phone: String(userData.phone || '').trim(),
        role: String(userData.role || '').trim().toLowerCase(),
        username: String(userData.username || userData.user_id || '').trim().toLowerCase(),
        is_active: userData.is_active !== false,
        credential_mode: credentialMode,
        event_type: outboxCfg.event_type,
        action: outboxCfg.action,
      });

      const existingOutbox = outbox.find(o => o.idempotency_key === outboxCfg.idempotency_key);
      if (existingOutbox) {
        if (
          existingOutbox.event_type !== outboxCfg.event_type ||
          existingOutbox.action !== outboxCfg.action ||
          (existingOutbox.request_fingerprint && existingOutbox.request_fingerprint !== fp)
        ) {
          throw new IdempotencyKeyConflictError(
            `IDEMPOTENCY_KEY_CONFLICT: idempotency_key "${outboxCfg.idempotency_key}" was already used with a different create-user payload.`
          );
        }
        if (!existingOutbox.local_user_id) {
          throw new IdempotencyKeyConflictError('Existing user was deleted for idempotency key.');
        }
        const existingUser = users.find(u => String(u.id) === String(existingOutbox.local_user_id));
        if (!existingUser) {
          throw new IdempotencyKeyConflictError('Existing user missing for idempotency key.');
        }
        if (outboxCfg.verifyReplayPassword && !outboxCfg.verifyReplayPassword(String(existingUser.password_hash || ''))) {
          throw new IdempotencyKeyConflictError(
            `IDEMPOTENCY_KEY_CONFLICT: idempotency_key "${outboxCfg.idempotency_key}" was already used with a different password.`
          );
        }
        return {
          user: { ...existingUser },
          outboxItem: { ...existingOutbox },
          created: false,
          atomic: true,
          idempotentReplay: true,
        };
      }

      const nowIso = new Date(nowMs).toISOString();
      const newUser: User = {
        ...userData,
        id: `usr-atomic-${seq++}`,
        central_sync_status: 'PENDING',
        central_sync_error: null,
        created_at: nowIso,
        updated_at: nowIso,
      };
      users.push(newUser);
      // NOTE: does NOT fabricate operational staff profile rows!
      const { item, created } = await (repo as any).enqueueSmavUserSyncEvent({
        idempotency_key: outboxCfg.idempotency_key,
        local_user_id: newUser.id,
        event_type: outboxCfg.event_type,
        action: outboxCfg.action,
        payload: sanitizeOutboxPayload({
          ...(newUser.central_auth_id ? { userId: newUser.central_auth_id } : {}),
          externalStaffId: newUser.id,
          email: newUser.email,
          fullName: newUser.name,
          role: mapLocalRoleToSmavRole(newUser.role),
          isActive: newUser.is_active,
        }),
        performed_by: performedBy,
        max_attempts: outboxCfg.max_attempts ?? 6,
        request_fingerprint: fp,
      });
      newUser.central_sync_outbox_id = item.id;
      return { user: { ...newUser }, outboxItem: item, created, atomic: true, idempotentReplay: false };
    },
    async updateUserWithSmavOutbox(
      id: string,
      updateData: Partial<User>,
      outboxCfg: {
        idempotency_key: string;
        event_type: SmavUserSyncOutboxItem['event_type'];
        action: Exclude<SmavUserSyncOutboxItem['action'], 'reset_password'>;
        max_attempts?: number;
      },
      performedBy: string
    ): Promise<{ user: User; outboxItem: SmavUserSyncOutboxItem; created: boolean; atomic: boolean; idempotentReplay?: boolean } | null> {
      if (updateData.central_auth_id !== undefined) {
        throw new CentralAuthLinkForbiddenError(
          'CENTRAL_AUTH_LINK_FORBIDDEN: ordinary Admin User updates cannot assign or modify central_auth_id.'
        );
      }

      const fp = fingerprint({
        op: 'update_user',
        local_user_id: String(id),
        event_type: outboxCfg.event_type,
        action: outboxCfg.action,
        updates: updateData,
      });

      // Pre-mutation idempotency lock & conflict check (MUST run BEFORE mutating user!)
      const existingOutbox = outbox.find(o => o.idempotency_key === outboxCfg.idempotency_key);
      if (existingOutbox) {
        if (
          String(existingOutbox.local_user_id || '') !== String(id) ||
          existingOutbox.event_type !== outboxCfg.event_type ||
          existingOutbox.action !== outboxCfg.action ||
          (existingOutbox.request_fingerprint && existingOutbox.request_fingerprint !== fp)
        ) {
          throw new IdempotencyKeyConflictError(
            `IDEMPOTENCY_KEY_CONFLICT: idempotency_key "${outboxCfg.idempotency_key}" was already used with a different update-user payload.`
          );
        }
        const existingUser = users.find(u => String(u.id) === String(id));
        if (!existingUser) return null;
        return {
          user: { ...existingUser },
          outboxItem: { ...existingOutbox },
          created: false,
          atomic: true,
          idempotentReplay: true,
        };
      }

      const updated = await (repo as any).updateUser(id, {
        ...updateData,
        central_sync_status: 'PENDING',
        central_sync_error: null,
      });
      if (!updated) return null;
      const { item, created } = await (repo as any).enqueueSmavUserSyncEvent({
        idempotency_key: outboxCfg.idempotency_key,
        local_user_id: updated.id,
        event_type: outboxCfg.event_type,
        action: outboxCfg.action,
        payload: sanitizeOutboxPayload({
          ...(updated.central_auth_id ? { userId: updated.central_auth_id } : {}),
          externalStaffId: updated.id,
          email: updated.email,
          fullName: updated.name,
          role: mapLocalRoleToSmavRole(updated.role),
          isActive: updated.is_active,
        }),
        performed_by: performedBy,
        max_attempts: outboxCfg.max_attempts ?? 6,
        request_fingerprint: fp,
      });
      const idx = users.findIndex(u => String(u.id) === String(id));
      if (idx !== -1) users[idx].central_sync_outbox_id = item.id;
      return { user: { ...updated, central_sync_outbox_id: item.id }, outboxItem: item, created, atomic: true, idempotentReplay: false };
    },
    async linkVerifiedCentralAuthId(input: {
      local_user_id: string;
      verified_central_auth_id: string;
      verification_source: 'smav_sync_response';
      evidence_ref: string;
      performed_by?: string;
    }): Promise<User | null> {
      const idx = users.findIndex(u => String(u.id) === String(input.local_user_id));
      if (idx === -1) return null;
      const user = users[idx];
      const cleanCid = String(input.verified_central_auth_id || '').trim();
      const cleanEvidence = String(input.evidence_ref || '').trim();
      if (!cleanCid || !cleanEvidence) {
        throw new CentralAuthLinkForbiddenError('Verified Central Auth UUID and evidence reference are required.');
      }
      if (input.verification_source !== 'smav_sync_response') {
        throw new CentralAuthLinkForbiddenError('Only smav_sync_response may establish a Central Auth identity link.');
      }
      if (user.central_auth_id) {
        if (user.central_auth_id.toLowerCase() === cleanCid.toLowerCase()) {
          return { ...user };
        }
        throw new CentralAuthLinkForbiddenError(
          `User ${user.id} already linked to ${user.central_auth_id}; manual reconciliation required.`
        );
      }
      const evidenceRow = outbox.find(
        o =>
          o.id === cleanEvidence &&
          String(o.local_user_id || '') === String(input.local_user_id) &&
          o.status === 'SYNCED' &&
          String(o.response_central_auth_id || '').toLowerCase() === cleanCid.toLowerCase()
      );
      if (!evidenceRow) {
        throw new CentralAuthLinkForbiddenError(
          `No verified SYNCED outbox evidence (${cleanEvidence}) found for user ${input.local_user_id} and UUID ${cleanCid}.`
        );
      }
      const dup = users.find(
        u => String(u.id) !== String(user.id) && u.central_auth_id?.toLowerCase() === cleanCid.toLowerCase()
      );
      if (dup) {
        throw new CentralAuthLinkForbiddenError(`UUID ${cleanCid} already assigned to ${dup.id}.`);
      }
      const nowIso = new Date(nowMs).toISOString();
      users[idx] = {
        ...user,
        central_auth_id: cleanCid,
        central_auth_linked_at: user.central_auth_linked_at || nowIso,
        central_outlet_code: user.central_outlet_code || 'glossylooks',
      };
      const staffIdx = staff.findIndex(s => String(s.user_id) === String(user.id) && !s.central_auth_id);
      if (staffIdx !== -1) {
        staff[staffIdx] = {
          ...staff[staffIdx],
          central_auth_id: cleanCid,
          central_auth_linked_at: staff[staffIdx].central_auth_linked_at || nowIso,
        };
      }
      return { ...users[idx] };
    },
    async enqueueSmavUserSyncEvent(event: {
      idempotency_key: string;
      local_user_id: string;
      event_type: SmavUserSyncOutboxItem['event_type'];
      action: SmavUserSyncOutboxItem['action'];
      payload: Record<string, any>;
      performed_by?: string;
      max_attempts?: number;
      request_fingerprint?: string | null;
    }): Promise<{ item: SmavUserSyncOutboxItem; created: boolean }> {
      if (event.action === 'reset_password') {
        throw new Error('reset_password must execute synchronously and cannot be enqueued as PENDING.');
      }
      const fp =
        event.request_fingerprint ||
        fingerprint({
          op: 'enqueue',
          local_user_id: String(event.local_user_id),
          event_type: event.event_type,
          action: event.action,
          payload: event.payload || {},
        });
      const existing = outbox.find(o => o.idempotency_key === event.idempotency_key);
      if (existing) {
        if (
          String(existing.local_user_id || '') !== String(event.local_user_id) ||
          existing.event_type !== event.event_type ||
          existing.action !== event.action ||
          (existing.request_fingerprint && existing.request_fingerprint !== fp)
        ) {
          throw new IdempotencyKeyConflictError(
            `IDEMPOTENCY_KEY_CONFLICT: idempotency_key "${event.idempotency_key}" was already used with a different sync payload.`
          );
        }
        return { item: { ...existing }, created: false };
      }
      const nowIso = new Date(nowMs).toISOString();
      const item: SmavUserSyncOutboxItem = {
        id: `outbox-${seq++}`,
        idempotency_key: event.idempotency_key,
        request_fingerprint: fp,
        local_user_id: event.local_user_id,
        audit_local_user_id: event.local_user_id,
        event_type: event.event_type,
        action: event.action,
        payload: event.payload,
        status: 'PENDING',
        attempts: 0,
        max_attempts: event.max_attempts ?? 6,
        next_retry_at: nowIso,
        locked_at: null,
        last_http_status: null,
        last_error: null,
        conflict: false,
        response_central_auth_id: null,
        performed_by: event.performed_by || null,
        created_at: nowIso,
        updated_at: nowIso,
        synced_at: null,
      };
      outbox.push(item);
      return { item: { ...item }, created: true };
    },
    async recordSmavSyncAuditEvent(event: {
      idempotency_key: string;
      local_user_id: string;
      event_type: SmavUserSyncOutboxItem['event_type'];
      action: SmavUserSyncOutboxItem['action'];
      payload: Record<string, any>;
      status: 'SYNCED' | 'FAILED';
      last_http_status?: number | null;
      last_error?: string | null;
      conflict?: boolean;
      response_central_auth_id?: string | null;
      performed_by?: string;
      request_fingerprint?: string | null;
    }): Promise<SmavUserSyncOutboxItem> {
      const nowIso = new Date(nowMs).toISOString();
      const fp =
        event.request_fingerprint ||
        fingerprint({
          op: 'audit',
          local_user_id: String(event.local_user_id),
          event_type: event.event_type,
          action: event.action,
        });
      const existing = outbox.find(o => o.idempotency_key === event.idempotency_key);
      if (existing) {
        if (
          String(existing.local_user_id || '') !== String(event.local_user_id) ||
          existing.event_type !== event.event_type ||
          existing.action !== event.action ||
          (existing.request_fingerprint && existing.request_fingerprint !== fp)
        ) {
          throw new IdempotencyKeyConflictError(
            `IDEMPOTENCY_KEY_CONFLICT: idempotency_key "${event.idempotency_key}" was already used for another operation.`
          );
        }
        return { ...existing };
      }
      const item: SmavUserSyncOutboxItem = {
        id: `outbox-${seq++}`,
        idempotency_key: event.idempotency_key,
        request_fingerprint: fp,
        local_user_id: event.local_user_id,
        audit_local_user_id: event.local_user_id,
        event_type: event.event_type,
        action: event.action,
        payload: event.payload,
        status: event.status,
        attempts: 1,
        max_attempts: 1,
        next_retry_at: nowIso,
        locked_at: null,
        last_http_status: event.last_http_status ?? null,
        last_error: event.last_error ?? null,
        conflict: Boolean(event.conflict),
        response_central_auth_id: event.response_central_auth_id ?? null,
        performed_by: event.performed_by || null,
        created_at: nowIso,
        updated_at: nowIso,
        synced_at: event.status === 'SYNCED' ? nowIso : null,
      };
      outbox.push(item);
      return { ...item };
    },
    async claimSmavUserSyncEventById(id: string): Promise<SmavUserSyncOutboxItem | null> {
      const item = outbox.find(o => o.id === id);
      if (!item) return null;
      if (
        !item.local_user_id ||
        item.status !== 'PENDING' ||
        item.conflict ||
        item.action === 'reset_password' ||
        item.attempts >= item.max_attempts ||
        Date.parse(item.next_retry_at) > nowMs
      ) {
        return null;
      }
      const nowIso = new Date(nowMs).toISOString();
      item.status = 'PROCESSING';
      item.attempts += 1;
      item.locked_at = nowIso;
      item.updated_at = nowIso;
      return { ...item };
    },
    async claimDueSmavUserSyncEvents(limit = 20, staleLockMinutes = 5): Promise<SmavUserSyncOutboxItem[]> {
      const nowIso = new Date(nowMs).toISOString();
      const staleThresholdMs = nowMs - Math.max(1, staleLockMinutes) * 60_000;
      const claimed: SmavUserSyncOutboxItem[] = [];

      // Step 1: Mark orphaned rows (deleted local user, ON DELETE SET NULL) as FAILED preserving history
      for (const item of outbox) {
        if (!item.local_user_id && (item.status === 'PENDING' || item.status === 'PROCESSING')) {
          item.status = 'FAILED';
          item.locked_at = null;
          item.last_error =
            item.last_error || 'Local user record was deleted; historical outbox entry preserved for audit.';
          item.updated_at = nowIso;
        }
      }

      // Step 2: Permanently fail exhausted stale PROCESSING locks (attempts already reached max_attempts at claim time)
      for (const item of outbox) {
        if (
          item.local_user_id &&
          item.status === 'PROCESSING' &&
          typeof item.locked_at === 'string' &&
          Date.parse(item.locked_at) < staleThresholdMs &&
          item.attempts >= item.max_attempts
        ) {
          item.status = 'FAILED';
          item.locked_at = null;
          item.last_error = item.last_error || 'Worker lock timed out after maximum retry attempts.';
          item.updated_at = nowIso;
          const u = users.find(usr => String(usr.id) === String(item.local_user_id));
          if (u) {
            u.central_sync_status = 'FAILED';
            u.central_sync_error = item.last_error;
          }
        }
      }

      // Step 3: Unified claim-time attempt increment (+1 on EVERY transition into PROCESSING)
      for (const item of outbox) {
        if (claimed.length >= limit) break;
        if (!item.local_user_id) continue;
        if (item.action === 'reset_password') continue;
        if (item.conflict) continue;
        if (item.attempts >= item.max_attempts) continue;

        const isDuePending = item.status === 'PENDING' && Date.parse(item.next_retry_at) <= nowMs;
        const isRecoverableStaleLock =
          item.status === 'PROCESSING' &&
          typeof item.locked_at === 'string' &&
          Date.parse(item.locked_at) < staleThresholdMs;

        if (!isDuePending && !isRecoverableStaleLock) continue;

        item.status = 'PROCESSING';
        item.attempts += 1;
        item.locked_at = nowIso;
        item.updated_at = nowIso;
        claimed.push({ ...item });
      }
      return claimed;
    },
    async getSmavUserSyncOutbox(filters?: { localUserId?: string; status?: string; limit?: number }): Promise<SmavUserSyncOutboxItem[]> {
      let rows = [...outbox];
      if (filters?.localUserId) {
        rows = rows.filter(
          r => String(r.local_user_id || r.audit_local_user_id || '') === String(filters.localUserId)
        );
      }
      if (filters?.status) rows = rows.filter(r => r.status === filters.status);
      rows.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      return rows.slice(0, filters?.limit ?? 50).map(r => ({ ...r }));
    },
    async getSmavUserSyncOutboxById(id: string): Promise<SmavUserSyncOutboxItem | null> {
      const found = outbox.find(o => o.id === id);
      return found ? { ...found } : null;
    },
    async getSmavUserSyncOutboxByIdempotencyKey(idempotencyKey: string): Promise<SmavUserSyncOutboxItem | null> {
      const found = outbox.find(o => o.idempotency_key === idempotencyKey);
      return found ? { ...found } : null;
    },
    async updateSmavUserSyncEvent(id: string, updates: Partial<SmavUserSyncOutboxItem>): Promise<SmavUserSyncOutboxItem | null> {
      const idx = outbox.findIndex(o => o.id === id);
      if (idx === -1) return null;
      outbox[idx] = { ...outbox[idx], ...updates, updated_at: new Date(nowMs).toISOString() };
      return { ...outbox[idx] };
    },
  } as unknown as ISalonRepository;

  const simulateHardDeleteUser = (userId: string) => {
    const idx = users.findIndex(u => String(u.id) === String(userId));
    if (idx !== -1) users.splice(idx, 1);
    // Models PostgreSQL ON DELETE SET NULL on smav_user_sync_outbox.local_user_id while preserving row + audit_local_user_id
    for (const item of outbox) {
      if (String(item.local_user_id || '') === String(userId)) {
        item.local_user_id = null;
      }
    }
  };

  return { repo, users, staff, outbox, getNowMs, setNowMs, advanceMs, simulateHardDeleteUser };
}

function createMockFetch(
  handler: (req: CapturedRequest, callIndex: number) => { status: number; body: Record<string, any> }
): { fetchImpl: FetchLike; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const captured: CapturedRequest = {
      url: String(url),
      method: String(init?.method || 'GET'),
      headers: (init?.headers as Record<string, string>) || {},
      body: init?.body ? JSON.parse(String(init.body)) : {},
    };
    requests.push(captured);
    const resp = handler(captured, requests.length - 1);
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      json: async () => resp.body,
      text: async () => JSON.stringify(resp.body),
    } as Response;
  };
  return { fetchImpl, requests };
}

function buildDeps(repo: ISalonRepository, fetchImpl: FetchLike, now: () => number): SmavSyncDependencies {
  const adapter = new GlossyLooksSmavAuthAdapter({
    outletCode: 'glossylooks',
    gatewayUrl: 'https://smav.mock.local',
    integrationKey: 'mock-integration-key-12345',
    fetchImpl,
  });
  return { repo, adapter, now };
}

function makeMockUser(
  overrides: Partial<User> & Pick<User, 'id' | 'user_id' | 'name' | 'email' | 'phone' | 'role'>
): User {
  const now = overrides.created_at || '2026-11-19T10:00:00.000Z';
  return {
    is_active: true,
    password_hash: 'scrypt$mock_salt$mock_hash',
    created_at: now,
    updated_at: overrides.updated_at || now,
    ...overrides,
  };
}

async function runTests() {
  const results: string[] = [];
  const test = async (name: string, fn: () => Promise<void> | void) => {
    await fn();
    results.push(`PASS: ${name}`);
    console.log(`✓ ${name}`);
  };

  // 1. Role mapping strictly uses RBAC role
  await test('RBAC role mapping: OWNER/MANAGER -> ADMIN, STYLIST/RECEPTIONIST -> POS_BILLING', () => {
    assert.equal(mapLocalRoleToSmavRole('owner'), 'ADMIN');
    assert.equal(mapLocalRoleToSmavRole('OWNER'), 'ADMIN');
    assert.equal(mapLocalRoleToSmavRole('manager'), 'ADMIN');
    assert.equal(mapLocalRoleToSmavRole('stylist'), 'POS_BILLING');
    assert.equal(mapLocalRoleToSmavRole('receptionist'), 'POS_BILLING');
    assert.equal(mapLocalRoleToSmavRole('inventory_staff'), 'POS_BILLING');
  });

  // 2. Payload & error sanitization strips secrets
  await test('Outbox payload & error sanitization removes passwords, tokens, and API keys', () => {
    const clean = sanitizeOutboxPayload({
      email: 'staff@theglossylooks.com',
      initialPassword: 'SuperSecretPassword!',
      newPassword: 'AnotherSecretPassword!',
      password_hash: 'scrypt$abc',
      resetToken: 'tok_123',
      nested: { secretKey: 'xyz', role: 'POS_BILLING' },
    });
    assert.equal(clean.email, 'staff@theglossylooks.com');
    assert.equal(clean.initialPassword, undefined);
    assert.equal(clean.newPassword, undefined);
    assert.equal(clean.password_hash, undefined);
    assert.equal(clean.resetToken, undefined);
    assert.equal(clean.nested.secretKey, undefined);
    assert.equal(clean.nested.role, 'POS_BILLING');

    const safeErr = sanitizeSyncError('Auth failed Bearer eyJhbGciOi.secret x-integration-key=supersecret');
    assert.ok(!safeErr.includes('eyJhbGciOi'));
    assert.ok(!safeErr.includes('supersecret'));
    assert.ok(safeErr.includes('[REDACTED]'));
  });

  // 3. Create Staff User (SRIREDDY) with exact contract & zero stored secrets
  await test('Create Staff User: exact endpoint/headers, transient password, zero outbox secret persistence', async () => {
    const srireddy = makeMockUser({
      id: 'usr-srireddy-01',
      user_id: 'TGL-STY09',
      username: 'srireddy',
      name: 'SRIREDDY',
      email: 'srireddy@theglossylooks.com',
      phone: '9000011111',
      role: 'stylist',
    });
    const mem = createInMemoryRepo([srireddy]);
    const mock = createMockFetch(() => ({
      status: 200,
      body: {
        success: true,
        userId: '11111111-1111-4111-8111-111111111111',
        email: 'srireddy@theglossylooks.com',
        role: 'POS_BILLING',
        isNewUser: true,
      },
    }));

    const res = await syncUserToSmavAndPersist(srireddy, {
      eventType: 'USER_CREATED',
      initialPassword: 'TempPassword#2026',
      performedBy: 'Madu Mounika',
      deps: buildDeps(mem.repo, mock.fetchImpl, mem.getNowMs),
    });

    assert.equal(res.synced, true);
    assert.equal(res.syncStatus, 'SYNCED');
    assert.equal(res.centralAuthId, '11111111-1111-4111-8111-111111111111');
    assert.equal(mock.requests.length, 1);

    const req = mock.requests[0];
    assert.equal(req.url, 'https://smav.mock.local/api/integrations/glossylooks/users/sync');
    assert.equal(req.method, 'POST');
    assert.equal(req.headers['X-Business-Source'], 'glossylooks');
    assert.equal(req.headers['X-Integration-Key'], 'mock-integration-key-12345');
    assert.equal(req.headers['X-SMAV-Sync-Origin'], 'outlet_admin');
    assert.ok(req.headers['X-Idempotency-Key']);
    assert.equal(req.body.action, 'upsert_user');
    assert.equal(req.body.outletCode, 'glossylooks');
    assert.equal(req.body.externalStaffId, 'usr-srireddy-01');
    assert.equal(req.body.role, 'POS_BILLING');
    assert.equal(req.body.initialPassword, 'TempPassword#2026');

    // Outbox MUST NOT contain plaintext password
    assert.equal(mem.outbox.length, 1);
    const outboxJson = JSON.stringify(mem.outbox[0]);
    assert.ok(!outboxJson.includes('TempPassword#2026'));
    assert.equal(mem.outbox[0].status, 'SYNCED');
    assert.equal(mem.users[0].central_auth_id, '11111111-1111-4111-8111-111111111111');
    assert.equal(mem.users[0].central_sync_status, 'SYNCED');
  });

  // 4. Edit User, Role Update, Email Change (UUID preserved)
  await test('Edit User, Role Change (STYLIST -> MANAGER -> RECEPTIONIST), and Email Change preserve Central Auth UUID', async () => {
    const user = makeMockUser({
      id: 'usr-sharadha-01',
      user_id: 'TGL-REC04',
      name: 'Sharadha',
      email: 'sharadha@theglossylooks.com',
      phone: '9000022222',
      role: 'receptionist',
      central_auth_id: '22222222-2222-4222-8222-222222222222',
    });
    const mem = createInMemoryRepo([user]);
    const mock = createMockFetch((req) => ({
      status: 200,
      body: {
        success: true,
        userId: req.body.userId,
        email: req.body.email,
        role: req.body.role,
        isNewUser: false,
      },
    }));
    const deps = buildDeps(mem.repo, mock.fetchImpl, mem.getNowMs);

    // Promote receptionist -> manager (ADMIN)
    const promoted = { ...user, role: 'manager' as const, name: 'Sharadha Devi' };
    const r1 = await syncUserToSmavAndPersist(promoted, { eventType: 'ROLE_CHANGED', performedBy: 'Owner', deps });
    assert.equal(r1.syncStatus, 'SYNCED');
    assert.equal(mock.requests[0].body.action, 'update_user');
    assert.equal(mock.requests[0].body.userId, '22222222-2222-4222-8222-222222222222');
    assert.equal(mock.requests[0].body.role, 'ADMIN');

    // Change email while preserving Central Auth UUID
    const emailUpdated = { ...promoted, email: 'sharadha.mgr@theglossylooks.com' };
    const r2 = await syncUserToSmavAndPersist(emailUpdated, { eventType: 'EMAIL_CHANGED', performedBy: 'Owner', deps });
    assert.equal(r2.syncStatus, 'SYNCED');
    assert.equal(mock.requests[1].body.userId, '22222222-2222-4222-8222-222222222222');
    assert.equal(mock.requests[1].body.email, 'sharadha.mgr@theglossylooks.com');

    // Demote manager -> stylist (POS_BILLING)
    const demoted = { ...emailUpdated, role: 'stylist' as const };
    const r3 = await syncUserToSmavAndPersist(demoted, { eventType: 'ROLE_CHANGED', performedBy: 'Owner', deps });
    assert.equal(r3.syncStatus, 'SYNCED');
    assert.equal(mock.requests[2].body.role, 'POS_BILLING');
    assert.equal(mem.users[0].central_auth_id, '22222222-2222-4222-8222-222222222222');
  });

  // 5. Disable & Reactivate User
  await test('Deactivate sends set_status(isActive:false); Reactivate restores exact mapped RBAC role only', async () => {
    const user = makeMockUser({
      id: 'usr-srikanth-01',
      user_id: 'TGL-MGR02',
      name: 'SRIKANTH KAYIDAPURAM',
      email: 'srikanth@theglossylooks.com',
      phone: '9000033333',
      role: 'manager',
      central_auth_id: '33333333-3333-4333-8333-333333333333',
    });
    const mem = createInMemoryRepo([user]);
    const mock = createMockFetch((req) => ({
      status: 200,
      body: {
        success: true,
        userId: req.body.userId,
        email: req.body.email,
        role: req.body.role || 'ADMIN',
      },
    }));
    const deps = buildDeps(mem.repo, mock.fetchImpl, mem.getNowMs);

    const disableRes = await setSmavUserStatusAndPersist(user, false, { performedBy: 'Owner', deps });
    assert.equal(disableRes.syncStatus, 'SYNCED');
    assert.equal(disableRes.status, 'disabled');
    assert.equal(mock.requests[0].body.action, 'set_status');
    assert.equal(mock.requests[0].body.isActive, false);
    assert.equal(mem.users[0].central_auth_status, 'DISABLED');

    // Reactivate with downgraded receptionist role -> must restore ONLY POS_BILLING
    const reactivatedUser = { ...mem.users[0], role: 'receptionist' as const };
    const reactivateRes = await setSmavUserStatusAndPersist(reactivatedUser, true, { performedBy: 'Owner', deps });
    assert.equal(reactivateRes.syncStatus, 'SYNCED');
    assert.equal(mock.requests[1].body.action, 'update_user');
    assert.equal(mock.requests[1].body.isActive, true);
    assert.equal(mock.requests[1].body.role, 'POS_BILLING');
    assert.equal(mem.users[0].central_auth_status, 'ACTIVE');
  });

  // 6. Password Reset (success & failure never persist password; worker never auto-retries reset_password)
  await test('Password Reset: transient forwarding only, never stored in outbox, failed reset not auto-retried', async () => {
    const user = makeMockUser({
      id: 'usr-mounika-01',
      user_id: 'TGL-OWN01',
      name: 'Madu Mounika',
      email: 'owner@theglossylooks.com',
      phone: '8985799459',
      role: 'owner',
      central_auth_id: '44444444-4444-4444-8444-444444444444',
    });
    const mem = createInMemoryRepo([user]);
    let shouldFail = false;
    const mock = createMockFetch(() =>
      shouldFail
        ? { status: 503, body: { success: false, message: 'Central Auth temporarily unavailable' } }
        : { status: 200, body: { success: true, userId: user.central_auth_id, mustChangePassword: true } }
    );
    const deps = buildDeps(mem.repo, mock.fetchImpl, mem.getNowMs);

    const okRes = await resetSmavUserPasswordAndPersist(user, 'NewSecurePass#2026', { performedBy: 'Owner', deps });
    assert.equal(okRes.synced, true);
    assert.equal(okRes.status, 'password_reset');
    assert.equal(mock.requests[0].body.action, 'reset_password');
    assert.equal(mock.requests[0].body.newPassword, 'NewSecurePass#2026');
    assert.ok(!JSON.stringify(mem.outbox).includes('NewSecurePass#2026'));

    shouldFail = true;
    const failRes = await resetSmavUserPasswordAndPersist(user, 'SecondPass#2026', { performedBy: 'Owner', deps });
    assert.equal(failRes.synced, false);
    assert.equal(failRes.syncStatus, 'FAILED');
    assert.equal(failRes.passwordResetRequired, true);
    assert.ok(!JSON.stringify(mem.outbox).includes('SecondPass#2026'));

    // Ensure background worker does NOT attempt to retry failed reset_password
    mem.advanceMs(3_600_000);
    const drain = await processPendingSmavUserSyncOutbox({ deps });
    assert.equal(drain.claimed, 0);
  });

  // 7. Idempotency replay
  await test('Idempotency: duplicate key replays cleanly without sending duplicate SMAV request', async () => {
    const user = makeMockUser({
      id: 'usr-idem-01',
      user_id: 'TGL-STY10',
      name: 'Test Stylist',
      email: 'idem@theglossylooks.com',
      phone: '9000044444',
      role: 'stylist',
    });
    const mem = createInMemoryRepo([user]);
    const mock = createMockFetch(() => ({
      status: 200,
      body: { success: true, userId: '55555555-5555-4555-8555-555555555555', role: 'POS_BILLING', isNewUser: true },
    }));
    const deps = buildDeps(mem.repo, mock.fetchImpl, mem.getNowMs);

    const r1 = await syncUserToSmavAndPersist(user, { idempotencyKey: 'idem-key-001', performedBy: 'Owner', deps });
    const r2 = await syncUserToSmavAndPersist(user, { idempotencyKey: 'idem-key-001', performedBy: 'Owner', deps });

    assert.equal(r1.syncStatus, 'SYNCED');
    assert.equal(r2.syncStatus, 'SYNCED');
    assert.equal(r2.status, 'idempotent_replay');
    assert.equal(mock.requests.length, 1);
  });

  // 8. Transient failure retry with exponential backoff -> automatic SYNCED
  await test('Durable outbox retries temporary 503 with exponential backoff and marks SYNCED on recovery', async () => {
    const user = makeMockUser({
      id: 'usr-retry-01',
      user_id: 'TGL-STY11',
      name: 'Retry User',
      email: 'retry@theglossylooks.com',
      phone: '9000055555',
      role: 'stylist',
    });
    const mem = createInMemoryRepo([user]);
    let attempt = 0;
    const mock = createMockFetch(() => {
      attempt++;
      if (attempt === 1) {
        return { status: 503, body: { success: false, message: 'Gateway temporarily unavailable' } };
      }
      return {
        status: 200,
        body: { success: true, userId: '66666666-6666-4666-8666-666666666666', role: 'POS_BILLING', isNewUser: true },
      };
    });
    const deps = buildDeps(mem.repo, mock.fetchImpl, mem.getNowMs);

    const first = await syncUserToSmavAndPersist(user, { eventType: 'USER_CREATED', performedBy: 'Owner', deps });
    assert.equal(first.synced, false);
    assert.equal(first.syncStatus, 'PENDING');
    assert.ok(first.retryScheduledAt);
    assert.equal(mem.users[0].central_sync_status, 'PENDING');

    // Before 30s backoff elapses, worker must NOT claim it
    mem.advanceMs(SMAV_RETRY_BACKOFF_MS[0] - 5_000);
    const tooEarly = await processPendingSmavUserSyncOutbox({ deps });
    assert.equal(tooEarly.claimed, 0);

    // After backoff elapses, worker claims and succeeds
    mem.advanceMs(10_000);
    const recovered = await processPendingSmavUserSyncOutbox({ deps });
    assert.equal(recovered.claimed, 1);
    assert.equal(recovered.synced, 1);
    assert.equal(mem.users[0].central_sync_status, 'SYNCED');
    assert.equal(mem.users[0].central_auth_id, '66666666-6666-4666-8666-666666666666');
    assert.equal(mem.users[0].central_sync_error, null);
  });

  // 9. UUID Mismatch & 409 Conflict fail closed (never overwrite UUID or duplicate user)
  await test('Identity Conflict: UUID mismatch and 409 fail closed without overwriting central_auth_id', async () => {
    const renuka = makeMockUser({
      id: 'usr-renuka-01',
      user_id: 'TGL-STY03',
      name: 'Renuka',
      email: 'renuka@theglossylooks.com',
      phone: '9000066666',
      role: 'stylist',
      central_auth_id: '77777777-7777-4777-8777-777777777777',
    });
    const mem = createInMemoryRepo([renuka]);
    const mock = createMockFetch(() => ({
      status: 200,
      body: {
        success: true,
        userId: '88888888-8888-4888-8888-888888888888', // mismatched UUID!
        email: 'renuka@theglossylooks.com',
      },
    }));
    const deps = buildDeps(mem.repo, mock.fetchImpl, mem.getNowMs);

    const res = await syncUserToSmavAndPersist(renuka, { performedBy: 'Owner', deps });
    assert.equal(res.synced, false);
    assert.equal(res.syncStatus, 'FAILED');
    assert.equal(res.conflict, true);
    assert.equal(mem.users[0].central_auth_id, '77777777-7777-4777-8777-777777777777');
    assert.equal(mem.users[0].central_sync_status, 'FAILED');

    // Also test explicit 409 conflict + Retry Sync
    const mock409 = createMockFetch(() => ({
      status: 409,
      body: { success: false, conflict: true, message: 'Email already bound to another Central Auth UUID' },
    }));
    const retryRes = await retrySmavSyncForUser(renuka.id, 'Owner', buildDeps(mem.repo, mock409.fetchImpl, mem.getNowMs));
    assert.equal(retryRes.synced, false);
    assert.equal(retryRes.syncStatus, 'FAILED');
    assert.equal(retryRes.conflict, true);
  });

  // 10. Safe Initial Reconciliation (Renuka, Madu Mounika, SRIKANTH KAYIDAPURAM, Sharadha, SRIREDDY)
  await test('Safe Initial Reconciliation: dry-run audits accurately; apply syncs safe accounts and skips Renuka ambiguity', async () => {
    const seedUsers: User[] = [
      makeMockUser({
        id: 'u-mounika',
        user_id: 'TGL-OWN01',
        name: 'Madu Mounika',
        email: 'owner@theglossylooks.com',
        phone: '8985799459',
        role: 'owner',
        central_auth_id: 'aaaa1111-1111-4111-8111-111111111111',
        central_sync_status: 'SYNCED',
        central_last_synced_at: '2026-11-18T10:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
      }),
      makeMockUser({
        id: 'u-srikanth',
        user_id: 'TGL-MGR01',
        name: 'SRIKANTH KAYIDAPURAM',
        email: 'srikanth@theglossylooks.com',
        phone: '9000010002',
        role: 'manager',
        central_auth_id: 'bbbb2222-2222-4222-8222-222222222222',
        central_sync_status: 'PENDING',
        created_at: '2026-02-01T00:00:00.000Z',
      }),
      makeMockUser({
        id: 'u-sharadha',
        user_id: 'TGL-REC01',
        name: 'Sharadha',
        email: 'sharadha@theglossylooks.com',
        phone: '9000010003',
        role: 'receptionist',
        created_at: '2026-03-01T00:00:00.000Z',
      }),
      makeMockUser({
        id: 'u-srireddy',
        user_id: 'TGL-STY09',
        name: 'SRIREDDY',
        email: 'srireddy@theglossylooks.com',
        phone: '9000010004',
        role: 'stylist',
        created_at: '2026-11-10T00:00:00.000Z',
      }),
      makeMockUser({
        id: 'u-renuka',
        user_id: 'TGL-STY03',
        name: 'Renuka',
        email: 'renuka.new@theglossylooks.com',
        phone: '9000010005',
        role: 'stylist',
        central_auth_id: 'cccc3333-3333-4333-8333-333333333333',
        created_at: '2026-02-15T00:00:00.000Z',
      }),
    ];

    const seedStaff: Staff[] = [
      {
        id: 'stf-renuka',
        user_id: 'u-renuka',
        name: 'Renuka',
        role: 'Senior Beautician', // Job title (must NOT override RBAC role)
        phone: '9000010005',
        email: 'renuka.old@theglossylooks.com',
        central_auth_id: 'dddd4444-4444-4444-8444-444444444444', // Mismatched UUID!
        is_active: true,
        joining_date: '2026-02-15',
        salary_type: 'monthly',
        base_salary: 25000,
        commission_rate: 0,
        skills: [],
        working_hours: '10:00 AM - 8:00 PM',
        created_at: '2026-02-15T00:00:00.000Z',
      },
    ];

    const mem = createInMemoryRepo(seedUsers, seedStaff);
    let uuidSeq = 1;
    const mock = createMockFetch((req) => ({
      status: 200,
      body: {
        success: true,
        userId: req.body.userId || `9999000${uuidSeq++}-0000-4000-8000-000000000000`,
        email: req.body.email,
        role: req.body.role,
        isNewUser: !req.body.userId,
      },
    }));
    const deps = buildDeps(mem.repo, mock.fetchImpl, mem.getNowMs);

    // Dry-run audit makes ZERO HTTP calls
    const dryReport = await reconcileAdminUsersToSmav({ dryRun: true, performedBy: 'Owner', deps });
    assert.equal(mock.requests.length, 0);
    assert.equal(dryReport.summary.totalAdminUsers, 5);
    assert.equal(dryReport.summary.alreadySynced, 1);
    assert.equal(dryReport.summary.readyUpdateByUuid, 1);
    assert.equal(dryReport.summary.readyLinkOrCreate, 2);
    assert.equal(dryReport.summary.needsManualReview, 1);

    const renukaAudit = dryReport.users.find(u => u.localUserId === 'u-renuka');
    assert.equal(renukaAudit?.classification, 'NEEDS_MANUAL_REVIEW');
    assert.ok(renukaAudit?.anomalies.some(a => a.includes('Central Auth UUID mismatch')));

    // Safe apply skips Renuka and syncs the 4 unambiguous users
    const applyReport = await reconcileAdminUsersToSmav({ dryRun: false, performedBy: 'Owner', deps });
    assert.equal(applyReport.summary.skippedAmbiguous, 1);
    assert.equal(applyReport.summary.syncedNow, 4);
    assert.equal(mock.requests.length, 4);
    assert.ok(!mock.requests.some(r => r.body.externalStaffId === 'u-renuka'));

    // Renuka's original UUID was NOT overwritten and status is FAILED for investigation
    const renukaAfter = mem.users.find(u => u.id === 'u-renuka')!;
    assert.equal(renukaAfter.central_auth_id, 'cccc3333-3333-4333-8333-333333333333');
    assert.equal(renukaAfter.central_sync_status, 'FAILED');

    // SRIREDDY and Sharadha are now linked & SYNCED with POS_BILLING; Srikanth with ADMIN
    const srireddyReq = mock.requests.find(r => r.body.externalStaffId === 'u-srireddy');
    const srikanthReq = mock.requests.find(r => r.body.externalStaffId === 'u-srikanth');
    assert.equal(srireddyReq?.body.role, 'POS_BILLING');
    assert.equal(srikanthReq?.body.role, 'ADMIN');
  });

  // 11. Legacy users with UUID + central_last_synced_at MUST NOT be auto-marked SYNCED
  await test('No auto-SYNCED inference: legacy user with central_auth_id + central_last_synced_at stays PENDING until verified', async () => {
    const legacyUser = makeMockUser({
      id: 'usr-legacy-01',
      user_id: 'TGL-STY05',
      name: 'Legacy Stylist',
      email: 'legacy@theglossylooks.com',
      phone: '9000077777',
      role: 'stylist',
      central_auth_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      central_last_synced_at: '2026-09-01T10:00:00.000Z',
      // central_sync_status intentionally undefined (pre-Migration 024)
    });

    assert.equal(deriveUserSyncStatus(legacyUser), 'PENDING');

    const mem = createInMemoryRepo([legacyUser]);
    const mock = createMockFetch(() => ({ status: 200, body: { success: true } }));
    const dryReport = await reconcileAdminUsersToSmav({
      dryRun: true,
      performedBy: 'Owner',
      deps: buildDeps(mem.repo, mock.fetchImpl, mem.getNowMs),
    });
    assert.equal(mock.requests.length, 0);
    assert.equal(dryReport.summary.alreadySynced, 0);
    assert.equal(dryReport.summary.readyUpdateByUuid, 1);
    assert.equal(dryReport.users[0].currentSyncStatus, 'PENDING');
  });

  // 12. Atomic user+outbox creation/update & strict UUID immutability (Renuka protection)
  await test('Atomic user+outbox RPC flow creates single outbox row and protects existing Central Auth UUID from reassignment', async () => {
    const renuka = makeMockUser({
      id: 'usr-renuka-atomic',
      user_id: 'TGL-STY03',
      name: 'Renuka',
      email: 'renuka@theglossylooks.com',
      phone: '9000088888',
      role: 'stylist',
      central_auth_id: '77777777-7777-4777-8777-777777777777',
    });
    const mem = createInMemoryRepo([renuka]);
    const mock = createMockFetch((req) => ({
      status: 200,
      body: {
        success: true,
        userId: req.body.userId || 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        email: req.body.email,
        role: req.body.role,
        isNewUser: !req.body.userId,
      },
    }));
    const deps = buildDeps(mem.repo, mock.fetchImpl, mem.getNowMs);

    // Atomic create + executeCommittedOutboxSync
    const createdBundle = await mem.repo.createUserWithSmavOutbox(
      {
        user_id: 'TGL-STY12',
        name: 'Atomic Stylist',
        email: 'atomic@theglossylooks.com',
        phone: '9000088889',
        role: 'stylist',
        password_hash: 'scrypt$salt$hash',
        is_active: true,
        central_sync_status: 'PENDING',
      },
      {
        idempotency_key: 'atomic-create-001',
        event_type: 'USER_CREATED',
        action: 'upsert_user',
        max_attempts: 6,
      },
      'Owner'
    );
    assert.equal(createdBundle.atomic, true);
    assert.equal(mem.outbox.length, 1);

    const syncRes = await executeCommittedOutboxSync({
      outboxItem: createdBundle.outboxItem,
      created: createdBundle.created,
      user: createdBundle.user,
      transientInitialPassword: 'AtomicPass#2026',
      performedBy: 'Owner',
      deps,
    });
    assert.equal(syncRes.synced, true);
    assert.equal(syncRes.syncStatus, 'SYNCED');
    assert.equal(mem.outbox.length, 1);
    assert.ok(!JSON.stringify(mem.outbox).includes('AtomicPass#2026'));

    // Attempt atomic update trying to reassign Renuka's UUID -> MUST fail closed with 403 CentralAuthLinkForbiddenError!
    let forbiddenErr: unknown = null;
    try {
      await mem.repo.updateUserWithSmavOutbox(
        renuka.id,
        {
          name: 'Renuka Devi',
          central_auth_id: '99999999-9999-4999-8999-999999999999', // forbidden reassignment attempt
        },
        {
          idempotency_key: 'atomic-renuka-001',
          event_type: 'USER_UPDATED',
          action: 'update_user',
          max_attempts: 6,
        },
        'Owner'
      );
    } catch (err) {
      forbiddenErr = err;
    }
    assert.ok(isCentralAuthLinkForbiddenError(forbiddenErr), 'Expected 403 CentralAuthLinkForbiddenError on central_auth_id mutation');
    assert.equal((forbiddenErr as CentralAuthLinkForbiddenError).statusCode, 403);
    assert.equal(mem.users[0].name, 'Renuka'); // unchanged
    assert.equal(mem.users[0].central_auth_id, '77777777-7777-4777-8777-777777777777');

    // Legitimate ordinary update without central_auth_id succeeds while preserving Renuka's UUID
    const updatedBundle = await mem.repo.updateUserWithSmavOutbox(
      renuka.id,
      { name: 'Renuka Devi' },
      {
        idempotency_key: 'atomic-renuka-002',
        event_type: 'USER_UPDATED',
        action: 'update_user',
        max_attempts: 6,
      },
      'Owner'
    );
    assert.ok(updatedBundle);
    assert.equal(updatedBundle!.user.name, 'Renuka Devi');
    assert.equal(updatedBundle!.user.central_auth_id, '77777777-7777-4777-8777-777777777777');
    assert.equal(mem.users[0].central_auth_id, '77777777-7777-4777-8777-777777777777');
  });

  // 13. Bounded retries (max_attempts), stale-lock recovery & permanent 409 non-retry
  await test('Bounded retries enforce max_attempts, stale locks recover & exhaust cleanly, and 409 conflicts never auto-retry', async () => {
    const userA = makeMockUser({
      id: 'usr-bounded-a',
      user_id: 'TGL-STY20',
      name: 'Bounded User',
      email: 'bounded@theglossylooks.com',
      phone: '9000099991',
      role: 'stylist',
    });
    const userB = makeMockUser({
      id: 'usr-conflict-b',
      user_id: 'TGL-STY21',
      name: 'Conflict User',
      email: 'conflict@theglossylooks.com',
      phone: '9000099992',
      role: 'stylist',
    });
    const mem = createInMemoryRepo([userA, userB]);

    // Case A: Transient 503 with max_attempts = 3 -> fails permanently on attempt 3
    const mock503 = createMockFetch(() => ({
      status: 503,
      body: { success: false, message: 'Upstream unavailable' },
    }));
    const deps503 = buildDeps(mem.repo, mock503.fetchImpl, mem.getNowMs);
    const { item: boundedItem } = await mem.repo.enqueueSmavUserSyncEvent({
      idempotency_key: 'bounded-503-key',
      local_user_id: userA.id,
      event_type: 'USER_UPDATED',
      action: 'upsert_user',
      payload: { externalStaffId: userA.id, email: userA.email },
      performed_by: 'Owner',
      max_attempts: 3,
    });

    // Attempt 1
    const r1 = await executeCommittedOutboxSync({ outboxItem: boundedItem, created: true, user: userA, performedBy: 'Owner', deps: deps503 });
    assert.equal(r1.syncStatus, 'PENDING');
    assert.equal(mem.outbox[0].attempts, 1);

    // Attempt 2
    mem.advanceMs(SMAV_RETRY_BACKOFF_MS[0] + 1_000);
    const d2 = await processPendingSmavUserSyncOutbox({ deps: deps503 });
    assert.equal(d2.claimed, 1);
    assert.equal(d2.pending, 1);
    assert.equal(mem.outbox[0].attempts, 2);

    // Attempt 3 -> max_attempts reached -> permanent FAILED
    mem.advanceMs(SMAV_RETRY_BACKOFF_MS[1] + 1_000);
    const d3 = await processPendingSmavUserSyncOutbox({ deps: deps503 });
    assert.equal(d3.claimed, 1);
    assert.equal(d3.failed, 1);
    assert.equal(mem.outbox[0].status, 'FAILED');
    assert.equal(mem.outbox[0].attempts, 3);
    assert.equal(mem.users[0].central_sync_status, 'FAILED');

    // Attempt 4 -> must NOT be claimed again!
    mem.advanceMs(86_400_000);
    const d4 = await processPendingSmavUserSyncOutbox({ deps: deps503 });
    assert.equal(d4.claimed, 0);

    // Case B: Permanent 409 Conflict -> never retried automatically
    const mock409 = createMockFetch(() => ({
      status: 409,
      body: { success: false, conflict: true, message: 'Duplicate Central Auth email conflict' },
    }));
    const deps409 = buildDeps(mem.repo, mock409.fetchImpl, mem.getNowMs);
    const cRes = await syncUserToSmavAndPersist(userB, { eventType: 'USER_CREATED', performedBy: 'Owner', deps: deps409 });
    assert.equal(cRes.syncStatus, 'FAILED');
    assert.equal(cRes.conflict, true);
    mem.advanceMs(86_400_000);
    const drainAfter409 = await processPendingSmavUserSyncOutbox({ deps: deps409 });
    assert.equal(drainAfter409.claimed, 0);

    // Case C: Stale PROCESSING lock recovery (attempt 1 crashed -> recovered as attempt 2, then attempt 2 crash exhausts max_attempts = 2)
    const { item: staleItem } = await mem.repo.enqueueSmavUserSyncEvent({
      idempotency_key: 'stale-lock-key',
      local_user_id: userA.id,
      event_type: 'USER_UPDATED',
      action: 'upsert_user',
      payload: { externalStaffId: userA.id, email: userA.email },
      performed_by: 'Owner',
      max_attempts: 2,
    });
    // Worker 1 claimed attempt 1 (attempts = 1) and crashed while PROCESSING
    const claimedOnce = await mem.repo.claimSmavUserSyncEventById(staleItem.id);
    assert.equal(claimedOnce?.status, 'PROCESSING');
    assert.equal(claimedOnce?.attempts, 1);

    // Advance 6 minutes (> 5 min stale threshold): Worker 2 recovers stale lock as attempt 2 (max_attempts = 2)
    mem.advanceMs(6 * 60_000);
    const recoveredDrain = await processPendingSmavUserSyncOutbox({ deps: deps503, staleLockMinutes: 5 });
    assert.equal(recoveredDrain.claimed, 1);
    assert.equal(recoveredDrain.failed, 1); // 503 on attempt 2/2 -> permanent FAILED (exact 2 attempts, no double-counting)
    const staleAfter = await mem.repo.getSmavUserSyncOutboxById(staleItem.id);
    assert.equal(staleAfter?.status, 'FAILED');
    assert.equal(staleAfter?.attempts, 2);
    assert.equal(staleAfter?.locked_at, null);

    // Case D: Stale PROCESSING lock that crashed on its FINAL attempt (attempts == max_attempts) fails directly without another HTTP call
    const { item: finalStaleItem } = await mem.repo.enqueueSmavUserSyncEvent({
      idempotency_key: 'stale-final-attempt-key',
      local_user_id: userA.id,
      event_type: 'USER_UPDATED',
      action: 'upsert_user',
      payload: { externalStaffId: userA.id, email: userA.email },
      performed_by: 'Owner',
      max_attempts: 2,
    });
    await mem.repo.updateSmavUserSyncEvent(finalStaleItem.id, {
      status: 'PROCESSING',
      attempts: 2, // already on final attempt 2/2 when worker crashed
      locked_at: new Date(mem.getNowMs()).toISOString(),
    });
    mem.advanceMs(6 * 60_000);
    const reqCountBeforeFinalStale = mock503.requests.length;
    const finalStaleDrain = await processPendingSmavUserSyncOutbox({ deps: deps503, staleLockMinutes: 5 });
    assert.equal(finalStaleDrain.claimed, 0);
    assert.equal(mock503.requests.length, reqCountBeforeFinalStale); // zero extra HTTP calls
    const finalStaleAfter = await mem.repo.getSmavUserSyncOutboxById(finalStaleItem.id);
    assert.equal(finalStaleAfter?.status, 'FAILED');
    assert.equal(finalStaleAfter?.attempts, 2); // never exceeds max_attempts
    assert.equal(finalStaleAfter?.locked_at, null);
  });

  // 14. Nested JSON secret guard & upstream password/JWT redaction in synchronous password reset
  await test('Nested JSON secrets stripped; synchronous password reset redacts echoed password/JWT and never creates PENDING row', async () => {
    const nestedClean = sanitizeOutboxPayload({
      email: 'test@theglossylooks.com',
      items: [
        { role: 'POS_BILLING', deep: { newPassword: 'LeakedPassword#99', bearerToken: 'tok_xyz', safe: true } },
      ],
      credentials: { private_key: '-----BEGIN KEY-----' },
    });
    assert.equal(nestedClean.items[0].deep.newPassword, undefined);
    assert.equal(nestedClean.items[0].deep.bearerToken, undefined);
    assert.equal(nestedClean.items[0].deep.safe, true);
    assert.equal(nestedClean.credentials, undefined);

    const user = makeMockUser({
      id: 'usr-pwd-sync',
      user_id: 'TGL-MGR05',
      name: 'Sync Manager',
      email: 'syncmgr@theglossylooks.com',
      phone: '9000099995',
      role: 'manager',
      central_auth_id: '12121212-1212-4121-8121-121212121212',
    });
    const mem = createInMemoryRepo([user]);
    const secretPwd = 'UltraSecretReset#2026';
    const fakeJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const mockEchoFail = createMockFetch(() => ({
      status: 500,
      body: {
        success: false,
        message: `Rejected password ${secretPwd} with Bearer ${fakeJwt} and token=abc123456`,
      },
    }));

    const res = await resetSmavUserPasswordAndPersist(user, secretPwd, {
      performedBy: 'Owner',
      deps: buildDeps(mem.repo, mockEchoFail.fetchImpl, mem.getNowMs),
    });

    assert.equal(res.synced, false);
    assert.equal(res.syncStatus, 'FAILED');
    assert.equal(res.passwordResetRequired, true);
    assert.ok(!String(res.error).includes(secretPwd));
    assert.ok(!String(res.error).includes(fakeJwt));
    assert.ok(!String(res.error).includes('abc123456'));

    // Strictly synchronous audit row: NEVER PENDING, attempts=1, max_attempts=1, zero secrets anywhere
    assert.equal(mem.outbox.length, 1);
    assert.equal(mem.outbox[0].status, 'FAILED');
    assert.equal(mem.outbox[0].attempts, 1);
    assert.equal(mem.outbox[0].max_attempts, 1);
    const serializedOutbox = JSON.stringify(mem.outbox[0]);
    const serializedUser = JSON.stringify(mem.users[0]);
    assert.ok(!serializedOutbox.includes(secretPwd));
    assert.ok(!serializedOutbox.includes(fakeJwt));
    assert.ok(!serializedUser.includes(secretPwd));
    assert.ok(!serializedUser.includes(fakeJwt));
  });

  // 15. Safe Idempotency: pre-mutation replay & payload-mismatch rejection (409)
  await test('Safe Idempotency: replaying a key never mutates user; mismatched payload raises 409 conflict without side effects', async () => {
    const stylist = makeMockUser({
      id: 'usr-safe-idem',
      user_id: 'TGL-STY30',
      name: 'Original Name',
      email: 'orig@theglossylooks.com',
      phone: '9000011122',
      role: 'stylist',
      central_auth_id: '13131313-1313-4131-8131-131313131313',
    });
    const mem = createInMemoryRepo([stylist]);
    const mock = createMockFetch((req) => ({
      status: 200,
      body: {
        success: true,
        userId: req.body.userId || '13131313-1313-4131-8131-131313131313',
        email: req.body.email,
        role: req.body.role,
      },
    }));
    const deps = buildDeps(mem.repo, mock.fetchImpl, mem.getNowMs);

    // First update with explicit key succeeds and syncs
    const u1 = await mem.repo.updateUserWithSmavOutbox(
      stylist.id,
      { name: 'Updated Name', role: 'manager' },
      { idempotency_key: 'idem-upd-001', event_type: 'ROLE_CHANGED', action: 'update_user', max_attempts: 6 },
      'Owner'
    );
    assert.ok(u1);
    assert.equal(u1!.created, true);
    const s1 = await executeCommittedOutboxSync({ outboxItem: u1!.outboxItem, created: u1!.created, user: u1!.user, performedBy: 'Owner', deps });
    assert.equal(s1.synced, true);
    assert.equal(mock.requests.length, 1);

    // Replaying exact same key + payload returns existing state without creating a new event or calling SMAV again
    const u2 = await mem.repo.updateUserWithSmavOutbox(
      stylist.id,
      { name: 'Updated Name', role: 'manager' },
      { idempotency_key: 'idem-upd-001', event_type: 'ROLE_CHANGED', action: 'update_user', max_attempts: 6 },
      'Owner'
    );
    assert.ok(u2);
    assert.equal(u2!.created, false);
    assert.equal(u2!.idempotentReplay, true);
    assert.equal(mem.outbox.length, 1);
    const s2 = await executeCommittedOutboxSync({ outboxItem: u2!.outboxItem, created: u2!.created, user: u2!.user, performedBy: 'Owner', deps });
    assert.equal(s2.status, 'idempotent_replay');
    assert.equal(mock.requests.length, 1);

    // Reusing the SAME key with a DIFFERENT payload MUST throw 409 IdempotencyKeyConflictError and MUST NOT mutate the user!
    let caughtConflict: unknown = null;
    try {
      await mem.repo.updateUserWithSmavOutbox(
        stylist.id,
        { name: 'Hijacked Name', role: 'owner' },
        { idempotency_key: 'idem-upd-001', event_type: 'ROLE_CHANGED', action: 'update_user', max_attempts: 6 },
        'Owner'
      );
    } catch (err) {
      caughtConflict = err;
    }
    assert.ok(isIdempotencyKeyConflictError(caughtConflict), 'Expected IdempotencyKeyConflictError on payload mismatch');
    assert.equal((caughtConflict as IdempotencyKeyConflictError).statusCode, 409);
    assert.equal(mem.users[0].name, 'Updated Name'); // untouched!
    assert.equal(mem.users[0].role, 'manager'); // untouched!
    assert.equal(mem.outbox.length, 1);
  });

  // 16. Operational staff preservation & zero fabricated defaults
  await test('Staff Mirror Safety: createUser does not fabricate operational staff rows; updateUser preserves staff title/salary/skills/UUID', async () => {
    const renukaUser = makeMockUser({
      id: 'usr-renuka-preserve',
      user_id: 'TGL-STY03',
      name: 'Renuka',
      email: 'renuka@theglossylooks.com',
      phone: '9000012345',
      role: 'stylist',
      central_auth_id: '77777777-7777-4777-8777-777777777777',
    });
    const renukaStaff: Staff = {
      id: 'stf-renuka-preserve',
      user_id: renukaUser.id,
      name: 'Renuka',
      role: 'Senior Bridal & Skin Specialist',
      phone: '9000012345',
      email: 'renuka@theglossylooks.com',
      joining_date: '2025-05-01',
      salary_type: 'monthly',
      base_salary: 42000,
      commission_rate: 15,
      skills: ['Bridal Makeup', 'HydraFacial'],
      working_hours: '09:30 AM - 07:30 PM',
      is_active: true,
      central_auth_id: '77777777-7777-4777-8777-777777777777',
      created_at: '2025-05-01T00:00:00.000Z',
    };
    const mem = createInMemoryRepo([renukaUser], [renukaStaff]);

    // Creating a new admin user MUST NOT invent an operational staff row
    const createdBundle = await mem.repo.createUserWithSmavOutbox(
      {
        user_id: 'TGL-REC99',
        name: 'Front Desk Only',
        email: 'frontdesk@theglossylooks.com',
        phone: '9000054321',
        role: 'receptionist',
        password_hash: 'scrypt$s$h',
        is_active: true,
        central_sync_status: 'PENDING',
      },
      { idempotency_key: 'no-fake-staff-001', event_type: 'USER_CREATED', action: 'upsert_user' },
      'Owner'
    );
    assert.equal(mem.staff.length, 1); // Still only Renuka's real staff row!
    assert.ok(createdBundle.user.id);

    // Attempting to include central_auth_id in ordinary update MUST throw 403 and leave both user and staff untouched
    let staffUuidErr: unknown = null;
    try {
      await mem.repo.updateUserWithSmavOutbox(
        renukaUser.id,
        { role: 'manager', phone: '9000099988', central_auth_id: '99999999-9999-4999-8999-999999999999' },
        { idempotency_key: 'preserve-staff-000', event_type: 'ROLE_CHANGED', action: 'update_user' },
        'Owner'
      );
    } catch (err) {
      staffUuidErr = err;
    }
    assert.ok(isCentralAuthLinkForbiddenError(staffUuidErr));
    assert.equal(mem.staff[0].central_auth_id, '77777777-7777-4777-8777-777777777777');

    // Updating Renuka's RBAC role & phone (without central_auth_id) mirrors phone while preserving job title, salary, commission, skills, hours, and UUID
    await mem.repo.updateUserWithSmavOutbox(
      renukaUser.id,
      { role: 'manager', phone: '9000099988' },
      { idempotency_key: 'preserve-staff-001', event_type: 'ROLE_CHANGED', action: 'update_user' },
      'Owner'
    );
    assert.equal(mem.staff[0].phone, '9000099988');
    assert.equal(mem.staff[0].role, 'Senior Bridal & Skin Specialist');
    assert.equal(mem.staff[0].base_salary, 42000);
    assert.equal(mem.staff[0].commission_rate, 15);
    assert.deepEqual(mem.staff[0].skills, ['Bridal Makeup', 'HydraFacial']);
    assert.equal(mem.staff[0].working_hours, '09:30 AM - 07:30 PM');
    assert.equal(mem.staff[0].central_auth_id, '77777777-7777-4777-8777-777777777777');
  });

  // 17. Synchronous Password Reset idempotency replay & cross-user conflict rejection
  await test('Password Reset Idempotency: identical replay avoids duplicate SMAV call; cross-user reuse throws 409 conflict', async () => {
    const user1 = makeMockUser({
      id: 'usr-pwd-idem-1',
      user_id: 'TGL-MGR11',
      name: 'Manager One',
      email: 'mgr1@theglossylooks.com',
      phone: '9000011111',
      role: 'manager',
      central_auth_id: '14141414-1414-4141-8141-141414141414',
    });
    const user2 = makeMockUser({
      id: 'usr-pwd-idem-2',
      user_id: 'TGL-STY12',
      name: 'Stylist Two',
      email: 'sty2@theglossylooks.com',
      phone: '9000022222',
      role: 'stylist',
      central_auth_id: '15151515-1515-4151-8151-151515151515',
    });
    const mem = createInMemoryRepo([user1, user2]);
    const mock = createMockFetch(() => ({
      status: 200,
      body: { success: true, userId: user1.central_auth_id, mustChangePassword: true },
    }));
    const deps = buildDeps(mem.repo, mock.fetchImpl, mem.getNowMs);

    const first = await resetSmavUserPasswordAndPersist(user1, 'ValidReset#2026', {
      idempotencyKey: 'pwd-reset-idem-001',
      performedBy: 'Owner',
      deps,
    });
    assert.equal(first.synced, true);
    assert.equal(mock.requests.length, 1);

    // Same user + same key -> clean idempotent_replay with zero extra SMAV calls
    const replay = await resetSmavUserPasswordAndPersist(user1, 'ValidReset#2026', {
      idempotencyKey: 'pwd-reset-idem-001',
      performedBy: 'Owner',
      deps,
    });
    assert.equal(replay.synced, true);
    assert.equal(replay.status, 'idempotent_replay');
    assert.equal(mock.requests.length, 1);

    // Different user + same key -> MUST throw 409 IdempotencyKeyConflictError and make zero SMAV calls
    let conflictErr: unknown = null;
    try {
      await resetSmavUserPasswordAndPersist(user2, 'AnotherReset#2026', {
        idempotencyKey: 'pwd-reset-idem-001',
        performedBy: 'Owner',
        deps,
      });
    } catch (err) {
      conflictErr = err;
    }
    assert.ok(isIdempotencyKeyConflictError(conflictErr), 'Expected 409 conflict on cross-user password reset key reuse');
    assert.equal(mock.requests.length, 1);
  });

  // 18. Static SQL safety verification for Migration 024 (all 7 final production-safety invariants)
  await test('Migration 024 SQL satisfies all production-safety invariants (audit-preserving deletion, tamper-proof audit, verified linking, idempotency locks)', () => {
    const sqlPath = path.resolve('database/migrations/024_smav_user_sync_outbox.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Forbidden anti-patterns
    assert.ok(!/SET\s+central_sync_status\s*=\s*'SYNCED'/i.test(sql), 'Migration 024 must not backfill SYNCED status');
    assert.ok(!/CREATE\s+OR\s+REPLACE\s+VIEW\s+public\.vw_smav_staff_auth_status/i.test(sql), 'Migration 024 must not replace vw_smav_staff_auth_status');
    assert.ok(!sql.includes('app.allow_central_auth_id_reassign'), 'Migration 024 must not allow bare session-setting UUID override');
    assert.ok(!sql.includes('Senior Bridal Stylist'), 'Migration 024 must not fabricate default staff job titles');
    assert.ok(!sql.includes('35000'), 'Migration 024 must not fabricate default staff salary');
    assert.ok(!/EXCEPTION\s+WHEN\s+others/i.test(sql), 'Migration 024 must not silently swallow DB exceptions');
    assert.ok(!/REFERENCES\s+public\.users\(id\)\s+ON\s+DELETE\s+CASCADE/i.test(sql), 'Outbox MUST NOT use ON DELETE CASCADE');
    assert.ok(!/GRANT\s+[^;]*INSERT[^;]*ON\s+public\.smav_central_auth_reconciliation_audit\s+TO\s+service_role/i.test(sql), 'service_role must NOT have direct INSERT on reconciliation audit');
    assert.ok(!/GRANT\s+[^;]*DELETE[^;]*ON\s+public\.smav_user_sync_outbox\s+TO\s+service_role/i.test(sql), 'service_role must NOT have DELETE on outbox');
    assert.ok(!sql.includes("v_source NOT IN ('smav_sync_response', 'smav_webhook')"), 'Webhook references must not be accepted as Central Auth link evidence');

    // Required production-safety guarantees
    assert.ok(sql.includes('ON DELETE SET NULL'));
    assert.ok(sql.includes('audit_local_user_id'));
    assert.ok(sql.includes('trg_smav_outbox_no_delete'));
    assert.ok(sql.includes('trg_smav_outbox_no_truncate'));
    assert.ok(sql.includes('smav_central_auth_reconciliation_audit'));
    assert.ok(sql.includes('trg_smav_reconcile_audit_immutable'));
    assert.ok(sql.includes('trg_smav_reconcile_audit_no_truncate'));
    assert.ok(sql.includes('trg_smav_reconcile_audit_insert_gate'));
    assert.ok(sql.includes('PG_CONTEXT'));
    assert.ok(sql.includes('txid_current()'));
    assert.ok(sql.includes('smav_link_verified_central_auth_id'));
    assert.ok(sql.includes('smav_admin_reconcile_central_auth_id'));
    assert.ok(sql.includes('CENTRAL_AUTH_LINK_FORBIDDEN'));
    assert.ok(sql.includes('p_credential_mode'));
    assert.ok(sql.includes('request_fingerprint'));
    assert.ok(sql.includes('pg_advisory_xact_lock'));
    assert.ok(sql.includes('IDEMPOTENCY_KEY_CONFLICT'));
    assert.ok(sql.includes('smav_claim_single_user_sync_event'));
    assert.ok(sql.includes('pg_catalog.pg_depend'));
    assert.ok(sql.includes('smav_jsonb_contains_secret_key'));
    assert.ok(sql.includes('smav_text_contains_secret'));
    assert.ok(sql.includes('smav_protect_central_auth_id'));
    assert.ok(sql.includes('smav_create_user_and_enqueue_sync'));
    assert.ok(sql.includes('smav_update_user_and_enqueue_sync'));
    assert.ok(sql.includes('smav_claim_due_user_sync_events'));
    assert.ok(sql.includes('vw_smav_user_sync_status'));
    assert.ok(sql.includes('SET search_path = pg_catalog, public'));
    assert.ok(sql.includes('service_role'));
  });

  // 19. Create-user password idempotency without storing plaintext or hash in outbox
  await test('Create-user idempotency rejects different passwords & credential-mode mismatches with 409 without storing password/hash in outbox', async () => {
    const hashPwd = (pwd: string) => {
      const salt = crypto.randomBytes(16).toString('hex');
      const derived = crypto.scryptSync(pwd, salt, 64).toString('hex');
      return `scrypt$${salt}$${derived}`;
    };
    const verifyPwd = (stored: string, supplied: string) => {
      const [, salt, hex] = stored.split('$');
      const derived = crypto.scryptSync(supplied, salt, 64);
      return crypto.timingSafeEqual(Buffer.from(hex, 'hex'), derived);
    };

    const mem = createInMemoryRepo([]);
    const pwdA = 'CreateSecret#A2026';
    const pwdB = 'DifferentSecret#B2026';
    const hashedA = hashPwd(pwdA);

    const first = await mem.repo.createUserWithSmavOutbox(
      {
        user_id: 'TGL-STY55',
        name: 'Password Guard Stylist',
        email: 'pwdguard@theglossylooks.com',
        phone: '9000055555',
        role: 'stylist',
        password_hash: hashedA,
        is_active: true,
        central_sync_status: 'PENDING',
      },
      {
        idempotency_key: 'idem-create-pwd-001',
        event_type: 'USER_CREATED',
        action: 'upsert_user',
        credential_mode: 'explicit',
        verifyReplayPassword: (stored) => verifyPwd(stored, pwdA),
      },
      'Owner'
    );
    assert.equal(first.created, true);
    assert.equal(mem.users.length, 1);

    // Outbox payload & fingerprint MUST contain ZERO plaintext password and ZERO password hash
    const serializedOutbox = JSON.stringify(mem.outbox[0]);
    assert.ok(!serializedOutbox.includes(pwdA));
    assert.ok(!serializedOutbox.includes(hashedA));
    assert.ok(!serializedOutbox.includes('scrypt$'));

    // Exact replay with SAME password succeeds idempotently
    const sameReplay = await mem.repo.createUserWithSmavOutbox(
      {
        user_id: 'TGL-STY55',
        name: 'Password Guard Stylist',
        email: 'pwdguard@theglossylooks.com',
        phone: '9000055555',
        role: 'stylist',
        password_hash: hashPwd(pwdA), // fresh salt, same password
        is_active: true,
        central_sync_status: 'PENDING',
      },
      {
        idempotency_key: 'idem-create-pwd-001',
        event_type: 'USER_CREATED',
        action: 'upsert_user',
        credential_mode: 'explicit',
        verifyReplayPassword: (stored) => verifyPwd(stored, pwdA),
      },
      'Owner'
    );
    assert.equal(sameReplay.created, false);
    assert.equal(sameReplay.idempotentReplay, true);
    assert.equal(sameReplay.user.id, first.user.id);

    // Replay with DIFFERENT password under same key MUST reject with 409 IdempotencyKeyConflictError!
    let diffPwdErr: unknown = null;
    try {
      await mem.repo.createUserWithSmavOutbox(
        {
          user_id: 'TGL-STY55',
          name: 'Password Guard Stylist',
          email: 'pwdguard@theglossylooks.com',
          phone: '9000055555',
          role: 'stylist',
          password_hash: hashPwd(pwdB),
          is_active: true,
          central_sync_status: 'PENDING',
        },
        {
          idempotency_key: 'idem-create-pwd-001',
          event_type: 'USER_CREATED',
          action: 'upsert_user',
          credential_mode: 'explicit',
          verifyReplayPassword: (stored) => verifyPwd(stored, pwdB),
        },
        'Owner'
      );
    } catch (err) {
      diffPwdErr = err;
    }
    assert.ok(isIdempotencyKeyConflictError(diffPwdErr), 'Expected 409 conflict when replaying create-user key with different password');

    // Replay switching from explicit password to generated (omitted) password MUST also reject with 409!
    let modeErr: unknown = null;
    try {
      await mem.repo.createUserWithSmavOutbox(
        {
          user_id: 'TGL-STY55',
          name: 'Password Guard Stylist',
          email: 'pwdguard@theglossylooks.com',
          phone: '9000055555',
          role: 'stylist',
          password_hash: hashPwd('RandomGen#999'),
          is_active: true,
          central_sync_status: 'PENDING',
        },
        {
          idempotency_key: 'idem-create-pwd-001',
          event_type: 'USER_CREATED',
          action: 'upsert_user',
          credential_mode: 'generated',
        },
        'Owner'
      );
    } catch (err) {
      modeErr = err;
    }
    assert.ok(isIdempotencyKeyConflictError(modeErr), 'Expected 409 conflict on explicit vs generated credential_mode mismatch');
    assert.equal(mem.users.length, 1);
  });

  // 20. Forbid ordinary NULL -> UUID central_auth_id assignment; require verified linking
  await test('Ordinary updates cannot assign central_auth_id even when NULL; verified SMAV sync links via linkVerifiedCentralAuthId', async () => {
    const unlinked = makeMockUser({
      id: 'usr-unlinked-null',
      user_id: 'TGL-STY60',
      name: 'Unlinked Stylist',
      email: 'unlinked60@theglossylooks.com',
      phone: '9000060000',
      role: 'stylist',
      central_auth_id: undefined, // currently NULL
    });
    const mem = createInMemoryRepo([unlinked]);

    // 1. Ordinary updateUser attempting NULL -> arbitrary UUID MUST fail with 403
    let err1: unknown = null;
    try {
      await mem.repo.updateUser(
        unlinked.id,
        { central_auth_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        'Owner'
      );
    } catch (err) {
      err1 = err;
    }
    assert.ok(isCentralAuthLinkForbiddenError(err1), 'Expected 403 when ordinary updateUser assigns central_auth_id from NULL');
    assert.equal(mem.users[0].central_auth_id, undefined);

    // 2. Ordinary updateUserWithSmavOutbox attempting NULL -> arbitrary UUID MUST fail with 403
    let err2: unknown = null;
    try {
      await mem.repo.updateUserWithSmavOutbox(
        unlinked.id,
        { central_auth_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        { idempotency_key: 'forbid-null-link-001', event_type: 'USER_UPDATED', action: 'upsert_user' },
        'Owner'
      );
    } catch (err) {
      err2 = err;
    }
    assert.ok(isCentralAuthLinkForbiddenError(err2), 'Expected 403 when updateUserWithSmavOutbox assigns central_auth_id from NULL');
    assert.equal(mem.users[0].central_auth_id, undefined);

    // 3. linkVerifiedCentralAuthId with fabricated/unverified outbox evidence MUST fail with 403
    let err3: unknown = null;
    try {
      await mem.repo.linkVerifiedCentralAuthId({
        local_user_id: unlinked.id,
        verified_central_auth_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        verification_source: 'smav_sync_response',
        evidence_ref: 'outbox-fake-999',
        performed_by: 'Attacker',
      });
    } catch (err) {
      err3 = err;
    }
    assert.ok(isCentralAuthLinkForbiddenError(err3), 'Expected 403 when linkVerifiedCentralAuthId lacks verified SYNCED outbox evidence');
    assert.equal(mem.users[0].central_auth_id, undefined);

    // 4. A webhook reference alone MUST never establish the Central Auth identity link.
    let webhookErr: unknown = null;
    try {
      await mem.repo.linkVerifiedCentralAuthId({
        local_user_id: unlinked.id,
        verified_central_auth_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        verification_source: 'smav_webhook',
        evidence_ref: 'fabricated-webhook-event',
        performed_by: 'SMAV Central Portal',
      } as any);
    } catch (err) {
      webhookErr = err;
    }
    assert.ok(isCentralAuthLinkForbiddenError(webhookErr), 'Expected 403 when webhook text is used as Central Auth link evidence');
    assert.equal(mem.users[0].central_auth_id, undefined);

    // 5. Verified SMAV sync response persists SYNCED outbox row and links via linkVerifiedCentralAuthId
    const verifiedUuid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const mock = createMockFetch(() => ({
      status: 200,
      body: { success: true, userId: verifiedUuid, email: unlinked.email, role: 'POS_BILLING', isNewUser: true },
    }));
    const res = await syncUserToSmavAndPersist(unlinked, {
      eventType: 'USER_CREATED',
      performedBy: 'Owner',
      deps: buildDeps(mem.repo, mock.fetchImpl, mem.getNowMs),
    });
    assert.equal(res.synced, true);
    assert.equal(mem.users[0].central_auth_id, verifiedUuid);
  });

  // 21. Audit-preserving deletion policy (ON DELETE SET NULL + audit_local_user_id)
  await test('Audit-preserving user deletion retains historical outbox evidence & worker fails orphaned rows cleanly', async () => {
    const doomed = makeMockUser({
      id: 'usr-audit-del-01',
      user_id: 'TGL-STY70',
      name: 'Deleted Stylist',
      email: 'deleted70@theglossylooks.com',
      phone: '9000070000',
      role: 'stylist',
    });
    const mem = createInMemoryRepo([doomed]);

    const { item } = await mem.repo.enqueueSmavUserSyncEvent({
      idempotency_key: 'audit-del-outbox-001',
      local_user_id: doomed.id,
      event_type: 'USER_UPDATED',
      action: 'upsert_user',
      payload: { externalStaffId: doomed.id, email: doomed.email },
      performed_by: 'Owner',
    });
    assert.equal(item.local_user_id, doomed.id);
    assert.equal(item.audit_local_user_id, doomed.id);

    // Simulate hard deletion of user row -> ON DELETE SET NULL preserves outbox row + audit_local_user_id
    mem.simulateHardDeleteUser(doomed.id);
    assert.equal(mem.users.length, 0);
    assert.equal(mem.outbox.length, 1);
    assert.equal(mem.outbox[0].local_user_id, null);
    assert.equal(mem.outbox[0].audit_local_user_id, doomed.id);

    // Worker drain MUST mark orphaned PENDING row FAILED without calling SMAV or deleting audit row
    const mockNever = createMockFetch(() => ({ status: 200, body: { success: true } }));
    const drain = await processPendingSmavUserSyncOutbox({
      deps: buildDeps(mem.repo, mockNever.fetchImpl, mem.getNowMs),
    });
    assert.equal(drain.claimed, 0);
    assert.equal(mockNever.requests.length, 0);
    assert.equal(mem.outbox.length, 1);
    assert.equal(mem.outbox[0].status, 'FAILED');
    assert.equal(mem.outbox[0].audit_local_user_id, doomed.id);

    // Audit query by original localUserId still finds preserved historical row
    const history = await mem.repo.getSmavUserSyncOutbox({ localUserId: doomed.id });
    assert.equal(history.length, 1);
    assert.equal(history[0].id, item.id);
  });

  // 22. SupabaseSalonRepository fail-closed behavior & exact Migration 024 RPC signature alignment
  await test('SupabaseSalonRepository fails closed with 503 Migration024RequiredError (zero non-atomic fallbacks) and matches Migration 024 RPC signatures 1-for-1', async () => {
    const tableWrites: string[] = [];
    const rpcCalls: Array<{ fn: string; params: Record<string, any> }> = [];

    // Part A: Missing Migration 024 -> every SMAV method MUST throw 503 Migration024RequiredError with ZERO table writes!
    const missingMigrationClient: any = {
      rpc: async (fn: string, params: Record<string, any>) => {
        rpcCalls.push({ fn, params });
        return {
          data: null,
          error: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` },
        };
      },
      from: (table: string) => {
        const missingTableResult = {
          data: null,
          error: { code: '42P01', message: `relation "public.${table}" does not exist` },
        };
        const builder: any = {
          insert: () => {
            if (table === 'users' || table === 'staff') tableWrites.push(`insert:${table}`);
            return builder;
          },
          update: () => {
            if (table === 'users' || table === 'staff') tableWrites.push(`update:${table}`);
            return builder;
          },
          select: () => builder,
          eq: () => builder,
          or: () => builder,
          order: () => builder,
          limit: () => Promise.resolve(missingTableResult),
          single: () => Promise.resolve(missingTableResult),
          maybeSingle: () => Promise.resolve(missingTableResult),
          then: (resolve: any) => Promise.resolve(missingTableResult).then(resolve),
        };
        return builder;
      },
    };

    const failClosedRepo = new SupabaseSalonRepository('http://offline.local', 'test-key', missingMigrationClient);

    const expect503 = async (label: string, fn: () => Promise<any>) => {
      let caught: unknown = null;
      try {
        await fn();
      } catch (err) {
        caught = err;
      }
      assert.ok(isMigration024RequiredError(caught), `${label}: expected Migration024RequiredError, got ${caught}`);
      assert.equal((caught as Migration024RequiredError).statusCode, 503, `${label}: expected statusCode 503`);
    };

    await expect503('createUserWithSmavOutbox', () =>
      failClosedRepo.createUserWithSmavOutbox(
        {
          user_id: 'TGL-STY88',
          name: 'Fail Closed User',
          email: 'failclosed@theglossylooks.com',
          phone: '9000088888',
          role: 'stylist',
          password_hash: 'scrypt$s$h',
          is_active: true,
        },
        {
          idempotency_key: 'fc-create-001',
          event_type: 'USER_CREATED',
          action: 'upsert_user',
          credential_mode: 'explicit',
        },
        'Owner'
      )
    );
    await expect503('updateUserWithSmavOutbox', () =>
      failClosedRepo.updateUserWithSmavOutbox(
        '00000000-0000-4000-8000-000000000001',
        { name: 'Updated' },
        { idempotency_key: 'fc-upd-001', event_type: 'USER_UPDATED', action: 'update_user' },
        'Owner'
      )
    );
    await expect503('enqueueSmavUserSyncEvent', () =>
      failClosedRepo.enqueueSmavUserSyncEvent({
        idempotency_key: 'fc-enq-001',
        local_user_id: '00000000-0000-4000-8000-000000000001',
        event_type: 'USER_UPDATED',
        action: 'update_user',
        payload: { email: 'a@b.com' },
      })
    );
    await expect503('claimSmavUserSyncEventById', () =>
      failClosedRepo.claimSmavUserSyncEventById('00000000-0000-4000-8000-000000000002')
    );
    await expect503('claimDueSmavUserSyncEvents', () => failClosedRepo.claimDueSmavUserSyncEvents(10, 5));
    await expect503('linkVerifiedCentralAuthId', () =>
      failClosedRepo.linkVerifiedCentralAuthId({
        local_user_id: '00000000-0000-4000-8000-000000000001',
        verified_central_auth_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        verification_source: 'smav_sync_response',
        evidence_ref: '00000000-0000-4000-8000-000000000003',
        performed_by: 'SMAV Sync',
      })
    );
    await expect503('getSmavUserSyncOutbox', () => failClosedRepo.getSmavUserSyncOutbox());
    await expect503('getSmavUserSyncOutboxByIdempotencyKey', () =>
      failClosedRepo.getSmavUserSyncOutboxByIdempotencyKey('fc-key-001')
    );
    await expect503('recordSmavSyncAuditEvent', () =>
      failClosedRepo.recordSmavSyncAuditEvent({
        idempotency_key: 'fc-audit-001',
        local_user_id: '00000000-0000-4000-8000-000000000001',
        event_type: 'PASSWORD_RESET',
        action: 'reset_password',
        payload: { email: 'a@b.com' },
        status: 'SYNCED',
      })
    );

    // Zero non-atomic fallback writes to users or staff!
    assert.deepEqual(tableWrites, [], 'Missing Migration 024 MUST NOT fall back to direct users/staff writes');

    // Part B: Verify every RPC name & parameter list matches Migration 024 SQL 1-for-1
    const sql = fs.readFileSync(path.resolve('database/migrations/024_smav_user_sync_outbox.sql'), 'utf8');
    const byFn = new Map(rpcCalls.map(c => [c.fn, Object.keys(c.params).sort()]));

    const expectedSignatures: Record<string, string[]> = {
      smav_create_user_and_enqueue_sync: [
        'p_action',
        'p_branch_id',
        'p_credential_mode',
        'p_email',
        'p_event_type',
        'p_idempotency_key',
        'p_is_active',
        'p_max_attempts',
        'p_name',
        'p_password_hash',
        'p_performed_by',
        'p_phone',
        'p_role',
        'p_user_code',
        'p_username',
      ],
      smav_update_user_and_enqueue_sync: [
        'p_action',
        'p_event_type',
        'p_idempotency_key',
        'p_local_user_id',
        'p_max_attempts',
        'p_performed_by',
        'p_updates',
      ],
      smav_enqueue_user_sync_event: [
        'p_action',
        'p_event_type',
        'p_idempotency_key',
        'p_local_user_id',
        'p_max_attempts',
        'p_payload',
        'p_performed_by',
      ],
      smav_claim_single_user_sync_event: ['p_outbox_id'],
      smav_claim_due_user_sync_events: ['p_limit', 'p_stale_lock_minutes'],
      smav_link_verified_central_auth_id: [
        'p_evidence_ref',
        'p_local_user_id',
        'p_performed_by',
        'p_verification_source',
        'p_verified_central_auth_id',
      ],
    };

    for (const [fnName, expectedParams] of Object.entries(expectedSignatures)) {
      assert.deepEqual(byFn.get(fnName), expectedParams, `RPC parameter mismatch for ${fnName}`);
      assert.ok(sql.includes(`CREATE OR REPLACE FUNCTION public.${fnName}(`), `SQL missing function ${fnName}`);
      for (const paramName of expectedParams) {
        assert.ok(sql.includes(paramName), `SQL missing parameter ${paramName} for ${fnName}`);
      }
    }

    // Part C: SupabaseSalonRepository.updateUser & updateStaff reject central_auth_id even when NULL without writing!
    const guardWrites: string[] = [];
    const existingNullUserClient: any = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: { id: 'u-1', name: 'Null User', central_auth_id: null },
                error: null,
              }),
            maybeSingle: () =>
              Promise.resolve({
                data: { id: 'u-1', name: 'Null User', central_auth_id: null },
                error: null,
              }),
          }),
        }),
        update: () => {
          guardWrites.push(`forbidden-update:${table}`);
          throw new Error(`Unexpected update to ${table}`);
        },
      }),
    };
    const guardRepo = new SupabaseSalonRepository('http://offline.local', 'test-key', existingNullUserClient);
    let uGuardErr: unknown = null;
    try {
      await guardRepo.updateUser('u-1', { central_auth_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }, 'Owner');
    } catch (err) {
      uGuardErr = err;
    }
    assert.ok(isCentralAuthLinkForbiddenError(uGuardErr));

    let sGuardErr: unknown = null;
    try {
      await guardRepo.updateStaff('s-1', { central_auth_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }, 'Manager');
    } catch (err) {
      sGuardErr = err;
    }
    assert.ok(isCentralAuthLinkForbiddenError(sGuardErr));
    assert.deepEqual(guardWrites, []);
  });

  console.log(`\nAll ${results.length} mocked SMAV identity sync tests passed.`);
}

runTests().catch((err) => {
  console.error('SMAV identity sync test failed:', err);
  process.exit(1);
});
