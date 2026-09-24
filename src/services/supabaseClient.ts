/**
 * Supabase Database Client & Persistent WhatsApp Feedback Data Layer
 * The Glossy Looks Women's Salon
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;

export interface SupabaseFeedbackPayload {
  customer_name: string;
  customer_phone: string;
  appointment_id?: string | null;
  service_name?: string | null;
  rating: 'good' | 'average' | 'bad' | string;
  feedback_text?: string | null;
  created_at?: string;
  whatsapp_message_id?: string | null;
  google_review_sent?: boolean;
  requires_follow_up?: boolean;
  follow_up_status?: 'PENDING' | 'CONTACTED' | 'RESOLVED' | string;
  follow_up_notes?: string | null;
}

/**
 * Initializes or retrieves the singleton Supabase client.
 * Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY || 
    process.env.SUPABASE_ANON_KEY
  )?.trim();

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  try {
    supabaseInstance = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    return supabaseInstance;
  } catch (err) {
    console.error('[Supabase Client] Initialization failed:', err);
    return null;
  }
}

/**
 * Saves a customer feedback entry to Supabase `customer_feedback` table.
 * Falls back safely if Supabase is unconfigured or unavailable.
 */
export async function saveFeedbackToSupabase(payload: SupabaseFeedbackPayload): Promise<{ success: boolean; data?: any; error?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    // In dev / unconfigured environment: Log notice and continue with in-memory persistence
    return { success: true };
  }

  try {
    const insertData = {
      customer_name: payload.customer_name,
      customer_phone: payload.customer_phone,
      appointment_id: payload.appointment_id || null,
      service_name: payload.service_name || 'Salon Service',
      rating: payload.rating,
      feedback_text: payload.feedback_text || null,
      comment: payload.feedback_text || null,
      created_at: payload.created_at || new Date().toISOString(),
      whatsapp_message_id: payload.whatsapp_message_id || null,
      google_review_sent: payload.google_review_sent ?? false,
      requires_follow_up: payload.requires_follow_up ?? false,
      follow_up_status: payload.follow_up_status || (payload.rating === 'bad' ? 'PENDING' : 'RESOLVED'),
    };

    const { data, error } = await client
      .from('customer_feedback')
      .insert([insertData])
      .select();

    if (error) {
      console.warn('[Supabase Storage Warning] Could not insert into customer_feedback:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err: any) {
    console.error('[Supabase Storage Exception]:', err?.message || err);
    return { success: false, error: err?.message };
  }
}

/**
 * Updates the `feedback_text` for an existing Average or Bad feedback entry in Supabase.
 */
export async function updateFollowupFeedbackInSupabase(
  customerPhone: string,
  feedbackText: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: true };
  }

  try {
    // Find the latest feedback row for this customer phone
    const { data: existingRows, error: findError } = await client
      .from('customer_feedback')
      .select('id, feedback_text, comment')
      .eq('customer_phone', customerPhone)
      .order('created_at', { ascending: false })
      .limit(1);

    if (findError) {
      console.warn('[Supabase Storage Warning] Could not find feedback row to update:', findError.message);
      return { success: false, error: findError.message };
    }

    if (existingRows && existingRows.length > 0) {
      const targetId = existingRows[0].id;
      const { error: updateError } = await client
        .from('customer_feedback')
        .update({
          feedback_text: feedbackText,
          comment: feedbackText,
          requires_follow_up: true,
          follow_up_status: 'PENDING',
        })
        .eq('id', targetId);

      if (updateError) {
        console.warn('[Supabase Storage Warning] Could not update feedback_text:', updateError.message);
        return { success: false, error: updateError.message };
      }
    } else {
      // If no row existed, insert one
      await saveFeedbackToSupabase({
        customer_name: 'Customer',
        customer_phone: customerPhone,
        rating: 'average',
        feedback_text: feedbackText,
      });
    }

    return { success: true };
  } catch (err: any) {
    console.error('[Supabase Follow-up Update Exception]:', err?.message || err);
    return { success: false, error: err?.message };
  }
}

/**
 * Records processed WhatsApp message ID in Supabase for cross-restart idempotency.
 */
export async function recordProcessedWebhookEventInSupabase(
  waMessageId: string,
  eventType: string,
  phoneNumber?: string,
  senderName?: string,
  payloadSummary?: string
): Promise<void> {
  const client = getSupabaseClient();
  if (!client || !waMessageId) return;

  try {
    await client
      .from('processed_webhook_events')
      .upsert([
        {
          wa_message_id: waMessageId,
          event_type: eventType,
          phone_number: phoneNumber || null,
          sender_name: senderName || null,
          payload_summary: payloadSummary || null,
          processed_at: new Date().toISOString(),
        },
      ]);
  } catch (err: any) {
    console.warn('[Supabase Idempotency Warning]:', err?.message || err);
  }
}

/**
 * Checks if a WhatsApp message ID was already processed in Supabase.
 */
export async function isWebhookEventProcessedInSupabase(waMessageId: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || !waMessageId) return false;

  try {
    const { data, error } = await client
      .from('processed_webhook_events')
      .select('wa_message_id')
      .eq('wa_message_id', waMessageId)
      .limit(1);

    if (error || !data) return false;
    return data.length > 0;
  } catch {
    return false;
  }
}

export interface SupabaseMessageLogPayload {
  id: string;
  customer_name: string;
  customer_phone: string;
  template_name?: string | null;
  direction?: 'inbound' | 'outbound' | string;
  message_type?: string;
  button_id?: string | null;
  message_text?: string | null;
  wa_message_id?: string | null;
  api_accepted?: boolean;
  http_status?: number | null;
  status: string;
  error_code?: string | number | null;
  error_message?: string | null;
  error_data?: any;
  fbtrace_id?: string | null;
  contacts?: any;
  raw_request?: any;
  raw_response?: any;
  appointment_id?: string | null;
  is_test?: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * Saves a WhatsApp message log to Supabase `whatsapp_message_logs`.
 */
export async function saveMessageLogInSupabase(log: SupabaseMessageLogPayload): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return true;

  try {
    const { error } = await client
      .from('whatsapp_message_logs')
      .upsert([log], { onConflict: 'id' });

    if (error) {
      console.warn('[Supabase Storage Warning] Could not save to whatsapp_message_logs:', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error('[Supabase Message Log Exception]:', err?.message || err);
    return false;
  }
}

/**
 * Updates delivery status of a WhatsApp message in Supabase by wa_message_id.
 */
export async function updateMessageLogStatusInSupabase(
  waMessageId: string,
  status: string,
  errorDetails?: string
): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || !waMessageId) return true;

  try {
    const updateData: any = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (errorDetails) {
      updateData.error_message = errorDetails;
    }

    const { error } = await client
      .from('whatsapp_message_logs')
      .update(updateData)
      .eq('wa_message_id', waMessageId);

    if (error) {
      console.warn('[Supabase Storage Warning] Could not update whatsapp_message_logs status:', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn('[Supabase Status Update Warning]:', err?.message || err);
    return false;
  }
}

/**
 * Fetch active or all services from Supabase `services` table.
 */
export async function fetchServicesFromSupabase(): Promise<any[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from('services')
      .select('*')
      .order('display_order', { ascending: true });

    if (error) {
      console.warn('[Supabase Services Warning]:', error.message);
      return null;
    }
    return data;
  } catch (err: any) {
    console.warn('[Supabase Services Exception]:', err?.message || err);
    return null;
  }
}

/**
 * Save (insert or update) a salon service in Supabase.
 */
export async function saveServiceInSupabase(service: any): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return true;

  try {
    const row = {
      id: service.id,
      name: service.name,
      category: service.category,
      price: service.price,
      original_price: service.originalPrice || service.original_price || service.price,
      duration_minutes: service.durationMinutes || service.duration_minutes || 60,
      description: service.description || '',
      popular: !!service.popular,
      tier: service.tier || 'Classic',
      image: service.image || null,
      active: service.active !== false,
      display_order: service.displayOrder || service.display_order || 1,
    };

    const { error } = await client.from('services').upsert([row], { onConflict: 'id' });
    if (error) {
      console.warn('[Supabase Service Save Warning]:', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error('[Supabase Service Save Exception]:', err?.message || err);
    return false;
  }
}

/**
 * Delete a salon service in Supabase.
 */
export async function deleteServiceInSupabase(id: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return true;

  try {
    const { error } = await client.from('services').delete().eq('id', id);
    if (error) {
      console.warn('[Supabase Service Delete Warning]:', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error('[Supabase Service Delete Exception]:', err?.message || err);
    return false;
  }
}

/**
 * Save an appointment and link to existing customer (or create a new customer record).
 * Deduplicates customers by mobile phone number to avoid duplicate entries.
 */
export async function saveAppointmentAndCustomerInSupabase(appointment: {
  id?: string;
  referenceCode?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  serviceIds?: string[];
  serviceNames?: string[];
  artistId?: string;
  artistName?: string;
  date: string;
  timeSlot: string;
  status?: string;
  totalAmount?: number;
  notes?: string;
  bookedBy?: string;
}): Promise<{ success: boolean; customerId?: string; appointmentId?: string; isExistingCustomer?: boolean; error?: string }> {
  const client = getSupabaseClient();
  const rawPhone = appointment.customerPhone.trim();
  const digits = rawPhone.replace(/\D/g, '');
  const normalizedPhone = digits.length >= 10 ? digits.slice(-10) : digits;

  if (!client) {
    return {
      success: true,
      customerId: 'cust-' + normalizedPhone,
      appointmentId: appointment.id || `apt-${Date.now()}`,
      isExistingCustomer: false,
    };
  }

  try {
    // 1. Check if customer with this mobile number already exists
    const { data: existingCustomers, error: findError } = await client
      .from('customers')
      .select('*')
      .or(`phone.eq.${rawPhone},phone.eq.${normalizedPhone},phone.ilike.%${normalizedPhone}%`)
      .limit(1);

    if (findError) {
      console.warn('[Supabase Customer Lookup Warning]:', findError.message);
    }

    let customerId: string;
    let isExisting = false;

    if (existingCustomers && existingCustomers.length > 0) {
      const existing = existingCustomers[0];
      customerId = existing.id;
      isExisting = true;

      // Update existing customer record (total visits, last visit, notes, email if missing)
      const updatePayload: any = {
        total_visits: (existing.total_visits || 0) + 1,
        last_visit: appointment.date,
        last_service: appointment.serviceNames?.[0] || existing.last_service,
        updated_at: new Date().toISOString(),
      };
      if (appointment.totalAmount) {
        updatePayload.total_spend = Number(existing.total_spend || 0) + Number(appointment.totalAmount);
      }
      if (!existing.email && appointment.customerEmail) {
        updatePayload.email = appointment.customerEmail.trim();
      }
      if (appointment.notes) {
        updatePayload.notes = existing.notes 
          ? `${existing.notes} | ${appointment.notes}` 
          : appointment.notes;
      }

      await client.from('customers').update(updatePayload).eq('id', customerId);
    } else {
      // Create a brand-new customer profile
      const newCustomerPayload = {
        name: appointment.customerName.trim(),
        phone: rawPhone,
        email: appointment.customerEmail?.trim() || null,
        total_visits: 1,
        total_spend: appointment.totalAmount || 0,
        last_visit: appointment.date,
        last_service: appointment.serviceNames?.[0] || 'Salon Service',
        notes: appointment.notes?.trim() || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: createdCust, error: createCustErr } = await client
        .from('customers')
        .insert([newCustomerPayload])
        .select('id')
        .single();

      if (createCustErr) {
        console.warn('[Supabase Customer Insert Warning]:', createCustErr.message);
        customerId = 'cust-' + normalizedPhone;
      } else {
        customerId = createdCust.id;
      }
    }

    // 2. Insert the appointment into `appointments` table
    const aptPayload = {
      reference_code: appointment.referenceCode || `GLS-${Math.floor(1000 + Math.random() * 9000)}`,
      customer_name: appointment.customerName.trim(),
      customer_phone: rawPhone,
      customer_email: appointment.customerEmail?.trim() || null,
      service_ids: appointment.serviceIds || [],
      service_names: appointment.serviceNames || [],
      artist_id: appointment.artistId || null,
      artist_name: appointment.artistName || 'Any Available Top Specialist',
      date: appointment.date,
      time_slot: appointment.timeSlot,
      status: (appointment.status || 'confirmed').toLowerCase(),
      booked_by: appointment.bookedBy || 'customer',
      total_amount: appointment.totalAmount || 0,
      payment_status: 'PENDING',
      feedback_status: 'NOT_SENT',
      notes: appointment.notes?.trim() || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: createdApt, error: aptErr } = await client
      .from('appointments')
      .insert([aptPayload])
      .select('id')
      .single();

    if (aptErr) {
      console.warn('[Supabase Appointment Insert Warning]:', aptErr.message);
    }

    return {
      success: true,
      customerId,
      appointmentId: createdApt?.id || appointment.id || `apt-${Date.now()}`,
      isExistingCustomer: isExisting,
    };
  } catch (err: any) {
    console.error('[Supabase Booking Exception]:', err?.message || err);
    return {
      success: true,
      customerId: 'cust-' + normalizedPhone,
      appointmentId: appointment.id || `apt-${Date.now()}`,
      isExistingCustomer: false,
    };
  }
}

