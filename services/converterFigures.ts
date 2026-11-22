import type { BoundingBox, ExtractedElement, FigureMode, FigureReview, ScannedPage } from '../types';
import { cropImage } from './pdfUtils';

export function normalizeFigureBox(box?: BoundingBox): BoundingBox | undefined {
  if (!box || ![box.xmin, box.xmax, box.ymin, box.ymax].every(Number.isFinite)) return;
  const xmin = Math.max(0, Math.min(box.xmin, box.xmax));
  const ymin = Math.max(0, Math.min(box.ymin, box.ymax));
  const xmax = Math.min(1000, Math.max(box.xmin, box.xmax));
  const ymax = Math.min(1000, Math.max(box.ymin, box.ymax));
  if (xmax > xmin && ymax > ymin) return { xmin, ymin, xmax, ymax };
}

const svgNS = 'http://www.w3.org/2000/svg';
const tags = new Set('svg g path line polyline polygon rect circle ellipse text tspan title desc'.split(' '));
const attributes = new Set(('xmlns viewBox width height x y x1 y1 x2 y2 dx dy cx cy rx ry r d points transform ' +
  'fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray opacity fill-opacity stroke-opacity ' +
  'fill-rule font-family font-size font-weight font-style text-anchor dominant-baseline').split(' '));

/** Render only self-contained diagram primitives, into the same PNG used for review and Word. */
const safeColor = /^(?:[a-z]+|#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i;

/**
 * Strip (instead of rejecting) anything outside the allowed primitives, so one harmless extra
 * attribute such as id, class, style or version no longer discards an otherwise good AI SVG.
 */
export function sanitizeFigureSvg(source: string): string | undefined {
  if (typeof source !== 'string' || source.length > 100_000) return;
  let text = source.match(/<svg\b[\s\S]*<\/svg>/i)?.[0];
  if (!text) return;
  text = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  if (/<!|<\?/.test(text)) return;
  if (!/^<svg\b[^>]*\sxmlns\s*=/i.test(text)) text = text.replace(/^<svg\b/i, `<svg xmlns="${svgNS}"`);
  const xml = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = xml.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== svgNS || xml.getElementsByTagName('parsererror').length) return;
  const nodes = Array.from(xml.getElementsByTagName('*'));
  if (nodes.length > 1500) return;
  for (const node of nodes) {
    if (!node.parentNode) continue;
    if (node.namespaceURI !== svgNS || !tags.has(node.localName)) { node.parentNode.removeChild(node); continue; }
    const style = node.getAttribute('style');
    if (style) for (const rule of style.split(';')) {
      const [name, ...rest] = rule.split(':');
      const key = name?.trim().toLowerCase(); const value = rest.join(':').trim();
      if (key && value && attributes.has(key) && !node.hasAttribute(key)) node.setAttribute(key, value);
    }
    for (const attr of Array.from(node.attributes)) {
      if (attr.name === 'xmlns') continue;
      if (!attributes.has(attr.name) || (['fill', 'stroke'].includes(attr.name) && !safeColor.test(attr.value.trim()))) node.removeAttribute(attr.name);
    }
  }
  if (!root.getAttribute('viewBox')) {
    const w = parseFloat(root.getAttribute('width') || ''), h = parseFloat(root.getAttribute('height') || '');
    if (w > 0 && h > 0) root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  if (!root.querySelector('path,line,polyline,polygon,rect,circle,ellipse,text')) return;
  return new XMLSerializer().serializeToString(root);
}

export async function renderFigureSvg(source: string): Promise<string | undefined> {
  const clean = sanitizeFigureSvg(source);
  if (!clean) return;
  const root = new DOMParser().parseFromString(clean, 'image/svg+xml').documentElement;
  const box = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) return;
  const scale = 1200 / Math.max(box[2], box[3]);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(box[2] * scale));
  canvas.height = Math.max(1, Math.round(box[3] * scale));
  root.setAttribute('width', String(canvas.width));
  root.setAttribute('height', String(canvas.height));
  const context = canvas.getContext('2d');
  if (!context) return;
  const image = new Image();
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(root));
  await image.decode();
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 0; i < pixels.length; i += 4) {
    if (Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 248) return canvas.toDataURL('image/png');
  }
}

export function isPageDecoration(element: ExtractedElement) {
  if (element.type !== 'image') return false;
  if (['branding', 'watermark', 'decoration'].includes(element.figureRole)) return true;
  const caption = element.content || '';
  if (/\b(?:question|option|solution|passage|identif(?:y|ication)|asked about)\b/i.test(caption)) return false;
  return /^(?:(?:a|an|the)\s+)?(?:background\s+)?watermark\b/i.test(caption)
    || /^(?:photo(?:graph)?|portrait|logo|image)\b.*\b(?:as|used as) (?:a |the )?(?:background )?watermark\b/i.test(caption)
    || /^(?:(?:a|the|circular|publisher|coaching|school|institute|header|footer)\s+)*logo\b.*\b(?:header|footer|banner|branding)\b/i.test(caption);
}

/** One manual crop from the crop dialog: the cropped PNG and the page region (0-1000) it came from. */
export interface FigureCrop { image: string; bbox: BoundingBox }

/**
 * Use the chosen image for a reviewed figure. When the crop dialog returned more boxes than one,
 * each further crop becomes its own figure right after it, in the order the boxes were numbered.
 */
export function applyConverterFigure(page: ScannedPage, figure: ExtractedElement, imageB64: string,
  bbox?: BoundingBox, extra: FigureCrop[] = []): ScannedPage {
  const index = page.elements?.indexOf(figure) ?? -1;
  if (!page.elements || index < 0) return page;
  const taken = new Set(page.elements.map(el => el.id));
  let serial = 2;
  const added = extra.map((crop): ExtractedElement => {
    let id = `${figure.id}_crop${serial++}`;
    while (taken.has(id)) id = `${figure.id}_crop${serial++}`;
    taken.add(id);
    return { id, type: 'image', content: 'Manual crop', bbox: crop.bbox, imageB64: crop.image };
  });
  const elements = [...page.elements];
  elements.splice(index, 1, { id: figure.id, type: 'image', content: figure.content, bbox, imageB64 }, ...added);
  if (!added.length) return { ...page, elements };
  // Keep the preview text in step: one marker per new figure, right after the figure it was cropped with.
  const marker = '[Image: ' + (figure.content || '') + ']';
  let occurrence = page.elements.slice(0, index)
    .filter(el => el.type !== 'text' && el.content === figure.content).length;
  const extractedText = page.extractedText?.split('\n\n').flatMap(block =>
    block === marker && occurrence-- === 0 ? [block, ...added.map(() => '[Image: Manual crop]')] : [block]).join('\n\n');
  return { ...page, elements, extractedText };
}

export function removeConverterFigure(page: ScannedPage, figure: ExtractedElement): ScannedPage {
  if (figure.type !== 'image' || !page.elements?.includes(figure)) return page;
  const marker = '[Image: ' + (figure.content || '') + ']';
  let occurrence = page.elements.slice(0, page.elements.indexOf(figure))
    .filter(el => el.type !== 'text' && el.content === figure.content).length;
  const extractedText = page.extractedText?.split('\n\n').filter(block => block !== marker || occurrence-- !== 0).join('\n\n');
  return { ...page, extractedText, elements: page.elements.filter(el => el !== figure) };
}

export async function prepareConverterFigures(pageImage: string, elements: ExtractedElement[], mode: FigureMode) {
  const prepared: ExtractedElement[] = [];
  for (const element of elements) {
    if (isPageDecoration(element)) continue;
    if (element.type !== 'image' && element.type !== 'table') {
      prepared.push(element);
      continue;
    }
    const bbox = normalizeFigureBox(element.bbox);
    const original = bbox ? await cropImage(pageImage, bbox).catch(() => undefined) : undefined;
    if (element.type === 'table') {
      prepared.push({ ...element, bbox, imageB64: original });
      continue;
    }
    const figureReview: FigureReview = { mode, original };
    if (mode === 'svg' && element.svg) {
      figureReview.recreation = await renderFigureSvg(element.svg).catch(() => undefined);
    }
    prepared.push({ id: element.id, type: 'image', content: element.content, bbox, figureReview });
  }
  return prepared;
}
