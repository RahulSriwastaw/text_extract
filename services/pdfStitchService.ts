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
  return new Blob([pdfBytes], { type: 'application/pdf' });
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
}

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

  const sx = Math.max(0, Math.round((box.x / 100) * img.naturalWidth));
  const sy = Math.max(0, Math.round((box.y / 100) * img.naturalHeight));
  const sw = Math.min(img.naturalWidth - sx, Math.max(1, Math.round((box.width / 100) * img.naturalWidth)));
  const sh = Math.min(img.naturalHeight - sy, Math.max(1, Math.round((box.height / 100) * img.naturalHeight)));

  canvas.width = sw;
  canvas.height = sh;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  return canvas.toDataURL('image/jpeg', 0.95);
};

/**
 * Renders a single PageCard (merged or standalone) onto a high-DPI A4 canvas
 * WYSIWYG: Clean layout with NO artificial question/solution tags.
 */
export const renderMergedCardToA4 = async (
  card: PageCard,
  targetWidth: number = Math.round(CANVAS_A4_WIDTH * EXPORT_SCALE),
  targetHeight: number = Math.round(CANVAS_A4_HEIGHT * EXPORT_SCALE)
): Promise<string> => {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas context');

  // Fill crisp white background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const marginX = Math.round(50 * (targetWidth / CANVAS_A4_WIDTH));
  const availableWidth = targetWidth - marginX * 2;
  const marginY = Math.round(50 * (targetHeight / CANVAS_A4_HEIGHT));
  const availableHeight = targetHeight - marginY * 2;

  // Case 1: Standalone Page (Not merged)
  if (!card.isMerged || (!card.solutionImage && !card.croppedSolutionImage)) {
    const qSrc = card.croppedQuestionImage || card.questionImage;
    const img = await loadImage(qSrc);

    // If pre-rendered cropped image is present, use it directly; else calculate from qCrop
    const sx = !card.croppedQuestionImage && card.qCrop ? Math.max(0, Math.round((card.qCrop.x / 100) * img.naturalWidth)) : 0;
    const sy = !card.croppedQuestionImage && card.qCrop ? Math.max(0, Math.round((card.qCrop.y / 100) * img.naturalHeight)) : 0;
    const sw = !card.croppedQuestionImage && card.qCrop ? Math.min(img.naturalWidth - sx, Math.max(1, Math.round((card.qCrop.width / 100) * img.naturalWidth))) : img.naturalWidth;
    const sh = !card.croppedQuestionImage && card.qCrop ? Math.min(img.naturalHeight - sy, Math.max(1, Math.round((card.qCrop.height / 100) * img.naturalHeight))) : img.naturalHeight;

    const scaleMult = card.qScale || 1.0;
    // Scale up proportionally to fill the printable width of the A4 page
    const fitWidthScale = availableWidth / sw;
    const fitHeightScale = availableHeight / sh;
    // Allow zoom multiplier while ensuring it fits page height
    const chosenScale = Math.min(fitWidthScale * scaleMult, fitHeightScale);
    const drawW = Math.round(sw * chosenScale);
    const drawH = Math.round(sh * chosenScale);

    const drawX = marginX + (availableWidth - drawW) / 2;
    // Align to top margin so cropped question starts at the top of the page (like a real document)
    const drawY = marginY;

    ctx.drawImage(img, sx, sy, sw, sh, drawX, drawY, drawW, drawH);
    return canvas.toDataURL('image/jpeg', 0.94);
  }

  // Case 2: Merged Q&A Page (Question on top, Solution on bottom - NO ARTIFICIAL TAGS)
  const qSrc = card.croppedQuestionImage || card.questionImage;
  const sSrc = card.croppedSolutionImage || card.solutionImage!;
  const qImg = await loadImage(qSrc);
  const sImg = await loadImage(sSrc);

  // Question dimensions
  const qSx = !card.croppedQuestionImage && card.qCrop ? Math.max(0, Math.round((card.qCrop.x / 100) * qImg.naturalWidth)) : 0;
  const qSy = !card.croppedQuestionImage && card.qCrop ? Math.max(0, Math.round((card.qCrop.y / 100) * qImg.naturalHeight)) : 0;
  const qSw = !card.croppedQuestionImage && card.qCrop ? Math.min(qImg.naturalWidth - qSx, Math.max(1, Math.round((card.qCrop.width / 100) * qImg.naturalWidth))) : qImg.naturalWidth;
  const qSh = !card.croppedQuestionImage && card.qCrop ? Math.min(qImg.naturalHeight - qSy, Math.max(1, Math.round((card.qCrop.height / 100) * qImg.naturalHeight))) : qImg.naturalHeight;

  // Solution dimensions
  const sSx = !card.croppedSolutionImage && card.solCrop ? Math.max(0, Math.round((card.solCrop.x / 100) * sImg.naturalWidth)) : 0;
  const sSy = !card.croppedSolutionImage && card.solCrop ? Math.max(0, Math.round((card.solCrop.y / 100) * sImg.naturalHeight)) : 0;
  const sSw = !card.croppedSolutionImage && card.solCrop ? Math.min(sImg.naturalWidth - sSx, Math.max(1, Math.round((card.solCrop.width / 100) * sImg.naturalWidth))) : sImg.naturalWidth;
  const sSh = !card.croppedSolutionImage && card.solCrop ? Math.min(sImg.naturalHeight - sSy, Math.max(1, Math.round((card.solCrop.height / 100) * sImg.naturalHeight))) : sImg.naturalHeight;

  const gap = Math.round(30 * (targetHeight / CANVAS_A4_HEIGHT));
  const dividerHeight = card.showDivider !== false ? Math.round(20 * (targetHeight / CANVAS_A4_HEIGHT)) : gap;

  // Calculate target heights with zoom multipliers
  const maxW = targetWidth - 20;
  const qScaleMult = card.qScale || 1.0;
  const sScaleMult = card.solScale || 1.0;

  let qDrawW = Math.min(maxW, Math.round(availableWidth * qScaleMult));
  let qDrawH = Math.round(qSh * (qDrawW / qSw));

  let sDrawW = Math.min(maxW, Math.round(availableWidth * sScaleMult));
  let sDrawH = Math.round(sSh * (sDrawW / sSw));

  const totalNeededH = qDrawH + sDrawH + dividerHeight + gap;
  if (totalNeededH > availableHeight) {
    const shrink = (availableHeight - dividerHeight - gap) / (qDrawH + sDrawH);
    qDrawH = Math.round(qDrawH * shrink);
    qDrawW = Math.round(qSw * (qDrawH / qSh));
    sDrawH = Math.round(sDrawH * shrink);
    sDrawW = Math.round(sSw * (sDrawH / sSh));
  }

  let currentY = marginY;

  // 1. DRAW QUESTION IMAGE (Top, Centered)
  const qX = marginX + (availableWidth - qDrawW) / 2;
  ctx.drawImage(qImg, qSx, qSy, qSw, qSh, qX, currentY, qDrawW, qDrawH);
  currentY += qDrawH + gap;

  // 2. SUBTLE DIVIDER LINE (Clean separator, NO artificial text badge)
  if (card.showDivider !== false) {
    ctx.save();
    const lineY = currentY + dividerHeight / 2;
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = Math.max(1.5, Math.round(1.5 * (targetWidth / CANVAS_A4_WIDTH)));
    ctx.beginPath();
    ctx.moveTo(marginX + 20, lineY);
    ctx.lineTo(marginX + availableWidth - 20, lineY);
    ctx.stroke();
    ctx.restore();
    currentY += dividerHeight;
  }

  // 3. DRAW SOLUTION IMAGE (Bottom, Centered)
  const sX = marginX + (availableWidth - sDrawW) / 2;
  ctx.drawImage(sImg, sSx, sSy, sSw, sSh, sX, currentY, sDrawW, sDrawH);

  return canvas.toDataURL('image/jpeg', 0.94);
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
    const pdfPage = pdfDoc.addPage([a4WidthPt, a4HeightPt]);

    pdfPage.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width: a4WidthPt,
      height: a4HeightPt,
    });
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes], { type: 'application/pdf' });
};

