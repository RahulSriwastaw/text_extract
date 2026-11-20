import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareConverterFigures, removeConverterFigure } from '../services/converterFigures';
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
