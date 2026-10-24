import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TARGET_FIELDS, cleanHtml, convertSource, csvString, defaultSettings, editRow, exportAudit, exportReview,
  exportTarget, formulaRisk, latexProblems, mergeContext, parseCsv, parseSettings, readSource, revalidate,
  safeImageUrl, summary,
} from '../services/universalCsv';

function fixture(values: Record<string, string> = {}, count = 1) {
  const source = { Question_EN: 'Which number is greater?', Question_HN: 'कौन सी संख्या बड़ी है?', Option_A_EN: '2', Option_B_EN: '3', Option_A_HN: '2', Option_B_HN: '3', Answer: 'B', Solution_EN: '3 is greater than 2.', Solution_HN: '3, 2 से बड़ा है।', ...values };
  const headers = Object.keys(source);
  return readSource(csvString([headers, ...Array.from({ length: count }, () => Object.values(source))]));
}
function convert(values: Record<string, string> = {}) { const source = fixture(values); const settings = defaultSettings(source.headers); return { source, settings, rows: convertSource(source, settings) }; }
function accept(rows: ReturnType<typeof convertSource>, settings: ReturnType<typeof defaultSettings>) { return revalidate(rows.map(r => ({ ...r, reviewAccepted: true })), settings); }

test('fixed target schema has exactly 34 unique fields in mandated order', () => {
  assert.equal(TARGET_FIELDS.length, 34); assert.equal(new Set(TARGET_FIELDS).size, 34);
  assert.equal(TARGET_FIELDS[0], 'question_r'); assert.equal(TARGET_FIELDS[33], 'duplicate_statistics');
  assert.deepEqual(TARGET_FIELDS.slice(15, 20), ['answer', 'set_name', 'difficulty_level', 'test_date', 'test_time']);
});
test('CSV preserves Hindi, CRLF, quotation marks, commas, trailing blank cells and BOM', () => {
  const records = [['a', 'b', 'c'], ['हिन्दी, "पाठ"\r\nअगली पंक्ति', '$\\frac{a}{b}$', '']];
  assert.deepEqual(parseCsv(csvString(records, true)), records);
});
test('malformed CSV fails clearly and ambiguous headers are rejected', () => {
  assert.throws(() => parseCsv('a,b\n"open,b'), /Unclosed/);
  assert.throws(() => parseCsv('a,b\n"closed"x,b'), /Unexpected/);
  assert.throws(() => readSource('Question_EN,question en\na,b'), /ambiguous/);
});
test('ragged and blank source rows have blocked outcomes and recoverable cells', () => {
  const source = readSource('Question_EN,Answer\nQ,A,EXTRA\n\nOther,B');
  const settings = defaultSettings(source.headers); const rows = convertSource(source, settings);
  assert.equal(rows.length, 3); assert.equal(rows[0].status, 'blocked'); assert.equal(rows[1].status, 'blocked');
  const audit = parseCsv(exportAudit(source, rows, settings));
  assert.deepEqual(JSON.parse(audit[1][3]), ['Q', 'A', 'EXTRA']);
});
test('ALP synthetic 37-row acceptance accounts for all records', () => {
  const source = fixture({ Passage_EN: 'A complete shared story.', Directions_EN: 'Use the story.' }, 37);
  assert.equal(source.format, 'ALP'); const settings = defaultSettings(source.headers);
  const rows = accept(convertSource(source, settings), settings);
  assert.equal(rows.length, 37); assert.equal(summary(rows).ready, 37);
  const output = parseCsv(exportTarget(rows, settings)); assert.equal(output.length, 38);
  assert.ok(output.every(r => r.length === 34));
});
test('GK synthetic 123-row acceptance with 32 source headers maps Option5 independently', () => {
  const base = { Question_EN: 'Question?', Question_HN: 'प्रश्न?', Option1_EN: 'One', Option2_EN: 'Two', Option1_HN: 'एक', Option2_HN: 'दो', Option5_EN: 'Five', Option5_HN: 'पाँच', Answer: '1', Solution_EN: 'Explanation.', Solution_HN: 'समाधान।', TestTitle: 'GK', Section: 'Knowledge', QuestionID: 'Q1' };
  const extra = Object.fromEntries(Array.from({ length: 32 - Object.keys(base).length }, (_, i) => [`Metadata${i}`, `value${i}`]));
  const record = { ...base, ...extra }; const source = readSource(csvString([Object.keys(record), ...Array.from({ length: 123 }, () => Object.values(record))]));
  assert.equal(source.format, 'GK'); assert.equal(source.headers.length, 32);
  const settings = defaultSettings(source.headers); const rows = accept(convertSource(source, settings), settings);
  assert.equal(rows.length, 123); assert.equal(rows[0].target.option5_hi, 'पाँच'); assert.equal(rows[0].target.set_name, 'GK');
  assert.equal(parseCsv(exportTarget(rows, settings)).length, 124);
});
test('passage and directions precede question; no nested paragraphs', () => {
  const { rows } = convert({ Passage_EN: '<p>Story</p>', Directions_EN: 'Directions', Passage_HN: 'गद्यांश' });
  const q = rows[0].target.question_en;
  assert.ok(q.indexOf('Story') < q.indexOf('Directions')); assert.ok(q.indexOf('Directions') < q.indexOf('Which'));
  assert.ok(!q.includes('<p><p>')); assert.ok(rows[0].target.question_hi.includes('गद्यांश'));
});
test('question-only content remains unchanged; existing normalized passage is not repeated', () => {
  const settings = defaultSettings();
  assert.equal(mergeContext('Question\ntext', '', '', 'en', settings), 'Question\ntext');
  assert.equal(mergeContext('<p>Story here</p><p>Question?</p>', 'Story  here', '', 'en', settings), '<p>Story here</p><p>Question?</p>');
  assert.match(mergeContext('Q', '', 'Generic direction', 'en', settings), /Generic direction/);
  settings.omitDirections = ['Generic direction']; assert.equal(mergeContext('Q', '', 'Generic direction', 'en', settings), 'Q');
});
test('explicit IDs propagate context but adjacency never does', () => {
  const source = readSource('Question_EN,Passage_EN,PassageID\nQ1,Story,G1\nQ2,,G1\nQ3,,');
  const rows = convertSource(source, defaultSettings(source.headers));
  assert.match(rows[1].target.question_en, /Story/); assert.equal(rows[2].target.question_en, 'Q3');
});
test('conflicting shared IDs block affected rows', () => {
  const source = readSource('Question_EN,Passage_EN,PassageID\nQ1,Story 1,G1\nQ2,Story 2,G1');
  const rows = convertSource(source, defaultSettings(source.headers));
  assert.ok(rows.every(r => r.issues.some(i => i.code === 'passage_conflict')));
});
test('sixth option including image-only is blocked until explicit resolution; audit retains all options', () => {
  const { source, settings, rows } = convert({ Option6_EN: 'Six', Option6_Image: 'https://example.com/six.png' });
  assert.equal(rows[0].status, 'blocked'); assert.equal(parseCsv(exportTarget(accept(rows, settings), settings)).length, 1);
  assert.match(exportAudit(source, rows, settings), /Six/);
  const resolved = revalidate(rows.map(r => ({ ...r, resolution: 'Source had an extraneous duplicate sixth option; five options verified.' })), settings);
  assert.ok(!resolved[0].issues.some(i => i.code === 'sixth_option'));
});
test('ambiguous Option_E is held for review; neutral option is copied', () => {
  assert.ok(convert({ Option_E: 'None of the above' }).rows[0].issues.some(i => i.code === 'option_e_language'));
  assert.equal(convert({ Option_E: '42' }).rows[0].target.option5_hi, '42');
});
test('question, option 3 and solution images remain in their correct fields', () => {
  const { rows } = convert({ ImageUrl: 'https://example.com/q.png', Option3_Image: 'https://example.com/o.png', Solution_Image_URL: 'https://example.com/s.png' });
  assert.match(rows[0].target.question_en, /q\.png/); assert.doesNotMatch(rows[0].target.question_en, /o\.png|s\.png/);
  assert.match(rows[0].target.option3_hi, /o\.png/); assert.match(rows[0].target.solution_en, /s\.png/);
});
test('unsafe URLs and HTML cannot be rendered or exported as ready', () => {
  assert.equal(safeImageUrl('javascript:alert(1)'), false); assert.equal(safeImageUrl('//example.com/q.png'), false);
  assert.equal(safeImageUrl('https://example.com/q.png', ['other.example']), false);
  assert.equal(safeImageUrl('https://user:password@example.com/q.png'), false);
  assert.doesNotMatch(cleanHtml('<script>alert(1)</script><img src="javascript:x" onerror="alert(1)"><p onclick="x">safe</p>'), /script|onerror|onclick|javascript/);
  assert.equal(convert({ ImageUrl: 'http://example.com/insecure.png' }).rows[0].status, 'blocked');
});
test('unsupported image and table profiles block affected rows', () => {
  const source = fixture({ Question_EN: '<table><tr><td>Data</td></tr></table>', ImageUrl: 'https://example.com/a.png' });
  const settings = { ...defaultSettings(source.headers), supportsImages: false, supportsTables: false };
  const rows = convertSource(source, settings); assert.equal(rows[0].status, 'blocked');
  assert.ok(rows[0].issues.some(i => i.code === 'html_table')); assert.ok(rows[0].issues.some(i => i.code === 'image_unrepresented'));
});
test('answer conversion is opt-in and validates the populated option', () => {
  const { source, settings, rows } = convert(); assert.equal(rows[0].target.answer, 'B');
  assert.equal(convertSource(source, { ...settings, answerFormat: 'numbers' })[0].target.answer, '2');
  assert.equal(convert({ Answer: 'F' }).rows[0].status, 'blocked'); assert.equal(convert({ Answer: 'E' }).rows[0].status, 'blocked');
  assert.equal(convert({ Answer: '' }).rows[0].status, 'blocked');
});
test('empty solutions and references/mismatches are reported without fabricated content', () => {
  const { rows } = convert({ Solution_EN: '<p><br></p>', Solution_HN: '' });
  assert.ok(rows[0].issues.some(i => i.code === 'solution_missing'));
  assert.ok(convert({ Solution_EN: 'The correct answer is A. See previous question.' }).rows[0].issues.some(i => i.code === 'solution_mismatch'));
});
test('LaTeX is preserved and dollar currency is not treated as an unclosed equation', () => {
  assert.deepEqual(latexProblems('Costs $5 and $10. Also $20.'), []);
  assert.deepEqual(latexProblems('$x^2 + y^2$ and $\\frac{a}{b}$'), []);
  assert.ok(latexProblems('$\\frac{a}{$').length > 0);
  assert.ok(latexProblems('Find $x^2').length > 0);
  assert.equal(convert({ Question_EN: '$\\sqrt{x}$' }).rows[0].target.question_en, '$\\sqrt{x}$');
});
test('no invented metadata or default quality vocabulary; explicitly configured values are supported', () => {
  const { source, settings, rows } = convert();
  for (const field of ['question_r', 'test_date', 'source_pages', 'difficulty_level', 'hash_figure', 'answer_check']) assert.equal(rows[0].target[field], '');
  const configured = convertSource(source, { ...settings, qualityValues: { ...settings.qualityValues, PASS: 'approved' } });
  assert.equal(configured[0].target.answer_check, 'approved');
});
test('duplicates retain all rows; exclusion is explicit and export recalculates readiness', () => {
  const source = fixture({}, 2), settings = defaultSettings(source.headers); const rows = convertSource(source, settings);
  assert.equal(summary(rows).duplicates, 2); assert.equal(summary(rows).review, 2);
  const accepted = accept(rows, settings); assert.equal(parseCsv(exportTarget(accepted, settings)).length, 3);
  accepted[1].excluded = true; assert.equal(parseCsv(exportTarget(accepted, settings)).length, 2);
});
test('manual edits revalidate, revoke review acceptance, and preserve original audit', () => {
  const { source, settings, rows } = convert();
  const edited = editRow(accept(rows, settings), 2, 'answer', 'F', settings);
  assert.equal(edited[0].status, 'blocked'); assert.equal(edited[0].source.values.Answer, 'B');
  assert.equal(edited[0].edits[0].before, 'B'); assert.match(exportAudit(source, edited, settings), /answer/);
});
test('formula protection preserves signed numbers, blocks formulas, and audits opt-in prefixes', () => {
  assert.equal(formulaRisk('-3'), false); assert.equal(formulaRisk('=SUM(1,2)'), true); assert.equal(formulaRisk('\t=1+1'), true);
  const { source, settings, rows } = convert({ Question_EN: '=HYPERLINK("https://bad.example")' });
  assert.equal(rows[0].status, 'blocked');
  const prefix = { ...settings, formulaPolicy: 'prefix' as const };
  const ready = accept(convertSource(source, prefix), prefix); const output = parseCsv(exportTarget(ready, prefix));
  assert.equal(output[1][8][0], "'"); assert.match(exportAudit(source, ready, prefix), /question_en/);
});
test('all five output artifacts support recoverable source data and 34-column target roundtrip', () => {
  const { source, settings, rows } = convert({ Marks: '4', Question_EN: 'Question, "quoted"\nSecond line' });
  const output = exportTarget(accept(rows, settings), settings); const parsed = parseCsv(output);
  assert.deepEqual(parsed[0], [...TARGET_FIELDS]); assert.equal(parsed[1][8], 'Question, "quoted"\nSecond line');
  const audit = parseCsv(exportAudit(source, rows, settings)); assert.deepEqual(JSON.parse(audit[1][3]), source.rows[0].cells);
  assert.equal(JSON.parse(audit[1][4]).Marks, '4'); assert.equal(parseCsv(exportReview(rows)).length, 1);
  assert.deepEqual(parseSettings(JSON.stringify(settings), source.headers), settings);
});
test('presets reject unknown columns, malformed settings and unsupported versions', () => {
  const settings = defaultSettings(['Question_EN']);
  assert.throws(() => parseSettings(JSON.stringify({ ...settings, version: 9 }), ['Question_EN']));
  assert.throws(() => parseSettings(JSON.stringify({ ...settings, answerFormat: 'random' }), ['Question_EN']));
  assert.throws(() => parseSettings(JSON.stringify({ ...settings, mapping: { answer: 'absent' } }), ['Question_EN']));
});
test('identical input and settings produce identical conversion and export', () => {
  const { source, settings } = convert({ Passage_EN: 'Story' });
  assert.deepEqual(convertSource(source, settings), convertSource(source, settings));
  assert.equal(exportTarget(accept(convertSource(source, settings), settings), settings), exportTarget(accept(convertSource(source, settings), settings), settings));
});
test('unmapping a known sixth option cannot bypass incompatibility checks', () => {
  const { source, settings } = convert({ Option6_EN: 'Sixth' }); settings.mapping.option6_en = '';
  assert.ok(convertSource(source, settings)[0].issues.some(i => i.code === 'sixth_option'));
});
test('partially removed image collections are blocked even if one safe image survives', () => {
  const { rows } = convert({ Question_EN: '<p>Q?</p><img src="https://example.com/ok.png"><img src="javascript:alert(1)">' });
  assert.equal(rows[0].status, 'blocked'); assert.ok(rows[0].issues.some(i => i.code === 'image_removed'));
});
test('a passage fragment matching part of a word is not discarded', () => {
  assert.match(mergeContext('The earth is round.', 'art', '', 'en', defaultSettings()), /<p>art<\/p>/);
});
test('passages cannot turn a missing question stem into an import-ready record', () => {
  const { rows } = convert({ Question_EN: '', Question_HN: '', Passage_EN: 'Story without a question.' });
  assert.equal(rows[0].status, 'blocked'); assert.ok(rows[0].issues.some(i => i.code === 'missing_stem'));
});
