/**
 * Design Studio → Word (.docx).
 *
 * Draws what the canvas shows with the `docx` library: theme, per-element styles, teaching
 * boxes, highlighter pens, cover / section / two-column slides and page decorations.
 * Math and bold/italic inside text reuse the converters of the plain DOCX export.
 * Slides layout becomes 16:9 landscape pages, one slide per page.
 *
 * Word has no per-page background, so a slide with its own colour (or a section slide) is
 * drawn as one shaded panel that fills the area inside the page margins.
 */
import {
  Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, ImageRun, Table, TableRow, TableCell,
  WidthType, Header, Footer, PageNumber, PageOrientation, ShadingType, HeightRule, VerticalAlign,
  PageBorderOffsetFrom, PageBorderDisplay, LineRuleType,
} from 'docx';
import { parseLineToChildren, type DocxRunStyle } from './docxService';
import {
  type DesignDoc, type DesignBlock, type DesignPage, type StyleContext, type ResolvedStyle,
  FONTS, PAGE_SIZE, SPACING, IMAGE_WIDTH, HIGHLIGHT_TEXT,
  resolveStyle, pageFill, calloutInfo, mix, legible, questionNumbers, displayText, balanceStars, highlightSegments, plainText,
} from './designDoc';

export interface DesignDocxOptions {
  /** Append every slide's teacher notes after the last slide. */
  includeNotes?: boolean;
}

const hex = (c: string) => c.replace('#', '');
const PX_TO_TWIP = 15;
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };
const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT };
type Child = Paragraph | Table;

function imageSize(dataUrl: string, maxWidth: number, maxHeight: number): Promise<{ width: number; height: number }> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(maxWidth / img.naturalWidth, maxHeight / img.naturalHeight, 1);
      resolve({ width: Math.max(1, Math.round(img.naturalWidth * scale)), height: Math.max(1, Math.round(img.naturalHeight * scale)) });
    };
    img.onerror = () => resolve({ width: Math.min(maxWidth, 360), height: Math.min(maxHeight, 240) });
    img.src = dataUrl;
  });
}

export async function generateDesignDocx(doc: DesignDoc, options: DesignDocxOptions = {}): Promise<Blob> {
  const { theme } = doc;
  const slides = doc.layout === 'slides';
  const size = PAGE_SIZE[doc.layout];
  const usableWidth = size.width - size.padding * 2;
  const usableHeight = (size.height - size.padding * 2) * PX_TO_TWIP;
  const spacing = SPACING[theme.spacing || 'normal'];
  const numbers = questionNumbers(doc);

  const runStyle = (st: ResolvedStyle): DocxRunStyle => ({
    font: FONTS[st.font].docx, size: Math.round(st.sizePt * 2), color: hex(st.color),
    ...(st.italic && { italics: true }), ...(st.underline && { underline: {} }),
  });

  /** Text → runs. Highlighted words become shaded runs in their pen colour; the rest keeps bold/italic/math. */
  const runs = (text: string, bold: boolean, run: DocxRunStyle): any[] =>
    highlightSegments(text, theme.highlight).flatMap(part => part.fill
      ? parseLineToChildren(balanceStars(part.text), bold || !!part.bold, undefined,
        { ...run, color: hex(HIGHLIGHT_TEXT), shading: { type: ShadingType.CLEAR, fill: hex(part.fill), color: 'auto' } })
      : parseLineToChildren(balanceStars(part.text).replace(/==/g, ''), bold, undefined, run));

  const paragraphProps = (st: ResolvedStyle, heading: boolean) => {
    const line = (color: string, width: number) => ({ style: BorderStyle.SINGLE, size: width, color: hex(color), space: 6 });
    const border =
      st.border === 'box' ? { top: line(st.borderColor, 8), bottom: line(st.borderColor, 8), left: line(st.borderColor, 8), right: line(st.borderColor, 8) }
      : st.border === 'left-bar' ? { left: line(st.borderColor, 32) }
      : st.border === 'underline' ? { bottom: line(st.borderColor, 12) }
      : undefined;
    return {
      alignment: ALIGN[st.align],
      spacing: { before: Math.round((heading ? 200 : 80) * spacing), after: Math.round((heading ? 140 : 80) * spacing), line: Math.round(290 * spacing) },
      ...(border && { border }),
      ...(st.background && { shading: { type: ShadingType.CLEAR, fill: hex(st.background), color: 'auto' } }),
    };
  };

  const paragraph = (block: Pick<DesignBlock, 'type' | 'level' | 'variant' | 'style'>, text: string, ctx: StyleContext, extra: Record<string, any> = {}) => {
    const st = resolveStyle(theme, block, ctx);
    return new Paragraph({ children: runs(text, st.bold, runStyle(st)), ...paragraphProps(st, block.type === 'heading'), ...extra });
  };

  /** A Markdown table, in the theme's colours. */
  const table = (block: DesignBlock, ctx: StyleContext, fill: string): Table => {
    const st = resolveStyle(theme, block, ctx);
    const run = runStyle(st);
    const edge = { style: BorderStyle.SINGLE, size: 6, color: hex(mix(st.color, fill, 0.45)) };
    const headerFill = mix(theme.primary, fill, 0.8);
    const lines = (block.text || '').split('\n').filter(l => l.trim() && !/^\|\s*[-:]+/.test(l));
    const rows = lines.map((line, r) => {
      const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
      return new TableRow({
        children: cells.map(cell => new TableCell({
          width: { size: 100 / cells.length, type: WidthType.PERCENTAGE },
          verticalAlign: VerticalAlign.CENTER,
          borders: { top: edge, bottom: edge, left: edge, right: edge },
          ...(r === 0 && { shading: { type: ShadingType.CLEAR, fill: hex(headerFill), color: 'auto' } }),
          children: [new Paragraph({
            children: runs(cell.trim(), r === 0 || st.bold, r === 0 ? { ...run, color: hex(legible(st.color, headerFill, 3)) } : run),
            alignment: AlignmentType.CENTER, spacing: { before: 40, after: 40 },
          })],
        })),
      });
    });
    return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
  };

  /** One slide's blocks → Word content. `width` is the px width they may use (half in a column). */
  const renderBlocks = async (blocks: DesignBlock[], ctx: StyleContext, fill: string, width: number): Promise<Child[]> => {
    const out: Child[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];

      if (block.type === 'option' && theme.optionColumns > 1) {
        // Consecutive options share one borderless grid.
        const group: DesignBlock[] = [];
        while (i < blocks.length && blocks[i].type === 'option') group.push(blocks[i++]);
        i--;
        const columns = theme.optionColumns;
        const rows: TableRow[] = [];
        for (let r = 0; r < group.length; r += columns) {
          rows.push(new TableRow({
            children: Array.from({ length: columns }, (_, c) => group[r + c]).map(option => new TableCell({
              width: { size: 100 / columns, type: WidthType.PERCENTAGE },
              borders: NO_BORDERS,
              children: [option ? paragraph(option, displayText(option), ctx) : new Paragraph({ children: [] })],
            })),
          }));
        }
        out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE }, borders: { ...NO_BORDERS, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER } }));
        continue;
      }

      switch (block.type) {
        case 'image': {
          const data = block.assetId && doc.assets[block.assetId];
          if (!data || !/^data:image\/(png|jpe?g);base64,/.test(data)) break;
          const st = resolveStyle(theme, block, ctx);
          const box = await imageSize(data, Math.round(width * IMAGE_WIDTH[st.width]), slides ? 400 : 520);
          out.push(new Paragraph({
            children: [new ImageRun({ data, transformation: box })],
            alignment: ALIGN[block.style?.align || theme.styles?.image?.align || 'center'],
            spacing: { before: 120, after: 120 },
          }));
          break;
        }
        case 'table':
          out.push(table(block, ctx, fill));
          out.push(new Paragraph({ children: [], spacing: { before: 0, after: 80 } }));
          break;
        case 'divider':
          out.push(paragraph({ ...block, style: { ...block.style, border: 'underline' } }, '', ctx));
          break;
        case 'list':
          for (const item of (block.text || '').split('\n').filter(Boolean)) {
            out.push(paragraph(block, item.replace(/^([-*•])\s+/, '•  '), ctx, { indent: { left: 360, hanging: 240 } }));
          }
          break;
        case 'callout': {
          // Label line + body share the same bar and shading, so Word joins them into one box.
          const info = calloutInfo(block, theme);
          const st = resolveStyle(theme, block, ctx);
          if (info?.label) {
            const tone = legible(info.color, st.background || fill, 4.5);
            out.push(new Paragraph({
              children: [
                new TextRun({ text: info.icon + ' ', font: 'Segoe UI Emoji', size: Math.round(st.sizePt * 1.7) }),
                new TextRun({ text: info.label, font: FONTS[st.font].docx, size: Math.round(st.sizePt * 1.7), bold: true, color: hex(tone) }),
              ],
              ...paragraphProps(st, false), keepNext: true,
            }));
          }
          out.push(paragraph(block, block.text || '', ctx));
          break;
        }
        default:
          out.push(paragraph(block, displayText(block, numbers[block.id]), ctx, block.type === 'option' ? { indent: { left: 360 } } : {}));
      }
    }
    return out;
  };

  /** Rough size of a block, to balance two columns. */
  const weight = (b: DesignBlock) => b.type === 'image' ? 500 : b.type === 'table' ? 120 + (b.text || '').split('\n').length * 90 : 90 + plainText(b.text || '').length;

  /** A cell must end with a paragraph. */
  const cellChildren = (items: Child[]) => items.length && items[items.length - 1] instanceof Paragraph ? items : [...items, new Paragraph({ children: [] })];

  const renderPage = async (page: DesignPage): Promise<Child[]> => {
    const ctx: StyleContext = { layout: doc.layout, pageScale: page.scale, pageLayout: page.layout, pageBackground: page.background };
    const fill = pageFill(theme, page);
    const ownFill = fill.toUpperCase() !== theme.pageBackground.toUpperCase() ? fill : undefined;
    const special = page.layout === 'title' || page.layout === 'section';
    const content: Child[] = [];
    if (page.title) content.push(paragraph({ type: 'heading', level: 1 }, page.title, { ...ctx, key: 'title' }));

    if (page.layout === 'two-column' && page.blocks.length > 1) {
      // A leading heading runs across both columns.
      const lead = page.blocks[0].type === 'heading' ? 1 : 0;
      content.push(...await renderBlocks(page.blocks.slice(0, lead), ctx, fill, usableWidth));
      const rest = page.blocks.slice(lead);
      const total = rest.reduce((n, b) => n + weight(b), 0);
      let cut = 0, run = 0;
      while (cut < rest.length - 1 && run + weight(rest[cut]) / 2 < total / 2) run += weight(rest[cut++]);
      cut = Math.max(1, cut);
      const half = usableWidth / 2 - 16;
      const column = async (blocks: DesignBlock[], pad: 'left' | 'right') => new TableCell({
        width: { size: 50, type: WidthType.PERCENTAGE }, borders: NO_BORDERS,
        margins: { [pad]: 200 },
        children: cellChildren(await renderBlocks(blocks, ctx, fill, half)),
      });
      content.push(new Table({
        rows: [new TableRow({ children: [await column(rest.slice(0, cut), 'right'), await column(rest.slice(cut), 'left')] })],
        width: { size: 100, type: WidthType.PERCENTAGE }, borders: { ...NO_BORDERS, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
      }));
    } else {
      content.push(...await renderBlocks(page.blocks, ctx, fill, usableWidth));
    }

    if (!ownFill && !(special && slides)) return content;
    // One panel filling the slide: its own colour, and (covers, section slides) content centred vertically.
    return [new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { ...NO_BORDERS, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
      rows: [new TableRow({
        ...(slides && { height: { value: usableHeight - 600, rule: HeightRule.ATLEAST } }),
        children: [new TableCell({
          borders: NO_BORDERS,
          verticalAlign: special ? VerticalAlign.CENTER : VerticalAlign.TOP,
          margins: { top: 200, bottom: 200, left: 300, right: 300 },
          ...(ownFill && { shading: { type: ShadingType.CLEAR, fill: hex(ownFill), color: 'auto' } }),
          children: cellChildren(content),
        })],
      })],
    })];
  };

  // ---- pages --------------------------------------------------------------------
  const children: Child[] = [];
  /** An (almost) zero-height paragraph that starts a new page; works before tables too. */
  const pageBreak = () => new Paragraph({
    pageBreakBefore: true, spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
    children: [new TextRun({ text: '', size: 2 })],
  });
  for (const [index, page] of doc.pages.entries()) {
    if (index > 0) children.push(pageBreak());
    children.push(...await renderPage(page));
  }

  const notes = options.includeNotes ? doc.pages.map((page, i) => ({ page, i })).filter(x => x.page.notes) : [];
  if (notes.length) {
    const ctx: StyleContext = { layout: 'document' };
    children.push(pageBreak());
    children.push(paragraph({ type: 'heading', level: 1 }, theme.labelLang === 'hi' ? 'शिक्षक के लिए नोट्स' : 'Teacher notes', ctx));
    for (const { page, i } of notes) {
      const name = plainText(page.title || (page.blocks[0]?.type === 'heading' ? page.blocks[0].text || '' : ''));
      children.push(paragraph({ type: 'heading', level: 3 }, `${slides ? 'Slide' : 'Section'} ${i + 1}${name ? ' — ' + name : ''}`, ctx));
      for (const line of page.notes!.split('\n').filter(l => l.trim())) children.push(paragraph({ type: 'paragraph' }, line, ctx));
    }
  }
  if (!children.length) children.push(new Paragraph({ children: [] }));

  // ---- header, footer, page decoration ----------------------------------------------
  const running = (key: 'header' | 'footer', text: string | undefined, withPageNumber: boolean) => {
    const st = resolveStyle(theme, { type: 'paragraph' }, { layout: doc.layout, key });
    const run = { font: FONTS[st.font].docx, size: Math.round(st.sizePt * 2), color: hex(st.color), bold: st.bold, italics: st.italic };
    return new Paragraph({
      alignment: ALIGN[st.align],
      children: [
        ...(text ? [new TextRun({ text, ...run })] : []),
        ...(withPageNumber ? [new TextRun({ children: [text ? '   ·   ' : '', PageNumber.CURRENT], ...run })] : []),
      ],
    });
  };
  const margin = size.padding * PX_TO_TWIP;
  const bar = { style: BorderStyle.SINGLE, size: 96, color: hex(theme.primary), space: 0 };       // 12 pt, the widest Word allows
  const frame = { style: BorderStyle.SINGLE, size: 24, color: hex(theme.primary), space: 14 };
  const decoration = theme.decoration || 'none';
  const borders = decoration === 'none' ? undefined : {
    pageBorders: { offsetFrom: PageBorderOffsetFrom.PAGE, display: PageBorderDisplay.ALL_PAGES },
    ...(decoration === 'top-bar' && { pageBorderTop: bar }),
    ...(decoration === 'bottom-bar' && { pageBorderBottom: bar }),
    ...(decoration === 'left-bar' && { pageBorderLeft: bar }),
    ...(decoration === 'frame' && { pageBorderTop: frame, pageBorderBottom: frame, pageBorderLeft: frame, pageBorderRight: frame }),
  };

  const document = new Document({
    ...(theme.pageBackground.toUpperCase() !== '#FFFFFF' && { background: { color: hex(theme.pageBackground) } }),
    sections: [{
      properties: {
        page: {
          margin: { top: margin, right: margin, bottom: margin, left: margin },
          size: slides
            // docx swaps width/height itself when the orientation is landscape
            ? { width: size.height * PX_TO_TWIP, height: size.width * PX_TO_TWIP, orientation: PageOrientation.LANDSCAPE }
            : { width: size.width * PX_TO_TWIP, height: size.height * PX_TO_TWIP, orientation: PageOrientation.PORTRAIT },
          ...(borders && { borders }),
        },
      },
      ...(theme.header && { headers: { default: new Header({ children: [running('header', theme.header, false)] }) } }),
      ...((theme.footer || theme.showPageNumbers) && { footers: { default: new Footer({ children: [running('footer', theme.footer, theme.showPageNumbers)] }) } }),
      children,
    }],
  });
  return Packer.toBlob(document);
}
