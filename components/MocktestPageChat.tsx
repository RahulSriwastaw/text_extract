import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Send, X } from 'lucide-react';
import type { MockTestMcqItem } from '../types';
import { getAiSettings } from '../services/aiDbService';
import { apiFetch } from '../services/apiClient';
import { directModelFields, type DirectModel } from '../services/claudeModels';
import { extractWithStudyAiBridge, type AiProvider } from '../services/studyAiBridgeService';
import { safeParseAiJsonObject } from '../services/textCleanService';
import { htmlToPlainText } from '../services/htmlLatex';
import { pageChatContext, pageChatPrompt, reviewPageReply, type ChatPage, type PageMessage } from '../services/pageChat';

interface Props {
  page: ChatPage; items: MockTestMcqItem[]; history: PageMessage[]; engine: string;
  provider: AiProvider; model: DirectModel; setName: string; difficulty: string; busy: boolean;
  append: (message: PageMessage) => void; apply: (items: MockTestMcqItem[]) => void; close: () => void;
}

export function MocktestPageChat({ page, items, history, engine, provider, model, setName, difficulty, busy, append, apply, close }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState<{ result: ReturnType<typeof reviewPageReply>; snapshot: string }>();
  const stale = proposal && proposal.snapshot !== JSON.stringify(items);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => { controller.current?.abort(); element.close(); };
  }, []);
  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [history.length, sending, proposal]);

  async function send() {
    const request = draft.trim();
    if (!request || controller.current || busy || proposal) return;
    const active = new AbortController();
    controller.current = active;
    setSending(true);
    setError('');
    setDraft('');
    append({ role: 'user', text: request });
    try {
      const rows = pageChatContext(items);
      const source = page.rawTextContent || '';
      const recent = history.slice(-16);
      let data;
      if (engine === 'bridge') {
        const result = await extractWithStudyAiBridge({
          prompt: pageChatPrompt(page.pageNumber, rows, source, recent, request), provider,
          base64Image: page.imageUrl || undefined, mimeType: page.imageUrl.match(/^data:([^;]+)/)?.[1],
          responseFormat: 'text', continueChat: false, signal: active.signal,
        });
        data = safeParseAiJsonObject(result.rawText.replace(result.expectedMarker, '').trim());
      } else {
        const { apiKey } = await getAiSettings();
        const response = await apiFetch('/api/mocktest-page-chat', {
          method: 'POST', signal: active.signal,
          headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'x-user-key': apiKey.trim() } : {}) },
          body: JSON.stringify({ pageNumber: page.pageNumber, rows, source, history: recent, request,
            image: page.imageUrl || undefined, ...directModelFields(model) }),
        });
        data = await response.json().catch(() => ({}));
        if (!response.ok) throw Error(data.error || `Page chat failed (HTTP ${response.status}).`);
      }
      if (active.signal.aborted) return;
      const result = reviewPageReply(data, items, page, setName, difficulty);
      append({ role: 'assistant', text: result.reply });
      if (result.edits.length) setProposal({ result, snapshot: JSON.stringify(items) });
    } catch (err) {
      if (!active.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Could not read the page. Please retry.');
        setDraft(request);
      }
    } finally {
      controller.current = null;
      if (!active.signal.aborted) setSending(false);
    }
  }

  function finish(applyChanges: boolean) {
    if (applyChanges && proposal && !stale && !busy) {
      apply(proposal.result.next);
      append({ role: 'assistant', text: 'Changes applied to this page.' });
    } else {
      append({ role: 'assistant', text: 'Proposed changes discarded.' });
    }
    setProposal(undefined);
  }
  return <dialog ref={dialog} aria-labelledby="page-chat-title" onCancel={close}
    className="fixed inset-0 m-auto w-[min(96vw,58rem)] max-h-[90dvh] p-0 rounded-xl border border-line bg-surface text-ink shadow-2xl backdrop:bg-black/70">
    <div className="flex flex-col max-h-[88dvh]">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id="page-chat-title" className="font-semibold">Page {page.pageNumber} chat</h2>
        <button className="btn btn-ghost btn-icon" aria-label="Close page chat" onClick={close}><X /></button>
      </header>
      <div className="flex min-h-0">
        {(page.imageUrl || page.rawTextContent) && <aside className="hidden sm:block w-2/5 overflow-auto p-3 border-r border-line">
          {page.imageUrl ? <img src={page.imageUrl} alt={`Original page ${page.pageNumber}`} className="w-full" /> :
            <p className="whitespace-pre-wrap text-sm">{page.rawTextContent}</p>}
        </aside>}
        <div ref={transcript} className="flex-1 min-w-0 overflow-auto p-4 space-y-3 min-h-40 text-sm" aria-live="polite">
          {!history.length && <p className="text-ink-2">{page.imageUrl || page.rawTextContent
            ? 'Ask about the original page or describe a correction.' : 'Ask about the extracted questions. This saved page has no original scan.'}</p>}
          {history.map((message, i) => <div key={i} className="whitespace-pre-wrap break-words">
            <strong className="block text-xs text-ink-3">{message.role === 'user' ? 'You' : 'Assistant'}</strong>{message.text}
          </div>)}
          {sending && <p role="status" className="flex items-center gap-2"><Loader2 className="w-4 animate-spin" />Reading page {page.pageNumber}…</p>}
          {proposal && <div className="space-y-2">
            <h3 className="font-semibold">Review changes</h3>
            {proposal.result.edits.map(({ action, item, fields }) => <details key={item.id} className="panel p-2 text-xs">
              <summary className="cursor-pointer">{action} · {item.source_question_reference || `Q${item.question_r}`} · {htmlToPlainText(item.question_en || item.question_hi).slice(0, 75)}</summary>
              {fields.map(key => <p className="mt-2 break-words" key={key}><b>{key}</b> {htmlToPlainText(String(item[key] || '')) || '(empty)'}</p>)}
            </details>)}
            {stale && <p role="status">This page changed. Discard the proposal and ask again using the latest questions.</p>}
            <div className="flex gap-2"><button className="btn btn-primary btn-sm" disabled={busy || stale} onClick={() => finish(true)}>Apply changes</button>
              <button className="btn btn-secondary btn-sm" onClick={() => finish(false)}>Discard</button></div>
          </div>}
          {error && <p role="alert" className="text-red-400">{error}</p>}
        </div>
      </div>
      <form className="flex gap-2 p-3 border-t border-line" onSubmit={e => { e.preventDefault(); void send(); }}>
        <textarea autoFocus rows={2} className="input flex-1" aria-label="Message for this page" value={draft}
          placeholder="Jaise, Q2 aur Q3 scan se dekhkar add karo" onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        <button className="btn btn-primary self-end" disabled={sending || busy || !!proposal || !draft.trim()}><Send /> Send</button>
      </form>
    </div>
  </dialog>;
}
