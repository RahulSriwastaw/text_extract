/**
 * services/adminApi.ts — Typed admin API client.
 *
 * All calls go through apiFetch which adds the Firebase ID token.
 * Admin password is stored in sessionStorage and sent as X-Admin-Password header.
 */
import { apiFetch, apiFetchJson } from './apiClient';

// ---------------------------------------------------------------------------
// Admin password session management
// ---------------------------------------------------------------------------
const ADMIN_PASS_KEY = 'admin_password';

export function setAdminPassword(password: string) {
  sessionStorage.setItem(ADMIN_PASS_KEY, password);
}

export function getAdminPassword(): string {
  return sessionStorage.getItem(ADMIN_PASS_KEY) || '';
}

export function clearAdminPassword() {
  sessionStorage.removeItem(ADMIN_PASS_KEY);
}

/** Wraps apiFetch to include admin password header */
function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const pass = getAdminPassword();
  if (pass) headers.set('X-Admin-Password', pass);
  return apiFetch(path, { ...init, headers });
}

/** Wraps apiFetchJson to include admin password header */
async function adminFetchJson<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await adminFetch(path, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface AdminMe {
  uid: string;
  email: string;
  name: string;
  picture: string;
}

export interface OverviewKpis {
  totalUsers: number;
  newUsersWeek: number;
  activeToday: number;
  active7d: number;
  active30d: number;
  totalRequests: number;
  totalErrors: number;
  errorRate: number;
  totalPages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  blockedUsers: number;
}

export interface DaySeries {
  day: string;
  requests: number;
  errors: number;
  pages: number;
  input_tokens: number;
  output_tokens: number;
}

export interface FeatureSplit { feature: string; requests: number; }
export interface EngineSplit { engine: string; requests: number; }
export interface TopUser { uid: string; name: string; email: string; requests: number; }

export interface OverviewData {
  kpis: OverviewKpis;
  daySeries: DaySeries[];
  byFeature: FeatureSplit[];
  byEngine: EngineSplit[];
  topUsers: TopUser[];
}

export interface UserRow {
  uid: string;
  email: string;
  name: string;
  photo_url: string;
  first_seen_at: string;
  last_seen_at: string;
  status: string;
  daily_limit: number | null;
  usageToday: number;
  usage30d: number;
}

export interface UserDetail {
  user: any;
  access: any;
  daySeries: DaySeries[];
  featureSplit: FeatureSplit[];
  events: any[];
  savedWork: { historyCount: number; mocktestCount: number };
  audit: any[];
}

export interface UsageEvent {
  id: number;
  ts: string;
  uid: string;
  userName?: string;
  feature: string;
  engine: string;
  provider: string;
  model: string;
  pages: number;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  status: string;
  error: string | null;
  source: string;
}

export interface KeyStat {
  keyPrefix: string;
  keyId: string;
  totalSuccesses: number;
  totalErrors: number;
  consecutiveErrors: number;
  lastSuccessTime: number;
  lastErrorTime: number;
  cooldownUntil: number;
  inFlight: number;
  isDead: boolean;
  isDailyExhausted: boolean;
  cooldownRemainingSec: number;
  dailyCooldownRemainingSec: number;
}

export interface AuditEntry {
  id: number;
  ts: string;
  admin_uid: string;
  admin_email: string;
  action: string;
  target_uid: string;
  details: any;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------
export const adminMe = () => adminFetchJson<AdminMe>('/api/admin/me');

export const fetchOverview = (range = 30) =>
  adminFetchJson<OverviewData>(`/api/admin/overview?range=${range}`);

export const fetchUsers = (params: { search?: string; status?: string; sort?: string; page?: number; pageSize?: number } = {}) => {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.status) q.set('status', params.status);
  if (params.sort) q.set('sort', params.sort);
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  return adminFetchJson<{ users: UserRow[]; total: number; page: number; pageSize: number }>(`/api/admin/users?${q}`);
};

export const fetchUserDetail = (uid: string) =>
  adminFetchJson<UserDetail>(`/api/admin/users/${encodeURIComponent(uid)}`);

export const patchUser = (uid: string, body: { status?: string; daily_limit?: number | null; blocked_reason?: string; note?: string }) =>
  adminFetch(`/api/admin/users/${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());

export const fetchReports = (params: { from?: string; to?: string; groupBy?: string; format?: string } = {}) => {
  const q = new URLSearchParams();
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  if (params.groupBy) q.set('groupBy', params.groupBy);
  if (params.format) q.set('format', params.format);
  const url = `/api/admin/reports?${q}`;
  if (params.format === 'csv') {
    return adminFetch(url).then(r => r.text());
  }
  return adminFetchJson<{ rows: any[]; from: string; to: string; groupBy: string }>(url);
};

export const fetchActivity = (params: { uid?: string; feature?: string; status?: string; cursor?: number; limit?: number } = {}) => {
  const q = new URLSearchParams();
  if (params.uid) q.set('uid', params.uid);
  if (params.feature) q.set('feature', params.feature);
  if (params.status) q.set('status', params.status);
  if (params.cursor) q.set('cursor', String(params.cursor));
  if (params.limit) q.set('limit', String(params.limit));
  return adminFetchJson<{ events: UsageEvent[]; nextCursor: number | null }>(`/api/admin/activity?${q}`);
};

export const fetchAudit = (cursor?: number) => {
  const q = cursor ? `?cursor=${cursor}` : '';
  return adminFetchJson<{ entries: AuditEntry[]; nextCursor: number | null }>(`/api/admin/audit${q}`);
};

export const fetchKeyStats = () =>
  adminFetchJson<{ keys: KeyStat[]; deadKeys: KeyStat[] }>('/api/admin/stats');

export const deactivateKey = (keyId: string) =>
  adminFetch('/api/admin/dead-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyId }),
  }).then(r => r.json());

export const resetKeyHealth = (keyId?: string) =>
  adminFetch('/api/admin/reset-key-health', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyId }),
  }).then(r => r.json());

export const fetchSettings = () =>
  adminFetchJson<Record<string, any>>('/api/admin/settings');

export const updateSettings = (body: { default_daily_limit?: number | null; retention_days?: number }) =>
  adminFetch('/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());

export const triggerPurge = () =>
  adminFetch('/api/admin/purge', { method: 'POST' }).then(r => r.json());
