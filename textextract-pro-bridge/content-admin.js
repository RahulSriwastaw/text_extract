/* Page <-> extension transport. A connection is healthy only after a worker PONG. */
(function () {
  if (window.__studyAiAdminV2) return;
  window.__studyAiAdminV2 = true;
  const PAGE = 'tf-study-ai';
  const EXT = 'tf-study-ai-extension';
  const post = payload => window.postMessage({ ...payload, source: EXT }, window.location.origin);
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
    try {
      if (!chrome.runtime?.id) throw new Error('Extension reloaded. Refresh this page to reconnect.');
      chrome.runtime.sendMessage({ ...data, type }, res => receive(res, chrome.runtime.lastError?.message));
    } catch (error) { receive(null, error.message); }
  });
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg?.type === 'STUDY_AI_RESULT' || msg?.type === 'STUDY_AI_PROGRESS') {
      post(msg);
      respond({ ok: true });
    }
  });
  post({ type: 'BRIDGE_READY' });
})();
