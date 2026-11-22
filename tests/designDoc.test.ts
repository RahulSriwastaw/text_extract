import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  elementsToDesignDoc, applyDesignOps, outlineForAi, autoPaginate, allBlocks, sanitizeStyle, tint, PRESET_THEMES,
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
    const { doc } = applyDesignOps(build(), [{ op: 'setTheme', patch: { primary: '#f00', baseSize: 99, font: 'comic', optionColumns: 2 } }]);
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
