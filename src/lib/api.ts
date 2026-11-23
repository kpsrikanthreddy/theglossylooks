/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ServiceCategory,
  ServiceItem,
  PackageCombo,
  Appointment,
  Customer,
  Order,
  PaymentRecord,
  CentralPaymentLedgerResponse,
  Product,
  Supplier,
  PurchaseOrder,
  InventoryMovement,
  Staff,
  PrintDevice,
  PrintJob,
  SalonSettings,
  GalleryItem,
  Enquiry,
  Review,
  User,
  AdminUser,
  AuditLog,
  DetailedSalesReport,
  SalesReportFilter,
  WhatsAppIntegration,
  WhatsAppStatusResponse,
  WhatsAppBusinessSettings,
  SalonBranch,
  BranchWhatsAppIntegration,
  BranchWhatsAppStatusResponse,
  WhatsAppMessageLog,
  AppointmentFeedback,
  ScheduledFeedbackJob,
  DailySalesReportLog,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppInboxFilter,
  WhatsAppInboxDiagnostics,
  SmavSyncStatus,
  SmavOutletRole,
  AdminRole
} from '../types/salon';
import {
  readPersistedAdminSession,
  type AdminBranchPermissions,
  type AdminMeResponse,
} from './adminSession';

export interface SmavSyncClientResult {
  synced: boolean;
  syncStatus: SmavSyncStatus;
  outletCode?: 'glossylooks';
  status?: string;
  outboxId?: string;
  idempotencyKey?: string;
  centralAuthId?: string;
  email?: string;
  username?: string;
  role?: string;
  isNewUser?: boolean;
  mustChangePassword?: boolean;
  conflict?: boolean;
  retryScheduledAt?: string | null;
  passwordResetRequired?: boolean;
  error?: string;
}

export interface SmavReconciliationUserAudit {
  localUserId: string;
  userCode: string;
  name: string;
  email: string;
  rbacRole: AdminRole;
  mappedSmavRole: SmavOutletRole;
  isActive: boolean;
  centralAuthId: string | null;
  staffProfileId: string | null;
  staffJobTitle: string | null;
  staffEmail: string | null;
  staffCentralAuthId: string | null;
  currentSyncStatus: SmavSyncStatus;
  classification: 'ALREADY_SYNCED' | 'READY_UPDATE_BY_UUID' | 'READY_LINK_OR_CREATE' | 'NEEDS_MANUAL_REVIEW';
  anomalies: string[];
  recommendedAction: string;
  syncResult?: SmavSyncClientResult;
}

export interface SmavReconciliationReport {
  dryRun: boolean;
  generatedAt: string;
  summary: {
    totalAdminUsers: number;
    alreadySynced: number;
    readyUpdateByUuid: number;
    readyLinkOrCreate: number;
    needsManualReview: number;
    syncedNow: number;
    pendingNow: number;
    failedNow: number;
    skippedAmbiguous: number;
  };
  users: SmavReconciliationUserAudit[];
}

export interface ApprovedWhatsAppTemplateInfo {
  name: string;
  status: string;
  language: string;
  category?: string;
  components?: any[];
}

export interface WhatsAppRecordContextResponse {
  record_type: 'appointment' | 'order';
  record_id: string;
  branch_id: string;
  branch_name: string;
  customer_name: string;
  customer_phone: string;
  phone_validation: {
    isValid: boolean;
    digits: string;
    e164: string;
    metaRecipient: string;
    error?: string;
  };
  customer_service_window: {
    window_open: boolean;
    last_inbound_at: string | null;
    window_expires_at: string | null;
    conversation_id: string | null;
    policy_note: string;
  };
  templates_source: 'meta_api' | 'unavailable';
  templates_error: string | null;
  approved_templates: ApprovedWhatsAppTemplateInfo[];
  missing_recommended_templates: string[];
  default_variables: Record<string, string>;
  logs: WhatsAppMessageLog[];
}

export interface SendRecordWhatsAppTemplateResponse {
  success: boolean;
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
  message_id?: string;
  error?: string;
  diagnostics?: string;
  log?: WhatsAppMessageLog;
  inbox_message?: WhatsAppMessage | null;
}

const API_BASE = '/api';

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function fetchJson<T>(url: string, options?: RequestInit, adminName?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    ...(options?.headers as Record<string, string> || {})
  };

  // Retrieve admin session token safely (preferring a copy that has a valid token)
  try {
    const savedSession = readPersistedAdminSession();
    if (savedSession) {
      if (savedSession.token) {
        headers['Authorization'] = `Bearer ${savedSession.token}`;
      }
      if (savedSession.user) {
        if (!headers['x-admin-name'] && (savedSession.user.name || adminName)) {
          headers['x-admin-name'] = savedSession.user.name || adminName || '';
        }
        if (savedSession.user.role) {
          headers['x-admin-role'] = savedSession.user.role;
        }
        if (savedSession.user.id) {
          headers['x-admin-user-id'] = savedSession.user.id;
        }
      }
    }
  } catch {
    // Ignore storage parse error
  }

  if (adminName && !headers['x-admin-name']) {
    headers['x-admin-name'] = adminName;
  }

  const method = String(options?.method || 'GET').toUpperCase();
  const maxAttempts = method === 'GET' && !options?.signal ? 2 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = !options?.signal ? new AbortController() : null;
    const timeoutId = controller
      ? window.setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS)
      : null;

    try {
      const res = await fetch(url, {
        ...options,
        credentials: 'include',
        headers,
        signal: options?.signal ?? controller?.signal
      });
      if (!res.ok) {
        if (attempt < maxAttempts && (res.status === 502 || res.status === 503 || res.status === 504)) {
          await new Promise(resolve => window.setTimeout(resolve, 800));
          continue;
        }
        const errorData = await res.json().catch(() => ({}));
        throw new ApiError(
          errorData.error || errorData.message || `Request failed (HTTP ${res.status})`,
          res.status,
          typeof errorData.code === 'string' ? errorData.code : undefined
        );
      }
      return await res.json();
    } catch (err: any) {
      const isTransient = err?.name === 'AbortError' || err instanceof TypeError;
      if (attempt < maxAttempts && isTransient) {
        await new Promise(resolve => window.setTimeout(resolve, 800));
        continue;
      }
      if (err?.name === 'AbortError') {
        throw new ApiError('Request timed out. Please check your connection and try again.', 0, 'REQUEST_TIMEOUT');
      }
      if (err instanceof TypeError) {
        throw new ApiError('Network error. Please check your internet connection and try again.', 0, 'NETWORK_ERROR');
      }
      throw err;
    } finally {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    }
  }

  throw new ApiError('Request failed unexpectedly.', 0, 'UNKNOWN_ERROR');
}

export const api = {
  // Settings
  getSettings: () => fetchJson<SalonSettings>(`${API_BASE}/settings`),
  updateSettings: (data: Partial<SalonSettings>, adminName?: string) =>
    fetchJson<SalonSettings>(`${API_BASE}/settings`, { method: 'PUT', body: JSON.stringify(data) }, adminName),

  // Customer OTP & Private Portal
  sendCustomerOTP: (mobile: string) =>
    fetchJson<{ success: boolean; sessionId: string; message: string }>(`${API_BASE}/auth/customer/send-otp`, {
      method: 'POST',
      body: JSON.stringify({ mobile })
    }),
  verifyCustomerOTP: (mobile: string, otp: string) =>
    fetchJson<{ success: boolean; customer: Customer; token: string }>(`${API_BASE}/auth/customer/verify-otp`, {
      method: 'POST',
      body: JSON.stringify({ mobile, otp })
    }),
  getCustomerMe: (mobile: string) => fetchJson<Customer>(`${API_BASE}/customer/me?mobile=${encodeURIComponent(mobile)}`),
  getCustomerAppointments: (mobile: string) => fetchJson<Appointment[]>(`${API_BASE}/customer/appointments?mobile=${encodeURIComponent(mobile)}`),
  getCustomerOrders: (mobile: string) => fetchJson<Order[]>(`${API_BASE}/customer/orders?mobile=${encodeURIComponent(mobile)}`),

  // Admin Auth & User Management (Owner)
  loginAdmin: (identifier: string, password: string) =>
    fetchJson<{
      success: boolean;
      token: string;
      expires_at?: string;
      user: AdminUser;
      branch_permissions?: AdminBranchPermissions;
    }>(`${API_BASE}/auth/admin/login`, {
      method: 'POST',
      body: JSON.stringify({ identifier, password })
    }),
  getAdminMe: () => fetchJson<AdminMeResponse>(`${API_BASE}/auth/admin/me`),
  refreshAdminSession: () =>
    fetchJson<AdminMeResponse>(`${API_BASE}/auth/admin/session/refresh`, { method: 'POST' }),
  logoutAdmin: () =>
    fetchJson<{ success: boolean }>(`${API_BASE}/auth/admin/logout`, { method: 'POST' }),
  getAdminUsers: () => fetchJson<User[]>(`${API_BASE}/admin/users`),
  createAdminUser: (data: Partial<User>, adminName?: string) =>
    fetchJson<User & { smavSync?: SmavSyncClientResult }>(`${API_BASE}/admin/users`, { method: 'POST', body: JSON.stringify(data) }, adminName),
  updateAdminUser: (id: string, data: Partial<User>, adminName?: string) =>
    fetchJson<User & { smavSync?: SmavSyncClientResult }>(`${API_BASE}/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, adminName),
  resetAdminUserPassword: (id: string, newPassword: string, adminName?: string) =>
    fetchJson<{ success: boolean; message: string; smavSync?: SmavSyncClientResult }>(`${API_BASE}/admin/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password: newPassword })
    }, adminName),
  deleteAdminUser: (id: string, adminName?: string) =>
    fetchJson<{ success: boolean; smavSync?: SmavSyncClientResult | null }>(`${API_BASE}/admin/users/${id}`, { method: 'DELETE' }, adminName),
  retryAdminUserSmavSync: (id: string, adminName?: string) =>
    fetchJson<{ smavSync: SmavSyncClientResult; user: User }>(`${API_BASE}/admin/users/${id}/retry-smav-sync`, { method: 'POST' }, adminName),
  reconcileAdminUsersSmav: (params?: { dryRun?: boolean; userIds?: string[] }, adminName?: string) =>
    fetchJson<SmavReconciliationReport>(`${API_BASE}/admin/users/reconcile-smav`, {
      method: 'POST',
      body: JSON.stringify({ dryRun: params?.dryRun !== false, ...(params?.userIds ? { userIds: params.userIds } : {}) })
    }, adminName),

  // Categories & Services & Packages
  getCategories: () => fetchJson<ServiceCategory[]>(`${API_BASE}/categories`),
  createCategory: (data: Partial<ServiceCategory>, adminName?: string) =>
    fetchJson<ServiceCategory>(`${API_BASE}/categories`, { method: 'POST', body: JSON.stringify(data) }, adminName),
  updateCategory: (id: string, data: Partial<ServiceCategory>, adminName?: string) =>
    fetchJson<ServiceCategory>(`${API_BASE}/categories/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, adminName),
  deleteCategory: (id: string, adminName?: string) =>
    fetchJson<{ success: boolean }>(`${API_BASE}/categories/${id}`, { method: 'DELETE' }, adminName),

  getServices: (categoryId?: string, search?: string) => {
    const params = new URLSearchParams();
    if (categoryId) params.append('category_id', categoryId);
    if (search) params.append('search', search);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return fetchJson<ServiceItem[]>(`${API_BASE}/services${qs}`);
  },
  createService: (data: Partial<ServiceItem>, adminName?: string) =>
    fetchJson<ServiceItem>(`${API_BASE}/services`, { method: 'POST', body: JSON.stringify(data) }, adminName),
  updateService: (id: string, data: Partial<ServiceItem>, adminName?: string) =>
    fetchJson<ServiceItem>(`${API_BASE}/services/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, adminName),
  deleteService: (id: string, adminName?: string) =>
    fetchJson<{ success: boolean }>(`${API_BASE}/services/${id}`, { method: 'DELETE' }, adminName),

  getPackages: () => fetchJson<PackageCombo[]>(`${API_BASE}/packages`),
  createPackage: (data: Partial<PackageCombo>, adminName?: string) =>
    fetchJson<PackageCombo>(`${API_BASE}/packages`, { method: 'POST', body: JSON.stringify(data) }, adminName),
  updatePackage: (id: string, data: Partial<PackageCombo>, adminName?: string) =>
    fetchJson<PackageCombo>(`${API_BASE}/packages/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, adminName),
  deletePackage: (id: string, adminName?: string) =>
    fetchJson<{ success: boolean }>(`${API_BASE}/packages/${id}`, { method: 'DELETE' }, adminName),

  // Appointments
  getAppointments: (filters?: { status?: string; staffId?: string; mobile?: string; deleted?: 'active' | 'deleted' | 'all' }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.staffId) params.append('staff_id', filters.staffId);
    if (filters?.mobile) params.append('mobile', filters.mobile);
    if (filters?.deleted && filters.deleted !== 'active') params.append('deleted', filters.deleted);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return fetchJson<Appointment[]>(`${API_BASE}/appointments${qs}`);
  },
  getAppointmentById: (id: string) => fetchJson<Appointment>(`${API_BASE}/appointments/${id}`),
  createAppointment: (data: any, customerName?: string) =>
    fetchJson<Appointment>(`${API_BASE}/appointments`, { method: 'POST', body: JSON.stringify(data) }, customerName),
  updateAppointment: (id: string, data: Partial<Appointment>, adminName?: string) =>
    fetchJson<Appointment>(`${API_BASE}/appointments/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, adminName),
  cancelAppointment: (id: string, reason: string, adminName?: string) =>
    fetchJson<Appointment>(`${API_BASE}/appointments/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }, adminName),
  softDeleteAppointment: (id: string, reason?: string, adminName?: string) =>
    fetchJson<{ success: boolean; appointment: Appointment }>(
      `${API_BASE}/appointments/${id}`,
      { method: 'DELETE', body: JSON.stringify({ reason }) },
      adminName
    ),
  restoreAppointment: (id: string, adminName?: string) =>
    fetchJson<{ success: boolean; appointment: Appointment }>(
      `${API_BASE}/appointments/${id}/restore`,
      { method: 'POST' },
      adminName
    ),

  // Customers
  getCustomers: (search?: string) => {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    return fetchJson<Customer[]>(`${API_BASE}/customers${qs}`);
  },
  createCustomer: (data: Partial<Customer>, adminName?: string) =>
    fetchJson<Customer>(`${API_BASE}/customers`, { method: 'POST', body: JSON.stringify(data) }, adminName),
  updateCustomer: (id: string, data: Partial<Customer>, adminName?: string) =>
    fetchJson<Customer>(`${API_BASE}/customers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, adminName),
  deleteCustomer: (id: string, adminName?: string) =>
    fetchJson<{ success: boolean }>(`${API_BASE}/customers/${id}`, { method: 'DELETE' }, adminName),

  // Orders & POS
  getOrders: (filters?: { deleted?: 'active' | 'deleted' | 'all'; branchId?: string; startIso?: string; endIso?: string }) => {
    const params = new URLSearchParams();
    if (filters?.deleted && filters.deleted !== 'active') params.append('deleted', filters.deleted);
    if (filters?.branchId && filters.branchId !== 'all') params.append('branch_id', filters.branchId);
    if (filters?.startIso) params.append('start_iso', filters.startIso);
    if (filters?.endIso) params.append('end_iso', filters.endIso);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return fetchJson<Order[]>(`${API_BASE}/orders${qs}`);
  },
  getPosPermittedBranches: () =>
    fetchJson<{
      branches: Array<{
        id: string;
        local_branch_id: string;
        smav_branch_id?: string;
        code: string;
        smav_branch_code: string;
        name: string;
        full_name: string;
        is_active: boolean;
        is_authorized?: boolean;
        source: 'smav';
      }>;
      all_branches?: Array<{
        id: string;
        local_branch_id: string;
        smav_branch_id?: string;
        code: string;
        smav_branch_code: string;
        name: string;
        full_name: string;
        is_active: boolean;
        is_authorized?: boolean;
        source: 'smav';
      }>;
      source: 'smav' | 'smav_error';
      warning?: string | null;
      error?: string | null;
    }>(`${API_BASE}/pos/branches`),
  getOrderById: (orderId: string) => fetchJson<Order>(`${API_BASE}/orders/${orderId}`),
  createOrder: (data: any, adminName?: string) =>
    fetchJson<Order>(`${API_BASE}/orders`, { method: 'POST', body: JSON.stringify(data) }, adminName),
  retryOrderSmavFinalize: (orderId: string, adminName?: string) =>
    fetchJson<{ success: boolean; already_finalized?: boolean; order?: Order; error?: string }>(
      `${API_BASE}/orders/${orderId}/retry-smav-finalize`,
      { method: 'POST' },
      adminName
    ),
  updateOrder: (id: string, data: Partial<Order>, adminName?: string) =>
    fetchJson<Order>(`${API_BASE}/orders/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, adminName),
  softDeleteOrder: (orderId: string, reason?: string, adminName?: string) =>
    fetchJson<{ success: boolean; order: Order; affected_payments: number; affected_order_items: number }>(
      `${API_BASE}/orders/${orderId}`,
      { method: 'DELETE', body: JSON.stringify({ reason }) },
      adminName
    ),
  restoreOrder: (orderId: string, adminName?: string) =>
    fetchJson<{ success: boolean; order: Order; restored_payments: number; restored_order_items: number }>(
      `${API_BASE}/orders/${orderId}/restore`,
      { method: 'POST' },
      adminName
    ),
  getOrderWhatsAppStatus: (orderId: string) =>
    fetchJson<{
      order_id: string;
      receipt_status: string;
      receipt_message_id?: string;
      receipt_error?: string;
      receipt_sent_at?: string;
      feedback_status: string;
      feedback_message_id?: string;
      feedback_error?: string;
      feedback_scheduled_at?: string;
      feedback_sent_at?: string;
    }>(`${API_BASE}/admin/orders/${orderId}/whatsapp/status`),
  sendOrderWhatsAppFeedback: (orderId: string) =>
    fetchJson<{ success: boolean; status: string; message_id?: string; error?: string; message?: string; already_sent?: boolean }>(
      `${API_BASE}/admin/orders/${orderId}/whatsapp/feedback`,
      { method: 'POST' }
    ),
  retryOrderWhatsApp: (orderId: string, jobType?: 'bill_receipt' | 'customer_feedback') =>
    fetchJson<{ success: boolean; status: string; message_id?: string; error?: string; message?: string }>(
      `${API_BASE}/admin/orders/${orderId}/whatsapp/retry`,
      { method: 'POST', body: JSON.stringify({ job_type: jobType }) }
    ),

  // Payments & Refunds
  getCentralPaymentLedger: (filters?: {
    scope?: 'today' | 'history' | 'deleted';
    timezone?: string;
    fromDate?: string;
    toDate?: string;
    branchId?: string;
    search?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.scope) params.append('scope', filters.scope);
    params.append('timezone', filters?.timezone || 'Asia/Kolkata');
    if (filters?.fromDate) params.append('fromDate', filters.fromDate);
    if (filters?.toDate) params.append('toDate', filters.toDate);
    if (filters?.branchId && filters.branchId !== 'all') params.append('branchId', filters.branchId);
    if (filters?.search && filters.search.trim()) params.append('search', filters.search.trim());
    const qs = params.toString() ? `?${params.toString()}` : '';
    return fetchJson<CentralPaymentLedgerResponse>(`${API_BASE}/admin/payments/ledger${qs}`);
  },
  getPayments: (filters?: { deleted?: 'active' | 'deleted' | 'all'; branchId?: string; startIso?: string; endIso?: string }) => {
    const params = new URLSearchParams();
    if (filters?.deleted && filters.deleted !== 'active') params.append('deleted', filters.deleted);
    if (filters?.branchId && filters.branchId !== 'all') params.append('branch_id', filters.branchId);
    if (filters?.startIso) params.append('start_iso', filters.startIso);
    if (filters?.endIso) params.append('end_iso', filters.endIso);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return fetchJson<PaymentRecord[]>(`${API_BASE}/payments${qs}`);
  },
  exportPaymentsCsv: async (filters?: { branchId?: string; startIso?: string; endIso?: string; mode?: string }): Promise<string> => {
    const params = new URLSearchParams();
    if (filters?.branchId && filters.branchId !== 'all') params.append('branch_id', filters.branchId);
    if (filters?.startIso) params.append('start_iso', filters.startIso);
    if (filters?.endIso) params.append('end_iso', filters.endIso);
    if (filters?.mode && filters.mode !== 'all') params.append('mode', filters.mode);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const headers: Record<string, string> = {
      'X-Requested-With': 'XMLHttpRequest',
    };
    try {
      const savedSession = readPersistedAdminSession();
      if (savedSession?.token) headers['Authorization'] = `Bearer ${savedSession.token}`;
    } catch {}
    const res = await fetch(`${API_BASE}/payments/export${qs}`, { headers, credentials: 'include' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to export Payment Ledger CSV (HTTP ${res.status})`);
    }
    return await res.text();
  },
  refundPayment: (id: string, reason: string, adminName?: string) =>
    fetchJson<PaymentRecord>(`${API_BASE}/payments/${id}/refund`, { method: 'POST', body: JSON.stringify({ reason }) }, adminName),
  softDeletePaymentBill: (
    paymentId: string,
    reason?: string,
    adminName?: string,
    meta?: { bill_number?: string; smav_central_bill_id?: string | null; order_id?: string }
  ) =>
    fetchJson<{ success: boolean; order?: Order; smav_synced?: boolean; affected_payments: number; affected_order_items?: number }>(
      `${API_BASE}/payments/${encodeURIComponent(paymentId)}`,
      {
        method: 'DELETE',
        body: JSON.stringify({
          reason,
          ...(meta?.bill_number ? { bill_number: meta.bill_number } : {}),
          ...(meta?.smav_central_bill_id ? { smav_central_bill_id: meta.smav_central_bill_id } : {}),
          ...(meta?.order_id ? { order_id: meta.order_id } : {}),
        }),
      },
      adminName
    ),
  restorePaymentBill: (
    paymentId: string,
    adminName?: string,
    meta?: { bill_number?: string; smav_central_bill_id?: string | null; order_id?: string }
  ) =>
    fetchJson<{ success: boolean; order?: Order; smav_synced?: boolean; restored_payments: number; restored_order_items?: number }>(
      `${API_BASE}/payments/${encodeURIComponent(paymentId)}/restore`,
      {
        method: 'POST',
        body: JSON.stringify({
          ...(meta?.bill_number ? { bill_number: meta.bill_number } : {}),
          ...(meta?.smav_central_bill_id ? { smav_central_bill_id: meta.smav_central_bill_id } : {}),
          ...(meta?.order_id ? { order_id: meta.order_id } : {}),
        }),
      },
      adminName
    ),

  // Products & Inventory
  getProducts: () => fetchJson<Product[]>(`${API_BASE}/products`),
  createProduct: (data: Partial<Product>, adminName?: string) =>
    fetchJson<Product>(`${API_BASE}/products`, { method: 'POST', body: JSON.stringify(data) }, adminName),
  updateProduct: (id: string, data: Partial<Product>, adminName?: string) =>
    fetchJson<Product>(`${API_BASE}/products/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, adminName),
  deleteProduct: (id: string, adminName?: string) =>
    fetchJson<{ success: boolean }>(`${API_BASE}/products/${id}`, { method: 'DELETE' }, adminName),
  getInventoryMovements: () => fetchJson<InventoryMovement[]>(`${API_BASE}/inventory/movements`),
  recordInventoryMovement: (data: any, adminName?: string) =>
    fetchJson<InventoryMovement>(`${API_BASE}/inventory/movement`, { method: 'POST', body: JSON.stringify(data) }, adminName),
  getSuppliers: () => fetchJson<Supplier[]>(`${API_BASE}/suppliers`),
  createSupplier: (data: Partial<Supplier>, adminName?: string) =>
    fetchJson<Supplier>(`${API_BASE}/suppliers`, { method: 'POST', body: JSON.stringify(data) }, adminName),

  // Staff
  getStaff: () => fetchJson<Staff[]>(`${API_BASE}/staff`),
  createStaff: (data: Partial<Staff>, adminName?: string) =>
    fetchJson<Staff>(`${API_BASE}/staff`, { method: 'POST', body: JSON.stringify(data) }, adminName),
  updateStaff: (id: string, data: Partial<Staff>, adminName?: string) =>
    fetchJson<Staff>(`${API_BASE}/staff/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, adminName),
  deleteStaff: (id: string, adminName?: string) =>
    fetchJson<{ success: boolean }>(`${API_BASE}/staff/${id}`, { method: 'DELETE' }, adminName),

  // Gallery
  getGallery: (onlyApproved?: boolean) => {
    const qs = onlyApproved ? '?approved=true' : '';
    return fetchJson<GalleryItem[]>(`${API_BASE}/gallery${qs}`);
  },
  createGalleryItem: (data: Partial<GalleryItem>, adminName?: string) =>
    fetchJson<GalleryItem>(`${API_BASE}/gallery`, { method: 'POST', body: JSON.stringify(data) }, adminName),
  updateGalleryItem: (id: string, data: Partial<GalleryItem>, adminName?: string) =>
    fetchJson<GalleryItem>(`${API_BASE}/gallery/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, adminName),
  deleteGalleryItem: (id: string, adminName?: string) =>
    fetchJson<{ success: boolean }>(`${API_BASE}/gallery/${id}`, { method: 'DELETE' }, adminName),

  // Enquiries & Reviews
  getEnquiries: () => fetchJson<Enquiry[]>(`${API_BASE}/enquiries`),
  createEnquiry: (data: Partial<Enquiry>) =>
    fetchJson<Enquiry>(`${API_BASE}/enquiries`, { method: 'POST', body: JSON.stringify(data) }),
  getReviews: () => fetchJson<Review[]>(`${API_BASE}/reviews`),
  createReview: (data: Partial<Review>) =>
    fetchJson<Review>(`${API_BASE}/reviews`, { method: 'POST', body: JSON.stringify(data) }),

  // Print Devices & Jobs
  getPrintDevices: () => fetchJson<PrintDevice[]>(`${API_BASE}/print-devices`),
  registerPrintDevice: (data: Partial<PrintDevice>) =>
    fetchJson<PrintDevice>(`${API_BASE}/print-devices/register`, { method: 'POST', body: JSON.stringify(data) }),
  getPrintJobs: () => fetchJson<PrintJob[]>(`${API_BASE}/print-jobs`),
  reprintJob: (data: { job_type: 'bill' | 'service_ticket'; order_id?: string; appointment_id?: string; payload: any }) =>
    fetchJson<PrintJob>(`${API_BASE}/print-jobs/reprint`, { method: 'POST', body: JSON.stringify(data) }),
  updatePrintJobStatus: (id: string, status: string) =>
    fetchJson<PrintJob>(`${API_BASE}/print-jobs/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),

  // Reports & Audit Logs
  getReports: () => fetchJson<any>(`${API_BASE}/reports`),
  getDetailedReports: (filter?: SalesReportFilter) => {
    const params = new URLSearchParams();
    if (filter?.period) params.append('period', filter.period);
    if (filter?.startDate) params.append('startDate', filter.startDate);
    if (filter?.endDate) params.append('endDate', filter.endDate);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return fetchJson<DetailedSalesReport>(`${API_BASE}/reports/detailed${qs}`);
  },
  getAuditLogs: () => fetchJson<AuditLog[]>(`${API_BASE}/audit-logs`),

  // WhatsApp Business Coexistence Integration (Legacy Global)
  getWhatsAppStatus: () =>
    fetchJson<WhatsAppStatusResponse>(`${API_BASE}/admin/whatsapp/status`),
  connectWhatsApp: (data: { waba_id?: string; phone_number_id?: string; code?: string; display_name?: string; display_phone_number?: string }, adminName?: string) =>
    fetchJson<{
      success: boolean;
      message?: string;
      diagnostics?: string;
      integration: WhatsAppIntegration;
      selection_required?: boolean;
      candidates?: Array<{ waba_id: string; phone_number_id: string; display_phone_number?: string; verified_name?: string }>;
    }>(`${API_BASE}/admin/whatsapp/connect`, { method: 'POST', body: JSON.stringify(data) }, adminName),
  disconnectWhatsApp: (adminName?: string) =>
    fetchJson<{ success: boolean; message: string; integration: WhatsAppIntegration }>(`${API_BASE}/admin/whatsapp/disconnect`, { method: 'POST' }, adminName),
  updateWhatsAppSettings: (data: Partial<WhatsAppBusinessSettings>, adminName?: string) =>
    fetchJson<{ success: boolean; message: string; settings: WhatsAppBusinessSettings }>(`${API_BASE}/admin/whatsapp/settings`, { method: 'POST', body: JSON.stringify(data) }, adminName),
  testWhatsAppConnection: (adminName?: string) =>
    fetchJson<{ success: boolean; message: string; diagnostics?: string; integration: WhatsAppIntegration }>(`${API_BASE}/admin/whatsapp/test`, { method: 'POST' }, adminName),

  // Multi-Branch Management (Owner & Assigned Branch Manager)
  getBranches: () =>
    fetchJson<SalonBranch[]>(`${API_BASE}/branches`).catch(() => fetchJson<SalonBranch[]>(`${API_BASE}/admin/branches`)),
  getBranchById: (branchId: string) =>
    fetchJson<SalonBranch>(`${API_BASE}/admin/branches/${branchId}`),
  createBranch: (data: Partial<SalonBranch>, adminName?: string) =>
    fetchJson<SalonBranch>(`${API_BASE}/admin/branches`, { method: 'POST', body: JSON.stringify(data) }, adminName),
  updateBranch: (branchId: string, data: Partial<SalonBranch>, adminName?: string) =>
    fetchJson<SalonBranch>(`${API_BASE}/admin/branches/${branchId}`, { method: 'PATCH', body: JSON.stringify(data) }, adminName),
  deleteBranch: (branchId: string, adminName?: string) =>
    fetchJson<{ success: boolean }>(`${API_BASE}/admin/branches/${branchId}`, { method: 'DELETE' }, adminName),

  // Multi-Branch WhatsApp Business Coexistence Onboarding
  getBranchWhatsAppStatus: (branchId: string) =>
    fetchJson<BranchWhatsAppStatusResponse>(`${API_BASE}/admin/branches/${branchId}/whatsapp/status`),
  updateBranchWhatsAppSettings: (branchId: string, data: { whatsapp_number: string; display_name?: string }, adminName?: string) =>
    fetchJson<{ success: boolean; message: string; branch: SalonBranch }>(`${API_BASE}/admin/branches/${branchId}/whatsapp/settings`, { method: 'POST', body: JSON.stringify(data) }, adminName),
  startBranchWhatsAppPairing: (branchId: string, adminName?: string) =>
    fetchJson<{ success: boolean; integration: BranchWhatsAppIntegration }>(`${API_BASE}/admin/branches/${branchId}/whatsapp/pairing`, { method: 'POST' }, adminName),
  connectBranchWhatsApp: (branchId: string, data: { waba_id?: string; phone_number_id?: string; code?: string; display_name?: string; display_phone_number?: string }, adminName?: string) =>
    fetchJson<{
      success: boolean;
      message?: string;
      diagnostics?: string;
      integration: BranchWhatsAppIntegration;
      selection_required?: boolean;
      candidates?: Array<{ waba_id: string; phone_number_id: string; display_phone_number?: string; verified_name?: string }>;
    }>(`${API_BASE}/admin/branches/${branchId}/whatsapp/connect`, { method: 'POST', body: JSON.stringify(data) }, adminName),
  testBranchWhatsApp: (branchId: string, adminName?: string) =>
    fetchJson<{ success: boolean; message: string; diagnostics?: string; integration: BranchWhatsAppIntegration }>(`${API_BASE}/admin/branches/${branchId}/whatsapp/test`, { method: 'POST' }, adminName),
  disconnectBranchWhatsApp: (branchId: string, adminName?: string) =>
    fetchJson<{ success: boolean; message: string; integration: BranchWhatsAppIntegration }>(`${API_BASE}/admin/branches/${branchId}/whatsapp/disconnect`, { method: 'POST' }, adminName),

  // Real WhatsApp Automated Messaging & Feedback
  getWhatsAppMessageLogs: (appointmentId?: string, branchId?: string, orderId?: string) => {
    const params = new URLSearchParams();
    if (appointmentId) params.append('appointment_id', appointmentId);
    if (branchId) params.append('branch_id', branchId);
    if (orderId) params.append('order_id', orderId);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return fetchJson<WhatsAppMessageLog[]>(`${API_BASE}/admin/whatsapp/message-logs${qs}`);
  },
  getWhatsAppRecordContext: (recordType: 'appointment' | 'order', recordId: string) =>
    fetchJson<WhatsAppRecordContextResponse>(
      `${API_BASE}/admin/whatsapp/record-context?record_type=${encodeURIComponent(recordType)}&record_id=${encodeURIComponent(recordId)}`
    ),
  sendRecordWhatsAppTemplate: (payload: {
    record_type: 'appointment' | 'order';
    record_id: string;
    template_name: string;
    template_language?: string;
    variables?: Record<string, string>;
    retry_log_id?: string;
  }) =>
    fetchJson<SendRecordWhatsAppTemplateResponse>(`${API_BASE}/admin/whatsapp/send-record-template`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  getAppointmentFeedback: (branchId?: string) => {
    const qs = branchId ? `?branch_id=${encodeURIComponent(branchId)}` : '';
    return fetchJson<AppointmentFeedback[]>(`${API_BASE}/admin/whatsapp/feedback${qs}`);
  },
  markFeedbackRead: (id: string) =>
    fetchJson<{ success: boolean }>(`${API_BASE}/admin/whatsapp/feedback/${id}/read`, { method: 'POST' }),
  getScheduledFeedbackJobs: (status?: string) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    return fetchJson<ScheduledFeedbackJob[]>(`${API_BASE}/admin/whatsapp/scheduled-jobs${qs}`);
  },
  sendWhatsAppTestTemplate: (data: { branch_id?: string; recipient: string; template_name: string }) =>
    fetchJson<{
      success: boolean;
      status: string;
      message_id?: string;
      error?: string;
      diagnostics?: string;
      log?: WhatsAppMessageLog;
    }>(`${API_BASE}/admin/whatsapp/test-send`, { method: 'POST', body: JSON.stringify(data) }),
  simulateWhatsAppFeedbackReply: (data: { phone: string; rating: string; text?: string; appointment_id?: string }) =>
    fetchJson<{
      success: boolean;
      message?: string;
      feedback?: AppointmentFeedback;
      auto_reply_sent?: string;
      alert_generated?: boolean;
    }>(`${API_BASE}/webhook/simulate-feedback-reply`, { method: 'POST', body: JSON.stringify(data) }),
  sendAppointmentWhatsAppConfirmation: (appointmentId: string, force?: boolean) =>
    fetchJson<{
      success: boolean;
      warning?: string;
      duplicate_prevented?: boolean;
      last_sent_at?: string;
      message?: string;
      status?: string;
      message_id?: string;
      error?: string;
      diagnostics?: string;
      log?: WhatsAppMessageLog;
      appointment?: Appointment;
    }>(`${API_BASE}/admin/appointments/${appointmentId}/whatsapp/confirm`, {
      method: 'POST',
      body: JSON.stringify({ force: !!force })
    }),

  // Daily Stylist Sales Reporting via WhatsApp
  sendDailyStylistSalesReport: (options?: { date?: string; force?: boolean }) =>
    fetchJson<{
      success: boolean;
      message?: string;
      reportDate?: string;
      totalBills?: number;
      totalServices?: number;
      totalSales?: number;
      cashTotal?: number;
      upiTotal?: number;
      otherTotal?: number;
      stylistReportsCount?: number;
      ownerSummarySent?: boolean;
      sent?: any[];
      skipped?: any[];
      failed?: any[];
      error?: string;
    }>(`${API_BASE}/admin/reports/send-daily-stylist-sales`, {
      method: 'POST',
      body: JSON.stringify(options || {})
    }),

  getDailyStylistSalesHistory: (date?: string) => {
    const qs = date ? `?date=${encodeURIComponent(date)}` : '';
    return fetchJson<{
      todayDate: string;
      alreadySentToday: boolean;
      todayReportsCount: number;
      reports: DailySalesReportLog[];
    }>(`${API_BASE}/admin/reports/daily-stylist-sales-history${qs}`);
  },

  // WhatsApp Inbox & Customer Chat
  getWhatsAppConversations: (filter?: WhatsAppInboxFilter, search?: string, branchId?: string) => {
    const params = new URLSearchParams();
    if (filter && filter !== 'all') params.append('filter', filter);
    if (search && search.trim()) params.append('search', search.trim());
    if (branchId) params.append('branch_id', branchId);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return fetchJson<WhatsAppConversation[]>(`${API_BASE}/admin/whatsapp/inbox/conversations${qs}`);
  },

  getWhatsAppConversation: (conversationId: string) =>
    fetchJson<WhatsAppConversation>(`${API_BASE}/admin/whatsapp/inbox/conversations/${encodeURIComponent(conversationId)}`),

  getWhatsAppMessages: (conversationId: string, limit: number = 50, before?: string) => {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (before) params.set('before', before);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return fetchJson<{ conversation?: WhatsAppConversation; messages: WhatsAppMessage[]; has_more?: boolean }>(
      `${API_BASE}/admin/whatsapp/inbox/conversations/${encodeURIComponent(conversationId)}/messages${qs}`
    );
  },

  sendWhatsAppManualMessage: (conversationId: string, text: string) =>
    fetchJson<{
      success: boolean;
      message: WhatsAppMessage;
      conversation: WhatsAppConversation;
      messageId?: string;
    }>(`${API_BASE}/admin/whatsapp/inbox/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text })
    }),

  sendWhatsAppTemplateMessage: (
    conversationId: string,
    payload: { template_name: string; components?: any[]; parameters?: Record<string, string>; custom_body_text?: string }
  ) =>
    fetchJson<{
      success: boolean;
      message: WhatsAppMessage;
      conversation: WhatsAppConversation;
      messageId?: string;
    }>(`${API_BASE}/admin/whatsapp/inbox/conversations/${encodeURIComponent(conversationId)}/send-template`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }),

  updateWhatsAppConversationStatus: (
    conversationId: string,
    data: { status?: 'OPEN' | 'CLOSED'; mark_read?: boolean }
  ) =>
    fetchJson<{ success: boolean; conversation: WhatsAppConversation }>(
      `${API_BASE}/admin/whatsapp/inbox/conversations/${encodeURIComponent(conversationId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data)
      }
    ),

  getWhatsAppInboxUnreadCount: (branchId?: string) => {
    const qs = branchId ? `?branch_id=${encodeURIComponent(branchId)}` : '';
    return fetchJson<{ unread_count: number }>(`${API_BASE}/admin/whatsapp/inbox/unread-count${qs}`);
  },

  getWhatsAppTemplatesList: () =>
    fetchJson<{ data: any[] }>(`${API_BASE}/admin/whatsapp/templates`),

  getWhatsAppInboxDiagnostics: () =>
    fetchJson<WhatsAppInboxDiagnostics>(`${API_BASE}/admin/whatsapp/inbox/diagnostics`),

  deleteWhatsAppConversation: (conversationId: string) =>
    fetchJson<{ success: boolean; message: string }>(
      `${API_BASE}/admin/whatsapp/inbox/conversations/${encodeURIComponent(conversationId)}`,
      { method: 'DELETE' }
    )
};

