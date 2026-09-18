/**
 * TextExtract Pro Bridge
 * Version: 2.3.6
 */

(function() {
  const PAGE = "tf-study-ai";
  const EXT = "tf-study-ai-extension";
  const VERSION = "2.3.6";
  const LOG = "[TextExtract Bridge]";
  let port = null;
  let portTimer = null;

  console.log(LOG, "content-admin.js injected on", location.href, "runtimeId:", (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id) || "MISSING");

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

  const isLikelyApp = typeof window !== "undefined" && (
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname.includes("text-extract-sigma") ||
    location.hostname.includes("vercel.app") ||
    location.hostname.includes("testfactory") ||
    document.title.toLowerCase().includes("textextract") ||
    document.title.toLowerCase().includes("mocktest")
  );

  let keepaliveStarted = false;
  function ensureKeepalive() {
    if (keepaliveStarted) return;
    keepaliveStarted = true;
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
    }, 20000);
  }

  console.log(LOG, "isLikelyApp:", isLikelyApp, "hostname:", typeof window !== "undefined" ? location.hostname : "n/a");

  if (isLikelyApp) {
    ensureKeepalive();
  }

  window.addEventListener("message", event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== PAGE) return;

    console.log(LOG, "received page message:", data.type, "extensionValid:", isExtensionValid());

    ensureKeepalive();

    if (!isExtensionValid()) {
      console.log(LOG, "chrome.runtime context invalidated (extension was reloaded/updated). Refresh page to reconnect.");
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
          error: "Extension was reloaded. Please refresh (F5) this webpage to reconnect."
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
          if (lastErr) {
            console.log(LOG, "background did not respond to STUDY_AI_PING:", lastErr.message);
          } else {
            console.log(LOG, "background responded to PING, ok:", !!res?.ok, "version:", res?.version);
          }
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
        console.log(LOG, "sendMessage threw:", e && e.message);
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
          expectedMarker: data.expectedMarker || null,
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
          expectedMarker: data.expectedMarker || null,
          pageNumber: data.pageNumber || null,
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
