/* Shared request lifecycle for all AI chat adapters. */
(function () {
  if (window.__studyAiRuntime) return;
  let active = null;
  const finished = new Map();
  const abortError = () => new DOMException('Extraction stopped by user.', 'AbortError');
  // Repair formatting only. Never add missing quotes/brackets or salvage a partial array.
  function repairJsonFormatting(input) {
    let out = '';
    let inString = false;
    for (let i = 0; i < input.length; i++) {
      const c = input[i];
      if (c === '"') { inString = !inString; out += c; continue; }
      if (inString) {
        if (c === '\\') {
          const next = input[i + 1] || '';
          const valid = /["\\/bfnrt]/.test(next) && next.length === 1
            || next === 'u' && /^[0-9a-f]{4}$/i.test(input.slice(i + 2, i + 6));
          if (valid) { out += c + next; i++; }
          else out += '\\\\';
        } else if (c.charCodeAt(0) < 32) out += JSON.stringify(c).slice(1, -1);
        else out += c;
      } else {
        const citation = input.slice(i).match(/^\[cite(?:_start|_end|:\s*[\d,\s]+)\]/i);
        if (c === '[' && citation) { i += citation[0].length - 1; continue; }
        if (c === ',' && /^\s*[\]}]/.test(input.slice(i + 1))) continue;
        out += c;
      }
    }
    return out;
  }
  // A page may legitimately open with the tail of a question split across pages:
  // only its remaining options, answer or solution are present, with no stem.
  const MCQ_FIELDS = ['content', 'text', 'type', 'question', 'question_hi', 'question_en', 'question_r',
    'option1_hi', 'option1_en', 'option2_hi', 'option2_en', 'option3_hi', 'option3_en', 'option4_hi', 'option4_en',
    'answer', 'solution', 'solution_hi', 'solution_en', 'explanation'];
  function isMcqItem(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    return MCQ_FIELDS.some(key => {
      const value = item[key];
      return typeof value === 'number' || typeof value === 'string' && value.trim() !== '';
    });
  }
  const runtime = {
    // Scope code extraction to the already selected assistant turn. textContent on
    // code preserves escapes/newlines without toolbar labels or rendered line wrapping.
    readReply(node) {
      const visible = (node?.innerText || node?.textContent || '').trim();
      if (!node?.querySelectorAll) return visible;
      const blocks = [...node.querySelectorAll('pre, code-block')];
      const outer = blocks.filter(block => !blocks.some(other => other !== block && other.contains(block)));
      if (!outer.length) return visible;
      const chunks = outer.map(block => {
        const code = block.querySelector('code') || block.querySelector('pre');
        if (code) return code.textContent || '';
        const copy = block.cloneNode(true);
        copy.querySelectorAll('button, [role="button"]').forEach(button => button.remove());
        return copy.textContent || '';
      });
      const markers = visible.split(/\r?\n/).filter(line => /^---STUDY_AI_COMPLETE[^\r\n]*---$/.test(line.trim()));
      return chunks.map(chunk => '```json\n' + chunk + '\n```').join('\n') + '\n' + markers.join('\n');
    },
    check() { if (active?.cancelled) throw abortError(); },
    async sleep(ms) {
      runtime.check();
      const signal = active?.controller.signal;
      await new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(abortError()); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
        signal?.addEventListener('abort', abort, { once: true });
      });
      runtime.check();
    },
    // One operation owns a composer. Repeated RUN messages never submit twice.
    run(msg, sendResponse, action, report) {
      if (finished.has(msg.requestId)) {
        sendResponse({ ok: true, started: true });
        report(...finished.get(msg.requestId));
        return;
      }
      if (active) {
        sendResponse(active.id === msg.requestId
          ? { ok: true, started: true }
          : { ok: false, error: 'AI chat is busy with another extraction.' });
        return;
      }
      active = { id: msg.requestId, cancelled: false, controller: new AbortController() };
      sendResponse({ ok: true, started: true });
      Promise.resolve().then(action).catch(error => {
        if (!active?.cancelled) report(msg.requestId, false, null, error.message, msg.adminTabId);
      }).finally(() => { active = null; });
    },
    remember(args) {
      if (active?.cancelled) return false;
      finished.set(args[0], args);
      if (finished.size > 8) finished.delete(finished.keys().next().value);
      return true;
    },
    // Accept complete JSON only; never salvage the first few objects of a streaming array.
    completeJson(text) {
      const source = String(text || '').replace(/(?:^|\r?\n)[ \t]*---STUDY_AI_COMPLETE[^\r\n]*---[ \t]*(?=\r?\n|$)/g, '').trim();
      const fences = [...source.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
      if ((source.match(/```/g) || []).length !== fences.length * 2) return null;
      const candidates = fences.length ? fences.map(m => m[1].trim()) : [source];
      const items = [];
      for (const candidate of candidates) {
        try {
          let clean = candidate.replace(/^(?:(?:json|copy code|copy)\s*\n)+/i, '');
          let parsed;
          try { parsed = JSON.parse(clean); }
          catch {
            clean = repairJsonFormatting(clean);
            // Rendered code blocks may include toolbar labels or surrounding prose.
            // Include ALL JSON delimiters; never drop an unfinished second object/array.
            const start = clean.search(/[\[{]/);
            const end = Math.max(clean.lastIndexOf(']'), clean.lastIndexOf('}'));
            if (start < 0 || end < start || /[\[\]{}]/.test(clean.slice(end + 1))) return null;
            parsed = JSON.parse(clean.slice(start, end + 1));
          }
          const batch = Array.isArray(parsed) ? parsed
            : Array.isArray(parsed?.questions) ? parsed.questions
            : Array.isArray(parsed?.elements) ? parsed.elements : [parsed];
          if (!batch.every(isMcqItem)) return null;
          items.push(...batch);
        } catch { return null; }
      }
      return JSON.stringify(items);
    },
  };
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg?.type === 'STUDY_AI_CANCEL') {
      if (active?.id === msg.requestId) { active.cancelled = true; active.controller.abort(); }
      respond({ ok: true });
    }
    if (msg?.type === 'STUDY_AI_TAB_STATUS') {
      respond({ ok: true, activeRequestId: active?.id || null, finished: finished.has(msg.requestId) });
    }
  });
  window.__studyAiRuntime = runtime;
})();
