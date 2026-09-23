import { supabase, isSupabaseConfigured } from './supabase';

export interface CropPercentageBox {
  x: number; // 0 to 100
  y: number; // 0 to 100
  width: number; // 0 to 100
  height: number; // 0 to 100
}

export type FigureTargetField = 
  | 'question' 
  | 'option1' 
  | 'option2' 
  | 'option3' 
  | 'option4' 
  | 'option5' 
  | 'solution';

export interface UploadFigureParams {
  imageData: string; // Base64 data URL
  questionNumber?: number | string;
  targetField?: FigureTargetField | string;
  setName?: string;
  useCloud?: boolean;
  useFirebaseCloud?: boolean; // Legacy alias for useCloud
}

export interface UploadFigureResult {
  url: string;
  absoluteUrl?: string;
  filename: string;
  isCloud?: boolean;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const arr = dataUrl.split(',');
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * High-resolution canvas crop from a source image using normalized percentage coordinates (0-100%).
 */
export async function cropImageRegion(
  sourceImageSrc: string,
  cropPercent: CropPercentageBox
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const natW = img.naturalWidth;
        const natH = img.naturalHeight;

        // Calculate source pixel coordinates with safety clamping
        const rawX = (cropPercent.x / 100) * natW;
        const rawY = (cropPercent.y / 100) * natH;
        const rawW = (cropPercent.width / 100) * natW;
        const rawH = (cropPercent.height / 100) * natH;

        const srcX = Math.max(0, Math.min(natW, rawX));
        const srcY = Math.max(0, Math.min(natH, rawY));
        const srcW = Math.max(1, Math.min(natW - srcX, rawW));
        const srcH = Math.max(1, Math.min(natH - srcY, rawH));

        // Create canvas at exact cropped resolution
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(srcW);
        canvas.height = Math.round(srcH);

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Canvas 2D context unavailable');
        }

        // Draw cropped section with smooth rendering
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);

        const croppedDataUrl = canvas.toDataURL('image/png', 0.95);
        resolve(croppedDataUrl);
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => {
      reject(new Error('Failed to load source image for cropping'));
    };

    img.src = sourceImageSrc;
  });
}

export const DEFAULT_IMGBB_API_KEY = '892c1e1f1ac46345ab6252ee885858cd';
export const IMGBB_UPLOAD_ENDPOINT = 'https://api.imgbb.com/1/upload';

export interface StagedCropItem {
  id: string;
  box: CropPercentageBox;
  dataUrl: string;
  targetField: FigureTargetField;
}

export function getStoredImgbbApiKey(): string {
  try {
    const customKey = localStorage.getItem('imgbb_custom_api_key');
    if (customKey && customKey.trim().length > 10) {
      return customKey.trim();
    }
  } catch (_) {}
  return DEFAULT_IMGBB_API_KEY;
}

export function setStoredImgbbApiKey(key: string) {
  try {
    if (!key || key.trim() === '' || key.trim() === DEFAULT_IMGBB_API_KEY) {
      localStorage.removeItem('imgbb_custom_api_key');
    } else {
      localStorage.setItem('imgbb_custom_api_key', key.trim());
    }
  } catch (_) {}
}

export interface UploadFigureParams {
  imageData: string; // Base64 data URL
  questionNumber?: number | string;
  targetField?: FigureTargetField | string;
  setName?: string;
  useCloud?: boolean;
  useFirebaseCloud?: boolean; // Legacy alias for useCloud
  imgbbApiKey?: string;
}

export interface UploadFigureResult {
  url: string;
  absoluteUrl?: string;
  filename: string;
  isCloud?: boolean;
  storageProvider?: 'imgbb' | 'supabase' | 'local';
}

/**
 * Uploads an image directly to ImgBB (https://api.imgbb.com/1/upload).
 */
export async function uploadToImgBB(
  imageData: string,
  apiKey: string = getStoredImgbbApiKey(),
  filename?: string
): Promise<UploadFigureResult> {
  let cleanBase64 = imageData;
  const match = imageData.match(/^data:image\/[a-zA-Z0-9+]+;base64,(.+)$/);
  if (match) {
    cleanBase64 = match[1];
  }

  const formData = new FormData();
  formData.append('image', cleanBase64);
  if (filename) {
    formData.append('name', filename);
  }

  const urlWithKey = `${IMGBB_UPLOAD_ENDPOINT}?key=${encodeURIComponent(apiKey.trim())}`;
  const response = await fetch(urlWithKey, {
    method: 'POST',
    body: formData
  });

  const json = await response.json().catch(() => null);

  if (!response.ok || !json?.success || !json?.data?.url) {
    const errorMsg = json?.error?.message || `ImgBB upload failed with status ${response.status}`;
    throw new Error(errorMsg);
  }

  const directUrl = json.data.url;
  const returnedFilename = json.data.image?.filename || (filename ? `${filename}.png` : 'figure.png');

  return {
    url: directUrl,
    absoluteUrl: directUrl,
    filename: returnedFilename,
    isCloud: true,
    storageProvider: 'imgbb'
  };
}

/**
 * Uploads a cropped figure to ImgBB Cloud Storage (Primary)
 * or local Express storage (/api/upload-figure) fallback.
 */
export async function uploadFigureImage(
  params: UploadFigureParams
): Promise<UploadFigureResult> {
  const { imageData, questionNumber, targetField, setName, imgbbApiKey } = params;
  const keyToUse = imgbbApiKey || getStoredImgbbApiKey();
  const safeQNum = questionNumber !== undefined && questionNumber !== null ? `q${questionNumber}` : 'q';
  const safeTarget = targetField ? `_${targetField}` : '';
  const filename = `${safeQNum}${safeTarget}_${Date.now()}`;

  // 1. Primary: Try ImgBB Cloud Storage
  try {
    const res = await uploadToImgBB(imageData, keyToUse, filename);
    console.log('[figureStorageService] Successfully uploaded figure to ImgBB:', res.url);
    return res;
  } catch (imgbbErr: any) {
    console.warn('[figureStorageService] ImgBB cloud upload notice:', imgbbErr?.message || imgbbErr, '- utilizing server storage fallback');
  }

  // 2. Resilient Fallback: Upload to local Express storage endpoint (/api/upload-figure)
  try {
    const response = await fetch('/api/upload-figure', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        imageData,
        questionNumber,
        targetField,
        setName,
        imgbbApiKey: keyToUse
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Upload failed (${response.status}): ${errText}`);
    }

    const result = await response.json();
    return {
      url: result.url,
      absoluteUrl: result.absoluteUrl,
      filename: result.filename,
      isCloud: !!result.isCloud,
      storageProvider: result.storageProvider || 'local'
    };
  } catch (localErr: any) {
    console.error('[figureStorageService] Storage upload failed:', localErr);
    throw new Error(`Failed to upload figure: ${localErr?.message || localErr}`);
  }
}

/**
 * Formats a figure URL into clean HTML for a question body.
 */
export function buildQuestionFigureTag(url: string, altText?: string): string {
  return `<p><img src="${url}" alt="${altText || 'Question Figure'}" style="max-width:100%;height:auto;margin:8px 0;display:block;" /></p>`;
}

/**
 * Formats a figure URL into clean HTML for an option.
 */
export function buildOptionFigureTag(url: string, optionLetter?: string): string {
  return `<img src="${url}" alt="${optionLetter ? `Option ${optionLetter}` : 'Option Figure'}" style="max-height:140px;width:auto;display:inline-block;" />`;
}

/**
 * Checks if a string contains an image tag, markdown image, or direct image link.
 */
export function hasFigureImage(text: string | null | undefined): boolean {
  if (!text) return false;
  return /<img\s+[^>]*src=["']([^"']+)["']/i.test(text) ||
         /!\[[^\]]*\]\(([^)]+)\)/i.test(text) ||
         /\[(?:FIGURE|IMAGE|FIG)[^\]]*:\s*([^\s\]]+)\]/i.test(text) ||
         /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(text.trim());
}

/**
 * Extracts all image URLs found inside text, HTML, Markdown, or custom tags.
 */
export function extractFigureUrls(text: string | null | undefined): string[] {
  if (!text) return [];
  const urls: string[] = [];

  // 1. HTML <img src="...">
  const htmlRegex = /<img\s+[^>]*src=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = htmlRegex.exec(text)) !== null) {
    if (match[1] && !urls.includes(match[1])) urls.push(match[1]);
  }

  // 2. Markdown ![alt](url)
  const mdRegex = /!\[[^\]]*\]\(([^)\s]+)[^)]*\)/gi;
  while ((match = mdRegex.exec(text)) !== null) {
    if (match[1] && !urls.includes(match[1])) urls.push(match[1]);
  }

  // 3. Custom tags [FIGURE: url] or [IMAGE: url]
  const tagRegex = /\[(?:FIGURE|IMAGE|FIG)[^\]]*:\s*([^\s\]]+)\]/gi;
  while ((match = tagRegex.exec(text)) !== null) {
    if (match[1] && !urls.includes(match[1])) urls.push(match[1]);
  }

  // 4. Check if text itself is a direct image URL or comma-separated URLs
  const parts = text.split(/[\s,]+/);
  for (const p of parts) {
    const trimmed = p.trim();
    if (/\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(trimmed) && (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/uploads/'))) {
      if (!urls.includes(trimmed)) urls.push(trimmed);
    }
  }

  return urls;
}
