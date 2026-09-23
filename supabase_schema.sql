-- ====================================================================
-- Supabase Schema for TextExtract Pro (Database: text-extract)
-- ====================================================================

-- 1. Create users table for user profile persistence
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS) on users
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read users" 
ON public.users FOR SELECT USING (true);

CREATE POLICY "Allow users to insert/update their profile" 
ON public.users FOR ALL USING (true) WITH CHECK (true);

-- --------------------------------------------------------------------
-- 2. Create user_history table for extracted document history
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT,
  original_name TEXT,
  created_at BIGINT,
  page_count INT DEFAULT 1,
  elements JSONB DEFAULT '[]'::jsonb,
  summary TEXT,
  raw_text TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_history_user_date 
ON public.user_history(user_id, created_at DESC);

ALTER TABLE public.user_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to user_history" 
ON public.user_history FOR ALL USING (true) WITH CHECK (true);

-- --------------------------------------------------------------------
-- 3. Create user_mocktests table for Mock Test sets
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_mocktests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  set_name TEXT,
  page_count INT DEFAULT 1,
  created_at BIGINT,
  items JSONB DEFAULT '[]'::jsonb,
  summary TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_mocktests_user_date 
ON public.user_mocktests(user_id, created_at DESC);

ALTER TABLE public.user_mocktests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to user_mocktests" 
ON public.user_mocktests FOR ALL USING (true) WITH CHECK (true);

-- --------------------------------------------------------------------
-- 4. Setup Storage Bucket for Cropped Figures & Diagrams
-- --------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public) 
VALUES ('figures', 'figures', true)
ON CONFLICT (id) DO NOTHING;

-- Public read access for images in 'figures' bucket
CREATE POLICY "Public Read Figures" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'figures');

-- Upload access for 'figures' bucket
CREATE POLICY "Public Insert Figures" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'figures');

CREATE POLICY "Public Update Figures" 
ON storage.objects FOR UPDATE 
USING (bucket_id = 'figures');

CREATE POLICY "Public Delete Figures" 
ON storage.objects FOR DELETE 
USING (bucket_id = 'figures');
