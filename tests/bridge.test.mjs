import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { buildSync } from 'esbuild';

const read = name => fs.readFileSync(new URL('../textextract-pro-bridge/' + name, import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 15; i++) await new Promise(setImmediate); };
function storage(data = {}) {
  return { data,
    async get(key) { return structuredClone(key === null ? data : Object.fromEntries((Array.isArray(key) ? key : [key]).map(k => [k, data[k]]))); },
    async set(values) { Object.assign(data, structuredClone(values)); },
    async remove(keys) { for (const key of [keys].flat()) delete data[key]; },
  };
}
function worker(state = { session: storage(), local: storage(), tabs: new Map(), sent: [], nextId: 100 }) {
  let listener;
  const chrome = {
    storage: { session: state.session, local: state.local },
    runtime: { onMessage: { addListener(fn) { listener = fn; } }, onConnect: { addListener() {} } },
    scripting: { async executeScript() {} },
    tabs: {
      onRemoved: { addListener() {} }, async query() { return []; },
      async get(id) { if (!state.tabs.has(id)) throw new Error('Missing tab'); return state.tabs.get(id); },
      async create(input) { const tab = { ...input, id: state.nextId++, status: 'complete' }; state.tabs.set(tab.id, tab); return tab; },
      async update(id, input) { Object.assign(state.tabs.get(id), input); return state.tabs.get(id); },
      async sendMessage(id, msg) {
        state.sent.push({ id, msg });
        if (state.loseRunAck && msg.type === 'STUDY_AI_RUN') { state.activeRequestId = msg.requestId; throw new Error('ACK lost'); }
        if (state.failRelay && id < 100) throw new Error('App transport disconnected');
        return { ok: true, activeRequestId: state.activeRequestId || null };
      },
    },
  };
  vm.runInNewContext(read('background.js'), { chrome, URL, console, setTimeout, Date });
  return { state, send: (msg, tabId = 1) => new Promise(resolve => listener(msg, { tab: { id: tabId } }, resolve)) };
}
const start = (id, provider = 'gemini', extra = {}) => ({ type: 'STUDY_AI_START', requestId: id, provider, prompt: 'Extract this page', fileBase64: 'image', ...extra });
const runs = state => state.sent.filter(s => s.msg.type === 'STUDY_AI_RUN');

test('duplicate requests submit once; queued pages reuse the owning chat', async () => {
  const w = worker();
  await Promise.all([w.send(start('one')), w.send(start('one'))]);
  await w.send(start('two', 'gemini', { continueChat: true }));
  await flush();
  assert.equal(runs(w.state).length, 1);
  const tabId = runs(w.state)[0].id;
  await w.send({ type: 'STUDY_AI_PROGRESS', requestId: 'one', step: 'stream', chatUrl: 'https://gemini.google.com/app/chat-one' }, tabId);
  await w.send({ type: 'STUDY_AI_RESULT', requestId: 'one', ok: true, text: '[{"content":"Page one"}]' }, tabId);
  await flush();
  assert.equal(runs(w.state).length, 2);
  assert.equal(runs(w.state)[1].id, tabId);
  assert.equal(w.state.tabs.size, 1);
  assert.equal(w.state.local.data.img_one, undefined);
});

test('a fresh chat reuses the same tab instead of opening another one', async () => {
  const w = worker();
  await w.send(start('one'));
  await flush();
  const tabId = runs(w.state)[0].id;
  await w.send({ type: 'STUDY_AI_PROGRESS', requestId: 'one', step: 'stream', chatUrl: 'https://gemini.google.com/app/chat-one' }, tabId);
  await w.send({ type: 'STUDY_AI_RESULT', requestId: 'one', ok: true, text: '[{"content":"Page one"}]' }, tabId);
  await flush();
  // Rotation sends continueChat:false; it must navigate this tab home, not spawn a second tab.
  await w.send(start('rotated', 'gemini', { continueChat: false }));
  await flush();
  assert.equal(w.state.tabs.size, 1);
  assert.equal(runs(w.state)[1].id, tabId);
  assert.equal(w.state.tabs.get(tabId).url, 'https://gemini.google.com/app');
});

test('providers progress independently; app tabs cannot read or cancel each other', async () => {
  const w = worker();
  await w.send(start('gemini'));
  await w.send(start('claude', 'claude'), 2);
  await flush();
  assert.equal(runs(w.state).length, 2);
  assert.equal((await w.send({ type: 'STUDY_AI_REQUEST_STATUS', requestId: 'gemini' }, 2)).ok, false);
  await w.send({ type: 'STUDY_AI_CANCEL', requestId: 'gemini' }, 2);
  assert.equal((await w.send({ type: 'STUDY_AI_REQUEST_STATUS', requestId: 'gemini' })).status, 'running');
  await w.send({ type: 'STUDY_AI_RESULT', requestId: 'gemini', ok: true, text: 'spoofed' }, 2);
  assert.equal(w.state.local.data.result_gemini, undefined);
});

test('lost result delivery recovers after a service worker restart and clears on ACK', async () => {
  const w = worker();
  await w.send(start('recover'));
  await flush();
  w.state.failRelay = true;
  await w.send({ type: 'STUDY_AI_RESULT', requestId: 'recover', ok: true, text: '[{"content":"Recovered"}]' }, runs(w.state)[0].id);
  const restarted = worker(w.state);
  const res = await restarted.send({ type: 'STUDY_AI_REQUEST_STATUS', requestId: 'recover' });
  assert.equal(res.result.text, '[{"content":"Recovered"}]');
  await restarted.send({ type: 'STUDY_AI_RESULT_ACK', requestId: 'recover' });
  assert.equal(w.state.local.data.result_recover, undefined);
});

test('queued cancellation removes the image and never submits the cancelled page', async () => {
  const w = worker();
  await w.send(start('active'));
  await w.send(start('cancelled'));
  await w.send({ type: 'STUDY_AI_CANCEL', requestId: 'cancelled' });
  await flush();
  await w.send({ type: 'STUDY_AI_RESULT', requestId: 'active', ok: true, text: '[]' }, runs(w.state)[0].id);
  await flush();
  assert.equal(runs(w.state).length, 1);
  assert.equal(w.state.local.data.img_cancelled, undefined);
});

test('lost send acknowledgement does not resubmit an active request', async () => {
  const w = worker(); w.state.loseRunAck = true;
  await w.send(start('ack'));
  await flush();
  assert.equal(runs(w.state).length, 1);
  assert.equal((await w.send({ type: 'STUDY_AI_REQUEST_STATUS', requestId: 'ack' })).status, 'running');
});

test('cancelling while image storage is pending cannot resurrect the job', async () => {
  const w = worker();
  const set = w.state.local.set;
  let release;
  w.state.local.set = async values => {
    await new Promise(resolve => { release = resolve; });
    await set(values);
  };
  const pending = w.send(start('saving'));
  await flush();
  await w.send({ type: 'STUDY_AI_CANCEL', requestId: 'saving' });
  release(); await pending; await flush();
  assert.equal(runs(w.state).length, 0);
  assert.equal(w.state.local.data.img_saving, undefined);
});

test('restored queue waits for hydration and rejects interrupted startup explicitly', async () => {
  const w = worker();
  const job = { ...start('old'), adminTabId: 1, status: 'starting', deadline: Date.now() + 100000 };
  await w.state.session.set({ study_ai_v2_job_old: job });
  const restarted = worker(w.state);
  const result = await restarted.send({ type: 'STUDY_AI_REQUEST_STATUS', requestId: 'old' });
  assert.equal(result.status, 'failed');
  assert.match(result.result.error, /interrupted/);
});

test('invalid provider and mismatched conversation URL never submit', async () => {
  const w = worker();
  assert.equal((await w.send(start('bad', 'invalid'))).ok, false);
  await w.send(start('url', 'gemini', { continueChat: true, chatUrl: 'https://gemini.google.com.evil.test/app' }));
  await flush();
  assert.equal(runs(w.state).length, 0);
  assert.equal((await w.send({ type: 'STUDY_AI_REQUEST_STATUS', requestId: 'url' })).status, 'failed');
});

function runtime() {
  let listener;
  const window = {};
  vm.runInNewContext(read('bridge-runtime.js'), { window, DOMException, AbortController, setTimeout, clearTimeout,
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } } });
  return { api: window.__studyAiRuntime, cancel: id => listener({ type: 'STUDY_AI_CANCEL', requestId: id }, {}, () => {}) };
}
test('complete JSON accepts text, bilingual MCQs and blank pages, rejects partial arrays', () => {
  const { api } = runtime();
  // A page can open with the tail of a question split across pages: options/answer, no stem.
  for (const text of ['[{"content":"Hindi हिन्दी / math \\u221a"}]', '[{"question_hi":"प्रश्न"}]', '[]', '```json\n[{"content":"table"}]\n```\n---STUDY_AI_COMPLETE_req---',
    '[{"question_r":8,"option3_hi":"पूर्वी राजस्थान","answer":"D","continues_previous":true},{"question_hi":"प्रश्न"}]']) {
    assert.notEqual(api.completeJson(text), null);
  }
  assert.equal(api.completeJson('Here is the extraction:\nJSON\nCopy code\n[{"content":"A complete page"}]\nCopy'), '[{"content":"A complete page"}]');
  assert.equal(api.completeJson('[{"content":"literal ---STUDY_AI_COMPLETE_req---"}]'), '[{"content":"literal ---STUDY_AI_COMPLETE_req---"}]');
  assert.equal(api.completeJson('[{"content":"first"}]\n[{"content":"unfinished'), null);
  for (const text of ['[{"content":"first"}, {"content":"unfinished', '```json\n[{"content":"first"}]', '[{"content":"first"}], [{"content":"cut off"}', 'Sorry, unable to extract', '[null]', '[{"foo":1}]']) {
    assert.equal(api.completeJson(text), null, text);
  }
});
test('adapter deduplicates delivery, rejects composer overlap and aborts pending waits', async () => {
  const { api, cancel } = runtime();
  let executions = 0;
  const errors = [];
  const action = async () => { executions++; await api.sleep(60000); };
  api.run({ requestId: 'a' }, () => {}, action, (...args) => errors.push(args));
  api.run({ requestId: 'a' }, res => assert.equal(res.ok, true), action, () => {});
  api.run({ requestId: 'b' }, res => assert.equal(res.ok, false), action, () => {});
  await Promise.resolve();
  cancel('a');
  await flush();
  assert.equal(executions, 1);
  assert.equal(errors.length, 0);
  api.run({ requestId: 'b' }, res => assert.equal(res.ok, true), async () => {}, () => {});
  await flush();
});

for (const name of ['content-gemini.js', 'content-bridge-generic.js']) {
  test(name + ': waits for complete current-page JSON without fabricating markers', async () => {
    const { api } = runtime();
    let time = 0;
    const marker = '---STUDY_AI_COMPLETE_P2_req-new---';
    const window = { __studyAiRuntime: { ...api, async sleep(ms) { time += ms; } }, fakeText: '', fakeNodes: [], fakeGenerating: false };
    const nodeFunction = name === 'content-gemini.js' ? 'getModelResponseNodes' : 'getAssistantTurnNodes';
    const source = read(name).replace(/\}\)\(\);\s*$/, `
      ${nodeFunction} = () => window.fakeNodes;
      isGenerating = () => window.fakeGenerating;
      scrapeBestReply = () => window.fakeText;
      progress = () => {};
      window.testWait = waitForJsonReplyLive;
      window.testMarker = hasCompletionMarker;
    })();`);
    vm.runInNewContext(source, { window, console, Date: class extends Date { static now() { return time; } },
      chrome: { runtime: { connect: () => ({ onDisconnect: { addListener() {} } }), onMessage: { addListener() {} } } } });
    const setReply = text => { window.fakeText = text; window.fakeNodes = [{ innerText: text }]; };
    setReply('[{"content":"Page two"}]');
    const unmarked = await window.testWait(20000, 'id', '', 1, 0, marker);
    assert.equal(unmarked, '[{"content":"Page two"}]');
    assert.equal(window.testMarker('---STUDY_AI_COMPLETE_P1_old---', marker), false);
    setReply('[{"content":"Page two"}]\n' + marker);
    assert.match(await window.testWait(20000, 'id', '', 1, 5, marker), /req-new/); // Virtualized older turns.
    setReply('[{"content":"One"}, {"content":"Cut off');
    await assert.rejects(window.testWait(20000, 'id', '', 1, 0, marker), /could not be read/);
    // A finished reply the strict reader rejects (prose fence beside the JSON) is still recovered.
    setReply('```text\nnotes\n```\n```json\n[{"question_hi":"प्रश्न"}]\n```\n' + marker);
    const recovered = await window.testWait(20000, 'id', '', 1, 0, marker);
    assert.match(recovered, /question_hi/);
    assert.match(recovered, /req-new/);
    setReply('[{"content":"Old page"}]\n---STUDY_AI_COMPLETE_P1_old---');
    await assert.rejects(window.testWait(20000, 'id', '', 1, 0, marker), /Timed out/);
    setReply('A clear explanation in plain text.');
    assert.equal(await window.testWait(20000, 'id', '', 1, 0, marker, 'text'), window.fakeText);
    setReply('[{"content":"Still generating"}]\n' + marker);
    window.fakeGenerating = true;
    await assert.rejects(window.testWait(20000, 'id', '', 1, 0, marker), /Timed out/);
  });
}

const serviceCode = buildSync({ entryPoints: [fileURLToPath(new URL('../services/studyAiBridgeService.ts', import.meta.url))], bundle: true, write: false, format: 'iife', globalName: 'Bridge', platform: 'browser' }).outputFiles[0].text;
function app() {
  const listeners = new Set();
  const timers = new Map();
  const posted = [];
  let timerId = 0;
  const window = {
    location: { origin: 'https://app.test' },
    addEventListener(type, fn) { if (type === 'message') listeners.add(fn); },
    removeEventListener(type, fn) { listeners.delete(fn); },
    postMessage(data) { posted.push(data); },
  };
  const context = vm.createContext({ window, localStorage: { getItem() { return null; } }, crypto: webcrypto, DOMException,
    console, setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    setInterval(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); }, clearInterval(id) { timers.delete(id); } });
  vm.runInContext(serviceCode, context);
  const emit = data => [...listeners].forEach(fn => fn({ source: window, origin: window.location.origin, data: { source: 'tf-study-ai-extension', ...data } }));
  return { api: context.Bridge, posted, emit, timers,
    pong() { const ping = posted.findLast(m => m.type === 'PING'); emit({ type: 'PONG', requestId: ping.requestId, ok: true, protocolVersion: 2 }); },
    fire(ms) { [...timers.values()].filter(t => t.ms === ms).forEach(t => t.fn()); } };
}
test('handshake ignores unrelated PONGs; timeout publishes disconnected state', async () => {
  const a = app();
  const status = [];
  a.api.subscribeToExtensionStatus(s => status.push(s));
  const first = a.api.pingStudyAiExtension(100);
  a.emit({ type: 'PONG', ok: true, requestId: 'unrelated' });
  a.fire(100);
  assert.equal((await first).connected, false);
  assert.equal(status.at(-1).connected, false);
  const next = a.api.pingStudyAiExtension(); a.pong();
  assert.equal((await next).connected, true);
});
test('a disconnected bridge re-checks itself and connects when the extension shows up', async () => {
  const a = app();
  const status = [];
  a.api.subscribeToExtensionStatus(s => status.push(s));
  const first = a.api.pingStudyAiExtension(100);
  a.fire(100);
  assert.equal((await first).connected, false);
  // Nothing used to re-check after this, so a tool opened before the extension was ready
  // stayed "not connected" forever.
  const pingsBefore = a.posted.filter(m => m.type === 'PING').length;
  a.fire(1000);
  await flush();
  assert.ok(a.posted.filter(m => m.type === 'PING').length > pingsBefore);
  a.pong();
  await flush();
  assert.equal(status.at(-1).connected, true);
});

test('app polls missing deliveries, preserves page metadata and ACKs the result', async () => {
  const a = app();
  const promise = a.api.extractWithStudyAiBridge({ prompt: 'Extract', pageNumber: 3 });
  a.pong(); await flush();
  const request = a.posted.find(m => m.type === 'EXTRACT_REQUEST');
  a.fire(10000);
  assert.equal(a.posted.at(-1).type, 'REQUEST_STATUS');
  a.emit({ type: 'STUDY_AI_RESULT', requestId: request.requestId, ok: true, text: '[{"content":"Page 3"}]', chatUrl: 'https://gemini.google.com/app/3' });
  const result = await promise;
  assert.equal(result.elements[0].content, 'Page 3');
  assert.equal(result.expectedMarker, request.expectedMarker);
  assert.equal(a.posted.at(-1).type, 'RESULT_ACK');
  assert.equal([...a.timers.values()].some(t => t.ms === 10000), false);
});

test('transient status transport errors recover without failing a valid extraction', async () => {
  const a = app();
  const promise = a.api.extractWithStudyAiBridge({ prompt: 'Extract' });
  a.pong(); await flush();
  const { requestId } = a.posted.find(m => m.type === 'EXTRACT_REQUEST');
  a.emit({ type: 'STUDY_AI_STATUS', requestId, ok: false, transportError: true });
  a.emit({ type: 'STUDY_AI_STATUS', requestId, ok: false, transportError: true });
  a.emit({ type: 'STUDY_AI_STATUS', requestId, ok: true, step: 'running' });
  a.emit({ type: 'STUDY_AI_RESULT', requestId, ok: true, text: '[{"content":"continued","continues_previous":true}]' });
  assert.equal((await promise).elements[0].continues_previous, true);
});
test('abort and timeout cancel extension jobs; empty JSON produces no fake elements', async () => {
  for (const mode of ['abort', 'timeout']) {
    const a = app(); const controller = new AbortController();
    const promise = a.api.extractWithStudyAiBridge({ prompt: 'Extract', signal: controller.signal, timeoutMs: 5000 });
    a.pong(); await flush();
    const rejection = assert.rejects(promise, mode === 'abort' ? /stopped by user/ : /timed out/);
    if (mode === 'abort') controller.abort(); else a.fire(5000);
    await rejection;
    assert.equal(a.posted.at(-1).type, 'CANCEL_REQUEST');
    assert.equal(a.api.parseExtensionOutputToElements('[]\n---STUDY_AI_COMPLETE_req---').length, 0);
  }
});
