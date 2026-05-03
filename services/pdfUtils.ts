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
      
      // Set scale to 2.5 for good resolution while keeping payload size small for parallel processing
      const viewport = page.getViewport({ scale: 2.5 });
      
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      
      if (!context) continue;

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      // Fill with white background (JPEG doesn't support transparency)
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: context,
        viewport: viewport,
      }).promise;

      // Convert to JPEG to massively reduce base64 size for faster network transfer
      const base64 = canvas.toDataURL('image/jpeg', 0.8);
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
      const x = Math.min(bbox.xmin, bbox.xmax) / 1000 * img.width;
      const y = Math.min(bbox.ymin, bbox.ymax) / 1000 * img.height;
      const width = Math.abs(bbox.xmax - bbox.xmin) / 1000 * img.width;
      const height = Math.abs(bbox.ymax - bbox.ymin) / 1000 * img.height;

      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));

      // Use the integer values for drawing
      ctx.drawImage(img, x, y, width, height, 0, 0, canvas.width, canvas.height);
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