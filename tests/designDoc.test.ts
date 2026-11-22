import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  elementsToDesignDoc, applyDesignOps, outlineForAi, autoPaginate, allBlocks, sanitizeStyle, tint, PRESET_THEMES,
  emphasizeText, stripHighlight, splitBlockText, planOverflowFix, fullTextChunks, emphasisToLinks, balanceStars, plainText,
} from '../services/designDoc.ts';
import type { ExtractedElement } from '../types.ts';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const sample: ExtractedElement[] = [
  { id: 'e1', type: 'text', content: '## Chapter 1\n\nQ1. What is 2 + 2?\n(a) 3\n(b) 4\nAnswer: b\n\nSome closing paragraph\nthat continues here.' },
  { id: 'e2', type: 'image', imageB64: PNG },
  { id: 'e3', type: 'text', content: '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n2. Second question with $x^2$?\n(a) yes\n(b) no' },
];
const build = () => elementsToDesignDoc(sample, 'Test');

describe('elementsToDesignDoc', () => {
  it('splits text into typed blocks', () => {
    const types = allBlocks(build()).map(b => b.type);
    assert.deepEqual(types, ['heading', 'question', 'option', 'option', 'answer', 'paragraph', 'image', 'table', 'question', 'option', 'option']);
  });

  it('joins continuation lines and keeps table rows together', () => {
    const blocks = allBlocks(build());
    assert.equal(blocks.find(b => b.type === 'paragraph')!.text, 'Some closing paragraph\nthat continues here.');
    assert.equal(blocks.find(b => b.type === 'table')!.text!.split('\n').length, 3);
  });

  it('stores images as assets with short unique ids', () => {
    const doc = build();
    const image = allBlocks(doc).find(b => b.type === 'image')!;
    assert.ok(doc.assets[image.assetId!].startsWith('data:image/png;base64,'));
    const ids = allBlocks(doc).map(b => b.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('outlineForAi', () => {
  it('never includes image data and truncates long text', () => {
    const doc = elementsToDesignDoc([{ id: 'x', type: 'text', content: 'word '.repeat(200) }, ...sample], 'T');
    const json = JSON.stringify(outlineForAi(doc));
    assert.ok(!json.includes(PNG));
    assert.ok(json.includes('…'));
    assert.ok(json.length < 2500);
  });
});

describe('applyDesignOps', () => {
  it('styles every block of a type', () => {
    const { doc, applied } = applyDesignOps(build(), [{ op: 'styleBlocks', type: 'question', style: { color: '#1d4ed8', border: 'box' } }]);
    assert.equal(applied, 1);
    for (const q of allBlocks(doc).filter(b => b.type === 'question')) assert.deepEqual(q.style, { color: '#1D4ED8', border: 'box' });
  });

  it('skips invalid colours, unknown ids and unknown ops without throwing', () => {
    const before = build();
    const { doc, applied, skipped } = applyDesignOps(before, [
      { op: 'styleBlocks', type: 'question', style: { color: 'red; background:url(x)' } },
      { op: 'removeBlock', id: 'nope' },
      { op: 'deleteEverything' },
      'garbage',
      { op: 'insertBlock', block: { type: 'image', text: 'x' } },
    ]);
    assert.equal(applied, 0);
    assert.equal(skipped, 5);
    assert.equal(doc, before);
  });

  it('does not mutate the input document (so Undo can keep the old one)', () => {
    const before = build();
    const snapshot = JSON.stringify(before);
    applyDesignOps(before, [{ op: 'setTheme', patch: { primary: '#ff0000' } }, { op: 'removeBlock', id: allBlocks(before)[0].id }]);
    assert.equal(JSON.stringify(before), snapshot);
  });

  it('sanitizes theme patches', () => {
    const { doc } = applyDesignOps(build(), [{ op: 'setTheme', patch: { primary: '#f00', baseSize: 99, font: 'wingdings', optionColumns: 2 } }]);
    assert.equal(doc.theme.primary, '#FF0000');
    assert.equal(doc.theme.baseSize, 18);
    assert.equal(doc.theme.font, 'sans');
    assert.equal(doc.theme.optionColumns, 2);
  });

  it('paginate splits at the named blocks and keeps every block', () => {
    const doc0 = build();
    const questions = allBlocks(doc0).filter(b => b.type === 'question');
    const { doc } = applyDesignOps(doc0, [{ op: 'paginate', breaks: [{ beforeBlockId: questions[1].id, title: 'Question 2' }, { beforeBlockId: 'missing' }] }]);
    assert.equal(doc.pages.length, 2);
    assert.equal(doc.pages[1].title, 'Question 2');
    assert.equal(doc.pages[1].blocks[0].id, questions[1].id);
    assert.equal(allBlocks(doc).length, allBlocks(doc0).length);
  });

  it('updateBlock changes text but cannot turn a block into an image', () => {
    const doc0 = build();
    const q = allBlocks(doc0).find(b => b.type === 'question')!;
    const { doc } = applyDesignOps(doc0, [{ op: 'updateBlock', id: q.id, text: 'Q1. New?', type: 'image' }]);
    const updated = allBlocks(doc).find(b => b.id === q.id)!;
    assert.equal(updated.text, 'Q1. New?');
    assert.equal(updated.type, 'question');
  });
});

describe('autoPaginate', () => {
  it('puts each question with its options on its own slide', () => {
    const doc = autoPaginate(build());
    assert.equal(doc.pages.length, 3);                       // heading+Q1 group, paragraph/image/table, Q2 group
    assert.equal(doc.pages[0].blocks[0].type, 'heading');
    assert.equal(doc.pages[0].blocks[1].type, 'question');
    assert.equal(doc.pages[2].blocks[0].type, 'question');
  });
});

describe('emphasize (bold / highlight without rewriting)', () => {
  const doc0 = elementsToDesignDoc([{ id: 't', type: 'text', content: 'भौतिक परिवर्तन में कोई नया पदार्थ नहीं बनता, जैसे $H_2O$ का जमना। भौतिक परिवर्तन उत्क्रमणीय है।' }], 'T');
  const id = allBlocks(doc0)[0].id;

  it('wraps every occurrence and leaves the other characters untouched', () => {
    const { doc, applied } = applyDesignOps(doc0, [{ op: 'emphasize', id, phrases: ['भौतिक परिवर्तन'], mark: 'both' }]);
    assert.equal(applied, 1);
    const text = allBlocks(doc)[0].text!;
    assert.equal(text.split('==**भौतिक परिवर्तन**==').length - 1, 2);
    assert.equal(stripHighlight(text).replace(/\*\*/g, ''), allBlocks(doc0)[0].text);
  });

  it('never marks inside math or inside an existing mark, and skips phrases that are not there', () => {
    const once = emphasizeText('Water is $H_2O$ and **H** is hydrogen', ['H'], 'highlight');
    assert.equal(once.text, 'Water is $H_2O$ and **H** is hydrogen');
    assert.equal(once.count, 0);
    assert.equal(applyDesignOps(doc0, [{ op: 'emphasize', id, phrases: ['not in the text'] }]).applied, 0);
  });

  it('extends a match to the end of the word so a Hindi vowel sign is never cut off', () => {
    assert.equal(emphasizeText('कुछ परिवर्तनों का वर्णन', ['परिवर्तन'], 'both').text, 'कुछ ==**परिवर्तनों**== का वर्णन');
    assert.equal(emphasizeText('जल बन गया है।', ['जल बन गया'], 'bold').text, '**जल बन गया** है।');
  });

  it('applying the same emphasis twice does not nest the markers', () => {
    const first = emphasizeText('key term here', ['key term'], 'bold').text;
    assert.equal(emphasizeText(first, ['key term'], 'bold').text, '**key term** here');
  });
});

describe('no stray stars on a page', () => {
  it('turns bold and highlight into links, whatever touches them', () => {
    assert.equal(emphasisToLinks('**•**कागज के **परिवर्तन**ों'), '[•](#b)कागज के [परिवर्तन](#b)ों');
    assert.equal(emphasisToLinks('यह ==**भौतिक परिवर्तन**== है और ==जल== भी'), 'यह [भौतिक परिवर्तन](#hlb) है और [जल](#hl) भी');
  });

  it('drops markers that have no partner and never touches math', () => {
    assert.equal(emphasisToLinks('half **open and $a**b$ and == alone'), 'half open and $a**b$ and  alone');
    assert.equal(emphasisToLinks('* list item with *italic*'), '* list item with *italic*');
  });

  it('balanceStars keeps pairs and removes a lone marker for the Word export', () => {
    assert.equal(balanceStars('**ok** and ** stray'), '**ok** and  stray');
    assert.equal(plainText('==**x**== y'), 'x y');
  });
});

describe('fitting slides', () => {
  it('splits a table by rows and repeats its header', () => {
    const halves = splitBlockText({ id: 'x', type: 'table', text: '| A | B |\n| --- | --- |\n| 1 | a |\n| 2 | b |\n| 3 | c |\n| 4 | d |' })!;
    assert.equal(halves[0], '| A | B |\n| --- | --- |\n| 1 | a |\n| 2 | b |');
    assert.equal(halves[1], '| A | B |\n| --- | --- |\n| 3 | c |\n| 4 | d |');
  });

  it('splits a long paragraph at a sentence end and keeps every word', () => {
    const text = 'पहला वाक्य यहाँ है। दूसरा वाक्य भी है। तीसरा वाक्य अंत में है।';
    const halves = splitBlockText({ id: 'x', type: 'paragraph', text })!;
    assert.equal(halves.join(' '), text);
    assert.ok(halves[0].endsWith('।'));
  });

  it('cannot split a heading or a one-sentence paragraph', () => {
    assert.equal(splitBlockText({ id: 'x', type: 'heading', text: 'A. B. C.' }), null);
    assert.equal(splitBlockText({ id: 'x', type: 'paragraph', text: 'single sentence without an end' }), null);
  });

  it('splitBlock op puts the second half right after the first', () => {
    const doc0 = elementsToDesignDoc([{ id: 't', type: 'text', content: 'One. Two. Three. Four.' }], 'T');
    const { doc } = applyDesignOps(doc0, [{ op: 'splitBlock', id: allBlocks(doc0)[0].id }]);
    assert.deepEqual(allBlocks(doc).map(b => b.text), ['One. Two.', 'Three. Four.']);
  });

  const page = (types: string[]) => ({ id: 'p', blocks: types.map((type, i) => ({ id: 'b' + i, type: type as any, text: 'One. Two.' })) });
  const bottoms = (...values: number[]) => Object.fromEntries(values.map((v, i) => ['b' + i, v]));

  it('moves the blocks that do not fit to a new slide', () => {
    assert.deepEqual(planOverflowFix(page(['paragraph', 'paragraph', 'paragraph']), bottoms(0.4, 0.8, 1.3), 130), { kind: 'break', beforeBlockId: 'b2' });
  });

  it('keeps a question with its options and a heading with what follows', () => {
    assert.deepEqual(planOverflowFix(page(['paragraph', 'question', 'option', 'option']), bottoms(0.5, 0.8, 0.95, 1.1), 110), { kind: 'break', beforeBlockId: 'b1' });
    assert.deepEqual(planOverflowFix(page(['paragraph', 'paragraph', 'heading', 'paragraph']), bottoms(0.3, 0.6, 0.8, 1.2), 120), { kind: 'break', beforeBlockId: 'b2' });
  });

  it('splits a single oversized block, and shrinks only when it cannot be split', () => {
    assert.deepEqual(planOverflowFix(page(['paragraph']), bottoms(1.5), 150), { kind: 'split', blockId: 'b0' });
    const fix = planOverflowFix({ id: 'p', blocks: [{ id: 'b0', type: 'heading', text: 'Huge' }] }, bottoms(1.25), 125);
    assert.equal(fix?.kind, 'scale');
    assert.ok(fix?.kind === 'scale' && fix.scale < 0.8 && fix.scale >= 0.55);
  });

  it('does nothing for a slide that fits', () => {
    assert.equal(planOverflowFix(page(['paragraph']), bottoms(0.6), 60), null);
  });
});

describe('fullTextChunks', () => {
  it('covers every block exactly once, in order, within the size limit', () => {
    const doc = elementsToDesignDoc([{ id: 't', type: 'text', content: Array.from({ length: 30 }, (_, i) => `Paragraph number ${i} ` + 'x'.repeat(300)).join('\n\n') }], 'T');
    const chunks = fullTextChunks(doc, 2000);
    assert.ok(chunks.length > 3);
    assert.deepEqual(chunks.flat(), allBlocks(doc).map(b => b.id));
    const full = JSON.stringify(outlineForAi(doc, { blockIds: chunks[0], fullText: true }));
    assert.ok(full.length < 3500 && !full.includes('…'));
  });
});

describe('helpers', () => {
  it('sanitizeStyle drops unknown keys', () => {
    assert.deepEqual(sanitizeStyle({ color: '#ABCDEF', position: 'fixed', size: 'huge', bold: true }), { color: '#ABCDEF', bold: true });
  });
  it('tint lightens toward white', () => {
    assert.equal(tint('#000000', 1), '#FFFFFF');
    assert.equal(tint('#1D4ED8', 0), '#1D4ED8');
  });
  it('ships six preset themes with valid colours', () => {
    assert.equal(PRESET_THEMES.length, 6);
    for (const t of PRESET_THEMES) assert.match(t.primary, /^#[0-9A-F]{6}$/);
  });
});
