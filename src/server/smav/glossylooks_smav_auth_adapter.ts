/**
 * The Glossy Looks Admin Portal - Central SMAV User Synchronization Adapter
 * File: integrations/glossylooks/glossylooks_smav_auth_adapter.ts
 *
 * Wraps the generic SmavOutletUserAdapter for outlet code `glossylooks`.
 * Synchronizes user creation (with explicit initialPassword), edits, status toggles,
 * and direct temporary password resets between The Glossy Looks Admin UI and Central SMAV
 * without storing plaintext passwords in any database table.
 */

import {
  SmavOutletUserAdapter,
  type OutletUserSyncPayload,
  type SmavSyncAdapterResponse,
} from './smav_outlet_user_adapter.ts';

export type GlossyLooksStaffPayload = OutletUserSyncPayload;
export type CentralAuthResponse = SmavSyncAdapterResponse;

export class GlossyLooksSmavAuthAdapter extends SmavOutletUserAdapter {
  constructor(config?: {
    gatewayUrl?: string;
    edgeFunctionUrl?: string;
    integrationKey?: string;
    outletCode?: string;
  }) {
    super({
      outletCode: config?.outletCode || 'glossylooks',
      integrationKey: config?.integrationKey || process.env.GLOSSYLOOKS_INTEGRATION_KEY || '',
      gatewayUrl: config?.gatewayUrl || process.env.SMAV_GATEWAY_URL,
      edgeFunctionUrl: config?.edgeFunctionUrl || process.env.SMAV_EDGE_FUNCTION_URL,
    });
  }

  async syncStaffMember(staff: GlossyLooksStaffPayload, idempotencyKey?: string): Promise<CentralAuthResponse> {
    return this.upsertUser(staff, idempotencyKey);
  }

  async setStaffActiveStatus(
    emailOrUserId: string,
    isActive: boolean,
    idempotencyKey?: string
  ): Promise<CentralAuthResponse> {
    const clean = emailOrUserId.trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean);
    const isEmail = clean.includes('@');
    return this.setUserStatus(
      {
        ...(isUuid ? { userId: clean } : isEmail ? { email: clean } : { externalStaffId: clean }),
        isActive,
      },
      idempotencyKey
    );
  }

  async resetStaffPassword(
    params: {
      userId?: string;
      externalStaffId?: string;
      email?: string;
      newPassword: string;
    },
    idempotencyKey?: string
  ): Promise<CentralAuthResponse> {
    return this.resetPassword(params, idempotencyKey);
  }
}
