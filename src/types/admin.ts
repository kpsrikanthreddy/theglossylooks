export type AdminRole = 'SALON_ADMIN' | 'SALON_STAFF' | 'SUPER_ADMIN' | 'RECEPTIONIST' | 'STAFF';

export type AdminRoute = 
  | 'login'
  | 'dashboard'
  | 'appointments'
  | 'customers'
  | 'customer-detail'
  | 'services'
  | 'staff'
  | 'billing'
  | 'feedback'
  | 'gallery'
  | 'enquiries'
  | 'whatsapp'
  | 'settings';

export type AdminSubRoute = AdminRoute;

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  phone?: string;
  avatar?: string;
  active?: boolean;
  assignedStaffId?: string; // links to Artist/Staff if role is STAFF
  createdAt: string;
  lastLogin?: string;
}

export interface PrinterSettings {
  enabled: boolean;
  printerName: string;
  connectionType: 'local_agent' | 'network_ip' | 'browser_direct';
  paperWidth: '3inch' | '4inch';
  autoPrint: boolean;
  autoCut: boolean;
  copies: number;
  networkIp?: string;
}

export interface PrintJob {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  type: 'bill' | 'test' | 'reprint';
  paperWidth: '3inch' | '4inch';
  autoCut: boolean;
  copies: number;
  status: 'pending' | 'claimed' | 'printed' | 'failed';
  content: any;
  createdAt: string;
  printedAt?: string;
  errorMessage?: string;
}

export interface AdminSession {
  token: string;
  user: AdminUser;
  expiresAt: number;
}

export interface CustomerProfile {
  id: string;
  name: string;
  phone: string;
  email?: string;
  lastVisit?: string;
  totalVisits: number;
  totalSpend: number;
  lastService?: string;
  notes?: string;
  createdAt: string;
}

export type FeedbackRating = 'GOOD' | 'AVERAGE' | 'BAD';

export interface CustomerFeedback {
  id: string;
  appointmentId: string;
  customerName: string;
  customerPhone: string;
  serviceName: string;
  artistName?: string;
  rating: FeedbackRating;
  comment?: string;
  createdAt: string;
  requiresFollowUp: boolean;
  followUpStatus: 'PENDING' | 'CONTACTED' | 'RESOLVED';
  followUpNotes?: string;
  googleReviewSent?: boolean;
}

export interface WhatsAppSettings {
  enabled: boolean;
  delayMinutes: number; // 15, 30, 60, 120, etc. Default 30
  templateName: string; // default: 'glossylooks_feedback'
  sendGoogleReviewOnGood: boolean;
  phoneNumberId: string;
  wabaId: string;
  webhookStatus: 'ACTIVE' | 'PENDING' | 'DISCONNECTED';
  lastWebhookReceived?: string;
  maskedToken: string; // e.g., '••••••••••••1234'
}

export interface WhatsAppMessageLog {
  id: string;
  customerName: string;
  customerPhone: string;
  templateName?: string;
  direction?: 'inbound' | 'outbound';
  messageType?: string;
  type?: 'APPOINTMENT_CONFIRMATION' | 'APPOINTMENT_REMINDER' | 'FEEDBACK_REQUEST' | 'FEEDBACK_FOLLOWUP' | 'GOOGLE_REVIEW_LINK' | string;
  status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'RECEIVED' | string;
  waMessageId?: string;
  apiAccepted?: boolean;
  httpStatus?: number;
  errorCode?: string | number | null;
  errorMessage?: string | null;
  errorData?: any;
  fbtraceId?: string | null;
  contacts?: any;
  messagePreview?: string;
  messageText?: string;
  rawRequest?: any;
  rawResponse?: any;
  timestamp: string;
  appointmentId?: string;
  isTest?: boolean;
}

export interface SalonSettings {
  businessName: string;
  address: string;
  openingTime: string;
  closingTime: string;
  phone: string;
  email: string;
  whatsappNumber: string;
  googleMapsUrl: string;
  googleBusinessProfileUrl: string;
  googleReviewUrl: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  actorName: string;
  actorRole: AdminRole;
  action: string;
  entity: string;
  entityId: string;
  details?: string;
}
