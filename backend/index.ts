import { registerQuestionBank, personalImages } from './questionBank.js';
import { registerDriveOAuth } from './driveOAuth.js';
import { registerAdminRoutes } from './adminRoutes.js';
import { saveQuestions } from './questionSheet.js';
import { uploadDriveFigure } from './driveFigures.js';
import { resolveClaudeModel } from './claudeModelSelection.js';
import { pageChatPrompt } from '../services/pageChat.js';
import { designChatPrompt, type DesignChatTurn } from '../services/designChat.js';
import { extractTemplateInstruction } from '../services/extractTemplates.js';
import type { ClaudeModel } from '../services/claudeModels.js';
import {
  MODEL_PROVIDERS, defaultModel, isCostlyModel, isModelAllowed, resolveAllowedModel, sanitizeModelAccess, visibleModels,
  type ModelAccess, type ModelProvider,
} from '../services/modelAccess.js';
import { getModelAccess, saveModelAccess } from './modelAccess.js';
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { NumberingStyle, OptionArrangement } from '../types.js';
import type { FigureMode } from '../types.js';
import { MCQ_PAGE_COVERAGE, MCQ_SHARED_CONTEXT, mcqFigureInstruction, CONTENT_FIGURE_INSTRUCTION, SVG_FIGURE_INSTRUCTION } from '../services/figurePrompt.js';
import fs from 'fs';
import path from 'path';
import { createHash } from 'node:crypto';
import {
  stripExamTagsAndJunk,
  cleanMocktestText,
  stripOptionLetterReferences,
  stripSolutionPrefix,
  prepareAiJsonString,
  safeParseAiJson,
  safeParseAiJsonObject,
  HTML_LATEX_FORMAT_RULES
} from '../services/textCleanService.js';
import {
  repairContentLatex,
  repairEntireMcqItem,
  validateAndExtractLatex
} from './latexRepair.js';
import { pushAICall, setEngine, getUsageContext, usageMiddleware, setPages, recordClientEvent } from './usage.js';
import { upsertAppUser, requireUser, requireAdmin, verifyUser, getDefaultDailyLimit, isAdminEmail, invalidateAccessCache, getPlansRequired, loadAccess, planDenial, getSupportWhatsapp } from './auth.js';
import type { VerifiedUser } from './auth.js';
import { adminDb, isAdminDbConfigured } from './db.js';

try {
  process.loadEnvFile();
} catch (e) {}

export const getClaudePrimaryModel = (): string => {
  return process.env.CLAUDE_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
};

export const getClaudeFallbackModel = (): string => {
  return process.env.CLAUDE_FALLBACK_MODEL || 'claude-haiku-5-5';
};

export const getPrimaryModel = (): string => {
  const claudeModel = process.env.CLAUDE_MODEL || process.env.ANTHROPIC_MODEL;
  if (claudeModel) return claudeModel;
  return 'claude-sonnet-5-5';
};

export const getFallbackModel = (): string => {
  const claudeFallback = process.env.CLAUDE_FALLBACK_MODEL;
  if (claudeFallback) return claudeFallback;
  return 'claude-haiku-5-5';
};

/** Mask a full API key to a safe id: prefix + short hash. Never expose full keys. */
export function maskKey(key: string): string {
  const prefix = key.substring(0, 8);
  const hash = createHash('sha256').update(key).digest('hex').substring(0, 8);
  return `${prefix}...${hash}`;
}

/** Find the full key by its masked id. */
function unmaskKey(maskedId: string, allKeys: string[]): string | undefined {
  return allKeys.find(k => maskKey(k) === maskedId);
}

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

/**
 * Personal API keys are switched off: everyone runs on the server keys and is
 * metered by their plan. Key headers from old clients are ignored.
 */
const PERSONAL_KEYS_ENABLED = false;
export const getUserKey = (_req: express.Request): string => '';

app.get('/api/config', (req, res) => {
  try {
    const { totalKeys } = getAIClient();
    res.json({
      totalKeys,
      model: getPrimaryModel(),
      fallbackModel: getFallbackModel(),
      provider: 'claude'
    });
  } catch (error) {
    res.json({
      totalKeys: 0,
      model: getPrimaryModel(),
      fallbackModel: getFallbackModel(),
      provider: 'claude'
    });
  }
});

app.post('/api/test-key', async (req, res) => {
  // Personal API keys are switched off (see getUserKey). Remove this line to allow them again.
  if (!PERSONAL_KEYS_ENABLED) return res.status(403).json({ success: false, message: 'Personal API keys are disabled. Usage runs on your plan.' });
  try {
    const { apiKey, provider = 'claude' } = req.body || {};
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 10) {
      return res.status(400).json({ success: false, message: 'Please enter a valid API key.' });
    }
    const cleanKey = apiKey.trim();

    if (provider === 'claude' || cleanKey.startsWith('sk-ant-')) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': cleanKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: process.env.CLAUDE_FALLBACK_MODEL || 'claude-haiku-5-5',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Respond with OK.' }]
        })
      });

      if (response.ok) {
        return res.json({ success: true, message: 'Claude API key verified successfully! Ready for extraction.', provider: 'claude' });
      }

      const errJson = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        success: false,
        message: errJson?.error?.message || `Claude API verification failed (HTTP ${response.status})`
      });
    } else {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: cleanKey });
      await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ text: 'Say OK' }]
      });
      return res.json({ success: true, message: 'API key verified successfully!' });
    }
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message || 'Verification failed' });
  }
});

// /api/debug-key removed — exposed full API keys (security fix)

let globalKeyRotationIndex = 0;

interface KeyHealthMetrics {
  lastErrorTime: number;
  lastSuccessTime: number;
  consecutiveErrors: number;
  totalErrors: number;
  totalSuccesses: number;
  cooldownUntil: number;
  errorType?: string;
  inFlight?: number;
}

const keyHealth = new Map<string, KeyHealthMetrics>();
const deadKeys = new Set<string>();
const dailyExhaustedKeys = new Map<string, number>();
const activeInFlightRequests = new Map<string, number>();

const FALLBACK_KEYS: string[] = [];

const getClaudeKeys = (userKeyInput?: string): string[] => {
  try {
    process.loadEnvFile();
  } catch(e) {}

  let primaryKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  let keysString = process.env.ANTHROPIC_API_KEYS || process.env.CLAUDE_API_KEYS || '';

  if (!primaryKey && !keysString) {
    const candidatePaths = [
      path.join(process.cwd(), '.env'),
      path.resolve('.env'),
      'h:/Rahul Sriwastaw/Tools/Code/text_extract/.env'
    ];
    for (const envPath of candidatePaths) {
      try {
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, 'utf8');
          content.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('ANTHROPIC_API_KEY=')) {
              primaryKey = trimmed.replace(/^ANTHROPIC_API_KEY=/, '').replace(/^["']|["']$/g, '');
            } else if (trimmed.startsWith('CLAUDE_API_KEY=')) {
              primaryKey = trimmed.replace(/^CLAUDE_API_KEY=/, '').replace(/^["']|["']$/g, '');
            } else if (trimmed.startsWith('ANTHROPIC_API_KEYS=')) {
              keysString = trimmed.replace(/^ANTHROPIC_API_KEYS=/, '').replace(/^["']|["']$/g, '');
            } else if (trimmed.startsWith('CLAUDE_API_KEYS=')) {
              keysString = trimmed.replace(/^CLAUDE_API_KEYS=/, '').replace(/^["']|["']$/g, '');
            }
          });
          if (keysString || primaryKey) break;
        }
      } catch (err) {}
    }
  }

  const serverKeys = (keysString || '')
    .split(/[,\n]+/)
    .map(k => k.trim().replace(/['"\s]/g, ''))
    .filter(k => k && k.length > 10);

  if (primaryKey && primaryKey.trim().length > 10) {
    const cleanPrimary = primaryKey.trim().replace(/['"\s]/g, '');
    if (!serverKeys.includes(cleanPrimary)) {
      serverKeys.unshift(cleanPrimary);
    }
  }

  const userKeys: string[] = [];
  if (userKeyInput && typeof userKeyInput === 'string') {
    const parsed = userKeyInput
      .split(/[,\n]+/)
      .map(k => k.trim().replace(/['"\s]/g, ''))
      .filter(k => k && k.length > 10);
    userKeys.push(...parsed);
  }

  const combined: string[] = [];
  for (const k of [...userKeys, ...serverKeys]) {
    if (!combined.includes(k) && !deadKeys.has(k)) {
      combined.push(k);
    }
  }

  return combined;
};

const getGeminiLegacyKeys = (userKeyInput?: string): string[] => {
  try {
    process.loadEnvFile();
  } catch(e) {}

  let primaryKey = process.env.GEMINI_API_KEY;
  let keysString = process.env.GEMINI_API_KEYS || '';

  if (!primaryKey && !keysString) {
    const candidatePaths = [
      path.join(process.cwd(), '.env'),
      path.resolve('.env'),
      'h:/Rahul Sriwastaw/Tools/Code/text_extract/.env'
    ];
    for (const envPath of candidatePaths) {
      try {
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, 'utf8');
          content.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('GEMINI_API_KEY=')) {
              primaryKey = trimmed.replace(/^GEMINI_API_KEY=/, '').replace(/^["']|["']$/g, '');
            }
            if (trimmed.startsWith('GEMINI_API_KEYS=')) {
              keysString = trimmed.replace(/^GEMINI_API_KEYS=/, '').replace(/^["']|["']$/g, '');
            }
          });
          if (keysString || primaryKey) break;
        }
      } catch (err) {}
    }
  }

  const serverKeys = (keysString || '')
    .split(/[,\n]+/)
    .map(k => k.trim().replace(/['"\s]/g, ''))
    .filter(k => k && k.length > 20);

  if (primaryKey && primaryKey.length > 20) {
    const cleanPrimary = primaryKey.trim().replace(/['"\s]/g, '');
    if (!serverKeys.includes(cleanPrimary)) {
      serverKeys.unshift(cleanPrimary);
    }
  }

  const userKeys: string[] = [];
  if (userKeyInput && typeof userKeyInput === 'string') {
    const parsed = userKeyInput
      .split(/[,\n]+/)
      .map(k => k.trim().replace(/['"\s]/g, ''))
      .filter(k => k && k.length > 20);
    userKeys.push(...parsed);
  }

  const combined: string[] = [];
  for (const k of [...userKeys, ...serverKeys, ...FALLBACK_KEYS]) {
    if (!combined.includes(k) && !deadKeys.has(k)) {
      combined.push(k);
    }
  }

  return combined;
};

export interface KeyPoolInfo {
  keys: string[];
  provider: 'claude' | 'gemini';
}

export const getActiveKeyPool = (userKeyInput?: string, requested?: KeyPoolInfo['provider']): KeyPoolInfo => {
  const keys = (userKeyInput || '').split(/[,\n]/).map(key => key.trim());
  const anthropic = keys.filter(key => key.startsWith('sk-ant-')).join(',');
  const google = keys.filter(key => /^(AIza|AQ\.)/.test(key)).join(',');
  if (requested === 'gemini') return { keys: getGeminiLegacyKeys(google), provider: 'gemini' };
  const claudeKeys = getClaudeKeys(anthropic);
  if (requested === 'claude' || claudeKeys.length) return { keys: claudeKeys, provider: 'claude' };
  return { keys: getGeminiLegacyKeys(google), provider: 'gemini' };
};

/**
 * Returns all active keys, combining user-provided keys with server-side keys.
 * userKeys take priority if provided.
 */
const getAllKeys = (userKeyInput?: string): string[] => {
  return getActiveKeyPool(userKeyInput).keys;
};

// ---------------------------------------------------------------------------
// Models: every model the server's API keys can reach, and which of them users may pick
// ---------------------------------------------------------------------------
interface CatalogModel { id: string; name: string; /** cannot do text extraction (audio, image-only…) */ disabled: boolean }
const catalogCache = new Map<ModelProvider, { at: number; models: CatalogModel[] }>();
const CATALOG_TTL_MS = 5 * 60_000;

/** The provider's full model list, read with the server's own keys. Cached for five minutes. */
async function fetchModelCatalog(provider: ModelProvider): Promise<{ models: CatalogModel[]; error?: string }> {
  const hit = catalogCache.get(provider);
  if (hit && Date.now() - hit.at < CATALOG_TTL_MS) return { models: hit.models };
  const { keys } = getActiveKeyPool('', provider);
  if (!keys.length) return { models: [], error: `No ${provider === 'gemini' ? 'Gemini' : 'Claude'} API key is configured on the server.` };
  const google = provider === 'gemini';
  for (const key of keys) {
    try {
      const url = new URL(google ? 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000' : 'https://api.anthropic.com/v1/models?limit=100');
      const headers: Record<string, string> = google ? { 'x-goog-api-key': key } : { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
      const models: CatalogModel[] = [];
      while (true) {
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
        if (!response.ok) {
          if ([401, 403, 429].includes(response.status)) break;          // try the next key
          return { models: [], error: 'The provider did not return its model list. Try again in a minute.' };
        }
        const page = await response.json();
        for (const m of google ? page.models : page.data) {
          const id = google ? m.name.replace(/^models\//, '') : m.id;
          const disabled = google && (!m.supportedGenerationMethods?.includes('generateContent') || /tts|native-audio|image-generation|image-preview|robotics|computer-use/i.test(id));
          models.push({ id, name: google ? m.displayName : m.display_name, disabled });
        }
        const token = google ? page.nextPageToken : page.has_more && page.last_id;
        const param = google ? 'pageToken' : 'after_id';
        if (!token || token === url.searchParams.get(param)) {
          catalogCache.set(provider, { at: Date.now(), models });
          return { models };
        }
        url.searchParams.set(param, token);
      }
    } catch { /* network error or timeout: try the next key */ }
  }
  return { models: [], error: 'Model list unavailable. Check the provider API key.' };
}

/** What a user may pick for one provider, and which model is preselected. */
async function userModels(provider: ModelProvider, access: ModelAccess | null) {
  const { models, error } = await fetchModelCatalog(provider);
  const visible = visibleModels(access, provider, models);
  const usable = visible.filter(m => !m.disabled);
  const serverDefault = provider === 'claude' ? getPrimaryModel() : process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const preferred = defaultModel(access, provider) || serverDefault;
  return { models: visible, error, default: usable.find(m => m.id === preferred)?.id || usable[0]?.id };
}

// The model picker: both providers, only the models the admin has switched on.
app.get('/api/models', async (_req, res) => {
  const access = await getModelAccess();
  const [claude, gemini] = await Promise.all([userModels('claude', access), userModels('gemini', access)]);
  if (claude.error && gemini.error) return res.status(503).json({ error: claude.error });
  res.set('Cache-Control', 'no-store').json({
    claude: claude.models, gemini: gemini.models,
    defaults: { claude: claude.default, gemini: gemini.default },
  });
});

// Older clients ask per provider.
app.get('/api/models/:provider', async (req, res) => {
  const provider = req.params.provider;
  if (provider !== 'claude' && provider !== 'gemini') return res.sendStatus(404);
  const { models, error } = await userModels(provider, await getModelAccess());
  if (error) return res.status(503).json({ error });
  res.set('Cache-Control', 'no-store').json({ models });
});

// Admin: every model with its on/off state.
app.get('/api/admin/models', requireAdmin, async (_req, res) => {
  const access = await getModelAccess();
  const providers = Object.fromEntries(await Promise.all(MODEL_PROVIDERS.map(async provider => {
    const { models, error } = await fetchModelCatalog(provider);
    return [provider, {
      error,
      default: (await userModels(provider, access)).default,       // what users are given today, also before the first save
      models: models.map(m => ({ id: m.id, name: m.name, unsupported: m.disabled, costly: isCostlyModel(m.id), enabled: isModelAllowed(access, provider, m.id) })),
    }];
  })));
  res.set('Cache-Control', 'no-store').json({ configured: !!access, providers });
});

// Admin: save which models users get. { reset: true } goes back to the built-in rule.
app.put('/api/admin/models', requireAdmin, async (req, res) => {
  try {
    const admin: VerifiedUser = (res.locals as any).admin;
    const access = req.body?.reset === true ? null : sanitizeModelAccess(req.body);
    if (req.body?.reset !== true) {
      if (!access) return res.status(400).json({ error: 'Send the list of active models.' });
      if (!access.claude.length && !access.gemini.length) return res.status(400).json({ error: 'Keep at least one model active, otherwise no AI feature can run.' });
    }
    await saveModelAccess(access);
    if (adminDb) {
      await adminDb.from('admin_audit').insert({
        admin_uid: admin.uid, admin_email: admin.email, action: access ? 'set_model_access' : 'reset_model_access', details: access,
      });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Could not save the model list.' });
  }
});

// ---------------------------------------------------------------------------
// Admin Auth — now uses Firebase Google login + ADMIN_EMAILS allowlist
// (checkAdminAuth and /api/admin/login removed — replaced by requireAdmin from api/auth.ts)
// ---------------------------------------------------------------------------

registerDriveOAuth(app, requireAdmin);

// GET /api/admin/me — confirms admin access
app.get('/api/admin/me', requireAdmin, (req, res) => {
  const admin: VerifiedUser = (res.locals as any).admin;
  res.json({ uid: admin.uid, email: admin.email, name: admin.name, picture: admin.picture });
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const allKeys = getAllKeys();
  const now = Date.now();
  const stats = allKeys.map(k => {
    const health = keyHealth.get(k) || { 
      lastErrorTime: 0, 
      lastSuccessTime: 0, 
      consecutiveErrors: 0, 
      totalErrors: 0, 
      totalSuccesses: 0,
      cooldownUntil: 0
    };
    const dailyCooldownUntil = dailyExhaustedKeys.get(k) || 0;
    return {
      keyPrefix: k.substring(0, 8) + '...',
      keyId: maskKey(k),
      ...health,
      inFlight: activeInFlightRequests.get(k) || 0,
      isDead: deadKeys.has(k),
      isDailyExhausted: dailyCooldownUntil > now,
      dailyCooldownRemainingSec: Math.max(0, Math.round((dailyCooldownUntil - now) / 1000)),
      cooldownRemainingSec: Math.max(0, Math.round((health.cooldownUntil - now) / 1000))
    };
  });
  
  const deadStats = Array.from(deadKeys).map(k => {
    const health = keyHealth.get(k) || { lastErrorTime: 0, lastSuccessTime: 0, consecutiveErrors: 0, totalErrors: 0, totalSuccesses: 0, cooldownUntil: 0 };
    return {
      keyPrefix: k.substring(0, 8) + '...',
      keyId: maskKey(k),
      ...health,
      inFlight: activeInFlightRequests.get(k) || 0,
      isDead: true,
      isDailyExhausted: false,
      dailyCooldownRemainingSec: 0,
      cooldownRemainingSec: 0
    };
  });

  res.json({ keys: stats, deadKeys: deadStats });
});

app.post('/api/admin/dead-key', requireAdmin, (req, res) => {
  const { keyId } = req.body;
  const allKeys = getAllKeys();
  const realKey = unmaskKey(keyId, allKeys);
  if (realKey) {
    deadKeys.add(realKey);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: "Key not found" });
  }
});

app.post('/api/admin/reset-key-health', requireAdmin, (req, res) => {
  const { keyId } = req.body;
  if (keyId) {
    const allKeys = getAllKeys();
    const realKey = unmaskKey(keyId, allKeys);
    if (realKey) {
      deadKeys.delete(realKey);
      dailyExhaustedKeys.delete(realKey);
      keyHealth.delete(realKey);
      activeInFlightRequests.delete(realKey);
    } else {
      return res.status(400).json({ error: "Key not found" });
    }
  } else {
    deadKeys.clear();
    dailyExhaustedKeys.clear();
    keyHealth.clear();
    activeInFlightRequests.clear();
  }
  res.json({ success: true, message: "Key health and rotation states reset successfully." });
});

// Register all new admin read/write endpoints
registerAdminRoutes(app);

/**
 * Intelligent Concurrency-Aware API Key Selector with Instant Failover.
 * - Supports Claude (Anthropic) as primary engine and Google GenAI as fallback.
 * - Prioritizes completely idle keys (activeInFlightRequests === 0) for true parallel execution.
 * - Excludes keys currently in deadKeys, dailyExhaustedKeys, or temporary cooldown.
 * - Distributes load smoothly across all healthy keys in the pool without bottle-necking.
 */
export const getAIClient = (skipKeys: Set<string> | string[] = [], userKeyInput?: string, requested?: KeyPoolInfo['provider']) => {
  const { keys: allKeys, provider } = getActiveKeyPool(userKeyInput, requested);
  const now = Date.now();
  const skipSet = skipKeys instanceof Set ? skipKeys : new Set(skipKeys);

  if (allKeys.length === 0) {
    throw new Error(`No active ${provider} API keys are configured.`);
  }

  const total = allKeys.length;

  const isHealthyKey = (k: string) => {
    if (deadKeys.has(k)) return false;
    const dailyCd = dailyExhaustedKeys.get(k) || 0;
    if (dailyCd > now) return false;
    const health = keyHealth.get(k);
    if (health && health.cooldownUntil > now) return false;
    return true;
  };

  const untriedHealthy = allKeys.filter(k => !skipSet.has(k) && isHealthyKey(k));
  const candidatePool = untriedHealthy.length > 0 ? untriedHealthy : allKeys.filter(k => isHealthyKey(k));

  if (candidatePool.length > 0) {
    candidatePool.sort((a, b) => {
      const activeA = activeInFlightRequests.get(a) || 0;
      const activeB = activeInFlightRequests.get(b) || 0;
      if (activeA !== activeB) return activeA - activeB;

      const errA = keyHealth.get(a)?.consecutiveErrors || 0;
      const errB = keyHealth.get(b)?.consecutiveErrors || 0;
      if (errA !== errB) return errA - errB;

      const idxA = allKeys.indexOf(a);
      const idxB = allKeys.indexOf(b);
      const distA = (idxA - globalKeyRotationIndex + total) % total;
      const distB = (idxB - globalKeyRotationIndex + total) % total;
      return distA - distB;
    });

    const selectedKey = candidatePool[0];
    const selIdx = allKeys.indexOf(selectedKey);
    globalKeyRotationIndex = (selIdx + 1) % total;

    return {
      provider,
      client: provider === 'claude'
        ? { provider: 'claude', apiKey: selectedKey }
        : new GoogleGenAI({ apiKey: selectedKey }),
      key: selectedKey,
      keyIndex: selIdx + 1,
      totalKeys: total,
      waitNeededMs: 0
    };
  }

  const eligibleTemporary = allKeys.filter(k => !deadKeys.has(k) && (dailyExhaustedKeys.get(k) || 0) <= now);

  if (eligibleTemporary.length === 0) {
    throw new Error(`All ${total} API keys have reached momentary rate limit or are unavailable. Please add fresh keys in Settings.`);
  }

  eligibleTemporary.sort((a, b) => {
    const cdA = keyHealth.get(a)?.cooldownUntil || 0;
    const cdB = keyHealth.get(b)?.cooldownUntil || 0;
    return cdA - cdB;
  });

  const selectedKey = eligibleTemporary[0];
  const earliestCd = keyHealth.get(selectedKey)?.cooldownUntil || 0;
  const waitNeededMs = Math.max(0, earliestCd - now);
  const selIdx = allKeys.indexOf(selectedKey);
  globalKeyRotationIndex = (selIdx + 1) % total;

  return {
    provider,
    client: provider === 'claude'
      ? { provider: 'claude', apiKey: selectedKey }
      : new GoogleGenAI({ apiKey: selectedKey }),
    key: selectedKey,
    keyIndex: selIdx + 1,
    totalKeys: total,
    waitNeededMs
  };
};

const getGeminiClient = getAIClient;

const reportKeySuccess = (key: string) => {
  const health = keyHealth.get(key) || { 
    lastErrorTime: 0, 
    lastSuccessTime: 0, 
    consecutiveErrors: 0, 
    totalErrors: 0, 
    totalSuccesses: 0,
    cooldownUntil: 0
  };
  health.lastSuccessTime = Date.now();
  health.consecutiveErrors = 0;
  health.cooldownUntil = 0; // Clear cooldown immediately on success
  health.totalSuccesses++;
  keyHealth.set(key, health);
};

const reportKeyError = (key: string, error: any) => {
  const now = Date.now();
  const errorStr = (error?.message || String(error)).toUpperCase();
  const keyPrefix = key.substring(0, 8) + '...' + key.slice(-4);

  // 1. Permanent Key Invalidation - ONLY genuinely invalid/deleted keys
  const isInvalid = errorStr.includes("API KEY NOT VALID") || 
                    errorStr.includes("API_KEY_INVALID") ||
                    errorStr.includes("CONSUMER HAS BEEN SUSPENDED") ||
                    errorStr.includes("PROJECT HAS BEEN DELETED") ||
                    errorStr.includes("ACCOUNT_DEACTIVATED");

  if (isInvalid) {
    deadKeys.add(key);
    console.error(`[API-Rotate] Key ${keyPrefix} marked as PERMANENTLY DEAD (Invalid/Deleted)`);
    return { type: 'DEAD', isDaily: false };
  }

  // 2. Daily Quota Exhaustion vs temporary rate limits
  const hasShortRetry = errorStr.includes("RETRY IN") || errorStr.includes("RETRYDELAY") || errorStr.includes("RETRYINFO");
  const isDailyLimit = !hasShortRetry && (
                       errorStr.includes("GENERATE_CONTENT_FREE_TIER_REQUESTS_PER_DAY") ||
                       (errorStr.includes("PERDAY") && errorStr.includes("RESOURCE_EXHAUSTED")) || 
                       (errorStr.includes("PER_DAY") && errorStr.includes("RESOURCE_EXHAUSTED")));

  if (isDailyLimit) {
    // Quarantine key for 5 minutes before re-checking
    const quarantineDurationMs = 5 * 60 * 1000;
    dailyExhaustedKeys.set(key, now + quarantineDurationMs);
    console.warn(`[API-Rotate] Key ${keyPrefix} reached daily limit. Quarantined for 5m. Switching to next key.`);
    return { type: 'DAILY_EXHAUSTED', isDaily: true };
  }

  // 3. Temporary Rate Limits (RPM: 15 req/min) or Server Overload
  const health = keyHealth.get(key) || { 
    lastErrorTime: 0, 
    lastSuccessTime: 0, 
    consecutiveErrors: 0, 
    totalErrors: 0, 
    totalSuccesses: 0,
    cooldownUntil: 0
  };
  health.lastErrorTime = now;
  health.consecutiveErrors++;
  health.totalErrors++;

  const isRateLimit = errorStr.includes("429") || 
                      errorStr.includes("RESOURCE_EXHAUSTED") || 
                      errorStr.includes("QUOTA");
  const isOverload = errorStr.includes("503") || 
                     errorStr.includes("500") || 
                     errorStr.includes("UNAVAILABLE") ||
                     errorStr.includes("FETCH FAILED") ||
                     errorStr.includes("ECONNRESET") ||
                     errorStr.includes("ETIMEDOUT");

  // Fast 15-second cooldown for RPM limits to clear the rolling 1-min window while other keys work
  let cooldownMs = 15000;
  if (isOverload) {
    cooldownMs = 4000;
  } else if (!isRateLimit) {
    cooldownMs = 2000;
  }

  health.cooldownUntil = now + cooldownMs;
  health.errorType = isRateLimit ? 'RATE_LIMIT' : (isOverload ? 'OVERLOAD' : 'TRANSIENT');
  keyHealth.set(key, health);

  console.warn(`[API-Rotate] Key ${keyPrefix} paused (${health.errorType}) for ${Math.round(cooldownMs / 1000)}s. Switching to next healthy key immediately.`);
  return { type: health.errorType, isDaily: false };
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function runAIAction(
  action: (client: any) => Promise<any>, 
  userKeyInput?: string,
  maxRetries?: number, requested?: KeyPoolInfo['provider']
) {
  const pool = getActiveKeyPool(userKeyInput, requested);
  const allKeys = pool.keys;
  const effectiveRetries = maxRetries ?? Math.max(12, allKeys.length * 2);
  const triedKeys = new Set<string>();
  let lastError: any = null;

  // Build a set of server-only keys (without user keys) for engine detection
  const serverOnlyKeys = new Set(getActiveKeyPool('', requested).keys);

  for (let attempt = 0; attempt <= effectiveRetries; attempt++) {
    // If all keys have been tried in this request sequence, clear to allow subsequent attempt
    if (triedKeys.size >= allKeys.length && allKeys.length > 0) {
      triedKeys.clear();
    }

    let clientInfo: ReturnType<typeof getGeminiClient>;
    try {
      clientInfo = getGeminiClient(triedKeys, userKeyInput, requested);
    } catch (e: any) {
      throw e;
    }

    const { client, key, keyIndex, totalKeys, waitNeededMs } = clientInfo;
    triedKeys.add(key);

    const keyPrefix = key.substring(0, 8) + '...' + key.slice(-4);

    // If all keys are temporarily cooling down, wait for the earliest one
    if (waitNeededMs > 0) {
      const waitSec = Math.ceil(waitNeededMs / 1000);
      console.log(`[API-Rotate] All healthy keys cooling down. Waiting ${waitSec}s for key [${keyIndex}/${totalKeys}] ${keyPrefix}...`);
      await delay(Math.min(waitNeededMs, 4000));
    }

    // Register active in-flight request for load balancing
    activeInFlightRequests.set(key, (activeInFlightRequests.get(key) || 0) + 1);

    try {
      const result = await action(client);
      reportKeySuccess(key);
      // Track whether the successful key was a server key or user's own key
      setEngine(serverOnlyKeys.has(key) ? 'server' : 'own_key');
      return result;
    } catch (error: any) {
      lastError = error;
      const errorStr = (error?.message || String(error)).toUpperCase();
      const { type } = reportKeyError(key, error);

      const isRetryable = type === 'DEAD' || 
                          type === 'DAILY_EXHAUSTED' || 
                          type === 'RATE_LIMIT' || 
                          type === 'OVERLOAD' ||
                          errorStr.includes("429") ||
                          errorStr.includes("RESOURCE_EXHAUSTED") ||
                          errorStr.includes("QUOTA") ||
                          errorStr.includes("EMPTY RESPONSE") || 
                          errorStr.includes("FAILED TO PARSE") ||
                          errorStr.includes("JSON") ||
                          errorStr.includes("SAFETY") ||
                          errorStr.includes("BLOCKED") ||
                          errorStr.includes("CANDIDATES") ||
                          errorStr.includes("MAX_TOKENS") ||
                          errorStr.includes("MODEL OUTPUT") ||
                          errorStr.includes("OUTPUT TEXT") ||
                          errorStr.includes("TOOL CALLS") ||
                          errorStr.includes("FINISH_REASON") ||
                          errorStr.includes("RECITATION") ||
                          errorStr.includes("OTHER");

      if (isRetryable && attempt < effectiveRetries) {
        console.warn(`[API-Rotate] Key [${keyIndex}/${totalKeys}] ${keyPrefix} FAILED (${error?.message || errorStr}). Instantly switching to next healthy API key...`);
        // Instant failover: no sleep needed because we have multiple healthy keys in pool!
        continue;
      }

      throw error;
    } finally {
      const current = activeInFlightRequests.get(key) || 1;
      if (current <= 1) {
        activeInFlightRequests.delete(key);
      } else {
        activeInFlightRequests.set(key, current - 1);
      }
    }
  }

  const finalError = new Error(`Exhausted attempts across all ${allKeys.length} available Gemini API keys. Last error: ${lastError?.message || "Service unavailable"}.`);
  (finalError as any).status = 429;
  throw finalError;
}

/**
 * Safely extracts the text from a Gemini generateContent response.
 * Returns empty string if response has no content.
 */
const safeExtractResponseText = (response: any): string => {
  if (response?.text && String(response.text).trim()) return String(response.text);
  if (response?.candidates?.[0]?.content?.parts) {
    const text = response.candidates[0].content.parts.map((p: any) => p.text || '').join('');
    if (text.trim()) return text;
  }
  return '';
};

/**
 * Invokes Anthropic Claude Messages API directly with vision & text payloads.
 */
function readInlineImage(input: string, declaredType = 'image/png') {
  const match = /^data:(image\/[\w.+-]+);base64,/i.exec(input.trim());
  const data = input.trim().slice(match?.[0].length ?? 0);
  const header = Buffer.from(data.slice(0, 16), 'base64');
  let mimeType = match?.[1].toLowerCase() || declaredType;
  if (header.subarray(0, 3).toString('hex') === 'ffd8ff') mimeType = 'image/jpeg';
  else if (header.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') mimeType = 'image/png';
  else if (['GIF87a', 'GIF89a'].includes(header.toString('ascii', 0, 6))) mimeType = 'image/gif';
  else if (header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP') mimeType = 'image/webp';
  return { data, mimeType: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType };
}

export async function callClaudeMessagesApi(
  apiKey: string,
  model: string,
  contents: any[] | string,
  config: Record<string, any> = {},
  label = 'Claude AI call'
): Promise<string> {
  const rawList = typeof contents === 'string' ? [{ text: contents }] : contents;
  const contentParts: any[] = [];

  for (const item of rawList) {
    if (typeof item === 'string') {
      contentParts.push({ type: 'text', text: item });
    } else if (item?.text) {
      contentParts.push({ type: 'text', text: item.text });
    } else if (item?.inlineData) {
      const { data: cleanData, mimeType: mime } = readInlineImage(String(item.inlineData.data || ''), item.inlineData.mimeType);
      if (cleanData) {
        contentParts.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mime,
            data: cleanData
          }
        });
      }
    }
  }

  let systemText = config.systemInstruction;
  if (config.responseMimeType === 'application/json' && !systemText) {
    systemText = 'You are a highly precise document extraction engine. You MUST output ONLY valid JSON without markdown fences (no ```json ... ```) and no explanations.';
  }

  const payload: Record<string, any> = {
    model,
    max_tokens: config.maxOutputTokens || 8192,
    messages: [
      {
        role: 'user',
        content: contentParts
      }
    ]
  };

  if (systemText) {
    payload.system = typeof systemText === 'string' ? systemText : JSON.stringify(systemText);
  }

  // Newer Claude models deprecate the temperature parameter
  if (config.temperature !== undefined && !model.includes('-5') && !model.includes('sonnet-5') && !model.includes('haiku-5')) {
    payload.temperature = config.temperature;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: config.abortSignal,
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorJson = await response.json().catch(() => ({}));
    const errorMessage = errorJson?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
    const err: any = new Error(`[${label}] Claude error: ${errorMessage}`);
    err.status = response.status;
    err.errorType = errorJson?.error?.type;
    throw err;
  }

  const data = await response.json();

  // Capture token counts for usage tracking
  pushAICall({
    provider: 'claude',
    model,
    inputTokens: data?.usage?.input_tokens || 0,
    outputTokens: data?.usage?.output_tokens || 0,
  });

  const text = (data.content || [])
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text || '')
    .join('');

  return text;
}

/**
 * Universal AI model invocation with instant failover on rate limits.
 * Automatically delegates to Claude Messages API (primary) or Google Gemini API.
 */
export const callAIWithFallback = async (
  client: any,
  primaryModel: string = getPrimaryModel(),
  fallbackModel: string = getFallbackModel(),
  contents: any[] | string,
  config: Record<string, any> = {},
  label = 'AI call'
): Promise<string> => {
  // Check if client is a Claude client
  const isClaude = client?.provider === 'claude' || client?.apiKey?.startsWith('sk-ant-') || (client?.apiKey && !client?.models);

  if (isClaude) {
    const claudeKey = client?.apiKey || client?.key || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '';
    // Only models the admin has switched on may run. Anything else (an old client, a saved
    // setting, a made-up id) is replaced by the default active model.
    const selected = typeof config.claudeModel === 'string' ? config.claudeModel : '';
    const requestedId = !selected ? undefined
      : /^anthropic:claude-[a-z0-9.-]+$/.test(selected) ? selected.slice(10)
      : await resolveClaudeModel(selected as ClaudeModel, claudeKey, config.abortSignal).catch(() => 'unknown-model');
    const access = await getModelAccess();
    const choice = resolveAllowedModel(access, 'claude', requestedId);
    if (choice.blocked) throw new Error('No Claude model is switched on. Choose another AI model.');
    const serverChain = [
      primaryModel || getPrimaryModel(),
      fallbackModel || getFallbackModel(),
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001'
    ];
    // The chosen model goes first. The rest are only reached when it does not exist or is
    // unavailable (see the loop below): the admin's other active models, cheaper families
    // first, or the server's own list while the admin has not chosen yet.
    const spare = access
      ? access.claude.filter(m => m !== choice.model).sort((a, b) => Number(isCostlyModel(a)) - Number(isCostlyModel(b))).slice(0, 3)
      : serverChain;
    const modelsToTry = (choice.model ? [choice.model, ...spare] : serverChain).filter((m, i, arr) => m && arr.indexOf(m) === i);

    let lastErr: any = null;
    for (const modelToUse of modelsToTry) {
      try {
        const text = await callClaudeMessagesApi(claudeKey, modelToUse, contents, config, label);
        if (text && text.trim()) {
          return text;
        }
        throw new Error(`[${label}] Claude model ${modelToUse} returned empty output.`);
      } catch (err: any) {
        lastErr = err;
        const errStr = (err?.message || String(err)).toUpperCase();
        if (errStr.includes('429') || errStr.includes('RATE_LIMIT') || errStr.includes('OVERLOADED') || errStr.includes('529')) {
          throw err;
        }
        if (
          errStr.includes('404') ||
          errStr.includes('NOT_FOUND') ||
          errStr.includes('MODEL') ||
          errStr.includes('UNAVAILABLE') ||
          errStr.includes('EMPTY OUTPUT')
        ) {
          console.warn(`[${label}] Claude model ${modelToUse} failed (${err?.message?.slice(0, 100)}). Trying fallback model...`);
          continue;
        }
        throw err;
      }
    }
    throw lastErr || new Error(`[${label}] All Claude models returned empty output.`);
  }

  if (config.claudeModel) throw new Error('The selected Claude model requires an Anthropic API key.');
  // Google Gemini Fallback
  const { geminiModel: requestedGemini, claudeModel: ignoredClaude, ...generationConfig } = config;
  if (requestedGemini && !/^[a-zA-Z0-9._-]+$/.test(requestedGemini)) throw new Error('Invalid Gemini model ID.');
  // Same rule as for Claude: only a model the admin has switched on may run.
  const geminiChoice = resolveAllowedModel(await getModelAccess(), 'gemini', requestedGemini || undefined);
  if (geminiChoice.blocked) throw new Error('No Gemini model is switched on. Choose another AI model.');
  const geminiModel = geminiChoice.model;
  const modelsToTry = geminiModel ? [geminiModel] : [
    process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash',
    'gemini-flash-latest'
  ].filter((m, i, arr) => m && arr.indexOf(m) === i);

  const effectiveConfig = geminiModel ? generationConfig : { ...generationConfig, thinkingConfig: config.thinkingConfig ?? { thinkingBudget: 0 } };

  const effectiveContents = typeof contents === 'string' ? [{ text: contents }] : contents;

  let lastErr: any = null;
  for (const modelToUse of modelsToTry) {
    try {
      const response = await client.models.generateContent({
        model: modelToUse,
        contents: effectiveContents,
        config: effectiveConfig
      });

      // Capture Gemini token counts for usage tracking
      const usageMeta = response?.usageMetadata;
      pushAICall({
        provider: 'gemini',
        model: modelToUse,
        inputTokens: usageMeta?.promptTokenCount || 0,
        outputTokens: usageMeta?.candidatesTokenCount || usageMeta?.totalTokenCount || 0,
      });

      const text = safeExtractResponseText(response);
      if (text) {
        return text;
      }
      throw new Error(`[${label}] Model ${modelToUse} returned empty output.`);
    } catch (err: any) {
      lastErr = err;
      const errStr = (err?.message || String(err)).toUpperCase();

      if (errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED') || errStr.includes('QUOTA')) {
        throw err;
      }

      if (
        errStr.includes('404') ||
        errStr.includes('503') ||
        errStr.includes('UNAVAILABLE') ||
        errStr.includes('EMPTY OUTPUT')
      ) {
        console.warn(`[${label}] Model ${modelToUse} failed (${err?.message?.slice(0, 100)}). Trying fallback model...`);
        continue;
      }
      throw err;
    }
  }

  throw lastErr || new Error(`[${label}] All models returned empty output.`);
};

export const callGeminiWithFallback = callAIWithFallback;

const cleanBilingualDuplicates = (text: string): string => {
  if (!text) return text;

  // 1. Question level identical text: 'Question: 1. What is X? / What is X?' -> 'Question: 1. What is X?'
  let cleaned = text.replace(/^(\s*(?:(?:Question|Q)\.?\s*[:\-]?\s*\d+\.?|#\d+\.?|\d+\.)\s*)([^\n/]+?)\s*\/\s*([^\n/]+)$/gm, (match, prefix, left, right) => {
    const lNorm = left.trim();
    const rNorm = right.trim();
    if (lNorm.toLowerCase() === rNorm.toLowerCase()) {
      return prefix + lNorm;
    }
    return match;
  });

  // 2. Format single line bilingual questions into two lines WITHOUT slash (ONLY FOR QUESTIONS)
  // A bilingual question separator '/' must separate a Hindi question from an English question!
  // It MUST NOT match inside units like 'm/s', 'km/h', or formulas like '1/2', 'a/b'!
  cleaned = cleaned.replace(/^(\s*(?:(?:Question|Q)\.?\s*[:\-]?\s*\d+[\.\)\-:]?|#\d+[\.\)\-:]?|\d+[\.\)\-:]?)\s+[^\n]+?)\s+(?:\/|\|)\s+([A-Za-z][^\n]+)$/gm, (match, hindiPart, engPart) => {
    // If the slash is inside $...$ or $$...$$, DO NOT split!
    const dollarsBefore = (hindiPart.match(/\$/g) || []).length;
    if (dollarsBefore % 2 !== 0) return match;

    const cleanHindi = hindiPart.trim();
    const cleanEng = engPart.trim();
    
    const hasHindi = /[\u0900-\u097F]/.test(cleanHindi);
    const engHindiCharCount = (cleanEng.match(/[\u0900-\u097F]/g) || []).length;
    const engLatinCharCount = (cleanEng.match(/[a-zA-Z]/g) || []).length;

    // cleanEng must be an actual English question (more Latin letters than Devanagari letters)
    if (hasHindi && engLatinCharCount > 5 && engLatinCharCount > engHindiCharCount) {
      return cleanHindi + '\n' + cleanEng;
    }
    return match;
  });

  // 3. Ensure bilingual options stay on ONE single line with ' / ' (e.g. '(b) सम / Even')
  cleaned = cleaned.replace(/^(\s*\([a-eA-E]\)\s+[^\n/]+?)\r?\n\s*([a-zA-Z][^\n]+)$/gm, (match, optHindi, optEng) => {
    return optHindi.trim() + ' / ' + optEng.trim();
  });

  // 4. Option level duplicates: e.g. '(a) 123 / 123' -> '(a) 123', '(b) 45.5% / 45.5%' -> '(b) 45.5%'
  cleaned = cleaned.replace(/^(\s*(?:\([a-zA-Z0-9]+\)|[a-zA-Z0-9]+[\.\)])\s*)([^\n/]+?)\s*\/\s*([^\n/]+)$/gm, (match, prefix, left, right) => {
    const lNorm = left.trim();
    const rNorm = right.trim();
    if (lNorm.toLowerCase() === rNorm.toLowerCase() || lNorm.replace(/\s+/g, '').toLowerCase() === rNorm.replace(/\s+/g, '').toLowerCase()) {
      return prefix + lNorm;
    }
    return match;
  });

  // 5. Clean standalone numbers/formulas/symbols/units duplicated with / e.g. '123 / 123', '$$x=2$$ / $$x=2$$'
  // (Only replace if left and right are identical, never touching m/s or km/h)
  cleaned = cleaned.replace(/([^\n/]+?)\s*\/\s*([^\n/]+)/g, (match, left, right) => {
    const lTrim = left.trim();
    const rTrim = right.trim();
    if (lTrim && rTrim && lTrim.toLowerCase() === rTrim.toLowerCase()) {
      return lTrim;
    }
    return match;
  });

  return cleaned;
};

const MATH_WORDS = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'cosec',
  'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
  'log', 'ln', 'lg', 'lim', 'det', 'exp', 'max', 'min',
  'pi', 'theta', 'alpha', 'beta', 'gamma', 'delta', 'lambda', 'sigma', 'omega', 'phi',
  'frac', 'sqrt', 'times', 'div', 'pm', 'cdot', 'text', 'mathrm', 'overline', 'underline',
  'cm', 'm', 'mm', 'km', 'kg', 'g', 'deg'
]);

function findMathStartIndex(str: string): number {
  const prefixMatch = str.match(/^(\s*(?:\*\*)?(?:Question|Q\.?|Prashn|प्रश्न)?\s*[:\-]?\s*#?\s*\(?\d+\)?[\.\)\-:]\s*(?:\*\*)?\s*)/i);
  const minPrefixIdx = (prefixMatch && prefixMatch[0].length > 0) ? prefixMatch[0].length : 0;

  let idx = str.length;

  while (idx > minPrefixIdx && /\s/.test(str[idx - 1])) {
    idx--;
  }

  while (idx > minPrefixIdx) {
    const prevChar = str[idx - 1];

    if (/[\d\s\+\-\*\/\=\(\)\[\]\{\}\\\^\_\.\,\u00D7\u00F7\u03C0\u03B8\u00B0]/.test(prevChar)) {
      if (prevChar === '.' && idx - 1 <= minPrefixIdx) {
        break;
      }
      idx--;
      continue;
    }

    if (/[a-zA-Z]/.test(prevChar)) {
      let wordStart = idx - 1;
      while (wordStart > minPrefixIdx && /[a-zA-Z]/.test(str[wordStart - 1])) {
        wordStart--;
      }
      const word = str.substring(wordStart, idx).toLowerCase();

      const isSingleLetterVar = word.length === 1;
      const isMathWord = MATH_WORDS.has(word);
      const isTrigCombo = /^(sin|cos|tan|sec|csc|cot|cosec)[a-z]$/i.test(word);

      if (isSingleLetterVar || isMathWord || isTrigCombo) {
        idx = wordStart;
        continue;
      } else {
        break;
      }
    }

    break;
  }

  if (idx < minPrefixIdx) {
    idx = minPrefixIdx;
  }

  while (idx < str.length && /\s/.test(str[idx])) {
    idx++;
  }

  return idx;
}

export function fixDanglingMathOnLine(line: string): string {
  if (!line) return line;

  let s = line;

  // Separate Hindi/Devanagari characters glued to $ or $$
  s = s.replace(/([\u0900-\u097F])(\$+)/g, '$1 $2');
  s = s.replace(/(\$+)([\u0900-\u097F])/g, '$1 $2');

  // Fix broken units across spaces e.g. "m s$" -> "m/s$", "m / s$" -> "m/s$"
  s = s.replace(/\bm\s*\/?\s*s(\$+)/g, 'm/s$1');
  s = s.replace(/\bm\s*\/?\s*s\b/g, 'm/s');

  // 1. Fix squashed math + units + $$:
  // e.g. "$$\frac{16\pi}{3}$$ cm^2$$" -> "$$\frac{16\pi}{3}\text{ cm}^2$$"
  s = s.replace(/\$\$([^\$]+)\$\$\s*(?:\\text\{)?\s*(cm|m|mm|km|km\/h|kg|g)\b(\^[0-9]+)?\}?\s*\$\$/g, (_m, math, unit, exp) => {
    const expStr = exp ? exp : '';
    return `$$${math.trim()}\\text{ ${unit}}${expStr}$$`;
  });

  // Also fix: "$$\frac{16\pi}{3}$$ cm^2" (without trailing $$) when cm^2 was left outside math
  s = s.replace(/\$\$([^\$]+)\$\$\s*(cm\^2|m\^2|cm\^3|m\^3)\b/g, (_m, math, unit) => {
    return `$$${math.trim()}\\text{ ${unit}}$$`;
  });

  // 2. Normalize single-dollar $...$ to $$...$$
  s = s.replace(/(?<!\$)\$(?!\$)([^\$\n]+?)(?<!\$)\$(?!\$)/g, (_m, p1) => `$$${p1}$$`);

  // 3. Normalize multiple consecutive dollars
  s = s.replace(/\${3,}/g, '$$');

  // 4. Check for dangling closing $$ without opening $$
  let result = '';
  let inMath = false;
  let i = 0;

  while (i < s.length) {
    if (s.startsWith('$$', i)) {
      if (inMath) {
        inMath = false;
        result += '$$';
        i += 2;
      } else {
        const remaining = s.substring(i + 2);
        const hasClosingLater = remaining.includes('$$');

        if (hasClosingLater) {
          inMath = true;
          result += '$$';
          i += 2;
        } else {
          // Unmatched dangling closing $$! Scan backwards to find where the math started
          const startIdx = findMathStartIndex(result);
          if (startIdx < result.length) {
            const beforeMath = result.substring(0, startIdx);
            const mathPart = result.substring(startIdx);
            result = beforeMath + '$$' + mathPart + '$$';
          } else {
            result += '$$';
          }
          i += 2;
        }
      }
    } else {
      result += s[i];
      i++;
    }
  }

  if (inMath) {
    result += '$$';
  }

  // 5. Clean & format all $$...$$ expressions
  result = result.replace(/\$\$([\s\S]*?)\$\$/g, (_m, mathBody) => {
    let mb = mathBody;

    // Convert Unicode math operators
    mb = mb.replace(/×/g, ' \\times ')
           .replace(/÷/g, ' \\div ')
           .replace(/°/g, '^\\circ ')
           .replace(/·/g, ' \\cdot ');

    // Normalize bare trig & math function names without backslash
    mb = mb.replace(/(?<!\\)\b(sin|cos|tan|sec|csc|cot|cosec|log|ln|lim)\s*([a-zA-Z0-9\(\[\{])/g, '\\$1 $2');
    mb = mb.replace(/(?<!\\)\b(sin|cos|tan|sec|csc|cot|cosec|log|ln|lim)\b(?![a-zA-Z])/g, '\\$1');
    mb = mb.replace(/(?<![a-zA-Z\\])(sin|cos|tan|sec|csc|cot|cosec)([A-Z])/g, '\\$1 $2');

    mb = mb.replace(/\s+/g, ' ').trim();
    return `$$${mb}$$`;
  });

  return result;
}

const cleanMixedMathText = (text: string): string => {
  if (!text) return text;

  // 1. Fix $\text{Hindi\nEnglish} math$ or $\text{...}$ spanning lines
  let cleaned = text.replace(/\$+\s*\\text\{([\s\S]*?)\}\s*([\s\S]*?)\$+/g, (_m, textContent, mathContent) => {
    const trimmedMath = mathContent.trim();
    if (trimmedMath) {
      return `${textContent.trim()} $$${trimmedMath}$$`;
    }
    return textContent.trim();
  });

  // 2. Fix broken $\text{... across lines e.g.
  cleaned = cleaned.replace(/\$+\s*\\text\{([^\n\}]+)\n\s*([^\}:]+)\s*:\s*\}\s*([^\$]+)\$+/g, (_m, hindi, eng, math) => {
    return `${hindi.trim()}\n${eng.trim()}: $$${math.trim()}$$`;
  });

  // 3. Fix standalone \text{...} only if it contains full non-math sentences (Devanagari or long phrases)
  cleaned = cleaned.replace(/\\text\{([^\}]+)\}/g, (match, inner) => {
    // Keep measurement units like \text{ cm}, \text{m}, etc.
    if (/^\s*(cm|m|mm|km|kg|g|s|h|sec|min|km\/h|degree|deg)\b/i.test(inner)) {
      return match;
    }
    // Remove if it's Hindi or long natural language
    if (/[\u0900-\u097F]/.test(inner) || inner.length > 20) {
      return inner;
    }
    return match;
  });

  return cleaned;
};

const wrapLatexExpressions = (text: string): string => {
  if (!text) return text;

  // 0. Unwrap any mixed \text inside $
  let s = cleanMixedMathText(text);

  // 1. Repair double backslashes, control characters & keywords
  s = s
    .replace(/\\\\+(frac|sqrt|times|beta|rho|neq|alpha|theta|overline|underline|pm|div|cdot|left|right|sum|int|pi|infty|circ|deg|text|mathbf|mathrm|ge|le|approx|quad|to|sim|partial|Delta|lambda|mu|sigma|omega|phi|sin|cos|tan|sec|csc|cot|log|ln|lim|binom)/g, '\\$1')
    .replace(/[\x0c\f]rac/g, '\\frac')
    .replace(/[\x08\b]eta/g, '\\beta')
    .replace(/(^|[^\\a-zA-Z])rac\{/g, '$1\\frac{')
    .replace(/(^|[^\\a-zA-Z])sqrt\{/g, '$1\\sqrt{')
    .replace(/(^|[^\\a-zA-Z])overline\{/g, '$1\\overline{')
    .replace(/(^|[^\\a-zA-Z])times(\s|\d|\$)/g, '$1\\times$2')
    .replace(/(^|[^\\a-zA-Z])frac(\d{2})(\d{2})/g, '$1\\frac{$2}{$3}')
    .replace(/(^|[^\\a-zA-Z])frac(\d)(\d{2})/g, '$1\\frac{$2}{$3}')
    .replace(/(^|[^\\a-zA-Z])frac(\d)(\d)(?!\d)/g, '$1\\frac{$2}{$3}')
    .replace(/\${3,}/g, '$$')
    .replace(/([\u0900-\u097F])(\$+)(?!\$)/g, '$1 $2')
    .replace(/(\$+)([\u0900-\u097F])/g, '$1 $2')
    .replace(/\bm\s*\n\s*\/?\s*s(\$+)/g, 'm/s$1')
    .replace(/\bm\s*\n\s*\/?\s*s\b/g, 'm/s');

  // Fix dangling dollars & normalize on every line
  const fixedLines = s.split('\n').map(fixDanglingMathOnLine);
  s = fixedLines.join('\n');

  const lines = s.split('\n');
  const resultLines = lines.map(line => {
    // Split line by existing $$...$$ blocks
    const parts = line.split(/(\$\$[\s\S]*?\$\$)/g);

    const processedParts = parts.map((part) => {
      // If part is already a math block, keep it as is
      if (part.startsWith('$$') && part.endsWith('$$')) {
        return part;
      }

      // Check if part contains unwrapped LaTeX commands
      if (!part.includes('\\')) {
        return part;
      }

      // Find and wrap all LaTeX expressions in this text segment
      let segment = part;
      let result = '';
      
      while (segment.length > 0) {
        const match = segment.match(/\\(frac|binom|sqrt|overline|underline|times|div|pm|cdot|alpha|beta|theta|sum|int|pi|sin|cos|tan|sec|csc|cot|cosec|arcsin|arccos|arctan|sinh|cosh|tanh|log|ln|lim|circ|deg|degree|infty|neq|le|ge|approx)/);
        if (!match || match.index === undefined) {
          result += segment;
          break;
        }

        const cmd = match[1];
        const latexIdx = match.index;
        const requiredBraceGroups = ['frac', 'binom'].includes(cmd) ? 2 : (['sqrt', 'overline', 'underline'].includes(cmd) ? 1 : 0);

        // Move backwards to capture math prefix (e.g. "4 - ")
        let startIdx = latexIdx;
        while (startIdx > 0) {
          const prevChar = segment[startIdx - 1];
          if (/[\d\s\+\-\*\/\=\(\)\.\^\_]/.test(prevChar)) {
            const prefixSoFar = segment.substring(0, startIdx);
            if (/^\s*(?:#?(?:Question|Q)\.?\s*[:\-]?\s*|\bPrashn\s*|\bप्रश्न\s*)?\d+[\.\)\-:]?\s*$/i.test(prefixSoFar) ||
                /(?:is|are|of|than|value|and|तथा|से|का|मान|है|कौन|बड़ा|छोटा|ज्ञात|सरल|कीजिए)\s*$/i.test(prefixSoFar) ||
                /^\s*\([a-eA-E]\)\s*$/.test(prefixSoFar)) {
              break;
            }
            startIdx--;
          } else {
            break;
          }
        }

        // Move forwards to balance braces
        let endIdx = latexIdx + 1 + cmd.length;
        if (requiredBraceGroups > 0) {
          let completedGroups = 0;
          let braceDepth = 0;
          let foundFirstBrace = false;

          for (let i = latexIdx; i < segment.length; i++) {
            const char = segment[i];
            if (char === '{') {
              braceDepth++;
              foundFirstBrace = true;
            } else if (char === '}') {
              braceDepth--;
              if (braceDepth === 0 && foundFirstBrace) {
                completedGroups++;
                if (completedGroups === requiredBraceGroups) {
                  endIdx = i + 1;
                  break;
                }
              }
            }
          }
        }

        // Capture any trailing units or exponents (e.g. \text{ cm}^2, cm^2, ^2)
        const trailingSegment = segment.substring(endIdx);
        const unitMatch = trailingSegment.match(/^\s*(?:\\text\{\s*(?:cm|m|mm|km|kg|g)\b\}|\b(?:cm|m|mm|km|kg|g)\b)?(?:\^[0-9]+)?/);
        if (unitMatch && unitMatch[0].trim().length > 0) {
          endIdx += unitMatch[0].length;
        }

        const beforeMath = segment.substring(0, startIdx);
        const mathExpr = segment.substring(startIdx, endIdx).trim();
        result += beforeMath + `$$${mathExpr}$$`;
        segment = segment.substring(endIdx);
      }

      return result;
    });

    return processedParts.join('');
  });

  return resultLines.join('\n');
};

const formatMcqText = (text: string): string => {
  if (!text) return text;
  text = formatChemicalReactions(text);
  
  // 0. Pre-process: Join multi-line math formulas spanning across newlines:
  let preProcessed = text
    .replace(/\$\$([\s\S]*?)\$\$/g, (_m, body) => '$$' + body.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim() + '$$')
    .replace(/(?<!\$)\$([^\$\n]*?)\n\s*([^\$\n]*?)\$(?!\$)/g, (_m, p1, p2) => '$' + (p1 + ' ' + p2).replace(/\s+/g, ' ').trim() + '$');
  
  // Fix broken units across lines e.g. "m\ns$" -> "m/s$"
  preProcessed = preProcessed.replace(/\bm\s*\n\s*\/?\s*s(\$+)/g, 'm/s$1');
  preProcessed = preProcessed.replace(/\bm\s*\n\s*\/?\s*s\b/g, 'm/s');
  preProcessed = preProcessed.replace(/(\b[0-9a-zA-Z\^\_]+)\s*\n\s*\/?\s*(s|sec|hr|h|min|m|cm|mm|kg|g)\b(\$+)/g, '$1 $2$3');

  // Join wrapped question lines of the same language
  const rawLines = preProcessed.split('\n');
  const mergedLines: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line) {
      mergedLines.push('');
      continue;
    }
    if (mergedLines.length === 0) {
      mergedLines.push(line);
      continue;
    }
    const prevLine = mergedLines[mergedLines.length - 1].trim();
    const isPrevQuestion = /^#\s/i.test(prevLine) || /^(?:(?:Question|Q\.?|Prashn|प्रश्न)?\s*[:\-]?\s*#?\s*\(?\d+\)?[\.\)\-:]\s*)/i.test(prevLine);
    const isCurrOption = /^(\([a-eA-E0-9]\)|[a-eA-E0-9][\.\)]|[A-E][\.\)])\s/.test(line);
    const isCurrAnswer = /^(?:Answer|Ans)\s*[:\-]/i.test(line);
    const isCurrNewQuestion = /^#\s/i.test(line) || /^(?:(?:Question|Q\.?|Prashn|प्रश्न)\s*[:\-]?\s*#?\s*\(?\d+\)?[\.\)\-:]\s*)/i.test(line);
    const isCurrHeader = /^(Section|Part|Khand|Unit|Paper|Note|Instruction)\b/i.test(line);

    if (isPrevQuestion && !isCurrOption && !isCurrAnswer && !isCurrNewQuestion && !isCurrHeader) {
      const prevHasHindi = /[\u0900-\u097F]/.test(prevLine);
      const currHasHindi = /[\u0900-\u097F]/.test(line);
      const currIsEnglishOnly = !currHasHindi && /[a-zA-Z]{3,}/.test(line);

      if (prevHasHindi && currIsEnglishOnly && !prevLine.includes('\n')) {
        mergedLines.push(line);
      } else {
        mergedLines[mergedLines.length - 1] = prevLine + ' ' + line;
      }
    } else {
      mergedLines.push(line);
    }
  }

  let res = mergedLines.map(fixDanglingMathOnLine).join('\n');
  res = wrapLatexExpressions(res);

  // 2. Separate squashed Answer from options e.g. '(D) $$\frac{31}{40}$$ / Answer: D' -> '(d) $$\frac{31}{40}$$\nAnswer: D'
  res = res.replace(/([^\n]+?)\s*\/+\s*(Answer\s*[:\-]\s*[a-eA-E])/gi, '$1\n$2');
  res = res.replace(/([^\n])\s+(Answer\s*[:\-]\s*[a-eA-E])/gi, '$1\n$2');
  res = res.replace(/([^\n])\s+(\([a-eA-E]\)\s+)/g, '$1\n$2');
  res = res.replace(/([^\n])\s+(#?(?:Question|Q)\.?\s*[:\-]?\s*\d+[\.\)\-:]?\s+)/gi, '$1\n\n$2');

  // 3. Normalize option labels to lowercase (a), (b), (c), (d)
  res = res.replace(/^(\s*)\(([A-E])\)(\s+)/gm, (_m, p1, p2, p3) => `${p1}(${p2.toLowerCase()})${p3}`);

  // 4. Fix unclosed / broken $$ across lines:
  res = res.replace(/(Question\s*[:\-]?\s*\d+[\.\)\-:]?)\s*\$\$\s*\n\s*([^\n\$]+)/g, (_m, qPrefix, mathBody) => {
    const cleanMath = mathBody.replace(/\$\$$/, '').trim();
    return `${qPrefix}\n$$${cleanMath}$$`;
  });

  // 5. Run fixDanglingMathOnLine on final lines
  res = res.split('\n').map(fixDanglingMathOnLine).join('\n');

  return res;
};

const SUB_MAP: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉'
};

export function formatChemicalReactions(text: string): string {
  if (!text) return text;
  let res = text;
  
  // 1. Format \xrightarrow[below]{above} or \xrightarrow{above}
  res = res.replace(/\\?xrightarrow\s*(?:\[([^\]]*)\])?\s*\{([^\}]*)\}/gi, (_m, below, above) => {
    const cleanAbove = (above || '').replace(/\\text\{([^\}]+)\}/g, '$1').replace(/[\{\}]/g, '').trim();
    const cleanBelow = (below || '').replace(/\\text\{([^\}]+)\}/g, '$1').replace(/[\{\}]/g, '').trim();
    const label = cleanBelow ? `${cleanAbove} / ${cleanBelow}` : cleanAbove;
    return label ? ` ⎯⎯(${label})⎯→ ` : ` → `;
  });

  // 2. Heal malformed xrightarrow without braces e.g. "xrightarrowताप", "xrightarrowHeat", "xrightarrowसूर्य का प्रकाश"
  res = res.replace(/\\?xrightarrow\s*([a-zA-Z\u0900-\u097F\s]+?)(?=\s+[A-Z0-9\+\-]|s*$)/g, (_m, label) => {
    const cleanLabel = label.trim();
    return cleanLabel ? ` ⎯⎯(${cleanLabel})⎯→ ` : ` → `;
  });

  // 3. For chemical equations with subscripts like CaCO_3(s), FeSO_4(aq), convert to Unicode subscripts
  res = res.replace(/([A-Za-z\)])(_[0-9]+|_\{[0-9]+\})/g, (_m, elem, sub) => {
    const digits = sub.replace(/[_{}]/g, '');
    const unicodeSub = digits.split('').map(d => SUB_MAP[d] || d).join('');
    return elem + unicodeSub;
  });

  return res;
}

const cleanRefinedText = (text: string): string => {
  text = formatChemicalReactions(text);
  if (!text) return text;
  
  let res = text;

  const examKeywords = [
    'SSC\\s*(?:CGL|CHSL|MTS|CPO|GD|JE)?',
    'CGL', 'CHSL', 'MTS', 'CPO', 'GD',
    'RRB\\s*(?:NTPC|ALP|JE|Group\\s*D)?',
    'NTPC', 'ALP', 'Group\\s*D',
    'UPSC\\s*(?:CSE|IAS|IPS|NDA|CDS|CAPF)?',
    'BPSC', 'UPPSC', 'MPPSC', 'HSSC', 'RAS', 'RPSC', 'UKPSC', 'JPSC', 'CGPSC',
    'IBPS\\s*(?:PO|Clerk)?', 'SBI\\s*(?:PO|Clerk)?',
    'CTET', 'TET', 'REET', 'HTET', 'UPTET', 'NET', 'JRF', 'CSIR', 'GATE',
    'Tier\\s*[-–—]?\\s*(?:I|II|III|IV|1|2|3|4)',
    'Shift\\s*[-–—]?\\s*(?:I|II|III|IV|1|2|3|4)',
    'CBE', 'CBSE', 'NTA',
    'प्रथम\\s*पाली', 'द्वितीय\\s*पाली', 'तृतीय\\s*पाली', 'पाली',
    'परीक्?षा', 'स्मृति\\s*पर\\s*आधारित', 'Memory\\s*Based'
  ];

  const examPattern = `(?:${examKeywords.join('|')})`;
  const examRegex = new RegExp(`(?<![\\p{L}\\p{M}\\\\])${examPattern}(?![\\p{L}\\p{M}])`, 'iu');

  const lines = res.split('\n');
  const cleanedLines: string[] = [];

  for (let line of lines) {
    let trimmed = line.trim();
    if (!trimmed) {
      cleanedLines.push('');
      continue;
    }

    // 1. If entire line is an exam tag, skip it
    if (examRegex.test(trimmed)) {
      const isQuestion = /^#?(?:Question|Q)\.?\s*[:\-]?\s*\d+/i.test(trimmed);
      const isOption = /^(\([a-eA-E0-9]\)|[a-eA-E0-9][\.\)])\s+/i.test(trimmed);

      if (!isQuestion && !isOption) {
        continue;
      }
    }

    // 2. If line is an option, strip trailing exam tag
    if (examRegex.test(trimmed)) {
      const slashTagMatch = trimmed.match(/\s*\/+\s*[\(\[](.*)$/);
      if (slashTagMatch && examRegex.test(slashTagMatch[1])) {
        trimmed = trimmed.substring(0, slashTagMatch.index).trim();
      } else {
        const parenTagMatch = trimmed.match(/\s+[\(\[](.*)$/);
        if (parenTagMatch && examRegex.test(parenTagMatch[1])) {
          trimmed = trimmed.substring(0, parenTagMatch.index).trim();
        }
      }
    }

    // 3. Skip header/footer junk
    if (/^(?:Page\s*\d+|\d+\s*\|\s*Page|Chapter\s*\d+|www\.[a-z0-9\.\-_]+|t\.me\/[a-z0-9\-_]+|Telegram\s*:|Join\s*Telegram)/i.test(trimmed)) {
      continue;
    }

    cleanedLines.push(trimmed);
  }

  return cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const extractLayoutWithRetry = async (
  base64Image: string,
  ocrText: string,
  numberingStyle: NumberingStyle,
  includeImages: boolean,
  isBilingual: boolean,
  mcqMode: boolean,
  refineMode: boolean = false,
  showAnswers: boolean = true,
  userKey?: string,
  showMcqNumbers: boolean = true,
  autoProofread: boolean = false,
  optionArrangement: OptionArrangement = OptionArrangement.VERTICAL,
  signal?: AbortSignal,
  figureMode: FigureMode = 'crop',
  claudeModel?: ClaudeModel, geminiModel?: string,
  /** Output template id (services/extractTemplates.ts); unknown ids and 'none' add nothing. */
  extractTemplate?: unknown
): Promise<any> => {
  const inlineImage = readInlineImage(base64Image);
  const templateInstruction = extractTemplateInstruction(extractTemplate);

  // 1. Question Numbering Feature Connection
  let numberingInstruction = '';
  if (!showMcqNumbers) {
    numberingInstruction = 'DO NOT prefix questions with question numbers. Omit or remove numbers (e.g. remove #1., Q1., 1.). Output only the clean question stem directly.';
  } else {
    switch (numberingStyle) {
      case NumberingStyle.Q_DOT:
        numberingInstruction = 'Format each question prefix with "Q" followed by the number and a dot (e.g., "Q1.", "Q23.").';
        break;
      case NumberingStyle.HASH:
        numberingInstruction = 'Format each question prefix with "#" followed by the number and a dot (e.g., "#1.", "#23.").';
        break;
      case NumberingStyle.QUESTION_DOT:
        numberingInstruction = 'Format each question prefix with the word "Question" followed by the number and a dot (e.g., "Question 1.", "Question 23.").';
        break;
      case NumberingStyle.NUMBER_DOT:
        numberingInstruction = 'Format each question prefix with just the number followed by a dot (e.g., "1.", "23."). Remove prefixes like "Q." or "Q".';
        break;
      default:
        numberingInstruction = 'Format each question prefix with the number followed by a dot (e.g. "1.", "2.").';
    }
  }

  // 2. Answers Feature Connection
  const answerInstruction = showAnswers
    ? `**ANSWER EXTRACTION ENABLED**:
- Identify the correct answer from the paper or deduce it, and add "Answer: [Correct Option Letter]" (e.g., "Answer: C") on its own new line immediately after the options.`
    : `**STRICT NO-ANSWER RULE (ANSWERS DISABLED)**:
- DO NOT extract, deduce, guess, or output any answers or answer keys under any circumstances!
- For each question, end immediately after the last option.`;

  // 3. Bilingual Mode Feature Connection
  const bilingualInstruction = isBilingual
    ? `**MANDATORY BILINGUAL TRANSLATION (HINDI + ENGLISH)**:
- YOU MUST OUTPUT EVERY QUESTION, HEADING, PARAGRAPH, AND TEXTUAL OPTION IN BOTH HINDI AND ENGLISH.
- **AUTOMATIC TRANSLATION**:
  - If the source image contains text in HINDI ONLY, translate the text into ENGLISH and provide both!
  - If the source image contains text in ENGLISH ONLY, translate the text into HINDI and provide both!
  - If both languages are already on the page, combine and preserve both faithfully.
- **TWO-LINE FORMAT (FOR QUESTIONS & PARAGRAPHS)**:
  Line 1: Hindi Text (NO forward slash / at the end)
  Line 2: English Text
- **OPTIONS FORMAT**: Each option on its OWN line:
  (a) [Hindi Option] / [English Option]
  (b) [Hindi Option] / [English Option]
- **STRICT RULE FOR NUMBERS & FORMULAS (DO NOT DUPLICATE)**:
  - If an option is a pure number, percentage, unit, or math formula (e.g. "0", "1", "45%", "$$x=2$$", "km/h"), write it ONLY ONCE without slash (e.g. "(a) 0", "(b) 45%").
- **LANGUAGE TEST EXCEPTION**: English Language / Grammar tests stay 100% English; Hindi Language / व्याकरण tests stay 100% Hindi.`
    : `**CRITICAL RULE: STRICT SOURCE LANGUAGE (NO TRANSLATION)**:
- Extract the text EXACTLY in the language it is written on the page.
- If it is in Hindi, output ONLY Hindi. If it is in English, output ONLY English.
- DO NOT translate anything.`;

  // 4. Images & Diagrams Feature Connection
  const imageInstruction = includeImages 
    ? `2. **Diagrams & Figures (KEEP IMAGES ENABLED)**:
   - Identify diagrams, charts, circuit diagrams, geometry figures, maps, and non-text visual elements, and place them in the 'elements' array exactly where they appear in the reading order.
   - For 'image' types, provide a concise but descriptive 'content' field explaining what the diagram shows (e.g., "Circuit diagram with resistors R1 and R2", "Geometry figure showing a triangle inside a circle").`
    : `2. **Diagrams & Figures**:
   - **DO NOT EXTRACT DIAGRAMS OR IMAGES**: Ignore all non-textual content such as diagrams, charts, and figures. Do not create any 'image' elements.`;

  const imageFormattingInstruction = includeImages
    ? `2. **Image Elements**:
   - Identify regions containing diagrams, charts, pattern series, geometry figures, or any non-textual content.
   - Provide the bounding box (bbox) for these regions in normalized coordinates [0-1000] ([ymin, xmin, ymax, xmax]).`
    : `2. **Image Elements**:
   - **STRICTLY IGNORE**: Do not extract any image elements.`;

  // 5. Option Arrangement Feature Connection
  let optArrangementInstruction = 'For multiple-choice options, ensure each option (a), (b), (c), (d) is on a separate line.';
  if (optionArrangement === OptionArrangement.HORIZONTAL) {
    optArrangementInstruction = 'Format all options horizontally inline on a single line separated by clean spacing: (a) ...   (b) ...   (c) ...   (d) ...';
  } else if (optionArrangement === OptionArrangement.GRID) {
    optArrangementInstruction = 'Format options in a balanced 2x2 grid (two options per line): (a) ...   (b) ... \\n (c) ...   (d) ...';
  }

  // 6. Refine Mode Feature Connection
  const refineInstruction = refineMode
    ? `**REFINE MODE ENABLED (STRICT CONTENT CLEANING & FILTERING)**:
- YOUR GOAL: Extract ONLY the pure primary content.
- **STRICTLY EXCLUDE ALL EXAM METADATA & TAGS**:
  - Completely IGNORE and DO NOT extract any previous year exam details, source tags, or shift names (e.g., "(SSC CGL Tier-I 02.12.2022 Shift-II)", "[RRB NTPC 2021]", "[UPSC 2020]", shift timings, exam dates, or test series tags).
- **REMOVE JUNK & BRANDING**: Exclude book chapter names, page headers/footers, page numbers, watermarks, Telegram/website links, publisher names, exam center codes, or decorative borders.
- **PRESERVE PURE CONTENT**: Extract the actual content, questions, options, paragraphs, and tables cleanly.`
    : `**FULL EXTRACTION MODE (A TO Z)**:
- Extract EVERY piece of text from the page, including headers, footers, page numbers, and exam tags. Leave nothing out.`;

  // 7. Auto Proofread Feature Connection
  const proofreadInstruction = autoProofread
    ? `**AUTO PROOFREAD & OCR CORRECTION ENABLED**:
- Silently fix OCR scanning errors: reconnect hyphenated words split across line breaks (e.g. "or- \\n ganization" -> "organization"), fix character confusions (e.g. "rn" misread as "m", "1" vs "l", "0" vs "O"), restore missing spaces between glued words, and ensure flawless grammar and formatting.`
    : `**LITERAL OCR EXTRACTION**: Extract text faithfully as printed on the page.`;

  // 8. MCQ Mode vs Universal Document Mode
  const mcqInstruction = mcqMode 
    ? `**MCQ / QUESTION-SET EXTRACTION MODE**:
- This document contains Multiple Choice Questions (MCQs), practice questions, or test sets.
- Format each MCQ clearly:
  Question: 1. [Question Text]
  ${optArrangementInstruction}
${showAnswers ? '  Answer: [Correct Option Letter]' : ''}
- 100% COMPLETE EXTRACTION: If the page contains reading passages, comprehension text, directions, instructions, or theory alongside questions, extract them all completely and attach passages to their questions.`
    : `**UNIVERSAL DOCUMENT / FULL TEXT EXTRACTION MODE**:
- CRITICAL MANDATE: Extract 100% COMPLETE TEXT of the entire PDF page without skipping or omitting anything!
- Extract EVERY SINGLE WORD, line, heading, paragraph, table, formula, note, instruction, or question visible on this page.
- Do NOT isolate only MCQs. Even if this page contains exam questions, practice tests, or questions with options, EXTRACT ALL TEXT on the page in natural reading order.
- Maintain document hierarchy & formatting:
  1. **Headings & Hierarchy**: Mark document headings with markdown (# Main Heading, ## Sub-Heading, ### Section).
  2. **Paragraphs & Articles**: Maintain clean paragraphs with natural line flow. Preserve bold (**bold**) and italics (*italic*).
  3. **Tables & Matrices**: Extract tabular data into Markdown tables (| Col 1 | Col 2 |) with standard separator rows (|---|---|).
  4. **Lists & Bullet Points**: Preserve bullet points (•, -, *) and numbered lists (1., 2., a., b., i., ii.).
  5. **Math & Science**: Enclose all mathematical expressions and formulas in LaTeX double dollar signs (\`$$\\frac{a}{b}$$\`, \`$$x^2 + y^2$$\`, \`$$\\sqrt{z}$$\`).
  6. **Notes & Blockquotes**: Mark notes or callouts with \`> Note: ...\`.
  7. **DO NOT FORCE QUESTIONS**: Do NOT convert general text into question format.`;

  const executeCall = async (client: any) => {
    signal?.throwIfAborted();
    const primaryModel = getPrimaryModel();
    const fallbackModel = getFallbackModel();
    const contents = [
      {
        inlineData: inlineImage
      },
      {
        text: `You are an elite, highly precise Universal Document Digitizer and PDF-to-Text Conversion Engine. Analyze the provided image and extract all elements in their correct reading order with 100% fidelity.

${bilingualInstruction}
${mcqInstruction}
${answerInstruction}
${refineInstruction}
${proofreadInstruction}
${templateInstruction}

**CRITICAL RULE: COMPLETE EXTRACTION**:
- You MUST read the ENTIRE page from top to bottom.
- Do NOT skip any text, questions, options, paragraphs, or tables, no matter where located on the page (unless Refine Mode is ON and it is excluded junk text).
- Ensure all content is extracted completely.

**OCR CONTEXT**:
Here is the raw text extracted by OCR:
"${ocrText}"
Use this as a reference to improve your accuracy, especially for math formulas and Hindi/English text.

**EXTRACTION RULES**:
1. **Text Elements**:
   - Identify distinct blocks of text (paragraphs, questions, options, headers).
   - ${numberingInstruction}
   - ${optArrangementInstruction}
   - Preserve mathematical formulas and scientific notations accurately.
   - **STRICT MATH RULE**: You MUST enclose ALL mathematical formulas, variables, equations, and expressions in double dollar signs like \`$$\` ... \`$$\` (e.g., \`$$x^2 + y^2 = r^2$$\`, \`$$(\\sec A + \\tan A) \\times (1 - \\sin A) \\times \\sec A$$\`).
   - **NO DANGLING DOLLARS**: NEVER output a closing \`$$\` without a matching opening \`$$\`! Never output broken math like \`(sec A + tan A)... \\sec A$$\` or \`\\frac{16\\pi}{3} cm^2$$\`. Every math expression MUST start with \`$$\` and end with \`$$\`.
   - For trigonometric expressions, ALWAYS use standard LaTeX: \`\\sin A\`, \`\\cos A\`, \`\\tan A\`, \`\\sec A\`, \`\\csc A\`, \`\\cot A\` inside \`$$\`...\`$$\`.
   - For formulas with units of measurement (area, volume, etc.), wrap them properly: e.g. \`$$\\frac{16\\pi}{3}\\text{ cm}^2$$\`.
   - PAY VERY CLOSE ATTENTION to recurring decimals or numbers with a line/bar over them (e.g., $0.04\\overline{3}$ or $0.\\overline{43}$). You MUST extract the bar correctly using LaTeX \\overline{}! This is a very common requirement.
   - For fractions, always use \`\\frac{num}{den}\`. For square roots, use \`\\sqrt{...}\`.
   - Ensure complex equations are balanced and valid LaTeX.

${imageInstruction}

3. **Tables**:
   - If you find a table or structured grid, extract it as a 'table' type.
   - Represent the table content in clean Markdown table format (| Col 1 | Col 2 |\\n|---|---|).

**OUTPUT FORMAT**:
You must respond ONLY with a valid JSON array of objects. Do not include any markdown formatting like \`\`\`json or \`\`\` in your response. Just the raw JSON array.

Each object in the array must have the following structure:
{
  "type": "text" | "image" | "table",
  "content": "The extracted text, image description, or markdown table",
  "bbox": [ymin, xmin, ymax, xmax] // Optional: normalized coordinates [0-1000] representing the bounding box of the element
}

**BBOX INSTRUCTIONS**:
1. **Text Elements**: bbox is optional but recommended if possible.
${imageFormattingInstruction}
${includeImages ? CONTENT_FIGURE_INSTRUCTION : ''}
${includeImages && figureMode === 'svg' ? SVG_FIGURE_INSTRUCTION : ''}
3. **Table Elements**: Provide the bbox for the entire table.

Ensure the elements in the JSON array are ordered exactly as they should be read from top to bottom, left to right.
`
        }
      ];

      const generateConfig = {
        abortSignal: signal, claudeModel, geminiModel,
        temperature: 0.1,
        responseMimeType: "application/json",
      };

      const responseText = await callGeminiWithFallback(
        client,
        getPrimaryModel(),
        getFallbackModel(),
        contents,
        generateConfig,
        '/api/extract'
      );

    const cleanedText = responseText.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    // Escape unescaped LaTeX backslashes so JSON.parse doesn't interpret \f as formfeed, \t as tab, etc.
    const latexEscaped = cleanedText.replace(/(?<!\\)\\(frac|sqrt|times|beta|rho|neq|alpha|theta|overline|pm|div|cdot|left|right|sum|int|pi|infty|circ|deg|text|mathbf|mathrm|ge|le|approx|quad|to|sim|partial|Delta|lambda|mu|sigma|omega|phi|sin|cos|tan|log|ln|lim|over|hat|vec|dots|ldots|cdots)/g, '\\\\$1');

    let parsedElements: any;
    try {
      parsedElements = JSON.parse(latexEscaped);
    } catch (e) {
      try {
        parsedElements = JSON.parse(cleanedText);
      } catch (e2) {
        const jsonMatch = cleanedText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          try {
            parsedElements = JSON.parse(jsonMatch[0]);
          } catch(e3) {
            console.error("JSON parse error:", cleanedText);
            throw new Error("Failed to parse AI response as JSON");
          }
        } else {
          console.error("JSON parse error:", cleanedText);
          throw new Error("Failed to parse AI response as JSON");
        }
      }
    }

    if (!Array.isArray(parsedElements)) {
      if (typeof parsedElements === 'object' && parsedElements !== null) {
        if (Array.isArray(parsedElements.elements)) {
          parsedElements = parsedElements.elements;
        } else {
          parsedElements = [parsedElements];
        }
      } else {
        throw new Error("AI response is not an array of elements");
      }
    }
    
    return parsedElements.map((el: any) => {
      let bboxObj = el.bbox;
      if (Array.isArray(el.bbox) && el.bbox.length === 4) {
        bboxObj = {
          ymin: el.bbox[0],
          xmin: el.bbox[1],
          ymax: el.bbox[2],
          xmax: el.bbox[3]
        };
      }

      let contentStr = Array.isArray(el.content) ? el.content.join('\n') : (el.content ? String(el.content) : '');
      if (el.type === 'text') {
        if (mcqMode) {
          contentStr = formatMcqText(contentStr);
          if (!showMcqNumbers) {
            contentStr = contentStr.replace(/^(\s*(?:\*\*)?(?:#?(?:Question|Q)\.?\s*[:\-]?\s*|\bPrashn\s*[:\-]?\s*|\bप्रश्न\s*[:\-]?\s*|#\s*)?(?:\((\d+)\)|\[(\d+)\]|(\d+))?(?:[\.\)\-:]?\s*(?:\*\*)?\s*|[\.\)\-:]\s*))/im, '');
          }
        }
        if (isBilingual) {
          contentStr = cleanBilingualDuplicates(contentStr);
        }
        if (refineMode) {
          contentStr = cleanRefinedText(contentStr);
        }
        if (!showAnswers && mcqMode) {
          contentStr = contentStr
            .replace(/([^\n]+?)\s*\/+\s*Answer\s*[:\-]\s*[a-eA-E]/gi, '$1')
            .replace(/^\s*Answer\s*[:\-]\s*[a-eA-E]\s*$/gim, '')
            .replace(/([^\n])\s+Answer\s*[:\-]\s*[a-eA-E]/gi, '$1')
            .trim();
        }
      }

      return {
        ...el,
        id: Math.random().toString(36).substring(2, 11),
        bbox: bboxObj,
        content: contentStr
      };
    });
  };

  return runAIAction(executeCall, userKey, undefined, geminiModel ? 'gemini' : claudeModel ? 'claude' : undefined);
};

const proofreadWithRetry = async (rawText: string, isBilingual: boolean = false, userKey?: string): Promise<any> => {
  const bilingualAddon = isBilingual 
    ? `
    IMPORTANT: This document is BILINGUAL (Hindi and English).
    - DUAL-LANGUAGE RULE: Output EVERY question in BOTH Hindi and English.
      - If input text is in Hindi only -> Translate into English and provide both.
      - If input text is in English only -> Translate into Hindi and provide both.
    - Question Format Rule: Output the Hindi question on Line 1 (NO slash /) and the English translation on Line 2 (e.g. "Hindi Question\\nEnglish Question").
    - Option Format Rule: Combine textual options on one line separated by " / " (e.g. "(a) Hindi Option / English Option").
    - NUMBERS & IDENTICAL OPTIONS RULE: NEVER duplicate pure numbers, mathematical formulas, or identical values (e.g., if option is 123, write "123", NEVER "123 / 123").
    - Consistent Labeling: Ensure options are labeled consistently (a), (b), (c), (d).`
    : ``;

  const prompt = `
    You are an expert Exam Paper Editor. I will provide you with raw text extracted from an exam paper.
    Your task is to identify and extract all Multiple Choice Questions (MCQs) from this text.
    ${bilingualAddon}
    
    For each MCQ:
    1. Extract the question text clearly.
    2. Extract all options (A, B, C, D, etc.).
    3. Clean up any OCR errors, typos, or stray characters.
    4. Ensure the question is complete and logical.
    5. Remove any junk text that is not part of the question or options (e.g., page numbers, headers, footers).
    6. LaTeX & Units Rule:
       - Keep all math, formulas, and units in proper LaTeX (e.g. "$3 \\times 10^8\\text{ m/s}$", "$\\frac{a}{b}$", "$\\sin\\theta$").
       - ALWAYS ensure opening and closing math delimiters ($ or $) are properly paired. NEVER leave unclosed or dangling delimiters.
       - Measurement units like m/s, km/h, cm^2 must NEVER be split across lines or separated from their numbers.
   - **CHEMICAL EQUATIONS**: For reaction conditions over arrows, use standard LaTeX \\xrightarrow{\\text{condition}} or ⎯⎯(condition)⎯→ (e.g. \\xrightarrow{\\text{Heat}}, \\xrightarrow{\\text{ताप}}). NEVER drop the backslash or concatenate into "xrightarrowHeat". Subscripts in chemical formulas must use standard LaTeX (e.g. CaCO_3, CuSO_4, H_2O).
       - Keep complete sentences intact; do NOT insert arbitrary newlines inside a question.
    
    Return a JSON object with a single key "questions" which is an array of objects.
    Each object must have:
    - "questionText": string
    - "options": array of objects, each with "label" (e.g. "A", "B") and "text" (string)
    - "answer": string (optional, if detected)
    
    RAW TEXT:
    "${rawText}"
  `;

  const executeProofread = async (client: any) => {
    const primaryModel = getPrimaryModel();
    const fallbackModel = getFallbackModel();
    const responseText = await callGeminiWithFallback(
      client,
      primaryModel,
      fallbackModel,
      [{ text: prompt }],
      {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
      '/api/proofread'
    );

    const cleanedText = responseText.replace(/^\`\`\`json\n?/, '').replace(/\n?\`\`\`$/, '').trim();
    const parsed = JSON.parse(cleanedText);
    const questions = parsed.questions || [];
    if (isBilingual) {
      questions.forEach((q: any) => {
        if (q.questionText) q.questionText = cleanBilingualDuplicates(q.questionText);
        if (Array.isArray(q.options)) {
          q.options.forEach((opt: any) => {
            if (opt.text) opt.text = cleanBilingualDuplicates(opt.text);
          });
        }
      });
    }
    return questions;
  };

  return runAIAction(executeProofread, userKey);
};

app.post('/api/extract', requireUser, usageMiddleware('extract'), async (req, res) => {
  const controller = new AbortController();
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });
  try {
    const { 
      base64Image, 
      ocrText, 
      numberingStyle, 
      includeImages, 
      isBilingual, 
      mcqMode, 
      refineMode, 
      showAnswers = true,
      showMcqNumbers = true,
      autoProofread = false,
      optionArrangement
    } = req.body;
    const userKey = getUserKey(req);
    const elements = await extractLayoutWithRetry(
      base64Image, 
      ocrText, 
      numberingStyle, 
      includeImages, 
      isBilingual, 
      mcqMode, 
      refineMode, 
      showAnswers, 
      userKey,
      showMcqNumbers,
      autoProofread,
      optionArrangement,
      controller.signal,
      req.body.figureMode === 'svg' ? 'svg' : 'crop', req.body.claudeModel, req.body.geminiModel, req.body.extractTemplate
    );
    if (controller.signal.aborted) return;
    res.json({ elements });
  } catch (error: any) {
    if (controller.signal.aborted) return;
    console.warn("Extraction failed:", error?.message || error);
    try {
      const parsedError = JSON.parse(error.message);
      if (parsedError.isQuotaError) {
        return res.status(429).json({ error: parsedError.originalError || "Quota exceeded", waitTime: parsedError.waitTime });
      }
    } catch(e) {}
    res.status(500).json({ error: error.message || "Extraction failed" });
  }
});

app.post('/api/proofread', requireUser, usageMiddleware('proofread'), async (req, res) => {
  try {
    const { rawText, isBilingual } = req.body;
    const userKey = getUserKey(req);
    const questions = await proofreadWithRetry(rawText, isBilingual, userKey);
    res.json({ questions });
  } catch (error: any) {
    console.warn("Proofread failed:", error?.message || error);
    try {
      const parsedError = JSON.parse(error.message);
      if (parsedError.isQuotaError) {
        return res.status(429).json({ error: parsedError.originalError || "Quota exceeded", waitTime: parsedError.waitTime });
      }
    } catch(e) {}
    res.status(500).json({ error: error.message || "Proofread failed" });
  }
});

// Unified cleaner aliases for backward compatibility across endpoints
const cleanServerMocktestText = cleanMocktestText;
const stripServerSolutionPrefix = stripSolutionPrefix;
const stripServerExamTagsAndJunk = stripExamTagsAndJunk;
const stripServerOptionLetterReferences = stripOptionLetterReferences;



const STRICT_MATH_AND_TEXT_PROMPT_RULES = `
${HTML_LATEX_FORMAT_RULES}
- Use standard Unicode arrows in text: →, ⇒.
- COMPREHENSIVE, STEP-BY-STEP DETAILED SOLUTIONS (FOR ALL STUDENT LEVELS):
  * Provide in-depth, thorough solutions so that even beginner or weaker students can understand easily.
  * For Math/Numericals: State Given Data ("दिया गया है / Given that:"), Key Formula/Theorem in LaTeX ($...$), complete step-by-step arithmetic without skipping intermediate steps, and final calculated value with units.
  * For Reasoning: State the fundamental rule, write out every step/pattern mapping, and explain the exact deduction.
  * For Science/GK/Polity/History: Provide full background/context (Articles, dates, causes) + 3-5 connected high-yield exam facts.
  * For Language: Explain grammar rules, vocabulary meanings, and why other options do not fit.
  * Avoid short 1-2 line summaries. Ensure the explanation is detailed, clear, and instructive.
- NO OPTION LETTERS IN SOLUTIONS: Never write "Option A is correct" or "सही विकल्प A है" (options shuffle dynamically). State facts, concept, and calculated values directly!`;

app.post('/api/mocktest-solve', requireUser, usageMiddleware('mocktest-solve'), async (req, res) => {
  try {
    const { question_hi, question_en, option1_hi, option2_hi, option3_hi, option4_hi, option5_hi, option1_en, option2_en, option3_en, option4_en, option5_en, answer, question_type } = req.body;
    const userKey = getUserKey(req);

    const qPrompt = `You are an elite Indian Competitive Exam Educator and Master Test-Series Author (specializing in SSC CGL/CHSL, Railway RRB NTPC/ALP/Group-D, Banking IBPS/SBI, UPSC, State PSC, and YCT-style exam publications).
Provide a THOROUGH, IN-DEPTH, STEP-BY-STEP PEDAGOGICAL SOLUTION tailored precisely to this question so that students of ANY level (from beginners to advanced) can easily understand the complete concept and derivation.

QUESTION CONTEXT:
Target Option / Answer: ${answer || 'Deduce correct answer'}
Question Type: ${question_type || 'MCQ'}

HINDI:
Question: ${question_hi || ''}
(A) ${option1_hi || ''}
(B) ${option2_hi || ''}
(C) ${option3_hi || ''}
(D) ${option4_hi || ''}
${option5_hi ? `(E) ${option5_hi}` : ''}

ENGLISH:
Question: ${question_en || ''}
(A) ${option1_en || ''}
(B) ${option2_en || ''}
(C) ${option3_en || ''}
(D) ${option4_en || ''}
${option5_en ? `(E) ${option5_en}` : ''}

CRITICAL PEDAGOGICAL GUIDELINES (DETAILED & STUDENT-FRIENDLY STANDARD):
1. DYNAMIC STEP-BY-STEP PATTERN (जैसा प्रश्न वैसा विस्तृत पैटर्न):
   - For MATHEMATICS / NUMERICALS / QUANT:
     * State given data clearly: "दिया गया है / Given that:" (list all given values and units).
     * State the key formula/theorem clearly in standard LaTeX math ($...$).
     * Show complete step-by-step intermediate calculations without skipping steps so weaker students understand clearly.
     * Conclude with the final computed numerical value and units.
   - For REASONING / LOGIC (Puzzles, Coding-Decoding, Series, Syllogism, Blood Relations):
     * State the core logic rule directly ("जिस प्रकार...", reverse letter positions, difference pattern).
     * Show the step-by-step pattern verification for each term or concept (e.g. K (+3) → N (-8) → F).
     * State the derived correct answer term/value directly.
   - For GENERAL KNOWLEDGE / HISTORY / POLITY / GEOGRAPHY / STATIC GK / ECONOMICS:
     * Direct Factual Context: State why the answer is correct with date, year, treaty, person, place, or Article.
     * High-Yield Connected Exam Facts: Provide 3–5 essential connected facts, treaty conditions, or mini-list for deep learning.
   - For GENERAL SCIENCE (Physics, Chemistry, Biology):
     * Explain the scientific principle/reaction/mechanism thoroughly.
     * Mention practical applications, related laws, and discoverers with years.
   - For LANGUAGE (Hindi & English Grammar, Vocab, Error Spotting):
     * State the grammatical rule, tense, voice, idiom meaning, or vocabulary usage clearly with examples.

2. FORMATTING RULES:
${HTML_LATEX_FORMAT_RULES}
- Structure solutions as short <p> paragraphs (given data, formula, each calculation step, final value); use <ol>/<ul> for fact lists.
- STRICT NO-PREFIX & NO-FILLER RULE: DO NOT start with 'हल:', 'Solution:', or 'Explanation:'. Start directly with the derivation or explanation.
- STRICT NO-OPTION-LETTER RULE: Options shuffle dynamically! NEVER write "सही विकल्प A है" or "Option A is correct". State facts, formulas, or calculated values directly!

Output ONLY valid JSON:
{
  "solution_hi": "दिया गया है...",
  "solution_en": "Given that...",
  "difficulty_level": "easy" | "medium" | "hard"
}`;

    const executeSolve = async (client: any) =>
      callGeminiWithFallback(
        client,
        getPrimaryModel(),
        getFallbackModel(),
        [{ text: qPrompt }],
        { geminiModel: req.body.geminiModel, claudeModel: req.body.claudeModel, temperature: 0.15, responseMimeType: 'application/json' },
        'mocktest-solve'
      );


    const rawJson = await runAIAction(executeSolve, userKey, undefined, req.body.geminiModel ? 'gemini' : req.body.claudeModel ? 'claude' : undefined);

    const parsed = safeParseAiJsonObject(rawJson);
    res.json({
      solution_hi: stripServerSolutionPrefix(cleanServerMocktestText(parsed.solution_hi || '')),
      solution_en: stripServerSolutionPrefix(cleanServerMocktestText(parsed.solution_en || '')),
      difficulty_level: parsed.difficulty_level || 'medium'
    });
  } catch (error: any) {
    console.warn("MockTest solve failed:", error?.message || error);
    res.status(500).json({ error: error.message || "Failed to generate solution" });
  }
});

app.post('/api/mocktest-repair-item', requireUser, usageMiddleware('mocktest-repair-item'), async (req, res) => {
  try {
    const { item } = req.body;
    if (!item) {
      return res.status(400).json({ error: "Missing question item in request body" });
    }

    const userKey = getUserKey(req);

    const repairPrompt = `You are an elite competitive exam test-series architect, educator, and question digitizer (SSC CGL, Railway RRB, Banking, UPSC).
You are given an INCOMPLETE exam question item. Some fields may be blank, options may be missing or stuck at the end of the question stem, or the subject and solution may need deep pedagogical repair.

INPUT QUESTION DATA:
Subject: "${item.subject || ''}"
Question (Hindi): "${item.question_hi || ''}"
Option 1 (Hindi): "${item.option1_hi || ''}"
Option 2 (Hindi): "${item.option2_hi || ''}"
Option 3 (Hindi): "${item.option3_hi || ''}"
Option 4 (Hindi): "${item.option4_hi || ''}"
${item.option5_hi ? `Option 5 (Hindi): "${item.option5_hi}"` : ''}
Question (English): "${item.question_en || ''}"
Option 1 (English): "${item.option1_en || ''}"
Option 2 (English): "${item.option2_en || ''}"
Option 3 (English): "${item.option3_en || ''}"
Option 4 (English): "${item.option4_en || ''}"
${item.option5_en ? `Option 5 (English): "${item.option5_en}"` : ''}
Answer Candidate: "${item.answer || ''}"

MANDATORY TASKS TO EXECUTE:
1. QUESTION STEM CLEANUP:
   - If options are attached at the end of the question text, strip them completely so the question statement is clean.
   - If question is in only one language, translate and generate the counterpart language.
2. 4 OPTIONS (A, B, C, D) RESTORATION:
   - All 4 options MUST be fully populated in clean normal text in BOTH Hindi (option1_hi..option4_hi) and English (option1_en..option4_en).
3. CORRECT ANSWER DEDUCTION:
   - Solve the question rigorously. Set "answer" to the exact correct option ("A", "B", "C", or "D").
4. DYNAMIC STEP-BY-STEP SOLUTION:
   - Provide a clear, step-by-step solution. NEVER mention option letters ("Option A is correct").
${STRICT_MATH_AND_TEXT_PROMPT_RULES}

Respond ONLY with a valid JSON object:
{
  "question_hi": "...",
  "question_en": "...",
  "option1_hi": "...",
  "option2_hi": "...",
  "option3_hi": "...",
  "option4_hi": "...",
  "option1_en": "...",
  "option2_en": "...",
  "option3_en": "...",
  "option4_en": "...",
  "answer": "B",
  "subject": "Reasoning",
  "difficulty_level": "medium",
  "solution_hi": "दिया गया है...",
  "solution_en": "Given that..."
}`;

    const executeRepair = async (client: any) =>
      callGeminiWithFallback(
        client,
        getPrimaryModel(),
        getFallbackModel(),
        [{ text: repairPrompt }],
        { temperature: 0.1, responseMimeType: 'application/json' },
        'mocktest-repair'
      );


    const rawJson = await runAIAction(executeRepair, userKey);

    const parsed = safeParseAiJsonObject(rawJson);
    if (parsed && typeof parsed === 'object') {
      if (parsed.question_hi) parsed.question_hi = cleanServerMocktestText(parsed.question_hi);
      if (parsed.question_en) parsed.question_en = cleanServerMocktestText(parsed.question_en);
      if (parsed.solution_hi) parsed.solution_hi = stripServerSolutionPrefix(cleanServerMocktestText(parsed.solution_hi));
      if (parsed.solution_en) parsed.solution_en = stripServerSolutionPrefix(cleanServerMocktestText(parsed.solution_en));
      if (parsed.option1_hi) parsed.option1_hi = cleanServerMocktestText(parsed.option1_hi);
      if (parsed.option2_hi) parsed.option2_hi = cleanServerMocktestText(parsed.option2_hi);
      if (parsed.option3_hi) parsed.option3_hi = cleanServerMocktestText(parsed.option3_hi);
      if (parsed.option4_hi) parsed.option4_hi = cleanServerMocktestText(parsed.option4_hi);
      if (parsed.option1_en) parsed.option1_en = cleanServerMocktestText(parsed.option1_en);
      if (parsed.option2_en) parsed.option2_en = cleanServerMocktestText(parsed.option2_en);
      if (parsed.option3_en) parsed.option3_en = cleanServerMocktestText(parsed.option3_en);
      if (parsed.option4_en) parsed.option4_en = cleanServerMocktestText(parsed.option4_en);
    }
    res.json(parsed);
  } catch (error: any) {
    console.warn("MockTest repair failed:", error?.message || error);
    res.status(500).json({ error: error.message || "Failed to auto-repair question" });
  }
});

app.post('/api/mocktest-reverify', requireUser, usageMiddleware('mocktest-reverify'), async (req, res) => {
  try {
    const { item, primaryImage, secondaryImage, missingFields } = req.body;
    if (!item) {
      return res.status(400).json({ error: "Missing question item in request body" });
    }
    const userKey = getUserKey(req);

    const cleanImg = (img?: string) => {
      if (!img) return '';
      return img.includes(';base64,') ? img.split(';base64,')[1] : img;
    };

    const cleanPrimary = cleanImg(primaryImage);
    const cleanSecondary = cleanImg(secondaryImage);

    const targetList = Array.isArray(missingFields) && missingFields.length > 0
      ? missingFields.join(', ')
      : 'Options, Question Stem, or Answer';

    const reverifyPrompt = `You are an expert competitive exam paper digitizer and visual inspector.
An MCQ was extracted from this exam paper, but the following required field(s) were flagged as MISSING, INCOMPLETE, or EMPTY:
MISSING FIELDS TO RECOVER: ${targetList}

EXISTING EXTRACTED QUESTION CONTEXT:
Question Reference: "${item.source_question_reference || item.question_r || ''}"
Current Page: "${item.source_pages || item.pageNumber || ''}"
Question (Hindi): "${item.question_hi || ''}"
Question (English): "${item.question_en || ''}"
Option 1: "${item.option1_hi || item.option1_en || ''}"
Option 2: "${item.option2_hi || item.option2_en || ''}"
Option 3: "${item.option3_hi || item.option3_en || ''}"
Option 4: "${item.option4_hi || item.option4_en || ''}"
Answer: "${item.answer || ''}"

INSPECTION INSTRUCTIONS:
1. Closely inspect the provided page image(s). If two images are provided, check the bottom of the first image and the top of the second image (since questions and options frequently cross page borders).
2. Locate this exact question.
3. Extract ONLY the true missing fields.
4. STRICT ACCURACY & TRUTHFULNESS:
   - If a missing field is NOT visible or cannot be found anywhere on the image(s), DO NOT invent fake data. Return empty string "" for that field.
${STRICT_MATH_AND_TEXT_PROMPT_RULES}
5. Output ONLY valid JSON:
{
  "recovered_fields": {
    "question_hi": "",
    "question_en": "",
    "option1_hi": "",
    "option2_hi": "",
    "option3_hi": "",
    "option4_hi": "",
    "option1_en": "",
    "option2_en": "",
    "option3_en": "",
    "option4_en": "",
    "answer": "",
    "solution_hi": "",
    "solution_en": ""
  },
  "source_pages": "${cleanSecondary ? `${item.pageNumber || '1'}, ${(item.pageNumber || 1) + 1}` : `${item.pageNumber || '1'}`}"
}`;

    const executeReverify = async (client: any) => {
      const parts: any[] = [];
      if (cleanPrimary) {
        parts.push({
          inlineData: {
            mimeType: 'image/png',
            data: cleanPrimary
          }
        });
      }
      if (cleanSecondary) {
        parts.push({
          inlineData: {
            mimeType: 'image/png',
            data: cleanSecondary
          }
        });
      }
      parts.push({ text: reverifyPrompt });
      return callGeminiWithFallback(
        client,
        getPrimaryModel(),
        getFallbackModel(),
        parts,
        { temperature: 0.1, responseMimeType: 'application/json' },
        'mocktest-reverify'
      );
    };


    const rawJson = await runAIAction(executeReverify, userKey);
    const parsed = safeParseAiJsonObject(rawJson);
    const rec = parsed?.recovered_fields || {};
    const cleanedRecovered: any = {};
    for (const k of Object.keys(rec)) {
      if (rec[k]) {
        cleanedRecovered[k] = cleanServerMocktestText(rec[k]);
      }
    }
    res.json({
      recovered_fields: cleanedRecovered,
      source_pages: parsed?.source_pages || item.source_pages
    });
  } catch (error: any) {
    console.warn("MockTest reverify failed:", error?.message || error);
    res.status(500).json({ error: error.message || "Failed to re-verify missing fields" });
  }
});

app.post('/api/mocktest-extract', requireUser, usageMiddleware('mocktest-extract'), async (req, res) => {
  try {
    const { base64Image, rawText, setName = 'Exam Paper', pendingContext, pageNumber, generateSimilar = false } = req.body;
    const userKey = getUserKey(req);

    let cleanBase64 = base64Image || '';
    if (cleanBase64.includes(';base64,')) {
      cleanBase64 = cleanBase64.split(';base64,')[1];
    }

    let carryOverPrompt = '';
    if (pendingContext && pendingContext.pendingItems && pendingContext.pendingItems.length > 0) {
      const pendingJson = JSON.stringify(pendingContext.pendingItems.map((it: any) => ({
        question_reference: it.source_question_reference || it.question_r,
        question_hi: it.question_hi || '',
        question_en: it.question_en || '',
        option1_hi: it.option1_hi || '',
        option2_hi: it.option2_hi || '',
        option3_hi: it.option3_hi || '',
        option4_hi: it.option4_hi || '',
        option1_en: it.option1_en || '',
        option2_en: it.option2_en || '',
        option3_en: it.option3_en || '',
        option4_en: it.option4_en || '',
        answer: it.answer || '',
        source_pages: it.source_pages || String(pendingContext.sourcePageNumber)
      })), null, 2);

      carryOverPrompt = `\n\nCRITICAL: CARRY-OVER CONTEXT FROM PREVIOUS PAGE (Page ${pendingContext.sourcePageNumber}):
The previous page ended with the following incomplete question(s) that may continue on this current page:
${pendingJson}

CARRY-OVER CONTINUATION INSTRUCTIONS:
1. Carefully check the VERY TOP of this page image:
   - Does this page start with the continuation of any pending question from the previous page (e.g., remaining options C and D, remainder of question text, answer, or explanation)?
   - IF YES:
     * MERGE the continuation with the pending question data from above to produce a SINGLE COMPLETE QUESTION.
     * Set its "source_pages" to "${pendingContext.sourcePageNumber}, ${pageNumber || pendingContext.sourcePageNumber + 1}".
     * Place this merged question as the FIRST object in the JSON output array.
     * DO NOT output the continuation fragment as a detached or separate question!
   - IF NO:
     * If this page begins with a brand new question, extract all questions on this page normally.
2. EXTRACT SUBSEQUENT QUESTIONS:
   - Extract all subsequent new multiple-choice questions appearing on this page normally.
3. INCOMPLETE QUESTIONS AT PAGE BOTTOM:
   - If the last question at the bottom of this page is cut off or missing options, extract whatever stem and options are visible.`;
    }

    let promptText = '';

    if (generateSimilar) {
      promptText = `You are an expert Competitive Exam Question Creator.
Input contains exam questions. Use them STRICTLY AS A CONCEPT REFERENCE to generate BRAND NEW, UNIQUE PRACTICE MCQs (DO NOT copy verbatim).${carryOverPrompt}

RULES:
1-2. HTML + LATEX FORMAT (questions, options and explanations):
${HTML_LATEX_FORMAT_RULES}
3. LANGUAGE PAPERS & BILINGUAL RULES (CRITICAL):
   - For English Language tests (English Comprehension, Grammar, Vocab, etc.): DO NOT translate into Hindi! Both "question_hi" and "question_en" (and options) MUST contain ONLY the original English text.
   - For Hindi Language tests (हिंदी गद्यांश, व्याकरण आदि): DO NOT translate into English! Both "question_hi" and "question_en" (and options) MUST contain ONLY the original Hindi text.
   - For other general subjects (Maths, Reasoning, Science, GS): provide Hindi in _hi and English in _en.
4. Comprehensive Solutions: Provide a detailed, step-by-step pedagogical solution (given data, LaTeX formula $...$, complete intermediate calculation or factual background) so any level of student can understand easily. NEVER write "Option A is correct" (options shuffle dynamically).
5. Answer: Correct option single letter ("A", "B", "C", or "D").
6. READING COMPREHENSION / PASSAGE SETS (CRITICAL):
   - If reference questions are based on a reading comprehension passage or गद्यांश, create a relevant passage and PREPEND THE COMPLETE PASSAGE TEXT TO EVERY SINGLE QUESTION belonging to that passage set in both question_hi and question_en, separated by "\\n---\\n".

Output ONLY a valid JSON array of objects:
[
  {
    "question_r": 1,
    "question_hi": "...",
    "question_en": "...",
    "option1_hi": "...",
    "option2_hi": "...",
    "option3_hi": "...",
    "option4_hi": "...",
    "option1_en": "...",
    "option2_en": "...",
    "option3_en": "...",
    "option4_en": "...",
    "answer": "A",
    "solution_hi": "...",
    "solution_en": "...",
    "subject": "Mathematics",
    "difficulty_level": "medium",
    "source_question_reference": "Ref-Q.1 (Variant)"
  }
]`;
    } else {
      promptText = `You are a professional Exam Paper Digitizer.
Extract all multiple-choice questions (MCQs) from the input into a strict JSON array.${carryOverPrompt}

RULES:
1-2. HTML + LATEX FORMAT (questions, options and explanations):
${HTML_LATEX_FORMAT_RULES}
3. LANGUAGE PAPERS & BILINGUAL RULES (CRITICAL):
   - For English Language tests (English Comprehension, Grammar, Vocab, etc.): DO NOT translate into Hindi! Both "question_hi" and "question_en" (and options) MUST contain ONLY the original English text.
   - For Hindi Language tests (हिंदी गद्यांश, व्याकरण आदि): DO NOT translate into English! Both "question_hi" and "question_en" (and options) MUST contain ONLY the original Hindi text.
   - For other general subjects (Maths, Reasoning, Science, GS): provide Hindi in _hi and English in _en.
4. Comprehensive Solutions: Provide a detailed, step-by-step pedagogical solution (given data, LaTeX formula $...$, complete intermediate calculation or factual background) so any level of student can understand easily. NEVER write "Option A is correct" (options shuffle dynamically).
5. Answer: Correct option single letter ("A", "B", "C", or "D").
6. READING COMPREHENSION / PASSAGE SETS (CRITICAL):
   - If questions are based on a Passage, Comprehension text, Directions, or गद्यांश / काव्यांश (e.g. "SET - 34 [Q. 164. to Q. 168.]", "Directions (439-443)", "गद्यांश को पढ़कर..."):
     Use the shared context fields below for the directions and data. Each question has its own stem and options.

Output ONLY a valid JSON array of objects:
[
  {
    "question_r": 1,
    "question_hi": "...",
    "question_en": "...",
    "option1_hi": "...",
    "option2_hi": "...",
    "option3_hi": "...",
    "option4_hi": "...",
    "option1_en": "...",
    "option2_en": "...",
    "option3_en": "...",
    "option4_en": "...",
    "answer": "A",
    "solution_hi": "...",
    "solution_en": "...",
    "subject": "General",
    "difficulty_level": "medium",
    "source_question_reference": "Q.1"
  }
]`;
    }

    if (!generateSimilar) promptText += "\n" + MCQ_PAGE_COVERAGE + "\n" + MCQ_SHARED_CONTEXT;
    if (cleanBase64 && !generateSimilar && ['svg', 'crop'].includes(req.body.figureMode)) {
      promptText += mcqFigureInstruction(req.body.figureMode);
    }
    const executeExtract = async (client: any) => {
      // Helper: extract text from a Gemini response safely
      const extractText = (resp: any): string => {
        if (resp?.text && String(resp.text).trim()) return String(resp.text);
        if (resp?.candidates?.[0]?.content?.parts) {
          return resp.candidates[0].content.parts.map((p: any) => p.text || '').join('');
        }
        return '';
      };

      const contents: any[] = [];
      if (cleanBase64) {
        contents.push({
          inlineData: {
            ...readInlineImage(cleanBase64)
          }
        });
      }
      if (rawText && typeof rawText === 'string' && rawText.trim()) {
        contents.push({
          text: `RAW EXAM / QUESTION PAPER TEXT OR DOCX CONTENT TO DIGITIZE:\n"""\n${rawText.trim()}\n"""\n\n${promptText}`
        });
      } else {
        contents.push({ text: promptText });
      }

      const responseText = await callGeminiWithFallback(
        client,
        getPrimaryModel(),
        getFallbackModel(),
        contents,
        {
          geminiModel: req.body.geminiModel, claudeModel: req.body.claudeModel,
          temperature: generateSimilar ? 0.35 : 0.1,
          responseMimeType: "application/json"
        },
        'mocktest-extract'
      );
      return responseText;
    };


    const rawJson = await runAIAction(executeExtract, userKey, undefined, req.body.geminiModel ? 'gemini' : req.body.claudeModel ? 'claude' : undefined);

    const parsed = safeParseAiJson(rawJson);
    const rawItems = Array.isArray(parsed) ? parsed : [];

    // Server-side Gadyansh / Passage detector and distributor:
    // If AI outputs standalone passage object or passage_hi fields, attach to respective questions.
    let currentPassageHi = '';
    let currentPassageEn = '';
    let currentPassageRange = '';
    let activeUntilQNum = 0;
    const distributedItems: any[] = [];

    for (let i = 0; i < rawItems.length; i++) {
      const it = rawItems[i];
      if (Object.hasOwn(it, 'passage_id')) {
        distributedItems.push(it);
        currentPassageHi = currentPassageEn = currentPassageRange = '';
        activeUntilQNum = 0;
        continue;
      }
      const qHi = String(it.question_hi || it.question || '');
      const qEn = String(it.question_en || '');
      const hasOpts = Boolean(it.option1_hi || it.option2_hi || it.option1_en || it.option2_en);

      // Check if standalone passage block
      const isPassageKw = /(?:गद्यांश|काव्यांश|पद्यांश|निर्देश|अनुच्छेद|passage|comprehension)/i.test(qHi);
      const isStandalone = !hasOpts && isPassageKw && qHi.length > 50;

      if (isStandalone) {
        const rangeMatch = qHi.match(/(?:प्र(?:\.|श्न)?|Q(?:uestion)?\.?)\s*(\d+)\s*(?:-|से|to)\s*(\d+)/i);
        if (rangeMatch) {
          activeUntilQNum = parseInt(rangeMatch[2], 10);
          currentPassageRange = `Q.${rangeMatch[1]}-${rangeMatch[2]}`;
        } else {
          activeUntilQNum = (it.question_r || (i + 1)) + 5;
          currentPassageRange = 'Passage Set';
        }
        currentPassageHi = qHi;
        currentPassageEn = qEn || qHi;
        continue;
      }

      if (it.passage_hi || it.gadyansh || it.passage) {
        currentPassageHi = it.passage_hi || it.gadyansh || it.passage;
        currentPassageEn = it.passage_en || currentPassageHi;
      }

      const qNum = parseInt(it.question_r, 10) || 0;
      const inRange = activeUntilQNum > 0 && qNum > 0 ? qNum <= activeUntilQNum : Boolean(currentPassageHi);

      let finalQHi = qHi;
      let finalQEn = qEn;

      if (currentPassageHi && inRange) {
        const snippet = currentPassageHi.slice(0, 25);
        if (!finalQHi.includes(snippet)) {
          finalQHi = `${currentPassageHi}\n---\n${finalQHi}`;
        }
        if (currentPassageEn) {
          const snippetEn = currentPassageEn.slice(0, 25);
          if (!finalQEn.includes(snippetEn)) {
            finalQEn = `${currentPassageEn}\n---\n${finalQEn}`;
          }
        }
        it.passage_hi = currentPassageHi;
        it.passage_en = currentPassageEn;
        if (!it.figure_notes) {
          it.figure_notes = currentPassageRange ? `गद्यांश / Passage: ${currentPassageRange}` : 'गद्यांश / Passage';
        }
      }

      distributedItems.push({
        ...it,
        question_hi: finalQHi,
        question_en: finalQEn
      });
    }

    const items = distributedItems.map((item: any) => ({
      ...item,
      question_hi: cleanServerMocktestText(item.question_hi),
      question_en: cleanServerMocktestText(item.question_en),
      solution_hi: stripServerSolutionPrefix(cleanServerMocktestText(item.solution_hi)),
      solution_en: stripServerSolutionPrefix(cleanServerMocktestText(item.solution_en)),
      option1_hi: cleanServerMocktestText(item.option1_hi),
      option2_hi: cleanServerMocktestText(item.option2_hi),
      option3_hi: cleanServerMocktestText(item.option3_hi),
      option4_hi: cleanServerMocktestText(item.option4_hi),
      option1_en: cleanServerMocktestText(item.option1_en),
      option2_en: cleanServerMocktestText(item.option2_en),
      option3_en: cleanServerMocktestText(item.option3_en),
      option4_en: cleanServerMocktestText(item.option4_en),
    }));
    res.json({ items });
  } catch (error: any) {
    console.warn("MockTest extract failed:", error?.message || error);
    res.status(500).json({ error: error.message || "Extraction failed" });
  }
});

app.post('/api/mocktest-generate-similar-item', requireUser, usageMiddleware('mocktest-generate-similar-item'), async (req, res) => {
  try {
    const { item } = req.body;
    if (!item) {
      return res.status(400).json({ error: "Missing question item in request body" });
    }
    const userKey = getUserKey(req);

    const prompt = `You are an elite Competitive Exam Test-Series Architect, Question Creator, and Educator (SSC CGL, Railway RRB, Banking, UPSC, State PSC).

REFERENCE QUESTION (USE STRICTLY AS INSPIRATION & CONCEPT BLUEPRINT):
Subject: ${item.subject || 'General'}
Reference Question (Hindi): ${item.question_hi || ''}
Reference Question (English): ${item.question_en || ''}
Reference Option A: ${item.option1_hi || item.option1_en || ''}
Reference Option B: ${item.option2_hi || item.option2_en || ''}
Reference Option C: ${item.option3_hi || item.option3_en || ''}
Reference Option D: ${item.option4_hi || item.option4_en || ''}
Reference Answer: ${item.answer || ''}
Difficulty Level: ${item.difficulty_level || 'medium'}

TASK:
GENERATE A BRAND NEW, UNIQUE SIMILAR MULTIPLE CHOICE QUESTION testing the same core concept or topic:
- DO NOT copy or reproduce the reference question! Create a FRESH, ORIGINAL VARIANT.
- For Math/Science: Change numerical values, scenarios, variables. Ensure formulas calculate accurately.
- For GK/Polity/History: Test the same subject area or era with a distinct new question.
- For Reasoning/Language: Keep the same logical rule with new entities, numbers, or sentences.
- Formulate 4 completely fresh, plausible options (A, B, C, D).
- Compute and verify the single correct answer ("A", "B", "C", or "D").
- Provide clear step-by-step solutions without mentioning option letters ("Option A is correct").
${STRICT_MATH_AND_TEXT_PROMPT_RULES}

Output ONLY a JSON object matching this structure:
{
  "question_hi": "...",
  "question_en": "...",
  "option1_hi": "...",
  "option2_hi": "...",
  "option3_hi": "...",
  "option4_hi": "...",
  "option1_en": "...",
  "option2_en": "...",
  "option3_en": "...",
  "option4_en": "...",
  "answer": "A",
  "solution_hi": "...",
  "solution_en": "...",
  "subject": "${item.subject || 'General'}",
  "difficulty_level": "${item.difficulty_level || 'medium'}",
  "source_question_reference": "Ref-Q.${item.question_r || '1'} (Variant)"
}`;

    const executeGenerate = async (client: any) =>
      callGeminiWithFallback(
        client,
        getPrimaryModel(),
        getFallbackModel(),
        [{ text: prompt }],
        { temperature: 0.4, responseMimeType: 'application/json' },
        'mocktest-generate-similar'
      );


    const rawJson = await runAIAction(executeGenerate, userKey);
    const parsed = safeParseAiJsonObject(rawJson);
    res.json({
      item: {
        ...item,
        ...parsed,
        id: `variant_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        question_hi: cleanServerMocktestText(parsed.question_hi || ''),
        question_en: cleanServerMocktestText(parsed.question_en || ''),
        solution_hi: stripServerSolutionPrefix(cleanServerMocktestText(parsed.solution_hi || '')),
        solution_en: stripServerSolutionPrefix(cleanServerMocktestText(parsed.solution_en || '')),
        option1_hi: cleanServerMocktestText(parsed.option1_hi || ''),
        option2_hi: cleanServerMocktestText(parsed.option2_hi || ''),
        option3_hi: cleanServerMocktestText(parsed.option3_hi || ''),
        option4_hi: cleanServerMocktestText(parsed.option4_hi || ''),
        option1_en: cleanServerMocktestText(parsed.option1_en || ''),
        option2_en: cleanServerMocktestText(parsed.option2_en || ''),
        option3_en: cleanServerMocktestText(parsed.option3_en || ''),
        option4_en: cleanServerMocktestText(parsed.option4_en || ''),
        answer: (parsed.answer || 'A').toUpperCase().trim(),
        subject: parsed.subject || item.subject,
        difficulty_level: parsed.difficulty_level || item.difficulty_level,
        source_question_reference: parsed.source_question_reference || `Ref-Q.${item.question_r} (Variant)`
      }
    });
  } catch (error: any) {
    console.warn("Generate similar item failed:", error?.message || error);
    res.status(500).json({ error: error.message || "Failed to generate similar question" });
  }
});

app.post('/api/mocktest-proofread', requireUser, usageMiddleware('mocktest-proofread'), async (req, res) => {
  try {
    const { items } = req.body;
    const userKey = getUserKey(req);

    if (!Array.isArray(items) || items.length === 0) {
      return res.json({ items: [] });
    }

    const proofreadPrompt = `You are a Senior Exam Editor and Pedagogical Proofreader for Indian competitive exam portals (SSC, Railway RRB, Banking, UPSC).
Rigorously PROOFREAD, CLEAN, and STANDARDIZE the following MockTest MCQ questions.

STRICT EDITORIAL GUIDELINES:
1. STRIP ALL EXAM CITATIONS & JUNK:
   - Completely REMOVE any previous-year exam tags, shift dates, shift names, paper codes, or book citations from question texts and options!
   - Specific examples that MUST BE STRIPPED:
     * "RRB Tech. - (III) 23/12/2024 (Afternoon)"
     * "NTPC CBT - I (GL) 17/06/2025 (Afternoon)"
     * "[SSC CGL 14/07/2023 (Shift-1)]"
     * "(RRB Group D 17-08-2022 Shift 2)"
     * "(Morning)", "(Evening)", "(Shift II)", "(प्रथम पाली)", "(दोपहर)"
     * "Youth Competition Times", "Pinnacle Publication", "Platform Education", etc.
   - The question text must be STRICTLY the problem statement itself, ending with appropriate question mark (?) or period (.).

2. OCR & GRAMMAR ERROR FIXING:
   - Correct scan OCR errors (e.g., 'rn' confused with 'm', broken Hindi matras/halants, misspelled math terms).
   - Ensure clean, natural Devanagari Hindi (question_hi) and English (question_en).
   - If Hindi or English counterpart is missing or malformed, provide an accurate translation so both languages are fully populated.

3. STANDARDIZE MATHEMATICAL FORMULAS (KATEX / LATEX STANDARD):
   - DO NOT alter mathematical numerical values, variables, or the correct answer.
${STRICT_MATH_AND_TEXT_PROMPT_RULES}

4. HTML + LATEX FORMAT & COMPREHENSIVE SOLUTIONS:
   - Keep every field in the clean HTML + LaTeX format above (<p> paragraphs, real <table>/<ol> for tables and statement lists, math in $...$).
   - Ensure solutions have detailed, thorough step-by-step explanations without prefix labels like "हल:" or "Solution:".
   - NEVER mention option letters ("Option A is correct") in solutions.

INPUT ITEMS TO PROOFREAD:
${JSON.stringify(items, null, 2)}

OUTPUT:
Respond ONLY with the JSON array of proofread objects inside \`\`\`json ... \`\`\` block, preserving all schema fields.`;

    const executeProofread = async (client: any) =>
      callGeminiWithFallback(
        client,
        getPrimaryModel(),
        getFallbackModel(),
        [{ text: proofreadPrompt }],
        { temperature: 0.1, responseMimeType: 'application/json' },
        'mocktest-proofread'
      );


    const rawJson = await runAIAction(executeProofread, userKey);

    const cleaned = (rawJson || '').replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    const rawProofread = Array.isArray(parsed) ? parsed : items;
    const cleanedItems = rawProofread.map((item: any) => ({
      ...item,
      question_hi: cleanServerMocktestText(item.question_hi),
      question_en: cleanServerMocktestText(item.question_en),
      solution_hi: stripServerSolutionPrefix(cleanServerMocktestText(item.solution_hi)),
      solution_en: stripServerSolutionPrefix(cleanServerMocktestText(item.solution_en)),
      option1_hi: cleanServerMocktestText(item.option1_hi),
      option2_hi: cleanServerMocktestText(item.option2_hi),
      option3_hi: cleanServerMocktestText(item.option3_hi),
      option4_hi: cleanServerMocktestText(item.option4_hi),
      option1_en: cleanServerMocktestText(item.option1_en),
      option2_en: cleanServerMocktestText(item.option2_en),
      option3_en: cleanServerMocktestText(item.option3_en),
      option4_en: cleanServerMocktestText(item.option4_en),
    }));
    res.json({ items: cleanedItems });
  } catch (error: any) {
    console.warn("MockTest proofread failed:", error?.message || error);
    res.status(500).json({ error: error.message || "Proofread failed" });
  }
});

app.post('/api/mocktest-page-chat', requireUser, usageMiddleware('mocktest-page-chat'), async (req, res) => {
  const { pageNumber, rows, source, history, request, image, claudeModel, geminiModel } = req.body || {};
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || !Array.isArray(rows) || !Array.isArray(history) ||
    typeof request !== 'string' || !request.trim() || typeof source !== 'string' || (image && typeof image !== 'string')) {
    return res.status(400).json({ error: 'A page and a chat message are required.' });
  }
  try {
    const prompt = pageChatPrompt(pageNumber, rows, source, history, request);
    const contents = [...(image ? [{ inlineData: readInlineImage(image) }] : []), { text: prompt }];
    const raw = await runAIAction(client => callGeminiWithFallback(client, getPrimaryModel(), getFallbackModel(),
      contents, { claudeModel, geminiModel, temperature: 0.15, responseMimeType: 'application/json' }, 'mocktest-page-chat'),
      getUserKey(req), undefined, geminiModel ? 'gemini' : claudeModel ? 'claude' : undefined);
    res.json(safeParseAiJsonObject(raw));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Page chat failed.' });
  }
});

/** Every complete {"op": ...} object found in a (possibly cut-off) AI reply. */
function salvageDesignOps(raw: string): unknown[] {
  const ops: unknown[] = [];
  for (const match of raw.matchAll(/\{\s*"op"\s*:\s*"\w+"(?:[^{}\[\]]|\[[^\]]*\]|\{[^{}]*\})*\}/g)) {
    try { ops.push(JSON.parse(match[0])); } catch { /* incomplete: skip */ }
  }
  return ops;
}

// ---------------------------------------------------------------------------
// POST /api/design-chat — Design Studio: the AI answers with design operations
// (theme / block styles / pagination), never with a rewritten document.
// ---------------------------------------------------------------------------
app.post('/api/design-chat', requireUser, usageMiddleware('design-chat'), async (req, res) => {
  const { outline, theme, layout, history, request, scopePageId, fullText, part, lesson, claudeModel, geminiModel } = req.body || {};
  const outlineSize = Array.isArray(outline) ? JSON.stringify(outline).length : 0;
  if (!outlineSize || typeof request !== 'string' || !request.trim() || !theme || typeof theme !== 'object'
      || (layout !== 'document' && layout !== 'slides'))
    return res.status(400).json({ error: 'Invalid design chat request.' });
  if (outlineSize > 300_000)
    return res.status(413).json({ error: 'This document is too large to send at once. Choose "This page only" and try again.' });
  try {
    const turns: DesignChatTurn[] = (Array.isArray(history) ? history : []).slice(-12)
      .filter((t: any) => t && typeof t.text === 'string' && (t.role === 'user' || t.role === 'assistant'))
      .map((t: any) => ({ role: t.role, text: t.text.slice(0, 600) }));
    const prompt = designChatPrompt({
      outline, theme, layout, history: turns, request: request.trim().slice(0, 2000),
      scopePageId: typeof scopePageId === 'string' ? scopePageId.slice(0, 20) : undefined,
      fullText: fullText === true,
      lesson: lesson === true,
      part: typeof part === 'string' && /^\d{1,3} of \d{1,3}$/.test(part) ? part : undefined,
    });
    const raw = await runAIAction(client => callGeminiWithFallback(client, getPrimaryModel(), getFallbackModel(),
      [{ text: prompt }], { claudeModel, geminiModel, temperature: 0.3, maxOutputTokens: 8192, responseMimeType: 'application/json' }, 'design-chat'),
      getUserKey(req), undefined, geminiModel ? 'gemini' : claudeModel ? 'claude' : undefined);
    const parsed = safeParseAiJsonObject(raw);
    // A reply cut off at the token limit is not valid JSON: keep every operation that arrived complete.
    const complete = Array.isArray(parsed.ops);
    const ops = complete ? parsed.ops : salvageDesignOps(String(raw || ''));
    res.json({
      reply: typeof parsed.reply === 'string' ? parsed.reply.slice(0, 1000) : '',
      ops: ops.slice(0, 150),
      ...(!complete && { truncated: true }),
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Design chat failed.' });
  }
});

app.post('/api/figure-svg', requireUser, usageMiddleware('figure-svg'), async (req, res) => {
  const { image, claudeModel, geminiModel } = req.body || {};
  if (typeof image !== 'string' || !image) return res.status(400).json({ error: 'A figure image is required.' });
  try {
    const prompt = 'The attached image is a cropped figure (chart, graph or diagram) from an exam page. Recreate the whole figure as one static SVG. ' +
      SVG_FIGURE_INSTRUCTION + '\nIgnore watermarks and logos overlapping the figure. Read every printed label and value; for pie charts draw each sector with path arcs proportional to its value and keep the labels. ' +
      'Respond with only a JSON object {"svg": "<svg ...>...</svg>"} and use single quotes for SVG attributes. Use {"svg": null} only if the image contains no figure.';
    const raw = await runAIAction(client => callGeminiWithFallback(client, getPrimaryModel(), getFallbackModel(),
      [{ inlineData: readInlineImage(image) }, { text: prompt }],
      { claudeModel, geminiModel, temperature: 0.1, responseMimeType: 'application/json' }, 'figure-svg'),
      getUserKey(req), undefined, geminiModel ? 'gemini' : claudeModel ? 'claude' : undefined);
    const parsed = safeParseAiJsonObject(raw);
    const svg = (typeof parsed?.svg === 'string' ? parsed.svg : String(raw || '')).match(/<svg\b[\s\S]*?<\/svg>/i)?.[0];
    res.json({ svg: svg || null });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'SVG creation failed.' });
  }
});

app.post('/api/mocktest-ai-chat', requireUser, usageMiddleware('mocktest-ai-chat'), async (req, res) => {
  try {
    const { item, userPrompt, history = [] } = req.body;
    if (!item || !userPrompt) {
      return res.status(400).json({ error: "Missing item or userPrompt in request body" });
    }
    const userKey = getUserKey(req);

    // Format previous conversation history if present
    let conversationHistoryText = '';
    if (Array.isArray(history) && history.length > 0) {
      conversationHistoryText = `\nPREVIOUS CONVERSATION HISTORY:\n` +
        history.map(m => `${m.role === 'user' ? 'User' : 'AI Assistant'}: ${m.text}`).join('\n') + '\n';
    }

    const chatPrompt = `You are an elite Competitive Exam Content Architect, Master Pedagogical Author, LaTeX/Unicode Specialist, and AI Co-Pilot for MockTest Creators.
The user is having an interactive chat with you to inspect, modify, refine, or fix an INDIVIDUAL Multiple-Choice Question (MCQ).

CURRENT QUESTION STATE:
- Sequence: Q#${item.question_r || 1}
- Subject: ${item.subject || 'General'}
- Level: ${item.subject_level || ''}
- Question (Hindi): ${item.question_hi || ''}
- Question (English): ${item.question_en || ''}
- Option A (Hindi): ${item.option1_hi || ''}
- Option B (Hindi): ${item.option2_hi || ''}
- Option C (Hindi): ${item.option3_hi || ''}
- Option D (Hindi): ${item.option4_hi || ''}
- Option E (Hindi): ${item.option5_hi || ''}
- Option A (English): ${item.option1_en || ''}
- Option B (English): ${item.option2_en || ''}
- Option C (English): ${item.option3_en || ''}
- Option D (English): ${item.option4_en || ''}
- Option E (English): ${item.option5_en || ''}
- Correct Answer: ${item.answer || ''}
- Solution (Hindi): ${item.solution_hi || ''}
- Solution (English): ${item.solution_en || ''}
- Difficulty: ${item.difficulty_level || 'medium'}
${conversationHistoryText}
USER INSTRUCTION / REQUEST:
"${userPrompt}"

YOUR MISSION:
1. Carefully analyze what the user wants to adjust, fix, or improve for this question.
   - If user asks to change the answer: update "answer", adjust options if needed, and rewrite "solution_hi" & "solution_en" step-by-step to match the new answer.
   - If user asks to improve solution/explanation: provide a comprehensive, step-by-step pedagogical derivation with given data, formula, and step-by-step intermediate calculations so any level of student can understand clearly.
   - If user asks to improve language/translation: ensure accurate, natural Hindi & English exam phrasing.
   - If user asks about Current Affairs: STRICT 1-YEAR WINDOW ONLY! Ensure all dates, schemes, winners, ministers, or statistics are verified from the LAST 1 YEAR ONLY (within 12 months).
   - If user asks to simplify or make harder: adjust question wording and distractors accordingly.
2. STRICT RULES TO ENFORCE:
   - STRICT NO-OPTION-LETTER RULE: Options shuffle dynamically! NEVER write "सही विकल्प A/B/C/D है" or "Option A/B/C/D is correct" in "solution_hi" or "solution_en"! State facts, formulas, or calculated values directly!
   - NO filler headers like 'Key Point:', 'Detailed Explanation:', 'हल:', 'Solution:'.
${STRICT_MATH_AND_TEXT_PROMPT_RULES}
3. Generate a friendly, concise, and helpful "reply" in the user's language (Hindi or English) explaining exactly what you changed or improved.

OUTPUT FORMAT:
Respond with ONLY a strict JSON object:
{
  "updatedItem": {
    "question_hi": "...",
    "question_en": "...",
    "option1_hi": "...",
    "option2_hi": "...",
    "option3_hi": "...",
    "option4_hi": "...",
    "option5_hi": "...",
    "option1_en": "...",
    "option2_en": "...",
    "option3_en": "...",
    "option4_en": "...",
    "option5_en": "...",
    "answer": "A",
    "solution_hi": "...",
    "solution_en": "...",
    "subject": "${item.subject || 'General'}",
    "difficulty_level": "easy | medium | hard"
  },
  "reply": "Concise summary of changes made"
}`;

    const executeChat = async (client: any) =>
      callGeminiWithFallback(
        client,
        getPrimaryModel(),
        getFallbackModel(),
        [{ text: chatPrompt }],
        { temperature: 0.25, responseMimeType: 'application/json' },
        'mocktest-ai-chat'
      );


    const rawJson = await runAIAction(executeChat, userKey);
    const parsed = safeParseAiJsonObject(rawJson);
    const updated = (parsed.updatedItem && typeof parsed.updatedItem === "object") ? parsed.updatedItem : parsed;
    const reply = parsed.reply || "प्रश्न को आपके निर्देशानुसार सफलतापूर्वक अपडेट कर दिया गया है।";

    // Deep sanitize fields
    const sanitizedUpdatedItem = {
      ...item,
      ...updated,
      question_hi: cleanServerMocktestText(updated.question_hi || item.question_hi),
      question_en: cleanServerMocktestText(updated.question_en || item.question_en),
      option1_hi: cleanServerMocktestText(updated.option1_hi || item.option1_hi),
      option2_hi: cleanServerMocktestText(updated.option2_hi || item.option2_hi),
      option3_hi: cleanServerMocktestText(updated.option3_hi || item.option3_hi),
      option4_hi: cleanServerMocktestText(updated.option4_hi || item.option4_hi),
      option5_hi: cleanServerMocktestText(updated.option5_hi || item.option5_hi),
      option1_en: cleanServerMocktestText(updated.option1_en || item.option1_en),
      option2_en: cleanServerMocktestText(updated.option2_en || item.option2_en),
      option3_en: cleanServerMocktestText(updated.option3_en || item.option3_en),
      option4_en: cleanServerMocktestText(updated.option4_en || item.option4_en),
      option5_en: cleanServerMocktestText(updated.option5_en || item.option5_en),
      solution_hi: stripServerSolutionPrefix(cleanServerMocktestText(updated.solution_hi || item.solution_hi)),
      solution_en: stripServerSolutionPrefix(cleanServerMocktestText(updated.solution_en || item.solution_en)),
      answer: (updated.answer || item.answer || '').trim()
    };

    res.json({
      updatedItem: sanitizedUpdatedItem,
      reply
    });
  } catch (error: any) {
    console.warn("MockTest AI chat failed:", error?.message || error);
    res.status(500).json({ error: error.message || "AI Chat failed" });
  }
});

app.post('/api/mocktest-add-question', requireUser, usageMiddleware('mocktest-add-question'), async (req, res) => {
  try {
    const { 
      text = '', 
      base64Image = '', 
      setName = 'Mock Test Paper', 
      targetPageNumber = 1, 
      nextQuestionNumber = 1, 
      difficulty = 'medium',
      instruction = '',
      optionCount = 4
    } = req.body;

    const optCount = Number(optionCount) === 5 ? 5 : 4;

    if (!text.trim() && !base64Image) {
      return res.status(400).json({ error: "Please provide either question text, an instruction, or an image/screenshot." });
    }

    const userKey = getUserKey(req);

    let cleanBase64 = '';
    if (base64Image) {
      cleanBase64 = base64Image.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '').trim();
    }

    const prompt = `You are an elite Competitive Exam Paper Architect and MCQ Digitizer.
The user wants to add a NEW Multiple-Choice Question (MCQ) to their test paper.

INPUT PROVIDED:
- Text / Question Prompt: ${text.trim() || '(No raw text provided; please extract from the attached screenshot/image)'}
- Custom Instructions: ${instruction.trim() || 'Ensure complete, high-quality bilingual MCQ with authentic options and step-by-step solution'}
- Sequence Number: Q#${nextQuestionNumber}
- Target Page: Page ${targetPageNumber}
- Difficulty Level: ${difficulty}
- Required Options Count: ${optCount} Options (${optCount === 5 ? 'A, B, C, D, and E' : 'A, B, C, and D'})

YOUR MISSION:
1. Parse the input (whether image screenshot, raw unformatted text, or prompt) and build a complete, professional exam MCQ:
   - If a screenshot/image is provided: extract the question, all options (${optCount} options: ${optCount === 5 ? 'A, B, C, D, and E' : 'A, B, C, and D'}), and figure/diagram context with high fidelity.
   - If raw text is provided: format it into clear, well-structured Hindi and English question stems and options.
   - If an instruction/topic is provided: formulate an authentic, exam-standard question with ${optCount} realistic options (${optCount === 5 ? 'A, B, C, D, and E' : 'A, B, C, and D'}).
2. BOTH Hindi and English fields MUST be fully populated!
3. Accurately deduce and verify the SINGLE CORRECT ANSWER (${optCount === 5 ? '"A", "B", "C", "D", or "E"' : '"A", "B", "C", or "D"'}).
4. Formulate an IN-DEPTH, STEP-BY-STEP PEDAGOGICAL SOLUTION in BOTH Hindi and English:
   - Math/Numericals: State given data ("दिया गया है / Given that:"), LaTeX formula ($...$), complete step-by-step intermediate calculation without skipping steps so any level of student can follow easily, conclude with final value with units.
   - Reasoning: Core rule/logic, full step-by-step pattern verification for each term, conclusion.
   - GK/Polity/History/Geography/Science: Full factual background + 3-5 connected high-yield exam points.
   - Language: Grammar rule/meaning + usage example.
5. STRICT NO-OPTION-LETTER RULE (CRITICAL FOR SHUFFLED OPTIONS):
   - Options shuffle dynamically in mock test portals!
   - YOU MUST NEVER mention option letters (A, B, C, D, E) or option numbers in solution_hi or solution_en! (e.g. NEVER write "सही विकल्प A है" or "Option B is correct").
   - State the factual name, term, formula, or calculated value directly!
6. CRITICAL CURRENT AFFAIRS RULE (STRICT LAST 1-YEAR WINDOW ONLY):
   - If the question belongs to Current Affairs, contemporary government schemes, national initiatives, sports tournaments, awards, summits, appointments, union budget, or recent GK:
   - The data, events, facts, schemes, and statistics MUST STRICTLY BE FROM THE LAST 1 YEAR ONLY (within the last 12 months)! Outdated 2-5 year old data is strictly forbidden.
${STRICT_MATH_AND_TEXT_PROMPT_RULES}

OUTPUT FORMAT:
Respond with ONLY a strict JSON object:
{
  "item": {
    "question_r": ${nextQuestionNumber},
    "question_type": "MCQ",
    "question_hi": "...",
    "question_en": "...",
    "option1_hi": "...",
    "option2_hi": "...",
    "option3_hi": "...",
    "option4_hi": "...",
    "option5_hi": "${optCount === 5 ? 'Option E Hindi text' : ''}",
    "option1_en": "...",
    "option2_en": "...",
    "option3_en": "...",
    "option4_en": "...",
    "option5_en": "${optCount === 5 ? 'Option E English text' : ''}",
    "answer": "A",
    "solution_hi": "...",
    "solution_en": "...",
    "subject": "Current Affairs | Mathematics | Reasoning | General Science | Polity | History | Geography | English | Hindi",
    "subject_level": "RRB Level 01 Stage I 2025",
    "difficulty_level": "${difficulty}",
    "source_pages": "${targetPageNumber}",
    "source_question_reference": "Q.${nextQuestionNumber} (Added)",
    "correction_notes": "Added via AI Quick Add / Paste"
  },
  "summary": "Short 1-line summary in Hindi explaining the question added"
}`;

    const executeAdd = async (client: any) => {
      const contents: any[] = [];
      if (cleanBase64) {
        contents.push({
          inlineData: {
            ...readInlineImage(cleanBase64)
          }
        });
      }
      contents.push({ text: prompt });
      return callGeminiWithFallback(
        client,
        getPrimaryModel(),
        getFallbackModel(),
        contents,
        { temperature: 0.25, responseMimeType: 'application/json' },
        'mocktest-add-question'
      );
    };


    const rawJson = await runAIAction(executeAdd, userKey);
    const parsedObj = safeParseAiJsonObject(rawJson);
    const rawItem = (parsedObj.item && typeof parsedObj.item === "object") ? parsedObj.item : parsedObj;
    const summary = parsedObj.summary || (rawItem !== parsedObj ? rawItem.summary : "") || "नया प्रश्न सफलतापूर्वक तैयार कर लिया गया है।";

    const sanitizedItem = {
      id: `mt_ai_added_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      pageNumber: Number(targetPageNumber) || 1,
      question_r: Number(nextQuestionNumber) || 1,
      question_type: rawItem.question_type || 'MCQ',
      question_hi: cleanServerMocktestText(rawItem.question_hi || ''),
      question_en: cleanServerMocktestText(rawItem.question_en || ''),
      option1_hi: cleanServerMocktestText(rawItem.option1_hi || ''),
      option2_hi: cleanServerMocktestText(rawItem.option2_hi || ''),
      option3_hi: cleanServerMocktestText(rawItem.option3_hi || ''),
      option4_hi: cleanServerMocktestText(rawItem.option4_hi || ''),
      option5_hi: cleanServerMocktestText(rawItem.option5_hi || ''),
      option1_en: cleanServerMocktestText(rawItem.option1_en || ''),
      option2_en: cleanServerMocktestText(rawItem.option2_en || ''),
      option3_en: cleanServerMocktestText(rawItem.option3_en || ''),
      option4_en: cleanServerMocktestText(rawItem.option4_en || ''),
      option5_en: cleanServerMocktestText(rawItem.option5_en || ''),
      solution_hi: stripServerSolutionPrefix(cleanServerMocktestText(rawItem.solution_hi || '')),
      solution_en: stripServerSolutionPrefix(cleanServerMocktestText(rawItem.solution_en || '')),
      answer: (rawItem.answer || 'A').trim().toUpperCase(),
      set_name: setName,
      difficulty_level: rawItem.difficulty_level || difficulty || 'medium',
      test_date: '',
      subject: (rawItem.subject || 'Current Affairs').trim(),
      subject_level: rawItem.subject_level || '',
      figure_notes: rawItem.figure_notes || '',
      correction_notes: rawItem.correction_notes || 'Added via AI Quick Add / Paste',
      source_pdf: '',
      source_pages: String(targetPageNumber),
      source_question_reference: rawItem.source_question_reference || `Q.${nextQuestionNumber} (Added)`,
      latex_check: 'checked',
      html_check: 'checked',
      answer_check: 'checked',
      solution_check: 'checked',
      hash_figure: '',
      manually_review: 'checked',
      duplicate_statistics: 'Unique added question'
    };

    res.json({
      item: sanitizedItem,
      summary
    });
  } catch (error: any) {
    console.warn("MockTest Add Question failed:", error?.message || error);
    res.status(500).json({ error: error.message || "Failed to add question with AI" });
  }
});

app.post('/api/latex/repair', requireUser, usageMiddleware('latex-repair'), async (req, res) => {
  try {
    const { content, contentType = 'content', selectedFormula, item, scope } = req.body;
    const userKey = getUserKey(req);

    // Scope-level item repair (Entire MCQ, Question, Options, Solution)
    if (item && typeof item === 'object') {
      const { repairedItem, result } = await repairEntireMcqItem(
        item,
        scope || 'entire_mcq',
        userKey,
        runAIAction,
        callGeminiWithFallback,
        getPrimaryModel(),
        getFallbackModel()
      );
      return res.json({
        ...result,
        repairedItem
      });
    }

    // Single content string repair
    const contentToRepair = content || req.body.text || '';
    if (typeof contentToRepair !== 'string' || !contentToRepair.trim()) {
      return res.status(400).json({ error: "Missing 'content' or 'item' in request body." });
    }

    const result = await repairContentLatex(
      contentToRepair,
      contentType,
      selectedFormula,
      userKey,
      runAIAction,
      callGeminiWithFallback,
      getPrimaryModel(),
      getFallbackModel()
    );

    return res.json(result);
  } catch (error: any) {
    console.error('[API /api/latex/repair] Error:', error);
    res.status(500).json({
      status: 'review_required',
      original: req.body?.content || '',
      repaired: req.body?.content || '',
      changes: [`Error processing repair: ${error?.message || 'Internal server error'}`],
      confidence: 0,
      error: error?.message || 'Failed to repair LaTeX'
    });
  }
});

// -------------------------------------------------------------
// Endpoint: Upload & Store Cropped Question/Option Figure Images
// (requireStorageUser replaced by requireUser from api/auth.ts)
// -------------------------------------------------------------

registerQuestionBank(app);

app.post('/api/question-sheet', requireUser, async (req, res) => {
  try {
    const uid = (res.locals as any).user?.uid;
    const result = await saveQuestions(uid, req.body.questions, req.body.setName);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Google Sheets save failed.' });
  }
});

app.post('/api/upload-figure', requireUser, async (req, res) => {
  try {
    const { imageData, svg, filename } = req.body;
    if (typeof imageData !== 'string' || imageData.length > 16_000_000 ||
        !/^data:image\/(?:png;base64,iVBORw0KGgo|jpeg;base64,\/9j\/)[a-zA-Z0-9+/]*={0,2}$/.test(imageData) ||
        (svg != null && (typeof svg !== 'string' || svg.length > 100000 || !/^\s*<svg\b/.test(svg))))
      return res.status(400).json({ error: 'Invalid figure or file too large.' });
    const name = typeof filename === 'string' ? filename.slice(0, 180) : 'figure-' + crypto.randomUUID();
    const destination = res.locals.user.uid === 'anonymous' ? undefined : await personalImages(res.locals.user.uid);
    return res.json(await uploadDriveFigure(imageData, name, svg, destination));
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : 'Drive upload failed.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/me — own status, limit, used today
// ---------------------------------------------------------------------------
app.get('/api/me', async (req, res) => {
  const user = await verifyUser(req);
  if (!user || !user.uid) {
    return res.status(401).json({ error: 'Sign in to continue.', code: 'auth_required' });
  }

  res.set('Cache-Control', 'private, no-store');
  await upsertAppUser(user);
  const { istToday } = await import('./usage.js');
  const today = istToday();
  let status = 'active';
  let daily_limit: number | null = null;
  let used = 0;
  let blocked_reason: string | null = null;

  if (adminDb) {
    try {
      const { data: access } = await adminDb
        .from('user_access')
        .select('status, daily_limit, blocked_reason')
        .eq('uid', user.uid)
        .maybeSingle();
      if (access) {
        status = access.status || 'active';
        daily_limit = access.daily_limit;
        blocked_reason = access.blocked_reason;
      }

      if (daily_limit == null) {
        daily_limit = await getDefaultDailyLimit();
      }

      const { data: dailyRows } = await adminDb
        .from('usage_daily')
        .select('requests, errors')
        .eq('uid', user.uid)
        .eq('day', today)
        .eq('engine', 'server');
      if (dailyRows) {
        for (const r of dailyRows) {
          used += (r.requests || 0) - (r.errors || 0);
        }
      }
    } catch (err) {
      console.warn('[/api/me] DB query failed:', err);
    }
  }

  // Plan state, so the app can show the balance and lock itself when there is no usable plan
  const plansRequired = await getPlansRequired();
  const isAdmin = user.email_verified && isAdminEmail(user.email);
  const access = await loadAccess(user.uid);

  res.json({
    uid: user.uid,
    email: user.email,
    name: user.name,
    picture: user.picture,
    status,
    daily_limit,
    used,
    blocked_reason: status === 'blocked' ? blocked_reason : undefined,
    plans_required: plansRequired,
    plan: access.plan || null,
    plan_state: plansRequired && !isAdmin ? planDenial(access) || 'ok' : 'ok',
    support_whatsapp: await getSupportWhatsapp(),
  });
});

// ---------------------------------------------------------------------------
// POST /api/usage/event — client-reported bridge/own-key run
// ---------------------------------------------------------------------------
app.post('/api/usage/event', requireUser, async (req, res) => {
  const user: VerifiedUser = (res.locals as any).user;
  const result = await recordClientEvent(user.uid, req.body);
  if (result.ok) {
    res.json({ ok: true });
  } else {
    res.status(400).json({ error: result.error });
  }
});

export default app;
