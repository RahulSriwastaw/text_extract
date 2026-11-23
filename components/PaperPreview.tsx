/**
 * Text extractor preview for an output template: one extracted page drawn the way it will
 * finally look (the Design Studio's "Board Exam" page), instead of as plain Markdown.
 * Read-only; the text itself is still edited with the Edit button.
 */
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { applyDesignOps, elementsToDesignDoc, examPaperOps, oneBlockPerLine, PAGE_SIZE } from '../services/designDoc';
import type { ExtractedElement } from '../types';
import { SlideFace } from './design/DesignCanvas';

const PaperPreview: React.FC<{ text: string }> = ({ text }) => {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const doc = useMemo(() => {
    const imported = elementsToDesignDoc([{ type: 'text', content: oneBlockPerLine(text) } as ExtractedElement], 'Preview');
    // One page of a paper: its page number is not known here, so the footer is left out.
    return applyDesignOps(imported, [...examPaperOps(imported), { op: 'setTheme', patch: { showPageNumbers: false } }]).doc;
  }, [text]);

  const scale = width ? Math.min(1, width / PAGE_SIZE.document.width) : 0;
  return (
    <div ref={host} className="paper-preview">
      {scale > 0 && <div className="mx-auto shadow-lg" style={{ width: PAGE_SIZE.document.width * scale }}><SlideFace doc={doc} page={doc.pages[0]} index={0} scale={scale} /></div>}
    </div>
  );
};

export default PaperPreview;
