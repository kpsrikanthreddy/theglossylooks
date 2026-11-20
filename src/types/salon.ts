/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Complete Data Models and Types for The Glossy Looks Salon Platform
 * Matches PostgreSQL / Supabase Relational Schema
 */

export type AdminRole =
  | 'superadmin'
  | 'admin'
  | 'owner'
  | 'manager'
  | 'receptionist'
  | 'stylist'
  | 'pos_billing'
  | 'inventory_staff';

export type SmavSyncStatus = 'SYNCED' | 'PENDING' | 'FAILED';

export type SmavOutletRole = 'ADMIN' | 'POS_BILLING';

export type SmavUserSyncEventType =
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'EMAIL_CHANGED'
  | 'ROLE_CHANGED'
  | 'USER_ACTIVATED'
  | 'USER_DEACTIVATED'
  | 'PASSWORD_RESET'
  | 'RECONCILE_USER';

export type SmavUserSyncAction = 'upsert_user' | 'update_user' | 'set_status' | 'reset_password';

export interface SmavUserSyncOutboxItem {
  id: string;
  idempotency_key: string;
  request_fingerprint?: string | null;
  local_user_id: string | null;
  audit_local_user_id?: string;
  event_type: SmavUserSyncEventType;
  action: SmavUserSyncAction;
  payload: Record<string, any>;
  status: 'PENDING' | 'PROCESSING' | 'SYNCED' | 'FAILED';
  attempts: number;
  max_attempts: number;
  next_retry_at: string;
  locked_at?: string | null;
  last_http_status?: number | null;
  last_error?: string | null;
  conflict?: boolean;
  response_central_auth_id?: string | null;
  performed_by?: string | null;
  created_at: string;
  updated_at: string;
  synced_at?: string | null;
}

export interface User {
  id: string;
  user_id: string; // Alphanumeric staff ID e.g. TGL-OWN01, TGL-MGR01
  email: string;
  password_hash: string;
  role: AdminRole;
  name: string;
  phone: string;
  branch_id?: string; // Assigned salon branch (e.g. 'tgl-gachibowli-main')
  is_active: boolean;
  username?: string;
  central_auth_id?: string;
  central_auth_status?: string;
  central_auth_linked_at?: string;
  central_outlet_code?: string;
  central_sync_version?: number;
  central_last_synced_at?: string;
  central_sync_origin?: string;
  central_sync_status?: SmavSyncStatus;
  central_sync_error?: string | null;
  central_sync_last_attempt_at?: string | null;
  central_sync_outbox_id?: string | null;
  smav_role?: SmavOutletRole;
  last_login_at?: string;
  created_at: string;
  updated_at: string;
}

export interface AdminUser {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: AdminRole;
  phone: string;
  branch_id?: string;
  last_login_at?: string;
}

export interface SalesReportFilter {
  period?: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom';
  startDate?: string;
  endDate?: string;
}

export interface DayWiseSalesRecord {
  date: string;
  formatted_date: string;
  orders_count: number;
  service_sales: number;
  product_sales: number;
  discount_amount: number;
  tax_amount: number;
  total_sales: number;
  paid_amount: number;
  due_amount: number;
  cash_amount: number;
  upi_amount: number;
  card_amount: number;
  split_amount: number;
}

export interface StaffSalesRecord {
  staff_name: string;
  role: string;
  services_count: number;
  service_revenue: number;
  commission_earned: number;
}

export interface DetailedSalesReport {
  filter: {
    period: string;
    startDate: string;
    endDate: string;
  };
  summary: {
    gross_sales: number;
    service_sales: number;
    product_sales: number;
    completed_orders: number;
    cancelled_orders: number;
    refunded_count: number;
    total_refund_amount: number;
    total_discount: number;
    tax_gst: number;
    net_sales: number;
    total_paid: number;
    outstanding_due: number;
  };
  payment_breakdown: {
    cash: number;
    upi: number;
    card: number;
    split: number;
    other: number;
  };
  staff_performance: StaffSalesRecord[];
  day_wise_breakdown: DayWiseSalesRecord[];
}

export interface CustomerAddress {
  label: string; // 'Home', 'Office', etc.
  address_line: string;
  area: string;
  city: string;
}

export interface Customer {
  id: string;
  name: string;
  mobile: string;
  email?: string;
  birthday?: string;
  address?: string;
  saved_addresses?: CustomerAddress[];
  preferences?: string;
  allergies?: string;
  notes?: string;
  loyalty_points: number;
  total_spend: number;
  visit_count: number;
  branch_id?: string;
  branch_name?: string;
  first_visit_at?: string;
  last_visit_at?: string;
  latest_bill_number?: string;
  feedback_rating?: 'good' | 'average' | 'bad' | string;
  status?: string;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export interface OTPSession {
  id: string;
  mobile: string;
  otp: string;
  expires_at: string;
  verified: boolean;
  created_at: string;
}

export interface Staff {
  id: string;
  user_id?: string; // Links to User.id (UUID or internal ID)
  admin_user_id?: string; // Stable internal alphanumeric ID (e.g. TGL-OWN01)
  name: string;
  phone: string;
  email?: string;
  role: string;
  title?: string;
  branch_id?: string;
  joining_date: string;
  salary_type: 'monthly' | 'commission' | 'hybrid';
  base_salary: number;
  commission_rate: number;
  skills: string[];
  working_hours?: string;
  is_active: boolean;
  username?: string;
  central_auth_id?: string;
  central_auth_status?: string;
  central_auth_linked_at?: string;
  central_outlet_code?: string;
  central_sync_version?: number;
  central_last_synced_at?: string;
  central_sync_origin?: string;
  central_sync_status?: SmavSyncStatus;
  central_sync_error?: string | null;
  central_sync_last_attempt_at?: string | null;
  created_at: string;
}

export interface StaffAvailability {
  id: string;
  staff_id: string;
  date: string;
  is_on_leave: boolean;
  shift_start: string;
  shift_end: string;
  notes?: string;
}

export interface ServiceCategory {
  id: string;
  name: string;
  slug: string;
  description: string;
  image_url: string;
  display_order: number;
  is_active: boolean;
}

export interface ServiceAddOn {
  id: string;
  name: string;
  price: number;
  duration_minutes: number;
}

export interface ServiceItem {
  id: string;
  category_id: string;
  /** Top-level group for Salon hierarchy (e.g. 'waxing', 'hair-care', 'threading', 'massage', etc.) */
  salon_group?: string;
  /** Subcategory used for the Salon menu. */
  salon_subcategory?: string;
  name: string;
  slug: string;
  description: string;
  benefits: string;
  duration_minutes: number;
  price: number;
  discount_price?: number;
  is_popular?: boolean;
  is_bridal_festive?: boolean;
  is_active: boolean;
  image_url: string;
  add_ons?: ServiceAddOn[];
  created_at?: string;
  updated_at?: string;
}

export interface PackageCombo {
  id: string;
  name: string;
  description: string;
  service_ids: string[];
  service_names: string[];
  original_price: number;
  package_price: number;
  duration_minutes: number;
  is_active: boolean;
}

export interface AppointmentItem {
  id: string;
  name: string;
  duration: number;
  price: number;
  staff_id?: string;
  staff_name?: string;
}

export interface Appointment {
  id: string;
  booking_reference: string;
  branch_id?: string;
  customer_id?: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  appointment_date: string;
  time_slot: string;
  status: 'Pending' | 'Confirmed' | 'Checked In' | 'Service In Progress' | 'Completed' | 'Cancelled' | 'No Show';
  assigned_staff_id?: string;
  assigned_staff_name?: string;
  services: AppointmentItem[];
  total_amount: number;
  discount_amount: number;
  final_amount: number;
  payment_preference?: 'pay_at_salon' | 'upi' | 'card' | 'advance';
  notes?: string;
  booking_source: 'website' | 'pos' | 'whatsapp' | 'walkin' | 'phone';
  created_at: string;
  updated_at?: string;
  completed_at?: string;
  whatsapp_status?: WhatsAppMessageStatus;
  last_whatsapp_sent_at?: string;
  last_whatsapp_error?: string;
  feedback_whatsapp_status?: WhatsAppMessageStatus;
  feedback_whatsapp_scheduled_at?: string;
  feedback_whatsapp_sent_at?: string;
  feedback_whatsapp_message_id?: string;
  feedback_whatsapp_source?: 'AUTO_FEEDBACK' | 'MANUAL_FEEDBACK';
  deleted_at?: string | null;
  deleted_by?: string | null;
  deleted_by_user_id?: string | null;
  deletion_reason?: string | null;
  restored_at?: string | null;
  restored_by?: string | null;
}

export interface OrderItem {
  service_id?: string;
  product_id?: string;
  item_name: string;
  item_type: 'service' | 'product';
  quantity: number;
  unit_price: number;
  total_price: number;
  staff_id?: string;
  staff_name?: string;
  commission_amount?: number;
  deleted_at?: string | null;
  deleted_by?: string | null;
  deletion_reason?: string | null;
}

export type SmavBillStatus = 'legacy' | 'reserved' | 'finalized' | 'finalize_pending' | 'voided';

export interface Order {
  id: string;
  bill_number: string;
  invoice_number?: string;
  branch_id?: string;
  branch_code?: string;
  branch_name?: string;
  smav_reservation_id?: string;
  smav_sale_id?: string;
  smav_bill_status?: SmavBillStatus;
  smav_finalized_at?: string | null;
  smav_finalize_error?: string | null;
  smav_last_event_id?: string | null;
  smav_last_event_at?: string | null;
  is_legacy_bill?: boolean;
  appointment_id?: string;
  customer_id?: string;
  customer_name: string;
  customer_phone: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  tax_percent: number;
  tax_amount: number;
  tip_amount?: number;
  grand_total: number;
  paid_amount: number;
  due_amount: number;
  payment_status: 'Paid' | 'Partial' | 'Pending' | 'Refunded' | 'Cancelled';
  primary_payment_mode: 'Cash' | 'UPI' | 'Card' | 'Bank Transfer' | 'Split Payment' | 'Pay Later';
  cashier_id?: string;
  cashier_name?: string;
  notes?: string;
  idempotency_key?: string;
  whatsapp_status?: WhatsAppMessageStatus;
  whatsapp_message_id?: string;
  whatsapp_error?: string;
  receipt_whatsapp_status?: WhatsAppMessageStatus;
  receipt_whatsapp_message_id?: string;
  receipt_whatsapp_error?: string;
  receipt_whatsapp_sent_at?: string;
  feedback_whatsapp_status?: WhatsAppMessageStatus;
  feedback_whatsapp_message_id?: string;
  feedback_whatsapp_error?: string;
  feedback_whatsapp_scheduled_at?: string;
  feedback_whatsapp_sent_at?: string;
  feedback_whatsapp_source?: 'AUTO_FEEDBACK' | 'MANUAL_FEEDBACK';
  feedback_rating?: FeedbackRating;
  deleted_at?: string | null;
  deleted_by?: string | null;
  deleted_by_user_id?: string | null;
  deletion_reason?: string | null;
  restored_at?: string | null;
  restored_by?: string | null;
  created_at: string;
}

export interface PaymentRecord {
  id: string;
  order_id: string;
  bill_number: string;
  customer_name: string;
  customer_phone: string;
  amount: number;
  payment_mode: 'Cash' | 'UPI' | 'Card' | 'Bank Transfer' | 'Split Payment' | 'Pay Later';
  transaction_ref?: string;
  status: 'Success' | 'Refunded' | 'Void';
  refund_reason?: string;
  notes?: string;
  recorded_by?: string;
  branch_id?: string;
  branch_code?: string;
  branch_name?: string;
  subtotal?: number;
  discount?: number;
  tax_amount?: number;
  receipt_whatsapp_status?: WhatsAppMessageStatus;
  receipt_whatsapp_error?: string;
  feedback_whatsapp_status?: WhatsAppMessageStatus;
  items?: OrderItem[];
  deleted_at?: string | null;
  deleted_by?: string | null;
  deleted_by_user_id?: string | null;
  deletion_reason?: string | null;
  restored_at?: string | null;
  restored_by?: string | null;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  brand: string;
  category: string;
  unit: string;
  current_stock: number;
  min_stock_alert: number;
  purchase_cost: number;
  sale_price: number;
  expiry_date?: string;
  location?: string;
  supplier_id?: string;
  supplier_name?: string;
  is_retail: boolean;
  updated_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact_person: string;
  phone: string;
  email?: string;
  address?: string;
  gstin?: string;
  created_at: string;
}

export interface PurchaseOrderItem {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
}

export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string;
  supplier_name: string;
  items: PurchaseOrderItem[];
  total_cost: number;
  status: 'Draft' | 'Ordered' | 'Received' | 'Cancelled';
  created_at: string;
}

export interface InventoryMovement {
  id: string;
  product_id: string;
  product_name: string;
  movement_type: 'stock_in' | 'stock_out' | 'damaged' | 'wastage' | 'service_usage' | 'pos_sale' | 'adjustment';
  quantity: number;
  balance_after: number;
  notes?: string;
  performed_by: string;
  created_at: string;
}

export interface GalleryItem {
  id: string;
  title: string;
  category: string;
  artist_name?: string;
  service_type?: string;
  image_url: string;
  video_url?: string;
  description: string;
  tags?: string[];
  is_approved: boolean;
  display_order: number;
  created_at: string;
}

export interface Enquiry {
  id: string;
  name: string;
  phone: string;
  email?: string;
  service_interest: string;
  message: string;
  status: 'New' | 'Contacted' | 'Converted' | 'Closed';
  created_at: string;
}

export interface Offer {
  id: string;
  title: string;
  coupon_code: string;
  discount_type: 'flat' | 'percentage';
  discount_value: number;
  min_order_value: number;
  valid_until: string;
  is_active: boolean;
}

export interface Review {
  id: string;
  customer_name: string;
  customer_area?: string;
  rating: number; // 1 - 5
  comment: string;
  service_rendered?: string;
  is_published: boolean;
  created_at: string;
}

export interface PrintDevice {
  id: string;
  device_name: string;
  device_id: string;
  branch: string;
  printer_name: string;
  printer_type: 'thermal' | 'a4';
  paper_size?: '58mm' | '80mm' | 'A4';
  is_online: boolean;
  auto_print_bill: boolean;
  auto_print_slip: boolean;
  copies: number;
  last_heartbeat: string;
}

export interface PrintJob {
  id: string;
  device_id: string;
  job_type: 'bill' | 'service_ticket';
  order_id?: string;
  appointment_id?: string;
  status: 'Pending' | 'Printing' | 'Printed' | 'Failed' | 'Retried';
  payload: any;
  retry_count: number;
  printed_at?: string;
  created_at: string;
}

export interface SalonSettings {
  brand_name: string;
  salon_type: string;
  address: string;
  city: string;
  phone: string;
  whatsapp: string;
  opening_hours: string;
  google_maps_url: string;
  announcement_text: string;
  primary_color?: string;
  accent_gold?: string;
}

export interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entity_id: string;
  performed_by: string;
  details: string;
  timestamp: string;
}

export type WhatsAppConnectionStatus = 'not_connected' | 'connecting' | 'connected' | 'error' | 'disconnected';

export interface WhatsAppIntegration {
  id: string;
  salon_id: string;
  waba_id?: string;
  phone_number_id?: string;
  display_phone_number?: string;
  masked_phone_number?: string;
  display_name?: string;
  status: WhatsAppConnectionStatus;
  connected_at?: string;
  updated_at?: string;
  last_verified_at?: string;
  diagnostics?: string;
  error_message?: string;
}

export interface WhatsAppBusinessSettings {
  id?: string;
  salon_id?: string;
  business_number: string;
  country_code: string;
  display_name: string;
  is_enabled: boolean;
  masked_number: string;
  updated_at?: string;
  updated_by?: string;
}

export interface WhatsAppPublicConfig {
  meta_app_id: string;
  config_id: string;
  api_version: string;
  is_configured: boolean;
}

export interface WhatsAppStatusResponse {
  integration: WhatsAppIntegration;
  settings: WhatsAppBusinessSettings;
  config: WhatsAppPublicConfig;
}

// ============================================================================
// Multi-Branch Salon & Coexistence WhatsApp Integration Types
// ============================================================================

export interface SalonBranch {
  id: string; // e.g. 'tgl-gachibowli-main'
  name: string; // e.g. 'Gachibowli Main Flagship'
  code: string; // e.g. 'GCB-01'
  smav_branch_code?: string; // Canonical SMAV branch code: 'GACHI' | 'KONDA'
  smav_branch_id?: string;
  address: string;
  city: string;
  phone: string;
  whatsapp_number: string;
  manager_id?: string;
  manager_name?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type BranchWhatsAppStatus = 'disconnected' | 'pairing' | 'connected' | 'failed';

export interface BranchWhatsAppIntegration {
  id: string;
  branch_id: string;
  configured_business_number: string;
  waba_id?: string;
  phone_number_id?: string;
  display_name?: string;
  display_phone_number?: string;
  masked_phone_number?: string;
  status: BranchWhatsAppStatus;
  connected_at?: string;
  last_verified_at?: string;
  diagnostics?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface BranchWhatsAppStatusResponse {
  branch: SalonBranch;
  integration: BranchWhatsAppIntegration;
  config: WhatsAppPublicConfig;
}

// ============================================================================
// WhatsApp Automated Messaging, Feedback & Webhook Types
// ============================================================================

export type WhatsAppMessageStatus =
  | 'queued'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'completed'
  | 'failed'
  | 'retrying'
  | 'cancelled'
  | 'pending_approval';

export interface WhatsAppMessageLog {
  id: string;
  appointment_id?: string;
  order_id?: string;
  bill_number?: string;
  payment_id?: string;
  branch_id?: string;
  template_name: string;
  recipient_number: string;
  customer_name?: string;
  job_type?: 'appointment_confirmation' | 'appointment_reminder' | 'customer_feedback' | 'bill_receipt' | 'payment_reminder' | 'pos_bill' | 'custom' | string;
  sender_phone_number_id?: string;
  meta_message_id?: string;
  status: WhatsAppMessageStatus;
  error_message?: string;
  diagnostics?: string;
  sent_by_user_id?: string;
  sent_by_user_name?: string;
  conversation_id?: string;
  whatsapp_message_id?: string;
  retry_count?: number;
  next_retry_at?: string;
  scheduled_at?: string;
  sent_at?: string;
  delivered_at?: string;
  read_at?: string;
  created_at: string;
  updated_at?: string;
}

export type FeedbackRating = 'good' | 'average' | 'bad';

export interface AppointmentFeedback {
  id: string;
  appointment_id?: string;
  order_id?: string;
  branch_id: string;
  customer_name: string;
  customer_phone: string;
  rating: FeedbackRating;
  reply_text?: string;
  meta_message_id?: string;
  incoming_meta_message_id?: string;
  is_read: boolean;
  notification_read?: boolean;
  reply_status?: 'pending' | 'sending' | 'sent' | 'failed';
  outgoing_meta_message_id?: string;
  reply_sent_at?: string;
  received_at: string;
}

export type ScheduledJobStatus = 'pending' | 'processing' | 'completed' | 'cancelled' | 'failed';

export interface ScheduledFeedbackJob {
  id: string;
  appointment_id?: string;
  order_id?: string;
  branch_id: string;
  customer_name: string;
  customer_phone: string;
  scheduled_at: string; // ISO string
  status: ScheduledJobStatus;
  job_type?: 'customer_feedback' | 'bill_receipt' | string;
  template_name?: string;
  feedback_source?: 'AUTO_FEEDBACK' | 'MANUAL_FEEDBACK';
  claimed_at?: string;
  attempts?: number;
  meta_message_id?: string;
  error_message?: string;
  created_at: string;
  updated_at?: string;
}

export interface ProcessedWebhookEvent {
  id?: string;
  event_id: string;
  event_type: string;
  processed_at: string;
}

// ============================================================================
// Automated Daily Stylist Sales Reporting Types
// ============================================================================

export type DailySalesReportStatus = 'sent' | 'failed' | 'retrying' | 'skipped_duplicate' | 'pending';

export interface DailySalesReportLog {
  id: string;
  report_date: string; // YYYY-MM-DD (Asia/Kolkata)
  report_type: 'stylist_report' | 'owner_summary';
  recipient_type: 'stylist' | 'owner';
  recipient_phone: string;
  recipient_name?: string;
  stylist_id?: string;
  stylist_name?: string;
  branch_id?: string;
  bills_count: number;
  services_count: number;
  total_sales: number;
  cash_amount: number;
  upi_amount: number;
  other_amount: number;
  breakdown_text?: string;
  breakdown_json?: any;
  template_name: string;
  meta_message_id?: string;
  status: DailySalesReportStatus;
  error_message?: string;
  sent_at?: string;
  created_at: string;
  updated_at: string;
}

export interface StylistSalesCalculation {
  stylistId?: string;
  stylistName: string;
  phone: string;
  billsCount: number;
  servicesCount: number;
  totalSales: number;
  cashAmount: number;
  upiAmount: number;
  otherAmount: number;
}

export interface DailySalesSummaryData {
  reportDate: string;
  totalBills: number;
  totalServices: number;
  totalSales: number;
  cashTotal: number;
  upiTotal: number;
  otherTotal: number;
  stylists: StylistSalesCalculation[];
  stylistBreakdownText: string;
}

// ============================================================================
// WhatsApp Inbox / Customer Chat Module Types
// ============================================================================

export type WhatsAppConversationStatus = 'OPEN' | 'CLOSED' | 'open' | 'closed';
export type WhatsAppMessageDirection = 'INBOUND' | 'OUTBOUND' | 'inbound' | 'outbound';
export type WhatsAppMessageType = 'text' | 'interactive' | 'button' | 'template' | 'image' | 'document' | 'status' | 'system';
export type WhatsAppDeliveryStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'received';
export type WhatsAppSourceBadge = 'WEBSITE_ENQUIRY' | 'WHATSAPP' | 'AUTOMATIC' | 'TEMPLATE' | 'ADMIN';
export type WhatsAppConversationSource = 'WHATSAPP' | 'WEBSITE_ENQUIRY' | 'MIXED';

export interface WhatsAppConversation {
  id: string;
  salon_id?: string;
  business_id?: string;
  branch_id?: string;
  customer_id?: string;
  wa_phone_number_id?: string;
  customer_wa_id?: string;
  customer_phone: string;
  customer_name?: string;
  status: WhatsAppConversationStatus;
  unread_count: number;
  last_message_text?: string;
  last_message_preview?: string;
  last_message_at: string;
  last_inbound_at?: string;
  source_channel?: WhatsAppConversationSource;
  metadata?: any;
  created_at: string;
  updated_at: string;
  // Augmented client fields
  customer_avatar?: string;
  window_status?: CustomerServiceWindowInfo;
}

export interface WhatsAppMessage {
  id: string;
  salon_id?: string;
  branch_id?: string;
  conversation_id: string;
  appointment_id?: string;
  order_id?: string;
  bill_number?: string;
  payment_id?: string;
  meta_message_id?: string; // wamid
  direction: WhatsAppMessageDirection;
  message_type?: WhatsAppMessageType;
  type?: WhatsAppMessageType;
  message_body?: string;
  text_body?: string;
  body?: string;
  template_name?: string;
  template_params?: any;
  button_reply_id?: string;
  button_reply_title?: string;
  status?: WhatsAppDeliveryStatus;
  delivery_status?: WhatsAppDeliveryStatus;
  source_badge?: WhatsAppSourceBadge;
  source?: WhatsAppSourceBadge;
  meta_timestamp?: number | string;
  metadata?: any;
  error_code?: string;
  error_message?: string;
  sent_by_user_id?: string;
  sent_by_user_name?: string;
  sender_admin_id?: string;
  sender_admin_name?: string;
  reply_to_message_id?: string;
  created_at?: string;
  sent_at?: string;
  delivered_at?: string;
  read_at?: string;
  received_at?: string;
  failed_at?: string;
}

export interface CustomerServiceWindowInfo {
  isOpen: boolean;
  expiresAt?: string;
  hoursRemaining?: number;
  minutesRemaining?: number;
  formattedRemaining?: string;
}

export type WhatsAppInboxFilter = 'all' | 'unread' | 'open' | 'closed';

export interface WhatsAppWebhookEvent {
  id: string;
  event_id?: string;
  event_type: string;
  sender_phone?: string;
  recipient_phone_number_id?: string;
  payload: any;
  status: 'received' | 'processed' | 'ignored' | 'failed';
  error_message?: string;
  received_at: string;
  processed_at?: string;
}

export interface WhatsAppInboxDiagnostics {
  status: string;
  meta_webhook_callback_url: string;
  last_webhook_received_at?: string | null;
  last_webhook_event_type?: string | null;
  last_webhook_error?: string | null;
  total_events_received: number;
  database_provider: string;
  environment: string;
  waba_phone_number_id?: string;
  active_conversations_count: number;
  last_message_saved_at?: string | null;
  total_conversations_count?: number;
  total_messages_count?: number;
  latest_database_error?: string | null;
}


