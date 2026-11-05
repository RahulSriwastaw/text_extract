/**
 * Study AI Bridge Service
 * Connects the web application to TextExtract Pro Bridge (protocol v2).
 * Runs queued extraction through the user's browser session with acknowledged
 * handshakes, cancellation and durable-result recovery.
 */

import { ExtractedElement, NumberingStyle, OptionArrangement } from '../types';
import { HTML_LATEX_FORMAT_RULES, safeParseAiJsonObject } from './textCleanService';

export const PAGE_SOURCE = 'tf-study-ai';
export const EXT_SOURCE = 'tf-study-ai-extension';

export type AiProvider = 'gemini' | 'deepseek' | 'chatgpt' | 'claude';

export interface BridgeSessionInfo {
  tabId?: number | null;
  chatUrl?: string | null;
  batch?: number;
  hasPdf?: boolean;
  provider?: string;
  alivePorts?: number;
  openJobs?: number;
}

/**
 * Explicit connection lifecycle.
 * - connecting: a handshake (PING) is in flight and nothing is connected yet
 * - connected: the extension's service worker answered a PING; heartbeats keep checking it
 * - disconnected: no answer (extension missing / asleep / page loaded first) or the user disconnected
 * - error: the extension answered but cannot work (e.g. it was reloaded and this page needs a refresh)
 */
export type BridgeConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface BridgeStatus {
  connected: boolean;
  /** Lifecycle state; `connected` is kept for existing callers and always agrees with it. */
  state?: BridgeConnectionState;
  /** A PING is in flight (while connected this is a heartbeat check, not a reconnect). */
  checking?: boolean;
  /** True after disconnectStudyAiBridge(): automatic reconnects stay off until connectStudyAiBridge(). */
  manual?: boolean;
  /** Automatic reconnect attempts made since the bridge was last seen. */
  reconnectAttempt?: number;
  protocolVersion?: number;
  error?: string;
  version?: string;
  session?: BridgeSessionInfo | null;
  provider?: AiProvider;
  openProviders?: AiProvider[];
  lastPingTime?: number;
}

/** Error thrown by the bridge with an explicit retry hint for queue/retry helpers. */
export class BridgeError extends Error {
  retryable: boolean;
  code?: string;
  constructor(message: string, options: { retryable?: boolean; code?: string } = {}) {
    super(message);
    this.name = 'BridgeError';
    this.retryable = !!options.retryable;
    this.code = options.code;
  }
}

export interface ExtractWithBridgeOptions {
  base64Image?: string;
  /** Several page images in one request (batch mode). Attached in order; overrides base64Image. */
  base64Images?: string[];
  /** Optional names matching base64Images. */
  fileNames?: string[];
  fileName?: string;
  mimeType?: string;
  prompt: string;
  responseFormat?: 'json' | 'text';
  provider?: AiProvider;
  continueChat?: boolean;
  skipPdf?: boolean;
  silent?: boolean;
  chatUrl?: string;
  timeoutMs?: number;
  pageNumber?: number;
  totalPages?: number;
  expectedMarker?: string;
  signal?: AbortSignal;
  onProgress?: (step: string, detail?: string, chatUrl?: string) => void;
}

const providers: AiProvider[] = ['gemini', 'deepseek', 'chatgpt', 'claude'];
let cachedStatus: BridgeStatus = { connected: false, state: 'disconnected', provider: getStoredAiProvider(), openProviders: [] };
const statusListeners = new Set<(status: BridgeStatus) => void>();
let pendingPing: Promise<BridgeStatus> | null = null;
const post = (payload: Record<string, unknown>) => window.postMessage({ ...payload, source: PAGE_SOURCE }, window.location.origin);
const requestIdFor = (prefix: string) => prefix + '_' + crypto.randomUUID();
// The extension's BRIDGE_READY announcement fires at document_start, before this bundle runs,
// so a page that loads first (or loads while the service worker is asleep) would otherwise stay
// "not connected" forever — nothing re-checked after the single mount-time ping.
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let reconnectAttempts = 0;
const RECONNECT_MAX_DELAY = 15000;
// Bounded so a page without the extension installed does not poll forever. Focus, tab visibility,
// a tool mounting, or any explicit ping re-arms the loop.
const RECONNECT_MAX_ATTEMPTS = 6;
// While connected, a periodic PING notices a reloaded/disabled extension or a sleeping worker
// before the user clicks Extract and gets a 5-minute silent wait.
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
const HEARTBEAT_MS = 30000;
const HEARTBEAT_TIMEOUT_MS = 4000;
// Set by disconnectStudyAiBridge(). Automatic pings (reconnect loop, focus, visibility,
// BRIDGE_READY, heartbeat) stay off until connectStudyAiBridge() is called.
let manuallyDisconnected = false;
const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

function clearReconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}
function clearHeartbeat() {
  if (heartbeatTimer) { clearTimeout(heartbeatTimer); heartbeatTimer = null; }
}

function scheduleReconnect() {
  if (typeof window === 'undefined' || reconnectTimer || cachedStatus.connected || manuallyDisconnected) return;
  if (reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) return;
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    // A hidden tab cannot help the user; the visibility listener re-arms this.
    if (isHidden()) return;
    void pingStudyAiExtension();
  }, reconnectDelay);
}

function scheduleHeartbeat() {
  clearHeartbeat();
  if (typeof window === 'undefined' || !cachedStatus.connected || manuallyDisconnected) return;
  heartbeatTimer = setTimeout(() => {
    heartbeatTimer = null;
    if (!cachedStatus.connected || manuallyDisconnected) return;
    // Nobody is looking at a hidden tab; check again when it becomes visible.
    if (isHidden()) { scheduleHeartbeat(); return; }
    void pingStudyAiExtension(HEARTBEAT_TIMEOUT_MS);
  }, HEARTBEAT_MS);
}

/** Re-arm the bounded reconnect loop; used wherever the user shows interest in the bridge. */
function rearmReconnect(pingNow: boolean) {
  if (manuallyDisconnected) return;
  reconnectAttempts = 0;
  reconnectDelay = 1000;
  if (pingNow) void pingStudyAiExtension();
  else scheduleReconnect();
}

/** Notify subscribers without touching reconnect/heartbeat timers (transient states). */
function emitStatus(status: BridgeStatus) {
  cachedStatus = status;
  statusListeners.forEach(fn => { try { fn(status); } catch {} });
}

/**
 * Publish a handshake verdict. `fromPing` means the verdict came from a real PING attempt, which is
 * the only thing that should grow the reconnect backoff.
 */
function publishStatus(status: BridgeStatus, fromPing = false) {
  const connected = !!status.connected;
  const state: BridgeConnectionState = status.state || (connected ? 'connected' : 'disconnected');
  emitStatus({ ...status, connected, state, checking: false, manual: manuallyDisconnected, reconnectAttempt: reconnectAttempts });
  if (connected) {
    reconnectDelay = 1000;
    reconnectAttempts = 0;
    clearReconnect();
    scheduleHeartbeat();
  } else {
    clearHeartbeat();
    if (fromPing) reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_DELAY);
    scheduleReconnect();
  }
}
function fromExtension(event: MessageEvent) {
  return event.source === window && event.origin === window.location.origin && event.data?.source === EXT_SOURCE;
}
/**
 * The extension's content script stamps the document (shared DOM) when it is injected. No stamp
 * means the extension is not loaded on this page at all, which needs a different fix from a
 * silent service worker.
 */
export function getInjectedBridgeVersion(): string | null {
  try { return document.documentElement.getAttribute('data-tf-bridge'); } catch { return null; }
}
function describeSilentExtension(): string {
  if (typeof document === 'undefined') return 'Extension did not respond.';
  const injected = getInjectedBridgeVersion();
  if (!injected) {
    return 'TextExtract Pro Bridge is not loaded on this page. Open chrome://extensions, make sure the extension is installed and enabled (toggle ON), then refresh this page (F5).';
  }
  return `Extension ${injected} is loaded but its service worker did not answer. In chrome://extensions click "Errors" or "Reload" on TextExtract Pro Bridge, then refresh this page.`;
}
/** Current cached bridge status (synchronous; use subscribeToExtensionStatus for updates). */
export function getBridgeStatus(): BridgeStatus {
  return cachedStatus;
}
export function getStoredAiProvider(): AiProvider {
  try {
    const stored = localStorage.getItem('study_ai_provider') as AiProvider;
    return ['gemini', 'deepseek', 'chatgpt', 'claude'].includes(stored) ? stored : 'gemini';
  } catch { return 'gemini'; }
}
/**
 * Pages per AI chat before the bridge starts a fresh one. A long chat grows the provider's DOM
 * until uploads and the composer become unreliable, which is why long runs fail part-way.
 * 0 disables rotation and keeps every page in one chat.
 */
export const CHAT_ROTATION_KEY = 'study_ai_chat_rotation';
export const DEFAULT_CHAT_ROTATION = 5;

export function getChatRotationInterval(): number {
  try {
    const stored = Number(localStorage.getItem(CHAT_ROTATION_KEY));
    if (!Number.isFinite(stored) || stored < 0) return DEFAULT_CHAT_ROTATION;
    return Math.min(Math.floor(stored), 50);
  } catch { return DEFAULT_CHAT_ROTATION; }
}

export function setChatRotationInterval(pages: number): void {
  try {
    const safe = Number.isFinite(pages) && pages > 0 ? Math.min(Math.floor(pages), 50) : 0;
    localStorage.setItem(CHAT_ROTATION_KEY, String(safe));
  } catch {}
}

/** True when this page index should open a new chat instead of continuing the current one. */
export function shouldStartNewChat(pageIndex: number, interval = getChatRotationInterval()): boolean {
  if (pageIndex <= 0) return true;
  return interval > 0 && pageIndex % interval === 0;
}

export function setStoredAiProvider(provider: AiProvider): void {
  if (typeof window === 'undefined' || !providers.includes(provider)) return;
  localStorage.setItem('study_ai_provider', provider);
  emitStatus({ ...cachedStatus, provider, session: null });
  // Each request supplies its provider. Changing a preference never resets an active job.
  void pingStudyAiExtension();
}
export function subscribeToExtensionStatus(callback: (status: BridgeStatus) => void): () => void {
  statusListeners.add(callback);
  callback(cachedStatus);
  // A tool mounting later must not inherit a stale "disconnected" verdict from page load.
  if (!cachedStatus.connected) rearmReconnect(false);
  return () => { statusListeners.delete(callback); };
}
/**
 * Handshake with the extension. Concurrent callers share one in-flight PING, so Connect buttons,
 * mount effects and the reconnect loop can all call this without duplicate traffic.
 * After disconnectStudyAiBridge() this resolves with the cached disconnected status unless
 * `force` is set (connectStudyAiBridge does that).
 */
export function pingStudyAiExtension(timeoutMs = 2500, options: { force?: boolean } = {}): Promise<BridgeStatus> {
  if (typeof window === 'undefined') return Promise.resolve({ connected: false, state: 'disconnected' });
  if (manuallyDisconnected && !options.force) return Promise.resolve(cachedStatus);
  if (pendingPing) return pendingPing;
  pendingPing = new Promise<BridgeStatus>(resolve => {
    const requestId = requestIdFor('ping');
    const provider = getStoredAiProvider();
    emitStatus({ ...cachedStatus, checking: true, state: cachedStatus.connected ? 'connected' : 'connecting' });
    const finish = (status: BridgeStatus) => {
      clearTimeout(timer);
      clearInterval(retry);
      window.removeEventListener('message', handler);
      publishStatus(status, true);
      resolve(cachedStatus);
    };
    const handler = (event: MessageEvent) => {
      if (!fromExtension(event) || event.data.type !== 'PONG' || event.data.requestId !== requestId) return;
      const data = event.data;
      const ok = !!data.ok;
      // The content script answered but the worker cannot serve us (typically "Extension reloaded.
      // Refresh this page"): that is an error the user must act on, not a transient disconnect.
      finish({ connected: ok, state: ok ? 'connected' : (data.error ? 'error' : 'disconnected'),
        version: data.version, protocolVersion: data.protocolVersion,
        error: ok ? undefined : (data.error || 'Extension refused the handshake.'), session: data.session || null, provider: getStoredAiProvider(),
        openProviders: (data.openProviders || []).filter((p: AiProvider) => providers.includes(p)), lastPingTime: Date.now() });
    };
    const send = () => post({ type: 'PING', requestId, provider });
    const timer = setTimeout(() => finish({ ...cachedStatus, connected: false, state: 'disconnected', session: null,
      error: cachedStatus.connected
        ? 'Bridge stopped responding. Check that TextExtract Pro Bridge is still enabled in chrome://extensions, then refresh this page.'
        : describeSilentExtension() }), timeoutMs);
    const retry = setInterval(send, Math.max(300, Math.floor(timeoutMs / 3)));
    window.addEventListener('message', handler);
    send();
  }).finally(() => { pendingPing = null; });
  return pendingPing;
}
/**
 * Explicit connect for a Connect button. Idempotent: repeated clicks share the in-flight PING.
 * Clears a manual disconnect and resets the reconnect backoff.
 */
export function connectStudyAiBridge(timeoutMs = 3000): Promise<BridgeStatus> {
  manuallyDisconnected = false;
  reconnectAttempts = 0;
  reconnectDelay = 1000;
  return pingStudyAiExtension(timeoutMs, { force: true });
}
/**
 * Explicit disconnect for a Disconnect button. Idempotent. Stops heartbeat and reconnect timers,
 * publishes `disconnected` with `manual: true`, and asks the extension to forget the chat session
 * so the next connect starts clean. Running extractions are not cancelled here; their owners hold
 * the AbortSignal.
 */
export async function disconnectStudyAiBridge(): Promise<void> {
  if (typeof window === 'undefined') return;
  const wasConnected = cachedStatus.connected;
  manuallyDisconnected = true;
  clearReconnect();
  clearHeartbeat();
  reconnectAttempts = 0;
  reconnectDelay = 1000;
  emitStatus({ ...cachedStatus, connected: false, state: 'disconnected', checking: false, manual: true, session: null, error: undefined });
  if (wasConnected) { try { await resetStudyAiSession(); } catch {} }
}
export function resetStudyAiSession(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  return new Promise(resolve => {
    const requestId = requestIdFor('reset');
    const finish = (ok: boolean) => { clearTimeout(timer); window.removeEventListener('message', handler); resolve(ok); };
    const handler = (event: MessageEvent) => {
      if (fromExtension(event) && event.data.type === 'SESSION_RESET' && event.data.requestId === requestId) finish(!!event.data.ok);
    };
    const timer = setTimeout(() => finish(false), 2500);
    window.addEventListener('message', handler);
    post({ type: 'RESET_SESSION', requestId });
  });
}
if (typeof window !== 'undefined') {
  window.addEventListener('message', event => {
    if (fromExtension(event) && event.data.type === 'BRIDGE_READY' && !manuallyDisconnected) void pingStudyAiExtension();
  });
  // Focus/visibility are the user coming back: re-check whether connected or not (a connected
  // verdict may be stale after the laptop slept), but never override a manual disconnect.
  window.addEventListener('focus', () => { if (!cachedStatus.connected) rearmReconnect(true); else scheduleHeartbeat(); });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (!cachedStatus.connected) rearmReconnect(true);
      else void pingStudyAiExtension(HEARTBEAT_TIMEOUT_MS);
    });
  }
  setTimeout(() => { void pingStudyAiExtension(); }, 300);
}

/**
 * Build an optimized prompt for web AI chat to extract MCQs and Layout
 * that ensures LaTeX math is enclosed in $$...$$ and outputs structured JSON.
 */
export function buildBridgePrompt(
  numberingStyle: NumberingStyle = NumberingStyle.HASH,
  isBilingual = false,
  mcqMode = true,
  refineMode = false,
  showAnswers = true,
  prevPageTailChunk?: string,
  includeImages = false,
  optionArrangement: OptionArrangement = OptionArrangement.VERTICAL,
  showMcqNumbers = true,
  autoProofread = false
): string {
  // 1. Question Numbering Feature Connection
  let numInstruction = '';
  if (!showMcqNumbers) {
    numInstruction = 'DO NOT prefix questions with question numbers. Omit or strip numbers (e.g. remove #1., Q1., 1.). Provide the clean question stem directly.';
  } else {
    if (numberingStyle === NumberingStyle.Q_DOT) numInstruction = 'Start each question with "Q" and number (e.g. Q1., Q2.).';
    else if (numberingStyle === NumberingStyle.QUESTION_DOT) numInstruction = 'Start each question with "Question" and number (e.g. Question 1., Question 2.).';
    else if (numberingStyle === NumberingStyle.NUMBER_DOT) numInstruction = 'Start each question with just the number followed by a dot (e.g. 1., 2.).';
    else numInstruction = 'Start each question with "#" and the number (e.g. #1., #2.).';
  }

  // 2. Answers Feature Connection
  const ansInstruction = showAnswers
    ? 'Deduce or extract the correct answer and put "Answer: [Letter]" (e.g. Answer: C) on a new line immediately after options.'
    : 'STRICT NO-ANSWER RULE: Do NOT output any answers, solutions, or answer keys under any circumstances.';

  // 3. Bilingual Mode Feature Connection
  const bilingualInstruction = isBilingual
    ? 'MANDATORY BILINGUAL EXTRACTION (HINDI + ENGLISH):\n- Provide ALL questions, headings, paragraphs, and textual options in BOTH Hindi and English.\n- If the source is in Hindi only -> Translate into English and provide both!\n- If the source is in English only -> Translate into Hindi and provide both!\n- If the source already contains both languages -> Extract and pair both faithfully.\n- Two-Line Format for Questions/Paragraphs: Line 1 Hindi, Line 2 English (NO slash / at line end).\n- Options Format: (a) [Hindi Option] / [English Option].\n- NEVER DUPLICATE IDENTICAL VALUES: If an option or value is a pure number, percentage, unit, or math formula (e.g. "123", "45%", "$$x=2$$", "km/h"), write it ONLY ONCE without slash (e.g. "(a) 123", "(b) 45%").\n- Language Test Exception: English Language / Grammar tests stay 100% English; Hindi Language / व्याकरण tests stay 100% Hindi.'
    : 'CRITICAL RULE: STRICT SOURCE LANGUAGE (NO TRANSLATION):\n- Extract text EXACTLY in the language it is written on the page.\n- If Hindi, output ONLY Hindi. If English, output ONLY English. Do NOT translate anything.';

  // 4. Refine Mode Feature Connection
  const refineInstruction = refineMode
    ? 'REFINE MODE (STRICT CONTENT FILTERING):\n- Strictly filter out and DO NOT extract: exam shift tags (e.g. SSC CGL shift details, RRB NTPC tags, UPSC exam year), running headers, running footers, page numbers, publisher branding, watermarks, Telegram/website links, or decorative lines.\n- Extract ONLY pure, primary content.'
    : 'FULL EXTRACTION MODE (A TO Z):\n- Extract 100% of all content visible on the page from top to bottom, including headers, footers, page numbers, and exam tags.';

  // 5. Auto Proofread Feature Connection
  const proofreadInstruction = autoProofread
    ? 'AUTO PROOFREAD & OCR CORRECTION ENABLED:\n- Silently fix OCR scanning errors: reconnect hyphenated words split across line breaks (e.g. "con- \\n dition" -> "condition"), fix character confusions (e.g. "rn" misread as "m", "1" vs "l", "0" vs "O"), restore missing spaces between glued words, and ensure flawless grammar and formatting.'
    : 'LITERAL OCR EXTRACTION: Extract text faithfully as printed on the page.';

  // 6. Option Arrangement Feature Connection
  let optArrangementInstruction = 'Each option must be on its own line:\n(a) ...\n(b) ...\n(c) ...\n(d) ...';
  if (optionArrangement === OptionArrangement.HORIZONTAL) {
    optArrangementInstruction = 'Format all options horizontally inline on a single line separated by clean spacing:\n(a) ...   (b) ...   (c) ...   (d) ...';
  } else if (optionArrangement === OptionArrangement.GRID) {
    optArrangementInstruction = 'Format options in a balanced 2x2 grid (two options per line):\n(a) ...   (b) ...\n(c) ...   (d) ...';
  }

  // 7. Math & LaTeX Formula Standard
  const mathInstruction = 'MATHEMATICAL & SCIENTIFIC FORMULAS (STRICT LATEX):\n- Enclose ALL formulas, equations, variables, powers, fractions, and roots in double dollar signs: $$...$$\n- Always use proper LaTeX: \\frac{a}{b}, \\sqrt{x}, \\sin A, \\cos B, \\tan \\theta, x^2, \\pi, \\pm, \\times, etc.\n- For recurring decimals or numbers with a bar over them, ALWAYS use \\overline{...} (e.g., $$0.04\\overline{3}$$, $$0.\\overline{43}$$).\n- NEVER output dangling $$ (every opening $$ MUST have a closing $$).\n- Normal text, non-math words, and regular numbers must remain outside $$ delimiters.';

  // 8. Images & Diagrams Feature Connection
  const imageInstruction = includeImages
    ? `FIGURES, DIAGRAMS AND TABLES (KEEP IMAGES ENABLED):
- For every diagram, chart, pattern series, geometry figure, circuit diagram, map, or visual illustration, output a separate element:
  { "type": "image", "content": "Concise descriptive title of what the diagram shows", "bbox": [ymin, xmin, ymax, xmax] }
- For every table or structured data grid, output: { "type": "table", "content": "Markdown table (| Col 1 | Col 2 |)", "bbox": [ymin, xmin, ymax, xmax] }
- bbox uses NORMALIZED coordinates from 0 to 1000 relative to the page image, in the order [ymin, xmin, ymax, xmax].
- Keep elements in natural reading order: a figure element goes exactly where it appears between the text elements.`
    : 'FIGURES: Do NOT output any image elements. Extract only text and markdown tables.';

  // 9. Continuation Context from Previous Page
  const continuationInstruction = prevPageTailChunk ? `
IMPORTANT MULTI-PAGE SPLIT QUESTION / CHUNK CONTINUATION:
The bottom of the previous page ended with:
"""
${prevPageTailChunk}
"""
SPLIT CONTENT HANDLING:
- If the top of this current page contains continuation text, remaining options (e.g. (c), (d)), or an Answer line that completes a sentence or question from the bottom of the previous page:
  CONNECT THEM TOGETHER! Do NOT create an orphan broken item.
  In the first JSON element, include the full text from the previous page along with the new text/options so it is 100% complete!
  Add "continues_previous": true in that JSON element.
- If this page ends with incomplete content whose remaining text will appear on the next page, extract what is visible.
` : '';

  if (mcqMode) {
    return `You are an elite, highly precise Universal Document Digitizer and Exam Question Extractor.
Your mission is to digitize and convert this PDF page into clean, perfectly structured, production-ready digital text and document elements.

DOCUMENT CONTEXT: This page contains Multiple Choice Questions (MCQs), practice test problems, or exam question sets.
${continuationInstruction}
RULES & SPECIFICATIONS:
1. 100% COMPLETE EXTRACTION: Extract ALL content present on this page from top to bottom. If the page contains passages, instructions, theory, or explanations alongside questions, extract them all completely. Never invent, hallucinate, or use sample placeholders.
2. CLEAN FORMAT (NO HTML): Output clean Markdown and plain text. Do NOT use HTML tags (<p>, <br>, <b>, <span>, <table>). Use natural newlines (\\n) for line breaks.
3. QUESTION NUMBERING: ${numInstruction}
4. OPTION ARRANGEMENT:
${optArrangementInstruction}
5. READING COMPREHENSION / PASSAGES (CRITICAL):
   - If questions are based on a passage, comprehension text, or directions (e.g., "SET - 34 [Q.164 to Q.168]", "Directions", "गद्यांश"):
     YOU MUST INCLUDE THE FULL PASSAGE TEXT WITH EVERY SINGLE QUESTION IN THAT SET!
   - Prepend the complete passage to each question stem (separated by "\\n---\\n").
   - NEVER output the passage only once with the first question! Every question in that set must have the complete passage attached.
6. ${bilingualInstruction}
7. ${ansInstruction}
8. ${refineInstruction}
9. ${proofreadInstruction}
10. ${mathInstruction}
11. ${imageInstruction}

OUTPUT FORMAT:
Return ONLY a valid JSON array of objects inside \`\`\`json ... \`\`\` code block:
[
  {
    "type": "text",
    "content": "Full extracted question text with options and answer..."
  }${includeImages ? `,
  {
    "type": "image",
    "content": "Concise description of diagram or figure",
    "bbox": [ymin, xmin, ymax, xmax]
  }` : ''}
]
At the very end after the JSON code block, on a new line, output:
---STUDY_AI_COMPLETE---`;
  }

  // Universal Document / Full Text Extraction Mode (extract 100% of all content from the PDF page)
  return `You are an elite, highly precise Universal Document Digitizer and PDF-to-Text Conversion AI.
Your absolute mandate is to extract 100% OF THE COMPLETE TEXT from this PDF page without skipping, omitting, summarizing, or filtering out ANY content.

DOCUMENT MISSION: EXTRACT ALL TEXT (FULL PAGE RECONSTRUCTION)
${continuationInstruction}
CRITICAL RULES & SPECIFICATIONS:
1. 100% COMPLETE TEXT EXTRACTION:
   - Extract EVERY SINGLE WORD, line, heading, paragraph, table, diagram label, formula, explanation, instruction, footnote, or question visible on this page.
   - Do NOT skip or omit anything. Do NOT summarize.
   - Do NOT isolate only MCQs. Even if this page contains exam questions, practice tests, or questions with options, EXTRACT ALL TEXT on the page in full reading order (including directions, passages, headers, questions, and explanations).
   - Read from the very top of the page to the very bottom in natural top-to-bottom reading order.
2. PRESERVE DOCUMENT STRUCTURE & HIERARCHY:
   - Headings: Use markdown headings for titles and sections (# Main Heading, ## Sub-Heading, ### Section).
   - Paragraphs: Keep natural paragraph flow and line breaks. Do NOT arbitrarily split sentences or merge unrelated paragraphs.
   - Text Formatting: Preserve emphasis where appropriate (**bold**, *italic*).
   - Lists: Format bullet points with "- " or "• ", and preserve numbered lists ("1. ", "a. ", "i. ").
   - Blockquotes & Notes: Format notes, tips, warnings, or callouts with "> Note: ...".
   - Tables: Convert all tables and structured data grids into clean Markdown tables (| Header 1 | Header 2 |\\n|---|---|\\n| Cell 1 | Cell 2 |).
3. DO NOT FORCE QUESTIONS: This is full document extraction mode. Do NOT convert general text into question format.
4. CLEAN FORMAT (NO HTML): Output clean Markdown and plain text without HTML tags (<p>, <br>, <b>, <span>, <table>).
5. ${bilingualInstruction}
6. ${refineInstruction}
7. ${proofreadInstruction}
8. ${mathInstruction}
9. ${imageInstruction}

OUTPUT FORMAT:
Return ONLY a valid JSON array of objects inside \`\`\`json ... \`\`\` code block:
[
  {
    "type": "text",
    "content": "Full extracted document text, paragraph, section, or markdown table..."
  }${includeImages ? `,
  {
    "type": "image",
    "content": "Concise description of diagram, photo, chart, or figure",
    "bbox": [ymin, xmin, ymax, xmax]
  }` : ''}
]
At the very end after the JSON code block, on a new line, output:
---STUDY_AI_COMPLETE---`;
}

/**
 * Execute layout extraction through the Study AI Extension
 */
export async function extractWithStudyAiBridge(
  options: ExtractWithBridgeOptions
): Promise<{ rawText: string; elements: ExtractedElement[]; expectedMarker: string; chatUrl?: string }> {
  if (options.signal?.aborted) throw new DOMException('Extraction stopped by user.', 'AbortError');
  const isAvailable = await pingStudyAiExtension(3000);
  if (!isAvailable.connected) {
    if (isAvailable.manual) {
      throw new BridgeError('Bridge is disconnected. Click "Connect bridge" to reconnect, then retry.', { code: 'disconnected' });
    }
    throw new BridgeError(
      isAvailable.state === 'error' && isAvailable.error
        ? isAvailable.error
        : 'TextExtract Pro Bridge Extension se connect nahi ho pa raha hai. Kripya is page ko ek baar Refresh (F5) karein aur chrome://extensions par extension check karein.',
      // A disconnect can be the worker waking up late; a reload error needs the user.
      { retryable: isAvailable.state !== 'error', code: 'not_connected' }
    );
  }
  if (isAvailable.protocolVersion !== 2) throw new BridgeError('Reload TextExtract Pro Bridge 2.5 in chrome://extensions, then refresh this page.', { code: 'protocol' });
  const pNum = options.pageNumber;
  const requestId = requestIdFor('req');
  const expectedMarker = options.expectedMarker || (pNum 
    ? `---STUDY_AI_COMPLETE_P${pNum}_${requestId}---` 
    : `---STUDY_AI_COMPLETE_${requestId}---`);
  const provider = options.provider || getStoredAiProvider();
  const timeoutMs = Math.min(Math.max(options.timeoutMs || 300000, 1000), 900000); // 5 min timeout for slow AI chats

  // Inject unique request-scoped completion marker to eliminate cross-page turn collisions
  let promptWithMarker = options.prompt || '';
  if (pNum && !promptWithMarker.includes(`[PAGE ${pNum}`)) {
    promptWithMarker = `[PAGE ${pNum} DOCUMENT EXTRACTION]\n` + promptWithMarker;
  }
  if (promptWithMarker.includes('---STUDY_AI_COMPLETE---')) {
    promptWithMarker = promptWithMarker.replace(/---STUDY_AI_COMPLETE---/g, expectedMarker);
  } else if (!promptWithMarker.includes(expectedMarker)) {
    promptWithMarker = `${promptWithMarker}\n\nAt the very end of your response, on a new line, output:\n${expectedMarker}`;
  }

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let completed = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let connectionMisses = 0;
    // Nothing (ACCEPTED / PROGRESS / STATUS / RESULT) has come back for this request yet. Without
    // this guard a request posted while the extension was reloading waited the full 5-minute
    // deadline in silence. The first resend is safe: the worker reserves the request ID and
    // treats a duplicate START as the same job.
    let sawExtension = false;
    let acceptResend: ReturnType<typeof setTimeout> | null = null;
    let acceptDeadline: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      window.removeEventListener('message', messageHandler);
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
      if (acceptResend) clearTimeout(acceptResend);
      if (acceptDeadline) clearTimeout(acceptDeadline);
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
    };

    const onAbort = () => {
      if (completed) return;
      completed = true;
      cleanup();
      try {
        window.postMessage({
          source: PAGE_SOURCE,
          type: 'CANCEL_REQUEST',
          requestId
        }, '*');
      } catch {}
      reject(new DOMException('Extraction stopped by user.', 'AbortError'));
    };

    if (options.signal) {
      if (options.signal.aborted) {
        return reject(new DOMException('Extraction stopped by user.', 'AbortError'));
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    const messageHandler = (event: MessageEvent) => {
      if (!fromExtension(event)) return;
      const data = event.data;
      if (data.source !== EXT_SOURCE) return;
      if (data.requestId === requestId) sawExtension = true;

      if (data.type === 'STUDY_AI_STATUS' && data.requestId === requestId && !data.ok) {
        if (data.transportError && ++connectionMisses < 3) return;
        completed = true; cleanup();
        post({ type: 'CANCEL_REQUEST', requestId });
        reject(new BridgeError(data.error || 'Extension lost this request. Retry this page.', { retryable: true, code: 'lost' }));
        return;
      }
      if (['STUDY_AI_PROGRESS', 'STUDY_AI_STATUS'].includes(data.type) && data.requestId === requestId) {
        connectionMisses = 0;
        if (options.onProgress) {
          try { options.onProgress(data.step || 'working', data.detail || '', data.chatUrl); } catch {}
        }
      }

      if (data.type === 'STUDY_AI_RESULT' && data.requestId === requestId) {
        if (completed) return;
        completed = true;
        cleanup();

        post({ type: 'RESULT_ACK', requestId });
        if (!data.ok) {
          const message = data.error || 'Extension extraction failed.';
          return reject(new BridgeError(message, { retryable: isRetryableBridgeMessage(message), code: 'failed' }));
        }

        const rawText = data.text || '';
        const elements = parseExtensionOutputToElements(rawText);
        resolve({ rawText, elements, expectedMarker, chatUrl: data.chatUrl });
      }
    };

    window.addEventListener('message', messageHandler);

    timer = setTimeout(() => {
      if (!completed) {
        completed = true;
        cleanup();
        post({ type: 'CANCEL_REQUEST', requestId });
        reject(
          new BridgeError('Extraction timed out waiting for AI chat reply. Check the open AI tab in Chrome.', { retryable: true, code: 'timeout' })
        );
      }
    }, timeoutMs);

    // Prepare payload. A batch sends an array; the worker stores it as-is and adapters attach each.
    const strip = (b64: string) => (b64.includes(';base64,') ? b64.split(';base64,')[1] : b64);
    const batch = (options.base64Images || []).filter(Boolean).map(strip);
    const cleanBase64: string | string[] | null = batch.length > 1 ? batch
      : batch.length === 1 ? batch[0]
      : options.base64Image ? strip(options.base64Image) : null;

    const payload = {
      fileNames: batch.length > 1 ? (options.fileNames || null) : null,
      source: PAGE_SOURCE,
      type: 'EXTRACT_REQUEST',
      requestId,
      expectedMarker,
      pageNumber: pNum || null,
      totalPages: options.totalPages || null,
      prompt: promptWithMarker,
      responseFormat: options.responseFormat || 'json',
      timeoutMs,
      fileName: options.fileName || 'page.png',
      fileBase64: cleanBase64,
      mimeType: options.mimeType || 'image/png',
      provider,
      continueChat: !!options.continueChat,
      skipPdf: !!options.skipPdf,
      silent: options.silent !== false,
      chatUrl: options.chatUrl || null,
    };

    if (options.onProgress) {
      try { options.onProgress('start', `Opening ${provider.toUpperCase()} in Chrome tab...`); } catch {}
    }

    post(payload);
    poll = setInterval(() => post({ type: 'REQUEST_STATUS', requestId }), 10000);
    acceptResend = setTimeout(() => { if (!completed && !sawExtension) post(payload); }, ACCEPT_RESEND_MS);
    acceptDeadline = setTimeout(() => {
      if (completed || sawExtension) return;
      completed = true;
      cleanup();
      post({ type: 'CANCEL_REQUEST', requestId });
      reject(new BridgeError(
        'The extension did not accept the request. Reload TextExtract Pro Bridge in chrome://extensions and refresh this page, then retry.',
        { retryable: true, code: 'not_accepted' }
      ));
    }, ACCEPT_DEADLINE_MS);
  });
}

const ACCEPT_RESEND_MS = 4000;
const ACCEPT_DEADLINE_MS = 15000;

// Failures the extension itself labels as transient or asks the user to "retry this page".
// Login, oversize replies, unreadable JSON and user aborts need a person, not another attempt.
const RETRYABLE_MESSAGE = /did not respond|not responding|stopped responding|did not accept|lost this request|retry this page|interrupted|busy with another|reloaded or disconnected|tab load timed out|tab was closed|did not acknowledge|job missing|timed out|deadline reached|could not attach|upload not confirmed|attachment disappeared|still generating|transport/i;
const FATAL_MESSAGE = /stopped by user|too large|login|log in|composer not found|kept getting cleared|no mcqs|belongs to another tab|unknown ai provider|prompt is empty|protocol|reload textextract pro bridge 2\.5/i;

function isRetryableBridgeMessage(message: string): boolean {
  if (FATAL_MESSAGE.test(message)) return false;
  return RETRYABLE_MESSAGE.test(message);
}

/** True when a bridge failure is worth another attempt (transient transport, lost job, timeout). */
export function isRetryableBridgeError(error: unknown): boolean {
  if (!error) return false;
  if (isAbort(error)) return false;
  if (error instanceof BridgeError || typeof (error as BridgeError).retryable === 'boolean') return !!(error as BridgeError).retryable;
  return isRetryableBridgeMessage(String((error as { message?: string }).message || error));
}

function abortError() {
  return new DOMException('Extraction stopped by user.', 'AbortError');
}
// Keep the original error object whenever it looks like one; `instanceof Error` is false for
// errors created in another realm (iframes, test VMs) and would hide an AbortError's name.
const toError = (error: unknown): Error =>
  (error && typeof error === 'object' && 'message' in error) ? (error as Error) : new Error(String(error));
const isAbort = (error: unknown) => (error as { name?: string } | null)?.name === 'AbortError';

/** Abortable sleep. Resolves early (rejecting with AbortError) when the signal fires. */
export function bridgeDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(t); reject(abortError()); };
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface BridgeRetryInfo {
  /** Attempt that just failed (1-based). */
  attempt: number;
  /** Total attempts allowed (retries + 1). */
  maxAttempts: number;
  error: Error;
  /** Delay before the next attempt starts. */
  delayMs: number;
}

export interface BridgeRetryOptions {
  /** Extra attempts after the first failure. Default 2. */
  retries?: number;
  /** First retry delay; doubles each time up to maxDelayMs. Default 1500 ms. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  isRetryable?: (error: unknown) => boolean;
  /** Called before each retry; may be async (e.g. reset the chat URL, update the UI). */
  onRetry?: (info: BridgeRetryInfo) => void | Promise<void>;
}

/**
 * Run a bridge task with bounded retries on transient failures. The task receives the attempt
 * number (1-based) so a caller can start a fresh chat or a new marker on a retry.
 * Aborts and non-retryable errors are rethrown immediately.
 */
export async function withBridgeRetry<T>(task: (attempt: number) => Promise<T>, options: BridgeRetryOptions = {}): Promise<T> {
  const retries = Math.max(0, Math.floor(options.retries ?? 2));
  const baseDelay = Math.max(0, options.baseDelayMs ?? 1500);
  const maxDelay = Math.max(baseDelay, options.maxDelayMs ?? 10000);
  const retryable = options.isRetryable || isRetryableBridgeError;
  const maxAttempts = retries + 1;
  let attempt = 0;
  while (true) {
    attempt++;
    if (options.signal?.aborted) throw abortError();
    try {
      return await task(attempt);
    } catch (error) {
      const err = toError(error);
      if (attempt >= maxAttempts || options.signal?.aborted || isAbort(err) || !retryable(err)) throw err;
      const delayMs = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);
      if (options.onRetry) await options.onRetry({ attempt, maxAttempts, error: err, delayMs });
      await bridgeDelay(delayMs, options.signal);
    }
  }
}

export type BridgeQueueItemStatus = 'running' | 'retrying' | 'done' | 'failed' | 'skipped';

export interface BridgeQueueProgress {
  index: number;
  total: number;
  /** Attempt in progress or just finished (1-based). */
  attempt: number;
  status: BridgeQueueItemStatus;
  error?: Error;
  done: number;
  failed: number;
}

export interface BridgeQueueResult<R> {
  index: number;
  status: 'done' | 'failed' | 'skipped';
  value?: R;
  error?: Error;
  attempts: number;
}

export interface BridgeQueueContext<R> {
  index: number;
  total: number;
  attempt: number;
  signal?: AbortSignal;
  /** Result of the previous item that completed, for continuation context. */
  previous?: R;
}

export interface BridgeQueueOptions<R> extends Omit<BridgeRetryOptions, 'onRetry'> {
  /** Stop the queue at the first item that exhausts its retries (default true). */
  stopOnError?: boolean;
  /** Settle time between items (default 1200 ms) so the AI tab and chat can catch up. */
  pauseBetweenMs?: number;
  /** Polled before each item; while it returns true the queue waits (Pause button). */
  shouldPause?: () => boolean;
  onProgress?: (progress: BridgeQueueProgress) => void;
  onRetry?: (index: number, info: BridgeRetryInfo) => void | Promise<void>;
  /** Called after an item succeeds, before the next starts. */
  onItemDone?: (index: number, value: R) => void | Promise<void>;
}

/**
 * Send items through the bridge one at a time. Guarantees: items run strictly in order, no item
 * runs again after it succeeded, every index gets exactly one result, failures are retried per
 * item with backoff, and an abort stops the queue with remaining items marked `skipped`.
 * The worker is the bridge call (e.g. extractWithStudyAiBridge) plus the caller's own bookkeeping.
 */
export async function runBridgeQueue<I, R>(
  items: readonly I[],
  worker: (item: I, ctx: BridgeQueueContext<R>) => Promise<R>,
  options: BridgeQueueOptions<R> = {}
): Promise<BridgeQueueResult<R>[]> {
  const total = items.length;
  const results: BridgeQueueResult<R>[] = [];
  const stopOnError = options.stopOnError !== false;
  const pauseBetween = Math.max(0, options.pauseBetweenMs ?? 1200);
  let done = 0;
  let failed = 0;
  let previous: R | undefined;
  let stopped = false;
  const report = (progress: Omit<BridgeQueueProgress, 'total' | 'done' | 'failed'>) => {
    try { options.onProgress?.({ ...progress, total, done, failed }); } catch {}
  };
  for (let index = 0; index < total; index++) {
    if (stopped || options.signal?.aborted) {
      results.push({ index, status: 'skipped', attempts: 0 });
      report({ index, attempt: 0, status: 'skipped' });
      continue;
    }
    try {
      while (options.shouldPause?.()) await bridgeDelay(250, options.signal);
    } catch (error) {
      // Aborted while paused: skip this and the rest.
      stopped = true;
      results.push({ index, status: 'skipped', attempts: 0, error: error as Error });
      report({ index, attempt: 0, status: 'skipped' });
      continue;
    }
    let attempts = 0;
    try {
      const value = await withBridgeRetry(async attempt => {
        attempts = attempt;
        report({ index, attempt, status: attempt > 1 ? 'retrying' : 'running' });
        return worker(items[index], { index, total, attempt, signal: options.signal, previous });
      }, {
        retries: options.retries,
        baseDelayMs: options.baseDelayMs,
        maxDelayMs: options.maxDelayMs,
        signal: options.signal,
        isRetryable: options.isRetryable,
        onRetry: info => options.onRetry?.(index, info),
      });
      done++;
      previous = value;
      results.push({ index, status: 'done', value, attempts });
      report({ index, attempt: attempts, status: 'done' });
      try { await options.onItemDone?.(index, value); } catch {}
    } catch (error) {
      const err = toError(error);
      const aborted = isAbort(err);
      failed++;
      results.push({ index, status: 'failed', error: err, attempts });
      report({ index, attempt: attempts, status: 'failed', error: err });
      if (aborted || stopOnError) stopped = true;
      continue;
    }
    if (index < total - 1 && pauseBetween > 0) {
      try { await bridgeDelay(pauseBetween, options.signal); } catch { stopped = true; }
    }
  }
  return results;
}

/**
 * Resets the active bridge session so the next extraction starts a fresh new chat (for a new document).
 */
export async function resetStudyAiBridgeSession(): Promise<void> {
  if (await resetStudyAiSession()) publishStatus({ ...cachedStatus, session: null });
}

export interface CaptureBridgeOptions {
  provider?: AiProvider;
  fullChat?: boolean;
  chatUrl?: string;
  expectedMarker?: string;
  pageNumber?: number;
  totalPages?: number;
}

/**
 * Capture existing chat content from AI tab without re-uploading
 */
export async function captureFromStudyAiBridge(
  providerOrOptions?: AiProvider | CaptureBridgeOptions,
  fullChatArg = true
): Promise<string> {
  const isAvailable = await pingStudyAiExtension(2000);
  if (!isAvailable.connected) {
    throw new Error('TextExtract Pro Bridge Extension se connect nahi ho pa raha hai. Kripya is page ko F5 (Refresh) karein.');
  }

  if (isAvailable.protocolVersion !== 2) throw new Error('Reload TextExtract Pro Bridge 2.5, then refresh this page.');
  const requestId = requestIdFor('cap');
  let activeProvider: AiProvider = getStoredAiProvider();
  let fullChat = fullChatArg;
  let chatUrl: string | null = null;
  let expectedMarker: string | null = null;
  let pageNumber: number | null = null;
  let totalPages: number | null = null;

  if (typeof providerOrOptions === 'object' && providerOrOptions !== null) {
    activeProvider = providerOrOptions.provider || getStoredAiProvider();
    fullChat = providerOrOptions.fullChat ?? fullChatArg;
    chatUrl = providerOrOptions.chatUrl || null;
    expectedMarker = providerOrOptions.expectedMarker || null;
    pageNumber = providerOrOptions.pageNumber || null;
    totalPages = providerOrOptions.totalPages || null;
  } else if (typeof providerOrOptions === 'string') {
    activeProvider = providerOrOptions;
  }

  return new Promise((resolve, reject) => {
    let completed = false;

    const cleanup = () => {
      window.removeEventListener('message', handler);
      clearTimeout(timer);
      clearInterval(poll);
    };

    const handler = (event: MessageEvent) => {
      if (event.source !== window || !event.data) return;
      const data = event.data;
      if (data.source !== EXT_SOURCE) return;

      if (data.type === 'STUDY_AI_STATUS' && data.requestId === requestId && !data.ok) {
        completed = true; cleanup(); reject(new Error(data.error || 'Capture request was lost.')); return;
      }
      if (data.type === 'STUDY_AI_RESULT' && data.requestId === requestId) {
        if (completed) return;
        completed = true;
        cleanup();

        if (!data.ok) {
          return reject(new Error(data.error || 'Capture failed.'));
        }
        post({ type: 'RESULT_ACK', requestId });
        resolve(data.text || '');
      }
    };

    window.addEventListener('message', handler);

    const timer = setTimeout(() => {
      if (!completed) {
        completed = true;
        cleanup();
        post({ type: 'CANCEL_REQUEST', requestId });
        reject(new Error('Capture timed out waiting for AI tab reply.'));
      }
    }, 90000);
    const poll = setInterval(() => post({ type: 'REQUEST_STATUS', requestId }), 10000);

    window.postMessage({
      source: PAGE_SOURCE,
      type: 'CAPTURE_REQUEST',
      timeoutMs: 90000,
      requestId,
      fullChat,
      chatUrl,
      expectedMarker,
      pageNumber,
      totalPages,
      provider: activeProvider
    }, '*');
  });
}

/**
 * Chat models emit bbox as the array [ymin, xmin, ymax, xmax] (normalized 0-1000), the same as the
 * direct API path. cropImage() needs the object form, so convert it here for both engines.
 */
function normalizeBbox(bbox: any): ExtractedElement['bbox'] {
  if (Array.isArray(bbox) && bbox.length === 4 && bbox.every(n => typeof n === 'number')) {
    return { ymin: bbox[0], xmin: bbox[1], ymax: bbox[2], xmax: bbox[3] };
  }
  if (bbox && typeof bbox === 'object' && ['ymin', 'xmin', 'ymax', 'xmax'].every(k => typeof bbox[k] === 'number')) {
    return bbox;
  }
  return undefined;
}

/**
 * Parses raw text or JSON scraped from AI chat into standard ExtractedElement[]
 */
export function parseExtensionOutputToElements(raw: string): ExtractedElement[] {
  if (!raw) return [];

  const text = raw.replace(/(?:^|\r?\n)[ \t]*---STUDY_AI_COMPLETE[^\r\n]*---[ \t]*(?=\r?\n|$)/g, '').trim();
  if (/^(?:```json\s*)?\[\s*\](?:\s*```)?$/.test(text)) return [];
  const chunksToScan: string[] = [];

  // Extract from all markdown code fences
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(text)) !== null) {
    if (match[1] && match[1].trim().length > 5) {
      chunksToScan.push(match[1].trim());
    }
  }

  if (chunksToScan.length === 0) {
    const unclosedMatch = text.match(/```(?:json)?\s*([\s\S]+)$/i);
    if (unclosedMatch && unclosedMatch[1].trim().length > 5) {
      chunksToScan.push(unclosedMatch[1].trim());
    } else {
      chunksToScan.push(text);
    }
  }

  const allItems: any[] = [];
  for (const chunk of chunksToScan) {
    const startIdx = chunk.indexOf('[');
    const endIdx = chunk.lastIndexOf(']');

    if (startIdx >= 0 && endIdx > startIdx) {
      const jsonStr = chunk.slice(startIdx, endIdx + 1);
      try {
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed)) {
          allItems.push(...parsed);
          continue;
        }
      } catch (_) {}
    }

    // Try parsing whole chunk
    try {
      const parsed = JSON.parse(chunk);
      if (Array.isArray(parsed)) {
        allItems.push(...parsed);
        continue;
      } else if (parsed && typeof parsed === 'object') {
        allItems.push(parsed);
        continue;
      }
    } catch (_) {}
  }

  if (allItems.length > 0) {
    return allItems.map((item: any, idx: number) => {
      // If item has content directly
      if (item.content) {
        return {
          id: `el_ext_${Date.now()}_${idx}`,
          type: item.type || 'text',
          content: item.content,
          bbox: normalizeBbox(item.bbox),
          continues_previous: item.continues_previous === true,
        };
      }

      // If item is structured question: { question, options, answer, solution }
      if (item.question) {
        let combined = item.question.trim();
        if (Array.isArray(item.options) && item.options.length > 0) {
          combined += '\n' + item.options.map((opt: string) => opt.trim()).join('\n');
        }
        if (item.answer) {
          const cleanAns = String(item.answer).replace(/^(Answer|Ans)\s*[:\-]\s*/i, '').trim();
          combined += `\nAnswer: ${cleanAns}`;
        }
        const sol = item.solution || item.explanation || item.sol || item.solution_hi || item.solution_en;
        if (sol) {
          combined += `\nSolution: ${sol}`;
        }

        return {
          id: `el_ext_${Date.now()}_${idx}`,
          type: 'text' as const,
          content: combined,
        };
      }

      // If item is bilingual MockTest item: { question_hi, question_en, solution_hi, ... }
      if (item.question_hi || item.question_en) {
        const q = (item.question_hi || item.question_en || '').trim();
        const opts = [
          item.option1_hi || item.option1_en,
          item.option2_hi || item.option2_en,
          item.option3_hi || item.option3_en,
          item.option4_hi || item.option4_en
        ].filter(Boolean);
        let combined = q;
        if (opts.length) combined += '\n' + opts.join('\n');
        if (item.answer) combined += `\nAnswer: ${item.answer}`;
        const sol = item.solution_hi || item.solution_en || item.solution || item.explanation;
        if (sol) {
          combined += `\nSolution: ${sol}`;
        }

        return {
          id: `el_ext_${Date.now()}_${idx}`,
          type: 'text' as const,
          content: combined,
        };
      }

      // Fallback object to string
      return {
        id: `el_ext_${Date.now()}_${idx}`,
        type: 'text' as const,
        content: typeof item === 'string' ? item : JSON.stringify(item),
      };
    });
  }

  // Check if raw text is conversational refusal/error or lacks real content
  const isErrorOrRefusal = /(?:cannot extract|binary JPEG|corrupted|JFIF|no readable text|I am sorry|I apologize|no questions|cannot read|unable to)/i.test(raw);
  if (isErrorOrRefusal || raw.trim().length < 10) {
    return [];
  }

  // Pure text fallback
  return [
    {
      id: `el_ext_${Date.now()}_0`,
      type: 'text',
      content: raw,
    },
  ];
}

/**
 * Proofread and clean extracted MCQs via the Extension Bridge (Zero-Token mode).
 */
export async function proofreadWithStudyAiBridge(rawText: string, isBilingual = false): Promise<any[]> {
  const prompt = `You are a professional Exam Paper Proofreader and OCR Cleaner.
Review the following extracted MCQ questions, fix typos, eliminate OCR artifacts, ensure proper LaTeX for formulas ($...$ or $$...$$), and format every question clearly.
${isBilingual ? 'Ensure bilingual format (Hindi & English) is accurately preserved and separated.' : 'Preserve the original language without translation.'}

RULES:
1. Extract question text clearly.
2. Extract all options (A, B, C, D, etc.).
3. Clean up any OCR errors, typos, or stray characters.
4. Remove junk text (page numbers, headers, footers).
5. All math formulas and scientific symbols must be in valid LaTeX ($...$).

OUTPUT FORMAT:
Return ONLY a valid JSON array of objects inside \`\`\`json ... \`\`\` code block:
[
  {
    "questionText": "Question statement...",
    "options": [
      { "label": "A", "text": "Option A text" },
      { "label": "B", "text": "Option B text" },
      { "label": "C", "text": "Option C text" },
      { "label": "D", "text": "Option D text" }
    ],
    "answer": "A"
  }
]
At the very end after the JSON code block, on a new line, output:
---STUDY_AI_COMPLETE---

RAW TEXT:
${rawText}`;

  const res = await extractWithStudyAiBridge({
    prompt,
    responseFormat: 'json',
    skipPdf: true,
    provider: getStoredAiProvider()
  });

  const raw = res.rawText || '';
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
  const jsonStr = match[1] ? match[1].trim() : raw.trim();
  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.questions)) return parsed.questions;
  } catch {}
  return [];
}

/**
 * Solves an MCQ question with detailed bilingual step-by-step pedagogical solution via Extension Bridge.
 */
export async function solveQuestionWithStudyAiBridge(item: any): Promise<{
  solution_hi: string;
  solution_en: string;
  difficulty_level: 'easy' | 'medium' | 'hard';
}> {
  const prompt = `You are an elite Indian Competitive Exam Educator and Master Test-Series Author.
Provide a THOROUGH, IN-DEPTH, STEP-BY-STEP PEDAGOGICAL SOLUTION tailored precisely to this question in BOTH Hindi and English.

QUESTION:
Target Answer: ${item.answer || 'Deduce correct answer'}
Question (Hindi): ${item.question_hi || ''}
(A) ${item.option1_hi || ''}
(B) ${item.option2_hi || ''}
(C) ${item.option3_hi || ''}
(D) ${item.option4_hi || ''}

Question (English): ${item.question_en || ''}
(A) ${item.option1_en || ''}
(B) ${item.option2_en || ''}
(C) ${item.option3_en || ''}
(D) ${item.option4_en || ''}

GUIDELINES:
- State given data, core formula in LaTeX ($...$), and step-by-step intermediate calculations.
- STRICT NO-OPTION-LETTER RULE: Never refer to option letters ("Option A is correct"). State actual facts, formulas, or calculated values.
${HTML_LATEX_FORMAT_RULES}

OUTPUT FORMAT:
Return ONLY a valid JSON object inside \`\`\`json ... \`\`\` code block:
{
  "solution_hi": "विस्तृत चरणबद्ध हल...",
  "solution_en": "Detailed step-by-step solution...",
  "difficulty_level": "medium"
}
At the very end after the JSON code block, on a new line, output:
---STUDY_AI_COMPLETE---`;

  const res = await extractWithStudyAiBridge({
    prompt,
    responseFormat: 'json',
    skipPdf: true,
    provider: getStoredAiProvider()
  });

  const raw = res.rawText || '';
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
  const jsonStr = match[1] ? match[1].trim() : raw.trim();
  try {
    // LaTeX-safe parse: single backslashes (\frac, \times) would otherwise become \f / \t control chars
    const parsed = safeParseAiJsonObject(jsonStr);
    if (!parsed.solution_hi && !parsed.solution_en) throw new Error('No solution fields');
    return {
      solution_hi: parsed.solution_hi || '',
      solution_en: parsed.solution_en || '',
      difficulty_level: (['easy', 'medium', 'hard'].includes(parsed.difficulty_level) ? parsed.difficulty_level : 'medium') as any
    };
  } catch {
    return {
      solution_hi: raw,
      solution_en: raw,
      difficulty_level: 'medium'
    };
  }
}

/**
 * Repairs an incomplete MCQ item (options, answer, subject, solution) via Extension Bridge.
 */
export async function repairQuestionWithStudyAiBridge(item: any): Promise<any> {
  const prompt = `You are an elite competitive exam test-series architect and question digitizer.
You are given an INCOMPLETE exam question item. Clean the question stem, restore all 4 options in Hindi and English, deduce the correct answer, and generate a step-by-step solution.

INPUT QUESTION DATA:
Subject: "${item.subject || ''}"
Question (Hindi): "${item.question_hi || ''}"
Option 1 (Hindi): "${item.option1_hi || ''}"
Option 2 (Hindi): "${item.option2_hi || ''}"
Option 3 (Hindi): "${item.option3_hi || ''}"
Option 4 (Hindi): "${item.option4_hi || ''}"
Question (English): "${item.question_en || ''}"
Option 1 (English): "${item.option1_en || ''}"
Option 2 (English): "${item.option2_en || ''}"
Option 3 (English): "${item.option3_en || ''}"
Option 4 (English): "${item.option4_en || ''}"
Answer Candidate: "${item.answer || ''}"

TASKS:
1. QUESTION STEM: Clean any stray option text from the stem. Ensure both Hindi and English question stems are complete.
2. ALL 4 OPTIONS: Restore clean option1_hi..option4_hi and option1_en..option4_en.
3. CORRECT ANSWER: Deduce exact answer ("A", "B", "C", or "D").
4. SOLUTION: Step-by-step pedagogical solution in both Hindi and English. No option-letter references.
5. FORMAT:
${HTML_LATEX_FORMAT_RULES}

OUTPUT FORMAT:
Return ONLY a valid JSON object inside \`\`\`json ... \`\`\` code block:
{
  "question_hi": "...",
  "question_en": "...",
  "option1_hi": "...",
  "option2_hi": "...",
  "option3_hi": "...",
  "option4_hi": "...",
  "option1_en": "...",
  "option2_en": "...",
  "option3_en": "...",
  "option4_en": "...",
  "answer": "B",
  "subject": "Mathematics",
  "difficulty_level": "medium",
  "solution_hi": "...",
  "solution_en": "..."
}
At the very end after the JSON code block, on a new line, output:
---STUDY_AI_COMPLETE---`;

  const res = await extractWithStudyAiBridge({
    prompt,
    responseFormat: 'json',
    skipPdf: true,
    provider: getStoredAiProvider()
  });

  const raw = res.rawText || '';
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
  const jsonStr = match[1] ? match[1].trim() : raw.trim();
  try {
    return safeParseAiJsonObject(jsonStr);
  } catch {
    return {};
  }
}

/**
 * Repairs broken or malformed LaTeX math formula via Extension Bridge.
 */
export async function repairLatexWithStudyAiBridge(formula: string, contextText = ''): Promise<{
  status: 'valid' | 'fixed' | 'review_required';
  original: string;
  repaired: string;
  changes: string[];
  confidence: number;
  error?: string;
}> {
  const prompt = `You are an elite LaTeX and mathematical typography expert.
Fix this broken or malformed LaTeX equation so that it renders flawlessly in KaTeX and Microsoft Word equation tools.

BROKEN FORMULA:
${formula}

${contextText ? `SURROUNDING CONTEXT:\n${contextText}` : ''}

RULES:
1. Fix missing braces, unescaped characters, unbalanced dollars ($), or broken commands (\\frac, \\sqrt, \\times).
2. Clean up corrupted OCR math symbols.
3. Output the repaired formula enclosed in $...$ or $$...$$.

OUTPUT FORMAT:
Return ONLY a valid JSON object inside \`\`\`json ... \`\`\` code block:
{
  "repairedFormula": "$...$",
  "isRepaired": true,
  "confidence": 0.95,
  "explanation": "Brief explanation of what was fixed"
}
At the very end after the JSON code block, on a new line, output:
---STUDY_AI_COMPLETE---`;

  const res = await extractWithStudyAiBridge({
    prompt,
    responseFormat: 'json',
    skipPdf: true,
    provider: getStoredAiProvider()
  });

  const raw = res.rawText || '';
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
  const jsonStr = match[1] ? match[1].trim() : raw.trim();
  try {
    const parsed = JSON.parse(jsonStr);
    const rep = parsed.repairedFormula || parsed.repaired || formula;
    return {
      status: 'fixed',
      original: formula,
      repaired: rep,
      changes: Array.isArray(parsed.changes) ? parsed.changes : [parsed.explanation || 'Repaired LaTeX syntax via Bridge'],
      confidence: parsed.confidence || 0.95
    };
  } catch {
    return {
      status: 'review_required',
      original: formula,
      repaired: formula,
      changes: ['Could not automatically repair formula'],
      confidence: 0.5,
      error: 'Could not parse repair output'
    };
  }
}

