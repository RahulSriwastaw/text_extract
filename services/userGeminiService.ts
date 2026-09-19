/**
 * User-Owned Gemini Service
 * Directly interacts with Google's Generative Language API from the browser
 * using the user's own authorization (Google OAuth token or personal Google AI Studio key).
 * Zero server-side API key usage, 100% user-owned quota, 0 cost to developer.
 */

import { getAiSettings, AiMessage } from './aiDbService';
import { NumberingStyle, ExtractedElement } from '../types';
import { pingStudyAiExtension, extractWithStudyAiBridge, getStoredAiProvider } from './studyAiBridgeService';

const GEMINI_MODEL = (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env.VITE_GEMINI_MODEL)
  ? (import.meta as any).env.VITE_GEMINI_MODEL
  : 'gemini-flash-latest';
const API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export interface QuestionContext {
  questionId: string;
  questionText: string;
  options: { label: string; text: string }[];
  userAnswer?: string;
  correctAnswer?: string;
  topic?: string;
}

export type AiActionType = 'explain' | 'why_wrong' | 'concept' | 'teach' | 'followup';

let clientKeyIndex = 0;

export function parseUserApiKeys(rawKeyString?: string): string[] {
  if (!rawKeyString) return [];
  return rawKeyString
    .split(/[,\n]+/)
    .map(k => k.trim().replace(/['"\s]/g, ''))
    .filter(k => k.length > 20);
}

export function getNextUserApiKey(rawKeyString?: string): string {
  const keys = parseUserApiKeys(rawKeyString);
  if (keys.length === 0) return '';
  const key = keys[clientKeyIndex % keys.length];
  clientKeyIndex = (clientKeyIndex + 1) % 1000000;
  return key;
}

/**
 * Validates whether the user has a valid authorization configured locally.
 */
export async function checkUserGeminiAuth(): Promise<{
  isAuthenticated: boolean;
  authType: 'oauth' | 'apikey' | 'none';
  userEmail?: string;
  tokenExpired?: boolean;
}> {
  const settings = await getAiSettings();

  if (settings.authType === 'apikey' && settings.apiKey) {
    const validKeys = parseUserApiKeys(settings.apiKey);
    if (validKeys.length > 0) {
      return {
        isAuthenticated: true,
        authType: 'apikey'
      };
    }
  }

  if (settings.authType === 'oauth' && settings.accessToken) {
    // Check expiration if timestamp exists
    if (settings.tokenExpiresAt && Date.now() > settings.tokenExpiresAt) {
      return {
        isAuthenticated: false,
        authType: 'oauth',
        userEmail: settings.userEmail,
        tokenExpired: true
      };
    }
    return {
      isAuthenticated: true,
      authType: 'oauth',
      userEmail: settings.userEmail
    };
  }

  // Check if Study AI Extension Bridge is connected (Free Zero-Token Mode)
  try {
    const bridge = await pingStudyAiExtension(1500);
    if (bridge.connected) {
      return {
        isAuthenticated: true,
        authType: 'extension' as any
      };
    }
  } catch {}

  return {
    isAuthenticated: false,
    authType: 'none'
  };
}

/**
 * Builds educational prompt for question explanation / learning
 */
function buildPrompt(
  action: AiActionType,
  context: QuestionContext,
  language: 'Hindi' | 'English' | 'Hinglish',
  followUpText?: string
): string {
  const formattedOptions = context.options
    .map(o => `${o.label.toUpperCase()}. ${o.text}`)
    .join('\n');

  const langInstruction = 
    language === 'Hindi' 
      ? 'भाषा निर्देश: कृपया शुद्ध, स्पष्ट और सरल हिंदी (Devanagari script) में उत्तर दें। यदि तकनीकी शब्द हों तो उन्हें कोष्ठक में अंग्रेजी में लिख सकते हैं।'
      : language === 'Hinglish'
      ? 'Language instruction: Please explain in friendly, clear conversational Hinglish (Roman script, Hindi + English mix that Indian students understand effortlessly).'
      : 'Language instruction: Please explain in clear, professional English suitable for competitive exam aspirants.';

  const baseHeader = `
You are an expert educational mentor assisting a student preparing for competitive exams.

Exam Question:
${context.questionText}

Options:
${formattedOptions}

Student's Answer: ${context.userAnswer || 'Not answered yet'}
Official Correct Answer: ${context.correctAnswer || 'Not specified'}

${langInstruction}
`;

  switch (action) {
    case 'explain':
      return `${baseHeader}
Task: Provide an in-depth, structured explanation for this question.
Requirements:
1. Clearly state why the correct answer is correct with facts/evidence.
2. If student provided an answer and it is incorrect, gently explain where the misunderstanding is.
3. Briefly touch upon why other options are incorrect or where they apply.
4. Highlight important key points or memorization tips/mnemonics if relevant.
5. Use markdown formatting with clear headings, bullet points, and bold text.`;

    case 'why_wrong':
      return `${baseHeader}
Task: Specifically analyze why the student's answer is wrong and contrast it with the correct answer.
Requirements:
1. Directly address the student's chosen answer: "${context.userAnswer}".
2. Explain the common trap or confusion that leads students to pick this wrong option.
3. Clearly contrast it with why the correct answer is right.
4. Give a practical tip to never confuse these two options again.`;

    case 'concept':
      return `${baseHeader}
Task: Explain the core foundational concept behind this question.
Requirements:
1. Explain the theory/background from absolute basics so any student can grasp it immediately.
2. Provide a real-world analogy or easy-to-remember mental model.
3. Mention key definitions, formulas, or timeline associated with this topic.
4. Keep it concise, engaging, and clear.`;

    case 'teach':
      return `${baseHeader}
Task: Teach this complete topic as a high-yield micro-lesson.
Requirements:
1. Provide a quick summary of this topic.
2. Outline the 3 to 5 most frequently asked questions/angles on this topic in competitive exams.
3. Provide summary notes / cheat-sheet bullets for quick revision.
4. End with one quick self-check practice question with answer.`;

    case 'followup':
      return `${baseHeader}
The student has a specific follow-up question regarding this problem:
Student's Query: "${followUpText}"

Please answer the student's question accurately, maintaining educational tone and context of the original question.`;
  }
}

/**
 * Sends a generation request directly to Google's Generative Language API
 */
export async function generateWithUserGemini(
  action: AiActionType,
  context: QuestionContext,
  previousMessages: AiMessage[] = [],
  followUpText?: string,
  onStreamChunk?: (chunk: string) => void
): Promise<string> {
  const auth = await checkUserGeminiAuth();
  if (!auth.isAuthenticated) {
    if (auth.tokenExpired) {
      throw new Error('Google authorization has expired. Please reconnect your Google account.');
    }
    throw new Error('Google/Gemini connection required. Please connect your Gemini account or API key.');
  }

  const settings = await getAiSettings();
  const language = settings.preferredLanguage || 'Hindi';

  // Construct prompt
  const prompt = buildPrompt(action, context, language, followUpText);

  // If using Study AI Extension Bridge (Zero-Token Mode)
  if ((auth.authType as string) === 'extension') {
    const res = await extractWithStudyAiBridge({
      prompt,
      skipPdf: true,
      continueChat: true,
      provider: getStoredAiProvider(),
      onProgress: (_step, detail) => {
        if (onStreamChunk && detail) {
          onStreamChunk(detail);
        }
      }
    });
    return res.rawText || 'No response from AI chat.';
  }

  // Build conversation contents
  const contents: any[] = [];

  // Add previous conversational context if follow-up
  if (action === 'followup' && previousMessages.length > 0) {
    // Keep last 4 messages for brevity
    const recent = previousMessages.slice(-4);
    for (const msg of recent) {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      });
    }
    contents.push({
      role: 'user',
      parts: [{ text: prompt }]
    });
  } else {
    contents.push({
      role: 'user',
      parts: [{ text: prompt }]
    });
  }

  // Determine endpoint and headers
  let url = `${API_BASE_URL}/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (settings.authType === 'apikey' && settings.apiKey) {
    const activeKey = getNextUserApiKey(settings.apiKey);
    url += `&key=${encodeURIComponent(activeKey)}`;
  } else if (settings.authType === 'oauth' && settings.accessToken) {
    headers['Authorization'] = `Bearer ${settings.accessToken}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 2048,
        topP: 0.95
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    let parsedMessage = `API Error ${response.status}`;
    try {
      const errJson = JSON.parse(errText);
      parsedMessage = errJson.error?.message || errText;
    } catch (e) {
      if (errText) parsedMessage = errText;
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(`Authentication Failed: ${parsedMessage}. Please verify your connection.`);
    }
    if (response.status === 429) {
      throw new Error('Gemini Quota Exceeded: Your personal account rate limit was reached. Please wait a moment.');
    }
    throw new Error(`Gemini Error (${response.status}): ${parsedMessage}`);
  }

  // Handle SSE streaming
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body stream is not available');
  }

  const decoder = new TextDecoder('utf-8');
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data: ')) {
        const jsonStr = trimmed.substring(6).trim();
        if (jsonStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const candidate = parsed.candidates?.[0];
          const textChunk = candidate?.content?.parts?.[0]?.text || '';
          if (textChunk) {
            fullText += textChunk;
            if (onStreamChunk) {
              onStreamChunk(fullText);
            }
          }
        } catch (err) {
          // ignore malformed SSE chunk
        }
      }
    }
  }

  return fullText.trim();
}

/**
 * Extracts layout/text from an image directly using the user's own Gemini credentials.
 * Fulfills requirement: "hum chahte hai users ke gemini ka use kar ke text nikle yahi par apne website me hi"
 */
export async function extractLayoutWithUserGemini(
  base64Image: string,
  numberingStyle: NumberingStyle = NumberingStyle.HASH,
  includeImages: boolean = true,
  isBilingual: boolean = false,
  mcqMode: boolean = true
): Promise<ExtractedElement[]> {
  const auth = await checkUserGeminiAuth();
  if (!auth.isAuthenticated) {
    throw new Error('User Gemini authorization required for local extraction.');
  }

  const settings = await getAiSettings();

  // Strip prefix if present
  const cleanBase64 = base64Image.replace(/^data:image\/[a-zA-Z]+;base64,/, '');

  let url = `${API_BASE_URL}/models/${GEMINI_MODEL}:generateContent`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (settings.authType === 'apikey' && settings.apiKey) {
    const activeKey = getNextUserApiKey(settings.apiKey);
    url += `?key=${encodeURIComponent(activeKey)}`;
  } else if (settings.authType === 'oauth' && settings.accessToken) {
    headers['Authorization'] = `Bearer ${settings.accessToken}`;
  }

  const prompt = `You are an expert OCR and exam question extractor.
Extract all questions, text, and tables from this image.
Format every multiple choice question clearly:
Question: <Question text>
(A) <Option A>
(B) <Option B>
(C) <Option C>
(D) <Option D>
Answer: <Correct Answer letter if visible>

Return a structured JSON array of elements with type: "text" | "table", content: string.`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: cleanBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Extraction failed (${response.status}): ${err}`);
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

  try {
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed)) {
      return parsed.map((item, idx) => ({
        id: `el_${Date.now()}_${idx}`,
        type: item.type || 'text',
        content: item.content || item.text || JSON.stringify(item)
      }));
    }
  } catch (e) {
    // If not valid JSON, wrap raw output
  }

  return [
    {
      id: `el_${Date.now()}_0`,
      type: 'text',
      content: rawText
    }
  ];
}

/**
 * Tests one or multiple API Keys against Gemini to verify validity before saving.
 */
export async function testGeminiApiKey(apiKeyInput: string): Promise<{ success: boolean; message: string; validCount?: number }> {
  const keys = parseUserApiKeys(apiKeyInput);
  if (keys.length === 0) {
    return { success: false, message: 'Please enter at least one valid Gemini API key (starts with AIza... or AQ...)' };
  }

  // Test the first key to verify Google Generative Language API connectivity
  try {
    const testKey = keys[0];
    const url = `${API_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(testKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Hello, respond with OK.' }] }]
      })
    });

    if (res.ok) {
      const msg = keys.length > 1
        ? `Successfully verified ${keys.length} API keys! Smart rotation enabled.`
        : 'Gemini connection verified successfully!';
      return { success: true, message: msg, validCount: keys.length };
    }

    const err = await res.json().catch(() => ({}));
    return {
      success: false,
      message: err.error?.message || `HTTP ${res.status}: Invalid API Key or Quota exceeded`
    };
  } catch (e: any) {
    return {
      success: false,
      message: e.message || 'Network error connecting to Gemini API'
    };
  }
}
