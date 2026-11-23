import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  elementsToDesignDoc, applyDesignOps, outlineForAi, autoPaginate, allBlocks, sanitizeStyle, tint, PRESET_THEMES,
  emphasizeText, stripHighlight, splitBlockText, planOverflowFix, fullTextChunks, emphasisToLinks, balanceStars, plainText,
  resolveStyle, styleKey, elementCounts, contrast, readableOn, highlightSegments, markSelection, unemphasizeText, calloutInfo, HIGHLIGHTERS, optionColumnsOf, splitOptionText, combinedOptionCount, optionsFromTable,
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
  it('styling "every block of a type" becomes a group style, so it also covers blocks added later', () => {
    const { doc, applied } = applyDesignOps(build(), [{ op: 'styleBlocks', type: 'question', style: { color: '#1d4ed8', border: 'box' } }]);
    assert.equal(applied, 1);
    assert.deepEqual(doc.theme.styles?.question, { color: '#1D4ED8', border: 'box' });
    for (const q of allBlocks(doc).filter(b => b.type === 'question')) {
      assert.equal(q.style, undefined);
      assert.equal(resolveStyle(doc.theme, q).color, '#1D4ED8');
    }
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
  it('every preset theme has valid colours and readable text, also the dark ones', () => {
    assert.equal(PRESET_THEMES.length, 12);
    for (const t of PRESET_THEMES) {
      assert.match(t.primary, /^#[0-9A-F]{6}$/);
      for (const type of ['heading', 'paragraph', 'question', 'answer', 'callout'] as const) {
        const st = resolveStyle(t, { type, level: 1 });
        assert.ok(contrast(st.color, st.background || t.pageBackground) >= 2.5, `${t.name}: ${type} is hard to read`);
      }
    }
  });
});

describe('element styles (all H2, all questions…)', () => {
  const withHeadings = () => elementsToDesignDoc([{ id: 't', type: 'text', content: '## Chapter\n\nIntro text.\n\n### Section A\n\nBody A.\n\n### Section B\n\nBody B.' }], 'T');

  it('one operation restyles every element of a kind and clears single-block overrides', () => {
    let doc = withHeadings();
    const h2s = allBlocks(doc).filter(b => styleKey(b) === 'h2');
    assert.equal(h2s.length, 2);
    doc = applyDesignOps(doc, [{ op: 'styleBlocks', ids: [h2s[0].id], style: { color: '#FF0000', bold: false } }]).doc;
    doc = applyDesignOps(doc, [{ op: 'setElementStyle', target: 'h2', style: { color: '#16a34a', underline: true } }]).doc;
    for (const b of allBlocks(doc).filter(x => styleKey(x) === 'h2')) {
      const st = resolveStyle(doc.theme, b);
      assert.equal(st.color, '#16A34A');
      assert.equal(st.underline, true);
    }
    assert.deepEqual(allBlocks(doc).find(b => b.id === h2s[0].id)!.style, { bold: false });   // its other override survives
    assert.notEqual(resolveStyle(doc.theme, allBlocks(doc).find(b => styleKey(b) === 'h1')!).color, '#16A34A');
  });

  it('a block keeps its own style on top of the group style, and reset brings the theme look back', () => {
    let doc = applyDesignOps(withHeadings(), [{ op: 'setElementStyle', target: 'paragraph', style: { size: 'lg', font: 'kokila' } }]).doc;
    const p = allBlocks(doc).find(b => b.type === 'paragraph')!;
    doc = applyDesignOps(doc, [{ op: 'styleBlocks', ids: [p.id], style: { color: '#123456' } }]).doc;
    const st = resolveStyle(doc.theme, allBlocks(doc).find(b => b.id === p.id)!);
    assert.equal(st.color, '#123456');
    assert.equal(st.font, 'kokila');
    assert.equal(st.sizePt, doc.theme.baseSize * 1.25);
    doc = applyDesignOps(doc, [{ op: 'setElementStyle', target: 'paragraph', reset: true }]).doc;
    assert.equal(doc.theme.styles?.paragraph, undefined);
  });

  it('unset removes one property; unknown targets are skipped', () => {
    let doc = applyDesignOps(withHeadings(), [{ op: 'setElementStyle', target: 'h1', style: { color: '#111111', align: 'center' } }]).doc;
    doc = applyDesignOps(doc, [{ op: 'setElementStyle', target: 'h1', unset: ['color'] }]).doc;
    assert.deepEqual(doc.theme.styles?.h1, { align: 'center' });
    assert.equal(applyDesignOps(doc, [{ op: 'setElementStyle', target: 'h9', style: { color: '#111111' } }]).applied, 0);
  });

  it('options layout: "every option" overrides the theme, and unset / reset fall back to it', () => {
    let doc = applyDesignOps(withHeadings(), [{ op: 'setTheme', patch: { optionColumns: 2 } }]).doc;
    assert.equal(optionColumnsOf(doc.theme), 2);                                   // nothing set: the theme decides, as before
    doc = applyDesignOps(doc, [{ op: 'setElementStyle', target: 'option', style: { columns: 4, bold: true } }]).doc;
    assert.equal(optionColumnsOf(doc.theme), 4);
    assert.equal(doc.theme.optionColumns, 2);
    doc = applyDesignOps(doc, [{ op: 'setElementStyle', target: 'option', unset: ['columns'] }]).doc;
    assert.equal(optionColumnsOf(doc.theme), 2);
    assert.deepEqual(doc.theme.styles?.option, { bold: true });
    doc = applyDesignOps(doc, [{ op: 'setElementStyle', target: 'option', style: { columns: 1 } }, { op: 'setElementStyle', target: 'option', reset: true }]).doc;
    assert.equal(optionColumnsOf(doc.theme), 2);
    assert.deepEqual(sanitizeStyle({ columns: 3 }), {});
    assert.deepEqual(sanitizeStyle({ columns: '2' }), { columns: 2 });
  });

  it('splits a line that holds several options, in Hindi and English, and leaves single options alone', () => {
    assert.deepEqual(splitOptionText('(A) हिगेल (B) कार्ल मार्क्स'), ['(A) हिगेल', '(B) कार्ल मार्क्स']);
    assert.deepEqual(splitOptionText('(a) Paris  (b) Rome (c) Berlin (d) None of these'), ['(a) Paris', '(b) Rome', '(c) Berlin', '(d) None of these']);
    assert.deepEqual(splitOptionText('(क) गंगा (ख) यमुना'), ['(क) गंगा', '(ख) यमुना']);
    assert.deepEqual(splitOptionText('1. 2.5 kg 2. 3 kg'), ['1. 2.5 kg', '2. 3 kg']);
    assert.deepEqual(splitOptionText('A) x B) y'), ['A) x', 'B) y']);
    assert.deepEqual(splitOptionText('(C) $f(x) = (D) + 1$ only (D) both'), ['(C) $f(x) = (D) + 1$ only', '(D) both']);
    assert.equal(splitOptionText('(A) only one option (see part (C) above)'), null);       // (C) is not the next label
    assert.equal(splitOptionText('(A) **bold (B) run** across'), null);                    // would tear the bold in half
    assert.equal(splitOptionText('A plain sentence.'), null);
  });

  it('setOptionsLayout separates combined options and sets the layout; a repeat is not counted as a change', () => {
    let doc = elementsToDesignDoc([{ type: 'text', content: 'Q1. किसने कहा?\n(A) हिगेल (B) कार्ल मार्क्स\n(C) मार्टिन लूथर (D) इनमें से सभी' } as ExtractedElement], 't');
    assert.deepEqual(allBlocks(doc).filter(b => b.type === 'option').map(b => b.text), ['(A) हिगेल', '(B) कार्ल मार्क्स', '(C) मार्टिन लूथर', '(D) इनमें से सभी']);   // new imports

    // A document saved before this: two options per block, with its own style.
    const page = doc.pages[0];
    doc = { ...doc, pages: [{ ...page, blocks: [page.blocks[0],
      { id: 'x1', type: 'option', text: '(A) हिगेल (B) कार्ल मार्क्स', style: { bold: true } },
      { id: 'x2', type: 'option', text: '(C) मार्टिन लूथर (D) इनमें से सभी' }] }] };
    assert.equal(combinedOptionCount(doc), 2);
    doc = applyDesignOps(doc, [{ op: 'setElementStyle', target: 'option', style: { columns: 4 } }]).doc;
    const result = applyDesignOps(doc, [{ op: 'setOptionsLayout', columns: 2 }]);
    doc = result.doc;
    assert.equal(result.applied, 1);
    const options = allBlocks(doc).filter(b => b.type === 'option');
    assert.deepEqual(options.map(b => b.text), ['(A) हिगेल', '(B) कार्ल मार्क्स', '(C) मार्टिन लूथर', '(D) इनमें से सभी']);
    assert.deepEqual(options.map(b => b.style), [{ bold: true }, { bold: true }, undefined, undefined]);
    assert.equal(new Set(allBlocks(doc).map(b => b.id)).size, allBlocks(doc).length);
    assert.equal(optionColumnsOf(doc.theme), 2);                                   // the "every option" override no longer hides it
    assert.equal(combinedOptionCount(doc), 0);

    const again = applyDesignOps(doc, [{ op: 'setOptionsLayout', columns: 2 }, { op: 'setTheme', patch: { spacing: doc.theme.spacing || 'normal' } }]);
    assert.deepEqual([again.applied, again.unchanged, again.skipped], [0, 2, 0]);
    assert.equal(again.doc, doc);
    assert.equal(applyDesignOps(doc, [{ op: 'setOptionsLayout', columns: 3 }]).skipped, 1);
  });

  it('a table that is really a grid of options becomes option blocks; real tables stay', () => {
    const grid = '| (A) फ्रांस (B) जर्मनी | (C) तुर्की (D) यूनान |  |  |\n| --- | --- | --- | --- |';
    assert.deepEqual(optionsFromTable(grid), ['(A) फ्रांस', '(B) जर्मनी', '(C) तुर्की', '(D) यूनान']);
    assert.deepEqual(optionsFromTable('| **(A) France** | (B) Germany |\n| --- | --- |\n| (C) Turkey | (D) Greece |'), ['(A) France', '(B) Germany', '(C) Turkey', '(D) Greece']);
    assert.equal(optionsFromTable('| Column I | Column II |\n| --- | --- |\n| (a) Delhi | (1) India |'), null);
    assert.equal(optionsFromTable('| (a) Delhi | (1) India |\n| --- | --- |\n| (b) Paris | (2) France |'), null);   // match the columns
    assert.equal(optionsFromTable('| (B) x | (C) y |'), null);                                                    // does not start at A

    let doc = elementsToDesignDoc([{ type: 'text', content: 'Q1. Who?' } as ExtractedElement], 't');
    const page = doc.pages[0];
    doc = { ...doc, pages: [{ ...page, blocks: [...page.blocks, { id: 't1', type: 'table', text: grid }, { id: 't2', type: 'table', text: '| Name | Age |\n| --- | --- |\n| A | 1 |' }] }] };
    assert.equal(combinedOptionCount(doc), 1);
    const result = applyDesignOps(doc, [{ op: 'setOptionsLayout', columns: 2 }]);
    assert.equal(result.applied, 1);
    assert.deepEqual(allBlocks(result.doc).map(b => b.type), ['question', 'option', 'option', 'option', 'option', 'table']);
    assert.equal(allBlocks(result.doc)[1].id, 't1');
    assert.equal(combinedOptionCount(result.doc), 0);
  });

  it('counts elements by kind and relabels a block', () => {
    let doc = withHeadings();
    assert.deepEqual(elementCounts(doc), { h1: 1, h2: 2, paragraph: 3, footer: 1 });
    const p = allBlocks(doc).find(b => b.type === 'paragraph')!;
    doc = applyDesignOps(doc, [{ op: 'updateBlock', id: p.id, type: 'callout', variant: 'remember' }]).doc;
    const box = allBlocks(doc).find(b => b.id === p.id)!;
    assert.equal(box.variant, 'remember');
    doc = applyDesignOps(doc, [{ op: 'updateBlock', id: p.id, type: 'heading', level: 3 }]).doc;
    assert.deepEqual([allBlocks(doc).find(b => b.id === p.id)!.variant, allBlocks(doc).find(b => b.id === p.id)!.level], [undefined, 3]);
  });
});

describe('highlighter pens', () => {
  it('a named pen is written into the marker and shown in its own colour', () => {
    const marked = emphasizeText('Acid turns blue litmus red', ['blue litmus'], 'highlight', 'green').text;
    assert.equal(marked, 'Acid turns =={green}blue litmus== red');
    assert.equal(emphasisToLinks(marked), 'Acid turns [blue litmus](#hl-green) red');
    assert.deepEqual(highlightSegments(marked, 'yellow'), [{ text: 'Acid turns ' }, { text: 'blue litmus', fill: HIGHLIGHTERS.green, bold: false }, { text: ' red' }]);
    assert.equal(plainText(marked), 'Acid turns blue litmus red');
  });

  it('highlights without a pen follow the default pen; "all" recolours the named ones too', () => {
    let doc = elementsToDesignDoc([{ id: 't', type: 'text', content: 'One ==alpha== and =={pink}**beta**== here.' }], 'T');
    assert.deepEqual(highlightSegments(allBlocks(doc)[0].text!, 'blue').filter(s => s.fill).map(s => s.fill), [HIGHLIGHTERS.blue, HIGHLIGHTERS.pink]);
    doc = applyDesignOps(doc, [{ op: 'setHighlighter', color: 'orange', all: true }]).doc;
    assert.equal(doc.theme.highlight, 'orange');
    assert.equal(allBlocks(doc)[0].text, 'One ==alpha== and ==**beta**== here.');
  });

  it('marking a selection merges with what is already there instead of nesting', () => {
    assert.equal(markSelection('The **key term** matters', 'key term', 'highlight', 'green'), 'The =={green}**key term**== matters');   // stays bold
    assert.equal(markSelection('The =={pink}key term== matters', 'key term', 'bold'), 'The =={pink}**key term**== matters');           // keeps its pen
    assert.equal(markSelection('The =={pink}key term== matters', 'key term', 'highlight', 'blue'), 'The =={blue}key term== matters');   // new pen
    assert.equal(markSelection('Value $x^2$ here', 'x^2', 'bold'), null);                                                              // inside math
  });

  it('clearMarks removes marks around a phrase, in one block or everywhere', () => {
    assert.equal(unemphasizeText('A ==**b**== c **d**', 'b'), 'A b c **d**');
    assert.equal(unemphasizeText('A ==**b**== c **d**', undefined, 'highlight'), 'A **b** c **d**');
    const doc0 = elementsToDesignDoc([{ id: 't', type: 'text', content: 'A ==b== c\n\nD **e** ==f=='}], 'T');
    const { doc } = applyDesignOps(doc0, [{ op: 'clearMarks', what: 'highlight' }]);
    assert.deepEqual(allBlocks(doc).map(b => b.text), ['A b c', 'D **e** f']);
  });
});

describe('teaching boxes and slides', () => {
  const lesson = () => elementsToDesignDoc([{ id: 't', type: 'text', content: '## पाठ\n\nसावधानी — पिन से सावधान रहिए।\n\nयह एक अनुच्छेद है।' }], 'T');

  it('labels a box in the lesson language and drops a label the text already starts with', () => {
    const doc = lesson();
    assert.equal(doc.theme.labelLang, 'hi');
    assert.equal(calloutInfo({ variant: 'caution', text: 'सावधानी — पिन से सावधान रहिए।' }, doc.theme)!.label, '');
    assert.equal(calloutInfo({ variant: 'remember', text: 'जल उबलता है।' }, doc.theme)!.label, 'याद रखें');
    assert.equal(calloutInfo({ variant: 'remember', text: 'x' }, { ...doc.theme, labelLang: 'en' })!.label, 'Remember');
  });

  it('insertSlide adds a slide with typed blocks; the AI still cannot add images', () => {
    const { doc, applied } = applyDesignOps(lesson(), [{ op: 'insertSlide', atStart: true, layout: 'title', notes: 'Greet the class',
      blocks: [{ type: 'heading', level: 1, text: 'Cover' }, { type: 'image', text: 'x' }, { type: 'callout', variant: 'objective', text: '- a\n- b' }] }]);
    assert.equal(applied, 1);
    assert.deepEqual([doc.pages[0].layout, doc.pages[0].notes, doc.pages[0].blocks.map(b => b.type)], ['title', 'Greet the class', ['heading', 'callout']]);
    assert.equal(doc.pages[0].blocks[1].variant, 'objective');
  });

  it('re-splitting the lesson keeps cover slides, notes and columns', () => {
    let doc = applyDesignOps(lesson(), [{ op: 'insertSlide', atStart: true, layout: 'title', blocks: [{ type: 'heading', level: 1, text: 'Cover' }] }]).doc;
    const body = doc.pages[1];
    doc = applyDesignOps(doc, [{ op: 'setPage', pageId: body.id, notes: 'Ask about change', layout: 'two-column' }]).doc;
    doc = applyDesignOps(doc, [{ op: 'paginate', breaks: [{ beforeBlockId: body.blocks[2].id, title: 'More' }] }]).doc;
    assert.equal(doc.pages.length, 3);
    assert.deepEqual([doc.pages[0].layout, doc.pages[0].blocks[0].text], ['title', 'Cover']);
    assert.deepEqual([doc.pages[1].notes, doc.pages[1].layout, doc.pages[2].title], ['Ask about change', 'two-column', 'More']);
  });

  it('duplicates, moves and removes slides, but never the last one', () => {
    let doc = applyDesignOps(lesson(), [{ op: 'insertSlide', title: 'Recap', blocks: [{ type: 'paragraph', text: 'End' }] }]).doc;
    const [first, second] = doc.pages;
    doc = applyDesignOps(doc, [{ op: 'movePage', pageId: second.id }]).doc;                      // to the start
    assert.deepEqual(doc.pages.map(p => p.id), [second.id, first.id]);
    doc = applyDesignOps(doc, [{ op: 'duplicatePage', pageId: first.id }]).doc;
    assert.equal(doc.pages.length, 3);
    assert.notEqual(doc.pages[2].blocks[0].id, first.blocks[0].id);
    doc = applyDesignOps(doc, [{ op: 'removePage', pageId: doc.pages[2].id }, { op: 'removePage', pageId: second.id }]).doc;
    assert.deepEqual(doc.pages.map(p => p.id), [first.id]);
    assert.equal(applyDesignOps(doc, [{ op: 'removePage', pageId: first.id }]).applied, 0);
  });

  it('find and replace changes text and titles', () => {
    let doc = applyDesignOps(lesson(), [{ op: 'setPage', pageId: lesson().pages[0].id, title: 'x' }]).doc;
    doc = applyDesignOps(doc, [{ op: 'findReplace', find: 'अनुच्छेद', replace: 'पैराग्राफ' }]).doc;
    assert.ok(allBlocks(doc).some(b => b.text === 'यह एक पैराग्राफ है।'));
    assert.equal(applyDesignOps(doc, [{ op: 'findReplace', find: 'not there', replace: 'x' }]).applied, 0);
  });

  it('section slides get the theme colour with readable text; a whole-lesson outline fits its budget', () => {
    const theme = PRESET_THEMES[1];
    const st = resolveStyle(theme, { type: 'heading', level: 1 }, { pageLayout: 'section', layout: 'slides' });
    assert.equal(st.align, 'center');
    assert.equal(st.color, readableOn(theme.primary));
    assert.equal(st.background, undefined);
    const big = elementsToDesignDoc([{ id: 't', type: 'text', content: Array.from({ length: 40 }, (_, i) => `Para ${i} ` + 'x'.repeat(900)).join('\n\n') }], 'T');
    assert.ok(JSON.stringify(outlineForAi(big, { maxChars: 9000 })).length < 13000);
  });
});
