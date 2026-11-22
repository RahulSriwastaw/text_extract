import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Undo2, Redo2, FileDown, Upload, FileText, Trash2, Palette, MessageSquare, ArrowLeft, Loader2,
  Presentation, File as FileIcon, Scissors, AlertTriangle, Play, ChevronDown, Printer, Shapes, PlusSquare,
} from 'lucide-react';
import mammoth from 'mammoth';
import type { ExtractedElement } from '../types';
import {
  type DesignDoc, type DesignOp, type Layout, type StyleKey,
  applyDesignOps, autoPaginate, elementsToDesignDoc, htmlToDesignDoc, insertImageBlock, allBlocks, planOverflowFix, plainText,
} from '../services/designDoc';
import { generateDesignDocx } from '../services/designDocx';
import { saveDesignDoc, getDesignDocs, deleteDesignDoc } from '../services/aiDbService';
import DesignCanvas, { measurePage } from './design/DesignCanvas';
import DesignChat, { type ChatMessage } from './design/DesignChat';
import { ThemePanel, ElementsPanel, InsertPanel } from './design/Panels';
import { Presenter, PrintView } from './design/Presenter';

export interface DesignInput { elements: ExtractedElement[]; title: string }

interface Props {
  /** Content handed over from the Text tool ("Design in Studio"). */
  input: DesignInput | null;
  onClearInput: () => void;
  onOpenTextTool: () => void;
}

const HISTORY_LIMIT = 40;
const MAX_FIT_ROUNDS = 80;
type Panel = 'chat' | 'theme' | 'elements' | 'insert';

/** The open design is kept in the address (?d=…) so a refresh reopens it. Only on the tool's own page. */
const onStudioPage = () => window.location.pathname.replace(/\/+$/, '') === '/design-studio';
const designInUrl = () => onStudioPage() ? new URLSearchParams(window.location.search).get('d') : null;

const DesignStudio: React.FC<Props> = ({ input, onClearInput, onOpenTextTool }) => {
  const [doc, setDoc] = useState<DesignDoc | null>(null);
  const [past, setPast] = useState<DesignDoc[]>([]);
  const [future, setFuture] = useState<DesignDoc[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string>();
  const [selectedBlockId, setSelectedBlockId] = useState<string>();
  const [highlightKey, setHighlightKey] = useState<StyleKey>();
  const [fill, setFill] = useState<Record<string, number>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [panel, setPanel] = useState<Panel>('chat');
  const [saved, setSaved] = useState<DesignDoc[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [canvasWidth, setCanvasWidth] = useState(800);
  const [presenting, setPresenting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [restoring, setRestoring] = useState(() => !!designInUrl() && !input);
  // The latest document. Updated in commit() too, because several changes can land before a render.
  const docRef = useRef<DesignDoc | null>(null);
  useEffect(() => { docRef.current = doc; }, [doc]);
  const canvasBox = useRef<HTMLDivElement>(null);
  const lastCommit = useRef({ key: '', time: 0 });

  const refreshSaved = useCallback(() => { getDesignDocs<DesignDoc>().then(setSaved).catch(() => setSaved([])); }, []);
  useEffect(refreshSaved, [refreshSaved]);

  const open = useCallback((next: DesignDoc) => {
    setDoc(next); setPast([]); setFuture([]); setMessages([]); setFill({});
    setSelectedPageId(next.pages[0]?.id); setSelectedBlockId(undefined); setHighlightKey(undefined); setNotice('');
  }, []);

  // Content arriving from the Text tool
  useEffect(() => {
    if (!input) return;
    setRestoring(false);
    open(elementsToDesignDoc(input.elements, input.title));
    onClearInput();
  }, [input]);

  // After a refresh: reopen the design named in the address.
  useEffect(() => {
    const id = designInUrl();
    if (!restoring || !id) return;
    let active = true;
    getDesignDocs<DesignDoc>()
      .then(list => { const found = list.find(d => d.id === id); if (active && found && !docRef.current) open(found); })
      .catch(() => {})
      .finally(() => active && setRestoring(false));
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (restoring || !onStudioPage()) return;
    const url = new URL(window.location.href);
    if (doc) url.searchParams.set('d', doc.id); else url.searchParams.delete('d');
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url);
  }, [doc?.id, restoring]);

  /**
   * Replace the document, remembering the previous one for Undo. Changes that share a
   * `coalesce` key and follow each other quickly (dragging a colour or a slider) are one step.
   */
  const commit = useCallback((next: DesignDoc, coalesce?: string) => {
    const current = docRef.current;
    if (!current || next === current) return;
    const now = Date.now();
    const sameGesture = !!coalesce && lastCommit.current.key === coalesce && now - lastCommit.current.time < 1200;
    lastCommit.current = { key: coalesce || '', time: now };
    if (!sameGesture) setPast(p => [...p.slice(-HISTORY_LIMIT + 1), current]);
    setFuture([]);
    docRef.current = next;          // several commits can happen before the next render
    fitRounds.current = 0;          // a real change: the automatic overflow fix may run again
    setDoc(next);
  }, []);

  // ---- Automatic overflow fix for slides (free, no AI) --------------------------------
  // While any slide holds more than fits: move the extra blocks to a new slide, split a
  // table/paragraph that is taller than a slide, and only then shrink that slide's text.
  // Its changes are folded into the user's last action, so one Undo takes both back.
  const [autoFit, setAutoFit] = useState(true);
  const [fitting, setFitting] = useState(false);
  const fitRounds = useRef(0);
  useEffect(() => {
    if (!doc || doc.layout !== 'slides' || !autoFit) { setFitting(false); return; }
    const timer = setTimeout(() => {
      const current = docRef.current;
      if (!current || current.layout !== 'slides') return;
      const ops: DesignOp[] = [];
      for (const page of current.pages) {
        const { bottoms, percent } = measurePage(current, page.id);
        const fix = planOverflowFix(page, bottoms, percent);
        if (!fix) continue;
        ops.push(fix.kind === 'break' ? { op: 'paginate', pageId: page.id, breaks: [{ beforeBlockId: fix.beforeBlockId }] }
          : fix.kind === 'split' ? { op: 'splitBlock', id: fix.blockId }
          : { op: 'setPage', pageId: page.id, scale: fix.scale });
      }
      if (!ops.length || fitRounds.current >= MAX_FIT_ROUNDS) { setFitting(false); return; }
      fitRounds.current++;
      const next = applyDesignOps(current, ops).doc;
      if (next === current) { setFitting(false); return; }
      setFitting(true);
      docRef.current = next;
      setDoc(next);                 // no history entry: part of the action that caused it
    }, 220);                        // after the canvas has rendered and measured the change
    return () => clearTimeout(timer);
  }, [doc, autoFit, canvasWidth]);

  const applyOps = useCallback((ops: unknown[], coalesce?: string) => {
    const current = docRef.current;
    if (!current) return { applied: 0, skipped: 0 };
    const result = applyDesignOps(current, ops);
    commit(result.doc, coalesce);
    return { applied: result.applied, skipped: result.skipped };
  }, [commit]);

  /**
   * For the Insert tools: apply, then select what was just added, so the next thing
   * lands after it (in reading order) and the new slide scrolls into view.
   */
  const insertOps = useCallback((ops: unknown[], coalesce?: string) => {
    const before = docRef.current;
    const result = applyOps(ops, coalesce);
    const after = docRef.current;
    if (!before || !after || after === before) return result;
    const oldPages = new Set(before.pages.map(p => p.id)), oldBlocks = new Set(allBlocks(before).map(b => b.id));
    const newPage = after.pages.find(p => !oldPages.has(p.id));
    const newBlocks = allBlocks(after).filter(b => !oldBlocks.has(b.id));
    if (newPage) {
      setSelectedPageId(newPage.id); setSelectedBlockId(undefined);
      setTimeout(() => document.getElementById('design-page-' + newPage.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
    } else if (newBlocks.length) {
      setSelectedBlockId(newBlocks[newBlocks.length - 1].id);
    }
    return result;
  }, [applyOps]);

  // Undo/redo restore a document exactly as it was, so the automatic fix stays out of the way.
  const undo = () => {
    if (!doc || !past.length) return;
    fitRounds.current = MAX_FIT_ROUNDS; lastCommit.current.key = '';
    setFuture(f => [doc, ...f]); setDoc(past[past.length - 1]); setPast(p => p.slice(0, -1));
  };
  const redo = () => {
    if (!doc || !future.length) return;
    fitRounds.current = MAX_FIT_ROUNDS; lastCommit.current.key = '';
    setPast(p => [...p, doc]); setDoc(future[0]); setFuture(f => f.slice(1));
  };

  // Autosave to this browser
  useEffect(() => {
    if (!doc) return;
    const timer = setTimeout(() => { saveDesignDoc(doc).then(refreshSaved).catch(() => setNotice('Could not save in this browser.')); }, 800);
    return () => clearTimeout(timer);
  }, [doc]);

  // Fit pages to the space between the side panels
  useEffect(() => {
    const el = canvasBox.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setCanvasWidth(el.clientWidth - 48));
    observer.observe(el);
    return () => observer.disconnect();
  }, [!!doc]);

  // Close the download menu on a click anywhere else
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuOpen]);

  const setLayout = (layout: Layout) => {
    if (!doc || doc.layout === layout) return;
    let next = applyDesignOps(doc, [{ op: 'setLayout', layout }]).doc;
    if (layout === 'slides' && next.pages.length === 1) next = autoPaginate(next);   // free first split, the AI can refine it
    commit(next);
    setSelectedPageId(next.pages[0]?.id);
  };

  /** Clicking an element opens its tools, unless the user is busy placing new content. */
  const selectBlock = (id: string | undefined) => {
    setSelectedBlockId(id);
    if (id && panel !== 'insert') setPanel('elements');
  };

  const upload = async (file: File) => {
    setBusy('Reading Word file…'); setNotice('');
    try {
      const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
      const next = htmlToDesignDoc(value, file.name.replace(/\.docx$/i, ''));
      if (!allBlocks(next).length) throw new Error('No text was found in this file.');
      open(next);
      setNotice('Word file loaded. Only the content is imported: the original colours, layout and Word equations are not.');
    } catch (e: any) {
      setNotice(e?.message || 'Could not read this Word file.');
    } finally { setBusy(''); }
  };

  const download = async () => {
    if (!doc) return;
    setBusy('Building Word file…'); setNotice('');
    try {
      const blob = await generateDesignDocx(doc, { includeNotes });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = (doc.title || 'design').replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.docx';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e: any) {
      setNotice('Could not build the Word file: ' + (e?.message || 'unknown error'));
    } finally { setBusy(''); }
  };

  // ------------------------------------------------------------------ start screen
  if (!doc) {
    if (restoring) return <p role="status" className="flex items-center gap-2 p-8 text-sm text-ink-2"><Loader2 size={16} className="animate-spin" /> Opening your design…</p>;
    return (
      <div className="app-container py-8 max-w-3xl">
        <h1 className="text-2xl font-bold font-display text-ink mb-1">Design Studio</h1>
        <p className="text-sm text-ink-3 mb-6">Turn extracted text into designed teaching slides or a Word document: AI does the heavy work, and every heading, box and colour stays editable by hand.</p>

        <div className="grid sm:grid-cols-2 gap-3 mb-8">
          <button type="button" onClick={onOpenTextTool} className="glass-card p-5 text-left rounded-2xl border border-line hover:border-accent transition-colors">
            <FileText className="w-6 h-6 text-accent mb-3" />
            <p className="font-bold text-ink">Bring text from the Text tool</p>
            <p className="text-xs text-ink-3 mt-1">Extract your pages there, then press "Design in Studio" next to Download DOCX.</p>
          </button>
          <label className="glass-card p-5 text-left rounded-2xl border border-line hover:border-accent transition-colors cursor-pointer">
            <Upload className="w-6 h-6 text-accent mb-3" />
            <p className="font-bold text-ink">Upload a Word file (.docx)</p>
            <p className="text-xs text-ink-3 mt-1">Imports the content only. Original colours, layout and Word equations are not kept.</p>
            <input type="file" accept=".docx" className="sr-only" disabled={!!busy}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
          </label>
        </div>

        {busy && <p role="status" className="flex items-center gap-2 text-sm text-ink-2 mb-4"><Loader2 size={16} className="animate-spin" /> {busy}</p>}
        {notice && <p role="alert" className="text-sm text-amber-300 mb-4">{notice}</p>}

        <h2 className="text-sm font-bold text-ink mb-2">Saved designs on this device</h2>
        {saved.length === 0 ? <p className="text-xs text-ink-3">Nothing saved yet. Designs save automatically in this browser.</p> : (
          <ul className="space-y-2">
            {saved.map(item => (
              <li key={item.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface border border-line">
                {item.layout === 'slides' ? <Presentation className="w-4 h-4 text-ink-3 shrink-0" /> : <FileIcon className="w-4 h-4 text-ink-3 shrink-0" />}
                <button type="button" className="flex-1 min-w-0 text-left" onClick={() => open(item)}>
                  <p className="text-sm font-semibold text-ink truncate">{item.title}</p>
                  <p className="text-[11px] text-ink-3">{item.pages.length} {item.layout === 'slides' ? 'slides' : 'sections'} · {new Date(item.updatedAt).toLocaleString()}</p>
                </button>
                <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Delete ${item.title}`} title="Delete"
                  onClick={() => confirm(`Delete "${item.title}"? This cannot be undone.`) && deleteDesignDoc(item.id).then(refreshSaved)}>
                  <Trash2 />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------------ editor
  const slides = doc.layout === 'slides';
  const overflowing = slides ? doc.pages.filter(p => (fill[p.id] || 0) > 100) : [];
  const fixNow = () => { fitRounds.current = 0; setAutoFit(true); setDoc({ ...doc }); };   // re-run the automatic fix
  const tabs: [Panel, string, React.ReactNode][] = [
    ['chat', 'AI', <MessageSquare />], ['theme', 'Theme', <Palette />], ['elements', 'Elements', <Shapes />], ['insert', 'Insert', <PlusSquare />],
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line bg-surface/60">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDoc(null); refreshSaved(); }} title="Back to saved designs"><ArrowLeft /> Designs</button>
        <input value={doc.title} onChange={e => setDoc({ ...doc, title: e.target.value, updatedAt: Date.now() })} aria-label="Design title"
          className="bg-transparent border border-transparent hover:border-line focus:border-accent rounded-lg px-2 py-1 text-sm font-bold text-ink min-w-0 w-40 sm:w-56 outline-none" />
        <div className="seg seg-sm" role="group" aria-label="Layout">
          <button type="button" className="seg-item" aria-pressed={!slides} onClick={() => setLayout('document')}><FileIcon /> Document</button>
          <button type="button" className="seg-item" aria-pressed={slides} onClick={() => setLayout('slides')}><Presentation /> Slides (PPT)</button>
        </div>
        {slides && (
          <label className="flex items-center gap-1.5 text-xs text-ink-2" title="Automatically moves extra content to new slides, splits long tables and paragraphs, and shrinks text only when needed. Free.">
            <input type="checkbox" checked={autoFit} onChange={e => { fitRounds.current = 0; setAutoFit(e.target.checked); }} /> Auto-fit slides
          </label>
        )}
        <div className="flex-1" />
        {fitting && <span role="status" className="flex items-center gap-1.5 text-xs text-ink-3"><Loader2 size={13} className="animate-spin" /> Fitting slides…</span>}
        {busy && <span role="status" className="flex items-center gap-1.5 text-xs text-ink-3"><Loader2 size={13} className="animate-spin" /> {busy}</span>}
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={undo} disabled={!past.length} aria-label="Undo" title="Undo"><Undo2 /></button>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={redo} disabled={!future.length} aria-label="Redo" title="Redo"><Redo2 /></button>
        {slides && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPresenting(true)} title="Show the slides full screen. Answers stay hidden until you press Next."><Play /> Present</button>
        )}
        <div className="relative btn-group" onClick={e => e.stopPropagation()}>
          <button type="button" className="btn btn-primary btn-sm" onClick={download} disabled={!!busy}><FileDown /> Download DOCX</button>
          <button type="button" className="btn btn-primary btn-sm btn-icon" aria-label="More download options" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(v => !v)}><ChevronDown /></button>
          {menuOpen && (
            <div className="menu right-0 top-full mt-2 w-64" role="menu">
              <label className="menu-item cursor-pointer">
                <input type="checkbox" checked={includeNotes} onChange={e => setIncludeNotes(e.target.checked)} /> Add teacher notes at the end of the Word file
              </label>
              <div className="menu-divider" />
              <button type="button" role="menuitem" className="menu-item" onClick={() => { setMenuOpen(false); setPrinting(true); }}>
                <Printer /> Print / Save as PDF
              </button>
            </div>
          )}
        </div>
      </div>

      {notice && <p role="status" className="px-3 py-1.5 text-xs text-amber-300 bg-amber-500/10 border-b border-amber-500/20">{notice}</p>}
      {overflowing.length > 0 && !fitting && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs text-red-300 bg-red-500/10 border-b border-red-500/20">
          <AlertTriangle size={14} />
          <span>{overflowing.length} slide{overflowing.length === 1 ? ' has' : 's have'} more content than fits.</span>
          <button type="button" className="btn btn-secondary btn-xs" onClick={fixNow}><Scissors /> Fix overflow now (free)</button>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Page list */}
        <nav className="hidden lg:block w-44 shrink-0 border-r border-line overflow-y-auto custom-scrollbar p-2 space-y-1" aria-label="Pages">
          {doc.pages.map((page, i) => {
            const percent = fill[page.id] || 0;
            const name = plainText(page.title || (page.blocks[0]?.type === 'heading' ? page.blocks[0].text || '' : ''));
            return (
              <button key={page.id} type="button"
                onClick={() => { setSelectedPageId(page.id); document.getElementById('design-page-' + page.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                className={`w-full text-left px-2.5 py-2 rounded-lg text-xs border ${page.id === selectedPageId ? 'bg-surface-3 border-accent text-ink' : 'border-transparent text-ink-3 hover:bg-surface-2 hover:text-ink'}`}>
                <span className="font-bold">{slides ? 'Slide' : 'Section'} {i + 1}</span>
                {name && <span className="block truncate">{name}</span>}
                <span className={`block text-[10px] ${slides && percent > 100 ? 'text-red-400 font-bold' : ''}`}>
                  {page.blocks.length} blocks{slides && percent > 0 && ` · ${percent}%`}{page.notes && ' · notes'}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Canvas */}
        <div ref={canvasBox} className="flex-1 min-w-0 overflow-auto custom-scrollbar bg-[#0A0A0A] p-6" onClick={e => { if (e.target === e.currentTarget) setSelectedBlockId(undefined); }}>
          <DesignCanvas doc={doc} width={canvasWidth} selectedPageId={selectedPageId} onSelectPage={setSelectedPageId} onFill={setFill}
            onOps={insertOps} selectedBlockId={selectedBlockId} onSelectBlock={selectBlock} highlightKey={panel === 'elements' ? highlightKey : undefined} />
        </div>

        {/* Side panel */}
        <aside className="w-80 xl:w-96 shrink-0 border-l border-line flex flex-col min-h-0 bg-surface/40 max-md:hidden">
          <div className="seg m-2" role="tablist" aria-label="Tools">
            {tabs.map(([id, text, icon]) => (
              <button key={id} type="button" role="tab" className="seg-item flex-1" aria-selected={panel === id} onClick={() => setPanel(id)}>{icon} {text}</button>
            ))}
          </div>

          {/* The chat stays mounted so a running request is not lost when another tab is opened. */}
          <div className={panel === 'chat' ? 'flex-1 min-h-0' : 'hidden'}>
            <DesignChat doc={doc} getDoc={() => docRef.current} fill={fill} selectedPageId={selectedPageId} messages={messages} setMessages={setMessages}
              applyOps={applyOps} restore={commit} />
          </div>
          {panel === 'theme' && <ThemePanel doc={doc} applyOps={applyOps} onReplace={commit} />}
          {panel === 'elements' && (
            <ElementsPanel doc={doc} applyOps={applyOps} selectedBlockId={selectedBlockId} onSelectBlock={setSelectedBlockId}
              highlightKey={highlightKey} setHighlightKey={setHighlightKey} />
          )}
          {panel === 'insert' && (
            <InsertPanel doc={doc} applyOps={insertOps} selectedPageId={selectedPageId} selectedBlockId={selectedBlockId}
              onInsertImage={dataUrl => commit(insertImageBlock(doc, dataUrl, { afterBlockId: selectedBlockId, pageId: selectedPageId }))} />
          )}
        </aside>
      </div>

      {presenting && <Presenter doc={doc} start={Math.max(0, doc.pages.findIndex(p => p.id === selectedPageId))} onExit={() => setPresenting(false)} />}
      {printing && <PrintView doc={doc} onDone={() => setPrinting(false)} />}
    </div>
  );
};

export default DesignStudio;
