/**
 * api/auth.ts — Firebase ID-token verification, user & admin middleware.
 *
 * verifyUser(req)   — verifies the Authorization: Bearer <idToken> header
 *                     using `jose` against Google's public JWKS.
 * requireUser       — Express middleware: sets res.locals.user, upserts app_users,
 *                     loads user_access + today's server-key count (cached 60 s).
 * requireAdmin      — additionally checks email_verified + ADMIN_EMAILS allowlist.
 * isAdminEmail(e)   — pure helper for the allowlist check.
 */
import type { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { adminDb, isAdminDbConfigured } from './db.js';
import { istToday } from './usage.js';

// ---------------------------------------------------------------------------
// Firebase project ID
// ---------------------------------------------------------------------------
const PROJECT_ID =
  process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '';

// ---------------------------------------------------------------------------
// Google public JWKS for Firebase Auth ID tokens
// ---------------------------------------------------------------------------
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

// ---------------------------------------------------------------------------
// Admin email allowlist
// ---------------------------------------------------------------------------
function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string): boolean {
  return getAdminEmails().includes(email.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Token payload type returned to route handlers
// ---------------------------------------------------------------------------
export interface VerifiedUser {
  uid: string;
  email: string;
  name: string;
  picture: string;
  email_verified: boolean;
}

// ---------------------------------------------------------------------------
// verifyUser — verify Firebase ID token from Authorization header
// ---------------------------------------------------------------------------
export async function verifyUser(req: Request): Promise<VerifiedUser | null> {
  const header = req.get('authorization');
  const token = header?.match(/^Bearer\s+(\S+)$/)?.[1];
  if (!token) return null;

  if (!PROJECT_ID) {
    console.warn('[auth] VITE_FIREBASE_PROJECT_ID is not set; cannot verify tokens.');
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
    });

    return {
      uid: String(payload.sub || ''),
      email: String((payload as any).email || ''),
      name: String((payload as any).name || ''),
      picture: String((payload as any).picture || ''),
      email_verified: !!(payload as any).email_verified,
    };
  } catch (err: any) {
    // Token expired, malformed, or invalid
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-user cache: access row + today's server-key count
// ---------------------------------------------------------------------------
export interface UserPlan {
  id: number;
  name: string;
  tokens: number;      // quota for this plan period
  used: number;        // server-key tokens spent so far
  expiresAt: string | null;
}

export interface CachedAccess {
  status: string;
  daily_limit: number | null;
  blocked_reason: string | null;
  serverCountToday: number;
  fetchedAt: number;
  plan?: UserPlan | null;
  /** false when the plan columns could not be read (DB error / migration not run): plan checks are skipped. */
  planKnown?: boolean;
}

const PLAN_COLUMNS = 'plan_id, plan_name, plan_tokens, plan_tokens_used, plan_expires_at';

const accessCache = new Map<string, CachedAccess>();
const CACHE_TTL_MS = 60_000; // 60 s

// Upsert throttle: at most once per minute per user per instance
const lastUpsert = new Map<string, number>();
const UPSERT_INTERVAL_MS = 60_000;

export async function upsertAppUser(user: VerifiedUser): Promise<void> {
  if (!adminDb) return;
  const now = Date.now();
  const last = lastUpsert.get(user.uid) || 0;
  if (now - last < UPSERT_INTERVAL_MS) return;
  lastUpsert.set(user.uid, now);

  try {
    const { error } = await adminDb.from('app_users').upsert(
      {
        uid: user.uid,
        email: user.email,
        name: user.name,
        photo_url: user.picture,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'uid' }
    );
    if (error) throw error;
  } catch (err) {
    lastUpsert.delete(user.uid);
    console.warn('[auth] app_users upsert failed:', err);
  }
}

export async function loadAccess(uid: string): Promise<CachedAccess> {
  const now = Date.now();
  const cached = accessCache.get(uid);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached;

  let status = 'active';
  let daily_limit: number | null = null;
  let blocked_reason: string | null = null;
  let serverCountToday = 0;
  let plan: UserPlan | null = null;
  let planKnown = false;

  if (adminDb) {
    try {
      let { data: access, error } = await adminDb
        .from('user_access')
        .select('status, daily_limit, blocked_reason, ' + PLAN_COLUMNS)
        .eq('uid', uid)
        .maybeSingle<any>();
      planKnown = !error;
      if (error) {
        // Plan columns missing (migration not run yet): keep block/limit checks working.
        ({ data: access } = await adminDb
          .from('user_access')
          .select('status, daily_limit, blocked_reason')
          .eq('uid', uid)
          .maybeSingle<any>());
      }

      if (access) {
        status = access.status || 'active';
        daily_limit = access.daily_limit;
        blocked_reason = access.blocked_reason;
        if (access.plan_id != null) {
          plan = {
            id: Number(access.plan_id),
            name: access.plan_name || 'Plan',
            tokens: Number(access.plan_tokens) || 0,
            used: Number(access.plan_tokens_used) || 0,
            expiresAt: access.plan_expires_at || null,
          };
        }
      }

      // Today's server-key request count for limit checks
      const today = istToday();
      const { data: dailyRows } = await adminDb
        .from('usage_daily')
        .select('requests, errors')
        .eq('uid', uid)
        .eq('day', today)
        .eq('engine', 'server');

      if (dailyRows) {
        for (const r of dailyRows) {
          // Only count successful requests toward the limit
          serverCountToday += (r.requests || 0) - (r.errors || 0);
        }
      }
    } catch (err) {
      planKnown = false;
      console.warn('[auth] loadAccess query failed, failing open:', err);
    }
  }

  const entry: CachedAccess = {
    status,
    daily_limit,
    blocked_reason,
    serverCountToday,
    fetchedAt: now,
    plan,
    planKnown,
  };
  accessCache.set(uid, entry);
  return entry;
}

// ---------------------------------------------------------------------------
// decideAccess — pure function (exported for unit tests)
// ---------------------------------------------------------------------------
export type PlanDenial = 'no_plan' | 'plan_expired' | 'token_limit';

/** Plan check on its own (pure). Returns null when the plan allows the request. */
export function planDenial(access: CachedAccess, now = Date.now()): PlanDenial | null {
  if (access.planKnown === false) return null; // could not read plan data: fail open
  const plan = access.plan;
  if (!plan) return 'no_plan';
  if (plan.expiresAt && Date.parse(plan.expiresAt) <= now) return 'plan_expired';
  if (plan.used >= plan.tokens) return 'token_limit';
  return null;
}

const PLAN_MESSAGES: Record<PlanDenial, string> = {
  no_plan: 'No active plan. Ask the admin to activate a plan for your account.',
  plan_expired: 'Your plan has expired. Ask the admin to renew it.',
  token_limit: 'Your plan tokens are used up. Ask the admin to renew the plan or add tokens.',
};

export interface AccessDecision {
  allowed: boolean;
  code?: 'blocked' | 'daily_limit' | PlanDenial;
  reason?: string;
  limit?: number;
  used?: number;
  resetsAt?: string; // ISO string for the next IST midnight
  hasOwnKey?: boolean;
  excludeServerKeys?: boolean;
}

export function decideAccess(
  access: CachedAccess,
  defaultLimit: number | null,
  hasOwnKey: boolean,
  plans: { required: boolean; isAdmin: boolean } = { required: false, isAdmin: false }
): AccessDecision {
  if (access.status === 'blocked') {
    return { allowed: false, code: 'blocked', reason: access.blocked_reason || 'Your account has been blocked.' };
  }

  // Plans: nobody but admins uses AI features without an active plan with tokens left.
  // An own API key does not bypass this.
  if (plans.required && !plans.isAdmin) {
    const denial = planDenial(access);
    if (denial) {
      return {
        allowed: false, code: denial, reason: PLAN_MESSAGES[denial],
        limit: access.plan?.tokens, used: access.plan?.used,
      };
    }
  }

  const limit = access.daily_limit ?? defaultLimit;
  if (limit == null) {
    return { allowed: true };
  }

  if (access.serverCountToday >= limit) {
    if (hasOwnKey) {
      // User has own key — allow but exclude server keys from the pool
      return { allowed: true, excludeServerKeys: true, hasOwnKey: true };
    }
    // Calculate next IST midnight
    const now = new Date();
    const istOffset = 5.5 * 60 * 60_000;
    const istNow = new Date(now.getTime() + istOffset);
    const istMidnight = new Date(istNow);
    istMidnight.setUTCHours(0, 0, 0, 0);
    istMidnight.setUTCDate(istMidnight.getUTCDate() + 1);
    const resetsAt = new Date(istMidnight.getTime() - istOffset).toISOString();

    return {
      allowed: false,
      code: 'daily_limit',
      limit,
      used: access.serverCountToday,
      resetsAt,
    };
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Global default limit helper
// ---------------------------------------------------------------------------
let cachedDefaultLimit: { value: number | null; at: number } = { value: null, at: 0 };

export async function getDefaultDailyLimit(): Promise<number | null> {
  const now = Date.now();
  if (now - cachedDefaultLimit.at < CACHE_TTL_MS) return cachedDefaultLimit.value;

  if (!adminDb) {
    cachedDefaultLimit = { value: null, at: now };
    return null;
  }

  try {
    const { data } = await adminDb
      .from('app_settings')
      .select('value')
      .eq('key', 'default_daily_limit')
      .maybeSingle();

    const v = data?.value;
    const limit = typeof v === 'number' ? v : null;
    cachedDefaultLimit = { value: limit, at: now };
    return limit;
  } catch {
    cachedDefaultLimit = { value: null, at: now };
    return null;
  }
}

// ---------------------------------------------------------------------------
// "Plans required" master switch (app_settings.plans_required)
// ---------------------------------------------------------------------------
let cachedPlansRequired = { value: false, at: 0 };

export async function getPlansRequired(): Promise<boolean> {
  const now = Date.now();
  if (now - cachedPlansRequired.at < CACHE_TTL_MS) return cachedPlansRequired.value;
  let value = false;
  if (adminDb) {
    try {
      const { data } = await adminDb.from('app_settings').select('value').eq('key', 'plans_required').maybeSingle();
      value = data?.value === true;
    } catch { /* keep off */ }
  }
  cachedPlansRequired = { value, at: now };
  return value;
}

export function invalidatePlansRequired(): void {
  cachedPlansRequired.at = 0;
  cachedWhatsapp.at = 0;
}

// ---------------------------------------------------------------------------
// WhatsApp number users contact to get a plan (app_settings.support_whatsapp)
// Stored as digits with country code, e.g. "919876543210".
// ---------------------------------------------------------------------------
let cachedWhatsapp = { value: '', at: 0 };

export async function getSupportWhatsapp(): Promise<string> {
  const now = Date.now();
  if (now - cachedWhatsapp.at < CACHE_TTL_MS) return cachedWhatsapp.value;
  let value = '';
  if (adminDb) {
    try {
      const { data } = await adminDb.from('app_settings').select('value').eq('key', 'support_whatsapp').maybeSingle();
      value = typeof data?.value === 'string' ? data.value.replace(/\D/g, '') : '';
    } catch { /* none */ }
  }
  cachedWhatsapp = { value, at: now };
  return value;
}

// ---------------------------------------------------------------------------
// requireUser middleware
// ---------------------------------------------------------------------------
const AUTH_REQUIRED = () => process.env.AUTH_REQUIRED === 'true';

export async function requireUser(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const user = await verifyUser(req);
  const plansRequired = await getPlansRequired();

  if (!user || !user.uid) {
    if (AUTH_REQUIRED() || plansRequired) {
      res.status(401).json({ error: 'Sign in to continue.', code: 'auth_required' });
      return;
    }
    // Soft mode: allow anonymous
    (res.locals as any).user = {
      uid: 'anonymous',
      email: '',
      name: '',
      picture: '',
      email_verified: false,
    } satisfies VerifiedUser;
    (res.locals as any).access = {
      status: 'active',
      daily_limit: null,
      blocked_reason: null,
      serverCountToday: 0,
      fetchedAt: Date.now(),
    } satisfies CachedAccess;
    next();
    return;
  }

  // Upsert user profile (throttled)
  upsertAppUser(user).catch(() => {});

  // Load access + today count
  const access = await loadAccess(user.uid);
  const defaultLimit = await getDefaultDailyLimit();
  // Personal API keys are switched off (backend/index.ts getUserKey), so nobody has one.
  const hasOwnKey = false;
  const decision = decideAccess(access, defaultLimit, hasOwnKey, {
    required: plansRequired,
    isAdmin: user.email_verified && isAdminEmail(user.email),
  });

  if (!decision.allowed) {
    const statusCode = decision.code === 'daily_limit' || decision.code === 'token_limit' ? 429 : 403;
    res.status(statusCode).json({
      error: decision.reason || 'Request not allowed.',
      code: decision.code,
      limit: decision.limit,
      used: decision.used,
      resetsAt: decision.resetsAt,
    });
    return;
  }

  (res.locals as any).user = user;
  (res.locals as any).access = access;
  (res.locals as any).accessDecision = decision;
  next();
}

// ---------------------------------------------------------------------------
// requireAdmin middleware
// ---------------------------------------------------------------------------
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const user = await verifyUser(req);
  if (!user || !user.uid) {
    res.status(401).json({ error: 'Sign in to access the admin panel.' });
    return;
  }

  if (!user.email_verified) {
    res.status(403).json({ error: 'Email not verified.' });
    return;
  }

  if (!isAdminEmail(user.email)) {
    res.status(403).json({ error: 'Not authorised.' });
    return;
  }

  // Admin password check (optional second factor)
  const adminPass = process.env.ADMIN_PASSWORD;
  if (adminPass) {
    const provided = req.get('x-admin-password') || '';
    if (provided !== adminPass) {
      res.status(403).json({ error: 'Invalid admin password.', code: 'admin_password_required' });
      return;
    }
  }

  if (!isAdminDbConfigured) {
    res.status(503).json({
      error: 'Admin database is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    });
    return;
  }

  (res.locals as any).admin = user;
  next();
}

// ---------------------------------------------------------------------------
// Invalidate cached access for a specific user (after admin changes)
// ---------------------------------------------------------------------------
export function invalidateAccessCache(uid: string): void {
  accessCache.delete(uid);
}
