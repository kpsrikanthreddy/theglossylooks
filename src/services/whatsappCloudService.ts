/**
 * Meta WhatsApp Cloud API Service & Feedback Workflow Engine
 * The Glossy Looks Women's Salon, Gachibowli, Hyderabad
 *
 * Implements:
 * - Meta Graph API messaging (Templates, Interactive Buttons, Quick Replies, Texts)
 * - HMAC-SHA256 webhook signature security validation
 * - Message-ID level idempotency against duplicate delivery
 * - Reliable phone normalization for Indian (+91) numbers
 * - Automated 3-tier feedback logic (Good -> Google Review, Average -> Improvements, Bad -> Apology & Followup)
 * - Persistent/in-memory scheduled queue for decoupled delays
 * - Full audit and message delivery logs (sent, delivered, read, failed)
 */

import crypto from 'crypto';
import {
  saveFeedbackToSupabase,
  updateFollowupFeedbackInSupabase,
  recordProcessedWebhookEventInSupabase,
  isWebhookEventProcessedInSupabase,
  saveMessageLogInSupabase,
  updateMessageLogStatusInSupabase,
} from './supabaseClient.ts';

export interface WhatsAppConfig {
  accessToken?: string;
  phoneNumberId?: string;
  wabaId?: string;
  verifyToken?: string;
  appSecret?: string;
  templateName?: string;
  templateLanguage?: string;
  googleReviewUrl?: string;
  delayMinutes?: number;
}

export interface StoredMessageLog {
  id: string;
  appointmentId?: string;
  customerId?: string;
  customerName: string;
  customerPhone: string;
  templateName?: string;
  direction: 'inbound' | 'outbound';
  messageType: 'template' | 'interactive' | 'text' | 'quick_reply' | 'button_reply';
  buttonId?: string;
  messageText: string;
  waMessageId?: string;
  apiAccepted?: boolean;
  httpStatus?: number;
  status: 'sent' | 'delivered' | 'read' | 'failed' | 'received';
  errorCode?: string | number | null;
  errorMessage?: string | null;
  errorData?: any;
  fbtraceId?: string | null;
  contacts?: any;
  rawRequest?: any;
  rawResponse?: any;
  isTest?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface ScheduledFeedbackItem {
  id: string;
  appointmentId: string;
  customerName: string;
  customerPhone: string;
  serviceName: string;
  artistName?: string;
  scheduledFor: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'CANCELLED';
  attempts: number;
  lastError?: string;
  createdAt: string;
  sentAt?: string;
}

export interface FeedbackRecord {
  id: string;
  appointmentId?: string;
  customerName: string;
  customerPhone: string;
  serviceName: string;
  artistName?: string;
  rating?: 'GOOD' | 'AVERAGE' | 'BAD' | 'good' | 'average' | 'bad';
  feedback_text?: string;
  comment?: string;
  requiresFollowUp: boolean;
  followUpStatus: 'PENDING' | 'CONTACTED' | 'RESOLVED';
  followUpNotes?: string;
  googleReviewSent: boolean;
  whatsappMessageId?: string;
  feedbackRequestSentAt?: string;
  feedbackReceivedAt?: string;
  createdAt: string;
}

// In-Memory Storage (synced with Supabase / disk when configured)
const processedMessageIds = new Map<string, { eventType: string; processedAt: string }>();
const messageLogs: StoredMessageLog[] = [
  {
    id: 'init-log-1',
    customerName: 'Ananya Reddy',
    customerPhone: '919876511001',
    templateName: 'glossylooks_feedback',
    direction: 'outbound',
    messageType: 'template',
    messageText: '[Template: glossylooks_feedback] Hi Ananya, thank you for visiting The Glossy Looks!',
    status: 'delivered',
    apiAccepted: true,
    httpStatus: 200,
    waMessageId: 'wamid.HBgMOTE5ODc2NTExMDAxFQIAERgSQjEwMjIzMzQ0NTU2Njc3OA==',
    appointmentId: 'apt-101',
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
  },
  {
    id: 'init-log-2',
    customerName: 'Ananya Reddy',
    customerPhone: '919876511001',
    templateName: 'glossylooks_feedback',
    direction: 'inbound',
    messageType: 'button_reply',
    buttonId: 'feedback_good',
    messageText: '😊 Good',
    status: 'received',
    apiAccepted: true,
    httpStatus: 200,
    waMessageId: 'wamid.HBgMOTE5ODc2NTExMDAxFQIAERgSQjEwMjIzMzQ0NTU2Njc3OQ==',
    appointmentId: 'apt-101',
    createdAt: new Date(Date.now() - 3600000 * 24 + 120000).toISOString(),
  }
];

const scheduledQueue: ScheduledFeedbackItem[] = [];
const feedbackRecords: FeedbackRecord[] = [
  {
    id: 'fb-seed-1',
    appointmentId: 'apt-101',
    customerName: 'Ananya Reddy',
    customerPhone: '919876511001',
    serviceName: 'Royal Bridal HD Makeover',
    artistName: 'Zainab Qureshi',
    rating: 'GOOD',
    comment: 'Makeover was splendid! Loved the hygiene and staff hospitality.',
    requiresFollowUp: false,
    followUpStatus: 'RESOLVED',
    googleReviewSent: true,
    whatsappMessageId: 'wamid.HBgMOTE5ODc2NTExMDAxFQIAERgSQjEwMjIzMzQ0NTU2Njc3OA==',
    feedbackRequestSentAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    feedbackReceivedAt: new Date(Date.now() - 3600000 * 24 + 120000).toISOString(),
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
  }
];

let lastWebhookReceivedTimestamp: string | null = new Date().toISOString();

/**
 * Normalizes Indian phone numbers into international E.164 format without '+' or spaces.
 * PHONE NUMBER RULE:
 * For an Indian number:
 *   +91 94401 23456 -> 919440123456
 *   94401 23456     -> 919440123456
 *   09440123456     -> 919440123456
 *   +919440123456   -> 919440123456
 *
 * DO NOT SEND:
 *   +919440123456
 *   09440123456
 *   9440123456
 */
export function normalizeIndianPhoneNumber(rawPhone: string): string {
  if (!rawPhone) return '';
  // Strip non-digit characters
  let digits = rawPhone.replace(/\D/g, '');

  // Strip leading zero(s) (e.g. 09440123456 -> 9440123456)
  digits = digits.replace(/^0+/, '');

  // If standard 10-digit Indian mobile number, prepend 91
  if (digits.length === 10) {
    return '91' + digits;
  }

  // If 12 digits starting with 91, already valid
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits;
  }

  // If 13 digits starting with 910 (e.g. +91 094401 23456)
  if (digits.length === 13 && digits.startsWith('910')) {
    return '91' + digits.substring(3);
  }

  return digits;
}

/**
 * Reads currently configured environment variables for WhatsApp.
 */
export function getWhatsAppConfig(): WhatsAppConfig {
  return {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN?.trim(),
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID?.trim(),
    wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim(),
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN?.trim() || 'glossy_looks_webhook_verify_token_2026',
    appSecret: process.env.META_APP_SECRET?.trim(),
    templateName: process.env.WHATSAPP_FEEDBACK_TEMPLATE?.trim() || 'glossylooks_feedback',
    templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || 'en',
    googleReviewUrl: process.env.GOOGLE_REVIEW_URL?.trim() || 'https://g.page/r/glossy-looks-gachibowli/review',
    delayMinutes: parseInt(process.env.FEEDBACK_DELAY_MINUTES || '30', 10) || 30,
  };
}

/**
 * Normalizes incoming reply text:
 * - trim spaces
 * - convert to lowercase
 */
export function normalizeIncomingText(rawText: string): string {
  if (!rawText) return '';
  return rawText.trim().toLowerCase();
}

/**
 * Detects customer feedback rating from normalized text or interactive button input.
 * Supports replies with or without emoji:
 * GOOD: "😊 Good", "Good"
 * AVERAGE: "😐 Average", "Average"
 * BAD: "😞 Bad", "Bad"
 */
export function detectFeedbackRating(input: string): 'good' | 'average' | 'bad' | null {
  if (!input) return null;
  const normalized = normalizeIncomingText(input);

  // Strip emojis to allow matching with or without emoji
  const stripped = normalized
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
    .trim();

  // GOOD: "😊 Good", "Good", "feedback_good"
  if (
    normalized === '😊 good' ||
    normalized === 'good' ||
    stripped === 'good' ||
    normalized === 'feedback_good'
  ) {
    return 'good';
  }

  // AVERAGE: "😐 Average", "Average", "feedback_average"
  if (
    normalized === '😐 average' ||
    normalized === 'average' ||
    stripped === 'average' ||
    normalized === 'feedback_average'
  ) {
    return 'average';
  }

  // BAD: "😞 Bad", "Bad", "feedback_bad"
  if (
    normalized === '😞 bad' ||
    normalized === 'bad' ||
    stripped === 'bad' ||
    normalized === 'feedback_bad'
  ) {
    return 'bad';
  }

  return null;
}

/**
 * Verifies Meta Webhook HMAC-SHA256 signature from `x-hub-signature-256` header.
 */
export function verifyMetaSignature(
  rawBody: Buffer | string,
  signatureHeader?: string,
  appSecret?: string
): boolean {
  if (!appSecret) {
    // If META_APP_SECRET is not configured, log notice and permit in development
    return true;
  }
  if (!signatureHeader) {
    return false;
  }

  try {
    const parts = signatureHeader.split('=');
    if (parts.length !== 2 || parts[0] !== 'sha256') {
      return false;
    }
    const signature = parts[1];
    const expected = crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');

    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch (err) {
    console.error('[WhatsApp Webhook Security] Signature check failed:', err);
    return false;
  }
}

/**
 * Checks idempotency of incoming Meta Webhook event.
 * Checks both in-memory cache and Supabase to guarantee duplicate webhooks are prevented.
 */
export async function isEventAlreadyProcessed(waMessageId: string): Promise<boolean> {
  if (!waMessageId) return false;
  if (processedMessageIds.has(waMessageId)) return true;
  return await isWebhookEventProcessedInSupabase(waMessageId);
}

/**
 * Records an event ID as processed to prevent duplicate responses if Meta retries.
 */
export async function markEventAsProcessed(
  waMessageId: string,
  eventType: string,
  phoneNumber?: string,
  senderName?: string,
  payloadSummary?: string
): Promise<void> {
  if (!waMessageId) return;
  processedMessageIds.set(waMessageId, {
    eventType,
    processedAt: new Date().toISOString(),
  });
  lastWebhookReceivedTimestamp = new Date().toISOString();
  await recordProcessedWebhookEventInSupabase(waMessageId, eventType, phoneNumber, senderName, payloadSummary);
}

/**
 * Records message transmission in logs.
 */
export function logWhatsAppMessage(log: Omit<StoredMessageLog, 'id' | 'createdAt'>): StoredMessageLog {
  const newLog: StoredMessageLog = {
    ...log,
    id: 'wlog-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    createdAt: new Date().toISOString(),
  };
  messageLogs.unshift(newLog);
  // Keep recent 500 logs in memory
  if (messageLogs.length > 500) {
    messageLogs.pop();
  }
  return newLog;
}

/**
 * Updates status of an existing message log when delivery receipt webhook arrives.
 * Requirement 6: Do NOT mark a message as DELIVERED just because Meta returns a message ID.
 * Use webhook status events to track: sent, delivered, read, failed.
 */
export function updateMessageLogStatus(
  waMessageId: string,
  status: 'sent' | 'delivered' | 'read' | 'failed',
  errorDetails?: string
): void {
  const target = messageLogs.find(m => m.waMessageId === waMessageId);
  if (target) {
    target.status = status;
    if (errorDetails) {
      target.errorMessage = errorDetails;
    }
    target.updatedAt = new Date().toISOString();
  }

  // Persist status update to Supabase
  updateMessageLogStatusInSupabase(waMessageId, status, errorDetails).catch(err => {
    console.warn('[Supabase Status Update Error]:', err);
  });
}

export interface MetaApiCallResult {
  success: boolean;
  apiAccepted: boolean;
  httpStatus: number;
  messageId?: string;
  contacts?: Array<{ input: string; wa_id: string }>;
  error?: {
    code?: number | string;
    message?: string;
    error_data?: any;
    fbtrace_id?: string;
    type?: string;
  };
  requestPayload: {
    endpoint: string;
    headers: Record<string, string>;
    body: any;
  };
  metaResponse: any;
}

/**
 * Helper to execute Meta Graph API HTTP call safely and capture COMPLETE response.
 * DO NOT simulate success. Returns actual Meta API response.
 */
export async function callMetaGraphApi(payload: any): Promise<MetaApiCallResult> {
  const config = getWhatsAppConfig();

  // Create masked copy of headers and request payload for logs and UI display
  const rawToken = config.accessToken || '';
  const maskedToken = rawToken.length > 8 
    ? `${rawToken.substring(0, 7)}...[MASKED]...${rawToken.slice(-4)}`
    : (rawToken ? '••••••••' : '[NOT_CONFIGURED]');

  const requestPayload = {
    endpoint: `POST https://graph.facebook.com/v22.0/${config.phoneNumberId || '{PHONE_NUMBER_ID}'}/messages`,
    headers: {
      'Authorization': `Bearer ${maskedToken}`,
      'Content-Type': 'application/json',
    },
    body: payload,
  };

  // If credentials are missing in the environment, report error truthfully - DO NOT SIMULATE SUCCESS
  if (!config.accessToken || !config.phoneNumberId) {
    const errorMsg = 'Meta WhatsApp credentials missing: WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID is not configured in process.env.';
    console.error(`[WhatsApp Cloud API Error]: ${errorMsg}`);
    return {
      success: false,
      apiAccepted: false,
      httpStatus: 400,
      error: {
        code: 'CREDENTIALS_MISSING',
        message: errorMsg,
      },
      requestPayload,
      metaResponse: {
        error: {
          code: 'CREDENTIALS_MISSING',
          message: errorMsg,
          details: 'Please set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in your environment variables.',
        },
      },
    };
  }

  const endpoint = `https://graph.facebook.com/v22.0/${config.phoneNumberId}/messages`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const httpStatus = response.status;
    let responseData: any = {};
    try {
      responseData = await response.json();
    } catch {
      responseData = { raw: await response.text() };
    }

    const messageId = responseData?.messages?.[0]?.id;
    const contacts = responseData?.contacts;
    const isAccepted = response.ok && Boolean(messageId);

    if (!isAccepted) {
      const errCode = responseData?.error?.code || httpStatus;
      const errMsg = responseData?.error?.message || 'Unknown Graph API Error';
      console.error(`[WhatsApp Cloud API Error ${errCode}]:`, errMsg, responseData?.error);
      return {
        success: false,
        apiAccepted: false,
        httpStatus,
        error: {
          code: errCode,
          message: errMsg,
          error_data: responseData?.error?.error_data,
          fbtrace_id: responseData?.error?.fbtrace_id,
          type: responseData?.error?.type,
        },
        requestPayload,
        metaResponse: responseData,
      };
    }

    return {
      success: true,
      apiAccepted: true,
      httpStatus,
      messageId,
      contacts,
      requestPayload,
      metaResponse: responseData,
    };
  } catch (err: any) {
    console.error('[WhatsApp Cloud API Network Error]:', err);
    return {
      success: false,
      apiAccepted: false,
      httpStatus: 0,
      error: {
        code: 'NETWORK_ERROR',
        message: err?.message || 'Network error communicating with Meta Graph API',
      },
      requestPayload,
      metaResponse: {
        error: {
          code: 'NETWORK_ERROR',
          message: err?.message,
        },
      },
    };
  }
}

/**
 * Sends the approved Meta WhatsApp template to a customer.
 * - Business-initiated messages use type: "template".
 * - Template name: "glossylooks_feedback"
 * - Does NOT require the customer to message first.
 * - Captures complete Meta API response.
 * - Does NOT mark as delivered upon send (status is 'sent' initially).
 */
export async function sendFeedbackTemplate(params: {
  appointmentId?: string;
  customerName: string;
  customerPhone: string;
  templateName?: string;
  languageCode?: string;
  includeVariables?: boolean;
  serviceName?: string;
  artistName?: string;
  isTest?: boolean;
}): Promise<MetaApiCallResult & { normalizedPhone: string; templateName: string }> {
  const config = getWhatsAppConfig();
  const normalizedPhone = normalizeIndianPhoneNumber(params.customerPhone);
  const templateName = params.templateName || config.templateName || 'glossylooks_feedback';
  const languageCode = params.languageCode || config.templateLanguage || 'en';

  if (!normalizedPhone) {
    const errResult: MetaApiCallResult = {
      success: false,
      apiAccepted: false,
      httpStatus: 400,
      error: {
        code: 'INVALID_PHONE',
        message: 'Invalid customer phone number. Must be a valid Indian mobile number.',
      },
      requestPayload: {
        endpoint: `POST https://graph.facebook.com/v22.0/${config.phoneNumberId || '{PHONE_NUMBER_ID}'}/messages`,
        headers: { Authorization: 'Bearer [MASKED]', 'Content-Type': 'application/json' },
        body: { to: params.customerPhone },
      },
      metaResponse: {
        error: { code: 'INVALID_PHONE', message: 'Could not normalize phone number for Meta Cloud API.' },
      },
    };
    return { ...errResult, normalizedPhone: '', templateName };
  }

  // 1. Build template payload
  const baseTemplate: any = {
    name: templateName,
    language: {
      code: languageCode,
    },
  };

  // If variables are supported and customer name is provided
  if (params.includeVariables !== false && params.customerName && params.customerName.trim() !== '') {
    baseTemplate.components = [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.customerName.trim() },
        ],
      },
    ];
  }

  const templatePayload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizedPhone,
    type: 'template',
    template: baseTemplate,
  };

  let metaResult = await callMetaGraphApi(templatePayload);

  // Auto-handling parameter count mismatch (Meta error 132000):
  // If template has 0 parameters but we sent 1 parameter, automatically retry without components
  if (!metaResult.success && metaResult.error?.code === 132000 && baseTemplate.components) {
    console.log('[WhatsApp Cloud API] Parameter count mismatch (132000). Retrying template without variables...');
    const retryPayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizedPhone,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: languageCode,
        },
      },
    };
    metaResult = await callMetaGraphApi(retryPayload);
  }

  // Requirement 6: Do NOT mark a message as DELIVERED just because Meta returns a message ID.
  // Initial status is 'sent' if accepted, or 'failed' if rejected.
  const logStatus = metaResult.apiAccepted ? 'sent' : 'failed';
  const previewText = `[Template: ${templateName}] Feedback Request dispatched to ${normalizedPhone}`;

  // Log to in-memory audit store
  const storedLog: StoredMessageLog = {
    id: 'wlog-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    appointmentId: params.appointmentId,
    customerName: params.customerName,
    customerPhone: normalizedPhone,
    templateName,
    direction: 'outbound',
    messageType: 'template',
    messageText: previewText,
    waMessageId: metaResult.messageId || undefined,
    apiAccepted: metaResult.apiAccepted,
    httpStatus: metaResult.httpStatus,
    status: logStatus,
    errorCode: metaResult.error?.code || null,
    errorMessage: metaResult.error?.message || null,
    errorData: metaResult.error?.error_data || null,
    fbtraceId: metaResult.error?.fbtrace_id || null,
    contacts: metaResult.contacts || null,
    rawRequest: metaResult.requestPayload,
    rawResponse: metaResult.metaResponse,
    isTest: params.isTest,
    createdAt: new Date().toISOString(),
  };

  messageLogs.unshift(storedLog);
  if (messageLogs.length > 500) {
    messageLogs.pop();
  }

  // Asynchronously record message log in Supabase
  saveMessageLogInSupabase({
    id: storedLog.id,
    customer_name: storedLog.customerName,
    customer_phone: storedLog.customerPhone,
    template_name: storedLog.templateName,
    direction: storedLog.direction,
    message_type: storedLog.messageType,
    message_text: storedLog.messageText,
    wa_message_id: storedLog.waMessageId || null,
    api_accepted: storedLog.apiAccepted ?? false,
    http_status: storedLog.httpStatus || null,
    status: storedLog.status,
    error_code: storedLog.errorCode ? String(storedLog.errorCode) : null,
    error_message: storedLog.errorMessage || null,
    error_data: storedLog.errorData || null,
    fbtrace_id: storedLog.fbtraceId || null,
    contacts: storedLog.contacts || null,
    raw_request: storedLog.rawRequest || null,
    raw_response: storedLog.rawResponse || null,
    appointment_id: storedLog.appointmentId || null,
    is_test: storedLog.isTest ?? false,
    created_at: storedLog.createdAt,
  }).catch(err => console.warn('[Supabase Log Warning]:', err));

  // If linked to an appointment, track or create pending feedback record
  if (params.appointmentId) {
    let existingFb = feedbackRecords.find(f => f.appointmentId === params.appointmentId);
    if (!existingFb) {
      existingFb = {
        id: 'fb-' + Date.now(),
        appointmentId: params.appointmentId,
        customerName: params.customerName,
        customerPhone: normalizedPhone,
        serviceName: params.serviceName || 'Salon Service',
        artistName: params.artistName,
        requiresFollowUp: false,
        followUpStatus: 'RESOLVED',
        googleReviewSent: false,
        whatsappMessageId: metaResult.messageId,
        feedbackRequestSentAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      feedbackRecords.unshift(existingFb);
    } else {
      existingFb.feedbackRequestSentAt = new Date().toISOString();
      if (metaResult.messageId) {
        existingFb.whatsappMessageId = metaResult.messageId;
      }
    }
  }

  return {
    ...metaResult,
    normalizedPhone,
    templateName,
  };
}

/**
 * Sends the official Approved Feedback Template.
 * Uses sendFeedbackTemplate under the hood.
 */
export async function sendFeedbackRequest(params: {
  appointmentId: string;
  customerName: string;
  customerPhone: string;
  serviceName?: string;
  artistName?: string;
  isTest?: boolean;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const res = await sendFeedbackTemplate({
    appointmentId: params.appointmentId,
    customerName: params.customerName,
    customerPhone: params.customerPhone,
    serviceName: params.serviceName,
    artistName: params.artistName,
    isTest: params.isTest,
  });

  return {
    success: res.success,
    messageId: res.messageId,
    error: res.error?.message,
  };
}

/**
 * Sends automated response for GOOD rating.
 * Requirement 3:
 * "Thank you so much, {{customer_name}}! 😊✨
 * We're happy you enjoyed your visit to The Glossy Looks.
 *
 * We'd really appreciate it if you could share your experience on Google:
 * {{GOOGLE_REVIEW_URL}}
 *
 * Thank you for supporting us! 💖"
 */
export async function sendGoodFeedbackReply(
  customerPhone: string,
  customerName: string,
  appointmentId?: string
): Promise<{ success: boolean; messageId?: string }> {
  const config = getWhatsAppConfig();
  const normalizedPhone = normalizeIndianPhoneNumber(customerPhone);
  const reviewUrl = config.googleReviewUrl || 'https://g.page/r/glossy-looks-gachibowli/review';

  const messageText = `Thank you so much, ${customerName}! 😊✨\nWe're happy you enjoyed your visit to The Glossy Looks.\n\nWe'd really appreciate it if you could share your experience on Google:\n${reviewUrl}\n\nThank you for supporting us! 💖`;

  const result = await callMetaGraphApi({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizedPhone,
    type: 'text',
    text: {
      preview_url: true,
      body: messageText,
    },
  });

  logWhatsAppMessage({
    appointmentId,
    customerName,
    customerPhone: normalizedPhone,
    direction: 'outbound',
    messageType: 'text',
    buttonId: 'feedback_good_reply',
    messageText,
    status: result.success ? 'sent' : 'failed',
    waMessageId: result.messageId,
  });

  return result;
}

// Backward compatible alias
export const sendGoogleReviewMessage = sendGoodFeedbackReply;

/**
 * Sends response for AVERAGE rating.
 * Requirement 4:
 * "Thank you for your feedback, {{customer_name}}. 🙏
 * We'd love to make your next visit even better.
 * Could you please tell us what we could improve?"
 *
 * IMPORTANT: Do NOT send the Google review link for Average feedback.
 */
export async function sendAverageFeedbackReply(
  customerPhone: string,
  customerName: string,
  appointmentId?: string
): Promise<{ success: boolean; messageId?: string }> {
  const normalizedPhone = normalizeIndianPhoneNumber(customerPhone);
  const messageText = `Thank you for your feedback, ${customerName}. 🙏\nWe'd love to make your next visit even better.\nCould you please tell us what we could improve?`;

  const result = await callMetaGraphApi({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizedPhone,
    type: 'text',
    text: { body: messageText },
  });

  logWhatsAppMessage({
    appointmentId,
    customerName,
    customerPhone: normalizedPhone,
    direction: 'outbound',
    messageType: 'text',
    buttonId: 'feedback_average_reply',
    messageText,
    status: result.success ? 'sent' : 'failed',
    waMessageId: result.messageId,
  });

  return result;
}

// Backward compatible alias
export const sendAverageReply = sendAverageFeedbackReply;

/**
 * Sends response for BAD rating.
 * Requirement 5:
 * "We're sorry your experience didn't meet your expectations,
 * {{customer_name}}. 🙏
 *
 * Your feedback is important to us.
 * Could you please tell us what went wrong?
 * Our team will look into it."
 *
 * IMPORTANT: Do NOT send the Google review link for Bad feedback.
 */
export async function sendBadFeedbackReply(
  customerPhone: string,
  customerName: string,
  appointmentId?: string
): Promise<{ success: boolean; messageId?: string }> {
  const normalizedPhone = normalizeIndianPhoneNumber(customerPhone);
  const messageText = `We're sorry your experience didn't meet your expectations,\n${customerName}. 🙏\n\nYour feedback is important to us.\nCould you please tell us what went wrong?\nOur team will look into it.`;

  const result = await callMetaGraphApi({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizedPhone,
    type: 'text',
    text: { body: messageText },
  });

  logWhatsAppMessage({
    appointmentId,
    customerName,
    customerPhone: normalizedPhone,
    direction: 'outbound',
    messageType: 'text',
    buttonId: 'feedback_bad_reply',
    messageText,
    status: result.success ? 'sent' : 'failed',
    waMessageId: result.messageId,
  });

  return result;
}

// Backward compatible alias
export const sendBadReply = sendBadFeedbackReply;

/**
 * Matches an incoming message to the most recent appropriate feedback record.
 */
export function findMatchingFeedbackRecord(normalizedPhone: string): FeedbackRecord | undefined {
  return feedbackRecords.find(fb => {
    const fbNorm = normalizeIndianPhoneNumber(fb.customerPhone);
    return fbNorm === normalizedPhone;
  });
}

/**
 * Handles incoming WhatsApp button / quick-reply payload.
 */
export async function handleIncomingFeedbackRating(
  buttonId: string,
  fromPhone: string,
  waMessageId: string,
  buttonTitle?: string,
  profileName?: string
): Promise<{ success: boolean; rating?: string; replySent: boolean }> {
  const normalizedPhone = normalizeIndianPhoneNumber(fromPhone);

  const rating = detectFeedbackRating(buttonTitle || buttonId) || 
    (buttonId.toLowerCase().includes('good') ? 'good' :
     buttonId.toLowerCase().includes('average') ? 'average' :
     buttonId.toLowerCase().includes('bad') ? 'bad' : null);

  if (!rating) {
    return { success: false, replySent: false };
  }

  // Find or create feedback record
  let record = findMatchingFeedbackRecord(normalizedPhone);
  const resolvedName = (record?.customerName && record.customerName !== 'Valued Guest') 
    ? record.customerName 
    : (profileName || record?.customerName || 'Valued Guest');

  if (!record) {
    record = {
      id: 'fb-' + Date.now(),
      appointmentId: 'apt-matched-' + Date.now(),
      customerName: resolvedName,
      customerPhone: normalizedPhone,
      serviceName: 'Salon Service',
      rating,
      requiresFollowUp: rating === 'bad',
      followUpStatus: rating === 'bad' ? 'PENDING' : 'RESOLVED',
      googleReviewSent: rating === 'good',
      createdAt: new Date().toISOString(),
    };
    feedbackRecords.unshift(record);
  } else {
    record.customerName = resolvedName;
  }

  record.rating = rating;
  record.feedbackReceivedAt = new Date().toISOString();
  record.whatsappMessageId = waMessageId;

  // Log incoming interaction
  logWhatsAppMessage({
    appointmentId: record.appointmentId,
    customerName: record.customerName,
    customerPhone: normalizedPhone,
    direction: 'inbound',
    messageType: 'button_reply',
    buttonId: buttonId,
    messageText: `Customer selected: ${buttonTitle || rating}`,
    status: 'received',
    waMessageId,
  });

  if (rating === 'good') {
    // Requirement 12: Log exact token FEEDBACK_GOOD_RECEIVED
    console.log('FEEDBACK_GOOD_RECEIVED', {
      customer_name: record.customerName,
      customer_phone: normalizedPhone,
      appointment_id: record.appointmentId,
      waMessageId,
    });

    record.requiresFollowUp = false;
    record.followUpStatus = 'RESOLVED';
    record.googleReviewSent = true;

    // Send GOOD reply
    await sendGoodFeedbackReply(normalizedPhone, record.customerName, record.appointmentId);

    // Save feedback in Supabase (Requirement 7)
    await saveFeedbackToSupabase({
      customer_name: record.customerName,
      customer_phone: normalizedPhone,
      appointment_id: record.appointmentId || null,
      service_name: record.serviceName,
      rating: 'good',
      feedback_text: null,
      created_at: record.feedbackReceivedAt,
      whatsapp_message_id: waMessageId,
      google_review_sent: true,
      requires_follow_up: false,
      follow_up_status: 'RESOLVED',
    });

    return { success: true, rating: 'good', replySent: true };
  } else if (rating === 'average') {
    // Requirement 12: Log exact token FEEDBACK_AVERAGE_RECEIVED
    console.log('FEEDBACK_AVERAGE_RECEIVED', {
      customer_name: record.customerName,
      customer_phone: normalizedPhone,
      appointment_id: record.appointmentId,
      waMessageId,
    });

    record.requiresFollowUp = false;
    record.followUpStatus = 'RESOLVED';
    record.googleReviewSent = false;

    // Send AVERAGE reply (DO NOT send Google Review URL)
    await sendAverageFeedbackReply(normalizedPhone, record.customerName, record.appointmentId);

    // Save feedback in Supabase (Requirement 7)
    await saveFeedbackToSupabase({
      customer_name: record.customerName,
      customer_phone: normalizedPhone,
      appointment_id: record.appointmentId || null,
      service_name: record.serviceName,
      rating: 'average',
      feedback_text: null,
      created_at: record.feedbackReceivedAt,
      whatsapp_message_id: waMessageId,
      google_review_sent: false,
      requires_follow_up: false,
      follow_up_status: 'RESOLVED',
    });

    return { success: true, rating: 'average', replySent: true };
  } else {
    // BAD rating
    // Requirement 12: Log exact token FEEDBACK_BAD_RECEIVED
    console.log('FEEDBACK_BAD_RECEIVED', {
      customer_name: record.customerName,
      customer_phone: normalizedPhone,
      appointment_id: record.appointmentId,
      waMessageId,
    });

    record.requiresFollowUp = true;
    record.followUpStatus = 'PENDING';
    record.followUpNotes = '⚠ Immediate Follow-up Required: Customer reported unsatisfactory visit.';
    record.googleReviewSent = false;

    // Send BAD reply (DO NOT send Google Review URL)
    await sendBadFeedbackReply(normalizedPhone, record.customerName, record.appointmentId);

    // Save feedback in Supabase (Requirement 7)
    await saveFeedbackToSupabase({
      customer_name: record.customerName,
      customer_phone: normalizedPhone,
      appointment_id: record.appointmentId || null,
      service_name: record.serviceName,
      rating: 'bad',
      feedback_text: null,
      created_at: record.feedbackReceivedAt,
      whatsapp_message_id: waMessageId,
      google_review_sent: false,
      requires_follow_up: true,
      follow_up_status: 'PENDING',
      follow_up_notes: record.followUpNotes,
    });

    return { success: true, rating: 'bad', replySent: true };
  }
}

/**
 * Handles incoming normal text messages.
 * If customer previously chose Average or Bad, stores text as feedback_text without overwriting blindly.
 */
export async function handleIncomingTextReply(
  text: string,
  fromPhone: string,
  waMessageId: string,
  profileName?: string
): Promise<{ success: boolean; commentSaved: boolean; isFollowUp?: boolean }> {
  const normalizedPhone = normalizeIndianPhoneNumber(fromPhone);
  let record = findMatchingFeedbackRecord(normalizedPhone);
  const customerName = record?.customerName || profileName || 'WhatsApp Customer';

  logWhatsAppMessage({
    appointmentId: record?.appointmentId,
    customerName,
    customerPhone: normalizedPhone,
    direction: 'inbound',
    messageType: 'text',
    messageText: text,
    status: 'received',
    waMessageId,
  });

  const ratingLower = (record?.rating || '').toLowerCase();
  const isFollowUp = Boolean(record && (ratingLower === 'average' || ratingLower === 'bad'));

  if (isFollowUp && record) {
    // Requirement 12: Log exact token FEEDBACK_FOLLOWUP_RECEIVED
    console.log('FEEDBACK_FOLLOWUP_RECEIVED', {
      customer_name: record.customerName,
      customer_phone: normalizedPhone,
      rating: record.rating,
      feedback_text: text,
      waMessageId,
    });

    const timeFormatted = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const newCommentLine = `[${timeFormatted}] ${text}`;

    // Requirement 8: If customer sends another message after selecting Average or Bad, save as feedback_text
    const updatedFeedbackText = record.feedback_text
      ? `${record.feedback_text}\n${text.trim()}`
      : text.trim();
    record.feedback_text = updatedFeedbackText;

    if (record.comment) {
      record.comment = `${record.comment}\n${newCommentLine}`;
    } else {
      record.comment = newCommentLine;
    }

    if (ratingLower === 'bad') {
      record.requiresFollowUp = true;
      record.followUpStatus = 'PENDING';
      record.followUpNotes = `Customer Follow-up: "${text.trim()}"`;
    }

    // Persist follow-up to Supabase
    await updateFollowupFeedbackInSupabase(normalizedPhone, updatedFeedbackText);

    return { success: true, commentSaved: true, isFollowUp: true };
  } else if (record) {
    const timeFormatted = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const newCommentLine = `[${timeFormatted}] ${text}`;
    if (record.comment) {
      record.comment = `${record.comment}\n${newCommentLine}`;
    } else {
      record.comment = newCommentLine;
    }
    return { success: true, commentSaved: true, isFollowUp: false };
  }

  return { success: true, commentSaved: false, isFollowUp: false };
}

/**
 * Schedules an automated feedback request when an appointment is completed.
 * Guarantees idempotency: checks appointment_id and avoids multiple automatic requests.
 */
export function scheduleAppointmentFeedback(
  appointment: {
    id: string;
    customerName: string;
    customerPhone: string;
    serviceNames?: string[];
    artistName?: string;
  },
  delayMinutes?: number
): { scheduled: boolean; scheduledFor: string; message: string } {
  const config = getWhatsAppConfig();
  const effectiveDelay = delayMinutes !== undefined ? delayMinutes : config.delayMinutes || 30;

  // Check if already in queue or already sent
  const existing = scheduledQueue.find(item => item.appointmentId === appointment.id);
  if (existing) {
    return {
      scheduled: false,
      scheduledFor: existing.scheduledFor,
      message: `Feedback already scheduled or sent for appointment ${appointment.id}`,
    };
  }

  const scheduledDate = new Date(Date.now() + effectiveDelay * 60 * 1000);
  const queueItem: ScheduledFeedbackItem = {
    id: 'sched-' + Date.now(),
    appointmentId: appointment.id,
    customerName: appointment.customerName,
    customerPhone: appointment.customerPhone,
    serviceName: appointment.serviceNames?.[0] || 'Salon Service',
    artistName: appointment.artistName,
    scheduledFor: scheduledDate.toISOString(),
    status: 'PENDING',
    attempts: 0,
    createdAt: new Date().toISOString(),
  };

  scheduledQueue.push(queueItem);

  return {
    scheduled: true,
    scheduledFor: scheduledDate.toISOString(),
    message: `Automated WhatsApp feedback scheduled for ${appointment.customerName} in ${effectiveDelay} minutes.`,
  };
}

/**
 * Checks and processes all due items in the scheduled feedback queue.
 * Called automatically every 30 seconds by backend timer, and can be triggered via cron endpoint.
 */
export async function processDueScheduledFeedback(): Promise<{ processedCount: number; errors: string[] }> {
  const now = new Date();
  const dueItems = scheduledQueue.filter(item => item.status === 'PENDING' && new Date(item.scheduledFor) <= now);
  const errors: string[] = [];
  let processedCount = 0;

  for (const item of dueItems) {
    try {
      item.attempts += 1;
      const sendResult = await sendFeedbackRequest({
        appointmentId: item.appointmentId,
        customerName: item.customerName,
        customerPhone: item.customerPhone,
        serviceName: item.serviceName,
        artistName: item.artistName,
      });

      if (sendResult.success) {
        item.status = 'SENT';
        item.sentAt = new Date().toISOString();
        processedCount += 1;
      } else {
        item.lastError = sendResult.error;
        if (item.attempts >= 3) {
          item.status = 'FAILED';
          errors.push(`Failed appointment ${item.appointmentId}: ${sendResult.error}`);
        }
      }
    } catch (err: any) {
      item.lastError = err?.message;
      if (item.attempts >= 3) item.status = 'FAILED';
      errors.push(`Exception in appointment ${item.appointmentId}: ${err?.message}`);
    }
  }

  return { processedCount, errors };
}

/**
 * Manually resends feedback for an appointment. Requires admin confirmation.
 * Dispatches the approved Meta template glossylooks_feedback.
 */
export async function resendFeedbackManually(appointment: {
  id: string;
  customerName: string;
  customerPhone: string;
  serviceNames?: string[];
  artistName?: string;
}): Promise<MetaApiCallResult & { normalizedPhone: string; templateName: string }> {
  return sendFeedbackTemplate({
    appointmentId: appointment.id,
    customerName: appointment.customerName,
    customerPhone: appointment.customerPhone,
    serviceName: appointment.serviceNames?.[0] || 'Salon Service',
    artistName: appointment.artistName,
    isTest: false,
  });
}

/**
 * Returns safe status information for Admin -> WhatsApp display without leaking any secrets.
 */
export function getSafeAdminWhatsAppStatus() {
  const config = getWhatsAppConfig();

  const isConfigured = Boolean(config.accessToken && config.phoneNumberId);
  const isPhoneConfigured = Boolean(config.phoneNumberId);
  const isWabaConfigured = Boolean(config.wabaId);
  const isWebhookConfigured = Boolean(config.verifyToken);

  const pendingDueCount = scheduledQueue.filter(s => s.status === 'PENDING').length;
  const badFeedbackCount = feedbackRecords.filter(f => f.rating === 'BAD' && f.requiresFollowUp).length;

  return {
    connection: isConfigured ? 'Configured' : 'Missing Credentials',
    phoneNumberStatus: isPhoneConfigured ? 'Configured' : 'Missing',
    phoneNumberId: config.phoneNumberId || 'Not Configured',
    wabaStatus: isWabaConfigured ? 'Configured' : 'Missing',
    wabaId: config.wabaId || 'Not Configured',
    webhookStatus: isWebhookConfigured ? 'Active' : 'Not Verified',
    feedbackTemplate: config.templateName || 'glossylooks_feedback',
    feedbackAutomation: 'Enabled',
    feedbackDelayMinutes: config.delayMinutes || 30,
    googleReviewUrl: config.googleReviewUrl,
    lastWebhookReceived: lastWebhookReceivedTimestamp,
    totalLogsCount: messageLogs.length,
    pendingQueueCount: pendingDueCount,
    badFeedbackCount,
    // Safely masked presentation only - NO RAW SECRETS EXPOSED
    hasAppSecret: Boolean(config.appSecret),
    maskedToken: config.accessToken ? `••••••••••••${config.accessToken.slice(-4)}` : 'Not Configured',
  };
}

/**
 * Exposes message logs and feedback records for admin API endpoints.
 */
export function getAllMessageLogs(): StoredMessageLog[] {
  return [...messageLogs];
}

export function getAllFeedbackRecords(): FeedbackRecord[] {
  return [...feedbackRecords];
}

export function updateFeedbackFollowUp(
  feedbackId: string,
  updates: { followUpStatus?: 'PENDING' | 'CONTACTED' | 'RESOLVED'; followUpNotes?: string; requiresFollowUp?: boolean }
): FeedbackRecord | null {
  const fb = feedbackRecords.find(f => f.id === feedbackId);
  if (!fb) return null;
  if (updates.followUpStatus) fb.followUpStatus = updates.followUpStatus;
  if (updates.followUpNotes !== undefined) fb.followUpNotes = updates.followUpNotes;
  if (updates.requiresFollowUp !== undefined) fb.requiresFollowUp = updates.requiresFollowUp;
  return fb;
}
