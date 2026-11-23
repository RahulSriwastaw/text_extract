/**
 * Design Studio document model.
 *
 * A DesignDoc is the extracted content split into small typed blocks ("elements": H1, H2,
 * paragraph, question, teaching box…), plus a theme. Everything here is pure (no DOM, no
 * network) so it can be unit-tested and shared by the canvas, the DOCX export and the AI chat.
 *
 * Nothing rewrites the document wholesale. The AI and every manual tool produce DesignOps,
 * and applyDesignOps() validates each one against a fixed vocabulary that both the on-screen
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

export interface BlockStyle {
  color?: string;          // '#RRGGBB'
  background?: string;     // '#RRGGBB'
  align?: 'left' | 'center' | 'right';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  border?: 'none' | 'box' | 'left-bar' | 'underline';
  borderColor?: string;
  font?: FontId;
  /** Images only. */
  width?: 'sm' | 'md' | 'lg' | 'full';
  /** "Every option" group style only: options per row. Unset = the theme's `optionColumns`. */
  columns?: 1 | 2 | 4;
}
export const STYLE_PROPS = ['color', 'background', 'align', 'size', 'bold', 'italic', 'underline', 'border', 'borderColor', 'font', 'width', 'columns'] as const;

/** How many options sit side by side: the "every option" choice, else the theme's. */
export const optionColumnsOf = (theme: Pick<Theme, 'optionColumns' | 'styles'>): 1 | 2 | 4 => theme.styles?.option?.columns || theme.optionColumns;

/**
 * Teaching boxes: a callout with a role. Each has a label (Hindi / English), an icon and a colour,
 * the way textbooks mark "याद रखें", "सावधानी", "क्रियाकलाप".
 */
export const CALLOUTS = {
  note: { en: 'Note', hi: 'नोट', icon: '📝', color: '#2563EB' },
  caution: { en: 'Caution', hi: 'सावधानी', icon: '⚠️', color: '#DC2626' },
  remember: { en: 'Remember', hi: 'याद रखें', icon: '📌', color: '#D97706' },
  definition: { en: 'Definition', hi: 'परिभाषा', icon: '📖', color: '#7C3AED' },
  example: { en: 'Example', hi: 'उदाहरण', icon: '💡', color: '#059669' },
  activity: { en: 'Activity', hi: 'क्रियाकलाप', icon: '🧪', color: '#0891B2' },
  objective: { en: 'Learning objectives', hi: 'सीखने के उद्देश्य', icon: '🎯', color: '#4F46E5' },
  keyterms: { en: 'Key terms', hi: 'मुख्य शब्द', icon: '🔑', color: '#B45309' },
  summary: { en: 'Summary', hi: 'सारांश', icon: '✅', color: '#16A34A' },
  think: { en: 'Think and discuss', hi: 'सोचें और चर्चा करें', icon: '🤔', color: '#9333EA' },
  homework: { en: 'Homework', hi: 'गृहकार्य', icon: '📚', color: '#BE185D' },
} as const;
export type CalloutId = keyof typeof CALLOUTS;
export const CALLOUT_IDS = Object.keys(CALLOUTS) as CalloutId[];

export interface DesignBlock {
  id: string;
  type: BlockType;
  /** Markdown + $LaTeX$, exactly as extraction produced it. */
  text?: string;
  level?: 1 | 2 | 3;       // heading
  variant?: CalloutId;     // callout: which teaching box
  assetId?: string;        // image → doc.assets[assetId]
  style?: BlockStyle;
}

/** How one slide arranges its blocks. */
export const PAGE_LAYOUTS = ['content', 'title', 'section', 'two-column'] as const;
export type PageLayout = typeof PAGE_LAYOUTS[number];

export interface DesignPage {
  id: string;
  title?: string;
  background?: string;
  /** Text size multiplier for this page only (0.55–1): the last resort when one block cannot fit a slide. */
  scale?: number;
  layout?: PageLayout;
  /** Teacher's own notes for this slide; never shown on the slide itself. */
  notes?: string;
  blocks: DesignBlock[];
}

export const MIN_PAGE_SCALE = 0.55;

/**
 * Every kind of element that can be styled as a group ("all H2", "all questions").
 * `title` is a slide's title line; `header` / `footer` are the running page texts.
 */
export const STYLE_KEYS = ['title', 'h1', 'h2', 'h3', 'paragraph', 'list', 'question', 'option', 'answer', 'callout', 'table', 'image', 'header', 'footer'] as const;
export type StyleKey = typeof STYLE_KEYS[number];
export const STYLE_KEY_LABELS: Record<StyleKey, string> = {
  title: 'Slide title', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', paragraph: 'Paragraph', list: 'Bullet list',
  question: 'Question', option: 'Option', answer: 'Answer', callout: 'Teaching box', table: 'Table', image: 'Image',
  header: 'Header', footer: 'Footer',
};

/** Which style group a block belongs to. */
export function styleKey(block: Pick<DesignBlock, 'type' | 'level'>): StyleKey | null {
  if (block.type === 'heading') return ('h' + (block.level || 2)) as StyleKey;
  if (block.type === 'divider') return null;
  return block.type;
}

/** Highlighter pens. `==text==` uses the theme's default pen; `=={green}text==` names one. */
export const HIGHLIGHTERS = {
  yellow: '#FDE68A', green: '#BBF7D0', pink: '#FBCFE8', blue: '#BFDBFE', orange: '#FED7AA', purple: '#DDD6FE',
} as const;
export type HighlighterId = keyof typeof HIGHLIGHTERS;
export const HIGHLIGHTER_IDS = Object.keys(HIGHLIGHTERS) as HighlighterId[];
/** Text on a highlighter is always dark, also on dark themes. */
export const HIGHLIGHT_TEXT = '#111827';

export const DECORATIONS = ['none', 'top-bar', 'bottom-bar', 'left-bar', 'frame'] as const;
export type Decoration = typeof DECORATIONS[number];
export const SPACING = { compact: 0.82, normal: 1, relaxed: 1.25 } as const;
export type SpacingId = keyof typeof SPACING;

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
  /** Per-element overrides ("all H2 are green"), on top of the look the theme gives each element. */
  styles?: Partial<Record<StyleKey, BlockStyle>>;
  /** Default highlighter pen. */
  highlight?: HighlighterId;
  decoration?: Decoration;
  spacing?: SpacingId;
  /** Language of the teaching-box labels. */
  labelLang?: 'hi' | 'en';
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
// Colour helpers
// ---------------------------------------------------------------------------
const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const toHex = (parts: number[]) => '#' + parts.map(c => Math.round(c).toString(16).padStart(2, '0')).join('').toUpperCase();

/** Blend colour `a` toward `b`: mix('#1D4ED8', '#FFFFFF', 0.9) is a very light blue. */
export function mix(a: string, b: string, amount: number): string {
  const x = rgb(a), y = rgb(b);
  return toHex(x.map((c, i) => c + (y[i] - c) * amount));
}
/** Blend toward white (kept for callers that always sit on white). */
export const tint = (hex: string, amount: number) => mix(hex, '#FFFFFF', amount);

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(c => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** White or near-black, whichever reads better on this background. */
export const readableOn = (background: string) => contrast('#FFFFFF', background) >= contrast('#111827', background) ? '#FFFFFF' : '#111827';
/** `color` if it can be read on `background`, otherwise white / near-black. */
export const legible = (color: string, background: string, minimum = 3) => contrast(color, background) >= minimum ? color : readableOn(background);

// ---------------------------------------------------------------------------
// Themes (applied instantly, no AI, no tokens)
// ---------------------------------------------------------------------------
const baseTheme = {
  font: 'sans', baseSize: 12, text: '#1F2937', pageBackground: '#FFFFFF', optionColumns: 1, showPageNumbers: true,
  styles: {}, highlight: 'yellow', decoration: 'none', spacing: 'normal',
} as const;

export const PRESET_THEMES: Theme[] = [
  { ...baseTheme, name: 'Classic', primary: '#111827', accent: '#374151', headingStyle: 'plain', questionStyle: 'plain' },
  { ...baseTheme, name: 'Ocean', primary: '#1D4ED8', accent: '#0EA5E9', headingStyle: 'bar', questionStyle: 'boxed', optionColumns: 2, decoration: 'top-bar' },
  { ...baseTheme, name: 'Sunrise', primary: '#C2410C', accent: '#F59E0B', headingStyle: 'banner', questionStyle: 'numbered-badge', optionColumns: 2 },
  { ...baseTheme, name: 'Forest', primary: '#166534', accent: '#65A30D', headingStyle: 'bar', questionStyle: 'boxed', highlight: 'green' },
  { ...baseTheme, name: 'Royal', primary: '#6D28D9', accent: '#DB2777', headingStyle: 'banner', questionStyle: 'boxed', optionColumns: 2, highlight: 'pink' },
  { ...baseTheme, name: 'Smart Class', primary: '#0F766E', accent: '#F59E0B', headingStyle: 'bar', questionStyle: 'boxed', decoration: 'left-bar', font: 'calibri' },
  { ...baseTheme, name: 'Chalkboard', primary: '#FDE047', accent: '#7DD3FC', text: '#F8FAFC', pageBackground: '#1F3D2B', headingStyle: 'plain', questionStyle: 'plain', font: 'comic', decoration: 'frame' },
  { ...baseTheme, name: 'Night', primary: '#38BDF8', accent: '#F472B6', text: '#E2E8F0', pageBackground: '#0F172A', headingStyle: 'bar', questionStyle: 'boxed', decoration: 'bottom-bar' },
  { ...baseTheme, name: 'Notebook', primary: '#1E3A8A', accent: '#B91C1C', text: '#1F2937', pageBackground: '#FEFCE8', headingStyle: 'plain', questionStyle: 'plain', font: 'kokila', baseSize: 14, decoration: 'left-bar' },
  { ...baseTheme, name: 'Kids', primary: '#EA580C', accent: '#16A34A', pageBackground: '#FFFBEB', headingStyle: 'banner', questionStyle: 'numbered-badge', optionColumns: 2, font: 'comic', decoration: 'frame', highlight: 'orange' },
  { ...baseTheme, name: 'Pastel', primary: '#BE185D', accent: '#7C3AED', pageBackground: '#FDF2F8', headingStyle: 'bar', questionStyle: 'boxed', font: 'utsaah', baseSize: 14, highlight: 'purple' },
  { ...baseTheme, name: 'Exam Paper', font: 'serif', primary: '#000000', accent: '#000000', headingStyle: 'plain', questionStyle: 'plain', optionColumns: 4 },
];

export const SIZE_SCALE: Record<NonNullable<BlockStyle['size']>, number> = { sm: 0.85, md: 1, lg: 1.25, xl: 1.6 };
export const HEADING_SCALE: Record<1 | 2 | 3, number> = { 1: 1.8, 2: 1.4, 3: 1.15 };
/** A slide is read from a distance: the same theme size is shown larger than on an A4 page. */
export const LAYOUT_TEXT_SCALE: Record<Layout, number> = { document: 1, slides: 1.7 };
/** Share of the content width an image may take. */
export const IMAGE_WIDTH: Record<NonNullable<BlockStyle['width']>, number> = { sm: 0.3, md: 0.5, lg: 0.75, full: 1 };

/** Page geometry shared by the canvas and the DOCX export (CSS px at 96 dpi). */
export const PAGE_SIZE: Record<Layout, { width: number; height: number; padding: number }> = {
  document: { width: 794, height: 1123, padding: 56 },   // A4 portrait
  slides: { width: 1280, height: 720, padding: 48 },     // 16:9
};

// ---------------------------------------------------------------------------
// Resolved look of one element: theme defaults → element-type style → the block's own style
// ---------------------------------------------------------------------------
export interface StyleContext {
  layout?: Layout;
  /** page.scale */
  pageScale?: number;
  pageLayout?: PageLayout;
  /** page.background, when the slide has its own */
  pageBackground?: string;
  /** Force a style group (slide title, header, footer) instead of deriving it from the block. */
  key?: StyleKey;
}

export interface ResolvedStyle {
  color: string;
  background?: string;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  italic: boolean;
  underline: boolean;
  border: NonNullable<BlockStyle['border']>;
  borderColor: string;
  sizePt: number;
  font: FontId;
  width: NonNullable<BlockStyle['width']>;
}

/** The colour behind a slide's content. */
export function pageFill(theme: Theme, page?: Pick<DesignPage, 'background' | 'layout'>): string {
  return page?.background || (page?.layout === 'section' ? theme.primary : theme.pageBackground);
}

export function resolveStyle(theme: Theme, block: Pick<DesignBlock, 'type' | 'level' | 'variant' | 'style'>, ctx: StyleContext = {}): ResolvedStyle {
  const layout = ctx.layout || 'document';
  const key = ctx.key || styleKey(block);
  const fill = pageFill(theme, { background: ctx.pageBackground, layout: ctx.pageLayout });
  const special = ctx.pageLayout === 'title' || ctx.pageLayout === 'section';
  const text = legible(theme.text, fill, 4);
  const base = theme.baseSize * LAYOUT_TEXT_SCALE[layout] * (ctx.pageScale || 1);
  const out: ResolvedStyle = {
    color: text, align: special ? 'center' : 'left', bold: false, italic: false, underline: false,
    border: 'none', borderColor: legible(theme.primary, fill, 1.6), sizePt: base, font: theme.font, width: 'md',
  };

  if (key === 'header' || key === 'footer') {
    out.sizePt = 8.5 * (layout === 'slides' ? 1.25 : 1);
    out.color = mix(text, fill, 0.4);
    out.align = 'center';
  } else switch (block.type) {
    case 'heading':
      out.bold = true;
      out.sizePt = base * HEADING_SCALE[block.level || 2] * (ctx.pageLayout === 'section' ? 1.45 : ctx.pageLayout === 'title' ? 1.3 : 1);
      if (special) { out.color = ctx.pageLayout === 'section' ? text : legible(theme.primary, fill, 3); break; }   // a banner inside a cover would fight it
      if (theme.headingStyle === 'banner') { out.background = theme.primary; out.color = readableOn(theme.primary); }
      else out.color = legible(theme.primary, fill, 3);
      if (theme.headingStyle === 'bar') out.border = 'left-bar';
      break;
    case 'question':
      out.bold = true;
      if (theme.questionStyle === 'boxed') { out.border = 'box'; out.background = mix(theme.primary, fill, 0.9); }
      if (theme.questionStyle === 'numbered-badge') out.color = legible(theme.primary, fill, 3);
      break;
    case 'answer':
      out.bold = true; out.color = legible(theme.accent, fill, 3);
      break;
    case 'callout': {
      const tone = block.variant ? CALLOUTS[block.variant].color : theme.accent;
      out.border = 'left-bar'; out.borderColor = legible(tone, fill, 1.6); out.background = mix(tone, fill, 0.88);
      break;
    }
  }

  for (const s of [key ? theme.styles?.[key] : undefined, block.style]) {
    if (!s) continue;
    if (s.color) out.color = s.color;
    if (s.background) out.background = s.background;
    if (s.align) out.align = s.align;
    if (s.bold !== undefined) out.bold = s.bold;
    if (s.italic !== undefined) out.italic = s.italic;
    if (s.underline !== undefined) out.underline = s.underline;
    if (s.border) out.border = s.border;
    if (s.borderColor) out.borderColor = s.borderColor;
    if (s.size) out.sizePt *= SIZE_SCALE[s.size];
    if (s.font) out.font = s.font;
    if (s.width) out.width = s.width;
  }
  // Text must stay readable on whatever ended up behind it.
  if (out.background) out.color = legible(out.color, out.background, 2.5);
  return out;
}

/** Label, icon and colour of a teaching box. The label is dropped when the text already starts with it. */
export function calloutInfo(block: Pick<DesignBlock, 'variant' | 'text'>, theme: Theme) {
  if (!block.variant) return null;
  const c = CALLOUTS[block.variant];
  const label = theme.labelLang === 'hi' ? c.hi : c.en;
  const start = plainText(block.text || '').trim().toLowerCase();
  const repeats = start.startsWith(c.hi) || start.startsWith(c.en.toLowerCase());
  return { icon: c.icon, label: repeats ? '' : label, color: c.color };
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
    theme: { ...PRESET_THEMES[0] },
    pages: [],
    assets: {},
    nextId: 1,
    updatedAt: Date.now(),
  };
}

/** Hindi labels for a mostly-Devanagari document, English otherwise. */
function labelLanguage(blocks: DesignBlock[]): 'hi' | 'en' {
  const sample = blocks.map(b => b.text || '').join(' ').slice(0, 4000);
  const hindi = (sample.match(/[ऀ-ॿ]/g) || []).length, latin = (sample.match(/[A-Za-z]/g) || []).length;
  return hindi > latin ? 'hi' : 'en';
}

const OPTION_SEQUENCES = [
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], ['1', '2', '3', '4', '5', '6', '7', '8'],
  ['i', 'ii', 'iii', 'iv', 'v', 'vi'], ['I', 'II', 'III', 'IV', 'V', 'VI'],
  ['क', 'ख', 'ग', 'घ', 'ङ'], ['अ', 'ब', 'स', 'द', 'इ'],
];

/**
 * "(A) हिगेल (B) कार्ल मार्क्स" → ["(A) हिगेल", "(B) कार्ल मार्क्स"]: one line that holds several
 * options, as papers print them two or four to a row. Splits only at the NEXT label of the same
 * series in the same bracket style ((A)→(B), a)→b), 1.→2., (क)→(ख)), never inside $math$.
 * Returns null when the text holds a single option.
 */
export function splitOptionText(text: string): string[] | null {
  const first = text.match(/^\s*(?:\*\*)?\s*([(\[]?)([A-Za-z]{1,3}|\d|[क-ह])([)\].])/);
  if (!first) return null;
  const [lead, open, label, close] = first;
  const series = OPTION_SEQUENCES.find(s => s.includes(label));
  if (!series) return null;
  const math = [...text.matchAll(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g)].map(m => [m.index!, m.index! + m[0].length]);
  const cuts: number[] = [];
  let from = lead.length;
  for (let i = series.indexOf(label) + 1; i < series.length; i++) {
    const marker = new RegExp(`(?<=\\s)(?:\\*\\*)?${escapeRegExp(open + series[i] + close)}${close === '.' ? '(?=\\s)' : ''}`, 'g');
    marker.lastIndex = from;
    let hit = marker.exec(text);
    while (hit && math.some(([a, b]) => hit!.index > a && hit!.index < b)) hit = marker.exec(text);
    if (!hit) break;
    cuts.push(hit.index);
    from = hit.index + hit[0].length;
  }
  if (!cuts.length) return null;
  const parts = [0, ...cuts].map((start, i) => text.slice(start, cuts[i] ?? text.length).trim());
  // A bold / highlight / math run that crosses two options would be torn in half: leave such a line alone.
  const even = (part: string, token: string) => part.split(token).length % 2 === 1;
  return parts.every(p => p && even(p, '**') && even(p, '==') && even(p, '$')) ? parts : null;
}

/**
 * A table that is really a question's options laid out in a grid, as Word files (and this app's
 * own Word export) hold them: "| (A) फ्रांस (B) जर्मनी | (C) तुर्की (D) यूनान |  |  |".
 * Returns one text per option, or null for a real table. Every filled cell must hold options, and
 * the labels must run A, B, C… from the first of a series, so a "match the columns" table is left alone.
 */
export function optionsFromTable(text: string): string[] | null {
  const cells = text.split('\n').filter(line => line.trim() && !/^\|\s*[-:]+/.test(line.trim()))
    .flatMap(line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|'))
    .map(cell => cell.trim().replace(/^\*\*([^*]+)\*\*$/, '$1').trim()).filter(Boolean);
  if (!cells.length) return null;
  const options = cells.flatMap(cell => splitOptionText(cell) || [cell]);
  const labels = options.map(option => option.match(/^([(\[]?)([A-Za-z]{1,3}|\d|[क-ह])([)\].])/));
  if (options.length < 2 || labels.some(l => !l)) return null;
  const series = OPTION_SEQUENCES.find(s => s[0] === labels[0]![2]);
  const same = labels.every((l, i) => l![1] === labels[0]![1] && l![3] === labels[0]![3] && series?.[i] === l![2]);
  return same ? options : null;
}

/** How many blocks still hold several options together: one line with "(A) … (B) …", or a table of options. */
export const combinedOptionCount = (doc: DesignDoc): number =>
  allBlocks(doc).filter(b => (b.type === 'option' && splitOptionText(b.text || '')) || (b.type === 'table' && optionsFromTable(b.text || ''))).length;

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
      for (const part of splitOptionText(line) || [line]) push('option', part);   // one block per option, so any layout works
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

function finish(doc: DesignDoc, blocks: DesignBlock[]): DesignDoc {
  doc.pages = [{ id: newId(doc, 'p'), blocks }];
  doc.theme = { ...doc.theme, labelLang: labelLanguage(blocks) };
  return doc;
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
  return finish(doc, blocks);
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
      const options = rows.length ? optionsFromTable(rows.join('\n')) : null;
      if (options) {
        for (const option of options) blocks.push({ id: newId(doc, 'b'), type: 'option', text: option });   // a grid of options, not a table
      } else if (rows.length) {
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
  return finish(doc, blocks);
}

/** Add an uploaded picture as an image block (after a block, or at the end of a page). */
export function insertImageBlock(doc: DesignDoc, dataUrl: string, where: { afterBlockId?: string; pageId?: string } = {}): DesignDoc {
  const next: DesignDoc = { ...doc, assets: { ...doc.assets }, pages: doc.pages.map(p => ({ ...p, blocks: [...p.blocks] })), updatedAt: Date.now() };
  const assetId = newId(next, 'a');
  next.assets[assetId] = dataUrl;
  const block: DesignBlock = { id: newId(next, 'b'), type: 'image', assetId };
  const after = where.afterBlockId ? locate(next.pages, where.afterBlockId) : null;
  const page = after?.page || next.pages.find(p => p.id === where.pageId) || next.pages[next.pages.length - 1];
  page.blocks.splice(after ? after.index + 1 : page.blocks.length, 0, block);
  return next;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export const allBlocks = (doc: DesignDoc) => doc.pages.flatMap(p => p.blocks);
export const wordCount = (page: DesignPage) =>
  page.blocks.reduce((n, b) => n + (b.text ? plainText(b.text).replace(/[|#-]+/g, ' ').split(/\s+/).filter(Boolean).length : 0), 0);

/** How many elements of each style group the document has. */
export function elementCounts(doc: DesignDoc): Partial<Record<StyleKey, number>> {
  const out: Partial<Record<StyleKey, number>> = {};
  for (const page of doc.pages) {
    if (page.title) out.title = (out.title || 0) + 1;
    for (const b of page.blocks) { const k = styleKey(b); if (k) out[k] = (out[k] || 0) + 1; }
  }
  if (doc.theme.header) out.header = 1;
  if (doc.theme.footer || doc.theme.showPageNumbers) out.footer = 1;
  return out;
}

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

/**
 * The compact view of the document sent to the AI: ids, types, styles and the
 * start of each text. Never image data.
 *  - pageIds: only these pages (default: all)
 *  - blockIds: only these blocks (one part of a long document)
 *  - fullText: send whole texts, for requests that must read the content
 *    (highlight key terms, bold important words). Costs more tokens.
 *  - maxChars: a total text budget shared by all blocks, for requests that must understand
 *    the whole lesson in ONE call (write a summary, a quiz, objectives).
 */
export function outlineForAi(doc: DesignDoc, options: { pageIds?: string[]; blockIds?: string[]; fullText?: boolean; maxChars?: number; fill?: Record<string, number> } = {}) {
  const { pageIds, fullText = false, fill = {} } = options;
  const wanted = options.blockIds && new Set(options.blockIds);
  const count = allBlocks(doc).length || 1;
  const limit = options.maxChars ? Math.max(100, Math.floor(options.maxChars / count)) : fullText ? 4000 : 160;
  return doc.pages
    .filter(page => (!pageIds || pageIds.includes(page.id)) && (!wanted || page.blocks.some(b => wanted.has(b.id))))
    .map(page => ({
      id: page.id,
      ...(page.title && { title: page.title }),
      ...(page.layout && page.layout !== 'content' && { layout: page.layout }),
      ...(fill[page.id] != null && { fillPercent: Math.round(fill[page.id]) }),
      blocks: page.blocks.filter(b => !wanted || wanted.has(b.id)).map(b => {
        const text = b.text || '';
        return {
          id: b.id, type: b.type,
          ...(b.level && { level: b.level }),
          ...(b.variant && { variant: b.variant }),
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
// Inline emphasis:  **bold**  and  ==highlight==  /  =={green}highlight==  inside a block's text
// ---------------------------------------------------------------------------
export type EmphasisMark = 'bold' | 'highlight' | 'both';
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A highlight span: group 1 = pen name (optional), group 2 = the text (may hold **bold**). */
const highlightRe = () => /==(?:\{([a-z]+)\})?([^=\n]+?)==/g;
const MATH = /(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g;
/** Run `change` on everything except $math$. */
const outsideMath = (text: string, change: (part: string) => string) => text.split(MATH).map((part, i) => i % 2 === 1 ? part : change(part)).join('');
const penOf = (name: string | undefined): HighlighterId | undefined => name && name in HIGHLIGHTERS ? name as HighlighterId : undefined;

/**
 * Wrap every occurrence of each phrase in the text. Math ($…$), existing marks and
 * table separators are left alone, so the content itself never changes.
 */
export function emphasizeText(text: string, phrases: string[], mark: EmphasisMark, pen?: HighlighterId): { text: string; count: number } {
  // Bold goes INSIDE the highlight: Markdown refuses to close "**" when a letter follows punctuation,
  // which happens all the time in Hindi ("==परिवर्तन==ों").
  const start = '==' + (pen ? `{${pen}}` : '');
  const [open, close] = mark === 'bold' ? ['**', '**'] : mark === 'highlight' ? [start, '=='] : [start + '**', '**=='];
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
 * Take marks off. With a phrase, only the marks that touch it (the mark lies inside the
 * phrase, or the phrase inside the mark); without one, every mark in the text.
 */
export function unemphasizeText(text: string, phrase?: string, what: 'all' | 'highlight' | 'bold' = 'all'): string {
  const p = phrase?.trim();
  const touches = (inner: string) => { const plain = inner.replace(/\*\*/g, '').trim(); return !p || plain.includes(p) || p.includes(plain); };
  return outsideMath(text, part => {
    let out = part;
    if (what !== 'bold') out = out.replace(highlightRe(), (m, _pen, inner: string) => touches(inner) ? inner : m);
    if (what !== 'highlight') out = out.replace(/\*\*([^*\n]+)\*\*/g, (m, inner: string) => touches(inner) ? inner : m);
    return out;
  });
}

/**
 * Mark the words the user selected with the mouse. Existing marks on those words are
 * merged instead of nested: highlighting bold words keeps them bold, and bolding
 * highlighted words keeps their pen colour. Returns null when the words are not found
 * as plain text (for example a selection running through an equation).
 */
export function markSelection(text: string, phrase: string, mark: 'bold' | 'highlight', pen?: HighlighterId): string | null {
  const p = phrase.trim();
  if (p.length < 1) return null;
  let wasBold = false, oldPen: HighlighterId | undefined, wasHighlighted = false;
  const touches = (inner: string) => { const plain = inner.replace(/\*\*/g, '').trim(); return plain.includes(p) || p.includes(plain); };
  outsideMath(text, part => {
    for (const m of part.matchAll(highlightRe())) if (touches(m[2])) { wasHighlighted = true; oldPen = penOf(m[1]); if (m[2].includes('**')) wasBold = true; }
    for (const m of part.matchAll(/\*\*([^*\n]+)\*\*/g)) if (touches(m[1])) wasBold = true;
    return part;
  });
  const cleared = unemphasizeText(text, p);
  const highlight = mark === 'highlight' || wasHighlighted;
  const bold = mark === 'bold' || wasBold;
  const result = emphasizeText(cleared, [p], highlight && bold ? 'both' : highlight ? 'highlight' : 'bold', mark === 'highlight' ? pen : oldPen);
  return result.count ? result.text : null;
}

/** Text cut at its highlights, for exports that draw them themselves (Word). */
export function highlightSegments(text: string, defaultPen: HighlighterId = 'yellow'): { text: string; fill?: string; bold?: boolean }[] {
  const out: { text: string; fill?: string; bold?: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(highlightRe())) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    const whole = /^\s*\*\*[^*]+\*\*\s*$/.test(m[2]);
    out.push({ text: whole ? m[2].replace(/\*\*/g, '') : m[2], fill: HIGHLIGHTERS[penOf(m[1]) || defaultPen], bold: whole });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/**
 * For the on-screen preview: **bold** and ==highlight== become Markdown links to
 * "#b" / "#hl" / "#hlb" (bold highlight; "-green" etc. names a pen), which the canvas draws
 * as <strong>/<mark>. Markdown's own "**" refuses to close next to punctuation or right
 * before a letter (very common in Hindi: "**•**कागज", "**परिवर्तन**ों"), and then the stars
 * show up as text. Links always parse. Any star or "==" left without a partner is dropped,
 * so a stray marker can never appear on a page. Math ($…$) is left untouched.
 */
export function emphasisToLinks(text: string): string {
  const link = (inner: string, target: string) => inner.trim() ? `[${inner.replace(/([\[\]])/g, '\\$1')}](#${target})` : inner;
  return outsideMath(text, part => part
    .replace(highlightRe(), (_m, pen: string | undefined, inner: string) => {
      const plain = inner.replace(/\*\*/g, '');
      const suffix = penOf(pen) ? '-' + pen : '';
      return link(plain, (/^\s*\*\*[^*]+\*\*\s*$/.test(inner) ? 'hlb' : 'hl') + suffix);
    })
    .replace(/\*\*([^*\n]+)\*\*/g, (_m, inner: string) => link(inner, 'b'))
    .replace(/\*\*|==/g, ''));
}

/** Drops any "**" that has no partner, so the Word export never prints a stray star. */
export const balanceStars = (text: string) =>
  text.replace(/\*\*([^*\n]+)\*\*/g, '\u0001$1\u0002').replace(/\*\*/g, '').replace(/[\u0001\u0002]/g, '**');

/** Text with the highlight markers removed (bold stays). */
export const stripHighlight = (text: string) => text.replace(highlightRe(), '$2');

/** Text without any bold / highlight markers (labels, word counts). */
export const plainText = (text: string) => stripHighlight(text).replace(/\*\*|==/g, '');

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
  // First block that does not fully fit. In two columns the blocks do not run top to bottom,
  // so the cut is taken in proportion to how far over the slide is.
  let k = page.layout === 'two-column'
    ? Math.min(blocks.length - 1, Math.floor(blocks.length * 100 / percent))
    : blocks.findIndex(b => (bottoms[b.id] ?? 0) > 1);
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
type BlockInput = { type: BlockType; text?: string; level?: 1 | 2 | 3; variant?: CalloutId; style?: BlockStyle };

export type DesignOp =
  | { op: 'setTheme'; patch: Partial<Theme> }
  /** Style every element of one kind ("all H2"). `override` also clears the same properties on single blocks so the group style shows. */
  | { op: 'setElementStyle'; target: StyleKey; style?: BlockStyle; unset?: (keyof BlockStyle)[]; reset?: boolean; override?: boolean }
  | { op: 'styleBlocks'; ids?: string[]; type?: BlockType; pageId?: string; style?: BlockStyle; unset?: (keyof BlockStyle)[]; clear?: boolean }
  | { op: 'updateBlock'; id: string; text?: string; type?: BlockType; level?: 1 | 2 | 3; variant?: CalloutId | null }
  | { op: 'insertBlock'; afterId?: string; pageId?: string; atEnd?: boolean; block: BlockInput }
  | { op: 'duplicateBlock'; id: string }
  | { op: 'removeBlock'; id: string }
  | { op: 'moveBlock'; id: string; afterId?: string; pageId?: string }
  | { op: 'setLayout'; layout: Layout }
  | { op: 'paginate'; pageId?: string; breaks: { beforeBlockId: string; title?: string }[] }
  | { op: 'setPage'; pageId: string; title?: string; background?: string | null; scale?: number; layout?: PageLayout; notes?: string }
  | { op: 'insertSlide'; afterPageId?: string; atStart?: boolean; title?: string; layout?: PageLayout; notes?: string; background?: string; blocks?: BlockInput[] }
  | { op: 'duplicatePage'; pageId: string }
  | { op: 'removePage'; pageId: string }
  | { op: 'movePage'; pageId: string; afterPageId?: string }
  | { op: 'emphasize'; id: string; phrases: string[]; mark?: EmphasisMark; color?: HighlighterId }
  /** Mark exactly the words the user selected. */
  | { op: 'markSelection'; id: string; phrase: string; mark: 'bold' | 'highlight'; color?: HighlighterId }
  /** Remove bold / highlight: from one block (optionally only around a phrase) or, without `id`, from the whole document. */
  | { op: 'clearMarks'; id?: string; phrase?: string; what?: 'all' | 'highlight' | 'bold' }
  /** Change the default pen; `all` also makes every existing highlight use it. */
  | { op: 'setHighlighter'; color: HighlighterId; all?: boolean }
  | { op: 'findReplace'; find: string; replace: string; matchCase?: boolean }
  | { op: 'splitBlock'; id: string }
  /** Option blocks that hold several options ("(A) … (B) …") become one block per option. */
  | { op: 'splitOptions'; ids?: string[]; pageId?: string }
  /** Options per row for the whole document: splits combined option blocks, then sets the layout (and drops any "every option" override). */
  | { op: 'setOptionsLayout'; columns: 1 | 2 | 4 };

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
const styleProps = (v: unknown) => (Array.isArray(v) ? v : []).filter((k): k is keyof BlockStyle => STYLE_PROPS.includes(k));

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
  set('font', oneOf(s.font, FONT_IDS));
  set('width', oneOf(s.width, ['sm', 'md', 'lg', 'full'] as const));
  if (s.columns != null) set('columns', oneOf(Number(s.columns), [1, 2, 4] as const));
  for (const key of ['bold', 'italic', 'underline'] as const) if (typeof s[key] === 'boolean') out[key] = s[key] as boolean;
  return out;
}

function sanitizeElementStyles(input: unknown): Partial<Record<StyleKey, BlockStyle>> {
  const s = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: Partial<Record<StyleKey, BlockStyle>> = {};
  for (const key of STYLE_KEYS) {
    const style = sanitizeStyle(s[key]);
    if (Object.keys(style).length) out[key] = style;
  }
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
  const highlight = oneOf(s.highlight, HIGHLIGHTER_IDS);
  if (highlight) out.highlight = highlight;
  const decoration = oneOf(s.decoration, DECORATIONS);
  if (decoration) out.decoration = decoration;
  const spacing = oneOf(s.spacing, Object.keys(SPACING) as SpacingId[]);
  if (spacing) out.spacing = spacing;
  const labelLang = oneOf(s.labelLang, ['hi', 'en'] as const);
  if (labelLang) out.labelLang = labelLang;
  if (s.styles && typeof s.styles === 'object') out.styles = sanitizeElementStyles(s.styles);
  return out;
}

function locate(pages: DesignPage[], blockId: string) {
  for (const page of pages) {
    const index = page.blocks.findIndex(b => b.id === blockId);
    if (index >= 0) return { page, index };
  }
  return null;
}

/** A new text block from untrusted input (the AI or a form). Never an image. */
function makeBlock(doc: { nextId: number }, input: unknown): DesignBlock | null {
  const b = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const type = oneOf(b.type, BLOCK_TYPES);
  if (!type || type === 'image') return null;
  const block: DesignBlock = { id: newId(doc, 'b'), type, text: text(b.text) ?? '' };
  if (type === 'heading') block.level = oneOf(b.level, [1, 2, 3] as const) || 2;
  if (type === 'callout') { const variant = oneOf(b.variant, CALLOUT_IDS); if (variant) block.variant = variant; }
  const style = sanitizeStyle(b.style);
  if (Object.keys(style).length) block.style = style;
  return block;
}

/** Covers and section dividers are slides in their own right: re-splitting the lesson leaves them alone. */
const isSpecial = (page: DesignPage) => page.layout === 'title' || page.layout === 'section';

/** Split blocks into pages wherever a break names a block. */
function paginateBlocks(doc: DesignDoc, blocks: DesignBlock[], breaks: { beforeBlockId: string; title?: string }[], firstPage: DesignPage): DesignPage[] {
  // A slide that opens with a heading already has its title: a second one would repeat it.
  const headings = new Set(blocks.filter(b => b.type === 'heading').map(b => b.id));
  const titles = new Map(breaks.map(b => [b.beforeBlockId, headings.has(b.beforeBlockId) ? undefined : b.title]));
  const inherit = { ...(firstPage.background ? { background: firstPage.background } : {}), ...(firstPage.layout === 'two-column' ? { layout: firstPage.layout } : {}) };
  const pages: DesignPage[] = [];
  for (const block of blocks) {
    const startsPage = titles.has(block.id);
    if (!pages.length) {
      pages.push({ ...firstPage, blocks: [], ...(startsPage && titles.get(block.id) ? { title: titles.get(block.id) } : {}) });
    } else if (startsPage) {
      const title = titles.get(block.id);
      pages.push({ id: newId(doc, 'p'), blocks: [], ...(title ? { title } : {}), ...inherit });
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
  const blocks = doc.pages.filter(p => !isSpecial(p)).flatMap(p => p.blocks);
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
export function applyDesignOps(doc: DesignDoc, ops: unknown): { doc: DesignDoc; applied: number; skipped: number; unchanged: number } {
  const next: DesignDoc = {
    ...doc,
    theme: { ...doc.theme, styles: { ...doc.theme.styles } },
    pages: doc.pages.map(p => ({ ...p, blocks: p.blocks.map(b => ({ ...b, style: b.style && { ...b.style } })) })),
  };
  let applied = 0, skipped = 0, unchanged = 0;
  const signature = () => JSON.stringify([next.layout, next.theme, next.pages]);
  let before = signature();

  /** Merge a style into one element group; optionally clear the same properties on its blocks. */
  const setGroupStyle = (target: StyleKey, style: BlockStyle, unset: (keyof BlockStyle)[], override: boolean) => {
    const merged: BlockStyle = { ...next.theme.styles?.[target], ...style };
    for (const key of unset) delete merged[key];
    const styles = { ...next.theme.styles };
    if (Object.keys(merged).length) styles[target] = merged; else delete styles[target];
    next.theme = { ...next.theme, styles };
    if (!override) return;
    const cleared = [...Object.keys(style), ...unset] as (keyof BlockStyle)[];
    for (const block of next.pages.flatMap(p => p.blocks)) {
      if (styleKey(block) !== target || !block.style) continue;
      for (const key of cleared) delete block.style[key];
      if (!Object.keys(block.style).length) delete block.style;
    }
  };

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
      case 'setElementStyle': {
        const target = oneOf(o.target, STYLE_KEYS);
        if (!target) break;
        if (o.reset === true) {
          const styles = { ...next.theme.styles };
          delete styles[target];
          next.theme = { ...next.theme, styles };
          ok = true;
          break;
        }
        const style = sanitizeStyle(o.style), unset = styleProps(o.unset);
        if (!Object.keys(style).length && !unset.length) break;
        setGroupStyle(target, style, unset, o.override !== false);
        ok = true;
        break;
      }
      case 'styleBlocks': {
        const style = sanitizeStyle(o.style), unset = styleProps(o.unset);
        const ids = Array.isArray(o.ids) ? new Set(o.ids.map(String)) : null;
        const type = oneOf(o.type, BLOCK_TYPES);
        if ((!Object.keys(style).length && !unset.length && o.clear !== true) || (!ids && !type)) break;
        if (!ids && !o.pageId) {
          // "Every block of this type" is a group style: it also covers blocks added later.
          const targets: StyleKey[] = type === 'heading' ? ['h1', 'h2', 'h3'] : type === 'divider' ? [] : [type as StyleKey];
          for (const target of targets) { setGroupStyle(target, style, unset, true); ok = true; }
          break;
        }
        for (const page of next.pages) {
          if (o.pageId && page.id !== o.pageId) continue;
          for (const block of page.blocks) {
            if (!(ids ? ids.has(block.id) : block.type === type)) continue;
            const merged: BlockStyle = o.clear === true ? {} : { ...block.style, ...style };
            for (const key of unset) delete merged[key];
            if (Object.keys(merged).length) block.style = merged; else delete block.style;
            ok = true;
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
        if (o.variant === null) { delete block.variant; ok = true; }
        else { const variant = oneOf(o.variant, CALLOUT_IDS); if (variant) { block.variant = variant; ok = true; } }
        if (block.type !== 'callout') delete block.variant;
        if (block.type !== 'heading') delete block.level; else if (!block.level) block.level = 2;
        break;
      }
      case 'insertBlock': {
        const block = makeBlock(next, o.block);                  // the AI cannot invent images
        if (!block) break;
        const after = o.afterId ? locate(next.pages, String(o.afterId)) : null;
        const page = after?.page || next.pages.find(p => p.id === o.pageId) || (o.afterId ? null : next.pages[0]);
        if (!page) break;
        page.blocks.splice(after ? after.index + 1 : o.atEnd ? page.blocks.length : 0, 0, block);
        ok = true;
        break;
      }
      case 'duplicateBlock': {
        const found = locate(next.pages, String(o.id));
        if (!found) break;
        const block = found.page.blocks[found.index];
        found.page.blocks.splice(found.index + 1, 0, { ...block, id: newId(next, 'b'), style: block.style && { ...block.style } });
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
          // Re-split the whole lesson. Covers and section slides stay where they are, and a slide
          // that still starts with the same block keeps its notes, background and columns.
          const kept = new Map(next.pages.filter(p => p.blocks[0]).map(p => [p.blocks[0].id, p]));
          const out: DesignPage[] = [];
          let run: DesignPage[] = [];
          const flush = () => {
            if (run.length) out.push(...paginateBlocks(next, run.flatMap(p => p.blocks), breaks, { ...run[0], scale: undefined }));
            run = [];
          };
          for (const page of next.pages) { if (isSpecial(page)) { flush(); out.push(page); } else run.push(page); }
          flush();
          for (const page of out) {
            const before = page.blocks[0] && kept.get(page.blocks[0].id);
            if (!before || isSpecial(page)) continue;
            if (before.notes && !page.notes) page.notes = before.notes;
            if (before.background && !page.background) page.background = before.background;
            if (before.layout === 'two-column') page.layout = 'two-column';
          }
          next.pages = out.length ? out : [{ id: newId(next, 'p'), blocks: [] }];
        }
        ok = true;
        break;
      }
      case 'setPage': {
        const page = next.pages.find(p => p.id === o.pageId);
        if (!page) break;
        const title = text(o.title, 120), background = color(o.background), notes = text(o.notes, 3000), layout = oneOf(o.layout, PAGE_LAYOUTS);
        if (title !== undefined && (!title || page.blocks[0]?.type !== 'heading')) { page.title = title || undefined; ok = true; }
        if (background) { page.background = background; ok = true; }
        else if (o.background === null || o.background === '') { delete page.background; ok = true; }
        if (notes !== undefined) { page.notes = notes.trim() || undefined; ok = true; }
        if (layout) { page.layout = layout === 'content' ? undefined : layout; ok = true; }
        if (Number.isFinite(Number(o.scale)) && o.scale != null) {
          const scale = Math.min(1, Math.max(MIN_PAGE_SCALE, Number(o.scale)));
          page.scale = scale < 1 ? scale : undefined; ok = true;
        }
        break;
      }
      case 'insertSlide': {
        const blocks = (Array.isArray(o.blocks) ? o.blocks : []).slice(0, 24).map((b: unknown) => makeBlock(next, b)).filter(Boolean) as DesignBlock[];
        const title = text(o.title, 120)?.trim();
        const layout = oneOf(o.layout, PAGE_LAYOUTS), notes = text(o.notes, 3000)?.trim(), background = color(o.background);
        // A page with no blocks is dropped at the end, so an "empty" slide gets one line to type into.
        if (!blocks.length) blocks.push({ id: newId(next, 'b'), type: title ? 'paragraph' : 'heading', text: '', ...(title ? {} : { level: 2 as const }) });
        const page: DesignPage = {
          id: newId(next, 'p'), blocks,
          ...(title && blocks[0].type !== 'heading' ? { title } : {}),
          ...(layout && layout !== 'content' ? { layout } : {}), ...(notes ? { notes } : {}), ...(background ? { background } : {}),
        };
        if (title && blocks[0].type === 'heading' && !blocks[0].text) blocks[0].text = title;
        const after = next.pages.findIndex(p => p.id === o.afterPageId);
        next.pages.splice(o.atStart === true ? 0 : after >= 0 ? after + 1 : next.pages.length, 0, page);
        ok = true;
        break;
      }
      case 'duplicatePage': {
        const index = next.pages.findIndex(p => p.id === o.pageId);
        if (index < 0) break;
        const page = next.pages[index];
        next.pages.splice(index + 1, 0, {
          ...page, id: newId(next, 'p'),
          blocks: page.blocks.map(b => ({ ...b, id: newId(next, 'b'), style: b.style && { ...b.style } })),
        });
        ok = true;
        break;
      }
      case 'removePage': {
        const index = next.pages.findIndex(p => p.id === o.pageId);
        if (index < 0 || next.pages.length < 2) break;
        next.pages.splice(index, 1);
        ok = true;
        break;
      }
      case 'movePage': {
        const index = next.pages.findIndex(p => p.id === o.pageId);
        if (index < 0 || o.afterPageId === o.pageId) break;
        const [page] = next.pages.splice(index, 1);
        const after = next.pages.findIndex(p => p.id === o.afterPageId);
        if (o.afterPageId && after < 0) { next.pages.splice(index, 0, page); break; }   // put it back
        next.pages.splice(after + 1, 0, page);
        ok = true;
        break;
      }
      case 'emphasize': {
        const found = locate(next.pages, String(o.id));
        const mark = oneOf(o.mark, ['bold', 'highlight', 'both'] as const) || 'bold';
        if (!found || !Array.isArray(o.phrases)) break;
        const block = found.page.blocks[found.index];
        if (!block.text || block.type === 'image') break;
        const result = emphasizeText(block.text, o.phrases.filter((p: unknown) => typeof p === 'string'), mark, oneOf(o.color, HIGHLIGHTER_IDS));
        if (result.count) { block.text = result.text; ok = true; }
        break;
      }
      case 'markSelection': {
        const found = locate(next.pages, String(o.id));
        const mark = oneOf(o.mark, ['bold', 'highlight'] as const);
        if (!found || !mark || typeof o.phrase !== 'string') break;
        const block = found.page.blocks[found.index];
        const marked = block.text && block.type !== 'image' ? markSelection(block.text, o.phrase, mark, oneOf(o.color, HIGHLIGHTER_IDS)) : null;
        if (marked && marked !== block.text) { block.text = marked; ok = true; }
        break;
      }
      case 'clearMarks': {
        const what = oneOf(o.what, ['all', 'highlight', 'bold'] as const) || 'all';
        const phrase = typeof o.phrase === 'string' ? o.phrase : undefined;
        const targets = o.id ? [locate(next.pages, String(o.id))].filter(Boolean).map(f => f!.page.blocks[f!.index]) : allBlocks(next);
        for (const block of targets) {
          if (!block.text) continue;
          const cleared = unemphasizeText(block.text, phrase, what);
          if (cleared !== block.text) { block.text = cleared; ok = true; }
        }
        break;
      }
      case 'setHighlighter': {
        const pen = oneOf(o.color, HIGHLIGHTER_IDS);
        if (!pen) break;
        next.theme = { ...next.theme, highlight: pen };
        if (o.all === true) for (const block of allBlocks(next)) if (block.text) block.text = block.text.replace(highlightRe(), '==$2==');
        ok = true;
        break;
      }
      case 'findReplace': {
        const find = text(o.find, 200), replacement = text(o.replace, 500) ?? '';
        if (!find) break;
        const pattern = new RegExp(escapeRegExp(find), o.matchCase === true ? 'g' : 'gi');
        const swap = (value: string | undefined) => {
          if (!value) return value;
          const changed = value.replace(pattern, () => replacement);
          if (changed !== value) ok = true;
          return changed;
        };
        for (const page of next.pages) {
          page.title = swap(page.title);
          for (const block of page.blocks) if (block.type !== 'image') block.text = swap(block.text);
        }
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
      case 'splitOptions':
      case 'setOptionsLayout': {
        if (o.op === 'setOptionsLayout') {
          const columns = oneOf(Number(o.columns), [1, 2, 4] as const);
          if (!columns) break;
          const styles = { ...next.theme.styles };
          if (styles.option) {
            const { columns: _dropped, ...rest } = styles.option;
            if (Object.keys(rest).length) styles.option = rest; else delete styles.option;
          }
          next.theme = { ...next.theme, optionColumns: columns, styles };
          ok = true;
        }
        const ids = o.op === 'splitOptions' && Array.isArray(o.ids) ? new Set(o.ids.map(String)) : null;
        for (const page of next.pages) {
          if (o.op === 'splitOptions' && o.pageId && page.id !== o.pageId) continue;
          for (let i = 0; i < page.blocks.length; i++) {
            const block = page.blocks[i];
            if ((block.type !== 'option' && block.type !== 'table') || (ids && !ids.has(block.id))) continue;
            // A table of options (from a Word file) becomes plain option blocks; its table look is dropped.
            const parts = block.type === 'table' ? optionsFromTable(block.text || '') : splitOptionText(block.text || '');
            if (!parts) continue;
            const style = block.type === 'option' && block.style;
            page.blocks.splice(i, 1, ...parts.map((part, k): DesignBlock => ({ id: k ? newId(next, 'b') : block.id, type: 'option', text: part, ...(style && { style: { ...style } }) })));
            i += parts.length - 1;
            ok = true;
          }
        }
        break;
      }
    }
    // An operation that leaves the document exactly as it was is not a change: it must not be reported as one.
    const after = ok ? signature() : before;
    if (!ok) skipped++; else if (after === before) unchanged++; else applied++;
    before = after;
  }

  next.pages = next.pages.filter((p, i, all) => p.blocks.length > 0 || all.length === 1);   // drop pages emptied by moves
  if (applied) next.updatedAt = Date.now();
  return { doc: applied ? next : doc, applied, skipped, unchanged };
}
