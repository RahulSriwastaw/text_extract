import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { NumberingStyle } from '../types.js';

const app = express();
app.use(express.json({ limit: '50mb' }));

app.get('/api/config', (req, res) => {
  try {
    const { totalKeys } = getGeminiClient();
    res.json({ totalKeys });
  } catch (error) {
    res.json({ totalKeys: 0 });
  }
});

app.get('/api/debug-key', (req, res) => {
  const k = process.env.GEMINI_API_KEY || '';
  res.json({ key: k, length: k.length });
});

let keyIndex = 0;
const keyHealth = new Map<string, { 
  lastErrorTime: number, 
  lastSuccessTime: number, 
  consecutiveErrors: number, 
  totalErrors: number, 
  totalSuccesses: number,
  errorType?: string 
}>();
const deadKeys = new Set<string>();

const getAllKeys = () => {
  const primaryKey = process.env.GEMINI_API_KEY;
  const keysString = process.env.GEMINI_API_KEYS || '';
  
  let allKeys = keysString
    .split(',')
    .map(k => k.trim().replace(/['"\s]/g, ''))
    .filter(k => k && k.length > 20);
    
  if (primaryKey && primaryKey.length > 20) {
    const cleanPrimary = primaryKey.trim().replace(/['"\s]/g, '');
    if (!allKeys.includes(cleanPrimary)) {
      allKeys.unshift(cleanPrimary);
    }
  }
  return allKeys.filter(k => !deadKeys.has(k));
};

// Admin Auth Middleware
const checkAdminAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'password123';

  if (!authHeader) {
    return res.status(401).json({ error: "Authorization required" });
  }

  const encoded = authHeader.split(' ')[1];
  const decoded = Buffer.from(encoded, 'base64').toString().split(':');
  const user = decoded[0];
  const pass = decoded[1];

  if (user === adminUser && pass === adminPass) {
    next();
  } else {
    res.status(403).json({ error: "Invalid credentials" });
  }
};

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'password123';

  if (username === adminUser && password === adminPass) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "Invalid username or password" });
  }
});

app.get('/api/admin/stats', checkAdminAuth, (req, res) => {
  const allKeys = getAllKeys();
  const stats = allKeys.map(k => {
    const health = keyHealth.get(k) || { 
      lastErrorTime: 0, 
      lastSuccessTime: 0, 
      consecutiveErrors: 0, 
      totalErrors: 0, 
      totalSuccesses: 0 
    };
    return {
      keyPrefix: k.substring(0, 8) + '...',
      key: k,
      ...health,
      isDead: deadKeys.has(k)
    };
  });
  
  // Also include dead keys
  const deadStats = Array.from(deadKeys).map(k => {
    const health = keyHealth.get(k) || { lastErrorTime: 0, lastSuccessTime: 0, consecutiveErrors: 0, totalErrors: 0, totalSuccesses: 0 };
    return {
      keyPrefix: k.substring(0, 8) + '...',
      key: k,
      ...health,
      isDead: true
    };
  });

  res.json({ keys: stats, deadKeys: deadStats });
});

app.post('/api/admin/dead-key', checkAdminAuth, (req, res) => {
  const { key } = req.body;
  if (key) {
    deadKeys.add(key);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: "Key required" });
  }
});

const getGeminiClient = (skipKeys: string[] = []) => {
  const allKeys = getAllKeys();
  const now = Date.now();

  if (allKeys.length === 0) {
    throw new Error("No valid API keys found. Please verify your keys in the Settings menu (GEMINI_API_KEY or GEMINI_API_KEYS).");
  }

  // Filter out dead/skip keys
  let candidates = allKeys.filter(k => !skipKeys.includes(k));

  if (candidates.length === 0 && skipKeys.length > 0) {
    candidates = allKeys.filter(k => k !== skipKeys[skipKeys.length - 1]);
  }

  if (candidates.length === 0) candidates = allKeys;

  let selectedKey = '';
  
  // 1. Prioritize keys that have NEVER errored or haven't errored in 2 min
  const healthyCandidates = candidates.filter(c => {
    const health = keyHealth.get(c);
    return !health || (now - health.lastErrorTime > 120000);
  });

  if (healthyCandidates.length > 0) {
    // Pick the one used least recently for success (to distribute load)
    selectedKey = healthyCandidates.sort((a, b) => {
      const hA = keyHealth.get(a)?.lastSuccessTime || 0;
      const hB = keyHealth.get(b)?.lastSuccessTime || 0;
      return hA - hB;
    })[0];
  }

  // 2. Fallback: try any key not recently errored (60s)
  if (!selectedKey) {
    const okayCandidates = candidates.filter(c => {
      const health = keyHealth.get(c);
      return !health || (now - health.lastErrorTime > 60000);
    });
    if (okayCandidates.length > 0) {
      selectedKey = okayCandidates.sort((a, b) => {
        const hA = keyHealth.get(a)?.lastSuccessTime || 0;
        const hB = keyHealth.get(b)?.lastSuccessTime || 0;
        return hA - hB;
      })[0];
    }
  }

  // 3. Last resort: pick the one with most distant lastErrorTime among candidates
  if (!selectedKey) {
    selectedKey = candidates.sort((a, b) => {
      const hA = keyHealth.get(a)?.lastErrorTime || 0;
      const hB = keyHealth.get(b)?.lastErrorTime || 0;
      return hA - hB;
    })[0];
  }

  return { client: new GoogleGenAI({ apiKey: selectedKey }), key: selectedKey, totalKeys: allKeys.length };
};

const reportKeySuccess = (key: string) => {
  const health = keyHealth.get(key) || { 
    lastErrorTime: 0, 
    lastSuccessTime: 0, 
    consecutiveErrors: 0, 
    totalErrors: 0, 
    totalSuccesses: 0 
  };
  health.lastSuccessTime = Date.now();
  health.consecutiveErrors = 0;
  health.totalSuccesses++;
  keyHealth.set(key, health);
};

const reportKeyError = (key: string, type?: string, isPermanent = false) => {
  if (isPermanent) {
    deadKeys.add(key);
    console.error(`Key ${key.substring(0, 8)}... marked as PERMANENTLY DEAD (Invalid or Denied)`);
    return;
  }
  const health = keyHealth.get(key) || { 
    lastErrorTime: 0, 
    lastSuccessTime: 0, 
    consecutiveErrors: 0, 
    totalErrors: 0, 
    totalSuccesses: 0 
  };
  health.lastErrorTime = Date.now();
  health.consecutiveErrors++;
  health.totalErrors++;
  health.errorType = type;
  keyHealth.set(key, health);
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runAIAction(action: (client: any) => Promise<any>, maxRetries?: number) {
  const allKeys = getAllKeys();
  const effectiveRetries = maxRetries ?? Math.max(8, allKeys.length * 2);
  let triedKeys: string[] = [];
  let lastError: any = null;

  for (let attempt = 0; attempt <= effectiveRetries; attempt++) {
    const { client, key, totalKeys } = getGeminiClient(triedKeys);
    triedKeys.push(key);
    if (triedKeys.length > 5) triedKeys.shift();

    try {
      const result = await action(client);
      reportKeySuccess(key);
      return result;
    } catch (error: any) {
      lastError = error;
      const errorStr = (error?.message || String(error)).toUpperCase();
      
      const isQuotaError = errorStr.includes("429") || 
                           errorStr.includes("RESOURCE_EXHAUSTED") ||
                           errorStr.includes("QUOTA") ||
                           errorStr.includes("LIMIT");
      
      const isServerOverloaded = errorStr.includes("503") || 
                                 errorStr.includes("500") ||
                                 errorStr.includes("UNAVAILABLE") ||
                                 errorStr.includes("FETCH FAILED") ||
                                 errorStr.includes("ECONNRESET") ||
                                 errorStr.includes("ETIMEDOUT");

      const isInvalidKey = errorStr.includes("API KEY NOT VALID") || 
                           errorStr.includes("PERMISSION_DENIED") ||
                           errorStr.includes("API_KEY_INVALID");

      if (isInvalidKey) {
        reportKeyError(key, 'INVALID', true);
        continue; 
      }

      if (isQuotaError || isServerOverloaded) {
        const errType = isQuotaError ? 'Quota' : 'Overload';
        console.warn(`Key ${key.substring(0, 8)}... error (${errType}). Attempt ${attempt + 1}/${effectiveRetries + 1}. Active keys: ${totalKeys}`);
        reportKeyError(key, errType);
        
        // Exponential backoff: 1.5s, 3s, 6s... with jitter
        const backoffMs = Math.pow(2, Math.min(attempt, 4)) * 1500 + Math.random() * 1000;
        await delay(backoffMs); 
        continue;
      }
      
      throw error;
    }
  }
  
  const finalError = new Error(`Exhausted ${triedKeys.length} attempts across available keys. ${lastError?.message || "Service unavailable"}.`);
  (finalError as any).status = 429;
  throw finalError;
}

const extractLayoutWithRetry = async (
  base64Image: string,
  ocrText: string,
  numberingStyle: NumberingStyle,
  includeImages: boolean,
  isBilingual: boolean,
  mcqMode: boolean,
  refineMode: boolean = false
): Promise<any> => {
  const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');

  let numberingInstruction = '';
  switch (numberingStyle) {
    case NumberingStyle.Q_DOT:
      numberingInstruction = 'Replace the question number (e.g., "1.", "Q.1", "23.", "Q12.") at the start of a question with "Q" followed by the number and a dot (e.g., "Q1.", "Q23.").';
      break;
    case NumberingStyle.HASH:
      numberingInstruction = 'Replace the question number (e.g., "1.", "Q.1", "23.", "Q12.") at the start of a question with "#" followed by the number and a dot (e.g., "#1.", "#23.").';
      break;
    case NumberingStyle.QUESTION_DOT:
      numberingInstruction = 'Replace the question number (e.g., "1.", "Q.1", "23.", "Q12.") at the start of a question with the word "Question" followed by the number and a dot (e.g., "Question 1.", "Question 23.").';
      break;
    case NumberingStyle.NUMBER_DOT:
      numberingInstruction = 'Ensure the question number is formatted as the number followed by a dot (e.g., "1.", "23."). Remove any prefixes like "Q." or "Q".';
      break;
    default:
      numberingInstruction = 'Replace the question number at the start of a question with the number followed by a dot.';
  }

  const bilingualInstruction = isBilingual
    ? `**CRITICAL MCQ RULE: BILINGUAL OUTPUT REQUIRED**:
- You MUST output EVERY question and EVERY option in BOTH Hindi and English.
- **QUESTION FORMAT**: "Question: [Number]. [Hindi Question] / [English Question]" (e.g., "Question: 1. 7.5 के प्रथम 8 गुणकों का औसत कितना होगा? / What will be the average of the first 8 multiples of 7.5?")
- **OPTION FORMAT**: Combine Hindi and English into one line: "(a) [Hindi Option] / [English Option]". Use lowercase letters in parentheses for options: (a), (b), (c), (d).
- **ANSWER FORMAT**: After all options, add a line like "Answer: [Label]" (e.g., "Answer: A") on its OWN NEW LINE.
- If the source text is only in one language, translate it to the other and combine.
- Maintain the ordering: Hindi followed by English, separated by a forward slash " / ".
- **VERTICAL ALIGNMENT**: Ensure each question starts on a new line and each option is clearly separated.
- **Answer Preservation**: NEVER skip the answer if it is visible on the page.`
    : `**CRITICAL RULE: NO TRANSLATION**:
- Extract the text EXACTLY in the language it is written.
- If it is in Hindi, output ONLY Hindi.
- If it is in English, output ONLY English.
- DO NOT translate anything.`;

  const imageInstruction = includeImages 
    ? `2. **Diagrams & Figures**:
   - **PLACEMENT**: Identify diagrams (images) and place them in the 'elements' array exactly where they appear in the reading order (e.g., if a diagram is between the question text and the options, it should be placed there).
   - **DESCRIPTION**: For 'image' types, provide a concise but descriptive 'content' field explaining what the diagram shows (e.g., "Circuit diagram with resistors R1 and R2", "Geometry figure showing a triangle inside a circle").`
    : `2. **Diagrams & Figures**:
   - **DO NOT EXTRACT DIAGRAMS OR IMAGES**: Ignore all non-textual content such as diagrams, charts, and figures. Do not create any 'image' elements.`;

  const imageFormattingInstruction = includeImages
    ? `2. **Image Elements**:
   - Identify regions containing diagrams, charts, pattern series, geometry figures, or any non-textual content.
   - Provide the bounding box (bbox) for these regions in normalized coordinates [0-1000].`
    : `2. **Image Elements**:
   - **STRICTLY IGNORE**: Do not extract any image elements.`;

  const mcqInstruction = mcqMode 
    ? `**MCQ EXTRACTION MODE (STRICT FORMATTING REQUIRED)**:
- This document is an MCQ paper.
- Every question MUST start with "Question: [Number]. "
- Every option MUST start with a bracketed lowercase letter like "(a) ", "(b) ", etc.
- **ANSWER FORMAT**: Every MCQ MUST end with "Answer: [Label]" (e.g., "Answer: A") on its OWN NEW LINE after all options.
- **BILINGUAL MATCHING**: If the source document has Hindi and English versions of the same question/option as separate blocks or on different pages, YOU MUST find them and combine them into one single line using the " / " separator. NEVER output the same question twice in different languages.
- **COMPLETE EXTRACTION**: Always check if a question is continued on the next column or page.
- **NUMBERING**: Always use the "Question: [Number]. " prefix for questions.
- **OPTIONS**: Always use "(a) ", "(b) ", etc. for options. Ensure labels are lowercase and bracketed.`
    : `**GENERAL DOCUMENT MODE**:
- Extract text as it appears. Maintain paragraphs and structure.`;

  const refineInstruction = refineMode
    ? `**REFINE MODE ENABLED (SMART CONTENT FILTERING)**:
- YOUR GOAL: Extract ONLY the primary subject matter content.
- **REMOVE JUNK**: Automatically identify and EXCLUDE headers, footers, page numbers, watermark text, boilerplate instructions, exam center codes, dates, or decorative text.
- **PRESERVE CONTENT**: Do NOT change, summarize, or rewrite the actual content. Extract the main text VERBATIM (EXACTLY as written).
- Focus on questions, options, and main paragraphs. If a piece of text looks like it doesn't belong to the core material, SKIP IT.`
    : `**FULLY EXTRACTION MODE (A TO Z)**:
- Extract EVERY piece of text from the page, including headers, footers, page numbers, and small boilerplate text. Leave nothing out.`;

  return runAIAction(async (client) => {
    const response = await client.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [
        {
          inlineData: {
            mimeType: 'image/png',
            data: cleanBase64
          }
        },
        {
          text: `You are a professional Exam Paper Digitizer. Analyze the provided image and extract all elements in their correct reading order.

${mcqInstruction}
${refineInstruction}

**CRITICAL RULE: COMPLETE EXTRACTION**:
- You MUST read the ENTIRE page from top to bottom.
- Do NOT skip any questions, options, paragraphs, or text, no matter how small the font is or where it is located on the page (unless it is junk text and Refine Mode is ON).
- Ensure every single question and its options are extracted.

**OCR CONTEXT**:
Here is the raw text extracted by OCR:
"${ocrText}"
Use this as a reference to improve your accuracy, especially for math formulas and Hindi/English text.

**CRITICAL RULE: LANGUAGE & SCRIPT PRESERVATION**: 
- **ACCURATELY IDENTIFY LANGUAGES**: This document may contain multiple languages (e.g., Hindi and English) mixed together.
- **MAINTAIN ORIGINAL SCRIPT**: Extract text exactly in the script it is written. 
  - If a sentence is in Hindi, use Devanagari script.
  - If a sentence or word is in English, use Latin script.
  - For mixed-language sentences (e.g., Hindi text with English technical terms), preserve the mix exactly as it appears.
${bilingualInstruction}

**EXTRACTION RULES**:
1. **Text Elements**:
   - Identify distinct blocks of text (paragraphs, questions, options, headers).
   - ${numberingInstruction}
   - For multiple-choice options, ensure they are extracted as separate text elements or clearly separated within the text.
   - Preserve mathematical formulas and scientific notations accurately.
   - **STRICT MATH RULE**: You MUST enclose ALL mathematical formulas, variables, and expressions in double dollar signs like \`$$\` ... \`$$\` (e.g., \`$$x^2 + y^2 = r^2$$\`), even for simple inline variables like \`$$x$$\`.
   - Use standard LaTeX format for all math.
   - PAY VERY CLOSE ATTENTION to recurring decimals or numbers with a line/bar over them (e.g., $0.04\\overline{3}$ or $0.\\overline{43}$). You MUST extract the bar correctly using LaTeX \\overline{}! This is a very common requirement.
   - For fractions, always use \`\\frac{num}{den}\`. For square roots, use \`\\sqrt{...}\`.
   - Ensure complex equations are balanced and valid LaTeX.

${imageInstruction}

3. **Tables**:
   - If you find a table, extract it as a 'table' type.
   - Represent the table content in Markdown format.

**OUTPUT FORMAT**:
You must respond ONLY with a valid JSON array of objects. Do not include any markdown formatting like \`\`\`json or \`\`\` in your response. Just the raw JSON array.

Each object in the array must have the following structure:
{
  "type": "text" | "image" | "table",
  "content": "The extracted text, image description, or markdown table",
  "bbox": [ymin, xmin, ymax, xmax] // Optional: normalized coordinates [0-1000] representing the bounding box of the element
}

**BBOX INSTRUCTIONS**:
1. **Text Elements**: bbox is optional but recommended if possible.
${imageFormattingInstruction}
3. **Table Elements**: Provide the bbox for the entire table.

Ensure the elements in the JSON array are ordered exactly as they should be read from top to bottom, left to right.
`
        }
      ],
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
      }
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error("Empty response from Gemini API");
    }

    let parsedElements;
    const cleanedText = responseText.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    parsedElements = JSON.parse(cleanedText);
    if (!Array.isArray(parsedElements)) {
      throw new Error("Response is not a JSON array");
    }
    
    return parsedElements.map((el: any) => {
      let bboxObj = el.bbox;
      if (Array.isArray(el.bbox) && el.bbox.length === 4) {
        bboxObj = {
          ymin: el.bbox[0],
          xmin: el.bbox[1],
          ymax: el.bbox[2],
          xmax: el.bbox[3]
        };
      }

      return {
        ...el,
        id: Math.random().toString(36).substring(2, 11),
        bbox: bboxObj,
        content: Array.isArray(el.content) ? el.content.join('\n') : (el.content ? String(el.content) : '')
      };
    });
  });
};

const proofreadWithRetry = async (rawText: string, isBilingual: boolean = false): Promise<any> => {
  const bilingualAddon = isBilingual 
    ? `
    IMPORTANT: This document is BILINGUAL (Hindi and English).
    - Preservation Rule: You MUST preserve BOTH languages for each question and its options.
    - Format Rule: Combine them into a single line separated by " / " (e.g., "Hindi Question / English Question").
    - Consistent Labeling: Ensure options are labeled consistently (a), (b), (c), (d).`
    : ``;

  const prompt = `
    You are an expert Exam Paper Editor. I will provide you with raw text extracted from an exam paper.
    Your task is to identify and extract all Multiple Choice Questions (MCQs) from this text.
    ${bilingualAddon}
    
    For each MCQ:
    1. Extract the question text clearly.
    2. Extract all options (A, B, C, D, etc.).
    3. Clean up any OCR errors, typos, or stray characters.
    4. Ensure the question is complete and logical.
    5. Remove any junk text that is not part of the question or options (e.g., page numbers, headers, footers).
    
    RAW TEXT:
    "${rawText}"
    
    Return the result as a JSON object with a 'questions' array. Each item should have:
    - questionText: string
    - options: array of {label: string, text: string}
    - answer: string (the label of the correct option if found, e.g., "A")
    
    If no MCQs are found, return {"questions": []}.
  `;

  return runAIAction(async (client) => {
    const response = await client.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
      }
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error("Empty response from Gemini API");
    }

    const cleanedText = responseText.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleanedText);
    return parsed.questions || [];
  });
};

app.post('/api/extract', async (req, res) => {
  try {
    const { base64Image, ocrText, numberingStyle, includeImages, isBilingual, mcqMode, refineMode } = req.body;
    const elements = await extractLayoutWithRetry(base64Image, ocrText, numberingStyle, includeImages, isBilingual, mcqMode, refineMode);
    res.json({ elements });
  } catch (error: any) {
    console.warn("Extraction failed:", error?.message || error);
    try {
      const parsedError = JSON.parse(error.message);
      if (parsedError.isQuotaError) {
        return res.status(429).json({ error: parsedError.originalError || "Quota exceeded", waitTime: parsedError.waitTime });
      }
    } catch(e) {}
    res.status(500).json({ error: error.message || "Extraction failed" });
  }
});

app.post('/api/proofread', async (req, res) => {
  try {
    const { rawText, isBilingual } = req.body;
    const questions = await proofreadWithRetry(rawText, isBilingual);
    res.json({ questions });
  } catch (error: any) {
    console.warn("Proofread failed:", error?.message || error);
    try {
      const parsedError = JSON.parse(error.message);
      if (parsedError.isQuotaError) {
        return res.status(429).json({ error: parsedError.originalError || "Quota exceeded", waitTime: parsedError.waitTime });
      }
    } catch(e) {}
    res.status(500).json({ error: error.message || "Proofread failed" });
  }
});

export default app;
