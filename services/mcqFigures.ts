import type { McqFigure, MockTestMcqItem } from '../types';
import { isPageDecoration, normalizeFigureBox } from './converterFigures';
import { buildOptionFigureTag, buildQuestionFigureTag } from './figureStorageService';

export function readMcqFigures(raw: unknown): McqFigure[] {
  if (!Array.isArray(raw)) return [];
  const figures: McqFigure[] = [];
  for (const entry of raw) {
    if (!entry || !/^(question|option[1-5]|solution)$/.test(entry.target)) continue;
    const b = entry.bbox;
    const figure: McqFigure = {
      id: 'figure-' + figures.length, type: 'image', target: entry.target,
      sourcePage: Number.isInteger(Number(entry.sourcePage)) && Number(entry.sourcePage) > 0 ? Number(entry.sourcePage) : undefined,
      content: typeof entry.content === 'string' ? entry.content : 'Figure',
      bbox: normalizeFigureBox(Array.isArray(b) ? { ymin: b[0], xmin: b[1], ymax: b[2], xmax: b[3] } : b),
      svg: typeof entry.svg === 'string' && entry.svg.length <= 100000 ? entry.svg : undefined,
      figureRole: entry.figureRole,
    };
    if (!isPageDecoration(figure)) figures.push(figure);
  }
  return figures;
}

export function resolveMcqFigure(item: MockTestMcqItem, figure: McqFigure, image?: string): Partial<MockTestMcqItem> {
  const changes: Partial<MockTestMcqItem> = { figures: item.figures?.filter(f => f.id !== figure.id) };
  if (image) {
    const tag = figure.target.startsWith('option')
      ? buildOptionFigureTag(image, String.fromCharCode(64 + Number(figure.target.slice(-1))))
      : buildQuestionFigureTag(image, figure.target);
    for (const lang of ['hi', 'en'] as const) {
      const key = `${figure.target}_${lang}` as const;
      changes[key] = (item[key] || '') + tag;
    }
  }
  return changes;
}
