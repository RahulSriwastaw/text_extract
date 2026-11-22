-- =============================================================
-- Plans + token quotas
-- Run this once in the Supabase SQL Editor, AFTER supabase_admin_schema.sql.
-- Safe to run again: every statement is idempotent.
-- =============================================================

-- 1. plans — the catalogue the admin assigns from
CREATE TABLE IF NOT EXISTS public.plans (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          TEXT NOT NULL,
  token_limit   BIGINT NOT NULL CHECK (token_limit > 0),   -- input + output tokens per plan period
  duration_days INT NOT NULL DEFAULT 30 CHECK (duration_days > 0),
  is_active     BOOLEAN NOT NULL DEFAULT true,             -- false = hidden from the assign list
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
-- No policies = only the service-role key can access.

-- 2. Per-user plan assignment. Name and token quota are copied from the plan
--    at assignment time, so editing a plan later never changes running plans.
ALTER TABLE public.user_access
  ADD COLUMN IF NOT EXISTS plan_id          BIGINT,
  ADD COLUMN IF NOT EXISTS plan_name        TEXT,
  ADD COLUMN IF NOT EXISTS plan_tokens      BIGINT,
  ADD COLUMN IF NOT EXISTS plan_tokens_used BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS plan_started_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_expires_at  TIMESTAMPTZ;

-- 3. Master switch (off until the admin turns it on in Settings)
INSERT INTO public.app_settings (key, value)
VALUES ('plans_required', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 4. Starter catalogue (only when no plan exists yet; edit freely in the admin panel).
--    token_limit is stored in raw API tokens. The admin panel shows it 1000x smaller:
--    5,000,000 here = 5,000 plan tokens = about 20 pages a day for 30 days.
INSERT INTO public.plans (name, token_limit, duration_days)
SELECT * FROM (VALUES
  ('Basic',    2500000::BIGINT, 30),   -- 2,500 tokens  (~10 pages/day)
  ('Teacher',  5000000::BIGINT, 30),   -- 5,000 tokens  (~20 pages/day)
  ('Pro',     12000000::BIGINT, 30)    -- 12,000 tokens (~50 pages/day)
) AS seed(name, token_limit, duration_days)
WHERE NOT EXISTS (SELECT 1 FROM public.plans);

-- =============================================================
-- record_usage(event jsonb) — same as before, plus:
-- server-key tokens are added to the user's plan counter.
-- Own-key and bridge runs do not spend plan tokens.
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

  INSERT INTO public.usage_daily (day, uid, feature, engine, requests, errors, pages, input_tokens, output_tokens)
  VALUES (v_day, v_uid, v_feature, v_engine, 1, v_is_error, v_pages, v_in_tokens, v_out_tokens)
  ON CONFLICT (day, uid, feature, engine)
  DO UPDATE SET
    requests      = public.usage_daily.requests + 1,
    errors        = public.usage_daily.errors + EXCLUDED.errors,
    pages         = public.usage_daily.pages + EXCLUDED.pages,
    input_tokens  = public.usage_daily.input_tokens + EXCLUDED.input_tokens,
    output_tokens = public.usage_daily.output_tokens + EXCLUDED.output_tokens;

  -- Spend plan tokens (server keys only)
  IF v_engine = 'server' AND (v_in_tokens + v_out_tokens) > 0 THEN
    UPDATE public.user_access
       SET plan_tokens_used = plan_tokens_used + v_in_tokens + v_out_tokens
     WHERE uid = v_uid AND plan_id IS NOT NULL;
  END IF;
END;
$$;
