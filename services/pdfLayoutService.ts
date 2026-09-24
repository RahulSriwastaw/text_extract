import { PDFDocument, rgb, degrees } from 'pdf-lib';
import { PageCard } from './pdfStitchService';
import { renderMergedCardToA4, solveJustifiedFill } from './pdfStitchService';

export const MM_TO_PT = 72 / 25.4; // 1 mm ~ 2.834645669 pt

export type PageSizeOption = 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal';
export type OrientationOption = 'auto' | 'portrait' | 'landscape';
export type ReadingDirectionOption = 'row-by-row' | 'col-by-col';
export type ReadingOrderOption = 'ltr' | 'rtl';
export type PagesPerSheetOption = 1 | 2 | 4 | 6 | 8 | 9 | 16 | 'custom';

export interface PdfLayoutConfig {
  layoutMode: 'multiple' | 'single';
  pagesPerSheet: PagesPerSheetOption;
  customRows?: number;
  customCols?: number;
  withBorder: boolean;
  readingDirection: ReadingDirectionOption;
  readingOrder: ReadingOrderOption;
  pageSize: PageSizeOption;
  orientation: OrientationOption;
  outerMargin: {
    top: number; // in mm
    bottom: number;
    left: number;
    right: number;
  };
  innerMargin: number; // in mm
  outputFileName: string;
}

export const DEFAULT_PDF_LAYOUT_CONFIG: PdfLayoutConfig = {
  layoutMode: 'multiple',
  pagesPerSheet: 4,
  customRows: 2,
  customCols: 2,
  withBorder: true,
  readingDirection: 'row-by-row',
  readingOrder: 'ltr',
  pageSize: 'A4',
  orientation: 'auto',
  outerMargin: {
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  innerMargin: 5,
  outputFileName: 'converted.pdf',
};

export const PAGE_SIZE_POINTS: Record<PageSizeOption, { width: number; height: number }> = {
  A4: { width: 595.28, height: 841.89 },
  A3: { width: 841.89, height: 1190.55 },
  A5: { width: 419.53, height: 595.28 },
  Letter: { width: 612.0, height: 792.0 },
  Legal: { width: 612.0, height: 1008.0 },
};

/**
 * Determine grid rows and cols based on pagesPerSheet and orientation
 */
export function getGridDimensions(
  pagesPerSheet: PagesPerSheetOption,
  isLandscape: boolean,
  customRows?: number,
  customCols?: number
): { rows: number; cols: number } {
  if (pagesPerSheet === 'custom' && customRows && customCols) {
    return { rows: Math.max(1, customRows), cols: Math.max(1, customCols) };
  }

  switch (pagesPerSheet) {
    case 1:
      return { rows: 1, cols: 1 };
    case 2:
      // On landscape sheet: 2 cols, 1 row. On portrait sheet: 1 col, 2 rows.
      return isLandscape ? { rows: 1, cols: 2 } : { rows: 2, cols: 1 };
    case 4:
      return { rows: 2, cols: 2 };
    case 6:
      return isLandscape ? { rows: 2, cols: 3 } : { rows: 3, cols: 2 };
    case 8:
      return isLandscape ? { rows: 2, cols: 4 } : { rows: 4, cols: 2 };
    case 9:
      return { rows: 3, cols: 3 };
    case 16:
      return { rows: 4, cols: 4 };
    default:
      return { rows: 2, cols: 2 };
  }
}

/**
 * Determine actual sheet dimensions in points based on paper size and orientation
 */
export function getSheetDimensions(
  pageSize: PageSizeOption,
  orientation: OrientationOption,
  pagesPerSheet: PagesPerSheetOption,
  customRows?: number,
  customCols?: number
): { width: number; height: number; isLandscape: boolean } {
  const base = PAGE_SIZE_POINTS[pageSize] || PAGE_SIZE_POINTS.A4;
  const shortSide = Math.min(base.width, base.height);
  const longSide = Math.max(base.width, base.height);

  let isLandscape = false;
  if (orientation === 'landscape') {
    isLandscape = true;
  } else if (orientation === 'portrait') {
    isLandscape = false;
  } else {
    // Automatic orientation standard:
    if (pagesPerSheet === 'custom' && customRows && customCols) {
      isLandscape = customCols > customRows;
    } else if (pagesPerSheet === 2 || pagesPerSheet === 6 || pagesPerSheet === 8) {
      isLandscape = true;
    } else {
      isLandscape = false;
    }
  }

  return {
    width: isLandscape ? longSide : shortSide,
    height: isLandscape ? shortSide : longSide,
    isLandscape,
  };
}

/**
 * Computes slot coordinates for a page on a sheet
 */
export interface SlotPosition {
  slotIndex: number;
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeSlotPositions(
  sheetWidth: number,
  sheetHeight: number,
  rows: number,
  cols: number,
  readingDirection: ReadingDirectionOption,
  readingOrder: ReadingOrderOption,
  outerMargin: { top: number; bottom: number; left: number; right: number },
  innerMarginMm: number
): SlotPosition[] {
  const marginLeftPt = outerMargin.left * MM_TO_PT;
  const marginRightPt = outerMargin.right * MM_TO_PT;
  const marginTopPt = outerMargin.top * MM_TO_PT;
  const marginBottomPt = outerMargin.bottom * MM_TO_PT;
  const innerGapPt = innerMarginMm * MM_TO_PT;

  const availW = Math.max(10, sheetWidth - marginLeftPt - marginRightPt);
  const availH = Math.max(10, sheetHeight - marginTopPt - marginBottomPt);

  const totalInnerW = Math.max(0, cols - 1) * innerGapPt;
  const totalInnerH = Math.max(0, rows - 1) * innerGapPt;

  const slotW = Math.max(10, (availW - totalInnerW) / cols);
  const slotH = Math.max(10, (availH - totalInnerH) / rows);

  const totalSlots = rows * cols;
  const positions: SlotPosition[] = [];

  for (let k = 0; k < totalSlots; k++) {
    let r = 0;
    let c = 0;

    if (readingDirection === 'row-by-row') {
      r = Math.floor(k / cols);
      const rawC = k % cols;
      c = readingOrder === 'rtl' ? cols - 1 - rawC : rawC;
    } else {
      // Column by column
      const rawC = Math.floor(k / rows);
      c = readingOrder === 'rtl' ? cols - 1 - rawC : rawC;
      r = k % rows;
    }

    const x = marginLeftPt + c * (slotW + innerGapPt);
    // In PDF coordinates, (0, 0) is bottom-left
    const yTop = sheetHeight - marginTopPt - r * (slotH + innerGapPt);
    const y = yTop - slotH;

    positions.push({
      slotIndex: k,
      row: r,
      col: c,
      x,
      y,
      width: slotW,
      height: slotH,
    });
  }

  return positions;
}

/**
 * Reorders a sheet's items so that, once they are laid out row by row, they are *read*
 * in the direction the user picked (right-to-left, or down the columns first).
 */
function applyReadingOrder<T>(
  items: T[],
  rowCounts: number[],
  readingDirection: ReadingDirectionOption,
  readingOrder: ReadingOrderOption
): T[] {
  // Clamp the row shape to the items actually present — the final sheet of a document
  // can be only partially filled, so a pinned grid may declare more slots than items.
  const counts: number[] = [];
  let remaining = items.length;
  for (const count of rowCounts) {
    const take = Math.max(0, Math.min(count, remaining));
    counts.push(take);
    remaining -= take;
  }

  const rows: T[][] = [];
  const rowStarts: number[] = [];
  let cursor = 0;
  for (const count of counts) {
    rowStarts.push(cursor);
    rows.push(items.slice(cursor, cursor + count));
    cursor += count;
  }

  if (readingDirection === 'col-by-col') {
    // Transpose: walk the slots down the columns first, then write the items back into
    // the same row shape so slot 1, 2, 3... run vertically instead of horizontally.
    const maxCols = Math.max(...counts, 1);
    const sequence: T[] = [];
    for (let c = 0; c < maxCols; c++) {
      for (let r = 0; r < rows.length; r++) {
        if (c < counts[r]) sequence.push(items[rowStarts[r] + c]);
      }
    }

    let idx = 0;
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < counts[r]; c++) rows[r][c] = sequence[idx++];
    }
  }

  if (readingOrder === 'rtl') {
    for (const row of rows) row.reverse();
  }

  return rows.flat();
}

/**
 * Generate a clean N-Up PDF from an array of PageCards (from QaPageStitcher).
 *
 * Pages are placed with a justified "fill the sheet" layout rather than a rigid
 * rows x cols grid: each row is stretched across the full width and the split into
 * rows is solved so the rows fill the sheet height. That keeps every page as large as
 * it can be and stops sheets from coming out half blank. When orientation is on "auto"
 * both portrait and landscape are tried and the better-filling one wins.
 */
export async function exportCardsWithPdfLayout(
  cards: PageCard[],
  config: PdfLayoutConfig,
  onProgress?: (current: number, total: number) => void
): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();

  const numPagesPerSheet =
    config.layoutMode === 'single'
      ? 1
      : config.pagesPerSheet === 'custom'
      ? (config.customRows || 2) * (config.customCols || 2)
      : (config.pagesPerSheet as number);

  // Render + embed every card first so the layout can be solved from real page shapes
  const embedded: { image: any; aspect: number }[] = [];
  for (let cardIdx = 0; cardIdx < cards.length; cardIdx++) {
    onProgress?.(cardIdx + 1, cards.length);

    const dataUrl = await renderMergedCardToA4(cards[cardIdx]);
    const base64Data = dataUrl.split(',')[1];
    const imageBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const image = await pdfDoc.embedJpg(imageBytes);
    embedded.push({ image, aspect: image.width / Math.max(1, image.height) });

    if (cardIdx % 2 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  const innerGapPt = config.innerMargin * MM_TO_PT;

  // An explicit custom rows x cols choice pins the grid shape; otherwise it is solved
  const pinnedRowCounts =
    config.pagesPerSheet === 'custom' && config.customRows && config.customCols
      ? new Array(Math.max(1, config.customRows)).fill(Math.max(1, config.customCols))
      : undefined;

  const groups: { image: any; aspect: number }[][] = [];
  for (let start = 0; start < embedded.length; start += numPagesPerSheet) {
    groups.push(embedded.slice(start, start + numPagesPerSheet));
  }

  const planSheet = (group: { image: any; aspect: number }[], orientation: OrientationOption) => {
    const { width: sheetWidth, height: sheetHeight } = getSheetDimensions(
      config.pageSize,
      orientation,
      numPagesPerSheet === 1 ? 1 : (config.pagesPerSheet as PagesPerSheetOption),
      config.customRows,
      config.customCols
    );

    const marginLeftPt = config.outerMargin.left * MM_TO_PT;
    const marginRightPt = config.outerMargin.right * MM_TO_PT;
    const marginTopPt = config.outerMargin.top * MM_TO_PT;
    const marginBottomPt = config.outerMargin.bottom * MM_TO_PT;

    const availWidth = Math.max(10, sheetWidth - marginLeftPt - marginRightPt);
    const availHeight = Math.max(10, sheetHeight - marginTopPt - marginBottomPt);

    // Solve the row shape first, then re-solve with the items placed in reading order
    const shape = solveJustifiedFill(
      group.map(g => g.aspect),
      availWidth,
      availHeight,
      innerGapPt,
      { rowCounts: pinnedRowCounts, maxPerRow: Math.min(group.length, 6) }
    );

    const order = applyReadingOrder(group, shape.rowCounts, config.readingDirection, config.readingOrder);
    const layout = solveJustifiedFill(
      order.map(g => g.aspect),
      availWidth,
      availHeight,
      innerGapPt,
      { rowCounts: shape.rowCounts }
    );

    return {
      width: sheetWidth,
      height: sheetHeight,
      layout,
      order,
      originX: marginLeftPt,
      originY: sheetHeight - marginTopPt,
    };
  };

  // Orientation is decided once for the whole document (the option that fills the
  // sheets best overall) so the exported PDF never mixes portrait and landscape sheets.
  let chosenOrientation: OrientationOption = config.orientation;
  if (config.orientation === 'auto') {
    let bestTotal = -Infinity;
    for (const orientation of ['portrait', 'landscape'] as OrientationOption[]) {
      const total = groups.reduce((sum, group) => sum + planSheet(group, orientation).layout.coverage, 0);
      if (total > bestTotal) {
        bestTotal = total;
        chosenOrientation = orientation;
      }
    }
  }

  for (const group of groups) {
    const sheet = planSheet(group, chosenOrientation);
    const sheetPage = pdfDoc.addPage([sheet.width, sheet.height]);

    for (let i = 0; i < sheet.order.length; i++) {
      const rect = sheet.layout.rects[i];
      if (!rect) continue;

      const drawX = sheet.originX + rect.x;
      // Layout coordinates run top-down; PDF coordinates run bottom-up
      const drawY = sheet.originY - rect.y - rect.height;

      sheetPage.drawImage(sheet.order[i].image, {
        x: drawX,
        y: drawY,
        width: rect.width,
        height: rect.height,
      });

      if (config.withBorder) {
        sheetPage.drawRectangle({
          x: drawX,
          y: drawY,
          width: rect.width,
          height: rect.height,
          borderColor: rgb(0.72, 0.72, 0.72),
          borderWidth: 0.75,
        });
      }
    }

    await new Promise(resolve => setTimeout(resolve, 0));
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
}

/**
 * Re-layout an existing PDF file directly into N-Up sheets
 */
export async function relayoutExistingPdf(
  pdfFileBytes: ArrayBuffer,
  config: PdfLayoutConfig,
  onProgress?: (current: number, total: number) => void
): Promise<Blob> {
  const srcDoc = await PDFDocument.load(pdfFileBytes);
  const outDoc = await PDFDocument.create();

  const totalSrcPages = srcDoc.getPageCount();
  const pageIndices = Array.from({ length: totalSrcPages }, (_, i) => i);
  const embeddedPages = await outDoc.embedPdf(srcDoc, pageIndices);

  const numPagesPerSheet =
    config.layoutMode === 'single'
      ? 1
      : config.pagesPerSheet === 'custom'
      ? (config.customRows || 2) * (config.customCols || 2)
      : (config.pagesPerSheet as number);

  const { width: sheetWidth, height: sheetHeight, isLandscape } = getSheetDimensions(
    config.pageSize,
    config.orientation,
    numPagesPerSheet === 1 ? 1 : (config.pagesPerSheet as PagesPerSheetOption)
  );

  const { rows, cols } = getGridDimensions(
    numPagesPerSheet === 1 ? 1 : config.pagesPerSheet,
    isLandscape,
    config.customRows,
    config.customCols
  );

  const slotPositions = computeSlotPositions(
    sheetWidth,
    sheetHeight,
    rows,
    cols,
    config.readingDirection,
    config.readingOrder,
    config.outerMargin,
    config.innerMargin
  );

  let currentSheetPage: any = null;

  for (let pageIdx = 0; pageIdx < totalSrcPages; pageIdx++) {
    onProgress?.(pageIdx + 1, totalSrcPages);

    const slotIndexOnSheet = pageIdx % numPagesPerSheet;
    if (slotIndexOnSheet === 0) {
      currentSheetPage = outDoc.addPage([sheetWidth, sheetHeight]);
    }

    const slot = slotPositions[slotIndexOnSheet];
    const embedded = embeddedPages[pageIdx];

    const srcW = embedded.width;
    const srcH = embedded.height;
    const srcAspect = srcW / srcH;
    const slotAspect = slot.width / slot.height;

    let drawW = slot.width;
    let drawH = slot.height;

    if (srcAspect > slotAspect) {
      drawW = slot.width;
      drawH = slot.width / srcAspect;
    } else {
      drawH = slot.height;
      drawW = slot.height * srcAspect;
    }

    const drawX = slot.x + (slot.width - drawW) / 2;
    const drawY = slot.y + (slot.height - drawH) / 2;

    currentSheetPage.drawPage(embedded, {
      x: drawX,
      y: drawY,
      width: drawW,
      height: drawH,
    });

    if (config.withBorder) {
      currentSheetPage.drawRectangle({
        x: drawX,
        y: drawY,
        width: drawW,
        height: drawH,
        borderColor: rgb(0.72, 0.72, 0.72),
        borderWidth: 0.75,
      });
    }

    if (pageIdx % 2 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  const pdfBytes = await outDoc.save();
  return new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
}
