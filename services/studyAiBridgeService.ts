/**
 * Study AI Bridge Service
 * Connects the web application to the 'Study AI Bridge (TestFactory)' Chrome Extension (v1.2.2).
 * Enables 100% free, unlimited text & MCQ extraction directly through the user's
 * active browser session (Gemini, DeepSeek, ChatGPT, Claude) with ZERO API keys or tokens.
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

let cachedStatus: BridgeStatus = {
  connected: false,
  version: undefined,
  session: null,
  provider: (typeof window !== 'undefined' ? (localStorage.getItem('study_ai_provider') as AiProvider) : null) || 'gemini',
  openProviders: [],
};

const statusListeners = new Set<(status: BridgeStatus) => void>();

// Global listener for extension messages
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    const data = event.data;
    if (data.source !== EXT_SOURCE) return;

    if (data.type === 'PONG') {
      const userSelected = getStoredAiProvider();
      // If extension session has a different provider, auto-sync it with user preference
      if (data.ok && data.session && data.session.provider !== userSelected) {
        window.postMessage({
          source: PAGE_SOURCE,
          type: 'SET_PROVIDER',
          provider: userSelected
        }, '*');
      }

      cachedStatus = {
        connected: !!data.ok,
        version: data.version || '2.4.2',
        session: data.session || null,
        provider: userSelected || (data.session?.provider as AiProvider) || 'gemini',
        openProviders: (data.openProviders as AiProvider[]) || [],
        lastPingTime: Date.now(),
      };
      statusListeners.forEach((fn) => {
        try { fn(cachedStatus); } catch {}
      });
    }
  });

  // Automatically attempt ping on boot
  setTimeout(() => {
    pingStudyAiExtension().catch(() => {});
  }, 300);
}

/**
 * Get preferred AI provider (gemini, deepseek, chatgpt, claude)
 */
export function getStoredAiProvider(): AiProvider {
  if (typeof window === 'undefined') return 'gemini';
  return (localStorage.getItem('study_ai_provider') as AiProvider) || 'gemini';
}

/**
 * Set preferred AI provider and synchronize with extension
 */
export function setStoredAiProvider(provider: AiProvider): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('study_ai_provider', provider);
  cachedStatus.provider = provider;
  statusListeners.forEach((fn) => {
    try { fn(cachedStatus); } catch {}
  });

  // Send message to extension background worker to switch provider & reset session
  window.postMessage({
    source: PAGE_SOURCE,
    type: 'SET_PROVIDER',
    provider
  }, '*');
}

/**
 * Subscribe to status updates from the extension
 */
export function subscribeToExtensionStatus(callback: (status: BridgeStatus) => void): () => void {
  statusListeners.add(callback);
  callback(cachedStatus);
  return () => {
    statusListeners.delete(callback);
  };
}

/**
 * Pings the Study AI Bridge Extension to verify if it is running
 */
export function pingStudyAiExtension(timeoutMs = 1500): Promise<BridgeStatus> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      return resolve({ connected: false });
    }

    let resolved = false;

    const cleanup = () => {
      window.removeEventListener('message', handler);
      clearTimeout(timer);
    };

    const handler = (event: MessageEvent) => {
      if (event.source !== window || !event.data) return;
      const data = event.data;
      if (data.source === EXT_SOURCE && data.type === 'PONG') {
        if (!resolved) {
          resolved = true;
          cleanup();
          cachedStatus = {
            connected: !!data.ok,
            version: data.version || '2.4.2',
            session: data.session || null,
            provider: (data.session?.provider as AiProvider) || cachedStatus.provider || 'gemini',
            openProviders: (data.openProviders as AiProvider[]) || [],
            lastPingTime: Date.now(),
          };
          resolve(cachedStatus);
        }
      }
    };

    window.addEventListener('message', handler);

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        console.warn(
          '[TextExtract Bridge] No PONG received within', timeoutMs, 'ms. Either the extension is not installed/enabled, ' +
          'or it needs a reload (chrome://extensions) + a hard refresh of this tab. Open DevTools console for "[TextExtract Bridge]" logs from the extension itself.'
        );
        resolve({ ...cachedStatus, connected: false });
      }
    }, timeoutMs);

    // Send PING
    window.postMessage({
      source: PAGE_SOURCE,
      type: 'PING'
    }, '*');
  });
}

/**
 * Resets the active session in the extension
 */
export function resetStudyAiSession(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(false);

    let resolved = false;
    const handler = (event: MessageEvent) => {
      if (event.source !== window || !event.data) return;
      if (event.data.source === EXT_SOURCE && event.data.type === 'SESSION_RESET') {
        if (!resolved) {
          resolved = true;
          window.removeEventListener('message', handler);
          resolve(true);
        }
      }
    };

    window.addEventListener('message', handler);
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        window.removeEventListener('message', handler);
        resolve(true);
      }
    }, 1200);

    window.postMessage({
      source: PAGE_SOURCE,
      type: 'RESET_SESSION'
    }, '*');
  });
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
    ? 'Translate every question and textual option so both Hindi and English are provided. Two-line question format: Line 1 Hindi, Line 2 English. Options: (a) Hindi / English.'
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
): Promise<{ rawText: string; elements: ExtractedElement[] }> {
  const isAvailable = await pingStudyAiExtension(2000);
  if (!isAvailable.connected) {
    throw new Error(
      'TextExtract Pro Bridge Extension se connect nahi ho pa raha hai. Kripya is page ko ek baar Refresh (F5) karein aur chrome://extensions par extension check karein.'
    );
  }  const pNum = options.pageNumber;
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const expectedMarker = options.expectedMarker || (pNum 
    ? `---STUDY_AI_COMPLETE_P${pNum}_${requestId}---` 
    : `---STUDY_AI_COMPLETE_${requestId}---`);
  const provider = options.provider || getStoredAiProvider();
  const timeoutMs = options.timeoutMs || 300000; // 5 min timeout for slow AI chats

  // Inject unique request-scoped completion marker to eliminate cross-page turn collisions
  let promptWithMarker = options.prompt || '';
  if (pNum && !promptWithMarker.includes(`[PAGE ${pNum}`)) {
    promptWithMarker = `[PAGE ${pNum} DOCUMENT EXTRACTION]\n` + promptWithMarker;
  }
  if (promptWithMarker.includes('---STUDY_AI_COMPLETE---')) {
    promptWithMarker = promptWithMarker.replace(/---STUDY_AI_COMPLETE---/g, expectedMarker);
  } else if (!promptWithMarker.includes(expectedMarker)) {
    promptWithMarker = `${promptWithMarker}\n\nAt the very end after the JSON code block, on a new line, output:\n${expectedMarker}`;
  }

  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    let completed = false;

    const cleanup = () => {
      window.removeEventListener('message', messageHandler);
      if (timer) clearTimeout(timer);
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
      if (event.source !== window || !event.data) return;
      const data = event.data;
      if (data.source !== EXT_SOURCE) return;

      if (data.type === 'STUDY_AI_PROGRESS' && data.requestId === requestId) {
        if (options.onProgress) {
          options.onProgress(data.step || 'working', data.detail || '', data.chatUrl);
        }
      }

      if (data.type === 'STUDY_AI_RESULT' && data.requestId === requestId) {
        if (completed) return;
        completed = true;
        cleanup();

        if (!data.ok) {
          return reject(new Error(data.error || 'Extension extraction failed.'));
        }

        const rawText = data.text || '';
        const elements = parseExtensionOutputToElements(rawText);
        resolve({ rawText, elements, expectedMarker, chatUrl: data.chatUrl } as any);
      }
    };

    window.addEventListener('message', messageHandler);

    timer = setTimeout(() => {
      if (!completed) {
        completed = true;
        cleanup();
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
      options.onProgress('start', `Opening ${provider.toUpperCase()} in Chrome tab...`);
    }

    window.postMessage(payload, '*');
  });
}

/**
 * Resets the active bridge session so the next extraction starts a fresh new chat (for a new document).
 */
export async function resetStudyAiBridgeSession(): Promise<void> {
  if (typeof window === 'undefined') return;
  window.postMessage({
    source: PAGE_SOURCE,
    type: 'RESET_SESSION',
  }, '*');
  if (cachedStatus.session) {
    cachedStatus.session.chatUrl = null;
    cachedStatus.session.batch = 0;
  }
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

  const requestId = `cap_${Date.now()}`;
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
    };

    const handler = (event: MessageEvent) => {
      if (event.source !== window || !event.data) return;
      const data = event.data;
      if (data.source !== EXT_SOURCE) return;

      if (data.type === 'STUDY_AI_RESULT' && data.requestId === requestId) {
        if (completed) return;
        completed = true;
        cleanup();

        if (!data.ok) {
          return reject(new Error(data.error || 'Capture failed.'));
        }
        resolve(data.text || '');
      }
    };

    window.addEventListener('message', handler);

    const timer = setTimeout(() => {
      if (!completed) {
        completed = true;
        cleanup();
        reject(new Error('Capture timed out waiting for AI tab reply.'));
      }
    }, 12000);

    window.postMessage({
      source: PAGE_SOURCE,
      type: 'CAPTURE_REQUEST',
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

  const text = raw.trim();
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
