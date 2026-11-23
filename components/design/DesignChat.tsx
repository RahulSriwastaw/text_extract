import React, { useEffect, useRef, useState } from 'react';
import { Send, Sparkles, Undo2, Loader2, Square, GraduationCap } from 'lucide-react';
import { apiFetch } from '../../services/apiClient';
import { directModelFields, defaultClaudeModel, type DirectModel } from '../../services/claudeModels';
import { ClaudeModelSelect } from '../ClaudeModelSelect';
import { DESIGN_TEMPLATES, type DesignChatTurn, type DesignChatResponse, type DesignTemplate, type TemplateMode } from '../../services/designChat';
import { type DesignDoc, outlineForAi, fullTextChunks } from '../../services/designDoc';

export interface ChatMessage extends DesignChatTurn {
  id: string;
  /** Set on assistant messages that changed the document: lets the user undo exactly that change. */
  undoTo?: DesignDoc;
  note?: string;
}

type Scope = 'design' | 'text' | 'page';
/** Whole-lesson requests send at most this much text in one go. */
const LESSON_CHARS = 9000;
const GROUPS = [...new Set(DESIGN_TEMPLATES.map(t => t.group))];
const MODE_HINT: Record<TemplateMode, string> = { design: '', fullText: 'reads every word', lesson: 'writes new content' };

interface Props {
  doc: DesignDoc;
  /** Always the latest document, also while a multi-part request is running. */
  getDoc: () => DesignDoc | null;
  fill: Record<string, number>;
  selectedPageId?: string;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  /** Apply the AI's operations; returns how many were applied and skipped. */
  applyOps: (ops: unknown[]) => { applied: number; skipped: number; unchanged?: number };
  restore: (doc: DesignDoc) => void;
}

const DesignChat: React.FC<Props> = ({ getDoc, fill, selectedPageId, messages, setMessages, applyOps, restore }) => {
  const [draft, setDraft] = useState('');
  const [scope, setScope] = useState<Scope>('design');
  const [model, setModel] = useState<DirectModel>(defaultClaudeModel);
  const [sending, setSending] = useState('');     // progress text while a request runs
  const [error, setError] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stop = useRef(false);

  // Follow the conversation; an empty chat shows the list of jobs from its top.
  useEffect(() => { if (messages.length) listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages, sending]);

  const call = async (body: Record<string, unknown>): Promise<DesignChatResponse> => {
    const response = await apiFetch('/api/design-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, ...directModelFields(model) }),
    });
    const data: DesignChatResponse & { error?: string } = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  };

  /** `mode` comes from a template; a typed message uses the Design / Full text / This page switch. */
  const send = async (request: string, mode?: TemplateMode) => {
    request = request.trim();
    if (!request || sending) return;
    const before = getDoc();
    if (!before) return;
    setError(''); setDraft(''); setShowTemplates(false);
    stop.current = false;
    const history = messages.map(({ role, text }) => ({ role, text })).slice(-12);
    const shown = request.length > 220 ? request.slice(0, 220) + '…' : request;
    setMessages(m => [...m, { id: 'u' + Date.now(), role: 'user', text: shown }]);

    const scopePageId = !mode && scope === 'page' ? selectedPageId : undefined;
    const how: TemplateMode | 'page' = scopePageId ? 'page' : mode || (scope === 'text' ? 'fullText' : 'design');
    let applied = 0, skipped = 0, unchanged = 0, reply = '', done = 0, failure = '', cutShort = 0;
    const common = () => { const current = getDoc()!; return { theme: current.theme, layout: current.layout, history, request }; };

    try {
      if (how !== 'fullText') {
        setSending(how === 'lesson' ? 'Reading the lesson and writing…' : 'Designing…');
        const current = getDoc()!;
        const data = await call({
          ...common(),
          ...(how === 'page' ? { outline: outlineForAi(current, { pageIds: [scopePageId!], fullText: true, fill }), scopePageId }
            : how === 'lesson' ? { outline: outlineForAi(current, { maxChars: LESSON_CHARS }), lesson: true }
            : { outline: outlineForAi(current, { fill }) }),
        });
        ({ applied, skipped, unchanged = 0 } = applyOps(data.ops || []));
        reply = data.reply;
        if (data.truncated) cutShort++;
        done = 1;
      } else {
        // The AI must read every word: send the document in parts and gather the slide breaks,
        // which are applied once at the end (a per-part paginate would undo the earlier parts).
        const chunks = fullTextChunks(before);
        const breaks: unknown[] = [];
        for (const [i, blockIds] of chunks.entries()) {
          if (stop.current) break;
          setSending(chunks.length > 1 ? `Reading part ${i + 1} of ${chunks.length}…` : 'Reading the full text…');
          const data = await call({
            ...common(), outline: outlineForAi(getDoc()!, { blockIds, fullText: true }), fullText: true,
            ...(chunks.length > 1 && { part: `${i + 1} of ${chunks.length}` }),
          });
          const ops = (data.ops || []).filter((op: any) => {
            if (op?.op !== 'paginate' || op.pageId) return true;
            if (Array.isArray(op.breaks)) breaks.push(...op.breaks);
            return false;
          });
          const result = applyOps(ops);
          applied += result.applied; skipped += result.skipped; unchanged += result.unchanged || 0;
          reply = data.reply || reply;
          if (data.truncated) cutShort++;
          done++;
        }
        if (breaks.length) {
          const result = applyOps([{ op: 'paginate', breaks }]);
          applied += result.applied; skipped += result.skipped;
        }
        if (stop.current) reply = `Stopped after part ${done}. ` + reply;
      }
    } catch (e: any) {
      failure = e?.message || 'Design chat failed.';
    }

    if (!done && failure) {
      setError(failure);
      setMessages(m => m.slice(0, -1));   // take back the question so it can be re-sent
      setDraft(request);
    } else {
      if (failure) setError(`Stopped early: ${failure} The changes made so far are kept.`);
      setMessages(m => [...m, {
        id: 'a' + Date.now(), role: 'assistant',
        text: reply || (applied ? 'Done.' : 'I could not find a change to make for that.'),
        ...(applied > 0 && { undoTo: before }),
        note: [
          applied ? `${applied} change${applied === 1 ? '' : 's'} applied${skipped ? `, ${skipped} skipped` : ''}`
            : skipped || unchanged ? 'Nothing changed in the document' + (unchanged ? ': it was already like that' : `: ${skipped} invalid change${skipped === 1 ? '' : 's'} skipped`) : '',
          cutShort ? `${cutShort} AI repl${cutShort === 1 ? 'y was' : 'ies were'} cut short; send the request again to finish the rest` : '',
        ].filter(Boolean).join(' · ') || undefined,
      }]);
    }
    setSending('');
  };

  const templates = (
    <div className="space-y-2.5">
      {GROUPS.map(group => (
        <div key={group}>
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">{group}</p>
          <div className="flex flex-wrap gap-1.5">
            {DESIGN_TEMPLATES.filter(t => t.group === group).map((t: DesignTemplate) => (
              <button key={t.label} type="button" disabled={!!sending} onClick={() => send(t.request, t.mode)} title={t.request}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-ink-2 bg-white/[0.04] border border-white/[0.08] hover:border-accent hover:text-ink text-left disabled:opacity-50">
                {t.label}{MODE_HINT[t.mode] && <span className="text-ink-3"> · {MODE_HINT[t.mode]}</span>}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-3 p-3" aria-live="polite">
        {messages.length === 0 && (
          <div>
            <p className="text-xs text-ink-3 mb-3">Pick a ready-made job or tell the AI what you want. It designs, labels elements, marks words and writes extra slides; your own wording stays the same unless you ask.</p>
            {templates}
          </div>
        )}
        {messages.map(m => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`max-w-[88%] rounded-xl px-3 py-2 text-xs leading-relaxed ${m.role === 'user' ? 'bg-accent text-on-accent' : 'bg-surface-2 border border-line text-ink'}`}>
              <p className="whitespace-pre-wrap">{m.text}</p>
              {m.note && <p className="mt-1 text-[10px] text-ink-3">{m.note}</p>}
              {m.undoTo && (
                <button type="button" onClick={() => { restore(m.undoTo!); setMessages(all => all.map(x => x.id === m.id ? { ...x, undoTo: undefined, note: 'Change undone' } : x)); }}
                  className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-accent-light hover:underline">
                  <Undo2 size={12} /> Undo this change
                </button>
              )}
            </div>
          </div>
        ))}
        {messages.length > 0 && showTemplates && <div className="pt-1">{templates}</div>}
        {sending && (
          <p className="flex items-center gap-2 text-xs text-ink-3">
            <Loader2 size={13} className="animate-spin" /> {sending}
            {sending.startsWith('Reading part') && (
              <button type="button" onClick={() => { stop.current = true; }} className="inline-flex items-center gap-1 text-[11px] font-bold text-ink-2 hover:text-ink"><Square size={10} /> Stop after this part</button>
            )}
          </p>
        )}
      </div>

      {error && <p role="alert" className="mx-3 mb-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-2.5 py-1.5">{error}</p>}

      <div className="border-t border-line p-3 space-y-2">
        {messages.length > 0 && (
          <button type="button" onClick={() => setShowTemplates(v => !v)} aria-expanded={showTemplates}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-accent-light hover:underline">
            <GraduationCap size={13} /> {showTemplates ? 'Hide ready-made jobs' : 'Ready-made jobs for teachers'}
          </button>
        )}
        <div className="seg seg-sm w-full" role="group" aria-label="What the AI reads for a typed message">
          <button type="button" className="seg-item flex-1" aria-pressed={scope === 'design'} onClick={() => setScope('design')}
            title="Whole document with shortened text. Cheapest. For colours, layout, slides, labelling elements.">Design</button>
          <button type="button" className="seg-item flex-1" aria-pressed={scope === 'text'} onClick={() => setScope('text')}
            title="Whole document with every word, sent in parts. Needed to bold, highlight, proofread or translate. Uses more tokens.">Full text</button>
          <button type="button" className="seg-item flex-1" aria-pressed={scope === 'page'} onClick={() => setScope('page')} disabled={!selectedPageId}
            title="Only the selected page, with its full text.">This page</button>
        </div>
        <ClaudeModelSelect value={model} onChange={setModel} />
        <form className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); send(draft); }}>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2} aria-label="Message to the design AI"
            placeholder="e.g. Sabhi H2 ko hara karo, definitions ko green highlight karo"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); } }}
            className="textarea flex-1 text-xs resize-none" />
          <button type="submit" disabled={!!sending || !draft.trim()} className="btn btn-primary btn-icon" aria-label="Send" title="Send">
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
          </button>
        </form>
        <p className="flex items-center gap-1 text-[10px] text-ink-3"><Sparkles size={11} /> Each AI message uses plan tokens. The Theme, Elements and Insert tabs are free.</p>
      </div>
    </div>
  );
};

export default DesignChat;
