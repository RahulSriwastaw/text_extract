import React, { useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { cleanMocktestText } from '../services/textCleanService';

declare global {
  interface Window {
    MathJax?: {
      typesetPromise: (elements?: HTMLElement[]) => Promise<void>;
      typesetClear?: (elements?: HTMLElement[]) => void;
      startup?: { promise: Promise<void> };
    };
  }
}

/**
 * Hook: Calls MathJax.typesetPromise() whenever `deps` change.
 */
export function useMathJax(ref?: React.RefObject<HTMLElement | null>, deps: any[] = []) {
  useEffect(() => {
    const triggerTypeset = async () => {
      const mj = window.MathJax;
      if (!mj?.typesetPromise) return;
      try {
        if (mj.startup?.promise) await mj.startup.promise;
        const elements = ref?.current ? [ref.current] : undefined;
        if (mj.typesetClear && elements) mj.typesetClear(elements);
        await mj.typesetPromise(elements);
      } catch (e) {
        console.debug('[MathJax] typesetPromise error (non-fatal):', e);
      }
    };
    const timer = setTimeout(triggerTypeset, 50);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * LaTeX and Math-safe content renderer using KaTeX + MathJax 3.
 * Renders $...$ / $$...$$ via KaTeX (fast, offline).
 */
export const LatexRenderer: React.FC<{ content: string; className?: string; inline?: boolean }> = ({
  content,
  className,
  inline = false
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useMathJax(containerRef, [content]);

  if (!content) return null;

  let clean = cleanMocktestText(content);

  clean = clean.replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$');
  clean = clean.replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$');

  // Convert HTML tables to Markdown tables for remarkGfm
  clean = clean.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_match, tableContent) => {
    const rows: string[][] = [];
    const rowMatches = tableContent.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    for (const rowHtml of rowMatches) {
      const cells: string[] = [];
      const cellMatches = rowHtml.match(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi) || [];
      for (const c of cellMatches) {
        const inner = c.replace(/<(?:th|td)[^>]*>|<\/(?:th|td)>/gi, '').replace(/\n/g, ' ').trim();
        cells.push(inner || '-');
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length === 0) return '';
    const maxCols = Math.max(...rows.map(r => r.length));
    const paddedRows = rows.map(r => {
      const full = [...r];
      while (full.length < maxCols) full.push('-');
      return '| ' + full.join(' | ') + ' |';
    });
    const headerDivider = '| ' + Array(maxCols).fill('---').join(' | ') + ' |';
    return '\n\n' + paddedRows[0] + '\n' + headerDivider + '\n' + paddedRows.slice(1).join('\n') + '\n\n';
  });

  // Convert HTML lists
  clean = clean.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '* $1\n');
  clean = clean.replace(/<\/?(?:ul|ol)[^>]*>/gi, '\n');

  // Formatting tags
  clean = clean
    .replace(/<hr\s*\/?>/gi, '\n\n---\n\n')
    .replace(/<div[^>]*>/gi, '')
    .replace(/<\/div>/gi, '\n')
    .replace(/<(?:b|strong)[^>]*>(.*?)<\/(?:b|strong)>/gi, '**$1**')
    .replace(/<(?:i|em)[^>]*>(.*?)<\/(?:i|em)>/gi, '*$1*')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<\/?p[^>]*>/gi, '\n\n');

  const lines = clean.split('\n');
  const normalizedLines: string[] = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const isTableLine = /^\s*\|.*\|\s*$/.test(l);

    if (isTableLine) {
      if (!inTable) {
        if (normalizedLines.length > 0 && normalizedLines[normalizedLines.length - 1].trim() !== '') {
          normalizedLines.push('');
        }
        inTable = true;
      }
      normalizedLines.push(l.trim());
    } else {
      if (inTable) {
        inTable = false;
        normalizedLines.push('');
      }
      normalizedLines.push(l);
    }
  }
  clean = normalizedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  const customTableComponents = {
    table: ({ children }: any) => (
      <div className="my-3 overflow-x-auto w-full rounded-xl border border-white/[0.15] bg-black/50 shadow-md">
        <table className="w-full text-left text-xs border-collapse border-spacing-0">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }: any) => (
      <thead className="bg-white/[0.08] border-b border-white/[0.15] text-amber-300 font-extrabold uppercase tracking-wider text-[11px]">
        {children}
      </thead>
    ),
    tbody: ({ children }: any) => (
      <tbody className="divide-y divide-white/[0.06] text-slate-200">
        {children}
      </tbody>
    ),
    tr: ({ children }: any) => (
      <tr className="hover:bg-white/[0.04] transition-colors">
        {children}
      </tr>
    ),
    th: ({ children }: any) => (
      <th className="py-2 px-3 font-extrabold border-r border-white/[0.08] last:border-r-0 text-amber-300">
        {children}
      </th>
    ),
    td: ({ children }: any) => (
      <td className="py-2 px-3 border-r border-white/[0.06] last:border-r-0 font-medium text-slate-200 leading-relaxed">
        {children}
      </td>
    )
  };

  const katexOptions = {
    throwOnError: false,
    strict: false,
    trust: true
  };

  if (inline) {
    return (
      <span ref={containerRef as React.RefObject<HTMLSpanElement>} className={`inline-flex items-center text-xs leading-normal ${className || ''}`}>
        <ReactMarkdown
          remarkPlugins={[remarkMath, remarkGfm]}
          rehypePlugins={[[rehypeKatex, katexOptions]]}
          components={{
            p: ({ children }) => <span className="inline">{children}</span>,
            ...customTableComponents
          }}
        >
          {clean}
        </ReactMarkdown>
      </span>
    );
  }

  return (
    <div ref={containerRef} className={`prose prose-invert max-w-none text-xs leading-relaxed ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[[rehypeKatex, katexOptions]]}
        components={customTableComponents}
      >
        {clean}
      </ReactMarkdown>
    </div>
  );
};
