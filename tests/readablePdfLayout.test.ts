import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { appendReadablePages, planReadablePages } from '../services/readablePdfLayout';
import { DEFAULT_PDF_LAYOUT_CONFIG, exportCardsWithPdfLayout, relayoutExistingPdf } from '../services/pdfLayoutService';
import { exportMergedCardsToPdf } from '../services/pdfStitchService';

test('mixed short questions and a dense page all retain full width and source order', () => {
  const items = [4, 4, 2.8, 2.8, 2.8, 3, 0.65].map(aspect => ({ width: 1000, height: 1000 / aspect }));
  const parts = planReadablePages(items, 550, 795, 14);
  assert.deepEqual(parts.map(p => p.itemIndex), [0, 1, 2, 3, 4, 5, 6, 6]);
  assert.ok(parts.every(p => p.width === 550));
  assert.ok(parts.every(p => p.y >= 0 && p.y + p.height <= 795.001));
  assert.ok(parts.at(-1)!.pageIndex > 0);
});

test('a question that fits a fresh page moves whole rather than being split or shrunk', () => {
  const parts = planReadablePages([{ width: 500, height: 300 }, { width: 500, height: 400 }], 500, 600, 20);
  assert.equal(parts.length, 2);
  assert.equal(parts[1].pageIndex, 1);
  assert.equal(parts[1].y, 0);
  assert.equal(parts[1].height, 400);
  assert.equal(parts[1].offset, 0);
});

test('tall content is fully covered with overlap and consistent scale on every page', () => {
  const parts = planReadablePages([{ width: 500, height: 2500 }], 500, 700, 10);
  assert.equal(parts.length, 4);
  assert.equal(parts[0].offset, 0);
  for (let i = 1; i < parts.length; i++) {
    assert.ok(parts[i].offset < parts[i - 1].offset + parts[i - 1].height);
    assert.ok(parts[i].offset > parts[i - 1].offset);
    assert.equal(parts[i].width, 500);
  }
  assert.equal(parts.at(-1)!.offset + parts.at(-1)!.height, 2500);
});

test('exact fits, empty input, invalid margins and deliberate scale reductions', () => {
  assert.deepEqual(planReadablePages([], 500, 700, 10), []);
  assert.throws(() => planReadablePages([], 0, 700, 10), /Margins/);
  const parts = planReadablePages([{ width: 500, height: 700 }, { width: 500, height: 700, scale: 0.5 }], 500, 700, 10);
  assert.equal(parts.length, 2);
  assert.equal(parts[1].pageIndex, 1);
  assert.equal(parts[1].width, 250);
  assert.equal(parts[1].height, 350);
  assert.equal(parts[1].x, 125);
});

test('PDF rendering preserves the image aspect ratio and places continuation slices correctly', async () => {
  const doc = await PDFDocument.create();
  const draws: { x: number; y: number; width: number; height: number }[] = [];
  appendReadablePages(doc, [{ width: 500, height: 1500, draw: (_page, box) => { draws.push(box); } }], {
    width: 600, height: 800, left: 50, right: 50, top: 50, bottom: 50, gap: 10,
  });
  assert.equal(doc.getPageCount(), 3);
  assert.equal(draws[0].y, -750);
  assert.equal(draws[1].y, -62);
  assert.ok(draws.every(box => box.width / box.height === 1 / 3));
  const reloaded = await PDFDocument.load(await doc.save());
  assert.equal(reloaded.getPageCount(), 3);
  assert.deepEqual(reloaded.getPage(0).getSize(), { width: 600, height: 800 });
});

test('existing PDFs also paginate at full width in readable mode', async () => {
  const src = await PDFDocument.create();
  const page = src.addPage([500, 1800]);
  page.drawText('Content at the top', { x: 20, y: 1750 });
  page.drawText('Content at the bottom', { x: 20, y: 20 });
  const bytes = await src.save();
  const blob = await relayoutExistingPdf(bytes.buffer as ArrayBuffer, DEFAULT_PDF_LAYOUT_CONFIG);
  const output = await PDFDocument.load(await blob.arrayBuffer());
  assert.equal(output.getPageCount(), 3);
});

test('merged PNG snippets export without a browser canvas, including quick download', async () => {
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
  const card = {
    id: 'mixed', originalPageNum: 1, questionImage: image, isMerged: true,
    items: [1, 2, 3].map(pageNum => ({ id: String(pageNum), pageNum, image })),
  };
  for (const blob of [await exportCardsWithPdfLayout([card], DEFAULT_PDF_LAYOUT_CONFIG), await exportMergedCardsToPdf([card])]) {
    const doc = await PDFDocument.load(await blob.arrayBuffer());
    assert.equal(doc.getPageCount(), 3);
    assert.equal(doc.getPage(0).getWidth(), 595.28);
  }
});
