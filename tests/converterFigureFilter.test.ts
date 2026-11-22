import assert from 'node:assert/strict';
import test from 'node:test';
import { applyConverterFigure, prepareConverterFigures, removeConverterFigure } from '../services/converterFigures';
import type { ExtractedElement, ScannedPage } from '../types';

test('skip page branding before cropping while keeping instructional images', async () => {
  const captions = [
    'Circular logo of Board Exam by Khan Sir with a photo next to the header title',
    'Photo of Khan Sir (instructor) as a watermark in the center of the page',
    'Triangle ABC with a watermark behind it',
    'Logo shown in question 3 for identification',
  ];
  const elements: ExtractedElement[] = captions.map((content, i) => ({ id: String(i), type: 'image', content }));
  for (const mode of ['crop', 'svg'] as const) {
    const output = await prepareConverterFigures('', elements, mode);
    assert.deepEqual(output.map(el => el.content), captions.slice(2));
  }
});

test('remove only the chosen figure and its preview marker from an edited page', () => {
  const one: ExtractedElement = { id: 'a', type: 'image', content: 'Diagram' };
  const two = { ...one, id: 'b', imageB64: 'approved crop' };
  const page: ScannedPage = { id: 'page', imageUrl: 'original', pageNumber: 1, isSelected: true,
    status: 'done', elements: [one, two], extractedText: '[Image: Diagram]\n\nEdited question\n\n[Image: Diagram]' };
  const result = removeConverterFigure(page, two);
  assert.deepEqual(result.elements, [one]);
  assert.equal(result.extractedText, '[Image: Diagram]\n\nEdited question');
  assert.equal(result.imageUrl, page.imageUrl);
});

test('several crops from one dialog become separate figures, in order, right after the reviewed figure', () => {
  const text: ExtractedElement = { id: 't', type: 'text', content: 'Question' };
  const one: ExtractedElement = { id: 'a', type: 'image', content: 'Diagram', figureReview: { mode: 'crop' } };
  const two: ExtractedElement = { id: 'b', type: 'image', content: 'Diagram', figureReview: { mode: 'crop' } };
  const page: ScannedPage = { id: 'page', imageUrl: 'original', pageNumber: 1, isSelected: true,
    status: 'done', elements: [one, text, two], extractedText: '[Image: Diagram]\n\nQuestion\n\n[Image: Diagram]' };
  const box = (n: number) => ({ xmin: n, ymin: n, xmax: n + 100, ymax: n + 100 });

  const single = applyConverterFigure(page, two, 'crop-1', box(1));
  assert.deepEqual(single.elements, [one, text, { id: 'b', type: 'image', content: 'Diagram', bbox: box(1), imageB64: 'crop-1' }]);
  assert.equal(single.extractedText, page.extractedText);

  const many = applyConverterFigure(page, one, 'crop-1', box(1), [{ image: 'crop-2', bbox: box(2) }, { image: 'crop-3', bbox: box(3) }]);
  assert.deepEqual(many.elements?.map(el => el.imageB64), ['crop-1', 'crop-2', 'crop-3', undefined, undefined]);
  assert.deepEqual(many.elements?.map(el => el.bbox), [box(1), box(2), box(3), undefined, undefined]);
  assert.equal(new Set(many.elements?.map(el => el.id)).size, 5);
  assert.ok(many.elements?.slice(0, 3).every(el => el.type === 'image' && !el.figureReview));
  assert.equal(many.extractedText, '[Image: Diagram]\n\n[Image: Manual crop]\n\n[Image: Manual crop]\n\nQuestion\n\n[Image: Diagram]');
  // A new figure is a normal figure: it can be removed again without touching the others.
  const removed = removeConverterFigure(many, many.elements![1]);
  assert.deepEqual(removed.elements?.map(el => el.imageB64), ['crop-1', 'crop-3', undefined, undefined]);
  assert.equal(removed.extractedText, '[Image: Diagram]\n\n[Image: Manual crop]\n\nQuestion\n\n[Image: Diagram]');
});
