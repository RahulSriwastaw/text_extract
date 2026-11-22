/**
 * Showing the slides to a class, and printing them.
 *
 *   Presenter  full-screen slideshow. Answers stay hidden until the teacher presses Next once more.
 *   PrintView  every page at full size for the browser's Print dialog ("Save as PDF").
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X, Eye } from 'lucide-react';
import { type DesignDoc, PAGE_SIZE } from '../../services/designDoc';
import { SlideFace } from './DesignCanvas';

export const Presenter: React.FC<{ doc: DesignDoc; start: number; onExit: () => void }> = ({ doc, start, onExit }) => {
  const [index, setIndex] = useState(Math.min(Math.max(0, start), doc.pages.length - 1));
  const [revealed, setRevealed] = useState(false);
  const [box, setBox] = useState({ width: window.innerWidth, height: window.innerHeight });
  const root = useRef<HTMLDivElement>(null);
  const size = PAGE_SIZE[doc.layout];
  const page = doc.pages[index];
  const hasAnswer = page.blocks.some(b => b.type === 'answer');
  const waiting = hasAnswer && !revealed;      // the next press shows the answer instead of moving on

  const go = (to: number) => { setIndex(Math.min(doc.pages.length - 1, Math.max(0, to))); setRevealed(false); };
  const next = () => waiting ? setRevealed(true) : index < doc.pages.length - 1 && go(index + 1);
  const previous = () => go(index - 1);
  // Keys must always see the latest state.
  const handlers = useRef({ next, previous, go, onExit });
  handlers.current = { next, previous, go, onExit };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = handlers.current;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); h.next(); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); h.previous(); }
      else if (e.key === 'Home') h.go(0);
      else if (e.key === 'End') h.go(doc.pages.length - 1);
      else if (e.key === 'Escape') h.onExit();
    };
    const onResize = () => setBox({ width: window.innerWidth, height: window.innerHeight });
    const onFullscreen = () => { onResize(); if (!document.fullscreenElement && wentFullscreen) handlers.current.onExit(); };
    let wentFullscreen = false;
    root.current?.requestFullscreen?.().then(() => { wentFullscreen = true; }).catch(() => { /* stays as a full-window overlay */ });
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('fullscreenchange', onFullscreen);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  const scale = Math.min(box.width / size.width, box.height / size.height);
  const button = 'p-2 rounded-lg text-white/80 hover:text-white hover:bg-white/15 disabled:opacity-30';
  return (
    <div ref={root} role="dialog" aria-label="Slideshow" className="fixed inset-0 z-[100] bg-black flex items-center justify-center group">
      <div onClick={next} style={{ cursor: 'pointer' }}>
        <SlideFace doc={doc} page={page} index={index} scale={scale} hideAnswers={waiting} />
      </div>
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1 rounded-xl bg-black/70 border border-white/15 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button type="button" className={button} onClick={previous} disabled={index === 0} aria-label="Previous slide" title="Previous (←)"><ChevronLeft size={18} /></button>
        <span className="text-xs text-white/80 tabular-nums px-1" aria-live="polite">{index + 1} / {doc.pages.length}</span>
        <button type="button" className={button} onClick={next} disabled={!waiting && index === doc.pages.length - 1} aria-label={waiting ? 'Show answer' : 'Next slide'} title={waiting ? 'Show answer (→)' : 'Next (→)'}>
          {waiting ? <Eye size={18} /> : <ChevronRight size={18} />}
        </button>
        <button type="button" className={button} onClick={onExit} aria-label="Exit slideshow" title="Exit (Esc)"><X size={18} /></button>
      </div>
      {waiting && <p className="absolute top-3 right-4 text-[11px] text-white/60 pointer-events-none">Answer hidden — press → or click to show</p>}
    </div>
  );
};

export const PrintView: React.FC<{ doc: DesignDoc; onDone: () => void }> = ({ doc, onDone }) => {
  useEffect(() => {
    const size = PAGE_SIZE[doc.layout];
    // One sheet per slide at the slide's own size; an A4 document flows over as many sheets as it needs.
    const style = document.createElement('style');
    style.textContent = doc.layout === 'slides'
      ? `@page { size: ${size.width}px ${size.height}px; margin: 0; }`
      : '@page { size: A4; margin: 0; } @media print { .design-print .design-sheet { break-inside: auto; } }';
    document.head.appendChild(style);
    window.addEventListener('afterprint', onDone);
    const timer = window.setTimeout(() => window.print(), 500);     // after fonts and pictures are in
    return () => { window.clearTimeout(timer); window.removeEventListener('afterprint', onDone); style.remove(); };
  }, []);
  return createPortal(
    <div className="design-print">
      {doc.pages.map((page, i) => <SlideFace key={page.id} doc={doc} page={page} index={i} scale={1} />)}
    </div>,
    document.body,
  );
};
