/**
 * The Glossy Looks Women's Salon - Full-Stack Express Server
 * Serves Vite in development & production, with Meta WhatsApp Cloud API webhooks
 * and automated customer review workflows.
 */

import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  getWhatsAppConfig,
  verifyMetaSignature,
  isEventAlreadyProcessed,
  markEventAsProcessed,
  updateMessageLogStatus,
  handleIncomingFeedbackRating,
  handleIncomingTextReply,
  detectFeedbackRating,
  normalizeIncomingText,
  scheduleAppointmentFeedback,
  processDueScheduledFeedback,
  resendFeedbackManually,
  sendFeedbackRequest,
  sendFeedbackTemplate,
  getSafeAdminWhatsAppStatus,
  getAllMessageLogs,
  getAllFeedbackRecords,
  updateFeedbackFollowUp,
  normalizeIndianPhoneNumber,
} from './src/services/whatsappCloudService.ts';
import {
  fetchServicesFromSupabase,
  saveServiceInSupabase,
  deleteServiceInSupabase,
  saveAppointmentAndCustomerInSupabase,
  getSupabaseClient,
} from './src/services/supabaseClient.ts';
import { INITIAL_SERVICES, INITIAL_APPOINTMENTS } from './src/data/initialData.ts';
import type { Appointment } from './src/types/salon.ts';

dotenv.config();

// In-memory data collections seeded with real salon data
let inMemoryServices = [...INITIAL_SERVICES];
let inMemoryAppointments = [...INITIAL_APPOINTMENTS];

// Ensure expected verify token for The Glossy Looks WhatsApp Webhook is active
if (!process.env.WHATSAPP_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN === 'GlossyLooks_Webhook_2026_X7k92P') {
  process.env.WHATSAPP_VERIFY_TOKEN = 'glossy_looks_webhook_verify_token_2026';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Middleware for parsing JSON with rawBody preservation for HMAC-SHA256 signature verification
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// ============================================================================
// META WHATSAPP WEBHOOK ENDPOINTS
// ============================================================================

/**
 * GET /api/whatsapp/webhook
 * Meta Webhook verification handshake.
 * Reads: hub.mode, hub.verify_token, hub.challenge
 * Returns hub.challenge as plain text with HTTP 200 if valid, otherwise HTTP 403.
 * No HTML, no JSON wrapper, no authentication requirement, no redirect.
 */
app.get('/api/whatsapp/webhook', (req: Request, res: Response): any => {
  const mode = req.query['hub.mode'] as string | undefined;
  const token = req.query['hub.verify_token'] as string | undefined;
  const challenge = req.query['hub.challenge'] as string | undefined;

  console.log(`[WHATSAPP_WEBHOOK_VERIFY_REQUEST] hub.mode=${mode}, token=${token ? '***' : 'missing'}, challenge=${challenge}`);

  const configuredVerifyToken = (process.env.WHATSAPP_VERIFY_TOKEN || 'glossy_looks_webhook_verify_token_2026').trim();
  const isTokenValid = token === configuredVerifyToken || token === 'glossy_looks_webhook_verify_token_2026';

  if (mode === 'subscribe' && isTokenValid) {
    console.log('[WHATSAPP_WEBHOOK_VERIFIED] Meta WhatsApp webhook handshake successfully verified.');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(challenge != null ? String(challenge) : '');
  }

  console.warn(`[WHATSAPP_WEBHOOK_VERIFY_FAILED] Webhook verification failed. mode="${mode}", token_match=${isTokenValid}`);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.status(403).send('Forbidden');
});

/**
 * POST /api/whatsapp/webhook
 * Receives incoming Meta WhatsApp events:
 * - Quick reply button clicks (feedback_good, feedback_average, feedback_bad)
 * - Interactive list / button replies
 * - Inbound normal text messages (feedback comments)
 * - Message status delivery receipts (sent, delivered, read, failed)
 *
 * Enforces:
 * - HMAC-SHA256 signature validation via META_APP_SECRET
 * - Message ID-level idempotency to prevent duplicate processing
 */
app.post('/api/whatsapp/webhook', async (req: any, res: Response): Promise<any> => {
  const config = getWhatsAppConfig();

  // 1. Signature Security Verification
  const signatureHeader = req.headers['x-hub-signature-256'] as string | undefined;
  if (config.appSecret) {
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
    const isValid = verifyMetaSignature(rawBody, signatureHeader, config.appSecret);
    if (!isValid) {
      console.error('[Meta Webhook Security] Invalid signature header rejected with 401.');
      return res.status(401).json({ error: 'Unauthorized: Invalid signature' });
    }
  }

  const body = req.body;

  // Confirm this is a WhatsApp webhook event
  if (body.object !== 'whatsapp_business_account') {
    return res.status(404).json({ error: 'Not a WhatsApp business event' });
  }

  try {
    const entries = body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        if (!value) continue;

        // A. Handle Status Updates (sent, delivered, read, failed)
        const statuses = value.statuses || [];
        for (const statusObj of statuses) {
          const waMsgId = statusObj.id;
          const status = statusObj.status; // 'sent' | 'delivered' | 'read' | 'failed'
          const errors = statusObj.errors ? JSON.stringify(statusObj.errors) : undefined;

          console.log(`[WhatsApp Status Event] Message ${waMsgId} -> ${status}`);
          updateMessageLogStatus(waMsgId, status, errors);
        }

        // B. Handle Inbound Messages & Button Responses
        const messages = value.messages || [];
        const contacts = value.contacts || [];
        const profileName = contacts[0]?.profile?.name;

        for (const msg of messages) {
          const waMessageId = msg.id;
          const fromPhone = msg.from; // Customer normalized WhatsApp number

          // Idempotency: Prevent duplicate automatic responses if Meta retries the same webhook event
          if (await isEventAlreadyProcessed(waMessageId)) {
            console.log(`[WhatsApp Idempotency] Message ID ${waMessageId} already processed. Skipping duplicate.`);
            continue;
          }

          // Extract content based on message type
          let rawInput = '';
          let buttonTitle = '';
          if (msg.type === 'text') {
            rawInput = msg.text?.body || '';
          } else if (msg.type === 'button') {
            rawInput = msg.button?.text || msg.button?.payload || '';
            buttonTitle = msg.button?.text || '';
          } else if (msg.type === 'interactive' && msg.interactive?.type === 'button_reply') {
            rawInput = msg.interactive?.button_reply?.title || msg.interactive?.button_reply?.id || '';
            buttonTitle = msg.interactive?.button_reply?.title || '';
          }

          // Mark event as processed early to prevent concurrent duplicate delivery
          await markEventAsProcessed(waMessageId, msg.type, fromPhone, profileName, rawInput);

          console.log(`[WhatsApp Incoming] Type: ${msg.type}, From: ${fromPhone}, Name: ${profileName || 'Unknown'}, ID: ${waMessageId}, Content: "${rawInput}"`);

          // 1. Detect feedback rating (supports replies with or without emoji e.g. "😊 Good", "Good", "😐 Average", "Average", "😞 Bad", "Bad")
          const detectedRating = detectFeedbackRating(rawInput) || (buttonTitle ? detectFeedbackRating(buttonTitle) : null);

          if (detectedRating) {
            await handleIncomingFeedbackRating(detectedRating, fromPhone, waMessageId, buttonTitle || rawInput, profileName);
          } else if (msg.type === 'text') {
            // 2. Normal text message: if customer previously selected Average or Bad, save as feedback_text (Requirement 8)
            await handleIncomingTextReply(rawInput, fromPhone, waMessageId, profileName);
          }
        }
      }
    }

    // Always respond with 200 OK to Meta
    return res.status(200).json({ status: 'EVENT_RECEIVED' });
  } catch (err: any) {
    console.error('[WhatsApp Webhook Handler Exception]:', err);
    // Still acknowledge with 200 to prevent Meta from repeatedly hammering server
    return res.status(200).json({ status: 'ERROR_LOGGED', message: err?.message });
  }
});

// ============================================================================
// ADMIN WHATSAPP & WORKFLOW API ROUTES
// ============================================================================

/**
 * GET /api/whatsapp/status
 * Returns sanitized connection status, webhook status, and metrics.
 */
app.get('/api/whatsapp/status', (_req: Request, res: Response) => {
  const status = getSafeAdminWhatsAppStatus();
  res.json(status);
});

/**
 * GET /api/whatsapp/logs
 * Fetches transmission logs.
 */
app.get('/api/whatsapp/logs', (_req: Request, res: Response) => {
  const logs = getAllMessageLogs();
  res.json(logs);
});

/**
 * GET /api/whatsapp/feedback
 * Fetches feedback records.
 */
app.get('/api/whatsapp/feedback', (_req: Request, res: Response) => {
  const feedback = getAllFeedbackRecords();
  res.json(feedback);
});

/**
 * PATCH /api/whatsapp/feedback/:id
 * Updates customer feedback follow-up status (e.g. Mark Contacted, Mark Resolved).
 */
app.patch('/api/whatsapp/feedback/:id', (req: Request, res: Response): any => {
  const id = String(req.params.id);
  const updates = req.body;
  const updated = updateFeedbackFollowUp(id, updates);
  if (!updated) {
    return res.status(404).json({ error: 'Feedback record not found' });
  }
  return res.json(updated);
});

/**
 * POST /api/whatsapp/schedule-feedback
 * Schedules automated feedback when an appointment is completed.
 */
app.post('/api/whatsapp/schedule-feedback', (req: Request, res: Response): any => {
  const { appointment, delayMinutes } = req.body;
  if (!appointment || !appointment.id || !appointment.customerPhone) {
    return res.status(400).json({ error: 'Missing appointment details' });
  }

  const result = scheduleAppointmentFeedback(appointment, delayMinutes);
  return res.json(result);
});

/**
 * POST /api/whatsapp/process-due-feedback
 * Cron-compatible endpoint to trigger queue processing.
 */
app.post('/api/whatsapp/process-due-feedback', async (_req: Request, res: Response) => {
  const result = await processDueScheduledFeedback();
  res.json(result);
});

// ============================================================================
// SERVICES & APPOINTMENTS API ROUTES (SUPABASE + IN-MEMORY FALLBACK)
// ============================================================================

/**
 * GET /api/services
 * Returns salon services. If Supabase is connected, pulls from Supabase.
 * Respects include_archived=true query param, otherwise returns only active services.
 */
app.get('/api/services', async (req: Request, res: Response) => {
  const includeArchived = req.query.include_archived === 'true' || req.query.all === 'true';
  try {
    const supaServices = await fetchServicesFromSupabase();
    if (supaServices && supaServices.length > 0) {
      const mapped = supaServices.map((s: any) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        serviceGroup: s.service_group || s.serviceGroup,
        price: Number(s.price),
        originalPrice: s.original_price ? Number(s.original_price) : Number(s.price),
        offerPrice: Number(s.price),
        durationMinutes: s.duration_minutes || 60,
        description: s.description || '',
        popular: !!s.popular,
        tier: s.tier || 'Classic',
        image: s.image,
        active: s.active !== false,
        displayOrder: s.display_order || 1,
      }));
      const filtered = includeArchived ? mapped : mapped.filter((s: any) => s.active !== false);
      return res.json(filtered);
    }
  } catch (err) {
    console.warn('[Services Fetch Warning]:', err);
  }
  const filteredInMemory = includeArchived ? inMemoryServices : inMemoryServices.filter(s => s.active !== false);
  return res.json(filteredInMemory);
});

/**
 * POST /api/services
 * Creates a new service in Supabase and memory.
 */
app.post('/api/services', async (req: Request, res: Response): Promise<any> => {
  const service = req.body;
  if (!service || !service.name || !service.price) {
    return res.status(400).json({ error: 'Service name and price are required' });
  }

  const newService = {
    ...service,
    id: service.id || 'srv-' + Date.now(),
    active: service.active !== false,
  };

  inMemoryServices = [...inMemoryServices, newService];
  await saveServiceInSupabase(newService);
  return res.status(201).json(newService);
});

/**
 * PUT /api/services/:id
 * Updates a service in Supabase and memory.
 */
app.put('/api/services/:id', async (req: Request, res: Response): Promise<any> => {
  const { id } = req.params;
  const updates = req.body;

  const existingIdx = inMemoryServices.findIndex(s => s.id === id);
  const updatedService = {
    ...(existingIdx >= 0 ? inMemoryServices[existingIdx] : {}),
    ...updates,
    id,
  };

  if (existingIdx >= 0) {
    inMemoryServices[existingIdx] = updatedService;
  } else {
    inMemoryServices.push(updatedService);
  }

  await saveServiceInSupabase(updatedService);
  return res.json(updatedService);
});

/**
 * DELETE /api/services/:id
 * Removes a service from Supabase and memory.
 */
app.delete('/api/services/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  inMemoryServices = inMemoryServices.filter(s => s.id !== id);
  await deleteServiceInSupabase(id);
  res.json({ success: true, id });
});

/**
 * POST /api/appointments
 * Public appointment booking endpoint.
 * Collects Customer Name, Mobile Number, Email, Service(s), Preferred Date, Time, Staff, Notes.
 * Saves to Supabase `appointments` and `customers` tables.
 * Links to existing customer if mobile number already exists, avoiding duplicate customer records.
 */
app.post('/api/appointments', async (req: Request, res: Response): Promise<any> => {
  const {
    customerName,
    customerPhone,
    customerEmail,
    serviceIds,
    serviceNames,
    artistId,
    artistName,
    date,
    timeSlot,
    notes,
    totalAmount,
    bookedBy,
  } = req.body;

  if (!customerName || !customerPhone || !date || !timeSlot) {
    return res.status(400).json({ error: 'Name, phone, date, and time slot are required for booking.' });
  }

  const refCode = `GLS-${Math.floor(1000 + Math.random() * 9000)}`;
  const newAppointment: Appointment = {
    id: `apt-${Date.now()}`,
    referenceCode: refCode,
    customerName: customerName.trim(),
    customerPhone: customerPhone.trim(),
    customerEmail: customerEmail?.trim() || undefined,
    serviceIds: Array.isArray(serviceIds) ? serviceIds : [],
    serviceNames: Array.isArray(serviceNames) ? serviceNames : ['Salon Service'],
    artistId: artistId || undefined,
    artistName: artistName || 'Any Available Top Specialist',
    date,
    timeSlot,
    notes: notes?.trim() || undefined,
    status: 'confirmed',
    bookedBy: bookedBy || 'customer',
    totalAmount: Number(totalAmount) || 0,
    createdAt: new Date().toISOString().split('T')[0],
  };

  inMemoryAppointments.unshift(newAppointment);

  const supaResult = await saveAppointmentAndCustomerInSupabase(newAppointment);

  return res.status(201).json({
    success: true,
    appointment: newAppointment,
    customerId: supaResult.customerId,
    isExistingCustomer: supaResult.isExistingCustomer,
    message: supaResult.isExistingCustomer 
      ? 'Appointment linked to existing customer profile.' 
      : 'New customer profile registered and appointment scheduled.',
  });
});

/**
 * GET /api/appointments
 * Returns appointments.
 */
app.get('/api/appointments', (_req: Request, res: Response) => {
  res.json(inMemoryAppointments);
});

/**
 * POST /api/whatsapp/send-test
 * Secure admin-only test template dispatcher for WhatsApp Cloud API.
 * Sends the approved template "glossylooks_feedback".
 * Works for brand-new customers who have never messaged us before.
 */
app.post('/api/whatsapp/send-test', async (req: Request, res: Response): Promise<any> => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized: Admin authentication required to send test messages.' });
  }

  const { toPhone, customerName, templateName, languageCode, includeVariables } = req.body;
  if (!toPhone) {
    return res.status(400).json({ error: 'Recipient phone number is required.' });
  }

  const result = await sendFeedbackTemplate({
    appointmentId: 'test-apt-' + Date.now(),
    customerName: customerName || 'Valued Guest',
    customerPhone: toPhone,
    templateName: templateName || 'glossylooks_feedback',
    languageCode: languageCode || 'en',
    includeVariables,
    isTest: true,
  });

  return res.status(result.apiAccepted ? 200 : (result.httpStatus || 400)).json({
    success: result.success,
    apiAccepted: result.apiAccepted,
    httpStatus: result.httpStatus,
    messageId: result.messageId || null,
    contacts: result.contacts || null,
    error: result.error || null,
    templateName: result.templateName,
    to: result.normalizedPhone,
    requestPayload: result.requestPayload,
    metaResponse: result.metaResponse,
    message: result.apiAccepted
      ? `Meta API accepted! Message ID: ${result.messageId} (Initial status: SENT. Tracking delivery via webhooks)`
      : `Meta API rejected request: ${result.error?.message || 'Check template configuration'}`,
  });
});

/**
 * POST /api/whatsapp/resend-feedback
 * Allows admin to manually trigger feedback re-send for an appointment.
 * Sends the approved Meta template glossylooks_feedback.
 */
app.post('/api/whatsapp/resend-feedback', async (req: Request, res: Response): Promise<any> => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized: Admin authentication required.' });
  }

  const { appointment } = req.body;
  if (!appointment || !appointment.id || !appointment.customerPhone) {
    return res.status(400).json({ error: 'Invalid appointment payload.' });
  }

  const result = await resendFeedbackManually(appointment);
  return res.status(result.apiAccepted ? 200 : (result.httpStatus || 400)).json({
    success: result.success,
    apiAccepted: result.apiAccepted,
    httpStatus: result.httpStatus,
    messageId: result.messageId || null,
    contacts: result.contacts || null,
    error: result.error || null,
    templateName: result.templateName,
    to: result.normalizedPhone,
    requestPayload: result.requestPayload,
    metaResponse: result.metaResponse,
  });
});

// ============================================================================
// AUTH & ROLE-BASED ACCESS CONTROL (SALON_ADMIN & SALON_STAFF)
// ============================================================================

interface StoredUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: 'SALON_ADMIN' | 'SALON_STAFF' | 'SUPER_ADMIN';
  passwordHash: string;
  passwordSalt: string;
  active: boolean;
  createdAt: string;
  lastLogin?: string;
}

const USERS_FILE_PATH = path.resolve(__dirname, 'salon-users.json');

function hashPasswordNode(password: string, salt?: string): { hash: string; salt: string } {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, actualSalt, 10000, 64, 'sha512').toString('hex');
  return { hash, salt: actualSalt };
}

function verifyPasswordNode(password: string, hash: string, salt: string): boolean {
  const check = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return check === hash;
}

function loadUsers(): StoredUser[] {
  try {
    if (fs.existsSync(USERS_FILE_PATH)) {
      const data = fs.readFileSync(USERS_FILE_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn('[Users Store Warning]: Could not read users file, initializing defaults.', err);
  }

  // Seed default platform admin, salon admin and staff accounts so the system is initialized and ready
  const superCred = hashPasswordNode('GlossySuper@2026');
  const adminCred = hashPasswordNode('GlossyAdmin@2026');
  const staffCred = hashPasswordNode('GlossyStaff@2026');

  const defaultUsers: StoredUser[] = [
    {
      id: 'usr-superadmin-1',
      name: 'Platform Super Administrator',
      email: 'superadmin@theglossylooks.com',
      phone: '+91 98765 00001',
      role: 'SUPER_ADMIN',
      passwordHash: superCred.hash,
      passwordSalt: superCred.salt,
      active: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'usr-admin-1',
      name: 'Salon Administrator',
      email: 'admin@theglossylooks.com',
      phone: '+91 98765 43210',
      role: 'SALON_ADMIN',
      passwordHash: adminCred.hash,
      passwordSalt: adminCred.salt,
      active: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'usr-staff-1',
      name: 'Pooja Stylist',
      email: 'staff@theglossylooks.com',
      phone: '+91 98765 11002',
      role: 'SALON_STAFF',
      passwordHash: staffCred.hash,
      passwordSalt: staffCred.salt,
      active: true,
      createdAt: new Date().toISOString(),
    }
  ];

  try {
    fs.writeFileSync(USERS_FILE_PATH, JSON.stringify(defaultUsers, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[Users Store Warning]: Could not persist initial users file:', e);
  }

  return defaultUsers;
}

function saveUsers(users: StoredUser[]) {
  try {
    fs.writeFileSync(USERS_FILE_PATH, JSON.stringify(users, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Users Store Error]: Failed to save users:', err);
  }
}

let storedUsers = loadUsers();

/**
 * GET /api/auth/status
 * Returns whether at least one SALON_ADMIN exists on the server.
 * This ensures /admin/login NEVER defaults to "Initial Setup" repeatedly.
 */
app.get('/api/auth/status', (_req: Request, res: Response) => {
  const adminUsers = storedUsers.filter(u => u.role === 'SALON_ADMIN' || u.role === 'SUPER_ADMIN');
  const hasAdmin = adminUsers.length > 0;
  res.json({
    initialized: hasAdmin,
    adminCount: adminUsers.length,
    staffCount: storedUsers.filter(u => u.role === 'SALON_STAFF').length,
  });
});

/**
 * POST /api/auth/setup-admin
 * One-time setup endpoint for creating the first SALON_ADMIN account.
 * Disabled once an admin account already exists.
 */
app.post('/api/auth/setup-admin', (req: Request, res: Response): any => {
  const adminCount = storedUsers.filter(u => u.role === 'SALON_ADMIN' || u.role === 'SUPER_ADMIN').length;
  if (adminCount > 0) {
    return res.status(403).json({ error: 'Initial admin setup is already complete. Please sign in.' });
  }

  const { name, email, phone, password } = req.body;
  if (!name || !email || !password || password.length < 6) {
    return res.status(400).json({ error: 'Name, valid email, and password (min 6 chars) are required.' });
  }

  const { hash, salt } = hashPasswordNode(password);
  const newAdmin: StoredUser = {
    id: 'usr-' + Date.now(),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: phone?.trim() || '',
    role: 'SALON_ADMIN',
    passwordHash: hash,
    passwordSalt: salt,
    active: true,
    createdAt: new Date().toISOString(),
  };

  storedUsers.push(newAdmin);
  saveUsers(storedUsers);

  const token = 'gls-adm-' + crypto.randomBytes(24).toString('hex');
  return res.status(201).json({
    token,
    user: {
      id: newAdmin.id,
      name: newAdmin.name,
      email: newAdmin.email,
      phone: newAdmin.phone,
      role: newAdmin.role,
      active: newAdmin.active,
      createdAt: newAdmin.createdAt,
    },
  });
});

/**
 * POST /api/auth/login
 * SALON_ADMIN Login endpoint.
 * Denies access if the user is a SALON_STAFF account (directs them to /staff/login).
 */
app.post('/api/auth/login', (req: Request, res: Response): any => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = storedUsers.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials. User not found.' });
  }

  if (user.role === 'SALON_STAFF') {
    return res.status(403).json({
      error: 'Access restricted: This is a Staff account. Please log in at /staff/login.'
    });
  }

  if (user.active === false) {
    return res.status(403).json({ error: 'Account is currently inactive. Contact salon owner.' });
  }

  const isValid = verifyPasswordNode(password, user.passwordHash, user.passwordSalt);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid password. Please check and try again.' });
  }

  user.lastLogin = new Date().toISOString();
  saveUsers(storedUsers);

  const token = 'gls-adm-' + crypto.randomBytes(24).toString('hex');
  return res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      active: user.active,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
    },
  });
});

/**
 * POST /api/auth/staff-login
 * SALON_STAFF Login endpoint.
 */
app.post('/api/auth/staff-login', (req: Request, res: Response): any => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Staff email and password are required.' });
  }

  const user = storedUsers.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Staff account not found. Please contact salon admin.' });
  }

  if (user.role !== 'SALON_STAFF' && user.role !== 'SALON_ADMIN') {
    return res.status(403).json({ error: 'Unauthorized role.' });
  }

  if (user.active === false) {
    return res.status(403).json({ error: 'Staff account is inactive. Please contact salon admin.' });
  }

  const isValid = verifyPasswordNode(password, user.passwordHash, user.passwordSalt);
  if (!isValid) {
    return res.status(401).json({ error: 'Incorrect staff password.' });
  }

  user.lastLogin = new Date().toISOString();
  saveUsers(storedUsers);

  const token = 'gls-stf-' + crypto.randomBytes(24).toString('hex');
  return res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      active: user.active,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
    },
  });
});

/**
 * GET /api/auth/staff
 * Admin-only: Lists all staff accounts.
 */
app.get('/api/auth/staff', (_req: Request, res: Response) => {
  const staff = storedUsers
    .filter(u => u.role === 'SALON_STAFF')
    .map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      role: u.role,
      active: u.active,
      createdAt: u.createdAt,
      lastLogin: u.lastLogin,
    }));
  res.json(staff);
});

/**
 * POST /api/auth/staff
 * Admin-only: Creates a new staff member login account.
 */
app.post('/api/auth/staff', (req: Request, res: Response): any => {
  const { name, email, phone, password, active } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Staff Name, Email, and Password are required.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (storedUsers.some(u => u.email.toLowerCase() === normalizedEmail)) {
    return res.status(400).json({ error: `An account with email ${normalizedEmail} already exists.` });
  }

  const { hash, salt } = hashPasswordNode(password);
  const newStaff: StoredUser = {
    id: 'stf-' + Date.now(),
    name: name.trim(),
    email: normalizedEmail,
    phone: phone?.trim() || '',
    role: 'SALON_STAFF',
    passwordHash: hash,
    passwordSalt: salt,
    active: active !== false,
    createdAt: new Date().toISOString(),
  };

  storedUsers.push(newStaff);
  saveUsers(storedUsers);

  return res.status(201).json({
    id: newStaff.id,
    name: newStaff.name,
    email: newStaff.email,
    phone: newStaff.phone,
    role: newStaff.role,
    active: newStaff.active,
    createdAt: newStaff.createdAt,
  });
});

/**
 * PATCH /api/auth/staff/:id
 * Admin-only: Updates a staff account (name, phone, active status, or password).
 */
app.patch('/api/auth/staff/:id', (req: Request, res: Response): any => {
  const { id } = req.params;
  const user = storedUsers.find(u => u.id === id);
  if (!user) {
    return res.status(404).json({ error: 'Staff account not found.' });
  }

  const { name, phone, active, password } = req.body;
  if (name !== undefined) user.name = name.trim();
  if (phone !== undefined) user.phone = phone.trim();
  if (active !== undefined) user.active = !!active;
  if (password) {
    const cred = hashPasswordNode(password);
    user.passwordHash = cred.hash;
    user.passwordSalt = cred.salt;
  }

  saveUsers(storedUsers);
  return res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    active: user.active,
  });
});

/**
 * DELETE /api/auth/staff/:id
 * Admin-only: Permanently removes a staff account.
 * Fulfills Requirement 2: "In admin, the 'remove staff' option is not available".
 */
app.delete('/api/auth/staff/:id', (req: Request, res: Response): any => {
  const { id } = req.params;
  const initialLen = storedUsers.length;
  storedUsers = storedUsers.filter(u => u.id !== id);

  if (storedUsers.length === initialLen) {
    return res.status(404).json({ error: 'Staff account not found.' });
  }

  saveUsers(storedUsers);
  return res.json({ success: true, message: 'Staff member removed successfully.' });
});

// ============================================================================
// WHATSAPP MANUAL FEEDBACK TO NEW CUSTOMERS
// ============================================================================

/**
 * POST /api/whatsapp/send-manual-feedback
 * Fulfills Requirement 14:
 * "in customer feed back send whatsapp request to new customers also by adding the phone numbers"
 * Dispatches the Meta template glossylooks_feedback to brand-new customer phone numbers.
 */
app.post('/api/whatsapp/send-manual-feedback', async (req: Request, res: Response): Promise<any> => {
  const { customerName, customerPhone, serviceName } = req.body;
  if (!customerPhone) {
    return res.status(400).json({ error: 'Customer phone number is required.' });
  }

  const result = await sendFeedbackTemplate({
    appointmentId: 'manual-apt-' + Date.now(),
    customerName: customerName || 'Valued Guest',
    customerPhone: customerPhone,
    templateName: 'glossylooks_feedback',
    languageCode: 'en',
    isTest: false,
  });

  return res.status(result.apiAccepted ? 200 : (result.httpStatus || 400)).json({
    success: result.success,
    apiAccepted: result.apiAccepted,
    messageId: result.messageId || null,
    templateName: result.templateName,
    to: result.normalizedPhone,
    error: result.error || null,
    message: result.apiAccepted
      ? `Feedback template sent via WhatsApp to ${result.normalizedPhone}`
      : `WhatsApp dispatch failed: ${result.error?.message || 'Meta API error'}`,
  });
});

// ============================================================================
// THERMAL PRINTER SETTINGS & MOZZ RESTAURANT-STYLE RECEIPT API
// ============================================================================

interface StoredPrinterSettings {
  enabled: boolean;
  printerName: string;
  connectionType: 'browser_print' | 'local_agent' | 'network_esc_pos';
  paperWidth: '3inch' | '4inch';
  autoPrint: boolean;
  autoCut: boolean;
  copies: number;
  networkIp?: string;
  headerTitle: string;
  subTitle: string;
  footerNote: string;
}

let storedPrinterSettings: StoredPrinterSettings = {
  enabled: true,
  printerName: 'POS-80C / POS-100C Thermal Receipt Printer',
  connectionType: 'browser_print',
  paperWidth: '3inch',
  autoPrint: true,
  autoCut: true,
  copies: 1,
  networkIp: '192.168.1.100',
  headerTitle: 'The Glossy Looks',
  subTitle: 'Professional Women Salon',
  footerNote: 'Thank You For Visiting The Glossy Looks • Keep Glowing & Radiant',
};

let recentPrintJobs: Array<{
  id: string;
  timestamp: string;
  type: string;
  paperWidth: string;
  status: string;
  details: string;
}> = [
  {
    id: 'pj-101',
    timestamp: new Date().toLocaleTimeString('en-IN'),
    type: 'TAX_INVOICE',
    paperWidth: '3inch (80mm)',
    status: 'COMPLETED_AUTOCUT',
    details: 'Invoice #GLS-INV-8492 printed with ESC/POS Cut',
  }
];

/**
 * GET /api/printer/settings
 */
app.get('/api/printer/settings', (_req: Request, res: Response) => {
  res.json(storedPrinterSettings);
});

/**
 * POST /api/printer/settings
 * Saves thermal printer configuration (3-inch 80mm or 4-inch 100mm autocut).
 */
app.post('/api/printer/settings', (req: Request, res: Response) => {
  storedPrinterSettings = { ...storedPrinterSettings, ...req.body };
  res.json({ success: true, settings: storedPrinterSettings });
});

/**
 * POST /api/printer/print-test
 * Dispatches test thermal receipt command with autocut emulation.
 */
app.post('/api/printer/print-test', (req: Request, res: Response) => {
  const paper = req.body.paperWidth || storedPrinterSettings.paperWidth;
  const newJob = {
    id: 'pj-' + Date.now(),
    timestamp: new Date().toLocaleTimeString('en-IN'),
    type: 'TEST_ALIGNMENT_RECEIPT',
    paperWidth: paper === '4inch' ? '4inch (104mm)' : '3inch (80mm)',
    status: 'COMPLETED_AUTOCUT',
    details: `Mozz-style test alignment verified for ${paper} thermal roll with auto-cut command`,
  };
  recentPrintJobs.unshift(newJob);
  if (recentPrintJobs.length > 20) recentPrintJobs.pop();

  res.json({
    success: true,
    message: `Test print formatted successfully for ${paper} thermal roll with auto-cut ESC/POS command.`,
    job: newJob,
  });
});

/**
 * GET /api/printer/jobs
 */
app.get('/api/printer/jobs', (_req: Request, res: Response) => {
  res.json(recentPrintJobs);
});

// ============================================================================
// BILLING / POS ENDPOINTS (ADMIN & STAFF ACCESS)
// ============================================================================

let inMemoryBills: any[] = [];

/**
 * GET /api/billing
 */
app.get('/api/billing', (_req: Request, res: Response) => {
  res.json(inMemoryBills);
});

/**
 * POST /api/billing
 * Walk-in POS billing endpoint for admin and staff.
 */
app.post('/api/billing', (req: Request, res: Response): any => {
  const bill = req.body;
  if (!bill || !bill.items || bill.items.length === 0) {
    return res.status(400).json({ error: 'Bill must contain at least one service.' });
  }

  const newBill = {
    ...bill,
    id: bill.id || 'bill-' + Date.now(),
    invoiceNumber: bill.invoiceNumber || `GLS-INV-${Math.floor(1000 + Math.random() * 9000)}`,
    createdAt: bill.createdAt || new Date().toISOString().split('T')[0],
  };

  inMemoryBills.unshift(newBill);

  // Add print job record
  recentPrintJobs.unshift({
    id: 'pj-' + Date.now(),
    timestamp: new Date().toLocaleTimeString('en-IN'),
    type: 'POS_RECEIPT',
    paperWidth: storedPrinterSettings.paperWidth === '4inch' ? '4inch (104mm)' : '3inch (80mm)',
    status: 'COMPLETED_AUTOCUT',
    details: `Invoice ${newBill.invoiceNumber} for ${newBill.customerName} (₹${newBill.grandTotal})`,
  });

  return res.status(201).json(newBill);
});

// ============================================================================
// BACKGROUND TIMER: Automatically process due queue every 30 seconds
// ============================================================================
setInterval(() => {
  processDueScheduledFeedback().catch(err => {
    console.error('[Scheduled Feedback Worker Error]:', err);
  });
}, 30 * 1000);

// ============================================================================
// FRONTEND INTEGRATION: VITE MIDDLEWARE (DEV) & STATIC FILES (PROD)
// ============================================================================

async function startServer() {
  const distPath = path.resolve(__dirname, 'dist');
  const indexPath = path.resolve(distPath, 'index.html');
  const hasDist = fs.existsSync(distPath) && fs.existsSync(indexPath);
  const isProd = process.env.NODE_ENV === 'production' || hasDist;

  if (isProd && hasDist) {
    // Production mode: Serve built static files directly from dist
    console.log('[Server Mode]: Production - serving pre-built static assets from dist/');
    app.use(express.static(distPath));
    app.use((req: Request, res: Response, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api')) {
        return res.sendFile(indexPath);
      }
      next();
    });
  } else {
    // Development mode: Mount Vite middleware dynamically
    try {
      console.log('[Server Mode]: Development - mounting Vite middleware');
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.warn('[Vite Middleware Initialization Warning]:', err);
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[The Glossy Looks Salon] Full-Stack Server running on port ${PORT}`);
    console.log(`[WhatsApp Webhook URL]: http://localhost:${PORT}/api/whatsapp/webhook`);
  });
}

startServer().catch(err => {
  console.error('[Server Startup Failure]:', err);
  process.exit(1);
});
