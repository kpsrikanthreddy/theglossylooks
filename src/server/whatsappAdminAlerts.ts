/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Server-side WhatsApp admin/salon notification routing, Meta template variable
 * mapping, and idempotency key helpers for Glossy Looks.
 *
 * Strictly server-side only: never import this file in React/browser code.
 */

import crypto from 'crypto';
import type { Appointment, Enquiry, SalonBranch } from '../types/salon.ts';
import { validateWhatsAppPhone } from '../lib/rbac.ts';

export const APPOINTMENT_ADMIN_ALERT_TEMPLATE = 'gl_new_appointment_alert';
export const ENQUIRY_ADMIN_ALERT_TEMPLATE = 'gl_new_enquiry_alert';

export interface ApprovedMetaTemplateSchema {
  name: string;
  status: string;
  language: string;
  category?: string;
  components?: any[];
}

export interface ResolvedAlertRecipient {
  metaRecipient: string; // e.g. 91XXXXXXXXXX (digits only, international format)
  e164: string;          // e.g. +91XXXXXXXXXX
  role: 'branch' | 'admin' | 'branch_and_admin';
  envSource: string;
}

export interface BuiltAlertTemplatePayload {
  templateName: string;
  templateLanguage: string;
  components: any[];
  renderedPreview: string;
  resolvedParameters: Array<{ key: string; value: string }>;
  usedLiveMetaSchema: boolean;
}

/**
 * Sanitize text for Meta WhatsApp Cloud API template body parameters.
 * Meta rejects newlines, tabs, empty strings, and runs of >4 consecutive spaces.
 */
export function sanitizeMetaTemplateText(
  raw: unknown,
  fallback = '-',
  maxLength = 400
): string {
  const cleaned = String(raw ?? '')
    .replace(/[\r\n\t]+/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/(?:,\s*){2,}/g, ', ')
    .replace(/^,\s*|,\s*$/g, '')
    .trim();

  if (!cleaned) return fallback;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 3).trim()}...` : cleaned;
}

/**
 * Derive a clean display name for a branch (e.g. "Gachibowli", "Kondapur").
 */
export function getCleanAlertBranchName(
  branch?: Partial<SalonBranch> | null,
  fallback = 'The Glossy Looks'
): string {
  const raw = String(branch?.name || '').trim();
  if (!raw) return fallback;
  return raw.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s{2,}/g, ' ').trim() || fallback;
}

function classifyKnownBranchKey(
  branch?: Partial<SalonBranch> | null,
  branchHint?: string | null
): 'gachibowli' | 'kondapur' | string | null {
  const code = String(branch?.smav_branch_code || branch?.code || '').trim().toUpperCase();
  if (code === 'GACHI') return 'gachibowli';
  if (code === 'KONDA') return 'kondapur';

  const haystack = [
    code,
    branch?.id,
    branch?.name,
    branch?.address,
    branchHint,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const mentionsGachi = haystack.includes('gachibowli') || haystack.includes('gachi');
  const mentionsKonda = haystack.includes('kondapur') || haystack.includes('konda');

  if (mentionsGachi && !mentionsKonda) return 'gachibowli';
  if (mentionsKonda && !mentionsGachi) return 'kondapur';

  if (code && /^[A-Z0-9_]+$/.test(code)) {
    return code.toLowerCase();
  }
  return null;
}

function parseEnvPhoneList(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\n]+/)
    .map(part => part.trim())
    .filter(Boolean);
}

/**
 * Resolve branch-specific and optional owner/admin WhatsApp alert recipients
 * strictly from server-side environment variables (with branch master-data
 * fallback for future branches).
 *
 * Env vars:
 * - WHATSAPP_GACHIBOWLI_ALERT_NUMBER
 * - WHATSAPP_KONDAPUR_ALERT_NUMBER
 * - WHATSAPP_ADMIN_ALERT_NUMBER (optional, receives all branch alerts)
 * - WHATSAPP_<BRANCH_CODE>_ALERT_NUMBER (extensible for future branches)
 */
export function resolveBranchAlertRecipients(
  branch?: Partial<SalonBranch> | null,
  branchHint?: string | null
): ResolvedAlertRecipient[] {
  const byMetaRecipient = new Map<string, ResolvedAlertRecipient>();

  const registerCandidate = (
    rawPhone: string | undefined | null,
    role: 'branch' | 'admin',
    envSource: string
  ) => {
    for (const candidate of parseEnvPhoneList(rawPhone || '')) {
      const validated = validateWhatsAppPhone(candidate);
      if (!validated.isValid || !validated.metaRecipient) continue;

      const existing = byMetaRecipient.get(validated.metaRecipient);
      if (existing) {
        if (existing.role !== role) {
          existing.role = 'branch_and_admin';
          existing.envSource = `${existing.envSource}+${envSource}`;
        }
        continue;
      }

      byMetaRecipient.set(validated.metaRecipient, {
        metaRecipient: validated.metaRecipient,
        e164: validated.e164,
        role,
        envSource,
      });
    }
  };

  const branchKey = classifyKnownBranchKey(branch, branchHint);
  let branchEnvRaw = '';
  let branchEnvName = '';

  if (branchKey === 'gachibowli') {
    branchEnvName = 'WHATSAPP_GACHIBOWLI_ALERT_NUMBER';
    branchEnvRaw = String(process.env.WHATSAPP_GACHIBOWLI_ALERT_NUMBER || '').trim();
  } else if (branchKey === 'kondapur') {
    branchEnvName = 'WHATSAPP_KONDAPUR_ALERT_NUMBER';
    branchEnvRaw = String(process.env.WHATSAPP_KONDAPUR_ALERT_NUMBER || '').trim();
  } else if (branchKey) {
    const dynamicEnvKey = `WHATSAPP_${branchKey.toUpperCase()}_ALERT_NUMBER`;
    branchEnvName = dynamicEnvKey;
    branchEnvRaw = String(process.env[dynamicEnvKey] || '').trim();
  }

  if (branchEnvRaw) {
    registerCandidate(branchEnvRaw, 'branch', branchEnvName);
  } else if (branch?.whatsapp_number) {
    // Reusable fallback for newly added branches configured in salon_branches
    registerCandidate(branch.whatsapp_number, 'branch', 'salon_branches.whatsapp_number');
  }

  const adminEnvRaw = String(process.env.WHATSAPP_ADMIN_ALERT_NUMBER || '').trim();
  if (adminEnvRaw) {
    registerCandidate(adminEnvRaw, 'admin', 'WHATSAPP_ADMIN_ALERT_NUMBER');
  }

  return Array.from(byMetaRecipient.values());
}

/**
 * Resolve the target SalonBranch for an enquiry submission using explicit branch
 * fields first, then unambiguous branch mention, then the default salon branch.
 */
export function resolveEnquiryBranch(
  branches: SalonBranch[],
  payload: Record<string, any>,
  defaultBranchId?: string | null
): SalonBranch | null {
  const list = Array.isArray(branches) ? branches : [];
  const explicitId = String(payload?.branch_id || '').trim();
  if (explicitId) {
    const byId = list.find(b => b.id === explicitId);
    if (byId) return byId;
  }

  const explicitCodeOrName = String(
    payload?.branch_code || payload?.branch_name || payload?.branch || ''
  ).trim();
  if (explicitCodeOrName) {
    const norm = explicitCodeOrName.toLowerCase();
    const matched = list.find(b => {
      const code = String(b.smav_branch_code || b.code || '').toLowerCase();
      const name = String(b.name || '').toLowerCase();
      const id = String(b.id || '').toLowerCase();
      return code === norm || id === norm || name === norm || name.includes(norm) || norm.includes(name);
    });
    if (matched) return matched;
  }

  // Check if enquiry text unambiguously names a single branch (e.g. Kondapur vs Gachibowli)
  const combinedText = `${payload?.service_interest || ''} ${payload?.message || ''}`.toLowerCase();
  if (combinedText.trim()) {
    const mentioned = list.filter(b => {
      const cleanName = getCleanAlertBranchName(b, '').toLowerCase();
      const code = String(b.smav_branch_code || b.code || '').toLowerCase();
      return (cleanName.length >= 4 && combinedText.includes(cleanName)) ||
        (code.length >= 4 && combinedText.includes(code));
    });
    if (mentioned.length === 1) {
      return mentioned[0];
    }
  }

  if (defaultBranchId) {
    const byDefault = list.find(b => b.id === defaultBranchId);
    if (byDefault) return byDefault;
  }

  return list.find(b => b.is_active !== false) || list[0] || null;
}

/**
 * Canonical variable map and default positional order for `gl_new_appointment_alert`.
 */
export function buildAppointmentAlertVariables(
  appointment: Appointment,
  branch?: Partial<SalonBranch> | null
): {
  variables: Record<string, string>;
  defaultPositionalOrder: Array<{ key: string; value: string }>;
} {
  const customerName = sanitizeMetaTemplateText(appointment.customer_name, 'Guest');
  const customerPhone = sanitizeMetaTemplateText(appointment.customer_phone, '-');
  const serviceNames = Array.isArray(appointment.services) && appointment.services.length > 0
    ? sanitizeMetaTemplateText(
        appointment.services.map(s => s?.name).filter(Boolean).join(', '),
        'Salon Service'
      )
    : 'Salon Service';
  const appointmentDate = sanitizeMetaTemplateText(appointment.appointment_date, '-');
  const appointmentTime = sanitizeMetaTemplateText(appointment.time_slot, '-');
  const branchName = sanitizeMetaTemplateText(getCleanAlertBranchName(branch), 'The Glossy Looks');
  const bookingId = sanitizeMetaTemplateText(appointment.booking_reference || appointment.id, 'GL-BKG');
  const stylistName = sanitizeMetaTemplateText(appointment.assigned_staff_name, 'Any Available');
  const amount = sanitizeMetaTemplateText(
    String(appointment.final_amount ?? appointment.total_amount ?? 0),
    '0'
  );
  const notes = sanitizeMetaTemplateText(appointment.notes, 'None');
  const bookingSource = sanitizeMetaTemplateText(appointment.booking_source, 'website');

  const variables: Record<string, string> = {
    customer_name: customerName,
    name: customerName,
    client_name: customerName,
    customer_phone: customerPhone,
    phone: customerPhone,
    mobile: customerPhone,
    mobile_number: customerPhone,
    phone_number: customerPhone,
    contact: customerPhone,
    service_name: serviceNames,
    services: serviceNames,
    service: serviceNames,
    service_names: serviceNames,
    appointment_date: appointmentDate,
    date: appointmentDate,
    booking_date: appointmentDate,
    appointment_time: appointmentTime,
    time: appointmentTime,
    time_slot: appointmentTime,
    slot: appointmentTime,
    booking_time: appointmentTime,
    branch_name: branchName,
    branch: branchName,
    salon_branch: branchName,
    location: branchName,
    booking_id: bookingId,
    booking_reference: bookingId,
    booking_ref: bookingId,
    reference: bookingId,
    appointment_id: sanitizeMetaTemplateText(appointment.id, bookingId),
    stylist_name: stylistName,
    stylist: stylistName,
    staff_name: stylistName,
    amount,
    total_amount: amount,
    estimated_total: amount,
    notes,
    special_notes: notes,
    booking_source: bookingSource,
    source: bookingSource,
  };

  const defaultPositionalOrder: Array<{ key: string; value: string }> = [
    { key: 'customer_name', value: customerName },
    { key: 'customer_phone', value: customerPhone },
    { key: 'service_name', value: serviceNames },
    { key: 'appointment_date', value: appointmentDate },
    { key: 'appointment_time', value: appointmentTime },
    { key: 'branch_name', value: branchName },
    { key: 'booking_id', value: bookingId },
  ];

  return { variables, defaultPositionalOrder };
}

/**
 * Canonical variable map and default positional order for `gl_new_enquiry_alert`.
 */
export function buildEnquiryAlertVariables(
  enquiry: Enquiry,
  branch?: Partial<SalonBranch> | null
): {
  variables: Record<string, string>;
  defaultPositionalOrder: Array<{ key: string; value: string }>;
} {
  const customerName = sanitizeMetaTemplateText(enquiry.name, 'Website Visitor');
  const customerPhone = sanitizeMetaTemplateText(enquiry.phone, '-');
  const serviceInterest = sanitizeMetaTemplateText(enquiry.service_interest, 'General Enquiry');
  const message = sanitizeMetaTemplateText(enquiry.message, 'No additional notes');
  const branchName = sanitizeMetaTemplateText(getCleanAlertBranchName(branch), 'The Glossy Looks');
  const email = sanitizeMetaTemplateText(enquiry.email, 'Not provided');
  const enquiryId = sanitizeMetaTemplateText(enquiry.id, 'ENQ');

  const variables: Record<string, string> = {
    customer_name: customerName,
    name: customerName,
    lead_name: customerName,
    visitor_name: customerName,
    customer_phone: customerPhone,
    phone: customerPhone,
    mobile: customerPhone,
    mobile_number: customerPhone,
    phone_number: customerPhone,
    contact: customerPhone,
    service_interest: serviceInterest,
    service_name: serviceInterest,
    service: serviceInterest,
    services: serviceInterest,
    interest: serviceInterest,
    topic: serviceInterest,
    message,
    enquiry_message: message,
    notes: message,
    details: message,
    requirement: message,
    branch_name: branchName,
    branch: branchName,
    salon_branch: branchName,
    location: branchName,
    email,
    customer_email: email,
    enquiry_id: enquiryId,
  };

  const defaultPositionalOrder: Array<{ key: string; value: string }> = [
    { key: 'customer_name', value: customerName },
    { key: 'customer_phone', value: customerPhone },
    { key: 'service_interest', value: serviceInterest },
    { key: 'message', value: message },
    { key: 'branch_name', value: branchName },
  ];

  return { variables, defaultPositionalOrder };
}

/**
 * Infer a semantic variable key from the label text immediately preceding a
 * positional placeholder like `Branch: {{1}}` or `Customer Phone: {{2}}` in
 * Meta's live approved template BODY text.
 */
function inferSemanticKeyFromLabel(
  precedingLineText: string,
  entityType: 'appointment' | 'enquiry'
): string | null {
  const label = precedingLineText
    .replace(/[*_`~]/g, ' ')
    .replace(/[^\w\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (!label) return null;
  // Inspect the tail of the line right before the placeholder (handles inline labels like "Date: {{4}} | Time: {{5}}")
  const segment = label.split(/[|•·]/).pop()?.trim() || label;

  if (/\b(branch|salon branch|outlet|location)\b/.test(segment)) return 'branch_name';
  if (/\b(booking\s*id|booking\s*ref|reference|ref\s*no|ref)\b/.test(segment)) return 'booking_id';
  if (/\b(phone|mobile|whatsapp|contact|number|tel)\b/.test(segment)) return 'customer_phone';
  if (/\b(email|e-mail|mail)\b/.test(segment)) return 'email';
  if (/\b(stylist|specialist|staff|artist)\b/.test(segment)) return 'stylist_name';
  if (/\b(amount|total|price|estimate)\b/.test(segment)) return 'amount';
  if (/\b(date|day)\b/.test(segment)) return 'appointment_date';
  if (/\b(time|slot)\b/.test(segment)) return 'appointment_time';
  if (/\b(service|services|interest|package|treatment|category|topic)\b/.test(segment)) {
    return entityType === 'enquiry' ? 'service_interest' : 'service_name';
  }
  if (/\b(message|enquiry|inquiry|notes|note|comment|details|requirement|query)\b/.test(segment)) {
    return entityType === 'enquiry' ? 'message' : 'notes';
  }
  if (/\b(customer|client|guest|visitor|lead|name)\b/.test(segment)) return 'customer_name';
  if (/\b(source|channel)\b/.test(segment)) return 'booking_source';
  return null;
}

/**
 * Build exact Meta WhatsApp template components aligned with the approved
 * template's placeholder count, language, and named/positional format.
 */
export function buildAlertTemplateComponents(params: {
  templateName: string;
  entityType: 'appointment' | 'enquiry';
  approvedTemplateSchema?: ApprovedMetaTemplateSchema;
  variables: Record<string, string>;
  defaultPositionalOrder: Array<{ key: string; value: string }>;
}): BuiltAlertTemplatePayload {
  const {
    templateName,
    entityType,
    approvedTemplateSchema,
    variables,
    defaultPositionalOrder,
  } = params;

  const templateLanguage = approvedTemplateSchema?.language || 'en';
  const bodyComp = approvedTemplateSchema?.components?.find(
    (c: any) => String(c?.type || '').toUpperCase() === 'BODY'
  );
  const rawBodyText = typeof bodyComp?.text === 'string' ? bodyComp.text : '';

  if (rawBodyText) {
    const matches = [...rawBodyText.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)];

    if (matches.length === 0) {
      return {
        templateName,
        templateLanguage,
        components: [],
        renderedPreview: rawBodyText,
        resolvedParameters: [],
        usedLiveMetaSchema: true,
      };
    }

    const isNamed = matches.some(m => !/^\d+$/.test(m[1]));
    const parameters: any[] = [];
    const resolvedParameters: Array<{ key: string; value: string }> = [];
    let preview = rawBodyText;

    matches.forEach((m, idx) => {
      const token = m[1];
      const matchIndex = m.index ?? 0;
      const lineStart = rawBodyText.lastIndexOf('\n', matchIndex) + 1;
      const precedingOnLine = rawBodyText.slice(lineStart, matchIndex);

      let resolvedKey = token;
      let rawVal = '';

      if (/^\d+$/.test(token)) {
        const posIndex = Number(token) - 1;
        const inferredKey = inferSemanticKeyFromLabel(precedingOnLine, entityType);
        if (inferredKey && variables[inferredKey] !== undefined) {
          resolvedKey = inferredKey;
          rawVal = variables[inferredKey];
        } else if (defaultPositionalOrder[posIndex]) {
          resolvedKey = defaultPositionalOrder[posIndex].key;
          rawVal = defaultPositionalOrder[posIndex].value;
        } else {
          resolvedKey = defaultPositionalOrder[idx]?.key || `var_${token}`;
          rawVal = defaultPositionalOrder[idx]?.value || '-';
        }
      } else {
        const normalizedToken = token.toLowerCase();
        resolvedKey = normalizedToken;
        rawVal =
          variables[normalizedToken] ??
          defaultPositionalOrder[idx]?.value ??
          '-';
      }

      const cleanVal = sanitizeMetaTemplateText(rawVal, '-');
      resolvedParameters.push({ key: resolvedKey, value: cleanVal });

      if (isNamed && !/^\d+$/.test(token)) {
        parameters.push({ type: 'text', parameter_name: token, text: cleanVal });
      } else {
        parameters.push({ type: 'text', text: cleanVal });
      }

      preview = preview.replace(m[0], cleanVal);
    });

    return {
      templateName,
      templateLanguage,
      components: [{ type: 'body', parameters }],
      renderedPreview: preview,
      resolvedParameters,
      usedLiveMetaSchema: true,
    };
  }

  // Fallback when Meta template schema lookup is unavailable: use exact ordered positional defaults
  const parameters = defaultPositionalOrder.map(item => ({
    type: 'text',
    text: sanitizeMetaTemplateText(item.value, '-'),
  }));
  const preview = `[${templateName}] ${defaultPositionalOrder
    .map(item => `${item.key}: ${item.value}`)
    .join(' | ')}`;

  return {
    templateName,
    templateLanguage,
    components: [{ type: 'body', parameters }],
    renderedPreview: preview,
    resolvedParameters: defaultPositionalOrder,
    usedLiveMetaSchema: false,
  };
}

function shortHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 24);
}

/**
 * Build deterministic idempotency keys (all strictly <= 140 chars to fit
 * processed_webhook_events.event_id VARCHAR(150)) to prevent duplicate alerts
 * on refresh, client retry, serverless retry, or duplicate webhook/job replay.
 */
export function buildAdminAlertDedupKeys(params: {
  entityType: 'appointment' | 'enquiry';
  entityId: string;
  recipientMeta: string;
  fingerprintParts: string[];
  idempotencyKey?: string | null;
}): string[] {
  const { entityType, entityId, recipientMeta, fingerprintParts, idempotencyKey } = params;
  const prefix = entityType === 'appointment' ? 'wa_alert:apt' : 'wa_alert:enq';
  const cleanEntityId = String(entityId || '').trim();
  const rawRecordKey = `${prefix}:${cleanEntityId}:${recipientMeta}`;
  const recordKey = rawRecordKey.length <= 140
    ? rawRecordKey
    : `${prefix}:h:${shortHash(cleanEntityId)}:${recipientMeta}`;

  const keys = [recordKey];

  const cleanIdem = String(idempotencyKey || '').trim();
  if (cleanIdem) {
    keys.push(`${prefix}_idem:${shortHash(cleanIdem)}:${recipientMeta}`);
  }

  const normalizedFp = fingerprintParts
    .map(p => String(p || '').trim().toLowerCase())
    .join('|');
  if (normalizedFp.replace(/\|/g, '').length > 0) {
    keys.push(`${prefix}_fp:${shortHash(normalizedFp)}:${recipientMeta}`);
  }

  return keys;
}
