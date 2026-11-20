/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared Role-Based Access Control (RBAC), Asia/Kolkata date boundary helpers,
 * and WhatsApp phone validation shared across server API routes and Admin Portal UI.
 */

export const DELETE_AUTHORIZED_ROLES = new Set(['SUPERADMIN', 'ADMIN', 'OWNER']);
export const FULL_PAYMENT_LEDGER_ROLES = new Set(['SUPERADMIN', 'ADMIN', 'OWNER']);
export const WHATSAPP_TEMPLATE_ALLOWED_ROLES = new Set([
  'SUPERADMIN',
  'ADMIN',
  'OWNER',
  'MANAGER',
  'RECEPTIONIST',
  'STYLIST',
  'POS_BILLING',
]);

export function normalizeRole(role?: string | null): string {
  return String(role || '').trim().toUpperCase();
}

/**
 * Only SUPERADMIN, ADMIN, and OWNER may delete records, view soft-deleted
 * records, or restore soft-deleted Appointments / Payment Ledger bills.
 * MANAGER, RECEPTIONIST, STYLIST, POS_BILLING, and other staff roles are denied.
 */
export function canDeleteOrRestoreRecords(role?: string | null): boolean {
  return DELETE_AUTHORIZED_ROLES.has(normalizeRole(role));
}

/**
 * Only OWNER, ADMIN, and SUPERADMIN have full Payment Ledger access
 * (multi-date ranges, branch-wise filters, export, edit, refund, delete/restore).
 */
export function hasFullPaymentLedgerAccess(role?: string | null): boolean {
  return FULL_PAYMENT_LEDGER_ROLES.has(normalizeRole(role));
}

/**
 * Staff roles (including RECEPTIONIST, STYLIST, POS_BILLING, MANAGER, INVENTORY_STAFF)
 * are restricted to today's (Asia/Kolkata) active Payment Ledger records for their
 * assigned branch only.
 */
export function isRestrictedPaymentLedgerStaff(role?: string | null): boolean {
  return !hasFullPaymentLedgerAccess(role);
}

/**
 * Roles permitted to dispatch approved Meta WhatsApp templates for records
 * they are authorized to access.
 */
export function canSendWhatsAppTemplates(role?: string | null): boolean {
  return WHATSAPP_TEMPLATE_ALLOWED_ROLES.has(normalizeRole(role));
}

/**
 * Returns YYYY-MM-DD in Asia/Kolkata timezone.
 */
export function getKolkataDateString(dateInput: Date | string = new Date()): string {
  const dt = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(dt.getTime())) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dt);
}

/**
 * Computes exact Asia/Kolkata 12:00:00.000 AM to 11:59:59.999 PM boundaries for today.
 * India Standard Time is fixed UTC+05:30 with no daylight saving transitions.
 */
export function getKolkataTodayBounds(now: Date = new Date()): {
  dateStr: string;
  startIso: string;
  endIso: string;
  startMs: number;
  endMs: number;
} {
  const dateStr = getKolkataDateString(now);
  const startIso = `${dateStr}T00:00:00.000+05:30`;
  const endIso = `${dateStr}T23:59:59.999+05:30`;
  return {
    dateStr,
    startIso,
    endIso,
    startMs: new Date(startIso).getTime(),
    endMs: new Date(endIso).getTime(),
  };
}

/**
 * Returns true strictly if the given timestamp falls inside today's Asia/Kolkata window
 * (12:00 AM to 11:59:59.999 PM IST). Rejects invalid, older, or future timestamps.
 */
export function isWithinKolkataToday(timestamp?: string | Date | null, now: Date = new Date()): boolean {
  if (!timestamp) return false;
  const dt = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const ms = dt.getTime();
  if (Number.isNaN(ms)) return false;
  const bounds = getKolkataTodayBounds(now);
  return ms >= bounds.startMs && ms <= bounds.endMs && getKolkataDateString(dt) === bounds.dateStr;
}

/**
 * Validates and normalizes a customer WhatsApp phone number.
 * Supports 10-digit Indian mobile numbers (6-9XXXXXXXXX) as well as 91-prefixed / E.164 numbers.
 */
export function validateWhatsAppPhone(rawPhone?: string | null): {
  isValid: boolean;
  digits: string;
  e164: string;
  metaRecipient: string;
  error?: string;
} {
  const cleaned = String(rawPhone || '').replace(/\D/g, '');
  if (!cleaned) {
    return {
      isValid: false,
      digits: '',
      e164: '',
      metaRecipient: '',
      error: 'Customer WhatsApp number is missing.',
    };
  }

  let digits = cleaned;
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  if (digits.length === 10) {
    if (!/^[6-9]\d{9}$/.test(digits)) {
      return {
        isValid: false,
        digits,
        e164: '',
        metaRecipient: '',
        error: 'Enter a valid 10-digit Indian mobile number starting with 6-9.',
      };
    }
    return {
      isValid: true,
      digits,
      e164: `+91${digits}`,
      metaRecipient: `91${digits}`,
    };
  }
  if (digits.length === 12 && digits.startsWith('91') && /^[6-9]\d{9}$/.test(digits.slice(2))) {
    return {
      isValid: true,
      digits: digits.slice(2),
      e164: `+${digits}`,
      metaRecipient: digits,
    };
  }
  if (digits.length >= 11 && digits.length <= 15) {
    return {
      isValid: true,
      digits,
      e164: `+${digits}`,
      metaRecipient: digits,
    };
  }

  return {
    isValid: false,
    digits,
    e164: '',
    metaRecipient: '',
    error: 'Invalid WhatsApp phone number. A valid 10-digit mobile number (or E.164 number) is required.',
  };
}
