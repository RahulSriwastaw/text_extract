import { GoogleGenAI, Type } from "@google/genai";
import { NumberingStyle, ExtractedElement } from "../types";
import { performOCR } from './ocrService';

const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("API Key is missing. Please set the GEMINI_API_KEY environment variable.");
  }
  return new GoogleGenAI({ apiKey });
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const extractLayoutFromImage = async (
  base64Image: string, 
  numberingStyle: NumberingStyle = NumberingStyle.HASH,
  includeImages: boolean = true,
  isBilingual: boolean = false,
  mcqMode: boolean = true,
  retryCount = 0
): Promise<ExtractedElement[]> => {
  const MAX_RETRIES = 5; // Increased from 3 to 5
  const client = getGeminiClient();
  
  const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');

  // Perform OCR
  let ocrText = '';
  try {
    ocrText = await performOCR(base64Image);
  } catch (e) {
    console.warn("OCR failed, proceeding without OCR context", e);
  }

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
    ? `- **BILINGUAL OUTPUT**: If a question or text is in a single language, provide its translation in the other major language present in the document (e.g., if Hindi, add English; if English, add Hindi). Present both versions clearly.`
    : `- **STRICTLY NO TRANSLATION**: Do not translate Hindi to English or vice versa.`;

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
    ? `**MCQ EXTRACTION MODE**:
- This document is primarily an MCQ paper.
- Ensure every question is followed by its options (A, B, C, D, etc.).
- If options are in a grid (e.g., A and B on one line, C and D on another), extract them in order.
- Maintain the relationship between questions and their options.`
    : `**GENERAL DOCUMENT MODE**:
- Extract text as it appears. Maintain paragraphs and structure.`;

  try {
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
- **STRICTLY NO TRANSLITERATION**: Do not write Hindi words using English letters (e.g., don't write "Prashna" for "प्रश्न").
- **NO CORRECTIONS**: Do not "fix" grammar, spelling, or punctuation. Extract the raw content.
- **BILINGUAL QUESTIONS**: Many exam papers provide the same question in both Hindi and English. Extract both versions exactly as they appear, maintaining their respective scripts and order.

**OBJECTIVE**: Identify text blocks, diagrams, figures, and tables.

**SYSTEMATIC ARRANGEMENT RULES**:
1. **Questions & Options**: 
   - **EXTRACT ALL OPTIONS**: Exam questions often have 4 or 5 options (A, B, C, D, E). You MUST extract ALL options present in the image. Do NOT skip option (E) or any other option.
   - **GROUPING**: Keep the question text and its corresponding options together in the same 'text' element if they are part of the same logical block, or ensure they follow each other immediately in the elements array.
   - **FORMATTING**: Use a clear format for options, e.g., (A) Option text, (B) Option text, etc. Ensure each option starts on a new line within the text block.
${imageInstruction}

**FORMATTING RULES**:
1. **Text Elements**:
   - **CONTINUOUS TEXT**: Extract text as continuous paragraphs. Do NOT include hard line breaks within a single question, sentence, or paragraph just because they appear on a new line in the image. Let the text flow naturally to the full width of the page.
   - Extract text exactly in the original script, preserving the language mix.
   - Use Markdown for bold (**text**) and headers.
   - ${numberingInstruction}
   - Use LaTeX inside $$ ... $$ for all mathematical formulas and symbols.
   - **CRITICAL: JSON ESCAPING**: You are generating JSON. You MUST double-escape all LaTeX backslashes. For example, output \\\\frac instead of \\frac, \\\\sin instead of \\sin, \\\\underline instead of \\underline.
   - **MATH FUNCTIONS**: Use standard LaTeX for functions like \\\\sin, \\\\cos, \\\\tan, \\\\cosec, \\\\sec, \\\\cot. If you see "cosec", use \\\\cosec or \\\\operatorname{cosec}.
   - **FRACTIONS**: Use \\\\frac{numerator}{denominator} for fractions.
   - **BAR/OVERLINE**: For equations or symbols with a bar over them (e.g., bar(x), overline(AB)), use the LaTeX command \\\\overline{...}.
   - **CHEMISTRY**: If you detect chemical formulas or reactions, use the \`\\\\ce{...}\` command (e.g., \`\\\\ce{H2O}\`, \`\\\\ce{2H2 + O2 -> 2H2O}\`).
   - **CLEANUP**: Remove stray artifacts (noise) but NEVER remove valid question numbers, option labels (A, B, C, D, E), or mathematical symbols.
   - **ACCURACY**: If a technical term or formula is unclear, you may use Google Search to verify the correct notation or spelling.
${imageFormattingInstruction}
3. **Table Elements**:
   - Identify tables and extract them as Markdown tables, preserving the language of the content within cells.
4. **Reading Order**:
   - List elements in the order they should appear in a document (top-to-bottom, left-to-right).

**BOUNDING BOXES**:
- For 'image' and 'table' types, the 'bbox' property is MANDATORY.
- Coordinates are [ymin, xmin, ymax, xmax] normalized to 1000.

Return the data as a JSON object with an 'elements' array.`
        }
      ],
      config: {
        responseMimeType: "application/json",
        tools: [{ googleSearch: {} }],
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            elements: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { 
                    type: Type.STRING, 
                    description: "The type of element: 'text', 'image', or 'table'" 
                  },
                  content: { 
                    type: Type.STRING, 
                    description: "The extracted text or markdown content. For images, provide a short description." 
                  },
                  bbox: {
                    type: Type.OBJECT,
                    description: "Bounding box for the element. Mandatory for images.",
                    properties: {
                      ymin: { type: Type.NUMBER },
                      xmin: { type: Type.NUMBER },
                      ymax: { type: Type.NUMBER },
                      xmax: { type: Type.NUMBER }
                    },
                    required: ["ymin", "xmin", "ymax", "xmax"]
                  }
                },
                required: ["type"]
              }
            }
          },
          required: ["elements"]
        }
      }
    });

    let result;
    let rawText = response.text || '{"elements": []}';
    
    // Clean up markdown code blocks if present
    rawText = rawText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
    
    try {
      result = JSON.parse(rawText);
    } catch (parseError) {
      console.warn("Initial JSON parse failed, attempting to fix escaped characters...", parseError);
      
      let fixedText = rawText
        // Fix unescaped \u (e.g. \underline, \uparrow)
        .replace(/\\u(?![0-9a-fA-F]{4})/g, '\\\\u')
        // Fix unescaped characters that are invalid in JSON
        .replace(/\\([^"\\/bfnrtu])/g, '\\\\$1')
        // Fix common LaTeX commands that start with valid JSON escape characters
        .replace(/\\f(?=rac)/g, '\\\\f')
        .replace(/\\b(?=egin|oldsymbol|f|ar)/g, '\\\\b')
        .replace(/\\n(?=ew|abla|o|eq)/g, '\\\\n')
        .replace(/\\r(?=ight|m)/g, '\\\\r')
        .replace(/\\t(?=ext|heta|imes|riangle)/g, '\\\\t');

      try {
        result = JSON.parse(fixedText);
      } catch (e2) {
        console.error("Failed to parse JSON even after fixing escapes", e2);
        throw new Error("Failed to parse AI response due to complex formatting. Please try again.");
      }
    }

    const elements = result?.elements || [];
    return elements.map((el: any, index: number) => ({
      ...el,
      id: `el-${index}-${Math.random().toString(36).substr(2, 5)}`
    }));
  } catch (error: any) {
    const errorStr = error?.message || String(error);
    const isQuotaError = errorStr.includes("429") || 
                         errorStr.includes("RESOURCE_EXHAUSTED") ||
                         errorStr.includes("quota") ||
                         errorStr.includes("limit");
    
    if (isQuotaError && retryCount < MAX_RETRIES) {
      // Exponential backoff: 15s, 30s, 60s, 120s, 240s + jitter
      const waitTime = Math.pow(2, retryCount) * 15000 + Math.random() * 5000; 
      console.warn(`Quota exceeded. Retrying in ${Math.round(waitTime/1000)}s... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await delay(waitTime);
      return extractLayoutFromImage(base64Image, numberingStyle, includeImages, isBilingual, mcqMode, retryCount + 1);
    }
    throw error;
  }
};

// Keep the old function for backward compatibility if needed, but update it to use the new logic
export const extractTextFromImage = async (base64Image: string, numberingStyle: NumberingStyle = NumberingStyle.HASH): Promise<string> => {
  const elements = await extractLayoutFromImage(base64Image, numberingStyle);
  return elements
    .map(el => el.type === 'text' || el.type === 'table' ? (el.content || '') : `[Image: ${el.content || ''}]`)
    .join('\n\n');
};

export const proofreadMcqs = async (rawText: string): Promise<any[]> => {
  const client = getGeminiClient();

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
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  questionText: { type: Type.STRING },
                  options: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        label: { type: Type.STRING },
                        text: { type: Type.STRING }
                      },
                      required: ["label", "text"]
                    }
                  }
                },
                required: ["questionText", "options"]
              }
            }
          },
          required: ["questions"]
        }
      }
    });
    
    let text = response.text || '{"questions": []}';
    
    // Clean up markdown code blocks
    text = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
    
    const data = JSON.parse(text);
    return data.questions || [];
  } catch (error) {
    console.error("Proofreading failed:", error);
    return [];
  }
};
