-- =============================================================
-- Admin Panel: users, usage tracking, reports, limits
-- Run this once in the Supabase SQL Editor.
-- All tables use RLS enabled with NO policies, so only
-- the service-role key (server) can read/write them.
-- =============================================================

-- 1. app_users  — trusted user profile written by the server
CREATE TABLE IF NOT EXISTS public.app_users (
  uid           TEXT PRIMARY KEY,
  email         TEXT,
  name          TEXT,
  photo_url     TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
-- No policies = only service-role key can access.

-- 2. user_access  — admin controls per user
CREATE TABLE IF NOT EXISTS public.user_access (
  uid            TEXT PRIMARY KEY REFERENCES public.app_users(uid) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  daily_limit    INT,                     -- null = use global default
  blocked_reason TEXT,
  note           TEXT,
  updated_by     TEXT,                    -- admin email
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_access ENABLE ROW LEVEL SECURITY;

-- 3. usage_events  — one row per AI request
CREATE TABLE IF NOT EXISTS public.usage_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
  day           DATE NOT NULL,            -- IST date (Asia/Kolkata)
  uid           TEXT NOT NULL,
  feature       TEXT NOT NULL,
  engine        TEXT NOT NULL CHECK (engine IN ('server', 'own_key', 'bridge')),
  provider      TEXT,
  model         TEXT,
  pages         INT DEFAULT 0,
  input_tokens  INT DEFAULT 0,
  output_tokens INT DEFAULT 0,
  duration_ms   INT DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error', 'limited', 'blocked')),
  error         TEXT,
  source        TEXT NOT NULL DEFAULT 'server' CHECK (source IN ('server', 'client'))
);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_usage_events_uid_ts
  ON public.usage_events (uid, ts DESC);

CREATE INDEX IF NOT EXISTS idx_usage_events_ts
  ON public.usage_events (ts DESC);

CREATE INDEX IF NOT EXISTS idx_usage_events_day
  ON public.usage_events (day);

-- 4. usage_daily  — aggregated totals for fast reports & limit checks
CREATE TABLE IF NOT EXISTS public.usage_daily (
  day           DATE NOT NULL,
  uid           TEXT NOT NULL,
  feature       TEXT NOT NULL,
  engine        TEXT NOT NULL,
  requests      INT NOT NULL DEFAULT 0,
  errors        INT NOT NULL DEFAULT 0,
  pages         INT NOT NULL DEFAULT 0,
  input_tokens  BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, uid, feature, engine)
);

ALTER TABLE public.usage_daily ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_usage_daily_day
  ON public.usage_daily (day);

-- 5. admin_audit  — admin action log
CREATE TABLE IF NOT EXISTS public.admin_audit (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  admin_uid   TEXT NOT NULL,
  admin_email TEXT NOT NULL,
  action      TEXT NOT NULL,
  target_uid  TEXT,
  details     JSONB
);

ALTER TABLE public.admin_audit ENABLE ROW LEVEL SECURITY;

-- 6. app_settings  — global settings
CREATE TABLE IF NOT EXISTS public.app_settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Seed default settings
INSERT INTO public.app_settings (key, value)
VALUES
  ('default_daily_limit', 'null'::jsonb),
  ('retention_days', '90'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- =============================================================
-- record_usage(event jsonb)
-- Inserts the event row AND upserts usage_daily in one call.
-- =============================================================
CREATE OR REPLACE FUNCTION public.record_usage(event JSONB)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_day        DATE;
  v_uid        TEXT;
  v_feature    TEXT;
  v_engine     TEXT;
  v_status     TEXT;
  v_pages      INT;
  v_in_tokens  INT;
  v_out_tokens INT;
  v_is_error   INT;
BEGIN
  v_day        := (event->>'day')::DATE;
  v_uid        := event->>'uid';
  v_feature    := event->>'feature';
  v_engine     := event->>'engine';
  v_status     := COALESCE(event->>'status', 'ok');
  v_pages      := COALESCE((event->>'pages')::INT, 0);
  v_in_tokens  := COALESCE((event->>'input_tokens')::INT, 0);
  v_out_tokens := COALESCE((event->>'output_tokens')::INT, 0);
  v_is_error   := CASE WHEN v_status IN ('error', 'limited', 'blocked') THEN 1 ELSE 0 END;

  -- Insert the raw event
  INSERT INTO public.usage_events (
    ts, day, uid, feature, engine, provider, model,
    pages, input_tokens, output_tokens, duration_ms,
    status, error, source
  ) VALUES (
    COALESCE((event->>'ts')::TIMESTAMPTZ, now()),
    v_day,
    v_uid,
    v_feature,
    v_engine,
    event->>'provider',
    event->>'model',
    v_pages,
    v_in_tokens,
    v_out_tokens,
    COALESCE((event->>'duration_ms')::INT, 0),
    v_status,
    event->>'error',
    COALESCE(event->>'source', 'server')
  );

  -- Upsert usage_daily
  INSERT INTO public.usage_daily (day, uid, feature, engine, requests, errors, pages, input_tokens, output_tokens)
  VALUES (v_day, v_uid, v_feature, v_engine, 1, v_is_error, v_pages, v_in_tokens, v_out_tokens)
  ON CONFLICT (day, uid, feature, engine)
  DO UPDATE SET
    requests      = public.usage_daily.requests + 1,
    errors        = public.usage_daily.errors + EXCLUDED.errors,
    pages         = public.usage_daily.pages + EXCLUDED.pages,
    input_tokens  = public.usage_daily.input_tokens + EXCLUDED.input_tokens,
    output_tokens = public.usage_daily.output_tokens + EXCLUDED.output_tokens;
END;
$$;

-- =============================================================
-- Seed app_users from existing public.users (one-time migration)
-- =============================================================
INSERT INTO public.app_users (uid, email, name, photo_url, first_seen_at, last_seen_at)
SELECT
  id,
  COALESCE(email, ''),
  COALESCE(display_name, ''),
  COALESCE(photo_url, ''),
  COALESCE(created_at, now()),
  COALESCE(updated_at, now())
FROM public.users
ON CONFLICT (uid) DO NOTHING;
