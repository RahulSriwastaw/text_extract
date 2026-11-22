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
      shared: entry.shared === true && entry.target === 'question',
      bbox: normalizeFigureBox(Array.isArray(b) ? { ymin: b[0], xmin: b[1], ymax: b[2], xmax: b[3] } : b),
      svg: typeof entry.svg === 'string' && entry.svg.length <= 100000 ? entry.svg : undefined,
      figureRole: entry.figureRole,
    };
    if (!isPageDecoration(figure)) figures.push(figure);
  }
  return figures;
}

/** `image` may be several URLs: manual crops made together for one figure are attached in the order given. */
export function resolveMcqFigure(item: MockTestMcqItem, figure: McqFigure, image?: string | string[]): Partial<MockTestMcqItem> {
  const changes: Partial<MockTestMcqItem> = { figures: item.figures?.filter(f => f.id !== figure.id) };
  for (const url of ([] as string[]).concat(image || []).filter(Boolean)) {
    changes.hash_figure = [...new Set([...(changes.hash_figure ?? item.hash_figure ?? '').split(', ').filter(Boolean), url])].join(', ');
    const tag = figure.target.startsWith('option')
      ? buildOptionFigureTag(url, String.fromCharCode(64 + Number(figure.target.slice(-1))))
      : buildQuestionFigureTag(url, figure.target);
    for (const lang of ['hi', 'en'] as const) {
      const key = `${figure.target}_${lang}` as const;
      const content = changes[key] ?? item[key] ?? '';
      changes[key] = content.includes(tag) ? content : content + tag;
    }
  }
  return changes;
}
