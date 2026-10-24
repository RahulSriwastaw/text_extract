import React, { useRef } from 'react';
import { Eye } from 'lucide-react';
import { LatexRenderer } from './LatexRenderer';

type Snippet = { label: string; title: string; before: string; after?: string; placeholder?: string };

const SNIPPETS: Snippet[] = [
  { label: 'B', title: 'Bold <b>', before: '<b>', after: '</b>', placeholder: 'bold' },
  { label: 'I', title: 'Italic <i>', before: '<i>', after: '</i>', placeholder: 'italic' },
  { label: 'U', title: 'Underline <u>', before: '<u>', after: '</u>', placeholder: 'text' },
  { label: '↵', title: 'Line break <br>', before: '<br>' },
  { label: '$x$', title: 'Inline math $...$', before: '$', after: '$', placeholder: 'x^{2}' },
  { label: '$$', title: 'Display math $$...$$', before: '$$', after: '$$', placeholder: 'x = \\frac{-b \\pm \\sqrt{b^{2}-4ac}}{2a}' },
  { label: 'a/b', title: 'Fraction \\frac{a}{b}', before: '$\\frac{', after: '}{b}$', placeholder: 'a' },
  { label: '√', title: 'Square root \\sqrt{x}', before: '$\\sqrt{', after: '}$', placeholder: 'x' },
  { label: 'x²', title: 'Power x^{n}', before: '$x^{', after: '}$', placeholder: '2' },
  { label: '1.', title: 'Numbered list (statements I, II, III)', before: '<ol type="I"><li>', after: '</li><li>Statement 2</li></ol>', placeholder: 'Statement 1' },
  { label: '▦', title: 'Table (Match the following)', before: '<table><tr><th>List I</th><th>List II</th></tr><tr><td>', after: '</td><td>1. ...</td></tr></table>', placeholder: 'A. ...' },
];

/**
 * Source editor for an HTML + LaTeX field: snippet toolbar, raw textarea/input and a live KaTeX preview.
 */
export const HtmlLatexField: React.FC<{
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  singleLine?: boolean;
  placeholder?: string;
  textClassName?: string;
}> = ({ value, onChange, rows = 3, singleLine = false, placeholder, textClassName = 'text-ink' }) => {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  const insert = (s: Snippet) => {
    const el = ref.current;
    const current = value || '';
    const start = el ? el.selectionStart ?? current.length : current.length;
    const end = el ? el.selectionEnd ?? current.length : current.length;
    const selected = current.slice(start, end) || s.placeholder || '';
    const next = current.slice(0, start) + s.before + selected + (s.after || '') + current.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const selStart = start + s.before.length;
      el.setSelectionRange(selStart, selStart + selected.length);
    });
  };

  const baseInput = `w-full px-2.5 py-2 bg-canvas border border-line-strong rounded-lg text-[13px] leading-relaxed font-mono focus:outline-none focus:border-accent ${textClassName}`;
  const hasContent = !!(value && value.trim());

  return (
    <div className="space-y-1.5 w-full min-w-0">
      {!singleLine && (
        <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Insert formatting">
          {SNIPPETS.map(s => (
            <button
              key={s.label}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => insert(s)}
              title={s.title}
              className="min-w-[28px] h-7 px-2 rounded-md bg-surface-2 hover:bg-surface-3 border border-line hover:border-line-strong text-xs font-semibold text-ink-2 hover:text-ink transition-colors"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      {singleLine ? (
        <input
          ref={ref}
          type="text"
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={baseInput}
        />
      ) : (
        <textarea
          ref={ref}
          rows={rows}
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${baseInput} resize-y min-h-[3rem]`}
        />
      )}
      {hasContent && (
        <div className="rounded-lg border border-dashed border-line-strong bg-white/[0.02] px-2.5 py-2">
          <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3 mb-1">
            <Eye className="w-3 h-3" /> Preview
          </div>
          <LatexRenderer content={value} inline={singleLine} className="text-ink" />
        </div>
      )}
    </div>
  );
};
