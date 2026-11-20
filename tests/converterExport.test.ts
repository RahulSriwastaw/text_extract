import assert from 'node:assert/strict';
import test from 'node:test';
import { getReadyExport } from '../services/converterExport';
import type { ScannedPage } from '../types';

test('partial DOCX includes selected ready content and counts only pages with exportable content', () => {
  const ready: ScannedPage = { id: '7', pageNumber: 7, status: 'done', isSelected: true, imageUrl: '',
    elements: [{ id: 'q', type: 'text', content: 'Question' }, { id: 'crop', type: 'image', imageB64: 'approved' },
      { id: 'svg', type: 'image', figureReview: { mode: 'svg' } }] };
  const pages: ScannedPage[] = [
    { ...ready, status: 'pending' }, { ...ready, status: 'processing' }, { ...ready, isSelected: false },
    ready, { ...ready, id: '8', elements: undefined, extractedText: 'Second page' },
    { ...ready, elements: [ready.elements[2]] },
  ];
  const result = getReadyExport(pages, true);
  assert.equal(result.pageCount, 2);
  assert.equal(result.pendingFigures, 2);
  assert.deepEqual(result.elements.map(el => el.id), ['q', 'crop', 'el_8']);
  assert.deepEqual(getReadyExport(pages, false).elements.map(el => el.id), ['q', 'el_8']);
  assert.equal(getReadyExport([{ ...ready, isSelected: false }], true).pageCount, 0);
});
