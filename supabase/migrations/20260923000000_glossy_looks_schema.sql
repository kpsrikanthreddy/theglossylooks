-- The Glossy Looks Women's Salon, Gachibowli, Hyderabad
-- Complete Database Schema & Row-Level-Security (RLS) Policies

-- Enums
CREATE TYPE admin_role AS ENUM ('SUPER_ADMIN', 'SALON_ADMIN', 'RECEPTIONIST', 'STAFF');
CREATE TYPE appointment_status AS ENUM ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show');
CREATE TYPE payment_status AS ENUM ('PENDING', 'PARTIAL', 'PAID');
CREATE TYPE feedback_rating AS ENUM ('GOOD', 'AVERAGE', 'BAD');
CREATE TYPE follow_up_status AS ENUM ('PENDING', 'CONTACTED', 'RESOLVED');

-- 1. Admin Users & Staff Authentication
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role admin_role NOT NULL DEFAULT 'RECEPTIONIST',
  phone TEXT,
  avatar TEXT,
  assigned_staff_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_login TIMESTAMPTZ
);

-- 2. Customers
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  email TEXT,
  total_visits INT DEFAULT 0,
  total_spend NUMERIC(10, 2) DEFAULT 0.00,
  last_visit DATE,
  last_service TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Salon Services Menu
CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  original_price NUMERIC(10, 2),
  duration_minutes INT NOT NULL DEFAULT 60,
  description TEXT,
  popular BOOLEAN DEFAULT false,
  tier TEXT DEFAULT 'Classic',
  image TEXT,
  active BOOLEAN DEFAULT true,
  display_order INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Staff / Artists
CREATE TABLE IF NOT EXISTS staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  specialty TEXT NOT NULL,
  avatar TEXT NOT NULL,
  phone TEXT,
  experience_years INT DEFAULT 1,
  bio TEXT,
  rating NUMERIC(3, 2) DEFAULT 4.9,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Appointments
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  service_ids TEXT[] NOT NULL,
  service_names TEXT[] NOT NULL,
  artist_id TEXT,
  artist_name TEXT,
  date DATE NOT NULL,
  time_slot TEXT NOT NULL,
  status appointment_status DEFAULT 'pending',
  booked_by TEXT DEFAULT 'customer',
  total_amount NUMERIC(10, 2) NOT NULL,
  payment_status payment_status DEFAULT 'PENDING',
  feedback_status TEXT DEFAULT 'NOT_SENT',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Billing Orders
CREATE TABLE IF NOT EXISTS bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  items JSONB NOT NULL,
  sub_total NUMERIC(10, 2) NOT NULL,
  discount_amount NUMERIC(10, 2) DEFAULT 0.00,
  tax_amount NUMERIC(10, 2) DEFAULT 0.00,
  grand_total NUMERIC(10, 2) NOT NULL,
  payment_mode TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'Paid',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. Customer Feedback & WhatsApp Ratings
CREATE TABLE IF NOT EXISTS customer_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  service_name TEXT NOT NULL,
  artist_name TEXT,
  rating feedback_rating NOT NULL,
  comment TEXT,
  requires_follow_up BOOLEAN DEFAULT false,
  follow_up_status follow_up_status DEFAULT 'RESOLVED',
  follow_up_notes TEXT,
  google_review_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 8. Gallery Portfolio Works
CREATE TABLE IF NOT EXISTS gallery_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'image',
  url TEXT NOT NULL,
  artist_id TEXT,
  artist_name TEXT,
  description TEXT,
  featured BOOLEAN DEFAULT false,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 9. Enquiries & Consultation Leads
CREATE TABLE IF NOT EXISTS enquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  service_interested TEXT,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'New',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 10. Salon & WhatsApp Settings
CREATE TABLE IF NOT EXISTS salon_settings (
  id INT PRIMARY KEY DEFAULT 1,
  business_name TEXT NOT NULL,
  address TEXT NOT NULL,
  opening_time TEXT NOT NULL,
  closing_time TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  whatsapp_number TEXT NOT NULL,
  google_maps_url TEXT,
  google_business_profile_url TEXT,
  google_review_url TEXT,
  whatsapp_enabled BOOLEAN DEFAULT true,
  whatsapp_delay_minutes INT DEFAULT 30,
  whatsapp_template_name TEXT DEFAULT 'glossylooks_feedback',
  send_google_review_on_good BOOLEAN DEFAULT true,
  phone_number_id TEXT,
  waba_id TEXT,
  masked_token TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 11. WhatsApp Message Logs
CREATE TABLE IF NOT EXISTS whatsapp_message_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  message_preview TEXT NOT NULL,
  appointment_id TEXT,
  timestamp TIMESTAMPTZ DEFAULT now()
);

-- 12. Security Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ DEFAULT now(),
  actor_name TEXT NOT NULL,
  actor_role admin_role NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details TEXT
);

-- Row Level Security (RLS) setup
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE gallery_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_settings ENABLE ROW LEVEL SECURITY;

-- Public read access for active services, staff, and gallery
CREATE POLICY "Public services are viewable by everyone" ON services FOR SELECT USING (active = true);
CREATE POLICY "Public staff are viewable by everyone" ON staff FOR SELECT USING (active = true);
CREATE POLICY "Public gallery works are viewable by everyone" ON gallery_items FOR SELECT USING (active = true);
CREATE POLICY "Public can insert consultation enquiries" ON enquiries FOR INSERT WITH CHECK (true);
CREATE POLICY "Public can insert appointments" ON appointments FOR INSERT WITH CHECK (true);
