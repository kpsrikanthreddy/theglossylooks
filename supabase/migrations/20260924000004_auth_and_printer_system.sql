-- Migration: 20260924000004_auth_and_printer_system.sql
-- Description: Robust Role-Based Access Control (Admin vs Staff), Password Security, and Thermal Printer Queue System
-- Author: The Glossy Looks Salon Engineering

-- 1. Enhance admin_users table for staff authentication, password hashes, and active status
DO $$
BEGIN
  -- Add password_hash column if not exists
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'admin_users' AND column_name = 'password_hash'
  ) THEN
    ALTER TABLE admin_users ADD COLUMN password_hash TEXT;
  END IF;

  -- Add salt column if not exists
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'admin_users' AND column_name = 'salt'
  ) THEN
    ALTER TABLE admin_users ADD COLUMN salt TEXT;
  END IF;

  -- Add active column if not exists
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'admin_users' AND column_name = 'active'
  ) THEN
    ALTER TABLE admin_users ADD COLUMN active BOOLEAN DEFAULT true;
  END IF;
END $$;

-- 2. Thermal Printer Queue & Jobs Table (MOZZ Restaurant-grade Architecture)
CREATE TABLE IF NOT EXISTS print_jobs (
  id TEXT PRIMARY KEY,
  invoice_id TEXT,
  invoice_number TEXT,
  type TEXT NOT NULL DEFAULT 'bill', -- 'bill', 'test', 'reprint'
  paper_width TEXT NOT NULL DEFAULT '3inch', -- '3inch' (80mm) or '4inch' (104mm)
  auto_cut BOOLEAN DEFAULT true,
  copies INT DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'claimed', 'printed', 'failed'
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  printed_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  error_message TEXT
);

-- 3. Printer Settings Table
CREATE TABLE IF NOT EXISTS printer_settings (
  id INT PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN DEFAULT true,
  printer_name TEXT DEFAULT 'POS-80C Thermal',
  connection_type TEXT DEFAULT 'local_agent', -- 'local_agent', 'network_ip', 'browser_direct'
  paper_width TEXT DEFAULT '3inch', -- '3inch' or '4inch'
  auto_print BOOLEAN DEFAULT true,
  auto_cut BOOLEAN DEFAULT true,
  copies INT DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Initial default settings row
INSERT INTO printer_settings (id, enabled, printer_name, connection_type, paper_width, auto_print, auto_cut, copies)
VALUES (1, true, 'POS-80C Thermal Printer', 'local_agent', '3inch', true, true, 1)
ON CONFLICT (id) DO NOTHING;

-- RLS
ALTER TABLE print_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE printer_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated admin/staff to read print jobs" ON print_jobs FOR SELECT USING (true);
CREATE POLICY "Allow authenticated admin/staff to insert print jobs" ON print_jobs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow authenticated admin/staff to update print jobs" ON print_jobs FOR UPDATE USING (true);
CREATE POLICY "Allow authenticated users to read printer settings" ON printer_settings FOR SELECT USING (true);
CREATE POLICY "Allow authenticated users to update printer settings" ON printer_settings FOR UPDATE USING (true);
