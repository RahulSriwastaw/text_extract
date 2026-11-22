/**
 * services/apiClient.ts — Authenticated API client for all /api calls.
 *
 * - Adds the Firebase ID token as Authorization: Bearer <token>.
 * - Retries once with a refreshed token on 401.
 * - Turns 403 `blocked` and 429 `daily_limit` into typed errors.
 * - Replace every raw `fetch('/api/...')` call with `apiFetch(...)`.
 */
import { auth } from './firebase';

// ---------------------------------------------------------------------------
// Typed API errors
// ---------------------------------------------------------------------------
export class ApiBlockedError extends Error {
  code = 'blocked' as const;
  reason: string;
  constructor(reason: string) {
    super(reason || 'Your account has been blocked.');
    this.name = 'ApiBlockedError';
    this.reason = reason;
  }
}

export class ApiLimitError extends Error {
  code = 'daily_limit' as const;
  limit: number;
  used: number;
  resetsAt: string;
  constructor(body: { limit?: number; used?: number; resetsAt?: string; error?: string }) {
    super(body.error || 'Daily limit reached.');
    this.name = 'ApiLimitError';
    this.limit = body.limit || 0;
    this.used = body.used || 0;
    this.resetsAt = body.resetsAt || '';
  }
}

/** No plan, expired plan, or plan tokens used up. */
export class ApiPlanError extends Error {
  code: 'no_plan' | 'plan_expired' | 'token_limit';
  constructor(body: { code: ApiPlanError['code']; error?: string }) {
    super(body.error || 'An active plan is required.');
    this.name = 'ApiPlanError';
    this.code = body.code;
  }
}

/**
 * Plan tokens shown in the UI are 1000x smaller than raw API tokens:
 * 1 plan token = 1,000 API tokens (a page costs roughly 8 plan tokens).
 * The database and the server keep counting raw API tokens.
 */
export const TOKEN_UNIT = 1000;
/** Raw API tokens → plan tokens, formatted (whole numbers; one decimal below 10). */
export function formatPlanTokens(raw: number): string {
  const n = (Number(raw) || 0) / TOKEN_UNIT;
  return n > 0 && n < 10 ? String(+n.toFixed(1)) : Math.round(n).toLocaleString();
}

/** Fired when the server refuses a request because of the plan, so the app can re-check /api/me. */
export const PLAN_CHANGED_EVENT = 'plan-status-changed';

// ---------------------------------------------------------------------------
// Token helper
// ---------------------------------------------------------------------------
async function getIdToken(forceRefresh = false): Promise<string> {
  const user = auth?.currentUser;
  if (!user) return '';
  try {
    return await user.getIdToken(forceRefresh);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// apiFetch — drop-in replacement for fetch('/api/...')
// ---------------------------------------------------------------------------
export async function apiFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = await getIdToken();

  const headers = new Headers(init.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response = await fetch(path, { ...init, headers });

  // Retry once with a refreshed token on 401
  if (response.status === 401 && token) {
    const refreshed = await getIdToken(true);
    if (refreshed && refreshed !== token) {
      headers.set('Authorization', `Bearer ${refreshed}`);
      response = await fetch(path, { ...init, headers });
    }
  }

  // Typed error handling
  if (response.status === 403 || response.status === 429) {
    try {
      const body = await response.clone().json();
      if (body.code === 'blocked') {
        throw new ApiBlockedError(body.reason || body.error || '');
      }
      if (body.code === 'daily_limit') {
        throw new ApiLimitError(body);
      }
      if (body.code === 'no_plan' || body.code === 'plan_expired' || body.code === 'token_limit') {
        window.dispatchEvent(new Event(PLAN_CHANGED_EVENT));
        throw new ApiPlanError(body);
      }
    } catch (err) {
      if (err instanceof ApiBlockedError || err instanceof ApiLimitError || err instanceof ApiPlanError) throw err;
      // If JSON parse failed, fall through to return the original response
    }
  }

  return response;
}

// ---------------------------------------------------------------------------
// Convenience: apiFetchJson — parse JSON response
// ---------------------------------------------------------------------------
export async function apiFetchJson<T = any>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json();
}
