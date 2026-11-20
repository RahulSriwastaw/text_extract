import type { BoundingBox, ExtractedElement, FigureMode, FigureReview } from '../types';
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
async function renderFigureSvg(source: string): Promise<string | undefined> {
  if (typeof source !== 'string' || source.length > 100_000 || /<!|<\?/.test(source)) return;
  const xml = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = xml.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== svgNS || !root.querySelector('path,line,polyline,polygon,rect,circle,ellipse,text')) return;
  const nodes = xml.getElementsByTagName('*');
  if (nodes.length > 1500) return;
  for (const node of nodes) {
    if (node.namespaceURI !== svgNS || !tags.has(node.tagName)) return;
    for (const attr of node.attributes) {
      if (!attributes.has(attr.name)) return;
      if (['fill', 'stroke'].includes(attr.name) && !/^(?:[a-z]+|#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(attr.value)) return;
    }
  }
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

export async function prepareConverterFigures(pageImage: string, elements: ExtractedElement[], mode: FigureMode) {
  const prepared: ExtractedElement[] = [];
  for (const element of elements) {
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
