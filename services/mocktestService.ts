import { MockTestMcqItem, QuestionType, DifficultyLevel, ExtractedElement } from '../types';
import { getAiSettings } from './aiDbService';

export const MOCKTEST_CSV_HEADERS = [
  'question_r',
  'question_hi',
  'option1_hi',
  'option2_hi',
  'option3_hi',
  'option4_hi',
  'option5_hi',
  'solution_hi',
  'question_en',
  'option1_en',
  'option2_en',
  'option3_en',
  'option4_en',
  'option5_en',
  'solution_en',
  'answer',
  'set_name',
  'difficulty_level'
] as const;

/**
 * Ensures text is wrapped in semantic HTML (<p>...</p>) if not already HTML.
 */
export function ensureHtmlParagraph(text: string): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed;
  }
  // If multiline, wrap each line or paragraph in <p>
  const paras = trimmed.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (paras.length <= 1) {
    return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
  }
  return paras.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

// Regex definitions for previous year exam names, shifts, dates, and publisher watermarks
const EXAM_KEYWORD_REGEX = '(?:RRB|SSC|NTPC|CBT|Tech|ALP|JE|Group[\\s\\-]*D|RPF|SI|Constable|CGL|CHSL|MTS|CPO|GD|Steno|UPSC|CDS|NDA|AFCAT|IBPS|SBI|PO|Clerk|BPSC|UPPSC|MPPSC|HSSC|DSSSB|CTET|UPTET|REET|Railway|एसएससी|आरआरबी|एनटीपीसी|रेलवे|ग्रुप[\\s\\-]*डी|टेक)';
const SHIFT_KEYWORD_REGEX = '(?:Afternoon|Morning|Evening|Night|Shift[\\s\\-]*[I|II|III|IV|V|1|2|3|4|5]|Batch[\\s\\-]*\\d+|दोपहर|सुबह|शाम|रात|प्रथम[\\s\\-]*पाली|द्वितीय[\\s\\-]*पाली|तृतीय[\\s\\-]*पाली|पाली[\\s\\-]*\\d+)';
const DATE_PATTERN_REGEX = '(?:\\d{1,2}[\\/\\.\\-]\\d{1,2}[\\/\\.\\-]\\d{2,4}|\\b(?:19|20)\\d{2}\\b)';

/**
 * Strips previous-year exam tags, shift dates, paper citations, and junk watermarks from question text and options.
 * Examples stripped:
 * - "RRB Tech. - (III) 23/12/2024 (Afternoon)"
 * - "NTPC CBT - I (GL) 17/06/2025 (Afternoon)"
 * - "[SSC CGL 14/07/2023 (Shift-1)]"
 * - "(RRB Group D 17-08-2022 Shift 2)"
 * - "आरआरबी टेक. - (III) 23/12/2024 (दोपहर)"
 */
export function stripExamTagsAndJunk(text: string): string {
  if (!text) return '';
  let res = text;

  // 1. Bracketed tags like [SSC CGL 14/07/2023 (Shift-1)], [RRB NTPC 28.12.2020 (Shift-I)]
  res = res.replace(/\[\s*(?:RRB|SSC|NTPC|CBT|Tech|ALP|JE|Group[\s\-]*D|RPF|SI|Constable|CGL|CHSL|MTS|CPO|GD|Steno|UPSC|CDS|NDA|AFCAT|IBPS|SBI|PO|Clerk|BPSC|UPPSC|MPPSC|HSSC|DSSSB|CTET|UPTET|REET|Railway|एसएससी|आरआरबी|एनटीपीसी|रेलवे|ग्रुप[\s\-]*डी|टेक)[^\]]*\]/gi, '');

  // 2. Parenthesized tags like (RRB Group D 17-08-2022 Shift 2)
  res = res.replace(/\(\s*(?:RRB|SSC|NTPC|CBT|Tech|ALP|JE|Group[\s\-]*D|RPF|SI|Constable|CGL|CHSL|MTS|CPO|GD|Steno|UPSC|CDS|NDA|AFCAT|IBPS|SBI|PO|Clerk|BPSC|UPPSC|MPPSC|HSSC|DSSSB|CTET|UPTET|REET|Railway|एसएससी|आरआरबी|एनटीपीसी|रेलवे|ग्रुप[\s\-]*डी|टेक)[^\)]*\)/gi, '');

  // 3. Leading bracketed or parenthesized exam tags at the start of question or inside <p>
  res = res.replace(/(?:^|<p>)\s*\[\s*(?:RRB|SSC|NTPC|CBT|Tech|ALP|JE|Group[\s\-]*D|RPF|SI|Constable|CGL|CHSL|MTS|CPO|GD|Steno|UPSC|CDS|NDA|AFCAT|IBPS|SBI|PO|Clerk|BPSC|UPPSC|MPPSC|HSSC|DSSSB|CTET|UPTET|REET|Railway|एसएससी|आरआरबी|एनटीपीसी|रेलवे|ग्रुप[\s\-]*डी|टेक)[^\]]*\]\s*/gi, (m) => m.startsWith('<p>') ? '<p>' : '');
  res = res.replace(/(?:^|<p>)\s*\(\s*(?:RRB|SSC|NTPC|CBT|Tech|ALP|JE|Group[\s\-]*D|RPF|SI|Constable|CGL|CHSL|MTS|CPO|GD|Steno|UPSC|CDS|NDA|AFCAT|IBPS|SBI|PO|Clerk|BPSC|UPPSC|MPPSC|HSSC|DSSSB|CTET|UPTET|REET|Railway|एसएससी|आरआरबी|एनटीपीसी|रेलवे|ग्रुप[\s\-]*डी|टेक)[^\)]*\)\s*/gi, (m) => m.startsWith('<p>') ? '<p>' : '');

  // 4. Trailing unbracketed exam tags (e.g. "RRB Tech. - (III) 23/12/2024 (Afternoon)", "NTPC CBT - I (GL) 17/06/2025 (Afternoon)")
  const trailingPattern = new RegExp(
    '(?:[\\s\\.\\,\\;\\-\\–\\—]|\\?|\\!)+(' + EXAM_KEYWORD_REGEX + '[\\s\\S]*?(?:' + DATE_PATTERN_REGEX + '|' + SHIFT_KEYWORD_REGEX + ')[\\s\\S]*?)(\\s*<\\/p>|$)',
    'i'
  );
  res = res.replace(trailingPattern, (match, _tag, closing) => {
    const preChar = match.trim().charAt(0);
    const punct = (preChar === '?' || preChar === '!' || preChar === '.') ? preChar : '';
    return punct + (closing || '');
  });

  // 5. Standalone trailing shift / date (e.g. "23/12/2024 (Afternoon)")
  res = res.replace(new RegExp('(?:[\\s\\-\\–\\—]+)(' + DATE_PATTERN_REGEX + '\\s*\\(?' + SHIFT_KEYWORD_REGEX + '\\)?|\\(?' + SHIFT_KEYWORD_REGEX + '\\)?)(\\s*<\\/p>|$)', 'i'), '$2');

  // 6. Clean publisher watermarks and book signatures
  res = res.replace(/(?:Youth\s*Competition\s*Times|Pinnacle\s*Publication|Testbook\.com|Adda247|Exampur|Gradeup|Drishti\s*IAS|Kiran\s*Prakashan|Platform\s*Education|Rukmini\s*Prakashan)[\s\S]*?(?:<\/p>|$)/gi, (m) => m.endsWith('</p>') ? '</p>' : '');

  // 7. Clean trailing whitespace before </p> and multiple spaces
  res = res.replace(/\s+<\/p>/gi, '</p>').replace(/[ \t]{2,}/g, ' ');

  return res.trim();
}

/**
 * Cleans overzealous math delimiters, invalid LaTeX, and strips extraneous exam tags
 * from question text, options, and solutions.
 */
export function cleanMocktestText(text: string): string {
  if (!text) return '';
  let res = text;

  // First, strip all extraneous exam tags, shifts, dates, and watermarks
  res = stripExamTagsAndJunk(res);

  // 1. Rupee sign before or inside $$:
  // e.g. "₹ $$4,800$$" -> "₹4,800"
  res = res.replace(/₹\s*\$\$\s*([^\$]+?)\s*\$\$/g, (_m, val) => `₹${val.trim()}`);
  res = res.replace(/₹\s*\$\s*([^\$]+?)\s*\$/g, (_m, val) => `₹${val.trim()}`);
  // e.g. "$$₹5$$" -> "₹5"
  res = res.replace(/\$\$\s*₹\s*([^\$]+?)\s*\$\$/g, (_m, val) => `₹${val.trim()}`);
  res = res.replace(/\$\s*₹\s*([^\$]+?)\s*\$/g, (_m, val) => `₹${val.trim()}`);

  // 2. Percentages inside $$ or $:
  // e.g. "$$40\%$$", "$$40%$$", "$$6.5\%$$", "$$6.8\%$$" -> "40%", "6.5%", "6.8%"
  res = res.replace(/\$\$\s*([+-]?\d+(?:[,\.]\d+)?)\s*(?:\\%|%)\s*\$\$/g, '$1%');
  res = res.replace(/\$\s*([+-]?\d+(?:[,\.]\d+)?)\s*(?:\\%|%)\s*\$/g, '$1%');

  // 3. Plain numbers (with optional commas/decimals) inside $$ or $:
  // e.g. "$$4,800$$" -> "4,800", "$$300$$" -> "300", "$$18$$" -> "18"
  res = res.replace(/\$\$\s*([+-]?\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*\$\$/g, '$1');
  res = res.replace(/\$\s*([+-]?\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*\$/g, '$1');

  // 4. Escaped percent signs outside LaTeX:
  // e.g. "6.5\%" -> "6.5%"
  res = res.replace(/(\d+(?:\.\d+)?)\\\%/g, '$1%');

  // 5. Convert any remaining inline $$math$$ to single $math$ for mocktest portals:
  // In HTML or inline text, mocktest apps use $...$ for inline KaTeX, whereas $$...$$ breaks or displays raw.
  res = res.replace(/\$\$([^\$\n]+?)\$\$/g, '$$$1$$');

  // 6. Clean stray trailing slashes or colons often copied from paper scan:
  // e.g. "350 /" -> "350"
  res = res.replace(/\s*[\/\\]\s*$/g, '');

  return res.trim();
}

/**
 * Deep cleans an entire MockTestMcqItem to ensure clean KaTeX and HTML compatibility in mocktest portals.
 */
export function cleanMockTestItem(item: MockTestMcqItem): MockTestMcqItem {
  return {
    ...item,
    question_hi: cleanMocktestText(item.question_hi),
    option1_hi: cleanMocktestText(item.option1_hi),
    option2_hi: cleanMocktestText(item.option2_hi),
    option3_hi: cleanMocktestText(item.option3_hi),
    option4_hi: cleanMocktestText(item.option4_hi),
    option5_hi: cleanMocktestText(item.option5_hi),
    solution_hi: cleanMocktestText(item.solution_hi),
    question_en: cleanMocktestText(item.question_en),
    option1_en: cleanMocktestText(item.option1_en),
    option2_en: cleanMocktestText(item.option2_en),
    option3_en: cleanMocktestText(item.option3_en),
    option4_en: cleanMocktestText(item.option4_en),
    option5_en: cleanMocktestText(item.option5_en),
    solution_en: cleanMocktestText(item.solution_en),
  };
}


/**
 * Escapes an individual field for RFC 4180 compliant CSV.
 */
export function escapeCsvField(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  // If string contains comma, quote, or newline, escape double quotes and wrap in quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Converts letter answer ('A','B','C','D','E') to 1-based numeric ('1','2','3','4','5')
 */
export function normalizeAnswerFormat(
  rawAnswer: string, 
  targetFormat: 'letters' | 'numbers' = 'letters'
): string {
  if (!rawAnswer) return '';
  const trimmed = rawAnswer.trim();

  // If MSQ or NAT, keep as is
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return trimmed;
  }

  const mapToNum: Record<string, string> = { 'A': '1', 'B': '2', 'C': '3', 'D': '4', 'E': '5' };
  const mapToLetter: Record<string, string> = { '1': 'A', '2': 'B', '3': 'C', '4': 'D', '5': 'E' };

  const upper = trimmed.toUpperCase();
  if (targetFormat === 'numbers') {
    return mapToNum[upper] || trimmed;
  } else {
    return mapToLetter[upper] || trimmed;
  }
}

/**
 * Serializes MockTestMcqItem array into a clean, RFC 4180 CSV string with UTF-8 BOM.
 */
export function serializeMockTestToCsv(
  items: MockTestMcqItem[],
  answerFormat: 'letters' | 'numbers' = 'letters'
): string {
  const headerLine = MOCKTEST_CSV_HEADERS.join(',');
  const lines = items.map((rawItem, index) => {
    const item = cleanMockTestItem(rawItem);
    const qNum = item.question_r || index + 1;
    const ans = normalizeAnswerFormat(item.answer, answerFormat);

    const row = [
      escapeCsvField(qNum),
      escapeCsvField(item.question_hi || ''),
      escapeCsvField(item.option1_hi || ''),
      escapeCsvField(item.option2_hi || ''),
      escapeCsvField(item.option3_hi || ''),
      escapeCsvField(item.option4_hi || ''),
      escapeCsvField(item.option5_hi || ''),
      escapeCsvField(item.solution_hi || ''),
      escapeCsvField(item.question_en || ''),
      escapeCsvField(item.option1_en || ''),
      escapeCsvField(item.option2_en || ''),
      escapeCsvField(item.option3_en || ''),
      escapeCsvField(item.option4_en || ''),
      escapeCsvField(item.option5_en || ''),
      escapeCsvField(item.solution_en || ''),
      escapeCsvField(ans),
      escapeCsvField(item.set_name || 'Mock Test'),
      escapeCsvField(item.difficulty_level || 'medium')
    ];
    return row.join(',');
  });

  // UTF-8 BOM (\uFEFF) ensures Excel & portals open Hindi Devanagari & math flawlessly
  return '\uFEFF' + [headerLine, ...lines].join('\n');
}

/**
 * Triggers a direct browser file download for the CSV file.
 */
export function downloadMockTestCsv(
  items: MockTestMcqItem[],
  fileName: string = 'mocktest_mcqs.csv',
  answerFormat: 'letters' | 'numbers' = 'letters'
): void {
  const csvContent = serializeMockTestToCsv(items, answerFormat);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  const cleanName = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  link.setAttribute('download', cleanName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * RFC 4180 CSV parser to import existing MockTest CSVs back into MockTestMcqItem[]
 */
export function parseCsvToMockTestItems(csvText: string, defaultSetName = 'Paper Name'): MockTestMcqItem[] {
  if (!csvText) return [];

  // Remove UTF-8 BOM if present
  let clean = csvText.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const nextChar = clean[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentField);
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++; // CRLF
      currentRow.push(currentField);
      currentField = '';
      if (currentRow.some(c => c.trim().length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentField += char;
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some(c => c.trim().length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length <= 1) return [];

  // First row is header
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const getCol = (row: string[], name: string): string => {
    const idx = headers.indexOf(name.toLowerCase());
    return idx >= 0 && row[idx] !== undefined ? row[idx] : '';
  };

  const items: MockTestMcqItem[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    const qNum = parseInt(getCol(row, 'question_r'), 10) || r;
    const ans = getCol(row, 'answer').trim();

    let qType: QuestionType = 'MCQ';
    if (ans.startsWith('[') && ans.endsWith(']')) qType = 'MSQ';
    else if (ans.startsWith('{') && ans.endsWith('}')) qType = 'NAT';

    items.push({
      id: `mt_row_${r}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      question_r: qNum,
      question_type: qType,
      question_hi: getCol(row, 'question_hi'),
      option1_hi: getCol(row, 'option1_hi'),
      option2_hi: getCol(row, 'option2_hi'),
      option3_hi: getCol(row, 'option3_hi'),
      option4_hi: getCol(row, 'option4_hi'),
      option5_hi: getCol(row, 'option5_hi'),
      solution_hi: getCol(row, 'solution_hi'),
      question_en: getCol(row, 'question_en'),
      option1_en: getCol(row, 'option1_en'),
      option2_en: getCol(row, 'option2_en'),
      option3_en: getCol(row, 'option3_en'),
      option4_en: getCol(row, 'option4_en'),
      option5_en: getCol(row, 'option5_en'),
      solution_en: getCol(row, 'solution_en'),
      answer: ans,
      set_name: getCol(row, 'set_name') || defaultSetName,
      difficulty_level: (getCol(row, 'difficulty_level').toLowerCase() as DifficultyLevel) || 'medium'
    });
  }

  return items.map(cleanMockTestItem);
}

/**
 * Converts standard extracted elements or OCR text into MockTestMcqItem[]
 */
export function convertElementsToMockTestItems(
  elements: ExtractedElement[],
  setName: string = 'Paper 1'
): MockTestMcqItem[] {
  const fullText = elements
    .map(e => e.type === 'text' ? (e.content || '') : '')
    .join('\n\n');

  if (!fullText.trim()) return [];

  const items: MockTestMcqItem[] = [];

  // Match question patterns: Q1, #1, 1., Question 1
  const qPattern = /(?:^|\n)(?:(?:Q(?:uestion)?\.?\s*[:\-]?\s*|#\s*)(\d+)[\.\)\-:]?|\((\d+)\))\s+/gi;
  const splits: { num: number; startIndex: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = qPattern.exec(fullText)) !== null) {
    const num = parseInt(match[1] || match[2], 10);
    splits.push({ num, startIndex: match.index });
  }

  if (splits.length === 0) {
    // Fallback: entire text as single question item
    items.push({
      id: `mt_item_1`,
      question_r: 1,
      question_type: 'MCQ',
      question_hi: ensureHtmlParagraph(fullText),
      option1_hi: '',
      option2_hi: '',
      option3_hi: '',
      option4_hi: '',
      solution_hi: '',
      question_en: ensureHtmlParagraph(fullText),
      option1_en: '',
      option2_en: '',
      option3_en: '',
      option4_en: '',
      solution_en: '',
      answer: 'A',
      set_name: setName,
      difficulty_level: 'medium'
    });
    return items;
  }

  for (let i = 0; i < splits.length; i++) {
    const start = splits[i].startIndex;
    const end = i < splits.length - 1 ? splits[i + 1].startIndex : fullText.length;
    const chunk = fullText.slice(start, end).trim();

    // Extract Answer line
    let answer = 'A';
    let contentWithoutAns = chunk;
    const ansMatch = chunk.match(/(?:Answer|Ans|उत्तर)\s*[:\-]?\s*([A-Ea-e1-5])/i);
    if (ansMatch) {
      answer = ansMatch[1].toUpperCase();
      contentWithoutAns = chunk.replace(/(?:Answer|Ans|उत्तर)\s*[:\-]?\s*[A-Ea-e1-5].*$/im, '').trim();
    }

    // Extract Options: (a), (b), (c), (d), (e) or A., B., C., D.
    const optPattern = /(?:^|\n)\s*(?:\(([a-eA-E1-5])\)|([a-eA-E1-5])[\.\)])\s+([^\n]+)/g;
    const rawOptions: { label: string; text: string }[] = [];
    let optMatch: RegExpExecArray | null;

    while ((optMatch = optPattern.exec(contentWithoutAns)) !== null) {
      const label = (optMatch[1] || optMatch[2]).toUpperCase();
      rawOptions.push({ label, text: optMatch[3].trim() });
    }

    // Question text is everything before the first option
    let qText = contentWithoutAns;
    const firstOptIdx = contentWithoutAns.search(/(?:^|\n)\s*(?:\([a-eA-E1-5]\)|[a-eA-E1-5][\.\)])\s+/);
    if (firstOptIdx > 0) {
      qText = contentWithoutAns.slice(0, firstOptIdx).trim();
    }
    // Strip the leading question numbering from qText
    qText = qText.replace(/^(?:(?:Q(?:uestion)?\.?\s*[:\-]?\s*|#\s*)\d+[\.\)\-:]?|\(\d+\))\s*/i, '').trim();

    // Determine if bilingual (Hindi vs English)
    const hasHindi = /[\u0900-\u097F]/.test(qText);
    let qHindi = qText;
    let qEng = qText;

    // Check if question has Hindi on line 1, English on line 2
    const lines = qText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length >= 2 && /[\u0900-\u097F]/.test(lines[0]) && /[a-zA-Z]{4,}/.test(lines[1])) {
      qHindi = lines[0];
      qEng = lines.slice(1).join(' ');
    } else if (qText.includes(' / ')) {
      const slashParts = qText.split(' / ');
      if (slashParts.length === 2) {
        qHindi = slashParts[0].trim();
        qEng = slashParts[1].trim();
      }
    }

    // Parse options for Hindi and English
    const getOpt = (label: string): { hi: string; en: string } => {
      const found = rawOptions.find(o => o.label === label);
      if (!found) return { hi: '', en: '' };
      const txt = found.text;
      if (txt.includes(' / ')) {
        const p = txt.split(' / ');
        return { hi: p[0].trim(), en: p[1].trim() };
      }
      return { hi: txt, en: txt };
    };

    const optA = getOpt('A');
    const optB = getOpt('B');
    const optC = getOpt('C');
    const optD = getOpt('D');
    const optE = getOpt('E');

    // Balance options so neither Hindi nor English is left blank
    const aHi = optA.hi || optA.en;
    const aEn = optA.en || optA.hi;
    const bHi = optB.hi || optB.en;
    const bEn = optB.en || optB.hi;
    const cHi = optC.hi || optC.en;
    const cEn = optC.en || optC.hi;
    const dHi = optD.hi || optD.en;
    const dEn = optD.en || optD.hi;
    const eHi = optE.hi || optE.en;
    const eEn = optE.en || optE.hi;

    const solHi = `<p><b>हल:</b> सही उत्तर विकल्प ${answer} है।</p>`;
    const solEn = `<p><b>Solution:</b> The correct option is ${answer}.</p>`;

    items.push({
      id: `mt_item_${i + 1}_${Date.now()}`,
      question_r: i + 1,
      question_type: 'MCQ',
      question_hi: ensureHtmlParagraph(qHindi || qEng),
      option1_hi: aHi,
      option2_hi: bHi,
      option3_hi: cHi,
      option4_hi: dHi,
      option5_hi: eHi,
      solution_hi: ensureHtmlParagraph(solHi),
      question_en: ensureHtmlParagraph(qEng || qHindi),
      option1_en: aEn,
      option2_en: bEn,
      option3_en: cEn,
      option4_en: dEn,
      option5_en: eEn,
      solution_en: ensureHtmlParagraph(solEn),
      answer,
      set_name: setName,
      difficulty_level: 'medium'
    });
  }

  return items.map(cleanMockTestItem);
}

/**
 * Generate a specialized AI prompt for directly extracting images into the 18-column MockTest schema.
 */
export function buildMockTestDirectPrompt(setName = 'Exam Paper'): string {
  return `You are a professional Exam Paper Digitizer and MockTest Content Architect.
Extract ALL multiple-choice questions (MCQs), multiple-select questions (MSQs), and numerical questions (NAT) from this image.

TARGET SCHEMA:
Extract into a strict JSON array of objects, where each object has these exact 18 fields:
1. question_r: Question sequence number (1, 2, 3...)
2. question_hi: Question text in Hindi wrapped in semantic HTML (<p>...</p>) with inline LaTeX math ($...$ or $$...$$).
3. option1_hi: Option 1 (A) in Hindi
4. option2_hi: Option 2 (B) in Hindi
5. option3_hi: Option 3 (C) in Hindi
6. option4_hi: Option 4 (D) in Hindi
7. option5_hi: Option 5 (E) in Hindi (empty string if 4 options)
8. solution_hi: DETAILED, STEP-BY-STEP EXPLANATION in Hindi formatted in HTML (<p><b>हल:</b>...</p>). Include formulas used, intermediate steps, proofs, and the final answer reason.
9. question_en: Question text in English wrapped in semantic HTML (<p>...</p>) with inline LaTeX math ($...$ or $$...$$).
10. option1_en: Option 1 (A) in English
11. option2_en: Option 2 (B) in English
12. option3_en: Option 3 (C) in English
13. option4_en: Option 4 (D) in English
14. option5_en: Option 5 (E) in English (empty string if 4 options)
15. solution_en: DETAILED, STEP-BY-STEP EXPLANATION in English formatted in HTML (<p><b>Solution:</b>...</p>). Include formulas, full working steps, and derivation.
16. answer: Correct answer identifier: Single choice MCQ: "A", "B", "C", "D". MSQ: '["3","4"]'. NAT: '{"start":"86","end":"86"}'.
17. set_name: "${setName}"
18. difficulty_level: "easy", "medium", or "hard"

FORMATTING RULES:
- Math expressions: Put ONLY actual algebraic/calculus formulas, fractions, powers, and variables in single dollar ($...$): e.g. $x^2 + y^2 = 25$, $\\frac{a}{b}$, $\\sqrt{x}$.
- CRITICAL: NEVER enclose normal numbers, percentages, or money in math delimiters!
  - Write 40%, NOT $$40\\%$$ or $40%$
  - Write ₹5 or ₹4,800, NOT $$₹5$$ or ₹ $$4,800$$
  - Write 300, NOT $$300$$
- STRICT NEGATIVE RULE: DO NOT include previous-year exam tags, shift dates, shift times, paper citations, or book publisher labels in the question text or options!
  - Examples that MUST BE OMITTED: "RRB Tech. - (III) 23/12/2024 (Afternoon)", "NTPC CBT - I (GL) 17/06/2025 (Afternoon)", "[SSC CGL 14/07/2023 (Shift-1)]", "(Shift-2)", "(Morning)", "Youth Competition Times", "Pinnacle".
  - The question text must be PURELY the question statement!
- If the original document is only in Hindi or only in English, TRANSLATE and generate the counterpart language so BOTH Hindi and English fields are fully populated!
- Both solution_hi and solution_en MUST BE DETAILED, pedagogy-grade solutions suitable for student practice.
- Respond ONLY with the JSON array inside \`\`\`json ... \`\`\` block.`;
}

/**
 * Call the AI service to generate rich, step-by-step Hindi & English solutions for a single MCQ item.
 */
export async function generateDeepSolutionForItem(
  item: MockTestMcqItem
): Promise<{ solution_hi: string; solution_en: string; difficulty_level?: DifficultyLevel }> {
  const settings = await getAiSettings();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (settings.apiKey) {
    headers['x-user-gemini-key'] = settings.apiKey.trim();
  }

  const response = await fetch('/api/mocktest-solve', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      question_hi: item.question_hi,
      question_en: item.question_en,
      option1_hi: item.option1_hi,
      option2_hi: item.option2_hi,
      option3_hi: item.option3_hi,
      option4_hi: item.option4_hi,
      option5_hi: item.option5_hi || '',
      option1_en: item.option1_en,
      option2_en: item.option2_en,
      option3_en: item.option3_en,
      option4_en: item.option4_en,
      option5_en: item.option5_en || '',
      answer: item.answer,
      question_type: item.question_type
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to generate solution');
  }

  const data = await response.json();
  return {
    solution_hi: data.solution_hi || '',
    solution_en: data.solution_en || '',
    difficulty_level: data.difficulty_level || item.difficulty_level
  };
}

/**
 * Parse raw text / JSON response from any AI provider (Gemini, DeepSeek, ChatGPT, Claude)
 * into a complete, valid MockTestMcqItem[] with all 18 fields fully populated.
 */
export function parseAiOutputToMockTestItems(
  rawText: string,
  setName: string = 'Mock Test Paper',
  startIndex: number = 1
): MockTestMcqItem[] {
  if (!rawText || !rawText.trim()) return [];

  let clean = rawText.trim();
  const fenceMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    clean = fenceMatch[1].trim();
  }

  const startIdx = clean.indexOf('[');
  const endIdx = clean.lastIndexOf(']');

  if (startIdx >= 0 && endIdx > startIdx) {
    const jsonStr = clean.slice(startIdx, endIdx + 1);
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((obj, i) => {
          const qNum = parseInt(obj.question_r, 10) || (startIndex + i);
          let rawAns = String(obj.answer || obj.ans || obj.correct || obj.correct_option || 'A').trim();
          rawAns = rawAns.replace(/^(?:Answer|Ans|उत्तर)\s*[:\-]?\s*/i, '').trim().toUpperCase();
          if (!rawAns) rawAns = 'A';

          let qType: QuestionType = 'MCQ';
          if (rawAns.startsWith('[') && rawAns.endsWith(']')) qType = 'MSQ';
          else if (rawAns.startsWith('{') && rawAns.endsWith('}')) qType = 'NAT';

          // 1. Question Text
          let qHi = obj.question_hi || '';
          let qEn = obj.question_en || '';
          const genericQ = obj.question || obj.question_text || obj.q || '';

          if (!qHi && !qEn && genericQ) {
            const lines = genericQ.split('\n').map((l: string) => l.trim()).filter(Boolean);
            if (lines.length >= 2 && /[\u0900-\u097F]/.test(lines[0]) && /[a-zA-Z]{4,}/.test(lines[1])) {
              qHi = lines[0];
              qEn = lines.slice(1).join(' ');
            } else if (genericQ.includes(' / ')) {
              const parts = genericQ.split(' / ');
              qHi = parts[0].trim();
              qEn = parts[1].trim();
            } else {
              qHi = genericQ;
              qEn = genericQ;
            }
          }

          if (!qHi && qEn) qHi = qEn;
          if (!qEn && qHi) qEn = qHi;

          qHi = qHi.replace(/^(?:(?:Q(?:uestion)?\.?\s*[:\-]?\s*|#\s*)\d+[\.\)\-:]?|\(\d+\))\s*/i, '').trim();
          qEn = qEn.replace(/^(?:(?:Q(?:uestion)?\.?\s*[:\-]?\s*|#\s*)\d+[\.\)\-:]?|\(\d+\))\s*/i, '').trim();

          // 2. Options Extraction
          let opt1Hi = String(obj.option1_hi || '');
          let opt2Hi = String(obj.option2_hi || '');
          let opt3Hi = String(obj.option3_hi || '');
          let opt4Hi = String(obj.option4_hi || '');
          let opt5Hi = String(obj.option5_hi || '');

          let opt1En = String(obj.option1_en || '');
          let opt2En = String(obj.option2_en || '');
          let opt3En = String(obj.option3_en || '');
          let opt4En = String(obj.option4_en || '');
          let opt5En = String(obj.option5_en || '');

          const cleanOptText = (txt: any) => {
            return String(txt || '').replace(/^(?:\([a-eA-E1-5]\)|[a-eA-E1-5][\.\)]|\b[A-E]\b[\.\)\s\-:]+)\s*/i, '').trim();
          };

          if (Array.isArray(obj.options)) {
            const arr = obj.options;
            if (arr[0] !== undefined) { const v = cleanOptText(arr[0]); opt1Hi = opt1Hi || v; opt1En = opt1En || v; }
            if (arr[1] !== undefined) { const v = cleanOptText(arr[1]); opt2Hi = opt2Hi || v; opt2En = opt2En || v; }
            if (arr[2] !== undefined) { const v = cleanOptText(arr[2]); opt3Hi = opt3Hi || v; opt3En = opt3En || v; }
            if (arr[3] !== undefined) { const v = cleanOptText(arr[3]); opt4Hi = opt4Hi || v; opt4En = opt4En || v; }
            if (arr[4] !== undefined) { const v = cleanOptText(arr[4]); opt5Hi = opt5Hi || v; opt5En = opt5En || v; }
          } else if (obj.options && typeof obj.options === 'object') {
            const o = obj.options;
            const a = o.A || o.a || o['1'];
            const b = o.B || o.b || o['2'];
            const c = o.C || o.c || o['3'];
            const d = o.D || o.d || o['4'];
            const e = o.E || o.e || o['5'];
            if (a) { opt1Hi = opt1Hi || cleanOptText(a); opt1En = opt1En || cleanOptText(a); }
            if (b) { opt2Hi = opt2Hi || cleanOptText(b); opt2En = opt2En || cleanOptText(b); }
            if (c) { opt3Hi = opt3Hi || cleanOptText(c); opt3En = opt3En || cleanOptText(c); }
            if (d) { opt4Hi = opt4Hi || cleanOptText(d); opt4En = opt4En || cleanOptText(d); }
            if (e) { opt5Hi = opt5Hi || cleanOptText(e); opt5En = opt5En || cleanOptText(e); }
          }

          if (obj.option_a || obj.optionA) { const v = cleanOptText(obj.option_a || obj.optionA); opt1Hi = opt1Hi || v; opt1En = opt1En || v; }
          if (obj.option_b || obj.optionB) { const v = cleanOptText(obj.option_b || obj.optionB); opt2Hi = opt2Hi || v; opt2En = opt2En || v; }
          if (obj.option_c || obj.optionC) { const v = cleanOptText(obj.option_c || obj.optionC); opt3Hi = opt3Hi || v; opt3En = opt3En || v; }
          if (obj.option_d || obj.optionD) { const v = cleanOptText(obj.option_d || obj.optionD); opt4Hi = opt4Hi || v; opt4En = opt4En || v; }

          // Ensure both Hindi & English options are balanced
          if (!opt1Hi && opt1En) opt1Hi = opt1En;
          if (!opt1En && opt1Hi) opt1En = opt1Hi;
          if (!opt2Hi && opt2En) opt2Hi = opt2En;
          if (!opt2En && opt2Hi) opt2En = opt2Hi;
          if (!opt3Hi && opt3En) opt3Hi = opt3En;
          if (!opt3En && opt3Hi) opt3En = opt3Hi;
          if (!opt4Hi && opt4En) opt4Hi = opt4En;
          if (!opt4En && opt4Hi) opt4En = opt4Hi;
          if (!opt5Hi && opt5En) opt5Hi = opt5En;
          if (!opt5En && opt5Hi) opt5En = opt5Hi;

          // 3. Solutions Extraction
          let solHi = obj.solution_hi || '';
          let solEn = obj.solution_en || '';
          const genericSol = obj.solution || obj.explanation || obj.exp || obj.sol || '';

          if (!solHi && genericSol) {
            solHi = `<p><b>हल:</b> ${genericSol}</p>`;
          }
          if (!solEn && genericSol) {
            solEn = `<p><b>Solution:</b> ${genericSol}</p>`;
          }

          if (!solHi && solEn) solHi = solEn;
          if (!solEn && solHi) solEn = solHi;

          if (!solHi) solHi = `<p><b>हल:</b> सही उत्तर विकल्प ${rawAns} है।</p>`;
          if (!solEn) solEn = `<p><b>Solution:</b> The correct option is ${rawAns}.</p>`;

          return cleanMockTestItem({
            id: `mt_ai_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
            question_r: qNum,
            question_type: qType,
            question_hi: ensureHtmlParagraph(qHi),
            option1_hi: opt1Hi,
            option2_hi: opt2Hi,
            option3_hi: opt3Hi,
            option4_hi: opt4Hi,
            option5_hi: opt5Hi,
            solution_hi: ensureHtmlParagraph(solHi),
            question_en: ensureHtmlParagraph(qEn),
            option1_en: opt1En,
            option2_en: opt2En,
            option3_en: opt3En,
            option4_en: opt4En,
            option5_en: opt5En,
            solution_en: ensureHtmlParagraph(solEn),
            answer: rawAns,
            set_name: obj.set_name || setName,
            difficulty_level: (obj.difficulty_level || 'medium').toLowerCase() as DifficultyLevel
          });
        });
      }
    } catch (e) {
      console.warn('JSON parse failed in parseAiOutputToMockTestItems, falling back to heuristic parsing:', e);
    }
  }

  // Fallback: convert raw elements/text
  const fakeElement: ExtractedElement = {
    id: `raw_${Date.now()}`,
    type: 'text',
    content: rawText
  };
  return convertElementsToMockTestItems([fakeElement], setName).map(cleanMockTestItem);
}

/**
 * Fast & ultra-reliable prompt for AI browser chat (DeepSeek, ChatGPT, Gemini, Claude) via Extension Bridge
 * that guarantees all 18 columns are provided with Hindi, English, options, and step-by-step solutions!
 */
export function buildMockTestBridgePrompt(setName = 'Mock Test Paper'): string {
  return `You are a professional Exam Paper Digitizer and MockTest Content Architect.
Extract ALL multiple-choice questions (MCQs), MSQs, and numerical questions from this exam page image.

STRICT REQUIREMENT: You MUST fill ALL fields for EVERY question in strict JSON format.
For every question, output an object in a JSON array with these exact fields:
- "question_r": Sequence number (1, 2, 3...)
- "question_hi": Question text in Hindi wrapped in semantic HTML (<p>...</p>) with inline LaTeX math ($...$).
- "option1_hi": Option 1 (A) in Hindi
- "option2_hi": Option 2 (B) in Hindi
- "option3_hi": Option 3 (C) in Hindi
- "option4_hi": Option 4 (D) in Hindi
- "option5_hi": Option 5 (E) in Hindi (or empty string if 4 options)
- "solution_hi": DETAILED step-by-step pedagogical explanation in Hindi formatted in HTML (<p><b>हल:</b>...</p>).
- "question_en": Question text in English wrapped in semantic HTML (<p>...</p>) with inline LaTeX math ($...$).
- "option1_en": Option 1 (A) in English
- "option2_en": Option 2 (B) in English
- "option3_en": Option 3 (C) in English
- "option4_en": Option 4 (D) in English
- "option5_en": Option 5 (E) in English (or empty string if 4 options)
- "solution_en": DETAILED step-by-step pedagogical explanation in English formatted in HTML (<p><b>Solution:</b>...</p>).
- "answer": Correct answer identifier (e.g. "A", "B", "C", or "D")
- "set_name": "${setName}"
- "difficulty_level": "easy", "medium", or "hard"

CRITICAL RULES:
1. BOTH Hindi and English fields MUST be fully populated! If the paper is only in Hindi or only in English, TRANSLATE and generate the counterpart language so NO field is left blank.
2. BOTH solution_hi and solution_en MUST be detailed and pedagogical with steps and formulas.
3. Put actual math formulas/fractions inside single dollar $...$ (e.g. $x^2 + y = 10$, $\\frac{a}{b}$).
4. NEVER wrap plain numbers, percentages (40%), or rupee amounts (₹4,800) in dollar signs.
5. STRICT NEGATIVE RULE: DO NOT include exam shift citations, previous-year question tags, dates, or source book labels in the question text or options! (e.g. "RRB Tech. - (III) 23/12/2024 (Afternoon)", "NTPC CBT-I", "[SSC CGL 2023]", "(Shift-1)" MUST BE OMITTED).
6. Output ONLY the JSON array inside \`\`\`json ... \`\`\` block.`;
}

/**
 * Extract MockTest MCQs from a base64 image using direct Gemini API (/api/mocktest-extract or /api/extract)
 */
export async function extractMockTestWithDirectApi(
  base64Image: string,
  setName: string = 'Mock Test Paper',
  startIndex: number = 1
): Promise<MockTestMcqItem[]> {
  const settings = await getAiSettings();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (settings.apiKey) {
    headers['x-user-gemini-key'] = settings.apiKey.trim();
  }

  // First try direct mocktest-extract
  try {
    const response = await fetch('/api/mocktest-extract', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        base64Image,
        setName
      })
    });

    if (response.ok) {
      const data = await response.json();
      const rawText = data.rawJson || data.rawText || (data.items ? JSON.stringify(data.items) : '');
      if (rawText) {
        const parsed = parseAiOutputToMockTestItems(rawText, setName, startIndex);
        if (parsed.length > 0) return parsed;
      }
    }
  } catch (e) {
    console.warn('/api/mocktest-extract error, attempting /api/extract fallback:', e);
  }

  // Fallback to /api/extract
  const extractRes = await fetch('/api/extract', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      base64Image,
      numberingStyle: 1, // NumberingStyle.HASH
      includeImages: false,
      isBilingual: true,
      mcqMode: true,
      refineMode: false,
      showAnswers: true
    })
  });

  if (!extractRes.ok) {
    const err = await extractRes.json().catch(() => ({}));
    throw new Error(err.error || 'Direct API extraction failed. Please check your Gemini API key in Settings.');
  }

  const data = await extractRes.json();
  const elements = data.elements || [];
  return convertElementsToMockTestItems(elements, setName);
}

/**
 * Proofreads an array of MockTest items using the server AI proofreading endpoint,
 * deeply analyzing questions, fixing OCR errors, ensuring bilingual completeness,
 * and stripping all extraneous exam citations and junk tags.
 */
export async function proofreadMocktestItems(
  items: MockTestMcqItem[],
  onProgress?: (message: string) => void
): Promise<MockTestMcqItem[]> {
  if (!items || items.length === 0) return [];

  const settings = await getAiSettings();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (settings.apiKey) {
    headers['x-user-gemini-key'] = settings.apiKey.trim();
  }

  const batchSize = 5;
  const result: MockTestMcqItem[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(items.length / batchSize);
    onProgress?.(`AI Proofreading chunk ${batchNum}/${totalBatches} (${chunk.length} MCQs)...`);

    try {
      const res = await fetch('/api/mocktest-proofread', {
        method: 'POST',
        headers,
        body: JSON.stringify({ items: chunk })
      });

      if (!res.ok) {
        throw new Error(`Proofread server error: ${res.statusText}`);
      }

      const data = await res.json();
      const proofreadChunk: MockTestMcqItem[] = Array.isArray(data.items) && data.items.length > 0 
        ? data.items 
        : chunk;

      // Merge proofread fields back with original IDs and numbering
      for (let j = 0; j < chunk.length; j++) {
        const orig = chunk[j];
        const pr = proofreadChunk[j] || orig;
        result.push(cleanMockTestItem({
          ...orig,
          question_hi: pr.question_hi || orig.question_hi,
          option1_hi: pr.option1_hi !== undefined ? pr.option1_hi : orig.option1_hi,
          option2_hi: pr.option2_hi !== undefined ? pr.option2_hi : orig.option2_hi,
          option3_hi: pr.option3_hi !== undefined ? pr.option3_hi : orig.option3_hi,
          option4_hi: pr.option4_hi !== undefined ? pr.option4_hi : orig.option4_hi,
          option5_hi: pr.option5_hi !== undefined ? pr.option5_hi : orig.option5_hi,
          solution_hi: pr.solution_hi || orig.solution_hi,
          question_en: pr.question_en || orig.question_en,
          option1_en: pr.option1_en !== undefined ? pr.option1_en : orig.option1_en,
          option2_en: pr.option2_en !== undefined ? pr.option2_en : orig.option2_en,
          option3_en: pr.option3_en !== undefined ? pr.option3_en : orig.option3_en,
          option4_en: pr.option4_en !== undefined ? pr.option4_en : orig.option4_en,
          option5_en: pr.option5_en !== undefined ? pr.option5_en : orig.option5_en,
          solution_en: pr.solution_en || orig.solution_en,
          answer: pr.answer || orig.answer,
          difficulty_level: pr.difficulty_level || orig.difficulty_level
        }));
      }
    } catch (e: any) {
      console.warn(`Proofread batch ${batchNum} failed, applying local tag & math sanitization:`, e);
      // Fallback: use locally cleaned items
      chunk.forEach(it => result.push(cleanMockTestItem(it)));
    }
  }

  return result;
}


