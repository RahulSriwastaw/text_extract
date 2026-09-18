/**
 * mcqDocxService.ts
 * LaTeX -> MathML (temml) -> OMML (W3C XSLT XSLTProcessor) -> DOCX (docx v8)
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  ShadingType,
  convertMillimetersToTwip,
  XmlComponent,
} from 'docx';
import { MockTestMcqItem } from '../types';

export interface DocxDownloadOptions {
  language: 'hi' | 'en' | 'both';
  includeSolution: boolean;
  includeAnswer: boolean;
  setName?: string;
}

// Minimal W3C MML2OMML XSLT
const MML2OMML_XSLT = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
  exclude-result-prefixes="xsl">
  <xsl:output method="xml" encoding="UTF-8" indent="no"/>
  <xsl:template match="math"><m:oMath><xsl:apply-templates/></m:oMath></xsl:template>
  <xsl:template match="mrow"><xsl:apply-templates/></xsl:template>
  <xsl:template match="mfrac">
    <m:f><m:fPr><m:type m:val="bar"/></m:fPr>
    <m:num><xsl:apply-templates select="*[1]"/></m:num>
    <m:den><xsl:apply-templates select="*[2]"/></m:den></m:f>
  </xsl:template>
  <xsl:template match="msup">
    <m:sSup><m:sSupPr><m:ctrlPr/></m:sSupPr>
    <m:e><xsl:apply-templates select="*[1]"/></m:e>
    <m:sup><xsl:apply-templates select="*[2]"/></m:sup></m:sSup>
  </xsl:template>
  <xsl:template match="msub">
    <m:sSub><m:sSubPr><m:ctrlPr/></m:sSubPr>
    <m:e><xsl:apply-templates select="*[1]"/></m:e>
    <m:sub><xsl:apply-templates select="*[2]"/></m:sub></m:sSub>
  </xsl:template>
  <xsl:template match="msubsup">
    <m:sSubSup><m:sSubSupPr><m:ctrlPr/></m:sSubSupPr>
    <m:e><xsl:apply-templates select="*[1]"/></m:e>
    <m:sub><xsl:apply-templates select="*[2]"/></m:sub>
    <m:sup><xsl:apply-templates select="*[3]"/></m:sup></m:sSubSup>
  </xsl:template>
  <xsl:template match="msqrt">
    <m:rad><m:radPr><m:degHide m:val="1"/><m:ctrlPr/></m:radPr>
    <m:deg/><m:e><xsl:apply-templates/></m:e></m:rad>
  </xsl:template>
  <xsl:template match="mroot">
    <m:rad><m:radPr><m:ctrlPr/></m:radPr>
    <m:deg><xsl:apply-templates select="*[2]"/></m:deg>
    <m:e><xsl:apply-templates select="*[1]"/></m:e></m:rad>
  </xsl:template>
  <xsl:template match="mover">
    <m:limUpp><m:limUppPr><m:ctrlPr/></m:limUppPr>
    <m:e><xsl:apply-templates select="*[1]"/></m:e>
    <m:lim><xsl:apply-templates select="*[2]"/></m:lim></m:limUpp>
  </xsl:template>
  <xsl:template match="munder">
    <m:limLow><m:limLowPr><m:ctrlPr/></m:limLowPr>
    <m:e><xsl:apply-templates select="*[1]"/></m:e>
    <m:lim><xsl:apply-templates select="*[2]"/></m:lim></m:limLow>
  </xsl:template>
  <xsl:template match="munderover">
    <m:nary><m:naryPr><m:limLoc m:val="undOvr"/><m:ctrlPr/></m:naryPr>
    <m:sub><xsl:apply-templates select="*[2]"/></m:sub>
    <m:sup><xsl:apply-templates select="*[3]"/></m:sup>
    <m:e><m:r><m:t><xsl:value-of select="*[1]"/></m:t></m:r></m:e></m:nary>
  </xsl:template>
  <xsl:template match="mi|mn|mo|mtext|ms">
    <m:r><m:t><xsl:value-of select="."/></m:t></m:r>
  </xsl:template>
  <xsl:template match="mspace"><m:r><m:t xml:space="preserve"> </m:t></m:r></xsl:template>
  <xsl:template match="mfenced">
    <xsl:if test="@open"><m:r><m:t><xsl:value-of select="@open"/></m:t></m:r></xsl:if>
    <xsl:apply-templates/>
    <xsl:if test="@close"><m:r><m:t><xsl:value-of select="@close"/></m:t></m:r></xsl:if>
  </xsl:template>
  <xsl:template match="menclose|mstyle|mpadded"><xsl:apply-templates/></xsl:template>
  <xsl:template match="annotation|annotation-xml"><xsl:apply-templates select="*[1]"/></xsl:template>
  <xsl:template match="semantics"><xsl:apply-templates select="*[1]"/></xsl:template>
  <xsl:template match="mglyph"/>
  <xsl:template match="*"><xsl:apply-templates/></xsl:template>
</xsl:stylesheet>`;

let _xsltProc: XSLTProcessor | null = null;

function getXsltProc(): XSLTProcessor | null {
  if (_xsltProc) return _xsltProc;
  try {
    if (typeof XSLTProcessor === 'undefined') return null;
    const parser = new DOMParser();
    const xsltDoc = parser.parseFromString(MML2OMML_XSLT, 'application/xml');
    const proc = new XSLTProcessor();
    proc.importStylesheet(xsltDoc);
    _xsltProc = proc;
    return proc;
  } catch { return null; }
}

async function latexToOmmlXml(latex: string, display = false): Promise<string | null> {
  try {
    const temmlMod = await import('temml');
    const temml = (temmlMod as any).default || temmlMod;
    const mathml: string = temml.renderToString(latex, { displayMode: display, throwOnError: false });
    const proc = getXsltProc();
    if (!proc) return null;
    const parser = new DOMParser();
    const mmlDoc = parser.parseFromString(mathml, 'application/xml');
    if (mmlDoc.querySelector('parsererror')) return null;
    const ommlDoc = proc.transformToDocument(mmlDoc);
    if (!ommlDoc?.documentElement) return null;
    const ser = new XMLSerializer();
    return ser.serializeToString(ommlDoc.documentElement);
  } catch (e) {
    console.warn('[mcqDocxService] LaTeX->OMML failed:', latex, e);
    return null;
  }
}

// Custom XmlComponent to inject raw OMML XML as a paragraph child
class OmmlElement extends XmlComponent {
  private readonly raw: string;
  constructor(raw: string) {
    super('m:oMath');
    this.raw = raw;
  }
  prepForXml(_ctx: any): any {
    return this.raw;
  }
}

const FONT_HI = 'Nirmala UI';
const FONT_EN = 'Calibri';
const C_BLACK = '000000';
const C_BLUE = '1F497D';
const C_GREEN = '1A7A1A';
const C_BROWN = '7B3F00';

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .trim();
}

interface Seg { type: 'text' | 'inline' | 'display'; val: string; }

function tokenize(text: string): Seg[] {
  const s = text
    .replace(/\\\[([^]*?)\\\]/g, (_m, i) => `$$${i}$$`)
    .replace(/\\\(([^]*?)\\\)/g, (_m, i) => `$${i}$`);
  const segs: Seg[] = [];
  const re = /(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) segs.push({ type: 'text', val: s.slice(last, m.index) });
    const isD = m[0].startsWith('$$');
    segs.push({ type: isD ? 'display' : 'inline', val: (isD ? m[0].slice(2, -2) : m[0].slice(1, -1)).trim() });
    last = m.index + m[0].length;
  }
  if (last < s.length) segs.push({ type: 'text', val: s.slice(last) });
  return segs;
}

interface RunCtx { lang: 'hi' | 'en'; bold?: boolean; italic?: boolean; color?: string; size?: number; }

async function htmlLatexToElements(html: string, ctx: RunCtx): Promise<Paragraph[]> {
  const plain = stripHtml(html);
  if (!plain.trim()) return [];
  const segs = tokenize(plain);
  const elems: Paragraph[] = [];
  const runs: (TextRun | OmmlElement)[] = [];

  for (const seg of segs) {
    if (seg.type === 'text') {
      const t = seg.val.replace(/\s+/g, ' ').trim();
      if (!t) continue;
      runs.push(new TextRun({
        text: t, font: ctx.lang === 'hi' ? FONT_HI : FONT_EN,
        bold: ctx.bold, italics: ctx.italic, color: ctx.color || C_BLACK, size: ctx.size || 24,
      }));
    } else {
      const isDisplay = seg.type === 'display';
      const omml = await latexToOmmlXml(seg.val, isDisplay);
      if (omml && isDisplay) {
        if (runs.length) { elems.push(new Paragraph({ children: [...runs], spacing: { after: 60 } })); runs.length = 0; }
        elems.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new OmmlElement(omml)], spacing: { before: 100, after: 100 } }));
      } else if (omml) {
        runs.push(new OmmlElement(omml));
      } else {
        runs.push(new TextRun({ text: ` ${seg.val} `, font: FONT_EN, italics: true, color: '555555', size: ctx.size || 24 }));
      }
    }
  }

  if (runs.length) elems.push(new Paragraph({ children: [...runs], spacing: { after: 60 } }));
  return elems.length ? elems : [new Paragraph({ children: [new TextRun({ text: '—', color: '999999' })], spacing: { after: 60 } })];
}

function divider(): Paragraph {
  return new Paragraph({
    children: [],
    border: { bottom: { color: 'CCCCCC', style: BorderStyle.SINGLE, size: 6, space: 1 } },
    spacing: { before: 120, after: 120 },
  });
}

function ansLabel(answer: string): string {
  const u = (answer || '').toString().trim().toUpperCase();
  if (/^[ABCDE]$/.test(u)) return u;
  return u === '1' ? 'A' : u === '2' ? 'B' : u === '3' ? 'C' : u === '4' ? 'D' : u === '5' ? 'E' : answer || '?';
}

export async function downloadMcqAsDocx(items: MockTestMcqItem[], opts: DocxDownloadOptions, fileName = 'mocktest_mcqs.docx'): Promise<void> {
  const { language, includeSolution, includeAnswer, setName } = opts;
  const kids: Paragraph[] = [];

  // Title
  kids.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: setName || 'MockTest Question Set', bold: true, size: 32, color: C_BLUE, font: FONT_EN })],
    spacing: { before: 0, after: 200 },
    shading: { type: ShadingType.SOLID, color: 'EBF3FB' },
  }));
  kids.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `Total Questions: ${items.length}  |  Language: ${language === 'both' ? 'Hindi + English' : language === 'hi' ? 'Hindi' : 'English'}`, size: 20, color: '555555', font: FONT_EN })],
    spacing: { before: 0, after: 320 },
  }));

  const OPT_LABELS = ['A', 'B', 'C', 'D', 'E'];
  const OPT_HI = ['option1_hi', 'option2_hi', 'option3_hi', 'option4_hi'] as const;
  const OPT_EN = ['option1_en', 'option2_en', 'option3_en', 'option4_en'] as const;

  for (const item of items) {
    const qn = item.question_r || '?';
    const ans = ansLabel(item.answer);

    // Question number
    kids.push(new Paragraph({
      children: [
        new TextRun({ text: `Q${qn}.`, bold: true, size: 26, color: C_BLUE, font: FONT_EN }),
        ...(item.subject ? [new TextRun({ text: `  [${item.subject}]`, size: 18, color: '777777', font: FONT_EN })] : []),
        ...(item.difficulty_level ? [new TextRun({ text: `  ${item.difficulty_level}`, size: 18, color: '999999', font: FONT_EN, italics: true })] : []),
      ],
      spacing: { before: 200, after: 80 },
    }));

    // Hindi
    if (language === 'hi' || language === 'both') {
      if (item.passage_hi) {
        const pe = await htmlLatexToElements(item.passage_hi, { lang: 'hi', italic: true, color: '444444' });
        kids.push(...pe);
      }
      const qe = await htmlLatexToElements(item.question_hi || '', { lang: 'hi' });
      kids.push(...qe);

      for (let i = 0; i < 4; i++) {
        const val = (item as any)[OPT_HI[i]] as string | undefined;
        if (!val) continue;
        const correct = OPT_LABELS[i] === ans;
        kids.push(new Paragraph({
          children: [new TextRun({ text: `(${OPT_LABELS[i]}) `, bold: correct && includeAnswer, color: correct && includeAnswer ? C_GREEN : '555555', font: FONT_EN, size: 22 })],
          spacing: { before: 20, after: 0 }, indent: { left: convertMillimetersToTwip(5) },
        }));
        const oe = await htmlLatexToElements(val, { lang: 'hi', bold: correct && includeAnswer, color: correct && includeAnswer ? C_GREEN : C_BLACK });
        oe.forEach(p => kids.push(new Paragraph({ ...p, indent: { left: convertMillimetersToTwip(15) } })));
      }
    }

    // English
    if (language === 'en' || language === 'both') {
      if (language === 'both') {
        kids.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '— English —', size: 18, color: 'BBBBBB', font: FONT_EN })], spacing: { before: 80, after: 40 } }));
      }
      if (item.passage_en) {
        const pe = await htmlLatexToElements(item.passage_en, { lang: 'en', italic: true, color: '444444' });
        kids.push(...pe);
      }
      const qe = await htmlLatexToElements(item.question_en || '', { lang: 'en' });
      kids.push(...qe);

      for (let i = 0; i < 4; i++) {
        const val = (item as any)[OPT_EN[i]] as string | undefined;
        if (!val) continue;
        const correct = OPT_LABELS[i] === ans;
        kids.push(new Paragraph({
          children: [new TextRun({ text: `(${OPT_LABELS[i]}) `, bold: correct && includeAnswer, color: correct && includeAnswer ? C_GREEN : '555555', font: FONT_EN, size: 22 })],
          spacing: { before: 20, after: 0 }, indent: { left: convertMillimetersToTwip(5) },
        }));
        const oe = await htmlLatexToElements(val, { lang: 'en', bold: correct && includeAnswer, color: correct && includeAnswer ? C_GREEN : C_BLACK });
        oe.forEach(p => kids.push(new Paragraph({ ...p, indent: { left: convertMillimetersToTwip(15) } })));
      }
    }

    // Answer badge
    if (includeAnswer) {
      kids.push(new Paragraph({
        children: [new TextRun({ text: `✓ Answer: ${ans}`, bold: true, size: 22, color: C_GREEN, font: FONT_EN })],
        spacing: { before: 80, after: 40 },
        shading: { type: ShadingType.SOLID, color: 'F0FAF0' },
      }));
    }

    // Solution
    if (includeSolution) {
      const hasSol = (language !== 'en' && item.solution_hi) || (language !== 'hi' && item.solution_en);
      if (hasSol) {
        kids.push(new Paragraph({
          children: [new TextRun({ text: '📌 Solution:', bold: true, size: 22, color: C_BROWN, font: FONT_EN })],
          spacing: { before: 60, after: 20 },
        }));
        if ((language === 'hi' || language === 'both') && item.solution_hi) {
          const se = await htmlLatexToElements(item.solution_hi, { lang: 'hi', color: '333333' });
          kids.push(...se);
        }
        if ((language === 'en' || language === 'both') && item.solution_en) {
          const se = await htmlLatexToElements(item.solution_en, { lang: 'en', color: '333333' });
          kids.push(...se);
        }
      }
    }

    kids.push(divider());
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT_EN, size: 24, color: C_BLACK },
          paragraph: { spacing: { line: 340, after: 80 } },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertMillimetersToTwip(20), bottom: convertMillimetersToTwip(20),
            left: convertMillimetersToTwip(25), right: convertMillimetersToTwip(20),
          },
        },
      },
      children: kids,
    }],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.docx') ? fileName : `${fileName}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
