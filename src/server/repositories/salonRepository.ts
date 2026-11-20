/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Clean Repository Interface for The Glossy Looks Salon Management System
 * Decouples database implementation (Supabase, PostgreSQL, SQLite, or File-backed DB)
 * from API route handlers and business logic.
 */

import type {
  User,
  Customer,
  OTPSession,
  Staff,
  StaffAvailability,
  ServiceCategory,
  ServiceItem,
  ServiceAddOn,
  PackageCombo,
  Appointment,
  Order,
  PaymentRecord,
  Product,
  Supplier,
  PurchaseOrder,
  InventoryMovement,
  GalleryItem,
  Enquiry,
  Offer,
  Review,
  PrintDevice,
  PrintJob,
  SalonSettings,
  AuditLog,
  DetailedSalesReport,
  SalesReportFilter,
  WhatsAppIntegration,
  WhatsAppBusinessSettings,
  SalonBranch,
  BranchWhatsAppIntegration,
  WhatsAppMessageLog,
  AppointmentFeedback,
  ScheduledFeedbackJob,
  ProcessedWebhookEvent,
  DailySalesReportLog,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppInboxFilter,
  WhatsAppWebhookEvent,
  WhatsAppInboxDiagnostics,
  SmavUserSyncOutboxItem,
  SmavUserSyncEventType,
  SmavUserSyncAction
} from '../../types/salon.ts';

export interface ISalonRepository {
  // Branches (Multi-Branch Coexistence)
  getBranches(): Promise<SalonBranch[]>;
  getBranchById(id: string): Promise<SalonBranch | null>;
  createBranch(branch: Omit<SalonBranch, 'id' | 'created_at' | 'updated_at'>, performedBy: string): Promise<SalonBranch>;
  updateBranch(id: string, data: Partial<SalonBranch>, performedBy: string): Promise<SalonBranch | null>;
  deleteBranch(id: string, performedBy: string): Promise<boolean>;

  // Branch WhatsApp Coexistence Integrations
  getBranchWhatsAppIntegration(branchId: string): Promise<BranchWhatsAppIntegration>;
  updateBranchWhatsAppIntegration(branchId: string, data: Partial<BranchWhatsAppIntegration>, performedBy: string): Promise<BranchWhatsAppIntegration>;
  disconnectBranchWhatsAppIntegration(branchId: string, performedBy: string): Promise<BranchWhatsAppIntegration>;

  // Settings & WhatsApp Integration (Legacy Global)
  getSettings(): Promise<SalonSettings>;
  updateSettings(data: Partial<SalonSettings>, performedBy: string): Promise<SalonSettings>;
  getWhatsAppIntegration(): Promise<WhatsAppIntegration>;
  updateWhatsAppIntegration(data: Partial<WhatsAppIntegration>, performedBy: string): Promise<WhatsAppIntegration>;
  disconnectWhatsAppIntegration(performedBy: string): Promise<WhatsAppIntegration>;
  getWhatsAppBusinessSettings(): Promise<WhatsAppBusinessSettings>;
  updateWhatsAppBusinessSettings(settings: Partial<WhatsAppBusinessSettings>, performedBy: string): Promise<WhatsAppBusinessSettings>;

  // Users & Staff
  getUsers(): Promise<User[]>;
  getUserByEmail(email: string): Promise<User | null>;
  getUserByIdentifier(identifier: string): Promise<User | null>;
  createUser(user: Omit<User, 'id' | 'created_at' | 'updated_at'>, performedBy: string): Promise<User>;
  updateUser(id: string, data: Partial<User>, performedBy: string): Promise<User | null>;
  resetUserPassword(id: string, newPassword: string, performedBy: string): Promise<boolean>;
  deleteUser(id: string, performedBy: string): Promise<boolean>;

  getStaff(): Promise<Staff[]>;
  getStaffById(id: string): Promise<Staff | null>;
  createStaff(staff: Omit<Staff, 'id' | 'created_at'>, performedBy: string): Promise<Staff>;
  updateStaff(id: string, data: Partial<Staff>, performedBy: string): Promise<Staff | null>;
  deleteStaff(id: string, performedBy: string): Promise<boolean>;

  // Customer & Auth
  createOTPSession(mobile: string): Promise<{ sessionId: string; otp: string }>;
  verifyOTP(mobile: string, otp: string): Promise<{ success: boolean; customer: Customer; token: string }>;
  getCustomers(search?: string): Promise<Customer[]>;
  getCustomerById(id: string): Promise<Customer | null>;
  getCustomerByMobile(mobile: string): Promise<Customer | null>;
  createCustomer(data: Omit<Customer, 'id' | 'created_at' | 'updated_at'>, performedBy: string): Promise<Customer>;
  updateCustomer(id: string, data: Partial<Customer>, performedBy: string): Promise<Customer | null>;
  deleteCustomer(id: string, performedBy: string): Promise<boolean>;
  upsertCustomerFromOrderOrAppointment(payload: { name: string; phone: string; email?: string; branchId?: string; spend?: number; billNumber?: string; isVisit?: boolean }): Promise<Customer>;

  // Categories & Services & Packages
  getCategories(): Promise<ServiceCategory[]>;
  createCategory(cat: Omit<ServiceCategory, 'id'>, performedBy: string): Promise<ServiceCategory>;
  updateCategory(id: string, cat: Partial<ServiceCategory>, performedBy: string): Promise<ServiceCategory | null>;
  deleteCategory(id: string, performedBy: string): Promise<boolean>;

  getServices(categoryId?: string, search?: string): Promise<ServiceItem[]>;
  getServiceById(id: string): Promise<ServiceItem | null>;
  createService(srv: Omit<ServiceItem, 'id' | 'created_at' | 'updated_at'>, performedBy: string): Promise<ServiceItem>;
  updateService(id: string, srv: Partial<ServiceItem>, performedBy: string): Promise<ServiceItem | null>;
  deleteService(id: string, performedBy: string): Promise<boolean>;

  getPackages(): Promise<PackageCombo[]>;
  createPackage(pkg: Omit<PackageCombo, 'id'>, performedBy: string): Promise<PackageCombo>;
  updatePackage(id: string, pkg: Partial<PackageCombo>, performedBy: string): Promise<PackageCombo | null>;
  deletePackage(id: string, performedBy: string): Promise<boolean>;

  // Appointments
  getAppointments(filters?: {
    status?: string;
    staffId?: string;
    customerMobile?: string;
    deleted?: 'active' | 'deleted' | 'all';
  }): Promise<Appointment[]>;
  getAppointmentById(id: string): Promise<Appointment | null>;
  createAppointment(apt: Omit<Appointment, 'id' | 'booking_reference' | 'created_at' | 'updated_at'>, performedBy?: string): Promise<Appointment>;
  updateAppointment(id: string, data: Partial<Appointment>, performedBy: string): Promise<Appointment | null>;
  cancelAppointment(id: string, reason: string, performedBy: string): Promise<Appointment | null>;
  softDeleteAppointment(
    id: string,
    actor: { userId?: string; name: string },
    reason: string
  ): Promise<Appointment | null>;
  restoreAppointment(
    id: string,
    actor: { userId?: string; name: string }
  ): Promise<Appointment | null>;

  // Orders & POS Invoicing
  getOrders(filters?: {
    customerMobile?: string;
    paymentStatus?: string;
    deleted?: 'active' | 'deleted' | 'all';
    branchId?: string;
    startIso?: string;
    endIso?: string;
  }): Promise<Order[]>;
  getOrderById(id: string): Promise<Order | null>;
  getOrderByIdempotencyKey(idempotencyKey: string): Promise<Order | null>;
  createOrder(orderData: Omit<Order, 'id' | 'created_at'>, performedBy: string): Promise<Order>;
  updateOrder(id: string, data: Partial<Order>): Promise<Order | null>;
  updateOrderStatus(id: string, status: Order['payment_status'], performedBy: string): Promise<Order | null>;
  softDeleteOrderTransaction(
    orderOrPaymentId: string,
    actor: { userId?: string; name: string },
    reason: string
  ): Promise<{ order: Order; affectedPayments: number } | null>;
  restoreOrderTransaction(
    orderOrPaymentId: string,
    actor: { userId?: string; name: string }
  ): Promise<{ order: Order; restoredPayments: number } | null>;

  // Payments & Refunds
  getPayments(filters?: {
    deleted?: 'active' | 'deleted' | 'all';
    branchId?: string;
    startIso?: string;
    endIso?: string;
  }): Promise<PaymentRecord[]>;
  recordPayment(payment: Omit<PaymentRecord, 'id' | 'created_at'>, performedBy: string): Promise<PaymentRecord>;
  refundPayment(id: string, reason: string, performedBy: string): Promise<PaymentRecord | null>;

  // Inventory Products, Suppliers & Movements
  getProducts(): Promise<Product[]>;
  getProductById(id: string): Promise<Product | null>;
  createProduct(prod: Omit<Product, 'id' | 'updated_at'>, performedBy: string): Promise<Product>;
  updateProduct(id: string, prod: Partial<Product>, performedBy: string): Promise<Product | null>;
  deleteProduct(id: string, performedBy: string): Promise<boolean>;
  recordInventoryMovement(movement: Omit<InventoryMovement, 'id' | 'created_at'>, performedBy: string): Promise<InventoryMovement>;
  getInventoryMovements(): Promise<InventoryMovement[]>;

  getSuppliers(): Promise<Supplier[]>;
  createSupplier(sup: Omit<Supplier, 'id' | 'created_at'>, performedBy: string): Promise<Supplier>;

  getPurchaseOrders(): Promise<PurchaseOrder[]>;
  createPurchaseOrder(po: Omit<PurchaseOrder, 'id' | 'created_at'>, performedBy: string): Promise<PurchaseOrder>;

  // Gallery Portfolio
  getGallery(onlyApproved?: boolean): Promise<GalleryItem[]>;
  createGalleryItem(item: Omit<GalleryItem, 'id' | 'created_at'>, performedBy: string): Promise<GalleryItem>;
  updateGalleryItem(id: string, item: Partial<GalleryItem>, performedBy: string): Promise<GalleryItem | null>;
  deleteGalleryItem(id: string, performedBy: string): Promise<boolean>;

  // Enquiries & Reviews
  getEnquiries(): Promise<Enquiry[]>;
  createEnquiry(enquiry: Omit<Enquiry, 'id' | 'created_at'>): Promise<Enquiry>;
  getReviews(): Promise<Review[]>;
  createReview(review: Omit<Review, 'id' | 'created_at'>): Promise<Review>;

  // Print Devices & Print Queue
  getPrintDevices(): Promise<PrintDevice[]>;
  registerPrintDevice(device: Partial<PrintDevice>): Promise<PrintDevice>;
  updateDeviceHeartbeat(deviceId: string): Promise<void>;
  getPrintJobs(deviceId?: string): Promise<PrintJob[]>;
  queuePrintJob(job: { device_id: string; job_type: 'bill' | 'service_ticket'; order_id?: string; appointment_id?: string; payload: any }): Promise<PrintJob>;
  updatePrintJobStatus(id: string, status: PrintJob['status']): Promise<PrintJob | null>;

  // Audit Logs & Reports
  getAuditLogs(): Promise<AuditLog[]>;
  logAudit(action: string, entity: string, entityId: string, performedBy: string, details: string): Promise<AuditLog>;
  getReports(): Promise<any>;
  getDetailedReports(filter?: SalesReportFilter): Promise<DetailedSalesReport>;

  // WhatsApp Message Logs
  getWhatsAppMessageLogs(appointmentId?: string, branchId?: string, orderId?: string): Promise<WhatsAppMessageLog[]>;
  createWhatsAppMessageLog(log: Omit<WhatsAppMessageLog, 'id' | 'created_at' | 'updated_at'>): Promise<WhatsAppMessageLog>;
  updateWhatsAppMessageLog(id: string, data: Partial<WhatsAppMessageLog>): Promise<WhatsAppMessageLog | null>;
  updateWhatsAppMessageLogByMetaId(metaMessageId: string, data: Partial<WhatsAppMessageLog>): Promise<WhatsAppMessageLog | null>;
  getDueWhatsAppMessageRetries(): Promise<WhatsAppMessageLog[]>;

  // Customer Feedback
  getAppointmentFeedback(branchId?: string): Promise<AppointmentFeedback[]>;
  createAppointmentFeedback(feedback: Omit<AppointmentFeedback, 'id' | 'received_at'>): Promise<AppointmentFeedback>;
  updateAppointmentFeedback(id: string, data: Partial<AppointmentFeedback>): Promise<AppointmentFeedback | null>;
  markFeedbackAsRead(id: string): Promise<boolean>;

  // Durable Scheduled Feedback Jobs
  getScheduledFeedbackJobs(status?: string): Promise<ScheduledFeedbackJob[]>;
  getDueScheduledFeedbackJobs(): Promise<ScheduledFeedbackJob[]>;
  createScheduledFeedbackJob(job: Omit<ScheduledFeedbackJob, 'id' | 'created_at' | 'updated_at'>): Promise<ScheduledFeedbackJob>;
  updateScheduledFeedbackJob(id: string, data: Partial<ScheduledFeedbackJob>): Promise<ScheduledFeedbackJob | null>;
  claimScheduledFeedbackJob(id: string): Promise<ScheduledFeedbackJob | null>;
  isFeedbackAlreadySentOrClaimed(appointmentId?: string, orderId?: string): Promise<boolean>;
  cancelScheduledFeedbackJobByAppointment(appointmentId: string): Promise<boolean>;
  cancelScheduledFeedbackJobByOrder(orderId: string): Promise<boolean>;

  // Webhook Event Idempotency
  isWebhookEventProcessed(eventId: string): Promise<boolean>;
  recordProcessedWebhookEvent(eventId: string, eventType: string): Promise<ProcessedWebhookEvent>;

  // Automated Daily Stylist Sales Reporting
  getDailySalesReports(date?: string): Promise<DailySalesReportLog[]>;
  getDailySalesReportByRecipient(date: string, recipientPhone: string, reportType: string): Promise<DailySalesReportLog | null>;
  createDailySalesReport(report: Omit<DailySalesReportLog, 'id' | 'created_at' | 'updated_at'>): Promise<DailySalesReportLog>;
  updateDailySalesReport(id: string, data: Partial<DailySalesReportLog>): Promise<DailySalesReportLog | null>;

  // WhatsApp Inbox & Conversations
  getWhatsAppConversations(
    salonIdOrOpts?: string | { salonId?: string; salon_id?: string; branchId?: string; branch_id?: string; filter?: WhatsAppInboxFilter; status?: any; search?: string },
    branchId?: string,
    filter?: WhatsAppInboxFilter,
    search?: string
  ): Promise<WhatsAppConversation[]>;
  getWhatsAppConversationById(id: string): Promise<WhatsAppConversation | null>;
  getOrCreateWhatsAppConversation(data: {
    salonId?: string;
    salon_id?: string;
    branchId?: string;
    branch_id?: string;
    customerPhone?: string;
    customer_phone?: string;
    customerName?: string;
    customer_name?: string;
    waPhoneNumberId?: string;
    wa_phone_number_id?: string;
    customerWaId?: string;
    customer_wa_id?: string;
    customerId?: string;
    customer_id?: string;
    sourceChannel?: 'WHATSAPP' | 'WEBSITE_ENQUIRY' | 'MIXED';
    source_channel?: 'WHATSAPP' | 'WEBSITE_ENQUIRY' | 'MIXED';
  }): Promise<WhatsAppConversation>;
  updateWhatsAppConversation(id: string, data: Partial<WhatsAppConversation>): Promise<WhatsAppConversation | null>;
  deleteWhatsAppConversation(id: string): Promise<boolean>;
  markWhatsAppConversationRead(id: string): Promise<boolean>;
  getWhatsAppInboxUnreadCount(salonId?: string, branchId?: string): Promise<number>;

  // WhatsApp Messages
  getWhatsAppMessages(conversationId: string, limit?: number, before?: string): Promise<WhatsAppMessage[]>;
  createWhatsAppMessage(message: Omit<WhatsAppMessage, 'id' | 'created_at'>): Promise<WhatsAppMessage>;
  updateWhatsAppMessageByMetaId(metaMessageId: string, data: Partial<WhatsAppMessage>): Promise<WhatsAppMessage | null>;
  updateWhatsAppMessage(id: string, data: Partial<WhatsAppMessage>): Promise<WhatsAppMessage | null>;

  // Webhook Events & Diagnostics
  createWhatsAppWebhookEvent(event: Omit<WhatsAppWebhookEvent, 'id' | 'received_at'>): Promise<WhatsAppWebhookEvent>;
  getWhatsAppWebhookDiagnostics(): Promise<WhatsAppInboxDiagnostics>;

  // Durable SMAV User Sync Outbox (Atomic Transactional Writes, Safe Idempotency, Verified Linking & Claim-Time Retries)
  createUserWithSmavOutbox(
    userData: Omit<User, 'id' | 'created_at' | 'updated_at'>,
    outbox: {
      idempotency_key: string;
      event_type: SmavUserSyncEventType;
      action: Exclude<SmavUserSyncAction, 'reset_password'>;
      max_attempts?: number;
      credential_mode?: 'explicit' | 'generated';
      verifyReplayPassword?: (storedPasswordHash: string) => boolean;
    },
    performedBy: string
  ): Promise<{ user: User; outboxItem: SmavUserSyncOutboxItem; created: boolean; idempotentReplay?: boolean; atomic: boolean }>;
  updateUserWithSmavOutbox(
    id: string,
    updateData: Partial<User>,
    outbox: {
      idempotency_key: string;
      event_type: SmavUserSyncEventType;
      action: Exclude<SmavUserSyncAction, 'reset_password'>;
      max_attempts?: number;
    },
    performedBy: string
  ): Promise<{ user: User; outboxItem: SmavUserSyncOutboxItem; created: boolean; idempotentReplay?: boolean; atomic: boolean } | null>;
  linkVerifiedCentralAuthId(input: {
    local_user_id: string;
    verified_central_auth_id: string;
    verification_source: 'smav_sync_response';
    evidence_ref: string;
    performed_by?: string;
  }): Promise<User>;
  enqueueSmavUserSyncEvent(input: {
    idempotency_key: string;
    local_user_id: string;
    event_type: SmavUserSyncEventType;
    action: SmavUserSyncAction;
    payload: Record<string, any>;
    performed_by?: string;
    max_attempts?: number;
    request_fingerprint?: string | null;
  }): Promise<{ item: SmavUserSyncOutboxItem; created: boolean }>;
  recordSmavSyncAuditEvent(input: {
    idempotency_key: string;
    local_user_id: string;
    event_type: SmavUserSyncEventType;
    action: SmavUserSyncAction;
    payload: Record<string, any>;
    request_fingerprint?: string | null;
    status: 'SYNCED' | 'FAILED';
    last_http_status?: number | null;
    last_error?: string | null;
    conflict?: boolean;
    response_central_auth_id?: string | null;
    performed_by?: string;
  }): Promise<SmavUserSyncOutboxItem>;
  claimSmavUserSyncEventById(id: string): Promise<SmavUserSyncOutboxItem | null>;
  claimDueSmavUserSyncEvents(limit?: number, staleLockMinutes?: number): Promise<SmavUserSyncOutboxItem[]>;
  getSmavUserSyncOutbox(filters?: { localUserId?: string; status?: string; limit?: number }): Promise<SmavUserSyncOutboxItem[]>;
  getSmavUserSyncOutboxById(id: string): Promise<SmavUserSyncOutboxItem | null>;
  getSmavUserSyncOutboxByIdempotencyKey(idempotencyKey: string): Promise<SmavUserSyncOutboxItem | null>;
  updateSmavUserSyncEvent(id: string, data: Partial<SmavUserSyncOutboxItem>): Promise<SmavUserSyncOutboxItem | null>;
}

export class IdempotencyKeyConflictError extends Error {
  public readonly statusCode = 409;
  public readonly code = 'IDEMPOTENCY_KEY_CONFLICT';
  public readonly idempotencyKey: string;

  constructor(idempotencyKey: string, message?: string) {
    super(
      message ||
        `Idempotency key conflict: "${idempotencyKey}" was already used with a different request payload.`
    );
    this.name = 'IdempotencyKeyConflictError';
    this.idempotencyKey = idempotencyKey;
  }
}

export function isIdempotencyKeyConflictError(err: unknown): err is IdempotencyKeyConflictError {
  if (err instanceof IdempotencyKeyConflictError) return true;
  const msg = typeof (err as any)?.message === 'string' ? (err as any).message : '';
  return msg.includes('IDEMPOTENCY_KEY_CONFLICT');
}

export class Migration024RequiredError extends Error {
  public readonly statusCode = 503;
  public readonly code = 'MIGRATION_024_REQUIRED';
  public readonly missingObject: string;

  constructor(missingObject: string, detail?: string) {
    super(
      `MIGRATION_024_REQUIRED: Required Migration 024 database object (${missingObject}) is not installed in Supabase. Refusing non-atomic write to protect Glossy Looks <-> SMAV identity integrity. Apply database/migrations/024_smav_user_sync_outbox.sql and retry.${detail ? ` (${detail})` : ''}`
    );
    this.name = 'Migration024RequiredError';
    this.missingObject = missingObject;
  }
}

export function isMigration024RequiredError(err: unknown): err is Migration024RequiredError {
  if (err instanceof Migration024RequiredError) return true;
  const code = (err as any)?.code;
  const msg = typeof (err as any)?.message === 'string' ? (err as any).message : '';
  return code === 'MIGRATION_024_REQUIRED' || msg.includes('MIGRATION_024_REQUIRED');
}

export class CentralAuthLinkForbiddenError extends Error {
  public readonly statusCode = 403;
  public readonly code = 'CENTRAL_AUTH_LINK_FORBIDDEN';

  constructor(message?: string) {
    super(
      message ||
        'CENTRAL_AUTH_LINK_FORBIDDEN: Ordinary user or staff updates cannot assign or modify central_auth_id. Use verified Central SMAV linking or audited manual reconciliation.'
    );
    this.name = 'CentralAuthLinkForbiddenError';
  }
}

export function isCentralAuthLinkForbiddenError(err: unknown): err is CentralAuthLinkForbiddenError {
  if (err instanceof CentralAuthLinkForbiddenError) return true;
  const code = (err as any)?.code;
  const msg = typeof (err as any)?.message === 'string' ? (err as any).message : '';
  return code === 'CENTRAL_AUTH_LINK_FORBIDDEN' || msg.includes('CENTRAL_AUTH_LINK_FORBIDDEN');
}



