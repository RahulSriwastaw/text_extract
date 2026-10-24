import sanitizeHtml from 'sanitize-html';
import katex from 'katex';

export const TARGET_FIELDS = [
  'question_r', 'question_hi', 'option1_hi', 'option2_hi', 'option3_hi', 'option4_hi', 'option5_hi', 'solution_hi',
  'question_en', 'option1_en', 'option2_en', 'option3_en', 'option4_en', 'option5_en', 'solution_en', 'answer',
  'set_name', 'difficulty_level', 'test_date', 'test_time', 'subject', 'subject_level', 'figure_notes', 'correction_notes',
  'source_pdf', 'source_pages', 'source_question_reference', 'latex_check', 'html_check', 'answer_check', 'solution_check',
  'hash_figure', 'manually_review', 'duplicate_statistics',
] as const;
export type TargetField = typeof TARGET_FIELDS[number];
export type TargetRow = Record<TargetField, string>;
export const EXTRA_FIELDS = ['passage_hi', 'passage_en', 'directions_hi', 'directions_en', 'passage_id', 'option_e',
  'option6_hi', 'option6_en', 'question_image', ...Array.from({ length: 6 }, (_, i) => `option${i + 1}_image`),
  'solution_image', 'org', 'exam', 'year', 'shift', 'chapter', 'topic', 'subtopic'] as const;
export type SourceFormat = 'ALP' | 'GK' | 'TARGET' | 'CUSTOM';
export type CheckState = 'PASS' | 'WARNING' | 'FAIL' | 'NOT_CHECKED';
export interface Settings {
  version: 1;
  mapping: Record<string, string>;
  answerFormat: 'preserve' | 'letters' | 'numbers';
  mergePassage: boolean;
  mergeDirections: boolean;
  deduplicatePassage: boolean;
  omitDirections: string[];
  formatting: 'preserve' | 'normalize' | 'plain';
  images: 'both' | 'hi' | 'en' | 'audit';
  approvedImageHosts: string[];
  supportsImages: boolean;
  supportsTables: boolean;
  neutralOptionE: boolean;
  missingSolution: 'warning' | 'error';
  duplicates: 'exact' | 'similar' | 'off';
  defaults: { subject: string; difficulty_level: string };
  requiredMetadata: string[];
  qualityValues: Record<CheckState, string>;
  reviewValue: string;
  reviewedValue: string;
  formulaPolicy: 'block' | 'prefix';
  bom: boolean;
}
export interface SourceRow { row: number; cells: string[]; values: Record<string, string>; error?: string }
export interface SourceFile { headers: string[]; rows: SourceRow[]; format: SourceFormat }
export interface Issue { code: string; severity: 'warning' | 'error'; message: string; field?: string }
export interface Edit { field: string; before: string; after: string }
export interface ConvertedRow {
  source: SourceRow; target: TargetRow; baseIssues: Issue[]; issues: Issue[]; transformations: string[];
  edits: Edit[]; reviewAccepted: boolean; excluded: boolean; resolution: string;
  duplicates: number[]; status: 'ready' | 'review' | 'blocked' | 'excluded';
}
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 5000;
const key = (s: string) => s.trim().toLowerCase().replace(/[\s_-]/g, '');
const has = (s: string) => !!s?.trim();
export function defaultSettings(headers: string[] = [], format: SourceFormat = detectFormat(headers)): Settings {
  const lookup = new Map(headers.map(h => [key(h), h]));
  const mapping: Record<string, string> = {};
  const choose = (target: string, ...aliases: string[]) => {
    mapping[target] = aliases.map(a => lookup.get(key(a))).find(Boolean) || '';
  };
  TARGET_FIELDS.forEach(f => choose(f, f));
  for (const [lang, sourceLang] of [['hi', 'HN'], ['en', 'EN']]) {
    choose(`question_${lang}`, `question_${lang}`, `Question_${sourceLang}`);
    choose(`solution_${lang}`, `solution_${lang}`, `Solution_${sourceLang}`);
    choose(`passage_${lang}`, `Passage_${sourceLang}`, `Passage_${lang}`);
    choose(`directions_${lang}`, `Directions_${sourceLang}`, `Directions_${lang}`);
    for (let n = 1; n <= 6; n++) {
      choose(`option${n}_${lang}`, `option${n}_${lang}`, `Option${n}_${sourceLang}`, `Option_${'ABCDEF'[n - 1]}_${sourceLang}`);
    }
  }
  choose('option_e', 'Option_E');
  choose('question_image', 'ImageUrl', 'Image_URL');
  choose('solution_image', 'Solution_Image_URL');
  for (let n = 1; n <= 6; n++) choose(`option${n}_image`, `Option${n}_Image`);
  choose('passage_id', 'PassageID', 'Passage_ID');
  choose('set_name', 'set_name', 'TestTitle');
  choose('subject', 'subject', 'Section');
  choose('source_question_reference', 'source_question_reference', 'QuestionID', 'QSNo');
  for (const [t, s] of Object.entries({ org: 'Org', exam: 'ExamName', year: 'ExamYear', shift: 'Shift', chapter: 'Chapter', topic: 'Topic', subtopic: 'SubTopic' })) choose(t, s);
  return { version: 1, mapping, answerFormat: 'preserve', mergePassage: true, mergeDirections: true,
    deduplicatePassage: true, omitDirections: [], formatting: 'preserve', images: 'both', approvedImageHosts: [],
    supportsImages: true, supportsTables: true, neutralOptionE: false, missingSolution: 'warning', duplicates: 'exact',
    defaults: { subject: '', difficulty_level: '' }, requiredMetadata: [],
    qualityValues: { PASS: '', WARNING: '', FAIL: '', NOT_CHECKED: '' }, reviewValue: '', reviewedValue: '',
    formulaPolicy: 'block', bom: true };
}

export function detectFormat(headers: string[]): SourceFormat {
  const h = new Set(headers.map(key));
  if (TARGET_FIELDS.every(f => h.has(key(f)))) return 'TARGET';
  if (h.has('optionahn') || h.has('optionaen')) return 'ALP';
  if ((h.has('option1hn') || h.has('option1en')) && (h.has('testtitle') || h.has('questionid'))) return 'GK';
  return 'CUSTOM';
}

/** RFC 4180 quoted fields, embedded CR/LF and doubled quotes. Malformed syntax fails before conversion. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let record: string[] = [], value = '', quoted = false, closed = false, touched = false;
  text = text.replace(/^\uFEFF/, '');
  const pushField = () => { record.push(value); value = ''; closed = false; };
  const pushRow = () => { pushField(); rows.push(record); record = []; touched = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { value += '"'; i++; }
        else { quoted = false; closed = true; }
      } else value += c;
      continue;
    }
    if (closed && c !== ',' && c !== '\r' && c !== '\n') throw new Error(`Unexpected character after a closing quote in record ${rows.length + 1}.`);
    if (c === '"') {
      if (value) throw new Error(`Unexpected quote in record ${rows.length + 1}. Quote the entire field and double embedded quotes.`);
      quoted = true; touched = true;
    } else if (c === ',') { pushField(); touched = true; }
    else if (c === '\r' || c === '\n') { pushRow(); if (c === '\r' && text[i + 1] === '\n') i++; }
    else { value += c; touched = true; }
    if (rows.length > MAX_ROWS + 1) throw new Error(`Maximum ${MAX_ROWS} source records per file.`);
  }
  if (quoted) throw new Error('Unclosed quoted field. Fix the source CSV before converting.');
  if (touched || record.length || value || closed) pushRow();
  return rows;
}
export function readSource(text: string): SourceFile {
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new Error('Maximum file size is 10 MB.');
  const [headers, ...data] = parseCsv(text);
  if (!headers?.length || headers.some(h => !has(h))) throw new Error('A nonempty header is required for every column.');
  if (new Set(headers.map(key)).size !== headers.length) throw new Error('Duplicate or ambiguous column names. Give every source column a unique name.');
  if (!data.length) throw new Error('The CSV has headers but no question records.');
  if (data.length > MAX_ROWS) throw new Error(`Maximum ${MAX_ROWS} source records per file.`);
  return { headers, format: detectFormat(headers), rows: data.map((cells, i) => ({ row: i + 2, cells,
    values: Object.fromEntries(headers.map((h, j) => [h, cells[j] ?? ''])),
    ...(cells.length !== headers.length ? { error: `Expected ${headers.length} cells; found ${cells.length}. Original cells retained in audit.` } : {}),
  })) };
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function safeImageUrl(value: string, hosts: string[] = []): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!hosts.length || hosts.some(h => h.toLowerCase() === url.hostname.toLowerCase()));
  } catch { return false; }
}
export function cleanHtml(value: string, hosts: string[] = []): string {
  return sanitizeHtml(value, {
    allowedTags: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'sup', 'sub', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'img', 'div', 'span', 'blockquote', 'hr'],
    allowedAttributes: { img: ['src', 'alt', 'width', 'height'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], ol: ['start'] },
    allowedSchemes: ['https'], allowProtocolRelative: false,
    exclusiveFilter: frame => frame.tag === 'img' && !safeImageUrl(frame.attribs.src || '', hosts),
  });
}
const htmlLike = (s: string) => /<\/?[a-z][^>]*>/i.test(s);
export function plainText(s: string): string {
  return sanitizeHtml(s.replace(/<br\s*\/?\s*>|<\/(?:p|div|li|tr)>/gi, '\n').replace(/<\/(?:td|th)>/gi, '\t'), { allowedTags: [], allowedAttributes: {} })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
const normalized = (s: string) => plainText(s).normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
const present = (s: string) => has(plainText(s)) || /<img\b[^>]*\bsrc=/i.test(s);
const contentFields = TARGET_FIELDS.filter(f => /^(question_(hi|en)|option\d_|solution_)/.test(f));
const block = (s: string) => htmlLike(s) ? s : `<p>${escapeHtml(s).replace(/\r\n|\r|\n/g, '<br>')}</p>`;
const imageCount = (s: string) => (s.match(/<img\b/gi) || []).length;
function containsPassage(question: string, passage: string): boolean {
  const value = normalized(passage);
  if (!value) return false;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(normalized(question));
}

export function mergeContext(question: string, passage: string, directions: string, lang: string, settings: Settings): string {
  let p = settings.mergePassage ? passage : '';
  const d = settings.mergeDirections && !settings.omitDirections.some(x => normalized(x) === normalized(directions)) ? directions : '';
  // Text-only matching is insufficient for image/table passages: require the complete markup in that case.
  if (p && settings.deduplicatePassage && (/<(?:img|table)\b/i.test(p) ? question.includes(p) : containsPassage(question, p))) p = '';
  if (!has(p) && !has(d)) return question;
  const labels = lang === 'hi' ? ['गद्यांश:', 'निर्देश:', 'प्रश्न:'] : ['Passage:', 'Directions:', 'Question:'];
  return [p, d, question].map((s, i) => has(s) ? `<p><b>${labels[i]}</b></p>\n${block(s)}` : '').filter(Boolean).join('\n\n');
}

export function latexProblems(text: string): string[] {
  const problems: string[] = [];
  const expressions = [...text.matchAll(/\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|(?<![\\$])\$(?!\$)([^\n$]+?)(?<!\\)\$(?!\$)/g)];
  for (const match of expressions) {
    const expression = match[1] ?? match[2] ?? match[3] ?? match[4];
    // Currency prose ($5 and $10) is not a mathematical expression.
    if (/^\d[\d,.]*\s+(?:and|or|to)\s*$/i.test(expression)) continue;
    try { katex.renderToString(expression, { throwOnError: true, trust: false, strict: 'ignore', maxExpand: 1000 }); }
    catch { problems.push(`Invalid or unsupported LaTeX: ${expression.slice(0, 90)}`); }
  }
  const remaining = text.replace(/\\\$/g, '').replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|(?<!\$)\$(?!\$)[^\n$]+?\$(?!\$)/g, '');
  if (/\\[([]|\\[)\]]|\$\$|\$(?=[a-zA-Z\\{])/.test(remaining)) problems.push('Possible unclosed mathematical delimiter.');
  return problems;
}
export function formulaRisk(s: string): boolean {
  return /^[\s\uFEFF]*[=+\-@\t\r\n]/.test(s) && !/^\s*[+-]?\d+(?:\.\d+)?\s*$/.test(s);
}

export function convertSource(source: SourceFile, settings: Settings, progress?: (n: number) => void): ConvertedRow[] {
  const get = (row: SourceRow, field: string) => row.values[settings.mapping[field]] || '';
  const groups = new Map<string, Record<string, Set<string>>>();
  for (const row of source.rows) {
    const id = get(row, 'passage_id');
    if (!has(id)) continue;
    const group = groups.get(id) || {};
    for (const f of ['passage_hi', 'passage_en', 'directions_hi', 'directions_en']) {
      group[f] ||= new Set(); if (has(get(row, f))) group[f].add(get(row, f));
    }
    groups.set(id, group);
  }
  const converted = source.rows.map((sourceRow, index) => {
    const target = Object.fromEntries(TARGET_FIELDS.map(f => [f, get(sourceRow, f)])) as TargetRow;
    const row: ConvertedRow = { source: sourceRow, target, baseIssues: [], issues: [], transformations: [], edits: [], reviewAccepted: false, excluded: false, resolution: '', duplicates: [], status: 'review' };
    const warn = (code: string, message: string, severity: 'warning' | 'error' = 'warning', field?: string) => row.baseIssues.push({ code, message, severity, field });
    if (sourceRow.error) warn('csv_shape', sourceRow.error, 'error');
    if (!present(target.question_hi) && !present(target.question_en) && !has(get(sourceRow, 'question_image'))) warn('missing_stem', 'Source has no mapped question text or question image. Passage/directions alone cannot supply a question.', 'error');
    if (!has(target.set_name)) target.set_name = ['org', 'exam', 'year', 'shift'].map(f => get(sourceRow, f)).filter(has).join(' / ');
    if (!has(target.subject_level)) target.subject_level = ['chapter', 'topic', 'subtopic'].map(f => get(sourceRow, f)).filter(has).join(' / ');
    target.subject ||= settings.defaults.subject;
    target.difficulty_level ||= settings.defaults.difficulty_level;
    target.source_question_reference ||= `source row ${sourceRow.row}`;
    const originalSixth = Object.entries(sourceRow.values).filter(([f]) => /^(option6(hn|hi|en|image)?|optionf(hn|hi|en)?)$/.test(key(f))).map(([, v]) => v);
    if ([...originalSixth, get(sourceRow, 'option6_hi'), get(sourceRow, 'option6_en'), get(sourceRow, 'option6_image')].some(has)) warn('sixth_option', 'Sixth option cannot fit the target. Edit the five options/answer and record an explicit resolution, or exclude this row.', 'error');
    const optionE = get(sourceRow, 'option_e');
    if (has(optionE)) {
      const neutral = settings.neutralOptionE || /^[\d\s.,+\-*/=()%<>]+$/.test(optionE.trim());
      if (!has(target.option5_hi) || !has(target.option5_en)) {
        if (neutral) { target.option5_hi ||= optionE; target.option5_en ||= optionE; row.transformations.push('Copied language-neutral Option_E to missing fifth-option fields.'); }
        else warn('option_e_language', 'Option_E language is ambiguous. Map language overrides or explicitly confirm it is neutral.');
      }
    }
    for (const lang of ['hi', 'en']) {
      const context: string[] = [];
      for (const kind of ['passage', 'directions']) {
        const f = `${kind}_${lang}`;
        let value = get(sourceRow, f);
        const grouped = groups.get(get(sourceRow, 'passage_id'))?.[f];
        if (grouped && grouped.size > 1) warn('passage_conflict', `Passage ID has conflicting ${f} values. Resolve source grouping before import.`, 'error', f);
        if (!has(value) && grouped?.size === 1) { value = [...grouped][0]; row.transformations.push(`Inherited ${f} using explicit passage ID.`); }
        const enabled = kind === 'passage' ? settings.mergePassage : settings.mergeDirections;
        if (has(value) && !enabled) { warn('context_omitted', `${f} omitted by configuration; original remains in audit.`, 'warning', f); row.transformations.push(`${f} retained in audit only.`); }
        if (kind === 'directions' && has(value) && settings.omitDirections.some(x => normalized(x) === normalized(value))) row.transformations.push(`Omitted explicitly configured generic directions (${lang}).`);
        context.push(value);
      }
      const f = `question_${lang}` as TargetField;
      const merged = mergeContext(target[f], context[0], context[1], lang, settings);
      if (merged !== target[f]) row.transformations.push(`Merged passage/directions into ${f}.`);
      target[f] = merged;
    }
    const imageMetadata: Record<string, string> = {};
    for (const [sourceField, targets, alt] of [
      ['question_image', ['question_hi', 'question_en'], 'Question figure'],
      ...Array.from({ length: 5 }, (_, i) => [`option${i + 1}_image`, [`option${i + 1}_hi`, `option${i + 1}_en`], `Option ${i + 1} figure`]),
      ['solution_image', ['solution_hi', 'solution_en'], 'Solution figure'],
    ] as [string, string[], string][]) {
      const url = get(sourceRow, sourceField);
      if (!has(url)) continue;
      imageMetadata[sourceField] = url;
      if (!safeImageUrl(url, settings.approvedImageHosts)) { warn('unsafe_image', `${sourceField}: URL is not an approved HTTPS image reference.`, 'error', sourceField); continue; }
      if (settings.images === 'audit' || !settings.supportsImages || settings.formatting === 'plain') { warn('image_unrepresented', `${sourceField} cannot be embedded with the selected target policy.`, 'error', sourceField); continue; }
      for (const field of targets.filter(f => settings.images === 'both' || f.endsWith(settings.images))) {
        const escaped = escapeHtml(url);
        if (!target[field].includes(`src="${escaped}"`) && !target[field].includes(`src='${url}'`)) {
          target[field] = (has(target[field]) ? block(target[field]) + '\n' : '') + `<img src="${escaped}" alt="${alt}">`;
          row.transformations.push(`${sourceField} embedded in ${field}.`);
        }
      }
    }
    if (Object.keys(imageMetadata).length) target.figure_notes = [target.figure_notes, JSON.stringify(imageMetadata)].filter(has).join('\n');
    for (const f of contentFields) {
      const original = target[f];
      if (htmlLike(original)) {
        const safe = cleanHtml(original, settings.approvedImageHosts);
        if (safe !== original) { row.transformations.push(`Sanitized/normalized HTML in ${f}; original retained in audit.`); warn('html_changed', `HTML in ${f} was sanitized or repaired. Review formatting.`, 'warning', f); }
        if (imageCount(original) > imageCount(safe) || (imageCount(original) && settings.formatting === 'plain')) warn('image_removed', `Image content in ${f} could not be safely represented. Fix the source or image policy.`, 'error', f);
        target[f] = settings.formatting === 'plain' ? plainText(safe) : safe;
      } else if (settings.formatting === 'normalize' && has(original)) target[f] = block(original);
    }
    const answer = target.answer.trim();
    const answerIndex = /^[A-E]$/i.test(answer) ? answer.toUpperCase().charCodeAt(0) - 64 : /^[1-5]$/.test(answer) ? Number(answer) : 0;
    if (answerIndex && settings.answerFormat !== 'preserve') { target.answer = settings.answerFormat === 'numbers' ? String(answerIndex) : 'ABCDE'[answerIndex - 1]; if (target.answer !== answer) row.transformations.push(`Answer converted from ${answer} to ${target.answer}.`); }
    progress?.(index + 1);
    return row;
  });
  return revalidate(converted, settings);
}

function issueState(issues: Issue[], pattern: RegExp): CheckState {
  const relevant = issues.filter(i => pattern.test(i.code));
  return relevant.some(i => i.severity === 'error') ? 'FAIL' : relevant.length ? 'WARNING' : 'PASS';
}
export function revalidate(input: ConvertedRow[], settings: Settings): ConvertedRow[] {
  const rows = input.map(r => ({ ...r, target: { ...r.target }, issues: r.baseIssues.filter(i => i.code !== 'sixth_option' || !has(r.resolution)), duplicates: [] as number[] }));
  for (const row of rows) {
    const add = (code: string, message: string, severity: 'warning' | 'error' = 'warning', field?: string) => row.issues.push({ code, message, severity, field });
    const t = row.target;
    if (!present(t.question_hi) && !present(t.question_en)) add('missing_question', 'No question text or question image.', 'error');
    const answer = t.answer.trim();
    const n = /^[A-E]$/i.test(answer) ? answer.toUpperCase().charCodeAt(0) - 64 : /^[1-5]$/.test(answer) ? Number(answer) : 0;
    if (!answer) add('answer_missing', 'Answer is required.', 'error', 'answer');
    else if (!n) add('answer_invalid', 'Answer must identify one option A–E or 1–5.', 'error', 'answer');
    else {
      if (!present(t[`option${n}_hi`]) && !present(t[`option${n}_en`])) add('answer_empty_option', `Answer points to empty option ${n}.`, 'error', 'answer');
      for (const lang of ['hi', 'en']) if (has(plainText(t[`question_${lang}`]))) {
        if (!present(t[`option${n}_${lang}`])) add('answer_language_gap', `Answer option ${n} is missing in ${lang}.`, 'error', `option${n}_${lang}`);
        if (Array.from({ length: 5 }, (_, i) => t[`option${i + 1}_${lang}`]).filter(present).length < 2) add('options_missing', `At least two options are required in ${lang}.`, 'error');
      }
    }
    const activeLanguages = ['hi', 'en'].filter(lang => present(t[`question_${lang}`]));
    for (const lang of activeLanguages) if (!present(t[`solution_${lang}`])) add('solution_missing', `Missing or empty ${lang} solution.`, settings.missingSolution, `solution_${lang}`);
    for (const f of contentFields) {
      const value = t[f];
      if (htmlLike(value) && cleanHtml(value, settings.approvedImageHosts) !== value) add('html_unsafe', `Unsafe or malformed HTML in ${f}. Edit the field to resolve.`, 'error', f);
      if (!settings.supportsTables && /<table\b/i.test(value)) add('html_table', `Target profile does not support tables in ${f}.`, 'error', f);
      if (/<img\b/i.test(value)) {
        if (!settings.supportsImages || settings.formatting === 'plain') add('image_unsupported', `Target profile cannot represent images in ${f}.`, 'error', f);
        else add('image_unverified', `Image accessibility in ${f} has not been verified. Check the student preview.`, 'warning', f);
      }
      latexProblems(plainText(value)).forEach(message => add('latex_invalid', message, 'warning', f));
      if (f.startsWith('solution_') && /\b(previous question|above question|preceding question)\b|पिछले प्रश्न/i.test(plainText(value))) add('solution_reference', `Solution in ${f} refers to another question.`, 'warning', f);
      if (f.startsWith('solution_')) {
        const stated = plainText(value).match(/(?:correct\s+(?:answer|option)\s*(?:is|:)?\s*)([A-E1-5])\b/i)?.[1];
        if (stated && n && (/[A-E]/i.test(stated) ? stated.toUpperCase().charCodeAt(0) - 64 : +stated) !== n) add('solution_mismatch', `Solution in ${f} names a different answer; human verification required.`, 'warning', f);
      }
    }
    for (const f of settings.requiredMetadata) if (!has(t[f])) add('metadata_missing', `Required metadata ${f} is missing.`, 'error', f);
    for (const f of TARGET_FIELDS) if (formulaRisk(t[f])) add('formula', `Spreadsheet formula-like prefix in ${f}${settings.formulaPolicy === 'prefix' ? '; export will prefix an apostrophe' : '; edit or select explicit apostrophe protection'}.`, settings.formulaPolicy === 'prefix' ? 'warning' : 'error', f);
  }
  if (settings.duplicates !== 'off') {
    const exact = new Map<string, ConvertedRow[]>();
    for (const row of rows) {
      const signature = contentFields.filter(f => !f.startsWith('solution_')).map(f => normalized(row.target[f]) + (row.target[f].match(/<img\b[^>]*>/g) || []).join('')).join('\u001f');
      const bucket = exact.get(signature) || []; bucket.push(row); exact.set(signature, bucket);
    }
    for (const group of exact.values()) if (group.length > 1) for (const row of group) {
      row.duplicates = group.filter(x => x !== row).slice(0, 50).map(x => x.source.row);
      row.issues.push({ code: 'duplicate_exact', severity: 'warning', message: `Exact content duplicate: ${group.length - 1} matching row(s). Source row(s) ${row.duplicates.join(', ')}${group.length > 51 ? ' (first 50 shown)' : ''}. Answers may differ; compare before accepting.` });
    }
    if (settings.duplicates === 'similar') {
      const signatures = rows.map(r => new Set(normalized(`${r.target.question_hi} ${r.target.question_en}`).split(/\s+/).filter(Boolean)));
      // Deterministic lexical candidates, not a claim of semantic equivalence.
      for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
        const a = signatures[i], b = signatures[j];
        if (a.size < 5 || b.size < 5 || Math.min(a.size, b.size) / Math.max(a.size, b.size) < 0.85 || rows[i].duplicates.includes(rows[j].source.row)) continue;
        const intersection = [...a].filter(t => b.has(t)).length;
        if (intersection / (a.size + b.size - intersection) >= 0.85) for (const [x, y] of [[i, j], [j, i]]) {
          rows[x].duplicates.push(rows[y].source.row);
          rows[x].issues.push({ code: 'duplicate_similar', severity: 'warning', message: `Potential text-similar duplicate of source row ${rows[y].source.row}; compare manually.` });
        }
      }
    }
  }
  for (const row of rows) {
    row.status = row.excluded ? 'excluded' : row.issues.some(i => i.severity === 'error') ? 'blocked' : row.issues.length && !row.reviewAccepted ? 'review' : 'ready';
    for (const [f, pattern] of [['latex_check', /^latex/], ['html_check', /^html/], ['answer_check', /^answer|^options/], ['solution_check', /^solution/]] as [TargetField, RegExp][]) row.target[f] = settings.qualityValues[issueState(row.issues, pattern)];
    row.target.manually_review = row.status === 'ready' ? settings.reviewedValue : settings.reviewValue;
    // Do not invent importer-specific quality vocabulary or hash algorithms.
  }
  return rows;
}
export function editRow(rows: ConvertedRow[], sourceRow: number, field: TargetField, value: string, settings: Settings): ConvertedRow[] {
  return revalidate(rows.map(r => r.source.row === sourceRow ? { ...r, target: { ...r.target, [field]: value }, reviewAccepted: false,
    edits: [...r.edits, { field, before: r.target[field], after: value }] } : r), settings);
}
export function summary(rows: ConvertedRow[]) {
  const count = (pattern: RegExp) => rows.filter(r => r.issues.some(i => pattern.test(i.code))).length;
  return { total: rows.length, converted: rows.filter(r => !r.source.error).length, ready: rows.filter(r => r.status === 'ready').length,
    review: rows.filter(r => r.status === 'review').length, blocked: rows.filter(r => r.status === 'blocked').length,
    excluded: rows.filter(r => r.status === 'excluded').length, missingAnswers: count(/^answer_missing/), missingSolutions: count(/^solution_missing/),
    html: count(/^html/), latex: count(/^latex/), images: count(/image/), duplicates: count(/^duplicate/), passages: count(/^passage|^context/) };
}
export function csvString(records: string[][], bom = false, protect = false): string {
  return (bom ? '\uFEFF' : '') + records.map(row => row.map(value => {
    const safe = protect && formulaRisk(value) ? "'" + value : value;
    return '"' + safe.replace(/"/g, '""') + '"';
  }).join(',')).join('\r\n');
}
export function exportTarget(rows: ConvertedRow[], settings: Settings): string {
  const verified = revalidate(rows, settings).filter(r => r.status === 'ready');
  return csvString([[...TARGET_FIELDS], ...verified.map(r => TARGET_FIELDS.map(f => r.target[f]))], settings.bom, settings.formulaPolicy === 'prefix');
}
export function exportValidation(rows: ConvertedRow[]): string {
  return csvString([['source_row', 'status', 'issues', 'duplicate_source_rows', 'review_accepted', 'resolution'], ...rows.map(r => [String(r.source.row), r.status, JSON.stringify(r.issues), r.duplicates.join(', '), String(r.reviewAccepted), r.resolution])], true, true);
}
export function exportAudit(source: SourceFile, rows: ConvertedRow[], settings: Settings): string {
  const used = new Set(Object.values(settings.mapping));
  return csvString([['source_row', 'outcome', 'original_headers_json', 'original_cells_json', 'unmapped_fields_json', 'transformations_json', 'edits_json', 'resolution', 'target_before_export_json', 'export_prefix_fields_json'],
    ...rows.map(r => [String(r.source.row), r.status, JSON.stringify(source.headers), JSON.stringify(r.source.cells),
      JSON.stringify(Object.fromEntries(Object.entries(r.source.values).filter(([f]) => !used.has(f)))), JSON.stringify(r.transformations), JSON.stringify(r.edits), r.resolution,
      JSON.stringify(r.target), JSON.stringify(settings.formulaPolicy === 'prefix' ? TARGET_FIELDS.filter(f => formulaRisk(r.target[f])) : [])])], true, true);
}
export function exportReview(rows: ConvertedRow[]): string {
  return csvString([['source_row', 'outcome', 'issues_json', 'original_cells_json', ...TARGET_FIELDS], ...rows.filter(r => r.status !== 'ready').map(r => [String(r.source.row), r.status, JSON.stringify(r.issues), JSON.stringify(r.source.cells), ...TARGET_FIELDS.map(f => r.target[f])])], true, true);
}

export function parseSettings(json: string, headers: string[]): Settings {
  const candidate = JSON.parse(json);
  const defaults = defaultSettings(headers);
  if (!candidate || candidate.version !== 1 || typeof candidate !== 'object') throw new Error('Unsupported mapping preset version.');
  for (const [k, v] of Object.entries(defaults)) {
    if (typeof candidate[k] !== typeof v || candidate[k] === null || Array.isArray(v) !== Array.isArray(candidate[k])) throw new Error(`Invalid preset setting: ${k}.`);
  }
  for (const [k, values] of Object.entries({ answerFormat: ['preserve', 'letters', 'numbers'], formatting: ['preserve', 'normalize', 'plain'], images: ['both', 'hi', 'en', 'audit'], missingSolution: ['warning', 'error'], duplicates: ['exact', 'similar', 'off'], formulaPolicy: ['block', 'prefix'] })) {
    if (!values.includes(candidate[k])) throw new Error(`Invalid preset setting: ${k}.`);
  }
  for (const k of ['omitDirections', 'approvedImageHosts', 'requiredMetadata']) if (!candidate[k].every((x: unknown) => typeof x === 'string')) throw new Error(`Invalid list: ${k}.`);
  for (const k of ['mapping', 'defaults', 'qualityValues']) if (Array.isArray(candidate[k]) || !Object.values(candidate[k]).every(v => typeof v === 'string')) throw new Error(`Invalid object: ${k}.`);
  for (const f of Object.keys(candidate.mapping)) if (![...TARGET_FIELDS, ...EXTRA_FIELDS].includes(f as any)) throw new Error(`Unknown mapping target: ${f}.`);
  for (const f of Object.values(candidate.mapping)) if (f && !headers.includes(f as string)) throw new Error(`Preset source column is absent: ${f}.`);
  if (!['PASS', 'WARNING', 'FAIL', 'NOT_CHECKED'].every(k => typeof candidate.qualityValues[k] === 'string') || !['subject', 'difficulty_level'].every(k => typeof candidate.defaults[k] === 'string')) throw new Error('Incomplete profile values.');
  if (!candidate.requiredMetadata.every((f: string) => TARGET_FIELDS.includes(f as TargetField))) throw new Error('Unknown required target field.');
  return Object.fromEntries(Object.keys(defaults).map(k => [k, candidate[k]])) as unknown as Settings;
}
