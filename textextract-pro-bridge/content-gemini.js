/**
 * TextExtract Pro Bridge
 * Version: 2.0.0
 */

(function() {
  const EXT_VER = "2.0.0";
  if (window.__tfStudyAiGeminiVer === EXT_VER) return;
  window.__tfStudyAiGeminiVer = EXT_VER;
  window.__tfStudyAiGeminiBound = true;
  const LOG = (...a) => console.log("[TextExtract Bridge]", ...a);
  const COMPLETE_MARKER = "YOUR_TEST_SERIES_JSON_COMPLETED";
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function isOurPromptText(text) {
    return /You are an expert Indian exam-paper|You are a professional Exam Paper Digitizer|STRICT REQUIREMENT: You MUST fill ALL fields|COMPLETION \(CRITICAL|Schema per item|ADMIN EXTRA:|Continue in THIS same chat with the SAME PDF|Continue SAME chat \+ SAME PDF/i.test(text || "");
  }
  let port = null;
  function connectKeepalive() {
    try {
      port = chrome.runtime.connect({
        name: "study-ai-keepalive"
      });
      port.onDisconnect.addListener(() => {
        port = null;
        setTimeout(connectKeepalive, 1200);
      });
    } catch {
      setTimeout(connectKeepalive, 2e3);
    }
  }
  connectKeepalive();
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg?.type) return;
    if (msg.type === "STUDY_AI_RUN") {
      sendResponse({
        ok: true,
        started: true
      });
      runExtract(msg).catch(e => {
        LOG("runExtract failed", e);
        report(msg.requestId, false, null, e?.message || String(e), msg.adminTabId);
      });
      return false;
    }
    if (msg.type === "STUDY_AI_CAPTURE") {
      sendResponse({
        ok: true,
        started: true
      });
      runCaptureOnly(msg).then(text => report(msg.requestId, true, text, null, msg.adminTabId)).catch(e => report(msg.requestId, false, null, e?.message || String(e), msg.adminTabId));
      return false;
    }
  });
  function progress(requestId, step, detail, adminTabId) {
    const payload = {
      type: "STUDY_AI_PROGRESS",
      requestId: requestId,
      step: step,
      detail: detail,
      chatUrl: location.href,
      adminTabId: adminTabId || undefined
    };
    try {
      chrome.runtime.sendMessage(payload, () => {
        void chrome.runtime.lastError;
      });
    } catch {}
    LOG(step, detail || "");
  }
  function report(requestId, ok, text, error, adminTabId) {
    const payload = {
      type: "STUDY_AI_RESULT",
      requestId: requestId,
      ok: ok,
      text: text || null,
      error: error || null,
      chatUrl: location.href,
      adminTabId: adminTabId || undefined
    };
    const attempt = n => {
      try {
        chrome.runtime.sendMessage(payload, res => {
          if (chrome.runtime.lastError || !res?.ok) {
            if (n < 8) setTimeout(() => attempt(n + 1), 400 + n * 200);
          }
        });
      } catch {
        if (n < 8) setTimeout(() => attempt(n + 1), 500);
      }
    };
    attempt(0);
  }
  function getJob(requestId, msg) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: "STUDY_AI_GET_JOB",
        requestId: requestId
      }, res => {
        const fromSw = res?.job || null;
        if (fromSw && (fromSw.prompt || fromSw.fullChat != null || fromSw.adminTabId)) {
          if ((!fromSw.fileBase64 || fromSw.fileBase64 === "[omitted]") && msg?.jobLite?.fileBase64) {
            fromSw.fileBase64 = msg.jobLite.fileBase64;
          }
          return resolve(fromSw);
        }
        if (msg?.jobLite) return resolve({
          ...msg.jobLite,
          requestId: requestId
        });
        resolve(null);
      });
    });
  }
  function startHeartbeat(requestId, adminTabId) {
    const id = setInterval(() => {
      try {
        chrome.runtime.sendMessage({
          type: "STUDY_AI_HEARTBEAT",
          requestId: requestId
        }, () => void chrome.runtime.lastError);
        progress(requestId, "heartbeat", "Bridge alive — waiting for model reply…", adminTabId);
        if (!port) connectKeepalive();
      } catch {}
    }, 8e3);
    return () => clearInterval(id);
  }

  function getModelResponseNodes() {
    const list = deepQueryAll("model-response");
    if (list.length) return list;
    const byRole = deepQueryAll('[data-message-author-role="model"]');
    if (byRole.length) return byRole;
    return deepQueryAll(".model-response-text, .response-content");
  }

  function snapshotReplyFingerprint() {
    const nodes = getModelResponseNodes();
    if (!nodes.length) return "0:";
    const last = nodes[nodes.length - 1];
    const text = (last.innerText || last.textContent || "").trim();
    return `${nodes.length}:${text.length}:${text.slice(-120)}`;
  }

  async function runExtract(msg) {
    const requestId = msg.requestId;
    const job = await getJob(requestId, msg) || msg.jobLite;
    const adminTabId = msg.adminTabId || job?.adminTabId;
    if (!job?.prompt) throw new Error("Job missing — restart extract from admin.");
    const stopHb = startHeartbeat(requestId, adminTabId);
    try {
      if (!job.continueChat) {
        try {
          const existingTurns = getModelResponseNodes();
          if (existingTurns.length > 0) {
            const newChatBtn = deepQueryAll('button, a, [role="button"]').find(b => {
              const label = ((b.getAttribute("aria-label") || "") + " " + (b.title || "") + " " + (b.textContent || "")).toLowerCase();
              return (label.includes("new chat") || label.includes("start new") || label.includes("नयी बातचीत") || label.includes("नई चैट")) && !label.includes("history");
            });
            if (newChatBtn) {
              LOG("Starting clean new chat for fresh page extraction");
              newChatBtn.click();
              await sleep(600);
            }
          }
        } catch {}
      }

      progress(requestId, "composer", "Waiting for input…", adminTabId);
      await waitForComposer(9e4);
      const el = findComposer();
      if (!el) throw new Error("Composer not found — login on the bridge tab, then retry.");
      const skipPdf = !!job.skipPdf && !job.fileBase64;
      const initialReplyCount = getModelResponseNodes().length;
      const baseline = snapshotReplyFingerprint();
      if (!skipPdf && job.fileBase64) {
        progress(requestId, "pdf", "Attaching page image…", adminTabId);
        const pasted = await pastePdfIntoComposer(el, job);
        progress(requestId, "pdf", pasted ? "Image attached — waiting for thumbnail…" : "Paste dispatched.", adminTabId);
        await waitForAttachment(job.fileName, 8e3);
        await sleep(600);
      } else if (!skipPdf && job.pdfOnClipboard) {
        progress(requestId, "pdf", "Ctrl+V from clipboard…", adminTabId);
        await focusAndPaste(el);
        await waitForAttachment("", 8e3);
      }
      progress(requestId, "prompt", "Injecting extraction prompt…", adminTabId);
      await injectPromptKeepAttachments(el, job.prompt);
      await sleep(500);
      progress(requestId, "send", "Sending to Gemini…", adminTabId);
      await clickSendOrEnter(el);
      progress(requestId, "wait", "Waiting for Gemini reply…", adminTabId);
      const text = await waitForJsonReplyLive(18e4, requestId, baseline, adminTabId, initialReplyCount);
      progress(requestId, "done", `Captured ${text.length} chars`, adminTabId);
      report(requestId, true, text, null, adminTabId);
    } finally {
      stopHb();
    }
  }
  async function runCaptureOnly(msg) {
    const job = await getJob(msg.requestId, msg) || msg.jobLite || {};
    const adminTabId = msg.adminTabId || job.adminTabId;
    const fullChat = !!(msg.fullChat || job.fullChat);
    const stopHb = startHeartbeat(msg.requestId, adminTabId);
    try {
      progress(msg.requestId, "capture", fullChat ? "Loading complete chat — scraping every JSON block…" : "Scraping latest reply…", adminTabId);
      const start = Date.now();
      while (Date.now() - start < 6e4 && isGenerating()) {
        progress(msg.requestId, "capture", "Still generating — waiting…", adminTabId);
        await sleep(1e3);
      }
      await sleep(800);
      if (fullChat) {
        await scrollChatToLoadAll(msg.requestId, adminTabId);
        const packed = scrapeAllJsonFromChat(msg.requestId, adminTabId);
        if (!packed || packed.length < 20) {
          throw new Error("No JSON found in this chat. Open the extract thread, wait for replies, then Recapture complete chat.");
        }
        progress(msg.requestId, "done", `Full chat packed ${packed.length} chars`, adminTabId);
        return packed;
      }
      const text = scrapeBestReply(true);
      if (!text || text.length < 20) {
        throw new Error("No reply on bridge tab. Let generation finish, then Capture again.");
      }
      return extractJsonCandidate(text) || text;
    } finally {
      stopHb();
    }
  }
  async function scrollChatToLoadAll(requestId, adminTabId) {
    const main = document.querySelector("main") || document.querySelector("chat-app-orchestrator") || document.scrollingElement || document.body;
    progress(requestId, "scroll", "Scrolling chat to load all messages…", adminTabId);
    try {
      for (let pass = 0; pass < 2; pass++) {
        main.scrollTop = 0;
        window.scrollTo(0, 0);
        await sleep(400);
        const steps = 16;
        for (let i = 0; i <= steps; i++) {
          const max = Math.max(main.scrollHeight || 0, document.body.scrollHeight || 0);
          main.scrollTop = max * i / steps;
          window.scrollTo(0, max * i / steps);
          await sleep(180);
        }
        main.scrollTop = main.scrollHeight || 0;
        window.scrollTo(0, document.body.scrollHeight || 0);
        await sleep(500);
      }
    } catch {}
  }
  function scrapeAllJsonFromChat(requestId, adminTabId) {
    const blocks = [];
    const seenExact = new Set;
    function pushCandidate(raw) {
      const t = (raw || "").trim();
      if (!t || t.length < 12) return;
      const json = extractJsonCandidate(t);
      const body = (json || t).trim();
      if (!/"question(?:_[a-z]+)?"\s*:/i.test(body) && !/"Question"\s*:/i.test(body) && !/"type"\s*:/i.test(body) && !/"content"\s*:/i.test(body)) {
        if (!(body.startsWith("[") && body.includes("{"))) return;
      }
      if (seenExact.has(body)) return;
      seenExact.add(body);
      blocks.push(body);
    }
    function pushAllFences(text) {
      const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
      let m;
      while (m = fenceRe.exec(text || "")) pushCandidate(m[1]);
    }
    const codeNodes = [ ...deepQueryAll("code"), ...deepQueryAll("pre"), ...deepQueryAll('[class*="code"]'), ...deepQueryAll('[class*="Code"]') ];
    for (const n of codeNodes) {
      pushCandidate(n.innerText || n.textContent || "");
    }
    const sels = [ "model-response", "message-content", ".model-response-text", '[data-message-author-role="model"]', ".response-content", '[class*="model-response"]', '[class*="response-container"]' ];
    const replyNodes = [];
    for (const s of sels) replyNodes.push(...deepQueryAll(s));
    const filtered = replyNodes.filter((n, _i, arr) => !arr.some(o => o !== n && n.contains(o)));
    for (const n of filtered) {
      const t = n.innerText || n.textContent || "";
      pushAllFences(t);
      pushCandidate(t);
    }
    const main = document.querySelector("main") || document.querySelector("chat-app-orchestrator") || document.body;
    const all = (main?.innerText || "").trim();
    pushAllFences(all);
    if (!blocks.length && all.length > 40) pushCandidate(all);
    if (!blocks.length) return "";
    progress(requestId, "capture", `Packed ${blocks.length} JSON block(s) from chat (exact-dupes only skipped)`, adminTabId);
    return blocks.map(b => "```json\n" + b + "\n```").join("\n\n");
  }
  function deepQueryAll(selector, root = document) {
    const out = [];
    const visit = node => {
      if (!node?.querySelectorAll) return;
      try {
        out.push(...node.querySelectorAll(selector));
      } catch {}
      for (const el of node.querySelectorAll("*")) {
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    };
    visit(root);
    return out;
  }
  async function waitForComposer(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (findComposer()) return;
      await sleep(350);
    }
    throw new Error("Gemini composer not found — login first.");
  }
  function findComposer() {
    const selectors = [ "div.ql-editor.textarea.new-input-ui", 'div.ql-editor[contenteditable="true"]', "div.ql-editor", 'rich-textarea div[contenteditable="true"]', 'div[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]', "textarea" ];
    for (const sel of selectors) {
      const list = deepQueryAll(sel).filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 40 && r.height > 12 && r.bottom > 0;
      });
      if (!list.length) continue;
      list.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
      return list[0];
    }
    return null;
  }
  function base64ToFile(base64, fileName, mimeType) {
    try {
      const raw = String(base64).replace(/^data:[^;]+;base64,/, "");
      const binary = atob(raw);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new File([ bytes ], fileName || "paper.pdf", {
        type: mimeType || "application/pdf"
      });
    } catch (e) {
      LOG("base64 fail", e);
      return null;
    }
  }
  function clearComposerAttachments() {
    try {
      const composer = findComposer();
      const container = composer?.closest('form, [class*="input-area"], [class*="composer"], .bottom-container, main') || document;
      const removeButtons = deepQueryAll('button[aria-label*="remove" i], button[aria-label*="delete" i], button[aria-label*="clear" i], button[aria-label*="close" i]', container);
      for (const btn of removeButtons) {
        btn.click();
      }
    } catch {}
  }

  async function tryDropFile(el, file) {
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      const evInit = {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt
      };
      el.dispatchEvent(new DragEvent("dragenter", evInit));
      await sleep(60);
      el.dispatchEvent(new DragEvent("dragover", evInit));
      await sleep(60);
      el.dispatchEvent(new DragEvent("drop", evInit));
      LOG("native drag-and-drop dispatched for", file.name);
      return true;
    } catch (e) {
      LOG("drag-and-drop failed", e);
      return false;
    }
  }

  async function pastePdfIntoComposer(el, job) {
    const file = base64ToFile(job.fileBase64, job.fileName, job.mimeType || "image/png");
    if (!file) return false;

    clearComposerAttachments();
    await sleep(150);

    el.scrollIntoView({ block: "center" });
    el.click();
    el.focus();
    await sleep(200);

    // 1. Try HTML5 native Drag & Drop directly on composer (works without clipboard permissions)
    await tryDropFile(el, file);
    await sleep(500);
    if (await waitForAttachment(job.fileName, 2500)) return true;

    // 2. Try native hidden file input assignment
    const viaInput = await tryFileInputAssign(file);
    if (viaInput) {
      await sleep(600);
      if (await waitForAttachment(job.fileName, 3000)) return true;
    }

    // 3. Try clipboard write + paste ONLY IF wroteClip succeeded with the NEW file
    let wroteClip = false;
    const fileMime = file.type || "image/png";
    try {
      window.focus();
      await navigator.clipboard.write([ new ClipboardItem({ [fileMime]: file }) ]);
      wroteClip = true;
      LOG("clipboard write ok with fresh image");
    } catch (e) {
      try {
        await navigator.clipboard.write([ new ClipboardItem({ [fileMime]: Promise.resolve(file) }) ]);
        wroteClip = true;
      } catch (e2) {
        LOG("clipboard write failed", e2);
      }
    }
    if (wroteClip) {
      await focusAndPaste(el);
      await sleep(600);
      if (await waitForAttachment(job.fileName, 3000)) return true;
    }

    return true;
  }

  async function focusAndPaste(el) {
    el.focus();
    await sleep(100);
    try {
      document.execCommand("paste");
    } catch {}
    const isMac = /Mac|iPhone/i.test(navigator.platform || "");
    const mod = {
      ctrlKey: !isMac,
      metaKey: isMac
    };
    for (const type of [ "keydown", "keyup" ]) {
      el.dispatchEvent(new KeyboardEvent(type, {
        key: "v",
        code: "KeyV",
        keyCode: 86,
        which: 86,
        bubbles: true,
        cancelable: true,
        ...mod
      }));
    }
  }

  async function tryFileInputAssign(file) {
    const proto = HTMLInputElement.prototype;
    const orig = proto.click;
    proto.click = function() {
      if (this.type === "file") return undefined;
      return orig.apply(this, arguments);
    };
    try {
      const btns = deepQueryAll('button, [role="button"]').filter(b => /upload|attach|add file|from device|insert/i.test(b.getAttribute("aria-label") || ""));
      for (const b of btns.slice(0, 4)) {
        try {
          b.click();
        } catch {}
        await sleep(350);
      }
      const inputs = deepQueryAll('input[type="file"]');
      const input = inputs.find(i => /image|png|jpg|pdf|\*|file/i.test(i.accept || i.name || "")) || inputs[0];
      if (!input) return false;
      const dt = new DataTransfer;
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    } catch {
      return false;
    } finally {
      proto.click = orig;
    }
  }

  async function waitForAttachment(fileName, timeoutMs) {
    const start = Date.now();
    const composer = findComposer();
    const container = composer?.closest('form, [class*="input-area"], [class*="composer"], .bottom-container, main') || document;

    while (Date.now() - start < (timeoutMs || 8e3)) {
      // Look strictly inside or adjacent to composer container for active attachments
      const chips = deepQueryAll(
        'uploader-file-card, [data-test-id*="file"], [class*="attachment-preview"], [class*="file-preview"], button[aria-label*="remove" i], button[aria-label*="delete" i], button[aria-label*="clear" i]',
        container
      );
      if (chips.length > 0) return true;
      await sleep(300);
    }
    return false;
  }
  function composerText(el) {
    return (el?.innerText || el?.textContent || el?.value || "").replace(/\s+/g, " ").trim();
  }
  function promptNeedle(prompt) {
    const p = String(prompt || "").replace(/\s+/g, " ").trim();
    if (p.includes(COMPLETE_MARKER)) return COMPLETE_MARKER;
    if (p.includes("expert Indian exam-paper")) return "expert Indian exam-paper";
    if (p.includes("professional Exam Paper Digitizer")) return "professional Exam Paper Digitizer";
    if (p.includes("STRICT REQUIREMENT:")) return "STRICT REQUIREMENT:";
    if (p.length > 80) return p.slice(40, 80);
    return p.slice(0, Math.min(32, p.length));
  }
  async function injectPromptKeepAttachments(el, prompt) {
    el = findComposer() || el;
    el.click();
    el.focus();
    await sleep(200);
    const payload = "\n" + prompt;
    const needle = promptNeedle(prompt);
    const hasNeedle = () => {
      const t = composerText(el);
      return t.includes(needle) || t.includes(String(prompt).slice(0, 24));
    };
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {}
    // Chunked insert — long prompts often fail as one insertText
    const chunkSize = 1500;
    for (let i = 0; i < payload.length; i += chunkSize) {
      try {
        document.execCommand("insertText", false, payload.slice(i, i + chunkSize));
      } catch {}
      await sleep(30);
    }
    await sleep(200);
    if (hasNeedle()) return;
    try {
      const dt = new DataTransfer;
      dt.setData("text/plain", payload);
      el.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dt
      }));
      await sleep(250);
    } catch {}
    if (hasNeedle()) return;
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      try {
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, "value");
        if (desc?.set) desc.set.call(el, (el.value || "") + payload);
        else el.value = (el.value || "") + payload;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      } catch {}
      await sleep(150);
      if (hasNeedle()) return;
    }
    try {
      const esc = payload.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      el.innerHTML = (el.innerHTML || "") + esc.split(/\n/).map(l => `<p>${l || "<br>"}</p>`).join("");
      el.classList.remove("ql-blank");
      el.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: payload.slice(0, 200)
      }));
      await sleep(150);
    } catch {}
    if (!hasNeedle()) {
      const t = composerText(el);
      if (t.length > 80 && /json|question|MCQ|exam/i.test(t)) return;
      throw new Error("Could not inject prompt into Gemini input. Click the chat box once, then retry.");
    }
  }
  function hasCompletionMarker(text) {
    if (!text || isOurPromptText(text)) return false;
    const lines = String(text).split(/\n/).map(l => l.trim()).filter(Boolean);
    return lines.some(l => l.toUpperCase() === COMPLETE_MARKER);
  }
  async function clickSendOrEnter(el) {
    for (let attempt = 0; attempt < 25; attempt++) {
      const send = findSendButton();
      const disabled = send?.disabled || send?.getAttribute("aria-disabled") === "true";
      if (send && !disabled) {
        send.click();
        await sleep(400);
        return;
      }
      await sleep(250);
    }
    const send = findSendButton();
    if (send) {
      send.click();
      await sleep(300);
      return;
    }
    el.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    }));
  }
  function findSendButton() {
    const buttons = deepQueryAll('button, [role="button"]');
    return (
      buttons.find(b => /^(send|submit|send message)$/i.test((b.getAttribute("aria-label") || "").trim())) ||
      buttons.find(b => {
        const al = (b.getAttribute("aria-label") || b.getAttribute("data-test-id") || b.title || "").toLowerCase();
        return (al.includes("send") || al.includes("submit")) && !al.includes("stop");
      }) ||
      buttons.find(b => {
        const svg = b.querySelector("svg");
        return svg && (b.className || "").toLowerCase().includes("send");
      }) ||
      null
    );
  }
  function isGenerating() {
    const buttons = deepQueryAll('button, [role="button"]');
    const hasStop = buttons.some(b => {
      const al = (b.getAttribute("aria-label") || b.getAttribute("title") || b.textContent || "").toLowerCase().trim();
      return /stop|stop response|stop generation|stop generating/i.test(al);
    });
    if (hasStop) return true;
    return deepQueryAll('.streaming, [data-is-streaming="true"], [class*="streaming"]').length > 0;
  }

  function hasStandaloneCompletion(text) {
    if (!text || isOurPromptText(text)) return false;
    if (/"question(?:_[a-z]+)?"\s*:/i.test(text || "")) return false;
    const lines = String(text).split(/\n/).map(l => l.trim()).filter(Boolean);
    return lines.some(l => l.toUpperCase() === COMPLETE_MARKER);
  }

  function sanitizeJsonEscapes(jsonStr) {
    if (!jsonStr) return "";
    let out = "";
    let inString = false;
    let escape = false;
    for (let i = 0; i < jsonStr.length; i++) {
      const c = jsonStr[i];
      if (escape) {
        out += c;
        escape = false;
        continue;
      }
      if (c === '"') {
        inString = !inString;
        out += c;
        continue;
      }
      if (inString && c === '\\') {
        const next = jsonStr[i + 1] || '';
        const afterNext = jsonStr[i + 2] || '';
        if (next === '\\') {
          out += '\\\\';
          i++;
          continue;
        }
        if (next === '"' || next === '/') {
          out += '\\' + next;
          i++;
          continue;
        }
        const isWord = /^[a-zA-Z]/.test(afterNext);
        if (/^[nrtbf]/.test(next) && !isWord) {
          out += '\\' + next;
          i++;
          continue;
        }
        if (next === 'u' && /^[0-9a-fA-F]{4}/.test(jsonStr.slice(i + 2, i + 6))) {
          out += jsonStr.slice(i, i + 6);
          i += 5;
          continue;
        }
        out += '\\\\';
        continue;
      }
      if (inString && c === '\n') {
        out += '\\n';
        continue;
      }
      if (inString && c === '\r') {
        out += '\\n';
        if (jsonStr[i + 1] === '\n') i++;
        continue;
      }
      out += c;
    }
    return out;
  }

  function repairJsonStringNewlines(input) {
    return sanitizeJsonEscapes(input);
  }

  function isValidMcqObj(x) {
    if (!x || typeof x !== "object") return false;
    return Boolean(
      x.question != null ||
      x.question_hi != null ||
      x.question_en != null ||
      x.question_r != null ||
      x.option1_hi != null ||
      x.option1_en != null ||
      x.solution_hi != null ||
      x.solution_en != null ||
      x.type != null ||
      x.content != null ||
      x.text != null
    );
  }

  function extractBalancedObjects(text) {
    const out = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escape = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (inString && c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (c === "{") {
        if (depth === 0) start = i;
        depth += 1;
      } else if (c === "}") {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          out.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
    return out;
  }

  function tryParseJsonLoose(s) {
    for (const a of [
      s,
      repairJsonStringNewlines(s),
      s.replace(/,\s*([\]}])/g, "$1"),
      repairJsonStringNewlines(s).replace(/,\s*([\]}])/g, "$1"),
    ]) {
      try {
        return JSON.parse(a);
      } catch {}
    }
    return null;
  }

  function extractQuestionsFromText(text) {
    if (!text) return [];
    let raw = String(text)
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/(^|\n)\s*json\s*\n\s*(\[)/gi, "$1$2")
      .replace(/^json\s*/i, "")
      .trim();
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) raw = fence[1].trim();
    else {
      const open = raw.match(/```(?:json)?\s*([\s\S]+)$/i);
      if (open) raw = open[1].trim();
    }
    const a0 = raw.indexOf("[");
    if (a0 >= 0) raw = raw.slice(a0);
    const repaired = repairJsonStringNewlines(raw);
    const a1 = repaired.lastIndexOf("]");
    if (repaired.startsWith("[") && a1 > 0) {
      const slice = repaired.slice(0, a1 + 1);
      const parsed = tryParseJsonLoose(slice);
      if (Array.isArray(parsed) && parsed.some(isValidMcqObj)) {
        return parsed.filter(isValidMcqObj);
      }
    }
    const objs = extractBalancedObjects(repaired);
    const out = [];
    for (const o of objs) {
      const p = tryParseJsonLoose(o);
      if (p && isValidMcqObj(p)) out.push(p);
    }
    return out;
  }

  function extractJsonCandidate(text) {
    if (!text) return null;
    const qs = extractQuestionsFromText(text);
    if (qs.length) return JSON.stringify(qs);
    if (hasStandaloneCompletion(text)) return "[]";
    const t = String(text).trim();
    if (
      t.length < 400 &&
      /^```(?:json)?\s*\[\s*\]\s*```\s*$/i.test(t) &&
      !/"question(?:_[a-z]+)?"\s*:/i.test(t)
    ) {
      return "[]";
    }
    const raw = repairJsonStringNewlines(t);
    const o0 = raw.indexOf("{");
    const o1 = raw.lastIndexOf("}");
    if (o0 >= 0 && o1 > o0) {
      try {
        const obj = JSON.parse(raw.slice(o0, o1 + 1).replace(/,\s*([\]}])/g, "$1"));
        if (Array.isArray(obj.questions)) return JSON.stringify(obj.questions);
        if (Array.isArray(obj.elements)) return JSON.stringify(obj.elements);
        if (isValidMcqObj(obj)) return JSON.stringify([ obj ]);
      } catch {}
    }
    return null;
  }

  function scrapeBestReply(preferLast, minIndex = 0) {
    const nodes = getModelResponseNodes();
    
    // When extracting for a subsequent page (minIndex > 0), focus STRICTLY on turns >= minIndex
    if (nodes.length > minIndex) {
      const newNodes = nodes.slice(minIndex);
      for (let i = newNodes.length - 1; i >= 0; i--) {
        const turn = newNodes[i];
        const codeBlocks = deepQueryAll("code-block, pre, code, [class*='code']", turn);
        for (let c = codeBlocks.length - 1; c >= 0; c--) {
          const cText = (codeBlocks[c].innerText || codeBlocks[c].textContent || "").trim();
          if (cText.length > 20) {
            const qs = extractQuestionsFromText(cText);
            if (qs.length) return "```json\n" + JSON.stringify(qs) + "\n```";
          }
        }
        const text = (turn.innerText || turn.textContent || "").trim();
        if (text.length > 10) {
          const qs = extractQuestionsFromText(text);
          if (qs.length) return "```json\n" + JSON.stringify(qs) + "\n```";
          const j = extractJsonCandidate(text);
          if (j) return j;
        }
      }
      if (newNodes.length) {
        const last = newNodes[newNodes.length - 1];
        return (last.innerText || last.textContent || "").trim();
      }
    }

    // If waiting for Page 2+ but the new turn has not yet rendered, DO NOT scrape old turns!
    if (minIndex > 0) {
      return "";
    }

    // Fallback for initial chat or when model-response tag isn't recognized
    const codeNodes = [ ...deepQueryAll("code-block"), ...deepQueryAll("code"), ...deepQueryAll("pre"), ...deepQueryAll('[class*="code"]') ];
    const codeTexts = codeNodes.map(n => (n.innerText || n.textContent || "").trim()).filter(t => t.length > 10);
    if (codeTexts.length) {
      for (let i = codeTexts.length - 1; i >= 0; i--) {
        const qs = extractQuestionsFromText(codeTexts[i]);
        if (qs.length) return "```json\n" + JSON.stringify(qs) + "\n```";
      }
      return codeTexts[codeTexts.length - 1];
    }

    if (nodes.length) {
      const texts = nodes.map(n => (n.innerText || n.textContent || "").trim()).filter(t => t.length > 20);
      if (texts.length) {
        for (let i = texts.length - 1; i >= 0; i--) {
          const qs = extractQuestionsFromText(texts[i]);
          if (qs.length) return "```json\n" + JSON.stringify(qs) + "\n```";
          if (extractJsonCandidate(texts[i])) return texts[i];
        }
        return texts[texts.length - 1];
      }
    }

    const main = document.querySelector("main") || document.querySelector("chat-app-orchestrator") || document.body;
    const all = (main?.innerText || "").trim();
    return preferLast ? all.slice(-6e4) : all;
  }

  function waitForJsonReplyLive(timeoutMs, requestId, baselineFingerprint, adminTabId, initialReplyCount = 0) {
    return new Promise((resolve, reject) => {
      let lastJson = "";
      let stable = 0;
      let lastLen = 0;
      let idleTicks = 0;
      const started = Date.now();
      let lastProgressAt = 0;
      let sentRetryClick = false;

      const tick = () => {
        if (Date.now() - started > timeoutMs) {
          cleanup();
          const blob = scrapeBestReply(true, initialReplyCount);
          const j = extractJsonCandidate(blob);
          if (j) return resolve(j);
          if (blob && blob.length > 80) return resolve(blob);
          return reject(new Error("Timed out waiting for Gemini reply on this page. Check Gemini tab."));
        }

        const generating = isGenerating();
        const nodes = getModelResponseNodes();
        const hasNewTurn = nodes.length > initialReplyCount;

        // If after 7 seconds no new turn appeared and not generating, retry clicking send
        if (!hasNewTurn && !generating && Date.now() - started > 7000 && !sentRetryClick) {
          sentRetryClick = true;
          const composer = findComposer();
          if (composer) clickSendOrEnter(composer);
        }

        if (!hasNewTurn) {
          if (Date.now() - lastProgressAt > 2500) {
            lastProgressAt = Date.now();
            progress(requestId, "wait", "Waiting for Gemini to start response…", adminTabId);
          }
          return;
        }

        const blob = scrapeBestReply(true, initialReplyCount);
        if (!blob) return;

        if (hasCompletionMarker(blob) && !generating) {
          const j = extractJsonCandidate(blob) || "[]";
          cleanup();
          progress(requestId, "done", "Completion marker received", adminTabId);
          return resolve(j + "\n" + COMPLETE_MARKER);
        }

        const json = extractJsonCandidate(blob);
        if (generating) {
          idleTicks = 0;
          stable = 0;
          if (Date.now() - lastProgressAt > 2000) {
            lastProgressAt = Date.now();
            progress(requestId, "stream", `Gemini generating… ${blob.length} chars`, adminTabId);
          }
        } else if (blob.length === lastLen) {
          idleTicks += 1;
        } else {
          idleTicks = 0;
        }
        lastLen = blob.length;

        if (json) {
          if (json === lastJson) {
            stable += 1;
            if (stable >= 2 && (!generating || idleTicks >= 2)) {
              cleanup();
              progress(requestId, "done", `Captured ${json.length} chars JSON`, adminTabId);
              return resolve(json);
            }
          } else {
            lastJson = json;
            stable = 1;
            progress(requestId, "stream", `JSON found (${json.length} chars), verifying…`, adminTabId);
          }
        } else if (!generating && idleTicks >= 4 && blob.length > 80) {
          // Idle fallback: Gemini finished generating and response stopped changing
          const qs = extractQuestionsFromText(blob);
          if (qs.length) {
            cleanup();
            progress(requestId, "done", `Captured ${qs.length} MCQ objects via idle fallback`, adminTabId);
            return resolve(JSON.stringify(qs));
          }
          const objs = extractBalancedObjects(blob);
          if (objs.length) {
            cleanup();
            progress(requestId, "done", `Captured ${objs.length} objects via fallback`, adminTabId);
            return resolve(`[\n${objs.join(",\n")}\n]`);
          }
          cleanup();
          progress(requestId, "done", `Captured ${blob.length} chars reply (idle fallback)`, adminTabId);
          return resolve(blob);
        }
      };
      const obs = new MutationObserver(() => tick());
      try {
        obs.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true
        });
      } catch {}
      const interval = setInterval(tick, 400);
      const cleanup = () => {
        clearInterval(interval);
        try { obs.disconnect(); } catch {}
      };
      setTimeout(tick, 1000);
    });
  }
})();