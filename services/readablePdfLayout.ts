import {
  PDFDocument, PDFPage, clip, endPath, popGraphicsState, pushGraphicsState, rectangle, rgb,
} from 'pdf-lib';

export interface ReadableItem {
  width: number;
  height: number;
  scale?: number;
}

export interface ReadablePlacement {
  itemIndex: number;
  pageIndex: number;
  x: number;
  y: number; // Top-down, relative to the content area
  width: number;
  height: number; // Visible part on this page
  fullHeight: number;
  offset: number; // Distance from the top of the original item
}

/** Keep each snippet at full column width. Overflow creates pages, never smaller text. */
export function planReadablePages(
  items: ReadableItem[], width: number, height: number, gap: number,
): ReadablePlacement[] {
  if (![width, height, gap].every(Number.isFinite) || width <= 0 || height <= 0 || gap < 0) {
    throw new Error('Margins must leave a positive content area on the page.');
  }
  const placements: ReadablePlacement[] = [];
  let pageIndex = 0;
  let y = 0;
  items.forEach((item, itemIndex) => {
    if (![item.width, item.height].every(v => Number.isFinite(v) && v > 0)) {
      throw new Error('Cannot lay out an image with invalid dimensions.');
    }
    // Respect an intentional reduction, but never zoom past the printable width.
    const scale = Number.isFinite(item.scale) && item.scale! > 0 ? Math.min(1, item.scale!) : 1;
    const drawWidth = width * scale;
    const fullHeight = item.height * drawWidth / item.width;
    if (y > 0 && y + fullHeight > height + 0.001) {
      pageIndex++;
      y = 0;
    }
    let offset = 0;
    while (offset < fullHeight) {
      const visibleHeight = Math.min(fullHeight - offset, height - y);
      placements.push({
        itemIndex, pageIndex, x: (width - drawWidth) / 2, y,
        width: drawWidth, height: visibleHeight, fullHeight, offset,
      });
      if (offset + visibleHeight >= fullHeight - 0.001) {
        y += visibleHeight + gap;
        break;
      }
      // A small repeated strip keeps a line crossing the page boundary readable.
      offset += visibleHeight - Math.min(12, visibleHeight * 0.05);
      pageIndex++;
      y = 0;
    }
  });
  return placements;
}

export interface ReadableDrawable extends ReadableItem {
  border?: boolean;
  draw: (page: PDFPage, box: { x: number; y: number; width: number; height: number }) => void;
}

export function appendReadablePages(
  doc: PDFDocument,
  items: ReadableDrawable[],
  sheet: { width: number; height: number; top: number; bottom: number; left: number; right: number; gap: number },
): void {
  const placements = planReadablePages(
    items, sheet.width - sheet.left - sheet.right, sheet.height - sheet.top - sheet.bottom, sheet.gap,
  );
  let page: PDFPage;
  let currentIndex = -1;
  for (const part of placements) {
    if (part.pageIndex !== currentIndex) {
      page = doc.addPage([sheet.width, sheet.height]);
      currentIndex = part.pageIndex;
    }
    const x = sheet.left + part.x;
    const top = sheet.height - sheet.top - part.y;
    const y = top - part.height;
    page!.pushOperators(pushGraphicsState(), rectangle(x, y, part.width, part.height), clip(), endPath());
    items[part.itemIndex].draw(page!, {
      x, y: top + part.offset - part.fullHeight, width: part.width, height: part.fullHeight,
    });
    page!.pushOperators(popGraphicsState());
    if (items[part.itemIndex].border) {
      page!.drawRectangle({ x, y, width: part.width, height: part.height, borderColor: rgb(0.72, 0.72, 0.72), borderWidth: 0.75 });
    }
  }
}
