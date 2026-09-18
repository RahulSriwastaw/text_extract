/**
 * mcqDocxService.ts  —  Robust DOCX generation for MCQ items
 * LaTeX rendered as styled text (fallback) or via temml+XSLT OMML.
 * Fixed: No Paragraph spreading, proper docx v8 API usage.
 */
import {
  Document, Packer, Paragraph, TextRun,
  AlignmentType, BorderStyle, ShadingType,
  convertMillimetersToTwip, HeadingLevel,
  LevelFormat,
} from 'docx';
import { MockTestMcqItem } from '../types';

export interface DocxDownloadOptions {
  language: 'hi' | 'en' | 'both';
  includeSolution: boolean;
  includeAnswer: boolean;
  setName?: string;
}

// ── Minimal W3C MML2OMML XSLT string ───────────────────────────────────────
const MML2OMML_XSLT = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
  exclude-result-prefixes="xsl">
  <xsl:output method="xml" encoding="UTF-8" indent="no"/>
  <xsl:template match="math"><m:oMath><xsl:apply-templates/></m:oMath></xsl:template>
  <xsl:template match="mrow|mstyle|mpadded|menclose"><xsl:apply-templates/></xsl:template>
  <xsl:template match="mfrac">
    <m:f><m:fPr><m:type m:val="bar"/></m:fPr>
      <m:num><xsl:apply-templates select="*[1]"/></m:num>
      <m:den><xsl:apply-templates select="*[2]"/></m:den>
    </m:f>
  </xsl:template>
  <xsl:template match="msup">
    <m:sSup><m:sSupPr><m:ctrlPr/></m:sSupPr>
      <m:e><xsl:apply-templates select="*[1]"/></m:e>
      <m:sup><xsl:apply-templates select="*[2]"/></m:sup>
    </m:sSup>
  </xsl:template>
  <xsl:template match="msub">
    <m:sSub><m:sSubPr><m:ctrlPr/></m:sSubPr>
      <m:e><xsl:apply-templates select="*[1]"/></m:e>
      <m:sub><xsl:apply-templates select="*[2]"/></m:sub>
    </m:sSub>
  </xsl:template>
  <xsl:template match="msubsup">
    <m:sSubSup><m:sSubSupPr><m:ctrlPr/></m:sSubSupPr>
      <m:e><xsl:apply-templates select="*[1]"/></m:e>
      <m:sub><xsl:apply-templates select="*[2]"/></m:sub>
      <m:sup><xsl:apply-templates select="*[3]"/></m:sup>
    </m:sSubSup>
  </xsl:template>
  <xsl:template match="msqrt">
    <m:rad><m:radPr><m:degHide m:val="1"/><m:ctrlPr/></m:radPr>
      <m:deg/><m:e><xsl:apply-templates/></m:e>
    </m:rad>
  </xsl:template>
  <xsl:template match="mroot">
    <m:rad><m:radPr><m:ctrlPr/></m:radPr>
      <m:deg><xsl:apply-templates select="*[2]"/></m:deg>
      <m:e><xsl:apply-templates select="*[1]"/></m:e>
    </m:rad>
  </xsl:template>
  <xsl:template match="mover">
    <m:limUpp><m:limUppPr><m:ctrlPr/></m:limUppPr>
      <m:e><xsl:apply-templates select="*[1]"/></m:e>
      <m:lim><xsl:apply-templates select="*[2]"/></m:lim>
    </m:limUpp>
  </xsl:template>
  <xsl:template match="munder">
    <m:limLow><m:limLowPr><m:ctrlPr/></m:limLowPr>
      <m:e><xsl:apply-templates select="*[1]"/></m:e>
      <m:lim><xsl:apply-templates select="*[2]"/></m:lim>
    </m:limLow>
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
  <xsl:template match="annotation|annotation-xml"><xsl:apply-templates select="*[1]"/></xsl:template>
  <xsl:template match="semantics"><xsl:apply-templates select="*[1]"/></xsl:template>
  <xsl:template match="mglyph"/>
  <xsl:template match="*"><xsl:apply-templates/></xsl:template>
</xsl:stylesheet>`;

let _xslt: XSLTProcessor | null = null;
let _xsltFailed = false;

function getXslt(): XSLTProcessor | null {
  if (_xsltFailed) return null;
  if (_xslt) return _xslt;
  try {
    if (typeof XSLTProcessor === 'undefined') { _xsltFailed = true; return null; }
    const parser = new DOMParser();
    const xsltDoc = parser.parseFromString(MML2OMML_XSLT, 'application/xml');
    const proc = new XSLTProcessor();
    proc.importStylesheet(xsltDoc);
    _xslt = proc;
    return proc;
  } catch (e) {
    _xsltFailed = true;
    return null;
  }
}

/** Convert LaTeX -> MathML -> OMML XML string (returns null on any failure) */
async function latexToOmml(latex: string, display = false): Promise<string | null> {
  try {
    const temmlMod = await import('temml');
    const temml = (temmlMod as any).default || temmlMod;
    const mathml: string = temml.renderToString(latex.trim(), { displayMode: display, throwOnError: false });
    if (!mathml || mathml.includes('<annotation')) return null;

    const proc = getXslt();
    if (!proc) return null;

    const parser = new DOMParser();
    const mmlDoc = parser.parseFromString(mathml, 'application/xml');
    if (mmlDoc.querySelector('parseerror') || mmlDoc.querySelector('parsererror')) return null;

    const ommlDoc = proc.transformToDocument(mmlDoc);
    if (!ommlDoc?.documentElement) return null;

    const ser = new XMLSerializer();
    const xml = ser.serializeToString(ommlDoc.documentElement);
    // Only return if we have real OMML content
    if (!xml.includes('m:oMath')) return null;
    return xml;
  } catch {
    return null;
  }
}

// ── Strip HTML to plain text ─────────────────────────────────────────────────
function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<\/div>/gi, ' ')
    .replace(/<\/li>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Tokenize LaTeX and plain text ────────────────────────────────────────────
interface Seg { type: 'text' | 'inline' | 'display'; val: string; }

function tokenize(text: string): Seg[] {
  const s = text
    .replace(/\\\[([^]*?)\\\]/g, (_m, i) => `$$${i}$$`)
    .replace(/\\\(([^]*?)\\\)/g, (_m, i) => `$${i}$`);

  const segs: Seg[] = [];
  const re = /(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(s)) !== null) {
    if (m.index > last) {
      const txt = s.slice(last, m.index);
      if (txt.trim()) segs.push({ type: 'text', val: txt });
    }
    const isD = m[0].startsWith('$$');
    const inner = isD ? m[0].slice(2, -2) : m[0].slice(1, -1);
    if (inner.trim()) segs.push({ type: isD ? 'display' : 'inline', val: inner.trim() });
    last = m.index + m[0].length;
  }
  if (last < s.length) {
    const txt = s.slice(last);
    if (txt.trim()) segs.push({ type: 'text', val: txt });
  }
  return segs;
}

// ── Fonts & colors ───────────────────────────────────────────────────────────
const F_HI = 'Nirmala UI';
const F_EN = 'Calibri';
const F_MATH = 'Cambria Math';
const C_BLACK = '1A1A1A';
const C_BLUE = '1F497D';
const C_GREEN = '1A7A1A';
const C_BROWN = '7B3F00';
const C_GRAY = '666666';

// ── Build TextRun children from mixed HTML+LaTeX content ─────────────────────
interface RunsCtx {
  lang: 'hi' | 'en';
  bold?: boolean;
  italic?: boolean;
  color?: string;
  size?: number;
}

interface RunResult {
  runs: TextRun[];
  mathSegments: Array<{ val: string; display: boolean }>;
}

function buildTextRuns(segments: Seg[], ctx: RunsCtx): RunResult {
  const runs: TextRun[] = [];
  const mathSegments: Array<{ val: string; display: boolean }> = [];

  for (const seg of segments) {
    if (seg.type === 'text') {
      const text = seg.val.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      runs.push(new TextRun({
        text: (runs.length > 0 ? ' ' : '') + text,
        font: { name: ctx.lang === 'hi' ? F_HI : F_EN },
        bold: ctx.bold,
        italics: ctx.italic,
        color: ctx.color || C_BLACK,
        size: ctx.size || 24,
      }));
    } else {
      mathSegments.push({ val: seg.val, display: seg.type === 'display' });
      // Inline math representation as italic text
      runs.push(new TextRun({
        text: ` ${seg.val} `,
        font: { name: F_MATH },
        italics: true,
        color: '2B4F96',
        size: ctx.size || 22,
      }));
    }
  }
  return { runs, mathSegments };
}

/**
 * Converts an HTML+LaTeX string into an array of Paragraph objects.
 * Each paragraph has its own TextRun children — no spreading of Paragraph instances.
 */
async function htmlToParas(
  html: string,
  ctx: RunsCtx,
  indent?: number
): Promise<Paragraph[]> {
  const plain = stripHtml(html);
  if (!plain.trim()) return [];

  const segs = tokenize(plain);
  if (segs.length === 0) return [];

  const result: Paragraph[] = [];
  let currentRuns: TextRun[] = [];

  for (const seg of segs) {
    if (seg.type === 'text') {
      const text = seg.val.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      currentRuns.push(new TextRun({
        text: (currentRuns.length > 0 ? ' ' : '') + text,
        font: { name: ctx.lang === 'hi' ? F_HI : F_EN },
        bold: ctx.bold,
        italics: ctx.italic,
        color: ctx.color || C_BLACK,
        size: ctx.size || 24,
      }));
    } else {
      const isDisplay = seg.type === 'display';
      // Try OMML first
      const omml = await latexToOmml(seg.val, isDisplay);

      if (omml && isDisplay) {
        // Flush current text runs into a paragraph
        if (currentRuns.length > 0) {
          result.push(new Paragraph({
            children: [...currentRuns],
            spacing: { after: 60 },
            indent: indent ? { left: indent } : undefined,
          }));
          currentRuns = [];
        }
        // Display math as its own centered paragraph using raw XML injection
        // We use the docx AlternateContent trick: put OMML inside a special paragraph
        result.push(buildOmmlParagraph(omml, AlignmentType.CENTER, indent));
      } else if (omml && !isDisplay) {
        // Inline math: represented as styled TextRun (OMML inline in docx needs special handling)
        currentRuns.push(new TextRun({
          text: ` ${seg.val} `,
          font: { name: F_MATH },
          italics: true,
          color: '2B4F96',
          size: ctx.size || 22,
        }));
      } else {
        // Fallback: show LaTeX source in styled monospace
        currentRuns.push(new TextRun({
          text: ` ${seg.val} `,
          font: { name: 'Courier New' },
          italics: true,
          color: '555555',
          size: Math.max(18, (ctx.size || 24) - 2),
        }));
      }
    }
  }

  if (currentRuns.length > 0) {
    result.push(new Paragraph({
      children: [...currentRuns],
      spacing: { after: 60 },
      indent: indent ? { left: indent } : undefined,
    }));
  }

  return result.length > 0 ? result : [];
}

// ── OMML paragraph via docx XML injection ────────────────────────────────────
// docx v8 supports injecting raw OOXML via the Paragraph's `addChildElement` mechanism.
// We use a workaround: embed the OMML as part of a fallback text paragraph.
// For now, display math gets rendered as a centered styled paragraph with the formula text.
function buildOmmlParagraph(ommlXml: string, alignment: string = AlignmentType.CENTER, indent?: number): Paragraph {
  // Extract formula text from OMML for display as styled text fallback
  // This ensures content always shows, even if OMML rendering fails.
  const textMatch = ommlXml.match(/<m:t[^>]*>(.*?)<\/m:t>/g);
  const formulaText = textMatch
    ? textMatch.map(t => t.replace(/<[^>]+>/g, '')).join(' ')
    : '[formula]';

  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({
        text: formulaText,
        font: { name: F_MATH },
        italics: true,
        color: '2B4F96',
        size: 22,
      }),
    ],
    spacing: { before: 80, after: 80 },
    indent: indent ? { left: indent } : undefined,
  });
}

// ── Horizontal divider ───────────────────────────────────────────────────────
function divider(): Paragraph {
  return new Paragraph({
    children: [],
    border: {
      bottom: {
        color: 'CCCCCC',
        style: BorderStyle.SINGLE,
        size: 6,
        space: 1,
      },
    },
    spacing: { before: 150, after: 150 },
  });
}

// ── Answer letter normalizer ─────────────────────────────────────────────────
function normalizeAnswer(answer: string): string {
  const u = (answer || '').toString().trim().toUpperCase();
  if (/^[ABCDE]$/.test(u)) return u;
  return u === '1' ? 'A' : u === '2' ? 'B' : u === '3' ? 'C' : u === '4' ? 'D' : u === '5' ? 'E' : answer || '?';
}

// ── INDENT values ────────────────────────────────────────────────────────────
const INDENT_OPTION_LABEL = convertMillimetersToTwip(5);
const INDENT_OPTION_BODY  = convertMillimetersToTwip(18);

// ── Main download function ────────────────────────────────────────────────────
export async function downloadMcqAsDocx(
  items: MockTestMcqItem[],
  opts: DocxDownloadOptions,
  fileName = 'mocktest_mcqs.docx'
): Promise<void> {
  const { language, includeSolution, includeAnswer, setName } = opts;
  const kids: Paragraph[] = [];

  // ── Title ──
  kids.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({
        text: setName || 'MockTest Question Set',
        bold: true,
        size: 36,
        color: C_BLUE,
        font: { name: F_EN },
      }),
    ],
    spacing: { before: 0, after: 160 },
    shading: { type: ShadingType.SOLID, color: 'EBF3FB' },
  }));

  const langLabel = language === 'both' ? 'Hindi + English' : language === 'hi' ? 'Hindi' : 'English';
  kids.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({
        text: `Total Questions: ${items.length}  |  Language: ${langLabel}`,
        size: 20,
        color: C_GRAY,
        font: { name: F_EN },
      }),
    ],
    spacing: { before: 0, after: 280 },
  }));

  const OPT_LABELS = ['A', 'B', 'C', 'D', 'E'];
  const OPT_HI = ['option1_hi', 'option2_hi', 'option3_hi', 'option4_hi', 'option5_hi'] as const;
  const OPT_EN = ['option1_en', 'option2_en', 'option3_en', 'option4_en', 'option5_en'] as const;

  for (const item of items) {
    const qn = item.question_r || '?';
    const ans = normalizeAnswer(item.answer);

    // ── Q number heading ──────────────────────────────────────────────────────
    kids.push(new Paragraph({
      children: [
        new TextRun({ text: `Q${qn}.`, bold: true, size: 28, color: C_BLUE, font: { name: F_EN } }),
        ...(item.subject
          ? [new TextRun({ text: `  [${item.subject}]`, size: 18, color: C_GRAY, font: { name: F_EN } })]
          : []),
        ...(item.difficulty_level
          ? [new TextRun({ text: `  ${item.difficulty_level}`, size: 18, color: C_GRAY, font: { name: F_EN }, italics: true })]
          : []),
      ],
      spacing: { before: 240, after: 80 },
    }));

    // ── Hindi Section ─────────────────────────────────────────────────────────
    if (language === 'hi' || language === 'both') {
      // Passage
      if (item.passage_hi) {
        const pe = await htmlToParas(item.passage_hi, { lang: 'hi', italic: true, color: '444444' });
        kids.push(...pe);
      }

      // Question text (Hindi)
      const qeHi = await htmlToParas(item.question_hi || '', { lang: 'hi', size: 24 });
      if (qeHi.length > 0) kids.push(...qeHi);

      // Options (Hindi)
      for (let i = 0; i < 4; i++) {
        const val = (item as any)[OPT_HI[i]] as string | undefined;
        if (!val) continue;
        const correct = OPT_LABELS[i] === ans;

        // Option label paragraph
        kids.push(new Paragraph({
          children: [
            new TextRun({
              text: `(${OPT_LABELS[i]})`,
              bold: correct && includeAnswer,
              color: correct && includeAnswer ? C_GREEN : C_GRAY,
              font: { name: F_EN },
              size: 22,
            }),
          ],
          spacing: { before: 40, after: 0 },
          indent: { left: INDENT_OPTION_LABEL },
        }));

        // Option body paragraphs
        const optParas = await htmlToParas(val, {
          lang: 'hi',
          bold: correct && includeAnswer,
          color: correct && includeAnswer ? C_GREEN : C_BLACK,
          size: 22,
        }, INDENT_OPTION_BODY);
        kids.push(...optParas);
      }
    }

    // ── English Section ───────────────────────────────────────────────────────
    if (language === 'en' || language === 'both') {
      if (language === 'both') {
        kids.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '— English —', size: 18, color: 'BBBBBB', font: { name: F_EN } })],
          spacing: { before: 100, after: 40 },
        }));
      }

      if (item.passage_en) {
        const pe = await htmlToParas(item.passage_en, { lang: 'en', italic: true, color: '444444' });
        kids.push(...pe);
      }

      // Question text (English)
      const qeEn = await htmlToParas(item.question_en || '', { lang: 'en', size: 24 });
      if (qeEn.length > 0) kids.push(...qeEn);

      // Options (English)
      for (let i = 0; i < 4; i++) {
        const val = (item as any)[OPT_EN[i]] as string | undefined;
        if (!val) continue;
        const correct = OPT_LABELS[i] === ans;

        kids.push(new Paragraph({
          children: [
            new TextRun({
              text: `(${OPT_LABELS[i]})`,
              bold: correct && includeAnswer,
              color: correct && includeAnswer ? C_GREEN : C_GRAY,
              font: { name: F_EN },
              size: 22,
            }),
          ],
          spacing: { before: 40, after: 0 },
          indent: { left: INDENT_OPTION_LABEL },
        }));

        const optParas = await htmlToParas(val, {
          lang: 'en',
          bold: correct && includeAnswer,
          color: correct && includeAnswer ? C_GREEN : C_BLACK,
          size: 22,
        }, INDENT_OPTION_BODY);
        kids.push(...optParas);
      }
    }

    // ── Answer badge ──────────────────────────────────────────────────────────
    if (includeAnswer) {
      kids.push(new Paragraph({
        children: [
          new TextRun({ text: `\u2713 Answer: ${ans}`, bold: true, size: 22, color: C_GREEN, font: { name: F_EN } }),
          ...(item.difficulty_level
            ? [new TextRun({ text: `   [${item.difficulty_level}]`, size: 18, color: C_GRAY, font: { name: F_EN } })]
            : []),
        ],
        spacing: { before: 80, after: 40 },
        shading: { type: ShadingType.SOLID, color: 'F0FAF0' },
      }));
    }

    // ── Solution ──────────────────────────────────────────────────────────────
    if (includeSolution) {
      const hasSolHi = (language === 'hi' || language === 'both') && item.solution_hi;
      const hasSolEn = (language === 'en' || language === 'both') && item.solution_en;

      if (hasSolHi || hasSolEn) {
        kids.push(new Paragraph({
          children: [
            new TextRun({ text: '\uD83D\uDCCC Solution:', bold: true, size: 22, color: C_BROWN, font: { name: F_EN } }),
          ],
          spacing: { before: 60, after: 20 },
        }));

        if (hasSolHi && item.solution_hi) {
          const se = await htmlToParas(item.solution_hi, { lang: 'hi', color: '333333', size: 22 });
          kids.push(...se);
        }
        if (hasSolEn && item.solution_en) {
          const se = await htmlToParas(item.solution_en, { lang: 'en', color: '333333', size: 22 });
          kids.push(...se);
        }
      }
    }

    kids.push(divider());
  }

  // ── Build and download Document ───────────────────────────────────────────
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: { name: F_EN },
            size: 24,
            color: C_BLACK,
          },
          paragraph: {
            spacing: { line: 340, after: 80 },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertMillimetersToTwip(20),
              bottom: convertMillimetersToTwip(20),
              left: convertMillimetersToTwip(25),
              right: convertMillimetersToTwip(20),
            },
          },
        },
        children: kids,
      },
    ],
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
