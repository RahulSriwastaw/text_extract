/**
 * api/usage.ts — Request-scoped usage tracking via AsyncLocalStorage.
 *
 * Flow:
 *   1. requireUser middleware runs → sets res.locals.user.
 *   2. The route handler calls AI functions that push token counts into the
 *      request context via `pushAICall`.
 *   3. On response finish, `flushUsage` fires via `waitUntil` (Vercel) or
 *      fire-and-forget, calling the Postgres `record_usage(event)` function.
 *   A logging failure never fails the user's request.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction } from 'express';
import { adminDb } from './db.js';
import type { VerifiedUser } from './auth.js';

// ---------------------------------------------------------------------------
// IST day boundary helper (exported for auth.ts too)
// ---------------------------------------------------------------------------
export function istToday(): string {
  const now = new Date();
  // IST = UTC + 5:30
  const ist = new Date(now.getTime() + 5.5 * 60 * 60_000);
  return ist.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ---------------------------------------------------------------------------
// Request context
// ---------------------------------------------------------------------------
export interface AICallRecord {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageContext {
  uid: string;
  feature: string;
  engine: 'server' | 'own_key' | 'bridge';
  pages: number;
  calls: AICallRecord[];
  startTime: number;
  status: 'ok' | 'error' | 'limited' | 'blocked';
  error?: string;
}

const store = new AsyncLocalStorage<UsageContext>();

// ---------------------------------------------------------------------------
// Public helpers called from AI functions
// ---------------------------------------------------------------------------

/** Push an AI call's token counts into the current request context. */
export function pushAICall(record: AICallRecord): void {
  const ctx = store.getStore();
  if (ctx) ctx.calls.push(record);
}

/** Mark the engine for the current request (server key vs own key). */
export function setEngine(engine: 'server' | 'own_key'): void {
  const ctx = store.getStore();
  if (ctx) ctx.engine = engine;
}

/** Mark pages processed in this request. */
export function setPages(pages: number): void {
  const ctx = store.getStore();
  if (ctx) ctx.pages = pages;
}

/** Mark error status for this request. */
export function setUsageError(message: string): void {
  const ctx = store.getStore();
  if (ctx) {
    ctx.status = 'error';
    ctx.error = (message || '').slice(0, 500);
  }
}

/** Get current context (for reading in runAIAction etc.). */
export function getUsageContext(): UsageContext | undefined {
  return store.getStore();
}

// ---------------------------------------------------------------------------
// Middleware: wrap the route handler in an AsyncLocalStorage context
// ---------------------------------------------------------------------------
export function usageMiddleware(feature: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user: VerifiedUser | undefined = (res.locals as any).user;
    const uid = user?.uid || 'anonymous';

    const ctx: UsageContext = {
      uid,
      feature,
      engine: 'server', // updated later by runAIAction if own key used
      pages: 0,
      calls: [],
      startTime: Date.now(),
      status: 'ok',
    };

    // On response finish, flush usage
    res.on('finish', () => {
      const duration = Date.now() - ctx.startTime;
      if (res.statusCode >= 400 && ctx.status === 'ok') {
        ctx.status = 'error';
      }
      flushUsage(ctx, duration).catch(err => {
        console.warn('[usage] flush failed:', err?.message || err);
      });
    });

    store.run(ctx, () => next());
  };
}

// ---------------------------------------------------------------------------
// Flush: record the usage event
// ---------------------------------------------------------------------------
async function flushUsage(ctx: UsageContext, durationMs: number): Promise<void> {
  if (!adminDb) return;
  if (!ctx.uid) return;
  // Don't record if no AI calls were made and status is ok (e.g. validation error before AI)
  if (ctx.calls.length === 0 && ctx.status === 'ok') return;

  const day = istToday();
  const totalInput = ctx.calls.reduce((s, c) => s + (c.inputTokens || 0), 0);
  const totalOutput = ctx.calls.reduce((s, c) => s + (c.outputTokens || 0), 0);
  const lastCall = ctx.calls[ctx.calls.length - 1];

  const event = {
    ts: new Date().toISOString(),
    day,
    uid: ctx.uid,
    feature: ctx.feature,
    engine: ctx.engine,
    provider: lastCall?.provider || null,
    model: lastCall?.model || null,
    pages: ctx.pages,
    input_tokens: totalInput,
    output_tokens: totalOutput,
    duration_ms: durationMs,
    status: ctx.status,
    error: ctx.error || null,
    source: 'server',
  };

  try {
    // Use waitUntil if available (Vercel Edge/Serverless)
    const waitUntil = (globalThis as any).__VERCEL_WAIT_UNTIL__;
    const promise = adminDb.rpc('record_usage', { event });
    if (typeof waitUntil === 'function') {
      waitUntil(promise);
    } else {
      await promise;
    }
  } catch (err) {
    console.warn('[usage] record_usage RPC failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Client-reported event helper (POST /api/usage/event)
// ---------------------------------------------------------------------------
const ALLOWED_FEATURES = new Set([
  'extract', 'mocktest-extract', 'mocktest-solve', 'mocktest-repair-item',
  'mocktest-reverify', 'mocktest-generate-similar-item', 'mocktest-proofread',
  'mocktest-page-chat', 'mocktest-ai-chat', 'mocktest-add-question',
  'figure-svg', 'proofread', 'latex-repair',
]);

const ALLOWED_ENGINES = new Set(['own_key', 'bridge']);

export async function recordClientEvent(uid: string, body: any): Promise<{ ok: boolean; error?: string }> {
  if (!adminDb) return { ok: false, error: 'Usage logging not configured.' };

  const feature = String(body.feature || '').slice(0, 100);
  const engine = String(body.engine || '');

  if (!ALLOWED_FEATURES.has(feature)) {
    return { ok: false, error: `Unknown feature: ${feature}` };
  }
  if (!ALLOWED_ENGINES.has(engine)) {
    return { ok: false, error: `Engine must be own_key or bridge.` };
  }

  const event = {
    ts: new Date().toISOString(),
    day: istToday(),
    uid,
    feature,
    engine,
    provider: String(body.provider || '').slice(0, 50) || null,
    model: String(body.model || '').slice(0, 100) || null,
    pages: Math.min(Math.max(Number(body.pages) || 0, 0), 10000),
    input_tokens: Math.min(Math.max(Number(body.input_tokens) || 0, 0), 10_000_000),
    output_tokens: Math.min(Math.max(Number(body.output_tokens) || 0, 0), 10_000_000),
    duration_ms: Math.min(Math.max(Number(body.duration_ms) || 0, 0), 3_600_000),
    status: 'ok',
    error: null,
    source: 'client',
  };

  try {
    await adminDb.rpc('record_usage', { event });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'DB error' };
  }
}
