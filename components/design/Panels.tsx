/**
 * Design Studio side panels — the manual tools. All of them are free (no AI, no tokens)
 * and work on what the AI or the importer already labelled: headings, questions, boxes…
 *
 *   ThemePanel     whole-document look
 *   ElementsPanel  one element, or every element of a kind ("all H2"); highlighter; find & replace
 *   InsertPanel    slides, teaching boxes, questions, tables, pictures, cover slide
 */
import React, { useState } from 'react';
import {
  Scissors, Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, RotateCcw, ImagePlus, Search,
  FileText, Type, Heading1, Heading2, Heading3, List, Table as TableIcon, Minus, HelpCircle, Square, Columns2, LayoutTemplate, Presentation,
} from 'lucide-react';
import {
  type DesignDoc, type DesignOp, type DesignBlock, type BlockStyle, type ResolvedStyle, type StyleKey, type FontId, type Theme,
  type CalloutId, type BlockType, type Decoration, type SpacingId, type PageLayout,
  PRESET_THEMES, FONTS, FONT_IDS, STYLE_KEYS, STYLE_KEY_LABELS, HIGHLIGHTERS, HIGHLIGHTER_IDS, CALLOUTS, CALLOUT_IDS, DECORATIONS,
  allBlocks, autoPaginate, elementCounts, resolveStyle, styleKey, plainText, optionColumnsOf, combinedOptionCount, examPaperOps,
} from '../../services/designDoc';
import type { OpResult } from './DesignCanvas';

type Apply = (ops: DesignOp[], coalesce?: string) => OpResult;

const label = 'block text-[11px] font-bold text-ink-3 mb-1';
const field = 'w-full bg-surface-2 border border-line rounded-lg px-2.5 py-1.5 text-xs text-ink';
const chip = 'px-2 py-1.5 rounded-lg text-[11px] font-medium border text-left transition-colors';
const chipIdle = chip + ' text-ink-2 bg-white/[0.04] border-white/[0.08] hover:border-accent hover:text-ink';

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <section className="space-y-2">
    <div>
      <h3 className="text-xs font-bold text-ink">{title}</h3>
      {hint && <p className="text-[11px] text-ink-3 leading-snug">{hint}</p>}
    </div>
    {children}
  </section>
);

function Seg<T extends string | number>({ value, options, onPick, name }: { value: T | undefined; options: readonly (readonly [T, React.ReactNode, string?])[]; onPick: (value: T) => void; name: string }) {
  return (
    <div className="seg seg-sm w-full" role="group" aria-label={name}>
      {options.map(([v, text, title]) => (
        <button key={String(v)} type="button" className="seg-item flex-1" aria-pressed={v === value} title={title} aria-label={title} onClick={() => onPick(v)}>{text}</button>
      ))}
    </div>
  );
}

/** A tiny picture of four options laid out in `columns` columns. */
const OptionGlyph: React.FC<{ columns: 1 | 2 | 4 }> = ({ columns }) => (
  <span aria-hidden="true" style={{ display: 'inline-grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 2, width: 26, verticalAlign: 'middle' }}>
    {[0, 1, 2, 3].map(i => <span key={i} style={{ height: columns === 4 ? 8 : 3, borderRadius: 1, background: 'currentColor' }} />)}
  </span>
);
const OPTION_LAYOUTS = [
  [1, <OptionGlyph columns={1} />, 'One option per row (4 rows)'],
  [2, <OptionGlyph columns={2} />, 'Two per row (2 × 2)'],
  [4, <OptionGlyph columns={4} />, 'All four in one row (1 × 4)'],
] as const;
const OPTION_LAYOUT_NAMES: Record<number, string> = { 1: 'one per row', 2: 'two per row (2 × 2)', 4: 'all in one row (1 × 4)' };

// ---------------------------------------------------------------------------
// Style controls shared by "this element" and "every element of this kind"
// ---------------------------------------------------------------------------
function StyleControls({ id, own, resolved, onChange, onUnset, image }: {
  id: string;
  /** What is set explicitly at this level. */
  own: BlockStyle;
  /** What the element ends up looking like (theme + group + own). */
  resolved: ResolvedStyle;
  onChange: (style: BlockStyle, coalesce?: string) => void;
  onUnset: (keys: (keyof BlockStyle)[]) => void;
  image?: boolean;
}) {
  const auto = (key: keyof BlockStyle, text = 'Auto') => own[key] !== undefined && (
    <button type="button" className="text-[10px] font-bold text-accent-light hover:underline" onClick={() => onUnset([key])}>{text}</button>
  );
  const toggle = 'seg-item flex-1';
  if (image) {
    return (
      <div className="space-y-2">
        <div><p className={label}>Picture width</p>
          <Seg name="Picture width" value={resolved.width} onPick={width => onChange({ width })} options={[['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large'], ['full', 'Full']] as const} /></div>
        <div><p className={label}>Position</p>
          <Seg name="Position" value={own.align || 'center'} onPick={align => onChange({ align })} options={[['left', <AlignLeft />, 'Left'], ['center', <AlignCenter />, 'Centre'], ['right', <AlignRight />, 'Right']] as const} /></div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] font-bold text-ink-3">
          <span className="flex justify-between">Text colour {auto('color')}</span>
          <input type="color" value={own.color || resolved.color} onChange={e => onChange({ color: e.target.value }, id + ':color')}
            className="block w-full h-7 mt-1 rounded-lg bg-surface-2 border border-line cursor-pointer" />
        </label>
        <label className="text-[11px] font-bold text-ink-3">
          <span className="flex justify-between">Background {auto('background', 'None')}</span>
          <input type="color" value={own.background || resolved.background || '#FFFFFF'} onChange={e => onChange({ background: e.target.value }, id + ':background')}
            className="block w-full h-7 mt-1 rounded-lg bg-surface-2 border border-line cursor-pointer" />
        </label>
      </div>
      <div>
        <p className={label + ' flex justify-between'}>Size {auto('size', 'Normal')}</p>
        <Seg name="Size" value={own.size || 'md'} onPick={size => onChange({ size })} options={[['sm', 'Small'], ['md', 'Normal'], ['lg', 'Large'], ['xl', 'Huge']] as const} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="seg seg-sm" role="group" aria-label="Text style">
          <button type="button" className={toggle} aria-pressed={resolved.bold} aria-label="Bold" title="Bold" onClick={() => onChange({ bold: !resolved.bold })}><Bold /></button>
          <button type="button" className={toggle} aria-pressed={resolved.italic} aria-label="Italic" title="Italic" onClick={() => onChange({ italic: !resolved.italic })}><Italic /></button>
          <button type="button" className={toggle} aria-pressed={resolved.underline} aria-label="Underline" title="Underline" onClick={() => onChange({ underline: !resolved.underline })}><Underline /></button>
        </div>
        <Seg name="Alignment" value={resolved.align} onPick={align => onChange({ align })} options={[['left', <AlignLeft />, 'Left'], ['center', <AlignCenter />, 'Centre'], ['right', <AlignRight />, 'Right']] as const} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] font-bold text-ink-3">Border
          <select className="select w-full text-xs mt-1" value={own.border || ''} onChange={e => e.target.value ? onChange({ border: e.target.value as BlockStyle['border'] }) : onUnset(['border'])}>
            <option value="">Theme default</option><option value="none">None</option><option value="box">Box</option><option value="left-bar">Side bar</option><option value="underline">Underline</option>
          </select>
        </label>
        <label className="text-[11px] font-bold text-ink-3">
          <span className="flex justify-between">Border colour {auto('borderColor')}</span>
          <input type="color" value={own.borderColor || resolved.borderColor} onChange={e => onChange({ borderColor: e.target.value }, id + ':border')}
            className="block w-full h-7 mt-1 rounded-lg bg-surface-2 border border-line cursor-pointer" />
        </label>
      </div>
      <label className="block text-[11px] font-bold text-ink-3">Font
        <select className="select w-full text-xs mt-1" value={own.font || ''} onChange={e => e.target.value ? onChange({ font: e.target.value as FontId }) : onUnset(['font'])}>
          <option value="">Same as the document</option>
          {FONT_IDS.map(f => <option key={f} value={f}>{FONTS[f].label}</option>)}
        </select>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
export const ThemePanel: React.FC<{ doc: DesignDoc; applyOps: Apply; onReplace: (doc: DesignDoc) => void }> = ({ doc, applyOps, onReplace }) => {
  const { theme } = doc;
  const setTheme = (patch: Partial<Theme>, coalesce?: string) => applyOps([{ op: 'setTheme', patch }], coalesce);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-5">
      <Section title="Themes" hint="One click changes the whole look. Free, no tokens.">
        <div className="grid grid-cols-3 gap-1.5">
          {PRESET_THEMES.map(preset => (
            <button key={preset.name} type="button" onClick={() => setTheme(preset)} aria-pressed={theme.name === preset.name} title={preset.name}
              className={`p-1.5 rounded-lg border text-left ${theme.name === preset.name ? 'border-accent bg-surface-3' : 'border-line hover:border-accent'}`}>
              <span className="flex h-7 rounded mb-1 overflow-hidden border border-white/10" style={{ background: preset.pageBackground }}>
                <span className="w-1.5" style={{ background: preset.primary }} />
                <span className="flex-1 flex flex-col justify-center gap-0.5 px-1">
                  <span className="h-1.5 w-8 rounded-sm" style={{ background: preset.primary }} />
                  <span className="h-1 w-10 rounded-sm" style={{ background: preset.text, opacity: 0.6 }} />
                  <span className="h-1 w-6 rounded-sm" style={{ background: preset.accent }} />
                </span>
              </span>
              <span className="block text-[11px] font-bold text-ink truncate">{preset.name}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-secondary btn-sm w-full" title="Board Exam theme, options two per row, and page codes moved into the header and footer"
          onClick={() => applyOps(examPaperOps(doc))}>
          <FileText /> Make it a board exam paper
        </button>
        <p className="text-[11px] text-ink-3 leading-snug">Question numbers in the margin, options 2 × 2, centred section headings, set code and page code in boxes. Free, no tokens.</p>
      </Section>

      <Section title="Colours">
        <div className="grid grid-cols-2 gap-2">
          {(['primary', 'accent', 'text', 'pageBackground'] as const).map(key => (
            <label key={key} className="text-[11px] font-bold text-ink-3">
              {{ primary: 'Main colour', accent: 'Accent colour', text: 'Text colour', pageBackground: 'Page background' }[key]}
              <input type="color" value={theme[key]} onChange={e => setTheme({ [key]: e.target.value, name: 'Custom' } as Partial<Theme>, 'theme:' + key)}
                className="block w-full h-7 mt-1 rounded-lg bg-surface-2 border border-line cursor-pointer" />
            </label>
          ))}
        </div>
      </Section>

      <Section title="Text">
        <div>
          <label className={label} htmlFor="design-font">Font</label>
          <select id="design-font" className="select w-full text-xs" value={theme.font} onChange={e => setTheme({ font: e.target.value as FontId })}>
            {FONT_IDS.map(id => <option key={id} value={id} style={{ fontFamily: FONTS[id].css }}>{FONTS[id].label}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="design-size">Text size: {theme.baseSize} pt</label>
          <input id="design-size" type="range" min={9} max={18} value={theme.baseSize} onChange={e => setTheme({ baseSize: Number(e.target.value) }, 'theme:size')} className="w-full" />
        </div>
        <div><p className={label}>Line spacing</p>
          <Seg name="Line spacing" value={theme.spacing || 'normal'} onPick={(spacing: SpacingId) => setTheme({ spacing })} options={[['compact', 'Compact'], ['normal', 'Normal'], ['relaxed', 'Relaxed']] as const} /></div>
      </Section>

      <Section title="Style of headings, questions and options">
        <div><p className={label}>Headings</p>
          <Seg name="Headings" value={theme.headingStyle} onPick={headingStyle => setTheme({ headingStyle })} options={[['plain', 'Plain'], ['bar', 'Side bar'], ['banner', 'Banner']] as const} /></div>
        <div><p className={label}>Questions</p>
          <Seg name="Questions" value={theme.questionStyle} onPick={questionStyle => setTheme({ questionStyle })} options={[['plain', 'Plain'], ['boxed', 'Boxed'], ['numbered-badge', 'Badge'], ['hanging', 'Exam', 'Exam paper: the number stands in the margin']] as const} /></div>
        <div><p className={label}>Options per row</p>
          <Seg name="Options per row" value={optionColumnsOf(theme)}
            onPick={columns => applyOps([{ op: 'setOptionsLayout', columns }])}
            options={[[1, '1'], [2, '2'], [4, '4']] as const} /></div>
      </Section>

      <Section title="Page decoration">
        <Seg name="Page decoration" value={theme.decoration || 'none'} onPick={(decoration: Decoration) => setTheme({ decoration })}
          options={DECORATIONS.map(d => [d, { none: 'None', 'top-bar': 'Top', 'bottom-bar': 'Bottom', 'left-bar': 'Side', frame: 'Frame' }[d]] as const)} />
      </Section>

      <Section title="Teaching-box labels" hint={'The words on boxes such as "Remember" / "याद रखें".'}>
        <Seg name="Label language" value={theme.labelLang || 'en'} onPick={(labelLang: 'hi' | 'en') => setTheme({ labelLang })} options={[['hi', 'हिंदी'], ['en', 'English']] as const} />
      </Section>

      {doc.layout === 'slides' && (
        <button type="button" className="btn btn-secondary btn-sm w-full" onClick={() => onReplace(autoPaginate(doc))}>
          <Scissors /> Re-split slides: one question per slide
        </button>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------
const TYPE_CHOICES: { value: string; label: string; type: BlockType; level?: 1 | 2 | 3 }[] = [
  { value: 'h1', label: 'Heading 1 (chapter)', type: 'heading', level: 1 },
  { value: 'h2', label: 'Heading 2 (section)', type: 'heading', level: 2 },
  { value: 'h3', label: 'Heading 3 (activity)', type: 'heading', level: 3 },
  { value: 'paragraph', label: 'Paragraph', type: 'paragraph' },
  { value: 'list', label: 'Bullet list', type: 'list' },
  { value: 'question', label: 'Question', type: 'question' },
  { value: 'option', label: 'Option', type: 'option' },
  { value: 'answer', label: 'Answer', type: 'answer' },
  { value: 'callout', label: 'Teaching box', type: 'callout' },
];

export const ElementsPanel: React.FC<{
  doc: DesignDoc; applyOps: Apply;
  selectedBlockId?: string; onSelectBlock: (id: string | undefined) => void;
  highlightKey?: StyleKey; setHighlightKey: (key: StyleKey | undefined) => void;
}> = ({ doc, applyOps, selectedBlockId, onSelectBlock, highlightKey, setHighlightKey }) => {
  const { theme } = doc;
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [found, setFound] = useState('');

  const page = doc.pages.find(p => p.blocks.some(b => b.id === selectedBlockId));
  const block: DesignBlock | undefined = page?.blocks.find(b => b.id === selectedBlockId);
  const counts = elementCounts(doc);
  const combined = highlightKey === 'option' ? combinedOptionCount(doc) : 0;
  const ctxOf = (key?: StyleKey) => ({ layout: doc.layout, pageLayout: page?.layout, pageBackground: page?.background, pageScale: page?.scale, ...(key && { key }) });
  const marks = allBlocks(doc).reduce((n, b) => n + ((b.text || '').match(/==[^=\n]+==/g) || []).length, 0);

  const sample = (key: StyleKey): Pick<DesignBlock, 'type' | 'level'> =>
    key === 'title' || key === 'h1' ? { type: 'heading', level: 1 } : key === 'h2' ? { type: 'heading', level: 2 } : key === 'h3' ? { type: 'heading', level: 3 }
    : key === 'header' || key === 'footer' ? { type: 'paragraph' } : { type: key as BlockType };

  const replaceAll = () => {
    if (!find) return;
    const pattern = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
    const count = doc.pages.reduce((n, p) => n + ((p.title || '').match(pattern) || []).length
      + p.blocks.reduce((m, b) => m + (b.type === 'image' ? 0 : ((b.text || '').match(pattern) || []).length), 0), 0);
    if (count) applyOps([{ op: 'findReplace', find, replace, matchCase }]);
    setFound(count ? `Replaced ${count} time${count === 1 ? '' : 's'}.` : 'Not found.');
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-5">
      {/* ---- the element that was clicked ---- */}
      <Section title="Selected element" hint={block ? undefined : 'Click any heading, paragraph, question or box on the page to change just that one.'}>
        {block && (
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] space-y-2.5">
            <p className="text-[11px] text-ink-2 truncate" title={plainText(block.text || '')}>
              <span className="font-bold text-accent-light">{STYLE_KEY_LABELS[styleKey(block) || 'paragraph']}</span>
              {block.text ? ' · ' + plainText(block.text).slice(0, 60) : ''}
            </p>
            {block.type !== 'image' && block.type !== 'table' && block.type !== 'divider' && (
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] font-bold text-ink-3">Element type
                  <select className="select w-full text-xs mt-1" value={block.type === 'heading' ? 'h' + (block.level || 2) : block.type}
                    onChange={e => { const c = TYPE_CHOICES.find(t => t.value === e.target.value)!; applyOps([{ op: 'updateBlock', id: block.id, type: c.type, ...(c.level && { level: c.level }) }]); }}>
                    {TYPE_CHOICES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </label>
                {block.type === 'callout' && (
                  <label className="text-[11px] font-bold text-ink-3">Box kind
                    <select className="select w-full text-xs mt-1" value={block.variant || ''}
                      onChange={e => applyOps([{ op: 'updateBlock', id: block.id, variant: (e.target.value || null) as CalloutId | null }])}>
                      <option value="">Plain box</option>
                      {CALLOUT_IDS.map(c => <option key={c} value={c}>{CALLOUTS[c].icon} {CALLOUTS[c].en}</option>)}
                    </select>
                  </label>
                )}
              </div>
            )}
            {block.type !== 'divider' && block.type !== 'table' && (
              <StyleControls id={'block:' + block.id} image={block.type === 'image'} own={block.style || {}} resolved={resolveStyle(theme, block, ctxOf())}
                onChange={(style, coalesce) => applyOps([{ op: 'styleBlocks', ids: [block.id], style }], coalesce)}
                onUnset={unset => applyOps([{ op: 'styleBlocks', ids: [block.id], unset }])} />
            )}
            <div className="flex flex-wrap gap-1.5">
              {styleKey(block) && block.style && Object.keys(block.style).length > 0 && (
                <button type="button" className="btn btn-secondary btn-xs" title="Copies this element's look to every element of the same kind"
                  onClick={() => applyOps([
                    { op: 'setElementStyle', target: styleKey(block)!, style: block.style, override: true },
                  ])}>
                  Apply to all: {STYLE_KEY_LABELS[styleKey(block)!]}
                </button>
              )}
              {block.style && <button type="button" className="btn btn-ghost btn-xs" onClick={() => applyOps([{ op: 'styleBlocks', ids: [block.id], clear: true }])}><RotateCcw /> Reset</button>}
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => onSelectBlock(undefined)}>Done</button>
            </div>
          </div>
        )}
      </Section>

      {/* ---- every element of one kind ---- */}
      <Section title="All elements of one kind" hint="Pick a kind: every one of them is outlined on the pages and changes together.">
        <div className="flex flex-wrap gap-1.5">
          {STYLE_KEYS.filter(key => counts[key] || theme.styles?.[key]).map(key => (
            <button key={key} type="button" aria-pressed={highlightKey === key} onClick={() => setHighlightKey(highlightKey === key ? undefined : key)}
              className={highlightKey === key ? chip + ' text-ink bg-surface-3 border-accent' : chipIdle}>
              {STYLE_KEY_LABELS[key]} <span className="text-ink-3">{counts[key] || 0}</span>
              {theme.styles?.[key] && <span className="text-accent-light" title="Has its own style"> ●</span>}
            </button>
          ))}
        </div>
        {highlightKey && (
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] space-y-2.5">
            <p className="text-[11px] font-bold text-accent-light">Every {STYLE_KEY_LABELS[highlightKey].toLowerCase()}</p>
            {(highlightKey === 'header' || highlightKey === 'footer') && (
              <input className={field} aria-label={highlightKey === 'header' ? 'Header text' : 'Footer text'}
                placeholder={highlightKey === 'header' ? 'Header text, e.g. Class 7 · Science' : 'Footer text, e.g. school name'}
                value={theme[highlightKey] || ''} onChange={e => applyOps([{ op: 'setTheme', patch: { [highlightKey]: e.target.value } }], 'theme:' + highlightKey)} />
            )}
            {highlightKey === 'header' && (
              <input className={field} aria-label="Header text at the right" placeholder="Right side, e.g. [ 111 ] (subject code)"
                value={theme.headerRight || ''} onChange={e => applyOps([{ op: 'setTheme', patch: { headerRight: e.target.value } }], 'theme:headerRight')} />
            )}
            {(highlightKey === 'header' || highlightKey === 'footer') && (
              <div><p className={label}>Header and footer style</p>
                <Seg name="Header and footer style" value={theme.runningStyle || 'plain'} onPick={runningStyle => applyOps([{ op: 'setTheme', patch: { runningStyle } }])}
                  options={[['plain', 'Plain'], ['exam', 'Exam paper', 'Codes in boxes at the left, "Page 4 of 24" at the right']] as const} /></div>
            )}
            {highlightKey === 'footer' && (
              <label className="flex items-center gap-2 text-xs text-ink-2">
                <input type="checkbox" checked={theme.showPageNumbers} onChange={e => applyOps([{ op: 'setTheme', patch: { showPageNumbers: e.target.checked } }])} /> Show page numbers
              </label>
            )}
            {highlightKey === 'option' && (
              <div>
                <p className={label + ' flex justify-between'}>Options layout
                  <span className="font-medium">{theme.styles?.option?.columns ? OPTION_LAYOUT_NAMES[theme.styles.option.columns] : `Auto: ${OPTION_LAYOUT_NAMES[theme.optionColumns]}`}</span></p>
                <Seg<number> name="Options layout" value={theme.styles?.option?.columns || 0}
                  onPick={columns => applyOps(columns
                    // Lines that hold two options ("(A) … (B) …") are separated first, or no layout could move them.
                    ? [{ op: 'splitOptions' }, { op: 'setElementStyle', target: 'option', style: { columns: columns as 1 | 2 | 4 } }]
                    : [{ op: 'setElementStyle', target: 'option', unset: ['columns'] }])}
                  options={[[0, 'Auto', "Follow the theme's layout"], ...OPTION_LAYOUTS]} />
                {combined > 0 && (
                  <p className="text-[11px] text-ink-3 leading-snug mt-1.5">
                    {combined} line{combined === 1 ? ' holds' : 's hold'} several options together, e.g. "(A) … (B) …".{' '}
                    <button type="button" className="font-bold text-accent-light hover:underline" onClick={() => applyOps([{ op: 'splitOptions' }])}>Separate them</button>
                  </p>
                )}
              </div>
            )}
            {highlightKey !== 'table' && (
              <StyleControls id={'group:' + highlightKey} image={highlightKey === 'image'} own={theme.styles?.[highlightKey] || {}}
                resolved={resolveStyle(theme, sample(highlightKey), ctxOf(highlightKey))}
                onChange={(style, coalesce) => applyOps([{ op: 'setElementStyle', target: highlightKey, style }], coalesce)}
                onUnset={unset => applyOps([{ op: 'setElementStyle', target: highlightKey, unset }])} />
            )}
            {highlightKey === 'table' && <p className="text-[11px] text-ink-3">Tables follow the theme's main colour and text colour (Theme tab).</p>}
            {theme.styles?.[highlightKey] && (
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => applyOps([{ op: 'setElementStyle', target: highlightKey, reset: true }])}><RotateCcw /> Back to the theme's look</button>
            )}
          </div>
        )}
        {!counts.header && !highlightKey && (
          <button type="button" className={chipIdle} onClick={() => setHighlightKey('header')}>+ Add a header / footer text</button>
        )}
      </Section>

      {/* ---- highlighter ---- */}
      <Section title="Highlighter" hint="Select words on a page with the mouse to bold or highlight them. Here you choose the default pen.">
        <div className="flex items-center gap-2">
          {HIGHLIGHTER_IDS.map(pen => (
            <button key={pen} type="button" title={`${pen} pen`} aria-label={`${pen} pen`} aria-pressed={(theme.highlight || 'yellow') === pen}
              onClick={() => applyOps([{ op: 'setHighlighter', color: pen }])}
              className="w-7 h-7 rounded-full border border-white/30"
              style={{ background: HIGHLIGHTERS[pen], outline: (theme.highlight || 'yellow') === pen ? '2px solid #F97316' : undefined, outlineOffset: 2 }} />
          ))}
        </div>
        <p className="text-[11px] text-ink-3">{marks} highlight{marks === 1 ? '' : 's'} in this document.</p>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="btn btn-secondary btn-xs" disabled={!marks} title="Every highlight, whatever its pen, switches to the default pen"
            onClick={() => applyOps([{ op: 'setHighlighter', color: theme.highlight || 'yellow', all: true }])}>Use this pen for all</button>
          <button type="button" className="btn btn-ghost btn-xs" disabled={!marks} onClick={() => applyOps([{ op: 'clearMarks', what: 'highlight' }])}>Remove all highlights</button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => applyOps([{ op: 'clearMarks', what: 'bold' }])}>Remove all bold</button>
        </div>
      </Section>

      {/* ---- find & replace ---- */}
      <Section title="Find and replace">
        <input className={field} placeholder="Find" aria-label="Find" value={find} onChange={e => { setFind(e.target.value); setFound(''); }} />
        <input className={field} placeholder="Replace with" aria-label="Replace with" value={replace} onChange={e => setReplace(e.target.value)} />
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-secondary btn-xs" disabled={!find} onClick={replaceAll}><Search /> Replace all</button>
          <label className="flex items-center gap-1.5 text-[11px] text-ink-2"><input type="checkbox" checked={matchCase} onChange={e => setMatchCase(e.target.checked)} /> Match case</label>
          {found && <span role="status" className="text-[11px] text-ink-3">{found}</span>}
        </div>
      </Section>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------
/** A picture file → a data URL no wider than 1600 px (keeps saved designs and Word files small). */
function readPicture(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read this picture.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('This file is not a picture the browser can open.'));
      img.onload = () => {
        const scale = Math.min(1, 1600 / img.naturalWidth);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
        const g = canvas.getContext('2d')!;
        g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, canvas.width, canvas.height);     // transparent PNGs would turn black as JPEG
        g.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(file.type === 'image/png' && file.size < 400_000 ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.88));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export const InsertPanel: React.FC<{
  doc: DesignDoc; applyOps: Apply;
  selectedPageId?: string; selectedBlockId?: string;
  onInsertImage: (dataUrl: string) => void;
}> = ({ doc, applyOps, selectedPageId, selectedBlockId, onInsertImage }) => {
  const [rows, setRows] = useState(3);
  const [columns, setColumns] = useState(3);
  const [lesson, setLesson] = useState({ title: doc.title, subject: '', teacher: '', school: '' });
  const [error, setError] = useState('');
  const slides = doc.layout === 'slides';
  const noun = slides ? 'slide' : 'section';
  const pageId = selectedPageId && doc.pages.some(p => p.id === selectedPageId) ? selectedPageId : doc.pages[doc.pages.length - 1]?.id;
  const anchor = selectedBlockId && doc.pages.some(p => p.blocks.some(b => b.id === selectedBlockId)) ? selectedBlockId : undefined;

  type NewBlock = Extract<DesignOp, { op: 'insertBlock' }>['block'];
  /** New blocks go right after the selected element, or at the end of the selected page. */
  const insert = (...blocks: NewBlock[]) => applyOps(anchor
    ? [...blocks].reverse().map(block => ({ op: 'insertBlock' as const, afterId: anchor, block }))   // each lands right after the anchor
    : blocks.map(block => ({ op: 'insertBlock' as const, pageId, atEnd: true, block })));
  const slide = (layout: PageLayout, blocks: NewBlock[]) => applyOps([{ op: 'insertSlide', afterPageId: pageId, layout, blocks }]);
  const hi = doc.theme.labelLang === 'hi';

  const tableText = () => {
    const row = (cells: string[]) => '| ' + cells.join(' | ') + ' |';
    return [row(Array.from({ length: columns }, (_, c) => `Heading ${c + 1}`)), '|' + ' --- |'.repeat(columns),
      ...Array.from({ length: rows - 1 }, () => row(Array.from({ length: columns }, () => ' ')))].join('\n');
  };

  const cover = () => {
    const title = lesson.title.trim() || doc.title;
    applyOps([
      { op: 'insertSlide', atStart: true, layout: 'title', blocks: [
        { type: 'heading', level: 1, text: title },
        ...(lesson.subject.trim() ? [{ type: 'paragraph' as const, text: lesson.subject.trim(), style: { size: 'lg' as const } }] : []),
        ...(lesson.teacher.trim() ? [{ type: 'paragraph' as const, text: lesson.teacher.trim() }] : []),
        ...(lesson.school.trim() ? [{ type: 'paragraph' as const, text: lesson.school.trim(), style: { size: 'sm' as const } }] : []),
      ] },
      ...(lesson.subject.trim() || lesson.school.trim() ? [{ op: 'setTheme' as const, patch: {
        ...(lesson.subject.trim() && { header: lesson.subject.trim() }), ...(lesson.school.trim() && { footer: lesson.school.trim() }),
      } }] : []),
    ]);
  };

  const tile = 'flex items-center gap-1.5 ' + chipIdle;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-5">
      <p className="text-[11px] text-ink-3">
        New content goes <span className="font-bold text-ink-2">{anchor ? 'right after the selected element' : `at the end of the selected ${noun}`}</span>. Then press its pencil to type.
      </p>

      <Section title={slides ? 'Slides' : 'Sections'}>
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" className={tile} onClick={() => slide('content', [])}><Square size={14} /> Blank {noun}</button>
          <button type="button" className={tile} onClick={() => slide('title', [{ type: 'heading', level: 1, text: hi ? 'पाठ का शीर्षक' : 'Lesson title' }, { type: 'paragraph', text: hi ? 'कक्षा · विषय' : 'Class · Subject' }])}><Presentation size={14} /> Cover</button>
          <button type="button" className={tile} onClick={() => slide('section', [{ type: 'heading', level: 1, text: hi ? 'नया भाग' : 'New section' }])}><LayoutTemplate size={14} /> Section divider</button>
          <button type="button" className={tile} onClick={() => slide('two-column', [{ type: 'heading', level: 2, text: hi ? 'तुलना' : 'Compare' }, { type: 'list', text: '- Point 1\n- Point 2' }, { type: 'list', text: '- Point 1\n- Point 2' }])}><Columns2 size={14} /> Two columns</button>
        </div>
      </Section>

      <Section title="Teaching boxes" hint="The labelled boxes teachers use most: aim, key words, recap, practice.">
        <div className="grid grid-cols-2 gap-1.5">
          {CALLOUT_IDS.map(id => (
            <button key={id} type="button" className={tile} onClick={() => insert({ type: 'callout', variant: id, text: '' })}>
              <span aria-hidden="true">{CALLOUTS[id].icon}</span> {hi ? CALLOUTS[id].hi : CALLOUTS[id].en}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Content">
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" className={tile} onClick={() => insert({ type: 'heading', level: 1, text: '' })}><Heading1 size={14} /> Heading 1</button>
          <button type="button" className={tile} onClick={() => insert({ type: 'heading', level: 2, text: '' })}><Heading2 size={14} /> Heading 2</button>
          <button type="button" className={tile} onClick={() => insert({ type: 'heading', level: 3, text: '' })}><Heading3 size={14} /> Heading 3</button>
          <button type="button" className={tile} onClick={() => insert({ type: 'paragraph', text: '' })}><Type size={14} /> Paragraph</button>
          <button type="button" className={tile} onClick={() => insert({ type: 'list', text: '- Point 1\n- Point 2\n- Point 3' })}><List size={14} /> Bullet list</button>
          <button type="button" className={tile} onClick={() => insert(
            { type: 'question', text: hi ? 'Q. प्रश्न यहाँ लिखें?' : 'Q. Type the question here?' },
            { type: 'option', text: '(a) ' }, { type: 'option', text: '(b) ' }, { type: 'option', text: '(c) ' }, { type: 'option', text: '(d) ' },
            { type: 'answer', text: 'Answer: a' })}><HelpCircle size={14} /> Question (MCQ)</button>
          <button type="button" className={tile} onClick={() => insert({ type: 'divider' })}><Minus size={14} /> Divider line</button>
          <label className={tile + ' cursor-pointer'}>
            <ImagePlus size={14} /> Picture
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only"
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; setError(''); if (f) readPicture(f).then(onInsertImage).catch(err => setError(err.message)); }} />
          </label>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-[11px] font-bold text-ink-3">Rows
            <input type="number" min={2} max={15} value={rows} onChange={e => setRows(Math.min(15, Math.max(2, Number(e.target.value) || 2)))} className={field + ' mt-1 w-16'} />
          </label>
          <label className="text-[11px] font-bold text-ink-3">Columns
            <input type="number" min={2} max={6} value={columns} onChange={e => setColumns(Math.min(6, Math.max(2, Number(e.target.value) || 2)))} className={field + ' mt-1 w-16'} />
          </label>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => insert({ type: 'table', text: tableText() })}><TableIcon /> Add table</button>
        </div>
        {error && <p role="alert" className="text-[11px] text-rose-300">{error}</p>}
      </Section>

      <Section title="Lesson details" hint="Makes a cover slide at the start, and puts the class/subject in the header and the school in the footer.">
        <input className={field} placeholder="Lesson / chapter title" aria-label="Lesson title" value={lesson.title} onChange={e => setLesson({ ...lesson, title: e.target.value })} />
        <input className={field} placeholder="Class · Subject (e.g. कक्षा 7 · विज्ञान)" aria-label="Class and subject" value={lesson.subject} onChange={e => setLesson({ ...lesson, subject: e.target.value })} />
        <input className={field} placeholder="Teacher's name" aria-label="Teacher's name" value={lesson.teacher} onChange={e => setLesson({ ...lesson, teacher: e.target.value })} />
        <input className={field} placeholder="School / institute" aria-label="School or institute" value={lesson.school} onChange={e => setLesson({ ...lesson, school: e.target.value })} />
        <button type="button" className="btn btn-secondary btn-sm w-full" onClick={cover}><Presentation /> Create cover slide</button>
      </Section>
    </div>
  );
};
