import test from 'node:test';
import assert from 'node:assert/strict';
import { fixBilingualOptions, splitBilingualLine, stripOptionLabels } from '../services/bilingualOptions';
import { parseAiOutputToMockTestItems } from '../services/mocktestService';
import { buildMockTestBridgePrompt } from '../services/mocktestService';

const plain = (html?: string) => (html ?? '').replace(/<[^>]+>/g, '').trim();
const hasBoth = (text: string) => /[ऀ-ॿ]/.test(text) && /[A-Za-z]{3,}/.test(text);

// The options of the Assertion-Reason question on page 9 / row 13 of the BPSC TRE history CSV.
const printed = [
  ['(a) both A and R are true and R is the correct explanation of A', 'A और R दोनों सही हैं और R, A का सही विवरण है।'],
  ['(b) both A and R are true but R is not the correct explanation of A', 'A और R दोनों सही हैं लेकिन R, A का सही विवरण नहीं है।'],
  ['(c) A is true but R is false', 'A सही है लेकिन R गलत है।'],
  ['(d) A is false but R is true', 'A गलत है लेकिन R सही है।'],
];

test('an "English / Hindi" line keeps only Hindi in the Hindi option, and the labels go', () => {
  const item = {
    option1_hi: `${printed[0][0]} / ${printed[0][1]}`, option2_hi: `${printed[1][0]} / ${printed[1][1]}`,
    option3_hi: `${printed[2][0]} / ${printed[2][1]}`, option4_hi: `${printed[3][0]} / ${printed[3][1]}`,
    option1_en: printed[0][0], option2_en: printed[1][0], option3_en: printed[2][0], option4_en: printed[3][0],
  };
  const fixed = fixBilingualOptions(item);
  assert.deepEqual([fixed.option1_hi, fixed.option3_hi], [printed[0][1], printed[2][1]]);
  assert.deepEqual([fixed.option2_en, fixed.option4_en], [printed[1][0].slice(4), printed[3][0].slice(4)]);
  for (const n of [1, 2, 3, 4] as const) {
    assert.ok(!hasBoth(fixed[`option${n}_hi`].replace(/\b[A-Z]\b/g, '')), `option${n}_hi must be Hindi only`);
    assert.ok(!/[ऀ-ॿ]/.test(fixed[`option${n}_en`]), `option${n}_en must be English only`);
    assert.ok(!fixed[`option${n}_hi`].includes(' / ') && !/^\(/.test(fixed[`option${n}_en`]));
  }
});

test('through the parser: the Hindi option is cleaned and the question keeps its two languages', () => {
  const [item] = parseAiOutputToMockTestItems('```json\n' + JSON.stringify([{
    question_r: 13, question_hi: 'कथन (A): नियोलिथिक लोग पहाड़ी प्रदेशों से दूर रहते थे।', question_en: 'Assertion (A): The Neolithic people lived away from the hills.',
    option1_hi: `${printed[0][0]} / ${printed[0][1]}`, option2_hi: `${printed[1][0]} / ${printed[1][1]}`,
    option3_hi: `${printed[2][0]} / ${printed[2][1]}`, option4_hi: `${printed[3][0]} / ${printed[3][1]}`,
    option1_en: printed[0][0], option2_en: printed[1][0], option3_en: printed[2][0], option4_en: printed[3][0],
    answer: 'C', solution_hi: 'नवपाषाण लोग केवल पत्थर पर निर्भर नहीं थे।', solution_en: 'The Neolithic people did not depend only on stone.',
  }]) + '\n```', 'History', 1);
  assert.equal(plain(item.option3_hi), printed[2][1]);
  assert.equal(plain(item.option3_en), printed[2][0].replace(/^\(c\)\s*/, ''));
  assert.equal(plain(item.option1_hi), printed[0][1]);
  assert.match(plain(item.question_hi), /नियोलिथिक/);
  assert.match(plain(item.question_en), /Neolithic/);
});

test('Hindi text with a stray English word, and real content, are left alone', () => {
  // row 9 of the same CSV: the source itself writes "but" inside the Hindi option.
  const row9 = { option1_hi: '(a) (A) और (R) दोनों सही हैं', option2_hi: '(b) (A) सही है, (R) गलत है',
    option3_hi: '(c) (A) सही है but (R) गलत है', option4_hi: '(d) (A) गलत है but (R) सही है' };
  const fixed = fixBilingualOptions(row9);
  assert.equal(fixed.option3_hi, '(A) सही है but (R) गलत है');
  assert.equal(fixed.option4_hi, '(A) गलत है but (R) सही है');
  // an unlabelled set whose options happen to begin with "(a)" keeps them
  const statements = ['(a) and (b) only', '(b) and (c) only', '(a) and (c) only', '(a), (b) and (c)'];
  assert.deepEqual(stripOptionLabels(statements), statements);
  const unchanged = { option1_hi: 'आय / व्यय', option2_hi: '60 km / h', option3_hi: 'a / b', option4_hi: '\\(x^2\\) / \\(y^2\\) मीटर', option1_en: 'x', option2_en: 'y' };
  assert.equal(fixBilingualOptions(unchanged), unchanged, 'same object when nothing needs fixing');
  assert.equal(splitBilingualLine('<img src="a.png" /> Delhi / दिल्ली'), null);
});

test('a copy of the combined line in the English field, or both languages in the English field, are fixed too', () => {
  const copied = fixBilingualOptions({ option1_hi: '<p>Delhi / दिल्ली</p>', option1_en: '<p>Delhi / दिल्ली</p>', option2_hi: '<p>Mumbai / मुंबई</p>', option2_en: '' });
  assert.deepEqual([copied.option1_hi, copied.option1_en], ['<p>दिल्ली</p>', '<p>Delhi</p>']);
  assert.deepEqual([copied.option2_hi, copied.option2_en], ['<p>मुंबई</p>', '<p>Mumbai</p>']);
  const english = fixBilingualOptions({ option1_hi: '', option1_en: 'Delhi / दिल्ली' });
  assert.deepEqual([english.option1_hi, english.option1_en], ['दिल्ली', 'Delhi']);
  // an English field that already holds something different is not overwritten
  const different = fixBilingualOptions({ option1_hi: 'Capital city / राजधानी', option1_en: 'The capital' });
  assert.deepEqual([different.option1_hi, different.option1_en], ['राजधानी', 'The capital']);
});

test('the extraction prompt tells the AI to split bilingual lines', () => {
  assert.match(buildMockTestBridgePrompt(), /BILINGUAL LINES ON THE PAGE/);
});
