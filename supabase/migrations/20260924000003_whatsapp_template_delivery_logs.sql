-- Migration: 20260924000003_whatsapp_template_delivery_logs.sql
-- Description: Complete Meta WhatsApp Cloud API Response Capture, Template Tracking, and Delivery Status Tracking
-- Author: The Glossy Looks Salon Engineering

-- 1. Ensure whatsapp_message_logs table exists and has all required audit fields
CREATE TABLE IF NOT EXISTS whatsapp_message_logs (
  id TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  template_name TEXT DEFAULT 'glossylooks_feedback',
  direction TEXT NOT NULL DEFAULT 'outbound',
  message_type TEXT NOT NULL DEFAULT 'template',
  button_id TEXT,
  message_text TEXT,
  wa_message_id TEXT,
  api_accepted BOOLEAN DEFAULT false,
  http_status INT,
  status TEXT NOT NULL DEFAULT 'sent',
  error_code TEXT,
  error_message TEXT,
  error_data JSONB,
  fbtrace_id TEXT,
  contacts JSONB,
  raw_request JSONB,
  raw_response JSONB,
  appointment_id TEXT,
  is_test BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Alter existing whatsapp_message_logs table to ensure all columns exist
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'whatsapp_message_logs') THEN
    ALTER TABLE whatsapp_message_logs ADD COLUMN IF NOT EXISTS template_name TEXT DEFAULT 'glossylooks_feedback';
    ALTER TABLE whatsapp_message_logs ADD COLUMN IF NOT EXISTS wa_message_id TEXT;
    ALTER TABLE whatsapp_message_logs ADD COLUMN IF NOT EXISTS api_accepted BOOLEAN DEFAULT false;
    ALTER TABLE whatsapp_message_logs ADD COLUMN IF NOT EXISTS http_status INT;
    ALTER TABLE whatsapp_message_logs ADD COLUMN IF NOT EXISTS error_code TEXT;
    ALTER TABLE whatsapp_message_logs ADD COLUMN IF NOT EXISTS error_message TEXT;
    ALTER TABLE whatsapp_message_logs ADD COLUMN IF NOT EXISTS error_data JSONB;
    ALTER TABLE whatsapp_message_logs ADD COLUMN IF NOT EXISTS fbtrace_id TEXT;
    ALTER TABLE whatsapp_message_logs ADD COLUMN IF NOT EXISTS contacts JSONB;
    ALTER TABLE whatsapp_message_logs ADD COLUMN IF NOT EXISTS raw_request JSONB;
    ALTER TABLE whatsapp_message_logs ADD COLUMN IF NOT EXISTS raw_response JSONB;
    ALTER TABLE whatsapp_message_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
  END IF;
END $$;

-- 3. Create high-performance indexes for webhook status updates & searches
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_wamid ON whatsapp_message_logs(wa_message_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_phone ON whatsapp_message_logs(customer_phone);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_status ON whatsapp_message_logs(status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_created ON whatsapp_message_logs(created_at DESC);

-- 4. Enable Row Level Security (RLS) & Policies
ALTER TABLE whatsapp_message_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow select on whatsapp_message_logs" ON whatsapp_message_logs;
CREATE POLICY "Allow select on whatsapp_message_logs" ON whatsapp_message_logs FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert on whatsapp_message_logs" ON whatsapp_message_logs;
CREATE POLICY "Allow insert on whatsapp_message_logs" ON whatsapp_message_logs FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update on whatsapp_message_logs" ON whatsapp_message_logs;
CREATE POLICY "Allow update on whatsapp_message_logs" ON whatsapp_message_logs FOR UPDATE USING (true);
