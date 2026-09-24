/**
 * Study AI Bridge Service
 * Connects the web application to TextExtract Pro Bridge (protocol v2).
 * Runs queued extraction through the user's browser session with acknowledged
 * handshakes, cancellation and durable-result recovery.
 */

import { ExtractedElement, NumberingStyle } from '../types';

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
function publishStatus(status: BridgeStatus) {
  cachedStatus = status;
  statusListeners.forEach(fn => { try { fn(status); } catch {} });
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
  window.addEventListener('focus', () => { void pingStudyAiExtension(); });
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
  prevPageTailChunk?: string
): string {
  let numInstruction = 'Start each question with "#" and the number (e.g. #1., #2.).';
  if (numberingStyle === NumberingStyle.Q_DOT) numInstruction = 'Start each question with "Q" and number (e.g. Q1., Q2.).';
  else if (numberingStyle === NumberingStyle.QUESTION_DOT) numInstruction = 'Start each question with "Question" and number (e.g. Question 1., Question 2.).';
  else if (numberingStyle === NumberingStyle.NUMBER_DOT) numInstruction = 'Start each question with just the number followed by a dot (e.g. 1., 2.).';

  const ansInstruction = showAnswers
    ? 'Deduce or extract the correct answer and put "Answer: [Letter]" (e.g. Answer: C) on a new line after options.'
    : 'Do NOT output any answers or answer keys.';

  const bilingualInstruction = isBilingual
    ? 'Translate every question and textual option so both Hindi and English are provided (EXCEPT for English Language tests which must remain 100% English, and Hindi Language tests which must remain 100% Hindi). Two-line question format: Line 1 Hindi, Line 2 English. Options: (a) Hindi / English.'
    : 'Extract in the original language without translation.';

  const refineInstruction = refineMode
    ? 'Strictly exclude exam tags (e.g. SSC CGL shift tags), headers, footers, page numbers, and watermarks.'
    : 'Extract complete text.';

  const continuationInstruction = prevPageTailChunk ? `
IMPORTANT MULTI-PAGE SPLIT QUESTION / CHUNK CONTINUATION:
The bottom of the previous page ended with:
"""
${prevPageTailChunk}
"""
SPLIT QUESTION HANDLING:
- If the top of this current page contains remaining options (e.g. (c), (d) or (a), (b)...), continuation text, or an Answer line that completes the question from the bottom of the previous page:
  CONNECT THEM TOGETHER! Do NOT create an orphan broken question.
  In the first JSON element, include the full question text from the previous page along with the new options/answer so the question is 100% complete!
  Add "continues_previous": true in that JSON element.
- If this page ends with an incomplete question whose options will appear on the next page, extract what is visible.
` : '';

  if (mcqMode) {
    return `You are a professional Exam Paper Digitizer.
Extract ALL multiple-choice questions (MCQs), passages, and tables from this page with 100% fidelity.
${continuationInstruction}
RULES:
1. Extract ONLY the real content present in the image. NEVER output sample, placeholder, or mock questions.
2. NO HTML TAGS: Output clean normal text without <p>, <br>, <b>, <span>, or <table>. Use natural newlines (\\n) for line breaks.
3. ${numInstruction}
4. ${bilingualInstruction}
5. ${ansInstruction}
6. ${refineInstruction}
7. LATEX FOR MATH & SCIENCE ONLY:
   - Use standard LaTeX for formulas, equations, roots, powers, fractions, and variables ($...$ or $$...$$).
   - Regular words, numbers, and units should remain normal plain text.
8. Each option must be on its own line: (a)... \\n (b)... \\n (c)... \\n (d)...
9. READING COMPREHENSION / PASSAGES (CRITICAL):
   - If questions are based on a passage, comprehension text, or directions (e.g., "SET - 34 [Q.164 to Q.168]", "Directions (439-443)", "गद्यांश"):
     YOU MUST INCLUDE THE FULL PASSAGE TEXT WITH EVERY SINGLE QUESTION IN THAT SET!
   - Prepend the complete passage to each question stem (separated by "\\n---\\n").
   - NEVER output the passage only once with the first question! Every question in that set must have the complete passage attached.

OUTPUT FORMAT:
Return ONLY a valid JSON array of objects inside \`\`\`json ... \`\`\` code block:
[
  {
    "type": "text",
    "content": "Full extracted question text with options and answer..."
  }
]
At the very end after the JSON code block, on a new line, output:
---STUDY_AI_COMPLETE---`;
  }

  return `You are a professional Document Digitizer.
Extract all content from this document page with 100% fidelity.
${continuationInstruction}
RULES:
1. Extract ONLY the real content present in the image. NEVER output sample, placeholder, or mock data.
2. NO HTML TAGS: Output clean markdown and plain text without HTML tags.
3. Preserve headings (#, ##), paragraphs, lists (•, 1., 2.), and tables (| Col 1 | Col 2 |).
4. LATEX FOR MATH & SCIENCE ONLY:
   - Enclose mathematical/scientific formulas in LaTeX ($...$ or $$...$$).
5. ${refineInstruction}

OUTPUT FORMAT:
Return ONLY a valid JSON array of objects inside \`\`\`json ... \`\`\` code block:
[
  {
    "type": "text",
    "content": "Full extracted document text or markdown table..."
  }
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
          bbox: item.bbox,
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
