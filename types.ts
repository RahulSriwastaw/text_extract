export enum NumberingStyle {
  Q_DOT = 'Q_DOT',           // Q1.
  HASH = 'HASH',             // #1.
  QUESTION_DOT = 'QUESTION_DOT', // Question 1.
  NUMBER_DOT = 'NUMBER_DOT'  // 1.
}

export enum OptionArrangement {
  VERTICAL = 'VERTICAL',     // One option per line
  HORIZONTAL = 'HORIZONTAL', // All options on one line
  GRID = 'GRID'              // Two options per line (A B then C D)
}

export interface BoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export interface ExtractedElement {
  type: 'text' | 'image' | 'table';
  content?: string;
  imageB64?: string;
  bbox?: BoundingBox;
  id: string;
}

export enum AppState {
  IDLE = 'IDLE',
  UPLOAD = 'UPLOAD',
  PROCESSING_PDF = 'PROCESSING_PDF', // Converting PDF to images
  ANALYZING = 'ANALYZING', // Sending to Gemini
  CROPPING = 'CROPPING', // Extracting image regions
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface ScannedPage {
  id: string;
  imageUrl: string; // Base64 or Blob URL
  pageNumber: number;
  status: 'pending' | 'processing' | 'done' | 'error';
  extractedText?: string; // Legacy support
  elements?: ExtractedElement[];
  isSelected: boolean;
}

export interface ConversionConfig {
  prompt: string;
}

export interface HistoryItem {
  id: string;
  fileName: string;
  timestamp: number;
  pagesCount: number;
  elements: ExtractedElement[];
}
