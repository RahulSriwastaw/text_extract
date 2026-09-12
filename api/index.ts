import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { NumberingStyle } from '../types.js';
import fs from 'fs';
import path from 'path';

try {
  process.loadEnvFile();
} catch (e) {}

const app = express();
app.use(express.json({ limit: '50mb' }));

app.get('/api/config', (req, res) => {
  try {
    const { totalKeys } = getGeminiClient();
    res.json({ totalKeys });
  } catch (error) {
    res.json({ totalKeys: 0 });
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
  }

  return { client: new GoogleGenAI({ apiKey: selectedKey }), key: selectedKey, totalKeys: allKeys.length };
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

const reportKeyError = (key: string, type: string, isPermanent = false) => {
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

  // Circuit Breaker: Quota/Rate-limit gets 40s cooldown, Server overload gets 15s, Transient gets 5s
  let cooldownSec = 15;
  if (type === 'QUOTA' || type === 'RATE_LIMIT') {
    cooldownSec = Math.min(30 + health.consecutiveErrors * 10, 90);
  } else if (type === 'OVERLOAD') {
    cooldownSec = 15;
  } else {
    cooldownSec = 5;
  }

  health.cooldownUntil = now + (cooldownSec * 1000);
  keyHealth.set(key, health);
  console.warn(`[API-Key] Key ${key.substring(0, 8)}... error: ${type}. Cooldown set for ${cooldownSec}s.`);
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runAIAction(
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

    const { client, key, totalKeys } = getGeminiClient(triedKeys, userKeyInput);
    triedKeys.add(key);

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
        // Immediately try the next key with no delay
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
                          errorStr.includes("MAX_TOKENS");

      if (isRetryable) {
        const errType = isQuotaError ? 'QUOTA' : (isServerOverloaded ? 'OVERLOAD' : 'TRANSIENT');
        console.warn(`[API-Key] Key ${key.substring(0, 8)}... failed (${errType}: ${error?.message || errorStr}). Attempt ${attempt + 1}/${effectiveRetries + 1}. Fast-rotating to next key in pool (${totalKeys} active keys).`);
        reportKeyError(key, errType);
        
        // Fast Instant Rotation:
        // If there are other available keys in the pool not yet attempted, rotate immediately with only 50ms jitter!
        // Only if all keys have been exhausted in this request sequence, apply a short backoff.
        const remainingUntried = allKeys.filter(k => !triedKeys.has(k)).length;
        const delayMs = remainingUntried > 0 ? 50 : Math.min(attempt * 250, 1200);
        await delay(delayMs); 
        continue;
      }
      
      throw error;
    }
  }
  
  const finalError = new Error(`Exhausted attempts across all ${allKeys.length} available Gemini API keys. Last error: ${lastError?.message || "Service unavailable"}.`);
  (finalError as any).status = 429;
  throw finalError;
}

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
    const response = await client.models.generateContent({
      model: 'gemini-flash-lite-latest',
      contents: [
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
   - **STRICT MATH RULE**: You MUST enclose ALL mathematical formulas, variables, equations, and expressions in double dollar signs like \`$$\` ... \`$$\` (e.g., \`$$x^2 + y^2 = r^2$$\`, \`$$(\sec A + \tan A) \times (1 - \sin A) \times \sec A$$\`).
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
      ],
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
      }
    });

    let responseText = response?.text;
    if (!responseText && response?.candidates?.[0]?.content?.parts) {
      responseText = response.candidates[0].content.parts.map((p: any) => p.text || '').join('');
    }

    if (!responseText || !responseText.trim()) {
      const finishReason = response?.candidates?.[0]?.finishReason;
      throw new Error(`Empty response from Gemini API (finishReason: ${finishReason || 'none'})`);
    }

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
    const response = await client.models.generateContent({
      model: 'gemini-flash-lite-latest',
      contents: prompt,
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
      }
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error("Empty response from Gemini API");
    }

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

// Server-side cleaner for math, LaTeX, stray $, and template scaffolding
const SERVER_EXAM_KEYWORD_REGEX = '(?:RRB|SSC|NTPC|CBT|Tech|ALP|JE|Group[\\s\\-]*D|RPF|SI|Constable|CGL|CHSL|MTS|CPO|GD|Steno|UPSC|CDS|NDA|AFCAT|IBPS|SBI|PO|Clerk|BPSC|UPPSC|MPPSC|HSSC|DSSSB|CTET|UPTET|REET|Railway|एसएससी|आरआरबी|एनटीपीसी|रेलवे|ग्रुप[\\s\\-]*डी|टेक)';
const SERVER_SHIFT_KEYWORD_REGEX = '(?:Afternoon|Morning|Evening|Night|Shift[\\s\\-]*[I|II|III|IV|V|1|2|3|4|5]|Batch[\\s\\-]*\\d+|दोपहर|सुबह|शाम|रात|प्रथम[\\s\\-]*पाली|द्वितीय[\\s\\-]*पाली|तृतीय[\\s\\-]*पाली|पाली[\\s\\-]*\\d+)';
const SERVER_DATE_PATTERN_REGEX = '(?:\\d{1,2}[\\/\\.\\-]\\d{1,2}[\\/\\.\\-]\\d{2,4}|\\b(?:19|20)\\d{2}\\b)';

function stripServerExamTagsAndJunk(text: string): string {
  if (!text) return '';
  let res = text;
  res = res.replace(/\[\s*(?:RRB|SSC|NTPC|CBT|Tech|ALP|JE|Group[\s\-]*D|RPF|SI|Constable|CGL|CHSL|MTS|CPO|GD|Steno|UPSC|CDS|NDA|AFCAT|IBPS|SBI|PO|Clerk|BPSC|UPPSC|MPPSC|HSSC|DSSSB|CTET|UPTET|REET|Railway|एसएससी|आरआरबी|एनटीपीसी|रेलवे|ग्रुप[\s\-]*डी|टेक)[^\]]*\]/gi, '');
  res = res.replace(/\(\s*(?:RRB|SSC|NTPC|CBT|Tech|ALP|JE|Group[\s\-]*D|RPF|SI|Constable|CGL|CHSL|MTS|CPO|GD|Steno|UPSC|CDS|NDA|AFCAT|IBPS|SBI|PO|Clerk|BPSC|UPPSC|MPPSC|HSSC|DSSSB|CTET|UPTET|REET|Railway|एसएससी|आरआरबी|एनटीपीसी|रेलवे|ग्रुप[\s\-]*डी|टेक)[^\)]*\)/gi, '');
  res = res.replace(/(?:^|<p>)\s*\[\s*(?:RRB|SSC|NTPC|CBT|Tech|ALP|JE|Group[\s\-]*D|RPF|SI|Constable|CGL|CHSL|MTS|CPO|GD|Steno|UPSC|CDS|NDA|AFCAT|IBPS|SBI|PO|Clerk|BPSC|UPPSC|MPPSC|HSSC|DSSSB|CTET|UPTET|REET|Railway|एसएससी|आरआरबी|एनटीपीसी|रेलवे|ग्रुप[\s\-]*डी|टेक)[^\]]*\]\s*/gi, (m) => m.startsWith('<p>') ? '<p>' : '');
  res = res.replace(/(?:^|<p>)\s*\(\s*(?:RRB|SSC|NTPC|CBT|Tech|ALP|JE|Group[\s\-]*D|RPF|SI|Constable|CGL|CHSL|MTS|CPO|GD|Steno|UPSC|CDS|NDA|AFCAT|IBPS|SBI|PO|Clerk|BPSC|UPPSC|MPPSC|HSSC|DSSSB|CTET|UPTET|REET|Railway|एसएससी|आरआरबी|एनटीपीसी|रेलवे|ग्रुप[\s\-]*डी|टेक)[^\)]*\)\s*/gi, (m) => m.startsWith('<p>') ? '<p>' : '');
  const trailingPattern = new RegExp(
    '(?:[\\s\\.\\,\\;\\-\\–\\—]|\\?|\\!)+(' + SERVER_EXAM_KEYWORD_REGEX + '[\\s\\S]*?(?:' + SERVER_DATE_PATTERN_REGEX + '|' + SERVER_SHIFT_KEYWORD_REGEX + ')[\\s\\S]*?)(\\s*<\\/p>|$)',
    'i'
  );
  res = res.replace(trailingPattern, (match, _tag, closing) => {
    const preChar = match.trim().charAt(0);
    const punct = (preChar === '?' || preChar === '!' || preChar === '.') ? preChar : '';
    return punct + (closing || '');
  });
  res = res.replace(new RegExp('(?:[\\s\\-\\–\\—]+)(' + SERVER_DATE_PATTERN_REGEX + '\\s*\\(?' + SERVER_SHIFT_KEYWORD_REGEX + '\\)?|\\(?' + SERVER_SHIFT_KEYWORD_REGEX + '\\)?)(\\s*<\\/p>|$)', 'i'), '$2');
  res = res.replace(/(?:Youth\s*Competition\s*Times|Pinnacle\s*Publication|Testbook\.com|Adda247|Exampur|Gradeup|Drishti\s*IAS|Kiran\s*Prakashan|Platform\s*Education|Rukmini\s*Prakashan)[\s\S]*?(?:<\/p>|$)/gi, (m) => m.endsWith('</p>') ? '</p>' : '');
  res = res.replace(/\s+<\/p>/gi, '</p>').replace(/[ \t]{2,}/g, ' ');
  return res.trim();
}

function cleanServerMocktestText(text: string): string {
  if (!text) return '';
  let res = text;
  res = stripServerExamTagsAndJunk(res);
  // Strip AI coach filler
  res = res.replace(/(?:<br\s*\/?>|\n)?\s*(?:<strong>|<b>)?\s*Important Exam Point\s*:\s*(?:<\/strong>|<\/b>)?[\s\S]*?(?:<\/p>|$)/gi, (m) => m.endsWith('</p>') ? '</p>' : '');
  // Strip scaffolding headers
  res = res.replace(/(?:<strong>|<b>)?\s*Key Point\s*:\s*(?:<\/strong>|<\/b>)?\s*/gi, '');
  res = res.replace(/(?:<strong>|<b>)?\s*Detailed Explanation\s*:\s*(?:<\/strong>|<\/b>)?\s*/gi, '');
  res = res.replace(/(?:<br\s*\/?>|\n)?\s*(?:<strong>|<b>)?\s*Additional Information\s*:\s*(?:<\/strong>|<\/b>)?\s*/gi, '<br>');

  // Corrupted escapes
  res = res.replace(/[\x0c\u21e1\u2191]rac/g, '\\frac');
  res = res.replace(/[\x09\b]imes/g, '\\times');
  res = res.replace(/(\d|[a-zA-Z\)])\s+imes\s+/g, '$1 \\times ');

  // Fix broken br tags
  res = res.replace(/&lt;\s*br\s*\/?&gt;/gi, '<br>');
  res = res.replace(/<\s*br\s*\/?>/gi, '<br>');

  // 1. Convert LaTeX fractions \frac{num}{den} to (num) / (den) or num / den
  for (let i = 0; i < 4; i++) {
    res = res.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, (_m, num, den) => {
      const cleanNum = num.trim();
      const cleanDen = den.trim();
      const numWrap = /[\s+\-*\/=]|\\times|\\div|×|÷|−|\+/.test(cleanNum) && !cleanNum.startsWith('(') && !cleanNum.startsWith('|')
        ? `(${cleanNum})`
        : cleanNum;
      const denWrap = /[\s+\-*\/=]|\\times|\\div|×|÷|−|\+/.test(cleanDen) && !cleanDen.startsWith('(')
        ? `(${cleanDen})`
        : cleanDen;
      return `${numWrap} / ${denWrap}`;
    });
  }
  res = res.replace(/\\frac\s*\{?([^}\s]+)\}?\s*\{?([^}\s]+)\}?/g, '$1 / $2');

  // 2. Convert roots
  res = res.replace(/\\sqrt\[3\]\s*\{([^{}]+)\}/g, '∛($1)');
  res = res.replace(/\\sqrt\s*\{([^{}]+)\}/g, '√($1)');
  res = res.replace(/\\sqrt\s*([a-zA-Z0-9]+)/g, '√$1');

  // 3. Convert standard math operators to clean Unicode
  res = res.replace(/\\times\b/g, '×');
  res = res.replace(/\\div\b/g, '÷');
  res = res.replace(/\\pm\b/g, '±');
  res = res.replace(/\\mp\b/g, '∓');
  res = res.replace(/\\cdot\b/g, '·');
  res = res.replace(/\\leq?\b/g, '≤');
  res = res.replace(/\\geq?\b/g, '≥');
  res = res.replace(/\\neq?\b/g, '≠');
  res = res.replace(/\\approx\b/g, '≈');
  res = res.replace(/\\equiv\b/g, '≡');
  res = res.replace(/\\propto\b/g, '∝');
  res = res.replace(/\\infty\b/g, '∞');

  // 4. Degree symbol
  res = res.replace(/(?:\^\\circ|\^\{\\circ\}|\\circ)\b/g, '°');
  res = res.replace(/(\d+)\s*\^\\circ/g, '$1°');
  res = res.replace(/(\d+)\s*°/g, '$1°');

  // 5. Greek letters
  res = res.replace(/\\alpha\b/g, 'α');
  res = res.replace(/\\beta\b/g, 'β');
  res = res.replace(/\\theta\b/g, 'θ');
  res = res.replace(/\\pi\b/g, 'π');
  res = res.replace(/\\Delta\b/g, 'Δ');
  res = res.replace(/\\sigma\b/g, 'σ');
  res = res.replace(/\\lambda\b/g, 'λ');
  res = res.replace(/\\omega\b/g, 'ω');
  res = res.replace(/\\mu\b/g, 'μ');

  // 6. Superscripts & Subscripts
  res = res.replace(/\^2\b/g, '²');
  res = res.replace(/\^3\b/g, '³');
  res = res.replace(/\^\{2\}/g, '²');
  res = res.replace(/\^\{3\}/g, '³');
  res = res.replace(/\^\{([^{}]+)\}/g, '<sup>$1</sup>');
  res = res.replace(/_\{([^{}]+)\}/g, '<sub>$1</sub>');
  res = res.replace(/\^([0-9a-zA-Z])/g, '<sup>$1</sup>');
  res = res.replace(/_([0-9a-zA-Z])/g, '<sub>$1</sub>');

  // 7. LaTeX formatting wrappers
  res = res.replace(/\\text(?:bf|it|rm)?\s*\{([^{}]+)\}/g, '$1');
  res = res.replace(/\\math(?:bf|it|rm|sf|tt)?\s*\{([^{}]+)\}/g, '$1');
  res = res.replace(/\\left\s*([|(\[{])/g, '$1');
  res = res.replace(/\\right\s*([|)\]}])/g, '$1');
  res = res.replace(/\\left\./g, '');
  res = res.replace(/\\right\./g, '');

  // 8. Logic and set symbols
  res = res.replace(/\\wedge\b/g, '∧');
  res = res.replace(/\\vee\b/g, '∨');
  res = res.replace(/\\rightarrow\b/g, '→');
  res = res.replace(/\\Rightarrow\b/g, '⇒');
  res = res.replace(/\\cap\b/g, '∩');
  res = res.replace(/\\cup\b/g, '∪');
  res = res.replace(/\\subset\b/g, '⊂');
  res = res.replace(/\\in\b/g, '∈');

  // 9. Percentage & currency
  res = res.replace(/(\d+(?:\.\d+)?)\\\%/g, '$1%');
  res = res.replace(/\$\s*=\s*/g, '= ');
  res = res.replace(/=\s*\$\s*₹/g, '= ₹');
  res = res.replace(/\$\s*₹/g, '₹');
  res = res.replace(/₹\s*\$/g, '₹');
  res = res.replace(/(₹\s*\d+(?:,\d+)*(?:\.\d+)?)\$/g, '$1');

  // 10. COMPLETE STRIPPING OF ALL $ AND $$ DELIMITERS!
  res = res.replace(/\$\$/g, '');
  res = res.replace(/(?<!\\)\$/g, '');
  res = res.replace(/\\\$/g, '$');

  // 11. Spacing artifacts
  res = res.replace(/\\[,;!\s]/g, ' ');
  res = res.replace(/\\quad\b/g, ' ');
  res = res.replace(/\\qquad\b/g, '  ');

  // 12. Minus sign
  res = res.replace(/(\w|\))\s*-\s*(\w|\()/g, '$1 − $2');

  // 13. Paragraph & whitespace cleanup
  res = res.replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br><br>');
  res = res.replace(/<p>\s*<br\s*\/?>/gi, '<p>');
  res = res.replace(/[ \t]{2,}/g, ' ');
  res = res.replace(/\s*[\/\\]\s*$/g, '');
  return res.trim();
}

function safeParseAiJson(rawJson: string): any {
  const cleaned = (rawJson || '').replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
  const safeJsonStr = cleaned
    .replace(/(?<!\\)\\frac/g, '\\\\frac')
    .replace(/(?<!\\)\\times/g, '\\\\times')
    .replace(/(?<!\\)\\sqrt/g, '\\\\sqrt')
    .replace(/(?<!\\)\\text/g, '\\\\text')
    .replace(/(?<!\\)\\div/g, '\\\\div')
    .replace(/(?<!\\)\\pm/g, '\\\\pm')
    .replace(/(?<!\\)\\cdot/g, '\\\\cdot')
    .replace(/(?<!\\)\\le(?!a)/g, '\\\\le')
    .replace(/(?<!\\)\\ge(?!t)/g, '\\\\ge')
    .replace(/(?<!\\)\\neq/g, '\\\\neq')
    .replace(/(?<!\\)\\approx/g, '\\\\approx');
  return JSON.parse(safeJsonStr);
}

app.post('/api/mocktest-solve', async (req, res) => {
  try {
    const { question_hi, question_en, option1_hi, option2_hi, option3_hi, option4_hi, option1_en, option2_en, option3_en, option4_en, answer, question_type } = req.body;
    const userKey = (req.headers['x-user-gemini-key'] as string) || '';

    const qPrompt = `You are an elite Indian exam educator, subject matter expert, and competitive exam test-series architect (SSC CGL, Railway RRB, Banking IBPS/SBI, UPSC, GATE, State PSC).
Conduct a DEEP PEDAGOGICAL RESEARCH and provide a RIGOROUS, STEP-BY-STEP SOLUTION for the question below.

Question Context:
Correct Answer: ${answer || 'Deduce correct answer'}
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

DEEP RESEARCH & SOLUTION REQUIREMENTS:
1. 'solution_hi': Detailed, pedagogical explanation in Hindi wrapped in clean semantic HTML (<p><b>हल:</b>...</p>).
   - Must include:
     a) दिया गया डेटा (Given Data) & मुख्य अवधारणा (Core Concept/Theorem).
     b) आवश्यक सूत्र (Formula in clean Unicode & text).
     c) चरण-दर-चरण विस्तृत गणना (Step-by-step calculation).
     d) निष्कर्ष एवं सही विकल्प (Final answer conclusion stating why Option ${answer} is correct).
   - DO NOT include filler labels like 'Key Point:', 'Detailed Explanation:', 'Additional Information:', or 'Important Exam Point:'!
2. 'solution_en': Detailed, rigorous solution in English wrapped in clean semantic HTML (<p><b>Solution:</b>...</p>).
   - Must include:
     a) Key concept & underlying principle.
     b) Standard formula / theorem in clean Unicode & text.
     c) Intermediate algebraic/numerical steps with proofs.
     d) Final deduction matching option ${answer}.
   - DO NOT include filler labels like 'Key Point:', 'Detailed Explanation:', 'Additional Information:', or 'Important Exam Point:'!
3. Math & Symbols (PURE UNICODE & CLEAN HTML - NO LATEX):
   - NEVER output LaTeX commands (like \\frac, \\times, \\div, \\sqrt, \\circ) or dollar delimiters ($...$ or $$...$$)!
   - Write symbols directly in Unicode: '×' for multiplication, '÷' for division, '−' for subtraction, '≤' and '≥', '≠', '°' for degrees, '√x', '²' for squared.
   - Write fractions as '(num) / (den)' or 'num / den' (e.g. '(60 × 9 − 11 × 30) / 2 = 105°').
   - Use '&gt;' and '&lt;' for comparisons in HTML.
   - NEVER use $ delimiters for human names, variables, counts, percentages, or money (write 40%, ₹4,800, 5, NOT $40%, $₹4800$).
4. Determine 'difficulty_level': 'easy' | 'medium' | 'hard'.
5. Output ONLY valid JSON:
{
  "solution_hi": "<p><b>हल:</b>...</p>",
  "solution_en": "<p><b>Solution:</b>...</p>",
  "difficulty_level": "medium"
}`;

    const executeSolve = async (client: any) => {
      let modelToUse = 'gemini-2.5-flash';
      try {
        const response = await client.models.generateContent({
          model: modelToUse,
          contents: [{ text: qPrompt }],
          config: {
            temperature: 0.15,
            responseMimeType: "application/json"
          }
        });
        let responseText = response?.text;
        if (!responseText && response?.candidates?.[0]?.content?.parts) {
          responseText = response.candidates[0].content.parts.map((p: any) => p.text || '').join('');
        }
        return responseText;
      } catch (err: any) {
        // Fallback to flash-lite if 2.5 is unavailable
        const response = await client.models.generateContent({
          model: 'gemini-flash-lite-latest',
          contents: [{ text: qPrompt }],
          config: {
            temperature: 0.2,
            responseMimeType: "application/json"
          }
        });
        let responseText = response?.text;
        if (!responseText && response?.candidates?.[0]?.content?.parts) {
          responseText = response.candidates[0].content.parts.map((p: any) => p.text || '').join('');
        }
        return responseText;
      }
    };

    const rawJson = await runAIAction(executeSolve, userKey);

    const parsed = safeParseAiJson(rawJson);
    res.json({
      solution_hi: cleanServerMocktestText(parsed.solution_hi || ''),
      solution_en: cleanServerMocktestText(parsed.solution_en || ''),
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
5. COMPREHENSIVE STEP-BY-STEP SOLUTION:
   - 'solution_hi': Detailed explanation in Hindi in clean HTML (<p><b>हल:</b> [Clean step-by-step formula and mathematical calculation proof]</p>). DO NOT include filler labels like 'Key Point:', 'Detailed Explanation:', 'Additional Information:', or 'Important Exam Point:'!
   - 'solution_en': Rigorous explanation in English in clean HTML (<p><b>Solution:</b> [Clean step-by-step formula and mathematical calculation proof]</p>). DO NOT include filler labels like 'Key Point:', 'Detailed Explanation:', 'Additional Information:', or 'Important Exam Point:'!
   - Both must clearly prove why option is correct with calculations and proofs.
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
  "solution_hi": "<p><b>हल:</b>...</p>",
  "solution_en": "<p><b>Solution:</b>...</p>"
}`;

    const executeRepair = async (client: any) => {
      let modelToUse = 'gemini-2.5-flash';
      try {
        const response = await client.models.generateContent({
          model: modelToUse,
          contents: [{ text: repairPrompt }],
          config: {
            temperature: 0.1,
            responseMimeType: "application/json"
          }
        });
        let responseText = response?.text;
        if (!responseText && response?.candidates?.[0]?.content?.parts) {
          responseText = response.candidates[0].content.parts.map((p: any) => p.text || '').join('');
        }
        return responseText;
      } catch (err: any) {
        const response = await client.models.generateContent({
          model: 'gemini-flash-lite-latest',
          contents: [{ text: repairPrompt }],
          config: {
            temperature: 0.15,
            responseMimeType: "application/json"
          }
        });
        let responseText = response?.text;
        if (!responseText && response?.candidates?.[0]?.content?.parts) {
          responseText = response.candidates[0].content.parts.map((p: any) => p.text || '').join('');
        }
        return responseText;
      }
    };

    const rawJson = await runAIAction(executeRepair, userKey);

    const parsed = safeParseAiJson(rawJson);
    if (parsed && typeof parsed === 'object') {
      if (parsed.question_hi) parsed.question_hi = cleanServerMocktestText(parsed.question_hi);
      if (parsed.question_en) parsed.question_en = cleanServerMocktestText(parsed.question_en);
      if (parsed.solution_hi) parsed.solution_hi = cleanServerMocktestText(parsed.solution_hi);
      if (parsed.solution_en) parsed.solution_en = cleanServerMocktestText(parsed.solution_en);
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

app.post('/api/mocktest-extract', async (req, res) => {
  try {
    const { base64Image, setName = 'Exam Paper' } = req.body;
    const userKey = (req.headers['x-user-gemini-key'] as string) || '';

    let cleanBase64 = base64Image || '';
    if (cleanBase64.includes(';base64,')) {
      cleanBase64 = cleanBase64.split(';base64,')[1];
    }

    const promptText = `You are a professional Exam Paper Digitizer and MockTest Content Architect.
Extract ALL multiple-choice questions (MCQs), multiple-select questions (MSQs), and numerical questions (NAT) from this image.

Extract into a strict JSON array of objects with these exact 34 fields:
1. question_r: Sequence number (1, 2, 3...)
2. question_hi: Question in Hindi wrapped in semantic HTML (<p>...</p>) with standard Unicode math (NO LaTeX commands, NO dollar signs!).
3. option1_hi: Option 1 (A) in Hindi wrapped in <p>...</p>
4. option2_hi: Option 2 (B) in Hindi wrapped in <p>...</p>
5. option3_hi: Option 3 (C) in Hindi wrapped in <p>...</p>
6. option4_hi: Option 4 (D) in Hindi wrapped in <p>...</p>
7. option5_hi: Option 5 (E) in Hindi (empty string if 4 options)
8. solution_hi: Detailed step-by-step pedagogical solution in Hindi in clean HTML (<p><b>हल:</b> [Clean step-by-step formula and mathematical calculation proof]</p>). DO NOT include filler labels like 'Key Point:', 'Detailed Explanation:', 'Additional Information:', or 'Important Exam Point:'!
9. question_en: Question in English wrapped in semantic HTML (<p>...</p>) with standard Unicode math (NO LaTeX commands, NO dollar signs!).
10. option1_en: Option 1 (A) in English wrapped in <p>...</p>
11. option2_en: Option 2 (B) in English wrapped in <p>...</p>
12. option3_en: Option 3 (C) in English wrapped in <p>...</p>
13. option4_en: Option 4 (D) in English wrapped in <p>...</p>
14. option5_en: Option 5 (E) in English (empty string if 4 options)
15. solution_en: Detailed step-by-step pedagogical explanation in English in clean HTML (<p><b>Solution:</b> [Clean step-by-step formula and mathematical calculation proof]</p>). DO NOT include filler labels like 'Key Point:', 'Detailed Explanation:', 'Additional Information:', or 'Important Exam Point:'!
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
26. source_pages: Source page number(s), e.g. "17"
27. source_question_reference: Question reference in paper, e.g. "Q.98"
28. latex_check: "checked"
29. html_check: "checked"
30. answer_check: "checked"
31. solution_check: "checked"
32. hash_figure: ""
33. manually_review: "checked"
34. duplicate_statistics: "Unique within this shift; duplicate check completed."

RULES:
- STRICT NEGATIVE RULE: DO NOT include previous-year exam shift citations, tags, dates, or publisher labels in question text or options! (e.g. "RRB Tech. - (III) 23/12/2024 (Afternoon)", "NTPC CBT-I", "[SSC CGL 2023]", "(Shift-1)" MUST BE OMITTED). The question text must be purely the question statement itself!
- If question is in one language only, translate and generate counterpart fields so BOTH Hindi and English are populated.
- NO LATEX, NO DOLLAR SIGNS: Output all mathematical symbols directly in clean Unicode and HTML (e.g. '×', '÷', '−', '≤', '≥', '≠', '°', '√x', '(a) / (b)', '&gt;', '&lt;'). NEVER output LaTeX commands (\\frac, \\times, \\sqrt, \\circ) or dollar sign delimiters ($...$ or $$...$$)! NEVER enclose plain numbers, percentages (40%), or rupee amounts (₹4,800) in dollar signs.
- NEVER use artificial labels like 'Key Point:', 'Detailed Explanation:', 'Additional Information:', or 'Important Exam Point:'!
- Solutions MUST be thorough, complete, and pedagogical.
- Respond ONLY with the JSON array.`;

    const executeExtract = async (client: any) => {
      const response = await client.models.generateContent({
        model: 'gemini-flash-lite-latest',
        contents: [
          {
            inlineData: {
              mimeType: 'image/png',
              data: cleanBase64
            }
          },
          { text: promptText }
        ],
        config: {
          temperature: 0.1,
          responseMimeType: "application/json"
        }
      });
      let responseText = response?.text;
      if (!responseText && response?.candidates?.[0]?.content?.parts) {
        responseText = response.candidates[0].content.parts.map((p: any) => p.text || '').join('');
      }
      return responseText;
    };

    const rawJson = await runAIAction(executeExtract, userKey);

    const parsed = safeParseAiJson(rawJson);
    const rawItems = Array.isArray(parsed) ? parsed : [];
    const items = rawItems.map((item: any) => ({
      ...item,
      question_hi: cleanServerMocktestText(item.question_hi),
      question_en: cleanServerMocktestText(item.question_en),
      solution_hi: cleanServerMocktestText(item.solution_hi),
      solution_en: cleanServerMocktestText(item.solution_en),
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

3. PRESERVE NUMBERS & ANSWERS (PURE UNICODE & CLEAN HTML - NO LATEX):
   - DO NOT alter mathematical numerical values, variables, or the correct answer.
   - NO LATEX, NO DOLLAR SIGNS: NEVER introduce or retain LaTeX commands (like \\frac, \\times, \\div, \\sqrt, \\circ) or dollar delimiters ($...$). Convert all math into clean Unicode symbols ('×', '÷', '−', '≤', '≥', '≠', '°', '√') and write fractions as '(a) / (b)' or 'a / b'.
   - Plain numbers, percentages (40%), and currency (₹4,800) MUST NOT be enclosed in dollar signs.

4. SEMANTIC HTML:
   - Ensure question_hi and question_en are wrapped in <p>...</p>.
   - Ensure solutions (if present) are structured with <p><b>हल:</b>...</p> and <p><b>Solution:</b>...</p>.

INPUT ITEMS TO PROOFREAD:
${JSON.stringify(items, null, 2)}

OUTPUT:
Respond ONLY with the JSON array of proofread objects inside \`\`\`json ... \`\`\` block, preserving all schema fields.`;

    const executeProofread = async (client: any) => {
      let modelToUse = 'gemini-2.5-flash';
      try {
        const response = await client.models.generateContent({
          model: modelToUse,
          contents: [{ text: proofreadPrompt }],
          config: {
            temperature: 0.1,
            responseMimeType: "application/json"
          }
        });
        let responseText = response?.text;
        if (!responseText && response?.candidates?.[0]?.content?.parts) {
          responseText = response.candidates[0].content.parts.map((p: any) => p.text || '').join('');
        }
        return responseText;
      } catch (err: any) {
        const response = await client.models.generateContent({
          model: 'gemini-flash-lite-latest',
          contents: [{ text: proofreadPrompt }],
          config: {
            temperature: 0.1,
            responseMimeType: "application/json"
          }
        });
        let responseText = response?.text;
        if (!responseText && response?.candidates?.[0]?.content?.parts) {
          responseText = response.candidates[0].content.parts.map((p: any) => p.text || '').join('');
        }
        return responseText;
      }
    };

    const rawJson = await runAIAction(executeProofread, userKey);

    const cleaned = (rawJson || '').replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    const rawProofread = Array.isArray(parsed) ? parsed : items;
    const cleanedItems = rawProofread.map((item: any) => ({
      ...item,
      question_hi: cleanServerMocktestText(item.question_hi),
      question_en: cleanServerMocktestText(item.question_en),
      solution_hi: cleanServerMocktestText(item.solution_hi),
      solution_en: cleanServerMocktestText(item.solution_en),
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

export default app;

