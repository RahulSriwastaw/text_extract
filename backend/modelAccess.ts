/**
 * backend/modelAccess.ts — the admin's choice of models, stored in app_settings ('model_access').
 *
 * Read on every AI request, so it is cached for a minute per server instance.
 * No row (or no database) means the admin has not chosen yet: the built-in rule applies.
 */
import { adminDb } from './db.js';
import { sanitizeModelAccess, type ModelAccess } from '../services/modelAccess.js';

const KEY = 'model_access';
const CACHE_TTL_MS = 60_000;
let cached: { value: ModelAccess | null; at: number } = { value: null, at: 0 };

export async function getModelAccess(): Promise<ModelAccess | null> {
  const now = Date.now();
  if (now - cached.at < CACHE_TTL_MS) return cached.value;
  let value: ModelAccess | null = cached.value;       // on a read error keep the last known choice
  if (adminDb) {
    try {
      const { data, error } = await adminDb.from('app_settings').select('value').eq('key', KEY).maybeSingle();
      if (!error) value = sanitizeModelAccess(data?.value);
    } catch { /* keep the last known choice */ }
  } else value = null;
  cached = { value, at: now };
  return value;
}

/** Save the admin's choice, or pass null to go back to the built-in rule. */
export async function saveModelAccess(access: ModelAccess | null): Promise<void> {
  if (!adminDb) throw new Error('Admin database is not configured.');
  const { error } = access
    ? await adminDb.from('app_settings').upsert({ key: KEY, value: access })
    : await adminDb.from('app_settings').delete().eq('key', KEY);
  if (error) throw new Error(error.message);
  cached = { value: access, at: Date.now() };
}
