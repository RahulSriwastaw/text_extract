/**
 * Word (.docx) → Design Studio, keeping the look.
 *
 * Reads the file's own XML instead of going through HTML, so what Word stores per paragraph
 * survives: text colour, bold / italic / underline, alignment, shading, borders, size, font,
 * heading levels, automatic numbering ("1.", "(a)"), pictures and equations (as LaTeX).
 *
 * What the Design Studio model cannot hold is left out and said so in the upload notice:
 * colours that differ between words of one paragraph (the main colour wins), table cell
 * colours, columns, text boxes and page layout.
 */
import JSZip from 'jszip';
import { FONTS, FONT_IDS, importedToDesignDoc, type BlockStyle, type DesignDoc, type FontId, type ImportedItem, type Theme } from './designDoc';

type XmlParser = (xml: string) => Document;
const browserParser: XmlParser = xml => new DOMParser().parseFromString(xml, 'application/xml');

// ---- small DOM helpers (work with the browser's DOM and with xmldom in tests) -------------
const kids = (el: Node | null | undefined): Element[] => {
  const out: Element[] = [];
  const list = el?.childNodes;
  for (let i = 0; list && i < list.length; i++) if (list[i].nodeType === 1) out.push(list[i] as Element);
  return out;
};
const child = (el: Node | null | undefined, name: string) => kids(el).find(k => k.nodeName === name);
const val = (el: Element | undefined, name = 'w:val') => el?.getAttribute(name) || '';
const on = (el: Element | undefined) => !!el && !['0', 'false', 'none'].includes(val(el));
const HEX6 = /^[0-9a-fA-F]{6}$/;

// ---- equations: Office Math (OMML) → LaTeX ------------------------------------------------
const SYMBOLS: Record<string, string> = {
  '×': '\\times ', '÷': '\\div ', '±': '\\pm ', '∓': '\\mp ', '≤': '\\le ', '≥': '\\ge ', '≠': '\\ne ', '≈': '\\approx ', '≡': '\\equiv ',
  '∞': '\\infty ', 'π': '\\pi ', 'θ': '\\theta ', 'α': '\\alpha ', 'β': '\\beta ', 'γ': '\\gamma ', 'δ': '\\delta ', 'Δ': '\\Delta ',
  'λ': '\\lambda ', 'μ': '\\mu ', 'σ': '\\sigma ', 'ω': '\\omega ', 'Ω': '\\Omega ', 'φ': '\\phi ', 'ρ': '\\rho ', 'τ': '\\tau ',
  '∑': '\\sum ', '∏': '\\prod ', '∫': '\\int ', '−': '-', '·': '\\cdot ', '⋅': '\\cdot ', '°': '^\\circ ', '→': '\\to ', '⇒': '\\Rightarrow ',
  '∴': '\\therefore ', '∵': '\\because ', '∠': '\\angle ', '△': '\\triangle ', '∥': '\\parallel ', '⊥': '\\perp ', '∈': '\\in ',
  '∪': '\\cup ', '∩': '\\cap ', '%': '\\%', '&': '\\&', '#': '\\#',
};
const FUNCTIONS = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'log', 'ln', 'lim', 'max', 'min', 'exp', 'det', 'gcd'];
const ACCENTS: Record<string, string> = { '̂': '\\hat', '̅': '\\overline', '¯': '\\overline', '⃗': '\\vec', '→': '\\vec', '̃': '\\tilde', '̇': '\\dot', '̈': '\\ddot' };
const mathText = (text: string) => /[ऀ-ॿ]/.test(text) ? `\\text{${text}}` : Array.from(text).map(c => SYMBOLS[c] ?? c).join('');
const braces = (s: string) => `{${s.trim()}}`;

export function ommlToLatex(node: Element): string {
  const all = (el: Element | undefined) => kids(el).map(ommlToLatex).join('');
  const part = (name: string) => all(child(node, name)).trim();
  const name = node.nodeName;
  if (name.endsWith('Pr')) return '';
  switch (name) {
    case 'm:r': {
      const text = kids(node).filter(k => k.nodeName === 'm:t').map(t => t.textContent || '').join('');
      return child(child(node, 'm:rPr'), 'm:nor') && /[A-Za-z]{2}/.test(text) ? `\\text{${text}}` : mathText(text);
    }
    case 'm:f': return val(child(child(node, 'm:fPr'), 'm:type'), 'm:val') === 'lin' ? `${part('m:num')}/${part('m:den')}` : `\\frac${braces(part('m:num'))}${braces(part('m:den'))}`;
    case 'm:sSup': return `${braces(part('m:e'))}^${braces(part('m:sup'))}`;
    case 'm:sSub': return `${braces(part('m:e'))}_${braces(part('m:sub'))}`;
    case 'm:sSubSup': return `${braces(part('m:e'))}_${braces(part('m:sub'))}^${braces(part('m:sup'))}`;
    case 'm:sPre': return `{}_${braces(part('m:sub'))}^${braces(part('m:sup'))}${braces(part('m:e'))}`;
    case 'm:rad': { const deg = part('m:deg'); return deg ? `\\sqrt[${deg}]${braces(part('m:e'))}` : `\\sqrt${braces(part('m:e'))}`; }
    case 'm:d': {
      const pr = child(node, 'm:dPr');
      const chr = (el: Element | undefined, fallback: string) => el ? val(el, 'm:val') : fallback;
      const edge = (c: string) => c === '' ? '.' : c === '{' ? '\\{' : c === '}' ? '\\}' : c;
      const inner = kids(node).filter(k => k.nodeName === 'm:e').map(e => all(e).trim()).join(chr(child(pr, 'm:sepChr'), '|'));
      return `\\left${edge(chr(child(pr, 'm:begChr'), '('))}${inner}\\right${edge(chr(child(pr, 'm:endChr'), ')'))}`;
    }
    case 'm:nary': {
      const chrEl = child(child(node, 'm:naryPr'), 'm:chr');
      const op = SYMBOLS[chrEl ? val(chrEl, 'm:val') : '∫'] || '\\int ';
      const sub = part('m:sub'), sup = part('m:sup');
      return `${op.trim()}${sub ? '_' + braces(sub) : ''}${sup ? '^' + braces(sup) : ''} ${part('m:e')}`;
    }
    case 'm:func': { const fn = part('m:fName'); return `${FUNCTIONS.includes(fn) ? '\\' + fn : fn} ${part('m:e')}`; }
    case 'm:bar': return `${val(child(child(node, 'm:barPr'), 'm:pos'), 'm:val') === 'bot' ? '\\underline' : '\\overline'}${braces(part('m:e'))}`;
    case 'm:acc': { const chrEl = child(child(node, 'm:accPr'), 'm:chr'); return `${ACCENTS[chrEl ? val(chrEl, 'm:val') : '̂'] || '\\hat'}${braces(part('m:e'))}`; }
    case 'm:limLow': return `${part('m:e')}_${braces(part('m:lim'))}`;
    case 'm:limUpp': return `${part('m:e')}^${braces(part('m:lim'))}`;
    case 'm:m': return `\\begin{matrix}${kids(node).filter(k => k.nodeName === 'm:mr').map(row => kids(row).filter(k => k.nodeName === 'm:e').map(e => all(e).trim()).join(' & ')).join(' \\\\ ')}\\end{matrix}`;
    case 'm:eqArr': return `\\begin{aligned}${kids(node).filter(k => k.nodeName === 'm:e').map(e => all(e).trim()).join(' \\\\ ')}\\end{aligned}`;
    default: return all(node);
  }
}

// ---- styles ---------------------------------------------------------------------------------
interface RunLook { bold?: boolean; italic?: boolean; underline?: boolean; color?: string; size?: number; font?: string; highlight?: boolean }
interface ParaLook { align?: string; background?: string; border?: BlockStyle['border']; borderColor?: string; heading?: 1 | 2 | 3; numId?: string; level?: number }

function readRunLook(rPr: Element | undefined): RunLook {
  const out: RunLook = {};
  if (!rPr) return out;
  const flag = (name: string) => { const el = child(rPr, name); return el ? on(el) : undefined; };
  const bold = flag('w:b'), italic = flag('w:i');
  if (bold !== undefined) out.bold = bold;
  if (italic !== undefined) out.italic = italic;
  const u = child(rPr, 'w:u');
  if (u) out.underline = val(u) !== 'none';
  const color = val(child(rPr, 'w:color'));
  if (HEX6.test(color)) out.color = '#' + color.toUpperCase();
  const size = Number(val(child(rPr, 'w:sz')));
  if (size > 0) out.size = size / 2;
  const fonts = child(rPr, 'w:rFonts');
  const font = fonts && (fonts.getAttribute('w:ascii') || fonts.getAttribute('w:hAnsi') || fonts.getAttribute('w:cs'));
  if (font) out.font = font;
  const highlight = child(rPr, 'w:highlight');
  if (highlight) out.highlight = val(highlight) !== 'none';
  return out;
}

function readParaLook(pPr: Element | undefined): ParaLook {
  const out: ParaLook = {};
  if (!pPr) return out;
  const jc = val(child(pPr, 'w:jc'));
  if (jc) out.align = jc;
  const fill = val(child(pPr, 'w:shd'), 'w:fill');
  if (HEX6.test(fill) && fill.toUpperCase() !== 'FFFFFF') out.background = '#' + fill.toUpperCase();
  const borders = child(pPr, 'w:pBdr');
  if (borders) {
    const side = (name: string) => { const el = child(borders, name); return el && !['nil', 'none'].includes(val(el)) ? el : undefined; };
    const left = side('w:left'), bottom = side('w:bottom'), top = side('w:top'), right = side('w:right');
    const shown = left && right && top && bottom ? { kind: 'box' as const, el: top } : left && !right ? { kind: 'left-bar' as const, el: left } : bottom && !top ? { kind: 'underline' as const, el: bottom } : null;
    if (shown) { out.border = shown.kind; const c = val(shown.el, 'w:color'); if (HEX6.test(c)) out.borderColor = '#' + c.toUpperCase(); }
  }
  const outline = child(pPr, 'w:outlineLvl');
  if (outline && Number(val(outline)) < 9) out.heading = Math.min(3, Number(val(outline)) + 1) as 1 | 2 | 3;
  const numPr = child(pPr, 'w:numPr');
  if (numPr) { out.numId = val(child(numPr, 'w:numId')); out.level = Number(val(child(numPr, 'w:ilvl'))) || 0; }
  return out;
}

interface StyleDef { run: RunLook; para: ParaLook }
function readStyles(xml: Document | null) {
  const styles = new Map<string, StyleDef>();
  const defaults: StyleDef = { run: {}, para: {} };
  if (!xml) return { styles, defaults, normal: '' };
  const root = xml.documentElement;
  const docDefaults = child(root, 'w:docDefaults');
  defaults.run = readRunLook(child(child(docDefaults, 'w:rPrDefault'), 'w:rPr'));
  const raw = new Map<string, { basedOn: string; def: StyleDef }>();
  let normal = '';
  for (const style of kids(root).filter(k => k.nodeName === 'w:style')) {
    const id = style.getAttribute('w:styleId') || '';
    const def: StyleDef = { run: readRunLook(child(style, 'w:rPr')), para: readParaLook(child(style, 'w:pPr')) };
    const heading = val(child(style, 'w:name')).toLowerCase().match(/^heading\s*([1-9])$/) || id.match(/^Heading([1-9])$/);
    if (heading) def.para.heading = Math.min(3, Number(heading[1])) as 1 | 2 | 3;
    if (/^title$/i.test(val(child(style, 'w:name')))) def.para.heading = 1;
    if (style.getAttribute('w:type') === 'paragraph' && style.getAttribute('w:default') === '1') normal = id;
    raw.set(id, { basedOn: val(child(style, 'w:basedOn')), def });
  }
  const resolve = (id: string, depth = 0): StyleDef => {
    const done = styles.get(id);
    if (done) return done;
    const entry = raw.get(id);
    if (!entry) return { run: {}, para: {} };
    const base = entry.basedOn && depth < 12 ? resolve(entry.basedOn, depth + 1) : { run: {}, para: {} };
    const merged = { run: { ...base.run, ...entry.def.run }, para: { ...base.para, ...entry.def.para } };
    styles.set(id, merged);
    return merged;
  };
  for (const id of raw.keys()) resolve(id);
  return { styles, defaults, normal };
}

// ---- automatic numbering ("1.", "(a)", bullets) ------------------------------------------------
interface NumLevel { format: string; text: string; start: number }
function readNumbering(xml: Document | null) {
  const levels = new Map<string, NumLevel[]>();     // numId → levels
  if (!xml) return levels;
  const root = xml.documentElement;
  const abstracts = new Map<string, NumLevel[]>();
  for (const abs of kids(root).filter(k => k.nodeName === 'w:abstractNum')) {
    const list: NumLevel[] = [];
    for (const lvl of kids(abs).filter(k => k.nodeName === 'w:lvl')) {
      list[Number(lvl.getAttribute('w:ilvl')) || 0] = { format: val(child(lvl, 'w:numFmt')) || 'decimal', text: val(child(lvl, 'w:lvlText')), start: Number(val(child(lvl, 'w:start'))) || 1 };
    }
    abstracts.set(abs.getAttribute('w:abstractNumId') || '', list);
  }
  for (const num of kids(root).filter(k => k.nodeName === 'w:num')) {
    const list = abstracts.get(val(child(num, 'w:abstractNumId')));
    if (list) levels.set(num.getAttribute('w:numId') || '', list);
  }
  return levels;
}
const roman = (n: number) => [['m', 1000], ['cm', 900], ['d', 500], ['cd', 400], ['c', 100], ['xc', 90], ['l', 50], ['xl', 40], ['x', 10], ['ix', 9], ['v', 5], ['iv', 4], ['i', 1]]
  .reduce((out, [s, v]) => { while (n >= (v as number)) { out += s; n -= v as number; } return out; }, '');
const letter = (n: number) => String.fromCharCode(97 + ((n - 1) % 26));
const formatNumber = (n: number, format: string) =>
  format === 'lowerLetter' ? letter(n) : format === 'upperLetter' ? letter(n).toUpperCase() : format === 'lowerRoman' ? roman(n) : format === 'upperRoman' ? roman(n).toUpperCase() : String(n);

// ---- the import --------------------------------------------------------------------------------
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const fontId = (name: string | undefined): FontId | undefined => name ? FONT_IDS.find(id => FONTS[id].docx.toLowerCase() === name.toLowerCase()) : undefined;
const most = <T,>(counts: Map<T, number>): T | undefined => [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];

export interface DocxImportResult { doc: DesignDoc; equations: number; images: number }

export async function docxToDesignDoc(data: ArrayBuffer | Uint8Array, title: string, parseXml: XmlParser = browserParser): Promise<DocxImportResult> {
  const zip = await JSZip.loadAsync(data);
  const xml = async (path: string) => { const file = zip.file(path); return file ? parseXml(await file.async('string')) : null; };
  const document = await xml('word/document.xml');
  if (!document) throw new Error('This is not a Word (.docx) file.');
  const { styles, defaults, normal } = readStyles(await xml('word/styles.xml'));
  const numbering = readNumbering(await xml('word/numbering.xml'));
  const rels = new Map<string, string>();
  for (const rel of kids((await xml('word/_rels/document.xml.rels'))?.documentElement)) rels.set(rel.getAttribute('Id') || '', rel.getAttribute('Target') || '');

  let equations = 0, images = 0;
  const counters = new Map<string, number[]>();
  const sizeChars = new Map<number, number>(), colorChars = new Map<string, number>(), fontChars = new Map<string, number>();

  interface Para { text: string; look: ParaLook; runs: { look: RunLook; length: number }[]; pictures: string[]; marker: string; bullet: boolean }

  const picture = async (drawing: Element): Promise<string | null> => {
    const blip = drawing.getElementsByTagName('a:blip')[0];
    const target = blip && rels.get(blip.getAttribute('r:embed') || '');
    if (!target) return null;
    const path = target.startsWith('/') ? target.slice(1) : 'word/' + target.replace(/^\.\//, '');
    const mime = MIME[path.split('.').pop()!.toLowerCase()];
    const file = zip.file(path);
    return mime && file ? `data:${mime};base64,${await file.async('base64')}` : null;
  };

  const readParagraph = async (p: Element): Promise<Para> => {
    const pPr = child(p, 'w:pPr');
    const styleId = val(child(pPr, 'w:pStyle')) || normal;
    const style = styles.get(styleId) || { run: {}, para: {} };
    const look: ParaLook = { ...style.para, ...readParaLook(pPr) };
    const para: Para = { text: '', look, runs: [], pictures: [], marker: '', bullet: false };
    const pieces: { text: string; look: RunLook; math?: boolean }[] = [];

    const walk = async (node: Element) => {
      for (const el of kids(node)) {
        switch (el.nodeName) {
          case 'w:r': {
            const rPr = child(el, 'w:rPr');
            const runStyle = styles.get(val(child(rPr, 'w:rStyle')))?.run || {};
            const runLook: RunLook = { ...defaults.run, ...style.run, ...runStyle, ...readRunLook(rPr) };
            let text = '';
            for (const part of kids(el)) {
              if (part.nodeName === 'w:t') text += part.textContent || '';
              else if (part.nodeName === 'w:tab') text += '\t';
              else if (part.nodeName === 'w:br' || part.nodeName === 'w:cr') text += part.getAttribute('w:type') === 'page' ? '' : '\n';
              else if (part.nodeName === 'w:noBreakHyphen') text += '-';
              else if (part.nodeName === 'w:drawing' || part.nodeName === 'mc:AlternateContent') {
                const data = await picture(part);
                if (data) para.pictures.push(data);
              }
            }
            if (text) pieces.push({ text, look: runLook });
            break;
          }
          case 'm:oMathPara': case 'm:oMath': {
            const latex = ommlToLatex(el).replace(/\s+/g, ' ').trim();
            if (latex) { equations++; pieces.push({ text: `$${latex}$`, look: {}, math: true }); }
            break;
          }
          case 'w:del': case 'w:pPr': break;
          default: await walk(el);            // hyperlinks, inserted text, content controls…
        }
      }
    };
    await walk(p);

    // Runs with the same emphasis join, so "**bold** **text**" becomes one "**bold text**".
    const whole = pieces.filter(x => !x.math && x.text.trim());
    const every = (key: 'bold' | 'italic' | 'underline') => whole.length > 0 && whole.every(x => x.look[key]);
    const allBold = every('bold'), allItalic = every('italic');
    let text = '';
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      if (piece.math) { text += piece.text; continue; }
      let run = piece.text;
      const same = (a: RunLook, b: RunLook) => !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.highlight === !!b.highlight;
      while (i + 1 < pieces.length && !pieces[i + 1].math && same(piece.look, pieces[i + 1].look)) run += pieces[++i].text;
      const core = run.trim();
      para.runs.push({ look: piece.look, length: core.length });
      if (!core || !/[\p{L}\p{N}]/u.test(core) || core.includes('\n')) { text += run; continue; }
      let marked = core;
      if (piece.look.bold && !allBold) marked = `**${marked}**`;
      if (piece.look.italic && !allItalic) marked = `*${marked}*`;
      if (piece.look.highlight) marked = `==${marked}==`;
      text += run.slice(0, run.length - run.trimStart().length) + marked + run.slice(run.trimEnd().length);
    }
    para.text = text.replace(/\t+/g, '   ').replace(/[  ]+\n/g, '\n').trim();
    // Books set options as "**(a)**27 **(b)**45": a bold label glued to its text. Written as "(a) 27 (b) 45"
    // the line is recognised as options and can be split and arranged.
    if (/^(\*\*)?\([A-Ea-e1-5]\)/.test(para.text)) {
      para.text = para.text.replace(/\*\*(\([A-Ea-e1-5]\))\*\*/g, '$1').replace(/(\([A-Ea-e1-5]\))(?=[^\s)])/g, '$1 ');
    }

    // Word's own numbering is not in the text: put "1." / "(a)" back, or mark the line as a bullet.
    const levels = look.numId && look.numId !== '0' ? numbering.get(look.numId) : undefined;
    if (levels && para.text) {
      const depth = look.level || 0;
      const count = counters.get(look.numId!) || [];
      count[depth] = (count[depth] ?? (levels[depth]?.start ?? 1) - 1) + 1;
      count.length = depth + 1;
      counters.set(look.numId!, count);
      const level = levels[depth];
      if (!level || level.format === 'bullet' || level.format === 'none') para.bullet = true;
      else para.marker = level.text.replace(/%(\d)/g, (_m, d) => formatNumber(count[Number(d) - 1] ?? 1, levels[Number(d) - 1]?.format || 'decimal')) + ' ';
    }
    return para;
  };

  /** What the whole paragraph looks like, as a block style. Colour, size and font are compared with the document's own later. */
  const paragraphLook = (para: Para) => {
    const filled = para.runs.filter(r => r.length > 0);
    const total = filled.reduce((n, r) => n + r.length, 0);
    const main = <K extends 'color' | 'size' | 'font'>(key: K): RunLook[K] | undefined => {
      const counts = new Map<RunLook[K], number>();
      for (const r of filled) counts.set(r.look[key], (counts.get(r.look[key]) || 0) + r.length);
      const top = most(counts);
      return top !== undefined && (counts.get(top) || 0) >= total * 0.6 ? top : undefined;
    };
    const every = (key: 'bold' | 'italic' | 'underline') => filled.length > 0 && filled.every(r => r.look[key]);
    return { color: main('color'), size: main('size'), font: main('font'), bold: every('bold'), italic: every('italic'), underline: every('underline'), total };
  };

  // ---- pass 1: read everything, in order ----
  type Read = { kind: 'para'; para: Para } | { kind: 'table'; text: string };
  const read: Read[] = [];
  const cellText = async (cell: Element) => {
    const parts: string[] = [];
    for (const p of Array.from(cell.getElementsByTagName('w:p'))) { const para = await readParagraph(p); if (para.text) parts.push(para.marker + para.text); }
    return parts.join(' ').replace(/\s+/g, ' ').replace(/\|/g, '/');
  };
  const readBody = async (parent: Element) => {
    for (const el of kids(parent)) {
      if (el.nodeName === 'w:p') {
        const para = await readParagraph(el);
        if (para.text || para.pictures.length) read.push({ kind: 'para', para });
      } else if (el.nodeName === 'w:tbl') {
        const rows: string[] = [];
        for (const row of kids(el).filter(k => k.nodeName === 'w:tr')) {
          const cells: string[] = [];
          for (const cell of kids(row).filter(k => k.nodeName === 'w:tc')) cells.push(await cellText(cell));
          if (cells.length) rows.push('| ' + cells.join(' | ') + ' |');
        }
        if (rows.length) read.push({ kind: 'table', text: [rows[0], '|' + ' --- |'.repeat(rows[0].split('|').length - 2), ...rows.slice(1)].join('\n') });
      } else if (el.nodeName === 'w:sdt') await readBody(child(el, 'w:sdtContent') || el);
    }
  };
  const body = child(document.documentElement, 'w:body');
  if (!body) throw new Error('No text was found in this file.');
  await readBody(body);

  // ---- the document's own body text: the most used size, colour and font ----
  for (const item of read) {
    if (item.kind !== 'para' || item.para.look.heading) continue;
    const look = paragraphLook(item.para);
    if (look.size) sizeChars.set(look.size, (sizeChars.get(look.size) || 0) + look.total);
    colorChars.set(look.color || '', (colorChars.get(look.color || '') || 0) + look.total);
    if (look.font) fontChars.set(look.font, (fontChars.get(look.font) || 0) + look.total);
  }
  const bodySize = most(sizeChars) || 11, bodyColor = most(colorChars) || '', bodyFont = most(fontChars);

  // ---- pass 2: blocks ----
  const items: ImportedItem[] = [];
  for (const item of read) {
    if (item.kind === 'table') { items.push({ kind: 'table', text: item.text }); continue; }
    const { para } = item;
    const look = paragraphLook(para);
    const align = para.look.align === 'center' ? 'center' : para.look.align === 'right' || para.look.align === 'end' ? 'right' : undefined;
    for (const image of para.pictures) { images++; items.push({ kind: 'image', image, ...(align && { style: { align } }) }); }
    if (!para.text) continue;

    const ratio = (look.size || bodySize) / bodySize;
    // A short, bold, clearly larger line is a heading even when Word's Heading styles were not used.
    const short = para.text.length <= 140 && !para.text.includes('\n') && !para.marker && !para.bullet;
    const heading = para.look.heading || (short && look.bold && ratio >= 1.6 ? 1 : short && look.bold && ratio >= 1.25 ? 2 : undefined);
    const style: BlockStyle = {
      ...(look.color && look.color !== bodyColor && { color: look.color }),
      ...(para.look.background && { background: para.look.background }),
      ...(align && { align }),
      ...(para.look.border && { border: para.look.border }), ...(para.look.borderColor && { borderColor: para.look.borderColor }),
      ...(look.italic && { italic: true }), ...(look.underline && { underline: true }),
      ...(look.font && look.font !== bodyFont && fontId(look.font) && { font: fontId(look.font) }),
      ...(!heading && look.bold && { bold: true }),
      ...(!heading && (ratio <= 0.88 ? { size: 'sm' as const } : ratio >= 1.5 ? { size: 'xl' as const } : ratio >= 1.15 ? { size: 'lg' as const } : {})),
    };
    const hasStyle = Object.keys(style).length > 0;
    if (heading) items.push({ kind: 'heading', text: para.text, level: heading as 1 | 2 | 3, ...(hasStyle && { style }) });
    else if (para.bullet) {
      const previous = items[items.length - 1];
      if (previous?.kind === 'list' && JSON.stringify(previous.style || {}) === JSON.stringify(hasStyle ? style : {})) previous.text += '\n- ' + para.text;
      else items.push({ kind: 'list', text: '- ' + para.text, ...(hasStyle && { style }) });
    } else items.push({ kind: 'text', text: para.marker + para.text, ...(hasStyle && { style }) });
  }

  // ---- the theme takes the document's own body look ----
  const theme: Partial<Theme> = { baseSize: Math.min(18, Math.max(9, Math.round(bodySize))) };
  if (fontId(bodyFont)) theme.font = fontId(bodyFont);
  if (bodyColor) theme.text = bodyColor;
  const page = val(child(document.documentElement, 'w:background'), 'w:color');
  if (HEX6.test(page)) theme.pageBackground = '#' + page.toUpperCase();

  return { doc: importedToDesignDoc(items, title, theme), equations, images };
}
