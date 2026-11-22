import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { Pencil, Trash2, ArrowUp, ArrowDown, Check, X, Copy, Plus, StickyNote, Bold, Eraser } from 'lucide-react';
import { normalizePreviewMath } from '../ProcessingList';
import {
  type DesignDoc, type DesignBlock, type DesignPage, type DesignOp, type StyleKey, type StyleContext, type HighlighterId, type PageLayout,
  PAGE_SIZE, FONTS, HIGHLIGHTERS, HIGHLIGHTER_IDS, IMAGE_WIDTH, SPACING, PAGE_LAYOUTS,
  displayText, questionNumbers, wordCount, emphasisToLinks, resolveStyle, pageFill, calloutInfo, styleKey, mix, legible,
} from '../../services/designDoc';

const PT = 96 / 72;   // pt → CSS px
const LINE_HEIGHT = { compact: 1.3, normal: 1.45, relaxed: 1.65 };
const LAYOUT_LABEL: Record<PageLayout, string> = { content: 'Content', title: 'Cover / title', section: 'Section divider', 'two-column': 'Two columns' };

export type OpResult = { applied: number; skipped: number };

/** Everything that makes a page editable. Without it (present mode, print) the page is read-only. */
export interface CanvasActions {
  /** `coalesce`: changes with the same key in quick succession are one Undo step (sliders, colour pickers). */
  onOps: (ops: DesignOp[], coalesce?: string) => OpResult;
  selectedBlockId?: string;
  onSelectBlock: (id: string | undefined) => void;
  /** Outline every element of this kind ("show me all H2"). */
  highlightKey?: StyleKey;
}

const markdownComponents = {
  // **bold** and ==highlight== arrive as links (see emphasisToLinks); real links are not clickable on a page preview.
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    const m = href?.match(/^#(hlb|hl|b)(?:-([a-z]+))?$/);
    if (!m) return <span>{children}</span>;
    if (m[1] === 'b') return <strong>{children}</strong>;
    const pen = m[2] && m[2] in HIGHLIGHTERS ? HIGHLIGHTERS[m[2] as HighlighterId] : undefined;
    return <mark style={pen ? { background: pen } : undefined}>{m[1] === 'hlb' ? <strong>{children}</strong> : children}</mark>;
  },
};

const Markdown = React.memo(({ text }: { text: string }) => (
  <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
    {emphasisToLinks(normalizePreviewMath(text))}
  </ReactMarkdown>
));

interface BlockViewProps {
  block: DesignBlock;
  doc: DesignDoc;
  page: DesignPage;
  number?: number;
  actions?: CanvasActions;
  previousId?: string;
  nextId?: string;
  /** This is the slide's title line, not a real block. */
  isTitle?: boolean;
  /** Present mode: keep the space but hide the content (answers before they are revealed). */
  hidden?: boolean;
  spanColumns?: boolean;
}

function BlockView({ block, doc, page, number, actions, previousId, nextId, isTitle, hidden, spanColumns }: BlockViewProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const { theme } = doc;
  const ctx: StyleContext = { layout: doc.layout, pageScale: page.scale, pageLayout: page.layout, pageBackground: page.background, ...(isTitle && { key: 'title' as const }) };
  const st = resolveStyle(theme, block, ctx);
  const fill = pageFill(theme, page);
  const gap = SPACING[theme.spacing || 'normal'];
  const key = isTitle ? 'title' : styleKey(block);

  const thin = `1px solid ${st.borderColor}`, none = '0 solid transparent';
  const style: React.CSSProperties = {
    color: st.color, textAlign: st.align, fontWeight: st.bold ? 700 : 400, fontStyle: st.italic ? 'italic' : 'normal',
    textDecoration: st.underline ? 'underline' : undefined, fontFamily: FONTS[st.font].css,
    fontSize: st.sizePt * PT, lineHeight: LINE_HEIGHT[theme.spacing || 'normal'], background: st.background,
    padding: st.background || st.border === 'box' ? '6px 10px' : st.border === 'left-bar' ? '2px 0 2px 10px' : undefined,
    borderRadius: st.border === 'box' || (st.background && st.border === 'none') ? 6 : undefined,
    // Four separate sides: React warns when `border` and `borderLeft` are mixed across renders.
    borderTop: st.border === 'box' ? thin : none,
    borderRight: st.border === 'box' ? thin : none,
    borderLeft: st.border === 'box' ? thin : st.border === 'left-bar' ? `4px solid ${st.borderColor}` : none,
    borderBottom: st.border === 'box' ? thin : st.border === 'underline' ? `2px solid ${st.borderColor}` : none,
    marginLeft: block.type === 'option' && theme.optionColumns === 1 ? 24 : undefined,
  };

  let body: React.ReactNode;
  if (block.type === 'image') {
    const src = block.assetId && doc.assets[block.assetId];
    body = src ? <img src={src} alt="Figure" style={{ maxWidth: IMAGE_WIDTH[st.width] * 100 + '%', maxHeight: doc.layout === 'slides' ? 400 : 520, display: 'inline-block' }} /> : null;
    style.textAlign = block.style?.align || theme.styles?.image?.align || 'center';
  } else if (block.type === 'divider') {
    body = <hr style={{ border: 0, borderTop: `2px solid ${st.borderColor}`, margin: '6px 0' }} />;
  } else {
    const badge = block.type === 'question' && theme.questionStyle === 'numbered-badge' && number;
    const shown = badge ? (block.text || '').replace(/^(#|Q\.?\s*\d+[.):-]?|\d+[.)])\s+/i, '') : displayText(block, number);
    const info = block.type === 'callout' ? calloutInfo(block, theme) : null;
    const tableVars = block.type === 'table' ? {
      '--design-table-border': mix(st.color, fill, 0.45),
      '--design-table-head': mix(theme.primary, fill, 0.8),
      '--design-table-head-text': legible(st.color, mix(theme.primary, fill, 0.8), 3),
    } as React.CSSProperties : undefined;
    body = (
      <>
        {info?.label && (
          <div style={{ fontSize: '0.82em', fontWeight: 700, color: legible(info.color, st.background || fill, 4.5), marginBottom: 2 }}>
            <span aria-hidden="true">{info.icon} </span>{info.label}
          </div>
        )}
        <div className="design-md" style={{ ...tableVars, ...(badge ? { display: 'flex', gap: 8, alignItems: 'flex-start' } : {}) }}>
          {badge && <span style={{ flex: 'none', minWidth: '1.7em', height: '1.7em', borderRadius: '1em', background: theme.primary, color: legible('#FFFFFF', theme.primary, 3), fontSize: '0.8em', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{number}</span>}
          <div style={{ minWidth: 0, flex: 1 }}>
            {shown.trim() ? <Markdown text={shown} /> : actions && <span style={{ opacity: 0.45, fontWeight: 400 }}>Click the pencil and type here…</span>}
          </div>
        </div>
      </>
    );
  }

  if (editing && actions) {
    const save = () => {
      actions.onOps([isTitle ? { op: 'setPage', pageId: page.id, title: draft } : { op: 'updateBlock', id: block.id, text: draft }]);
      setEditing(false);
    };
    return (
      <div className="my-1 p-2 rounded-lg" style={{ background: '#FFFBEB', border: '1px solid #F59E0B', columnSpan: spanColumns ? 'all' : undefined }}>
        <textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)} rows={Math.min(12, Math.max(2, draft.split('\n').length + 1))}
          aria-label="Edit text"
          onKeyDown={e => { if (e.key === 'Escape') setEditing(false); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); }}
          style={{ width: '100%', font: '13px/1.5 ui-monospace, Consolas, monospace', color: '#111827', background: '#fff', border: '1px solid #D1D5DB', borderRadius: 6, padding: 8 }} />
        <div className="flex flex-wrap items-center gap-2 mt-1.5" style={{ fontSize: 12, color: '#6B7280' }}>
          <button type="button" onClick={save} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-bold" style={{ background: '#16A34A', color: '#fff' }}><Check size={13} /> Save</button>
          <button type="button" onClick={() => setEditing(false)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-bold" style={{ background: '#E5E7EB', color: '#111827' }}><X size={13} /> Cancel</button>
          <span>**bold**, ==highlight== and $math$ are kept. Ctrl+Enter saves.</span>
        </div>
      </div>
    );
  }

  const selected = !!actions && !isTitle && actions.selectedBlockId === block.id;
  const grouped = !!actions?.highlightKey && key === actions.highlightKey;
  const tool = 'p-1 rounded hover:bg-white/20 disabled:opacity-30';
  return (
    <div className="design-block group relative" data-block-id={isTitle ? undefined : block.id} data-title-of={isTitle ? page.id : undefined}
      onClick={actions && !isTitle ? () => actions.onSelectBlock(block.id) : undefined}
      style={{
        margin: `${(block.type === 'heading' ? 10 : 4) * gap}px 0 ${(block.type === 'heading' ? 6 : 4) * gap}px`,
        breakInside: 'avoid', columnSpan: spanColumns ? 'all' : undefined, borderRadius: 4,
        outline: selected ? '2px solid #F97316' : grouped ? '2px dashed #38BDF8' : undefined, outlineOffset: 2,
        visibility: hidden ? 'hidden' : undefined,
      }}>
      <div style={style}>{body}</div>
      {actions && (
        <div className="design-block-tools absolute -top-3 right-0 hidden group-hover:flex group-focus-within:flex items-center gap-0.5 px-1 py-0.5 rounded-md shadow"
          style={{ background: '#111827', color: '#fff', zIndex: 2, fontSize: 13, fontWeight: 400, fontFamily: 'system-ui, sans-serif' }}
          onClick={e => e.stopPropagation()}>
          {block.type !== 'image' && block.type !== 'divider' && (
            <button type="button" className={tool} title="Edit text" aria-label="Edit text" onClick={() => { setDraft(block.text || ''); setEditing(true); }}><Pencil size={13} /></button>
          )}
          {isTitle ? (
            <button type="button" className={tool} title="Remove slide title" aria-label="Remove slide title" onClick={() => actions.onOps([{ op: 'setPage', pageId: page.id, title: '' }])}><Trash2 size={13} /></button>
          ) : (
            <>
              <button type="button" className={tool} title="Duplicate" aria-label="Duplicate" onClick={() => actions.onOps([{ op: 'duplicateBlock', id: block.id }])}><Copy size={13} /></button>
              <button type="button" className={tool} title="Move up" aria-label="Move up" disabled={!previousId}
                onClick={() => actions.onOps([{ op: 'moveBlock', id: previousId!, afterId: block.id }])}><ArrowUp size={13} /></button>
              <button type="button" className={tool} title="Move down" aria-label="Move down" disabled={!nextId}
                onClick={() => actions.onOps([{ op: 'moveBlock', id: block.id, afterId: nextId }])}><ArrowDown size={13} /></button>
              <button type="button" className={tool} title="Delete" aria-label="Delete" onClick={() => actions.onOps([{ op: 'removeBlock', id: block.id }])}><Trash2 size={13} /></button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One page exactly as it looks: background, decoration, header/footer and blocks.
 * Used by the editor (with `actions`), the presenter and the print view (read-only).
 */
export function SlideFace({ doc, page, index, scale, actions, hideAnswers, selected, onClick }: {
  doc: DesignDoc; page: DesignPage; index: number; scale: number;
  actions?: CanvasActions; hideAnswers?: boolean; selected?: boolean; onClick?: () => void;
}) {
  const size = PAGE_SIZE[doc.layout];
  const { theme } = doc;
  const slides = doc.layout === 'slides';
  const numbers = questionNumbers(doc);
  const fill = pageFill(theme, page);
  const special = page.layout === 'title' || page.layout === 'section';
  const twoColumn = page.layout === 'two-column';
  const blocks = page.blocks;
  const headerStyle = resolveStyle(theme, { type: 'paragraph' }, { layout: doc.layout, key: 'header', pageBackground: page.background, pageLayout: page.layout });
  const footerStyle = resolveStyle(theme, { type: 'paragraph' }, { layout: doc.layout, key: 'footer', pageBackground: page.background, pageLayout: page.layout });
  const running = (st: typeof headerStyle): React.CSSProperties => ({
    position: 'absolute', left: size.padding, right: size.padding, textAlign: st.align, fontSize: st.sizePt * PT, color: st.color,
    fontWeight: st.bold ? 700 : 400, fontStyle: st.italic ? 'italic' : 'normal', fontFamily: FONTS[st.font].css, pointerEvents: 'none',
  });

  const view = (block: DesignBlock, i: number) => (
    <BlockView key={block.id} doc={doc} page={page} number={numbers[block.id]} actions={actions} block={block}
      previousId={blocks[i - 1]?.id} nextId={blocks[i + 1]?.id}
      hidden={hideAnswers && block.type === 'answer'} spanColumns={twoColumn && i === 0 && block.type === 'heading'} />
  );
  // Group consecutive options into a grid when the theme asks for columns.
  const rendered: React.ReactNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type === 'option' && theme.optionColumns > 1) {
      const start = i;
      while (i + 1 < blocks.length && blocks[i + 1].type === 'option') i++;
      rendered.push(
        <div key={'grid' + blocks[start].id} style={{ display: 'grid', gridTemplateColumns: `repeat(${theme.optionColumns}, minmax(0, 1fr))`, columnGap: 16, breakInside: 'avoid' }}>
          {blocks.slice(start, i + 1).map((b, k) => view(b, start + k))}
        </div>
      );
    } else rendered.push(view(blocks[i], i));
  }

  const decoration = theme.decoration || 'none';
  const band: React.CSSProperties = { position: 'absolute', background: theme.primary, pointerEvents: 'none' };
  return (
    <div className="design-sheet" onClick={onClick}
      style={{
        width: size.width * scale, height: slides ? size.height * scale : undefined, minHeight: slides ? undefined : size.height * scale,
        position: 'relative', overflow: 'hidden', background: fill, borderRadius: actions ? 6 : 0,
        boxShadow: actions ? (selected ? '0 0 0 3px #F97316, 0 8px 30px rgb(0 0 0 / 0.45)' : '0 8px 30px rgb(0 0 0 / 0.45)') : undefined,
        ['--design-hl' as any]: HIGHLIGHTERS[theme.highlight || 'yellow'],
      }}>
      <div style={{
        position: 'relative', width: size.width, minHeight: size.height, zoom: scale, padding: size.padding, boxSizing: 'border-box',
        fontFamily: FONTS[theme.font].css, color: legible(theme.text, fill, 4),
        display: 'flex', flexDirection: 'column', justifyContent: special ? 'center' : 'flex-start',
      }}>
        {decoration === 'top-bar' && <div style={{ ...band, top: 0, left: 0, right: 0, height: 16 }} />}
        {decoration === 'bottom-bar' && <div style={{ ...band, bottom: 0, left: 0, right: 0, height: 16 }} />}
        {decoration === 'left-bar' && <div style={{ ...band, top: 0, bottom: 0, left: 0, width: 16 }} />}
        {decoration === 'frame' && <div style={{ position: 'absolute', inset: 14, border: `4px solid ${legible(theme.primary, fill, 1.6)}`, borderRadius: 4, pointerEvents: 'none' }} />}
        {theme.header && <div style={{ ...running(headerStyle), top: 20 }}>{theme.header}</div>}

        <div data-design-inner={page.id} style={twoColumn ? { columnCount: 2, columnGap: 40 } : undefined}>
          {page.title && <BlockView doc={doc} page={page} actions={actions} isTitle spanColumns={twoColumn}
            block={{ id: 'title-' + page.id, type: 'heading', level: 1, text: page.title }} />}
          {rendered}
        </div>

        {(theme.footer || theme.showPageNumbers) && (
          <div style={{ ...running(footerStyle), bottom: 14 }}>
            {[theme.footer, theme.showPageNumbers ? String(index + 1) : ''].filter(Boolean).join('   ·   ')}
          </div>
        )}
      </div>
    </div>
  );
}

function PageView({ page, index, count, doc, scale, selected, onSelect, actions, onMeasure }: {
  page: DesignPage; index: number; count: number; doc: DesignDoc; scale: number; selected: boolean;
  onSelect: () => void; actions: CanvasActions; onMeasure: (pageId: string, percent: number) => void;
}) {
  const size = PAGE_SIZE[doc.layout];
  const slides = doc.layout === 'slides';
  const host = useRef<HTMLElement>(null);
  const [percent, setPercent] = useState(0);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState(page.notes || '');
  useEffect(() => { setNotes(page.notes || ''); }, [page.notes]);

  // Measure how much of one page the content takes. Runs after every render of this page.
  useLayoutEffect(() => {
    const el = host.current?.querySelector<HTMLElement>(`[data-design-inner="${page.id}"]`);
    if (!el) return;
    const measure = () => {
      const value = Math.round(el.scrollHeight / (size.height - size.padding * 2) * 100);
      setPercent(prev => prev === value ? prev : value);
      onMeasure(page.id, value);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  });

  const { onOps } = actions;
  const over = slides && percent > 100;
  const noun = slides ? 'Slide' : 'Section';
  const tool = 'p-1 rounded text-ink-3 hover:text-ink hover:bg-white/10 disabled:opacity-30';
  const previous = doc.pages[index - 1], next = doc.pages[index + 1];
  return (
    <section ref={host} aria-label={`${noun} ${index + 1}`} className="mb-6" id={'design-page-' + page.id}>
      <SlideFace doc={doc} page={page} index={index} scale={scale} actions={actions} selected={selected} onClick={onSelect} />

      {/* How much content this page holds, and the tools for the page itself */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-ink-3" style={{ width: size.width * scale }}>
        <span className="font-bold text-ink-2">{noun} {index + 1}</span>
        <span>{page.blocks.length} blocks</span>
        <span>{wordCount(page)} words</span>
        {slides ? (
          <>
            <span className="flex-1 min-w-16 h-1.5 rounded-full bg-white/10 overflow-hidden" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Slide fill">
              <span className={`block h-full ${over ? 'bg-red-500' : percent > 85 ? 'bg-orange-400' : 'bg-emerald-500'}`} style={{ width: Math.min(100, percent) + '%' }} />
            </span>
            <span className={over ? 'text-red-400 font-bold' : ''}>{percent}% full{over && ' — overflow'}</span>
          </>
        ) : (
          <span className="flex-1">≈ {Math.max(1, Math.ceil(percent / 100))} A4 page{percent > 100 ? 's' : ''}</span>
        )}
        <span className="flex items-center gap-0.5">
          <select className="bg-surface-2 border border-line rounded px-1 py-0.5 text-[11px] text-ink-2" aria-label={`${noun} ${index + 1} layout`} title="How this page arranges its content"
            value={page.layout || 'content'} onChange={e => onOps([{ op: 'setPage', pageId: page.id, layout: e.target.value as PageLayout }])}>
            {PAGE_LAYOUTS.map(l => <option key={l} value={l}>{LAYOUT_LABEL[l]}</option>)}
          </select>
          <input type="color" aria-label={`${noun} ${index + 1} background colour`} title="Background colour of this page"
            value={pageFill(doc.theme, page)} onChange={e => onOps([{ op: 'setPage', pageId: page.id, background: e.target.value }], 'page-bg:' + page.id)}
            className="w-6 h-5 rounded border border-line bg-transparent cursor-pointer" />
          {page.background && <button type="button" className={tool} title="Back to the theme's background" aria-label="Reset background" onClick={() => onOps([{ op: 'setPage', pageId: page.id, background: null }])}><X size={13} /></button>}
          <button type="button" className={tool + (page.notes ? ' !text-accent-light' : '')} title="Teacher notes for this page" aria-label="Teacher notes" aria-expanded={notesOpen} onClick={() => setNotesOpen(v => !v)}><StickyNote size={13} /></button>
          <button type="button" className={tool} title={`Add a ${noun.toLowerCase()} after this one`} aria-label="Add page after" onClick={() => onOps([{ op: 'insertSlide', afterPageId: page.id }])}><Plus size={13} /></button>
          <button type="button" className={tool} title="Duplicate" aria-label="Duplicate page" onClick={() => onOps([{ op: 'duplicatePage', pageId: page.id }])}><Copy size={13} /></button>
          <button type="button" className={tool} title="Move up" aria-label="Move page up" disabled={!previous} onClick={() => onOps([{ op: 'movePage', pageId: page.id, afterPageId: doc.pages[index - 2]?.id }])}><ArrowUp size={13} /></button>
          <button type="button" className={tool} title="Move down" aria-label="Move page down" disabled={!next} onClick={() => onOps([{ op: 'movePage', pageId: page.id, afterPageId: next?.id }])}><ArrowDown size={13} /></button>
          <button type="button" className={tool} title="Delete" aria-label="Delete page" disabled={count < 2}
            onClick={() => confirm(`Delete ${noun.toLowerCase()} ${index + 1} and its content?`) && onOps([{ op: 'removePage', pageId: page.id }])}><Trash2 size={13} /></button>
        </span>
      </div>

      {(notesOpen || !!page.notes) && (
        <div className="mt-1.5" style={{ width: size.width * scale }}>
          <label className="block text-[10px] font-bold text-ink-3 mb-0.5" htmlFor={'notes-' + page.id}>Teacher notes (only you see these; add them to the Word file from the Download menu)</label>
          <textarea id={'notes-' + page.id} value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            onBlur={() => notes !== (page.notes || '') && onOps([{ op: 'setPage', pageId: page.id, notes }])}
            placeholder="What to say, ask or show on this page…" className="textarea w-full text-xs" />
        </div>
      )}
    </section>
  );
}

/**
 * Where each block of a rendered slide ends, as a fraction of the usable slide height
 * (above 1 = runs off the slide). Read from the DOM; used by the automatic overflow fix.
 */
export function measurePage(doc: DesignDoc, pageId: string): { bottoms: Record<string, number>; percent: number } {
  const inner = document.querySelector<HTMLElement>(`[data-design-inner="${pageId}"]`);
  if (!inner) return { bottoms: {}, percent: 0 };
  const size = PAGE_SIZE[doc.layout];
  const box = inner.getBoundingClientRect();
  // getBoundingClientRect is in screen px; scale it back with the element's own layout height.
  const ratio = inner.scrollHeight / Math.max(1, box.height);
  const usable = size.height - size.padding * 2;
  const bottoms: Record<string, number> = {};
  for (const el of Array.from(inner.querySelectorAll<HTMLElement>('[data-block-id]'))) {
    bottoms[el.dataset.blockId!] = (el.getBoundingClientRect().bottom - box.top) * ratio / usable;
  }
  return { bottoms, percent: Math.round(inner.scrollHeight / usable * 100) };
}

interface CanvasProps extends CanvasActions {
  doc: DesignDoc;
  /** Width available for one page; pages are scaled down to fit. */
  width: number;
  selectedPageId?: string;
  onSelectPage: (pageId: string) => void;
  /** Reports how full each page is (percent of one page height). */
  onFill: (fill: Record<string, number>) => void;
}

const DesignCanvas: React.FC<CanvasProps> = ({ doc, width, selectedPageId, onSelectPage, onFill, onOps, selectedBlockId, onSelectBlock, highlightKey }) => {
  const size = PAGE_SIZE[doc.layout];
  const scale = Math.min(1, Math.max(0.3, width / size.width));
  const fill = useRef<Record<string, number>>({});
  const timer = useRef<number | undefined>(undefined);
  const report = (pageId: string, percent: number) => {
    if (fill.current[pageId] === percent) return;
    fill.current = { ...fill.current, [pageId]: percent };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onFill(fill.current), 150);
  };

  // ---- Words selected with the mouse → a small toolbar: bold, highlighter pens, clear -----
  const [picked, setPicked] = useState<{ blockId: string; phrase: string; x: number; y: number } | null>(null);
  const [hint, setHint] = useState('');
  const readSelection = () => {
    const selection = window.getSelection();
    const phrase = selection?.toString().trim() || '';
    const blockOf = (node: Node | null) => (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('[data-block-id]');
    const start = blockOf(selection?.anchorNode || null), end = blockOf(selection?.focusNode || null);
    if (!selection || selection.isCollapsed || !phrase || phrase.includes('\n') || !start || start !== end) { setPicked(null); return; }
    const box = selection.getRangeAt(0).getBoundingClientRect();
    setPicked({ blockId: start.dataset.blockId!, phrase, x: box.left + box.width / 2, y: box.top });
    setHint('');
  };
  useEffect(() => {
    const close = () => setPicked(null);
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, []);
  const mark = (op: DesignOp) => {
    const { applied } = onOps([op]);
    if (applied) { setPicked(null); window.getSelection()?.removeAllRanges(); }
    else setHint('Select plain words inside one paragraph (not across an equation).');
  };
  const actions: CanvasActions = { onOps, selectedBlockId, onSelectBlock, highlightKey };

  return (
    <div className="flex flex-col items-center" onMouseUp={() => setTimeout(readSelection, 0)}>
      {doc.pages.map((page, i) => (
        <PageView key={page.id} page={page} index={i} count={doc.pages.length} doc={doc} scale={scale} selected={page.id === selectedPageId}
          onSelect={() => onSelectPage(page.id)} actions={actions} onMeasure={report} />
      ))}

      {picked && (
        <div role="toolbar" aria-label="Format the selected words" onMouseDown={e => e.preventDefault()} onMouseUp={e => e.stopPropagation()}
          className="fixed z-50 flex items-center gap-1 px-1.5 py-1 rounded-lg shadow-xl border border-white/10"
          style={{ left: Math.min(window.innerWidth - 150, Math.max(150, picked.x)), top: Math.max(8, picked.y - 46), transform: 'translateX(-50%)', background: '#111827', color: '#fff' }}>
          <button type="button" title="Bold" aria-label="Bold" className="p-1.5 rounded hover:bg-white/15"
            onClick={() => mark({ op: 'markSelection', id: picked.blockId, phrase: picked.phrase, mark: 'bold' })}><Bold size={14} /></button>
          {HIGHLIGHTER_IDS.map(pen => (
            <button key={pen} type="button" title={`Highlight ${pen}`} aria-label={`Highlight ${pen}`} className="w-5 h-5 rounded-full border border-white/40 hover:scale-110 transition-transform"
              style={{ background: HIGHLIGHTERS[pen], outline: pen === (doc.theme.highlight || 'yellow') ? '2px solid #fff' : undefined, outlineOffset: 1 }}
              onClick={() => mark({ op: 'markSelection', id: picked.blockId, phrase: picked.phrase, mark: 'highlight', color: pen })} />
          ))}
          <button type="button" title="Remove bold and highlight" aria-label="Remove bold and highlight" className="p-1.5 rounded hover:bg-white/15"
            onClick={() => mark({ op: 'clearMarks', id: picked.blockId, phrase: picked.phrase })}><Eraser size={14} /></button>
          {hint && <span className="text-[11px] text-amber-300 max-w-48 leading-tight">{hint}</span>}
        </div>
      )}
    </div>
  );
};

export default DesignCanvas;
