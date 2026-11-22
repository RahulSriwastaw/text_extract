import React, { useEffect, useRef, useState } from 'react';
import { Send, Sparkles, Undo2, Loader2 } from 'lucide-react';
import { apiFetch } from '../../services/apiClient';
import { directModelFields, defaultClaudeModel, type DirectModel } from '../../services/claudeModels';
import { ClaudeModelSelect } from '../ClaudeModelSelect';
import { DESIGN_SUGGESTIONS, type DesignChatTurn, type DesignChatResponse } from '../../services/designChat';
import { type DesignDoc, outlineForAi } from '../../services/designDoc';

export interface ChatMessage extends DesignChatTurn {
  id: string;
  /** Set on assistant messages that changed the document: lets the user undo exactly that change. */
  undoTo?: DesignDoc;
  note?: string;
}

interface Props {
  doc: DesignDoc;
  fill: Record<string, number>;
  selectedPageId?: string;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  /** Apply the AI's operations; returns how many were applied and skipped. */
  applyOps: (ops: unknown[]) => { applied: number; skipped: number };
  restore: (doc: DesignDoc) => void;
  /** Lets the canvas ask the chat to send a request (e.g. "split this slide"). */
  pending?: { request: string; pageId?: string; key: number };
}

const DesignChat: React.FC<Props> = ({ doc, fill, selectedPageId, messages, setMessages, applyOps, restore, pending }) => {
  const [draft, setDraft] = useState('');
  const [scope, setScope] = useState<'all' | 'page'>('all');
  const [model, setModel] = useState<DirectModel>(defaultClaudeModel);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const handled = useRef(0);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages, sending]);

  const send = async (request: string, pageId?: string) => {
    request = request.trim();
    if (!request || sending) return;
    setError('');
    setSending(true);
    setDraft('');
    const before = doc;
    const history = messages.map(({ role, text }) => ({ role, text }));
    setMessages(m => [...m, { id: 'u' + Date.now(), role: 'user', text: request }]);
    try {
      const scopePageId = pageId || (scope === 'page' ? selectedPageId : undefined);
      const response = await apiFetch('/api/design-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outline: outlineForAi(doc, scopePageId, fill), theme: doc.theme, layout: doc.layout,
          history: history.slice(-12), request, scopePageId, ...directModelFields(model),
        }),
      });
      const data: DesignChatResponse & { error?: string } = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
      const { applied, skipped } = applyOps(data.ops || []);
      setMessages(m => [...m, {
        id: 'a' + Date.now(), role: 'assistant',
        text: data.reply || (applied ? 'Done.' : 'I could not find a change to make for that.'),
        ...(applied > 0 && { undoTo: before }),
        note: applied ? `${applied} change${applied === 1 ? '' : 's'} applied${skipped ? `, ${skipped} skipped` : ''}` : skipped ? `${skipped} invalid change${skipped === 1 ? '' : 's'} skipped` : undefined,
      }]);
    } catch (e: any) {
      setError(e?.message || 'Design chat failed.');
      setMessages(m => m.slice(0, -1));   // take back the question so it can be re-sent
      setDraft(request);
    } finally {
      setSending(false);
    }
  };

  // A request raised from the canvas (split an overflowing slide)
  useEffect(() => {
    if (pending && pending.key !== handled.current) { handled.current = pending.key; send(pending.request, pending.pageId); }
  }, [pending]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-3 p-3" aria-live="polite">
        {messages.length === 0 && (
          <div>
            <p className="text-xs text-ink-3 mb-2">Tell the AI how the document should look. It changes the design and layout; your text stays the same unless you ask.</p>
            <div className="flex flex-wrap gap-1.5">
              {DESIGN_SUGGESTIONS.map(s => (
                <button key={s} type="button" disabled={sending} onClick={() => send(s)}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-ink-2 bg-white/[0.04] border border-white/[0.08] hover:border-accent hover:text-ink text-left">
                  {s}
                </button>
              ))}
            </div>
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
        {sending && <p className="flex items-center gap-2 text-xs text-ink-3"><Loader2 size={13} className="animate-spin" /> Designing…</p>}
      </div>

      {error && <p role="alert" className="mx-3 mb-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-2.5 py-1.5">{error}</p>}

      <div className="border-t border-line p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="seg seg-sm" role="group" aria-label="What the AI can see">
            <button type="button" className="seg-item" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>Whole document</button>
            <button type="button" className="seg-item" aria-pressed={scope === 'page'} onClick={() => setScope('page')} disabled={!selectedPageId}
              title="Sends only the selected page: fewer tokens, and the AI sees its full text">This page only</button>
          </div>
          <ClaudeModelSelect value={model} onChange={setModel} />
        </div>
        <form className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); send(draft); }}>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2} aria-label="Message to the design AI"
            placeholder="e.g. Questions ko neele box me rakho, headings bade karo"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); } }}
            className="textarea flex-1 text-xs resize-none" />
          <button type="submit" disabled={sending || !draft.trim()} className="btn btn-primary btn-icon" aria-label="Send" title="Send">
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
          </button>
        </form>
        <p className="flex items-center gap-1 text-[10px] text-ink-3"><Sparkles size={11} /> Each message uses plan tokens. Themes and manual edits are free.</p>
      </div>
    </div>
  );
};

export default DesignChat;
