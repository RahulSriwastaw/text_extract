import { NumberingStyle, ExtractedElement } from "../types";
import { performOCR } from './ocrService';

export const extractLayoutFromImage = async (
  base64Image: string, 
  numberingStyle: NumberingStyle = NumberingStyle.HASH,
  includeImages: boolean = true,
  isBilingual: boolean = false,
  mcqMode: boolean = true
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
      mcqMode
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
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

export const proofreadMcqs = async (rawText: string): Promise<any[]> => {
  const response = await fetch('/api/proofread', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ rawText }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  return data.questions;
};
