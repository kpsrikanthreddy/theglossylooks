import { SALON_INFO } from '../data/initialData';
import { Appointment, BillOrder, CustomerEnquiry } from '../types/salon';

/**
 * Clean phone number to digits only with country code
 */
export function sanitizePhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return '91' + digits; // Default to India prefix if 10 digits
  }
  return digits;
}

/**
 * Open WhatsApp URL in new tab or app
 */
export function openWhatsApp(phone: string, message: string): void {
  const targetPhone = sanitizePhoneNumber(phone);
  const encodedText = encodeURIComponent(message);
  const url = `https://wa.me/${targetPhone}?text=${encodedText}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Create WhatsApp link for the salon's own WhatsApp number (Customer enquiries)
 */
export function getSalonWhatsAppUrl(customMessage?: string): string {
  const defaultMsg = `Hello Glossy Looks Women Salon, I would like to enquire about your services and book an appointment.`;
  const text = encodeURIComponent(customMessage || defaultMsg);
  return `https://wa.me/${SALON_INFO.whatsapp}?text=${text}`;
}

/**
 * Generate Appointment Confirmation message
 */
export function getAppointmentWhatsAppMessage(appointment: Appointment): string {
  return `✨ *Glossy Looks Women Salon - Appointment Confirmation* ✨

Dear ${appointment.customerName},
Your luxury salon appointment has been confirmed! Here are the details:

🗓️ *Date:* ${appointment.date}
⏰ *Time:* ${appointment.timeSlot}
💅 *Services:* ${appointment.serviceNames.join(', ')}
${appointment.artistName ? `💄 *Stylist/Artist:* ${appointment.artistName}\n` : ''}🏷️ *Booking Ref:* ${appointment.referenceCode}
💰 *Estimated Total:* ₹${appointment.totalAmount.toLocaleString('en-IN')}

📍 *Location:* ${SALON_INFO.address}
🗺️ *Google Maps:* ${SALON_INFO.googleMapsDirectionsUrl}

Please arrive 10 minutes prior to your slot. If you need to reschedule, reply to this message.
We look forward to pampering you! 💖`;
}

/**
 * Generate Appointment Reminder message
 */
export function getAppointmentReminderMessage(appointment: Appointment): string {
  return `✨ *Reminder: Your Appointment Today at Glossy Looks Women Salon* ✨

Hello ${appointment.customerName},
This is a gentle reminder for your pampering session today:

⏰ *Time:* ${appointment.timeSlot} (${appointment.date})
💅 *Services:* ${appointment.serviceNames.join(', ')}
${appointment.artistName ? `💄 *Specialist:* ${appointment.artistName}\n` : ''}📍 *Salon Address:* ${SALON_INFO.address}

Need directions or running late? Call us at ${SALON_INFO.phone}. See you soon! ✨`;
}

/**
 * Generate Invoice / Bill message
 */
export function getInvoiceWhatsAppMessage(bill: BillOrder): string {
  const itemsText = bill.items
    .map((item, idx) => `${idx + 1}. ${item.name} (${item.quantity}x) - ₹${(item.price * item.quantity).toLocaleString('en-IN')}`)
    .join('\n');

  return `🧾 *Glossy Looks Women Salon - Digital Invoice* 🧾

Thank you for visiting us, *${bill.customerName}*!
Here is your itemized billing statement:

📋 *Invoice No:* ${bill.invoiceNumber}
📅 *Date:* ${bill.createdAt}
--------------------------------
${itemsText}
--------------------------------
Subtotal: ₹${(bill.subtotal ?? bill.subTotal ?? 0).toLocaleString('en-IN')}
${bill.discountAmount > 0 ? `Discount: -₹${bill.discountAmount.toLocaleString('en-IN')}\n` : ''}Tax: ₹${bill.taxAmount.toLocaleString('en-IN')}
${(bill.tipAmount ?? 0) > 0 ? `Stylist Gratuity: ₹${(bill.tipAmount ?? 0).toLocaleString('en-IN')}\n` : ''}*Grand Total Paid:* ₹${bill.grandTotal.toLocaleString('en-IN')}
Payment Mode: *${bill.paymentMode}* (${bill.paymentStatus})

Handled by: ${bill.staffName || 'Reception Desk'}
We hope you loved your new look! Looking forward to your next visit. 🌸`;
}

/**
 * Generate Post-Service Feedback Follow-up
 */
export function getFeedbackFollowUpMessage(customerName: string, serviceName?: string): string {
  return `💖 *Glossy Looks Women Salon - How was your experience?* 💖

Dear ${customerName},
Thank you for trusting Glossy Looks Salon${serviceName ? ` with your ${serviceName}` : ''}!

We would love to know how you feel about your look. If you loved the service, please take a moment to leave us a 5-star review on Google:
⭐ Google Review Link: ${SALON_INFO.googleMapsDirectionsUrl}

As a token of appreciation, show this message on your next visit to enjoy a complimentary hair gloss spa or foot scrub! 🌸`;
}

/**
 * Generate Enquiry Follow-up message
 */
export function getEnquiryFollowUpMessage(enquiry: CustomerEnquiry): string {
  return `Hello ${enquiry.customerName} Ji! ✨
Greetings from *Glossy Looks Women Salon*.

We received your enquiry regarding:
📌 *Service:* ${enquiry.serviceOfInterest}
${enquiry.preferredDate ? `🗓️ *Preferred Date:* ${enquiry.preferredDate}\n` : ''}
We have customized packages and master stylists ready for this. Would you like to schedule a quick 5-minute call or bridal consultation today?

Warm regards,
Customer Relations Team
Glossy Looks Women Salon | ${SALON_INFO.phone}`;
}
