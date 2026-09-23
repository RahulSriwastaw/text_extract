import { PDFDocument, rgb, degrees } from 'pdf-lib';
import { PageCard } from './pdfStitchService';
import { renderMergedCardToA4 } from './pdfStitchService';

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
 * Generate a clean N-Up PDF from an array of PageCards (from QaPageStitcher)
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

  const { width: sheetWidth, height: sheetHeight, isLandscape } = getSheetDimensions(
    config.pageSize,
    config.orientation,
    numPagesPerSheet === 1 ? 1 : (config.pagesPerSheet as PagesPerSheetOption),
    config.customRows,
    config.customCols
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

  const totalCards = cards.length;
  let currentSheetPage: any = null;

  for (let cardIdx = 0; cardIdx < totalCards; cardIdx++) {
    onProgress?.(cardIdx + 1, totalCards);

    const slotIndexOnSheet = cardIdx % numPagesPerSheet;
    if (slotIndexOnSheet === 0) {
      currentSheetPage = pdfDoc.addPage([sheetWidth, sheetHeight]);
    }

    const slot = slotPositions[slotIndexOnSheet];
    const card = cards[cardIdx];

    // Render card to image bytes
    const dataUrl = await renderMergedCardToA4(card);
    const base64Data = dataUrl.split(',')[1];
    const imageBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const embeddedImage = await pdfDoc.embedJpg(imageBytes);

    // Calculate aspect fit within slot
    const imgAspect = embeddedImage.width / embeddedImage.height;
    const slotAspect = slot.width / slot.height;

    let drawW = slot.width;
    let drawH = slot.height;

    if (imgAspect > slotAspect) {
      // Content wider than slot
      drawW = slot.width;
      drawH = slot.width / imgAspect;
    } else {
      // Content taller than slot
      drawH = slot.height;
      drawW = slot.height * imgAspect;
    }

    const drawX = slot.x + (slot.width - drawW) / 2;
    const drawY = slot.y + (slot.height - drawH) / 2;

    // Draw page image
    currentSheetPage.drawImage(embeddedImage, {
      x: drawX,
      y: drawY,
      width: drawW,
      height: drawH,
    });

    // Draw border if requested
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

    // Yield control smoothly for UI progress
    if (cardIdx % 2 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
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
