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

let keyIndex = 0;
const keyHealth = new Map<string, { 
  lastErrorTime: number, 
  lastSuccessTime: number, 
  consecutiveErrors: number, 
  totalErrors: number, 
  totalSuccesses: number,
  errorType?: string 
}>();
const deadKeys = new Set<string>();

const FALLBACK_KEYS: string[] = [];

const getAllKeys = () => {
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
  
  let allKeys = (keysString || '')
    .split(',')
    .map(k => k.trim().replace(/['"\s]/g, ''))
    .filter(k => k && k.length > 20);
    
  if (primaryKey && primaryKey.length > 20) {
    const cleanPrimary = primaryKey.trim().replace(/['"\s]/g, '');
    if (!allKeys.includes(cleanPrimary)) {
      allKeys.unshift(cleanPrimary);
    }
  }

  // If no keys found from env/file, use verified fallback keys
  if (allKeys.length === 0) {
    allKeys = [...FALLBACK_KEYS];
  }

  return allKeys.filter(k => !deadKeys.has(k));
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

const getGeminiClient = (skipKeys: string[] = []) => {
  const allKeys = getAllKeys();
  const now = Date.now();

  if (allKeys.length === 0) {
    throw new Error("No valid API keys found. Please verify your keys in the Settings menu (GEMINI_API_KEY or GEMINI_API_KEYS).");
  }

  // Filter out dead/skip keys
  let candidates = allKeys.filter(k => !skipKeys.includes(k));

  if (candidates.length === 0 && skipKeys.length > 0) {
    candidates = allKeys.filter(k => k !== skipKeys[skipKeys.length - 1]);
  }

  if (candidates.length === 0) candidates = allKeys;

  let selectedKey = '';
  
  // 1. Prioritize keys that have NEVER errored or haven't errored in 2 min
  const healthyCandidates = candidates.filter(c => {
    const health = keyHealth.get(c);
    return !health || (now - health.lastErrorTime > 120000);
  });

  if (healthyCandidates.length > 0) {
    // Pick the one used least recently for success (to distribute load)
    selectedKey = healthyCandidates.sort((a, b) => {
      const hA = keyHealth.get(a)?.lastSuccessTime || 0;
      const hB = keyHealth.get(b)?.lastSuccessTime || 0;
      return hA - hB;
    })[0];
  }

  // 2. Fallback: try any key not recently errored (60s)
  if (!selectedKey) {
    const okayCandidates = candidates.filter(c => {
      const health = keyHealth.get(c);
      return !health || (now - health.lastErrorTime > 60000);
    });
    if (okayCandidates.length > 0) {
      selectedKey = okayCandidates.sort((a, b) => {
        const hA = keyHealth.get(a)?.lastSuccessTime || 0;
        const hB = keyHealth.get(b)?.lastSuccessTime || 0;
        return hA - hB;
      })[0];
    }
  }

  // 3. Last resort: pick the one with most distant lastErrorTime among candidates
  if (!selectedKey) {
    selectedKey = candidates.sort((a, b) => {
      const hA = keyHealth.get(a)?.lastErrorTime || 0;
      const hB = keyHealth.get(b)?.lastErrorTime || 0;
      return hA - hB;
    })[0];
  }

  return { client: new GoogleGenAI({ apiKey: selectedKey }), key: selectedKey, totalKeys: allKeys.length };
};

const reportKeySuccess = (key: string) => {
  const health = keyHealth.get(key) || { 
    lastErrorTime: 0, 
    lastSuccessTime: 0, 
    consecutiveErrors: 0, 
    totalErrors: 0, 
    totalSuccesses: 0 
  };
  health.lastSuccessTime = Date.now();
  health.consecutiveErrors = 0;
  health.totalSuccesses++;
  keyHealth.set(key, health);
};

const reportKeyError = (key: string, type?: string, isPermanent = false) => {
  if (isPermanent) {
    deadKeys.add(key);
    console.error(`Key ${key.substring(0, 8)}... marked as PERMANENTLY DEAD (Invalid or Denied)`);
    return;
  }
  const health = keyHealth.get(key) || { 
    lastErrorTime: 0, 
    lastSuccessTime: 0, 
    consecutiveErrors: 0, 
    totalErrors: 0, 
    totalSuccesses: 0 
  };
  health.lastErrorTime = Date.now();
  health.consecutiveErrors++;
  health.totalErrors++;
  health.errorType = type;
  keyHealth.set(key, health);
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runAIAction(action: (client: any) => Promise<any>, maxRetries?: number) {
  const allKeys = getAllKeys();
  const effectiveRetries = maxRetries ?? Math.max(8, allKeys.length * 2);
  let triedKeys: string[] = [];
  let lastError: any = null;

  for (let attempt = 0; attempt <= effectiveRetries; attempt++) {
    const { client, key, totalKeys } = getGeminiClient(triedKeys);
    triedKeys.push(key);
    if (triedKeys.length > 5) triedKeys.shift();

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
        continue; 
      }

      if (isQuotaError || isServerOverloaded) {
        const errType = isQuotaError ? 'Quota' : 'Overload';
        console.warn(`Key ${key.substring(0, 8)}... error (${errType}). Attempt ${attempt + 1}/${effectiveRetries + 1}. Active keys: ${totalKeys}`);
        reportKeyError(key, errType);
        
        // Exponential backoff: 1.5s, 3s, 6s... with jitter
        const backoffMs = Math.pow(2, Math.min(attempt, 4)) * 1500 + Math.random() * 1000;
        await delay(backoffMs); 
        continue;
      }
      
      throw error;
    }
  }
  
  const finalError = new Error(`Exhausted ${triedKeys.length} attempts across available keys. ${lastError?.message || "Service unavailable"}.`);
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
  cleaned = cleaned.replace(/^(\s*(?:(?:Question|Q)\.?\s*[:\-]?\s*\d+[\.\)\-:]?|#\d+[\.\)\-:]?|\d+[\.\)\-:]?)\s+[^\n/]+?)\s*\/+\s*([A-Za-z\$\\\(\[\{\d][^\n]+)$/gm, (match, hindiPart, engPart) => {
    const cleanHindi = hindiPart.replace(/\s*\/+$/, '').trim();
    const cleanEng = engPart.trim();
    if (/[\u0900-\u097F]/.test(cleanHindi) || /[a-zA-Z]/.test(cleanEng)) {
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
    if (lNorm.toLowerCase() === rNorm.toLowerCase()) {
      return prefix + lNorm;
    }
    if (lNorm.replace(/\s+/g, '').toLowerCase() === rNorm.replace(/\s+/g, '').toLowerCase()) {
      return prefix + lNorm;
    }
    return match;
  });

  // 5. Clean standalone numbers/formulas/symbols/units duplicated with / e.g. '123 / 123', '$$x=2$$ / $$x=2$$'
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

  // 3. Fix standalone \text{...} in normal sentences
  cleaned = cleaned.replace(/\\text\{([^\}]+)\}/g, '$1');

  return cleaned;
};

const wrapLatexExpressions = (text: string): string => {
  if (!text) return text;

  // 0. Unwrap any mixed \text inside $
  let s = cleanMixedMathText(text);

  // 1. Repair double backslashes, control characters & keywords
  s = s
    .replace(/\\\\+(frac|sqrt|times|beta|rho|neq|alpha|theta|overline|underline|pm|div|cdot|left|right|sum|int|pi|infty|circ|deg|text|mathbf|mathrm|ge|le|approx|quad|to|sim|partial|Delta|lambda|mu|sigma|omega|phi|sin|cos|tan|log|ln|lim|binom)/g, '\\$1')
    .replace(/[\x0c\f]rac/g, '\\frac')
    .replace(/[\x08\b]eta/g, '\\beta')
    .replace(/(^|[^\\a-zA-Z])rac\{/g, '$1\\frac{')
    .replace(/(^|[^\\a-zA-Z])sqrt\{/g, '$1\\sqrt{')
    .replace(/(^|[^\\a-zA-Z])overline\{/g, '$1\\overline{')
    .replace(/(^|[^\\a-zA-Z])times(\s|\d|\$)/g, '$1\\times$2')
    .replace(/(^|[^\\a-zA-Z])frac(\d{2})(\d{2})/g, '$1\\frac{$2}{$3}')
    .replace(/(^|[^\\a-zA-Z])frac(\d)(\d{2})/g, '$1\\frac{$2}{$3}')
    .replace(/(^|[^\\a-zA-Z])frac(\d)(\d)(?!\d)/g, '$1\\frac{$2}{$3}')
    .replace(/\${3,}/g, '$$');

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
        const match = segment.match(/\\(frac|binom|sqrt|overline|underline|times|div|pm|cdot|alpha|beta|theta|sum|int|pi|sin|cos|tan)/);
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
  
  // 1. First repair and wrap any un-delimited LaTeX formulas
  let res = wrapLatexExpressions(text);

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

  // 5. Ensure any dangling single $$ on a line gets balanced
  const lines = res.split('\n');
  const fixedLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const dollarCount = (line.match(/\$\$/g) || []).length;
    if (dollarCount % 2 !== 0) {
      if (i + 1 < lines.length && (lines[i + 1].match(/\$\$/g) || []).length === 0 && /[+\-*\/=^_\\{}]/.test(lines[i + 1])) {
        const cleanL1 = line.replace(/\$\$/, '').trim();
        const nextMath = lines[i + 1].trim();
        fixedLines.push(cleanL1 ? `${cleanL1}\n$$${nextMath}$$` : `$$${nextMath}$$`);
        i++;
        continue;
      } else {
        line = line + '$$';
      }
    }
    fixedLines.push(line);
  }

  return fixedLines.join('\n');
};

const cleanRefinedText = (text: string): string => {
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
  showAnswers: boolean = true
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
    ? `**MCQ EXTRACTION MODE (STRICT LINE-BY-LINE FORMATTING REQUIRED)**:
- This document is an MCQ paper.
- Each MCQ must be cleanly formatted on separate lines:
  Question: 1. [Question Text]
  (a) [Option A]
  (b) [Option B]
  (c) [Option C]
  (d) [Option D]
${showAnswers ? '  Answer: [Correct Option Letter]' : ''}
- NEVER put all options on the same line. Always put each option on a new line.`
    : `**GENERAL DOCUMENT MODE**:
- Extract text as it appears. Maintain paragraphs and structure.`;

  const refineInstruction = refineMode
    ? `**REFINE MODE ENABLED (STRICT CONTENT CLEANING & FILTERING)**:
- YOUR GOAL: Extract ONLY the pure question text and pure options.
- **STRICTLY EXCLUDE ALL EXAM METADATA & TAGS**:
  - Completely IGNORE and DO NOT extract any previous year exam details, source tags, or shift names (e.g., "(SSC CGL Tier-I (CBE) परीक्षा, 02.12.2022 Shift-II)", "(SSC CGL Tier-II (CBE) परीक्षा, 07.03.2023)", "[RRB NTPC 2021]", "(UPSC 2020)", "(CTET 2022)", shift timings, exam dates, or test series tags).
  - Do NOT attach exam tags to options or questions.
- **REMOVE JUNK & BRANDING**: Exclude book chapter names, page headers/footers, page numbers, watermarks, Telegram/website links, publisher names, exam center codes, or decorative text.
- **PRESERVE PURE CONTENT**: Extract the actual question and options cleanly and accurately.`
    : `**FULLY EXTRACTION MODE (A TO Z)**:
- Extract EVERY piece of text from the page, including headers, footers, page numbers, and small boilerplate text. Leave nothing out.`;

  return runAIAction(async (client) => {
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
   - **STRICT MATH RULE**: You MUST enclose ALL mathematical formulas, variables, and expressions in double dollar signs like \`$$\` ... \`$$\` (e.g., \`$$x^2 + y^2 = r^2$$\`), even for simple inline variables like \`$$x$$\`.
   - Use standard LaTeX format for all math.
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

    const responseText = response.text;
    if (!responseText) {
      throw new Error("Empty response from Gemini API");
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
        console.error("JSON parse error:", cleanedText);
        throw new Error("Failed to parse AI response as JSON");
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
  });
};

const proofreadWithRetry = async (rawText: string, isBilingual: boolean = false): Promise<any> => {
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
    
    RAW TEXT:
    "${rawText}"
    
    Return the result as a JSON object with a 'questions' array. Each item should have:
    - questionText: string
    - options: array of {label: string, text: string}
    - answer: string (the label of the correct option if found, e.g., "A")
    
    If no MCQs are found, return {"questions": []}.
  `;

  return runAIAction(async (client) => {
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

    const cleanedText = responseText.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
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
  });
};

app.post('/api/extract', async (req, res) => {
  try {
    const { base64Image, ocrText, numberingStyle, includeImages, isBilingual, mcqMode, refineMode, showAnswers = true } = req.body;
    const elements = await extractLayoutWithRetry(base64Image, ocrText, numberingStyle, includeImages, isBilingual, mcqMode, refineMode, showAnswers);
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
    const questions = await proofreadWithRetry(rawText, isBilingual);
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

export default app;
