/**
 * Master Question Bank field guide (68 fields): one row per question.
 *
 * Fields 1-31 track a row inside the master bank, fields 32-68 are the 37 app fields in the
 * order of the app's CSV template. "Extractor" fields are filled when MCQs are extracted;
 * "Master" fields are left empty (the merge step fills or recomputes them), except a few that
 * can only be derived from the same row and are therefore safe to fill here.
 *
 * Pure helpers only (no DOM, no network, no runtime imports) so tests and the backend can import this file.
 */
import type { MockTestMcqItem } from '../types';

export const MASTER_TRACKING_FIELDS = [
  'master_id', 'exam_category', 'exam', 'source_collection', 'source_file', 'review_flag', 'has_figure', 'content_hash',
  'question_id', 'source_id', 'source_row', 'year', 'paper_or_set', 'exam_tags', 'source_status', 'quality_status',
  'quality_issues', 'question_type', 'option_count', 'language_type', 'has_passage', 'has_solution', 'has_solution_hi',
  'has_solution_en', 'answer_letter', 'times_used', 'last_set_id', 'sub_topic', 'legacy_tags', 'canonical_id', 'added_on',
] as const;

export const MASTER_APP_FIELDS = [
  'question_r', 'passage_hi', 'question_hi', 'option1_hi', 'option2_hi', 'option3_hi', 'option4_hi', 'option5_hi', 'solution_hi',
  'passage_en', 'question_en', 'option1_en', 'option2_en', 'option3_en', 'option4_en', 'option5_en', 'solution_en',
  'answer', 'set_name', 'difficulty_level', 'chapter_name', 'test_date', 'test_time', 'subject', 'subject_level',
  'figure_notes', 'correction_notes', 'source_pdf', 'source_pages', 'source_question_reference',
  'latex_check', 'html_check', 'answer_check', 'solution_check', 'hash_figure', 'manually_review', 'duplicate_statistics',
] as const;

export const MASTER_QB_HEADERS = [...MASTER_TRACKING_FIELDS, ...MASTER_APP_FIELDS] as const;
export type MasterField = typeof MASTER_QB_HEADERS[number];
export type MasterRow = Record<MasterField, string>;

export const EXAM_CATEGORIES = [
  'SSC', 'Railway RRB', 'BSSC', 'Bihar State Exams', 'UP State Exams', 'UPSC PCS', 'Teaching',
  'Subjectwise GS', 'School Boards', 'Current Affairs', 'Book Practice', 'Other Exams',
] as const;
export const SOURCE_STATUSES = ['REAL_PYQ', 'BOOK_PRACTICE', 'FRAMED_MCQ', 'MOCK_TEST'] as const;
export const EXAM_EXAMPLES = [
  'SSC CGL', 'SSC CHSL', 'SSC GD', 'RRB NTPC', 'RRB Group D', 'RRB ALP', 'BPSC TRE', 'BSSC 10plus2', 'UPPCS Pre',
] as const;
export const DIFFICULTY_LEVELS = ['easy', 'medium', 'hard'] as const;

/** Paper-level values the teacher enters once; they apply to every extracted question. */
export interface MasterContext {
  exam_category?: string;
  exam?: string;
  year?: string;
  source_status?: string;
  test_date?: string;
  test_time?: string;
  subject_level?: string;
}

/** Where a question came from as the app knows it: the uploaded file and the page number inside that file. */
export interface MasterSource { pdf?: string; page?: string }

/** Fields the extractor must send for every row (the guide's "Minimum the extractor must send"). */
export const MASTER_MINIMUM_FIELDS: MasterField[] = [
  'exam_category', 'exam', 'year', 'source_status', 'paper_or_set', 'question_r', 'question_hi', 'question_en',
  'option1_hi', 'option2_hi', 'option3_hi', 'option4_hi', 'option1_en', 'option2_en', 'option3_en', 'option4_en',
  'answer', 'subject', 'chapter_name', 'source_pdf', 'source_pages', 'source_question_reference',
];

// ---------------------------------------------------------------------------
// Prompt text shared by the browser (bridge prompts) and the backend (direct API prompt)
// ---------------------------------------------------------------------------

export const MASTER_FIELD_PROMPT_RULES = `MASTER QUESTION BANK FIELDS (fill for EVERY question, use exactly these spellings):
- "chapter_name": the chapter the question belongs to, e.g. "Percentage", "Profit and Loss", "Modern History". Never empty.
- "sub_topic": the type or sub-topic inside the chapter, e.g. "LCM of fractions", "Successive discount". Never empty.
- "subject": the academic subject, e.g. "Mathematics", "Reasoning", "General Awareness", "English", "Hindi", "General Science".
- "subject_level": the exam level printed on the paper, e.g. "Graduate Level (SSC CGL/CPO)". "" if the paper does not print one.
- "difficulty_level": lower case "easy", "medium" or "hard".
- "exam_category": ONE of ${EXAM_CATEGORIES.map(c => `"${c}"`).join(', ')} - only if the paper itself names the exam, else "".
- "exam": the exact exam name printed on the paper, e.g. "SSC CGL", "RRB NTPC", "BPSC TRE". "" if not printed.
- "year": the 4-digit exam year if printed, else "". Never guess a year.
- "test_date": "YYYY-MM-DD" if the exam date is printed, else "". Never write "N/A".
- "test_time": the shift time as printed, e.g. "9:00 AM - 10:30 AM", else "".
- "exam_tags": other exams where this same question is printed as having appeared, separated by ";" (e.g. "SSC CGL 2023; RRB NTPC 2021"), else "".
- "source_question_reference": the question number as printed in the source, e.g. "Q.16".
- "figure_notes": if the question or an option needs a figure, one short sentence saying what the figure shows; else "".
- "correction_notes": ONLY a real problem or change, e.g. "Official key C; correct answer D (proved)" or "Answer self-solved, no key in source". Otherwise "".
- "manually_review": "yes" ONLY if something is unreadable, doubtful or could not be verified. Otherwise "". Never write "checked".
Do NOT output latex_check, html_check, answer_check, solution_check, hash_figure or duplicate_statistics.`;

/** Extra keys for the JSON example object inside an extraction prompt (comma-first, ready to splice before the closing brace). */
export const MASTER_FIELD_JSON_EXAMPLE = `,
    "chapter_name": "...",
    "sub_topic": "...",
    "subject_level": "",
    "exam_category": "",
    "exam": "",
    "year": "",
    "test_date": "",
    "test_time": "",
    "exam_tags": "",
    "figure_notes": "",
    "correction_notes": "",
    "manually_review": ""`;

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

/** Plain text of an HTML field (tags, entities and extra spaces removed). */
export function plainText(html?: string | null): string {
  return String(html ?? '')
    .replace(/<(?:br|\/p|\/div|\/li|\/tr)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const hasImage = (html?: string | null) => /<img\b/i.test(String(html ?? ''));
const isFilled = (html?: string | null) => (plainText(html) !== '' && plainText(html).toLowerCase() !== 'blank') || hasImage(html);
const squash = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, '');

/** Spelling from `list` that matches `value` (ignoring case, spaces and `_`/`-`), or "". */
export function canonicalValue(value: unknown, list: readonly string[]): string {
  const wanted = squash(String(value ?? '').trim());
  return wanted ? list.find(entry => squash(entry) === wanted) ?? '' : '';
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function isoDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "YYYY-MM-DD" from common printed dates (2024-09-10, 10/09/2024, 10 Sep 2024), or "" when unknown or invalid. */
export function normalizeIsoDate(value: unknown): string {
  const text = String(value ?? '').trim();
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) return isoDate(+match[1], +match[2], +match[3]);
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); // day first, as printed in Indian papers
  if (match) return isoDate(+match[3], +match[2], +match[1]);
  match = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  const month = match ? MONTHS.indexOf(match[2].slice(0, 3).toLowerCase()) : -1;
  return match && month >= 0 ? isoDate(+match[3], month + 1, +match[1]) : '';
}

/** A 4-digit exam year, or "". */
export function normalizeYear(value: unknown): string {
  const text = String(value ?? '').trim();
  return /^(?:19|20)\d{2}$/.test(text) ? text : '';
}

/** "12" or "12-13" (the guide's format) from "12", "12, 13", "12-13" or "Page 12". */
export function normalizeSourcePages(value: unknown): string {
  const text = String(value ?? '').trim();
  const range = text.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (range) return `${+range[1]}-${+range[2]}`;
  const pages = [...new Set([...text.matchAll(/\d+/g)].map(match => +match[0]))].sort((a, b) => a - b);
  if (!pages.length) return '';
  if (pages.length === 1) return String(pages[0]);
  return pages.every((page, index) => !index || page === pages[index - 1] + 1)
    ? `${pages[0]}-${pages[pages.length - 1]}` : pages.join(', ');
}

/** "Q16" from "Q.16", "Question 16" or "16"; other references stay as they are; empty becomes the guide's phrase. */
export function normalizeQuestionReference(value: unknown): string {
  const text = String(value ?? '').trim();
  const number = text.match(/^Q(?:uestion)?\.?\s*(\d+)$/i) || text.match(/^(\d+)$/);
  return number ? `Q${number[1]}` : text || 'Question number not printed';
}

/** Answer in the guide's format: letter A-E for MCQ, ["3","4"] for MSQ, {"start":"86","end":"86"} for NAT. */
export function normalizeMasterAnswer(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const value = JSON.parse(text);
      if (Array.isArray(value)) return JSON.stringify(value.map(entry => String(entry)));
      if (value && typeof value === 'object') {
        return JSON.stringify(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key.toLowerCase(), String(entry)])));
      }
    } catch { /* keep the text as the AI wrote it */ }
    return text;
  }
  const letter = text.toUpperCase().replace(/^(?:OPTION|OPT|ANSWER|ANS)\s*[:\-]?\s*/, '');
  const byNumber: Record<string, string> = { '1': 'A', '2': 'B', '3': 'C', '4': 'D', '5': 'E' };
  return byNumber[letter] || (/^[A-E]$/.test(letter) ? letter : text);
}

function questionTypeOf(item: MockTestMcqItem, answer: string): 'MCQ' | 'MSQ' | 'NAT' {
  if (answer.startsWith('[')) return 'MSQ';
  if (answer.startsWith('{')) return 'NAT';
  return item.question_type === 'MSQ' || item.question_type === 'NAT' ? item.question_type : 'MCQ';
}

const YES_LIKE = /^(?:yes|y|true|needs[-_ ]?review|review)$/i;
const PASSAGE_MARKER = /^\s*गद्यांश\s*\/\s*Passage/; // internal note written for passage questions
const NO_SOLUTION_PLACEHOLDER = /(?:उपलब्ध नहीं है|not available)/i;

function languageTypeOf(item: MockTestMcqItem): 'bilingual' | 'english_only' | 'hindi_only' {
  const deva = /[ऀ-ॿ]/;
  const hi = plainText([item.question_hi, item.option1_hi, item.option2_hi, item.solution_hi].join(' '));
  const en = plainText([item.question_en, item.option1_en, item.option2_en, item.solution_en].join(' '));
  if (!deva.test(hi) && !deva.test(en)) return 'english_only';
  return deva.test(en) ? 'hindi_only' : 'bilingual';
}

function imageLinks(item: MockTestMcqItem): string[] {
  const html = [item.question_hi, item.question_en, item.solution_hi, item.solution_en,
    ...[1, 2, 3, 4, 5].flatMap(n => [item[`option${n}_hi` as 'option1_hi'], item[`option${n}_en` as 'option1_en']])].join(' ');
  const found = [...html.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
  const stored = String(item.hash_figure ?? '').split(/,\s*/);
  return [...new Set([...found, ...stored].filter(link => /^(?:https?:\/\/|\/uploads\/)/i.test(link)))];
}

// ---------------------------------------------------------------------------
// One question -> one 68-field row
// ---------------------------------------------------------------------------

export function buildMasterRow(item: MockTestMcqItem, context: MasterContext = {}, source: MasterSource = {}): MasterRow {
  const row = Object.fromEntries(MASTER_QB_HEADERS.map(field => [field, ''])) as MasterRow;
  const text = (value: unknown) => String(value ?? '').trim();

  const answer = normalizeMasterAnswer(item.answer);
  const type = questionTypeOf(item, answer);
  const letter = type === 'MCQ' && /^[A-E]$/.test(answer) ? answer : '';
  const optionsHi = [1, 2, 3, 4, 5].map(n => item[`option${n}_hi` as 'option1_hi'] as string | undefined);
  const optionsEn = [1, 2, 3, 4, 5].map(n => item[`option${n}_en` as 'option1_en'] as string | undefined);
  const has = (n: number) => isFilled(optionsHi[n]) || isFilled(optionsEn[n]);

  // Solutions: the parser copies the correct option's text in when the page has no solution, which is not a solution.
  const correctTexts = letter ? [optionsHi['ABCDE'.indexOf(letter)], optionsEn['ABCDE'.indexOf(letter)]].map(plainText) : [];
  const realSolution = (html?: string) => {
    const plain = plainText(html);
    if (!plain) return false;
    if (plain.length < 80 && NO_SOLUTION_PLACEHOLDER.test(plain)) return false;
    return !correctTexts.includes(plain);
  };
  const solutionHi = realSolution(item.solution_hi), solutionEn = realSolution(item.solution_en);

  const links = imageLinks(item);
  const figure = Boolean(item.figures?.length) || links.length > 0
    || [item.question_hi, item.question_en, ...optionsHi, ...optionsEn].some(hasImage);
  const notes = PASSAGE_MARKER.test(text(item.figure_notes)) ? '' : text(item.figure_notes);

  const issues: string[] = [];
  if (!isFilled(item.question_hi) && !isFilled(item.question_en)) issues.push('missing_question');
  else if (!isFilled(item.question_hi)) issues.push('missing_hindi');
  if (type !== 'NAT' && ![0, 1, 2, 3].every(has)) issues.push('missing_options'); // numeric-answer questions have no options
  if (type === 'MCQ' ? !letter : !answer) issues.push('bad_answer_format');
  if (!solutionHi && !solutionEn) issues.push('no_solution');
  if (figure && (item.figures?.length || !links.length)) issues.push('figure_missing');

  const reviewByAi = YES_LIKE.test(text(item.manually_review));
  const realProblem = issues.some(issue => ['missing_question', 'missing_options', 'bad_answer_format'].includes(issue));

  const setName = text(item.set_name);
  const testDate = normalizeIsoDate(context.test_date) || normalizeIsoDate(item.test_date);
  const difficulty = canonicalValue(item.difficulty_level, DIFFICULTY_LEVELS);
  const checkValue = (value?: string) => /^(?:yes|no)$/i.test(text(value)) ? text(value).toUpperCase() : '';

  const passageText = [item.passage_hi, item.passage_en].some(value => plainText(value));
  const sourcePdf = text(item.source_pdf) || text(source.pdf);

  Object.assign(row, {
    // Part A: tracking fields
    exam_category: canonicalValue(context.exam_category, EXAM_CATEGORIES) || canonicalValue(item.exam_category, EXAM_CATEGORIES),
    exam: text(context.exam) || text(item.exam),
    source_file: text(item.source_file) || sourcePdf,
    has_figure: figure ? 'yes' : '',
    question_id: text(item.question_id),
    source_id: text(item.source_id),
    source_row: text(item.source_row),
    year: normalizeYear(context.year) || normalizeYear(item.year) || normalizeYear(testDate.slice(0, 4))
      || normalizeYear(setName.match(/\b(?:19|20)\d{2}\b/)?.[0]),
    paper_or_set: setName,
    exam_tags: text(item.exam_tags).split(/\s*[;|]\s*/).filter(Boolean).join('; '),
    source_status: canonicalValue(context.source_status, SOURCE_STATUSES) || canonicalValue(item.source_status, SOURCE_STATUSES),
    quality_issues: issues.join('; '),
    question_type: type,
    option_count: type === 'NAT' ? '' : has(4) ? '5' : '4',
    language_type: languageTypeOf(item),
    has_passage: item.passageGroupId || passageText || PASSAGE_MARKER.test(text(item.figure_notes)) ? 'yes' : '',
    has_solution: solutionHi || solutionEn ? 'yes' : '',
    has_solution_hi: solutionHi ? 'yes' : '',
    has_solution_en: solutionEn ? 'yes' : '',
    answer_letter: letter,
    sub_topic: text(item.sub_topic),
    // Part B: app fields. Passages stay inside the question text until the app shows them separately.
    question_r: text(item.question_r),
    question_hi: text(item.question_hi),
    option1_hi: text(item.option1_hi), option2_hi: text(item.option2_hi), option3_hi: text(item.option3_hi),
    option4_hi: text(item.option4_hi), option5_hi: text(item.option5_hi),
    solution_hi: text(item.solution_hi),
    question_en: text(item.question_en),
    option1_en: text(item.option1_en), option2_en: text(item.option2_en), option3_en: text(item.option3_en),
    option4_en: text(item.option4_en), option5_en: text(item.option5_en),
    solution_en: text(item.solution_en),
    answer,
    set_name: setName,
    difficulty_level: difficulty,
    chapter_name: text(item.chapter_name),
    test_date: testDate,
    test_time: text(context.test_time) || text(item.test_time),
    subject: text(item.subject),
    subject_level: text(context.subject_level) || text(item.subject_level),
    figure_notes: figure ? [notes, ...links.filter(link => !notes.includes(link))].filter(Boolean).join(' ') : '',
    correction_notes: text(item.correction_notes),
    source_pdf: sourcePdf,
    // The page inside the source file wins over the page number the AI reported (which counts pages of the whole queue).
    source_pages: normalizeSourcePages(source.page) || normalizeSourcePages(item.source_pages),
    source_question_reference: normalizeQuestionReference(item.source_question_reference),
    // The reviewer fills the checks and the master fills the hash and duplicate info.
    latex_check: checkValue(item.latex_check),
    html_check: checkValue(item.html_check),
    answer_check: checkValue(item.answer_check),
    solution_check: checkValue(item.solution_check),
    manually_review: reviewByAi || realProblem ? 'yes' : '',
  });
  return row;
}

/** Which of the guide's minimum fields are empty, and in how many rows (only fields with a gap are returned). */
export function masterGaps(rows: MasterRow[]): { field: MasterField; missing: number }[] {
  return MASTER_MINIMUM_FIELDS
    .map(field => ({
      field,
      // Numeric-answer (NAT) questions have no options, so empty options are not a gap there.
      missing: rows.filter(row => !row[field] && !(row.question_type === 'NAT' && /^option\d_/.test(field))).length,
    }))
    .filter(gap => gap.missing > 0);
}
