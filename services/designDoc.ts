/**
 * Design Studio document model.
 *
 * A DesignDoc is the extracted content split into small typed blocks, plus a theme.
 * Everything here is pure (no DOM, no network) so it can be unit-tested and shared
 * by the canvas, the DOCX export and the AI chat.
 *
 * The AI never rewrites the document: it returns DesignOps, and applyDesignOps()
 * validates each one against a fixed style vocabulary that both the on-screen
 * canvas and the Word export can render.
 */
import type { ExtractedElement } from '../types';
import { classifyLine } from './docxService';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
export type Layout = 'document' | 'slides';
export const BLOCK_TYPES = ['heading', 'paragraph', 'question', 'option', 'answer', 'list', 'table', 'image', 'callout', 'divider'] as const;
export type BlockType = typeof BLOCK_TYPES[number];

export interface BlockStyle {
  color?: string;          // '#RRGGBB'
  background?: string;     // '#RRGGBB'
  align?: 'left' | 'center' | 'right';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  bold?: boolean;
  italic?: boolean;
  border?: 'none' | 'box' | 'left-bar' | 'underline';
  borderColor?: string;
}

export interface DesignBlock {
  id: string;
  type: BlockType;
  /** Markdown + $LaTeX$, exactly as extraction produced it. */
  text?: string;
  level?: 1 | 2 | 3;       // heading
  assetId?: string;        // image → doc.assets[assetId]
  style?: BlockStyle;
}

export interface DesignPage {
  id: string;
  title?: string;
  background?: string;
  /** Text size multiplier for this page only (0.55–1): the last resort when one block cannot fit a slide. */
  scale?: number;
  blocks: DesignBlock[];
}

export const MIN_PAGE_SCALE = 0.55;

/**
 * Font choices. `docx` is the font name written into the Word file (all ship with Windows/Office);
 * `css` is the on-screen stack, ending in a Devanagari-capable fallback.
 */
export const FONTS = {
  sans: { label: 'Arial', docx: 'Arial', css: 'Arial, "Noto Sans Devanagari", "Nirmala UI", sans-serif' },
  serif: { label: 'Times New Roman', docx: 'Times New Roman', css: '"Times New Roman", "Noto Serif Devanagari", Kokila, serif' },
  hindi: { label: 'Nirmala UI (Hindi)', docx: 'Nirmala UI', css: '"Nirmala UI", "Noto Sans Devanagari", Mangal, sans-serif' },
  mangal: { label: 'Mangal (Hindi)', docx: 'Mangal', css: 'Mangal, "Noto Sans Devanagari", "Nirmala UI", sans-serif' },
  kokila: { label: 'Kokila (Hindi, book style)', docx: 'Kokila', css: 'Kokila, "Noto Serif Devanagari", "Nirmala UI", serif' },
  aparajita: { label: 'Aparajita (Hindi, classic)', docx: 'Aparajita', css: 'Aparajita, "Noto Serif Devanagari", "Nirmala UI", serif' },
  utsaah: { label: 'Utsaah (Hindi, modern)', docx: 'Utsaah', css: 'Utsaah, "Noto Sans Devanagari", "Nirmala UI", sans-serif' },
  calibri: { label: 'Calibri', docx: 'Calibri', css: 'Calibri, "Noto Sans Devanagari", "Nirmala UI", sans-serif' },
  cambria: { label: 'Cambria', docx: 'Cambria', css: 'Cambria, "Noto Serif Devanagari", "Nirmala UI", serif' },
  georgia: { label: 'Georgia', docx: 'Georgia', css: 'Georgia, "Noto Serif Devanagari", "Nirmala UI", serif' },
  verdana: { label: 'Verdana', docx: 'Verdana', css: 'Verdana, "Noto Sans Devanagari", "Nirmala UI", sans-serif' },
  comic: { label: 'Comic Sans (friendly)', docx: 'Comic Sans MS', css: '"Comic Sans MS", "Noto Sans Devanagari", "Nirmala UI", cursive' },
} as const;
export type FontId = keyof typeof FONTS;
export const FONT_IDS = Object.keys(FONTS) as FontId[];

export interface Theme {
  name: string;
  font: FontId;
  baseSize: number;        // pt, 9–18
  primary: string;
  accent: string;
  text: string;
  pageBackground: string;
  headingStyle: 'plain' | 'bar' | 'banner';
  questionStyle: 'plain' | 'boxed' | 'numbered-badge';
  optionColumns: 1 | 2 | 4;
  header?: string;
  footer?: string;
  showPageNumbers: boolean;
}

export interface DesignDoc {
  id: string;
  title: string;
  layout: Layout;
  theme: Theme;
  pages: DesignPage[];
  /** Image data URLs, kept out of everything sent to the AI. */
  assets: Record<string, string>;
  /** Counter behind the short ids (b12, p3) that keep AI prompts small. */
  nextId: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Themes (applied instantly, no AI, no tokens)
// ---------------------------------------------------------------------------
const baseTheme = { font: 'sans', baseSize: 12, text: '#1F2937', pageBackground: '#FFFFFF', optionColumns: 1, showPageNumbers: true } as const;

export const PRESET_THEMES: Theme[] = [
  { ...baseTheme, name: 'Classic', primary: '#111827', accent: '#374151', headingStyle: 'plain', questionStyle: 'plain' },
  { ...baseTheme, name: 'Ocean', primary: '#1D4ED8', accent: '#0EA5E9', headingStyle: 'bar', questionStyle: 'boxed', optionColumns: 2 },
  { ...baseTheme, name: 'Sunrise', primary: '#C2410C', accent: '#F59E0B', headingStyle: 'banner', questionStyle: 'numbered-badge', optionColumns: 2 },
  { ...baseTheme, name: 'Forest', primary: '#166534', accent: '#65A30D', headingStyle: 'bar', questionStyle: 'boxed' },
  { ...baseTheme, name: 'Royal', primary: '#6D28D9', accent: '#DB2777', headingStyle: 'banner', questionStyle: 'boxed', optionColumns: 2 },
  { ...baseTheme, name: 'Exam Paper', font: 'serif', primary: '#000000', accent: '#000000', headingStyle: 'plain', questionStyle: 'plain', optionColumns: 4 },
];

export const SIZE_SCALE: Record<NonNullable<BlockStyle['size']>, number> = { sm: 0.85, md: 1, lg: 1.25, xl: 1.6 };
export const HEADING_SCALE: Record<1 | 2 | 3, number> = { 1: 1.8, 2: 1.4, 3: 1.15 };
/** A slide is read from a distance: the same theme size is shown larger than on an A4 page. */
export const LAYOUT_TEXT_SCALE: Record<Layout, number> = { document: 1, slides: 1.7 };

/** Mix a hex colour with white: tint('#1D4ED8', 0.9) is a very light blue for boxes. */
export function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(c => mix(c).toString(16).padStart(2, '0')).join('').toUpperCase();
}

// ---------------------------------------------------------------------------
// Building a doc from extracted elements
// ---------------------------------------------------------------------------
const newId = (doc: { nextId: number }, prefix: 'b' | 'p' | 'a') => prefix + doc.nextId++;

function emptyDoc(title: string): DesignDoc {
  return {
    id: 'design_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: title || 'Untitled design',
    layout: 'document',
    theme: PRESET_THEMES[0],
    pages: [],
    assets: {},
    nextId: 1,
    updatedAt: Date.now(),
  };
}

/** Split Markdown text into typed blocks (question, option, heading, table…). */
export function textToBlocks(doc: { nextId: number }, text: string): DesignBlock[] {
  const blocks: DesignBlock[] = [];
  let open: DesignBlock | null = null;   // block still collecting continuation lines
  const push = (type: BlockType, text: string, extra: Partial<DesignBlock> = {}) => {
    open = { id: newId(doc, 'b'), type, text, ...extra };
    blocks.push(open);
  };

  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) { open = null; continue; }

    const markdownHeading = line.match(/^(#{2,4})\s+(.*)$/);   // '# ' alone is the HASH question style
    const c = classifyLine(line);

    if (c.isTableRow) {
      if (open?.type === 'table') open.text += '\n' + line;
      else push('table', line);
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      push('divider', ''); open = null;
    } else if (markdownHeading) {
      push('heading', markdownHeading[2], { level: Math.min(3, markdownHeading[1].length - 1) as 1 | 2 | 3 }); open = null;
    } else if (c.isHeader) {
      push('heading', c.cleanLineText, { level: 2 }); open = null;
    } else if (c.isAnswerLine) {
      push('answer', line); open = null;
    } else if (c.isMainQuestion) {
      push('question', line);
    } else if (c.isOption) {
      push('option', line);
    } else if (c.isInstruction || c.isBlockquote) {
      push('callout', line.replace(/^>\s*/, ''));
    } else if (/^([-*•]|\d+\))\s+/.test(line) && !c.isMainQuestion) {
      if (open?.type === 'list') open.text += '\n' + line;
      else push('list', line);
    } else if (open && (open.type === 'paragraph' || open.type === 'question' || open.type === 'option' || open.type === 'callout')
      && !c.isMetadata && !c.isSeparator && !c.isFullEquation) {
      open.text += '\n' + line;                                // continuation of the previous block
    } else {
      push('paragraph', line);
      if (c.isMetadata || c.isSeparator) open = null;
    }
  }
  return blocks;
}

/** Extracted elements (from the Text tool) → a one-page document in the Classic theme. */
export function elementsToDesignDoc(elements: ExtractedElement[], title: string): DesignDoc {
  const doc = emptyDoc(title);
  const blocks: DesignBlock[] = [];
  for (const element of elements) {
    if (element.type === 'image') {
      const data = element.imageB64;
      if (!data) continue;
      const assetId = newId(doc, 'a');
      doc.assets[assetId] = data.startsWith('data:') ? data : 'data:image/png;base64,' + data;
      blocks.push({ id: newId(doc, 'b'), type: 'image', assetId });
    } else if (element.content?.trim()) {
      blocks.push(...textToBlocks(doc, element.content));
    }
  }
  doc.pages = [{ id: newId(doc, 'p'), blocks }];
  return doc;
}

/**
 * HTML from an uploaded Word file (mammoth) → document. Only content survives:
 * the original colours/layout and Word equations are not in mammoth's output.
 */
export function htmlToDesignDoc(html: string, title: string): DesignDoc {
  const doc = emptyDoc(title);
  const blocks: DesignBlock[] = [];
  const root = new DOMParser().parseFromString(html, 'text/html').body;

  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (!(node instanceof HTMLElement)) return '';
    const inner = Array.from(node.childNodes).map(inline).join('');
    const tag = node.tagName;
    if (tag === 'BR') return '\n';
    // Bold/italic only around real words: Markdown cannot close "**" after a lone bullet or symbol.
    const hasWord = /[\p{L}\p{N}]/u.test(inner);
    if ((tag === 'STRONG' || tag === 'B') && hasWord) return `**${inner.trim()}**`;
    if ((tag === 'EM' || tag === 'I') && hasWord) return `*${inner.trim()}*`;
    return inner;
  };
  const addImages = (node: Element) => {
    for (const img of Array.from(node.querySelectorAll('img'))) {
      const src = img.getAttribute('src') || '';
      if (!/^data:image\/(png|jpe?g);base64,/.test(src)) continue;
      const assetId = newId(doc, 'a');
      doc.assets[assetId] = src;
      blocks.push({ id: newId(doc, 'b'), type: 'image', assetId });
    }
  };

  for (const node of Array.from(root.children)) {
    const tag = node.tagName;
    const heading = tag.match(/^H([1-6])$/);
    if (heading) {
      // Stray Markdown "#" marks typed into a Word heading would show up as text.
      const text = inline(node).replace(/\s*#{1,6}\s*/g, ' – ').replace(/^ – | – $/g, '').trim();
      if (text) blocks.push({ id: newId(doc, 'b'), type: 'heading', text, level: Math.min(3, Number(heading[1])) as 1 | 2 | 3 });
    } else if (tag === 'UL' || tag === 'OL') {
      const items = Array.from(node.children).map((li, i) => (tag === 'OL' ? `${i + 1})` : '-') + ' ' + inline(li).trim());
      if (items.length) blocks.push({ id: newId(doc, 'b'), type: 'list', text: items.join('\n') });
    } else if (tag === 'TABLE') {
      const rows = Array.from(node.querySelectorAll('tr')).map(tr =>
        '| ' + Array.from(tr.children).map(cell => inline(cell).replace(/\s+/g, ' ').replace(/\|/g, '/').trim()).join(' | ') + ' |');
      if (rows.length) {
        const columns = rows[0].split('|').length - 2;
        blocks.push({ id: newId(doc, 'b'), type: 'table', text: [rows[0], '|' + ' --- |'.repeat(columns), ...rows.slice(1)].join('\n') });
      }
    } else {
      // A typed bullet ("• text") becomes a real list item; neighbours join into one list.
      const text = inline(node).trim().replace(/^[•●▪◦‣·]\s*/, '- ');
      const previous = blocks[blocks.length - 1];
      if (text.startsWith('- ') && previous?.type === 'list') previous.text += '\n' + text;
      else if (text) blocks.push(...textToBlocks(doc, text));
      addImages(node);
    }
  }
  doc.pages = [{ id: newId(doc, 'p'), blocks }];
  return doc;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export const allBlocks = (doc: DesignDoc) => doc.pages.flatMap(p => p.blocks);
export const wordCount = (page: DesignPage) =>
  page.blocks.reduce((n, b) => n + (b.text ? b.text.replace(/[|*=#-]+/g, ' ').split(/\s+/).filter(Boolean).length : 0), 0);

/** Question number for every question block, in reading order (used for badges and the '# ' style). */
export function questionNumbers(doc: DesignDoc): Record<string, number> {
  const out: Record<string, number> = {};
  let n = 0;
  for (const b of allBlocks(doc)) if (b.type === 'question') out[b.id] = ++n;
  return out;
}

/** Text as shown: the '# ' question marker of the HASH numbering style becomes a real number. */
export const displayText = (block: DesignBlock, questionNumber?: number): string =>
  block.type === 'question' && questionNumber ? (block.text || '').replace(/^#\s+/, questionNumber + '. ') : block.text || '';

/** Page geometry shared by the canvas and the DOCX export (CSS px at 96 dpi). */
export const PAGE_SIZE: Record<Layout, { width: number; height: number; padding: number }> = {
  document: { width: 794, height: 1123, padding: 56 },   // A4 portrait
  slides: { width: 1280, height: 720, padding: 48 },     // 16:9
};

/**
 * The compact view of the document sent to the AI: ids, types, styles and the
 * start of each text. Never image data.
 *  - pageIds: only these pages (default: all)
 *  - blockIds: only these blocks (one part of a long document)
 *  - fullText: send whole texts, for requests that must read the content
 *    (highlight key terms, bold important words). Costs more tokens.
 */
export function outlineForAi(doc: DesignDoc, options: { pageIds?: string[]; blockIds?: string[]; fullText?: boolean; fill?: Record<string, number> } = {}) {
  const { pageIds, fullText = false, fill = {} } = options;
  const wanted = options.blockIds && new Set(options.blockIds);
  return doc.pages
    .filter(page => (!pageIds || pageIds.includes(page.id)) && (!wanted || page.blocks.some(b => wanted.has(b.id))))
    .map(page => ({
      id: page.id,
      ...(page.title && { title: page.title }),
      ...(fill[page.id] != null && { fillPercent: Math.round(fill[page.id]) }),
      blocks: page.blocks.filter(b => !wanted || wanted.has(b.id)).map(b => {
        const text = b.text || '';
        const limit = fullText ? 4000 : 160;
        return {
          id: b.id, type: b.type,
          ...(b.level && { level: b.level }),
          ...(text && { text: text.length > limit ? text.slice(0, limit) + '…' : text }),
          ...(b.style && Object.keys(b.style).length > 0 && { style: b.style }),
        };
      }),
    }));
}

/**
 * Groups of consecutive block ids whose full text fits one AI request. A long document
 * is sent in several requests so every block's whole text can be read, and each reply
 * stays small enough for the server's time limit.
 */
export function fullTextChunks(doc: DesignDoc, maxChars = 2200): string[][] {
  const chunks: string[][] = [];
  let size = 0;
  for (const block of allBlocks(doc)) {
    const chars = (block.text?.length || 0) + 40;
    if (!chunks.length || (size + chars > maxChars && chunks[chunks.length - 1].length)) { chunks.push([]); size = 0; }
    chunks[chunks.length - 1].push(block.id);
    size += chars;
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Inline emphasis:  **bold**  and  ==highlight==  inside a block's text
// ---------------------------------------------------------------------------
export type EmphasisMark = 'bold' | 'highlight' | 'both';
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Wrap every occurrence of each phrase in the text. Math ($…$), existing marks and
 * table separators are left alone, so the content itself never changes.
 */
export function emphasizeText(text: string, phrases: string[], mark: EmphasisMark): { text: string; count: number } {
  // Bold goes INSIDE the highlight: Markdown refuses to close "**" when a letter follows punctuation,
  // which happens all the time in Hindi ("==परिवर्तन==ों").
  const [open, close] = mark === 'bold' ? ['**', '**'] : mark === 'highlight' ? ['==', '=='] : ['==**', '**=='];
  let count = 0;
  // Split out the spans that must not be touched; only plain segments are searched.
  const protectedSpan = /(\$\$[\s\S]*?\$\$|\$[^$\n]+\$|==[^=\n]+==|\*\*[^*\n]+\*\*)/g;
  const wanted = [...new Set(phrases.map(p => p.trim()).filter(p => p.length >= 2 && p.length <= 200))].sort((a, b) => b.length - a.length);
  if (!wanted.length) return { text, count };
  // A match always runs to the end of its word. Marking only part of a Hindi word ("परिवर्तन" in
  // "परिवर्तनों") would cut the vowel sign off its consonant and break the rendering.
  const pattern = new RegExp(`(?:${wanted.map(escapeRegExp).join('|')})[\\p{L}\\p{M}]*`, 'gu');
  const out = text.split(protectedSpan).map((part, i) =>
    i % 2 === 1 ? part : part.replace(pattern, match => { count++; return open + match + close; })
  ).join('');
  return { text: out, count };
}

/**
 * For the on-screen preview: **bold** and ==highlight== become Markdown links to
 * "#b" / "#hl" / "#hlb" (bold highlight), which the canvas draws as <strong>/<mark>.
 * Markdown's own "**" refuses to close next to punctuation or right before a letter
 * (very common in Hindi: "**•**कागज", "**परिवर्तन**ों"), and then the stars show up as
 * text. Links always parse. Any star or "==" left without a partner is dropped, so a
 * stray marker can never appear on a page. Math ($…$) is left untouched.
 */
export function emphasisToLinks(text: string): string {
  const link = (inner: string, target: string) => inner.trim() ? `[${inner.replace(/([\[\]])/g, '\\$1')}](#${target})` : inner;
  return text.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g).map((part, i) => {
    if (i % 2 === 1) return part;
    return part
      .replace(/==([^=\n]+)==/g, (_m, inner: string) => {
        const plain = inner.replace(/\*\*/g, '');
        return link(plain, /^\s*\*\*[^*]+\*\*\s*$/.test(inner) ? 'hlb' : 'hl');
      })
      .replace(/\*\*([^*\n]+)\*\*/g, (_m, inner: string) => link(inner, 'b'))
      .replace(/\*\*|==/g, '');
  }).join('');
}

/** Drops any "**" that has no partner, so the Word export never prints a stray star. */
export const balanceStars = (text: string) =>
  text.replace(/\*\*([^*\n]+)\*\*/g, '\u0001$1\u0002').replace(/\*\*/g, '').replace(/[\u0001\u0002]/g, '**');

/** Text without any bold / highlight markers (labels, word counts). */
export const plainText = (text: string) => text.replace(/\*\*|==/g, '');

/** Text with the ==highlight== markers removed (for word counts and plain exports). */
export const stripHighlight = (text: string) => text.replace(/==([^=\n]+)==/g, '$1');

// ---------------------------------------------------------------------------
// Splitting one block in two (when a single block is taller than a slide)
// ---------------------------------------------------------------------------
/** Two halves of a block's text, or null when it cannot be split sensibly. */
export function splitBlockText(block: DesignBlock): [string, string] | null {
  const text = block.text || '';
  if (block.type === 'table') {
    const lines = text.split('\n').filter(Boolean);
    const isSeparator = (l: string) => /^\|\s*[-:]+/.test(l);
    const header = lines.length > 1 && isSeparator(lines[1]) ? lines.slice(0, 2) : [];
    const rows = lines.slice(header.length).filter(l => !isSeparator(l));
    if (rows.length < 2) return null;
    const half = Math.ceil(rows.length / 2);
    return [[...header, ...rows.slice(0, half)].join('\n'), [...header, ...rows.slice(half)].join('\n')];   // header repeats
  }
  if (block.type === 'image' || block.type === 'divider' || block.type === 'heading') return null;
  const halves = (parts: string[], joiner: string): [string, string] | null => {
    if (parts.length < 2) return null;
    const total = parts.join(joiner).length;
    let at = 1, run = parts[0].length;
    while (at < parts.length - 1 && run + parts[at].length / 2 < total / 2) run += parts[at++].length + joiner.length;
    return [parts.slice(0, at).join(joiner), parts.slice(at).join(joiner)];
  };
  return halves(text.split('\n').filter(l => l.trim()), '\n')
    || halves((text.match(/[^।.?!]+[।.?!]+["')\]]*\s*|[^।.?!]+$/g) || []).map(s => s.trim()).filter(Boolean), ' ');
}

/**
 * What to do about one overflowing slide, given where each block ends
 * (bottoms[blockId] = fraction of the slide height; above 1 means it runs off the slide).
 * Tried in order: move later blocks to a new slide, split one oversized block, shrink the text.
 */
export type OverflowFix =
  | { kind: 'break'; beforeBlockId: string }
  | { kind: 'split'; blockId: string }
  | { kind: 'scale'; scale: number }
  | null;

export function planOverflowFix(page: DesignPage, bottoms: Record<string, number>, percent: number): OverflowFix {
  const { blocks } = page;
  if (!blocks.length || percent <= 100) return null;
  // First block that does not fully fit
  let k = blocks.findIndex(b => (bottoms[b.id] ?? 0) > 1);
  if (k < 0) k = blocks.length - 1;

  if (k > 0) {
    // Keep a question together with its options/answer: break before the question when that is possible.
    let at = k;
    if (blocks[at].type === 'option' || blocks[at].type === 'answer') {
      let q = at;
      while (q > 0 && (blocks[q].type === 'option' || blocks[q].type === 'answer' || blocks[q].type === 'image')) q--;
      if (q > 0 && blocks[q].type === 'question') at = q;
    }
    // Never leave a heading alone at the bottom of a slide.
    if (at > 1 && blocks[at - 1].type === 'heading') at--;
    return { kind: 'break', beforeBlockId: blocks[at].id };
  }

  // The very first block is already too tall.
  if (splitBlockText(blocks[0])) return { kind: 'split', blockId: blocks[0].id };
  if (blocks.length > 1) return { kind: 'break', beforeBlockId: blocks[1].id };
  const current = page.scale || 1;
  const scale = Math.max(MIN_PAGE_SCALE, Math.floor(current * (100 / percent) * 0.97 * 100) / 100);
  return scale < current ? { kind: 'scale', scale } : null;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------
export type DesignOp =
  | { op: 'setTheme'; patch: Partial<Theme> }
  | { op: 'styleBlocks'; ids?: string[]; type?: BlockType; pageId?: string; style: BlockStyle }
  | { op: 'updateBlock'; id: string; text?: string; type?: BlockType; level?: 1 | 2 | 3 }
  | { op: 'insertBlock'; afterId?: string; pageId?: string; block: { type: BlockType; text?: string; level?: 1 | 2 | 3; style?: BlockStyle } }
  | { op: 'removeBlock'; id: string }
  | { op: 'moveBlock'; id: string; afterId?: string; pageId?: string }
  | { op: 'setLayout'; layout: Layout }
  | { op: 'paginate'; pageId?: string; breaks: { beforeBlockId: string; title?: string }[] }
  | { op: 'setPage'; pageId: string; title?: string; background?: string; scale?: number }
  | { op: 'emphasize'; id: string; phrases: string[]; mark?: EmphasisMark }
  | { op: 'splitBlock'; id: string };

const HEX = /^#[0-9a-fA-F]{6}$/;
const color = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (HEX.test(s)) return s.toUpperCase();
  const short = s.match(/^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/);
  return short ? ('#' + short[1] + short[1] + short[2] + short[2] + short[3] + short[3]).toUpperCase() : undefined;
};
const oneOf = <T>(v: unknown, allowed: readonly T[]): T | undefined => allowed.includes(v as T) ? v as T : undefined;
const text = (v: unknown, max = 20000): string | undefined => typeof v === 'string' ? v.slice(0, max) : undefined;

/** Keep only the style keys and values the canvas and the DOCX export both understand. */
export function sanitizeStyle(input: unknown): BlockStyle {
  const s = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: BlockStyle = {};
  const set = <K extends keyof BlockStyle>(key: K, value: BlockStyle[K] | undefined) => { if (value !== undefined) out[key] = value; };
  set('color', color(s.color));
  set('background', color(s.background));
  set('borderColor', color(s.borderColor));
  set('align', oneOf(s.align, ['left', 'center', 'right'] as const));
  set('size', oneOf(s.size, ['sm', 'md', 'lg', 'xl'] as const));
  set('border', oneOf(s.border, ['none', 'box', 'left-bar', 'underline'] as const));
  if (typeof s.bold === 'boolean') out.bold = s.bold;
  if (typeof s.italic === 'boolean') out.italic = s.italic;
  return out;
}

export function sanitizeThemePatch(input: unknown): Partial<Theme> {
  const s = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: Partial<Theme> = {};
  for (const key of ['primary', 'accent', 'text', 'pageBackground'] as const) {
    const c = color(s[key]);
    if (c) out[key] = c;
  }
  const font = oneOf(s.font, FONT_IDS);
  if (font) out.font = font;
  const headingStyle = oneOf(s.headingStyle, ['plain', 'bar', 'banner'] as const);
  if (headingStyle) out.headingStyle = headingStyle;
  const questionStyle = oneOf(s.questionStyle, ['plain', 'boxed', 'numbered-badge'] as const);
  if (questionStyle) out.questionStyle = questionStyle;
  const optionColumns = oneOf(Number(s.optionColumns), [1, 2, 4] as const);
  if (optionColumns) out.optionColumns = optionColumns;
  if (Number.isFinite(Number(s.baseSize)) && s.baseSize != null) out.baseSize = Math.min(18, Math.max(9, Math.round(Number(s.baseSize))));
  if (typeof s.showPageNumbers === 'boolean') out.showPageNumbers = s.showPageNumbers;
  for (const key of ['name', 'header', 'footer'] as const) {
    const t = text(s[key], 120);
    if (t !== undefined) out[key] = t;
  }
  return out;
}

function locate(pages: DesignPage[], blockId: string) {
  for (const page of pages) {
    const index = page.blocks.findIndex(b => b.id === blockId);
    if (index >= 0) return { page, index };
  }
  return null;
}

/** Split blocks into pages wherever a break names a block. */
function paginateBlocks(doc: DesignDoc, blocks: DesignBlock[], breaks: { beforeBlockId: string; title?: string }[], firstPage: DesignPage): DesignPage[] {
  // A slide that opens with a heading already has its title: a second one would repeat it.
  const headings = new Set(blocks.filter(b => b.type === 'heading').map(b => b.id));
  const titles = new Map(breaks.map(b => [b.beforeBlockId, headings.has(b.beforeBlockId) ? undefined : b.title]));
  const pages: DesignPage[] = [];
  for (const block of blocks) {
    const startsPage = titles.has(block.id);
    if (!pages.length) {
      pages.push({ ...firstPage, blocks: [], ...(startsPage && titles.get(block.id) ? { title: titles.get(block.id) } : {}) });
    } else if (startsPage) {
      const title = titles.get(block.id);
      pages.push({ id: newId(doc, 'p'), blocks: [], ...(title ? { title } : {}), ...(firstPage.background ? { background: firstPage.background } : {}) });
    }
    pages[pages.length - 1].blocks.push(block);
  }
  return pages.length ? pages : [{ ...firstPage, blocks: [] }];
}

/**
 * One slide per question (with its options, answer and figure), a new slide at
 * every heading, and at most `maxBlocks` plain blocks per slide. No AI involved.
 */
export function autoPaginate(doc: DesignDoc, maxBlocks = 6): DesignDoc {
  const blocks = allBlocks(doc);
  const breaks: { beforeBlockId: string }[] = [];
  let count = 0;
  blocks.forEach((block, i) => {
    const startsGroup = block.type === 'question' || (block.type === 'heading' && blocks[i + 1]?.type !== 'question');
    const afterHeading = blocks[i - 1]?.type === 'heading';
    // A figure right after a question's options/answer stays on that question's slide.
    const full = count >= maxBlocks + (block.type === 'image' || block.type === 'answer' ? 2 : 0);
    if (i > 0 && !afterHeading && (startsGroup || full)) { breaks.push({ beforeBlockId: block.id }); count = 0; }
    count++;
  });
  return applyDesignOps(doc, [{ op: 'paginate', breaks }]).doc;
}

/**
 * Apply AI (or UI) operations. Invalid ops are skipped, never thrown: an unknown
 * id, colour or enum simply does nothing. Returns a new doc; `doc` is not mutated.
 */
export function applyDesignOps(doc: DesignDoc, ops: unknown): { doc: DesignDoc; applied: number; skipped: number } {
  const next: DesignDoc = {
    ...doc,
    theme: { ...doc.theme },
    pages: doc.pages.map(p => ({ ...p, blocks: p.blocks.map(b => ({ ...b, style: b.style && { ...b.style } })) })),
  };
  let applied = 0, skipped = 0;

  for (const raw of Array.isArray(ops) ? ops : []) {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
    let ok = false;

    switch (o.op) {
      case 'setTheme': {
        const patch = sanitizeThemePatch(o.patch);
        ok = Object.keys(patch).length > 0;
        if (ok) next.theme = { ...next.theme, ...patch };
        break;
      }
      case 'styleBlocks': {
        const style = sanitizeStyle(o.style);
        const ids = Array.isArray(o.ids) ? new Set(o.ids.map(String)) : null;
        const type = oneOf(o.type, BLOCK_TYPES);
        if (!Object.keys(style).length || (!ids && !type)) break;
        for (const page of next.pages) {
          if (o.pageId && page.id !== o.pageId) continue;
          for (const block of page.blocks) {
            if (ids ? ids.has(block.id) : block.type === type) { block.style = { ...block.style, ...style }; ok = true; }
          }
        }
        break;
      }
      case 'updateBlock': {
        const found = locate(next.pages, String(o.id));
        if (!found) break;
        const block = found.page.blocks[found.index];
        const newText = text(o.text), type = oneOf(o.type, BLOCK_TYPES), level = oneOf(o.level, [1, 2, 3] as const);
        if (newText !== undefined && block.type !== 'image') { block.text = newText; ok = true; }
        if (type && type !== 'image' && block.type !== 'image') { block.type = type; ok = true; }
        if (level) { block.level = level; ok = true; }
        break;
      }
      case 'insertBlock': {
        const b = (o.block && typeof o.block === 'object' ? o.block : {}) as Record<string, unknown>;
        const type = oneOf(b.type, BLOCK_TYPES);
        if (!type || type === 'image') break;                    // the AI cannot invent images
        const block: DesignBlock = { id: newId(next, 'b'), type, text: text(b.text) ?? '' };
        const level = oneOf(b.level, [1, 2, 3] as const);
        if (type === 'heading') block.level = level || 2;
        const style = sanitizeStyle(b.style);
        if (Object.keys(style).length) block.style = style;
        const after = o.afterId ? locate(next.pages, String(o.afterId)) : null;
        const page = after?.page || next.pages.find(p => p.id === o.pageId) || (o.afterId ? null : next.pages[0]);
        if (!page) break;
        page.blocks.splice(after ? after.index + 1 : 0, 0, block);
        ok = true;
        break;
      }
      case 'removeBlock': {
        const found = locate(next.pages, String(o.id));
        if (found) { found.page.blocks.splice(found.index, 1); ok = true; }
        break;
      }
      case 'moveBlock': {
        const found = locate(next.pages, String(o.id));
        if (!found || o.afterId === o.id) break;
        const [block] = found.page.blocks.splice(found.index, 1);
        const after = o.afterId ? locate(next.pages, String(o.afterId)) : null;
        const page = after?.page || next.pages.find(p => p.id === o.pageId);
        if (!page) { found.page.blocks.splice(found.index, 0, block); break; }   // put it back
        page.blocks.splice(after ? after.index + 1 : 0, 0, block);
        ok = true;
        break;
      }
      case 'setLayout': {
        const layout = oneOf(o.layout, ['document', 'slides'] as const);
        if (layout) { next.layout = layout; ok = true; }
        break;
      }
      case 'paginate': {
        const known = new Set(allBlocks(next).map(b => b.id));
        const breaks = (Array.isArray(o.breaks) ? o.breaks : [])
          .filter((b: any) => b && known.has(String(b.beforeBlockId)))
          .map((b: any) => ({ beforeBlockId: String(b.beforeBlockId), title: text(b.title, 120) }));
        const target = o.pageId ? next.pages.findIndex(p => p.id === o.pageId) : -1;
        if (o.pageId && target < 0) break;
        if (target >= 0) {
          const page = next.pages[target];
          next.pages.splice(target, 1, ...paginateBlocks(next, page.blocks, breaks, page));
        } else {
          next.pages = paginateBlocks(next, allBlocks(next), breaks, next.pages[0] || { id: newId(next, 'p'), blocks: [] });
        }
        ok = true;
        break;
      }
      case 'setPage': {
        const page = next.pages.find(p => p.id === o.pageId);
        if (!page) break;
        const title = text(o.title, 120), background = color(o.background);
        if (title !== undefined && (!title || page.blocks[0]?.type !== 'heading')) { page.title = title || undefined; ok = true; }
        if (background) { page.background = background; ok = true; }
        if (Number.isFinite(Number(o.scale)) && o.scale != null) {
          const scale = Math.min(1, Math.max(MIN_PAGE_SCALE, Number(o.scale)));
          page.scale = scale < 1 ? scale : undefined; ok = true;
        }
        break;
      }
      case 'emphasize': {
        const found = locate(next.pages, String(o.id));
        const mark = oneOf(o.mark, ['bold', 'highlight', 'both'] as const) || 'bold';
        if (!found || !Array.isArray(o.phrases)) break;
        const block = found.page.blocks[found.index];
        if (!block.text || block.type === 'image') break;
        const result = emphasizeText(block.text, o.phrases.filter((p: unknown) => typeof p === 'string'), mark);
        if (result.count) { block.text = result.text; ok = true; }
        break;
      }
      case 'splitBlock': {
        const found = locate(next.pages, String(o.id));
        if (!found) break;
        const block = found.page.blocks[found.index];
        const halves = splitBlockText(block);
        if (!halves) break;
        block.text = halves[0];
        // The second half goes right after the first; the next overflow pass moves it to its own slide.
        found.page.blocks.splice(found.index + 1, 0, { ...block, id: newId(next, 'b'), text: halves[1], style: block.style && { ...block.style } });
        ok = true;
        break;
      }
    }
    ok ? applied++ : skipped++;
  }

  next.pages = next.pages.filter((p, i, all) => p.blocks.length > 0 || all.length === 1);   // drop pages emptied by moves
  if (applied) next.updatedAt = Date.now();
  return { doc: applied ? next : doc, applied, skipped };
}
