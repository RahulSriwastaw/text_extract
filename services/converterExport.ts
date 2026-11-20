import type { ExtractedElement, ScannedPage } from '../types';

export function getReadyExport(pages: ScannedPage[], includeImages: boolean) {
  const elements: ExtractedElement[] = [];
  let pageCount = 0;
  let pendingFigures = 0;
  for (const page of pages) {
    if (!page.isSelected || page.status !== 'done') continue;
    const start = elements.length;
    if (page.elements?.length) {
      for (const element of page.elements) {
        if (element.type === 'image') {
          if (!includeImages) continue;
          if (element.figureReview) {
            pendingFigures++;
            continue;
          }
        }
        if (element.content?.trim() || element.imageB64) elements.push(element);
      }
    } else if (page.extractedText?.trim()) {
      elements.push({ id: 'el_' + page.id, type: 'text', content: page.extractedText });
    }
    if (elements.length > start) pageCount++;
  }
  return { elements, pageCount, pendingFigures };
}
