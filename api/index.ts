import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { NumberingStyle } from '../types.js';

const app = express();
app.use(express.json({ limit: '50mb' }));

app.get('/api/config', (req, res) => {
  const keysString = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
  const keys = keysString.split(',').map(k => k.trim()).filter(k => k);
  res.json({ keyCount: keys.length });
});

const getGeminiClient = (excludeKeys: string[] = []) => {
  const keysString = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY;
  if (!keysString) {
    throw new Error("API Key is missing. Please set the GEMINI_API_KEYS environment variable.");
  }
  
  let keys = keysString.split(',').map(k => k.trim()).filter(k => k);
  if (keys.length === 0) {
    throw new Error("No valid API keys found.");
  }

  // Filter out keys that have already failed in this retry chain,
  // unless all keys have failed (in which case we try them all again)
  let availableKeys = keys.filter(k => !excludeKeys.includes(k));
  if (availableKeys.length === 0) {
    availableKeys = keys;
  }

  // Select a completely random key from the available pool
  const randomIndex = Math.floor(Math.random() * availableKeys.length);
  const apiKey = availableKeys[randomIndex];

  return { client: new GoogleGenAI({ apiKey }), key: apiKey };
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const extractLayoutWithRetry = async (
  base64Image: string,
  ocrText: string,
  numberingStyle: NumberingStyle,
  includeImages: boolean,
  isBilingual: boolean,
  mcqMode: boolean,
  retryCount = 0,
  failedKeys: string[] = []
): Promise<any> => {
  const MAX_RETRIES = 5;
  const { client, key: currentKey } = getGeminiClient(failedKeys);
  
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
    ? `**CRITICAL RULE: BILINGUAL OUTPUT REQUIRED**:
- You MUST output EVERY question and EVERY option in BOTH English and Hindi.
- If the source text is ONLY in English, you MUST translate it to Hindi and output BOTH (English first, then Hindi).
- If the source text is ONLY in Hindi, you MUST translate it to English and output BOTH (Hindi first, then English).
- If the source text is already in both languages, preserve both.
- Do not skip translating any part of the text.`
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
- CRITICAL: You MUST place a newline character before EVERY single question to ensure it is not merged with previous text.
- Format every question so it starts on a NEW LINE like "Q.1 [Question Text]".
- Format every option so it starts on a NEW LINE like "A. [Option Text]".
- Do NOT squash multiple questions or options into a single paragraph. Each question and each option MUST be on its own line.`
    : `**GENERAL DOCUMENT MODE**:
- Extract text as it appears. Maintain paragraphs and structure.`;

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
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

**CRITICAL RULE: COMPLETE EXTRACTION**:
- You MUST read the ENTIRE page from top to bottom.
- Do NOT skip any questions, options, paragraphs, or text, no matter how small the font is or where it is located on the page.
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
   - Preserve mathematical formulas and scientific notations accurately. Use LaTeX format enclosed in $...$ for inline math and $$...$$ for block math if applicable.

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
  "bbox": [x_min, y_min, x_max, y_max] // Optional: normalized coordinates [0-1000] representing the bounding box of the element
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
    try {
      const cleanedText = responseText.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
      parsedElements = JSON.parse(cleanedText);
      if (!Array.isArray(parsedElements)) {
        throw new Error("Response is not a JSON array");
      }
      
      // Ensure content is a string
      parsedElements = parsedElements.map((el: any) => ({
        ...el,
        content: Array.isArray(el.content) ? el.content.join('\n') : (el.content ? String(el.content) : '')
      }));
    } catch (parseError) {
      console.error("Failed to parse Gemini response as JSON:", responseText);
      throw new Error("Invalid JSON response from AI model");
    }

    return parsedElements;
  } catch (error: any) {
    const errorStr = error?.message || String(error);
    const isQuotaError = errorStr.includes("429") || 
                         errorStr.includes("RESOURCE_EXHAUSTED") ||
                         errorStr.includes("quota") ||
                         errorStr.includes("limit") ||
                         errorStr.includes("503") ||
                         errorStr.includes("UNAVAILABLE") ||
                         errorStr.includes("Unexpected token") ||
                         errorStr.includes("JSON") ||
                         errorStr.includes("fetch failed") ||
                         errorStr.includes("ECONNRESET") ||
                         errorStr.includes("ETIMEDOUT");

    let extractedJsonObj: any = null;
    const jsonMatch = errorStr.match(/\{.*\}/s);
    if (jsonMatch) {
      try {
        extractedJsonObj = JSON.parse(jsonMatch[0]);
      } catch(e) {}
    }
    
    if (isQuotaError && retryCount < MAX_RETRIES) {
      let waitTime = Math.pow(2, retryCount) * 2000 + Math.random() * 2000; 
      
      // Attempt to extract recommended retry delay if provided in Google RPC error
      if (extractedJsonObj?.error?.details) {
        const details = extractedJsonObj.error.details;
        const retryInfo = details.find((d: any) => d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo');
        if (retryInfo && retryInfo.retryDelay) {
          const delaySecs = parseFloat(retryInfo.retryDelay.replace('s', ''));
          if (!isNaN(delaySecs)) {
            waitTime = (delaySecs * 1000) + 1000; // Use recommended delay + 1s buffer
          }
        }
      }

      console.warn(`Quota or network issue. Retrying with a different key in ${Math.round(waitTime/1000)}s... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await delay(waitTime);
      return extractLayoutWithRetry(base64Image, ocrText, numberingStyle, includeImages, isBilingual, mcqMode, retryCount + 1, [...failedKeys, currentKey]);
    }

    // Clean up output message if it's a raw JSON string
    if (extractedJsonObj?.error?.message) {
      throw new Error(extractedJsonObj.error.message);
    }
    throw error;
  }
};

const proofreadWithRetry = async (rawText: string, retryCount = 0, failedKeys: string[] = []): Promise<any> => {
  const MAX_RETRIES = 5;
  const { client, key: currentKey } = getGeminiClient(failedKeys);

  const prompt = `
    You are an expert Exam Paper Editor. I will provide you with raw text extracted from an exam paper.
    Your task is to identify and extract all Multiple Choice Questions (MCQs) from this text.
    
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
    
    If no MCQs are found, return {"questions": []}.
  `;

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
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
  } catch (error: any) {
    const errorStr = error?.message || String(error);
    const isQuotaError = errorStr.includes("429") || 
                         errorStr.includes("RESOURCE_EXHAUSTED") ||
                         errorStr.includes("quota") ||
                         errorStr.includes("limit") ||
                         errorStr.includes("503") ||
                         errorStr.includes("UNAVAILABLE") ||
                         errorStr.includes("Unexpected token") ||
                         errorStr.includes("JSON") ||
                         errorStr.includes("fetch failed") ||
                         errorStr.includes("ECONNRESET") ||
                         errorStr.includes("ETIMEDOUT");

    let extractedJsonObj: any = null;
    const jsonMatch = errorStr.match(/\{.*\}/s);
    if (jsonMatch) {
      try {
        extractedJsonObj = JSON.parse(jsonMatch[0]);
      } catch(e) {}
    }
    
    if (isQuotaError && retryCount < MAX_RETRIES) {
      let waitTime = Math.pow(2, retryCount) * 2000 + Math.random() * 2000; 
      
      if (extractedJsonObj?.error?.details) {
        const details = extractedJsonObj.error.details;
        const retryInfo = details.find((d: any) => d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo');
        if (retryInfo && retryInfo.retryDelay) {
          const delaySecs = parseFloat(retryInfo.retryDelay.replace('s', ''));
          if (!isNaN(delaySecs)) {
            waitTime = (delaySecs * 1000) + 1000; // Use recommended delay + 1s buffer
          }
        }
      }

      console.warn(`Quota or network issue. Retrying with a different key in ${Math.round(waitTime/1000)}s... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await delay(waitTime);
      return proofreadWithRetry(rawText, retryCount + 1, [...failedKeys, currentKey]);
    }

    if (extractedJsonObj?.error?.message) {
      throw new Error(extractedJsonObj.error.message);
    }
    throw error;
  }
};

app.post('/api/extract', async (req, res) => {
  try {
    const { base64Image, ocrText, numberingStyle, includeImages, isBilingual, mcqMode } = req.body;
    const elements = await extractLayoutWithRetry(base64Image, ocrText, numberingStyle, includeImages, isBilingual, mcqMode);
    res.json({ elements });
  } catch (error: any) {
    console.error("Extraction error:", error);
    res.status(500).json({ error: error.message || "Extraction failed" });
  }
});

app.post('/api/proofread', async (req, res) => {
  try {
    const { rawText } = req.body;
    const questions = await proofreadWithRetry(rawText);
    res.json({ questions });
  } catch (error: any) {
    console.error("Proofread error:", error);
    res.status(500).json({ error: error.message || "Proofread failed" });
  }
});

export default app;
