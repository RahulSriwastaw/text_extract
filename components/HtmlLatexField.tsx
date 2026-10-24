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
}> = ({ value, onChange, rows = 3, singleLine = false, placeholder, textClassName = 'text-white' }) => {
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

  const baseInput = `w-full p-2 bg-black/60 border border-white/[0.1] rounded-lg text-xs font-mono focus:outline-none focus:border-amber-500/50 ${textClassName}`;
  const hasContent = !!(value && value.trim());

  return (
    <div className="space-y-1.5 w-full min-w-0">
      {!singleLine && (
        <div className="flex flex-wrap items-center gap-1">
          {SNIPPETS.map(s => (
            <button
              key={s.label}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => insert(s)}
              title={s.title}
              className="min-w-[24px] px-1.5 py-0.5 rounded bg-white/[0.05] hover:bg-amber-500/20 border border-white/[0.08] hover:border-amber-500/40 text-[10px] font-bold text-slate-300 hover:text-amber-200 transition-colors"
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
        <div className="rounded-lg border border-dashed border-white/[0.1] bg-white/[0.02] px-2 py-1.5">
          <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">
            <Eye className="w-2.5 h-2.5" /> KaTeX preview
          </div>
          <LatexRenderer content={value} inline={singleLine} className="text-slate-200" />
        </div>
      )}
    </div>
  );
};
