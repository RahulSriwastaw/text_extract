/**
 * services/adminApi.ts — Typed admin API client.
 *
 * All calls go through apiFetch which adds the Firebase ID token.
 */
import { apiFetch, apiFetchJson } from './apiClient';

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
export const adminMe = () => apiFetchJson<AdminMe>('/api/admin/me');

export const fetchOverview = (range = 30) =>
  apiFetchJson<OverviewData>(`/api/admin/overview?range=${range}`);

export const fetchUsers = (params: { search?: string; status?: string; sort?: string; page?: number; pageSize?: number } = {}) => {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.status) q.set('status', params.status);
  if (params.sort) q.set('sort', params.sort);
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  return apiFetchJson<{ users: UserRow[]; total: number; page: number; pageSize: number }>(`/api/admin/users?${q}`);
};

export const fetchUserDetail = (uid: string) =>
  apiFetchJson<UserDetail>(`/api/admin/users/${encodeURIComponent(uid)}`);

export const patchUser = (uid: string, body: { status?: string; daily_limit?: number | null; blocked_reason?: string; note?: string }) =>
  apiFetch(`/api/admin/users/${encodeURIComponent(uid)}`, {
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
    return apiFetch(url).then(r => r.text());
  }
  return apiFetchJson<{ rows: any[]; from: string; to: string; groupBy: string }>(url);
};

export const fetchActivity = (params: { uid?: string; feature?: string; status?: string; cursor?: number; limit?: number } = {}) => {
  const q = new URLSearchParams();
  if (params.uid) q.set('uid', params.uid);
  if (params.feature) q.set('feature', params.feature);
  if (params.status) q.set('status', params.status);
  if (params.cursor) q.set('cursor', String(params.cursor));
  if (params.limit) q.set('limit', String(params.limit));
  return apiFetchJson<{ events: UsageEvent[]; nextCursor: number | null }>(`/api/admin/activity?${q}`);
};

export const fetchAudit = (cursor?: number) => {
  const q = cursor ? `?cursor=${cursor}` : '';
  return apiFetchJson<{ entries: AuditEntry[]; nextCursor: number | null }>(`/api/admin/audit${q}`);
};

export const fetchKeyStats = () =>
  apiFetchJson<{ keys: KeyStat[]; deadKeys: KeyStat[] }>('/api/admin/stats');

export const deactivateKey = (keyId: string) =>
  apiFetch('/api/admin/dead-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyId }),
  }).then(r => r.json());

export const resetKeyHealth = (keyId?: string) =>
  apiFetch('/api/admin/reset-key-health', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyId }),
  }).then(r => r.json());

export const fetchSettings = () =>
  apiFetchJson<Record<string, any>>('/api/admin/settings');

export const updateSettings = (body: { default_daily_limit?: number | null; retention_days?: number }) =>
  apiFetch('/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());

export const triggerPurge = () =>
  apiFetch('/api/admin/purge', { method: 'POST' }).then(r => r.json());
