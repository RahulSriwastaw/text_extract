/* Page <-> extension transport. A connection is healthy only after a worker PONG. */
(function () {
  if (window.__studyAiAdminV2) return;
  window.__studyAiAdminV2 = true;
  const PAGE = 'tf-study-ai';
  const EXT = 'tf-study-ai-extension';
  const VERSION = '2.5.15';
  const post = payload => window.postMessage({ ...payload, source: EXT }, window.location.origin);
  // The DOM is shared with the page (isolated worlds share the document), so the app can tell
  // "extension not injected here" apart from "extension injected but its worker is silent".
  const mark = () => { try { document.documentElement.setAttribute('data-tf-bridge', VERSION); } catch {} };
  mark();
  // After the extension is reloaded this script is orphaned: chrome.runtime.id disappears and the
  // worker re-injects a fresh copy next to it. The orphan must not win the race with its error
  // PONG, so it answers late; the page keeps the first PONG for a request and ignores the rest.
  const orphaned = () => !chrome.runtime?.id;
  const routes = {
    PING: 'STUDY_AI_PING', SET_PROVIDER: 'STUDY_AI_SET_PROVIDER',
    EXTRACT_REQUEST: 'STUDY_AI_START', CAPTURE_REQUEST: 'STUDY_AI_CAPTURE_START',
    CANCEL_REQUEST: 'STUDY_AI_CANCEL', REQUEST_STATUS: 'STUDY_AI_REQUEST_STATUS',
    RESULT_ACK: 'STUDY_AI_RESULT_ACK', RESET_SESSION: 'STUDY_AI_RESET_SESSION',
  };
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== PAGE) return;
    const data = event.data;
    const type = routes[data.type];
    if (!type) return;
    const receive = (res, error) => {
      if (data.type === 'PING' || data.type === 'SET_PROVIDER') {
        post({ ...res, type: 'PONG', requestId: data.requestId, ok: !error && !!res?.ok, error });
      } else if (data.type === 'RESET_SESSION') {
        post({ type: 'SESSION_RESET', requestId: data.requestId, ok: !error && !!res?.ok, error });
      } else if (data.type === 'REQUEST_STATUS') {
        if (res?.result) post(res.result);
        else post({ ...res, type: 'STUDY_AI_STATUS', requestId: data.requestId, ok: !error && !!res?.ok, transportError: !!error, error: error || res?.error });
      } else if (data.type === 'EXTRACT_REQUEST' || data.type === 'CAPTURE_REQUEST') {
        // A transport error is ambiguous: status polling recovers an accepted job.
        if (error) post({ type: 'STUDY_AI_PROGRESS', requestId: data.requestId, step: 'reconnecting', detail: error });
        else if (!res?.ok) post({ type: 'STUDY_AI_RESULT', requestId: data.requestId, ok: false, error: res?.error || 'Extension failed to start job.' });
        else post({ type: 'STUDY_AI_ACCEPTED', requestId: data.requestId, status: res.status });
      }
    };
    if (orphaned()) {
      // A live copy (re-injected by the worker) answers first; this only fires when none exists.
      setTimeout(() => receive(null, 'Extension was reloaded. Refresh this page (F5) to reconnect.'), 1500);
      return;
    }
    try {
      chrome.runtime.sendMessage({ ...data, type }, res => {
        const error = chrome.runtime.lastError?.message;
        // "Receiving end does not exist" means the service worker failed to start (see the
        // extension's Errors button in chrome://extensions), not a transport glitch.
        receive(res, error && /receiving end|could not establish/i.test(error)
          ? 'Extension service worker is not responding. Open chrome://extensions, click Errors / Reload on TextExtract Pro Bridge, then refresh this page.'
          : error);
      });
    } catch (error) { receive(null, error.message); }
  });
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
      if (msg?.type === 'STUDY_AI_RESULT' || msg?.type === 'STUDY_AI_PROGRESS') {
        post(msg);
        respond({ ok: true });
      }
    });
  } catch {}
  post({ type: 'BRIDGE_READY', version: VERSION });
})();
