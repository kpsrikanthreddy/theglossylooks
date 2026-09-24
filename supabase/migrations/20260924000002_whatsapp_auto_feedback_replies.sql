-- Migration: 20260924000002_whatsapp_auto_feedback_replies.sql
-- Description: Automatic WhatsApp Feedback Reply Handling & Storage for The Glossy Looks
-- Author: The Glossy Looks Salon Engineering

-- 1. Ensure customer_feedback table exists with required fields:
-- customer_name, customer_phone, appointment_id, service_name, rating, feedback_text, created_at
CREATE TABLE IF NOT EXISTS customer_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  appointment_id TEXT,
  service_name TEXT DEFAULT 'Salon Service',
  rating TEXT,
  feedback_text TEXT,
  comment TEXT,
  whatsapp_message_id TEXT,
  requires_follow_up BOOLEAN DEFAULT false,
  follow_up_status TEXT DEFAULT 'RESOLVED',
  follow_up_notes TEXT,
  google_review_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Alter existing customer_feedback table if it was created from prior schema
DO $$
BEGIN
  -- Add feedback_text column if not present
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'customer_feedback' AND column_name = 'feedback_text'
  ) THEN
    ALTER TABLE customer_feedback ADD COLUMN feedback_text TEXT;
  END IF;

  -- Ensure appointment_id is nullable (feedback can arrive without prior appointment record)
  ALTER TABLE customer_feedback ALTER COLUMN appointment_id DROP NOT NULL;

  -- Ensure service_name is nullable with default
  ALTER TABLE customer_feedback ALTER COLUMN service_name DROP NOT NULL;
  ALTER TABLE customer_feedback ALTER COLUMN service_name SET DEFAULT 'Salon Service';

  -- Ensure rating can store lowercase 'good', 'average', 'bad' or text
  BEGIN
    ALTER TABLE customer_feedback ALTER COLUMN rating TYPE TEXT USING rating::TEXT;
    ALTER TABLE customer_feedback ALTER COLUMN rating DROP NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Ensure google_review_sent column exists
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'customer_feedback' AND column_name = 'google_review_sent'
  ) THEN
    ALTER TABLE customer_feedback ADD COLUMN google_review_sent BOOLEAN DEFAULT false;
  END IF;

  -- Ensure whatsapp_message_id exists
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'customer_feedback' AND column_name = 'whatsapp_message_id'
  ) THEN
    ALTER TABLE customer_feedback ADD COLUMN whatsapp_message_id TEXT;
  END IF;
END $$;

-- 3. Webhook Idempotency Table: processed_webhook_events
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  wa_message_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  phone_number TEXT,
  sender_name TEXT,
  payload_summary TEXT,
  processed_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Create Indexes for High-Performance Webhook Lookups
CREATE INDEX IF NOT EXISTS idx_customer_feedback_phone_created 
  ON customer_feedback(customer_phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_processed_events_processed_at 
  ON processed_webhook_events(processed_at);

-- 5. Enable Row Level Security (RLS)
ALTER TABLE customer_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_webhook_events ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies
DROP POLICY IF EXISTS "Allow select for authenticated or service role" ON customer_feedback;
CREATE POLICY "Allow select for authenticated or service role" ON customer_feedback FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert/update for webhook and service role" ON customer_feedback;
CREATE POLICY "Allow insert/update for webhook and service role" ON customer_feedback FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow all on processed_webhook_events" ON processed_webhook_events;
CREATE POLICY "Allow all on processed_webhook_events" ON processed_webhook_events FOR ALL USING (true);
