import React, { useMemo } from 'react';
import katex from 'katex';
import { cleanMocktestText } from '../services/textCleanService';
import { protectMath, restoreMath, toInlineHtml, MathSegment } from '../services/htmlLatex';

/**
 * Kept for backward compatibility: math is now rendered synchronously by KaTeX,
 * so there is nothing to typeset after mount.
 */
export function useMathJax(_ref?: React.RefObject<HTMLElement | null>, _deps: any[] = []) {}

const KATEX_MACROS: Record<string, string> = {
  '\\degree': '^\\circ',
  '\\cosec': '\\operatorname{cosec}',
  '\\R': '\\mathbb{R}',
  '\\N': '\\mathbb{N}',
  '\\Z': '\\mathbb{Z}',
};

const mathCache = new Map<string, string>();
const MATH_CACHE_LIMIT = 4000;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Renders one TeX segment with KaTeX; invalid TeX is shown as highlighted source instead of breaking the card. */
export function renderMathSegment({ tex, display }: MathSegment): string {
  const key = `${display ? 'D' : 'I'}|${tex}`;
  const cached = mathCache.get(key);
  if (cached !== undefined) return cached;

  let html: string;
  try {
    html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      strict: 'ignore',
      trust: false,
      output: 'htmlAndMathml',
      macros: { ...KATEX_MACROS },
    });
  } catch (err: any) {
    const msg = String(err?.message || 'Invalid LaTeX').replace(/^KaTeX parse error:\s*/, '');
    const src = display ? `$$${tex}$$` : `$${tex}$`;
    html = `<span class="math-error" title="LaTeX error: ${escapeHtml(msg)}">${escapeHtml(src)}</span>`;
  }
  if (mathCache.size > MATH_CACHE_LIMIT) mathCache.clear();
  mathCache.set(key, html);
  return html;
}

// Tailwind preflight's `list-style: none` overrides the native <ol type> hint (and CSS [type] selectors
// are case-insensitive), so the marker style is applied inline.
const OL_TYPE_STYLES: Record<string, string> = { I: 'upper-roman', i: 'lower-roman', A: 'upper-alpha', a: 'lower-alpha', '1': 'decimal' };

/** HTML + LaTeX string → final HTML with KaTeX markup. Input is sanitized by cleanMocktestText. */
export function renderHtmlLatex(content: string, inline = false): string {
  if (!content) return '';
  let html = cleanMocktestText(content).replace(
    /<ol([^>]*?) type="([IiAa1])"/g,
    (_m, before, t) => `<ol${before} type="${t}" style="list-style-type:${OL_TYPE_STYLES[t]}"`
  );
  if (inline) html = toInlineHtml(html);
  const { text, math } = protectMath(html);
  return restoreMath(text, math, renderMathSegment);
}

/**
 * Renders MCQ content stored as clean HTML (<p>, <br>, <b>, <sup>, <table>, <ol>, <img>…)
 * with LaTeX math ($...$, $$...$$, \(...\), \[...\]) typeset by KaTeX.
 */
export const LatexRenderer: React.FC<{ content: string; className?: string; inline?: boolean }> = React.memo(({
  content,
  className,
  inline = false
}) => {
  const html = useMemo(() => renderHtmlLatex(content || '', inline), [content, inline]);
  if (!html) return null;

  if (inline) {
    return (
      <span
        className={`mcq-html mcq-html-inline ${className || ''}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <div
      className={`mcq-html text-xs leading-relaxed ${className || ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

LatexRenderer.displayName = 'LatexRenderer';
