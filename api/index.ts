import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { NumberingStyle } from '../types.js';
import fs from 'fs';
import path from 'path';
import {
  stripExamTagsAndJunk,
  cleanMocktestText,
  stripOptionLetterReferences,
  stripSolutionPrefix,
  prepareAiJsonString,
  safeParseAiJson,
  safeParseAiJsonObject
} from '../services/textCleanService.js';
import {
  repairContentLatex,
  repairEntireMcqItem,
  validateAndExtractLatex
} from './latexRepair.js';

try {
  process.loadEnvFile();
} catch (e) {}

export const getPrimaryModel = (): string => {
  return 'gemini-2.5-flash';
};

export const getFallbackModel = (): string => {
  return 'gemini-2.5-flash';
};

const app = express();
app.use(express.json({ limit: '50mb' }));

app.get('/api/config', (req, res) => {
  try {
    const { totalKeys } = getGeminiClient();
    res.json({
      totalKeys,
      model: getPrimaryModel(),
      fallbackModel: getFallbackModel()
    });
  } catch (error) {
    res.json({
      totalKeys: 0,
      model: getPrimaryModel(),
      fallbackModel: getFallbackModel()
    });
  }
});

app.get('/api/debug-key', (req, res) => {
  const k = process.env.GEMINI_API_KEY || '';
  res.json({ key: k, length: k.length });
});

let roundRobinIndex = 0;

interface KeyHealthMetrics {
  lastErrorTime: number;
  lastSuccessTime: number;
  consecutiveErrors: number;
  totalErrors: number;
  totalSuccesses: number;
  cooldownUntil: number;
  errorType?: string;
}

const keyHealth = new Map<string, KeyHealthMetrics>();
const deadKeys = new Set<string>();

const FALLBACK_KEYS: string[] = [];

/**
 * Returns all active keys, combining user-provided keys with server-side keys.
 * userKeys take priority if provided.
 */
const getAllKeys = (userKeyInput?: string): string[] => {
  try {
    process.loadEnvFile();
  } catch(e) {}

  let primaryKey = process.env.GEMINI_API_KEY;
  let keysString = process.env.GEMINI_API_KEYS || '';

  // Direct read from .env if process.env is empty
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
  
  // Parse server pool keys
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

  // Parse user-supplied keys from request headers/settings
  const userKeys: string[] = [];
  if (userKeyInput && typeof userKeyInput === 'string') {
    const parsed = userKeyInput
      .split(/[,\n]+/)
      .map(k => k.trim().replace(/['"\s]/g, ''))
      .filter(k => k && k.length > 20);
    userKeys.push(...parsed);
  }

  // Combine: user keys first, then all server keys, removing duplicates and dead keys
  const combined: string[] = [];
  for (const k of [...userKeys, ...serverKeys, ...FALLBACK_KEYS]) {
    if (!combined.includes(k) && !deadKeys.has(k)) {
      combined.push(k);
    }
  }

  return combined;
};

// Admin Auth Middleware
const checkAdminAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'password123';

  if (!authHeader) {
    return res.status(401).json({ error: "Authorization required" });
  }

  const encoded = authHeader.split(' ')[1];
  const decoded = Buffer.from(encoded, 'base64').toString().split(':');
  const user = decoded[0];
  const pass = decoded[1];

  if (user === adminUser && pass === adminPass) {
    next();
  } else {
    res.status(403).json({ error: "Invalid credentials" });
  }
};

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'password123';

  if (username === adminUser && password === adminPass) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "Invalid username or password" });
  }
});

app.get('/api/admin/stats', checkAdminAuth, (req, res) => {
  const allKeys = getAllKeys();
  const stats = allKeys.map(k => {
    const health = keyHealth.get(k) || { 
      lastErrorTime: 0, 
      lastSuccessTime: 0, 
      consecutiveErrors: 0, 
      totalErrors: 0, 
      totalSuccesses: 0 
    };
    return {
      keyPrefix: k.substring(0, 8) + '...',
      key: k,
      ...health,
      isDead: deadKeys.has(k)
    };
  });
  
  // Also include dead keys
  const deadStats = Array.from(deadKeys).map(k => {
    const health = keyHealth.get(k) || { lastErrorTime: 0, lastSuccessTime: 0, consecutiveErrors: 0, totalErrors: 0, totalSuccesses: 0 };
    return {
      keyPrefix: k.substring(0, 8) + '...',
      key: k,
      ...health,
      isDead: true
    };
  });

  res.json({ keys: stats, deadKeys: deadStats });
});

app.post('/api/admin/dead-key', checkAdminAuth, (req, res) => {
  const { key } = req.body;
  if (key) {
    deadKeys.add(key);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: "Key required" });
  }
});

const getGeminiClient = (skipKeys: Set<string> | string[] = [], userKeyInput?: string) => {
  const allKeys = getAllKeys(userKeyInput);
  const now = Date.now();
  const skipSet = skipKeys instanceof Set ? skipKeys : new Set(skipKeys);

  if (allKeys.length === 0) {
    throw new Error("No valid API keys found. Please verify your keys in .env (GEMINI_API_KEYS) or Settings menu.");
  }

  // 1. Available candidate keys not yet tried in this request sequence
  let candidates = allKeys.filter(k => !skipSet.has(k));

  // If all keys have been attempted once in this sequence, reset candidates to all active keys
  if (candidates.length === 0) {
    candidates = allKeys;
  }

  // 2. Filter candidate keys not currently under temporary cooldown
  const availableHealthy = candidates.filter(k => {
    const health = keyHealth.get(k);
    if (!health) return true;
    return now >= health.cooldownUntil;
  });

  let selectedKey = '';
  let waitNeededMs = 0;

  if (availableHealthy.length > 0) {
    // True Round-Robin distribution across healthy keys to spread the load evenly across all keys
    const idx = Math.abs(roundRobinIndex % availableHealthy.length);
    selectedKey = availableHealthy[idx];
    roundRobinIndex = (roundRobinIndex + 1) % 1000000;
  } else {
    // All candidates are currently under cooldown; pick the one whose cooldown expires the soonest
    const sorted = [...candidates].sort((a, b) => {
      const cdA = keyHealth.get(a)?.cooldownUntil || 0;
      const cdB = keyHealth.get(b)?.cooldownUntil || 0;
      return cdA - cdB;
    });
    selectedKey = sorted[0];
    const earliestCd = keyHealth.get(selectedKey)?.cooldownUntil || 0;
    if (earliestCd > now) {
      waitNeededMs = Math.min(earliestCd - now + 100, 15000);
    }
  }

  return { client: new GoogleGenAI({ apiKey: selectedKey }), key: selectedKey, totalKeys: allKeys.length, waitNeededMs };
};

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
  health.cooldownUntil = 0; // instantly clear cooldown on success
  health.totalSuccesses++;
  keyHealth.set(key, health);
};

const reportKeyError = (key: string, type: string, isPermanent = false, customCooldownMs?: number) => {
  if (isPermanent) {
    deadKeys.add(key);
    console.error(`[API-Key] Key ${key.substring(0, 8)}... marked as PERMANENTLY DEAD (Invalid or Denied)`);
    return;
  }
  const health = keyHealth.get(key) || { 
    lastErrorTime: 0, 
    lastSuccessTime: 0, 
    consecutiveErrors: 0, 
    totalErrors: 0, 
    totalSuccesses: 0,
    cooldownUntil: 0
  };
  const now = Date.now();
  health.lastErrorTime = now;
  health.consecutiveErrors++;
  health.totalErrors++;
  health.errorType = type;

  let cooldownMs = 5000;
  if (customCooldownMs && customCooldownMs > 0) {
    cooldownMs = customCooldownMs;
  } else if (type === 'QUOTA' || type === 'RATE_LIMIT') {
    cooldownMs = Math.min(5000 + health.consecutiveErrors * 2000, 12000);
  } else if (type === 'OVERLOAD') {
    cooldownMs = 4000;
  } else {
    cooldownMs = 2000;
  }

  health.cooldownUntil = now + cooldownMs;
  keyHealth.set(key, health);
  console.warn(`[API-Key] Key ${key.substring(0, 8)}... error: ${type}. Cooldown set for ${Math.round(cooldownMs / 1000)}s.`);
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const extractRetryDelayMs = (error: any): number => {
  if (!error) return 0;
  const msg = error?.message || String(error);
  const match = msg.match(/retry\s+(?:in|after)\s+([0-9.]+)\s*s/i);
  if (match && match[1]) {
    const sec = parseFloat(match[1]);
    if (!isNaN(sec) && sec > 0) {
      return Math.ceil(sec * 1000);
    }
  }
  if (Array.isArray(error?.details)) {
    for (const d of error.details) {
      if (d?.retryDelay) {
        const sec = parseFloat(String(d.retryDelay).replace('s', ''));
        if (!isNaN(sec) && sec > 0) {
          return Math.ceil(sec * 1000);
        }
      }
    }
  }
  return 0;
};

export async function runAIAction(
  action: (client: any) => Promise<any>, 
  userKeyInput?: string,
  maxRetries?: number
) {
  const allKeys = getAllKeys(userKeyInput);
  // Allow enough attempts to rotate across the entire key pool twice (minimum 10 attempts)
  const effectiveRetries = maxRetries ?? Math.max(10, allKeys.length * 2);
  const triedKeys = new Set<string>();
  let lastError: any = null;

  for (let attempt = 0; attempt <= effectiveRetries; attempt++) {
    // If all keys have been tried in this request, reset the set to allow a second pass
    if (triedKeys.size >= allKeys.length && allKeys.length > 0) {
      triedKeys.clear();
    }

    const { client, key, totalKeys, waitNeededMs } = getGeminiClient(triedKeys, userKeyInput);
    triedKeys.add(key);

    // If all keys are currently cooling down, wait for the earliest one to become available
    if (waitNeededMs > 0) {
      console.log(`[API-Key] All keys temporarily in rate-limit cooldown. Waiting ${waitNeededMs}ms for key ${key.substring(0, 8)}...`);
      await delay(waitNeededMs);
    }

    try {
      const result = await action(client);
      reportKeySuccess(key);
      return result;
    } catch (error: any) {
      lastError = error;
      const errorStr = (error?.message || String(error)).toUpperCase();
      
      const isQuotaError = errorStr.includes("429") || 
                           errorStr.includes("RESOURCE_EXHAUSTED") ||
                           errorStr.includes("QUOTA") ||
                           errorStr.includes("LIMIT");
      
      const isServerOverloaded = errorStr.includes("503") || 
                                 errorStr.includes("500") ||
                                 errorStr.includes("UNAVAILABLE") ||
                                 errorStr.includes("FETCH FAILED") ||
                                 errorStr.includes("ECONNRESET") ||
                                 errorStr.includes("ETIMEDOUT");

      const isInvalidKey = errorStr.includes("API KEY NOT VALID") || 
                           errorStr.includes("PERMISSION_DENIED") ||
                           errorStr.includes("API_KEY_INVALID");

      if (isInvalidKey) {
        reportKeyError(key, 'INVALID', true);
        // Immediately try the next key with minimal delay
        await delay(50);
        continue; 
      }

      const isRetryable = isQuotaError || 
                          isServerOverloaded || 
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

      if (isRetryable) {
        const errType = isQuotaError ? 'QUOTA' : (isServerOverloaded ? 'OVERLOAD' : 'TRANSIENT');
        const retryDelayMs = extractRetryDelayMs(error);
        const cooldownMs = retryDelayMs > 0 ? (retryDelayMs + 500) : undefined;
        reportKeyError(key, errType, false, cooldownMs);

        console.warn(`[API-Key] Key ${key.substring(0, 8)}... failed (${errType}: ${error?.message || errorStr}). Attempt ${attempt + 1}/${effectiveRetries + 1}. Rotating to next key in pool (${totalKeys} active keys).`);
        
        const remainingUntried = allKeys.filter(k => !triedKeys.has(k)).length;
        if (remainingUntried > 0) {
          // Pacing rotated attempts with 350ms prevents burst limit exhaustion
          await delay(350); 
        } else {
          // All keys in the pool have been attempted in this round. Wait for quota cooldown before next pass!
          const waitTime = retryDelayMs > 0 ? (retryDelayMs + 500) : 6000;
          console.log(`[API-Key] All ${allKeys.length} keys attempted in this round. Waiting ${waitTime}ms before next cycle...`);
          await delay(waitTime);
        }
        continue;
      }
      
      throw error;
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
 * Strictly calls gemini-2.5-flash only.
 * Throws a retryable error if model produces empty output, so runAIAction can retry with a different key.
 */
export const callGeminiWithFallback = async (
  client: any,
  _primaryModel: string,
  _fallbackModel: string,
  contents: any[],
  config: Record<string, any> = {},
  label = 'AI call'
): Promise<string> => {
  // STRICT: User mandated using ONLY gemini-2.5-flash
  const modelToUse = 'gemini-2.5-flash';

  const response = await client.models.generateContent({
    model: modelToUse,
    contents,
    config
  });
  const text = safeExtractResponseText(response);
  if (text) {
    return text;
  }

  throw new Error(`[${label}] Model ${modelToUse} returned empty output.`);
};

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
  const examRegex = new RegExp(`\\b${examPattern}`, 'i');

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
  userKey?: string
): Promise<any> => {
  const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');

  let numberingInstruction = '';
  switch (numberingStyle) {
    case NumberingStyle.Q_DOT:
      numberingInstruction = 'Replace the question number (e.g., "1.", "Q.1", "23.", "Q12.") at the start of a question with "Q" followed by the number and a dot (e.g., "Q1.", "Q23.").';
      break;
    case NumberingStyle.HASH:
      numberingInstruction = 'Replace the question number (e.g., "1.", "Q.1", "23.", "Q12.") at the start of a question with "#" followed by the number and a dot (e.g., "#1.", "#23.").';
      break;
    case NumberingStyle.QUESTION_DOT:
      numberingInstruction = 'Replace the question number (e.g., "1.", "Q.1", "23.", "Q12.") at the start of a question with the word "Question" followed by the number and a dot (e.g., "Question 1.", "Question 23.").';
      break;
    case NumberingStyle.NUMBER_DOT:
      numberingInstruction = 'Ensure the question number is formatted as the number followed by a dot (e.g., "1.", "23."). Remove any prefixes like "Q." or "Q".';
      break;
    default:
      numberingInstruction = 'Replace the question number at the start of a question with the number followed by a dot.';
  }

  const answerInstruction = showAnswers
    ? `**ANSWER EXTRACTION ENABLED**:
- Identify the correct answer from the paper or deduce it, and add "Answer: [Correct Option Letter]" (e.g., "Answer: C") on its own new line after the options.`
    : `**STRICT NO-ANSWER RULE (ANSWERS DISABLED)**:
- DO NOT extract, deduce, guess, or output any answers!
- Under NO circumstances should you include "Answer: ...", solutions, or answer keys.
- For each MCQ, end immediately after the last option (d).`;

  const bilingualInstruction = isBilingual
    ? `**MANDATORY BILINGUAL TRANSLATION (HINDI + ENGLISH)**:
- YOU MUST OUTPUT EVERY QUESTION AND TEXTUAL OPTION IN BOTH HINDI AND ENGLISH.
- **AUTOMATIC TRANSLATION**:
  - If the source image contains text in HINDI ONLY, you MUST translate the question text and textual options into ENGLISH!
  - If the source image contains text in ENGLISH ONLY, you MUST translate the question text and textual options into HINDI!
  - If both languages are already on the page, combine and preserve both.
- **QUESTION FORMAT (TWO-LINE FORMAT WITHOUT SLASH)**:
  Line 1: "Question: [Number]. [Hindi Question Text]" (NO forward slash / at the end)
  Line 2: "[English Question Text]"
  Example:
  Question: 1. सबसे छोटी प्राकृत संख्या कौन-सी है?
  Which is the smallest natural number?
- **OPTIONS FORMAT**: Each option on its OWN NEW LINE:
  (a) [Hindi Option] / [English Option]
  (b) [Hindi Option] / [English Option]
  (c) [Hindi Option] / [English Option]
  (d) [Hindi Option] / [English Option]
- **STRICT RULE FOR NUMBERS & FORMULAS (DO NOT DUPLICATE)**:
  - If an option is a pure number, percentage, unit, or math formula (e.g. "0", "1", "2", "3", "45%", "$$x=2$$"), write it ONLY ONCE without slash (e.g. "(a) 0", "(b) 2", "(c) 1", "(d) 3").
${showAnswers ? '- **ANSWER FORMAT**: After options, add "Answer: [Label]" (e.g. "Answer: C") on its OWN NEW LINE.' : '- **NO ANSWERS**: Do not include answers or answer lines.'}`
    : `**CRITICAL RULE: NO TRANSLATION**:
- Extract the text EXACTLY in the language it is written.
- If it is in Hindi, output ONLY Hindi.
- If it is in English, output ONLY English.
- DO NOT translate anything.`;

  const imageInstruction = includeImages 
    ? `2. **Diagrams & Figures**:
   - **PLACEMENT**: Identify diagrams (images) and place them in the 'elements' array exactly where they appear in the reading order (e.g., if a diagram is between the question text and the options, it should be placed there).
   - **DESCRIPTION**: For 'image' types, provide a concise but descriptive 'content' field explaining what the diagram shows (e.g., "Circuit diagram with resistors R1 and R2", "Geometry figure showing a triangle inside a circle").`
    : `2. **Diagrams & Figures**:
   - **DO NOT EXTRACT DIAGRAMS OR IMAGES**: Ignore all non-textual content such as diagrams, charts, and figures. Do not create any 'image' elements.`;

  const imageFormattingInstruction = includeImages
    ? `2. **Image Elements**:
   - Identify regions containing diagrams, charts, pattern series, geometry figures, or any non-textual content.
   - Provide the bounding box (bbox) for these regions in normalized coordinates [0-1000].`
    : `2. **Image Elements**:
   - **STRICTLY IGNORE**: Do not extract any image elements.`;

  const mcqInstruction = mcqMode 
    ? `**MCQ / QUESTION-SET EXTRACTION MODE**:
- This document contains Multiple Choice Questions (MCQs), practice questions, or test sets.
- Format each MCQ clearly:
  Question: 1. [Question Text]
  (a) [Option A]
  (b) [Option B]
  (c) [Option C]
  (d) [Option D]
${showAnswers ? '  Answer: [Correct Option Letter]' : ''}
- If a reading passage, comprehension text, poem, or table appears before questions, extract it completely in full markdown before the questions.`
    : `**UNIVERSAL DOCUMENT / GENERAL TEXT EXTRACTION MODE**:
- Extract ANY type of document content with 100% fidelity:
  1. **Headings & Hierarchy**: Mark document headings with markdown (# Main Heading, ## Sub-Heading, ### Section).
  2. **Paragraphs & Articles**: Maintain clean paragraphs with natural line flow. Preserve bold (**bold**) and italics (*italic*).
  3. **Tables & Matrices**: Extract tabular data into Markdown tables (| Col 1 | Col 2 |) with standard separator rows (|---|---|).
  4. **Lists & Bullet Points**: Preserve bullet points (•, -, *) and numbered lists (1., 2., a., b., i., ii.).
  5. **Math & Science**: Enclose all mathematical expressions and formulas in LaTeX double dollar signs (\`$$\\frac{a}{b}$$\`, \`$$x^2 + y^2$$\`, \`$$\\sqrt{z}$$\`).
  6. **Notes & Blockquotes**: Mark notes or callouts with \`> Note: ...\`.
  7. **Handwritten / Scanned Notes**: Transcribe accurately in natural reading order.`;

  const refineInstruction = refineMode
    ? `**REFINE MODE ENABLED (STRICT CONTENT CLEANING & FILTERING)**:
- YOUR GOAL: Extract ONLY the pure primary content.
- **STRICTLY EXCLUDE ALL EXAM METADATA & TAGS**:
  - Completely IGNORE and DO NOT extract any previous year exam details, source tags, or shift names (e.g., "(SSC CGL Tier-I (CBE) परीक्षा, 02.12.2022 Shift-II)", "(SSC CGL Tier-II (CBE) परीक्षा, 07.03.2023)", "[RRB NTPC 2021]", "(UPSC 2020)", "(CTET 2022)", shift timings, exam dates, or test series tags).
  - Do NOT attach exam tags to options or questions.
- **REMOVE JUNK & BRANDING**: Exclude book chapter names, page headers/footers, page numbers, watermarks, Telegram/website links, publisher names, exam center codes, or decorative text.
- **PRESERVE PURE CONTENT**: Extract the actual question, options, paragraphs, and tables cleanly and accurately.`
    : `**FULLY EXTRACTION MODE (A TO Z)**:
- Extract EVERY piece of text from the page, including headers, footers, page numbers, and small boilerplate text. Leave nothing out.`;

  const executeCall = async (client: any) => {
    const primaryModel = getPrimaryModel();
    const fallbackModel = getFallbackModel();
    const contents = [
      {
        inlineData: {
          mimeType: 'image/png',
          data: cleanBase64
        }
      },
      {
        text: `You are a professional Exam Paper Digitizer. Analyze the provided image and extract all elements in their correct reading order.

${bilingualInstruction}
${mcqInstruction}
${answerInstruction}
${refineInstruction}

**CRITICAL RULE: COMPLETE EXTRACTION**:
- You MUST read the ENTIRE page from top to bottom.
- Do NOT skip any questions, options, paragraphs, or text, no matter how small the font is or where it is located on the page (unless it is junk text and Refine Mode is ON).
- Ensure every single question and its options are extracted.

**OCR CONTEXT**:
Here is the raw text extracted by OCR:
"${ocrText}"
Use this as a reference to improve your accuracy, especially for math formulas and Hindi/English text.

**EXTRACTION RULES**:
1. **Text Elements**:
   - Identify distinct blocks of text (paragraphs, questions, options, headers).
   - ${numberingInstruction}
   - For multiple-choice options, ensure each option (a), (b), (c), (d) is on a separate line.
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
   - If you find a table, extract it as a 'table' type.
   - Represent the table content in Markdown format.

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
3. **Table Elements**: Provide the bbox for the entire table.

Ensure the elements in the JSON array are ordered exactly as they should be read from top to bottom, left to right.
`
        }
      ];

      const generateConfig = {
        temperature: 0.1,
        responseMimeType: "application/json",
      };

      const responseText = await callGeminiWithFallback(
        client,
        'gemini-2.5-flash',
        'gemini-2.5-flash',
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
        }
        if (isBilingual) {
          contentStr = cleanBilingualDuplicates(contentStr);
        }
        if (refineMode) {
          contentStr = cleanRefinedText(contentStr);
        }
        if (!showAnswers) {
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

  return runAIAction(executeCall, userKey);
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
      'gemini-2.5-flash',
      'gemini-2.5-flash',
      prompt,
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

app.post('/api/extract', async (req, res) => {
  try {
    const { base64Image, ocrText, numberingStyle, includeImages, isBilingual, mcqMode, refineMode, showAnswers = true } = req.body;
    const userKey = (req.headers['x-user-gemini-key'] as string) || '';
    const elements = await extractLayoutWithRetry(base64Image, ocrText, numberingStyle, includeImages, isBilingual, mcqMode, refineMode, showAnswers, userKey);
    res.json({ elements });
  } catch (error: any) {
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

app.post('/api/proofread', async (req, res) => {
  try {
    const { rawText, isBilingual } = req.body;
    const userKey = (req.headers['x-user-gemini-key'] as string) || '';
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
- MATHEMATICAL & SCIENTIFIC FORMULAS (STRICT HUMAN-LIKE LATEX STANDARD):
  * Enclose ALL math formulas, equations, variables, algebra, fractions, and square roots in standard LaTeX delimiters: $...$ for inline, $$...$$ for display equations.
  * Fractions MUST use \\frac{numerator}{denominator} (e.g. $\\frac{4}{3}$).
  * Mixed fractions MUST be enclosed entirely in $...$: e.g. "$1\\frac{7}{8}$" or "$1 \\frac{7}{8}$". NEVER leave dangling dollars like "1\\frac{7}{8}$$".
  * Powers: $x^2$, $10^{-5}$. Roots: $\\sqrt{x}$, $\\sqrt[3]{27}$.
  * Operators & symbols: $\\times$, $\\div$, $\\pm$, $\\le$, $\\ge$, $\\neq$, $\\approx$, $\\degree$, $\\alpha$, $\\beta$, $\\theta$, $\\pi$, $\\Delta$, $\\infty$.
  * CRITICAL: NEVER output naked LaTeX commands like \\frac, \\sqrt, \\times, or \\text in plain text without enclosing them in $...$!
  * CRITICAL: If you use \\text{...}, it MUST ALWAYS be inside $...$ with proper spacing: e.g. $\\text{Speed} = \\frac{\\text{Distance}}{\\text{Time}}$ or $45\\text{ litres}$.
- EQUALS SIGN & CALCULATION STEPS (CRITICAL):
  * In step-by-step calculations, each equation line starting with '=' MUST be fully wrapped in complete $$...$$ or $...$ delimiters!
    - CORRECT: "$$= 224375 \\times \\left(1 + \\frac{4}{100}\\right)^2$$"
    - CORRECT: "$$= 224375 \\times \\frac{26}{25} \\times \\frac{26}{25}$$"
    - CORRECT: "$$= 359 \\times 676 = 242684$$"
    - NEVER leave equation steps naked without $: e.g. NEVER write "= 224375\\times\\frac{26}{25}" without enclosing in $$...$$.
    - NEVER output an unclosed single dollar like "= $224375". Always close your math delimiters!
    - NEVER break a fraction or formula across HTML tags (e.g. "\\frac{4}</p><p>{100}" is strictly forbidden).
  * For inline prose sentences with math:
    - CORRECT: "अतः $x = 5000$"
    - CORRECT: "पत्नी का वेतन = $11x = 11 \\times 5000$ = ₹55,000"
    - WRONG: "पत्नी का वेतन $= 11x"
- REASONING ARROWS & SYMBOL SERIES RULE (CRITICAL):
  * For Coding-Decoding, Letter Puzzles, Series steps, or Mappings:
    ALWAYS use standard Unicode arrows: '→' or '⇒' (e.g. "FIST → 3962", "SOFT → 3562", "F → 3, I → 9", "3, 4, 5 → preceded by...").
    NEVER write LaTeX '\\rightarrow', '\\Rightarrow', or 'ightarrow'!
  * For Character / Symbol / Number Series questions (संख्या-प्रतीक श्रृंखला):
    ALWAYS use pure standard Unicode symbols: 'Ω', '*', '^', '∧', '#', '@', '&', '$', '%', '!', '?', ';'.
    NEVER output LaTeX commands like '\\Omega', '\\bigwedge', '\\wedge', '\\vee', '\\star', '\\text{ }', '\\%' or '\\!' in symbol series!
    Write the series naturally: e.g. "(बाएँ) 3 Ω 2 * £ 1 + & % 4 6 @ 8 7 U 9 # 1 @ 5 $ (दाएँ)".
    NEVER treat a literal '$' in a series as an opening/closing math delimiter!
- WORD SPACING & PLAIN TEXT RULE (CRITICAL - NEVER CONCATENATE WORDS):
  * ALWAYS maintain natural, clear spacing between words, numbers, and variables!
  * NEVER glue words to numbers or variables!
    - WRONG: "ratio of 7 : 2tomakeapaintmixture.Ifapainteruses315"
    - CORRECT: "ratio of 7 : 2 to make a paint mixture. If a painter uses 315 litres"
    - WRONG: "Letthequantityofbluepaintbe7x"
    - CORRECT: "Let the quantity of blue paint be $7x$."
    - WRONG: "2केअनुपातमैंमिलकर"
    - CORRECT: "2 के अनुपात में मिलकर"
- OPTIONS FORMATTING:
  * For options that are plain numbers, percentages, or numbers with units (e.g. "420 litres", "405 लीटर", "15 days", "20%"):
    DO NOT wrap them in dollar signs! Write clean plain text: <p>420 litres</p>, <p>405 लीटर</p>.
  * Only use LaTeX $...$ in options if the option itself is a mathematical expression (e.g. "$\\frac{3}{4}$", "$\\sqrt{2}$", "$x^2 - 4$").
- INDIAN RUPEE CURRENCY RULE (₹):
  * Indian Rupee amounts MUST be written as plain text: '₹4,800', 'Rs. 500', '₹x'.
  * NEVER wrap '₹' in dollar signs: NEVER write '$₹4,800$', '₹$4800$', or '₹x$'.`;

app.post('/api/mocktest-solve', async (req, res) => {
  try {
    const { question_hi, question_en, option1_hi, option2_hi, option3_hi, option4_hi, option1_en, option2_en, option3_en, option4_en, answer, question_type } = req.body;
    const userKey = (req.headers['x-user-gemini-key'] as string) || '';

    const qPrompt = `You are an elite Indian Competitive Exam Educator and Master Test-Series Author (specializing in SSC CGL/CHSL, Railway RRB NTPC/ALP/Group-D, Banking IBPS/SBI, UPSC, State PSC, and YCT-style exam publications).
Provide an EXAM-ORIENTED, HIGH-YIELD, MEDIUM-LENGTH PEDAGOGICAL SOLUTION tailored precisely to this question.

QUESTION CONTEXT:
Target Option / Answer: ${answer || 'Deduce correct answer'}
Question Type: ${question_type || 'MCQ'}

HINDI:
Question: ${question_hi || ''}
(A) ${option1_hi || ''}
(B) ${option2_hi || ''}
(C) ${option3_hi || ''}
(D) ${option4_hi || ''}

ENGLISH:
Question: ${question_en || ''}
(A) ${option1_en || ''}
(B) ${option2_en || ''}
(C) ${option3_en || ''}
(D) ${option4_en || ''}

CRITICAL PEDAGOGICAL GUIDELINES (YCT EXAM PUBLICATION STANDARD):
1. DYNAMIC PATTERN ACCORDING TO QUESTION DISCIPLINE (जैसा प्रश्न वैसा पैटर्न):
   - For MATHEMATICS / NUMERICALS / QUANT:
     * State given data clearly: "दिया गया है / Given that:" (e.g. A की चाल = 40 km/h...).
     * State the key formula in clean LaTeX math ($...$).
     * Show step-by-step intermediate calculation without skipping steps so even weaker students understand clearly.
     * Conclude with the final computed numerical value.
   - For REASONING / LOGIC (Puzzles, Coding-Decoding, Series, Syllogism):
     * State the core logic rule directly ("जिस प्रकार...", reverse letter positions, difference pattern).
     * Show the step-by-step pattern verification for each term or concept (e.g. K (+3) → N (-8) → F).
     * State the derived correct answer term/value directly.
   - For GENERAL KNOWLEDGE / HISTORY / POLITY / GEOGRAPHY / STATIC GK:
     * Direct Factual Context: State why the answer is correct with date, year, treaty, person, place, or Article.
     * High-Yield Connected Exam Facts: Provide 3–4 essential connected facts, treaty conditions, or mini-list.
   - For GENERAL SCIENCE (Physics, Chemistry, Biology):
     * Explain the scientific principle/reaction/mechanism directly.
     * Mention practical remedies (concave lens) or related discoveries/scientists with years.
   - For LANGUAGE (Hindi & English Grammar, Vocab, Error Spotting):
     * State the grammatical rule, tense, voice, idiom meaning, or vocabulary usage clearly.

2. ACCESSIBLE TO WEAKER STUDENTS: Use simple, lucid, and direct explanation.
3. BALANCED MEDIUM LENGTH: 3 to 6 focused lines or 3-5 structured steps/points.
4. STRICT NO-PREFIX & NO-FILLER RULE: DO NOT start with 'हल:', 'Solution:', or 'Explanation:'. DO NOT include filler labels like 'Key Point:', 'Detailed Explanation:'.
5. STRICT NO-OPTION-LETTER RULE: Options shuffle dynamically! NEVER write "सही विकल्प A है" or "Option A is correct". State facts, formulas, or calculated values directly!
${STRICT_MATH_AND_TEXT_PROMPT_RULES}
- Wrap solutions in clean semantic HTML (<p>...</p>). Use <b>...</b> for emphasis and <table>...</table> for tabular steps.

Output ONLY valid JSON:
{
  "solution_hi": "<p>दिया गया है...</p>",
  "solution_en": "<p>Given that...</p>",
  "difficulty_level": "easy" | "medium" | "hard"
}`;

    const executeSolve = async (client: any) =>
      callGeminiWithFallback(
        client,
        getPrimaryModel(),
        getFallbackModel(),
        [{ text: qPrompt }],
        { temperature: 0.15, responseMimeType: 'application/json' },
        'mocktest-solve'
      );


    const rawJson = await runAIAction(executeSolve, userKey);

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

app.post('/api/mocktest-repair-item', async (req, res) => {
  try {
    const { item } = req.body;
    if (!item) {
      return res.status(400).json({ error: "Missing question item in request body" });
    }

    const userKey = (req.headers['x-user-gemini-key'] as string) || '';

    const repairPrompt = `You are an elite competitive exam test-series architect, educator, and question digitizer (SSC CGL, Railway RRB, Banking, UPSC).
You are given an INCOMPLETE exam question item. Some fields may be blank, options may be missing or stuck at the end of the question stem, or the subject and solution may need deep pedagogical repair.

INPUT QUESTION DATA:
Subject: "${item.subject || ''}"
Question (Hindi): "${item.question_hi || ''}"
Option 1 (Hindi): "${item.option1_hi || ''}"
Option 2 (Hindi): "${item.option2_hi || ''}"
Option 3 (Hindi): "${item.option3_hi || ''}"
Option 4 (Hindi): "${item.option4_hi || ''}"
Question (English): "${item.question_en || ''}"
Option 1 (English): "${item.option1_en || ''}"
Option 2 (English): "${item.option2_en || ''}"
Option 3 (English): "${item.option3_en || ''}"
Option 4 (English): "${item.option4_en || ''}"
Answer Candidate: "${item.answer || ''}"

MANDATORY TASKS TO EXECUTE:
1. QUESTION STEM CLEANUP:
   - If options are attached at the end of the question text (e.g. "? 7 6 5 8" or "? A 7 B 6..."), STRIP THEM COMPLETELY from both 'question_hi' and 'question_en' so the question ends cleanly with the punctuation mark (e.g. '?').
   - Wrap both 'question_hi' and 'question_en' in semantic HTML (<p>...</p>).
   - If question is in only one language, translate and generate the counterpart language.
2. 4 OPTIONS (A, B, C, D) RESTORATION:
   - All 4 options MUST be fully populated in BOTH Hindi (option1_hi..option4_hi) and English (option1_en..option4_en).
   - If options were trailing in the question text, extract them into Option 1 (A), Option 2 (B), Option 3 (C), Option 4 (D).
   - If options are missing altogether, deduce and generate 4 standard, realistic exam options suitable for this question.
   - Do NOT use generic words like "Blank" or leave them empty.
3. CORRECT ANSWER DEDUCTION:
   - Solve the question rigorously. Verify or set "answer" to the exact correct option ("A", "B", "C", or "D").
4. STRICT ACADEMIC SUBJECT:
   - Select ONLY from: ["Current Affairs", "History", "Geography", "Polity", "Economics", "General Science", "Physics", "Chemistry", "Biology", "Mathematics", "Reasoning", "Computer Knowledge", "English", "Hindi", "Environment & Ecology", "Static GK"].
   - CRITICAL: Letter puzzles, word arrangements, alphabetical order questions (e.g. words like ION, EBB, PET, GET or letter counting between letters) MUST BE "Reasoning", NEVER "Chemistry" or other subjects!
5. DYNAMIC STEP-BY-STEP SOLUTION (YCT EXAM PUBLICATION PATTERN - जैसा प्रश्न वैसा पैटर्न):
   - PATTERN BY DISCIPLINE:
     * MATHEMATICS / NUMERICALS: State given data ("दिया गया है / Given that:"), write formula in standard LaTeX math ($...$), show full step-by-step intermediate calculations without skipping steps, and conclude with the calculated value.
     * REASONING / LOGIC: State the underlying rule/logic, show pattern test step-by-step for each term/option, and conclude why the option is uniquely correct.
     * GK / HISTORY / POLITY / GEOGRAPHY / STATIC GK: State direct factual context followed by 3–4 high-yield connected exam facts or mini-list.
     * GENERAL SCIENCE: State scientific principle/reaction/mechanism directly and provide practical remedies or related discoverers.
     * LANGUAGE: State grammar rule, meaning, or usage clearly.
   - ACCESSIBLE TO WEAKER STUDENTS: Use simple, lucid language. Explain each intermediate step clearly.
   - BALANCED MEDIUM LENGTH: 3 to 6 focused lines or 3-5 structured steps/points.
   - STRICT NO-PREFIX & NO-FILLER RULE: DO NOT start with 'हल:', 'Solution:', or 'Explanation:'! NEVER include filler labels like 'Key Point:'!
   - STRICT NO-OPTION-LETTER RULE: Options shuffle dynamically! NEVER mention option letters (A, B, C, D) in solution!
${STRICT_MATH_AND_TEXT_PROMPT_RULES}
   - Wrap all questions, options, and explanations in semantic HTML (<p>...</p>).
6. DIFFICULTY LEVEL:
   - 'easy' | 'medium' | 'hard'.

Respond ONLY with a valid JSON object:
{
  "question_hi": "<p>...</p>",
  "question_en": "<p>...</p>",
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
  "solution_hi": "<p>दिया गया है...</p>",
  "solution_en": "<p>Given that...</p>"
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

app.post('/api/mocktest-reverify', async (req, res) => {
  try {
    const { item, primaryImage, secondaryImage, missingFields } = req.body;
    if (!item) {
      return res.status(400).json({ error: "Missing question item in request body" });
    }
    const userKey = (req.headers['x-user-gemini-key'] as string) || '';

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
   - Wrap fields in semantic HTML (<p>...</p>).
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

app.post('/api/mocktest-extract', async (req, res) => {
  try {
    const { base64Image, setName = 'Exam Paper', pendingContext, pageNumber, generateSimilar = false } = req.body;
    const userKey = (req.headers['x-user-gemini-key'] as string) || '';

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
      promptText = `You are an elite Competitive Exam Test-Series Architect, Question Creator, and Educator (SSC CGL, Railway RRB, Banking, UPSC, State PSC).

CRITICAL MISSION - REFERENCE-ONLY MODE (DO NOT REPRODUCE VERBATIM QUESTIONS):
- The attached exam page image contains questions that you MUST USE AS REFERENCE AND CONCEPT BLUEPRINT ONLY!
- ABSOLUTELY DO NOT copy, transcribe, or extract the exact questions from this image!
- "SAME TO SAME" OR VERBATIM QUESTIONS ARE STRICTLY FORBIDDEN!
- For each question visible on the page:
  1. Deeply analyze its core academic subject, topic, concept, mathematical formula, difficulty level, and reasoning pattern.
  2. GENERATE A BRAND NEW, UNIQUE PRACTICE MCQ based on that underlying topic/concept:
     * For Math / Quant / Science: Create a fresh problem testing the same mathematical theorem or formula, but with COMPLETELY DIFFERENT numbers, variables, values, and scenarios. Ensure the values calculate cleanly.
     * For GK / GS / History / Polity / Geography: Test the same historical period, constitutional article/concept, geographical feature, or scientific phenomenon with a FRESH, DISTINCT QUESTION.
     * For Current Affairs / Contemporary GK: STRICT 1-YEAR WINDOW ONLY! Any question based on current affairs, government schemes, awards, sports, summits, appointments, or budget MUST STRICTLY use researched, verified events and data from the LAST 1 YEAR ONLY (within the last 12 months)! NEVER use outdated 2-5 year old data.
     * For Reasoning / Logic: Create a new puzzle, series, syllogism, or coding-decoding problem following the identical logic/pattern but with NEW letters, words, or arrangements.
     * For English / Hindi Language: Test the same grammatical concept or vocabulary standard using DIFFERENT sentences and context.
  3. Formulate 4 completely fresh, plausible options (A, B, C, D) with authentic distractors.
  4. Rigorously solve and verify the SINGLE CORRECT ANSWER ("A", "B", "C", or "D").
  5. Provide an exhaustive, step-by-step pedagogical solution in BOTH Hindi (<p>...</p>) and English (<p>...</p>).
  6. Set "source_question_reference" to "Ref-Q.X (Variant)" where X corresponds to the reference question sequence on the page.

${carryOverPrompt}

Extract into a strict JSON array of objects with these exact 34 fields:
1. question_r: Sequence number (1, 2, 3...)
2. question_hi: Brand new question in Hindi wrapped in semantic HTML (<p>...</p>) with standard KaTeX/LaTeX math ($...$ for inline formulas, $$...$$ for display equations) and clean HTML markup.
3. option1_hi: Option 1 (A) in Hindi wrapped in <p>...</p> (with KaTeX $...$ if mathematical formula).
4. option2_hi: Option 2 (B) in Hindi wrapped in <p>...</p> (with KaTeX $...$ if mathematical formula).
5. option3_hi: Option 3 (C) in Hindi wrapped in <p>...</p> (with KaTeX $...$ if mathematical formula).
6. option4_hi: Option 4 (D) in Hindi wrapped in <p>...</p> (with KaTeX $...$ if mathematical formula).
7. option5_hi: Option 5 (E) in Hindi (empty string if 4 options)
8. solution_hi: DYNAMIC STEP-BY-STEP SOLUTION in Hindi formatted in clean HTML (<p>...</p>) with full KaTeX/LaTeX math adhering strictly to the YCT Exam Publication Pattern (जैसा प्रश्न वैसा पैटर्न). NO 'हल:' or 'उत्तर:' prefix. NO filler labels!
9. question_en: Brand new question in English wrapped in semantic HTML (<p>...</p>) with standard KaTeX/LaTeX math ($...$ for inline formulas, $$...$$ for display equations) and clean HTML markup.
10. option1_en: Option 1 (A) in English wrapped in <p>...</p> (with KaTeX $...$ if mathematical formula).
11. option2_en: Option 2 (B) in English wrapped in <p>...</p> (with KaTeX $...$ if mathematical formula).
12. option3_en: Option 3 (C) in English wrapped in <p>...</p> (with KaTeX $...$ if mathematical formula).
13. option4_en: Option 4 (D) in English wrapped in <p>...</p> (with KaTeX $...$ if mathematical formula).
14. option5_en: Option 5 (E) in English (empty string if 4 options)
15. solution_en: DYNAMIC STEP-BY-STEP SOLUTION in English formatted in clean HTML (<p>...</p>) with full KaTeX/LaTeX math adhering strictly to the YCT Exam Publication Pattern (जैसा प्रश्न वैसा पैटर्न). NO 'Solution:' or 'Explanation:' prefix. NO filler labels!
16. answer: Correct answer identifier: Single choice "A", "B", "C", "D".
17. set_name: "${setName}"
18. difficulty_level: "Easy", "Medium", or "Hard"
19. test_date: Test date in YYYY-MM-DD if present, else empty string ""
20. test_time: Test time if present, else empty string ""
21. subject: STRICT ACADEMIC SUBJECT ONLY! (e.g. "Current Affairs", "History", "Geography", "Polity", "Economics", "General Science", "Physics", "Chemistry", "Biology", "Mathematics", "Reasoning", "Computer Knowledge", "English", "Hindi"). NEVER put exam name/stage/shift in subject!
22. subject_level: Exam level/stage (e.g. "RRB Level 01 Stage I 2025")
23. figure_notes: Figure notes or empty string ""
24. correction_notes: "Generated from reference question concept"
25. source_pdf: Source PDF file name if known, else empty string ""
26. source_pages: Source page number(s), e.g. "${pageNumber || '1'}"
27. source_question_reference: e.g. "Ref-Q.1 (Variant)"
28. latex_check: "checked"
29. html_check: "checked"
30. answer_check: "checked"
31. solution_check: "checked"
32. hash_figure: ""
33. manually_review: "checked"
34. duplicate_statistics: "Unique generated variant based on reference concept."

RULES & YCT SOLUTION GUIDELINES (जैसा प्रश्न वैसा पैटर्न):
- STRICT RULE: DO NOT duplicate the reference questions! Create fresh, original questions.
- CRITICAL CURRENT AFFAIRS RULE (STRICT LAST 1-YEAR DATA ONLY):
  * For any question on Current Affairs, Government Schemes, Union Budget, Appointments, Sports Championships, or Summits:
  * YOU MUST STRICTLY USE RESEARCHED, FACTUALLY ACCURATE DATA FROM THE LAST 1 YEAR ONLY (within the last 12 months)!
  * Outdated 2-5 year old events or obsolete data are STRICTLY FORBIDDEN!
- STRICT NO-OPTION-LETTER RULE (CRITICAL FOR SHUFFLED OPTIONS):
  * In online test series and mock portals, options are SHUFFLED dynamically.
  * NEVER write "सही विकल्प A/B/C/D है" or "Option A/B/C/D is correct" in the solution!
  * State the facts, formulas, or calculated values directly! (e.g. "'खेलो इंडिया मिशन ढांचा' को लॉन्च किया गया था।", "अतः समय = 160 मिनट।").
- Both Hindi and English fields MUST be fully populated.
- DYNAMIC SOLUTION PATTERN:
  * For Math/Numericals: State given data ("दिया गया है / Given that:"), write formula in standard LaTeX math ($...$), show complete step-by-step intermediate calculation without skipping steps so weaker students understand clearly, conclude with final value.
  * For Reasoning: State underlying logic/rule, test step-by-step for each term/option, conclude why option is uniquely correct.
  * For GK/Polity/History/Geography: State direct factual context (date, treaty, person, place, or Article) + 3–4 high-yield connected exam facts or mini-list.
  * For Science: State scientific law/cause + practical remedies or discoverers.
  * For Language: State grammar rule, meaning, or usage clearly.
- ACCESSIBLE TO WEAKER STUDENTS: Simple, clear, and direct language.
- BALANCED MEDIUM LENGTH: 3 to 6 focused lines or 3-5 structured steps/points.
- STRICT NO-PREFIX & NO-FILLER RULE: DO NOT start with 'हल:', 'Solution:', or 'Explanation:'. DO NOT include filler labels like 'Key Point:', 'Detailed Explanation:', 'Additional Information:', or 'Important Exam Point:'.
${STRICT_MATH_AND_TEXT_PROMPT_RULES}
- Wrap all questions, options, and explanations in semantic HTML <p>...</p>.
- Respond ONLY with the JSON array.`;
    } else {
      promptText = `You are a professional Exam Paper Digitizer and MockTest Content Architect.
Extract ALL multiple-choice questions (MCQs), multiple-select questions (MSQs), and numerical questions (NAT) from this image.${carryOverPrompt}

Extract into a strict JSON array of objects with these exact 34 fields:
1. question_r: Sequence number (1, 2, 3...)
2. question_hi: Question in Hindi wrapped in semantic HTML (<p>...</p>) with standard KaTeX/LaTeX math ($...$ for inline formulas, $$...$$ for display equations) and clean HTML markup.
3. option1_hi: Option 1 (A) in Hindi wrapped in <p>...</p> (with KaTeX $...$ if mathematical formula).
4. option2_hi: Option 2 (B) in Hindi wrapped in <p>...</p> (with KaTeX $...$ if mathematical formula).
5. option3_hi: Option 3 (C) in Hindi wrapped in <p>...</p> (with KaTeX $...$ if mathematical formula).
6. option4_hi: Option 4 (D) in Hindi wrapped in <p>...</p> (with KaTeX $...$ if mathematical formula).
7. option5_hi: Option 5 (E) in Hindi (empty string if 4 options)
8. solution_hi: DYNAMIC STEP-BY-STEP SOLUTION in Hindi in clean HTML (<p>...</p>) with full KaTeX/LaTeX math following YCT Exam Publication Pattern (जैसा प्रश्न वैसा पैटर्न). DO NOT prefix with 'हल:', '<b>हल:</b>', or 'उत्तर:'! DO NOT include filler labels like 'Key Point:'!
9. question_en: Question in English wrapped in semantic HTML (<p>...</p>) with standard KaTeX/LaTeX math ($...$ for inline formulas, $$...$$ for display equations) and clean HTML markup.
10. option1_en: Option 1 (A) in English wrapped in <p>...</p> (with KaTeX $...$ if mathematical formula).
11. option2_en: Option 2 (B) in English wrapped in <p>...</p> (with KaTeX $...$ if mathematical formula).
12. option3_en: Option 3 (C) in English wrapped in <p>...</p> (with KaTeX $...$ if mathematical formula).
13. option4_en: Option 4 (D) in English wrapped in <p>...</p> (with KaTeX $...$ if mathematical formula).
14. option5_en: Option 5 (E) in English (empty string if 4 options)
15. solution_en: DYNAMIC STEP-BY-STEP SOLUTION in English in clean HTML (<p>...</p>) with full KaTeX/LaTeX math following YCT Exam Publication Pattern (जैसा प्रश्न वैसा पैटर्न). DO NOT prefix with 'Solution:', '<b>Solution:</b>', or 'Explanation:'! DO NOT include filler labels like 'Key Point:'!
16. answer: Correct answer: Single choice "A", "B", "C", "D". MSQ: '["3","4"]'. NAT: '{"start":"86","end":"86"}'.
17. set_name: "${setName}"
18. difficulty_level: "Easy", "Medium", or "Hard"
19. test_date: Test date in YYYY-MM-DD if present, else empty string ""
20. test_time: Test time (e.g. "4:30 PM - 6:00 PM") if present, else empty string ""
21. subject: STRICT ACADEMIC SUBJECT ONLY!
    STRICT RULE: Only store pure academic subject (e.g. "Current Affairs", "History", "Geography", "Polity", "Economics", "General Science", "Physics", "Chemistry", "Biology", "Mathematics", "Reasoning", "Computer Knowledge", "English", "Hindi", "Environment & Ecology", "Static GK").
    NEVER include exam names/shifts like "RRB", "NTPC", "Level 01", "Stage I", "Shift-3" in subject!
22. subject_level: Exam level/stage (e.g. "RRB Level 01 Stage I 2025")
23. figure_notes: Figure notes or empty string ""
24. correction_notes: Clipping or correction notes or empty string ""
25. source_pdf: Source PDF file name if known, else empty string ""
26. source_pages: Source page number(s), e.g. "${pageNumber || '1'}"
27. source_question_reference: Question reference in paper, e.g. "Q.98"
28. latex_check: "checked"
29. html_check: "checked"
30. answer_check: "checked"
31. solution_check: "checked"
32. hash_figure: ""
33. manually_review: "checked"
34. duplicate_statistics: "Unique within this shift; duplicate check completed."

RULES & YCT SOLUTION GUIDELINES (जैसा प्रश्न वैसा पैटर्न):
- CRITICAL GADYANSH / READING COMPREHENSION RULE (गद्यांश / काव्यांश / निर्देश):
  * If this page contains a reading comprehension passage, poem, story, or case study (e.g. "निम्नलिखित गद्यांश को पढ़कर पूछे गए प्रश्नों के उत्तर दीजिए: (प्र. 66-70)"):
  * YOU MUST NEVER DROP OR OMIT THE PASSAGE! The full passage text MUST be stored and preserved.
  * Every question belonging to that passage set (e.g. Q.66 to Q.70) MUST include the complete passage text prepended to its question text:
    In question_hi:
    <p><strong>निर्देश (प्र. 66-70): निम्नलिखित गद्यांश को पढ़कर पूछे गए प्रश्नों के उत्तर दीजिए:</strong></p>
    <p>[Full verbatim Hindi passage text...]</p>
    <hr>
    <p>[Question text]</p>
    
    In question_en:
    <p><strong>Directions (Q. 66-70): Read the following passage and answer the questions:</strong></p>
    <p>[Full English translated passage text...]</p>
    <hr>
    <p>[Question text]</p>
  * Also set "figure_notes" to "गद्यांश / Passage: Q.66-70"
- STRICT NEGATIVE RULE: DO NOT include previous-year exam shift citations, tags, dates, or publisher labels in question text or options! (e.g. "RRB Tech. - (III) 23/12/2024 (Afternoon)", "NTPC CBT-I", "[SSC CGL 2023]", "(Shift-1)" MUST BE OMITTED). The question text must be purely the question statement itself!
- If question is in one language only, translate and generate counterpart fields so BOTH Hindi and English are populated.
- DYNAMIC SOLUTION PATTERN:
  * Math/Quant: State given data ("दिया गया है / Given that:"), write formula in standard LaTeX math ($...$), complete step-by-step intermediate calculation without skipping steps so weaker students understand easily, conclude with final value.
  * Reasoning: State logic/rule, step-by-step verification for each term/option, conclude why option is uniquely correct.
  * GK/Polity/History/Geography: State factual context (date/treaty/place/Article) + 3–4 high-yield connected exam facts or mini-list.
  * Science: State scientific law/reaction/mechanism + practical remedies or discoverers with years.
  * Language: State grammatical rule or usage clearly.
- STRICT NO-OPTION-LETTER RULE (CRITICAL FOR SHUFFLED OPTIONS):
  * In online test series and mock portals, options are SHUFFLED dynamically (Option A for one student can be Option C for another).
  * NEVER write "सही विकल्प A/B/C/D है" or "Option A/B/C/D is correct" in the solution!
  * State the concepts, facts, dates, names, formulas, and values directly! (e.g. "'खेलो इंडिया मिशन ढांचा' को लॉन्च किया गया था।", "अतः समय = 160 मिनट।"). NEVER mention the option letter!
- STRICT NO-PREFIX & NO-FILLER RULE: DO NOT start with 'हल:', 'Solution:', or 'Explanation:'! The test portal UI renders its own Solution header. NEVER include filler labels like 'Key Point:', 'Detailed Explanation:'!
${STRICT_MATH_AND_TEXT_PROMPT_RULES}
- Wrap all questions, options, and explanations in semantic HTML <p>...</p>. Use <b>...</b> for emphasis and clean HTML tables <table>...</table> for matching lists or comparison charts!
- Respond ONLY with the JSON array.`;
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

      const responseText = await callGeminiWithFallback(
        client,
        'gemini-2.5-flash',
        'gemini-2.5-flash',
        [
          {
            inlineData: {
              mimeType: 'image/png',
              data: cleanBase64
            }
          },
          { text: promptText }
        ],
        {
          temperature: generateSimilar ? 0.35 : 0.1,
          responseMimeType: "application/json"
        },
        'mocktest-extract'
      );
      return responseText;
    };


    const rawJson = await runAIAction(executeExtract, userKey);

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
          finalQHi = `<p>${currentPassageHi.replace(/\n+/g, '</p><p>')}</p><hr><p>${finalQHi.replace(/^<p>/i, '').replace(/<\/p>$/i, '')}</p>`;
        }
        if (currentPassageEn) {
          const snippetEn = currentPassageEn.slice(0, 25);
          if (!finalQEn.includes(snippetEn)) {
            finalQEn = `<p>${currentPassageEn.replace(/\n+/g, '</p><p>')}</p><hr><p>${finalQEn.replace(/^<p>/i, '').replace(/<\/p>$/i, '')}</p>`;
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

app.post('/api/mocktest-generate-similar-item', async (req, res) => {
  try {
    const { item } = req.body;
    if (!item) {
      return res.status(400).json({ error: "Missing question item in request body" });
    }
    const userKey = (req.headers['x-user-gemini-key'] as string) || '';

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
- For Math/Science: Change numerical values, scenarios, variables, or what is being solved. Ensure formulas calculate accurately.
- For GK/Polity/History: Test the same subject area, constitutional article, or era with a distinct new question.
- For Current Affairs / Contemporary GK: STRICT 1-YEAR WINDOW ONLY! Any question based on current affairs, government schemes, awards, sports, summits, appointments, or budget MUST STRICTLY use researched, verified events and data from the LAST 1 YEAR ONLY (within the last 12 months)! NEVER use outdated 2-5 year old data.
- For Reasoning/Language: Keep the same logical rule with new entities, numbers, or sentences.
- Formulate 4 completely fresh, plausible options (A, B, C, D).
- Compute and verify the single correct answer ("A", "B", "C", or "D").
- DYNAMIC PEDAGOGICAL SOLUTIONS (YCT EXAM PATTERN - जैसा प्रश्न वैसा पैटर्न):
  * For Math: Given data ("दिया गया है / Given that:"), clean Unicode formula, complete step-by-step intermediate calculations without skipping steps, calculated conclusion.
  * For Reasoning: Core rule/logic, step-by-step verification, conclusion.
  * For GK/Polity/History/Geography: Direct factual context + 3-4 connected exam facts/mini-list.
  * For Science: Scientific cause/law + practical remedy or discoverer.
  * For Language: Grammar rule/meaning + distractor analysis.
  * Accessible to weaker students: simple and clear steps.
  * Balanced medium length: 3 to 6 focused lines or 3-5 structured steps/points.
  * NO solution prefix labels ('हल:', 'Solution:') and NO filler labels ('Key Point:', 'Detailed Explanation:').
  * STRICT NO-OPTION-LETTER RULE: Options shuffle dynamically! NEVER write "सही विकल्प A/B/C/D है" or "Option A/B/C/D is correct" in the solution. State the facts, formulas, or calculated values directly!
${STRICT_MATH_AND_TEXT_PROMPT_RULES}
- Wrap all questions, options, and explanations in semantic HTML (<p>...</p>).

Output ONLY a JSON object matching this structure:
{
  "question_hi": "<p>...</p>",
  "question_en": "<p>...</p>",
  "option1_hi": "<p>...</p>",
  "option2_hi": "<p>...</p>",
  "option3_hi": "<p>...</p>",
  "option4_hi": "<p>...</p>",
  "option1_en": "<p>...</p>",
  "option2_en": "<p>...</p>",
  "option3_en": "<p>...</p>",
  "option4_en": "<p>...</p>",
  "answer": "A",
  "solution_hi": "<p>...</p>",
  "solution_en": "<p>...</p>",
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

app.post('/api/mocktest-proofread', async (req, res) => {
  try {
    const { items } = req.body;
    const userKey = (req.headers['x-user-gemini-key'] as string) || '';

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

4. SEMANTIC HTML & NO SOLUTION LABELS:
   - Ensure question_hi and question_en are wrapped in <p>...</p>.
   - Ensure solutions (if present) are structured with clean step-by-step explanations in <p>...</p> WITHOUT prefix labels like "<b>हल:</b>", "हल:", "<b>Solution:</b>", or "Solution:" as the portal UI displays its own Solution header!

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

app.post('/api/mocktest-ai-chat', async (req, res) => {
  try {
    const { item, userPrompt, history = [] } = req.body;
    if (!item || !userPrompt) {
      return res.status(400).json({ error: "Missing item or userPrompt in request body" });
    }
    const userKey = (req.headers['x-user-gemini-key'] as string) || '';

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
   - If user asks to improve solution/explanation: provide a structured, step-by-step pedagogical derivation following the YCT Exam pattern (जैसा प्रश्न वैसा पैटर्न) with given data, formula, and step-by-step intermediate calculation.
   - If user asks to improve language/translation: ensure accurate, natural Hindi & English exam phrasing.
   - If user asks about Current Affairs: STRICT 1-YEAR WINDOW ONLY! Ensure all dates, schemes, winners, ministers, or statistics are verified from the LAST 1 YEAR ONLY (within 12 months).
   - If user asks to simplify or make harder: adjust question wording and distractors accordingly.
2. STRICT RULES TO ENFORCE:
   - STRICT NO-OPTION-LETTER RULE: Options shuffle dynamically! NEVER write "सही विकल्प A/B/C/D है" or "Option A/B/C/D is correct" in "solution_hi" or "solution_en"! State facts, formulas, or calculated values directly!
   - NO filler headers like 'Key Point:', 'Detailed Explanation:', 'हल:', 'Solution:'.
${STRICT_MATH_AND_TEXT_PROMPT_RULES}
   - Wrap text in semantic HTML (<p>...</p>).
3. Generate a friendly, concise, and helpful "reply" in the user's language (Hindi or English) explaining exactly what you changed or improved.

OUTPUT FORMAT:
Respond with ONLY a strict JSON object:
{
  "updatedItem": {
    "question_hi": "<p>...</p>",
    "question_en": "<p>...</p>",
    "option1_hi": "<p>...</p>",
    "option2_hi": "<p>...</p>",
    "option3_hi": "<p>...</p>",
    "option4_hi": "<p>...</p>",
    "option5_hi": "<p>...</p>",
    "option1_en": "<p>...</p>",
    "option2_en": "<p>...</p>",
    "option3_en": "<p>...</p>",
    "option4_en": "<p>...</p>",
    "option5_en": "<p>...</p>",
    "answer": "A",
    "solution_hi": "<p>...</p>",
    "solution_en": "<p>...</p>",
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

app.post('/api/mocktest-add-question', async (req, res) => {
  try {
    const { 
      text = '', 
      base64Image = '', 
      setName = 'Mock Test Paper', 
      targetPageNumber = 1, 
      nextQuestionNumber = 1, 
      difficulty = 'medium',
      instruction = ''
    } = req.body;

    if (!text.trim() && !base64Image) {
      return res.status(400).json({ error: "Please provide either question text, an instruction, or an image/screenshot." });
    }

    const userKey = (req.headers['x-user-gemini-key'] as string) || '';

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

YOUR MISSION:
1. Parse the input (whether image screenshot, raw unformatted text, or prompt) and build a complete, professional exam MCQ:
   - If a screenshot/image is provided: extract the question, all 4 options, and figure/diagram context with high fidelity.
   - If raw text is provided: format it into clear, well-structured Hindi and English question stems and options.
   - If an instruction/topic is provided (e.g. "Create a question on..."): formulate an authentic, exam-standard question with realistic distractors.
2. BOTH Hindi and English fields MUST be fully populated!
3. Accurately deduce and verify the SINGLE CORRECT ANSWER ("A", "B", "C", or "D").
4. Formulate an EXAM-ORIENTED, STEP-BY-STEP PEDAGOGICAL SOLUTION in BOTH Hindi (<p>...</p>) and English (<p>...</p>) following the YCT Exam Pattern (जैसा प्रश्न वैसा पैटर्न):
   - Math/Numericals: State given data ("दिया गया है / Given that:"), clean Unicode formula, complete step-by-step intermediate calculation without skipping steps so weaker students understand easily, conclude with final value.
   - Reasoning: Core rule/logic, step-by-step verification, conclusion.
   - GK/Polity/History/Geography: Direct factual context + 3-4 connected high-yield exam facts or mini-list.
   - Science: Scientific law/reaction/mechanism + practical remedies.
   - Language: Grammar rule/meaning + usage.
5. STRICT NO-OPTION-LETTER RULE (CRITICAL FOR SHUFFLED OPTIONS):
   - Options shuffle dynamically in mock test portals!
   - YOU MUST NEVER mention option letters (A, B, C, D) or option numbers in solution_hi or solution_en! (e.g. NEVER write "सही विकल्प A है" or "Option B is correct").
   - State the factual name, term, formula, or calculated value directly! (e.g. "'खेलो इंडिया मिशन ढांचा' को लॉन्च किया गया था।" or "अतः समय = 160 मिनट होगा।").
6. CRITICAL CURRENT AFFAIRS RULE (STRICT LAST 1-YEAR WINDOW ONLY):
   - If the question belongs to Current Affairs, contemporary government schemes, national initiatives, sports tournaments, awards, summits, appointments, union budget, or recent GK:
   - The data, events, facts, schemes, and statistics MUST STRICTLY BE FROM THE LAST 1 YEAR ONLY (within the last 12 months)! Outdated 2-5 year old data is strictly forbidden.
${STRICT_MATH_AND_TEXT_PROMPT_RULES}
- Wrap all text in clean semantic HTML (<p>...</p>). Use <b>...</b> for emphasis and <table>...</table> for tabular steps.

OUTPUT FORMAT:
Respond with ONLY a strict JSON object:
{
  "item": {
    "question_r": ${nextQuestionNumber},
    "question_type": "MCQ",
    "question_hi": "<p>...</p>",
    "question_en": "<p>...</p>",
    "option1_hi": "<p>...</p>",
    "option2_hi": "<p>...</p>",
    "option3_hi": "<p>...</p>",
    "option4_hi": "<p>...</p>",
    "option5_hi": "",
    "option1_en": "<p>...</p>",
    "option2_en": "<p>...</p>",
    "option3_en": "<p>...</p>",
    "option4_en": "<p>...</p>",
    "option5_en": "",
    "answer": "A",
    "solution_hi": "<p>...</p>",
    "solution_en": "<p>...</p>",
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
            mimeType: 'image/png',
            data: cleanBase64
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

app.post('/api/latex/repair', async (req, res) => {
  try {
    const { content, contentType = 'content', selectedFormula, item, scope } = req.body;
    const userKey = (req.headers['x-user-gemini-key'] as string) || '';

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
    if (typeof content !== 'string') {
      return res.status(400).json({ error: "Missing 'content' or 'item' in request body." });
    }

    const result = await repairContentLatex(
      content,
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

export default app;

