/**
 * Study AI Bridge Service
 * Connects the web application to TextExtract Pro Bridge (protocol v2).
 * Runs queued extraction through the user's browser session with acknowledged
 * handshakes, cancellation and durable-result recovery.
 */

import { ExtractedElement, NumberingStyle, OptionArrangement } from '../types';

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

export interface BridgeStatus {
  connected: boolean;
  protocolVersion?: number;
  error?: string;
  version?: string;
  session?: BridgeSessionInfo | null;
  provider?: AiProvider;
  openProviders?: AiProvider[];
  lastPingTime?: number;
}

export interface ExtractWithBridgeOptions {
  base64Image?: string;
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
let cachedStatus: BridgeStatus = { connected: false, provider: getStoredAiProvider(), openProviders: [] };
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

function scheduleReconnect() {
  if (typeof window === 'undefined' || reconnectTimer || cachedStatus.connected) return;
  if (reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) return;
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    // A hidden tab cannot help the user; the visibility listener re-arms this.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    void pingStudyAiExtension();
  }, reconnectDelay);
}

/** Re-arm the bounded reconnect loop; used wherever the user shows interest in the bridge. */
function rearmReconnect(pingNow: boolean) {
  reconnectAttempts = 0;
  reconnectDelay = 1000;
  if (pingNow) void pingStudyAiExtension();
  else scheduleReconnect();
}

function publishStatus(status: BridgeStatus) {
  cachedStatus = status;
  statusListeners.forEach(fn => { try { fn(status); } catch {} });
  if (status.connected) {
    reconnectDelay = 1000;
    reconnectAttempts = 0;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  } else {
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_DELAY);
    scheduleReconnect();
  }
}
function fromExtension(event: MessageEvent) {
  return event.source === window && event.origin === window.location.origin && event.data?.source === EXT_SOURCE;
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
  publishStatus({ ...cachedStatus, provider, session: null });
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
export function pingStudyAiExtension(timeoutMs = 2500): Promise<BridgeStatus> {
  if (typeof window === 'undefined') return Promise.resolve({ connected: false });
  if (pendingPing) return pendingPing;
  pendingPing = new Promise<BridgeStatus>(resolve => {
    const requestId = requestIdFor('ping');
    const provider = getStoredAiProvider();
    const finish = (status: BridgeStatus) => {
      clearTimeout(timer);
      clearInterval(retry);
      window.removeEventListener('message', handler);
      publishStatus(status);
      resolve(status);
    };
    const handler = (event: MessageEvent) => {
      if (!fromExtension(event) || event.data.type !== 'PONG' || event.data.requestId !== requestId) return;
      const data = event.data;
      finish({ connected: !!data.ok, version: data.version, protocolVersion: data.protocolVersion,
        error: data.error, session: data.session || null, provider: getStoredAiProvider(),
        openProviders: (data.openProviders || []).filter((p: AiProvider) => providers.includes(p)), lastPingTime: Date.now() });
    };
    const send = () => post({ type: 'PING', requestId, provider });
    const timer = setTimeout(() => finish({ ...cachedStatus, connected: false, session: null,
      error: 'Extension did not respond. Reload the extension and refresh this page.' }), timeoutMs);
    const retry = setInterval(send, Math.max(300, Math.floor(timeoutMs / 3)));
    window.addEventListener('message', handler);
    send();
  }).finally(() => { pendingPing = null; });
  return pendingPing;
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
    if (fromExtension(event) && event.data.type === 'BRIDGE_READY') void pingStudyAiExtension();
  });
  window.addEventListener('focus', () => { rearmReconnect(true); });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !cachedStatus.connected) rearmReconnect(true);
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
    throw new Error(
      'TextExtract Pro Bridge Extension se connect nahi ho pa raha hai. Kripya is page ko ek baar Refresh (F5) karein aur chrome://extensions par extension check karein.'
    );
  }
  if (isAvailable.protocolVersion !== 2) throw new Error('Reload TextExtract Pro Bridge 2.5 in chrome://extensions, then refresh this page.');
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
    let timer: NodeJS.Timeout | null = null;
    let completed = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let connectionMisses = 0;

    const cleanup = () => {
      window.removeEventListener('message', messageHandler);
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
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

      if (data.type === 'STUDY_AI_STATUS' && data.requestId === requestId && !data.ok) {
        if (data.transportError && ++connectionMisses < 3) return;
        completed = true; cleanup();
        post({ type: 'CANCEL_REQUEST', requestId });
        reject(new Error(data.error || 'Extension lost this request. Retry this page.'));
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
          return reject(new Error(data.error || 'Extension extraction failed.'));
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
          new Error('Extraction timed out waiting for AI chat reply. Check the open AI tab in Chrome.')
        );
      }
    }, timeoutMs);

    // Prepare payload
    let cleanBase64 = options.base64Image || null;
    if (cleanBase64 && cleanBase64.includes(';base64,')) {
      cleanBase64 = cleanBase64.split(';base64,')[1];
    }

    const payload = {
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
  });
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
- NO HTML TAGS: Use natural newlines (\\n).
- LATEX FOR MATH: Wrap formulas in $...$.

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
    const parsed = JSON.parse(jsonStr);
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
5. LATEX: Wrap math in $...$. NO HTML tags.

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
    return JSON.parse(jsonStr);
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

