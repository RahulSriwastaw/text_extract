/**
 * TextExtract Pro Bridge
 * Version: 2.4.2
 */

(function() {
  const EXT_VER = "2.5.15";
  if (window.__tfStudyAiGeminiVer === EXT_VER) return;
  const runtime = window.__studyAiRuntime;
  window.__tfStudyAiGeminiVer = EXT_VER;
  window.__tfStudyAiGeminiBound = true;
  const LOG = (...a) => console.log("[TextExtract Bridge Gemini]", ...a);
  const COMPLETE_MARKER = "---STUDY_AI_COMPLETE---";
  const sleep = ms => runtime.sleep(ms);
  function isOurPromptText(text) {
    return /Universal Document Digitizer|PDF-to-Text OCR Specialist|COMPLETE TEXT of this PDF page|You are an expert Indian exam-paper|You are a professional Exam Paper Digitizer|You are a professional Document Digitizer|STRICT REQUIREMENT: You MUST fill ALL fields|COMPLETION \(CRITICAL|Schema per item|ADMIN EXTRA:|Continue in THIS same chat with the SAME PDF|Continue SAME chat \+ SAME PDF/i.test(text || "");
  }
  let port = null;
  function connectKeepalive() {
    try {
      port = chrome.runtime.connect({
        name: "study-ai-keepalive"
      });
      port.onDisconnect.addListener(() => {
        void chrome.runtime?.lastError;
        try { if (port?.error) void port.error; } catch {}
        port = null;
        setTimeout(connectKeepalive, 1200);
      });
    } catch {
      void chrome.runtime?.lastError;
      setTimeout(connectKeepalive, 2e3);
    }
  }
  connectKeepalive();

  // Safely rebind onMessage listener on every script execution / extension reload
  if (window.__tfStudyAiGeminiMsgListener) {
    try {
      chrome.runtime.onMessage.removeListener(window.__tfStudyAiGeminiMsgListener);
    } catch {}
  }

  const geminiMsgListener = (msg, _sender, sendResponse) => {
    if (!msg?.type) return;
    if (msg.type === "STUDY_AI_RUN" || msg.type === "STUDY_AI_CAPTURE") {
      runtime.run(msg, sendResponse, async () => {
        if (msg.type === "STUDY_AI_RUN") await runExtract(msg);
        else report(msg.requestId, true, await runCaptureOnly(msg), null, msg.adminTabId);
      }, report);
      return false;
    }
  };
  window.__tfStudyAiGeminiMsgListener = geminiMsgListener;
  chrome.runtime.onMessage.addListener(geminiMsgListener);
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
    if (!runtime.remember([requestId, ok, text, error, adminTabId])) return;
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
    let list = deepQueryAll("model-response");
    if (!list.length) {
      list = deepQueryAll('[data-message-author-role="model"]');
    }
    if (!list.length) {
      list = deepQueryAll(".model-response-text, .response-content");
    }
    // Filter out prompt text and deduplicate nested child nodes to ensure 1 node per response turn
    list = list.filter(m => !isOurPromptText(m.innerText || m.textContent || ""));
    return list.filter((node, idx, arr) => !arr.some(other => other !== node && other.contains(node)));
  }

  function getUserQueryNodes() {
    let nodes = deepQueryAll("user-query, [data-message-author-role='user'], .user-query, [class*='user-query']");
    const withPrompt = nodes.filter(n => {
      const t = (n.innerText || n.textContent || "").trim();
      return isOurPromptText(t) || t.includes("Exam Paper Digitizer") || t.includes("STUDY_AI_COMPLETE");
    });
    const pool = withPrompt.length ? withPrompt : nodes;
    return pool.filter((node, idx, arr) => !arr.some(other => other !== node && other.contains(node)));
  }

  function findAssistantReplyForPage(targetPageNumber, expectedMarker, requestId, totalPages) {
    const pNum = Number(targetPageNumber) || null;
    const expMarker = expectedMarker ? String(expectedMarker).trim() : null;
    const reqId = requestId ? String(requestId).trim() : null;
    const totPages = Number(totalPages) || null;

    LOG(`[GeminiTurnPairing] Page: ${pNum}/${totPages}, marker: ${expMarker}, reqId: ${reqId}`);
    const modelTurns = getModelResponseNodes();

    // Priority 1: Direct marker match in model-response
    if (expMarker) {
      for (let i = modelTurns.length - 1; i >= 0; i--) {
        const turnText = runtime.readReply(modelTurns[i]);
        if (hasCompletionMarker(turnText, expMarker)) {
          LOG(`[GeminiTurnPairing] Priority 1: Direct marker match on turn #${i}`);
          return turnText;
        }
      }
    }
    if (expMarker) throw new Error("No reply matches this extraction request yet. Wait for completion or retry this page.");
    if (pNum) {
      const pageTag = `_P${pNum}_`;
      for (let i = modelTurns.length - 1; i >= 0; i--) {
        const turnText = runtime.readReply(modelTurns[i]);
        if (turnText.includes(pageTag)) {
          LOG(`[GeminiTurnPairing] Priority 1b: Found page tag (${pageTag}) in turn #${i}`);
          return turnText;
        }
      }
    }

    // Priority 2: User-query to Model-response pairing
    const userNodes = getUserQueryNodes();
    let matchedIndex = -1;
    if (userNodes.length > 0) {
      for (let i = 0; i < userNodes.length; i++) {
        const uText = (userNodes[i].innerText || userNodes[i].textContent || "").trim();
        if (expMarker && uText.includes(expMarker)) { matchedIndex = i; break; }
        if (reqId && uText.includes(reqId)) { matchedIndex = i; break; }
        if (pNum && (uText.includes(`[PAGE ${pNum} `) || uText.includes(`_P${pNum}_`))) { matchedIndex = i; break; }
      }

      if (matchedIndex === -1 && pNum && pNum > 0) {
        const total = totPages || pNum;
        if (pNum <= total && userNodes.length >= (total - pNum + 1)) {
          matchedIndex = userNodes.length - (total - pNum + 1);
        } else if (pNum - 1 < userNodes.length) {
          matchedIndex = pNum - 1;
        } else {
          matchedIndex = userNodes.length - 1;
        }
      }

      if (matchedIndex >= 0 && matchedIndex < modelTurns.length) {
        const t = (modelTurns[matchedIndex].innerText || modelTurns[matchedIndex].textContent || "").trim();
        if (t.length > 20 && !isOurPromptText(t)) {
          LOG(`[GeminiTurnPairing] Priority 2: Paired model turn #${matchedIndex}`);
          return t;
        }
      }
    }

    // Priority 3: Positional Page Index Mapping (Page 1 -> Turn 0, Page 2 -> Turn 1, etc.)
    if (pNum && pNum > 0) {
      const targetIdx = pNum - 1;
      if (targetIdx < modelTurns.length) {
        const t = (modelTurns[targetIdx].innerText || modelTurns[targetIdx].textContent || "").trim();
        if (t.length > 20 && !isOurPromptText(t)) {
          LOG(`[GeminiTurnPairing] Priority 3: Positional turn #${targetIdx} for Page ${pNum}`);
          return t;
        }
      }
    }

    // Priority 4: Latest model turn
    if (modelTurns.length > 0) {
      for (let i = modelTurns.length - 1; i >= 0; i--) {
        const t = runtime.readReply(modelTurns[i]);
        if (t.length > 20 && !isOurPromptText(t)) return t;
      }
    }

    return scrapeBestReply(true);
  }

  function snapshotReplyFingerprint() {
    const nodes = getModelResponseNodes();
    if (!nodes.length) return "0:";
    const last = nodes[nodes.length - 1];
    const text = runtime.readReply(last);
    return `${nodes.length}:${text.length}:${text.slice(-120)}`;
  }

  async function runExtract(msg) {
    const requestId = msg.requestId;
    const job = await getJob(requestId, msg) || msg.jobLite;
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
          const existingTurns = getModelResponseNodes();
          if (existingTurns.length > 0) {
            const newChatBtn = deepQueryAll('button, a, [role="button"]').find(b => {
              const label = ((b.getAttribute("aria-label") || "") + " " + (b.title || "") + " " + (b.textContent || "")).toLowerCase();
              return (label.includes("new chat") || label.includes("start new") || label.includes("नयी बातचीत") || label.includes("नई चैट")) && !label.includes("history");
            });
            if (newChatBtn) {
              LOG("Starting clean new chat for fresh page extraction");
              newChatBtn.click();
              await sleep(1000);
            }
          }
        } catch (e) {
          LOG("Error during new chat guard/click:", e);
        }
      }

      progress(requestId, "composer", "Waiting for input…", adminTabId);
      await waitForComposer(9e4);
      const el = findComposer();
      if (!el) throw new Error("Composer not found — login on the bridge tab, then retry.");
      const skipPdf = !!job.skipPdf && !job.fileBase64;
      const initialReplyCount = getModelResponseNodes().length;
      const initialUserTurns = getUserQueryNodes().length;
      const baseline = snapshotReplyFingerprint();
      const needsImage = !skipPdf && !!job.fileBase64;
      if (needsImage) {
        // Retry the whole attach cycle on a cleaned composer. A single upload can silently drop
        // mid-run; retrying here is far cheaper than failing the page and losing the chat turn.
        let attached = false;
        for (let attempt = 1; attempt <= 3 && !attached; attempt++) {
          runtime.check();
          progress(requestId, "pdf", attempt === 1 ? "Attaching page image…" : `Attaching page image (retry ${attempt - 1})…`, adminTabId);
          attached = await pastePdfIntoComposer(findComposer() || el, job);
          if (!attached) {
            await clearComposerAttachments();
            await sleep(800);
          }
        }
        if (!attached) throw new Error("Image upload not confirmed after 3 attempts. Open the AI tab, remove any stuck attachment, then retry this page.");
        progress(requestId, "pdf", "Image attached — waiting for thumbnail and upload completion…", adminTabId);
        await waitForAttachmentReady(35000);
        await sleep(500);
      } else if (!skipPdf && job.pdfOnClipboard) {
        progress(requestId, "pdf", "Ctrl+V from clipboard…", adminTabId);
        const baseline = countAttachments();
        await focusAndPaste(el);
        if (!await waitForAttachment("", 30000, baseline)) throw new Error("Clipboard upload not confirmed. Attach the image and retry.");
      }
      runtime.check();
      progress(requestId, "prompt", "Injecting extraction prompt…", adminTabId);
      let promptStuck = false;
      for (let attempt = 1; attempt <= 3 && !promptStuck; attempt++) {
        await injectPromptKeepAttachments(findComposer() || el, job.prompt);
        await sleep(500);
        runtime.check();
        promptStuck = verifyComposerHasPrompt(job.prompt);
        if (!promptStuck) {
          LOG(`Prompt did not stick after injection attempt ${attempt} — retrying...`);
          progress(requestId, "prompt", `Prompt was cleared — retrying (${attempt})…`, adminTabId);
          await sleep(400);
        }
      }
      if (!promptStuck) {
        throw new Error("Prompt text kept getting cleared from the Gemini input before sending. Click the chat box once, then retry this page.");
      }
      // Last check before the turn is spent: an image-less or prompt-less send wastes the page
      // and returns an answer about the previous image.
      if (needsImage && countAttachments() < Math.max(1, jobImageList(job).length)) {
        throw new Error("Image attachment disappeared before sending. Retry this page.");
      }
      progress(requestId, "send", "Sending to Gemini…", adminTabId);
      let sent = await submitPrompt(findComposer() || el, initialUserTurns, initialReplyCount, requestId, adminTabId);
      if (!sent) {
        // Re-inject once (Gemini may have dropped the text when the upload finished), then retry.
        LOG("Nothing was sent — re-injecting prompt and retrying submit.");
        progress(requestId, "send", "Send did not go through — re-typing prompt and retrying…", adminTabId);
        await injectPromptKeepAttachments(findComposer() || el, job.prompt);
        await sleep(500);
        runtime.check();
        sent = await submitPrompt(findComposer() || el, initialUserTurns, initialReplyCount, requestId, adminTabId);
      }
      if (!sent) {
        throw new Error("Prompt was typed but Gemini did not send it (Send button stayed disabled). Click once inside the Gemini chat box, then retry this page. [" + sendDiagnostics() + "]");
      }
      progress(requestId, "wait", "Waiting for Gemini reply…", adminTabId);
      const expectedMarker = job.expectedMarker || msg.expectedMarker || null;
      const text = await waitForJsonReplyLive(18e4, requestId, baseline, adminTabId, initialReplyCount, expectedMarker, job.responseFormat);
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
      while (Date.now() - start < 1500 && isGenerating()) {
        await sleep(250);
      }
      if (fullChat) {
        await scrollChatToLoadAll(msg.requestId, adminTabId);
        const packed = scrapeAllJsonFromChat(msg.requestId, adminTabId);
        if (!packed || packed.length < 20) {
          throw new Error("No JSON found in this chat. Open the extract thread, wait for replies, then Recapture complete chat.");
        }
        progress(msg.requestId, "done", `Full chat packed ${packed.length} chars`, adminTabId);
        return packed;
      }
      if (!fullChat && isGenerating()) throw new Error("AI is still generating. Wait for completion, then capture again.");
      const targetPageNumber = msg.pageNumber || job.pageNumber || null;
      const totalPages = msg.totalPages || job.totalPages || null;
      const expectedMarker = msg.expectedMarker || job.expectedMarker || null;
      const requestId = msg.requestId || job.requestId || null;

      let text = "";
      if (!fullChat) {
        text = findAssistantReplyForPage(targetPageNumber, expectedMarker, requestId, totalPages);
      } else {
        await scrollChatToLoadAll(msg.requestId, adminTabId);
        const packed = scrapeAllJsonFromChat(msg.requestId, adminTabId);
        if (!packed || packed.length < 20) {
          throw new Error("No JSON found in this chat. Open the extract thread, wait for replies, then Recapture complete chat.");
        }
        progress(msg.requestId, "done", `Full chat packed ${packed.length} chars`, adminTabId);
        return packed;
      }

      const validated = runtime.completeJson(text);
      if (validated !== null) return validated;
      if (expectedMarker) {
        // The marker proves this reply finished, so the lenient reader cannot pick up a partial stream.
        const marked = extractQuestionsFromText(text);
        if (marked.length) {
          progress(msg.requestId, "done", `Captured ${marked.length} question(s) for Page ${targetPageNumber || ""}`, adminTabId);
          return "```json\n" + JSON.stringify(marked, null, 2) + "\n```\n" + expectedMarker;
        }
        if (hasStandaloneCompletion(text)) return "```json\n[]\n```\n" + expectedMarker;
        throw new Error("The matching page reply was found, but its JSON format could not be read. Copy its code block and use Paste CSV / JSON to recover it.");
      }
      if (!text || text.length < 20) {
        throw new Error("No reply on bridge tab for this page. Let generation finish, then Capture again.");
      }
      const qs = extractQuestionsFromText(text);
      if (qs.length) {
        progress(msg.requestId, "done", `Captured ${qs.length} question(s) for Page ${targetPageNumber || ""}`, adminTabId);
        return "```json\n" + JSON.stringify(qs, null, 2) + "\n```";
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
  // A hidden duplicate editor (collapsed side panel, off-screen clone, aria-hidden overlay) still
  // reports a bounding box, so size alone let the prompt land in an invisible element while the
  // real composer stayed empty and Send stayed disabled.
  function isTrulyVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest('[aria-hidden="true"], [inert], [hidden]')) return false;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
    if (el.offsetParent === null && style.position !== "fixed") return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 30 || r.height <= 12) return false;
    if (r.bottom <= 0 || r.right <= 0) return false;
    if (r.top > (window.innerHeight || document.documentElement.clientHeight)) return false;
    return true;
  }
  function findComposer() {
    const selectors = [
      "rich-textarea div.ql-editor",
      "div.ql-editor.textarea.new-input-ui",
      'div.ql-editor[contenteditable="true"]',
      "div.ql-editor",
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][aria-label*="prompt" i]',
      'div[contenteditable="true"][aria-label*="Gemini" i]',
      'div[contenteditable="true"]',
      "textarea",
      "p[data-placeholder]"
    ];
    for (const sel of selectors) {
      const list = deepQueryAll(sel).filter(el => isTrulyVisible(el) && !el.closest('model-response, user-query'));
      if (!list.length) continue;
      list.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
      return list[0];
    }
    return null;
  }
  function base64ToFile(base64, fileName, mimeType) {
    try {
      const raw = String(base64).replace(/^data:[^;]+;base64,/, "");

      // Auto-detect actual file type from binary signature
      let detectedMime = mimeType;
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

      let finalName = fileName || `page.${detectedExt}`;
      // CRITICAL: If the file is an image but fileName was mistakenly given .txt extension, fix it to real image extension!
      if (detectedMime && detectedMime.startsWith("image/") && (finalName.toLowerCase().endsWith(".txt") || !finalName.includes("."))) {
        finalName = finalName.replace(/\.txt$/i, "") + `.${detectedExt}`;
      }

      const binary = atob(raw);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new File([ bytes ], finalName, {
        type: detectedMime || "image/png"
      });
    } catch (e) {
      LOG("base64 fail", e);
      return null;
    }
  }
  const ATTACHMENT_CHIP_SELECTOR = 'uploader-file-card, uploader-file-preview, gem-media-attachment, file-preview, [data-test-id*="file-preview"], ' +
    '[data-test-id*="uploaded"], [class*="attachment-preview"], [class*="file-preview"], [class*="uploader-file"], ' +
    '[class*="file-chip"], [class*="file-card"], [class*="thumbnail"], [class*="attachment-chip"]';

  // Gemini's new input UI renders the attachment preview and the Send button as siblings of
  // <rich-textarea>, under div.text-input-field / .input-area. Stopping at rich-textarea made the
  // attach step count zero chips, retry the upload three times and never reach the prompt.
  function composerContainer() {
    const composer = findComposer();
    return composer?.closest('.text-input-field, .input-area, .input-area-container, input-container, form, [class*="input-area"], [class*="composer"], .bottom-container, .chat-input-container')
      || composer?.parentElement?.parentElement?.parentElement || document;
  }

  // Count real attachment chips in the composer only, never past turns in chat history.
  // Class names on Gemini's upload UI churn often, so beyond the named selectors above we also
  // treat a blob: image thumbnail or a "remove file" button near the composer as proof of an
  // attachment — those survive UI renames far better than a specific class/tag list.
  function attachmentChips() {
    const container = composerContainer();
    const visible = el => {
      try {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      } catch { return false; }
    };
    const notHistory = chip => !chip.closest('model-response, user-query, [data-message-author-role], .conversation-container');
    // Per-file elements first: the preview wrapper is one element however many files it holds,
    // and batch mode needs the real count.
    const perFile = deepQueryAll('uploader-file-preview, uploader-file-card, gem-media-attachment, [class*="file-preview-chip"]', container)
      .filter(visible)
      .filter(notHistory);
    const perFileOuter = perFile.filter((chip, _i, arr) => !arr.some(other => other !== chip && other.contains(chip)));
    if (perFileOuter.length) return perFileOuter;
    const chips = deepQueryAll(ATTACHMENT_CHIP_SELECTOR, container)
      .filter(visible)
      .filter(notHistory);
    const outer = chips.filter((chip, _i, arr) => !arr.some(other => other !== chip && other.contains(chip)));
    if (outer.length) return outer;

    const removeButtons = deepQueryAll('button[aria-label*="remove file" i], button[aria-label*="remove attachment" i], button[aria-label*="delete file" i], button[aria-label*="remove image" i]', container)
      .filter(visible)
      .filter(notHistory);
    if (removeButtons.length) return removeButtons;

    // Fallback: a freshly attached image renders as a blob: thumbnail inside the composer area.
    const blobImages = deepQueryAll('img[src^="blob:"], [style*="blob:"]', container)
      .filter(visible)
      .filter(notHistory);
    return blobImages;
  }

  function countAttachments() {
    return attachmentChips().length;
  }

  async function waitForAttachmentReady(timeoutMs = 30000) {
    const start = Date.now();
    await sleep(600);
    while (Date.now() - start < timeoutMs) {
      // Only spinners inside the input area count; a spinner elsewhere on the page (sidebar,
      // notebook list) must not hold the page for 35 seconds.
      const uploading = deepQueryAll(
        '[class*="upload-progress"], [class*="uploading"], [aria-label*="uploading" i], ' +
        '[class*="file-uploading"], .animate-spin, svg[class*="loading"], [data-test-id*="loading"], mat-progress-spinner, [role="progressbar"]',
        composerContainer()
      ).filter(el => {
        try {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && !el.closest('model-response, user-query, [data-message-author-role]');
        } catch { return false; }
      });
      if (uploading.length > 0) {
        LOG("Attachment upload still in progress in Gemini UI, waiting...");
        await sleep(600);
        continue;
      }
      await sleep(600);
      return true;
    }
    return false;
  }

  // Dismiss any upload menu / overlay left open by an earlier page. These steal focus from
  // the composer, which is why prompt injection and Send start failing as a run goes on.
  function closeOpenOverlays() {
    try {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true }));
      const menus = deepQueryAll('[role="menu"], [role="dialog"], .cdk-overlay-backdrop').filter(el => {
        try {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        } catch { return false; }
      });
      for (const menu of menus.slice(0, 3)) {
        menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true }));
      }
    } catch {}
  }

  async function clearComposerAttachments(timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    closeOpenOverlays();
    while (Date.now() < deadline) {
      const chips = attachmentChips();
      if (!chips.length) return true;
      for (const chip of chips) {
        const remove = chip.matches?.("button") ? chip
          : chip.querySelector?.('button[aria-label*="remove" i], button[aria-label*="delete" i], button[aria-label*="close" i]');
        try { remove?.click(); } catch {}
      }
      await sleep(350);
    }
    return countAttachments() === 0;
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

  // Batch mode sends several page images in one request; attach them in order, each one verified.
  function jobImageList(job) {
    const list = Array.isArray(job?.fileBase64) ? job.fileBase64 : (job?.fileBase64 ? [job.fileBase64] : []);
    return list.filter(Boolean);
  }
  function jobImageName(job, index, total) {
    const names = Array.isArray(job?.fileNames) ? job.fileNames : [];
    if (names[index]) return names[index];
    const base = job?.fileName || "page.png";
    if (total <= 1) return base;
    return base.replace(/(\.[a-z0-9]+)?$/i, `_${index + 1}$1`);
  }
  async function pastePdfIntoComposer(el, job) {
    const images = jobImageList(job);
    if (!images.length) return false;
    // Start from a known-empty composer so a leftover chip can never be mistaken for this page.
    await clearComposerAttachments();
    for (let i = 0; i < images.length; i++) {
      runtime.check();
      const file = base64ToFile(images[i], jobImageName(job, i, images.length), job.mimeType || "image/png");
      if (!file) return false;
      if (!await attachOneFile(el, file)) return false;
      if (images.length > 1) await sleep(500);
    }
    return true;
  }
  async function attachOneFile(el, file) {
    const baseline = countAttachments();

    el.scrollIntoView({ block: "center" });
    el.click();
    el.focus();
    await sleep(200);

    // Method 1: native hidden file input assignment (most reliable & clean)
    const inputAccepted = await tryFileInputAssign(file);
    LOG("file input assign accepted:", inputAccepted);
    if (inputAccepted && await waitForAttachment(file.name, 15000, baseline)) return true;

    // Method 2: HTML5 native Drag & Drop directly on composer
    if (await tryDropFile(el, file) && await waitForAttachment(file.name, 8000, baseline)) return true;

    // Method 3: clipboard write + paste, only because nothing attached yet
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
      if (await waitForAttachment(file.name, 8000, baseline)) return true;
    }

    // Never report success on a composer with no image: the page would be answered blind.
    return false;
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

  function findFileInput() {
    const inputs = deepQueryAll('input[type="file"]');
    return inputs.find(i => /image|png|jpg|pdf|\*|file/i.test(i.accept || i.name || "")) || inputs[0] || null;
  }

  // Returns true if the input actually accepted our file (checked immediately, before any
  // framework code has a chance to clear input.value). This is a much more reliable success
  // signal than waiting for a specific attachment-chip element to render, since Gemini's upload
  // preview markup changes across releases while the underlying <input type=file> contract does not.
  async function tryFileInputAssign(file) {
    const proto = HTMLInputElement.prototype;
    const orig = proto.click;
    proto.click = function() {
      if (this.type === "file") return undefined;
      return orig.apply(this, arguments);
    };
    let openedMenu = false;
    try {
      // Reuse the existing input when Gemini already renders one. Clicking upload buttons on
      // every page left menus stacked open, which is what broke later pages.
      let input = findFileInput();
      if (!input) {
        // Only the composer's own upload button. In a chat with history, a plain /upload/ match hit
        // "Show the uploaded image in a lightbox" on the previous turn, opened the lightbox and never
        // found a file input — which is why pages after the first stalled on "Attaching page image".
        const label = b => ((b.getAttribute("aria-label") || "") + " " + (b.getAttribute("mattooltip") || "") + " " + (b.title || "")).toLowerCase();
        const isUploadBtn = b => /upload|attach|add file|from device|insert|अपलोड/i.test(label(b))
          && !/uploaded|lightbox|show|open|remove|delete|preview|हटा/i.test(label(b))
          && !b.closest('model-response, user-query, [data-message-author-role], .conversation-container');
        const scoped = deepQueryAll('button, [role="button"]', composerContainer()).filter(isUploadBtn);
        const btns = scoped.length ? scoped : deepQueryAll('button, [role="button"]').filter(isUploadBtn);
        for (const b of btns.slice(0, 3)) {
          try { b.click(); } catch {}
          openedMenu = true;
          await sleep(350);
          input = findFileInput();
          if (input) break;
        }
      }
      if (!input) return false;
      try { input.value = ''; } catch {}
      const dt = new DataTransfer;
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return input.files && input.files.length > 0 && input.files[0].name === file.name;
    } catch {
      return false;
    } finally {
      proto.click = orig;
      if (openedMenu) closeOpenOverlays();
    }
  }

  // Success means one MORE attachment than before this page started, never just "a chip exists".
  async function waitForAttachment(fileName, timeoutMs, baseline = 0) {
    const start = Date.now();
    while (Date.now() - start < (timeoutMs || 8e3)) {
      if (countAttachments() > baseline) {
        // Let the upload settle, then confirm it did not disappear again.
        await sleep(600);
        if (countAttachments() > baseline) return true;
      }
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
  // Re-reads the LIVE composer right before we trust it. A script-inserted prompt can appear for
  // an instant (passing injectPromptKeepAttachments' own check) and then get wiped by Gemini's
  // next re-render before Send is actually clicked — this catches that and lets the caller retry.
  function verifyComposerHasPrompt(prompt) {
    const composer = findComposer();
    if (!composer) return false;
    const t = composerText(composer);
    if (!t) return false;
    const needle = promptNeedle(prompt);
    if (t.includes(needle)) return true;
    const minLen = Math.min(50, Math.floor(String(prompt || "").length * 0.2));
    return minLen > 0 && t.length >= minLen;
  }

  // Quill (Gemini's editor) syncs its model from DOM mutations, and Gemini's Send button enables
  // from that model. Tell both layers about the change so the button does not stay disabled.
  function notifyEditorChanged(el, sample) {
    try {
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: sample || " " }));
      el.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true }));
      el.classList.remove("ql-blank");
    } catch {}
  }

  async function injectPromptKeepAttachments(el, prompt) {
    closeOpenOverlays();
    el = findComposer() || el;
    el.scrollIntoView({ block: "center" });
    el.click();
    el.focus();
    await sleep(200);
    // Empty editor: no leading newline, or Gemini keeps a blank first paragraph.
    const payload = composerText(el) ? "\n" + prompt : prompt;
    const needle = promptNeedle(prompt);
    const hasNeedle = () => {
      const t = composerText(findComposer() || el);
      return t.includes(needle) || t.includes(String(prompt).replace(/\s+/g, " ").trim().slice(0, 24));
    };
    // Gemini's model accepted the text: its Send button container turns visible / the field is dirty.
    const registered = () => !!document.querySelector(".send-button-container.visible") || /ng-dirty/.test(el.closest("rich-textarea")?.className || "");
    // Re-injection after a failed send: the prompt is already there, only wake the model up.
    if (hasNeedle()) { notifyEditorChanged(el, String(prompt).slice(0, 40)); return; }
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
    if (hasNeedle() && registered()) { notifyEditorChanged(el, payload.slice(0, 40)); return; }
    // Strategy 2: append the prompt as DOM paragraphs. Verified live on Gemini: Quill syncs its model
    // from DOM mutations, Gemini marks the field dirty and shows Send, and it needs no focus — so it
    // also works in the background tab the bridge opens, where execCommand can insert nothing.
    // (innerHTML is not an option: Gemini enforces Trusted Types and the assignment throws.)
    try {
      el = findComposer() || el;
      // Text present but Gemini's model did not take it (background tab): rebuild it as DOM nodes.
      if (!hasNeedle() || !registered()) {
        while (el.firstChild) el.removeChild(el.firstChild);
        for (const line of String(prompt).split(/\r?\n/)) {
          const p = document.createElement("p");
          if (line) p.textContent = line; else p.appendChild(document.createElement("br"));
          el.appendChild(p);
        }
      }
      el.classList.remove("ql-blank");
      notifyEditorChanged(el, String(prompt).slice(0, 40));
      await sleep(350);
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
      const dt = new DataTransfer;
      dt.setData("text/plain", payload);
      el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
      await sleep(250);
    } catch {}
    if (!hasNeedle()) {
      const t = composerText(el);
      if (t.length > 80 && /json|question|MCQ|exam/i.test(t)) { notifyEditorChanged(el, payload.slice(0, 40)); return; }
      throw new Error("Could not inject prompt into Gemini input. Click the chat box once, then retry.");
    }
    notifyEditorChanged(el, payload.slice(0, 40));
  }

  const isDisabledButton = b => !b || b.disabled || b.getAttribute("aria-disabled") === "true" || /\bdisabled\b/.test((b.className || "").toString());

  // Evidence that the prompt actually left the composer: generation started, a new user turn or
  // model turn appeared, or the editor emptied.
  function sendHappened(baselineUserTurns, baselineModelTurns) {
    if (isGenerating()) return true;
    if (getUserQueryNodes().length > baselineUserTurns) return true;
    if (getModelResponseNodes().length > baselineModelTurns) return true;
    const t = composerText(findComposer());
    return t.length < 10;
  }

  function dispatchEnter(el) {
    const init = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", init));
    el.dispatchEvent(new KeyboardEvent("keypress", init));
    el.dispatchEvent(new KeyboardEvent("keyup", init));
  }

  // Submit with escalating strategies and verify each one. Clicking a disabled Send and walking
  // away was the failure the user saw: image attached, prompt typed, nothing ever sent, then a
  // 3-minute wait for a reply that could not come.
  // The bridge opens Gemini in a background tab, where the send button never reacts to a scripted
  // click (verified live: the same click works at once in a foreground tab). Ask the worker to show
  // the tab for the send, then give the user their previous tab back.
  function askWorker(type, requestId) {
    return new Promise(resolve => {
      try { chrome.runtime.sendMessage({ type, requestId }, res => { void chrome.runtime.lastError; resolve(!!res?.ok); }); }
      catch { resolve(false); }
    });
  }
  // Bring the tab forward and wait until the document really is visible (window un-minimized,
  // tab switched); a click before that is swallowed.
  async function showTabForSend(requestId) {
    const granted = await askWorker("STUDY_AI_FOCUS_TAB", requestId);
    for (let i = 0; i < 12 && document.visibilityState !== "visible"; i++) await sleep(250);
    return granted && document.visibilityState === "visible";
  }

  async function submitPrompt(el, baselineUserTurns, baselineModelTurns, requestId, adminTabId) {
    const sent = () => sendHappened(baselineUserTurns, baselineModelTurns);
    const settle = async ms => { await sleep(ms); return sent(); };
    let focused = false;
    try {
      // Fast path: a visible tab sends on the first click. Hidden tab: bring it forward first.
      if (document.visibilityState !== "visible") {
        progress(requestId, "send", "Showing the Gemini tab for the send…", adminTabId);
        focused = await showTabForSend(requestId);
        await sleep(300);
        progress(requestId, "send", `Tab ${focused ? "visible" : "still hidden"} — ${sendDiagnostics()}`, adminTabId);
      }
      const ok = await submitPromptSteps(el, sent, settle, requestId, adminTabId);
      if (!ok) progress(requestId, "send", "Send failed — " + sendDiagnostics(), adminTabId);
      return ok;
    } finally {
      if (focused) void askWorker("STUDY_AI_RESTORE_TAB", requestId);
    }
  }

  async function submitPromptSteps(el, sent, settle, requestId, adminTabId) {
    // A: wait for Send to enable (upload finishing, model catching up with the editor), then click.
    for (let attempt = 0; attempt < 32; attempt++) {
      const send = findSendButton();
      if (send && !isDisabledButton(send)) {
        send.click();
        if (await settle(700)) return true;
        break;
      }
      if (attempt === 8) {
        // Send still disabled: nudge the editor model with a real keystroke-like edit.
        const composer = findComposer() || el;
        composer.focus();
        try {
          // A DOM mutation is what Quill's model listens to; it works without focus too.
          const last = composer.lastElementChild || composer;
          last.appendChild(document.createTextNode(" "));
        } catch {}
        notifyEditorChanged(composer, " ");
        progress(requestId, "send", "Send button still disabled — nudging the editor…", adminTabId);
      }
      await sleep(250);
    }
    // A2: the tab may still have been hidden during A; once shown, one more click is cheap.
    if (document.visibilityState !== "visible") {
      if (await showTabForSend(requestId)) {
        await sleep(300);
        const send = findSendButton();
        if (send && !isDisabledButton(send)) { send.click(); if (await settle(900)) return true; }
      }
    }
    // B: Enter in the composer (Gemini submits on Enter without Shift).
    const composer = findComposer() || el;
    composer.focus();
    dispatchEnter(composer);
    if (await settle(900)) return true;
    // C: click whatever Send we can find, even if it looks disabled (stale aria state).
    const send = findSendButton();
    if (send) {
      send.click();
      if (await settle(900)) return true;
    }
    // D: native form submission when the composer lives in a form.
    const form = composer.closest("form");
    if (form) {
      try { form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); } catch {}
      if (await settle(900)) return true;
    }
    return sent();
  }

  // Kept for compatibility with older call sites.
  async function clickSendOrEnter(el) {
    return submitPrompt(el, getUserQueryNodes().length, getModelResponseNodes().length);
  }

  const SEND_WORDS = /send|submit|भेज|enviar|envoyer|senden/i;
  const NOT_SEND_WORDS = /stop|रोक|mic|microphone|माइक|dictate|voice|आवाज़|upload|अपलोड|attach|file|फ़ाइल|add|जोड़|menu|more|history|search|खोज|feedback|report|share|copy|edit|retry|regenerate|close|बंद|gem|canvas|deep research|tool|mode|picker|model|expand|collapse|fullscreen/i;

  // One-line state of the composer for progress/error messages, so a failed send explains itself.
  function sendDiagnostics() {
    try {
      const composer = findComposer();
      const rt = composer?.closest("rich-textarea");
      const send = findSendButton();
      const label = send ? ((send.getAttribute("aria-label") || "") + "|" + (send.className || "").toString().slice(0, 30)) : "none";
      return `vis=${document.visibilityState} focus=${document.hasFocus()} text=${composerText(composer).length} dirty=${/ng-dirty/.test(rt?.className || "")} sendVisible=${!!document.querySelector(".send-button-container.visible")} picked=${label} disabled=${isDisabledButton(send)} gen=${isGenerating()}`;
    } catch (e) { return "diag-error:" + e.message; }
  }

  function findSendButton() {
    const composer = findComposer();
    const container = composerContainer();
    const visible = b => { try { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch { return false; } };
    const label = b => ((b.getAttribute("aria-label") || "") + " " + (b.getAttribute("data-test-id") || "") + " " + (b.getAttribute("mattooltip") || "") + " " + (b.title || "") + " " + (b.textContent || "")).replace(/\s+/g, " ").trim().toLowerCase();
    const notHistory = b => !b.closest('model-response, user-query, [data-message-author-role], .conversation-container');

    // 0. Gemini's own send button markup (class survives label localisation).
    const known = deepQueryAll('button.send-button, .send-button-container button, button[class*="send-button"], button[data-test-id*="send" i], button[aria-label*="send" i], button[aria-label*="भेज"], button[mattooltip*="send" i]')
      .filter(b => visible(b) && notHistory(b) && !/stop|रोक/i.test(label(b)));
    if (known.length) return known[known.length - 1];

    // Check candidate buttons near composer first
    const nearButtons = composer ? deepQueryAll('button, [role="button"]', container) : [];
    const allButtons = nearButtons.length ? nearButtons : deepQueryAll('button, [role="button"]');

    // Exclude any button that belongs to past chat messages (history / responses) or feedback
    const validButtons = allButtons.filter(b => visible(b) && notHistory(b));

    // 1. Exact send/submit aria-label or test-id
    const exact = validButtons.find(b => /^(send|submit|send message|send prompt|संदेश भेजें|भेजें)$/i.test(label(b)) || b.getAttribute("data-test-id") === 'send-button');
    if (exact) return exact;

    // 2. Buttons with send/submit text (any language we know), never stop/mic
    const withText = validButtons.find(b => SEND_WORDS.test(label(b)) && !/stop|रोक/i.test(label(b)));
    if (withText) return withText;

    // 3. Icon button whose class names say send
    const classBtn = validButtons.find(b => /send|submit/i.test((b.className || "").toString()));
    if (classBtn) return classBtn;

    // 4. Last valid button near the composer that is clearly not mic/upload/stop (the circular
    //    send icon sits bottom-right). Only when the composer holds text; otherwise it is the mic.
    if (nearButtons.length > 0 && composerText(composer).length > 10) {
      const filteredNear = validButtons.filter(b => !NOT_SEND_WORDS.test(label(b)));
      if (filteredNear.length > 0) return filteredNear[filteredNear.length - 1];
    }

    return null;
  }
  function isGenerating() {
    // 1. Check for Stop buttons (Gemini web UI uses various aria-labels / titles)
    const buttons = deepQueryAll('button, [role="button"]');
    const hasStop = buttons.some(b => {
      try {
        const r = b.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
      } catch { return false; }
      const al = ((b.getAttribute("aria-label") || "") + " " + (b.getAttribute("title") || "") + " " + (b.getAttribute("mattooltip") || "") + " " + (b.textContent || "")).toLowerCase().trim();
      return (/\b(stop|stop response|stop generation|stop generating|cancel response)\b/i.test(al) || /रोकें|रोको/.test(al) ||
             /\bstop-button\b|\bstop_button\b/.test((b.className || "").toString()) ||
             b.querySelector('.ds-icon-stop, [class*="stop-icon"], svg[data-icon="stop"]') !== null) &&
             !al.includes("history") && !al.includes("search");
    });
    if (hasStop) return true;

    // 2. Check for streaming/thinking/processing DOM indicators in Gemini (must be visible)
    const streamIndicators = deepQueryAll(
      '.streaming, [data-is-streaming="true"], [class*="streaming"], .typing-indicator, ' +
      'span.cursor, .blinking-cursor, .result-streaming'
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

  function hasStandaloneCompletion(text) {
    if (!text || isOurPromptText(text)) return false;
    if (/"question(?:_[a-z]+)?"\s*:/i.test(text || "")) return false;
    const lines = String(text).split(/\n/).map(l => l.trim()).filter(Boolean);
    return lines.some(l => l.toUpperCase() === COMPLETE_MARKER || l.toUpperCase().includes("STUDY_AI_COMPLETE") || l.toUpperCase().includes("YOUR_TEST_SERIES_JSON_COMPLETED"));
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
      x.content != null ||
      x.text != null ||
      x.question != null ||
      x.question_hi != null ||
      x.question_en != null ||
      x.question_r != null ||
      x.option1_hi != null ||
      x.option1_en != null ||
      x.solution_hi != null ||
      x.solution_en != null ||
      x.type != null
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

  function scrapeBestReply(preferLast, minIndex = 0, expectedMarker = null) {
    const nodes = getModelResponseNodes();
    
    // Priority 1: When expectedMarker is specified, strictly check if candidate turns have reached completion!
    if (expectedMarker && typeof expectedMarker === "string" && expectedMarker.length > 5) {
      const candidates = (nodes.length > minIndex) ? nodes.slice(minIndex) : [];
      for (let i = candidates.length - 1; i >= 0; i--) {
        const turn = candidates[i];
        const turnText = runtime.readReply(turn);
        if (hasCompletionMarker(turnText, expectedMarker)) {
          // Model outputted the completion marker! Return complete raw text so caller can extract all MCQs!
          return turnText;
        }
      }
      // If expectedMarker is not yet present, return the active streaming turn's RAW text.
      // CRITICAL: NEVER return partial synthetic JSON while streaming, which causes premature termination!
      if (nodes.length > minIndex) {
        const last = nodes[nodes.length - 1];
        return runtime.readReply(last);
      }
      return "";
    }

    // When minIndex > 0 (subsequent page), return raw text of turns >= minIndex
    if (nodes.length > minIndex) {
      const last = nodes[nodes.length - 1];
      return runtime.readReply(last);
    }

    // If waiting for Page 2+ but new turn has not yet rendered, do NOT scrape old turns!
    if (minIndex > 0) {
      return "";
    }

    // Fallback for initial chat or when model-response tag isn't recognized
    if (nodes.length) {
      const last = nodes[nodes.length - 1];
      return runtime.readReply(last);
    }

    const codeNodes = [ ...deepQueryAll("code-block"), ...deepQueryAll("code"), ...deepQueryAll("pre"), ...deepQueryAll('[class*="code"]') ];
    const codeTexts = codeNodes.map(n => (n.innerText || n.textContent || "").trim()).filter(t => t.length > 10 && !isOurPromptText(t));
    if (codeTexts.length) {
      return codeTexts[codeTexts.length - 1];
    }

    const main = document.querySelector("main") || document.querySelector("chat-app-orchestrator") || document.body;
    const all = (main?.innerText || "").trim();
    return preferLast ? all.slice(-6e4) : all;
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
      const nodes = getModelResponseNodes();
      // Only new assistant turns may satisfy a new page request.
      const markedNode = expectedMarker ? nodes.find(node => hasCompletionMarker(node.innerText || node.textContent || "", expectedMarker)) : null;
      if (nodes.length <= initialReplyCount && !markedNode) continue;
      const blob = markedNode ? runtime.readReply(markedNode) : scrapeBestReply(true, initialReplyCount, expectedMarker);
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
        // Never hand back a stalled, cut-off stream as a page result: the app would parse a partial
        // array as a complete page. The app retries the page or the user recaptures.
        throw new Error("AI reply was found but its JSON format could not be read yet. After generation finishes, use Recapture or paste the code block with Paste CSV / JSON.");
      }
    }
    throw new Error("Timed out waiting for a complete AI reply. Partial output was not accepted; check the AI tab.");
  }
})();