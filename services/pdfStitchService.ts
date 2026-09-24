import { PDFDocument } from 'pdf-lib';

export interface SnippetCrop {
  id: string;
  sourceDocId: string; // 'doc1' (questions) or 'doc2' (solutions)
  sourceDocName: string;
  sourcePageNumber: number;
  type: 'question' | 'solution' | 'diagram' | 'general';
  label?: string; // e.g., "Q. 1", "Sol. 1"
  imageUrl: string; // base64
  naturalWidth: number;
  naturalHeight: number;
  aspectRatio: number;
  createdAt: number;
}

export interface CanvasElement {
  id: string;
  snippetId?: string;
  type: 'snippet' | 'divider' | 'badge';
  imageUrl?: string;
  label?: string;
  badgeType?: 'question' | 'solution' | 'diagram';
  // Coordinates relative to standard virtual page canvas: 794 x 1123 px (Standard A4 @ 96 DPI)
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

export interface StitchPage {
  id: string;
  pageNumber: number;
  title: string;
  elements: CanvasElement[];
  thumbnailUrl?: string;
}

// Standard A4 reference canvas size in virtual pixels
export const CANVAS_A4_WIDTH = 794;
export const CANVAS_A4_HEIGHT = 1123;
export const EXPORT_SCALE = 2.5; // High-DPI export (1985 x 2807 px)

/**
 * Load an image from a base64 string
 */
export const loadImage = (src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error('Failed to load image for rendering: ' + e));
    img.src = src;
  });
};

/**
 * Renders a single StitchPage onto a high-DPI offscreen canvas and returns base64 image
 */
export const renderPageToCanvas = async (
  page: StitchPage,
  targetWidth: number = Math.round(CANVAS_A4_WIDTH * EXPORT_SCALE),
  targetHeight: number = Math.round(CANVAS_A4_HEIGHT * EXPORT_SCALE)
): Promise<string> => {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas 2D context');

  const scale = targetWidth / CANVAS_A4_WIDTH;

  // 1. Fill clean crisp white background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, targetWidth, targetHeight);

  // Enable high-quality smoothing
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // 2. Sort elements by zIndex
  const sortedElements = [...page.elements].sort((a, b) => a.zIndex - b.zIndex);

  for (const el of sortedElements) {
    const elX = Math.round(el.x * scale);
    const elY = Math.round(el.y * scale);
    const elW = Math.round(el.width * scale);
    const elH = Math.round(el.height * scale);

    if (el.type === 'snippet' && el.imageUrl) {
      try {
        const img = await loadImage(el.imageUrl);
        ctx.drawImage(img, elX, elY, elW, elH);
      } catch (err) {
        console.error('Failed to draw snippet element:', err);
      }
    } else if (el.type === 'divider') {
      // Draw subtle horizontal separator
      ctx.save();
      const lineY = elY + Math.round(elH / 2);
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = Math.max(2, Math.round(2 * scale));
      ctx.beginPath();
      ctx.moveTo(elX, lineY);
      ctx.lineTo(elX + elW, lineY);
      ctx.stroke();

      if (el.label) {
        // Draw centered pill badge on top of divider
        const text = el.label.toUpperCase();
        const fontSize = Math.round(13 * scale);
        ctx.font = `bold ${fontSize}px sans-serif`;
        const textMetrics = ctx.measureText(text);
        const pillWidth = textMetrics.width + 24 * scale;
        const pillHeight = 22 * scale;
        const pillX = elX + (elW - pillWidth) / 2;
        const pillY = lineY - pillHeight / 2;

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(pillX - 4 * scale, pillY, pillWidth + 8 * scale, pillHeight);

        // Fill badge pill
        ctx.fillStyle = '#F1F5F9';
        drawRoundedRect(ctx, pillX, pillY, pillWidth, pillHeight, 6 * scale);
        ctx.fill();

        ctx.strokeStyle = '#CBD5E1';
        ctx.lineWidth = Math.max(1, Math.round(1 * scale));
        ctx.stroke();

        ctx.fillStyle = '#475569';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, elX + elW / 2, lineY);
      }
      ctx.restore();
    } else if (el.type === 'badge') {
      // Draw badge element
      ctx.save();
      const isQuestion = el.badgeType === 'question';
      const isSolution = el.badgeType === 'solution';
      
      const bgColor = isQuestion ? '#FFF7ED' : isSolution ? '#F0FDF4' : '#F8FAFC';
      const borderColor = isQuestion ? '#FDBA74' : isSolution ? '#86EFAC' : '#CBD5E1';
      const textColor = isQuestion ? '#C2410C' : isSolution ? '#15803D' : '#334155';

      ctx.fillStyle = bgColor;
      drawRoundedRect(ctx, elX, elY, elW, elH, 6 * scale);
      ctx.fill();

      ctx.strokeStyle = borderColor;
      ctx.lineWidth = Math.max(1.5, Math.round(1.5 * scale));
      ctx.stroke();

      if (el.label) {
        ctx.fillStyle = textColor;
        ctx.font = `bold ${Math.round(12 * scale)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(el.label, elX + elW / 2, elY + elH / 2);
      }
      ctx.restore();
    }
  }

  return canvas.toDataURL('image/jpeg', 0.93);
};

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Automatic layout: Stack Question snippet on Top and Solution snippet on Bottom
 */
export const createStackedLayout = (
  questionSnippet: SnippetCrop,
  solutionSnippet: SnippetCrop,
  pageNumber: number
): CanvasElement[] => {
  const elements: CanvasElement[] = [];
  const paddingX = 40;
  const availableWidth = CANVAS_A4_WIDTH - paddingX * 2; // 714 px
  const availableHeight = CANVAS_A4_HEIGHT - 80; // 1043 px

  // Calculate proportional heights
  const qScale = Math.min(1, availableWidth / questionSnippet.naturalWidth);
  const qWidth = Math.min(availableWidth, questionSnippet.naturalWidth * qScale);
  const qHeight = questionSnippet.naturalHeight * (qWidth / questionSnippet.naturalWidth);

  const sScale = Math.min(1, availableWidth / solutionSnippet.naturalWidth);
  const sWidth = Math.min(availableWidth, solutionSnippet.naturalWidth * sScale);
  const sHeight = solutionSnippet.naturalHeight * (sWidth / solutionSnippet.naturalWidth);

  // Check if both fit comfortably
  const dividerHeight = 30;
  const badgeHeight = 24;
  const totalNeeded = qHeight + sHeight + dividerHeight + badgeHeight * 2 + 40;

  let finalQW = qWidth;
  let finalQH = qHeight;
  let finalSW = sWidth;
  let finalSH = sHeight;

  if (totalNeeded > availableHeight) {
    const shrinkFactor = (availableHeight - dividerHeight - badgeHeight * 2 - 40) / (qHeight + sHeight);
    finalQH = Math.round(qHeight * shrinkFactor);
    finalQW = Math.round(qWidth * shrinkFactor);
    finalSH = Math.round(sHeight * shrinkFactor);
    finalSW = Math.round(sWidth * shrinkFactor);
  }

  let currentY = 40;

  // 1. Question Badge
  elements.push({
    id: `badge-q-${Date.now()}-${Math.random()}`,
    type: 'badge',
    badgeType: 'question',
    label: `QUESTION ${pageNumber}`,
    x: paddingX,
    y: currentY,
    width: 130,
    height: 24,
    zIndex: 1,
  });
  currentY += 32;

  // 2. Question Snippet (Centered)
  const qX = paddingX + (availableWidth - finalQW) / 2;
  elements.push({
    id: `snippet-q-${Date.now()}-${Math.random()}`,
    snippetId: questionSnippet.id,
    type: 'snippet',
    imageUrl: questionSnippet.imageUrl,
    x: Math.round(qX),
    y: Math.round(currentY),
    width: Math.round(finalQW),
    height: Math.round(finalQH),
    zIndex: 2,
  });
  currentY += finalQH + 24;

  // 3. Divider
  elements.push({
    id: `divider-${Date.now()}-${Math.random()}`,
    type: 'divider',
    label: 'SOLUTION / EXPLANATION',
    x: paddingX,
    y: Math.round(currentY),
    width: availableWidth,
    height: 24,
    zIndex: 1,
  });
  currentY += 36;

  // 4. Solution Snippet (Centered)
  const sX = paddingX + (availableWidth - finalSW) / 2;
  elements.push({
    id: `snippet-s-${Date.now()}-${Math.random()}`,
    snippetId: solutionSnippet.id,
    type: 'snippet',
    imageUrl: solutionSnippet.imageUrl,
    x: Math.round(sX),
    y: Math.round(currentY),
    width: Math.round(finalSW),
    height: Math.round(finalSH),
    zIndex: 2,
  });

  return elements;
};

/**
 * Creates a Side-by-Side layout (50/50)
 */
export const createSideBySideLayout = (
  questionSnippet: SnippetCrop,
  solutionSnippet: SnippetCrop,
  pageNumber: number
): CanvasElement[] => {
  const elements: CanvasElement[] = [];
  const padding = 30;
  const colWidth = (CANVAS_A4_WIDTH - padding * 3) / 2; // ~352 px
  const availableHeight = CANVAS_A4_HEIGHT - 100;

  // Scale Q
  const qScale = Math.min(1, colWidth / questionSnippet.naturalWidth);
  const qW = Math.min(colWidth, questionSnippet.naturalWidth * qScale);
  const qH = Math.min(availableHeight - 40, questionSnippet.naturalHeight * (qW / questionSnippet.naturalWidth));

  // Scale S
  const sScale = Math.min(1, colWidth / solutionSnippet.naturalWidth);
  const sW = Math.min(colWidth, solutionSnippet.naturalWidth * sScale);
  const sH = Math.min(availableHeight - 40, solutionSnippet.naturalHeight * (sW / solutionSnippet.naturalWidth));

  // Left column: Question
  elements.push({
    id: `badge-q-${Date.now()}`,
    type: 'badge',
    badgeType: 'question',
    label: `QUESTION ${pageNumber}`,
    x: padding,
    y: 40,
    width: 120,
    height: 24,
    zIndex: 1,
  });
  elements.push({
    id: `snippet-q-${Date.now()}`,
    snippetId: questionSnippet.id,
    type: 'snippet',
    imageUrl: questionSnippet.imageUrl,
    x: padding,
    y: 72,
    width: Math.round(qW),
    height: Math.round(qH),
    zIndex: 2,
  });

  // Right column: Solution
  const rightX = padding * 2 + colWidth;
  elements.push({
    id: `badge-s-${Date.now()}`,
    type: 'badge',
    badgeType: 'solution',
    label: `SOLUTION ${pageNumber}`,
    x: rightX,
    y: 40,
    width: 120,
    height: 24,
    zIndex: 1,
  });
  elements.push({
    id: `snippet-s-${Date.now()}`,
    snippetId: solutionSnippet.id,
    type: 'snippet',
    imageUrl: solutionSnippet.imageUrl,
    x: rightX,
    y: 72,
    width: Math.round(sW),
    height: Math.round(sH),
    zIndex: 2,
  });

  return elements;
};

/**
 * Compiles all stitched pages into a downloadable PDF file using pdf-lib
 */
export const exportStitchedPagesToPdf = async (
  pages: StitchPage[],
  onProgress?: (current: number, total: number) => void
): Promise<Blob> => {
  const pdfDoc = await PDFDocument.create();

  // A4 dimensions in points: 595.28 x 841.89
  const a4WidthPt = 595.28;
  const a4HeightPt = 841.89;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    onProgress?.(i + 1, pages.length);

    // High-resolution render of the canvas
    const dataUrl = await renderPageToCanvas(page);
    const base64Data = dataUrl.split(',')[1];
    const imageBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

    const embeddedImage = await pdfDoc.embedJpg(imageBytes);
    const pdfPage = pdfDoc.addPage([a4WidthPt, a4HeightPt]);

    pdfPage.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width: a4WidthPt,
      height: a4HeightPt,
    });
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
};

/**
 * Crops a bounding box area from an image base64
 */
export const cropImageSnippet = (
  base64Image: string,
  cropRect: { x: number; y: number; width: number; height: number },
  imgNaturalWidth: number,
  imgNaturalHeight: number
): Promise<{ dataUrl: string; width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas context not available'));

      const scaleX = img.naturalWidth / imgNaturalWidth;
      const scaleY = img.naturalHeight / imgNaturalHeight;

      const sx = Math.max(0, cropRect.x * scaleX);
      const sy = Math.max(0, cropRect.y * scaleY);
      const sw = Math.min(img.naturalWidth - sx, cropRect.width * scaleX);
      const sh = Math.min(img.naturalHeight - sy, cropRect.height * scaleY);

      canvas.width = Math.max(1, Math.round(sw));
      canvas.height = Math.max(1, Math.round(sh));

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      resolve({
        dataUrl: canvas.toDataURL('image/jpeg', 0.95),
        width: canvas.width,
        height: canvas.height,
      });
    };
    img.onerror = () => reject(new Error('Failed to load image for cropping'));
    img.src = base64Image;
  });
};

export interface CropBox {
  x: number; // percentage of image width (0 - 100)
  y: number; // percentage of image height (0 - 100)
  width: number; // percentage of image width (0 - 100)
  height: number; // percentage of image height (0 - 100)
}

export interface PageCardItem {
  id: string;
  pageNum: number;
  image: string; // base64
  croppedImage?: string; // Pre-rendered clean cropped base64 snapshot
  crop?: CropBox;
  scale?: number;
  label?: string; // e.g. "Question", "Solution", "Part 1", "Diagram"
}

export interface PageCard {
  id: string;
  originalPageNum: number;
  questionImage: string;
  croppedQuestionImage?: string; // Pre-rendered clean cropped base64 snapshot
  solutionImage?: string;
  croppedSolutionImage?: string; // Pre-rendered clean cropped base64 snapshot
  solutionPageNum?: number;
  isMerged: boolean;
  isSelected?: boolean; // Selection flag for downloading / sending to AI
  qCrop?: CropBox;
  solCrop?: CropBox;
  qScale?: number; // Zoom/Scale multiplier (e.g., 0.8 to 2.0, default 1.0)
  solScale?: number;
  showDivider?: boolean;
  items?: PageCardItem[]; // Multi-item support (2, 3, 4+ pages/snippets per card)
}

/**
 * Ensures a card has a valid items array, populating from legacy question/solution fields if needed.
 */
export const ensureCardItems = (card: PageCard): PageCardItem[] => {
  // 1. If card already has multi-items array, return it directly
  if (card.items && card.items.length > 1) {
    return card.items;
  }

  // 2. If card is marked as merged and has solutionImage, ensure BOTH question and solution are present
  if (card.isMerged && card.solutionImage) {
    const qItem: PageCardItem = (card.items && card.items[0]) ? card.items[0] : {
      id: `${card.id}-item-0`,
      pageNum: card.originalPageNum,
      image: card.questionImage,
      croppedImage: card.croppedQuestionImage,
      crop: card.qCrop,
      scale: card.qScale || 1.0,
      label: 'Question',
    };
    const solItem: PageCardItem = (card.items && card.items[1]) ? card.items[1] : {
      id: `${card.id}-item-1`,
      pageNum: card.solutionPageNum || (card.originalPageNum + 1),
      image: card.solutionImage,
      croppedImage: card.croppedSolutionImage,
      crop: card.solCrop,
      scale: card.solScale || 1.0,
      label: 'Solution',
    };
    return [qItem, solItem];
  }

  // 3. If card has 1 item already populated and is not merged
  if (card.items && card.items.length === 1) {
    return card.items;
  }

  // 4. Default single-item fallback
  const items: PageCardItem[] = [
    {
      id: `${card.id}-item-0`,
      pageNum: card.originalPageNum,
      image: card.questionImage,
      croppedImage: card.croppedQuestionImage,
      crop: card.qCrop,
      scale: card.qScale || 1.0,
      label: `Page ${card.originalPageNum}`,
    }
  ];
  return items;
};

/**
 * Crops an image base64 using percentage coordinates (0 - 100) and returns clean base64 data URL
 */
export const cropImageByPercentage = async (
  srcBase64: string,
  box: CropBox
): Promise<string> => {
  const img = await loadImage(srcBase64);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas context');

  const naturalW = img.naturalWidth || 1000;
  const naturalH = img.naturalHeight || 1400;

  const bx = Math.max(0, Math.min(100, isNaN(box.x) ? 0 : box.x));
  const by = Math.max(0, Math.min(100, isNaN(box.y) ? 0 : box.y));
  const bw = Math.max(1, Math.min(100 - bx, isNaN(box.width) ? 100 : box.width));
  const bh = Math.max(1, Math.min(100 - by, isNaN(box.height) ? 100 : box.height));

  const sx = Math.max(0, Math.round((bx / 100) * naturalW));
  const sy = Math.max(0, Math.round((by / 100) * naturalH));
  const sw = Math.max(1, Math.min(naturalW - sx, Math.round((bw / 100) * naturalW)));
  const sh = Math.max(1, Math.min(naturalH - sy, Math.round((bh / 100) * naturalH)));

  canvas.width = sw;
  canvas.height = sh;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  return canvas.toDataURL('image/jpeg', 0.95);
};

// Text-visibility boost applied to every drawn snippet: gentle contrast + brightness lift
// (helps faint scans / low-contrast phone photos read clearly after shrinking into a grid)
const IMAGE_ENHANCE_FILTER = 'contrast(1.14) brightness(1.03) saturate(1.05)';

// A rendered card's page is allowed to grow taller than a plain A4 sheet (become "vertical")
// so that many merged snippets never have to be squeezed smaller than this floor.
const MAX_PAGE_HEIGHT_MULTIPLIER = 3.2;

export interface JustifiedRect {
  x: number;
  y: number;
  width: number;
  height: number;
  row: number;
}

export interface JustifiedLayoutResult {
  rects: JustifiedRect[];
  rowCounts: number[];
  contentHeight: number;
  coverage: number; // 0 - 1, fraction of the available area actually covered by content
}

/**
 * Enumerates candidate "how many items per row" splits. Rows are kept near-uniform
 * (counts differ by at most 1) so the result still reads like a clean grid, but which
 * rows carry the extra item is free — that freedom is what lets the stack of rows land
 * on the sheet height instead of stopping half way down.
 */
function buildRowCountCandidates(n: number, maxPerRow: number): number[][] {
  const candidates: number[][] = [];

  const pickRows = (total: number, take: number, limit: number): number[][] => {
    const out: number[][] = [];
    const current: number[] = [];
    const walk = (start: number) => {
      if (out.length >= limit) return;
      if (current.length === take) {
        out.push([...current]);
        return;
      }
      for (let i = start; i < total; i++) {
        current.push(i);
        walk(i + 1);
        current.pop();
        if (out.length >= limit) return;
      }
    };
    walk(0);
    return out;
  };

  for (let rows = 1; rows <= n; rows++) {
    const base = Math.floor(n / rows);
    const extra = n % rows;
    if (base < 1) continue;
    if (base + (extra > 0 ? 1 : 0) > maxPerRow) continue;

    if (extra === 0) {
      candidates.push(new Array(rows).fill(base));
      continue;
    }
    for (const picked of pickRows(rows, extra, 120)) {
      const counts = new Array(rows).fill(base);
      for (const i of picked) counts[i] = base + 1;
      candidates.push(counts);
    }
  }

  return candidates.length > 0 ? candidates : [[n]];
}

/**
 * Builds the geometry for one candidate row split: every row is stretched so its items
 * span the full width, and each item keeps its own aspect ratio (so nothing is
 * letterboxed inside an over-sized slot).
 */
function layoutFromRowCounts(
  aspects: number[],
  counts: number[],
  availWidth: number,
  availHeight: number,
  gap: number,
  flexibleHeight: boolean,
  maxHeight: number
): JustifiedLayoutResult {
  const rows = counts.length;
  const heightLimit = flexibleHeight ? maxHeight : availHeight;

  const rowAspectSums: number[] = [];
  let cursor = 0;
  for (const count of counts) {
    let sum = 0;
    for (let i = 0; i < count; i++) sum += Math.max(0.05, aspects[cursor + i] || 1);
    rowAspectSums.push(sum);
    cursor += count;
  }

  // Height each row needs when its items are stretched to fill the full width
  const naturalHeights = counts.map(
    (count, r) => (availWidth - (count - 1) * gap) / rowAspectSums[r]
  );
  const sumHeights = naturalHeights.reduce((a, b) => a + b, 0);
  const gapsTotal = (rows - 1) * gap;

  // Only shrink when the natural stack is taller than what we are allowed to use
  let scale = 1;
  if (sumHeights + gapsTotal > heightLimit) {
    scale = Math.max(0.05, (heightLimit - gapsTotal) / sumHeights);
  }

  const usedHeight = sumHeights * scale + gapsTotal;
  const contentHeight = flexibleHeight ? usedHeight : availHeight;

  // Any height we could not consume is spread between the rows rather than dumped
  // as one blank block at the bottom of the sheet.
  const leftover = Math.max(0, contentHeight - usedHeight);
  const extraRowGap = rows > 1 ? leftover / (rows - 1) : 0;
  const topOffset = rows > 1 ? 0 : leftover / 2;

  const rects: JustifiedRect[] = [];
  let y = topOffset;
  let index = 0;
  let coveredArea = 0;

  for (let r = 0; r < rows; r++) {
    const count = counts[r];
    const rowHeight = naturalHeights[r] * scale;
    const rowGap = gap * scale;
    const rowWidth = availWidth * scale;
    let x = (availWidth - rowWidth) / 2; // centred only when the row had to shrink

    for (let c = 0; c < count; c++) {
      const aspect = Math.max(0.05, aspects[index] || 1);
      const width = aspect * rowHeight;
      rects.push({ x, y, width, height: rowHeight, row: r });
      coveredArea += width * rowHeight;
      x += width + rowGap;
      index++;
    }

    y += rowHeight + gap + extraRowGap;
  }

  const coverage = coveredArea / Math.max(1, availWidth * Math.max(1, contentHeight));
  return { rects, rowCounts: counts, contentHeight, coverage };
}

/**
 * Justified "fill the sheet" solver — the same idea tools like online2pdf use for their
 * multiple-pages-per-sheet output.
 *
 * Instead of dropping pages into a rigid rows x cols grid (which letterboxes every page
 * and leaves the rest of the sheet blank), every row is stretched to the full width and
 * the split into rows is searched so the stack of rows fills the available height as
 * completely as possible. The result: pages come out as large as they can be and the
 * sheet is actually used.
 *
 * With `flexibleHeight` the page height follows the content exactly (used when the page
 * itself may grow "vertical"); otherwise the layout is fitted into a fixed sheet.
 */
export function solveJustifiedFill(
  aspects: number[],
  availWidth: number,
  availHeight: number,
  gap: number,
  opts: {
    flexibleHeight?: boolean;
    maxHeight?: number;
    maxPerRow?: number;
    rowCounts?: number[];
  } = {}
): JustifiedLayoutResult {
  const n = aspects.length;
  const flexibleHeight = opts.flexibleHeight === true;
  const maxHeight = opts.maxHeight ?? availHeight;

  if (n === 0) {
    return { rects: [], rowCounts: [], contentHeight: flexibleHeight ? 0 : availHeight, coverage: 0 };
  }

  // Caller pinned the grid shape (e.g. an explicit custom rows x cols choice)
  if (opts.rowCounts && opts.rowCounts.length > 0) {
    return layoutFromRowCounts(aspects, opts.rowCounts, availWidth, availHeight, gap, flexibleHeight, maxHeight);
  }

  const maxPerRow = Math.max(1, Math.min(opts.maxPerRow ?? 5, n));
  const candidates = buildRowCountCandidates(n, maxPerRow);

  let best: JustifiedLayoutResult | null = null;
  let bestScore = -Infinity;

  for (const counts of candidates) {
    const result = layoutFromRowCounts(aspects, counts, availWidth, availHeight, gap, flexibleHeight, maxHeight);

    // Prefer splits that still look like a tidy grid when quality is otherwise equal
    const irregularity = Math.max(...counts) - Math.min(...counts);

    let score: number;
    if (flexibleHeight) {
      // Page height is free, so aim for a natural A4-ish page that is completely filled
      score = -(Math.abs(result.contentHeight - availHeight) + irregularity * 0.08 * availHeight);
    } else {
      score = result.coverage - irregularity * 0.02;
    }

    if (score > bestScore) {
      bestScore = score;
      best = result;
    }
  }

  return best ?? layoutFromRowCounts(aspects, [n], availWidth, availHeight, gap, flexibleHeight, maxHeight);
}

/**
 * Renders a single PageCard (with 1, 2, 3, or more pages/snippets) onto a high-DPI canvas.
 * WYSIWYG: Clean layout with NO artificial question/solution tags.
 *
 * The canvas WIDTH is always fixed to A4 width, but the HEIGHT is computed from the
 * actual content that needs to be drawn (auto content-fit) instead of always being a
 * fixed A4 height. This removes dead white space below short content, and lets pages
 * with many merged snippets grow taller ("vertical") rather than shrinking every
 * snippet down to fit a fixed-size sheet.
 */
export const renderMergedCardToA4 = async (
  card: PageCard,
  targetWidth: number = Math.round(CANVAS_A4_WIDTH * EXPORT_SCALE),
  maxTargetHeight: number = Math.round(CANVAS_A4_HEIGHT * EXPORT_SCALE * MAX_PAGE_HEIGHT_MULTIPLIER)
): Promise<string> => {
  const scaleFactor = targetWidth / CANVAS_A4_WIDTH;
  const marginX = Math.round(50 * scaleFactor);
  const availableWidth = targetWidth - marginX * 2;
  const marginY = Math.round(50 * scaleFactor);
  // The "natural" A4 content box — used as the shape the auto layout aims for,
  // never as a floor that would pad short content out with blank space.
  const idealContentHeight = Math.round(CANVAS_A4_HEIGHT * scaleFactor) - marginY * 2;

  const items = ensureCardItems(card);

  const finalize = (canvas: HTMLCanvasElement): string => {
    const result = canvas.toDataURL('image/jpeg', 0.94);
    canvas.width = 0;
    canvas.height = 0;
    return result;
  };

  const drawImageEnhanced = (
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    sx: number, sy: number, sw: number, sh: number,
    dx: number, dy: number, dw: number, dh: number
  ) => {
    ctx.save();
    ctx.filter = IMAGE_ENHANCE_FILTER;
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    ctx.restore();
  };

  // Case 1: Standalone Single Item (Unmerged)
  if (items.length <= 1) {
    const item = items[0] || {
      id: `${card.id}-0`,
      pageNum: card.originalPageNum,
      image: card.questionImage,
      scale: 1.0
    };
    const src = item.croppedImage || item.image || card.questionImage;
    if (!src) {
      console.warn('renderMergedCardToA4: Empty image source on card', card.id);
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = Math.round(CANVAS_A4_HEIGHT * scaleFactor);
      const ctx = canvas.getContext('2d');
      if (ctx) { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      return finalize(canvas);
    }
    const img = await loadImage(src);

    const naturalW = img.naturalWidth || 1000;
    const naturalH = img.naturalHeight || 1400;

    const sx = !item.croppedImage && item.crop ? Math.max(0, Math.round((item.crop.x / 100) * naturalW)) : 0;
    const sy = !item.croppedImage && item.crop ? Math.max(0, Math.round((item.crop.y / 100) * naturalH)) : 0;
    const sw = !item.croppedImage && item.crop ? Math.min(naturalW - sx, Math.max(1, Math.round((item.crop.width / 100) * naturalW))) : naturalW;
    const sh = !item.croppedImage && item.crop ? Math.min(naturalH - sy, Math.max(1, Math.round((item.crop.height / 100) * naturalH))) : naturalH;

    const scaleMult = item.scale || 1.0;
    // Fit by width only — the page height auto-adjusts to whatever this produces.
    const fitWidthScale = (availableWidth / Math.max(1, sw)) * scaleMult;
    let drawW = Math.max(1, Math.round(sw * fitWidthScale));
    let drawH = Math.max(1, Math.round(sh * fitWidthScale));

    // Safety cap: never let a single snippet blow past the max page height.
    const maxAvailableHeight = maxTargetHeight - marginY * 2;
    if (drawH > maxAvailableHeight) {
      const shrink = maxAvailableHeight / drawH;
      drawH = Math.max(1, Math.round(drawH * shrink));
      drawW = Math.max(1, Math.round(drawW * shrink));
    }

    // Page follows the content exactly — no padding out to a full sheet
    const contentHeight = drawH;
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = contentHeight + marginY * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create canvas context');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const drawX = Math.max(0, marginX + (availableWidth - drawW) / 2);
    const drawY = marginY;
    drawImageEnhanced(ctx, img, sx, sy, sw, sh, drawX, drawY, drawW, drawH);

    return finalize(canvas);
  }

  // Case 2: Multi-Item Merged Set
  const loaded = await Promise.all(
    items.map(async (item) => {
      const src = item.croppedImage || item.image;
      const img = await loadImage(src);
      const naturalW = img.naturalWidth || 1000;
      const naturalH = img.naturalHeight || 1400;

      const sx = !item.croppedImage && item.crop ? Math.max(0, Math.round((item.crop.x / 100) * naturalW)) : 0;
      const sy = !item.croppedImage && item.crop ? Math.max(0, Math.round((item.crop.y / 100) * naturalH)) : 0;
      const sw = !item.croppedImage && item.crop ? Math.min(naturalW - sx, Math.max(1, Math.round((item.crop.width / 100) * naturalW))) : naturalW;
      const sh = !item.croppedImage && item.crop ? Math.min(naturalH - sy, Math.max(1, Math.round((item.crop.height / 100) * naturalH))) : naturalH;

      const scaleMult = item.scale || 1.0;
      const safeSw = Math.max(1, sw);
      const safeSh = Math.max(1, sh);

      return { img, sx, sy, sw: safeSw, sh: safeSh, scaleMult, aspect: safeSw / safeSh };
    })
  );

  // Subcase 2A: 2 Items (Clean vertical Question + Solution stack with optional divider)
  if (items.length === 2) {
    const gap = Math.round(24 * scaleFactor);
    const dividerHeight = card.showDivider !== false ? Math.round(18 * scaleFactor) : gap;
    const totalDividersHeight = dividerHeight + gap;

    const itemsCalculated = loaded.map(it => {
      const drawW = Math.min(targetWidth - 20, Math.round(availableWidth * it.scaleMult));
      const drawH = Math.round(it.sh * (drawW / it.sw));
      return { ...it, drawW, drawH };
    });

    const totalItemsHeight = itemsCalculated.reduce((sum, it) => sum + it.drawH, 0);
    const naturalTotalHeight = totalItemsHeight + totalDividersHeight;

    // Only shrink if the natural content would exceed the sane max page height;
    // otherwise let the page grow taller to fit both snippets at full size.
    const maxAvailableHeight = maxTargetHeight - marginY * 2;
    let shrinkFactor = 1.0;
    if (naturalTotalHeight > maxAvailableHeight) {
      const spaceForItems = Math.max(100, maxAvailableHeight - totalDividersHeight);
      shrinkFactor = spaceForItems / Math.max(1, totalItemsHeight);
    }

    const contentHeight = Math.round(naturalTotalHeight * shrinkFactor);
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = contentHeight + marginY * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create canvas context');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    let currentY = marginY;
    for (let i = 0; i < itemsCalculated.length; i++) {
      const it = itemsCalculated[i];
      const finalDrawH = Math.max(1, Math.round(it.drawH * shrinkFactor));
      const finalDrawW = Math.max(1, Math.round(it.sw * (finalDrawH / it.sh)));
      const drawX = Math.max(0, marginX + (availableWidth - finalDrawW) / 2);

      drawImageEnhanced(ctx, it.img, it.sx, it.sy, it.sw, it.sh, drawX, currentY, finalDrawW, finalDrawH);
      currentY += finalDrawH + gap;

      if (i === 0 && card.showDivider !== false) {
        ctx.save();
        const lineY = currentY + dividerHeight / 2;
        ctx.strokeStyle = '#CBD5E1';
        ctx.lineWidth = Math.max(1.5, Math.round(1.5 * scaleFactor));
        ctx.beginPath();
        ctx.moveTo(marginX + 20, lineY);
        ctx.lineTo(marginX + availableWidth - 20, lineY);
        ctx.stroke();
        ctx.restore();
        currentY += dividerHeight;
      }
    }

    return finalize(canvas);
  }

  // Subcase 2B: 3 or more items — smart justified fill.
  // Every row is stretched across the full width and the split into rows is solved so
  // the page ends up A4-shaped and completely used: no letterboxing inside slots, no
  // blank band left at the bottom. Fewer items per row = bigger, more readable pages.
  const count = loaded.length;
  const gap = Math.round(18 * scaleFactor);
  const maxAvailableHeight = maxTargetHeight - marginY * 2;

  const layout = solveJustifiedFill(
    loaded.map(it => it.aspect),
    availableWidth,
    idealContentHeight,
    gap,
    {
      flexibleHeight: true,
      maxHeight: maxAvailableHeight,
      maxPerRow: Math.min(count, 4),
    }
  );

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = Math.round(layout.contentHeight) + marginY * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas context');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  for (let idx = 0; idx < count; idx++) {
    const it = loaded[idx];
    const rect = layout.rects[idx];
    if (!rect) continue;

    const drawX = marginX + rect.x;
    const drawY = marginY + rect.y;

    drawImageEnhanced(ctx, it.img, it.sx, it.sy, it.sw, it.sh, drawX, drawY, rect.width, rect.height);

    if (card.showDivider !== false) {
      ctx.save();
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = Math.max(1, Math.round(1 * scaleFactor));
      ctx.strokeRect(drawX, drawY, rect.width, rect.height);
      ctx.restore();
    }
  }

  return finalize(canvas);
};

/**
 * Compiles an array of PageCards into a downloadable PDF
 */
export const exportMergedCardsToPdf = async (
  cards: PageCard[],
  onProgress?: (current: number, total: number) => void
): Promise<Blob> => {
  const pdfDoc = await PDFDocument.create();
  const a4WidthPt = 595.28;
  const a4HeightPt = 841.89;

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    onProgress?.(i + 1, cards.length);

    const dataUrl = await renderMergedCardToA4(card);
    const base64Data = dataUrl.split(',')[1];
    const imageBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

    const embeddedImage = await pdfDoc.embedJpg(imageBytes);

    // Page width is always A4; height follows the rendered content's real aspect ratio
    // (renderMergedCardToA4 now auto-fits its own height), so a page with many merged
    // snippets becomes a taller ("vertical") A4-width sheet instead of shrinking to fit
    // a fixed A4 height, and short single-snippet pages don't carry dead white space.
    const contentAspect = embeddedImage.width / embeddedImage.height;
    const pageHeightPt = Math.max(a4HeightPt * 0.4, a4WidthPt / contentAspect);
    const pdfPage = pdfDoc.addPage([a4WidthPt, pageHeightPt]);

    pdfPage.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width: a4WidthPt,
      height: pageHeightPt,
    });

    // Yield control so export progress updates smoothly on screen
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
};

