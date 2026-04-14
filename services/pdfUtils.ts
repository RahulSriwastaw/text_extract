// We access pdfjsLib from the global window object loaded via CDN in index.html
declare global {
  interface Window {
    pdfjsLib: any;
  }
}

export const convertPdfToImages = async (file: File): Promise<string[]> => {
  if (!window.pdfjsLib) {
    throw new Error("PDF.js library is not loaded. Please check your internet connection and try again.");
  }
  
  const arrayBuffer = await file.arrayBuffer();
  
  try {
    // Load the document
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    const pageCount = pdf.numPages;
    const images: string[] = [];

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      
      // Set scale to 4.0 for higher resolution OCR (vital for small fonts and math denominators)
      const viewport = page.getViewport({ scale: 4.0 });
      
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      
      if (!context) continue;

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({
        canvasContext: context,
        viewport: viewport,
      }).promise;

      // Convert to base64
      const base64 = canvas.toDataURL('image/png');
      images.push(base64);
    }

    return images;
  } catch (error: any) {
    console.error("PDF Processing Error:", error);
    
    if (error?.name === 'PasswordException') {
      throw new Error("This PDF is password protected. Please remove the password and try again.");
    }
    
    if (error?.name === 'InvalidPDFException') {
      throw new Error("The PDF file appears to be corrupted or invalid.");
    }

    if (error?.name === 'MissingPDFException') {
        throw new Error("The PDF file is missing or empty.");
    }

    // PDF.js generic error structure
    if (error?.message && error.message.includes("PDF header not found")) {
        throw new Error("Not a valid PDF file.");
    }

    throw new Error("Failed to process PDF. Please ensure the file is a valid, unlocked PDF document.");
  }
};

export const cropImage = async (base64: string, bbox: { ymin: number, xmin: number, ymax: number, xmax: number }): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error("Could not get canvas context"));
        return;
      }

      // Normalized coordinates are 0-1000
      const x = (bbox.xmin / 1000) * img.width;
      const y = (bbox.ymin / 1000) * img.height;
      const width = ((bbox.xmax - bbox.xmin) / 1000) * img.width;
      const height = ((bbox.ymax - bbox.ymin) / 1000) * img.height;

      canvas.width = width;
      canvas.height = height;

      ctx.drawImage(img, x, y, width, height, 0, 0, width, height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error("Failed to load image for cropping"));
    img.src = base64;
  });
};

export const readFileAsBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.readAsDataURL(file);
  });
};