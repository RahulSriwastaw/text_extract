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
  errorMessage?: string;
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

export type QuestionType = 'MCQ' | 'MSQ' | 'NAT';
export type DifficultyLevel = 'easy' | 'medium' | 'hard';

export interface MockTestMcqItem {
  id: string;
  question_r: number;
  question_type: QuestionType;
  question_hi: string;
  option1_hi: string;
  option2_hi: string;
  option3_hi: string;
  option4_hi: string;
  option5_hi?: string;
  solution_hi: string;
  question_en: string;
  option1_en: string;
  option2_en: string;
  option3_en: string;
  option4_en: string;
  option5_en?: string;
  solution_en: string;
  answer: string; // "D", "[\"3\",\"4\"]", or "{\"start\":\"86\",\"end\":\"86\"}"
  set_name: string;
  difficulty_level: DifficultyLevel | string;
  test_date?: string;
  test_time?: string;
  subject?: string;
  subject_level?: string;
  figure_notes?: string;
  correction_notes?: string;
  source_pdf?: string;
  source_pages?: string | number;
  source_question_reference?: string;
  latex_check?: string;
  html_check?: string;
  answer_check?: string;
  solution_check?: string;
  hash_figure?: string;
  manually_review?: string;
  duplicate_statistics?: string;
  passage_hi?: string;
  passage_en?: string;
  pageNumber?: number;
  pageId?: string;
}

