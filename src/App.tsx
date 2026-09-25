/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Calendar, ArrowRight } from 'lucide-react';
import { 
  SalonService, 
  Artist, 
  GalleryWork, 
  Appointment, 
  BillOrder, 
  CustomerEnquiry, 
  RetailProduct 
} from './types/salon';
import { 
  AdminSession, 
  AdminUser, 
  CustomerProfile,
  CustomerFeedback, 
  WhatsAppSettings, 
  SalonSettings, 
  AuditLog, 
  WhatsAppMessageLog,
  AdminSubRoute,
  PrinterSettings
} from './types/admin';
import { 
  INITIAL_SERVICES, 
  INITIAL_ARTISTS, 
  INITIAL_GALLERY, 
  INITIAL_APPOINTMENTS, 
  INITIAL_BILLS, 
  INITIAL_ENQUIRIES, 
  INITIAL_RETAIL_PRODUCTS,
  SALON_INFO
} from './data/initialData';
import { getStoredSession, clearStoredSession } from './services/authService';
import { useAdminRouter } from './hooks/useAdminRouter';
import { getCustomerProfiles } from './services/customerService';
import { onAppointmentCompletedHook } from './services/feedbackAutomationService';

// Customer Facing Components
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { ServicesMenu } from './components/ServicesMenu';
import { ArtistsSection } from './components/ArtistsSection';
import { GallerySection } from './components/GallerySection';
import { EnquirySection } from './components/EnquirySection';
import { ContactAndMap } from './components/ContactAndMap';
import { AppointmentBookingModal } from './components/AppointmentBookingModal';
import { PublicBookingPage } from './components/PublicBookingPage';
import { InvoiceModal } from './components/InvoiceModal';
import { WhatsAppWidget } from './components/WhatsAppWidget';
import { Footer } from './components/Footer';

// Staff Portal Components
import { StaffLogin } from './components/StaffLogin';
import { StaffPortal } from './components/StaffPortal';

// Admin Portal Components
import { AdminLogin } from './components/admin/AdminLogin';
import { AdminLayout } from './components/admin/AdminLayout';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { AdminAppointments } from './components/admin/AdminAppointments';
import { AdminCustomers } from './components/admin/AdminCustomers';
import { AdminServices } from './components/admin/AdminServices';
import { AdminStaff } from './components/admin/AdminStaff';
import { AdminBilling } from './components/admin/AdminBilling';
import { AdminFeedback } from './components/admin/AdminFeedback';
import { AdminGallery } from './components/admin/AdminGallery';
import { AdminEnquiries } from './components/admin/AdminEnquiries';
import { AdminWhatsApp } from './components/admin/AdminWhatsApp';
import { AdminSettings } from './components/admin/AdminSettings';

const INITIAL_FEEDBACK: CustomerFeedback[] = [
  {
    id: 'fb-1',
    appointmentId: 'apt-101',
    customerName: 'Ananya Reddy',
    customerPhone: '+91 98765 11001',
    serviceName: 'Royal Bridal HD Makeover',
    artistName: 'Zainab Qureshi',
    rating: 'GOOD',
    comment: 'The bridal makeover was absolutely breathtaking! Everyone praised the natural glow and longevity of the makeup.',
    requiresFollowUp: false,
    followUpStatus: 'RESOLVED',
    googleReviewSent: true,
    createdAt: new Date(Date.now() - 3600000 * 24 * 2).toISOString(),
  },
  {
    id: 'fb-2',
    appointmentId: 'apt-102',
    customerName: 'Pooja Hegde',
    customerPhone: '+91 98765 11002',
    serviceName: 'Moroccan Argan Hair Spa',
    artistName: 'Ritu Sharma',
    rating: 'GOOD',
    comment: 'Hair feels silky soft and frizz-free. Really serene ambience in the spa room.',
    requiresFollowUp: false,
    followUpStatus: 'RESOLVED',
    googleReviewSent: true,
    createdAt: new Date(Date.now() - 3600000 * 24 * 3).toISOString(),
  },
  {
    id: 'fb-3',
    appointmentId: 'apt-103',
    customerName: 'Sneha Rao',
    customerPhone: '+91 98765 11003',
    serviceName: 'Soft Glam Party Makeup',
    artistName: 'Zainab Qureshi',
    rating: 'AVERAGE',
    comment: 'Overall nice styling, but waiting time was 20 minutes past my booked slot time.',
    requiresFollowUp: false,
    followUpStatus: 'RESOLVED',
    followUpNotes: 'Manager noted timing delay due to previous appointment extension.',
    googleReviewSent: false,
    createdAt: new Date(Date.now() - 3600000 * 24 * 4).toISOString(),
  },
  {
    id: 'fb-4',
    appointmentId: 'apt-104',
    customerName: 'Meghana K',
    customerPhone: '+91 98765 11004',
    serviceName: '24K Gold Luxury Facial',
    artistName: 'Afreen Banu',
    rating: 'BAD',
    comment: 'Felt slight skin irritation after the steam treatment. Would appreciate advice from the aesthetician.',
    requiresFollowUp: true,
    followUpStatus: 'PENDING',
    followUpNotes: '',
    googleReviewSent: false,
    createdAt: new Date(Date.now() - 3600000 * 12).toISOString(),
  },
];

const INITIAL_SALON_SETTINGS: SalonSettings = {
  businessName: 'The Glossy Looks',
  address: '31, Vinayak Nagar, Gachibowli, Hyderabad, Telangana 500032',
  phone: '+91 98765 43210',
  email: 'contact@theglossylooks.com',
  whatsappNumber: '+91 98765 43210',
  openingTime: '09:30',
  closingTime: '20:30',
  googleMapsUrl: 'https://maps.google.com/?q=31+Vinayak+Nagar+Gachibowli+Hyderabad',
  googleBusinessProfileUrl: 'https://business.google.com',
  googleReviewUrl: 'https://g.page/r/theglossylooks-gachibowli/review',
};

const INITIAL_WHATSAPP_SETTINGS: WhatsAppSettings = {
  enabled: true,
  delayMinutes: 30,
  templateName: 'glossylooks_feedback',
  sendGoogleReviewOnGood: true,
  phoneNumberId: '109847291847120',
  wabaId: '849201948201942',
  maskedToken: '••••••••••••4892',
  webhookStatus: 'ACTIVE',
  lastWebhookReceived: new Date().toISOString(),
};

const INITIAL_AUDIT_LOGS: AuditLog[] = [
  {
    id: 'aud-1',
    timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
    actorName: 'Salon Administrator',
    actorRole: 'SALON_ADMIN',
    action: 'Admin Login',
    entity: 'AUTH',
    entityId: 'admin-1',
    details: 'Authenticated to portal from Gachibowli terminal',
  },
  {
    id: 'aud-2',
    timestamp: new Date(Date.now() - 3600000 * 5).toISOString(),
    actorName: 'Reception Desk',
    actorRole: 'RECEPTIONIST',
    action: 'Appointment Completed',
    entity: 'APPOINTMENT',
    entityId: 'apt-101',
    details: 'Status updated to COMPLETED. Automated WhatsApp feedback queued.',
  },
];

export default function App() {
  // Admin, Staff & Public Router Hook
  const { path, isAdminRoute, isStaffRoute, subRoute, publicPage, customerId, navigate } = useAdminRouter();

  // Authentication State
  const [session, setSession] = useState<AdminSession | null>(() => getStoredSession());
  const [staffSession, setStaffSession] = useState<AdminSession | null>(() => {
    try {
      const saved = localStorage.getItem('glossy_staff_session_v1');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [printerSettings, setPrinterSettings] = useState<PrinterSettings>(() => {
    try {
      const saved = localStorage.getItem('glossy_printer_settings');
      return saved ? JSON.parse(saved) : {
        enabled: true,
        printerName: 'POS-80C Thermal Printer',
        connectionType: 'local_agent',
        paperWidth: '3inch',
        autoPrint: true,
        autoCut: true,
        copies: 1,
        networkIp: '192.168.1.100',
      };
    } catch {
      return {
        enabled: true,
        printerName: 'POS-80C Thermal Printer',
        connectionType: 'local_agent',
        paperWidth: '3inch',
        autoPrint: true,
        autoCut: true,
        copies: 1,
        networkIp: '192.168.1.100',
      };
    }
  });

  // Core Data Collections (with localStorage persistence)
  const [services, setServices] = useState<SalonService[]>(() => {
    try {
      const menuVer = localStorage.getItem('glossy_menu_version');
      if (menuVer !== 'v2_theglossylooks_pdf') {
        localStorage.setItem('glossy_services', JSON.stringify(INITIAL_SERVICES));
        localStorage.setItem('glossy_menu_version', 'v2_theglossylooks_pdf');
        return INITIAL_SERVICES;
      }
      const saved = localStorage.getItem('glossy_services');
      return saved ? JSON.parse(saved) : INITIAL_SERVICES;
    } catch {
      return INITIAL_SERVICES;
    }
  });

  const [artists, setArtists] = useState<Artist[]>(() => {
    try {
      const saved = localStorage.getItem('glossy_artists');
      return saved ? JSON.parse(saved) : INITIAL_ARTISTS;
    } catch {
      return INITIAL_ARTISTS;
    }
  });

  const [galleryItems, setGalleryItems] = useState<GalleryWork[]>(() => {
    try {
      const saved = localStorage.getItem('glossy_gallery');
      return saved ? JSON.parse(saved) : INITIAL_GALLERY;
    } catch {
      return INITIAL_GALLERY;
    }
  });

  const [appointments, setAppointments] = useState<Appointment[]>(() => {
    try {
      const saved = localStorage.getItem('glossy_appointments');
      return saved ? JSON.parse(saved) : INITIAL_APPOINTMENTS;
    } catch {
      return INITIAL_APPOINTMENTS;
    }
  });

  const [bills, setBills] = useState<BillOrder[]>(() => {
    try {
      const saved = localStorage.getItem('glossy_bills');
      return saved ? JSON.parse(saved) : INITIAL_BILLS;
    } catch {
      return INITIAL_BILLS;
    }
  });

  const [enquiries, setEnquiries] = useState<CustomerEnquiry[]>(() => {
    try {
      const saved = localStorage.getItem('glossy_enquiries');
      return saved ? JSON.parse(saved) : INITIAL_ENQUIRIES;
    } catch {
      return INITIAL_ENQUIRIES;
    }
  });

  const [feedback, setFeedback] = useState<CustomerFeedback[]>(() => {
    try {
      const saved = localStorage.getItem('glossy_feedback');
      return saved ? JSON.parse(saved) : INITIAL_FEEDBACK;
    } catch {
      return INITIAL_FEEDBACK;
    }
  });

  const [salonSettings, setSalonSettings] = useState<SalonSettings>(() => {
    try {
      const saved = localStorage.getItem('glossy_salon_settings');
      return saved ? JSON.parse(saved) : INITIAL_SALON_SETTINGS;
    } catch {
      return INITIAL_SALON_SETTINGS;
    }
  });

  const [whatsappSettings, setWhatsAppSettings] = useState<WhatsAppSettings>(() => {
    try {
      const saved = localStorage.getItem('glossy_whatsapp_settings');
      return saved ? JSON.parse(saved) : INITIAL_WHATSAPP_SETTINGS;
    } catch {
      return INITIAL_WHATSAPP_SETTINGS;
    }
  });

  const [messageLogs, setMessageLogs] = useState<WhatsAppMessageLog[]>(() => {
    try {
      const saved = localStorage.getItem('glossy_whatsapp_logs');
      return saved ? JSON.parse(saved) : [
        {
          id: 'log-1',
          customerName: 'Ananya Reddy',
          customerPhone: '+91 98765 11001',
          type: 'FEEDBACK_REQUEST',
          status: 'DELIVERED',
          messagePreview: 'Hi Ananya, thank you for visiting The Glossy Looks! How was your Royal Bridal HD Makeover?',
          timestamp: new Date(Date.now() - 3600000 * 24 * 2).toISOString(),
          appointmentId: 'apt-101',
        },
        {
          id: 'log-2',
          customerName: 'Ananya Reddy',
          customerPhone: '+91 98765 11001',
          type: 'GOOGLE_REVIEW_LINK',
          status: 'READ',
          messagePreview: 'We are thrilled you loved your salon makeover! Could you support our team with a 5-star Google Review?',
          timestamp: new Date(Date.now() - 3600000 * 24 * 2 + 600000).toISOString(),
          appointmentId: 'apt-101',
        },
      ];
    } catch {
      return [];
    }
  });

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() => {
    try {
      const saved = localStorage.getItem('glossy_audit_logs');
      return saved ? JSON.parse(saved) : INITIAL_AUDIT_LOGS;
    } catch {
      return INITIAL_AUDIT_LOGS;
    }
  });

  const [retailProducts] = useState<RetailProduct[]>(INITIAL_RETAIL_PRODUCTS);

  // Modals & Public Flow States
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [preselectedService, setPreselectedService] = useState<SalonService | null>(null);
  const [preselectedArtist, setPreselectedArtist] = useState<Artist | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<BillOrder | null>(null);
  const [galleryArtistFilter, setGalleryArtistFilter] = useState<string>('All');
  const [activeSection, setActiveSection] = useState<string>('hero');

  // Customer Intelligence Profiles (derived from live appointments & billing)
  const customerProfiles = useMemo(() => {
    return getCustomerProfiles(appointments, bills, feedback);
  }, [appointments, bills, feedback]);

  // Sync WhatsApp feedback, message logs, and services with backend API
  useEffect(() => {
    const syncBackendData = async () => {
      try {
        const [fbRes, logsRes, srvRes, aptRes] = await Promise.all([
          fetch('/api/whatsapp/feedback'),
          fetch('/api/whatsapp/logs'),
          fetch('/api/services'),
          fetch('/api/appointments'),
        ]);

        if (srvRes.ok) {
          const serverServices = await srvRes.json();
          if (Array.isArray(serverServices) && serverServices.length > 0) {
            setServices(serverServices);
          }
        }

        if (aptRes.ok) {
          const serverApts = await aptRes.json();
          if (Array.isArray(serverApts) && serverApts.length > 0) {
            setAppointments(prev => {
              const map = new Map(prev.map(a => [a.id, a]));
              serverApts.forEach((a: any) => map.set(a.id, a));
              return Array.from(map.values());
            });
          }
        }

        if (fbRes.ok) {
          const serverFeedback = await fbRes.json();
          if (Array.isArray(serverFeedback) && serverFeedback.length > 0) {
            setFeedback(prev => {
              const map = new Map(prev.map(f => [f.id, f]));
              serverFeedback.forEach(f => {
                map.set(f.id, {
                  id: f.id,
                  appointmentId: f.appointmentId,
                  customerName: f.customerName,
                  customerPhone: f.customerPhone,
                  serviceName: f.serviceName,
                  artistName: f.artistName,
                  rating: f.rating || 'GOOD',
                  comment: f.comment,
                  createdAt: f.createdAt,
                  requiresFollowUp: f.requiresFollowUp,
                  followUpStatus: f.followUpStatus,
                  followUpNotes: f.followUpNotes,
                  googleReviewSent: f.googleReviewSent,
                });
              });
              return Array.from(map.values());
            });
          }
        }

        if (logsRes.ok) {
          const serverLogs = await logsRes.json();
          if (Array.isArray(serverLogs) && serverLogs.length > 0) {
            setMessageLogs(prev => {
              const map = new Map(prev.map(l => [l.id, l]));
              serverLogs.forEach((l: any) => {
                map.set(l.id, {
                  id: l.id,
                  customerName: l.customerName,
                  customerPhone: l.customerPhone,
                  templateName: l.templateName || 'glossylooks_feedback',
                  direction: l.direction,
                  messageType: l.messageType,
                  type: (l.messageType === 'button_reply' ? 'FEEDBACK_REPLY' : (l.messageType || 'FEEDBACK_REQUEST').toUpperCase().replace(/ /g, '_')) as any,
                  status: (l.status || 'SENT').toUpperCase() as any,
                  waMessageId: l.waMessageId,
                  apiAccepted: l.apiAccepted,
                  httpStatus: l.httpStatus,
                  errorCode: l.errorCode,
                  errorMessage: l.errorMessage,
                  errorData: l.errorData,
                  fbtraceId: l.fbtraceId,
                  contacts: l.contacts,
                  messagePreview: l.messageText || l.messagePreview,
                  messageText: l.messageText,
                  rawRequest: l.rawRequest,
                  rawResponse: l.rawResponse,
                  timestamp: l.createdAt || l.timestamp || new Date().toISOString(),
                  appointmentId: l.appointmentId,
                  isTest: l.isTest,
                });
              });
              return Array.from(map.values());
            });
          }
        }
      } catch {
        // Disconnected fallback
      }
    };

    syncBackendData();
    const interval = setInterval(syncBackendData, 20000);
    return () => clearInterval(interval);
  }, []);

  // Sync state to localStorage
  useEffect(() => {
    localStorage.setItem('glossy_services', JSON.stringify(services));
  }, [services]);

  useEffect(() => {
    localStorage.setItem('glossy_artists', JSON.stringify(artists));
  }, [artists]);

  useEffect(() => {
    localStorage.setItem('glossy_gallery', JSON.stringify(galleryItems));
  }, [galleryItems]);

  useEffect(() => {
    localStorage.setItem('glossy_appointments', JSON.stringify(appointments));
  }, [appointments]);

  useEffect(() => {
    localStorage.setItem('glossy_bills', JSON.stringify(bills));
  }, [bills]);

  useEffect(() => {
    localStorage.setItem('glossy_enquiries', JSON.stringify(enquiries));
  }, [enquiries]);

  useEffect(() => {
    localStorage.setItem('glossy_feedback', JSON.stringify(feedback));
  }, [feedback]);

  useEffect(() => {
    localStorage.setItem('glossy_salon_settings', JSON.stringify(salonSettings));
  }, [salonSettings]);

  useEffect(() => {
    localStorage.setItem('glossy_whatsapp_settings', JSON.stringify(whatsappSettings));
  }, [whatsappSettings]);

  useEffect(() => {
    localStorage.setItem('glossy_whatsapp_logs', JSON.stringify(messageLogs));
  }, [messageLogs]);

  useEffect(() => {
    localStorage.setItem('glossy_audit_logs', JSON.stringify(auditLogs));
  }, [auditLogs]);

  // Dynamic Route-Based SEO & Document Title
  useEffect(() => {
    let title = "The Glossy Looks – Luxury Women's Salon & Bridal Studio";
    let desc = "Experience bespoke bridal makeovers, signature hair color, and luxury spa therapies at The Glossy Looks in Gachibowli, Hyderabad. Book online today.";

    if (publicPage === 'services') {
      title = "Salon Services & Price Menu | The Glossy Looks Women Salon";
      desc = "Explore our complete bespoke bridal, hair styling, skin aesthetics, and spa treatments. Transparent pricing with instant booking.";
    } else if (publicPage === 'book') {
      title = "Book Salon Appointment Online | The Glossy Looks Women Salon";
      desc = "Book your beauty and salon slot at The Glossy Looks Women Salon in Gachibowli. Instant booking pass & WhatsApp confirmation.";
    } else if (publicPage === 'artists') {
      title = "Meet Our Acclaimed Artists & Stylists | The Glossy Looks";
      desc = "Discover our team of master couturiers, makeup artists, and hair specialists at The Glossy Looks Women Salon in Gachibowli.";
    } else if (publicPage === 'gallery') {
      title = "Bridal & Hair Transformations Portfolio | The Glossy Looks";
      desc = "Browse signature bridal transformations, Parisian balayage, and party glam styling crafted by master artists at The Glossy Looks.";
    } else if (publicPage === 'contact') {
      title = "Contact Us & Salon Location | The Glossy Looks Gachibowli";
      desc = "Visit The Glossy Looks in Vinayak Nagar, Gachibowli, Hyderabad. Connect via WhatsApp or get Google Maps directions.";
    } else if (publicPage === 'enquiry') {
      title = "Customer Enquiry & Bridal Consultation | The Glossy Looks";
      desc = "Have questions about bridal makeover packages or hair treatments? Send an enquiry directly to our concierge team at The Glossy Looks.";
    } else if (isStaffRoute) {
      if (subRoute === 'login') {
        title = "Staff Portal Sign In | The Glossy Looks";
      } else {
        title = "Staff Operations & Walk-in POS | The Glossy Looks";
      }
      desc = "Staff portal for today's salon appointments, walk-in billing POS, and thermal receipts.";
    } else if (isAdminRoute) {
      if (subRoute === 'login') {
        title = "Admin Sign In | The Glossy Looks Management Portal";
      } else {
        const subTitle = subRoute ? subRoute.charAt(0).toUpperCase() + subRoute.slice(1) : 'Dashboard';
        title = `${subTitle} | The Glossy Looks Salon Admin`;
      }
      desc = "Management and administration portal for The Glossy Looks Women Salon.";
    }

    document.title = title;

    // Update meta description
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      metaDesc.setAttribute('content', desc);
    }
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) {
      ogTitle.setAttribute('content', title);
    }
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) {
      ogDesc.setAttribute('content', desc);
    }
    const twitterTitle = document.querySelector('meta[name="twitter:title"]');
    if (twitterTitle) {
      twitterTitle.setAttribute('content', title);
    }
    const twitterDesc = document.querySelector('meta[name="twitter:description"]');
    if (twitterDesc) {
      twitterDesc.setAttribute('content', desc);
    }

    // Robots meta tag: noindex, nofollow for admin and staff routes
    let robotsMeta = document.querySelector('meta[name="robots"]');
    if (!robotsMeta) {
      robotsMeta = document.createElement('meta');
      robotsMeta.setAttribute('name', 'robots');
      document.head.appendChild(robotsMeta);
    }
    if (isAdminRoute || isStaffRoute) {
      robotsMeta.setAttribute('content', 'noindex, nofollow');
    } else {
      robotsMeta.setAttribute('content', 'index, follow');
    }

    // Canonical link
    let canonicalLink = document.querySelector('link[rel="canonical"]');
    if (!canonicalLink) {
      canonicalLink = document.createElement('link');
      canonicalLink.setAttribute('rel', 'canonical');
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.setAttribute('href', `https://glossylooks.ai.studio${path === '/' ? '' : path}`);
  }, [publicPage, isAdminRoute, isStaffRoute, subRoute, path]);

  // Security route protection: ONLY applies to /admin/* routes
  useEffect(() => {
    if (isAdminRoute && subRoute !== 'login') {
      if (!session) {
        navigate('/admin/login', true);
      }
    }
  }, [isAdminRoute, subRoute, session, navigate]);

  // Audit Log helper
  const addAuditLog = useCallback((action: string, entity: string, entityId: string, details?: string) => {
    const newLog: AuditLog = {
      id: 'aud-' + Date.now(),
      timestamp: new Date().toISOString(),
      actorName: session?.user.name || 'System / Receptionist',
      actorRole: session?.user.role || 'SALON_ADMIN',
      action,
      entity,
      entityId,
      details,
    };
    setAuditLogs(prev => [newLog, ...prev]);
  }, [session]);

  // WhatsApp Message Log helper
  const addWhatsAppLog = useCallback((log: Omit<WhatsAppMessageLog, 'id' | 'timestamp'>) => {
    const newLog: WhatsAppMessageLog = {
      ...log,
      id: 'log-' + Date.now(),
      timestamp: new Date().toISOString(),
    };
    setMessageLogs(prev => [newLog, ...prev]);
  }, []);

  // Handlers for Salon Operations
  const handleAppointmentCreated = (newApt: Appointment) => {
    setAppointments(prev => [newApt, ...prev]);
    addAuditLog('Appointment Created', 'APPOINTMENT', newApt.id, `Booked for ${newApt.customerName} on ${newApt.date} at ${newApt.timeSlot}`);

    // Persist to server / Supabase with customer deduplication
    fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newApt),
    }).catch(err => console.warn('Appointment backend sync warning:', err));
  };

  const handleUpdateAppointment = (updated: Appointment) => {
    const existing = appointments.find(a => a.id === updated.id);
    const wasNotCompleted = existing?.status !== 'completed';
    const isNowCompleted = updated.status === 'completed';

    setAppointments(prev => prev.map(a => a.id === updated.id ? updated : a));
    addAuditLog('Appointment Updated', 'APPOINTMENT', updated.id, `Status: ${updated.status}, Staff: ${updated.artistName || 'Unassigned'}`);

    // If marked completed, trigger the decoupled feedback automation hook and backend persistent scheduler!
    if (wasNotCompleted && isNowCompleted) {
      addAuditLog('Appointment Completed', 'APPOINTMENT', updated.id, `Completed for ${updated.customerName}. WhatsApp feedback triggered.`);
      onAppointmentCompletedHook(updated, whatsappSettings, addWhatsAppLog);

      // Persistently register in server feedback queue
      fetch('/api/whatsapp/schedule-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointment: updated,
          delayMinutes: whatsappSettings.delayMinutes,
        }),
      }).catch(err => console.warn('Backend feedback scheduling warning:', err));
    }
  };

  const handleCreateBill = (newBill: BillOrder) => {
    setBills(prev => [newBill, ...prev]);
    addAuditLog('Invoice Generated', 'BILLING', newBill.id, `Invoice ${newBill.invoiceNumber} for ₹${newBill.grandTotal} (${newBill.paymentMode})`);
  };

  const handleAddService = (newService: SalonService) => {
    setServices(prev => [...prev, newService]);
    addAuditLog('Service Added', 'SERVICE', newService.id, `Created service: ${newService.name} (₹${newService.price})`);
    fetch('/api/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newService),
    }).catch(err => console.warn('Service save warning:', err));
  };

  const handleUpdateService = (updated: SalonService) => {
    setServices(prev => prev.map(s => s.id === updated.id ? updated : s));
    addAuditLog('Service Updated', 'SERVICE', updated.id, `Updated service: ${updated.name}`);
    fetch(`/api/services/${updated.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).catch(err => console.warn('Service update warning:', err));
  };

  const handleDeleteService = (id: string) => {
    const srv = services.find(s => s.id === id);
    setServices(prev => prev.filter(s => s.id !== id));
    addAuditLog('Service Deleted', 'SERVICE', id, `Removed service: ${srv?.name || id}`);
    fetch(`/api/services/${id}`, {
      method: 'DELETE',
    }).catch(err => console.warn('Service delete warning:', err));
  };

  const handleAddArtist = (newArtist: Artist) => {
    setArtists(prev => [...prev, newArtist]);
    addAuditLog('Staff Added', 'STAFF', newArtist.id, `Registered staff: ${newArtist.name}`);
  };

  const handleUpdateArtist = (updated: Artist) => {
    setArtists(prev => prev.map(a => a.id === updated.id ? updated : a));
    addAuditLog('Staff Updated', 'STAFF', updated.id, `Updated staff profile: ${updated.name}`);
  };

  const handleAddGalleryWork = (work: GalleryWork) => {
    setGalleryItems(prev => [work, ...prev]);
    addAuditLog('Gallery Work Uploaded', 'GALLERY', work.id, `Published look: ${work.title}`);
  };

  const handleUpdateGalleryWork = (work: GalleryWork) => {
    setGalleryItems(prev => prev.map(w => w.id === work.id ? work : w));
    addAuditLog('Gallery Work Updated', 'GALLERY', work.id, `Updated look: ${work.title}`);
  };

  const handleDeleteGalleryWork = (id: string) => {
    setGalleryItems(prev => prev.filter(w => w.id !== id));
    addAuditLog('Gallery Work Deleted', 'GALLERY', id, `Removed look #${id}`);
  };

  const handleUpdateEnquiryStatus = (id: string, status: CustomerEnquiry['status']) => {
    setEnquiries(prev => prev.map(e => e.id === id ? { ...e, status } : e));
    addAuditLog('Enquiry Status Updated', 'ENQUIRY', id, `Lead marked as ${status}`);
  };

  const handleUpdateFeedback = (updated: CustomerFeedback) => {
    setFeedback(prev => prev.map(f => f.id === updated.id ? updated : f));
    addAuditLog('Feedback Handled', 'FEEDBACK', updated.id, `Follow-up status: ${updated.followUpStatus}`);
  };

  const handleSendFeedbackPrompt = async (appointment: Appointment) => {
    addAuditLog('Feedback Prompt Dispatched', 'WHATSAPP', appointment.id, `Manual trigger for ${appointment.customerName}`);

    try {
      const res = await fetch('/api/whatsapp/resend-feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer admin-token',
        },
        body: JSON.stringify({ appointment }),
      });

      const data = await res.json();
      if (res.ok && data.apiAccepted) {
        addWhatsAppLog({
          customerName: appointment.customerName,
          customerPhone: data.to || appointment.customerPhone,
          templateName: data.templateName || 'glossylooks_feedback',
          direction: 'outbound',
          messageType: 'template',
          type: 'FEEDBACK_REQUEST',
          status: 'SENT',
          waMessageId: data.messageId,
          apiAccepted: true,
          httpStatus: data.httpStatus,
          messagePreview: `[Template: ${data.templateName || 'glossylooks_feedback'}] Dispatched to ${data.to || appointment.customerPhone}`,
          appointmentId: appointment.id,
          rawRequest: data.requestPayload,
          rawResponse: data.metaResponse,
        });
        addAuditLog('Feedback Template Accepted', 'WHATSAPP', appointment.id, `Meta ID: ${data.messageId} (Status: SENT)`);
      } else {
        addWhatsAppLog({
          customerName: appointment.customerName,
          customerPhone: data.to || appointment.customerPhone,
          templateName: data.templateName || 'glossylooks_feedback',
          direction: 'outbound',
          messageType: 'template',
          type: 'FEEDBACK_REQUEST',
          status: 'FAILED',
          waMessageId: data.messageId,
          apiAccepted: false,
          httpStatus: data.httpStatus,
          errorCode: data.error?.code,
          errorMessage: data.error?.message,
          messagePreview: `[Template: ${data.templateName || 'glossylooks_feedback'}] Failed: ${data.error?.message || 'Meta Error'}`,
          appointmentId: appointment.id,
          rawRequest: data.requestPayload,
          rawResponse: data.metaResponse,
        });
        addAuditLog('Feedback Template Failed', 'WHATSAPP', appointment.id, `Error: ${data.error?.message || 'Failed'}`);
      }
    } catch (err: any) {
      console.warn('Backend resend error:', err);
    }
  };

  const handleLogout = () => {
    clearStoredSession();
    setSession(null);
    navigate('/admin/login');
  };

  const handleScrollToSection = (sectionId: string) => {
    if (subRoute !== null) {
      navigate('/');
    }
    setActiveSection(sectionId);
    setTimeout(() => {
      const el = document.getElementById(sectionId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
      }
    }, 50);
  };

  // ==========================================
  // VIEW ROUTING
  // ==========================================

  // 0. STAFF PORTAL ROUTES (/staff/*)
  if (isStaffRoute) {
    if (subRoute === 'login') {
      return (
        <StaffLogin
          onLoginSuccess={(newSession) => {
            setStaffSession(newSession);
            addAuditLog('Staff Login', 'AUTH', newSession.user.id, `Staff ${newSession.user.name} logged in`);
            navigate('/staff/billing');
          }}
          onBackToWebsite={() => navigate('/')}
          onGoToAdminLogin={() => navigate('/admin/login')}
        />
      );
    }

    if (!staffSession) {
      return (
        <StaffLogin
          onLoginSuccess={(newSession) => {
            setStaffSession(newSession);
            addAuditLog('Staff Login', 'AUTH', newSession.user.id, `Staff ${newSession.user.name} logged in`);
            navigate('/staff/billing');
          }}
          onBackToWebsite={() => navigate('/')}
          onGoToAdminLogin={() => navigate('/admin/login')}
        />
      );
    }

    return (
      <StaffPortal
        currentUser={staffSession.user}
        appointments={appointments}
        services={services}
        printerSettings={printerSettings}
        onLogout={() => {
          localStorage.removeItem('glossy_staff_session_v1');
          setStaffSession(null);
          navigate('/staff/login');
        }}
        onViewPublicSite={() => navigate('/')}
        onCreateBill={handleCreateBill}
      />
    );
  }

  // 1. ADMIN LOGIN ROUTE (/admin/login)
  if (isAdminRoute && subRoute === 'login') {
    return (
      <AdminLogin
        onLoginSuccess={(newSession) => {
          setSession(newSession);
          addAuditLog('Admin Login', 'AUTH', newSession.user.id, `Session authenticated for ${newSession.user.name} (${newSession.user.role})`);
          navigate('/admin/dashboard');
        }}
        onBackToWebsite={() => navigate('/')}
        onGoToStaffLogin={() => navigate('/staff/login')}
      />
    );
  }

  // 2. ADMIN PORTAL PROTECTED ROUTES (/admin/*)
  if (isAdminRoute && subRoute !== null) {
    if (!session) {
      return (
        <AdminLogin
          onLoginSuccess={(newSession) => {
            setSession(newSession);
            addAuditLog('Admin Login', 'AUTH', newSession.user.id, `Session authenticated for ${newSession.user.name}`);
            navigate('/admin/dashboard');
          }}
          onBackToWebsite={() => navigate('/')}
          onGoToStaffLogin={() => navigate('/staff/login')}
        />
      );
    }

    // Role-based security: Staff cannot access admin features (Requirement 7)
    if (session.user.role === 'SALON_STAFF') {
      return (
        <div className="min-h-screen bg-[#FAF7F5] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full text-center shadow-xl border border-red-200 space-y-4">
            <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
              <span className="text-2xl font-bold font-mono">403</span>
            </div>
            <h2 className="font-serif-luxury text-2xl font-bold text-[#2D2424]">Access Restricted</h2>
            <p className="text-sm text-[#7A6B6B]">
              Staff accounts are prohibited from accessing salon administration, customer profiles, and financial reports.
            </p>
            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={() => navigate('/staff/billing')}
                className="w-full py-3 px-4 rounded-xl text-sm font-semibold bg-[#8C3A42] text-white hover:bg-[#742F36] transition-colors cursor-pointer"
              >
                Go to Staff Operations Portal
              </button>
              <button
                onClick={handleLogout}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-[#7A6B6B] hover:bg-stone-100 transition-colors cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <AdminLayout
        currentUser={session.user}
        currentRoute={subRoute}
        pendingEnquiriesCount={enquiries.filter(e => e.status === 'New').length}
        badFeedbackCount={feedback.filter(f => f.rating === 'BAD' && f.requiresFollowUp).length}
        onNavigate={(route) => navigate(route === 'dashboard' ? '/admin/dashboard' : `/admin/${route}`)}
        onLogout={handleLogout}
        onViewPublicSite={() => navigate('/')}
      >
        {subRoute === 'dashboard' && (
          <AdminDashboard
            appointments={appointments}
            bills={bills}
            feedback={feedback}
            enquiries={enquiries}
            customers={customerProfiles}
            onNavigate={(route) => navigate(`/admin/${route}`)}
            onUpdateAppointmentStatus={(id, status) => {
              const apt = appointments.find(a => a.id === id);
              if (apt) handleUpdateAppointment({ ...apt, status });
            }}
          />
        )}

        {subRoute === 'appointments' && (
          <AdminAppointments
            appointments={appointments}
            services={services}
            artists={artists}
            onCreateAppointment={() => {
              setPreselectedService(null);
              setPreselectedArtist(null);
              setBookingModalOpen(true);
            }}
            onUpdateStatus={(id, status) => {
              const apt = appointments.find(a => a.id === id);
              if (apt) handleUpdateAppointment({ ...apt, status });
            }}
            onUpdateAppointment={handleUpdateAppointment}
          />
        )}

        {(subRoute === 'customers' || subRoute === 'customer-detail') && (
          <AdminCustomers
            customers={customerProfiles}
            appointments={appointments}
            bills={bills}
            feedback={feedback}
            whatsappLogs={messageLogs}
            selectedCustomerId={customerId}
            onSelectCustomer={(id) => id ? navigate(`/admin/customers/${id}`) : navigate('/admin/customers')}
            onUpdateCustomer={(phone: string, updates: Partial<CustomerProfile>) => {
              addAuditLog('Customer Profile Updated', 'CUSTOMER', phone, 'Updated profile details');
            }}
          />
        )}

        {subRoute === 'services' && (
          <AdminServices
            services={services}
            onAddService={handleAddService}
            onUpdateService={handleUpdateService}
            onDeleteService={handleDeleteService}
          />
        )}

        {subRoute === 'staff' && (
          <AdminStaff
            artists={artists}
            appointments={appointments}
            onAddArtist={handleAddArtist}
            onUpdateArtist={handleUpdateArtist}
          />
        )}

        {subRoute === 'billing' && (
          <AdminBilling
            bills={bills}
            services={services}
            customers={customerProfiles}
            onCreateBill={handleCreateBill}
          />
        )}

        {subRoute === 'feedback' && (
          <AdminFeedback
            feedback={feedback}
            appointments={appointments}
            whatsappSettings={whatsappSettings}
            onUpdateFeedback={handleUpdateFeedback}
            onSendFeedbackRequest={handleSendFeedbackPrompt}
          />
        )}

        {subRoute === 'gallery' && (
          <AdminGallery
            galleryItems={galleryItems}
            artists={artists}
            onAddWork={handleAddGalleryWork}
            onUpdateWork={handleUpdateGalleryWork}
            onDeleteWork={handleDeleteGalleryWork}
          />
        )}

        {subRoute === 'enquiries' && (
          <AdminEnquiries
            enquiries={enquiries}
            onUpdateStatus={handleUpdateEnquiryStatus}
          />
        )}

        {subRoute === 'whatsapp' && (
          <AdminWhatsApp
            settings={whatsappSettings}
            messageLogs={messageLogs}
            onUpdateSettings={(newSettings) => {
              setWhatsAppSettings(newSettings);
              addAuditLog('WhatsApp Config Updated', 'WHATSAPP', 'config', `Automation enabled: ${newSettings.enabled}, delay: ${newSettings.delayMinutes}m`);
            }}
          />
        )}

        {subRoute === 'settings' && (
          <AdminSettings
            salonSettings={salonSettings}
            whatsappSettings={whatsappSettings}
            auditLogs={auditLogs}
            currentUser={session.user}
            onUpdateSalonSettings={(newSettings) => {
              setSalonSettings(newSettings);
              addAuditLog('Salon Settings Updated', 'SETTINGS', 'profile', 'Salon address/profile changed');
            }}
            onUpdateWhatsAppSettings={(newSettings) => {
              setWhatsAppSettings(newSettings);
              addAuditLog('Feedback Settings Updated', 'SETTINGS', 'whatsapp', 'Rules updated');
            }}
          />
        )}
      </AdminLayout>
    );
  }

  // 3. PUBLIC SALON WEBSITE (/, /services, /book, /gallery, /contact)
  return (
    <div className="min-h-screen flex flex-col bg-[#FAF7F5] selection:bg-[#E8C5C8] selection:text-[#3B1E22]">
      
      {/* Top Navbar */}
      <Navbar
        currentPath={path}
        onNavigate={navigate}
        onOpenBooking={() => {
          setPreselectedService(null);
          setPreselectedArtist(null);
          setBookingModalOpen(true);
        }}
        appointmentCount={appointments.length}
      />

      {/* Customer-Facing Salon Website Content by Route */}
      <main className="flex-1">
        {publicPage === 'services' && (
          <div>
            {/* Services Page Header Banner */}
            <div className="bg-[#2D2424] text-[#FAF7F5] py-12 px-4 sm:px-6 lg:px-8 text-center relative overflow-hidden">
              <div className="max-w-4xl mx-auto space-y-3 relative z-10">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#3B2F2F] text-[#E8C5C8] text-xs font-semibold uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-[#E5B5B7] inline-block animate-pulse"></span>
                  <span>The Glossy Looks • Live Salon Menu</span>
                </div>
                <h1 className="font-serif-luxury text-3xl sm:text-5xl font-bold text-white tracking-tight">
                  Salon Services & Price Menu
                </h1>
                <p className="text-xs sm:text-sm text-[#D9C4BE] max-w-xl mx-auto">
                  Explore our complete bespoke bridal, hair transformations, skin aesthetics, and spa treatments. 
                  All prices are transparent and updated live.
                </p>
              </div>
            </div>

            {/* Complete Services Menu */}
            <ServicesMenu
              services={services}
              onSelectForBooking={(srv) => {
                setPreselectedService(srv);
                setPreselectedArtist(null);
                setBookingModalOpen(true);
              }}
              onAddToBill={() => navigate('/admin/billing')}
            />

            {/* Contact and Location */}
            <ContactAndMap />
          </div>
        )}

        {publicPage === 'book' && (
          <div>
            <div className="bg-[#2D2424] text-[#FAF7F5] py-10 px-4 sm:px-6 lg:px-8 text-center relative overflow-hidden">
              <div className="max-w-3xl mx-auto space-y-2 relative z-10">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#3B2F2F] text-[#E8C5C8] text-xs font-semibold uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-[#E5B5B7] inline-block animate-pulse"></span>
                  <span>Instant Slot Reservation</span>
                </div>
                <h1 className="font-serif-luxury text-3xl sm:text-4xl font-bold text-white tracking-tight">
                  Book Your Salon Slot
                </h1>
                <p className="text-xs sm:text-sm text-[#D9C4BE] max-w-lg mx-auto">
                  Select your desired services with live search, choose your date and time, and receive an instant booking pass.
                </p>
              </div>
            </div>

            <PublicBookingPage
              services={services}
              artists={artists}
              initialSelectedService={preselectedService}
              initialSelectedArtist={preselectedArtist}
              onAppointmentCreated={handleAppointmentCreated}
              onNavigate={navigate}
            />
            <ContactAndMap />
          </div>
        )}

        {publicPage === 'artists' && (
          <div>
            {/* Artists Page Header Banner */}
            <div className="bg-[#2D2424] text-[#FAF7F5] py-12 px-4 sm:px-6 lg:px-8 text-center relative overflow-hidden">
              <div className="max-w-4xl mx-auto space-y-3 relative z-10">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#3B2F2F] text-[#E8C5C8] text-xs font-semibold uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-[#E5B5B7] inline-block animate-pulse"></span>
                  <span>Master Couturiers & Stylists</span>
                </div>
                <h1 className="font-serif-luxury text-3xl sm:text-5xl font-bold text-white tracking-tight">
                  Meet Our Acclaimed Artists
                </h1>
                <p className="text-xs sm:text-sm text-[#D9C4BE] max-w-xl mx-auto">
                  Trained across London, Paris, and Mumbai academies, our resident senior artists craft personalized luxury transformations.
                </p>
              </div>
            </div>

            <ArtistsSection
              artists={artists}
              onBookWithArtist={() => {
                setPreselectedService(null);
                setPreselectedArtist(null);
                setBookingModalOpen(true);
              }}
              onFilterGalleryByArtist={(artistName) => {
                setGalleryArtistFilter(artistName);
                navigate('/gallery');
              }}
            />

            {/* Quick booking CTA */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
              <div className="bg-gradient-to-r from-[#2D2424] to-[#4A3234] rounded-3xl p-8 sm:p-12 text-center text-white space-y-4 shadow-xl">
                <h2 className="font-serif-luxury text-2xl sm:text-3xl font-bold">
                  Experience Five-Star Artist Service
                </h2>
                <p className="text-sm text-[#E8DDD8] max-w-xl mx-auto font-light">
                  Book an appointment with any of our master specialists today for hair styling, bridal couture, or skin aesthetics.
                </p>
                <button
                  onClick={() => navigate('/book')}
                  className="inline-flex items-center gap-2 bg-[#8C3A42] hover:bg-[#742F36] text-white px-8 py-3.5 rounded-xl font-semibold transition-all hover:scale-105 shadow-md cursor-pointer"
                >
                  <Calendar className="w-4 h-4" />
                  <span>Book Appointment Now</span>
                </button>
              </div>
            </div>

            <ContactAndMap />
          </div>
        )}

        {publicPage === 'gallery' && (
          <div>
            {/* Gallery Header Banner */}
            <div className="bg-[#2D2424] text-[#FAF7F5] py-12 px-4 sm:px-6 lg:px-8 text-center relative overflow-hidden">
              <div className="max-w-4xl mx-auto space-y-3 relative z-10">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#3B2F2F] text-[#E8C5C8] text-xs font-semibold uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-[#E5B5B7] inline-block animate-pulse"></span>
                  <span>Artist Portfolio & Lookbook</span>
                </div>
                <h1 className="font-serif-luxury text-3xl sm:text-5xl font-bold text-white tracking-tight">
                  Artist Portfolio & Lookbook
                </h1>
                <p className="text-xs sm:text-sm text-[#D9C4BE] max-w-xl mx-auto">
                  Browse signature bridal transformations, Parisian balayage tones, and glamorous party styling crafted by our master stylists.
                </p>
              </div>
            </div>

            {/* Gallery Section */}
            <GallerySection
              galleryItems={galleryItems}
              artists={artists}
              selectedArtistFilter={galleryArtistFilter}
              onSelectArtistFilter={setGalleryArtistFilter}
              onBookThisLook={() => {
                setPreselectedService(null);
                setPreselectedArtist(null);
                setBookingModalOpen(true);
              }}
              onOpenUploadInAdmin={() => navigate('/admin/gallery')}
            />
            <ContactAndMap />
          </div>
        )}

        {publicPage === 'contact' && (
          <div>
            {/* Contact Header Banner */}
            <div className="bg-[#2D2424] text-[#FAF7F5] py-12 px-4 sm:px-6 lg:px-8 text-center relative overflow-hidden">
              <div className="max-w-4xl mx-auto space-y-3 relative z-10">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#3B2F2F] text-[#E8C5C8] text-xs font-semibold uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-[#E5B5B7] inline-block animate-pulse"></span>
                  <span>Contact Us & Location</span>
                </div>
                <h1 className="font-serif-luxury text-3xl sm:text-5xl font-bold text-white tracking-tight">
                  Contact Us & Google Maps
                </h1>
                <p className="text-xs sm:text-sm text-[#D9C4BE] max-w-xl mx-auto">
                  Conveniently situated in Vinayak Nagar, Gachibowli, Hyderabad. Connect with our concierge or drop in today.
                </p>
              </div>
            </div>

            <ContactAndMap />
          </div>
        )}

        {publicPage === 'enquiry' && (
          <div>
            {/* Enquiry Header Banner */}
            <div className="bg-[#2D2424] text-[#FAF7F5] py-12 px-4 sm:px-6 lg:px-8 text-center relative overflow-hidden">
              <div className="max-w-4xl mx-auto space-y-3 relative z-10">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#3B2F2F] text-[#E8C5C8] text-xs font-semibold uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-[#E5B5B7] inline-block animate-pulse"></span>
                  <span>Send a Customer Enquiry</span>
                </div>
                <h1 className="font-serif-luxury text-3xl sm:text-5xl font-bold text-white tracking-tight">
                  Send a Customer Enquiry & Consultation
                </h1>
                <p className="text-xs sm:text-sm text-[#D9C4BE] max-w-xl mx-auto">
                  Planning your wedding makeover, signature color transformation, or private bridal party? Send us an enquiry and our manager will contact you.
                </p>
              </div>
            </div>

            <EnquirySection
              onEnquirySubmitted={(enq) => {
                setEnquiries((prev) => [enq, ...prev]);
                const leadName = enq.customerName || enq.name || 'Client';
                const leadPhone = enq.customerPhone || enq.phone || '';
                addAuditLog('Enquiry Submitted', 'ENQUIRY', enq.id, `Lead received from ${leadName} (${leadPhone})`);
              }}
            />
            <ContactAndMap />
          </div>
        )}

        {publicPage === 'home' && (
          <div>
            {/* Hero Section with ONE primary Book Appointment CTA */}
            <Hero
              onOpenBooking={() => {
                setPreselectedService(null);
                setPreselectedArtist(null);
                setBookingModalOpen(true);
              }}
              onExploreMenu={() => navigate('/services')}
              onViewGallery={() => navigate('/gallery')}
              onOpenAdmin={() => navigate('/admin')}
            />

            {/* Short Salon Introduction (Requirement 2) */}
            <section className="py-12 bg-white border-y border-[#EDE1DD]">
              <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center space-y-4">
                <span className="text-xs uppercase font-bold tracking-widest text-[#8C3A42] bg-[#FAF0F1] px-3.5 py-1 rounded-full">
                  Private Luxury Sanctuary
                </span>
                <h2 className="font-serif-luxury text-2xl sm:text-4xl font-bold text-[#2D2424]">
                  Where Haute Coiffure Meets Bespoke Aesthetics
                </h2>
                <p className="text-sm sm:text-base text-[#615252] leading-relaxed max-w-3xl mx-auto font-light">
                  The Glossy Looks is Hyderabad's dedicated women-only sanctuary in Gachibowli, blending Parisian balayage techniques,
                  radiant bridal couture makeovers, and rejuvenating aesthetic skin therapies. All services are performed in hygienic,
                  private styling suites by acclaimed master artists.
                </p>
              </div>
            </section>

            {/* Small Featured-Services Preview (Requirement 2: Small preview, not full duplication) */}
            <section className="py-14 bg-[#FAF7F5]">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 gap-4">
                  <div>
                    <span className="text-xs uppercase font-bold tracking-wider text-[#8C3A42]">Curated Highlights</span>
                    <h2 className="font-serif-luxury text-2xl sm:text-3xl font-bold text-[#2D2424] mt-1">
                      Featured Services Preview
                    </h2>
                    <p className="text-xs sm:text-sm text-[#7A6B6B] mt-1">
                      Handpicked signature treatments most loved by our Gachibowli clientele.
                    </p>
                  </div>
                  <button
                    onClick={() => navigate('/services')}
                    className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-[#8C3A42] hover:text-[#5B2329] self-start sm:self-auto cursor-pointer"
                  >
                    <span>View All Services & Live Menu</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {services.filter(s => s.active !== false).slice(0, 6).map((srv) => (
                    <div
                      key={srv.id}
                      className="bg-white rounded-2xl overflow-hidden border border-[#EDE1DD] shadow-xs hover:shadow-md transition-all group flex flex-col"
                    >
                      <div className="h-44 overflow-hidden relative bg-[#EFE8E5]">
                        <img
                          src={srv.image || 'https://images.unsplash.com/photo-1560869713-7d0a29430803?auto=format&fit=crop&w=400&q=80'}
                          alt={srv.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                        <span className="absolute top-3 left-3 px-2.5 py-1 bg-white/95 backdrop-blur-xs rounded-full text-[10px] uppercase font-bold text-[#8C3A42] shadow-xs">
                          {srv.category}
                        </span>
                      </div>
                      <div className="p-5 flex-1 flex flex-col justify-between space-y-3">
                        <div>
                          <h3 className="font-serif-luxury text-base font-bold text-[#2D2424]">{srv.name}</h3>
                          <p className="text-xs text-[#7A6B6B] line-clamp-2 mt-1 font-light leading-relaxed">
                            {srv.description || 'Custom tailored pampering with premium salon products and expert styling.'}
                          </p>
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-[#F0E6E3]">
                          <div>
                            <span className="font-serif-luxury text-lg font-bold text-[#8C3A42]">
                              ₹{srv.price.toLocaleString('en-IN')}
                            </span>
                            <span className="text-[11px] text-[#8C7A7A] ml-1.5">• {srv.durationMinutes} min</span>
                          </div>
                          <button
                            onClick={() => {
                              setPreselectedService(srv);
                              setPreselectedArtist(null);
                              setBookingModalOpen(true);
                            }}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#FAF0F1] text-[#8C3A42] hover:bg-[#8C3A42] hover:text-white transition-colors cursor-pointer"
                          >
                            Book Slot
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Small Gallery Preview (Requirement 2: Small preview, not full duplication) */}
            <section className="py-14 bg-white border-t border-[#EDE1DD]">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 gap-4">
                  <div>
                    <span className="text-xs uppercase font-bold tracking-wider text-[#8C3A42]">Signature Portfolio</span>
                    <h2 className="font-serif-luxury text-2xl sm:text-3xl font-bold text-[#2D2424] mt-1">
                      Real Looks Preview
                    </h2>
                    <p className="text-xs sm:text-sm text-[#7A6B6B] mt-1">
                      A glimpse into recent bridal transformations and master styling crafted in salon.
                    </p>
                  </div>
                  <button
                    onClick={() => navigate('/gallery')}
                    className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-[#8C3A42] hover:text-[#5B2329] self-start sm:self-auto cursor-pointer"
                  >
                    <span>View Full Portfolio & Lookbook</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {galleryItems.slice(0, 4).map((work) => (
                    <div
                      key={work.id}
                      onClick={() => navigate('/gallery')}
                      className="group relative rounded-2xl overflow-hidden aspect-[4/5] bg-stone-100 cursor-pointer shadow-xs hover:shadow-md transition-all"
                    >
                      <img
                        src={work.mediaUrl || work.url || work.thumbnailUrl || 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=400&q=80'}
                        alt={work.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent flex flex-col justify-end p-4 text-white">
                        <span className="text-[10px] uppercase font-bold text-[#E8C5C8]">{work.category}</span>
                        <h4 className="font-serif-luxury text-sm font-semibold truncate">{work.title}</h4>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Primary Book Appointment CTA Card */}
            <section className="py-14 bg-[#FAF7F5]">
              <div className="max-w-5xl mx-auto px-4 sm:px-6">
                <div className="bg-gradient-to-br from-[#2D2424] to-[#453133] rounded-3xl p-8 sm:p-12 text-center text-white space-y-5 shadow-2xl relative overflow-hidden">
                  <div className="space-y-2 relative z-10">
                    <span className="text-xs uppercase font-bold tracking-widest text-[#E8C5C8] bg-white/10 px-3.5 py-1 rounded-full">
                      Instant Booking Pass
                    </span>
                    <h2 className="font-serif-luxury text-3xl sm:text-4xl font-bold">
                      Ready to Unveil Your Radiant Glow?
                    </h2>
                    <p className="text-xs sm:text-sm text-[#DDD0CC] max-w-xl mx-auto font-light leading-relaxed">
                      Reserve your private slot today. Experience customized care, transparent pricing, and instant WhatsApp confirmation.
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-4 pt-2 relative z-10">
                    <button
                      onClick={() => navigate('/book')}
                      className="flex items-center gap-2 bg-[#8C3A42] hover:bg-[#742F36] text-white px-8 py-3.5 rounded-xl text-sm font-semibold shadow-md transition-all hover:scale-105 cursor-pointer"
                    >
                      <Calendar className="w-4 h-4" />
                      <span>Book Salon Slot Online</span>
                    </button>
                    <button
                      onClick={() => navigate('/contact')}
                      className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-6 py-3.5 rounded-xl text-sm font-medium transition-colors cursor-pointer"
                    >
                      <span>Find Our Salon / Maps</span>
                    </button>
                  </div>
                </div>
              </div>
            </section>

          </div>
        )}
      </main>

      {/* Footer */}
      <Footer
        onNavigate={navigate}
        onOpenBooking={() => {
          setPreselectedService(null);
          setPreselectedArtist(null);
          setBookingModalOpen(true);
        }}
        onOpenAdmin={() => navigate('/admin')}
      />

      {/* Booking Modal */}
      <AppointmentBookingModal
        isOpen={bookingModalOpen}
        onClose={() => setBookingModalOpen(false)}
        services={services}
        artists={artists}
        initialSelectedService={preselectedService}
        initialSelectedArtist={preselectedArtist}
        onAppointmentCreated={handleAppointmentCreated}
        defaultRole="customer"
      />

      {/* Invoice View Modal */}
      <InvoiceModal
        bill={viewingInvoice}
        onClose={() => setViewingInvoice(null)}
      />

      {/* Floating WhatsApp Concierge Widget */}
      <WhatsAppWidget />

    </div>
  );
}
