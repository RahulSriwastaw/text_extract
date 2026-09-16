/**
 * textCleanService.ts
 *
 * UNIFIED SOURCE OF TRUTH for math, LaTeX, KaTeX, MathJax, and text normalization.
 * Connects both the MockTest Extractor and PDF-to-Text conversion tools to the same
 * systematic, human-like standard.
 */

const EXAM_KEYWORD_REGEX = '(?:RRB|SSC|NTPC|CBT|Tech|ALP|JE|Group[\\s\\-]*D|RPF|SI|Constable|CGL|CHSL|MTS|CPO|GD|Steno|UPSC|CDS|NDA|AFCAT|IBPS|SBI|PO|Clerk|BPSC|UPPSC|MPPSC|HSSC|DSSSB|CTET|UPTET|REET|Railway|एसएससी|आरआरबी|एनटीपीसी|रेलवे|ग्रुप[\\s\\-]*डी|टेक)';
const SHIFT_KEYWORD_REGEX = '(?:Afternoon|Morning|Evening|Night|Shift[\\s\\-]*[I|II|III|IV|V|1|2|3|4|5]|Batch[\\s\\-]*\\d+|दोपहर|सुबह|शाम|रात|प्रथम[\\s\\-]*पाली|द्वितीय[\\s\\-]*पाली|तृतीय[\\s\\-]*पाली|पाली[\\s\\-]*\\d+)';
const DATE_PATTERN_REGEX = '(?:\\d{1,2}[\\/\\.\\-]\\d{1,2}[\\/\\.\\-]\\d{2,4}|\\b(?:19|20)\\d{2}\\b)';

const SUB_MAP: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉'
};

/**
 * Strips exam tags, shifts, dates, publication watermarks, and boilerplate headers.
 */
export function stripExamTagsAndJunk(text: string): string {
  if (!text) return '';
  let res = text;

  // Bracketed & parenthesized exam tags
  res = res.replace(new RegExp(`\\[\\s*${EXAM_KEYWORD_REGEX}[^\\]]*\\]`, 'gi'), '');
  res = res.replace(new RegExp(`\\(\\s*${EXAM_KEYWORD_REGEX}[^\\)]*\\)`, 'gi'), '');
  res = res.replace(new RegExp(`(?:^|<p>)\\s*\\[\\s*${EXAM_KEYWORD_REGEX}[^\\]]*\\]\\s*`, 'gi'), (m) => m.startsWith('<p>') ? '<p>' : '');
  res = res.replace(new RegExp(`(?:^|<p>)\\s*\\(\\s*${EXAM_KEYWORD_REGEX}[^\\)]*\\)\\s*`, 'gi'), (m) => m.startsWith('<p>') ? '<p>' : '');

  // Trailing shift or date pattern
  const trailingPattern = new RegExp(
    `(?:[\\s\\.\\,\\;\\-\\–\\—]|\\?|\\!)+(${EXAM_KEYWORD_REGEX}[\\s\\S]*?(?:${DATE_PATTERN_REGEX}|${SHIFT_KEYWORD_REGEX})[\\s\\S]*?)(\\s*<\\/p>|$)`,
    'i'
  );
  res = res.replace(trailingPattern, (match, _tag, closing) => {
    const preChar = match.trim().charAt(0);
    const punct = (preChar === '?' || preChar === '!' || preChar === '.') ? preChar : '';
    return punct + (closing || '');
  });

  res = res.replace(new RegExp(`(?:[\\s\\-\\–\\—]+)(${DATE_PATTERN_REGEX}\\s*\\(?${SHIFT_KEYWORD_REGEX}\\)?|\\(?${SHIFT_KEYWORD_REGEX}\\)?)(\\s*<\\/p>|$)`, 'i'), '$2');
  res = res.replace(/(?:Youth\s*Competition\s*Times|Pinnacle\s*Publication|Testbook\.com|Adda247|Exampur|Gradeup|Drishti\s*IAS|Kiran\s*Prakashan|Platform\s*Education|Rukmini\s*Prakashan)[\s\S]*?(?:<\/p>|$)/gi, (m) => m.endsWith('</p>') ? '</p>' : '');
  res = res.replace(/\s+<\/p>/gi, '</p>').replace(/[ \t]{2,}/g, ' ');

  return res.trim();
}

/**
 * Strips option letter references (e.g. 'सही विकल्प A है।', 'Option B is correct.')
 */
export function stripOptionLetterReferences(text: string): string {
  if (!text) return '';
  let res = text;
  // Hindi option references
  res = res.replace(/(?:(?:अतः|इसलिए|इस प्रकार|यहाँ|अत:|स्पष्टतः)\s*,?\s*)?(?:सही\s*)?(?:उत्तर\s*)?विकल्प\s*(?:\([a-eA-E1-5]\)|[a-eA-E1-5])\s*(?:ही\s*)?(?:सही|उचित|सत्य|अभिष्ट|अभीष्ट|उपयुक्त)?\s*(?:उत्तर|विकल्प)?\s*(?:है|होगा|होता है)\s*[।\.]?\s*(?=<\/p>|$)/gi, '');
  res = res.replace(/(?:(?:अतः|इसलिए|इस प्रकार|यहाँ|अत:|स्पष्टतः)\s*,?\s*)?सही\s*(?:उत्तर|विकल्प)\s*(?:\([a-eA-E1-5]\)|[a-eA-E1-5])\s*(?:है|होगा)\s*[।\.]?\s*(?=<\/p>|$)/gi, '');
  res = res.replace(/(?:(?:अतः|इसलिए|इस प्रकार)\s*,?\s*)?विकल्प\s*(?:\([a-eA-E1-5]\)|[a-eA-E1-5])\s*सही\s*(?:है|उत्तर है)\s*[।\.]?\s*(?=<\/p>|$)/gi, '');
  res = res.replace(/सही\s*उत्तर\s*विकल्प\s*(?:\([a-eA-E1-5]\)|[a-eA-E1-5])\s*है\s*[।\.]?\s*(?=<\/p>|$)/gi, '');
  res = res.replace(/सही\s*विकल्प\s*(?:\([a-eA-E1-5]\)|[a-eA-E1-5])\s*है\s*[।\.]?\s*(?=<\/p>|$)/gi, '');
  res = res.replace(/(?:(?:अतः|इसलिए|इस प्रकार|यहाँ|अत:)\s*,?\s*)?सही\s*(?:उत्तर|विकल्प)\s*(?:\([a-eA-E1-5]\)|[a-eA-E1-5])\s*(?:है|होगा)\s*[।\.]\s*/gi, '');
  res = res.replace(/(?:(?:अतः|इसलिए|इस प्रकार|यहाँ|अत:|स्पष्टतः)\s*,?\s*)?(?:सही\s*)?(?:उत्तर\s*)?विकल्प\s*(?:\([a-eA-E1-5]\)|[a-eA-E1-5])\s*[।\.]?\s*(?=<\/p>|$)/gi, '');

  // English option references
  res = res.replace(/(?:(?:Therefore|Hence|Thus|So)\s*,?\s*)?(?:the\s*)?(?:correct\s*)?(?:option|choice|answer)\s*(?:is\s*)?(?:\([a-eA-E1-5]\)|[a-eA-E1-5])\s*(?:is\s*(?:the\s*)?(?:correct|right)(?:\s*(?:answer|option|choice))?)?\s*[\.]?\s*(?=<\/p>|$)/gi, '');
  res = res.replace(/(?:(?:Therefore|Hence|Thus|So)\s*,?\s*)?(?:option|choice)\s*(?:\([a-eA-E1-5]\)|[a-eA-E1-5])\s*is\s*(?:the\s*)?(?:correct|right)(?:\s*(?:answer|option|choice))?\s*[\.]?\s*(?=<\/p>|$)/gi, '');
  res = res.replace(/(?:The\s*)?[Cc]orrect\s*(?:option|answer|choice)\s*[:：\-–]?\s*(?:\([a-eA-E1-5]\)|[a-eA-E1-5])\s*[\.]?\s*(?=<\/p>|$)/gi, '');
  res = res.replace(/Correct\s*answer\s*is\s*(?:\([a-eA-E1-5]\)|[a-eA-E1-5])\s*[\.]?\s*(?=<\/p>|$)/gi, '');
  res = res.replace(/(?:(?:Therefore|Hence|Thus|So)\s*,?\s*)?(?:the\s*)?(?:correct\s*)?(?:option|choice|answer)\s*(?:is\s*)?(?:\([a-eA-E1-5]\)|[a-eA-E1-5])\s*[\.]\s*/gi, '');

  res = res.replace(/\s+<\/p>/gi, '</p>').trim();
  return res;
}

/**
 * Strips prefix labels like 'हल:', 'Solution:', 'Explanation:' from solutions.
 */
export function stripSolutionPrefix(text: string): string {
  if (!text) return '';
  let res = text.trim();
  res = res.replace(/^<p>\s*(?:<(?:b|strong)[^>]*>\s*)?(?:Solution|हल|Explanation|व्याख्या|उत्तर)\s*[:：\-–]?\s*(?:<\/(?:b|strong)>\s*)?<\/p>\s*/i, '');
  res = res.replace(/^(<p>\s*)(?:<(?:b|strong)[^>]*>\s*)?(?:Solution|हल|Explanation|व्याख्या|उत्तर)\s*[:：\-–]?\s*(?:<\/(?:b|strong)>\s*)?(?:\s*<br\s*\/?>)?\s*/i, '$1');
  res = res.replace(/^(?:<(?:b|strong)[^>]*>\s*)?(?:Solution|हल|Explanation|व्याख्या|उत्तर)\s*[:：\-–]?\s*(?:<\/(?:b|strong)>\s*)?(?:\s*<br\s*\/?>)?\s*/i, '');
  res = res.replace(/^<p>\s+/, '<p>');
  res = stripOptionLetterReferences(res);
  return res.trim();
}

/**
 * Normalizes chemical reaction formulas.
 */
export function formatChemicalReactions(text: string): string {
  if (!text) return text;
  let res = text;
  
  res = res.replace(/\\?xrightarrow\s*(?:\[([^\]]*)\])?\s*\{([^\}]*)\}/gi, (_m, below, above) => {
    const cleanAbove = (above || '').replace(/\\text\{([^\}]+)\}/g, '$1').replace(/[\{\}]/g, '').trim();
    const cleanBelow = (below || '').replace(/\\text\{([^\}]+)\}/g, '$1').replace(/[\{\}]/g, '').trim();
    const label = cleanBelow ? `${cleanAbove} / ${cleanBelow}` : cleanAbove;
    return label ? ` ⎯⎯(${label})⎯→ ` : ` → `;
  });

  res = res.replace(/\\?xrightarrow\s*([a-zA-Z\u0900-\u097F\s]+?)(?=\s+[A-Z0-9\+\-]|s*$)/g, (_m, label) => {
    const cleanLabel = label.trim();
    return cleanLabel ? ` ⎯⎯(${cleanLabel})⎯→ ` : ` → `;
  });

  res = res.replace(/([A-Za-z\)])(_[0-9]+|_\{[0-9]+\})/g, (_m, elem, sub) => {
    const digits = sub.replace(/[_{}]/g, '');
    const unicodeSub = digits.split('').map(d => SUB_MAP[d] || d).join('');
    return elem + unicodeSub;
  });

  return res;
}

/**
 * Cleans bilingual duplicate strings (e.g. "123 / 123" -> "123").
 */
export function cleanBilingualDuplicates(text: string): string {
  if (!text) return text;
  const parts = text.split(/\s*\/\s*/);
  if (parts.length === 2 && parts[0].trim() === parts[1].trim()) {
    return parts[0].trim();
  }
  return text;
}

/**
 * THE UNIFIED TEXT & MATH CLEANER (cleanMocktestText)
 * Used identically on Server and Client, for both Mocktest Extractor and PDF Converter.
 */
export function cleanMocktestText(text: string): string {
  if (!text) return '';
  let res = text;

  // 1. Strip junk tags and watermarks
  res = stripExamTagsAndJunk(res);

  // 2. Strip AI coach filler
  res = res.replace(/(?:<br\s*\/?>|\n)?\s*(?:<strong>|<b>)?\s*Important Exam Point\s*:\s*(?:<\/strong>|<\/b>)?[\s\S]*?(?:<\/p>|$)/gi, (m) => m.endsWith('</p>') ? '</p>' : '');
  res = res.replace(/(?:<strong>|<b>)?\s*Key Point\s*:\s*(?:<\/strong>|<\/b>)?\s*/gi, '');
  res = res.replace(/(?:<strong>|<b>)?\s*Detailed Explanation\s*:\s*(?:<\/strong>|<\/b>)?\s*/gi, '');
  res = res.replace(/(?:<br\s*\/?>|\n)?\s*(?:<strong>|<b>)?\s*Additional Information\s*:\s*(?:<\/strong>|<\/b>)?\s*/gi, '<br>');

  // 3. Decode common HTML entities (crucial for character series like &amp; -> &)
  res = res.replace(/&amp;/g, '&')
           .replace(/&lt;/g, '<')
           .replace(/&gt;/g, '>')
           .replace(/&quot;/g, '"')
           .replace(/&#39;/g, "'");

  // 4. Fix corrupted formfeed \x0c and tab \t LaTeX from improper JSON parsing
  res = res.replace(/[\x0c\u21e1\u2191]rac/g, '\\frac');
  res = res.replace(/[\x09\b]imes/g, '\\times');
  res = res.replace(/(\d|[a-zA-Z\)])\s+imes\s+/g, '$1 \\times ');

  // 5. Fix corrupted \r + ightarrow or literal "ightarrow" from JSON unescaping
  res = res.replace(/[\r\x0d]?\\?r?ightarrow\b/gi, ' → ');
  res = res.replace(/([a-zA-Z0-9,])\s*ightarrow\s*([a-zA-Z0-9])/gi, '$1 → $2');
  res = res.replace(/([a-zA-Z0-9,])\s*ightarrow\b/gi, '$1 → ');
  res = res.replace(/\bightarrow\b/gi, '→');

  // 6. Standardize LaTeX arrows to clean Unicode arrows
  res = res.replace(/\\rightarrow\b/g, ' → ');
  res = res.replace(/\\Rightarrow\b/g, ' ⇒ ');
  res = res.replace(/\\leftarrow\b/g, ' ← ');
  res = res.replace(/\\Leftarrow\b/g, ' ⇐ ');
  res = res.replace(/\\to\b/g, ' → ');

  // 7. Clean LaTeX spacing junk \! (negative thin space)
  res = res.replace(/\\!/g, '');

  // 8. Convert symbol-series LaTeX commands to clean Unicode symbols
  res = res.replace(/\\Omega\b/g, 'Ω');
  res = res.replace(/\\(?:big)?wedge\b/gi, '∧');
  res = res.replace(/\\(?:big)?vee\b/gi, '∨');
  res = res.replace(/\\degree\b/g, '°');

  // 9. Unescape stray escaped digits like \7 (do NOT unescape \%, \_, \&, \# which are valid/required in LaTeX!)
  res = res.replace(/\\([0-9])/g, '$1');

  // 10. Standardize environments: KaTeX requires aligned/gathered instead of align/gather
  res = res.replace(/\\begin\{align\*?\}/g, '\\begin{aligned}');
  res = res.replace(/\\end\{align\*?\}/g, '\\end{aligned}');
  res = res.replace(/\\begin\{gather\*?\}/g, '\\begin{gathered}');
  res = res.replace(/\\end\{gather\*?\}/g, '\\end{gathered}');

  // 11. Clean empty \text{ } or \text{  }
  res = res.replace(/\\text\s*\{\s*\}/g, ' ');

  // 12. Fix double-escaped backslashes (\\frac -> \frac, \\sqrt -> \sqrt)
  res = res.replace(/\\\\([a-zA-Z]+)/g, '\\$1');

  // 13. Standardize MathJax inline \( ... \) and display \[ ... \] into KaTeX $ and $$
  res = res.replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$');
  res = res.replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$');

  // 14. Fix stray $= and =$ around operators and currency
  res = res.replace(/\$\s*=\s*₹/g, '= ₹');
  res = res.replace(/\s*=\s*\$\s*₹/g, ' = ₹');
  res = res.replace(/\$\s*₹\s*([0-9,]+(?:\.[0-9]+)?)\s*\$/g, '₹$1');
  res = res.replace(/\$\s*₹\s*/g, '₹');
  res = res.replace(/₹\s*\$/g, '₹');
  res = res.replace(/(₹\s*[0-9,]+(?:\.[0-9]+)?)\$/g, '$1');

  // 15. Simplify simple number options wrapped in $: e.g. "$420$ litres" or "$420$ लीटर"
  res = res.replace(/<p>\s*\$\s*(\d+(?:\.\d+)?)\s*\$\s*([a-zA-Z\u0900-\u097F\s]*)<\/p>/gi, '<p>$1 $2</p>');
  res = res.replace(/^\s*\$\s*(\d+(?:\.\d+)?)\s*\$\s*([a-zA-Z\u0900-\u097F\s]*)$/gi, '$1 $2');

  // 16. Heal trailing backslashes at end of line, formula, or before </p>
  res = res.replace(/\\+(\s*<\/p>|\s*$)/gm, '$1');

  // 17. Safe line-by-line single dollar balancing (avoids corrupting display math $$ or equations)
  const rawLines = res.split('\n');
  for (let li = 0; li < rawLines.length; li++) {
    let line = rawLines[li];
    const hasPStart = /^\s*<p>/i.test(line);
    const hasPEnd = /<\/p>\s*$/i.test(line);
    let inner = line.replace(/^\s*<p>/i, '').replace(/<\/p>\s*$/i, '').trim();

    // If line has display math $$...$$, leave it completely intact!
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
      } else if (dollarCount === 0 && /^=\s*[^$]*\\[a-zA-Z]/.test(inner)) {
        inner = `$$${inner}$$`;
      }
    }
    rawLines[li] = (hasPStart ? '<p>' : '') + inner + (hasPEnd ? '</p>' : '');
  }
  res = rawLines.join('\n');

  // 18. Clean inside all math blocks ($...$ and $$...$$):
  // - Escape unescaped % inside math so KaTeX doesn't comment out the formula
  // - Replace HTML <br> with \\ (LaTeX newline)
  // - Strip HTML tags inside math blocks
  res = res.replace(/(\$\$[\s\S]*?\$\$|\$[^\$\n]+?\$)/g, (match) => {
    const isDisplay = match.startsWith('$$');
    let inner = isDisplay ? match.slice(2, -2) : match.slice(1, -1);

    // Escape % inside math
    inner = inner.replace(/(?<!\\)%/g, '\\%');

    // Replace HTML <br> with LaTeX newline
    inner = inner.replace(/<br\s*\/?>/gi, ' \\\\ ');

    // Strip remaining HTML tags from inside math
    inner = inner.replace(/<\/?(?:p|b|strong|i|em|span|div)[^>]*>/gi, '');

    // Standardize cosec -> csc
    inner = inner.replace(/\\cosec\b/g, '\\csc');

    return isDisplay ? `$$${inner}$$` : `$${inner}$`;
  });

  // 19. Safe outside-math LaTeX normalization
  const tokens = res.split(/(\$\$[\s\S]*?\$\$|\$[^\$\n]+?\$)/g);
  for (let i = 0; i < tokens.length; i++) {
    const isMath = /^\$\$[\s\S]*?\$\$$/.test(tokens[i]) || /^\$[^\$\n]+?\$$/.test(tokens[i]);
    if (!isMath) {
      let part = tokens[i];
      // Naked fraction or mixed fraction outside $...$ -> wrap cleanly in $...$
      part = part.replace(/(?:(\d+)\s*)?\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, (_m, whole, n, d) => {
        return whole ? `$${whole}\\frac{${n}}{${d}}$` : `$\\frac{${n}}{${d}}$`;
      });
      // Naked \sqrt{...} outside $...$ -> wrap in $...$
      part = part.replace(/\\sqrt(?:\s*\[[^\]]+\])?\s*\{([^{}]+)\}/g, (_m, inner) => `$\\sqrt{${inner}}$`);
      // Naked \left( ... \right) outside $...$ -> wrap in $...$
      part = part.replace(/\\left\(([\s\S]*?)\\right\)(?:\^([0-9a-zA-Z]+|\{[^}]+\}))?/g, (_m, inner, exp) => {
        return exp ? `$\\left(${inner}\\right)^${exp}$` : `$\\left(${inner}\\right)$`;
      });
      // Naked \text{...} outside $...$ is plain text: unwrap it cleanly with space
      part = part.replace(/\\text\s*\{([^{}]+)\}/g, ' $1 ');
      // Naked LaTeX operators outside $...$ -> clean Unicode
      part = part.replace(/\\times\b/g, '×');
      part = part.replace(/\\div\b/g, '÷');
      part = part.replace(/\\pm\b/g, '±');
      part = part.replace(/\\leq?\b/g, '≤');
      part = part.replace(/\\geq?\b/g, '≥');
      part = part.replace(/\\neq?\b/g, '≠');
      part = part.replace(/\\approx\b/g, '≈');
      part = part.replace(/\\Rightarrow\b/g, '⇒');
      part = part.replace(/\\rightarrow\b/g, '→');
      part = part.replace(/\\degree\b/g, '°');
      tokens[i] = part;
    }
  }
  res = tokens.join('');

  // 20. Convert Unicode roots to standard KaTeX
  res = res.replace(/∛\s*\(?([0-9a-zA-Z\.\+\-\*\/]+)\)?/g, (_m, val) => `$\\sqrt[3]{${val}}$`);
  res = res.replace(/√\s*\(?([0-9a-zA-Z\.\+\-\*\/]+)\)?/g, (_m, val) => `$\\sqrt{${val}}$`);

  // 21. Convert Unicode vulgar fractions to clean LaTeX
  res = res.replace(/½/g, '$\\frac{1}{2}$');
  res = res.replace(/¼/g, '$\\frac{1}{4}$');
  res = res.replace(/¾/g, '$\\frac{3}{4}$');
  res = res.replace(/⅓/g, '$\\frac{1}{3}$');
  res = res.replace(/⅔/g, '$\\frac{2}{3}$');

  // 22. Strip all HTML tags completely (user requested pure normal text without HTML, only LaTeX for math)
  res = res
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<\/?(?:p|b|strong|i|em|span|div|table|thead|tbody|tr|td|th|ul|ol|li|hr)[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ');

  return res.trim();
}

/**
 * Prepares raw AI JSON strings before JSON.parse to prevent \r, \f, \t corruption.
 */
export function prepareAiJsonString(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // Convert arrow LaTeX commands to Unicode so \r is not interpreted as carriage return by JSON.parse
  s = s.replace(/(?<!\\)\\rightarrow\b/gi, ' → ');
  s = s.replace(/(?<!\\)\\Rightarrow\b/g, ' ⇒ ');
  s = s.replace(/(?<!\\)\\leftarrow\b/gi, ' ← ');
  s = s.replace(/(?<!\\)\\Leftarrow\b/g, ' ⇐ ');
  s = s.replace(/(?<!\\)\\to\b/g, ' → ');

  // Convert symbol-series LaTeX commands to clean Unicode
  s = s.replace(/(?<!\\)\\(?:big)?wedge\b/gi, '∧');
  s = s.replace(/(?<!\\)\\(?:big)?vee\b/gi, '∨');
  s = s.replace(/(?<!\\)\\!/g, '');

  // Escape single-backslash math LaTeX commands so JSON.parse doesn't choke or corrupt \f, \t, etc.
  s = s
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

  return s;
}

/**
 * Robust JSON parser for AI outputs that may contain markdown or unbalanced fragments.
 */
export function safeParseAiJson(rawJson: string): any {
  if (!rawJson || !rawJson.trim()) return [];

  const text = rawJson.trim();
  const chunksToScan: string[] = [];

  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(text)) !== null) {
    if (match[1] && match[1].trim().length > 5) {
      chunksToScan.push(match[1].trim());
    }
  }

  if (chunksToScan.length === 0) {
    const unclosedMatch = text.match(/```(?:json)?\s*([\s\S]+)$/i);
    if (unclosedMatch && unclosedMatch[1].trim().length > 5) {
      chunksToScan.push(unclosedMatch[1].trim());
    } else {
      chunksToScan.push(text);
    }
  }

  const collected: any[] = [];
  const seenSigs = new Set<string>();

  const addParsed = (item: any) => {
    if (!item) return;
    if (Array.isArray(item)) {
      item.forEach(addParsed);
      return;
    }
    if (typeof item === 'object') {
      const sig = String(item.question_hi || item.question_en || item.question || item.question_r || JSON.stringify(item)).slice(0, 60);
      if (!seenSigs.has(sig)) {
        seenSigs.add(sig);
        collected.push(item);
      }
    }
  };

  for (const chunk of chunksToScan) {
    const safeChunk = prepareAiJsonString(chunk);

    try {
      const p = JSON.parse(safeChunk);
      addParsed(p);
      continue;
    } catch (_) {}

    // Extract balanced arrays
    let startArr = -1;
    let bDepth = 0;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < safeChunk.length; i++) {
      const ch = safeChunk[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (!inStr) {
        if (ch === '[') {
          if (bDepth === 0) startArr = i;
          bDepth++;
        } else if (ch === ']') {
          bDepth--;
          if (bDepth === 0 && startArr >= 0) {
            try {
              const p = JSON.parse(safeChunk.slice(startArr, i + 1));
              addParsed(p);
            } catch (_) {}
            startArr = -1;
          }
        }
      }
    }

    // Extract standalone balanced { ... } objects
    let braceDepth = 0;
    let startObj = -1;
    let inStr2 = false;
    let esc2 = false;
    for (let i = 0; i < safeChunk.length; i++) {
      const ch = safeChunk[i];
      if (esc2) { esc2 = false; continue; }
      if (ch === '\\') { esc2 = true; continue; }
      if (ch === '"') { inStr2 = !inStr2; continue; }
      if (!inStr2) {
        if (ch === '{') {
          if (braceDepth === 0) startObj = i;
          braceDepth++;
        } else if (ch === '}') {
          braceDepth--;
          if (braceDepth === 0 && startObj >= 0) {
            try {
              const p = JSON.parse(safeChunk.slice(startObj, i + 1));
              addParsed(p);
            } catch (_) {}
            startObj = -1;
          }
        }
      }
    }
  }

  return collected;
}

/**
 * Parses single AI JSON object.
 */
export function safeParseAiJsonObject(rawJson: string): any {
  if (!rawJson || !rawJson.trim()) return {};

  const safeChunk = prepareAiJsonString(rawJson);

  try {
    const obj = JSON.parse(safeChunk);
    if (Array.isArray(obj)) return obj[0] || {};
    if (typeof obj === 'object' && obj !== null) return obj;
  } catch (_) {}

  const list = safeParseAiJson(rawJson);
  if (Array.isArray(list) && list.length > 0) {
    return list[0];
  }
  return typeof list === 'object' && list !== null ? list : {};
}
