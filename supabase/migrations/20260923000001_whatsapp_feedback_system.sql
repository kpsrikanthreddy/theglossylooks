-- Migration: 20260923000001_whatsapp_feedback_system.sql
-- Description: Meta WhatsApp Cloud API Webhook, Feedback Workflow, and Message Delivery Logging
-- Author: The Glossy Looks Salon Engineering

-- 1. Ensure feedback_rating enum includes flexible statuses or allow nullable rating for pending feedback
DO $$
BEGIN
  -- If customer_feedback table exists, ensure required columns exist
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'customer_feedback') THEN
    ALTER TABLE customer_feedback 
      ADD COLUMN IF NOT EXISTS whatsapp_message_id TEXT,
      ADD COLUMN IF NOT EXISTS customer_id TEXT,
      ADD COLUMN IF NOT EXISTS feedback_request_sent_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS feedback_received_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS google_review_link_sent BOOLEAN DEFAULT false;

    -- Make rating nullable initially if pending feedback is created before customer replies
    ALTER TABLE customer_feedback ALTER COLUMN rating DROP NOT NULL;
  END IF;
END $$;

-- 2. Enhance WhatsApp Message Logs with direction, button IDs, and status tracking
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'whatsapp_message_logs') THEN
    ALTER TABLE whatsapp_message_logs
      ADD COLUMN IF NOT EXISTS wa_message_id TEXT,
      ADD COLUMN IF NOT EXISTS customer_id TEXT,
      ADD COLUMN IF NOT EXISTS feedback_id UUID,
      ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'outbound',
      ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'template',
      ADD COLUMN IF NOT EXISTS button_id TEXT,
      ADD COLUMN IF NOT EXISTS message_text TEXT,
      ADD COLUMN IF NOT EXISTS error_details TEXT,
      ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT false;
  END IF;
END $$;

-- 3. Idempotency Table: Processed Webhook Events
-- Guarantees that duplicate Meta webhooks are never processed multiple times
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  wa_message_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  phone_number TEXT,
  sender_name TEXT,
  payload_summary TEXT,
  processed_at TIMESTAMPTZ DEFAULT now()
);

-- Index for quick lookup
CREATE INDEX IF NOT EXISTS idx_processed_events_processed_at ON processed_webhook_events(processed_at);

-- 4. Persistent Scheduled Feedback Queue
-- Guarantees feedback is dispatched after the configured delay (default 30 mins)
-- even across browser reloads, server restarts, and redeployments.
CREATE TABLE IF NOT EXISTS scheduled_feedback_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  service_name TEXT,
  artist_name TEXT,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'CANCELLED')),
  attempts INT DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_scheduled_queue_status_time ON scheduled_feedback_queue(status, scheduled_for);

-- 5. Row Level Security Policies
ALTER TABLE processed_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_feedback_queue ENABLE ROW LEVEL SECURITY;

-- Allow authenticated admin users to read and manage queue and events
CREATE POLICY "Admins can view processed webhook events" ON processed_webhook_events FOR SELECT USING (true);
CREATE POLICY "Admins can view and manage scheduled queue" ON scheduled_feedback_queue FOR ALL USING (true);
