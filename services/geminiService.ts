import { NumberingStyle, ExtractedElement } from "../types";
import { performOCR } from './ocrService';

export const extractLayoutFromImage = async (
  base64Image: string, 
  numberingStyle: NumberingStyle = NumberingStyle.HASH,
  includeImages: boolean = true,
  isBilingual: boolean = false,
  mcqMode: boolean = true,
  refineMode: boolean = false,
  retryCount: number = 0
): Promise<ExtractedElement[]> => {
  // Skipping client-side OCR for speed when processing in parallel.
  // Gemini 2.5 Flash is highly capable of reading text directly from the image.
  const ocrText = '';

  const response = await fetch('/api/extract', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      base64Image,
      ocrText,
      numberingStyle,
      includeImages,
      isBilingual,
      mcqMode,
      refineMode
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    if (response.status === 429 && retryCount < 5) {
        let waitTime = errorData.waitTime || 60000;
        
        // Try to parse waitTime from nested error message if not directly available
        if (errorData.error && typeof errorData.error === 'string') {
          try {
            const parsed = JSON.parse(errorData.error);
            if (parsed.waitTime) waitTime = parsed.waitTime;
          } catch(e) {
            const match = errorData.error.match(/retry in ([\d\.]+)s/i);
            if (match) waitTime = (parseFloat(match[1]) * 1000) + 1000;
          }
        }

        console.warn(`[Client] Quota hit. Waiting ${Math.round(waitTime/1000)}s before retry ${retryCount + 1}/5...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return extractLayoutFromImage(base64Image, numberingStyle, includeImages, isBilingual, mcqMode, refineMode, retryCount + 1);
    }
    
    // Friendly error message for quota
    if (response.status === 429) {
      throw new Error("Gemini Free Tier Quota Exceeded. The AI is busy (20 requests/day limit reached). Please wait a few minutes or retry later.");
    }
    
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  return data.elements;
};

// Keep the old function for backward compatibility if needed
export const extractTextFromImage = async (base64Image: string, numberingStyle: NumberingStyle = NumberingStyle.HASH): Promise<string> => {
  const elements = await extractLayoutFromImage(base64Image, numberingStyle);
  return elements
    .map(el => el.type === 'text' || el.type === 'table' ? (el.content || '') : `[Image: ${el.content || ''}]`)
    .join('\n\n');
};

export const proofreadMcqs = async (rawText: string, isBilingual: boolean = false, retryCount: number = 0): Promise<any[]> => {
  const response = await fetch('/api/proofread', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ rawText, isBilingual }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    if (response.status === 429 && retryCount < 5) {
        let waitTime = errorData.waitTime || 60000;
        
        // Try to parse waitTime from nested error message
        if (errorData.error && typeof errorData.error === 'string') {
          try {
            const parsed = JSON.parse(errorData.error);
            if (parsed.waitTime) waitTime = parsed.waitTime;
          } catch(e) {
            const match = errorData.error.match(/retry in ([\d\.]+)s/i);
            if (match) waitTime = (parseFloat(match[1]) * 1000) + 1000;
          }
        }

        console.warn(`[Client] Quota hit (Proofread). Waiting ${Math.round(waitTime/1000)}s before retry ${retryCount + 1}/5...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return proofreadMcqs(rawText, isBilingual, retryCount + 1);
    }
    
    if (response.status === 429) {
      throw new Error("Gemini Free Tier Quota Exceeded (Proofread limit reached). Please wait a few minutes.");
    }
    
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  return data.questions;
};
