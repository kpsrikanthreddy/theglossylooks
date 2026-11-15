/**
 * Generic Multi-Outlet SMAV User Synchronization Adapter
 * File: integrations/shared/smav_outlet_user_adapter.ts
 *
 * Reusable across any salon, restaurant, retail store, or future outlet portal.
 * Supports bidirectional synchronization between an Outlet Admin portal and
 * Central SMAV Supabase Auth (`smav-identity-admin` / SMAV Print Agent Gateway):
 *
 * - Single-source user creation: name, username, email, role, initialPassword (never stored in plaintext)
 * - Idempotent updates matched by existing Central Auth UUID or `(source, external_id)`
 * - Direct server-side password resets enforcing first-login password change (`must_change_password: true`)
 * - Loop prevention via `X-SMAV-Sync-Origin` and `X-Idempotency-Key`
 */

import crypto from 'crypto';

export interface OutletUserSyncPayload {
  userId?: string;
  externalStaffId?: string;
  email: string;
  fullName: string;
  username?: string;
  phone?: string;
  role?: 'OWNER' | 'MANAGER' | 'ADMIN' | 'STAFF' | 'STYLIST' | 'RECEPTIONIST' | 'CASHIER' | string;
  isActive?: boolean;
  initialPassword?: string;
  newPassword?: string;
}

export interface SmavSyncAdapterResponse {
  success: boolean;
  status?: number;
  message: string;
  userId?: string;
  email?: string;
  username?: string;
  role?: 'ADMIN' | 'STAFF';
  isNewUser?: boolean;
  mustChangePassword?: boolean;
  conflict?: boolean;
  details?: any;
}

export class SmavOutletUserAdapter {
  protected readonly outletCode: string;
  protected readonly gatewayOrEdgeUrl: string;
  protected readonly integrationKey: string;
  protected readonly useCentralGateway: boolean;

  constructor(config: {
    outletCode: string;
    integrationKey?: string;
    gatewayUrl?: string;
    edgeFunctionUrl?: string;
  }) {
    this.outletCode = String(config.outletCode || '').trim().toLowerCase();
    this.integrationKey = (config.integrationKey || '').trim();
    if (config.gatewayUrl?.trim()) {
      this.useCentralGateway = true;
      this.gatewayOrEdgeUrl = config.gatewayUrl.trim().replace(/\/+$/, '');
    } else {
      this.useCentralGateway = false;
      const smavSupabaseUrl = (process.env.SMAV_SUPABASE_URL || '').trim().replace(/\/+$/, '');
      this.gatewayOrEdgeUrl = (
        config.edgeFunctionUrl ||
        process.env.SMAV_EDGE_FUNCTION_URL ||
        (smavSupabaseUrl ? `${smavSupabaseUrl}/functions/v1/smav-identity-admin` : '') ||
        'https://qykdwswatopylzvqhgog.supabase.co/functions/v1/smav-identity-admin'
      ).trim();
    }
  }

  private buildHeaders(idempotencyKey?: string): Record<string, string> {
    const anonKey = (process.env.SMAV_SUPABASE_ANON_KEY || '').trim();
    return {
      'Content-Type': 'application/json',
      'X-Business-Source': this.outletCode,
      'X-Integration-Key': this.integrationKey,
      'X-SMAV-Sync-Origin': 'outlet_admin',
      'X-Idempotency-Key': idempotencyKey || `${this.outletCode}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ...(!this.useCentralGateway && anonKey ? { apikey: anonKey } : {}),
    };
  }

  private async postSync(
    edgeAction: string,
    gatewayAction: 'upsert_user' | 'update_user' | 'reset_password' | 'set_status',
    body: Record<string, any>,
    idempotencyKey?: string
  ): Promise<SmavSyncAdapterResponse> {
    if (!this.integrationKey) {
      return {
        success: false,
        message: `Integration key not configured for outlet "${this.outletCode}".`,
      };
    }

    try {
      const targetUrl = this.useCentralGateway
        ? `${this.gatewayOrEdgeUrl}/api/integrations/outlets/${encodeURIComponent(this.outletCode)}/users/sync`
        : this.gatewayOrEdgeUrl;

      const payload = this.useCentralGateway
        ? {
            action: gatewayAction,
            syncOrigin: 'outlet_admin',
            outletCode: this.outletCode,
            ...body,
          }
        : {
            action: edgeAction,
            outletCode: this.outletCode,
            businessSource: this.outletCode,
            syncOrigin: 'outlet_admin',
            ...body,
          };

      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: this.buildHeaders(idempotencyKey),
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      const resolvedUserId =
        data?.userId ||
        data?.centralAuthId ||
        data?.central_auth_id ||
        data?.user?.id ||
        data?.results?.[0]?.userId ||
        data?.results?.[0]?.centralAuthId;

      return {
        success: Boolean(res.ok && data?.success !== false),
        status: res.status,
        message: data?.message || data?.error || (res.ok ? 'Synchronized' : `HTTP ${res.status}`),
        userId: resolvedUserId ? String(resolvedUserId) : undefined,
        email: data?.email || data?.user?.email,
        username: data?.username || data?.user?.username,
        role: data?.role || data?.user?.role,
        isNewUser: Boolean(data?.isNewUser),
        mustChangePassword: data?.mustChangePassword,
        conflict: res.status === 409,
        details: data,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `SMAV synchronization failed: ${err?.message || 'Network error'}`,
      };
    }
  }

  /**
   * Create or update a staff/admin user from the Outlet Admin page.
   * For new users, supply `initialPassword` (>= 8 chars). Passwords are never saved locally in plaintext.
   */
  public upsertUser(user: OutletUserSyncPayload, idempotencyKey?: string): Promise<SmavSyncAdapterResponse> {
    return this.postSync(
      'upsert-user',
      user.userId ? 'update_user' : 'upsert_user',
      {
        userId: user.userId,
        externalStaffId: user.externalStaffId,
        email: user.email?.trim().toLowerCase(),
        fullName: user.fullName?.trim(),
        username: user.username?.trim().toLowerCase(),
        phone: user.phone?.trim() || '',
        role: user.role || 'STAFF',
        isActive: user.isActive !== false,
        ...(user.initialPassword ? { initialPassword: user.initialPassword } : {}),
      },
      idempotencyKey
    );
  }

  /**
   * Directly set a temporary password for an existing staff member through Central Auth.
   * Forces password update on their first sign-in (`must_change_password: true`).
   */
  public resetPassword(
    params: {
      userId?: string;
      externalStaffId?: string;
      email?: string;
      newPassword: string;
    },
    idempotencyKey?: string
  ): Promise<SmavSyncAdapterResponse> {
    return this.postSync(
      'reset-password',
      'reset_password',
      {
        userId: params.userId,
        externalStaffId: params.externalStaffId,
        email: params.email?.trim().toLowerCase(),
        newPassword: params.newPassword,
      },
      idempotencyKey
    );
  }

  /**
   * Enable or disable an outlet user across the outlet and Central SMAV.
   */
  public setUserStatus(
    params: {
      userId?: string;
      externalStaffId?: string;
      email?: string;
      isActive: boolean;
    },
    idempotencyKey?: string
  ): Promise<SmavSyncAdapterResponse> {
    return this.postSync(
      'set-status',
      'set_status',
      {
        userId: params.userId,
        externalStaffId: params.externalStaffId,
        email: params.email?.trim().toLowerCase(),
        isActive: params.isActive,
      },
      idempotencyKey
    );
  }

  /**
   * Helper for the Outlet Portal webhook route receiving updates FROM SMAV Print Agent (`smav_portal`).
   * Enforces timing-safe `X-Integration-Key` verification, outlet scope validation, and prevents echo loops
   * when origin is already `outlet_admin`.
   */
  public verifyIncomingSmavWebhook(headers: Record<string, string | string[] | undefined>, body: any): {
    authorized: boolean;
    shouldApply: boolean;
    skipReason?: string;
  } {
    if (!this.integrationKey) {
      return { authorized: false, shouldApply: false, skipReason: 'GLOSSYLOOKS_INTEGRATION_KEY is not configured' };
    }

    const rawKey = headers['x-integration-key'] || headers['X-Integration-Key'];
    const providedKey = String(Array.isArray(rawKey) ? rawKey[0] : rawKey || '').trim();
    const expectedBuf = Buffer.from(this.integrationKey, 'utf8');
    const providedBuf = Buffer.from(providedKey, 'utf8');

    if (
      !providedKey ||
      expectedBuf.length !== providedBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, providedBuf)
    ) {
      return { authorized: false, shouldApply: false, skipReason: 'Invalid X-Integration-Key' };
    }

    const rawSource = headers['x-business-source'] || headers['X-Business-Source'] || body?.outletCode || body?.outlet_code;
    const source = String(Array.isArray(rawSource) ? rawSource[0] : rawSource || '').trim().toLowerCase();
    if (source && source !== this.outletCode) {
      return {
        authorized: false,
        shouldApply: false,
        skipReason: `Outlet mismatch: expected ${this.outletCode}, received ${source}`,
      };
    }

    const rawOrigin = headers['x-smav-sync-origin'] || headers['X-SMAV-Sync-Origin'] || body?.syncOrigin || body?.sync_origin;
    const origin = String(Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin || '').trim().toLowerCase();
    if (origin === 'outlet_admin') {
      return {
        authorized: true,
        shouldApply: false,
        skipReason: 'Loop prevention: skipped echo of outlet_admin event',
      };
    }

    return { authorized: true, shouldApply: true };
  }
}
