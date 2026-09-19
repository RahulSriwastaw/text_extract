/**
 * TextExtract Pro Bridge
 * Version: 2.3.4
 * Copyright (c) Shivajee Kumar. All rights reserved.
 */

const PROVIDERS = {
  gemini: {
    id: "gemini",
    home: "https://gemini.google.com/app",
    match: [ "https://gemini.google.com/*" ],
    script: "content-gemini.js",
    chatUrlOk: u => /gemini\.google\.com/i.test(u || "")
  },
  deepseek: {
    id: "deepseek",
    home: "https://chat.deepseek.com/",
    match: [ "https://chat.deepseek.com/*" ],
    script: "content-bridge-generic.js",
    chatUrlOk: u => /chat\.deepseek\.com/i.test(u || "")
  },
  chatgpt: {
    id: "chatgpt",
    home: "https://chatgpt.com/",
    match: [ "https://chatgpt.com/*", "https://chat.openai.com/*" ],
    script: "content-bridge-generic.js",
    chatUrlOk: u => /chatgpt\.com|chat\.openai\.com/i.test(u || "")
  },
  claude: {
    id: "claude",
    home: "https://claude.ai/new",
    match: [ "https://claude.ai/*" ],
    script: "content-bridge-generic.js",
    chatUrlOk: u => /claude\.ai/i.test(u || "")
  }
};

function resolveProvider(id) {
  return PROVIDERS[id] || PROVIDERS.gemini;
}

const EXT_VERSION = "2.4.2";

const JOBS_KEY = "study_ai_jobs_v1";

const SESSION_KEY = "study_ai_session_v1";

const jobs = new Map;

const alivePorts = new Set;
const adminTabIds = new Set;

let session = {
  tabId: null,
  chatUrl: null,
  pdfKey: null,
  batch: 0,
  provider: "gemini"
};

(async () => {
  try {
    const data = await chrome.storage.session.get([ JOBS_KEY, SESSION_KEY ]);
    if (data[SESSION_KEY]) session = {
      ...session,
      ...data[SESSION_KEY]
    };
    const saved = data[JOBS_KEY] || {};
    for (const [id, job] of Object.entries(saved)) {
      if (job && Date.now() - (job.createdAt || 0) < 30 * 60 * 1e3) {
        jobs.set(id, job);
      }
    }
  } catch {}
})();

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "study-ai-keepalive") return;
  alivePorts.add(port);
  if (port.sender && port.sender.tab && port.sender.tab.id) {
    adminTabIds.add(port.sender.tab.id);
  }
  port.onDisconnect.addListener(() => {
    void chrome.runtime?.lastError;
    try { if (port.error) void port.error; } catch {}
    alivePorts.delete(port);
  });
  try {
    port.postMessage({
      type: "HELLO",
      version: EXT_VERSION
    });
  } catch (e) {
    void chrome.runtime?.lastError;
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  adminTabIds.delete(tabId);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender && sender.tab && sender.tab.id) {
    adminTabIds.add(sender.tab.id);
  }
  if (!msg || !msg.type) return;
  async function detectOpenProviders() {
    const open = [];
    for (const [pId, pCfg] of Object.entries(PROVIDERS)) {
      try {
        const pTabs = await chrome.tabs.query({ url: pCfg.match });
        if (pTabs && pTabs.length > 0) {
          open.push(pId);
        }
      } catch {}
    }
    return open;
  }

  if (msg.type === "STUDY_AI_PING") {
    (async () => {
      try {
        const openProviders = await detectOpenProviders();
        sendResponse({
          ok: true,
          version: EXT_VERSION,
          openProviders: openProviders,
          session: {
            tabId: session.tabId,
            chatUrl: session.chatUrl,
            batch: session.batch,
            hasPdf: !!session.pdfKey,
            provider: session.provider || "gemini",
            alivePorts: alivePorts.size,
            openJobs: jobs.size
          }
        });
      } catch (e) {
        sendResponse({
          ok: true,
          version: EXT_VERSION,
          openProviders: [],
          session: {
            ...session,
            alivePorts: alivePorts.size,
            openJobs: jobs.size
          }
        });
      }
    })();
    return true;
  }
  if (msg.type === "STUDY_AI_SET_PROVIDER") {
    (async () => {
      try {
        session.provider = msg.provider || "gemini";
        session.tabId = null;
        session.chatUrl = null;
        session.batch = 0;
        await persistSession();
        const openProviders = await detectOpenProviders();
        sendResponse({
          ok: true,
          version: EXT_VERSION,
          openProviders: openProviders,
          session: {
            tabId: session.tabId,
            chatUrl: session.chatUrl,
            batch: session.batch,
            hasPdf: !!session.pdfKey,
            provider: session.provider,
            alivePorts: alivePorts.size,
            openJobs: jobs.size
          }
        });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message });
      }
    })();
    return true;
  }
  if (msg.type === "STUDY_AI_START") {
    (async () => {
      try {
        const adminTabId = sender.tab?.id;
        if (!adminTabId) throw new Error("Admin tab missing");
        const requestId = msg.requestId || `req_${Date.now()}`;
        const providerId = msg.provider || session.provider || "gemini";
        const provider = resolveProvider(providerId);
        const continueChat = !!msg.continueChat;
        const skipPdf = !!msg.skipPdf && !msg.fileBase64;
        const silent = msg.silent !== false;
        const preferredUrl = msg.chatUrl || (session.provider === providerId ? session.chatUrl : null) || null;
        const pdfKey = msg.fileName ? `${msg.fileName}:${(msg.fileBase64 || "").length}` : session.pdfKey;
        const job = {
          requestId: requestId,
          expectedMarker: msg.expectedMarker || null,
          pageNumber: msg.pageNumber || null,
          totalPages: msg.totalPages || null,
          prompt: msg.prompt,
          fileName: skipPdf ? null : msg.fileName || null,
          fileBase64: skipPdf ? null : msg.fileBase64 || null,
          mimeType: msg.mimeType || "image/png",
          pdfOnClipboard: skipPdf ? false : !!msg.pdfOnClipboard,
          continueChat: continueChat,
          skipPdf: skipPdf,
          provider: providerId,
          adminTabId: adminTabId,
          createdAt: Date.now(),
          status: "running"
        };
        await saveJob(job);
        const bridgeTab = await openOrReuseTab({
          continueChat: continueChat,
          silent: silent,
          preferredUrl: preferredUrl,
          providerId: providerId
        });
        session.tabId = bridgeTab.id;
        session.provider = providerId;
        if (!skipPdf && pdfKey) session.pdfKey = pdfKey;
        session.batch = continueChat ? session.batch + 1 : 1;
        await persistSession();
        await waitTabComplete(bridgeTab.id, 9e4);
        if (!silent) {
          try {
            await chrome.tabs.update(bridgeTab.id, { active: true });
          } catch {}
        }
        await delay(continueChat ? 800 : 1600);
        await kickBridge(bridgeTab.id, requestId, "STUDY_AI_RUN", adminTabId, {
          provider: providerId
        });
        const slim = jobs.get(requestId);
        if (slim) {
          slim.kickedAt = Date.now();
          await saveJob(slim);
        }
        sendResponse({
          ok: true,
          requestId: requestId,
          geminiTabId: bridgeTab.id,
          continueChat: continueChat,
          skipPdf: skipPdf,
          batch: session.batch,
          chatUrl: session.chatUrl,
          provider: providerId
        });
      } catch (e) {
        sendResponse({
          ok: false,
          error: e?.message || String(e)
        });
      }
    })();
    return true;
  }
  if (msg.type === "STUDY_AI_CAPTURE_START") {
    (async () => {
      try {
        const adminTabId = sender.tab?.id;
        if (!adminTabId) throw new Error("Admin tab missing");
        const requestId = msg.requestId || `cap_${Date.now()}`;
        const fullChat = !!msg.fullChat;
        const providerId = msg.provider || session.provider || "gemini";
        await saveJob({
          requestId: requestId,
          expectedMarker: msg.expectedMarker || null,
          pageNumber: msg.pageNumber || null,
          totalPages: msg.totalPages || null,
          adminTabId: adminTabId,
          createdAt: Date.now(),
          fullChat: fullChat,
          provider: providerId,
          status: "capturing"
        });
        const preferredUrl = msg.chatUrl || session.chatUrl || null;
        const tab = await openOrReuseTab({
          continueChat: true,
          silent: true,
          preferredUrl: preferredUrl,
          providerId: providerId
        });
        session.tabId = tab.id;
        session.provider = providerId;
        if (tab.status !== "complete") {
          await waitTabComplete(tab.id, 2000).catch(() => {});
        }
        await kickBridge(tab.id, requestId, "STUDY_AI_CAPTURE", adminTabId, {
          fullChat: fullChat,
          expectedMarker: msg.expectedMarker || null,
          pageNumber: msg.pageNumber || null,
          totalPages: msg.totalPages || null,
          provider: providerId
        });
        sendResponse({
          ok: true,
          requestId: requestId
        });
      } catch (e) {
        sendResponse({
          ok: false,
          error: e?.message || String(e)
        });
      }
    })();
    return true;
  }
  if (msg.type === "STUDY_AI_PROGRESS") {
    (async () => {
      const job = await getJob(msg.requestId) || null;
      const adminTabId = job?.adminTabId || msg.adminTabId;
      if (msg.chatUrl) {
        session.chatUrl = msg.chatUrl;
        await persistSession();
      }
      if (job) {
        job.lastProgressAt = Date.now();
        job.lastStep = msg.step;
        job.lastDetail = msg.detail;
        await saveJob(job);
      }
      if (adminTabId) {
        await relayToAdminReliable(adminTabId, {
          type: "STUDY_AI_PROGRESS",
          requestId: msg.requestId,
          step: msg.step,
          detail: msg.detail,
          chatUrl: session.chatUrl
        });
      }
      sendResponse({
        ok: true
      });
    })();
    return true;
  }
  if (msg.type === "STUDY_AI_RESULT") {
    (async () => {
      const job = await getJob(msg.requestId) || null;
      const adminTabId = job?.adminTabId || msg.adminTabId;
      if (msg.chatUrl) {
        session.chatUrl = msg.chatUrl;
        await persistSession();
      }
      const payload = {
        ...msg,
        chatUrl: msg.chatUrl || session.chatUrl
      };
      if (adminTabId) {
        await relayToAdminReliable(adminTabId, payload, 8);
      } else {
        await broadcastResultToAdminTabs(payload);
      }
      await deleteJob(msg.requestId);
      sendResponse({
        ok: true
      });
    })();
    return true;
  }
  if (msg.type === "STUDY_AI_GET_JOB") {
    (async () => {
      const job = await getJob(msg.requestId);
      sendResponse({
        ok: true,
        job: job || null
      });
    })();
    return true;
  }
  if (msg.type === "STUDY_AI_RESET_SESSION") {
    (async () => {
      session = {
        tabId: null,
        chatUrl: null,
        pdfKey: null,
        batch: 0,
        provider: session.provider || "gemini"
      };
      await persistSession();
      sendResponse({
        ok: true
      });
    })();
    return true;
  }
  if (msg.type === "STUDY_AI_HEARTBEAT") {
    (async () => {
      if (msg.requestId) {
        const job = await getJob(msg.requestId);
        if (job) {
          job.lastHeartbeatAt = Date.now();
          await saveJob(job);
        }
      }
      sendResponse({
        ok: true,
        version: EXT_VERSION,
        t: Date.now()
      });
    })();
    return true;
  }
});

async function saveJob(job) {
  jobs.set(job.requestId, job);
  try {
    if (job.fileBase64) {
      await chrome.storage.local.set({ [`img_${job.requestId}`]: job.fileBase64 });
    }
    const data = await chrome.storage.session.get(JOBS_KEY);
    const all = data[JOBS_KEY] || {};
    // Store metadata in session storage without huge base64 payload to prevent quota errors
    const { fileBase64: _omitted, ...jobMeta } = job;
    all[job.requestId] = jobMeta;
    const cutoff = Date.now() - 30 * 60 * 1e3;
    for (const [k, v] of Object.entries(all)) {
      if (!v?.createdAt || v.createdAt < cutoff) delete all[k];
    }
    await chrome.storage.session.set({
      [JOBS_KEY]: all
    });
  } catch (e) {
    console.warn("saveJob storage error:", e);
  }
}

async function getJob(requestId) {
  if (!requestId) return null;
  let job = jobs.get(requestId);
  if (job?.fileBase64) return job;

  try {
    if (!job) {
      const data = await chrome.storage.session.get(JOBS_KEY);
      job = data[JOBS_KEY]?.[requestId] || null;
    }
    if (job && !job.fileBase64) {
      const localData = await chrome.storage.local.get(`img_${requestId}`);
      if (localData[`img_${requestId}`]) {
        job.fileBase64 = localData[`img_${requestId}`];
      }
    }
    if (job) {
      jobs.set(requestId, job);
      return job;
    }
  } catch {}
  return jobs.get(requestId) || null;
}

async function deleteJob(requestId) {
  jobs.delete(requestId);
  try {
    const data = await chrome.storage.session.get(JOBS_KEY);
    const all = data[JOBS_KEY] || {};
    delete all[requestId];
    await chrome.storage.session.set({
      [JOBS_KEY]: all
    });
  } catch {}
  try {
    await chrome.storage.local.remove(`img_${requestId}`);
  } catch {}
}

async function persistSession() {
  try {
    await chrome.storage.session.set({
      [SESSION_KEY]: session
    });
  } catch {}
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function waitTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === "complete") return resolve(tab);
      } catch (e) {
        return reject(e);
      }
      if (Date.now() - start > timeoutMs) {
        return reject(new Error("Bridge tab load timeout"));
      }
      setTimeout(check, 300);
    };
    check();
  });
}

async function kickBridge(tabId, requestId, type, adminTabId, extra = {}) {
  const job = await getJob(requestId);
  const providerId = extra.provider || job?.provider || session.provider || "gemini";
  const provider = resolveProvider(providerId);
  const payload = {
    type: type,
    requestId: requestId,
    expectedMarker: job?.expectedMarker || extra.expectedMarker || null,
    adminTabId: adminTabId,
    provider: providerId,
    fullChat: !!(extra.fullChat || job?.fullChat),
    jobLite: job ? {
      prompt: job.prompt,
      expectedMarker: job.expectedMarker || null,
      pageNumber: job.pageNumber || null,
      fileName: job.fileName,
      mimeType: job.mimeType,
      pdfOnClipboard: job.pdfOnClipboard,
      continueChat: job.continueChat,
      skipPdf: job.skipPdf,
      fullChat: job.fullChat,
      provider: providerId,
      adminTabId: adminTabId,
      fileBase64: jobs.get(requestId)?.fileBase64 || job?.fileBase64 || null
    } : {
      adminTabId: adminTabId,
      expectedMarker: extra.expectedMarker || null,
      fullChat: !!extra.fullChat,
      provider: providerId
    },
    ...extra
  };
  const trySend = () => new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, payload, res => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message
        });
      } else resolve(res || {
        ok: true
      });
    });
  });
  let lastErr = "";
  for (let attempt = 0; attempt < 14; attempt++) {
    let res = await trySend();
    if (res?.ok || res?.started) return;
    lastErr = res?.error || "no listener";
    try {
      await chrome.scripting.executeScript({
        target: {
          tabId: tabId
        },
        files: [ provider.script ]
      });
    } catch (e) {
      lastErr = e?.message || lastErr;
    }
    await delay(400 + attempt * 200);
    res = await trySend();
    if (res?.ok || res?.started) return;
    lastErr = res?.error || lastErr;
  }
  await relayToAdminReliable(adminTabId, {
    type: "STUDY_AI_RESULT",
    requestId: requestId,
    ok: false,
    error: lastErr || "Could not reach bridge tab. Reload TextExtract Pro Bridge extension + refresh AI chat tab.",
    chatUrl: session.chatUrl
  });
  await deleteJob(requestId);
}

async function openOrReuseTab({continueChat: continueChat, silent: silent, preferredUrl: preferredUrl, providerId: providerId}) {
  const provider = resolveProvider(providerId || session.provider || "gemini");
  const tabs = await chrome.tabs.query({
    url: provider.match
  });
  let tab = session.tabId && tabs.find(t => t.id === session.tabId) || tabs.find(t => preferredUrl && t.url && preferredUrl && t.url.startsWith(String(preferredUrl).split("?")[0])) || tabs[0] || null;
  const canReuseChat = continueChat && preferredUrl && provider.chatUrlOk(preferredUrl);
  const targetUrl = canReuseChat ? preferredUrl : continueChat && tab?.url ? null : provider.home;
  if (tab) {
    const update = {
      active: !silent
    };
    if (targetUrl && tab.url !== targetUrl) update.url = targetUrl;
    await chrome.tabs.update(tab.id, update);
    session.tabId = tab.id;
    if (preferredUrl && provider.chatUrlOk(preferredUrl)) session.chatUrl = preferredUrl; else if (tab.url) session.chatUrl = tab.url;
    session.provider = provider.id;
    await persistSession();
    return tab;
  }
  const url = targetUrl || preferredUrl || provider.home;
  const created = await chrome.tabs.create({
    url: url,
    active: !silent
  });
  session.tabId = created.id;
  session.chatUrl = url;
  session.provider = provider.id;
  await persistSession();
  return created;
}

async function relayToAdminReliable(adminTabId, msg, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    const ok = await relayOnce(adminTabId, msg);
    if (ok) return true;
    await delay(300 + i * 250);
  }
  await broadcastResultToAdminTabs(msg);
  return false;
}

function relayOnce(adminTabId, msg) {
  return new Promise(resolve => {
    try {
      chrome.tabs.sendMessage(adminTabId, msg, () => {
        if (!chrome.runtime.lastError) return resolve(true);
        const inject = world => chrome.scripting.executeScript({
          target: {
            tabId: adminTabId
          },
          world: world,
          func: payload => {
            window.postMessage({
              source: "tf-study-ai-extension",
              ...payload
            }, "*");
          },
          args: [ msg ]
        });
        inject("MAIN").then(() => resolve(true)).catch(() => inject(undefined).then(() => resolve(true)).catch(() => resolve(false)));
      });
    } catch {
      resolve(false);
    }
  });
}

async function broadcastResultToAdminTabs(msg) {
  try {
    for (const p of alivePorts) {
      if (p && p.sender && p.sender.tab && p.sender.tab.id) {
        await relayOnce(p.sender.tab.id, msg);
      }
    }
    for (const tabId of adminTabIds) {
      await relayOnce(tabId, msg);
    }
    const vercelTabs = await chrome.tabs.query({
      url: [
        "https://text-extract-sigma.vercel.app/*",
        "https://*.vercel.app/*",
        "http://localhost/*",
        "http://localhost:*/*",
        "http://127.0.0.1/*",
        "http://127.0.0.1:*/*"
      ]
    });
    for (const t of vercelTabs) {
      if (t.id) await relayOnce(t.id, msg);
    }
  } catch {}
}