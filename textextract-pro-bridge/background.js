/* TextExtract Pro Bridge 2.5: durable, owner-scoped request queue. */
const EXT_VERSION = '2.5.1';
const PROVIDERS = {
  gemini: { home: 'https://gemini.google.com/app', hosts: ['gemini.google.com'], script: 'content-gemini.js' },
  deepseek: { home: 'https://chat.deepseek.com/', hosts: ['chat.deepseek.com'], script: 'content-bridge-generic.js' },
  chatgpt: { home: 'https://chatgpt.com/', hosts: ['chatgpt.com', 'chat.openai.com'], script: 'content-bridge-generic.js' },
  claude: { home: 'https://claude.ai/new', hosts: ['claude.ai'], script: 'content-bridge-generic.js' },
};
const PREFIX = 'study_ai_v2_job_';
const SESSIONS_KEY = 'study_ai_v2_sessions';
const jobs = new Map();
const sessions = {};
const launching = new Set();
const terminal = job => ['completed', 'failed', 'cancelled'].includes(job.status);
const sessionKey = (tabId, provider) => tabId + ':' + provider;
const ready = (async () => {
  const data = await chrome.storage.session.get(null);
  Object.assign(sessions, data[SESSIONS_KEY] || {});
  for (const [key, job] of Object.entries(data)) {
    if (key.startsWith(PREFIX)) jobs.set(job.requestId, job);
  }
})();

function validUrl(provider, value) {
  try { const u = new URL(value); return u.protocol === 'https:' && PROVIDERS[provider].hosts.includes(u.hostname); }
  catch { return false; }
}
async function save(job) {
  jobs.set(job.requestId, job);
  await chrome.storage.session.set({ [PREFIX + job.requestId]: job });
}
async function saveSessions() { await chrome.storage.session.set({ [SESSIONS_KEY]: sessions }); }
async function tabMessage(tabId, payload) { return chrome.tabs.sendMessage(tabId, payload); }
async function relay(job, payload) {
  // Results belong only to the requesting app tab; never broadcast document content.
  try { await tabMessage(job.adminTabId, payload); } catch { /* App polls durable status after reconnect. */ }
}
async function finish(job, payload) {
  if (terminal(job)) return;
  const previousStatus = job.status;
  job.status = payload.ok ? 'completed' : 'failed';
  job.finishedAt = Date.now();
  const result = { ...payload, type: 'STUDY_AI_RESULT', requestId: job.requestId, chatUrl: payload.chatUrl || job.chatUrl };
  // Persist output before delivery so a lost acknowledgement cannot lose extraction.
  try {
    await chrome.storage.local.set({ ['result_' + job.requestId]: result });
    await save(job);
  } catch (error) { job.status = previousStatus; delete job.finishedAt; throw error; }
  await chrome.storage.local.remove('img_' + job.requestId);
  await relay(job, result);
  void pump();
}
async function resultFor(job) {
  return (await chrome.storage.local.get('result_' + job.requestId))['result_' + job.requestId];
}
async function maintain() {
  for (const job of jobs.values()) {
    if (!terminal(job) && Date.now() > job.deadline) {
      if (job.bridgeTabId) await tabMessage(job.bridgeTabId, { type: 'STUDY_AI_CANCEL', requestId: job.requestId }).catch(() => {});
      await finish(job, { ok: false, error: 'Extraction deadline reached. Check the AI tab, then retry this page.' });
    }
    if (terminal(job) && Date.now() - job.finishedAt > 10 * 60 * 1000) {
      jobs.delete(job.requestId);
      await chrome.storage.session.remove(PREFIX + job.requestId);
      await chrome.storage.local.remove(['img_' + job.requestId, 'result_' + job.requestId]);
    }
  }
}
async function pump() {
  await ready;
  for (const provider of Object.keys(PROVIDERS)) {
    if (launching.has(provider)) continue;
    if ([...jobs.values()].some(j => j.provider === provider && ['starting', 'running'].includes(j.status))) continue;
    const job = [...jobs.values()].find(j => j.provider === provider && j.status === 'queued');
    if (!job) continue;
    launching.add(provider);
    job.status = 'starting';
    void launch(job).catch(error => finish(job, { ok: false, error: error.message }))
      .finally(() => { launching.delete(provider); void pump(); });
  }
}
function assertActive(job) {
  if (terminal(job) || Date.now() > job.deadline) throw new Error('Extraction cancelled or expired.');
}
async function launch(job) {
  await save(job);
  assertActive(job);
  const provider = PROVIDERS[job.provider];
  const key = sessionKey(job.adminTabId, job.provider);
  const previous = sessions[key];
  let tab = previous?.tabId ? await chrome.tabs.get(previous.tabId).catch(() => null) : null;
  if (tab && !validUrl(job.provider, tab.url)) tab = null;
  const preferredUrl = job.continueChat ? (job.chatUrl || previous?.chatUrl) : null;
  if (preferredUrl && !validUrl(job.provider, preferredUrl)) throw new Error('Chat URL does not match the selected AI provider.');
  // Reuse this app's tab whenever it is alive: a fresh chat is a navigation to the provider
  // home inside the same tab, never a new tab piling up on every rotation.
  const urlBeforeNavigation = tab?.url || null;
  // A fresh chat is the provider home; a continuation is its own chat URL. Navigating only when
  // the tab is somewhere else keeps rotation from reloading a tab that is already correct.
  const targetUrl = job.continueChat ? (preferredUrl || null) : provider.home;
  let navigating = false;
  if (!tab) {
    tab = await chrome.tabs.create({ url: preferredUrl || provider.home, active: !job.silent });
  } else if (targetUrl && tab.url !== targetUrl) {
    tab = await chrome.tabs.update(tab.id, { url: targetUrl, active: !job.silent });
    navigating = true;
  }
  job.bridgeTabId = tab.id;
  // After a navigation the tab still reports its previous URL, so a fresh chat must not inherit
  // the old thread here — the adapter reports the real chat URL once the page settles.
  job.chatUrl = job.continueChat ? (tab.url || preferredUrl || provider.home) : provider.home;
  sessions[key] = { tabId: tab.id, chatUrl: job.chatUrl, provider: job.provider, batch: job.continueChat ? (previous?.batch || 0) + 1 : 1 };
  await saveSessions();
  await save(job);
  assertActive(job);
  await relay(job, { type: 'STUDY_AI_PROGRESS', requestId: job.requestId, step: 'connecting', detail: 'Connecting to AI chat...', chatUrl: job.chatUrl });
  const loadDeadline = Math.min(job.deadline, Date.now() + 90000);
  // A reused tab still reports the old document as 'complete' until the navigation commits,
  // so hold until it actually leaves the previous URL before injecting the adapter.
  const navigationGrace = Date.now() + 15000;
  while (true) {
    assertActive(job);
    const current = await chrome.tabs.get(tab.id);
    const left = !navigating || current.url !== urlBeforeNavigation || Date.now() > navigationGrace;
    if (current.status === 'complete' && left) break;
    if (Date.now() > loadDeadline) throw new Error('AI tab load timed out. Check your connection.');
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assertActive(job);
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['bridge-runtime.js', provider.script] });
  assertActive(job);
  // Allow a cancelled adapter to unwind before assigning its composer again.
  for (let attempt = 0; attempt < 20; attempt++) {
    const status = await tabMessage(tab.id, { type: 'STUDY_AI_TAB_STATUS', requestId: job.requestId });
    if (!status?.activeRequestId || status.activeRequestId === job.requestId) break;
    await new Promise(resolve => setTimeout(resolve, 250));
    assertActive(job);
  }
  job.status = 'running';
  job.lastHeartbeatAt = Date.now();
  await save(job);
  const image = (await chrome.storage.local.get('img_' + job.requestId))['img_' + job.requestId];
  let response;
  try { response = await tabMessage(tab.id, {
    type: job.capture ? 'STUDY_AI_CAPTURE' : 'STUDY_AI_RUN',
    requestId: job.requestId, adminTabId: job.adminTabId,
    expectedMarker: job.expectedMarker, fullChat: job.fullChat,
    jobLite: { ...job, fileBase64: image || null },
  }); } catch (error) {
    // Delivery can succeed even when its ACK is lost. Inspect, never resubmit the prompt.
    const status = await tabMessage(tab.id, { type: 'STUDY_AI_TAB_STATUS', requestId: job.requestId }).catch(() => null);
    if (status?.activeRequestId === job.requestId || status?.finished) return;
    throw error;
  }
  if (!response?.ok) throw new Error(response?.error || 'AI chat adapter did not acknowledge the request.');
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'study-ai-keepalive') return;
  port.onDisconnect.addListener(() => { void chrome.runtime.lastError; });
  port.postMessage({ type: 'HELLO', version: EXT_VERSION });
});
chrome.tabs.onRemoved.addListener(tabId => {
  void ready.then(async () => {
    for (const job of jobs.values()) {
      if (terminal(job)) continue;
      if (job.bridgeTabId === tabId || job.adminTabId === tabId) {
        if (job.adminTabId === tabId && job.bridgeTabId) await tabMessage(job.bridgeTabId, { type: 'STUDY_AI_CANCEL', requestId: job.requestId }).catch(() => {});
        await finish(job, { ok: false, error: 'Extraction tab was closed.' });
      }
    }
    for (const [key, value] of Object.entries(sessions)) {
      if (key.startsWith(tabId + ':') || value.tabId === tabId) delete sessions[key];
    }
    await saveSessions();
  }).catch(console.warn);
});

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg?.type?.startsWith('STUDY_AI_')) return;
  ready.then(() => handle(msg, sender)).then(respond, error => respond({ ok: false, error: error.message }));
  return true;
});
async function handle(msg, sender) {
  const adminTabId = sender.tab?.id;
  const job = jobs.get(msg.requestId);
  const owner = job && job.adminTabId === adminTabId;
  const adapter = job && job.bridgeTabId === adminTabId;
  switch (msg.type) {
    case 'STUDY_AI_PING': {
      await maintain();
      void pump();
      const openProviders = [];
      for (const [id, p] of Object.entries(PROVIDERS)) {
        if ((await chrome.tabs.query({ url: p.hosts.map(h => 'https://' + h + '/*') })).length) openProviders.push(id);
      }
      const provider = Object.hasOwn(PROVIDERS, msg.provider) ? msg.provider : 'gemini';
      return { ok: true, version: EXT_VERSION, protocolVersion: 2, openProviders,
        session: { ...sessions[sessionKey(adminTabId, provider)], provider,
          openJobs: [...jobs.values()].filter(j => j.adminTabId === adminTabId && !terminal(j)).length } };
    }
    case 'STUDY_AI_SET_PROVIDER':
      if (!Object.hasOwn(PROVIDERS, msg.provider)) throw new Error('Unknown AI provider.');
      return handle({ type: 'STUDY_AI_PING', provider: msg.provider }, sender);
    case 'STUDY_AI_START':
    case 'STUDY_AI_CAPTURE_START': {
      if (!adminTabId || !msg.requestId) throw new Error('Request ID and app tab are required.');
      if (job) {
        if (!owner) throw new Error('Request belongs to another tab.');
        if (terminal(job)) { const result = await resultFor(job); if (result) await relay(job, result); }
        return { ok: true, requestId: job.requestId, status: job.status };
      }
      if (!Object.hasOwn(PROVIDERS, msg.provider)) throw new Error('Unknown AI provider.');
      if (msg.type === 'STUDY_AI_START' && !msg.prompt?.trim()) throw new Error('Extraction prompt is empty.');
      const { fileBase64, ...input } = msg;
      const queued = { ...input, capture: msg.type === 'STUDY_AI_CAPTURE_START',
        continueChat: msg.type === 'STUDY_AI_CAPTURE_START' || !!msg.continueChat, adminTabId,
        createdAt: Date.now(), deadline: Date.now() + Math.min(Math.max(Number(msg.timeoutMs) || 300000, 1000), 900000), status: 'saving' };
      // Reserve ID before asynchronous storage writes (duplicate STARTs share one job).
      jobs.set(queued.requestId, queued);
      try {
        if (fileBase64) await chrome.storage.local.set({ ['img_' + msg.requestId]: fileBase64 });
        if (terminal(queued)) { await chrome.storage.local.remove('img_' + msg.requestId); return { ok: true, status: queued.status }; }
        queued.status = 'queued';
        await save(queued);
      } catch (error) { jobs.delete(queued.requestId); await chrome.storage.local.remove('img_' + msg.requestId); throw error; }
      await relay(queued, { type: 'STUDY_AI_PROGRESS', requestId: msg.requestId, step: 'queued', detail: 'Page queued for ' + msg.provider.toUpperCase() });
      void pump();
      return { ok: true, requestId: msg.requestId, status: 'queued' };
    }
    case 'STUDY_AI_REQUEST_STATUS': {
      if (!owner) return { ok: false, error: 'Request not found.' };
      await maintain();
      if (terminal(job)) return { ok: true, status: job.status, result: await resultFor(job) };
      if (job.status === 'starting' && !launching.has(job.provider)) {
        await finish(job, { ok: false, error: 'Connection setup was interrupted. Retry this page.' });
      } else if (job.status === 'running' && Date.now() - job.lastHeartbeatAt > 30000) {
        const status = await tabMessage(job.bridgeTabId, { type: 'STUDY_AI_TAB_STATUS', requestId: job.requestId }).catch(() => null);
        if (status?.finished) {
          await tabMessage(job.bridgeTabId, { type: job.capture ? 'STUDY_AI_CAPTURE' : 'STUDY_AI_RUN', requestId: job.requestId });
        } else if (status?.activeRequestId !== job.requestId) {
          await finish(job, { ok: false, error: 'AI tab reloaded or disconnected. Retry this page or capture its reply.' });
        }
      }
      void pump();
      return { ok: true, status: job.status, result: terminal(job) ? await resultFor(job) : null,
        step: job.lastStep || job.status, detail: job.lastDetail, chatUrl: job.chatUrl };
    }
    case 'STUDY_AI_CANCEL':
      if (!owner || terminal(job)) return { ok: true };
      job.status = 'cancelled'; job.finishedAt = Date.now();
      await save(job);
      if (job.bridgeTabId) await tabMessage(job.bridgeTabId, { type: 'STUDY_AI_CANCEL', requestId: job.requestId }).catch(() => {});
      await chrome.storage.local.remove('img_' + job.requestId);
      void pump();
      return { ok: true };
    case 'STUDY_AI_RESULT_ACK':
      if (owner && terminal(job)) await chrome.storage.local.remove('result_' + job.requestId);
      return { ok: true };
    case 'STUDY_AI_GET_JOB': {
      if (!adapter) return { ok: false, job: null };
      const image = (await chrome.storage.local.get('img_' + job.requestId))['img_' + job.requestId];
      return { ok: true, job: { ...job, fileBase64: image || null } };
    }
    case 'STUDY_AI_PROGRESS':
    case 'STUDY_AI_HEARTBEAT':
      if (adapter && !terminal(job)) {
        job.lastHeartbeatAt = Date.now();
        if (msg.step && msg.step !== 'heartbeat') { job.lastStep = msg.step; job.lastDetail = msg.detail; }
        if (validUrl(job.provider, msg.chatUrl)) {
          job.chatUrl = msg.chatUrl;
          const key = sessionKey(job.adminTabId, job.provider);
          if (sessions[key]?.tabId === job.bridgeTabId) { sessions[key].chatUrl = msg.chatUrl; await saveSessions(); }
        }
        await save(job);
        if (msg.type === 'STUDY_AI_PROGRESS' && msg.step !== 'heartbeat') await relay(job, { ...msg, chatUrl: job.chatUrl });
      }
      return { ok: true };
    case 'STUDY_AI_RESULT':
      if (adapter) await finish(job, msg);
      return { ok: true };
    case 'STUDY_AI_RESET_SESSION':
      for (const key of Object.keys(sessions)) if (key.startsWith(adminTabId + ':')) delete sessions[key];
      await saveSessions();
      return { ok: true };
    default: return { ok: false, error: 'Unknown bridge message.' };
  }
}
