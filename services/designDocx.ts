/**
 * Design Studio → Word (.docx).
 *
 * Renders the same theme + block styles the canvas shows, using the `docx` library.
 * Math and bold/italic inside text reuse the converters of the plain DOCX export.
 * Slides layout becomes 16:9 landscape pages, one slide per page.
 */
import {
  Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, ImageRun, Table, TableRow, TableCell,
  WidthType, Header, Footer, PageNumber, PageOrientation, ShadingType,
} from 'docx';
import { parseLineToChildren, createDocxTable, type DocxRunStyle } from './docxService';
import {
  type DesignDoc, type DesignBlock, type Theme, type BlockStyle, type Layout,
  SIZE_SCALE, HEADING_SCALE, PAGE_SIZE, LAYOUT_TEXT_SCALE, tint, questionNumbers, displayText,
} from './designDoc';

const FONTS: Record<Theme['font'], string> = { sans: 'Arial', serif: 'Times New Roman', hindi: 'Nirmala UI' };
const hex = (c: string) => c.replace('#', '');
const PX_TO_TWIP = 15;
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };

/** What a block looks like once the theme defaults and its own style are combined. */
export interface ResolvedStyle extends Required<Pick<BlockStyle, 'color' | 'align' | 'bold' | 'italic' | 'border' | 'borderColor'>> {
  background?: string;
  sizePt: number;
}

/** Theme defaults per block type + the block's own overrides. Shared with the canvas so both look the same. */
export function resolveStyle(theme: Theme, block: DesignBlock, layout: Layout = 'document'): ResolvedStyle {
  const s = block.style || {};
  const base = theme.baseSize * LAYOUT_TEXT_SCALE[layout];
  const out: ResolvedStyle = {
    color: theme.text, align: 'left', bold: false, italic: false, border: 'none', borderColor: theme.primary,
    sizePt: base,
  };
  switch (block.type) {
    case 'heading':
      out.bold = true;
      out.sizePt = base * HEADING_SCALE[block.level || 2];
      out.color = theme.headingStyle === 'banner' ? '#FFFFFF' : theme.primary;
      if (theme.headingStyle === 'banner') out.background = theme.primary;
      if (theme.headingStyle === 'bar') out.border = 'left-bar';
      break;
    case 'question':
      out.bold = true;
      if (theme.questionStyle === 'boxed') { out.border = 'box'; out.background = tint(theme.primary, 0.93); }
      if (theme.questionStyle === 'numbered-badge') out.color = theme.primary;
      break;
    case 'answer':
      out.bold = true; out.color = theme.accent;
      break;
    case 'callout':
      out.border = 'left-bar'; out.borderColor = theme.accent; out.background = tint(theme.accent, 0.9);
      break;
  }
  if (s.color) out.color = s.color;
  if (s.background) out.background = s.background;
  if (s.align) out.align = s.align;
  if (s.bold !== undefined) out.bold = s.bold;
  if (s.italic !== undefined) out.italic = s.italic;
  if (s.border) out.border = s.border;
  if (s.borderColor) out.borderColor = s.borderColor;
  if (s.size) out.sizePt *= SIZE_SCALE[s.size];
  return out;
}

const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT };

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

export async function generateDesignDocx(doc: DesignDoc): Promise<Blob> {
  const { theme } = doc;
  const page = PAGE_SIZE[doc.layout];
  const contentWidth = page.width - page.padding * 2;
  const numbers = questionNumbers(doc);
  const children: (Paragraph | Table)[] = [];
  let breakPending = false;          // the next paragraph starts a new page

  const paragraph = (block: DesignBlock, text: string, extra: Record<string, any> = {}) => {
    const st = resolveStyle(theme, block, doc.layout);
    const run: DocxRunStyle = { font: FONTS[theme.font], size: Math.round(st.sizePt * 2), color: hex(st.color), ...(st.italic && { italics: true }) };
    const line = (color: string, size: number) => ({ style: BorderStyle.SINGLE, size, color: hex(color), space: 6 });
    const border =
      st.border === 'box' ? { top: line(st.borderColor, 8), bottom: line(st.borderColor, 8), left: line(st.borderColor, 8), right: line(st.borderColor, 8) }
      : st.border === 'left-bar' ? { left: line(st.borderColor, 32) }
      : st.border === 'underline' ? { bottom: line(st.borderColor, 12) }
      : undefined;
    const p = new Paragraph({
      children: parseLineToChildren(text, st.bold, undefined, run) as any[],
      alignment: ALIGN[st.align],
      spacing: { before: block.type === 'heading' ? 200 : 80, after: block.type === 'heading' ? 140 : 80, line: 300 },
      ...(border && { border }),
      ...(st.background && { shading: { type: ShadingType.CLEAR, fill: hex(st.background), color: 'auto' } }),
      ...(breakPending && { pageBreakBefore: true }),
      ...extra,
    });
    breakPending = false;
    return p;
  };
  /** Tables cannot carry a page break themselves: spend it on an empty paragraph first. */
  const flushBreak = () => {
    if (!breakPending) return;
    children.push(new Paragraph({ pageBreakBefore: true, spacing: { before: 0, after: 0 }, children: [] }));
    breakPending = false;
  };

  for (const [pageIndex, designPage] of doc.pages.entries()) {
    breakPending = pageIndex > 0;
    if (designPage.title) {
      children.push(paragraph({ id: 'title', type: 'heading', level: 1 }, designPage.title));
    }

    const blocks = designPage.blocks;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];

      if (block.type === 'option' && theme.optionColumns > 1) {
        // Consecutive options share one borderless grid.
        const group: DesignBlock[] = [];
        while (i < blocks.length && blocks[i].type === 'option') group.push(blocks[i++]);
        i--;
        flushBreak();
        const columns = theme.optionColumns;
        const rows: TableRow[] = [];
        for (let r = 0; r < group.length; r += columns) {
          const cells = Array.from({ length: columns }, (_, c) => group[r + c]);
          rows.push(new TableRow({
            children: cells.map(option => new TableCell({
              width: { size: 100 / columns, type: WidthType.PERCENTAGE },
              borders: NO_BORDERS,
              children: [option ? paragraph(option, displayText(option)) : new Paragraph({ children: [] })],
            })),
          }));
        }
        children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE }, borders: { ...NO_BORDERS, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER } }));
        continue;
      }

      switch (block.type) {
        case 'image': {
          const data = block.assetId && doc.assets[block.assetId];
          if (!data || !/^data:image\/(png|jpe?g);base64,/.test(data)) break;
          const size = await imageSize(data, Math.min(contentWidth, 520), doc.layout === 'slides' ? 330 : 420);
          children.push(new Paragraph({
            children: [new ImageRun({ data, transformation: size })],
            alignment: ALIGN[block.style?.align || 'center'],
            spacing: { before: 120, after: 120 },
            ...(breakPending && { pageBreakBefore: true }),
          }));
          breakPending = false;
          break;
        }
        case 'table':
          flushBreak();
          children.push(createDocxTable((block.text || '').split('\n').filter(Boolean)));
          children.push(new Paragraph({ children: [], spacing: { before: 0, after: 80 } }));
          break;
        case 'divider':
          children.push(paragraph({ ...block, style: { ...block.style, border: 'underline' } }, ''));
          break;
        case 'list':
          for (const item of (block.text || '').split('\n').filter(Boolean)) {
            children.push(paragraph(block, item.replace(/^([-*•])\s+/, '•  '), { indent: { left: 360, hanging: 240 } }));
          }
          break;
        default:
          children.push(paragraph(block, displayText(block, numbers[block.id]), block.type === 'option' ? { indent: { left: 360 } } : {}));
      }
    }
  }
  if (!children.length) children.push(new Paragraph({ children: [] }));

  const small = (text: string | undefined, withPageNumber: boolean) => new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      ...(text ? [new TextRun({ text, font: FONTS[theme.font], size: 16, color: '6B7280' })] : []),
      ...(withPageNumber ? [new TextRun({ children: [text ? '   ·   ' : '', PageNumber.CURRENT], font: FONTS[theme.font], size: 16, color: '6B7280' })] : []),
    ],
  });
  const margin = page.padding * PX_TO_TWIP;

  const document = new Document({
    ...(theme.pageBackground.toUpperCase() !== '#FFFFFF' && { background: { color: hex(theme.pageBackground) } }),
    sections: [{
      properties: {
        page: {
          margin: { top: margin, right: margin, bottom: margin, left: margin },
          size: doc.layout === 'slides'
            // docx swaps width/height itself when the orientation is landscape
            ? { width: page.height * PX_TO_TWIP, height: page.width * PX_TO_TWIP, orientation: PageOrientation.LANDSCAPE }
            : { width: page.width * PX_TO_TWIP, height: page.height * PX_TO_TWIP, orientation: PageOrientation.PORTRAIT },
        },
      },
      ...(theme.header && { headers: { default: new Header({ children: [small(theme.header, false)] }) } }),
      ...((theme.footer || theme.showPageNumbers) && { footers: { default: new Footer({ children: [small(theme.footer, theme.showPageNumbers)] }) } }),
      children,
    }],
  });
  return Packer.toBlob(document);
}
