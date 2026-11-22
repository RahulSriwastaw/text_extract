import React, { useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { Pencil, Trash2, ArrowUp, ArrowDown, Check, X } from 'lucide-react';
import { normalizePreviewMath } from '../ProcessingList';
import { resolveStyle } from '../../services/designDocx';
import {
  type DesignDoc, type DesignBlock, type DesignPage, type DesignOp, type Theme,
  PAGE_SIZE, displayText, questionNumbers, wordCount,
} from '../../services/designDoc';

const FONT_STACK: Record<Theme['font'], string> = {
  sans: 'Arial, "Noto Sans Devanagari", sans-serif',
  serif: '"Times New Roman", "Noto Serif Devanagari", serif',
  hindi: '"Nirmala UI", "Noto Sans Devanagari", Mangal, sans-serif',
};
const PT = 96 / 72;   // pt → CSS px

interface CanvasProps {
  doc: DesignDoc;
  /** Width available for one page; pages are scaled down to fit. */
  width: number;
  selectedPageId?: string;
  onSelectPage: (pageId: string) => void;
  onOps: (ops: DesignOp[]) => void;
  /** Reports how full each page is (percent of one page height). */
  onFill: (fill: Record<string, number>) => void;
}

const Markdown = React.memo(({ text }: { text: string }) => (
  <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
    {normalizePreviewMath(text)}
  </ReactMarkdown>
));

function BlockView({ block, doc, number, onOps, isFirst, isLast, previousId, nextId }: {
  block: DesignBlock; doc: DesignDoc; number?: number; onOps: (ops: DesignOp[]) => void;
  isFirst: boolean; isLast: boolean; previousId?: string; nextId?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const { theme } = doc;
  const st = resolveStyle(theme, block, doc.layout);

  const thin = `1px solid ${st.borderColor}`, none = '0 solid transparent';
  const style: React.CSSProperties = {
    color: st.color, textAlign: st.align, fontWeight: st.bold ? 700 : 400, fontStyle: st.italic ? 'italic' : 'normal',
    fontSize: st.sizePt * PT, lineHeight: 1.45, background: st.background,
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
    body = src ? <img src={src} alt="Figure" style={{ maxWidth: '70%', maxHeight: doc.layout === 'slides' ? 330 : 420, display: 'inline-block' }} /> : null;
    style.textAlign = block.style?.align || 'center';
  } else if (block.type === 'divider') {
    body = <hr style={{ border: 0, borderTop: `2px solid ${st.borderColor}`, margin: '6px 0' }} />;
  } else {
    const badge = block.type === 'question' && theme.questionStyle === 'numbered-badge' && number;
    const shown = badge ? (block.text || '').replace(/^(#|Q\.?\s*\d+[.):-]?|\d+[.)])\s+/i, '') : displayText(block, number);
    body = (
      <div className="design-md" style={badge ? { display: 'flex', gap: 8, alignItems: 'flex-start' } : undefined}>
        {badge && <span style={{ flex: 'none', minWidth: 26, height: 26, borderRadius: 13, background: theme.primary, color: '#fff', fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{number}</span>}
        <div style={{ minWidth: 0, flex: 1 }}><Markdown text={shown} /></div>
      </div>
    );
  }

  if (editing) {
    const save = () => { onOps([{ op: 'updateBlock', id: block.id, text: draft }]); setEditing(false); };
    return (
      <div className="my-1 p-2 rounded-lg" style={{ background: '#FFFBEB', border: '1px solid #F59E0B' }}>
        <textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)} rows={Math.min(12, Math.max(2, draft.split('\n').length + 1))}
          aria-label="Edit block text"
          onKeyDown={e => { if (e.key === 'Escape') setEditing(false); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); }}
          style={{ width: '100%', font: '13px/1.5 ui-monospace, Consolas, monospace', color: '#111827', background: '#fff', border: '1px solid #D1D5DB', borderRadius: 6, padding: 8 }} />
        <div className="flex items-center gap-2 mt-1.5" style={{ fontSize: 12, color: '#6B7280' }}>
          <button type="button" onClick={save} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-bold" style={{ background: '#16A34A', color: '#fff' }}><Check size={13} /> Save</button>
          <button type="button" onClick={() => setEditing(false)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-bold" style={{ background: '#E5E7EB', color: '#111827' }}><X size={13} /> Cancel</button>
          <span>Markdown and $math$ are kept. Ctrl+Enter saves.</span>
        </div>
      </div>
    );
  }

  const tool = 'p-1 rounded hover:bg-black/10 disabled:opacity-30';
  return (
    <div className="design-block group relative" style={{ margin: block.type === 'heading' ? '10px 0 6px' : '4px 0' }}>
      <div style={style}>{body}</div>
      <div className="design-block-tools absolute -top-3 right-0 hidden group-hover:flex group-focus-within:flex items-center gap-0.5 px-1 py-0.5 rounded-md shadow"
        style={{ background: '#111827', color: '#fff', zIndex: 2 }}>
        {block.type !== 'image' && block.type !== 'divider' && (
          <button type="button" className={tool} title="Edit text" aria-label="Edit text" onClick={() => { setDraft(block.text || ''); setEditing(true); }}><Pencil size={13} /></button>
        )}
        <button type="button" className={tool} title="Move up" aria-label="Move up" disabled={isFirst}
          onClick={() => onOps([{ op: 'moveBlock', id: previousId!, afterId: block.id }])}><ArrowUp size={13} /></button>
        <button type="button" className={tool} title="Move down" aria-label="Move down" disabled={isLast}
          onClick={() => onOps([{ op: 'moveBlock', id: block.id, afterId: nextId }])}><ArrowDown size={13} /></button>
        <button type="button" className={tool} title="Delete block" aria-label="Delete block" onClick={() => onOps([{ op: 'removeBlock', id: block.id }])}><Trash2 size={13} /></button>
      </div>
    </div>
  );
}

function PageView({ page, index, doc, scale, selected, onSelect, onOps, onMeasure }: {
  page: DesignPage; index: number; doc: DesignDoc; scale: number; selected: boolean;
  onSelect: () => void; onOps: (ops: DesignOp[]) => void; onMeasure: (pageId: string, percent: number) => void;
}) {
  const size = PAGE_SIZE[doc.layout];
  const inner = useRef<HTMLDivElement>(null);
  const [percent, setPercent] = useState(0);
  const numbers = questionNumbers(doc);
  const { theme } = doc;
  const slides = doc.layout === 'slides';

  // Measure how much of one page the content takes. Runs after every render of this page.
  useLayoutEffect(() => {
    const el = inner.current;
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

  // Group consecutive options into a grid when the theme asks for columns.
  const rendered: React.ReactNode[] = [];
  const blocks = page.blocks;
  const view = (block: DesignBlock, i: number) => (
    <BlockView key={block.id} doc={doc} number={numbers[block.id]} onOps={onOps} block={block}
      isFirst={i === 0} isLast={i === blocks.length - 1} previousId={blocks[i - 1]?.id} nextId={blocks[i + 1]?.id} />
  );
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type === 'option' && theme.optionColumns > 1) {
      const start = i;
      while (i + 1 < blocks.length && blocks[i + 1].type === 'option') i++;
      rendered.push(
        <div key={'grid' + blocks[start].id} style={{ display: 'grid', gridTemplateColumns: `repeat(${theme.optionColumns}, minmax(0, 1fr))`, columnGap: 16 }}>
          {blocks.slice(start, i + 1).map((b, k) => view(b, start + k))}
        </div>
      );
    } else rendered.push(view(blocks[i], i));
  }

  const over = slides && percent > 100;
  const words = wordCount(page);
  return (
    <section aria-label={`${slides ? 'Slide' : 'Section'} ${index + 1}`} className="mb-6" id={'design-page-' + page.id}>
      <div onClick={onSelect}
        style={{
          width: size.width * scale, height: slides ? size.height * scale : undefined,
          minHeight: slides ? undefined : size.height * scale, position: 'relative', overflow: 'hidden',
          borderRadius: 6, boxShadow: selected ? '0 0 0 3px #F97316, 0 8px 30px rgb(0 0 0 / 0.45)' : '0 8px 30px rgb(0 0 0 / 0.45)',
          background: page.background || theme.pageBackground,
        }}>
        <div style={{
          width: size.width, minHeight: slides ? size.height : size.height, zoom: scale, padding: size.padding, boxSizing: 'border-box',
          fontFamily: FONT_STACK[theme.font], color: theme.text,
        }}>
          {theme.header && <div style={{ fontSize: 11, color: '#6B7280', textAlign: 'center', marginTop: -30, marginBottom: 14 }}>{theme.header}</div>}
          <div ref={inner}>
            {page.title && <BlockView doc={doc} onOps={ops => onOps(ops.map(o => o.op === 'updateBlock' ? { op: 'setPage', pageId: page.id, title: o.text || '' } : o))}
              block={{ id: 'title-' + page.id, type: 'heading', level: 1, text: page.title }} isFirst isLast />}
            {rendered}
            {!blocks.length && <p style={{ color: '#9CA3AF', fontSize: 14 }}>Empty page</p>}
          </div>
        </div>
        {(theme.footer || theme.showPageNumbers) && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 8 * scale, textAlign: 'center', fontSize: 11 * scale, color: '#6B7280', fontFamily: FONT_STACK[theme.font] }}>
            {[theme.footer, theme.showPageNumbers ? String(index + 1) : ''].filter(Boolean).join('   ·   ')}
          </div>
        )}
      </div>

      {/* How much content this page holds */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-ink-3" style={{ width: size.width * scale }}>
        <span className="font-bold text-ink-2">{slides ? 'Slide' : 'Section'} {index + 1}</span>
        <span>{blocks.length} blocks</span>
        <span>{words} words</span>
        {slides ? (
          <>
            <span className="flex-1 min-w-16 h-1.5 rounded-full bg-white/10 overflow-hidden" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Slide fill">
              <span className={`block h-full ${over ? 'bg-red-500' : percent > 85 ? 'bg-orange-400' : 'bg-emerald-500'}`} style={{ width: Math.min(100, percent) + '%' }} />
            </span>
            <span className={over ? 'text-red-400 font-bold' : ''}>{percent}% full{over && ' — overflow, split this slide'}</span>
          </>
        ) : (
          <span>≈ {Math.max(1, Math.ceil(percent / 100))} A4 page{percent > 100 ? 's' : ''}</span>
        )}
      </div>
    </section>
  );
}

const DesignCanvas: React.FC<CanvasProps> = ({ doc, width, selectedPageId, onSelectPage, onOps, onFill }) => {
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

  return (
    <div className="flex flex-col items-center">
      {doc.pages.map((page, i) => (
        <PageView key={page.id} page={page} index={i} doc={doc} scale={scale} selected={page.id === selectedPageId}
          onSelect={() => onSelectPage(page.id)} onOps={onOps} onMeasure={report} />
      ))}
    </div>
  );
};

export default DesignCanvas;
