/**
 * Customer Management Service
 * Aggregates visit history, payments, feedback, and communication logs.
 */

import { CustomerProfile, CustomerFeedback, WhatsAppMessageLog } from '../types/admin';
import { Appointment, BillOrder } from '../types/salon';

const CUSTOMERS_OVERRIDE_KEY = 'glossy_customers_overrides_v1';

export function getCustomerProfiles(
  appointments: Appointment[],
  bills: BillOrder[],
  feedback: CustomerFeedback[]
): CustomerProfile[] {
  // Read any manually edited customer records
  let overrides: Record<string, Partial<CustomerProfile>> = {};
  try {
    const raw = localStorage.getItem(CUSTOMERS_OVERRIDE_KEY);
    if (raw) overrides = JSON.parse(raw);
  } catch (e) {
    console.error(e);
  }

  const map = new Map<string, CustomerProfile>();

  // Aggregate from appointments
  appointments.forEach(apt => {
    const phone = apt.customerPhone.trim();
    if (!phone) return;

    const existing = map.get(phone);
    const aptAmount = apt.totalAmount || 0;
    const isCompleted = apt.status === 'completed';

    if (!existing) {
      map.set(phone, {
        id: 'cust-' + phone.replace(/[^0-9]/g, ''),
        name: apt.customerName,
        phone: phone,
        email: apt.customerEmail || '',
        lastVisit: apt.date,
        totalVisits: isCompleted ? 1 : 0,
        totalSpend: isCompleted ? aptAmount : 0,
        lastService: apt.serviceNames?.[0] || 'Salon Service',
        notes: apt.notes || '',
        createdAt: apt.createdAt || new Date().toISOString(),
      });
    } else {
      if (isCompleted) {
        existing.totalVisits += 1;
        existing.totalSpend += aptAmount;
      }
      if (!existing.lastVisit || new Date(apt.date) > new Date(existing.lastVisit)) {
        existing.lastVisit = apt.date;
        existing.lastService = apt.serviceNames?.[0] || existing.lastService;
      }
      if (!existing.email && apt.customerEmail) {
        existing.email = apt.customerEmail;
      }
    }
  });

  // Aggregate from bills
  bills.forEach(bill => {
    const phone = bill.customerPhone.trim();
    if (!phone) return;

    const existing = map.get(phone);
    if (existing) {
      // Avoid double-counting spend if already counted in appointment
      if (existing.totalSpend < bill.grandTotal) {
        existing.totalSpend = Math.max(existing.totalSpend, bill.grandTotal);
      }
    } else {
      map.set(phone, {
        id: 'cust-' + phone.replace(/[^0-9]/g, ''),
        name: bill.customerName,
        phone: phone,
        email: bill.customerEmail || '',
        lastVisit: bill.createdAt.split('T')[0],
        totalVisits: 1,
        totalSpend: bill.grandTotal,
        lastService: bill.items?.[0]?.name || 'Salon Service',
        notes: bill.notes || '',
        createdAt: bill.createdAt,
      });
    }
  });

  // Apply manual admin overrides
  const result: CustomerProfile[] = [];
  map.forEach((profile, phone) => {
    const override = overrides[phone] || overrides[profile.id];
    if (override) {
      result.push({ ...profile, ...override });
    } else {
      result.push(profile);
    }
  });

  return result.sort((a, b) => b.totalSpend - a.totalSpend);
}

export function saveCustomerOverride(phone: string, updates: Partial<CustomerProfile>): void {
  try {
    const raw = localStorage.getItem(CUSTOMERS_OVERRIDE_KEY);
    const overrides: Record<string, Partial<CustomerProfile>> = raw ? JSON.parse(raw) : {};
    overrides[phone] = { ...(overrides[phone] || {}), ...updates };
    localStorage.setItem(CUSTOMERS_OVERRIDE_KEY, JSON.stringify(overrides));
  } catch (e) {
    console.error(e);
  }
}
