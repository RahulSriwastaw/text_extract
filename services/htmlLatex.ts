/**
 * htmlLatex.ts
 *
 * Single source of truth for the "HTML + LaTeX" content format used by the MockTest
 * MCQ extractor (stored fields, CSV/DOCX export, AI prompts and KaTeX rendering).
 *
 * Format contract:
 *  - Structure is clean, sanitized HTML: <p>, <br>, <b>, <i>, <u>, <sup>, <sub>, lists, tables, <img>.
 *  - All math is LaTeX: inline $...$ and display $$...$$ (\(...\) and \[...\] are normalized to $ / $$).
 *  - Math never contains HTML; < and > inside math are written as \lt / \gt so the HTML stays valid.
 *
 * Pure string code (no DOM), so it runs identically on the Node server and in the browser.
 */

/** Prompt block shared by every AI prompt that generates or repairs MCQ content. */
export const HTML_LATEX_FORMAT_RULES = `- OUTPUT FORMAT = CLEAN HTML + LaTeX (the app renders it with KaTeX):
  * Wrap every paragraph of question stems and solutions in <p>...</p>; use <br> for a line break inside a paragraph. Each option is a single <p>...</p>.
  * Allowed tags only: <p>, <br>, <b>, <i>, <u>, <sup>, <sub>, <ul>, <ol>, <li>, <table>, <tr>, <th>, <td>. No <div>/<span>, no style/class attributes, no Markdown (**, |---|) and no code fences.
  * Statement lists (I, II, III), Match-the-Following columns and data tables MUST be real HTML (<ol>/<ul> or <table> with <tr>/<th>/<td>), never ASCII art.
  * ALL mathematical/scientific notation goes in LaTeX: inline $...$ and display $$...$$ (e.g. $\\frac{a}{b}$, $\\sqrt{x}$, $x^{2}$, $H_{2}O$, $\\times$, $\\theta$, $0.\\overline{3}$). Never use \\(...\\) or \\[...\\], and never write math with Unicode (½, √, ²) or <sup>/<sub>.
  * Never put HTML tags inside $...$; inside math write \\lt and \\gt instead of < and >.
  * Plain words, units, plain numbers and currency stay as normal text outside $...$ (e.g. "40 km/h", "₹500").
  * JSON safety: double every LaTeX backslash inside JSON strings (e.g. "$\\\\frac{1}{2}$") and never put double quotes inside HTML tags (tags need no attributes).`;

// ---------------------------------------------------------------------------
// Inline SVG support
// ---------------------------------------------------------------------------

const SVG_BLOCK_RE = /<svg\b[\s\S]*?<\/svg\s*>/gi;

function svgToDataUri(svg: string): string {
  let s = svg.trim();
  // Never keep active content; an <img> data URI cannot run scripts anyway, this is belt and braces.
  s = s.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  s = s.replace(/&nbsp;/g, '&#160;');
  if (!/^<svg[^>]*\sxmlns\s*=/i.test(s)) s = s.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (/xlink:/i.test(s) && !/xmlns:xlink/i.test(s)) s = s.replace(/^<svg/i, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  const enc = encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `data:image/svg+xml;charset=utf-8,${enc}`;
}

/** Converts inline <svg>…</svg> blocks into <img> tags with an SVG data URI (renders safely everywhere). */
export function svgBlocksToImg(text: string): string {
  if (!text || !/<svg\b/i.test(text)) return text;
  return text.replace(SVG_BLOCK_RE, svg => `<img src="${svgToDataUri(svg)}" alt="figure" class="svg-figure">`);
}

/** Same as svgBlocksToImg but emits Markdown image syntax (for ReactMarkdown previews). */
export function svgBlocksToMarkdown(text: string): string {
  if (!text || !/<svg\b/i.test(text)) return text;
  return text.replace(SVG_BLOCK_RE, svg => `\n\n![figure](${svgToDataUri(svg)})\n\n`);
}

// ---------------------------------------------------------------------------
// Math protection
// ---------------------------------------------------------------------------

export interface MathSegment {
  tex: string;
  display: boolean;
}

const PH_OPEN = '';
const PH_CLOSE = '';
const PLACEHOLDER_RE = /(\d+)/g;

/**
 * $$...$$ | \[...\] | \(...\) | $...$ (single-line, not escaped, closing $ not followed by a digit
 * so "costs $5 and $10" is not treated as math).
 */
const MATH_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![\\$])\$(?!\$)((?:\\\$|[^$\n])+?)\$(?!\d)/g;

/** Replaces every math segment with a private-use placeholder so HTML processing never touches TeX. */
export function protectMath(text: string): { text: string; math: MathSegment[] } {
  const math: MathSegment[] = [];
  const out = text.replace(MATH_RE, (whole, dd, br, pa, sd) => {
    const display = dd !== undefined || br !== undefined;
    const tex = (dd ?? br ?? pa ?? sd ?? '').trim();
    if (!tex) return whole;
    math.push({ tex, display });
    return `${PH_OPEN}${math.length - 1}${PH_CLOSE}`;
  });
  return { text: out, math };
}

export function restoreMath(text: string, math: MathSegment[], render: (seg: MathSegment) => string): string {
  return text.replace(PLACEHOLDER_RE, (whole, idx) => {
    const seg = math[Number(idx)];
    return seg ? render(seg) : whole;
  });
}

/** Cleans TeX so it is KaTeX-valid and safe to embed in HTML text. */
export function normalizeMathTex(tex: string): string {
  let t = tex;
  // HTML that leaked inside math
  t = t.replace(/<br\s*\/?>/gi, ' \\\\ ');
  t = t.replace(/<sup>([\s\S]*?)<\/sup>/gi, '^{$1}');
  t = t.replace(/<sub>([\s\S]*?)<\/sub>/gi, '_{$1}');
  t = t.replace(/<\/?[a-zA-Z][a-zA-Z0-9]*\b[^<>]*>/g, '');
  // Entities
  t = t
    .replace(/&nbsp;/gi, '~')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  // Raw comparison signs would break the surrounding HTML
  t = t.replace(/\s*<\s*=/g, ' \\le ').replace(/\s*>\s*=/g, ' \\ge ');
  t = t.replace(/</g, ' \\lt ').replace(/>/g, ' \\gt ');
  // KaTeX has no align/gather/cosec
  t = t
    .replace(/\\begin\{align\*?\}/g, '\\begin{aligned}')
    .replace(/\\end\{align\*?\}/g, '\\end{aligned}')
    .replace(/\\begin\{gather\*?\}/g, '\\begin{gathered}')
    .replace(/\\end\{gather\*?\}/g, '\\end{gathered}')
    .replace(/\\cosec\b/g, '\\csc');
  // Unescaped % would comment out the rest of the formula
  t = t.replace(/(?<!\\)%/g, '\\%');
  return t.replace(/[ \t]{2,}/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// HTML sanitizing + structuring
// ---------------------------------------------------------------------------

const INLINE_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'sup', 'sub', 'mark', 'small', 'span', 'code', 'br', 'img']);
const BLOCK_TAGS = new Set([
  'p', 'div', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);
const VOID_TAGS = new Set(['br', 'img', 'hr']);
/** Known tags that are removed but whose text is kept. */
const UNWRAP_TAGS = new Set([
  'a', 'font', 'center', 'section', 'article', 'header', 'footer', 'main', 'nav', 'figure',
  'figcaption', 'label', 'big', 'tt', 'abbr', 'cite', 'del', 'ins', 'strike', 'html', 'body',
  'o:p', 'colgroup', 'col', 'wbr', 'meta', 'link',
]);
/** Removed together with their content. */
const DROP_WITH_CONTENT_RE = /<(script|style|iframe|object|embed|noscript|title|head|template|textarea|select|button|svg|math)\b[\s\S]*?<\/\1\s*>/gi;
const DROP_SINGLE_RE = /<\/?(?:script|style|iframe|object|embed|noscript|title|head|template|textarea|select|button|input|form|svg|math)\b[^<>]*>/gi;

const ALLOWED_ATTRS: Record<string, string[]> = {
  img: ['src', 'alt', 'width', 'height', 'style'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
  ol: ['start', 'type'],
};

type HNode =
  | { kind: 'text'; value: string }
  | { kind: 'el'; tag: string; attrs: string; children: HNode[] };

const TAG_RE = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*(?::[a-zA-Z]+)?)\b((?:[^<>"']|"[^"]*"|'[^']*')*)>/g;

function isKnownTag(name: string): boolean {
  return INLINE_TAGS.has(name) || BLOCK_TAGS.has(name) || UNWRAP_TAGS.has(name);
}

function sanitizeAttrs(tag: string, raw: string): string {
  const allowed = ALLOWED_ATTRS[tag];
  if (!allowed || !raw) return '';
  const out: string[] = [];
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(raw)) !== null) {
    const name = m[1].toLowerCase();
    if (!allowed.includes(name)) continue;
    const value = (m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (name === 'src' && !/^(https?:|data:image\/|blob:|\/)/i.test(value)) continue;
    if (name === 'style' && /expression|url\s*\(|javascript:/i.test(value)) continue;
    if ((name === 'colspan' || name === 'rowspan' || name === 'start' || name === 'width' || name === 'height') && !/^\d+(px|%)?$/.test(value)) continue;
    out.push(`${name}="${value.replace(/"/g, '&quot;')}"`);
  }
  return out.length ? ' ' + out.join(' ') : '';
}

/** Parses an HTML-ish string into a balanced tree, dropping unsafe/unknown markup. */
function parseHtml(input: string): HNode[] {
  const root: HNode = { kind: 'el', tag: '#root', attrs: '', children: [] };
  const stack: Array<Extract<HNode, { kind: 'el' }>> = [root as Extract<HNode, { kind: 'el' }>];
  const top = () => stack[stack.length - 1];
  const pushText = (value: string) => {
    if (!value) return;
    const kids = top().children;
    const last = kids[kids.length - 1];
    if (last && last.kind === 'text') last.value += value;
    else kids.push({ kind: 'text', value });
  };

  const src = input.replace(DROP_WITH_CONTENT_RE, '').replace(DROP_SINGLE_RE, '');
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(src)) !== null) {
    pushText(src.slice(lastIndex, m.index));
    lastIndex = TAG_RE.lastIndex;
    if (m[0].startsWith('<!--')) continue;

    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (!isKnownTag(tag)) {
      // Not real markup (e.g. "x<y and y>z") – keep it as literal text
      pushText(m[0]);
      continue;
    }
    if (UNWRAP_TAGS.has(tag)) continue;

    if (closing) {
      const idx = stack.map(n => n.tag).lastIndexOf(tag);
      if (idx > 0) stack.length = idx;
      continue;
    }
    const el: Extract<HNode, { kind: 'el' }> = { kind: 'el', tag, attrs: sanitizeAttrs(tag, m[3] || ''), children: [] };
    if (tag === 'img' && !/\bsrc="/.test(el.attrs)) continue; // unsafe or missing src
    // Implicitly close an open <p>/<li>/<td>/<tr> when a sibling of the same kind starts
    if (['p', 'li', 'td', 'th', 'tr'].includes(tag)) {
      const sameIdx = stack.map(n => n.tag).lastIndexOf(tag);
      const tableBoundary = Math.max(stack.map(n => n.tag).lastIndexOf('table'), stack.map(n => n.tag).lastIndexOf('ul'), stack.map(n => n.tag).lastIndexOf('ol'));
      if (sameIdx > 0 && sameIdx > tableBoundary - (tag === 'p' ? 0 : 1)) stack.length = sameIdx;
    }
    top().children.push(el);
    if (!VOID_TAGS.has(tag) && !m[3]?.trim().endsWith('/')) stack.push(el);
  }
  pushText(src.slice(lastIndex));
  return root.children;
}

const isWs = (n: HNode) => n.kind === 'text' && !n.value.trim();

/** Converts text newlines to <br> and flattens nested paragraphs for inline contexts (td, li, p). */
function inlineify(children: HNode[]): HNode[] {
  const out: HNode[] = [];
  for (const c of children) {
    if (c.kind === 'text') {
      const parts = c.value.replace(/\r/g, '').split(/\n/);
      parts.forEach((p, i) => {
        if (i > 0) out.push({ kind: 'el', tag: 'br', attrs: '', children: [] });
        if (p) out.push({ kind: 'text', value: p });
      });
    } else if (c.tag === 'p' || c.tag === 'div' || /^h[1-6]$/.test(c.tag)) {
      if (out.length && !isBr(out[out.length - 1])) out.push({ kind: 'el', tag: 'br', attrs: '', children: [] });
      const inner = inlineify(c.children);
      out.push(...(/^h[1-6]$/.test(c.tag) ? [{ kind: 'el', tag: 'b', attrs: '', children: inner } as HNode] : inner));
      out.push({ kind: 'el', tag: 'br', attrs: '', children: [] });
    } else {
      out.push(structure(c));
    }
  }
  return trimBr(collapseBr(out));
}

const isBr = (n: HNode) => n.kind === 'el' && n.tag === 'br';

function collapseBr(nodes: HNode[]): HNode[] {
  const out: HNode[] = [];
  let brRun = 0;
  for (const n of nodes) {
    if (isBr(n)) {
      brRun++;
      if (brRun <= 2) out.push(n);
    } else if (isWs(n) && brRun > 0) {
      // whitespace between line breaks carries no meaning
    } else {
      brRun = 0;
      out.push(n);
    }
  }
  return out;
}

function trimBr(nodes: HNode[]): HNode[] {
  let s = 0;
  let e = nodes.length;
  while (s < e && (isBr(nodes[s]) || isWs(nodes[s]))) s++;
  while (e > s && (isBr(nodes[e - 1]) || isWs(nodes[e - 1]))) e--;
  const out = nodes.slice(s, e);
  if (out.length) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first.kind === 'text') out[0] = { kind: 'text', value: first.value.replace(/^\s+/, '') };
    if (last.kind === 'text') out[out.length - 1] = { kind: 'text', value: (out[out.length - 1] as any).value.replace(/\s+$/, '') };
  }
  return out;
}

/** Recursively normalizes an element's children according to its role. */
function structure(node: HNode): HNode {
  if (node.kind === 'text') return node;
  const { tag } = node;
  if (['table', 'thead', 'tbody', 'tfoot', 'tr', 'ul', 'ol'].includes(tag)) {
    // Container tags: only element children are meaningful
    let kids = node.children.filter(c => !isWs(c));
    if (tag === 'ul' || tag === 'ol') {
      kids = kids.map(c => (c.kind === 'el' && c.tag === 'li' ? c : { kind: 'el', tag: 'li', attrs: '', children: [c] } as HNode));
    }
    if (tag === 'tr') {
      kids = kids.map(c => (c.kind === 'el' && (c.tag === 'td' || c.tag === 'th') ? c : { kind: 'el', tag: 'td', attrs: '', children: [c] } as HNode));
    }
    return { ...node, children: kids.map(structure) };
  }
  if (['td', 'th', 'li', 'caption', 'p'].includes(tag) || /^h[1-6]$/.test(tag)) {
    return { ...node, children: inlineify(node.children) };
  }
  if (tag === 'blockquote' || tag === 'div') {
    return { ...node, children: blockify(node.children) };
  }
  if (tag === 'pre') return node;
  return { ...node, children: node.children.map(structure) };
}

const BLOCK_OUTPUT = new Set(['p', 'table', 'ul', 'ol', 'blockquote', 'pre', 'hr']);

/** Turns a mixed sequence into block-level nodes; loose inline content becomes <p> paragraphs. */
function blockify(children: HNode[]): HNode[] {
  const out: HNode[] = [];
  let run: HNode[] = [];

  const flush = () => {
    if (!run.length) return;
    // Blank lines split paragraphs
    const paras: HNode[][] = [[]];
    for (const n of run) {
      if (n.kind === 'text' && /\n\s*\n/.test(n.value)) {
        const parts = n.value.split(/\n\s*\n/);
        parts.forEach((p, i) => {
          if (i > 0) paras.push([]);
          if (p) paras[paras.length - 1].push({ kind: 'text', value: p });
        });
      } else {
        paras[paras.length - 1].push(n);
      }
    }
    for (const p of paras) {
      const inner = inlineify(p);
      if (inner.some(n => !isWs(n) && !isBr(n))) out.push({ kind: 'el', tag: 'p', attrs: '', children: inner });
    }
    run = [];
  };

  for (const c of children) {
    if (c.kind === 'el' && (BLOCK_TAGS.has(c.tag) && !['td', 'th', 'tr', 'thead', 'tbody', 'tfoot', 'caption', 'li'].includes(c.tag))) {
      flush();
      if (c.tag === 'div') {
        out.push(...blockify(c.children));
      } else if (c.tag === 'p' || /^h[1-6]$/.test(c.tag)) {
        // A <p> that wrongly contains block content is split around it
        if (c.children.some(k => k.kind === 'el' && BLOCK_OUTPUT.has(k.tag))) {
          out.push(...blockify(c.children));
        } else {
          const inner = inlineify(c.children);
          if (inner.some(n => !isWs(n) && !isBr(n))) {
            out.push({ kind: 'el', tag: 'p', attrs: '', children: /^h[1-6]$/.test(c.tag) ? [{ kind: 'el', tag: 'b', attrs: '', children: inner }] : inner });
          }
        }
      } else {
        out.push(structure(c));
      }
    } else if (c.kind === 'el' && ['td', 'th', 'tr', 'li'].includes(c.tag)) {
      // Orphan table/list parts: keep their content as text
      run.push(...c.children);
    } else {
      run.push(c);
    }
  }
  flush();
  return out;
}

function escapeText(s: string): string {
  return s
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[ \t]{2,}/g, ' ');
}

function serialize(nodes: HNode[]): string {
  return nodes
    .map(n => {
      if (n.kind === 'text') return escapeText(n.value);
      if (VOID_TAGS.has(n.tag)) return `<${n.tag}${n.attrs}>`;
      return `<${n.tag}${n.attrs}>${serialize(n.children)}</${n.tag}>`;
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Markdown leftovers (AI chat / pasted answers)
// ---------------------------------------------------------------------------

function markdownTablesToHtml(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const isDivider = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  while (i < lines.length) {
    if (isRow(lines[i]) && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const head = cells(lines[i]);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && isRow(lines[i])) body.push(cells(lines[i++]));
      out.push(
        '<table><tr>' + head.map(c => `<th>${c}</th>`).join('') + '</tr>' +
        body.map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('') +
        '</table>'
      );
    } else {
      out.push(lines[i++]);
    }
  }
  return out.join('\n');
}

function markdownInlineToHtml(text: string): string {
  return text
    .replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>')
    .replace(/__([^_\n]+?)__/g, '<b>$1</b>');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalizes any AI / OCR / pasted / legacy plain-text field into the canonical HTML + LaTeX format.
 * Idempotent: running it on its own output returns the same string.
 */
export function normalizeHtmlLatex(input: string): string {
  if (!input || !input.trim()) return '';
  const { text, math } = protectMath(svgBlocksToImg(input).replace(/\r\n?/g, '\n'));
  let s =markdownInlineToHtml(markdownTablesToHtml(text));
  s = serialize(blockify(parseHtml(s)));
  return restoreMath(s, math, seg => {
    const tex = normalizeMathTex(seg.tex);
    return seg.display ? `$$${tex}$$` : `$${tex}$`;
  });
}

const ENTITY_MAP: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Strips markup for plain-text checks ("is this option blank?", search, dedupe). Math source is kept. */
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|li|tr|div|h[1-6])>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (m, e) => ENTITY_MAP[e] ?? m)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** For one-line contexts (options): drops the outer <p> and joins paragraphs with <br>. */
export function toInlineHtml(html: string): string {
  if (!html) return '';
  const trimmed = html.trim();
  if (/<(?:table|ul|ol|blockquote|pre)\b/i.test(trimmed)) return trimmed;
  return trimmed
    .replace(/^<p>/i, '')
    .replace(/<\/p>$/i, '')
    .replace(/<\/p>\s*<p>/gi, '<br>');
}
