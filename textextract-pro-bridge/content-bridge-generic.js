/**
 * TextExtract Pro Bridge — generic content script for DeepSeek / ChatGPT / Claude
 * Version: 2.4.2
 */

(function () {
  const EXT_VER = "2.5.4";
  if (window.__tfStudyAiGenericVer === EXT_VER) return;
  const runtime = window.__studyAiRuntime;
  window.__tfStudyAiGenericVer = EXT_VER;
  const LOG = (...a) => console.log("[TextExtract Bridge Gen]", ...a);
  const COMPLETE_MARKER = "---STUDY_AI_COMPLETE---";
  const sleep = ms => runtime.sleep(ms);

  let port = null;
  function connectKeepalive() {
    try {
      port = chrome.runtime.connect({ name: "study-ai-keepalive" });
      port.onDisconnect.addListener(() => {
        void chrome.runtime?.lastError;
        try { if (port?.error) void port.error; } catch {}
        port = null;
        setTimeout(connectKeepalive, 1200);
      });
    } catch {
      void chrome.runtime?.lastError;
      setTimeout(connectKeepalive, 2000);
    }
  }
  connectKeepalive();

  // Safely rebind onMessage listener on script injection / extension reload
  if (window.__tfStudyAiGenericMsgListener) {
    try {
      chrome.runtime.onMessage.removeListener(window.__tfStudyAiGenericMsgListener);
    } catch {}
  }

  const genericMsgListener = (msg, _s, sendResponse) => {
    if (!msg?.type) return;
    if (msg.type === "STUDY_AI_RUN" || msg.type === "STUDY_AI_CAPTURE") {
      runtime.run(msg, sendResponse, async () => {
        if (msg.type === "STUDY_AI_RUN") await runExtract(msg);
        else report(msg.requestId, true, await runCaptureOnly(msg), null, msg.adminTabId);
      }, report);
      return false;
    }
  };
  window.__tfStudyAiGenericMsgListener = genericMsgListener;
  chrome.runtime.onMessage.addListener(genericMsgListener);

  function progress(requestId, step, detail, adminTabId) {
    try {
      chrome.runtime.sendMessage(
        {
          type: "STUDY_AI_PROGRESS",
          requestId,
          step,
          detail,
          chatUrl: location.href,
          adminTabId: adminTabId || undefined,
        },
        () => void chrome.runtime.lastError,
      );
    } catch {}
    LOG(step, detail || "");
  }

  function report(requestId, ok, text, error, adminTabId) {
    if (!runtime.remember([requestId, ok, text, error, adminTabId])) return;
    const payload = {
      type: "STUDY_AI_RESULT",
      requestId,
      ok,
      text: text || null,
      error: error || null,
      chatUrl: location.href,
      adminTabId: adminTabId || undefined,
    };
    const attempt = (n) => {
      try {
        chrome.runtime.sendMessage(payload, (res) => {
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
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "STUDY_AI_GET_JOB", requestId }, (res) => {
        const fromSw = res?.job || null;
        if (fromSw && (fromSw.prompt || fromSw.fullChat != null || fromSw.adminTabId)) {
          if ((!fromSw.fileBase64 || fromSw.fileBase64 === "[omitted]") && msg?.jobLite?.fileBase64) {
            fromSw.fileBase64 = msg.jobLite.fileBase64;
          }
          return resolve(fromSw);
        }
        if (msg?.jobLite) return resolve({ ...msg.jobLite, requestId });
        resolve(null);
      });
    });
  }

  function startHeartbeat(requestId, adminTabId) {
    const id = setInterval(() => {
      try {
        chrome.runtime.sendMessage({ type: "STUDY_AI_HEARTBEAT", requestId }, () => void chrome.runtime.lastError);
        progress(requestId, "heartbeat", "Bridge alive — waiting for model reply…", adminTabId);
        if (!port) connectKeepalive();
      } catch {}
    }, 8000);
    return () => clearInterval(id);
  }

  function deepQueryAll(selector, root = document) {
    const out = [];
    const visit = (node) => {
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

  function findComposer() {
    const selectors = [
      "#prompt-textarea",
      'div[id="prompt-textarea"]',
      "textarea#chat-input",
      'div.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][data-placeholder]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      'textarea[placeholder*="Message" i]',
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="Send" i]',
      "textarea",
    ];
    for (const sel of selectors) {
      const list = deepQueryAll(sel).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 20 && r.height > 12 && r.bottom > 0 && !el.disabled;
      });
      if (!list.length) continue;
      list.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
      return list[0];
    }
    return null;
  }

  async function waitForComposer(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (findComposer()) return;
      await sleep(350);
    }
    throw new Error("Chat composer not found — login on this AI tab first.");
  }

  function composerText(el) {
    return (el?.innerText || el?.textContent || el?.value || "").replace(/\s+/g, " ").trim();
  }

  function promptNeedle(prompt) {
    const p = String(prompt || "").replace(/\s+/g, " ").trim();
    if (p.includes(COMPLETE_MARKER)) return COMPLETE_MARKER;
    if (p.includes("STUDY_AI_COMPLETE")) return "STUDY_AI_COMPLETE";
    if (p.includes("Universal Document Digitizer")) return "Universal Document Digitizer";
    if (p.includes("Document Digitizer")) return "Document Digitizer";
    if (p.includes("PDF-to-Text")) return "PDF-to-Text";
    if (p.includes("expert Indian exam-paper")) return "expert Indian exam-paper";
    if (p.includes("professional Exam Paper Digitizer")) return "professional Exam Paper Digitizer";
    if (p.includes("STRICT REQUIREMENT:")) return "STRICT REQUIREMENT:";
    if (p.includes("COMPLETE TEXT")) return "COMPLETE TEXT";
    if (p.length > 80) return p.slice(10, 45);
    return p.slice(0, Math.min(24, p.length));
  }

  async function tryEnableDeepSeekExtras() {
    // Best-effort: click Vision / DeepThink toggles if present
    const buttons = deepQueryAll("button, [role='button'], div[class*='button']");
    for (const b of buttons) {
      const t = ((b.getAttribute("aria-label") || "") + " " + (b.textContent || "")).toLowerCase();
      if (/deep.?think|deepthink|r1/.test(t) && !/selected|active|on/i.test(b.className || "")) {
        try {
          b.click();
          await sleep(200);
        } catch {}
      }
      if (/vision|search files|upload/.test(t) && /vision/.test(t)) {
        try {
          b.click();
          await sleep(200);
        } catch {}
      }
    }
  }

  async function injectPrompt(el, prompt) {
    await sleep(250);
    el = findComposer() || el;
    if (!el) {
      await waitForComposer(8000);
      el = findComposer();
    }
    if (!el) throw new Error("Could not find chat composer to inject prompt.");

    el.click();
    el.focus();
    await sleep(200);
    if (/deepseek\.com/i.test(location.href)) await tryEnableDeepSeekExtras();

    const currentText = composerText(findComposer() || el);
    const payload = currentText.length > 0 ? ("\n" + prompt) : prompt;
    const needle = promptNeedle(prompt);
    const hasNeedle = () => {
      const activeEl = findComposer() || el;
      const t = composerText(activeEl);
      if (!t) return false;
      if (t.includes(needle)) return true;
      if (t.includes(String(prompt).slice(0, 24))) return true;
      if (t.includes("Universal Document Digitizer") || t.includes("Document Digitizer")) return true;
      if (t.includes("COMPLETE TEXT") || t.includes("STUDY_AI_COMPLETE")) return true;
      if (t.length > 40 && prompt.length > 40 && t.includes(prompt.slice(20, 50))) return true;
      return false;
    };

    // --- Strategy 1: TEXTAREA / INPUT (DeepSeek, etc.) ---
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      el.focus();
      // Try native execCommand on focused textarea (properly triggers Vue/React listeners)
      try {
        el.select();
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, payload);
      } catch {}
      await sleep(100);

      if (!hasNeedle()) {
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, "value");
        const next = (el.value || "") + (el.value && !payload.startsWith("\n") ? "\n" : "") + payload;
        if (desc?.set) desc.set.call(el, next);
        else el.value = next;

        // Reset React internal tracker if attached
        if (el._valueTracker) {
          try { el._valueTracker.setValue(""); } catch {}
        }
        el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: payload }));
        el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: payload }));
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }

      if (!hasNeedle()) {
        try {
          const dt = new DataTransfer();
          dt.setData("text/plain", payload);
          el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
        } catch {}
      }
      await sleep(150);
      if (hasNeedle()) {
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
    }

    // --- Strategy 2: ContentEditable (ChatGPT, Claude, etc.) ---
    el.focus();
    let targetBlock = el.querySelector("p") || el.querySelector('[contenteditable="true"]') || el;
    targetBlock.focus();

    // Place caret INSIDE targetBlock (crucial for ProseMirror/Lexical schemas)
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(targetBlock);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {}

    // A. Chunked execCommand insertText
    const chunkSize = 1500;
    for (let i = 0; i < payload.length; i += chunkSize) {
      try {
        document.execCommand("insertText", false, payload.slice(i, i + chunkSize));
      } catch {}
      await sleep(25);
    }
    await sleep(150);
    if (hasNeedle()) {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    // B. ClipboardEvent paste on targetBlock
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", payload);
      const safeHtml = `<p>${payload.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>`;
      dt.setData("text/html", safeHtml);
      targetBlock.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }),
      );
      await sleep(200);
    } catch {}
    if (hasNeedle()) {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    // C. InputEvent beforeinput / input
    try {
      targetBlock.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: payload,
        }),
      );
      targetBlock.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: payload.slice(0, 100),
        }),
      );
      await sleep(150);
    } catch {}
    if (hasNeedle()) {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    // D. Safe innerHTML insertion inside target paragraph
    try {
      const esc = payload.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      if (targetBlock.tagName === "P") {
        targetBlock.innerHTML = (targetBlock.innerHTML || "") + esc.replace(/\n/g, "<br>");
      } else {
        const pList = esc.split(/\n/).map((l) => `<p>${l || "<br>"}</p>`).join("");
        el.innerHTML = (el.innerHTML || "") + pList;
      }
      targetBlock.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: payload.slice(0, 80) }));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } catch {}
    await sleep(200);

    if (!hasNeedle()) {
      const t = composerText(findComposer() || el);
      if (t.length > 40 && (isOurPromptText(t) || /digitiz|text|ocr|extract|pdf|markdown|json|question|mcq|exam/i.test(t))) return;
      throw new Error("Could not inject prompt. Click the chat input once, then retry from admin.");
    }
  }

  function findSendButton() {
    // 1. ChatGPT primary selectors
    const chatgptSend = deepQueryAll('button[data-testid="send-button"], button[data-testid="fruitjuice-send-button"], button#send-button')[0];
    if (chatgptSend) return chatgptSend;

    // 2. Buttons in or near composer container
    const composer = findComposer();
    const container = composer?.closest('form, [class*="composer"], [class*="input"], main') || document;
    const buttons = deepQueryAll("button, [role='button'], div[class*='button']", container);

    const exact = buttons.find((b) => {
      const al = (b.getAttribute("aria-label") || "").trim().toLowerCase();
      return /^(send|send message|send prompt|submit|发送)$/i.test(al);
    });
    if (exact) return exact;

    // DeepSeek icon buttons
    const dsBtn = buttons.find((b) => {
      const cls = (b.className || "").toString().toLowerCase();
      const al = (b.getAttribute("aria-label") || "").toLowerCase();
      const testid = (b.getAttribute("data-testid") || "").toLowerCase();
      if (/ds-icon-button|_send|send-btn|chat-submit/i.test(cls)) return true;
      if (/send/i.test(testid)) return true;
      if (al.includes("send") || al.includes("发送")) return true;
      return false;
    });
    if (dsBtn) return dsBtn;

    // Claude and generic SVG send buttons
    const svgSend = buttons.find((b) => {
      const al = (b.getAttribute("aria-label") || b.getAttribute("title") || b.textContent || "").toLowerCase();
      return (al.includes("send") || al === "↑") && !al.includes("stop");
    });
    if (svgSend) return svgSend;

    // 3. Document-wide fallback
    const allButtons = deepQueryAll("button, [role='button']");
    return (
      allButtons.find((b) => /^(send|submit|send message|send prompt)$/i.test((b.getAttribute("aria-label") || "").trim())) ||
      allButtons.find((b) => {
        const al = (b.getAttribute("aria-label") || b.textContent || "").toLowerCase();
        return (al.includes("send") || al === "↑") && !al.includes("stop");
      }) ||
      null
    );
  }

  async function clickSendOrEnter(el) {
    el = findComposer() || el;
    let clicked = false;
    for (let attempt = 0; attempt < 25; attempt++) {
      const send = findSendButton();
      const disabled = !send || send.disabled || send.getAttribute("aria-disabled") === "true";
      if (send && !disabled) {
        send.click();
        clicked = true;
        await sleep(400);
        break;
      }
      await sleep(200);
    }

    // Always fallback to Enter key dispatch if send wasn't clicked or button was stuck disabled
    if (!clicked && el) {
      el.focus();
      const send = findSendButton();
      if (send) {
        try { send.click(); } catch {}
      }
      const enterOpts = {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      };
      el.dispatchEvent(new KeyboardEvent("keydown", enterOpts));
      el.dispatchEvent(new KeyboardEvent("keypress", enterOpts));
      el.dispatchEvent(new KeyboardEvent("keyup", enterOpts));
      await sleep(350);
    }
  }

  function isGenerating() {
    const stopByTestId = deepQueryAll('[data-testid="stop-button"]');
    if (stopByTestId.length > 0) return true;

    const buttons = deepQueryAll("button, [role='button']");
    const hasStop = buttons.some((b) => {
      const al = ((b.getAttribute("aria-label") || "") + " " + (b.getAttribute("title") || "") + " " + (b.textContent || "")).toLowerCase();
      if (/stop generating|stop response|cancel response|stop streaming/i.test(al)) return true;
      if (al === "stop") return true;
      if (b.getAttribute("data-testid") === "stop-button") return true;
      if (b.querySelector(".ds-icon-stop") || b.querySelector("[class*='stop-icon']") || b.querySelector("svg[data-icon='stop']")) return true;
      return false;
    });
    if (hasStop) return true;

    const streamIndicators = deepQueryAll(
      '.streaming, [data-is-streaming="true"], [class*="streaming"], .typing-indicator, ' +
      'span.cursor, .blinking-cursor, .result-streaming, [data-testid*="loading"]'
    ).filter(el => {
      try {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      } catch {
        return false;
      }
    });
    return streamIndicators.length > 0;
  }

  function hasCompletionMarker(text, expectedMarker) {
    if (!text || isOurPromptText(text)) return false;
    if (expectedMarker && typeof expectedMarker === "string" && expectedMarker.length > 5) {
      return String(text).split(/\r?\n/).some(line => line.trim() === expectedMarker);
    }
    const u = String(text).toUpperCase();
    return u.includes(COMPLETE_MARKER) || 
           u.includes("STUDY_AI_COMPLETE") || 
           u.includes("YOUR_TEST_SERIES_JSON_COMPLETED") ||
           u.includes("ALL_QUESTIONS_EXTRACTED_COMPLETELY");
  }

  function isOurPromptText(text) {
    return /Universal Document Digitizer|PDF-to-Text OCR Specialist|COMPLETE TEXT of this PDF page|STUDY_AI_COMPLETE|You are an expert Indian exam-paper|You are a professional Exam Paper Digitizer|You are a professional Document Digitizer|STRICT REQUIREMENT: You MUST fill ALL fields|COMPLETION \(CRITICAL|Schema per item|ADMIN EXTRA:|Continue in THIS same chat with the SAME PDF|Continue SAME chat \+ SAME PDF/i.test(
      text || "",
    );
  }

  function hasStandaloneCompletion(text) {
    if (!text || isOurPromptText(text)) return false;
    if (/"question(?:_[a-z]+)?"\s*:/i.test(text || "")) return false;
    const lines = String(text)
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return lines.some((l) => {
      const u = l.toUpperCase();
      return u === COMPLETE_MARKER || u.includes("STUDY_AI_COMPLETE") || u.includes("YOUR_TEST_SERIES_JSON_COMPLETED");
    });
  }

  /**
   * Sanitizes JSON strings containing unescaped LaTeX (e.g. single backslashes in \%, \$, \frac, \times)
   * so standard JSON.parse does not fail with 'Bad escaped character in JSON'.
   */
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

        // Escaped backslash
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

        // Standard escape letters (\n, \r, \t, \b, \f)
        // If followed by letters (e.g. \frac, \times, \right, \text, \beta), it's a LaTeX command!
        const isWord = /^[a-zA-Z]/.test(afterNext);
        if (/^[nrtbf]/.test(next) && !isWord) {
          out += '\\' + next;
          i++;
          continue;
        }

        // Unicode \uXXXX
        if (next === 'u' && /^[0-9a-fA-F]{4}/.test(jsonStr.slice(i + 2, i + 6))) {
          out += jsonStr.slice(i, i + 6);
          i += 5;
          continue;
        }

        // LaTeX or invalid escape (e.g. \%, \$, \frac, \times, \sqrt, \alpha)
        out += '\\\\';
        continue;
      }

      // Raw unescaped newlines inside strings
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

  /** Recover question objects even from huge / truncated DeepSeek dumps */
  function extractQuestionsFromText(text) {
    if (!text) return [];
    let raw = String(text)
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/(^|\n)\s*json\s*\n\s*(\[)/gi, "$1$2")
      .replace(/^json\s*/i, "")
      .trim();

    const candidates = [];
    const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
    let m;
    while ((m = fenceRe.exec(raw)) !== null) {
      if (m[1] && m[1].trim()) candidates.push(m[1].trim());
    }
    if (!candidates.length) {
      const open = raw.match(/```(?:json)?\s*([\s\S]+)$/i);
      if (open) candidates.push(open[1].trim());
      else candidates.push(raw);
    }

    const isValidMcqObj = (x) =>
      x && (x.question != null || x.question_hi != null || x.question_en != null ||
            x.question_r != null || x.type != null || x.content != null);

    const allQuestions = [];
    const seenSignatures = new Set();

    for (const chunk of candidates) {
      const a0 = chunk.indexOf("[");
      const working = a0 >= 0 ? chunk.slice(a0) : chunk;
      const repaired = repairJsonStringNewlines(working);
      const a1 = repaired.lastIndexOf("]");
      if (repaired.startsWith("[") && a1 > 0) {
        const slice = repaired.slice(0, a1 + 1);
        const parsed = tryParseJsonLoose(slice);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (isValidMcqObj(item)) {
              const sig = (item.question_hi || item.question_en || item.question || item.content || item.question_r || JSON.stringify(item)).slice(0, 60);
              if (!seenSignatures.has(sig)) {
                seenSignatures.add(sig);
                allQuestions.push(item);
              }
            }
          }
        }
      }

      const objs = extractBalancedObjects(repaired);
      for (const o of objs) {
        const p = tryParseJsonLoose(o);
        if (p && isValidMcqObj(p)) {
          const sig = (p.question_hi || p.question_en || p.question || p.content || p.question_r || JSON.stringify(p)).slice(0, 60);
          if (!seenSignatures.has(sig)) {
            seenSignatures.add(sig);
            allQuestions.push(p);
          }
        }
      }
    }

    return allQuestions;
  }

  function extractJsonCandidate(text) {
    const qs = extractQuestionsFromText(text);
    if (qs.length) return JSON.stringify(qs);
    if (!text) return null;
    // Never treat prompt-echo / long chatter as empty complete — only short standalone done
    if (hasStandaloneCompletion(text)) return "[]";
    const t = String(text).trim();
    if (
      t.length < 400 &&
      /^```(?:json)?\s*\[\s*\]\s*```\s*$/i.test(t) &&
      !/"question(?:_[a-z]+)?"\s*:/i.test(t)
    ) {
      return "[]";
    }
    return null;
  }

  async function scrollDeepSeekChat() {
    const root =
      document.querySelector("[class*='scroll']") ||
      document.querySelector("main") ||
      document.scrollingElement ||
      document.body;
    for (let i = 0; i < 16; i++) {
      try {
        root.scrollTop = 0;
      } catch {}
      window.scrollTo(0, 0);
      await sleep(120);
      try {
        root.scrollTop = root.scrollHeight || 999999;
      } catch {}
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(180);
    }
  }

  function getAssistantTurnNodes() {
    let turns = [];
    if (/deepseek\.com/i.test(location.href)) {
      turns = deepQueryAll(".ds-markdown, [class*='message-content']");
    } else if (/(?:chatgpt\.com|chat\.openai\.com)/i.test(location.href)) {
      turns = deepQueryAll('[data-message-author-role="assistant"], article [class*="agent-turn"]');
    } else if (/claude\.ai/i.test(location.href)) {
      turns = deepQueryAll('[data-is-streaming], [class*="font-claude-message"]');
    } else {
      turns = deepQueryAll('[data-message-author-role="assistant"], .markdown');
    }
    if (!turns.length) {
      turns = deepQueryAll("pre code, pre");
    }
    turns = turns.filter(m => !isOurPromptText(m.innerText || m.textContent || ""));
    // Filter out nested child nodes so 1 assistant response = 1 turn node
    return turns.filter((node, idx, arr) => !arr.some(other => other !== node && other.contains(node)));
  }

  function snapshotReplyFingerprint() {
    const turns = getAssistantTurnNodes();
    if (!turns.length) return "0:";
    const last = turns[turns.length - 1];
    const text = runtime.readReply(last);
    return `${turns.length}:${text.length}:${text.slice(-120)}`;
  }

  function getUserPromptNodes() {
    let nodes = [];
    if (/deepseek\.com/i.test(location.href)) {
      const sideList = deepQueryAll(".ds-virtual-list-visible-items div._81e7b5e, div._81e7b5e");
      if (sideList.length) {
        nodes = sideList;
      } else {
        nodes = deepQueryAll("div._72b6158, [class*='user-message'], [class*='user-prompt']");
      }
    } else if (/(?:chatgpt\.com|chat\.openai\.com)/i.test(location.href)) {
      nodes = deepQueryAll('[data-message-author-role="user"]');
    } else if (/claude\.ai/i.test(location.href)) {
      nodes = deepQueryAll('[data-is-streaming="false"][class*="user"], [class*="font-user-message"]');
    } else {
      nodes = deepQueryAll('[data-message-author-role="user"], [class*="user"]');
    }
    const withPrompt = nodes.filter((n) => {
      const t = (n.innerText || n.textContent || "").trim();
      return isOurPromptText(t) || t.includes("Exam Paper Digitizer") || t.includes("STUDY_AI_COMPLETE");
    });
    const pool = withPrompt.length ? withPrompt : nodes;
    return pool.filter((node, idx, arr) => !arr.some((other) => other !== node && other.contains(node)));
  }

  async function findAssistantReplyForPage(targetPageNumber, expectedMarker, requestId, totalPages) {
    const pNum = Number(targetPageNumber) || null;
    const expMarker = expectedMarker ? String(expectedMarker).trim() : null;
    const reqId = requestId ? String(requestId).trim() : null;
    const totPages = Number(totalPages) || null;

    LOG(`[TurnPairing] Searching reply for Page: ${pNum}/${totPages}, marker: ${expMarker}, reqId: ${reqId}`);

    const assistantTurns = getAssistantTurnNodes();
    LOG(`[TurnPairing] Found ${assistantTurns.length} assistant turn nodes`);

    // --- PRIORITY 1: Direct match in Assistant Output (marker or page signature) ---
    if (expMarker) {
      for (let i = assistantTurns.length - 1; i >= 0; i--) {
        const text = runtime.readReply(assistantTurns[i]);
        if (hasCompletionMarker(text, expMarker)) {
          LOG(`[TurnPairing] Priority 1: Found direct marker match on assistant turn #${i}`);
          return text;
        }
      }
    }
    if (expMarker) throw new Error("No reply matches this extraction request yet. Wait for completion or retry this page.");
    if (pNum) {
      const pageTag = `_P${pNum}_`;
      for (let i = assistantTurns.length - 1; i >= 0; i--) {
        const text = runtime.readReply(assistantTurns[i]);
        if (text.includes(pageTag)) {
          LOG(`[TurnPairing] Priority 1b: Found direct page tag (${pageTag}) in assistant turn #${i}`);
          return text;
        }
      }
    }

    // --- PRIORITY 2: User Prompt to Assistant Turn 1-to-1 Pairing ---
    const userNodes = getUserPromptNodes();
    LOG(`[TurnPairing] Found ${userNodes.length} user prompt nodes`);
    let matchedIndex = -1;

    if (userNodes.length > 0) {
      // Step 2A: Content match
      for (let i = 0; i < userNodes.length; i++) {
        const uText = (userNodes[i].innerText || userNodes[i].textContent || "").trim();
        if (expMarker && uText.includes(expMarker)) {
          matchedIndex = i;
          LOG(`[TurnPairing] Priority 2: User prompt #${i} matches expectedMarker`);
          break;
        }
        if (reqId && uText.includes(reqId)) {
          matchedIndex = i;
          LOG(`[TurnPairing] Priority 2: User prompt #${i} matches reqId`);
          break;
        }
        if (pNum && (uText.includes(`[PAGE ${pNum} `) || uText.includes(`_P${pNum}_`))) {
          matchedIndex = i;
          LOG(`[TurnPairing] Priority 2: User prompt #${i} matches page tag P${pNum}`);
          break;
        }
      }

      // Step 2B: Mathematical relative index match if not found by text
      if (matchedIndex === -1 && pNum && pNum > 0) {
        const total = totPages || pNum;
        if (pNum <= total && userNodes.length >= (total - pNum + 1)) {
          matchedIndex = userNodes.length - (total - pNum + 1);
          LOG(`[TurnPairing] Priority 2B: Relative index ${matchedIndex} for Page ${pNum}/${total}`);
        } else if (pNum - 1 < userNodes.length) {
          matchedIndex = pNum - 1;
        } else {
          matchedIndex = userNodes.length - 1;
        }
      }

      // DeepSeek: Clicking the user prompt in the virtual list / sidebar activates and scrolls to that turn
      if (matchedIndex >= 0 && /deepseek\.com/i.test(location.href)) {
        try {
          if (userNodes[matchedIndex]) {
            LOG(`[TurnPairing] DeepSeek: Clicking user turn #${matchedIndex}`);
            userNodes[matchedIndex].click();
            await sleep(500);
          }
        } catch (e) {
          LOG("[TurnPairing] DeepSeek turn click error:", e);
        }
      }

      const freshAssistantTurns = getAssistantTurnNodes();
      const candidateTurns = freshAssistantTurns.length >= assistantTurns.length ? freshAssistantTurns : assistantTurns;

      if (matchedIndex >= 0 && matchedIndex < candidateTurns.length) {
        const t = (candidateTurns[matchedIndex].innerText || candidateTurns[matchedIndex].textContent || "").trim();
        if (t.length > 20 && !isOurPromptText(t)) {
          LOG(`[TurnPairing] Priority 2: Returning paired assistant turn #${matchedIndex}`);
          return t;
        }
      }

      // If exact index wasn't within bounds, check the assistant turn directly following the matched user node
      if (matchedIndex >= 0 && userNodes[matchedIndex]) {
        const uNode = userNodes[matchedIndex];
        const nextTurn = candidateTurns.find(at => 
          (uNode.compareDocumentPosition(at) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
        );
        if (nextTurn) {
          const t = (nextTurn.innerText || nextTurn.textContent || "").trim();
          if (t.length > 20 && !isOurPromptText(t)) {
            LOG(`[TurnPairing] Priority 2b: Returning directly following assistant turn`);
            return t;
          }
        }
      }
    }

    // --- PRIORITY 3: Positional Page Index Mapping (Page 1 -> Turn 0, Page 2 -> Turn 1, etc.) ---
    if (pNum && pNum > 0) {
      const targetIdx = pNum - 1;
      if (targetIdx < assistantTurns.length) {
        const t = (assistantTurns[targetIdx].innerText || assistantTurns[targetIdx].textContent || "").trim();
        if (t.length > 20 && !isOurPromptText(t)) {
          LOG(`[TurnPairing] Priority 3: Returning positional turn #${targetIdx} for Page ${pNum}`);
          return t;
        }
      }
    }

    // --- PRIORITY 4: Fallback to latest assistant turn or best reply ---
    if (assistantTurns.length > 0) {
      for (let i = assistantTurns.length - 1; i >= 0; i--) {
        const last = assistantTurns[i];
        const t = runtime.readReply(last);
        if (t.length > 20 && !isOurPromptText(t)) {
          const qs = extractQuestionsFromText(t);
          if (qs.length) return t;
          if (extractJsonCandidate(t)) return t;
        }
      }
    }

    return scrapeBestReply();
  }

  function scrapeDeepSeek(minIndex = 0, expectedMarker = null) {
    const turns = getAssistantTurnNodes();
    
    // Priority 1: Match expectedMarker if provided
    if (expectedMarker && typeof expectedMarker === "string" && expectedMarker.length > 5) {
      const candidates = (turns.length > minIndex) ? turns.slice(minIndex) : [];
      for (let i = candidates.length - 1; i >= 0; i--) {
        const text = runtime.readReply(candidates[i]);
        if (hasCompletionMarker(text, expectedMarker)) {
          return text;
        }
      }
      if (turns.length > minIndex) {
        const last = turns[turns.length - 1];
        return runtime.readReply(last);
      }
      return "";
    }

    if (turns.length > minIndex) {
      const newTurns = turns.slice(minIndex);
      for (let i = newTurns.length - 1; i >= 0; i--) {
        const text = runtime.readReply(newTurns[i]);
        if (text.length > 10) {
          const qs = extractQuestionsFromText(text);
          if (qs.length) return "```json\n" + JSON.stringify(qs) + "\n```";
          const j = extractJsonCandidate(text);
          if (j) return j;
        }
      }
      const last = newTurns[newTurns.length - 1];
      return runtime.readReply(last);
    }
    // If turns.length <= minIndex (e.g. virtual scrolling unmounted previous turns in DeepSeek), check latest turn
    if (turns.length > 0) {
      const last = turns[turns.length - 1];
      const lastText = runtime.readReply(last);
      if (lastText.length > 20 && !isOurPromptText(lastText)) {
        return lastText;
      }
    }
    if (minIndex > 0) return "";

    const chunks = [];
    const push = (t) => {
      const s = (t || "").trim();
      if (s.length < 20) return;
      if (isOurPromptText(s) && !/"question(?:_[a-z]+)?"\s*:/i.test(s)) return;
      chunks.push(s);
    };

    for (const sel of [
      "pre code",
      "pre",
      ".md-code-block",
      "[class*='code-block']",
      ".ds-markdown pre",
      ".ds-markdown code",
      ".ds-markdown",
      "[class*='ds-markdown']",
      "[class*='markdown-body']",
      "[class*='ds-message']",
      "[class*='message-content']",
      "[class*='hljs']",
    ]) {
      for (const n of deepQueryAll(sel)) push(n.innerText || n.textContent || "");
    }

    // Gather questions from ALL code blocks and chunks, never skip any chunk
    const allQs = [];
    const seenSigs = new Set();
    for (const c of chunks) {
      if (/"question(?:_[a-z]+)?"\s*:/i.test(c) || /"options"\s*:/i.test(c)) {
        const qs = extractQuestionsFromText(c);
        for (const q of qs) {
          const sig = (q.question_hi || q.question_en || q.question || q.content || q.question_r || JSON.stringify(q)).slice(0, 60);
          if (!seenSigs.has(sig)) {
            seenSigs.add(sig);
            allQs.push(q);
          }
        }
      }
    }
    if (allQs.length > 0) {
      return "```json\n" + JSON.stringify(allQs, null, 2) + "\n```";
    }

    // Fallback: join all chunks with questions
    const withQs = chunks.filter((c) => /"question(?:_[a-z]+)?"\s*:/i.test(c));
    if (withQs.length) {
      return withQs.join("\n\n");
    }

    for (let i = chunks.length - 1; i >= 0; i--) {
      if (extractJsonCandidate(chunks[i])) return chunks[i];
    }
    if (chunks.length) return chunks[chunks.length - 1];

    let body = (document.body?.innerText || "").trim();
    body = body
      .split(/\n{3,}/)
      .filter((p) => /"question(?:_[a-z]+)?"\s*:/i.test(p) || !isOurPromptText(p))
      .join("\n\n");
    return body;
  }

  function scrapeBestReply(minIndex = 0, expectedMarker = null) {
    if (/deepseek\.com/i.test(location.href)) return scrapeDeepSeek(minIndex, expectedMarker);

    const turns = getAssistantTurnNodes();

    // Priority 1: Match expectedMarker if provided
    if (expectedMarker && typeof expectedMarker === "string" && expectedMarker.length > 5) {
      const candidates = (turns.length > minIndex) ? turns.slice(minIndex) : [];
      for (let i = candidates.length - 1; i >= 0; i--) {
        const t = runtime.readReply(candidates[i]);
        if (hasCompletionMarker(t, expectedMarker)) {
          return t;
        }
      }
      if (turns.length > minIndex) {
        const last = turns[turns.length - 1];
        return runtime.readReply(last);
      }
      return "";
    }

    if (turns.length > minIndex) {
      const newTurns = turns.slice(minIndex);
      for (let i = newTurns.length - 1; i >= 0; i--) {
        const t = runtime.readReply(newTurns[i]);
        if (extractJsonCandidate(t) || hasStandaloneCompletion(t)) return t;
      }
      const last = newTurns[newTurns.length - 1];
      return runtime.readReply(last);
    }
    if (minIndex > 0) return "";

    const codeTexts = [...deepQueryAll("code"), ...deepQueryAll("pre")]
      .map((n) => (n.innerText || n.textContent || "").trim())
      .filter((t) => t.length > 10 && (!isOurPromptText(t) || /"question(?:_[a-z]+)?"\s*:/i.test(t)));
    for (let i = codeTexts.length - 1; i >= 0; i--) {
      if (extractJsonCandidate(codeTexts[i])) return codeTexts[i];
    }
    const sels = [
      '[data-message-author-role="assistant"]',
      ".markdown",
      ".prose",
      "[class*='assistant']",
      "[class*='response']",
    ];
    const texts = [];
    for (const s of sels) {
      for (const n of deepQueryAll(s)) {
        const t = (n.innerText || "").trim();
        if (t.length > 40 && (!isOurPromptText(t) || /"question(?:_[a-z]+)?"\s*:/i.test(t))) texts.push(t);
      }
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      if (extractJsonCandidate(texts[i]) || hasStandaloneCompletion(texts[i])) return texts[i];
    }
    if (texts.length) return texts[texts.length - 1];
    return (document.body?.innerText || "").slice(-80000);
  }

  function packQuestionsForReport(text) {
    const qs = extractQuestionsFromText(text);
    if (qs.length) {
      return "```json\n" + JSON.stringify(qs) + "\n```";
    }
    const j = extractJsonCandidate(text);
    if (j && j !== "[]") return "```json\n" + j + "\n```";
    return text;
  }

  async function reportSafe(requestId, text, adminTabId) {
    const packed = text; // Already validated; preserve text elements and completion marker.
    // Large payloads often fail chrome.runtime messaging — clipboard fallback
    if (packed && packed.length > 700000) {
      try {
        await navigator.clipboard.writeText(packed);
      } catch {}
      report(
        requestId,
        false,
        null,
        "Reply too large for bridge relay — JSON copied to clipboard. Use Paste JSON in admin.",
        adminTabId,
      );
      return;
    }
    report(requestId, true, packed, null, adminTabId);
  }

  /** Merge every question object found across chat bubbles (full-chat). */
  function scrapeAllQuestionJson() {
    const chunks = [];
    const seen = new Set();
    const pushChunk = (t) => {
      const s = (t || "").trim();
      if (s.length < 20) return;
      if (isOurPromptText(s) && !/"question(?:_[a-z]+)?"\s*:/i.test(s)) return;
      if (seen.has(s.slice(0, 200) + ":" + s.length)) return;
      seen.add(s.slice(0, 200) + ":" + s.length);
      chunks.push(s);
    };
    for (const sel of [
      ".ds-markdown",
      "[class*='ds-markdown']",
      "[class*='markdown-body']",
      "pre",
      "code",
      "[class*='code-block']",
      '[data-message-author-role="assistant"]',
      ".markdown",
      ".prose",
    ]) {
      for (const n of deepQueryAll(sel)) pushChunk(n.innerText || n.textContent || "");
    }
    pushChunk(scrapeBestReply());
    const byKey = new Map();
    for (const c of chunks) {
      for (const q of extractQuestionsFromText(c)) {
        const key = String(q.question || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        if (!key || byKey.has(key)) continue;
        byKey.set(key, q);
      }
    }
    return [...byKey.values()];
  }

  function isJsonCompleteAndBalanced(text) {
    if (!text) return false;
    const t = text.trim();
    if (!/"question(?:_[a-z]+)?"\s*:/i.test(t)) return false;

    // Code fence check: if odd count of ```, code block is still open and streaming!
    const fenceMatches = t.match(/```/g);
    if (fenceMatches && fenceMatches.length % 2 !== 0) return false;

    let inStr = false;
    let esc = false;
    let squareDepth = 0;
    let curlyDepth = 0;
    let seenOpen = false;

    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (!inStr) {
        if (c === "[") { squareDepth++; seenOpen = true; }
        else if (c === "]") { squareDepth--; }
        else if (c === "{") { curlyDepth++; seenOpen = true; }
        else if (c === "}") { curlyDepth--; }
      }
    }
    return seenOpen && squareDepth === 0 && curlyDepth === 0;
  }

  async function waitForJsonReplyLive(timeoutMs, requestId, baseline, adminTabId, initialReplyCount = 0, expectedMarker = null, responseFormat = "json") {
    const deadline = Date.now() + timeoutMs;
    let lastText = "";
    let changedAt = Date.now();
    let progressAt = 0;
    while (Date.now() < deadline) {
      await sleep(500);
      const nodes = getAssistantTurnNodes();
      // Only new assistant turns may satisfy a new page request.
      const markedNode = expectedMarker ? nodes.find(node => hasCompletionMarker(node.innerText || node.textContent || "", expectedMarker)) : null;
      if (nodes.length <= initialReplyCount && !markedNode) continue;
      const blob = markedNode ? runtime.readReply(markedNode) : scrapeBestReply(initialReplyCount, expectedMarker);
      if (!blob || isOurPromptText(blob)) continue;
      if (expectedMarker && /---STUDY_AI_COMPLETE[^\r\n]*---/.test(blob) && !hasCompletionMarker(blob, expectedMarker)) continue;
      if (blob !== lastText) { lastText = blob; changedAt = Date.now(); }
      const stableFor = Date.now() - changedAt;
      if (Date.now() - progressAt > 3000) {
        progressAt = Date.now();
        progress(requestId, "stream", "Reading response (" + blob.length + " chars)...", adminTabId);
      }
      if (isGenerating()) continue;
      if (responseFormat === "text" && stableFor >= 5000) return blob;
      const json = runtime.completeJson(blob);
      const marked = hasCompletionMarker(blob, expectedMarker);
      if (json !== null && stableFor >= (marked ? 1500 : 5000)) {
        // Preserve real completion evidence, never manufacture the marker.
        return json + (marked ? "\n" + (expectedMarker || COMPLETE_MARKER) : "");
      }
      // Marker + stopped generation + stable text means the reply is finished
      if (json === null && marked && stableFor >= 2000) {
        const recovered = extractQuestionsFromText(blob);
        if (recovered.length) {
          return "```json\n" + JSON.stringify(recovered, null, 2) + "\n```\n" + (expectedMarker || COMPLETE_MARKER);
        }
        // Universal full-text or markdown output
        return blob;
      }
      if (stableFor >= 15000 && json === null) {
        if (!isGenerating() && blob && blob.length > 30) {
          return blob;
        }
        throw new Error("AI reply was found but its JSON format could not be read yet. After generation finishes, use Recapture or paste the code block with Paste CSV / JSON.");
      }
    }
    throw new Error("Timed out waiting for a complete AI reply. Partial output was not accepted; check the AI tab.");
  }

  const ATTACHMENT_CHIP_SELECTOR = '[data-testid*="file-preview"], [data-testid*="attachment"], [class*="attachment-preview"], ' +
    '[class*="file-preview"], [class*="uploaded-file"], [class*="file-chip"]';

  // Count real attachment chips only. Treating any nearby "remove/close" control as proof of an
  // upload let pages be sent with no image at all.
  function attachmentChips() {
    const composer = findComposer();
    const container = composer?.closest('form, [class*="composer"], main') || document;
    const visible = el => {
      try {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      } catch { return false; }
    };
    const chips = deepQueryAll(ATTACHMENT_CHIP_SELECTOR, container).filter(visible);
    const outer = chips.filter((chip, _i, arr) => !arr.some(other => other !== chip && other.contains(chip)));
    if (outer.length) return outer;
    return deepQueryAll('button[aria-label*="remove file" i], button[aria-label*="remove attachment" i], button[data-testid*="remove-file"]', container).filter(visible);
  }

  function countAttachments() {
    return attachmentChips().length;
  }

  async function clearComposerAttachments(timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const chips = attachmentChips();
      if (!chips.length) return true;
      for (const chip of chips) {
        const remove = chip.matches?.("button") ? chip
          : chip.querySelector?.('button[aria-label*="remove" i], button[aria-label*="delete" i], button[data-testid*="remove"]');
        try { remove?.click(); } catch {}
      }
      await sleep(350);
    }
    return countAttachments() === 0;
  }

  async function waitForNewAttachment(baseline, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (countAttachments() > baseline) {
        await sleep(600);
        if (countAttachments() > baseline) return true;
      }
      await sleep(300);
    }
    return false;
  }

  async function pastePdf(job) {
    if (!job?.fileBase64) return false;
    try {
      const raw = String(job.fileBase64).replace(/^data:[^;]+;base64,/, "");

      // Auto-detect actual file type from binary signature
      let detectedMime = job.mimeType || "image/png";
      let detectedExt = "png";
      if (raw.startsWith("/9j/") || raw.startsWith("/9J/")) {
        detectedMime = "image/jpeg";
        detectedExt = "jpg";
      } else if (raw.startsWith("iVBORw")) {
        detectedMime = "image/png";
        detectedExt = "png";
      } else if (raw.startsWith("JVBERi0")) {
        detectedMime = "application/pdf";
        detectedExt = "pdf";
      } else if (raw.startsWith("UklGR")) {
        detectedMime = "image/webp";
        detectedExt = "webp";
      }

      let finalName = job.fileName || `page.${detectedExt}`;
      if (detectedMime?.startsWith("image/") && (finalName.toLowerCase().endsWith(".txt") || !finalName.includes("."))) {
        finalName = finalName.replace(/\.txt$/i, "") + `.${detectedExt}`;
      }

      const binary = atob(raw);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], finalName, {
        type: detectedMime,
      });

      await clearComposerAttachments();

      // 1. Try file input assign first (cleanest React file upload)
      let inputs = deepQueryAll('input[type="file"]');
      if (!inputs.length) {
        const attachBtns = deepQueryAll('button, [role="button"]').filter((b) => {
          const t = (
            (b.getAttribute("aria-label") || "") +
            " " +
            (b.getAttribute("data-testid") || "") +
            " " +
            (b.textContent || "")
          ).toLowerCase();
          return /attach|upload|file|image|add content/i.test(t);
        });
        for (const b of attachBtns.slice(0, 2)) {
          try {
            b.click();
          } catch {}
          await sleep(250);
        }
        inputs = deepQueryAll('input[type="file"]');
      }

      const el = findComposer();
      // Each method must prove a NEW chip appeared. Reporting success on an unchanged composer
      // sent pages with no image, which is why runs died a few pages in.
      const baseline = countAttachments();
      if (inputs.length) {
        const input = inputs[inputs.length - 1];
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new Event("input", { bubbles: true }));
        LOG("Attached via input[type=file]:", finalName);
        if (await waitForNewAttachment(baseline, 12000)) return true;
      }

      // 2. Fallback: Try HTML5 native Drag & Drop directly on composer
      if (el) {
        try {
          const dt = new DataTransfer();
          dt.items.add(file);
          const evInit = { bubbles: true, cancelable: true, dataTransfer: dt };
          el.dispatchEvent(new DragEvent("dragenter", evInit));
          el.dispatchEvent(new DragEvent("dragover", evInit));
          el.dispatchEvent(new DragEvent("drop", evInit));
          LOG("Attached via HTML5 drop:", finalName);
          if (await waitForNewAttachment(baseline, 8000)) return true;
        } catch {}
      }

      // 3. Fallback: Try clipboard write if window is active
      try {
        window.focus();
        await navigator.clipboard.write([ new ClipboardItem({ [file.type]: file }) ]);
        if (el) {
          el.focus();
          document.execCommand("paste");
          LOG("Attached via clipboard paste:", finalName);
          if (await waitForNewAttachment(baseline, 8000)) return true;
        }
      } catch {}

      return false;
    } catch (e) {
      LOG("pdf paste failed", e);
      return false;
    }
  }

  async function waitForAttachmentReady(timeoutMs = 30000) {
    const start = Date.now();
    await sleep(1000);
    while (Date.now() - start < timeoutMs) {
      const uploading = deepQueryAll(
        '[class*="upload-progress"], [class*="uploading"], [aria-label*="uploading" i], ' +
        '[class*="file-uploading"], .animate-spin, svg[class*="loading"], [data-testid*="loading"]'
      );
      if (uploading.length > 0) {
        LOG("Attachment upload still in progress in chat UI, waiting...");
        await sleep(600);
        continue;
      }
      // Give UI 1s to finalize attached state
      await sleep(1000);
      return true;
    }
    return false;
  }

  async function runExtract(msg) {
    const requestId = msg.requestId;
    const job = (await getJob(requestId, msg)) || msg.jobLite;
    const adminTabId = msg.adminTabId || job?.adminTabId;
    if (!job?.prompt) throw new Error("Job missing — restart extract from admin.");
    const stopHb = startHeartbeat(requestId, adminTabId);
    try {
      // ALWAYS ensure previous generation has completely finished before proceeding!
      let waitGenSec = 0;
      while (isGenerating() && waitGenSec < 90) {
        LOG("Ongoing generation detected — waiting for chat to become idle...");
        progress(requestId, "wait", "Previous generation still completing in chat… please wait", adminTabId);
        await sleep(1000);
        waitGenSec++;
      }
      runtime.check();
      if (isGenerating()) throw new Error("AI chat is still generating. Wait for it to finish, then retry.");

      if (!job.continueChat) {
        try {
          const turns = getAssistantTurnNodes();
          if (turns.length > 0) {
            const newChatBtn = deepQueryAll('button, a, [role="button"]').find(b => {
              const label = ((b.getAttribute("aria-label") || "") + " " + (b.title || "") + " " + (b.textContent || "")).toLowerCase();
              return label.includes("new chat") || label.includes("start new") || label.includes("new conversation");
            });
            if (newChatBtn) {
              LOG("Clicking New chat to isolate page extraction");
              newChatBtn.click();
              await sleep(1000);
            }
          }
        } catch (e) {
          LOG("Error during new chat guard/click:", e);
        }
      }

      progress(requestId, "composer", "Waiting for chat input…", adminTabId);
      await waitForComposer(90000);
      const el = findComposer();
      if (!el) throw new Error("Composer not found — login first.");
      const skipPdf = !!job.skipPdf && !job.fileBase64;
      const initialReplyCount = getAssistantTurnNodes().length;
      const baseline = snapshotReplyFingerprint();
      const needsImage = !skipPdf && !!job.fileBase64;
      if (needsImage) {
        // A single upload can silently drop mid-run; retrying on a cleaned composer is cheaper
        // than failing the page.
        let attached = false;
        for (let attempt = 1; attempt <= 3 && !attached; attempt++) {
          runtime.check();
          progress(requestId, "pdf", `Attaching image for page (${job.fileName || 'page'})${attempt > 1 ? ` — retry ${attempt - 1}` : ''}…`, adminTabId);
          attached = await pastePdf(job);
          if (!attached) {
            await clearComposerAttachments();
            await sleep(800);
          }
        }
        if (!attached) throw new Error("Could not attach the page image after 3 attempts. Check upload support in the selected AI chat, remove any stuck attachment, then retry.");
        progress(requestId, "pdf", "Waiting for image upload to complete…", adminTabId);
        if (!await waitForAttachmentReady(30000)) throw new Error("Image upload not confirmed. Retry this page after checking the AI tab.");
        await sleep(800);
      }
      runtime.check();
      progress(requestId, "prompt", "Injecting prompt…", adminTabId);
      await injectPrompt(findComposer() || el, job.prompt);
      await sleep(600);
      runtime.check();
      // An image-less send wastes the turn and answers about the previous page's image.
      if (needsImage && countAttachments() < 1) {
        throw new Error("Image attachment disappeared before sending. Retry this page.");
      }
      progress(requestId, "send", "Sending…", adminTabId);
      await clickSendOrEnter(findComposer() || el);

      // Verify send initiated
      let sendConfirmed = false;
      const sendWaitStart = Date.now();
      while (Date.now() - sendWaitStart < 6000) {
        if (isGenerating() || getAssistantTurnNodes().length > initialReplyCount) {
          sendConfirmed = true;
          break;
        }
        await sleep(500);
      }
      if (!sendConfirmed && !isGenerating()) {
        const composer = findComposer();
        const compText = composer ? (composer.innerText || composer.value || "").trim() : "";
        if (compText.length > 20) {
          LOG("Composer still has prompt text, re-clicking send...");
          await clickSendOrEnter(composer || el);
        }
      }

      progress(requestId, "wait", "Waiting for AI reply…", adminTabId);
      const expectedMarker = job.expectedMarker || msg.expectedMarker || null;
      const text = await waitForJsonReplyLive(180000, requestId, baseline, adminTabId, initialReplyCount, expectedMarker, job.responseFormat);
      progress(requestId, "done", `Captured ${text.length} chars`, adminTabId);
      await reportSafe(requestId, text, adminTabId);
    } finally {
      stopHb();
    }
  }

  async function runCaptureOnly(msg) {
    const job = (await getJob(msg.requestId, msg)) || msg.jobLite || {};
    const adminTabId = msg.adminTabId || job.adminTabId;
    const fullChat = !!(msg.fullChat || job.fullChat);
    const stopHb = startHeartbeat(msg.requestId, adminTabId);
    try {
      const start = Date.now();
      while (Date.now() - start < 1500 && isGenerating()) {
        await sleep(250);
      }
      progress(
        msg.requestId,
        "capture",
        fullChat ? "Scrolling chat + scraping every JSON batch…" : "Scraping latest reply…",
        adminTabId,
      );
      if (fullChat) {
        await scrollDeepSeekChat();
      } else {
        try {
          window.scrollTo(0, document.body.scrollHeight || 999999);
        } catch {}
        await sleep(100);
      }

      if (!fullChat && isGenerating()) throw new Error("AI is still generating. Wait for completion, then capture again.");
      const targetPageNumber = msg.pageNumber || job.pageNumber || null;
      const totalPages = msg.totalPages || job.totalPages || null;
      const expectedMarker = msg.expectedMarker || job.expectedMarker || null;
      const requestId = msg.requestId || job.requestId || null;

      let replyText = "";
      if (!fullChat) {
        replyText = await findAssistantReplyForPage(targetPageNumber, expectedMarker, requestId, totalPages);
      } else {
        const allQs = scrapeAllQuestionJson();
        if (allQs.length) {
          progress(msg.requestId, "done", `Found ${allQs.length} question(s)`, adminTabId);
          return "```json\n" + JSON.stringify(allQs, null, 2) + "\n```";
        }
        replyText = scrapeBestReply();
      }

      const validated = runtime.completeJson(replyText);
      if (validated !== null) return validated;
      if (expectedMarker) {
        // The marker proves this reply finished, so the lenient reader cannot pick up a partial stream.
        const marked = extractQuestionsFromText(replyText);
        if (marked.length) {
          progress(msg.requestId, "done", `Captured ${marked.length} question(s) for Page ${targetPageNumber || ""}`, adminTabId);
          return "```json\n" + JSON.stringify(marked, null, 2) + "\n```\n" + expectedMarker;
        }
        if (hasStandaloneCompletion(replyText)) return "```json\n[]\n```\n" + expectedMarker;
        throw new Error("The matching page reply was found, but its JSON format could not be read. Copy its code block and use Paste CSV / JSON to recover it.");
      }
      if (!replyText || replyText.length < 20) throw new Error("No reply to capture yet.");
      if (isOurPromptText(replyText) && !extractJsonCandidate(replyText)) {
        throw new Error("Only prompt text found — wait for AI reply, then Capture again.");
      }
      if (hasStandaloneCompletion(replyText) && !/"question"\s*:/i.test(replyText)) {
        return "```json\n[]\n```\n" + (expectedMarker || COMPLETE_MARKER);
      }

      const qs = extractQuestionsFromText(replyText);
      if (qs.length) {
        progress(msg.requestId, "done", `Captured ${qs.length} question(s) for Page ${targetPageNumber || ""}`, adminTabId);
        return "```json\n" + JSON.stringify(qs, null, 2) + "\n```";
      }

      const j = extractJsonCandidate(replyText);
      if (j && j !== "[]") return "```json\n" + j + "\n```";
      if (/"question"\s*:/i.test(replyText)) return replyText;
      if (replyText && replyText.length > 30 && !isOurPromptText(replyText)) {
        progress(msg.requestId, "done", `Scraped text content (${replyText.length} chars)`, adminTabId);
        return replyText;
      }

      throw new Error(
        "No reply content found in chat DOM for this page. Please wait for AI to finish, or click Paste CSV."
      );
    } finally {
      stopHb();
    }
  }
})();
