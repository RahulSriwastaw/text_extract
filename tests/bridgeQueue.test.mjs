// Queue / retry / connection-state logic of services/studyAiBridgeService.ts, isolated from the DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { buildSync } from 'esbuild';

const serviceCode = buildSync({
  entryPoints: [fileURLToPath(new URL('../services/studyAiBridgeService.ts', import.meta.url))],
  bundle: true, write: false, format: 'iife', globalName: 'Bridge', platform: 'browser',
}).outputFiles[0].text;

// Real timers; the page stub swallows the module's mount-time PING.
function load() {
  const listeners = new Set();
  const posted = [];
  const window = {
    location: { origin: 'https://app.test' },
    addEventListener(type, fn) { if (type === 'message') listeners.add(fn); },
    removeEventListener(type, fn) { listeners.delete(fn); },
    postMessage(data) { posted.push(data); },
  };
  // Real timers, but unref'd so the service's bounded reconnect/heartbeat timers never keep the
  // test process alive. A hidden document also keeps the reconnect loop from pinging on its own.
  const unref = t => { t.unref?.(); return t; };
  const context = vm.createContext({ window, document: { visibilityState: 'hidden', addEventListener() {} },
    localStorage: { getItem() { return null; }, setItem() {} }, crypto: webcrypto,
    DOMException, AbortController, console, Date,
    setTimeout: (fn, ms) => unref(setTimeout(fn, ms)), clearTimeout,
    setInterval: (fn, ms) => unref(setInterval(fn, ms)), clearInterval });
  vm.runInContext(serviceCode, context);
  const emit = data => [...listeners].forEach(fn => fn({ source: window, origin: window.location.origin, data: { source: 'tf-study-ai-extension', ...data } }));
  const pong = (ok = true, extra = {}) => {
    const ping = posted.findLast(m => m.type === 'PING');
    emit({ type: 'PONG', requestId: ping.requestId, ok, protocolVersion: 2, ...extra });
  };
  return { api: context.Bridge, posted, emit, pong };
}
const tick = () => new Promise(r => setTimeout(r, 5));
const retryable = msg => Object.assign(new Error(msg), { retryable: true });
// Values built inside the VM have that realm's prototypes; compare them as plain data.
const plain = value => JSON.parse(JSON.stringify(value));

test('runBridgeQueue sends strictly in order, retries transient failures, never re-runs a finished item', async () => {
  const { api } = load();
  const calls = [];
  let flaky = 0;
  const results = await api.runBridgeQueue(['p1', 'p2', 'p3'], async (item, ctx) => {
    calls.push(`${item}#${ctx.attempt}`);
    if (item === 'p2' && flaky++ < 2) throw new api.BridgeError('Extension lost this request. Retry this page.', { retryable: true });
    return item.toUpperCase();
  }, { baseDelayMs: 1, pauseBetweenMs: 0 });
  assert.deepEqual(calls, ['p1#1', 'p2#1', 'p2#2', 'p2#3', 'p3#1']);
  assert.deepEqual(plain(results.map(r => [r.index, r.status, r.value, r.attempts])),
    [[0, 'done', 'P1', 1], [1, 'done', 'P2', 3], [2, 'done', 'P3', 1]]);
});

test('runBridgeQueue stops after retries are exhausted and reports every item exactly once', async () => {
  const { api } = load();
  const progress = [];
  const results = await api.runBridgeQueue([1, 2, 3], async item => {
    if (item === 2) throw retryable('Extraction timed out waiting for AI chat reply.');
    return item;
  }, { retries: 1, baseDelayMs: 1, pauseBetweenMs: 0, onProgress: p => progress.push(`${p.index}:${p.status}`) });
  assert.deepEqual(plain(results.map(r => r.status)), ['done', 'failed', 'skipped']);
  assert.equal(results[1].attempts, 2);
  assert.match(results[1].error.message, /timed out/);
  assert.deepEqual(plain(progress), ['0:running', '0:done', '1:running', '1:retrying', '1:failed', '2:skipped']);
  assert.equal(results.length, 3);
});

test('runBridgeQueue does not retry fatal errors or aborts, and continues when stopOnError is false', async () => {
  const { api } = load();
  let attempts = 0;
  const results = await api.runBridgeQueue(['a', 'b', 'c'], async item => {
    attempts++;
    if (item === 'a') throw new Error('Chat composer not found — login on this AI tab first.');
    if (item === 'b') throw new DOMException('Extraction stopped by user.', 'AbortError');
    return item;
  }, { baseDelayMs: 1, pauseBetweenMs: 0, stopOnError: false });
  // 'a' is fatal (no retry), 'b' is an abort (no retry, and it stops the queue), 'c' is skipped.
  assert.equal(attempts, 2);
  assert.deepEqual(plain(results.map(r => r.status)), ['failed', 'failed', 'skipped']);
});

test('an AbortSignal stops the queue between items and while paused', async () => {
  const { api } = load();
  const controller = new AbortController();
  const results = await api.runBridgeQueue([1, 2, 3], async item => {
    if (item === 1) controller.abort();
    return item;
  }, { signal: controller.signal, baseDelayMs: 1, pauseBetweenMs: 50 });
  assert.deepEqual(plain(results.map(r => r.status)), ['done', 'skipped', 'skipped']);

  const paused = new AbortController();
  let pausing = true;
  setTimeout(() => paused.abort(), 20);
  const pausedResults = await api.runBridgeQueue([1], async item => item, { signal: paused.signal, shouldPause: () => pausing });
  assert.deepEqual(plain(pausedResults.map(r => r.status)), ['skipped']);
  pausing = false;
});

test('withBridgeRetry backs off, passes the attempt number and surfaces the last error', async () => {
  const { api } = load();
  const retries = [];
  const value = await api.withBridgeRetry(async attempt => {
    if (attempt < 3) throw retryable('busy with another extraction');
    return 'ok on ' + attempt;
  }, { retries: 2, baseDelayMs: 2, onRetry: info => retries.push([info.attempt, info.delayMs]) });
  assert.equal(value, 'ok on 3');
  assert.deepEqual(retries, [[1, 2], [2, 4]]);
  await assert.rejects(api.withBridgeRetry(async () => { throw retryable('Retry this page'); }, { retries: 1, baseDelayMs: 1 }), /Retry this page/);
  await assert.rejects(api.withBridgeRetry(async () => { throw new Error('Reply too large for bridge relay'); }, { retries: 3, baseDelayMs: 1 }), /too large/);
});

test('isRetryableBridgeError classifies extension failures', () => {
  const { api } = load();
  for (const msg of ['AI tab reloaded or disconnected. Retry this page.', 'Connection setup was interrupted. Retry this page.',
    'Extraction deadline reached. Check the AI tab, then retry this page.', 'Could not attach the page image after 3 attempts.']) {
    assert.equal(api.isRetryableBridgeError(new Error(msg)), true, msg);
  }
  for (const msg of ['Reply too large for bridge relay', 'Chat composer not found — login on this AI tab first.',
    'Page 3: No MCQs could be extracted.', 'Reload TextExtract Pro Bridge 2.5 in chrome://extensions, then refresh this page.']) {
    assert.equal(api.isRetryableBridgeError(new Error(msg)), false, msg);
  }
  assert.equal(api.isRetryableBridgeError(new DOMException('stopped', 'AbortError')), false);
  assert.equal(api.isRetryableBridgeError(new api.BridgeError('x', { retryable: true })), true);
});

test('connection states: connecting → connected → heartbeat loss → disconnected; reload error is surfaced', async () => {
  const a = load();
  const states = [];
  a.api.subscribeToExtensionStatus(s => states.push(s.state));
  const ping = a.api.pingStudyAiExtension(200);
  assert.equal(a.api.getBridgeStatus().state, 'connecting');
  a.pong();
  assert.equal((await ping).state, 'connected');
  // Extension reloaded: the orphaned content script answers with an error → 'error', not 'disconnected'.
  const again = a.api.pingStudyAiExtension(200);
  a.pong(false, { error: 'Extension reloaded. Refresh this page to reconnect.' });
  const status = await again;
  assert.equal(status.state, 'error');
  assert.match(status.error, /reloaded/);
  // No answer at all → 'disconnected' with a reconnect attempt counter.
  const silent = a.api.pingStudyAiExtension(30);
  assert.equal((await silent).state, 'disconnected');
  assert.ok(states.includes('connecting') && states.includes('connected') && states.includes('error'));
});

test('disconnect is idempotent and blocks automatic reconnects until connect is called', async () => {
  const a = load();
  const ping = a.api.pingStudyAiExtension(200); a.pong(); await ping;
  const pingsBefore = a.posted.filter(m => m.type === 'PING').length;
  await a.api.disconnectStudyAiBridge();
  await a.api.disconnectStudyAiBridge();
  const st = a.api.getBridgeStatus();
  assert.equal(st.connected, false);
  assert.equal(st.state, 'disconnected');
  assert.equal(st.manual, true);
  assert.equal(a.posted.filter(m => m.type === 'RESET_SESSION').length, 1);
  // Automatic/plain pings are suppressed while manually disconnected.
  const suppressed = await a.api.pingStudyAiExtension(50);
  assert.equal(suppressed.manual, true);
  assert.equal(a.posted.filter(m => m.type === 'PING').length, pingsBefore);
  a.emit({ type: 'BRIDGE_READY' });
  await tick();
  assert.equal(a.posted.filter(m => m.type === 'PING').length, pingsBefore);
  await assert.rejects(a.api.extractWithStudyAiBridge({ prompt: 'x' }), /disconnected/i);
  // Double-click Connect: both calls share one PING and both resolve connected.
  const c1 = a.api.connectStudyAiBridge(200);
  const c2 = a.api.connectStudyAiBridge(200);
  assert.equal(a.posted.filter(m => m.type === 'PING').length, pingsBefore + 1);
  a.pong();
  assert.equal((await c1).connected, true);
  assert.equal((await c2).connected, true);
  assert.equal(a.api.getBridgeStatus().manual, false);
});

test('an accepted request completes normally; its acceptance keeps the fast-fail guard quiet', async () => {
  const a = load();
  const p = a.api.pingStudyAiExtension(200); a.pong(); await p;
  const promise = a.api.extractWithStudyAiBridge({ prompt: 'Extract', timeoutMs: 60000 });
  await tick(); a.pong(); await tick();
  const first = a.posted.filter(m => m.type === 'EXTRACT_REQUEST');
  assert.equal(first.length, 1);
  // Acceptance arrives → the request stays alive past the accept deadline.
  a.emit({ type: 'STUDY_AI_ACCEPTED', requestId: first[0].requestId, status: 'queued' });
  a.emit({ type: 'STUDY_AI_RESULT', requestId: first[0].requestId, ok: true, text: '[{"content":"ok"}]' });
  assert.equal((await promise).elements[0].content, 'ok');
});
