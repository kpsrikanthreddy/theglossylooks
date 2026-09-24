/**
 * Automated Customer Feedback & WhatsApp Workflow Service
 * Decoupled event hooks for appointment completion and customer review handling.
 */

import { Appointment } from '../types/salon';
import { CustomerFeedback, FeedbackRating, SalonSettings, WhatsAppMessageLog, WhatsAppSettings } from '../types/admin';

export const DEFAULT_SALON_SETTINGS: SalonSettings = {
  businessName: 'The Glossy Looks Women’s Salon',
  address: '31, Vinayak Nagar, Gachibowli, Hyderabad, Telangana 500032',
  openingTime: '09:30',
  closingTime: '20:30',
  phone: '+91 98765 43210',
  email: 'info@glossylookssalon.com',
  whatsappNumber: '919876543210',
  googleMapsUrl: 'https://maps.google.com/?q=The+Glossy+Looks+Vinayak+Nagar+Gachibowli+Hyderabad',
  googleBusinessProfileUrl: 'https://business.google.com/n/the-glossy-looks-gachibowli',
  googleReviewUrl: 'https://g.page/r/glossy-looks-gachibowli/review',
};

export const DEFAULT_WHATSAPP_SETTINGS: WhatsAppSettings = {
  enabled: true,
  delayMinutes: 30,
  templateName: 'glossylooks_feedback',
  sendGoogleReviewOnGood: true,
  phoneNumberId: '109283746501928',
  wabaId: '394857201948572',
  webhookStatus: 'ACTIVE',
  lastWebhookReceived: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
  maskedToken: '••••••••••••4892',
};

// Initial feedback data to demonstrate the system
export const INITIAL_FEEDBACK: CustomerFeedback[] = [
  {
    id: 'fb-1',
    appointmentId: 'apt-101',
    customerName: 'Ananya Sharma',
    customerPhone: '+91 98765 43211',
    serviceName: 'Royal Bridal HD Makeover',
    artistName: 'Zainab Qureshi',
    rating: 'GOOD',
    comment: 'The bridal makeover was absolutely stunning! Everyone at my reception was praising the hair and contouring. Thank you Zainab!',
    createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
    requiresFollowUp: false,
    followUpStatus: 'RESOLVED',
    googleReviewSent: true,
  },
  {
    id: 'fb-2',
    appointmentId: 'apt-102',
    customerName: 'Dr. Meera Nambiar',
    customerPhone: '+91 98490 12345',
    serviceName: 'Organic Keratin Infusion & Gloss Treatment',
    artistName: 'Farhana Begum',
    rating: 'GOOD',
    comment: 'Hair feels silky, soft and completely frizz free. Great hygienic studio environment.',
    createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
    requiresFollowUp: false,
    followUpStatus: 'RESOLVED',
    googleReviewSent: true,
  },
  {
    id: 'fb-3',
    appointmentId: 'apt-103',
    customerName: 'Priya Varma',
    customerPhone: '+91 99887 76655',
    serviceName: 'Signature Creative Haircut & Moroccan Blowdry',
    artistName: 'Farhana Begum',
    rating: 'AVERAGE',
    comment: 'Haircut is decent, but had to wait 20 minutes past my appointment time.',
    createdAt: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(),
    requiresFollowUp: false,
    followUpStatus: 'RESOLVED',
    followUpNotes: 'Informed client about unexpected rush; credited 10% loyalty discount for next visit.',
    googleReviewSent: false,
  },
  {
    id: 'fb-4',
    appointmentId: 'apt-104',
    customerName: 'Sravani Reddy',
    customerPhone: '+91 97012 34567',
    serviceName: '24K Luxury Gold Radiance Facial',
    artistName: 'Anita Rao',
    rating: 'BAD',
    comment: 'Slight redness around cheekbones after facial. Requested follow up with dermatologist advice.',
    createdAt: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
    requiresFollowUp: true,
    followUpStatus: 'PENDING',
    followUpNotes: 'Needs manager callback to arrange complimentary soothing aloe mask and check on skin condition.',
    googleReviewSent: false,
  }
];

export const INITIAL_WHATSAPP_LOGS: WhatsAppMessageLog[] = [
  {
    id: 'wlog-1',
    customerName: 'Ananya Sharma',
    customerPhone: '+91 98765 43211',
    type: 'FEEDBACK_REQUEST',
    status: 'DELIVERED',
    messagePreview: 'Hi Ananya, thank you for visiting The Glossy Looks! How was your Royal Bridal HD Makeover with Zainab today? Reply 1 for Good, 2 for Average, 3 for Bad.',
    timestamp: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
    appointmentId: 'apt-101',
  },
  {
    id: 'wlog-2',
    customerName: 'Ananya Sharma',
    customerPhone: '+91 98765 43211',
    type: 'GOOGLE_REVIEW_LINK',
    status: 'READ',
    messagePreview: 'We are thrilled you loved your look! Could you take 30 seconds to support us with a Google Review? https://g.page/r/glossy-looks-gachibowli/review',
    timestamp: new Date(Date.now() - 2 * 24 * 3600 * 1000 + 5 * 60 * 1000).toISOString(),
    appointmentId: 'apt-101',
  },
  {
    id: 'wlog-3',
    customerName: 'Sravani Reddy',
    customerPhone: '+91 97012 34567',
    type: 'FEEDBACK_REQUEST',
    status: 'READ',
    messagePreview: 'Hi Sravani, thank you for visiting The Glossy Looks! How was your 24K Luxury Gold Radiance Facial with Anita today?',
    timestamp: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
    appointmentId: 'apt-104',
  }
];

/**
 * Event hook triggered when an appointment is marked COMPLETED.
 * Exposes a decoupled trigger that initiates the automated WhatsApp feedback flow.
 */
export function onAppointmentCompletedHook(
  appointment: Appointment,
  settings: WhatsAppSettings,
  onLogCreated?: (log: WhatsAppMessageLog) => void
): { scheduled: boolean; message: string; log?: WhatsAppMessageLog } {
  if (!settings.enabled) {
    return {
      scheduled: false,
      message: 'WhatsApp automated feedback is currently disabled in settings.',
    };
  }

  const primaryService = appointment.serviceNames?.[0] || 'your salon service';
  const artistMention = appointment.artistName ? ` with ${appointment.artistName}` : '';
  const delayStr = settings.delayMinutes >= 60 
    ? `${settings.delayMinutes / 60} hour(s)` 
    : `${settings.delayMinutes} minute(s)`;

  const messageText = `Hi ${appointment.customerName}, thank you for choosing The Glossy Looks Women's Salon, Gachibowli! How was your ${primaryService}${artistMention}? Please share your quick feedback:\n1️⃣ Good 😊\n2️⃣ Average 😐\n3️⃣ Bad 😞`;

  const newLog: WhatsAppMessageLog = {
    id: 'wlog-' + Date.now(),
    customerName: appointment.customerName,
    customerPhone: appointment.customerPhone,
    type: 'FEEDBACK_REQUEST',
    status: 'SENT',
    messagePreview: messageText,
    timestamp: new Date().toISOString(),
    appointmentId: appointment.id,
  };

  if (onLogCreated) {
    onLogCreated(newLog);
  }

  return {
    scheduled: true,
    message: `Automated feedback request scheduled (delay: ${delayStr}) for ${appointment.customerName}.`,
    log: newLog,
  };
}

/**
 * Processes incoming customer rating logic according to business rules:
 * - GOOD: thank you + Google review link
 * - AVERAGE: thank you + ask for suggestions
 * - BAD: apology + flag for immediate admin follow-up (NO Google review link)
 */
export function processCustomerFeedbackRating(
  rating: FeedbackRating,
  customerName: string,
  salonSettings: SalonSettings
): {
  requiresFollowUp: boolean;
  replyMessage: string;
  sendGoogleReview: boolean;
} {
  switch (rating) {
    case 'GOOD':
      return {
        requiresFollowUp: false,
        sendGoogleReview: true,
        replyMessage: `Dear ${customerName}, thank you so much! Our team is delighted that you had a wonderful experience at The Glossy Looks. If you have a moment, please consider sharing your experience on Google: ${salonSettings.googleReviewUrl}`,
      };

    case 'AVERAGE':
      return {
        requiresFollowUp: false,
        sendGoogleReview: false,
        replyMessage: `Dear ${customerName}, thank you for your feedback. We continuously strive for perfection. Could you let us know what we could improve for your next visit? Your comfort is our priority!`,
      };

    case 'BAD':
      return {
        requiresFollowUp: true,
        sendGoogleReview: false,
        replyMessage: `Dear ${customerName}, we sincerely apologize that your experience did not meet expectations. Our salon manager will personally get in touch with you shortly to make this right. Thank you for bringing this to our attention.`,
      };
  }
}
