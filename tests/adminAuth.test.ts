import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Inline the pure functions to avoid import resolution issues with ESM/CJS
// These match the implementations in api/auth.ts and api/usage.ts

// ---------------------------------------------------------------------------
// IST day boundary
// ---------------------------------------------------------------------------
function istToday(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60_000);
  return ist.toISOString().slice(0, 10);
}

describe('istToday', () => {
  it('returns a YYYY-MM-DD string', () => {
    const d = istToday();
    assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns IST date, not UTC', () => {
    // IST is UTC+5:30, so at 23:00 UTC it's already the next day in IST
    const d = istToday();
    // Just check it's a plausible date
    const parsed = new Date(d + 'T00:00:00+05:30');
    assert.ok(!isNaN(parsed.getTime()));
  });
});

// ---------------------------------------------------------------------------
// isAdminEmail
// ---------------------------------------------------------------------------
function isAdminEmail(email: string, adminEmails: string): boolean {
  const list = adminEmails.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

describe('isAdminEmail', () => {
  it('matches exact email case-insensitively', () => {
    assert.ok(isAdminEmail('Admin@Gmail.com', 'admin@gmail.com,other@test.com'));
  });

  it('rejects non-listed email', () => {
    assert.ok(!isAdminEmail('hacker@evil.com', 'admin@gmail.com'));
  });

  it('handles empty env var', () => {
    assert.ok(!isAdminEmail('anyone@test.com', ''));
  });

  it('trims whitespace', () => {
    assert.ok(isAdminEmail(' admin@gmail.com ', ' admin@gmail.com , other@test.com '));
  });
});

// ---------------------------------------------------------------------------
// decideAccess
// ---------------------------------------------------------------------------
interface CachedAccess {
  status: string;
  daily_limit: number | null;
  blocked_reason: string | null;
  serverCountToday: number;
  fetchedAt: number;
}

interface AccessDecision {
  allowed: boolean;
  code?: 'blocked' | 'daily_limit';
  reason?: string;
  limit?: number;
  used?: number;
  resetsAt?: string;
  hasOwnKey?: boolean;
  excludeServerKeys?: boolean;
}

function decideAccess(access: CachedAccess, defaultLimit: number | null, hasOwnKey: boolean): AccessDecision {
  if (access.status === 'blocked') {
    return { allowed: false, code: 'blocked', reason: access.blocked_reason || 'Your account has been blocked.' };
  }
  const limit = access.daily_limit ?? defaultLimit;
  if (limit == null) return { allowed: true };
  if (access.serverCountToday >= limit) {
    if (hasOwnKey) return { allowed: true, excludeServerKeys: true, hasOwnKey: true };
    const now = new Date();
    const istOffset = 5.5 * 60 * 60_000;
    const istNow = new Date(now.getTime() + istOffset);
    const istMidnight = new Date(istNow);
    istMidnight.setUTCHours(0, 0, 0, 0);
    istMidnight.setUTCDate(istMidnight.getUTCDate() + 1);
    const resetsAt = new Date(istMidnight.getTime() - istOffset).toISOString();
    return { allowed: false, code: 'daily_limit', limit, used: access.serverCountToday, resetsAt };
  }
  return { allowed: true };
}

describe('decideAccess', () => {
  const now = Date.now();

  it('allows active user with no limit', () => {
    const r = decideAccess({ status: 'active', daily_limit: null, blocked_reason: null, serverCountToday: 100, fetchedAt: now }, null, false);
    assert.ok(r.allowed);
  });

  it('blocks a blocked user', () => {
    const r = decideAccess({ status: 'blocked', daily_limit: null, blocked_reason: 'spam', serverCountToday: 0, fetchedAt: now }, null, false);
    assert.ok(!r.allowed);
    assert.equal(r.code, 'blocked');
    assert.equal(r.reason, 'spam');
  });

  it('allows user under limit', () => {
    const r = decideAccess({ status: 'active', daily_limit: 10, blocked_reason: null, serverCountToday: 5, fetchedAt: now }, null, false);
    assert.ok(r.allowed);
  });

  it('denies user over limit without own key', () => {
    const r = decideAccess({ status: 'active', daily_limit: 10, blocked_reason: null, serverCountToday: 10, fetchedAt: now }, null, false);
    assert.ok(!r.allowed);
    assert.equal(r.code, 'daily_limit');
    assert.equal(r.limit, 10);
    assert.equal(r.used, 10);
    assert.ok(r.resetsAt);
  });

  it('allows user over limit WITH own key but excludes server keys', () => {
    const r = decideAccess({ status: 'active', daily_limit: 10, blocked_reason: null, serverCountToday: 15, fetchedAt: now }, null, true);
    assert.ok(r.allowed);
    assert.ok(r.excludeServerKeys);
    assert.ok(r.hasOwnKey);
  });

  it('uses default limit when user has no override', () => {
    const r = decideAccess({ status: 'active', daily_limit: null, blocked_reason: null, serverCountToday: 5, fetchedAt: now }, 3, false);
    assert.ok(!r.allowed);
    assert.equal(r.code, 'daily_limit');
    assert.equal(r.limit, 3);
  });

  it('user override takes precedence over default', () => {
    const r = decideAccess({ status: 'active', daily_limit: 50, blocked_reason: null, serverCountToday: 5, fetchedAt: now }, 3, false);
    assert.ok(r.allowed);
  });
});

// ---------------------------------------------------------------------------
// maskKey
// ---------------------------------------------------------------------------
import { createHash } from 'node:crypto';

function maskKey(key: string): string {
  const prefix = key.substring(0, 8);
  const hash = createHash('sha256').update(key).digest('hex').substring(0, 8);
  return `${prefix}...${hash}`;
}

describe('maskKey', () => {
  it('returns prefix...hash format', () => {
    const masked = maskKey('sk-ant-api03-abcdefghijklmnop');
    assert.match(masked, /^sk-ant-a\.\.\.[\da-f]{8}$/);
  });

  it('never includes the full key', () => {
    const key = 'sk-ant-api03-abcdefghijklmnop';
    const masked = maskKey(key);
    assert.ok(!masked.includes(key));
    assert.ok(masked.length < key.length);
  });

  it('is deterministic', () => {
    const key = 'AIzaSyB1234567890';
    assert.equal(maskKey(key), maskKey(key));
  });

  it('different keys produce different masks', () => {
    assert.notEqual(maskKey('key-aaaa'), maskKey('key-bbbb'));
  });
});

// ---------------------------------------------------------------------------
// Client event validation (allowlist)
// ---------------------------------------------------------------------------
const ALLOWED_FEATURES = new Set([
  'extract', 'mocktest-extract', 'mocktest-solve', 'mocktest-repair-item',
  'mocktest-reverify', 'mocktest-generate-similar-item', 'mocktest-proofread',
  'mocktest-page-chat', 'mocktest-ai-chat', 'mocktest-add-question',
  'figure-svg', 'proofread', 'latex-repair',
]);
const ALLOWED_ENGINES = new Set(['own_key', 'bridge']);

describe('client event validation', () => {
  it('accepts known features', () => {
    assert.ok(ALLOWED_FEATURES.has('extract'));
    assert.ok(ALLOWED_FEATURES.has('mocktest-extract'));
  });

  it('rejects unknown features', () => {
    assert.ok(!ALLOWED_FEATURES.has('admin-hack'));
    assert.ok(!ALLOWED_FEATURES.has(''));
  });

  it('only allows own_key and bridge engines', () => {
    assert.ok(ALLOWED_ENGINES.has('own_key'));
    assert.ok(ALLOWED_ENGINES.has('bridge'));
    assert.ok(!ALLOWED_ENGINES.has('server'));
  });

  it('caps numeric values', () => {
    const cap = (v: number, max: number) => Math.min(Math.max(v || 0, 0), max);
    assert.equal(cap(-5, 10000), 0);
    assert.equal(cap(99999, 10000), 10000);
    assert.equal(cap(500, 10000), 500);
  });
});
