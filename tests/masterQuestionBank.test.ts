import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MASTER_QB_HEADERS, MASTER_TRACKING_FIELDS, MASTER_APP_FIELDS, MASTER_FIELD_PROMPT_RULES,
  buildMasterRow, masterGaps, masterSourceResolver, normalizeIsoDate, normalizeMasterAnswer, normalizeQuestionReference, normalizeSourcePages,
} from '../services/masterQuestionBank';
import {
  parseAiOutputToMockTestItems, buildMasterBankRows, serializeMasterBankCsv, buildMockTestBridgePrompt, buildMockTestDirectPrompt,
} from '../services/mocktestService';
import type { MockTestMcqItem } from '../types';

const fenced = (objects: unknown[]) => '```json\n' + JSON.stringify(objects) + '\n```';
const parse = (objects: unknown[], setName = 'SSC CGL 2024 10 Sep Shift 1') => parseAiOutputToMockTestItems(fenced(objects), setName, 1);

/** Minimal RFC 4180 reader: rows of fields, so the test also proves quoting keeps 68 columns per row. */
function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  const body = text.replace(/^﻿/, '');
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (quoted) {
      if (char === '"' && body[i + 1] === '"') { field += '"'; i++; } else if (char === '"') quoted = false; else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const percentage = {
  question_r: 16, question_hi: 'एक संख्या का 20% 40 है। संख्या ज्ञात कीजिए।', question_en: '20% of a number is 40. Find the number.',
  option1_hi: '100', option2_hi: '150', option3_hi: '200', option4_hi: '250',
  option1_en: '100', option2_en: '150', option3_en: '200', option4_en: '250', answer: 'C',
  solution_hi: 'माना संख्या x है। 20% of x = 40, इसलिए x = 40 × 100 / 20 = 200।',
  solution_en: 'Let the number be x. 20% of x = 40, so x = 40 × 100 / 20 = 200.',
  subject: 'Mathematics', difficulty_level: 'Easy', chapter_name: 'Percentage', sub_topic: 'Basic percentage',
  source_question_reference: 'Q.16', source_pages: '12', test_date: '10/09/2024', exam_tags: ['SSC CGL 2023', 'RRB NTPC 2021'],
  latex_check: 'checked', html_check: 'checked', manually_review: 'checked',
};

test('the field list is the 68 fields of the Master QB guide, in the guide order', () => {
  assert.equal(MASTER_TRACKING_FIELDS.length, 31);
  assert.equal(MASTER_APP_FIELDS.length, 37);
  assert.equal(MASTER_QB_HEADERS.length, 68);
  assert.equal(new Set(MASTER_QB_HEADERS).size, 68);
  assert.equal(MASTER_QB_HEADERS[0], 'master_id');
  assert.equal(MASTER_QB_HEADERS[30], 'added_on');
  assert.equal(MASTER_QB_HEADERS[31], 'question_r');
  assert.equal(MASTER_QB_HEADERS[32], 'passage_hi');
  assert.equal(MASTER_QB_HEADERS[40], 'passage_en');
  assert.equal(MASTER_QB_HEADERS[51], 'chapter_name');
  assert.equal(MASTER_QB_HEADERS[67], 'duplicate_statistics');
});

test('an extracted MCQ fills every Extractor field and leaves the Master fields empty', () => {
  const [item] = parse([percentage]);
  const context = { exam_category: 'SSC', exam: 'SSC CGL', source_status: 'REAL_PYQ' };
  const [row] = buildMasterBankRows([item], context, () => ({ pdf: 'SSC_CGL_2024.pdf', page: '12' }));
  assert.deepEqual(Object.keys(row), [...MASTER_QB_HEADERS]);
  assert.deepEqual({
    exam_category: row.exam_category, exam: row.exam, year: row.year, paper_or_set: row.paper_or_set, source_status: row.source_status,
    source_file: row.source_file, source_pdf: row.source_pdf, source_pages: row.source_pages, source_question_reference: row.source_question_reference,
    question_type: row.question_type, option_count: row.option_count, language_type: row.language_type,
    has_figure: row.has_figure, has_passage: row.has_passage, has_solution: row.has_solution, has_solution_hi: row.has_solution_hi,
    has_solution_en: row.has_solution_en, answer: row.answer, answer_letter: row.answer_letter, difficulty_level: row.difficulty_level,
    chapter_name: row.chapter_name, sub_topic: row.sub_topic, test_date: row.test_date, subject: row.subject,
    exam_tags: row.exam_tags, quality_issues: row.quality_issues,
  }, {
    exam_category: 'SSC', exam: 'SSC CGL', year: '2024', paper_or_set: 'SSC CGL 2024 10 Sep Shift 1', source_status: 'REAL_PYQ',
    source_file: 'SSC_CGL_2024.pdf', source_pdf: 'SSC_CGL_2024.pdf', source_pages: '12', source_question_reference: 'Q16',
    question_type: 'MCQ', option_count: '4', language_type: 'bilingual',
    has_figure: '', has_passage: '', has_solution: 'yes', has_solution_hi: 'yes',
    has_solution_en: 'yes', answer: 'C', answer_letter: 'C', difficulty_level: 'easy',
    chapter_name: 'Percentage', sub_topic: 'Basic percentage', test_date: '2024-09-10', subject: 'Mathematics',
    exam_tags: 'SSC CGL 2023; RRB NTPC 2021', quality_issues: '',
  });
  for (const field of ['master_id', 'source_collection', 'review_flag', 'content_hash', 'quality_status', 'times_used', 'last_set_id',
    'legacy_tags', 'canonical_id', 'added_on', 'passage_hi', 'passage_en', 'hash_figure', 'duplicate_statistics',
    'latex_check', 'html_check', 'answer_check', 'solution_check', 'manually_review'] as const) {
    assert.equal(row[field], '', `${field} must stay empty`);
  }
  assert.equal(masterGaps([row]).length, 0);
});

test('paper-level details come from the teacher, and the year falls back to the date or the set name; nothing is guessed', () => {
  const [item] = parse([{ ...percentage, test_date: '' }], 'Practice Set 7');
  assert.equal(buildMasterRow(item, { year: '2023', test_date: '2024-01-05' }).year, '2023');
  assert.equal(buildMasterRow(item, { test_date: '2024-01-05' }).year, '2024');
  assert.equal(buildMasterRow(item, { test_date: '2024-01-05' }).test_date, '2024-01-05');
  const unknown = buildMasterRow(item);
  assert.equal(unknown.year, '');
  assert.equal(unknown.exam, '');
  assert.equal(unknown.test_date, '');
  assert.equal(buildMasterRow(item, { exam_category: 'not a category', source_status: 'real pyq' }).exam_category, '');
  assert.equal(buildMasterRow(item, { source_status: 'real pyq' }).source_status, 'REAL_PYQ');
  const gaps = masterGaps([unknown]).map(gap => gap.field);
  for (const field of ['exam_category', 'exam', 'year', 'source_status', 'source_pdf']) assert.ok(gaps.includes(field as never), field);
});

test('values are written in the guide formats', () => {
  assert.equal(normalizeIsoDate('10/09/2024'), '2024-09-10');
  assert.equal(normalizeIsoDate('10 Sep 2024'), '2024-09-10');
  assert.equal(normalizeIsoDate('2024-9-1'), '2024-09-01');
  assert.equal(normalizeIsoDate('N/A'), '');
  assert.equal(normalizeIsoDate('31/02/2024'), '');
  assert.equal(normalizeSourcePages('12, 13'), '12-13');
  assert.equal(normalizeSourcePages('Page 12'), '12');
  assert.equal(normalizeSourcePages('3, 7'), '3, 7');
  assert.equal(normalizeQuestionReference('Q.16'), 'Q16');
  assert.equal(normalizeQuestionReference('Q.164 (Added)'), 'Q.164 (Added)');
  assert.equal(normalizeQuestionReference(''), 'Question number not printed');
  assert.equal(normalizeMasterAnswer('3'), 'C');
  assert.equal(normalizeMasterAnswer('Option b'), 'B');
  assert.equal(normalizeMasterAnswer('["3", 4]'), '["3","4"]');
  assert.equal(normalizeMasterAnswer('{"START":"86","END":"86"}'), '{"start":"86","end":"86"}');
});

test('language, solution, passage, figure and review flags are worked out from the row itself', () => {
  const hindiOnly = { ...percentage, question_en: percentage.question_hi, option1_en: '100', solution_en: '' };
  const [hindi, english, noSolution, multi, numeric] = parse([
    hindiOnly,
    { ...percentage, question_r: 2, question_hi: 'Choose the correct word', question_en: 'Choose the correct word',
      option1_hi: 'go', option1_en: 'go', option2_hi: 'went', option2_en: 'went', option3_hi: 'gone', option3_en: 'gone', option4_hi: 'going', option4_en: 'going', answer: 'B',
      solution_hi: 'The past tense of go is went.', solution_en: 'The past tense of go is went.' },
    // Each question needs its own reference: the parser drops a second question that repeats the first one's page, reference, text and options.
    { ...percentage, question_r: 3, source_question_reference: 'Q.3', solution_hi: '', solution_en: '', manually_review: '' },
    { ...percentage, question_r: 4, source_question_reference: 'Q.4', answer: '["3","4"]' },
    { ...percentage, question_r: 5, source_question_reference: 'Q.5', answer: '{"start":"86","end":"86"}', option1_hi: '', option2_hi: '', option3_hi: '', option4_hi: '',
      option1_en: '', option2_en: '', option3_en: '', option4_en: '' },
  ]);
  assert.equal(buildMasterRow(hindi).language_type, 'hindi_only');
  assert.equal(buildMasterRow(english).language_type, 'english_only');
  const missing = buildMasterRow(noSolution);
  assert.equal(missing.has_solution, '');
  assert.match(missing.quality_issues, /no_solution/);
  assert.equal(missing.manually_review, '', 'a missing solution is for the master step, not a reason to block the row');
  // The parser copies the correct option's text in when the page has no solution; options differ per language here.
  const [capital] = parse([{ ...percentage, question_r: 6, source_question_reference: 'Q.6', question_hi: 'भारत की राजधानी क्या है?', question_en: 'What is the capital of India?',
    option1_hi: 'मुंबई', option2_hi: 'दिल्ली', option3_hi: 'कोलकाता', option4_hi: 'चेन्नई',
    option1_en: 'Mumbai', option2_en: 'Delhi', option3_en: 'Kolkata', option4_en: 'Chennai', answer: 'B', solution_hi: '', solution_en: '' }]);
  assert.deepEqual([capital.solution_hi.includes('दिल्ली'), capital.solution_en.includes('Delhi')], [true, true], 'the parser fills the option text in');
  const copied = buildMasterRow(capital);
  assert.deepEqual([copied.has_solution, copied.has_solution_hi, copied.has_solution_en], ['', '', '']);
  assert.match(copied.quality_issues, /no_solution/);
  const msq = buildMasterRow(multi);
  assert.deepEqual([msq.question_type, msq.answer, msq.answer_letter], ['MSQ', '["3","4"]', '']);
  const nat = buildMasterRow(numeric);
  assert.deepEqual([nat.question_type, nat.answer, nat.option_count, nat.quality_issues.includes('missing_options')], ['NAT', '{"start":"86","end":"86"}', '', false]);
  assert.equal(masterGaps([nat]).some(gap => gap.field.startsWith('option')), false);

  const base = parse([percentage])[0];
  const withImage: MockTestMcqItem = { ...base, question_en: '<p>Find the area.</p><p><img src="https://drive.test/a.png" alt="Question Figure" /></p>', hash_figure: 'https://drive.test/a.png', figure_notes: 'Triangle ABC' };
  const figure = buildMasterRow(withImage);
  assert.equal(figure.has_figure, 'yes');
  assert.equal(figure.figure_notes, 'Triangle ABC https://drive.test/a.png');
  assert.equal(figure.hash_figure, '');
  assert.ok(!figure.quality_issues.includes('figure_missing'));
  const pending = buildMasterRow({ ...base, figures: [{ id: 'figure-0', type: 'image', target: 'question' }] });
  assert.equal(pending.has_figure, 'yes');
  assert.match(pending.quality_issues, /figure_missing/);
  const plain = buildMasterRow({ ...base, figure_notes: 'गद्यांश / Passage: Q.1-5', passageGroupId: 'g1' });
  assert.deepEqual([plain.has_figure, plain.figure_notes, plain.has_passage, plain.passage_hi], ['', '', 'yes', '']);

  const broken = buildMasterRow({ ...base, answer: '' });
  assert.equal(broken.manually_review, 'yes');
  assert.match(broken.quality_issues, /bad_answer_format/);
  assert.equal(buildMasterRow({ ...base, manually_review: 'yes' }).manually_review, 'yes');
  assert.equal(buildMasterRow({ ...base, latex_check: 'yes' }).latex_check, 'YES');
});

test('the Master CSV has 68 columns on every row, even with commas, quotes and line breaks in the text', () => {
  const items = parse([{ ...percentage, question_en: 'Say "hello", then\nstop', solution_en: 'Line one,\nline two' }, { ...percentage, question_r: 17 }]);
  const csv = serializeMasterBankCsv(buildMasterBankRows(items, { exam: 'SSC CGL' }));
  assert.ok(csv.startsWith('﻿' + MASTER_QB_HEADERS.join(',') + '\n'));
  const rows = readCsv(csv);
  assert.equal(rows.length, 3);
  for (const row of rows) assert.equal(row.length, 68);
  assert.equal(rows[1][MASTER_QB_HEADERS.indexOf('exam')], 'SSC CGL');
  assert.equal(rows[2][MASTER_QB_HEADERS.indexOf('question_r')], '17');
  assert.match(rows[1][MASTER_QB_HEADERS.indexOf('question_en')], /Say "hello", then/);
});

test('the source file and the page inside it come from the saved pages, also for a set loaded back from History', () => {
  const pages = [
    { id: 'p1', pageNumber: 1, sourceFile: 'First.pdf', filePage: 1 },
    { id: 'p2', pageNumber: 2, sourceFile: 'First.pdf', filePage: 2 },
    { id: 'p3', pageNumber: 3, sourceFile: 'Second.pdf', filePage: 1 },
    { id: 'p4', pageNumber: 4, sourceFile: 'Second.pdf', filePage: 2 },
    { id: 'p5', pageNumber: 5 }, // pasted text: no file
  ];
  const [one, merged, pasted] = parse([
    { ...percentage, source_pages: '4' },
    { ...percentage, question_r: 2, source_question_reference: 'Q.2', source_pages: '3, 4', question_hi: 'दूसरा प्रश्न', question_en: 'Second question' },
    { ...percentage, question_r: 3, source_question_reference: 'Q.3', source_pages: '5', question_hi: 'तीसरा प्रश्न', question_en: 'Third question' },
  ]);
  const rows = buildMasterBankRows([{ ...one, pageId: 'p4' }, merged, pasted], { exam: 'SSC CGL' }, masterSourceResolver(pages));
  assert.deepEqual(rows.map(row => [row.source_pdf, row.source_pages]), [['Second.pdf', '2'], ['Second.pdf', '1-2'], ['', '5']]);
  assert.deepEqual(rows.map(row => row.source_file), ['Second.pdf', 'Second.pdf', '']);
  // a set saved without pages (an older History entry) still exports; the file and page just stay as the AI reported them
  const old = buildMasterBankRows([one], {}, masterSourceResolver(undefined));
  assert.deepEqual([old[0].source_pdf, old[0].source_pages], ['', '4']);
});

test('extraction prompts ask for the Extractor fields and no longer ask for the reviewer and master fields', () => {
  for (const prompt of [buildMockTestBridgePrompt(), buildMockTestDirectPrompt()]) {
    assert.ok(prompt.includes(MASTER_FIELD_PROMPT_RULES));
    assert.match(prompt, /chapter_name/);
    assert.match(prompt, /sub_topic/);
    assert.ok(!prompt.includes('latex_check ("checked")'));
    assert.ok(!prompt.includes('Unique within this shift'));
  }
  assert.match(buildMockTestBridgePrompt(), /"chapter_name": "\.\.\."/);
});
