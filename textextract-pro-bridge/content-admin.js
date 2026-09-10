/**
 * TextExtract Pro Bridge
 * Version: 2.0.0
 */

(function() {
  const PAGE = "tf-study-ai";
  const EXT = "tf-study-ai-extension";
  const VERSION = "2.0.0";
  let port = null;
  let portTimer = null;

  function isExtensionValid() {
    try {
      return !!(typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function connectKeepalive() {
    if (!isExtensionValid()) return;
    try {
      if (port) {
        try {
          port.disconnect();
        } catch {}
      }
      port = chrome.runtime.connect({
        name: "study-ai-keepalive"
      });
      port.onDisconnect.addListener(() => {
        port = null;
        clearTimeout(portTimer);
        if (isExtensionValid()) {
          portTimer = setTimeout(connectKeepalive, 1500);
        }
      });
      port.onMessage.addListener(() => {});
    } catch {
      clearTimeout(portTimer);
      if (isExtensionValid()) {
        portTimer = setTimeout(connectKeepalive, 3000);
      }
    }
  }

  connectKeepalive();

  setInterval(() => {
    if (!isExtensionValid()) return;
    if (!port) {
      connectKeepalive();
    } else {
      try {
        chrome.runtime.sendMessage({
          type: "STUDY_AI_HEARTBEAT"
        }, () => {
          void (chrome.runtime && chrome.runtime.lastError);
        });
      } catch {}
    }
  }, 2e4);

  window.addEventListener("message", event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== PAGE) return;

    if (!isExtensionValid()) {
      if (data.type === "PING") {
        window.postMessage({
          source: EXT,
          type: "PONG",
          ok: false,
          error: "Extension reloaded. Please refresh this page."
        }, "*");
      } else if (data.type === "EXTRACT_REQUEST" || data.type === "CAPTURE_REQUEST") {
        window.postMessage({
          source: EXT,
          type: "STUDY_AI_RESULT",
          requestId: data.requestId,
          ok: false,
          error: "Extension context invalidated. Please refresh this web page."
        }, "*");
      }
      return;
    }

    if (data.type === "PING") {
      try {
        chrome.runtime.sendMessage({
          type: "STUDY_AI_PING"
        }, res => {
          const lastErr = chrome.runtime?.lastError;
          window.postMessage({
            source: EXT,
            type: "PONG",
            ok: !lastErr && !!res?.ok,
            version: res?.version || VERSION,
            session: res?.session || null,
            error: lastErr?.message || null
          }, "*");
        });
      } catch (e) {
        window.postMessage({
          source: EXT,
          type: "PONG",
          ok: false,
          error: "Extension reloaded. Please refresh this page."
        }, "*");
      }
      return;
    }

    if (data.type === "SET_PROVIDER") {
      try {
        chrome.runtime.sendMessage({
          type: "STUDY_AI_SET_PROVIDER",
          provider: data.provider
        }, res => {
          const lastErr = chrome.runtime?.lastError;
          window.postMessage({
            source: EXT,
            type: "PONG",
            ok: !lastErr && !!res?.ok,
            version: res?.version || VERSION,
            session: res?.session || null,
            error: lastErr?.message || null
          }, "*");
        });
      } catch (e) {
        window.postMessage({
          source: EXT,
          type: "PONG",
          ok: false,
          error: "Extension reloaded. Please refresh this page."
        }, "*");
      }
      return;
    }

    if (data.type === "EXTRACT_REQUEST") {
      connectKeepalive();
      try {
        chrome.runtime.sendMessage({
          type: "STUDY_AI_START",
          requestId: data.requestId,
          prompt: data.prompt,
          fileName: data.fileName,
          fileBase64: data.fileBase64,
          mimeType: data.mimeType,
          pdfOnClipboard: !!data.pdfOnClipboard,
          continueChat: !!data.continueChat,
          skipPdf: !!data.skipPdf,
          silent: data.silent !== false,
          chatUrl: data.chatUrl || null,
          provider: data.provider || "gemini"
        }, res => {
          const lastErr = chrome.runtime?.lastError;
          if (lastErr || !res?.ok) {
            window.postMessage({
              source: EXT,
              type: "STUDY_AI_RESULT",
              requestId: data.requestId,
              ok: false,
              error: lastErr?.message || res?.error || "Extension failed to start job"
            }, "*");
          }
        });
      } catch (e) {
        window.postMessage({
          source: EXT,
          type: "STUDY_AI_RESULT",
          requestId: data.requestId,
          ok: false,
          error: "Extension connection lost. Please refresh this page."
        }, "*");
      }
      return;
    }

    if (data.type === "CAPTURE_REQUEST") {
      connectKeepalive();
      try {
        chrome.runtime.sendMessage({
          type: "STUDY_AI_CAPTURE_START",
          requestId: data.requestId,
          chatUrl: data.chatUrl || null,
          fullChat: !!data.fullChat,
          provider: data.provider || "gemini"
        }, res => {
          const lastErr = chrome.runtime?.lastError;
          if (lastErr || !res?.ok) {
            window.postMessage({
              source: EXT,
              type: "STUDY_AI_RESULT",
              requestId: data.requestId,
              ok: false,
              error: lastErr?.message || res?.error || "Capture failed to start"
            }, "*");
          }
        });
      } catch (e) {
        window.postMessage({
          source: EXT,
          type: "STUDY_AI_RESULT",
          requestId: data.requestId,
          ok: false,
          error: "Extension connection lost. Please refresh this page."
        }, "*");
      }
      return;
    }

    if (data.type === "RESET_SESSION") {
      try {
        chrome.runtime.sendMessage({
          type: "STUDY_AI_RESET_SESSION"
        }, () => {
          void (chrome.runtime && chrome.runtime.lastError);
          window.postMessage({
            source: EXT,
            type: "SESSION_RESET",
            ok: true
          }, "*");
        });
      } catch {}
    }
  });
  chrome.runtime.onMessage.addListener(msg => {
    if (!msg) return;
    if (msg.type === "STUDY_AI_RESULT" || msg.type === "STUDY_AI_PROGRESS") {
      window.postMessage({
        source: EXT,
        ...msg
      }, "*");
    }
  });
  window.postMessage({
    source: EXT,
    type: "PONG",
    ok: true,
    version: VERSION
  }, "*");
})();
