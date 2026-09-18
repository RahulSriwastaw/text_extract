import katex from 'katex';
import { LatexRepairResponse, LatexRepairStatus, LatexValidationIssue, MockTestMcqItem } from '../types.js';
import { cleanMocktestText, safeParseAiJsonObject } from '../services/textCleanService.js';

export interface LatexExtractResult {
  hasFormulas: boolean;
  formulas: string[];
  issues: LatexValidationIssue[];
  isValid: boolean;
}

/**
 * Validates a single LaTeX math expression with KaTeX.
 */
export function validateSingleLatexFormula(latex: string, displayMode = false): { valid: boolean; error?: string } {
  const trimmed = latex.trim();
  if (!trimmed) return { valid: true };

  try {
    katex.renderToString(trimmed, {
      throwOnError: true,
      displayMode,
      strict: false
    });
    return { valid: true };
  } catch (err: any) {
    return {
      valid: false,
      error: err?.message || 'KaTeX parse error'
    };
  }
}

/**
 * Extracts and validates all LaTeX expressions found in content.
 * Looks for $$...$$, $...$, \(...\), \[...\], and naked TeX macros.
 */
export function validateAndExtractLatex(content: string): LatexExtractResult {
  if (!content || !content.trim()) {
    return { hasFormulas: false, formulas: [], issues: [], isValid: true };
  }

  const formulas: string[] = [];
  const issues: LatexValidationIssue[] = [];

  // Check 1: Unbalanced dollar signs (odd number of unescaped $)
  const unescapedDollars = (content.match(/(?<!\\)\$/g) || []).length;
  if (unescapedDollars % 2 !== 0) {
    issues.push({
      formula: 'Content-level $ delimiter',
      error: `Unbalanced math delimiters: found ${unescapedDollars} unescaped $ signs.`
    });
  }

  // Check 2: Extract display math $$...$$
  const displayRegex = /\$\$([\s\S]*?)\$\$/g;
  let match: RegExpExecArray | null;
  while ((match = displayRegex.exec(content)) !== null) {
    const raw = match[1];
    formulas.push(raw);
    const val = validateSingleLatexFormula(raw, true);
    if (!val.valid) {
      issues.push({ formula: `$$${raw}$$`, error: val.error || 'Invalid display math' });
    }
  }

  // Check 3: Extract bracket display \[...\]
  const bracketDisplayRegex = /\\\[([\s\S]*?)\\\]/g;
  while ((match = bracketDisplayRegex.exec(content)) !== null) {
    const raw = match[1];
    formulas.push(raw);
    const val = validateSingleLatexFormula(raw, true);
    if (!val.valid) {
      issues.push({ formula: `\\[${raw}\\]`, error: val.error || 'Invalid display math' });
    }
  }

  // Check 4: Extract inline math $...$ (avoiding $$)
  const inlineRegex = /(?<!\$)\$([^\$\n]+?)\$(?!\$)/g;
  while ((match = inlineRegex.exec(content)) !== null) {
    const raw = match[1];
    formulas.push(raw);
    const val = validateSingleLatexFormula(raw, false);
    if (!val.valid) {
      issues.push({ formula: `$${raw}$`, error: val.error || 'Invalid inline math' });
    }
  }

  // Check 5: Extract inline \(...\)
  const parenInlineRegex = /\\\(([\s\S]*?)\\\)/g;
  while ((match = parenInlineRegex.exec(content)) !== null) {
    const raw = match[1];
    formulas.push(raw);
    const val = validateSingleLatexFormula(raw, false);
    if (!val.valid) {
      issues.push({ formula: `\\(${raw}\\)`, error: val.error || 'Invalid inline math' });
    }
  }

  // Check 6: Detect naked or un-delimited LaTeX macros (e.g. \frac{1}{2} without $)
  const nakedMacroRegex = /(?<!\$|\\|\w)(\\(?:frac|sqrt|sum|int|times|div|pm|approx|leq|geq|neq|alpha|beta|gamma|theta|degree|Omega|rightarrow|Rightarrow)\s*\{?[^\s$]*\}?)(?!\$)/g;
  while ((match = nakedMacroRegex.exec(content)) !== null) {
    const macroSnippet = match[1];
    const alreadyFound = formulas.some(f => f.includes(macroSnippet));
    if (!alreadyFound) {
      const val = validateSingleLatexFormula(macroSnippet, false);
      if (!val.valid) {
        issues.push({ formula: macroSnippet, error: `Naked / un-delimited broken LaTeX macro: ${val.error}` });
      }
    }
  }

  return {
    hasFormulas: formulas.length > 0 || issues.length > 0,
    formulas,
    issues,
    isValid: issues.length === 0
  };
}

/**
 * Local deterministic LaTeX normalization to repair common formatting/OCR errors
 * without invoking external AI API calls.
 */
export function normalizeLatexLocally(content: string): string {
  if (!content) return '';
  let res = content;

  // 1. Standardize environments: KaTeX requires aligned/gathered instead of align/gather
  res = res.replace(/\\begin\{align\*?\}/g, '\\begin{aligned}');
  res = res.replace(/\\end\{align\*?\}/g, '\\end{aligned}');
  res = res.replace(/\\begin\{gather\*?\}/g, '\\begin{gathered}');
  res = res.replace(/\\end\{gather\*?\}/g, '\\end{gathered}');

  // 2. Convert MathJax delimiters \( ... \) and \[ ... \] into $ and $$
  res = res.replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$');
  res = res.replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$');

  // 3. Fix double-escaped backslashes in TeX commands (e.g., \\frac -> \frac, \\sqrt -> \sqrt)
  res = res.replace(/\\\\([a-zA-Z]+)/g, '\\$1');

  // 4. Fix corrupted JSON escape sequences
  res = res.replace(/[\x0c\u21e1\u2191]rac/g, '\\frac');
  res = res.replace(/[\x09\b]imes/g, '\\times');
  res = res.replace(/[\r\x0d]?\\?r?ightarrow\b/gi, '\\rightarrow');

  // 5. Wrap naked fractions outside $...$ in $...$
  res = res.replace(/(?<!\$|\\)(?:(\d+)\s*)?\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}(?!\$)/g, (_m, whole, n, d) => {
    return whole ? `$${whole}\\frac{${n}}{${d}}$` : `$\\frac{${n}}{${d}}$`;
  });

  // 6. Wrap naked \sqrt outside $...$ in $...$
  res = res.replace(/(?<!\$|\\)\\sqrt(?:\s*\[[^\]]+\])?\s*\{([^{}]+)\}(?!\$)/g, (_m, inner) => `$\\sqrt{${inner}}$`);

  // 7. Clean trailing backslashes at end of lines/paragraphs
  res = res.replace(/\\+(\s*<\/p>|\s*$)/gm, '$1');

  // 8. Safe line-by-line single dollar balancing
  const rawLines = res.split('\n');
  for (let li = 0; li < rawLines.length; li++) {
    let line = rawLines[li];
    const hasPStart = /^\s*<p>/i.test(line);
    const hasPEnd = /<\/p>\s*$/i.test(line);
    let inner = line.replace(/^\s*<p>/i, '').replace(/<\/p>\s*$/i, '').trim();

    const displayMatch = inner.match(/\$\$/g);
    if (!displayMatch) {
      const dollarCount = (inner.match(/(?<!\\)\$/g) || []).length;
      if (dollarCount === 1) {
        if (inner.endsWith('$')) {
          if (inner.includes('=')) {
            inner = inner.replace(/(=\s*)([^\n$]*\\[a-zA-Z][^\n$]*)\$$/, '$1$$$2$$');
          } else if (/\\[a-zA-Z]/.test(inner)) {
            inner = inner.replace(/([^\n$]*\\[a-zA-Z][^\n$]*)\$$/, '$$$1$$');
          } else {
            inner = inner.replace(/\$$/, '');
          }
        } else if (inner.startsWith('=')) {
          inner = `$$${inner}$$`;
        } else {
          inner = inner.replace(/(?<!\\)\$([^\n$]*)$/, '$$$1$$');
        }
      }
    }
    rawLines[li] = inner;
  }
  res = rawLines.join('\n');

  // 9. Clean inside all math blocks:
  // - Escape unescaped % inside math
  // - Replace HTML <br> with \\ (LaTeX newline)
  // - Strip HTML tags inside math blocks
  res = res.replace(/(\$\$[\s\S]*?\$\$|\$[^\$\n]+?\$)/g, (match) => {
    const isDisplay = match.startsWith('$$');
    let inner = isDisplay ? match.slice(2, -2) : match.slice(1, -1);

    inner = inner.replace(/(?<!\\)%/g, '\\%');
    inner = inner.replace(/<br\s*\/?>/gi, ' \\\\ ');
    inner = inner.replace(/<\/?(?:p|b|strong|i|em|span|div)[^>]*>/gi, '');
    inner = inner.replace(/\\cosec\b/g, '\\csc');

    return isDisplay ? `$$${inner}$$` : `$${inner}$`;
  });

  // Strip all HTML tags completely
  res = res
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:p|b|strong|i|em|span|div|table|thead|tbody|tr|td|th|ul|ol|li|hr)[^>]*>/gi, '')
    .trim();

  return res.trim();
}

/**
 * Builds a strict prompt for Gemini to repair LaTeX syntax.
 */
function buildLatexRepairPrompt(content: string, contentType: string, selectedFormula?: string): string {
  return `You are an expert LaTeX and mathematical typesetting assistant for competitive examinations.

TASK:
Repair broken, incomplete, improperly escaped, or invalid LaTeX syntax in the provided ${contentType.toUpperCase()} content.

INPUT CONTENT:
"""
${content}
"""
${selectedFormula ? `TARGET FORMULA TO SPECIFICALLY REPAIR:\n"""\n${selectedFormula}\n"""\n` : ''}

CRITICAL RULES:
1. PURE LATEX REPAIR:
   - Fix broken braces (e.g. \\frac{a}{b), missing brackets, unescaped symbols, mismatched \\left and \\right.
   - Fix corrupted LaTeX commands from OCR or JSON escaping (e.g. rac -> \\frac, imes -> \\times).
   - Ensure proper math delimiters: inline math in $...$, display equations in $$...$$.
2. NO HTML TAGS:
   - Output clean normal text without HTML tags (NO <p>, <br>, <b>, <table>, <span>).
   - Preserve all Hindi (Devanagari) and English text exactly. Do NOT change question wording or options.
3. MATHEMATICAL INTEGRITY:
   - Do NOT change mathematical relations, numbers, or exponents.
4. CONFIDENCE:
   - If repaired to clean KaTeX, set status to "fixed".
   - If already valid KaTeX, set status to "valid".
   - If intent cannot be deduced, set status to "review_required".

OUTPUT FORMAT:
Respond with ONLY a valid, strict JSON object (no markdown code fence, no text outside JSON):
{
  "status": "fixed" | "valid" | "review_required",
  "original": "<original content>",
  "repaired": "<repaired content with clean KaTeX>",
  "changes": [
    "Brief explanation of syntax fix 1",
    "Brief explanation of syntax fix 2"
  ],
  "confidence": 0.95
}`;
}

/**
 * Core function to repair content using local validation + Gemini AI + post-validation.
 */
export async function repairContentLatex(
  content: string,
  contentType: string = 'content',
  selectedFormula?: string,
  userKey?: string,
  runAIFn?: (action: (client: any) => Promise<any>, userKey?: string) => Promise<any>,
  callGeminiFn?: (client: any, pModel: string, fModel: string, contents: any[], config?: any, label?: string) => Promise<string>,
  primaryModel: string = 'gemini-3.5-flash',
  fallbackModel: string = 'gemini-flash-latest'
): Promise<LatexRepairResponse> {
  if (!content || !content.trim()) {
    return {
      status: 'valid',
      original: content || '',
      repaired: content || '',
      changes: ['No content provided to repair.'],
      confidence: 1.0
    };
  }

  // STEP 1: Local KaTeX validation
  const initialValidation = validateAndExtractLatex(content);
  if (initialValidation.isValid && !selectedFormula) {
    return {
      status: 'valid',
      original: content,
      repaired: content,
      changes: ['All formulas passed local KaTeX validation. No repair needed.'],
      confidence: 1.0
    };
  }

  // STEP 2: Try deterministic local normalization first
  const locallyNormalized = normalizeLatexLocally(content);
  const normalizedValidation = validateAndExtractLatex(locallyNormalized);

  // If local normalization completely resolved all KaTeX issues without AI:
  if (normalizedValidation.isValid && locallyNormalized !== content && !selectedFormula) {
    return {
      status: 'fixed',
      original: content,
      repaired: locallyNormalized,
      changes: [
        'Repaired delimiters and backslashes using local KaTeX normalizer (0 AI tokens spent).'
      ],
      confidence: 0.98
    };
  }

  // STEP 3: Content has complex syntax errors -> Call Gemini AI
  if (!runAIFn || !callGeminiFn) {
    return {
      status: normalizedValidation.isValid ? 'fixed' : 'review_required',
      original: content,
      repaired: locallyNormalized,
      changes: normalizedValidation.issues.map(i => `${i.formula}: ${i.error}`),
      confidence: normalizedValidation.isValid ? 0.9 : 0.4
    };
  }

  const prompt = buildLatexRepairPrompt(content, contentType, selectedFormula);

  try {
    const rawAiOutput = await runAIFn(async (client: any) => {
      return callGeminiFn(
        client,
        primaryModel,
        fallbackModel,
        [{ text: prompt }],
        { temperature: 0.1, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
        'latex-repair'
      );
    }, userKey);

    const parsed = safeParseAiJsonObject(rawAiOutput);
    if (!parsed || !parsed.repaired) {
      throw new Error('AI failed to return valid JSON with repaired content.');
    }

    const repairedContent = parsed.repaired;
    const initialChanges: string[] = Array.isArray(parsed.changes)
      ? parsed.changes
      : (parsed.changes ? [String(parsed.changes)] : ['LaTeX syntax repaired by AI.']);

    // STEP 4: Post-AI KaTeX Validation on AI output
    const postValidation = validateAndExtractLatex(repairedContent);

    if (!postValidation.isValid) {
      const safeHealed = normalizeLatexLocally(repairedContent);
      const safeValidation = validateAndExtractLatex(safeHealed);

      if (safeValidation.isValid) {
        return {
          status: 'fixed',
          original: content,
          repaired: safeHealed,
          changes: [...initialChanges, 'KaTeX validated after secondary normalization.'],
          confidence: Math.min(Number(parsed.confidence) || 0.85, 0.9)
        };
      }

      return {
        status: 'review_required',
        original: content,
        repaired: safeHealed,
        changes: [
          ...initialChanges,
          ...safeValidation.issues.map(iss => `Post-repair KaTeX warning: ${iss.error}`)
        ],
        confidence: Math.min(Number(parsed.confidence) || 0.5, 0.6)
      };
    }

    const confidenceVal = typeof parsed.confidence === 'number'
      ? Math.max(0.1, Math.min(1.0, parsed.confidence))
      : (parsed.status === 'valid' ? 1.0 : 0.95);

    const statusVal: LatexRepairStatus = parsed.status === 'review_required'
      ? 'review_required'
      : (parsed.status === 'valid' ? 'valid' : 'fixed');

    return {
      status: statusVal,
      original: content,
      repaired: repairedContent,
      changes: initialChanges,
      confidence: confidenceVal
    };
  } catch (error: any) {
    console.warn('[LatexRepair] AI call failed, falling back to local normalizer:', error?.message || error);
    return {
      status: normalizedValidation.isValid ? 'fixed' : 'review_required',
      original: content,
      repaired: locallyNormalized,
      changes: [
        `AI Repair unavailable (${error?.message || 'Error'}). Applied local KaTeX normalization.`,
        ...normalizedValidation.issues.map(i => `${i.formula}: ${i.error}`)
      ],
      confidence: normalizedValidation.isValid ? 0.8 : 0.4,
      error: error?.message || 'AI repair failed'
    };
  }
}

/**
 * Repairs an entire MCQ Item across questions, options, and solutions.
 */
export async function repairEntireMcqItem(
  item: MockTestMcqItem,
  scope: 'entire_mcq' | 'question' | 'options' | 'solution' = 'entire_mcq',
  userKey?: string,
  runAIFn?: any,
  callGeminiFn?: any,
  primaryModel?: string,
  fallbackModel?: string
): Promise<{ repairedItem: MockTestMcqItem; result: LatexRepairResponse }> {
  const cloned: MockTestMcqItem = { ...item };
  const allChanges: string[] = [];
  let worstStatus: LatexRepairStatus = 'valid';
  let totalConfidence = 0;
  let count = 0;

  const repairField = async (val: string, fieldName: string) => {
    if (!val || !val.trim()) return val;
    const res = await repairContentLatex(
      val,
      fieldName,
      undefined,
      userKey,
      runAIFn,
      callGeminiFn,
      primaryModel,
      fallbackModel
    );
    if (res.status === 'review_required') worstStatus = 'review_required';
    else if (res.status === 'fixed' && worstStatus !== 'review_required') worstStatus = 'fixed';

    if (res.repaired !== val) {
      allChanges.push(`[${fieldName}] ${res.changes.join('; ')}`);
    }
    totalConfidence += res.confidence;
    count++;
    return res.repaired;
  };

  if (scope === 'entire_mcq' || scope === 'question') {
    if (cloned.question_hi) cloned.question_hi = await repairField(cloned.question_hi, 'question_hi');
    if (cloned.question_en) cloned.question_en = await repairField(cloned.question_en, 'question_en');
  }

  if (scope === 'entire_mcq' || scope === 'options') {
    if (cloned.option1_hi) cloned.option1_hi = await repairField(cloned.option1_hi, 'option1_hi');
    if (cloned.option2_hi) cloned.option2_hi = await repairField(cloned.option2_hi, 'option2_hi');
    if (cloned.option3_hi) cloned.option3_hi = await repairField(cloned.option3_hi, 'option3_hi');
    if (cloned.option4_hi) cloned.option4_hi = await repairField(cloned.option4_hi, 'option4_hi');

    if (cloned.option1_en) cloned.option1_en = await repairField(cloned.option1_en, 'option1_en');
    if (cloned.option2_en) cloned.option2_en = await repairField(cloned.option2_en, 'option2_en');
    if (cloned.option3_en) cloned.option3_en = await repairField(cloned.option3_en, 'option3_en');
    if (cloned.option4_en) cloned.option4_en = await repairField(cloned.option4_en, 'option4_en');
  }

  if (scope === 'entire_mcq' || scope === 'solution') {
    if (cloned.solution_hi) cloned.solution_hi = await repairField(cloned.solution_hi, 'solution_hi');
    if (cloned.solution_en) cloned.solution_en = await repairField(cloned.solution_en, 'solution_en');
  }

  const avgConfidence = count > 0 ? totalConfidence / count : 1.0;

  const result: LatexRepairResponse = {
    status: worstStatus,
    original: JSON.stringify(item, null, 2),
    repaired: JSON.stringify(cloned, null, 2),
    changes: allChanges.length > 0 ? allChanges : ['All LaTeX formulas verified valid.'],
    confidence: avgConfidence,
    repairedItem: cloned
  };

  return { repairedItem: cloned, result };
}
