import React, { useState, useRef, useEffect } from 'react';
import { 
  FileSpreadsheet, Upload, Play, Pause, RotateCw, Trash2, CheckCircle2, 
  AlertCircle, AlertTriangle, Loader2, Sparkles, Download, Copy, Check, Plus, 
  BookOpen, CheckSquare, Square, StopCircle, Zap, Settings, RefreshCw, Key,
  ZoomIn, ZoomOut, RotateCcw, ChevronLeft, ChevronRight, X, Edit3, ChevronDown, ChevronUp, Eye, Camera, SlidersHorizontal, FileText, MessageSquare, Clipboard, ClipboardPaste, Save, History,
  Image as ImageIcon, Scissors, Crosshair, Cloud, HardDrive, CheckCheck, Hand, ExternalLink, MoreHorizontal
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { convertPdfToImages, readFileAsBase64 } from '../services/pdfUtils';
import mammoth from 'mammoth';
import { 
  cropImageRegion, 
  uploadFigureImage, 
  buildQuestionFigureTag, 
  buildOptionFigureTag,
  hasFigureImage,
  extractFigureUrls,
  FigureTargetField,
  CropPercentageBox
} from '../services/figureStorageService';

export interface StagedCropItem {
  id: string;
  box: CropPercentageBox;
  dataUrl: string;
  targetField: FigureTargetField;
}
import { HighResPageLightbox } from './HighResPageLightbox';
import { MocktestAiChatModal } from './MocktestAiChatModal';
import { MocktestAddQuestionModal } from './MocktestAddQuestionModal';
import { MocktestPasteCsvModal } from './MocktestPasteCsvModal';
import { LatexRepairModal } from './LatexRepairModal';
import { LatexRenderer, useMathJax } from './LatexRenderer';
import { HtmlLatexField } from './HtmlLatexField';
import { htmlToPlainText } from '../services/htmlLatex';
import { 
  MockTestMcqItem, 
  DifficultyLevel,
  LatexRepairScope,
  MocktestHistoryItem
} from '../types';
import { useCurrentUser } from '../services/authService';
import { addMocktestHistoryItem } from '../services/historyService';
import { saveItemBackup, restoreItemBackup, canUndoItem } from '../services/latexRepairService';
import { 
  downloadMockTestCsv, 
  serializeMockTestToCsv, 
  parseCsvToMockTestItems, 
  parseAnyMockTestPastedText,
  parseAiOutputToMockTestItems,
  buildMockTestDirectPrompt,
  buildMockTestBridgePrompt,
  extractMockTestWithDirectApi,
  convertElementsToMockTestItems,
  generateDeepSolutionForItem,
  proofreadMocktestItems,
  cleanMockTestItem,
  standardizeItemHtmlAndMathJax,
  STANDARD_SUBJECTS,
  normalizeStrictSubject,
  detectItemFieldIssues,
  autoRecoverItemOptionsFromStem,
  repairMockTestItemWithAi,
  PendingMcqContext,
  separateCompleteAndPendingItems,
  mergePendingCarryOver,
  reverifyMockTestItemWithImages,
  buildMockTestSimilarBridgePrompt,
  generateSimilarQuestionItem,
  generateSimilarBatchFromItems
} from '../services/mocktestService';
import { cleanMocktestText } from '../services/textCleanService';
import { 
  extractWithStudyAiBridge, 
  captureFromStudyAiBridge,
  resetStudyAiBridgeSession,
  parseExtensionOutputToElements,
  pingStudyAiExtension, 
  subscribeToExtensionStatus,
  getStoredAiProvider,
  setStoredAiProvider,
  getChatRotationInterval,
  setChatRotationInterval,
  shouldStartNewChat,
  BridgeStatus,
  AiProvider
} from '../services/studyAiBridgeService';
import GeminiSettingsModal from './GeminiSettingsModal';
import GeminiConnectModal from './GeminiConnectModal';
import { downloadMcqAsDocx } from '../services/mcqDocxService';

interface PageQueueItem {
  id: string;
  pageNumber: number;
  imageUrl: string;
  status: 'pending' | 'processing' | 'ready' | 'error';
  errorMessage?: string;
  mcqCount: number;
  isSelected: boolean;
  items?: MockTestMcqItem[];
  pendingContext?: PendingMcqContext | null;
  rawTextContent?: string;
  sourceType?: 'pdf' | 'image' | 'docx' | 'text';
  fileName?: string;
  expectedMarker?: string;
  /** Chat this page was extracted in. Recapture needs it once a run rotates to a fresh chat. */
  chatUrl?: string;
}

export function splitTextIntoDocumentPages(text: string, maxQuestionsPerPage = 10): string[] {
  if (!text || !text.trim()) return [];
  const clean = text.trim();

  // 1. If text has form-feed page breaks (\f)
  if (clean.includes('\f')) {
    const parts = clean.split('\f').map(p => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts;
  }

  // 2. If text has markdown / explicit page delimiters
  if (/(?:^|\n)\s*(?:---|===+\s*Page\s*\d*===+)\s*(?:\n|$)/i.test(clean)) {
    const parts = clean.split(/(?:^|\n)\s*(?:---|===+\s*Page\s*\d*===+)\s*(?:\n|$)/i)
      .map(p => p.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts;
  }

  // 3. Question-aware chunking: detect question boundaries like "1.", "Q1.", "Question 1:", "प्रश्न 1"
  const qMatches = clean.match(/(?:^|\n)\s*(?:Q\.?\s*\d+|\d+\.|\(\d+\)|Question\s*\d+|प्रश्न\s*\d+)[\s:\.\-]/gi);
  if (qMatches && qMatches.length > maxQuestionsPerPage) {
    const qSplit = clean.split(/(?=(?:^|\n)\s*(?:Q\.?\s*\d+|\d+\.|\(\d+\)|Question\s*\d+|प्रश्न\s*\d+)[\s:\.\-])/i)
      .map(q => q.trim())
      .filter(Boolean);
    
    if (qSplit.length > 1) {
      const pagedChunks: string[] = [];
      for (let i = 0; i < qSplit.length; i += maxQuestionsPerPage) {
        const slice = qSplit.slice(i, i + maxQuestionsPerPage);
        pagedChunks.push(slice.join('\n\n'));
      }
      return pagedChunks;
    }
  }

  // 4. Word-count chunking if very large (> 1800 words)
  const words = clean.split(/\s+/);
  if (words.length > 1800) {
    const pagedChunks: string[] = [];
    const chunkSize = 1200;
    for (let i = 0; i < words.length; i += chunkSize) {
      pagedChunks.push(words.slice(i, i + chunkSize).join(' '));
    }
    return pagedChunks;
  }

  return [clean];
}

export { LatexRenderer, useMathJax };


export interface MocktestExtractorProps {
  initialPages?: string[];
  onClearInitialPages?: () => void;
}

export const MocktestExtractor: React.FC<MocktestExtractorProps> = ({ initialPages, onClearInitialPages }) => {
  // Page queue state
  const [pages, setPages] = useState<PageQueueItem[]>([]);
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isProofreading, setIsProofreading] = useState(false);
  const [activePageIndex, setActivePageIndex] = useState<number | null>(null);
  const [liveStatusText, setLiveStatusText] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; text: string } | null>(null);

  // Engine Mode & Concurrency Batch Size (default to direct API to avoid bridge 503 errors)
  const [aiEngine, setAiEngine] = useState<'bridge' | 'api'>('api');
  const [batchSize, setBatchSize] = useState<number>(3);
  const [selectedProvider, setSelectedProvider] = useState<AiProvider>(getStoredAiProvider());
  // Active document session for AI Bridge (1 document = 1 continuous chat thread)
  const [documentChatUrl, setDocumentChatUrlState] = useState<string | null>(null);
  const documentChatUrlRef = useRef<string | null>(null);
  const setDocumentChatUrl = (url: string | null) => {
    documentChatUrlRef.current = url;
    setDocumentChatUrlState(url);
  };
  const [documentSessionId, setDocumentSessionId] = useState<string>(() => `doc_${Date.now()}`);
  // Pages per AI chat before the bridge opens a fresh one (0 = one chat for the whole document).
  const [chatRotation, setChatRotationState] = useState<number>(() => getChatRotationInterval());
  const setChatRotation = (pages: number) => {
    setChatRotationInterval(pages);
    setChatRotationState(getChatRotationInterval());
  };

  // Direct Text Input state
  const [inputMode, setInputMode] = useState<'upload' | 'direct_text'>('upload');
  const [directTextInput, setDirectTextInput] = useState<string>('');
  const [directTextSplitCount, setDirectTextSplitCount] = useState<number>(10);

  // Configuration state
  const [outputFileName, setOutputFileName] = useState<string>('');
  const [setName, setSetName] = useState<string>('RRB NTPC 2024 CBT-1');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('medium');
  const [answerFormat, setAnswerFormat] = useState<'letters' | 'numbers'>('letters');
  const [mathFormat, setMathFormat] = useState<'mathjax' | 'unicode'>('mathjax');
  const [isGeneratingDocx, setIsGeneratingDocx] = useState(false);
  const [docxLang, setDocxLang] = useState<'hi' | 'en' | 'both'>('both');
  const [autoDeepSolveAll, setAutoDeepSolveAll] = useState<boolean>(true);
  // Extraction Mode: 'exact' (Extract as written) vs 'similar' (Input PDF as Reference -> Generate Brand-New Practice Questions)
  const [extractionMode, setExtractionMode] = useState<'exact' | 'similar'>('exact');
  const [generatingSimilarId, setGeneratingSimilarId] = useState<string | null>(null);
  const [isGeneratingSimilarBatch, setIsGeneratingSimilarBatch] = useState(false);

  // Per-page CSV / TSV / JSON manual paste drawer state
  const [activePastePageId, setActivePastePageId] = useState<string | null>(null);
  const [pasteInputText, setPasteInputText] = useState<string>('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  // Extracted MCQs state
  const [extractedMcqs, setExtractedMcqs] = useState<MockTestMcqItem[]>([]);
  const [activeTab, setActiveTab] = useState<'split' | 'grid' | 'csv'>('split');
  const [solvingId, setSolvingId] = useState<string | null>(null);
  const [isSolvingAll, setIsSolvingAll] = useState(false);
  const [repairingId, setRepairingId] = useState<string | null>(null);
  const [isRepairingAll, setIsRepairingAll] = useState(false);
  const [repairProgress, setRepairProgress] = useState<{ current: number; total: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [user] = useCurrentUser();
  const [isSavedToHistory, setIsSavedToHistory] = useState(false);
  const currentSessionSetIdRef = useRef<string>('');

  const handleSaveSetToHistory = async () => {
    if (extractedMcqs.length === 0) return;
    const currentUid = user?.uid || 'guest';
    if (!currentSessionSetIdRef.current) {
      currentSessionSetIdRef.current = 'mock_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    }
    const item = {
      id: currentSessionSetIdRef.current,
      userId: currentUid,
      setName: outputFileName || setName || 'Mock Test',
      timestamp: Date.now(),
      questionCount: extractedMcqs.length,
      questions: extractedMcqs,
      pages: pages
    };
    await addMocktestHistoryItem(currentUid, item);
    setIsSavedToHistory(true);
    setTimeout(() => setIsSavedToHistory(false), 3000);
    alert(`✨ Test set "${item.setName}" (${extractedMcqs.length} questions) successfully saved to your account history!`);
  };

  // Auto-save draft for this user ID so reload/refresh never loses progress
  useEffect(() => {
    if (extractedMcqs.length > 0) {
      const currentUid = user?.uid || 'guest';
      try {
        localStorage.setItem(`mocktest_draft_${currentUid}`, JSON.stringify({
          setName: outputFileName || setName,
          timestamp: Date.now(),
          questions: extractedMcqs
        }));
      } catch (_) {}
    }
  }, [extractedMcqs, outputFileName, setName, user]);

  // AI LaTeX Repair Modal state
  const [latexRepairTarget, setLatexRepairTarget] = useState<{ item: MockTestMcqItem; scope: LatexRepairScope } | null>(null);
  const [undoToast, setUndoToast] = useState<{ itemId: string; questionNum: number } | null>(null);

  // Inline editing & High-Res Image Zoom modal state
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
  const [zoomPageIndex, setZoomPageIndex] = useState<number | null>(null);
  const [isFigureCropMode, setIsFigureCropMode] = useState<boolean>(false);
  const [selectedTargetQuestionId, setSelectedTargetQuestionId] = useState<string>('');
  const [selectedTargetField, setSelectedTargetField] = useState<FigureTargetField>('question');

  const handleQuickCropForQuestion = (item: MockTestMcqItem, field: FigureTargetField = 'question') => {
    const targetPageNum = item.pageNumber || parseInt(String(item.source_pages || '1'), 10) || 1;
    const targetIdx = pages.findIndex(p => p.pageNumber === targetPageNum);
    const validIdx = targetIdx !== -1 ? targetIdx : (zoomPageIndex !== null ? zoomPageIndex : 0);
    setZoomPageIndex(validIdx);
    setIsFigureCropMode(true);
    setSelectedTargetQuestionId(item.id);
    setSelectedTargetField(field);
  };

  const [previewLightboxUrl, setPreviewLightboxUrl] = useState<string | null>(null);

  const handleRemoveFigureFromItem = (itemId: string, field: FigureTargetField, urlToRemove: string) => {
    const targetQuestion = extractedMcqs.find(q => q.id === itemId) ||
      pages.flatMap(p => p.items || []).find(q => q.id === itemId);
    if (!targetQuestion) return;

    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cleanField = (val: string | undefined) => {
      if (!val) return '';
      return val
        .replace(new RegExp(`<p>\\s*<img[^>]*src=["']${escapeRegex(urlToRemove)}["'][^>]*>\\s*<\\/p>`, 'gi'), '')
        .replace(new RegExp(`<img[^>]*src=["']${escapeRegex(urlToRemove)}["'][^>]*>`, 'gi'), '')
        .replace(new RegExp(`!\\[[^\\]]*\\]\\(${escapeRegex(urlToRemove)}\\)`, 'gi'), '')
        .replace(new RegExp(`\\[(?:FIGURE|IMAGE|FIG)[^\]]*:\\s*${escapeRegex(urlToRemove)}\\]`, 'gi'), '')
        .replace(new RegExp(escapeRegex(urlToRemove), 'gi'), '')
        .trim();
    };

    const updates: Partial<MockTestMcqItem> = {};
    if (field === 'question') {
      updates.question_hi = cleanField(targetQuestion.question_hi);
      updates.question_en = cleanField(targetQuestion.question_en);
    } else if (field === 'solution') {
      updates.solution_hi = cleanField(targetQuestion.solution_hi);
      updates.solution_en = cleanField(targetQuestion.solution_en);
    } else if (field.startsWith('option')) {
      const keyHi = `${field}_hi` as keyof MockTestMcqItem;
      const keyEn = `${field}_en` as keyof MockTestMcqItem;
      (updates as any)[keyHi] = cleanField(targetQuestion[keyHi] as string);
      (updates as any)[keyEn] = cleanField(targetQuestion[keyEn] as string);
    }

    if (targetQuestion.hash_figure) {
      const nextHash = targetQuestion.hash_figure
        .split(',')
        .map(s => s.trim())
        .filter(s => s && s !== urlToRemove)
        .join(', ');
      updates.hash_figure = nextHash;
    }

    updateItem(itemId, updates);
  };

  // Copy Page Image & AI CSV Prompt to Clipboard for external AIs (ChatGPT, Claude, etc.)
  const [copiedImagePageId, setCopiedImagePageId] = useState<string | null>(null);
  const [copiedPromptPageId, setCopiedPromptPageId] = useState<string | null>(null);

  const handleCopyPageImage = async (page: PageQueueItem) => {
    if (!page.imageUrl) {
      if (page.rawTextContent) {
        await navigator.clipboard.writeText(page.rawTextContent);
        setCopiedImagePageId(page.id);
        setTimeout(() => setCopiedImagePageId(null), 3000);
        alert(`📄 Copied text content of Page ${page.pageNumber} to clipboard!`);
        return;
      }
      alert(`No image available for Page ${page.pageNumber}`);
      return;
    }

    try {
      // Load image into canvas and create a clean PNG Blob
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image element'));
        img.src = page.imageUrl!;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context could not be created');
      ctx.drawImage(img, 0, 0);

      const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('Could not convert canvas to PNG blob');

      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);

      setCopiedImagePageId(page.id);
      setTimeout(() => setCopiedImagePageId(null), 3000);
      alert(`📸 Page ${page.pageNumber} image copied to clipboard!\n\nNow open ChatGPT, Claude, or Gemini and press Ctrl+V to paste the image directly!`);
    } catch (e: any) {
      console.warn('Direct image clipboard copy fallback:', e);
      try {
        await navigator.clipboard.writeText(page.imageUrl);
        setCopiedImagePageId(page.id);
        setTimeout(() => setCopiedImagePageId(null), 3000);
        alert(`Notice: Image data copied to clipboard! (Or right-click the image on the left and choose "Copy image")`);
      } catch (_) {
        alert('Please right-click the page image on the left and select "Copy image".');
      }
    }
  };

  const handleCopyPagePrompt = (page: PageQueueItem) => {
    const promptText = `Extract ALL Multiple Choice Questions (MCQs) from this test paper image (Page ${page.pageNumber}) into a clean CSV format.

Output ONLY the raw CSV text (without markdown code fences, backticks, or other explanation).

Required CSV Header:
question_r,question_hi,question_en,option1_hi,option2_hi,option3_hi,option4_hi,option1_en,option2_en,option3_en,option4_en,answer,solution_hi,solution_en

Rules:
1. LANGUAGE PAPERS & BILINGUAL RULES (CRITICAL):
   - For English Language tests (English Comprehension, Grammar, Vocab, Error Spotting, etc.):
     DO NOT translate into Hindi! Both _hi and _en columns (question_hi and question_en, option1_hi and option1_en, etc.) MUST contain ONLY the original English text.
   - For Hindi Language tests (हिंदी भाषा, गद्यांश, व्याकरण, मुहावरे, पर्यायवाची आदि):
     DO NOT translate into English! Both _hi and _en columns (question_hi and question_en, option1_hi and option1_en, etc.) MUST contain ONLY the original Hindi text.
   - For other general subjects (Maths, Reasoning, Science, GS, Social Studies):
     Place Hindi in _hi columns and English in _en columns as normal.
2. The "answer" column must be the single uppercase letter: A, B, C, D, or E.
3. Every field containing commas or quotes must be enclosed in double quotes ("...").
4. Keep all mathematical formulas in clean LaTeX notation (e.g., $x^2 + y^2 = r^2$).
5. Provide a detailed, step-by-step explanatory solution for every question.
6. READING COMPREHENSION / PASSAGE SETS (CRITICAL):
   - If questions are based on a Passage, Comprehension text, Directions, or गद्यांश / काव्यांश (e.g., "SET - 34 [Q. 164. to Q. 168.]", "Directions (439-443)", "गद्यांश को पढ़कर..."):
     YOU MUST INCLUDE THE FULL PASSAGE TEXT WITH EVERY SINGLE QUESTION IN THAT SET!
   - Prepend the complete passage to both question_hi and question_en, separated by "\\n---\\n" (e.g., "[Full Passage Text]\\n---\\n[Question Text]").
   - NEVER output the passage only once or only with the first question! Every question belonging to that passage set (e.g. Q.164, Q.165, Q.166, Q.167, Q.168) MUST have the complete passage text attached so each question can be understood and answered independently.`;

    navigator.clipboard.writeText(promptText);
    setCopiedPromptPageId(page.id);
    setTimeout(() => setCopiedPromptPageId(null), 3000);
    alert(`📋 AI Extraction Prompt for Page ${page.pageNumber} copied to clipboard!\n\n1. Paste (Ctrl+V) this prompt along with the image into ChatGPT / Claude.\n2. Once generated, copy its CSV.\n3. Click "Paste to Page" here to import all questions directly into Page ${page.pageNumber}!`);
  };

  const [activeChatQuestion, setActiveChatQuestion] = useState<MockTestMcqItem | null>(null);
  const [showAddQuestionModal, setShowAddQuestionModal] = useState<boolean>(false);
  const [addQuestionTargetPage, setAddQuestionTargetPage] = useState<number>(1);
  const [showPasteCsvModal, setShowPasteCsvModal] = useState<boolean>(false);
  const [pasteCsvTargetPage, setPasteCsvTargetPage] = useState<number | undefined>(undefined);

  // Modals & Bridge status
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({ connected: false });
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);

  // UI Enhancement: Collapsible Paper Settings & Grouped AI Tools
  const [showPaperSettings, setShowPaperSettings] = useState(false);
  const [showAiToolsMenu, setShowAiToolsMenu] = useState(false);
  const aiToolsRef = useRef<HTMLDivElement>(null);
  // Which dropdown is open: 'add' | 'export' | 'runs' | 'more' | `q:${itemId}` | `latex:${itemId}`
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const toggleMenu = (id: string) => setOpenMenu(prev => (prev === id ? null : id));

  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvImportInputRef = useRef<HTMLInputElement>(null);
  const pauseRef = useRef<boolean>(false);
  const activeAbortControllersRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (aiToolsRef.current && !aiToolsRef.current.contains(e.target as Node)) {
        setShowAiToolsMenu(false);
      }
      if (!(e.target as Element | null)?.closest?.('[data-menu-root]')) {
        setOpenMenu(null);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenu(null);
        setShowAiToolsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  useEffect(() => {
    pauseRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    const unsub = subscribeToExtensionStatus(st => {
      setBridgeStatus(st);
    });
    pingStudyAiExtension().catch(() => {});
    return () => unsub();
  }, [aiEngine]);

  useEffect(() => {
    if (initialPages && initialPages.length > 0) {
      const queueItems: PageQueueItem[] = initialPages.map((url, idx) => ({
        id: `stitch-page-${Date.now()}-${idx}`,
        pageNumber: idx + 1,
        imageUrl: url,
        status: 'pending',
        mcqCount: 0,
        isSelected: true,
      }));
      setPages(queueItems);
      onClearInitialPages?.();
    }
  }, [initialPages]);

  // Listen to load requests from the History Drawer
  useEffect(() => {
    const handleLoadHistory = (e: any) => {
      const item: MocktestHistoryItem = e.detail;
      if (!item || !item.questions || item.questions.length === 0) return;

      if (item.id) {
        currentSessionSetIdRef.current = item.id;
      }
      setExtractedMcqs(item.questions);
      if (item.setName) {
        setSetName(item.setName);
        setOutputFileName(item.setName);
      }

      // Restore full PDF pages, images and content so the layout & editor loads completely!
      if (item.pages && Array.isArray(item.pages) && item.pages.length > 0) {
        const restoredPages: PageQueueItem[] = item.pages.map((p: any) => {
          const pageQuestions = (p.items && p.items.length > 0)
            ? p.items
            : item.questions.filter((q: MockTestMcqItem) => q.pageNumber === p.pageNumber || q.pageId === p.id);

          return {
            id: p.id || `page_${p.pageNumber}_${Date.now()}`,
            pageNumber: p.pageNumber,
            imageUrl: p.imageUrl || '',
            status: p.status || 'ready',
            mcqCount: pageQuestions.length,
            isSelected: true,
            items: pageQuestions,
            rawTextContent: p.rawTextContent || '',
            sourceType: p.sourceType || (p.rawTextContent ? 'text' : 'image'),
            fileName: p.fileName || item.setName || `Page ${p.pageNumber}`
          };
        });
        setPages(restoredPages);
      } else {
        // Fallback: If pages array was not saved previously, reconstruct pages by grouping questions by pageNumber
        const pageGroups = new Map<number, MockTestMcqItem[]>();
        item.questions.forEach((q: MockTestMcqItem) => {
          const pNum = q.pageNumber || (q.source_pages ? parseInt(String(q.source_pages)) : 1) || 1;
          if (!pageGroups.has(pNum)) pageGroups.set(pNum, []);
          pageGroups.get(pNum)!.push(q);
        });

        const sortedPageNumbers = Array.from(pageGroups.keys()).sort((a, b) => a - b);
        const reconstructedPages: PageQueueItem[] = sortedPageNumbers.map(pNum => {
          const pageItems = pageGroups.get(pNum) || [];
          return {
            id: `page_${pNum}_${item.id || Date.now()}`,
            pageNumber: pNum,
            imageUrl: '',
            status: 'ready' as const,
            mcqCount: pageItems.length,
            isSelected: true,
            items: pageItems,
            sourceType: 'text',
            fileName: item.setName || `Page ${pNum}`
          };
        });
        setPages(reconstructedPages);
      }

      setActiveTab('split');
      setLiveStatusText(`✓ Loaded "${item.setName || 'Mock Test'}" (${item.questions.length} MCQs) with pages from History!`);
      alert(`✨ Successfully loaded "${item.setName || 'Mock Test'}" (${item.questions.length} questions) with pages and content into the Editor!`);
    };
    window.addEventListener('load_mocktest_history', handleLoadHistory);
    return () => window.removeEventListener('load_mocktest_history', handleLoadHistory);
  }, []);

  const handleProviderChange = (prov: AiProvider) => {
    setSelectedProvider(prov);
    setStoredAiProvider(prov);
    setBridgeStatus(prev => ({ ...prev, provider: prov }));
    setDocumentChatUrl('');
  };

  // Handle files dropped / chosen
  const handleFiles = async (files: FileList | File[]) => {
    const validFiles = Array.from(files);
    if (validFiles.length === 0) return;

    // Automatically set output file name and setName from the uploaded input file
    const firstFile = validFiles[0];
    if (firstFile && firstFile.name) {
      const baseName = firstFile.name.replace(/\.[^/.]+$/, '').trim();
      if (baseName) {
        setOutputFileName(baseName);
        setSetName(baseName);
      }
    }

    if (pages.length === 0) {
      resetStudyAiBridgeSession().catch(() => {});
      setDocumentChatUrl(null);
      setDocumentSessionId(`doc_${Date.now()}`);
    }

    setUploadProgress({ current: 0, total: validFiles.length, text: 'Reading files...' });
    const newQueueItems: PageQueueItem[] = [];

    try {
      for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];

        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          setUploadProgress({
            current: i + 1,
            total: validFiles.length,
            text: `Rendering PDF pages (${file.name})...`
          });

          const images = await convertPdfToImages(file, (curr, tot) => {
            setUploadProgress({
              current: curr,
              total: tot,
              text: `Rendering PDF page ${curr} of ${tot} (high-res)...`
            });
          });

          images.forEach(img => {
            newQueueItems.push({
              id: `page_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              pageNumber: 0,
              imageUrl: img,
              status: 'pending',
              mcqCount: 0,
              isSelected: true,
              items: []
            });
          });
        } else if (file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(file.name)) {
          setUploadProgress({
            current: i + 1,
            total: validFiles.length,
            text: `Loading image ${file.name}...`
          });
          const base64 = await readFileAsBase64(file);
          newQueueItems.push({
            id: `page_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            pageNumber: 0,
            imageUrl: base64,
            status: 'pending',
            mcqCount: 0,
            isSelected: true,
            items: [],
            sourceType: 'image',
            fileName: file.name
          });
        } else if (file.name.toLowerCase().endsWith('.docx') || file.name.toLowerCase().endsWith('.doc') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
          // Word Document processing using mammoth
          setUploadProgress({
            current: i + 1,
            total: validFiles.length,
            text: `Extracting text from Word document (${file.name})...`
          });
          const arrayBuffer = await file.arrayBuffer();
          let extractedText = '';
          try {
            const result = await mammoth.convertToMarkdown({ arrayBuffer });
            extractedText = (result.value || '').trim();
          } catch (mErr) {
            console.warn('mammoth markdown conversion failed, falling back to raw text:', mErr);
            const rawRes = await mammoth.extractRawText({ arrayBuffer });
            extractedText = (rawRes.value || '').trim();
          }

          if (!extractedText) {
            alert(`Could not extract readable text from "${file.name}". Please make sure the Word document contains text.`);
            continue;
          }

          const chunks = splitTextIntoDocumentPages(extractedText, directTextSplitCount || 10);
          chunks.forEach((chunk, chunkIdx) => {
            newQueueItems.push({
              id: `docx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              pageNumber: 0,
              imageUrl: '',
              status: 'pending',
              mcqCount: 0,
              isSelected: true,
              items: [],
              rawTextContent: chunk,
              sourceType: 'docx',
              fileName: chunks.length > 1 ? `${file.name} (Part ${chunkIdx + 1}/${chunks.length})` : file.name
            });
          });
        } else if (file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt') || file.name.toLowerCase().endsWith('.md')) {
          // Raw text or markdown file
          setUploadProgress({
            current: i + 1,
            total: validFiles.length,
            text: `Reading text file (${file.name})...`
          });
          const text = await file.text();
          const cleanText = text.trim();
          if (!cleanText) {
            alert(`File "${file.name}" is empty.`);
            continue;
          }

          const chunks = splitTextIntoDocumentPages(cleanText, directTextSplitCount || 10);
          chunks.forEach((chunk, chunkIdx) => {
            newQueueItems.push({
              id: `txt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              pageNumber: 0,
              imageUrl: '',
              status: 'pending',
              mcqCount: 0,
              isSelected: true,
              items: [],
              rawTextContent: chunk,
              sourceType: 'text',
              fileName: chunks.length > 1 ? `${file.name} (Part ${chunkIdx + 1}/${chunks.length})` : file.name
            });
          });
        }
      }

      setPages(prev => {
        const startNum = prev.length + 1;
        const mapped = newQueueItems.map((item, idx) => ({
          ...item,
          pageNumber: startNum + idx
        }));
        return [...prev, ...mapped];
      });
    } catch (err: any) {
      alert(`Error loading files: ${err.message || err}`);
    } finally {
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Direct Text Input: Chunk and add to pages
  const handleAddDirectText = (startExtractNow = false) => {
    if (!directTextInput || !directTextInput.trim()) {
      alert('Please enter or paste exam text first.');
      return;
    }

    if (pages.length === 0) {
      resetStudyAiBridgeSession().catch(() => {});
      setDocumentChatUrl(null);
      setDocumentSessionId(`doc_${Date.now()}`);
    }

    const clean = directTextInput.trim();
    const chunks = splitTextIntoDocumentPages(clean, directTextSplitCount || 10);
    const startNum = pages.length + 1;

    const newItems: PageQueueItem[] = chunks.map((chunk, idx) => ({
      id: `text_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      pageNumber: startNum + idx,
      imageUrl: '',
      status: 'pending',
      mcqCount: 0,
      isSelected: true,
      items: [],
      rawTextContent: chunk,
      sourceType: 'text',
      fileName: chunks.length > 1 ? `Pasted Text (Section ${idx + 1}/${chunks.length})` : 'Pasted Text'
    }));

    setPages(prev => [...prev, ...newItems]);
    setDirectTextInput('');
    setInputMode('upload'); // Switch to main workspace view

    setLiveStatusText(`✓ Added ${chunks.length} text section(s) to extraction queue!`);

    if (startExtractNow) {
      setTimeout(() => {
        handleStartExtraction(extractionMode);
      }, 350);
    }
  };

  // Process a single page item sequentially with carry-over context
  const processPageItemSequential = async (
    page: PageQueueItem,
    pendingContext: PendingMcqContext | null,
    pageIndex: number,
    totalPages: number,
    isLastPage: boolean,
    mode?: 'exact' | 'similar',
    engine: 'bridge' | 'api' = aiEngine
  ): Promise<{ completeItems: MockTestMcqItem[]; nextPendingContext: PendingMcqContext | null }> => {
    const activeMode = mode || extractionMode;
    const isSimilar = activeMode === 'similar';

    setActivePageIndex(pageIndex);
    setPages(prev => prev.map(p => p.id === page.id ? { ...p, status: 'processing', errorMessage: undefined } : p));
    
    const abortController = new AbortController();
    activeAbortControllersRef.current.set(page.id, abortController);

    const carryNotice = pendingContext && pendingContext.pendingItems.length > 0
      ? ` (Carrying forward ${pendingContext.pendingItems.length} pending MCQ from P.${pendingContext.sourcePageNumber})`
      : '';
    setLiveStatusText(
      isSimilar
        ? `[Sequential ${pageIndex + 1}/${totalPages}] Page ${page.pageNumber}: 🧠 Generating BRAND NEW similar MCQs from reference page...${carryNotice}`
        : `[Sequential ${pageIndex + 1}/${totalPages}] Page ${page.pageNumber}: Starting AI extraction...${carryNotice}`
    );

    const isUsingBridge = engine === 'bridge';

    try {
      let rawExtractedItems: MockTestMcqItem[] = [];

      if (isUsingBridge) {
        let prompt = isSimilar
          ? buildMockTestSimilarBridgePrompt(setName, pendingContext, page.pageNumber)
          : buildMockTestBridgePrompt(setName, pendingContext, page.pageNumber);

        if (page.rawTextContent) {
          prompt = `${prompt}\n\nRAW EXAM DOCUMENT TEXT TO EXTRACT:\n\`\`\`\n${page.rawTextContent}\n\`\`\``;
        }

        const isJpeg = page.imageUrl?.startsWith('data:image/jpeg') || page.imageUrl?.includes('/9j/');
        const imgExt = isJpeg ? 'jpg' : 'png';
        const imgMime = isJpeg ? 'image/jpeg' : 'image/png';
        const pageFileName = page.imageUrl
          ? `mocktest_page_${page.pageNumber}.${imgExt}`
          : `mocktest_page_${page.pageNumber}.txt`;

        // A chat that keeps growing makes uploads and the composer unreliable, so start a fresh
        // one every few pages. Split-question context still carries over: it travels in the prompt.
        const startNewChat = shouldStartNewChat(pageIndex, chatRotation);
        if (startNewChat && pageIndex > 0) {
          setDocumentChatUrl(null);
          setLiveStatusText(`[Page ${page.pageNumber}] Starting a fresh AI chat (every ${chatRotation} pages)...`);
        }

        const initialMarker = `---STUDY_AI_COMPLETE_P${page.pageNumber}_${crypto.randomUUID()}---`;
        page.expectedMarker = initialMarker;
        setPages(prev => prev.map(p => p.id === page.id ? { ...p, expectedMarker: initialMarker } : p));

        const bridgeRes = await extractWithStudyAiBridge({
          base64Image: page.imageUrl || undefined,
          fileName: pageFileName,
          mimeType: page.imageUrl ? imgMime : 'text/plain',
          skipPdf: !page.imageUrl,
          prompt,
          provider: selectedProvider || getStoredAiProvider() || 'gemini',
          continueChat: !startNewChat,
          chatUrl: startNewChat ? undefined : (documentChatUrlRef.current || undefined),
          pageNumber: page.pageNumber,
          totalPages: pages.length,
          expectedMarker: initialMarker,
          silent: true,
          signal: abortController.signal,
          onProgress: (step, detail, chatUrl) => {
            if (chatUrl) {
              setDocumentChatUrl(chatUrl);
            }
            const msg = detail || `${step.toUpperCase()}...`;
            setLiveStatusText(`[Page ${page.pageNumber}] ${msg}`);
            setPages(prev => prev.map(p => p.id === page.id ? { ...p, errorMessage: msg } : p));
          }
        });

        if (bridgeRes.chatUrl) {
          setDocumentChatUrl(bridgeRes.chatUrl);
          // Remember the page's own chat so Recapture still works after a rotation.
          page.chatUrl = bridgeRes.chatUrl;
          setPages(prev => prev.map(p => p.id === page.id ? { ...p, chatUrl: bridgeRes.chatUrl } : p));
        }
        if (bridgeRes.expectedMarker) {
          page.expectedMarker = bridgeRes.expectedMarker;
          setPages(prev => prev.map(p => p.id === page.id ? { ...p, expectedMarker: bridgeRes.expectedMarker } : p));
        }
        const { rawText, elements } = bridgeRes;

        // 1. Parse AI rawText as JSON
        const startIndex = extractedMcqs.length + 1;
        rawExtractedItems = parseAiOutputToMockTestItems(rawText, setName, startIndex);

        // 2. Fallback: if JSON parse produced nothing, convert elements only if real items exist
        if (rawExtractedItems.length === 0 && elements && elements.length > 0) {
          rawExtractedItems = convertElementsToMockTestItems(elements, setName);
        }

        // 3. Strict Check: If no MCQs found, do NOT insert dummy mock questions!
        if (rawExtractedItems.length === 0) {
          throw new Error(`Page ${page.pageNumber}: No MCQs could be extracted. Please check the page image.`);
        }
      } else {
        // Direct API mode
        setLiveStatusText(
          isSimilar
            ? `[Page ${page.pageNumber}] 🧠 Calling Gemini API to generate NEW practice MCQs from reference...`
            : `[Page ${page.pageNumber}] Calling Gemini API with carry-over context...`
        );
        const startIndex = extractedMcqs.length + 1;
        rawExtractedItems = await extractMockTestWithDirectApi(
          page.imageUrl || '',
          setName,
          startIndex,
          pendingContext,
          page.pageNumber,
          isSimilar,
          page.rawTextContent,
          abortController.signal
        );
      }

      // 1. RECONCILE CARRY-OVER MERGE
      const { mergedPendingItems, freshPageItems, logMessage } = mergePendingCarryOver(
        rawExtractedItems,
        pendingContext,
        page.pageNumber
      );
      console.log(`[Sequential Engine] ${logMessage}`);
      setLiveStatusText(logMessage);

      // If pending items were merged/completed, update them in state
      // If pending items were merged/completed, update them in state
      if (mergedPendingItems.length > 0 && pendingContext) {
        setPages(prev => {
          const nextPages = prev.map(p => {
            if (p.pageNumber === pendingContext.sourcePageNumber || p.id === pendingContext.sourcePageId) {
              const existingItems = p.items || [];
              const updatedItems = existingItems.map(existing => {
                const matchedMerged = mergedPendingItems.find(m => m.id === existing.id);
                return matchedMerged || existing;
              });
              for (const m of mergedPendingItems) {
                if (!updatedItems.some(it => it.id === m.id)) {
                  updatedItems.push(m);
                }
              }
              return {
                ...p,
                items: updatedItems,
                mcqCount: updatedItems.length,
                errorMessage: undefined
              };
            }
            return p;
          });

          // Derive extractedMcqs cleanly from all pages
          const allMcqs = nextPages.flatMap(p => p.items || []);
          setExtractedMcqs(allMcqs.map((it, idx) => ({ ...it, question_r: idx + 1 })));
          return nextPages;
        });
      }

      // 2. PROCESS FRESH PAGE ITEMS: Tag with this page's metadata
      const taggedFreshItems = freshPageItems.map(item => ({
        ...item,
        pageNumber: page.pageNumber,
        pageId: page.id,
        set_name: setName,
        difficulty_level: difficulty
      }));

      // 3. SEPARATE COMPLETE VS INCOMPLETE/PENDING ITEMS
      const { completeItems, pendingItems } = separateCompleteAndPendingItems(taggedFreshItems, isLastPage);
      console.log(`[Sequential Engine] Page ${page.pageNumber}: ${completeItems.length} complete, ${pendingItems.length} pending.`);

      // 4. If One-Shot Auto-Fill All Fields is enabled, perform deep research pass on complete items
      let finalComplete = completeItems;
      if (autoDeepSolveAll && finalComplete.length > 0) {
        setLiveStatusText(`[Page ${page.pageNumber}] Deep-researching solutions for ${finalComplete.length} MCQs...`);
        setPages(prev => prev.map(p => p.id === page.id ? {
          ...p,
          errorMessage: `Deep-researching solutions (${finalComplete.length} MCQs)...`
        } : p));

        finalComplete = await Promise.all(
          finalComplete.map(async (item) => {
            if (abortController.signal.aborted) {
              return item;
            }
            if (item.solution_hi && item.solution_hi.length > 35 && item.solution_en && item.solution_en.length > 35) {
              return item;
            }
            try {
              const solRes = await generateDeepSolutionForItem(item);
              return {
                ...item,
                solution_hi: solRes.solution_hi || item.solution_hi,
                solution_en: solRes.solution_en || item.solution_en,
                difficulty_level: solRes.difficulty_level || item.difficulty_level
              };
            } catch (e) {
              console.warn(`Deep research failed for Q#${item.question_r}:`, e);
              return item;
            }
          })
        );
      }

      if (abortController.signal.aborted) {
        throw new DOMException('Extraction stopped by user.', 'AbortError');
      }

      // If last page, include any pending items as complete so nothing is lost
      if (isLastPage && pendingItems.length > 0) {
        finalComplete = [...finalComplete, ...pendingItems];
      }

      // ALL items extracted from this page belong to this page!
      // Even if an item is pending carry-over to the next page, it originated here and must be displayed here.
      const allPageItems = [...finalComplete, ...(isLastPage ? [] : pendingItems)];

      // Update current page state & keep extractedMcqs 100% in sync with all pages
      setPages(prev => {
        const nextPages: PageQueueItem[] = prev.map(p => p.id === page.id ? {
          ...p,
          status: 'ready' as const,
          mcqCount: allPageItems.length,
          errorMessage: pendingItems.length > 0 && !isLastPage ? `Question continues on Page ${page.pageNumber + 1}` : undefined,
          items: allPageItems
        } : p);

        // Derive extractedMcqs cleanly from all pages combined
        const allMcqs = nextPages.flatMap(p => p.items || []);
        const formattedMcqs = allMcqs.map((it, idx) => ({ ...it, question_r: idx + 1 }));
        setExtractedMcqs(formattedMcqs);

        // Auto-save this updated question set to user account history immediately after every single page!
        if (formattedMcqs.length > 0) {
          const currentUid = user?.uid || 'guest';
          if (!currentSessionSetIdRef.current) {
            currentSessionSetIdRef.current = 'mock_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
          }
          addMocktestHistoryItem(currentUid, {
            id: currentSessionSetIdRef.current,
            userId: currentUid,
            setName: outputFileName || setName || 'Mock Test Paper',
            timestamp: Date.now(),
            questionCount: formattedMcqs.length,
            questions: formattedMcqs,
            pages: nextPages,
          }).catch(() => {});
        }

        return nextPages;
      });

      const nextPendingContext: PendingMcqContext | null = (pendingItems.length > 0 && !isLastPage)
        ? {
            sourcePageNumber: page.pageNumber,
            sourcePageId: page.id,
            pendingItems
          }
        : null;

      return { completeItems: finalComplete, nextPendingContext };
    } catch (err: any) {
      const isAborted = err?.name === 'AbortError' || err?.message?.includes('stopped by user') || err?.message?.includes('aborted');
      if (isAborted) {
        setPages(prev => prev.map(p => p.id === page.id ? {
          ...p,
          status: (p.items && p.items.length > 0) ? 'ready' : 'pending',
          errorMessage: 'Extraction stopped by user'
        } : p));
        throw err;
      }
      const msg = err.message || 'Extraction failed';
      setPages(prev => prev.map(p => p.id === page.id ? {
        ...p,
        status: 'error',
        errorMessage: msg
      } : p));
      throw err;
    } finally {
      activeAbortControllersRef.current.delete(page.id);
    }
  };

  // Convenient single-page process wrapper
  const processPageItem = async (page: PageQueueItem, pageIndex: number, totalPages: number): Promise<MockTestMcqItem[]> => {
    const res = await processPageItemSequential(page, null, pageIndex, totalPages, true);
    return res.completeItems;
  };

  // Multi-Page Sequential Extraction Loop with Carry-Over Context
  const handleStartExtraction = async (targetMode?: 'exact' | 'similar', forceAll: boolean = false) => {
    const mode = targetMode || extractionMode;
    if (targetMode) setExtractionMode(targetMode);

    let selectedPages = pages.filter(p => p.isSelected);
    if (selectedPages.length === 0) {
      alert('No pages selected for extraction. Please select at least one page.');
      return;
    }

    if (!forceAll) {
      const pendingOrError = selectedPages.filter(p => p.status !== 'ready');
      if (pendingOrError.length === 0) {
        const confirmAll = confirm(
          `All ${selectedPages.length} selected pages have already been processed.\n\n` +
          `Would you like to ${mode === 'similar' ? 'GENERATE NEW SIMILAR MCQs for' : 'RE-EXTRACT'} all ${selectedPages.length} selected pages from scratch?`
        );
        if (!confirmAll) return;
        setPages(prev => prev.map(p => p.isSelected ? { ...p, status: 'pending', errorMessage: undefined } : p));
      } else if (pendingOrError.length < selectedPages.length) {
        const reExtractAll = confirm(
          `${pendingOrError.length} page(s) need processing, and ${selectedPages.length - pendingOrError.length} are already ready.\n\n` +
          `Click OK to process ALL ${selectedPages.length} selected pages,\nor Cancel to process ONLY the ${pendingOrError.length} pending/failed page(s).`
        );
        if (reExtractAll) {
          setPages(prev => prev.map(p => p.isSelected ? { ...p, status: 'pending', errorMessage: undefined } : p));
        } else {
          selectedPages = pendingOrError;
        }
      } else {
        selectedPages = pendingOrError;
      }
    } else {
      setPages(prev => prev.map(p => p.isSelected ? { ...p, status: 'pending', errorMessage: undefined } : p));
    }

    let activeEngine = aiEngine;
    if (activeEngine === 'bridge') {
      const ping = await pingStudyAiExtension(1500);
      if (!ping.connected) {
        const useApiInstead = confirm(
          'TextExtract Pro Bridge Extension se connection nahi mil pa raha hai.\n\n' +
          'Kya aap Direct Gemini API (23 Rotating Keys) se bina extension ke turant extraction karna chahte hain?\n\n' +
          '• [OK] dabayein: Direct Gemini API se turant extraction shuru karein (No extension needed).\n' +
          '• [Cancel] dabayein: Extension connection modal kholein.'
        );
        if (useApiInstead) {
          activeEngine = 'api';
          setAiEngine('api');
        } else {
          setShowConnectModal(true);
          return;
        }
      }
    }

    setIsProcessingAll(true);
    pauseRef.current = false;
    setIsPaused(false);

    try {
      let carriedPendingContext: PendingMcqContext | null = null;
      const firstIndex = pages.findIndex(p => p.id === selectedPages[0].id);
      const previousPage = firstIndex > 0 ? pages[firstIndex - 1] : null;
      if (previousPage?.items?.length && previousPage.pageNumber + 1 === selectedPages[0].pageNumber) {
        const incomplete = previousPage.items.filter(item => {
          const issues = detectItemFieldIssues(item);
          return issues.hasMissingOptions || issues.hasEmptyQuestion;
        });
        if (incomplete.length) carriedPendingContext = {
          sourcePageNumber: previousPage.pageNumber, sourcePageId: previousPage.id, pendingItems: incomplete,
        };
      }

      for (let i = 0; i < selectedPages.length; i++) {
        if (pauseRef.current) {
          setLiveStatusText('Processing paused by user.');
          return;
        }

        const page = selectedPages[i];
        if (carriedPendingContext && carriedPendingContext.sourcePageNumber + 1 !== page.pageNumber) carriedPendingContext = null;
        const isLast = (i === selectedPages.length - 1);

        const carryInfo = carriedPendingContext && carriedPendingContext.pendingItems.length > 0
          ? ` (Carrying ${carriedPendingContext.pendingItems.length} pending MCQ from P.${carriedPendingContext.sourcePageNumber})`
          : '';
        setLiveStatusText(
          mode === 'similar'
            ? `[Sequential ${i + 1}/${selectedPages.length}] Page ${page.pageNumber}: 🧠 Generating NEW similar MCQs from reference page...${carryInfo}`
            : `[Sequential ${i + 1}/${selectedPages.length}] Processing Page ${page.pageNumber}...${carryInfo}`
        );

        try {
          const { nextPendingContext } = await processPageItemSequential(
            page,
            carriedPendingContext,
            i,
            selectedPages.length,
            isLast,
            mode,
            activeEngine
          );
          carriedPendingContext = nextPendingContext;
        } catch (pageErr: any) {
          const isAborted = pageErr?.name === 'AbortError' || pageErr?.message?.includes('stopped by user') || pageErr?.message?.includes('aborted');
          if (isAborted) {
            console.log(`Page ${page.pageNumber} extraction stopped.`);
            setLiveStatusText("Extraction stopped. Completed pages are saved; resume remaining pages when ready.");
            return;
          } else {
            console.error(`Error processing page ${page.pageNumber}:`, pageErr);
            throw new Error(`Page ${page.pageNumber} failed: ${pageErr.message || pageErr}. Completed pages are saved. Retry this page before continuing.`);
          }
        }

        // Fast pacing delay between sequential pages (keys rotate automatically across pool)
        await new Promise(res => setTimeout(res, 150));
      }

      setLiveStatusText(
        mode === 'similar'
          ? '✓ All selected pages processed: Brand-new similar practice MCQs generated successfully!'
          : 'All selected pages sequentially processed with carry-over context!'
      );
    } catch (err: any) {
      console.error('Sequential extraction error:', err);
      setLiveStatusText(`Extraction stopped: ${err.message || err}`);
    } finally {
      setIsProcessingAll(false);
      setActivePageIndex(null);
      // Automatically save completed extraction set to user history
      setTimeout(() => {
        setPages(currentPages => {
          const allMcqs = currentPages.flatMap(p => p.items || []);
          if (allMcqs.length > 0) {
            const currentUid = user?.uid || 'guest';
            if (!currentSessionSetIdRef.current) {
              currentSessionSetIdRef.current = 'mock_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
            }
            const autoItem: MocktestHistoryItem = {
              id: currentSessionSetIdRef.current,
              userId: currentUid,
              setName: outputFileName || setName || 'Mock Test Paper',
              timestamp: Date.now(),
              questionCount: allMcqs.length,
              questions: allMcqs.map((it, idx) => ({ ...it, question_r: idx + 1 })),
              pages: currentPages,
            };
            addMocktestHistoryItem(currentUid, autoItem).catch((err) => {
              console.warn('[history] Auto-save mocktest failed:', err);
            });
          }
          return currentPages;
        });
      }, 50);
    }
  };

  // Dedicated full re-extraction from scratch
  const handleReExtractAll = async (targetMode?: 'exact' | 'similar') => {
    if (pages.length === 0) return;
    const mode = targetMode || extractionMode;
    const actionLabel = mode === 'similar' ? 'generate BRAND-NEW SIMILAR MCQs for' : 'RE-EXTRACT';
    const confirmAll = confirm(`Are you sure you want to ${actionLabel} ALL ${pages.length} pages sequentially from scratch?`);
    if (!confirmAll) return;
    setPages(prev => prev.map(p => ({ ...p, isSelected: true, status: 'pending', errorMessage: undefined })));
    setIsProcessingAll(false);
    setIsPaused(false);
    pauseRef.current = false;
    setTimeout(() => {
      handleStartExtraction(mode, true);
    }, 150);
  };

  // Re-verify single item with missing fields using actual page images
  const handleReverifyItem = async (item: MockTestMcqItem) => {
    const primaryPage = pages.find(p => p.pageNumber === item.pageNumber || p.id === item.pageId);
    if (!primaryPage || !primaryPage.imageUrl) {
      alert('Cannot locate page image for this question.');
      return;
    }

    const nextPage = pages.find(p => p.pageNumber === (item.pageNumber || 1) + 1);
    const prevPage = pages.find(p => p.pageNumber === (item.pageNumber || 1) - 1);
    const adjacentPage = (item.source_pages && String(item.source_pages).includes(','))
      ? (nextPage || prevPage)
      : nextPage;

    setRepairingId(item.id);
    setLiveStatusText(`Visual Re-verifying Q#${item.question_r} using Page ${primaryPage.pageNumber}${adjacentPage ? ` & Page ${adjacentPage.pageNumber}` : ''}...`);

    try {
      const reverified = await reverifyMockTestItemWithImages(
        item,
        primaryPage.imageUrl,
        adjacentPage?.imageUrl
      );
      updateItem(item.id, reverified);
      setLiveStatusText(`✓ Q#${item.question_r} visually re-verified successfully!`);
    } catch (err: any) {
      alert(`Re-verification failed for Q#${item.question_r}: ${err.message || err}`);
    } finally {
      setRepairingId(null);
    }
  };

  // Bulk Re-verify Missing Fields using actual page images
  const handleReverifyMissingFields = async (targetItems?: MockTestMcqItem[]) => {
    const list = targetItems || extractedMcqs.filter(it => detectItemFieldIssues(it).hasIssues);
    if (list.length === 0) {
      alert('All questions are already complete!');
      return;
    }

    setIsRepairingAll(true);
    setRepairProgress({ current: 0, total: list.length });
    setLiveStatusText(`🔍 Visually re-verifying ${list.length} question(s) with original page images...`);

    try {
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        setRepairProgress({ current: i + 1, total: list.length });
        setRepairingId(item.id);
        setLiveStatusText(`Visual Re-verifying Q#${item.question_r} (${i + 1}/${list.length})...`);

        const primaryPage = pages.find(p => p.pageNumber === item.pageNumber || p.id === item.pageId);
        const nextPage = pages.find(p => p.pageNumber === (item.pageNumber || 1) + 1);
        const prevPage = pages.find(p => p.pageNumber === (item.pageNumber || 1) - 1);
        const adjacentPage = (item.source_pages && String(item.source_pages).includes(','))
          ? (nextPage || prevPage)
          : nextPage;

        if (primaryPage?.imageUrl) {
          try {
            const reverified = await reverifyMockTestItemWithImages(
              item,
              primaryPage.imageUrl,
              adjacentPage?.imageUrl
            );
            updateItem(item.id, reverified);
          } catch (e) {
            console.warn(`Visual re-verify failed for Q#${item.question_r}:`, e);
          }
        }

        await new Promise(r => setTimeout(r, 600));
      }
      setLiveStatusText(`✓ Visual re-verification completed!`);
    } finally {
      setIsRepairingAll(false);
      setRepairingId(null);
    }
  };

  // Single page retry / process (supports 'exact' vs 'similar')
  const handleRetryPage = async (page: PageQueueItem, idx: number, mode?: 'exact' | 'similar') => {
    const targetMode = mode || extractionMode;
    if (isProcessingAll && !isPaused) {
      const confirmOverride = confirm(
        `Batch processing is active. Would you like to pause batch extraction and process Page ${page.pageNumber} now?`
      );
      if (!confirmOverride) return;
      pauseRef.current = true;
      setIsPaused(true);
      await new Promise(r => setTimeout(r, 300));
    }

    setIsProcessingAll(false);
    pauseRef.current = false;
    setActivePageIndex(idx);

    // Immediately reflect processing state in the UI
    setPages(prev => prev.map(p => p.id === page.id ? {
      ...p,
      status: 'processing',
      errorMessage: undefined
    } : p));
    setLiveStatusText(
      targetMode === 'similar'
        ? `[Page ${page.pageNumber}] 🧠 Generating BRAND NEW similar MCQs using this page as reference...`
        : `[Page ${page.pageNumber}] Retrying extraction with intelligent key rotation...`
    );

    try {
      // Find if previous page has pending / incomplete items to carry over
      let retryPendingContext: PendingMcqContext | null = null;
      if (idx > 0) {
        const prevPage = pages[idx - 1];
        if (prevPage && prevPage.items && prevPage.items.length > 0) {
          const incompleteItems = prevPage.items.filter(it => {
            const iss = detectItemFieldIssues(it);
            return iss.hasMissingOptions || iss.hasEmptyQuestion;
          });
          if (incompleteItems.length > 0) {
            retryPendingContext = {
              sourcePageNumber: prevPage.pageNumber,
              sourcePageId: prevPage.id,
              pendingItems: incompleteItems
            };
          }
        }
      }

      await processPageItemSequential(page, retryPendingContext, idx, pages.length, idx === pages.length - 1, targetMode);
      setLiveStatusText(
        targetMode === 'similar'
          ? `✓ Page ${page.pageNumber}: Similar practice MCQs generated successfully!`
          : `✓ Page ${page.pageNumber} extracted successfully!`
      );
    } catch (err: any) {
      const isAborted = err?.name === 'AbortError' || err?.message?.includes('stopped by user') || err?.message?.includes('aborted');
      if (isAborted) {
        setPages(prev => prev.map(p => p.id === page.id ? {
          ...p,
          status: (p.items && p.items.length > 0) ? 'ready' : 'pending',
          errorMessage: 'Extraction stopped by user'
        } : p));
        setLiveStatusText(`Page ${page.pageNumber} extraction stopped.`);
        return;
      }
      console.error(`Page ${page.pageNumber} processing failed:`, err);
      const errMsg = err?.message || 'Processing failed';
      setPages(prev => prev.map(p => p.id === page.id ? {
        ...p,
        status: 'error',
        errorMessage: errMsg
      } : p));
      setLiveStatusText(`Page ${page.pageNumber} processing failed: ${errMsg}`);
    } finally {
      setActivePageIndex(null);
    }
  };

  // Stop extraction for a specific running page
  const handleStopPage = (pageId: string) => {
    // If batch was running, pause batch processing so subsequent pages don't auto-run
    if (isProcessingAll) {
      pauseRef.current = true;
      setIsPaused(true);
    }
    const controller = activeAbortControllersRef.current.get(pageId);
    if (controller) {
      controller.abort();
      activeAbortControllersRef.current.delete(pageId);
    }
    setPages(prev => prev.map(p => {
      if (p.id === pageId) {
        return {
          ...p,
          status: (p.items && p.items.length > 0) ? 'ready' : 'pending',
          errorMessage: 'Extraction stopped by user'
        };
      }
      return p;
    }));
    const target = pages.find(p => p.id === pageId);
    setLiveStatusText(target ? `Page ${target.pageNumber} extraction stopped.` : 'Extraction stopped.');
    if (activePageIndex !== null && pages[activePageIndex]?.id === pageId) {
      setActivePageIndex(null);
    }
  };

  // Stop all running extractions
  const handleStopAll = () => {
    pauseRef.current = true;
    setIsProcessingAll(false);
    setIsPaused(false);
    activeAbortControllersRef.current.forEach(ctrl => ctrl.abort());
    activeAbortControllersRef.current.clear();
    setPages(prev => prev.map(p => {
      if (p.status === 'processing') {
        return {
          ...p,
          status: (p.items && p.items.length > 0) ? 'ready' : 'pending',
          errorMessage: 'Extraction stopped by user'
        };
      }
      return p;
    }));
    setActivePageIndex(null);
    setLiveStatusText('All extractions stopped by user.');
  };

  // Generate a brand-new similar question variant from an existing MCQ item
  const handleGenerateSimilarSingleItem = async (item: MockTestMcqItem) => {
    setGeneratingSimilarId(item.id);
    setLiveStatusText(`Generating brand-new similar question inspired by Q#${item.question_r}...`);
    try {
      const newItem = await generateSimilarQuestionItem(item);
      // Insert newItem immediately after the reference item
      setExtractedMcqs(prev => {
        const idx = prev.findIndex(it => it.id === item.id);
        const copy = [...prev];
        if (idx >= 0) {
          copy.splice(idx + 1, 0, newItem);
        } else {
          copy.push(newItem);
        }
        return copy.map((it, i) => ({ ...it, question_r: i + 1 }));
      });
      // Also update pages items if associated
      if (item.pageId) {
        setPages(prev => prev.map(p => {
          if (p.id === item.pageId && p.items) {
            const pIdx = p.items.findIndex(it => it.id === item.id);
            const pCopy = [...p.items];
            if (pIdx >= 0) {
              pCopy.splice(pIdx + 1, 0, newItem);
            } else {
              pCopy.push(newItem);
            }
            return { ...p, items: pCopy, mcqCount: pCopy.length };
          }
          return p;
        }));
      }
      setLiveStatusText(`✓ New similar question variant generated successfully!`);
    } catch (err: any) {
      alert(`Failed to generate similar question: ${err?.message || err}`);
    } finally {
      setGeneratingSimilarId(null);
    }
  };

  // Batch generate brand new similar questions from currently extracted MCQs
  const handleGenerateSimilarFromCurrentMcqs = async () => {
    if (extractedMcqs.length === 0) {
      alert('No MCQs currently loaded to use as reference.');
      return;
    }
    const confirmGen = confirm(
      `Generate brand-new similar practice MCQs for all ${extractedMcqs.length} questions?\n\n` +
      `The current questions will be used strictly as conceptual reference (topics, formulas, difficulty), and fresh, unique practice questions will be created (NO duplicates).`
    );
    if (!confirmGen) return;

    setIsGeneratingSimilarBatch(true);
    setLiveStatusText(`Generating ${extractedMcqs.length} new similar questions from reference set...`);
    try {
      const newItems = await generateSimilarBatchFromItems(extractedMcqs, (msg) => {
        setLiveStatusText(msg);
      });
      // Append the new variants with updated numbering
      setExtractedMcqs(prev => {
        const combined = [...prev, ...newItems];
        return combined.map((it, idx) => ({ ...it, question_r: idx + 1 }));
      });
      setLiveStatusText(`✓ Successfully generated ${newItems.length} new similar practice questions!`);
    } catch (err: any) {
      alert(`Batch similar generation failed: ${err?.message || err}`);
    } finally {
      setIsGeneratingSimilarBatch(false);
    }
  };

  // Manual Recapture from open AI tab (Gemini/ChatGPT/DeepSeek/Claude)
  const handleRecaptureFromAiTab = async (page: PageQueueItem) => {
    if (isProcessingAll && !isPaused) {
      const confirmOverride = confirm(
        `Batch processing is currently active. Would you like to pause batch extraction and recapture Page ${page.pageNumber} now?`
      );
      if (!confirmOverride) return;
      pauseRef.current = true;
      setIsPaused(true);
      await new Promise(r => setTimeout(r, 300));
    }
    setIsProcessingAll(false);

    setLiveStatusText(`Page ${page.pageNumber}: Recapturing response from AI tab...`);
    setPages(prev => prev.map(p => p.id === page.id ? { ...p, errorMessage: 'Reading response from AI tab...' } : p));

    try {
      const provider = selectedProvider || getStoredAiProvider() || 'gemini';
      const rawText = await captureFromStudyAiBridge({
        provider,
        fullChat: false,
        chatUrl: page.chatUrl || documentChatUrl || undefined,
        pageNumber: page.pageNumber,
        totalPages: pages.length,
        expectedMarker: page.expectedMarker || undefined
      });
      if (!rawText || !rawText.trim()) {
        throw new Error('No response text detected on AI tab. Please verify the AI finished writing.');
      }

      const startIndex = extractedMcqs.filter(it => it.pageId !== page.id).length + 1;
      let formattedItems = parseAnyMockTestPastedText(rawText, setName, startIndex);
      if (formattedItems.length === 0) {
        const elements = parseExtensionOutputToElements(rawText);
        if (elements && elements.length > 0) {
          formattedItems = convertElementsToMockTestItems(elements, setName);
        }
      }

      if (formattedItems.length === 0) {
        throw new Error('AI tab content captured, but could not extract structured MCQs. You can also paste CSV / JSON directly using the "Paste CSV" button below the page.');
      }

      formattedItems = formattedItems.map(item => ({
        ...item,
        pageNumber: page.pageNumber,
        pageId: page.id,
        set_name: setName,
        difficulty_level: difficulty
      }));

      setPages(prev => prev.map(p => p.id === page.id ? {
        ...p,
        status: 'ready',
        mcqCount: formattedItems.length,
        errorMessage: undefined,
        items: formattedItems
      } : p));

      setExtractedMcqs(prev => {
        const withoutThisPage = prev.filter(it => it.pageId !== page.id);
        const nextList = [...withoutThisPage, ...formattedItems];
        return nextList.map((it, idx) => ({ ...it, question_r: idx + 1 }));
      });

      setLiveStatusText(`✓ Page ${page.pageNumber}: Successfully recaptured ${formattedItems.length} MCQs!`);
    } catch (err: any) {
      console.error('Recapture failed:', err);
      const msg = err.message || 'Recapture failed';
      setLiveStatusText(`Page ${page.pageNumber}: ${msg}`);
      setPages(prev => prev.map(p => p.id === page.id ? { ...p, errorMessage: msg } : p));
      alert(`Recapture failed: ${msg}`);
    }
  };

  // Direct manual paste of CSV / TSV / JSON for a specific page
  const handleImportPastedContentForPage = (page: PageQueueItem, rawInput: string) => {
    const text = rawInput.trim();
    if (!text) {
      setPasteError('Please enter or paste CSV, TSV table, or JSON questions first.');
      return;
    }

    try {
      const startIndex = extractedMcqs.filter(it => it.pageId !== page.id).length + 1;
      let formattedItems = parseAnyMockTestPastedText(text, setName, startIndex);
      if (formattedItems.length === 0) {
        const elements = parseExtensionOutputToElements(text);
        if (elements && elements.length > 0) {
          formattedItems = convertElementsToMockTestItems(elements, setName);
        }
      }

      if (formattedItems.length === 0) {
        setPasteError('Could not detect questions. Please verify your CSV has question/option columns, or is valid JSON/TSV.');
        return;
      }

      formattedItems = formattedItems.map(item => ({
        ...item,
        pageNumber: page.pageNumber,
        pageId: page.id,
        set_name: setName,
        difficulty_level: difficulty
      }));

      setPages(prev => prev.map(p => p.id === page.id ? {
        ...p,
        status: 'ready',
        mcqCount: formattedItems.length,
        errorMessage: undefined,
        items: formattedItems
      } : p));

      setExtractedMcqs(prev => {
        const withoutThisPage = prev.filter(it => it.pageId !== page.id);
        const nextList = [...withoutThisPage, ...formattedItems];
        return nextList.map((it, idx) => ({ ...it, question_r: idx + 1 }));
      });

      setActivePastePageId(null);
      setPasteInputText('');
      setPasteError(null);
      setLiveStatusText(`✓ Page ${page.pageNumber}: Successfully imported ${formattedItems.length} MCQs from pasted CSV/JSON!`);
    } catch (err: any) {
      setPasteError(`Import failed: ${err?.message || err}`);
    }
  };

  // Manual Recapture of ALL questions across the entire document chat
  const handleRecaptureFullChat = async () => {
    if (isProcessingAll) return;
    const confirmRecapture = confirm(
      'Recapture All Questions From AI Chat?\n\n' +
      'This will read the entire conversation thread for this document and merge all extracted questions into the table.'
    );
    if (!confirmRecapture) return;

    setLiveStatusText('Recapturing ALL MCQs from the complete AI chat thread...');
    try {
      const provider = selectedProvider || getStoredAiProvider() || 'gemini';
      const rawText = await captureFromStudyAiBridge({
        provider,
        fullChat: true,
        chatUrl: documentChatUrl || undefined
      });

      if (!rawText || !rawText.trim()) {
        throw new Error('No response text detected on AI tab. Please verify the AI finished writing.');
      }

      let allItems = parseAiOutputToMockTestItems(rawText, setName, 1);
      if (allItems.length === 0) {
        const elements = parseExtensionOutputToElements(rawText);
        if (elements && elements.length > 0) {
          allItems = convertElementsToMockTestItems(elements, setName);
        }
      }

      if (allItems.length === 0) {
        throw new Error('AI chat content captured, but could not extract structured MCQs.');
      }

      setExtractedMcqs(allItems.map((it, idx) => ({
        ...it,
        question_r: idx + 1,
        set_name: setName,
        difficulty_level: difficulty
      })));

      setLiveStatusText(`✓ Successfully recaptured all ${allItems.length} MCQs from the complete chat!`);
    } catch (err: any) {
      console.error('Full chat recapture failed:', err);
      const msg = err.message || 'Recapture failed';
      setLiveStatusText(`Full chat recapture failed: ${msg}`);
      alert(`Recapture failed: ${msg}`);
    }
  };

  // Delete a single page
  const handleDeletePage = (pageId: string) => {
    setPages(prev => prev.filter(p => p.id !== pageId).map((p, idx) => ({ ...p, pageNumber: idx + 1 })));
    setExtractedMcqs(prev => prev.filter(it => it.pageId !== pageId).map((it, idx) => ({ ...it, question_r: idx + 1 })));
  };

  // Toggle selection for a page
  const togglePageSelection = (pageId: string) => {
    setPages(prev => prev.map(p => p.id === pageId ? { ...p, isSelected: !p.isSelected } : p));
  };

  // Auto-Solve Deep Solutions for all items lacking solutions
  const handleAutoSolveAll = async () => {
    const unsolved = extractedMcqs.filter(i => !i.solution_hi || !i.solution_en);
    if (unsolved.length === 0) {
      alert('All questions already have detailed step-by-step solutions!');
      return;
    }

    setIsSolvingAll(true);
    try {
      for (let i = 0; i < extractedMcqs.length; i++) {
        const item = extractedMcqs[i];
        if (item.solution_hi && item.solution_en) continue;

        setSolvingId(item.id);
        try {
          const res = await generateDeepSolutionForItem(item);
          updateItem(item.id, {
            solution_hi: res.solution_hi || item.solution_hi,
            solution_en: res.solution_en || item.solution_en,
            difficulty_level: res.difficulty_level || item.difficulty_level
          });
        } catch (e) {
          console.warn(`Could not solve Q#${item.question_r}:`, e);
        }
        await new Promise(r => setTimeout(r, 400));
      }
    } finally {
      setIsSolvingAll(false);
      setSolvingId(null);
    }
  };

  // Auto-solve individual item
  const handleSolveSingle = async (item: MockTestMcqItem) => {
    setSolvingId(item.id);
    try {
      const res = await generateDeepSolutionForItem(item);
      updateItem(item.id, {
        solution_hi: res.solution_hi || item.solution_hi,
        solution_en: res.solution_en || item.solution_en,
        difficulty_level: res.difficulty_level || item.difficulty_level
      });
    } catch (err: any) {
      alert(`Auto-solve failed: ${err.message}`);
    } finally {
      setSolvingId(null);
    }
  };

  // Download CSV
  const handleDownloadCsv = () => {
    if (extractedMcqs.length === 0) {
      alert('No MCQs to download yet. Extract some pages first!');
      return;
    }
    const currentUid = user?.uid || 'guest';
    if (!currentSessionSetIdRef.current) {
      currentSessionSetIdRef.current = 'mock_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    }
    addMocktestHistoryItem(currentUid, {
      id: currentSessionSetIdRef.current,
      userId: currentUid,
      setName: outputFileName || setName || 'Mock Test Paper',
      timestamp: Date.now(),
      questionCount: extractedMcqs.length,
      questions: extractedMcqs,
      pages: pages,
    }).catch(() => {});

    const chosenName = (outputFileName || setName || 'mocktest').trim();
    const safeBase = chosenName.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'mocktest';
    const finalFileName = safeBase.toLowerCase().endsWith('.csv') ? safeBase : `${safeBase}.csv`;
    downloadMockTestCsv(extractedMcqs, finalFileName, answerFormat, mathFormat);
  };

  // Download DOCX with native LaTeX math equations
  const handleDownloadDocx = async () => {
    if (isGeneratingDocx || extractedMcqs.length === 0) return;
    setIsGeneratingDocx(true);
    try {
      const currentUid = user?.uid || 'guest';
      if (!currentSessionSetIdRef.current) {
        currentSessionSetIdRef.current = 'mock_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      }
      addMocktestHistoryItem(currentUid, {
        id: currentSessionSetIdRef.current,
        userId: currentUid,
        setName: outputFileName || setName || 'Mock Test Paper',
        timestamp: Date.now(),
        questionCount: extractedMcqs.length,
        questions: extractedMcqs,
        pages: pages,
      }).catch(() => {});

      const safeBase = (outputFileName || setName || 'mocktest').replace(/[\\/:\*?"<>|]+/g, '_').trim() || 'mocktest';
      await downloadMcqAsDocx(
        extractedMcqs,
        { language: docxLang, includeSolution: true, includeAnswer: true, setName: setName || outputFileName },
        `${safeBase}.docx`
      );
    } catch (e: any) {
      alert(`DOCX generation failed: ${e?.message || e}`);
    } finally {
      setIsGeneratingDocx(false);
    }
  };

  // Copy CSV to clipboard
  const handleCopyCsv = () => {
    if (extractedMcqs.length === 0) return;
    const csv = serializeMockTestToCsv(extractedMcqs, answerFormat, mathFormat);
    navigator.clipboard.writeText(csv);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Import CSV
  const handleImportCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      if (text) {
        const parsed = parseAnyMockTestPastedText(text, setName);
        if (parsed.length > 0) {
          const standardized = parsed.map(it => standardizeItemHtmlAndMathJax(it, mathFormat === 'mathjax'));
          setExtractedMcqs(standardized);

          // Automatically save imported test set to User Account History
          const currentUid = user?.uid || 'guest';
          const importItem: MocktestHistoryItem = {
            id: 'mock_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            userId: currentUid,
            setName: file.name.replace(/\.[^/.]+$/, '') || setName || 'Imported Test Set',
            timestamp: Date.now(),
            questionCount: standardized.length,
            questions: standardized,
          };
          addMocktestHistoryItem(currentUid, importItem).catch((err) => {
            console.warn('[history] Auto-save imported mocktest failed:', err);
          });

          alert(`✨ Successfully imported and standardized ${standardized.length} MCQs!\n\nAll bare text fields have been formatted and saved to your Account History.`);
        } else {
          alert('Could not parse any MCQs from this file. Verify format (CSV, TSV, or JSON).');
        }
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  // Standardize 100% consistent <p>...</p> wrappers & standard MathJax \(...\) syntax across all loaded questions
  const handleStandardizeMathJaxAndHtml = () => {
    if (extractedMcqs.length === 0) {
      alert('No questions loaded to standardize.');
      return;
    }
    const standardized = extractedMcqs.map(it => standardizeItemHtmlAndMathJax(it, true));
    setExtractedMcqs(standardized);
    setPages(prev => prev.map(p => ({
      ...p,
      items: (p.items || []).map(it => standardizeItemHtmlAndMathJax(it, true))
    })));
    setLiveStatusText(`✨ Standardized MathJax \\(...\\) & <p>...</p> on all ${standardized.length} MCQs!`);
    alert(`✨ Format Standardization Complete!\n\nAll ${standardized.length} questions now have:\n1. 100% consistent <p>...</p> HTML wrapping across all 14 text fields (0 bare text).\n2. Standard MathJax \\(...\\) notation for exponents (y³ → \\(y^3\\)), roots (∛ → \\(\\sqrt[3]{...}\\)), and fractions.`);
  };

  // Deep AI Proofreading
  const handleProofreadAll = async () => {
    if (extractedMcqs.length === 0) {
      alert('No questions loaded to proofread.');
      return;
    }
    setIsProofreading(true);
    try {
      setLiveStatusText('✨ Deep AI Proofreading: Purging exam tags & fixing OCR errors...');
      const cleaned = await proofreadMocktestItems(extractedMcqs, (msg) => {
        setLiveStatusText(msg);
      });
      setExtractedMcqs(cleaned);
      // Sync back to pages
      setPages(prev => prev.map(p => ({
        ...p,
        items: cleaned.filter(it => it.pageId === p.id || it.pageNumber === p.pageNumber)
      })));
      setLiveStatusText(`✓ All ${cleaned.length} questions proofread and cleaned error-free!`);
      alert(`✨ AI Proofreading Complete!\n\nSuccessfully proofread ${cleaned.length} questions. All previous-year exam tags, shifts, dates, and OCR errors have been cleanly eliminated.`);
    } catch (err: any) {
      console.error('Proofreading error:', err);
      setExtractedMcqs(prev => prev.map(cleanMockTestItem));
      alert(`AI proofreading finished with offline sanitizer!`);
    } finally {
      setIsProofreading(false);
    }
  };

  // Clean overzealous math and format ($$) + strip exam tags immediately offline
  const handleCleanAllMath = () => {
    if (extractedMcqs.length === 0) {
      alert('No questions loaded to clean.');
      return;
    }
    const cleaned = extractedMcqs.map(cleanMockTestItem);
    setExtractedMcqs(cleaned);
    setPages(prev => prev.map(p => ({
      ...p,
      items: cleaned.filter(it => it.pageId === p.id || it.pageNumber === p.pageNumber)
    })));
    setLiveStatusText('🧹 Cleaned all exam tags, shift references, and math delimiters!');
    alert('Exam citations, shifts, LaTeX delimiters ($$), percentages, and rupee signs cleaned successfully!');
  };

  // Add question to a specific page
  const handleAddQuestionToPage = (page: PageQueueItem) => {
    const nextNum = extractedMcqs.length + 1;
    const newItem: MockTestMcqItem = {
      id: `mt_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      pageNumber: page.pageNumber,
      pageId: page.id,
      question_r: nextNum,
      question_type: 'MCQ',
      question_hi: '<p>प्रश्न यहाँ लिखें...</p>',
      option1_hi: '<p>विकल्प A</p>',
      option2_hi: '<p>विकल्प B</p>',
      option3_hi: '<p>विकल्प C</p>',
      option4_hi: '<p>विकल्प D</p>',
      option5_hi: '',
      solution_hi: '<p>विस्तृत हल व व्याख्या...</p>',
      question_en: '<p>Enter question text here...</p>',
      option1_en: '<p>Option A</p>',
      option2_en: '<p>Option B</p>',
      option3_en: '<p>Option C</p>',
      option4_en: '<p>Option D</p>',
      option5_en: '',
      solution_en: '<p>Detailed step-by-step proof...</p>',
      answer: answerFormat === 'letters' ? 'A' : '1',
      set_name: setName,
      difficulty_level: difficulty,
      test_date: '',
      test_time: '',
      subject: 'Current Affairs',
      subject_level: 'RRB Level 01 Stage I 2025',
      figure_notes: '',
      correction_notes: '',
      source_pdf: '',
      source_pages: String(page.pageNumber),
      source_question_reference: `Q.${nextNum}`,
      latex_check: 'checked',
      html_check: 'checked',
      answer_check: 'checked',
      solution_check: 'checked',
      hash_figure: '',
      manually_review: 'checked',
      duplicate_statistics: 'Unique within this shift; duplicate check completed.'
    };
    setExtractedMcqs(prev => [...prev, newItem]);
    setPages(prev => prev.map(p => p.id === page.id ? {
      ...p,
      items: [...(p.items || []), newItem],
      mcqCount: (p.items || []).length + 1
    } : p));
    setEditingItemId(newItem.id);
  };

  // Add global question
  const handleAddQuestion = () => {
    const firstPage = pages[0];
    if (firstPage) {
      handleAddQuestionToPage(firstPage);
      return;
    }
    const nextNum = extractedMcqs.length + 1;
    const newItem: MockTestMcqItem = {
      id: `mt_manual_${Date.now()}`,
      question_r: nextNum,
      question_type: 'MCQ',
      question_hi: '<p>प्रश्न यहाँ लिखें...</p>',
      option1_hi: '<p>विकल्प A</p>',
      option2_hi: '<p>विकल्प B</p>',
      option3_hi: '<p>विकल्प C</p>',
      option4_hi: '<p>विकल्प D</p>',
      option5_hi: '',
      solution_hi: '<p>विस्तृत हल व व्याख्या...</p>',
      question_en: '<p>Enter question text here...</p>',
      option1_en: '<p>Option A</p>',
      option2_en: '<p>Option B</p>',
      option3_en: '<p>Option C</p>',
      option4_en: '<p>Option D</p>',
      option5_en: '',
      solution_en: '<p>Detailed step-by-step proof...</p>',
      answer: answerFormat === 'letters' ? 'A' : '1',
      set_name: setName,
      difficulty_level: difficulty,
      test_date: '',
      test_time: '',
      subject: 'Current Affairs',
      subject_level: 'RRB Level 01 Stage I 2025',
      figure_notes: '',
      correction_notes: '',
      source_pdf: '',
      source_pages: '1',
      source_question_reference: `Q.${nextNum}`,
      latex_check: 'checked',
      html_check: 'checked',
      answer_check: 'checked',
      solution_check: 'checked',
      hash_figure: '',
      manually_review: 'checked',
      duplicate_statistics: 'Unique within this shift; duplicate check completed.'
    };
    setExtractedMcqs(prev => [...prev, newItem]);
    setEditingItemId(newItem.id);
  };

  const updateItem = (id: string, updates: Partial<MockTestMcqItem>) => {
    setExtractedMcqs(prev => prev.map(it => it.id === id ? cleanMockTestItem({ ...it, ...updates }) : it));
    setPages(prev => prev.map(p => ({
      ...p,
      items: (p.items || []).map(it => it.id === id ? cleanMockTestItem({ ...it, ...updates }) : it)
    })));
  };

  // Typing in edit mode stores the raw source (no trimming/re-wrapping under the cursor);
  // the item is normalized to clean HTML + LaTeX once editing ends (see effect below).
  const updateItemDraft = (id: string, updates: Partial<MockTestMcqItem>) => {
    setExtractedMcqs(prev => prev.map(it => it.id === id ? { ...it, ...updates } : it));
    setPages(prev => prev.map(p => ({
      ...p,
      items: (p.items || []).map(it => it.id === id ? { ...it, ...updates } : it)
    })));
  };

  const prevEditingItemIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prevId = prevEditingItemIdRef.current;
    prevEditingItemIdRef.current = editingItemId;
    if (prevId && prevId !== editingItemId) updateItem(prevId, {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingItemId]);

  const deleteItem = (id: string) => {
    setExtractedMcqs(prev => prev.filter(it => it.id !== id).map((it, idx) => ({
      ...it,
      question_r: idx + 1
    })));
    setPages(prev => prev.map(p => {
      const nextItems = (p.items || []).filter(it => it.id !== id);
      return {
        ...p,
        items: nextItems,
        mcqCount: nextItems.length
      };
    }));
  };

  // AI LaTeX Repair Modal handlers
  const handleOpenLatexRepair = (item: MockTestMcqItem, targetScope: LatexRepairScope = 'entire_mcq') => {
    setLatexRepairTarget({ item, scope: targetScope });
  };

  const handleApplyLatexRepair = (repairedItem: MockTestMcqItem) => {
    if (!latexRepairTarget) return;
    const original = latexRepairTarget.item;
    saveItemBackup(original);
    updateItem(original.id, repairedItem);
    setUndoToast({ itemId: original.id, questionNum: original.question_r || 1 });
    setLiveStatusText(`✓ Applied LaTeX repair to Q#${original.question_r || 1}!`);
  };

  const handleUndoRepair = (itemId: string) => {
    const previous = restoreItemBackup(itemId);
    if (previous) {
      updateItem(previous.id, previous);
      setLiveStatusText(`↺ Reverted LaTeX repair for Q#${previous.question_r || 1}`);
    }
    setUndoToast(null);
  };

  // Insert question created via AI Quick Add / Screenshot paste
  const handleInsertNewQuestion = (newItem: MockTestMcqItem, targetPageNumber: number) => {
    const targetPage = pages.find(p => p.pageNumber === targetPageNumber) || pages[0];
    const resolvedItem: MockTestMcqItem = {
      ...newItem,
      pageNumber: targetPageNumber,
      pageId: targetPage?.id,
      source_pages: String(targetPageNumber),
      set_name: setName
    };

    setExtractedMcqs(prev => [...prev, resolvedItem]);

    if (targetPage) {
      setPages(prev => prev.map(p => {
        if (p.id === targetPage.id) {
          const nextItems = [...(p.items || []), resolvedItem];
          return {
            ...p,
            items: nextItems,
            mcqCount: nextItems.length,
            status: p.status === 'pending' || p.status === 'error' ? 'ready' : p.status
          };
        }
        return p;
      }));
    }

    setLiveStatusText(`✓ Q#${resolvedItem.question_r} successfully added to Page ${targetPageNumber}!`);
  };

  // Insert or merge questions created via Paste CSV / Missing
  const handlePasteCsvAddItems = (newOrMergedItems: MockTestMcqItem[], targetPageNum?: number) => {
    const targetPage = targetPageNum ? pages.find(p => p.pageNumber === targetPageNum) : undefined;

    const resolvedItems = newOrMergedItems.map(it => {
      // If item is assigned to this target page and lacks proper pageId / source_pages
      if (targetPageNum && (it.pageNumber === targetPageNum || !it.pageNumber)) {
        return {
          ...it,
          pageNumber: targetPageNum,
          pageId: targetPage?.id || it.pageId,
          source_pages: it.source_pages || String(targetPageNum),
          set_name: it.set_name || setName
        };
      }
      return {
        ...it,
        set_name: it.set_name || setName
      };
    });

    setExtractedMcqs(resolvedItems);

    // Sync with pages
    setPages(prevPages => prevPages.map(p => {
      const pQuestions = resolvedItems.filter(it => 
        (it.pageId && it.pageId === p.id) || it.pageNumber === p.pageNumber
      );
      return {
        ...p,
        items: pQuestions,
        mcqCount: pQuestions.length,
        status: pQuestions.length > 0 && (p.status === 'pending' || p.status === 'error') ? 'ready' : p.status
      };
    }));

    setLiveStatusText(
      targetPageNum
        ? `✓ Questions successfully added to Page ${targetPageNum} via CSV paste (${resolvedItems.length} total)!`
        : `✓ Test questions successfully updated via CSV paste (${resolvedItems.length} total)!`
    );

    // Auto-save merged test paper to User Account History
    if (resolvedItems.length > 0) {
      const currentUid = user?.uid || 'guest';
      addMocktestHistoryItem(currentUid, {
        id: 'mock_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        userId: currentUid,
        setName: outputFileName || setName || 'Mock Test Set',
        timestamp: Date.now(),
        questionCount: resolvedItems.length,
        questions: resolvedItems,
      }).catch((err) => {
        console.warn('[history] Auto-save pasted mocktest failed:', err);
      });
    }
  };

  // Single Question AI Repair
  const handleAiRepairSingle = async (item: MockTestMcqItem) => {
    setRepairingId(item.id);
    try {
      setLiveStatusText(`⚡ AI Repairing Q#${item.question_r}: Deducing options, answer & solution...`);
      const repaired = await repairMockTestItemWithAi(item);
      updateItem(item.id, repaired);
      setLiveStatusText(`✓ Q#${item.question_r} successfully repaired and completed!`);
    } catch (err: any) {
      alert(`AI Repair failed for Q#${item.question_r}: ${err.message || err}`);
    } finally {
      setRepairingId(null);
    }
  };

  // Bulk Repair for questions on a single page
  const handleAiRepairPageItems = async (pageItems: MockTestMcqItem[]) => {
    const targets = pageItems.filter(it => detectItemFieldIssues(it).hasIssues);
    if (targets.length === 0) {
      alert('All questions on this page are already complete!');
      return;
    }
    setIsRepairingAll(true);
    try {
      for (let i = 0; i < targets.length; i++) {
        const item = targets[i];
        setRepairingId(item.id);
        setLiveStatusText(`AI Repairing Q#${item.question_r} (${i + 1}/${targets.length})...`);
        try {
          const repaired = await repairMockTestItemWithAi(item);
          updateItem(item.id, repaired);
        } catch (e) {
          console.warn(`Repair failed for Q#${item.question_r}:`, e);
        }
        await new Promise(r => setTimeout(r, 400));
      }
      setLiveStatusText(`✓ Page questions repaired successfully!`);
    } finally {
      setIsRepairingAll(false);
      setRepairingId(null);
    }
  };

  // Bulk Repair All Incomplete Questions across the document
  const handleAiRepairAllIncomplete = async () => {
    const incompleteItems = extractedMcqs.filter(it => detectItemFieldIssues(it).hasIssues);
    if (incompleteItems.length === 0) {
      alert('All questions already have complete options and detailed solutions!');
      return;
    }

    setIsRepairingAll(true);
    setRepairProgress({ current: 0, total: incompleteItems.length });
    setLiveStatusText(`⚡ AI Auto-Repairing ${incompleteItems.length} incomplete questions...`);

    try {
      for (let i = 0; i < incompleteItems.length; i++) {
        const item = incompleteItems[i];
        setRepairProgress({ current: i + 1, total: incompleteItems.length });
        setRepairingId(item.id);
        setLiveStatusText(`Repairing Q#${item.question_r} (${i + 1}/${incompleteItems.length})...`);
        try {
          const repaired = await repairMockTestItemWithAi(item);
          updateItem(item.id, repaired);
        } catch (e) {
          console.warn(`Repair failed for Q#${item.question_r}:`, e);
        }
        await new Promise(r => setTimeout(r, 400));
      }
      setLiveStatusText(`✓ All ${incompleteItems.length} questions successfully repaired!`);
      alert(`✨ AI Repair Complete!\n\nSuccessfully checked and repaired ${incompleteItems.length} questions. Missing options and pedagogical solutions have been generated.`);
    } finally {
      setIsRepairingAll(false);
      setRepairingId(null);
      setRepairProgress(null);
    }
  };

  // Jump to specific page card with animated pulse highlight
  const scrollToPageCard = (pageNumber: number) => {
    const doScroll = () => {
      const el = document.getElementById(`page-card-${pageNumber}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('ring-4', 'ring-amber-400', 'shadow-[0_0_35px_rgba(245,158,11,0.6)]', 'transition-all', 'duration-300');
        setTimeout(() => {
          el.classList.remove('ring-4', 'ring-amber-400', 'shadow-[0_0_35px_rgba(245,158,11,0.6)]');
        }, 2500);
      }
    };

    if (activeTab !== 'split') {
      setActiveTab('split');
      setTimeout(doScroll, 120);
    } else {
      doScroll();
    }
  };

  const solvedCount = extractedMcqs.filter(i => (i.solution_hi && i.solution_hi.length > 10) || (i.solution_en && i.solution_en.length > 10)).length;

  return (
    <div className="app-container py-6 space-y-5">
      {/* Page header: title + document actions */}
      <section className="card">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4 p-4 sm:p-5">
          <div className="min-w-0">
            <p className="page-eyebrow mb-1">MCQ extractor</p>
            <h1 className="page-title">Bilingual MockTest MCQ extractor</h1>
            <p className="page-subtitle mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span><strong className="text-ink-2 font-semibold">{pages.length}</strong> pages</span>
              <span aria-hidden="true">·</span>
              <span><strong className="text-ink-2 font-semibold">{extractedMcqs.length}</strong> MCQs</span>
              <span aria-hidden="true">·</span>
              <span><strong className="text-ink-2 font-semibold">{solvedCount}/{extractedMcqs.length}</strong> solved</span>
            </p>
          </div>

          <div className="toolbar">
            {/* Output file name */}
            <label className="input-group w-full sm:w-60" title="Output file name. Rename here before download!">
              <FileText className="w-4 h-4 text-ink-3 shrink-0" />
              <input
                type="text"
                value={outputFileName || setName}
                onChange={(e) => {
                  const val = e.target.value;
                  setOutputFileName(val);
                  setSetName(val);
                  setExtractedMcqs(prev => prev.map(i => ({ ...i, set_name: val })));
                }}
                placeholder="File name"
                aria-label="Output file name"
              />
              <span className="text-xs text-ink-3 font-medium shrink-0">.csv</span>
            </label>

            {/* Add menu */}
            <div className="relative" data-menu-root>
              <button
                type="button"
                onClick={() => toggleMenu('add')}
                aria-haspopup="menu"
                aria-expanded={openMenu === 'add'}
                className="btn btn-secondary"
              >
                <Plus />
                <span>Add</span>
                <ChevronDown className={`transition-transform ${openMenu === 'add' ? 'rotate-180' : ''}`} />
              </button>
              {openMenu === 'add' && (
                <div className="menu right-0 mt-1.5 w-72 animate-fadeIn" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      setOpenMenu(null);
                      setAddQuestionTargetPage(pages.find(p => p.status === 'ready')?.pageNumber || 1);
                      setShowAddQuestionModal(true);
                    }}
                  >
                    <Sparkles />
                    <span>Add question with AI<span className="menu-item-desc">Type, give an AI instruction or paste a screenshot (Ctrl+V)</span></span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      setOpenMenu(null);
                      setPasteCsvTargetPage(undefined);
                      setShowPasteCsvModal(true);
                    }}
                  >
                    <ClipboardPaste />
                    <span>Paste CSV / missing questions<span className="menu-item-desc">Fill gaps or assign pasted rows to pages</span></span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      setOpenMenu(null);
                      handleAddQuestion();
                    }}
                  >
                    <Plus />
                    <span>Blank MCQ row<span className="menu-item-desc">Create an empty question and fill it by hand</span></span>
                  </button>
                  <div className="menu-divider" />
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      setOpenMenu(null);
                      csvImportInputRef.current?.click();
                    }}
                  >
                    <Upload />
                    <span>Import CSV / JSON to edit</span>
                  </button>
                </div>
              )}
              <input
                ref={csvImportInputRef}
                type="file"
                accept=".csv,.json,.tsv,.txt"
                onChange={handleImportCsv}
                className="hidden"
              />
            </div>

            {/* Save set to account history */}
            <button
              type="button"
              onClick={handleSaveSetToHistory}
              disabled={extractedMcqs.length === 0}
              className={`btn btn-secondary ${isSavedToHistory ? 'text-emerald-300 border-emerald-500/40' : ''}`}
              title="Save this question set to your user account history"
            >
              {isSavedToHistory ? <Check /> : <Save />}
              <span>{isSavedToHistory ? 'Saved' : 'Save'}</span>
            </button>

            {/* Export: primary action of the page */}
            <div className="relative" data-menu-root>
              <div className="btn-group">
                <button
                  type="button"
                  onClick={handleDownloadCsv}
                  disabled={extractedMcqs.length === 0}
                  className="btn btn-primary"
                  title="Download standard 34-column CSV for MockTest portal"
                >
                  <Download />
                  <span>Export CSV</span>
                </button>
                <button
                  type="button"
                  onClick={() => toggleMenu('export')}
                  aria-haspopup="menu"
                  aria-expanded={openMenu === 'export'}
                  aria-label="More export options"
                  className="btn btn-primary btn-icon w-8"
                >
                  <ChevronDown className={`transition-transform ${openMenu === 'export' ? 'rotate-180' : ''}`} />
                </button>
              </div>
              {openMenu === 'export' && (
                <div className="menu right-0 mt-1.5 w-72 animate-fadeIn" role="menu">
                  <p className="menu-label">CSV</p>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    disabled={extractedMcqs.length === 0}
                    onClick={() => { setOpenMenu(null); handleDownloadCsv(); }}
                  >
                    <Download />
                    <span>Download 34-column CSV</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    disabled={extractedMcqs.length === 0}
                    onClick={handleCopyCsv}
                  >
                    {copied ? <Check className="!text-emerald-400" /> : <Copy />}
                    <span>{copied ? 'Copied to clipboard' : 'Copy CSV to clipboard'}</span>
                  </button>
                  <div className="menu-divider" />
                  <p className="menu-label">Word document</p>
                  <div className="px-2.5 pb-2">
                    <div className="seg seg-sm w-full" role="group" aria-label="DOCX language">
                      {([['both', 'Hi + En'], ['hi', 'Hindi'], ['en', 'English']] as const).map(([val, label]) => (
                        <button
                          key={val}
                          type="button"
                          aria-pressed={docxLang === val}
                          onClick={() => setDocxLang(val)}
                          className="seg-item flex-1"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    disabled={isGeneratingDocx || extractedMcqs.length === 0}
                    onClick={() => { setOpenMenu(null); handleDownloadDocx(); }}
                  >
                    {isGeneratingDocx ? <Loader2 className="animate-spin" /> : <FileText />}
                    <span>{isGeneratingDocx ? 'Building DOCX…' : 'Download DOCX'}<span className="menu-item-desc">Editable Word file with LaTeX math</span></span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Run settings summary + toggle */}
        <div className="flex flex-wrap items-center gap-2 px-4 sm:px-5 py-2.5 border-t border-line bg-white/[0.015]">
          <span className="text-xs font-semibold text-ink-3 mr-1">Run settings</span>
          {aiEngine === 'bridge' ? (
            <span className={`badge ${bridgeStatus.connected ? 'badge-success' : 'badge-warning'}`}>
              <span className="dot" />
              Bridge · {selectedProvider.charAt(0).toUpperCase() + selectedProvider.slice(1)} · {bridgeStatus.connected ? 'connected' : 'not connected'}
            </span>
          ) : (
            <span className="badge badge-info"><Key /> Direct Gemini API</span>
          )}
          <span className="badge badge-neutral">{extractionMode === 'exact' ? 'Exact PDF' : 'Ref mode (new MCQs)'}</span>
          <span className="badge badge-neutral">
            {aiEngine === 'api' ? `${batchSize} page${batchSize > 1 ? 's' : ''} in parallel` : chatRotation === 0 ? 'Single chat' : `New chat every ${chatRotation}P`}
          </span>
          {autoDeepSolveAll && <span className="badge badge-neutral">Auto-fill all 34 fields</span>}
          <span className="badge badge-neutral">{answerFormat === 'letters' ? 'A–D' : '1–4'} · {difficulty}</span>
          <button
            type="button"
            onClick={() => setShowPaperSettings(!showPaperSettings)}
            aria-expanded={showPaperSettings}
            className="btn btn-ghost btn-sm ml-auto"
          >
            <SlidersHorizontal />
            <span>{showPaperSettings ? 'Hide settings' : 'Change'}</span>
            {showPaperSettings ? <ChevronUp /> : <ChevronDown />}
          </button>
        </div>

        {/* Run settings panel */}
        {showPaperSettings && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-line border-t border-line animate-fadeIn">
            {/* AI engine */}
            <div className="bg-surface p-4 sm:p-5 space-y-4">
              <h2 className="text-sm font-semibold text-ink">AI engine</h2>
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <span className="field-label">Engine</span>
                  <div className="seg" role="group" aria-label="AI engine">
                    <button type="button" aria-pressed={aiEngine === 'bridge'} onClick={() => setAiEngine('bridge')} className="seg-item">
                      <Zap /> Extension bridge
                    </button>
                    <button type="button" aria-pressed={aiEngine === 'api'} onClick={() => setAiEngine('api')} className="seg-item">
                      <Key /> Direct Gemini API
                    </button>
                  </div>
                </div>

                {aiEngine === 'bridge' ? (
                  <div>
                    <span className="field-label">Provider</span>
                    <div className="flex items-center gap-2">
                      <select
                        value={selectedProvider}
                        onChange={(e) => handleProviderChange(e.target.value as AiProvider)}
                        className="select w-44"
                        aria-label="AI provider"
                      >
                        <option value="gemini">Gemini {bridgeStatus.openProviders?.includes('gemini') ? '🟢 (Tab Open)' : ''}</option>
                        <option value="deepseek">DeepSeek {bridgeStatus.openProviders?.includes('deepseek') ? '🟢 (Tab Open)' : ''}</option>
                        <option value="chatgpt">ChatGPT {bridgeStatus.openProviders?.includes('chatgpt') ? '🟢 (Tab Open)' : ''}</option>
                        <option value="claude">Claude {bridgeStatus.openProviders?.includes('claude') ? '🟢 (Tab Open)' : ''}</option>
                      </select>
                      {bridgeStatus.connected ? (
                        <button
                          type="button"
                          onClick={() => setAiEngine('api')}
                          className="btn btn-ghost btn-sm"
                          title="Disconnect Bridge"
                        >
                          Disconnect
                        </button>
                      ) : (
                        <button type="button" onClick={() => setShowConnectModal(true)} className="btn btn-secondary">
                          Connect bridge
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    <span className="field-label">API key</span>
                    <button type="button" onClick={() => setShowSettingsModal(true)} className="btn btn-secondary">
                      <Settings /> Configure key
                    </button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <span className="field-label">Mode</span>
                  <div className="seg" role="group" aria-label="Extraction mode">
                    <button
                      type="button"
                      aria-pressed={extractionMode === 'exact'}
                      onClick={() => setExtractionMode('exact')}
                      className="seg-item"
                      title="Extract exact questions directly as written in the PDF"
                    >
                      <BookOpen /> Exact PDF
                    </button>
                    <button
                      type="button"
                      aria-pressed={extractionMode === 'similar'}
                      onClick={() => setExtractionMode('similar')}
                      className="seg-item"
                      title="PDF questions act strictly as conceptual reference; AI generates brand-new practice MCQs (No duplicates)"
                    >
                      <Sparkles /> Ref mode (new MCQs)
                    </button>
                  </div>
                </div>

                {aiEngine === 'api' ? (
                  <div>
                    <span className="field-label">Parallel batch</span>
                    <div className="seg" role="group" aria-label="Parallel batch size">
                      {[1, 2, 3, 5].map((count) => (
                        <button
                          key={count}
                          type="button"
                          aria-pressed={batchSize === count}
                          onClick={() => setBatchSize(count)}
                          className="seg-item"
                          title={`Process ${count} page(s) simultaneously via Direct API key rotation`}
                        >
                          {count}P
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div>
                    <span className="field-label" title="Extension Bridge browser chat tab me 1-by-1 sequentially page send aur extract karta hai.">New chat every</span>
                    <div className="seg" role="group" aria-label="New chat every N pages">
                      {[2, 3, 5, 10, 0].map((count) => (
                        <button
                          key={count}
                          type="button"
                          aria-pressed={chatRotation === count}
                          onClick={() => setChatRotation(count)}
                          className="seg-item"
                          title={count === 0
                            ? 'Poore document ke liye ek hi chat (lambe run me upload fail ho sakta hai)'
                            : `Har ${count} page ke baad fresh AI chat — upload aur composer reliable rehte hain`}
                        >
                          {count === 0 ? 'Off' : `${count}P`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer select-none" title="Image bhejte hi Question, Options, Answer, Subject, aur Solutions ek sath fill honge">
                <input
                  type="checkbox"
                  checked={autoDeepSolveAll}
                  onChange={(e) => setAutoDeepSolveAll(e.target.checked)}
                  className="mt-0.5 w-4 h-4 cursor-pointer"
                />
                <span className="text-sm text-ink-2">
                  Auto-fill all 34 fields and solutions
                  <span className="block text-xs text-ink-3">Question, options, answer, subject and solutions in one pass</span>
                </span>
              </label>
            </div>

            {/* Paper */}
            <div className="bg-surface p-4 sm:p-5 space-y-4">
              <h2 className="text-sm font-semibold text-ink">Paper</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <span className="field-label">Answer format</span>
                  <div className="seg w-full" role="group" aria-label="Answer format">
                    <button type="button" aria-pressed={answerFormat === 'letters'} onClick={() => setAnswerFormat('letters')} className="seg-item flex-1">
                      Letters (A–D)
                    </button>
                    <button type="button" aria-pressed={answerFormat === 'numbers'} onClick={() => setAnswerFormat('numbers')} className="seg-item flex-1">
                      Numbers (1–4)
                    </button>
                  </div>
                </div>

                <div>
                  <span className="field-label">Math notation</span>
                  <div className="seg w-full" role="group" aria-label="Math notation">
                    <button type="button" aria-pressed={mathFormat === 'mathjax'} onClick={() => setMathFormat('mathjax')} title="LaTeX standard \(...\)" className="seg-item flex-1">
                      LaTeX \(...\)
                    </button>
                    <button type="button" aria-pressed={mathFormat === 'unicode'} onClick={() => setMathFormat('unicode')} title="Plain Unicode and HTML" className="seg-item flex-1">
                      Unicode / HTML
                    </button>
                  </div>
                </div>

                <div>
                  <label className="field-label" htmlFor="mcq-default-difficulty">Default difficulty</label>
                  <select
                    id="mcq-default-difficulty"
                    value={difficulty}
                    onChange={(e) => {
                      const diff = e.target.value as DifficultyLevel;
                      setDifficulty(diff);
                      setExtractedMcqs(prev => prev.map(i => ({ ...i, difficulty_level: diff })));
                    }}
                    className="select"
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Input: upload files or paste text */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="seg" role="tablist" aria-label="Input mode">
            <button
              type="button"
              role="tab"
              aria-selected={inputMode === 'upload'}
              onClick={() => setInputMode('upload')}
              className="seg-item"
            >
              <Upload />
              <span>Upload files</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inputMode === 'direct_text'}
              onClick={() => setInputMode('direct_text')}
              className="seg-item"
            >
              <FileText />
              <span>Paste text</span>
            </button>
          </div>

          {inputMode === 'upload' && (
            <p className="hidden sm:block text-xs text-ink-3">PDF, Word (.docx), TXT / MD and images</p>
          )}
        </div>

        {inputMode === 'upload' ? (
          /* File Upload Dropzone */
          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`relative border border-dashed rounded-[14px] cursor-pointer transition-colors ${
              pages.length === 0
                ? 'border-line-strong bg-surface hover:border-accent/50 hover:bg-surface-2 px-6 py-10 text-center'
                : 'border-line-strong bg-surface hover:border-accent/50 hover:bg-surface-2 px-4 py-3'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.doc,.txt,.md,image/*"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
              className="hidden"
            />

            {pages.length === 0 ? (
              <div className="flex flex-col items-center gap-3">
                <span className="w-12 h-12 rounded-xl flex items-center justify-center bg-accent/10 border border-accent/25 text-accent-light">
                  <Upload className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-ink">Drop your exam paper here</h3>
                  <p className="text-sm text-ink-3 mt-1 max-w-lg">
                    PDF, Word (.docx), text files or photos. Word and text files are read exactly, without OCR errors.
                  </p>
                </div>
                <span className="btn btn-secondary btn-sm mt-1">Browse files</span>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 text-sm text-ink-2">
                <Upload className="w-4 h-4 text-ink-3" />
                <span className="font-medium">Add more files</span>
                <span className="text-ink-3 hidden sm:inline">— drop here or click to browse</span>
              </div>
            )}

            {uploadProgress && (
              <div className="mt-3 max-w-md mx-auto callout callout-info items-center">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span className="font-medium">{uploadProgress.text}</span>
              </div>
            )}
          </div>
        ) : (
          /* Direct Text Input Editor */
          <div className="card p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink">Paste exam text</h3>
                <p className="text-xs text-ink-3">From a PDF, Word document, web page or your notes</p>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                <span className="text-xs font-medium text-ink-3">Split every</span>
                <div className="seg seg-sm" role="group" aria-label="Questions per section">
                  {[5, 10, 15, 20, 50].map((num) => (
                    <button
                      key={num}
                      type="button"
                      aria-pressed={directTextSplitCount === num}
                      onClick={() => setDirectTextSplitCount(num)}
                      className="seg-item"
                      title={`Split text into sections of approximately ${num} questions`}
                    >
                      {num} Qs
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <textarea
              rows={pages.length === 0 ? 9 : 6}
              value={directTextInput}
              onChange={(e) => setDirectTextInput(e.target.value)}
              placeholder="Paste exam questions or question paper text here...

Example:
1. निम्नलिखित में से कौन सी नदी भ्रंश घाटी से होकर बहती है?
(a) नर्मदा
(b) गोदावरी
(c) कृष्णा
(d) महानदी
उत्तर: (a) नर्मदा
व्याख्या: नर्मदा नदी विंध्य और सतपुड़ा पर्वत श्रृंखलाओं के बीच एक भ्रंश घाटी से होकर बहती है।

2. In which year was the Indian National Congress founded?
(A) 1885
(B) 1890
(C) 1905
(D) 1919
Answer: (A) 1885
Explanation: The Indian National Congress was founded in December 1885 at Bombay by Allan Octavian Hume."
              className="textarea font-mono text-[13px] resize-y"
            />

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
                <span><strong className="text-ink-2 font-semibold">{directTextInput.length}</strong> characters</span>
                <span><strong className="text-ink-2 font-semibold">{directTextInput.trim() ? directTextInput.trim().split(/\s+/).length : 0}</strong> words</span>
                {directTextInput.trim() && (
                  <span className="badge badge-success">
                    ~{splitTextIntoDocumentPages(directTextInput, directTextSplitCount || 10).length} section(s)
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 self-end sm:self-auto">
                {directTextInput.trim() && (
                  <button
                    type="button"
                    onClick={() => setDirectTextInput('')}
                    className="btn btn-ghost"
                  >
                    Clear
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => handleAddDirectText(false)}
                  disabled={!directTextInput.trim()}
                  className="btn btn-secondary"
                >
                  <Plus />
                  Add as pages
                </button>

                <button
                  type="button"
                  onClick={() => handleAddDirectText(true)}
                  disabled={!directTextInput.trim()}
                  className="btn btn-primary"
                >
                  <Play />
                  <span>Add and extract</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Main workspace: page image on the left, extracted questions on the right */}
      {pages.length > 0 && (
        <div className="space-y-4">
          {/* Workspace command bar & page filmstrip (sticky under the navbar) */}
          <div className="card sticky top-14 z-30 shadow-[0_8px_24px_rgb(0_0_0/0.35)]">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-3">
              {/* Run control */}
              <div className="toolbar">
                {!isProcessingAll ? (
                  <>
                    <div className="relative" data-menu-root>
                      <div className="btn-group">
                        <button
                          type="button"
                          onClick={() => handleStartExtraction('exact')}
                          className="btn btn-primary"
                          title="Extract exact questions directly as written in the PDF"
                        >
                          <Play />
                          <span>Start extraction</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleMenu('runs')}
                          aria-haspopup="menu"
                          aria-expanded={openMenu === 'runs'}
                          aria-label="More run options"
                          className="btn btn-primary btn-icon w-8"
                        >
                          <ChevronDown className={`transition-transform ${openMenu === 'runs' ? 'rotate-180' : ''}`} />
                        </button>
                      </div>
                      {openMenu === 'runs' && (
                        <div className="menu left-0 mt-1.5 w-80 animate-fadeIn" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            className="menu-item"
                            onClick={() => { setOpenMenu(null); handleStartExtraction('similar'); }}
                            title="PDF questions act strictly as conceptual reference/blueprint. Generates brand-new similar MCQs (strictly no verbatim duplicates)!"
                          >
                            <Sparkles />
                            <span>Generate similar MCQs (ref mode)<span className="menu-item-desc">Use pages as reference and create brand-new questions</span></span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="menu-item"
                            onClick={() => { setOpenMenu(null); handleReExtractAll(extractionMode); }}
                          >
                            <RotateCw />
                            <span>Re-run all pages<span className="menu-item-desc">Extract every page again from scratch ({extractionMode === 'exact' ? 'exact PDF' : 'ref mode'})</span></span>
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setIsPaused(!isPaused)}
                      className="btn btn-secondary"
                    >
                      {isPaused ? <Play /> : <Pause />}
                      <span>{isPaused ? 'Resume' : 'Pause'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleStopAll}
                      className="btn btn-danger-solid"
                      title="Stop all running extractions"
                    >
                      <Square className="fill-current" />
                      <span>Stop all</span>
                    </button>
                  </>
                )}

                {/* Status / selection */}
                {liveStatusText ? (
                  <span className={`badge h-7 max-w-[18rem] sm:max-w-md ${isProcessingAll ? 'badge-accent' : 'badge-neutral'}`} role="status">
                    {isProcessingAll ? <Loader2 className="animate-spin" /> : <span className="dot text-ink-3" />}
                    <span className="truncate">{liveStatusText}</span>
                  </span>
                ) : (
                  <div className="flex items-center gap-1 text-xs text-ink-3">
                    <button
                      type="button"
                      onClick={() => {
                        const allSelected = pages.every(p => p.isSelected);
                        setPages(prev => prev.map(p => ({ ...p, isSelected: !allSelected })));
                      }}
                      className="btn btn-ghost btn-xs"
                    >
                      {pages.every(p => p.isSelected) ? 'Deselect all' : 'Select all'}
                    </button>
                    <span>{pages.filter(p => p.isSelected).length}/{pages.length} selected</span>
                  </div>
                )}
              </div>

              <div className="toolbar justify-between lg:justify-end">
                {/* View switcher */}
                <div className="seg" role="tablist" aria-label="View">
                  <button type="button" role="tab" aria-selected={activeTab === 'split'} onClick={() => setActiveTab('split')} className="seg-item">
                    <BookOpen />
                    <span>Split</span>
                  </button>
                  <button type="button" role="tab" aria-selected={activeTab === 'grid'} onClick={() => setActiveTab('grid')} className="seg-item">
                    <FileSpreadsheet />
                    <span>Grid</span>
                  </button>
                  <button type="button" role="tab" aria-selected={activeTab === 'csv'} onClick={() => setActiveTab('csv')} className="seg-item">
                    <Copy />
                    <span>Raw CSV</span>
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  {/* AI tools */}
                  <div className="relative" ref={aiToolsRef}>
                    <button
                      type="button"
                      onClick={() => setShowAiToolsMenu(!showAiToolsMenu)}
                      aria-haspopup="menu"
                      aria-expanded={showAiToolsMenu}
                      className="btn btn-secondary"
                    >
                      {isSolvingAll || isProofreading ? <Loader2 className="animate-spin" /> : <Sparkles />}
                      <span>AI tools</span>
                      <ChevronDown className={`transition-transform ${showAiToolsMenu ? 'rotate-180' : ''}`} />
                    </button>

                    {showAiToolsMenu && (
                      <div className="menu right-0 mt-1.5 w-80 animate-fadeIn" role="menu">
                        <p className="menu-label">Generate</p>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => { setShowAiToolsMenu(false); handleGenerateSimilarFromCurrentMcqs(); }}
                          disabled={isGeneratingSimilarBatch || extractedMcqs.length === 0}
                          className="menu-item"
                        >
                          <Sparkles />
                          <span>Generate similar set<span className="menu-item-desc">Brand-new practice MCQs using current items as reference</span></span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => { setShowAiToolsMenu(false); handleAutoSolveAll(); }}
                          disabled={isSolvingAll || extractedMcqs.length === 0}
                          className="menu-item"
                        >
                          <CheckCheck />
                          <span>Auto-solve all<span className="menu-item-desc">Deep bilingual solutions for every MCQ</span></span>
                        </button>
                        <div className="menu-divider" />
                        <p className="menu-label">Clean up</p>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => { setShowAiToolsMenu(false); handleProofreadAll(); }}
                          disabled={isProofreading || extractedMcqs.length === 0}
                          className="menu-item"
                        >
                          <Eye />
                          <span>AI proofread (clean tags)<span className="menu-item-desc">Validate HTML tags and fix OCR anomalies</span></span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => { setShowAiToolsMenu(false); handleStandardizeMathJaxAndHtml(); }}
                          disabled={extractedMcqs.length === 0}
                          className="menu-item"
                        >
                          <FileText />
                          <span>Fix MathJax + &lt;p&gt;<span className="menu-item-desc">Standardize all 14 fields with &lt;p&gt; and \(...\)</span></span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => { setShowAiToolsMenu(false); handleCleanAllMath(); }}
                          disabled={extractedMcqs.length === 0}
                          className="menu-item"
                        >
                          <RefreshCw />
                          <span>Clean tags and math<span className="menu-item-desc">Sanitize raw symbols and formatting glitches</span></span>
                        </button>
                        <div className="menu-divider" />
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => { setShowAiToolsMenu(false); handleRecaptureFullChat(); }}
                          disabled={isProcessingAll}
                          className="menu-item"
                        >
                          <Camera />
                          <span>Recapture all from chat<span className="menu-item-desc">Re-read the complete AI conversation for this document</span></span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Overflow */}
                  <div className="relative" data-menu-root>
                    <button
                      type="button"
                      onClick={() => toggleMenu('more')}
                      aria-haspopup="menu"
                      aria-expanded={openMenu === 'more'}
                      aria-label="More actions"
                      title="More actions"
                      className="btn btn-ghost btn-icon"
                    >
                      <MoreHorizontal />
                    </button>
                    {openMenu === 'more' && (
                      <div className="menu right-0 mt-1.5 w-60 animate-fadeIn" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          className="menu-item menu-item-danger"
                          disabled={isProcessingAll}
                          onClick={() => {
                            setOpenMenu(null);
                            if (confirm('Clear all pages and questions?')) {
                              setPages([]);
                              setExtractedMcqs([]);
                            }
                          }}
                        >
                          <Trash2 />
                          <span>Clear all pages and questions</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Page filmstrip with problem indicators */}
            {(() => {
              const pagesWithIssues = pages.filter(p => {
                if (p.status === 'error' || Boolean(p.errorMessage)) return true;
                const pageQuestions = (p.items && p.items.length > 0)
                  ? p.items
                  : extractedMcqs.filter(m => m.pageNumber === p.pageNumber || m.pageId === p.id);
                return pageQuestions.some(it => detectItemFieldIssues(it).hasIssues);
              });

              return (
                <div className="px-3 py-2 border-t border-line flex items-center gap-2 overflow-x-auto">
                  <span className="text-xs font-semibold text-ink-3 shrink-0">Pages</span>
                  {pagesWithIssues.length > 0 && (
                    <button
                      type="button"
                      onClick={() => scrollToPageCard(pagesWithIssues[0].pageNumber)}
                      className="badge badge-warning h-6 cursor-pointer hover:bg-amber-500/20 shrink-0"
                      title="Jump to the first page with missing or incomplete fields"
                    >
                      <AlertTriangle />
                      <span>{pagesWithIssues.length} need fixes</span>
                    </button>
                  )}

                  <div className="flex items-center gap-1 shrink-0">
                    {pages.map((p) => {
                      const pageQuestions = (p.items && p.items.length > 0)
                        ? p.items
                        : extractedMcqs.filter(m => m.pageNumber === p.pageNumber || m.pageId === p.id);
                      const count = pageQuestions.length;
                      const isError = p.status === 'error' || Boolean(p.errorMessage);
                      const problemCount = pageQuestions.filter(it => detectItemFieldIssues(it).hasIssues).length;
                      const hasIncomplete = p.status === 'ready' && problemCount > 0;

                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => scrollToPageCard(p.pageNumber)}
                          title={
                            isError
                              ? `Page ${p.pageNumber}: Error processing page! Click to jump & inspect.`
                              : hasIncomplete
                              ? `Page ${p.pageNumber}: ${problemCount} of ${count} question(s) have incomplete/missing fields. Click to jump.`
                              : p.status === 'ready'
                              ? `Page ${p.pageNumber}: All ${count} questions complete.`
                              : `Page ${p.pageNumber}`
                          }
                          className={`h-6 px-2 rounded-md text-xs font-semibold shrink-0 border transition-colors flex items-center gap-1 ${
                            p.status === 'processing'
                              ? 'bg-accent/10 border-accent/40 text-accent-light'
                              : isError
                              ? 'bg-rose-500/10 border-rose-500/40 text-rose-300 hover:bg-rose-500/20'
                              : hasIncomplete
                              ? 'bg-amber-500/10 border-amber-500/40 text-amber-300 hover:bg-amber-500/20'
                              : p.status === 'ready'
                              ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/20'
                              : 'bg-transparent border-line-strong text-ink-3 hover:text-ink hover:bg-white/[0.04]'
                          }`}
                        >
                          {p.status === 'processing' ? (
                            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                          ) : isError ? (
                            <AlertCircle className="w-3 h-3 shrink-0" />
                          ) : hasIncomplete ? (
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                          ) : null}
                          <span>P{p.pageNumber}</span>
                          {count > 0 && (
                            <span className="opacity-75 font-medium">
                              · {count}{hasIncomplete && ` (${problemCount})`}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* TAB 1: SPLIT VIEW (TextExtract Style: Left Page Thumbnail | Right Questions) */}
          {activeTab === 'split' && (
            <div className="space-y-6">
              {pages.map((page, idx) => {
                // Find all MCQs belonging to this page
                const pageQuestions = (page.items && page.items.length > 0)
                  ? page.items
                  : extractedMcqs.filter(m => m.pageId === page.id || m.pageNumber === page.pageNumber);

                return (
                  <div
                    key={page.id}
                    id={`page-card-${page.pageNumber}`}
                    className={`card overflow-hidden flex flex-col lg:flex-row min-h-[380px] scroll-mt-40 transition-colors ${
                      page.isSelected ? 'border-accent/35' : ''
                    }`}
                  >
                    {/* LEFT SIDE: page image and page actions */}
                    <div className="w-full lg:w-[320px] xl:w-[360px] bg-canvas/60 border-b lg:border-b-0 lg:border-r border-line p-4 flex flex-col gap-3 shrink-0">
                      {/* Page header */}
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-2 cursor-pointer select-none" title="Include this page in batch runs">
                          <input
                            type="checkbox"
                            checked={!!page.isSelected}
                            onChange={() => togglePageSelection(page.id)}
                            className="w-4 h-4 cursor-pointer"
                          />
                          <span className="text-sm font-semibold text-ink">Page {page.pageNumber}</span>
                        </label>

                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          {page.status === 'processing' && (
                            <span className="badge badge-accent">
                              <Loader2 className="animate-spin" /> Extracting…
                            </span>
                          )}
                          {page.status === 'ready' && (() => {
                            const issueCount = pageQuestions.filter(q => detectItemFieldIssues(q).hasIssues).length;
                            return (
                              <>
                                {issueCount > 0 && (
                                  <span
                                    className="badge badge-warning"
                                    title={`${issueCount} of ${pageQuestions.length} question(s) have missing or incomplete fields`}
                                  >
                                    <AlertTriangle /> {issueCount} need fix
                                  </span>
                                )}
                                <span className="badge badge-success">
                                  <CheckCircle2 /> {pageQuestions.length} MCQs
                                </span>
                              </>
                            );
                          })()}
                          {page.status === 'error' && (
                            <span className="badge badge-danger">
                              <AlertCircle /> Error
                            </span>
                          )}
                          {page.status === 'pending' && (
                            <span className="badge badge-neutral">Pending</span>
                          )}
                        </div>
                      </div>

                      {/* Page preview (image or text / DOCX section) */}
                      {page.imageUrl ? (
                        <button
                          type="button"
                          className="relative group rounded-[10px] overflow-hidden border border-line bg-white/[0.03] aspect-[3/4] max-h-[400px] w-full flex items-center justify-center"
                          onClick={() => { setZoomPageIndex(idx); setIsFigureCropMode(false); }}
                          title="Open full-size page"
                        >
                          <img
                            src={page.imageUrl}
                            alt={`Page ${page.pageNumber}`}
                            className="w-full h-full object-contain"
                          />
                          <span className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 flex items-center justify-center gap-2 text-sm font-semibold text-white transition-opacity">
                            <ZoomIn className="w-5 h-5" />
                            Open full size
                          </span>
                        </button>
                      ) : (
                        <div className="rounded-[10px] overflow-hidden border border-line bg-canvas p-3 aspect-[3/4] max-h-[400px] flex flex-col">
                          <div className="flex items-center justify-between pb-2 border-b border-line text-xs">
                            <span className="font-semibold text-ink-2 flex items-center gap-1.5">
                              <FileText className="w-3.5 h-3.5 text-ink-3" />
                              <span>{page.sourceType === 'docx' ? 'Word DOCX' : 'Direct text'}</span>
                            </span>
                            <span className="text-ink-3">
                              {page.rawTextContent ? `${page.rawTextContent.length} chars` : ''}
                            </span>
                          </div>
                          <div className="flex-1 my-2 overflow-y-auto font-mono text-xs text-ink-2 leading-relaxed whitespace-pre-wrap select-text">
                            {page.rawTextContent || 'No text content available'}
                          </div>
                          <div className="pt-2 border-t border-line flex items-center justify-between gap-2 text-xs">
                            <span className="text-ink-3 truncate" title={page.fileName}>
                              {page.fileName || `Section ${page.pageNumber}`}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (page.rawTextContent) {
                                  navigator.clipboard.writeText(page.rawTextContent);
                                  alert('Copied section text to clipboard!');
                                }
                              }}
                              className="btn btn-ghost btn-xs"
                            >
                              <Copy />
                              <span>Copy</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Page actions */}
                      <div className="flex items-center gap-1 flex-wrap">
                        {page.status === 'processing' ? (
                          <button
                            type="button"
                            onClick={() => handleStopPage(page.id)}
                            className="btn btn-danger-solid btn-sm"
                            title={`Stop extraction for Page ${page.pageNumber}`}
                          >
                            <Square className="fill-current" />
                            <span>Stop</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleRetryPage(page, idx, 'exact')}
                            className="btn btn-secondary btn-sm"
                            title="Extract exact questions from this page"
                          >
                            <RotateCw />
                            <span>{page.status === 'pending' ? 'Extract' : 'Re-extract'}</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            if (activePastePageId === page.id) {
                              setActivePastePageId(null);
                            } else {
                              setActivePastePageId(page.id);
                            }
                            setPasteInputText('');
                            setPasteError(null);
                          }}
                          disabled={page.status === 'processing'}
                          aria-expanded={activePastePageId === page.id}
                          className={`btn btn-secondary btn-sm ${activePastePageId === page.id ? 'border-accent/50 text-accent-light' : ''}`}
                          title="Paste CSV rows, Excel table, or JSON directly for this page"
                        >
                          <ClipboardPaste />
                          <span>Paste</span>
                        </button>

                        <span className="flex-1" />

                        <button
                          type="button"
                          onClick={() => handleCopyPageImage(page)}
                          className="btn btn-ghost btn-sm btn-icon"
                          title={`Copy Page ${page.pageNumber} image to paste (Ctrl+V) in ChatGPT / Claude`}
                          aria-label="Copy page image"
                        >
                          {copiedImagePageId === page.id ? <Check className="text-emerald-400" /> : <ImageIcon />}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCopyPagePrompt(page)}
                          className="btn btn-ghost btn-sm btn-icon"
                          title="Copy ready-to-use CSV prompt for ChatGPT / Claude"
                          aria-label="Copy CSV prompt"
                        >
                          {copiedPromptPageId === page.id ? <Check className="text-emerald-400" /> : <Clipboard />}
                        </button>

                        <div className="relative" data-menu-root>
                          <button
                            type="button"
                            onClick={() => toggleMenu(`page:${page.id}`)}
                            aria-haspopup="menu"
                            aria-expanded={openMenu === `page:${page.id}`}
                            aria-label={`More actions for page ${page.pageNumber}`}
                            title="More page actions"
                            className="btn btn-ghost btn-sm btn-icon"
                          >
                            <MoreHorizontal />
                          </button>
                          {openMenu === `page:${page.id}` && (
                            <div className="menu right-0 bottom-full mb-1.5 w-72 animate-fadeIn" role="menu">
                              <button
                                type="button"
                                role="menuitem"
                                className="menu-item"
                                disabled={page.status === 'processing'}
                                onClick={() => { setOpenMenu(null); handleRetryPage(page, idx, 'similar'); }}
                                title="Use this page strictly as conceptual reference and generate brand-new practice MCQs"
                              >
                                <Sparkles />
                                <span>Generate similar MCQs<span className="menu-item-desc">New questions using this page as reference</span></span>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="menu-item"
                                disabled={page.status === 'processing'}
                                onClick={() => { setOpenMenu(null); handleRecaptureFromAiTab(page); }}
                              >
                                <Camera />
                                <span>Recapture from AI tab<span className="menu-item-desc">Re-read the finished response if it was cut off</span></span>
                              </button>
                              {page.imageUrl && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="menu-item"
                                  onClick={() => {
                                    setOpenMenu(null);
                                    setZoomPageIndex(idx);
                                    setIsFigureCropMode(true);
                                    const firstQ = pageQuestions[0];
                                    if (firstQ) setSelectedTargetQuestionId(firstQ.id);
                                  }}
                                >
                                  <Scissors />
                                  <span>Crop figures</span>
                                </button>
                              )}
                              <div className="menu-divider" />
                              <button
                                type="button"
                                role="menuitem"
                                className="menu-item menu-item-danger"
                                disabled={page.status === 'processing'}
                                onClick={() => { setOpenMenu(null); handleDeletePage(page.id); }}
                              >
                                <Trash2 />
                                <span>Delete page</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Inline Manual Paste CSV / JSON Drawer directly below page */}
                      {activePastePageId === page.id && (
                        <div className="panel p-3 space-y-2.5 animate-fadeIn">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                              <FileSpreadsheet className="w-4 h-4 text-ink-3" />
                              <span>Paste CSV / table / JSON</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => { setActivePastePageId(null); setPasteInputText(''); setPasteError(null); }}
                              className="btn btn-ghost btn-xs btn-icon"
                              title="Close"
                              aria-label="Close paste panel"
                            >
                              <X />
                            </button>
                          </div>

                          <p className="text-xs text-ink-3 leading-snug">
                            DeepSeek, ChatGPT, Excel ya kahi se bhi Page {page.pageNumber} ke CSV rows ya JSON yaha paste karein:
                          </p>

                          <textarea
                            value={pasteInputText}
                            onChange={(e) => { setPasteInputText(e.target.value); setPasteError(null); }}
                            placeholder={`Example CSV format:\nquestion_hi,option1_hi,option2_hi,option3_hi,option4_hi,answer,solution_hi\n"भारत की राजधानी?","मुंबई","दिल्ली","कोलकाता","चेन्नई","B","दिल्ली भारत की राजधानी है"`}
                            rows={5}
                            className="textarea font-mono text-xs resize-y"
                          />

                          {pasteError && (
                            <div className="callout callout-danger items-center text-xs">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                              <span>{pasteError}</span>
                            </div>
                          )}

                          <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  const clipText = await navigator.clipboard.readText();
                                  if (clipText && clipText.trim()) {
                                    setPasteInputText(clipText.trim());
                                    setPasteError(null);
                                  } else {
                                    setPasteError('Clipboard is empty.');
                                  }
                                } catch (e) {
                                  setPasteError('Could not read clipboard. Please paste manually (Ctrl+V).');
                                }
                              }}
                              className="btn btn-ghost btn-sm"
                              title="Paste directly from clipboard"
                            >
                              <Clipboard />
                              <span>From clipboard</span>
                            </button>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => { setActivePastePageId(null); setPasteInputText(''); setPasteError(null); }}
                                className="btn btn-ghost btn-sm"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleImportPastedContentForPage(page, pasteInputText)}
                                disabled={!pasteInputText.trim()}
                                className="btn btn-primary btn-sm"
                              >
                                <Check />
                                <span>Import</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* RIGHT SIDE: extracted questions for this page */}
                    <div className="flex-1 min-w-0 flex flex-col p-4 gap-4">
                      {/* Panel header */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-line">
                        {(() => {
                          const pageIncompleteCount = pageQuestions.filter(it => detectItemFieldIssues(it).hasIssues).length;
                          return (
                            <>
                              <div className="flex items-center gap-2">
                                <h3 className="text-sm font-semibold text-ink">Questions</h3>
                                <span className="badge badge-neutral">{pageQuestions.length}</span>
                                {pageIncompleteCount > 0 && (
                                  <span className="badge badge-warning">
                                    <AlertTriangle />
                                    <span>{pageIncompleteCount} incomplete</span>
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5">
                                {pageIncompleteCount > 0 && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleReverifyMissingFields(pageQuestions.filter(it => detectItemFieldIssues(it).hasIssues))}
                                      disabled={isRepairingAll}
                                      className="btn btn-secondary btn-sm"
                                      title="Visually re-inspect page images to recover missing fields"
                                    >
                                      <Eye />
                                      <span>Re-verify ({pageIncompleteCount})</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleAiRepairPageItems(pageQuestions)}
                                      disabled={isRepairingAll}
                                      className="btn btn-primary btn-sm"
                                      title="Auto-fill missing options & solutions for incomplete questions on this page"
                                    >
                                      <Sparkles />
                                      <span>AI fill ({pageIncompleteCount})</span>
                                    </button>
                                  </>
                                )}
                                <div className="relative" data-menu-root>
                                  <button
                                    type="button"
                                    onClick={() => toggleMenu(`pageadd:${page.id}`)}
                                    aria-haspopup="menu"
                                    aria-expanded={openMenu === `pageadd:${page.id}`}
                                    className="btn btn-ghost btn-sm"
                                  >
                                    <Plus />
                                    <span>Add</span>
                                    <ChevronDown />
                                  </button>
                                  {openMenu === `pageadd:${page.id}` && (
                                    <div className="menu right-0 mt-1.5 w-72 animate-fadeIn" role="menu">
                                      <button
                                        type="button"
                                        role="menuitem"
                                        className="menu-item"
                                        onClick={() => {
                                          setOpenMenu(null);
                                          setAddQuestionTargetPage(page.pageNumber);
                                          setShowAddQuestionModal(true);
                                        }}
                                      >
                                        <Sparkles />
                                        <span>Add with AI / screenshot<span className="menu-item-desc">Text prompt or paste a screenshot (Ctrl+V)</span></span>
                                      </button>
                                      <button
                                        type="button"
                                        role="menuitem"
                                        className="menu-item"
                                        onClick={() => {
                                          setOpenMenu(null);
                                          setPasteCsvTargetPage(page.pageNumber);
                                          setShowPasteCsvModal(true);
                                        }}
                                      >
                                        <ClipboardPaste />
                                        <span>Paste CSV to page {page.pageNumber}</span>
                                      </button>
                                      <button
                                        type="button"
                                        role="menuitem"
                                        className="menu-item"
                                        onClick={() => { setOpenMenu(null); handleAddQuestionToPage(page); }}
                                      >
                                        <Plus />
                                        <span>Blank question</span>
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </>
                          );
                        })()}
                      </div>

                      {/* Content area by status */}
                      {page.status === 'processing' && (
                        <div className="py-16 flex flex-col items-center justify-center text-center gap-3" role="status">
                          <Loader2 className="w-8 h-8 text-accent animate-spin" />
                          <div className="space-y-1 max-w-sm">
                            <p className="text-sm font-semibold text-ink">Extracting bilingual MCQs…</p>
                            <p className="text-sm text-ink-3">
                              {page.errorMessage || 'Reading questions, options and step-by-step solutions.'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleStopPage(page.id)}
                            className="btn btn-secondary btn-sm mt-1"
                            title={`Stop extracting Page ${page.pageNumber}`}
                          >
                            <Square className="fill-current" />
                            <span>Stop extraction</span>
                          </button>
                        </div>
                      )}

                      {page.status === 'pending' && (
                        <div className="py-16 text-center flex flex-col items-center gap-2">
                          <BookOpen className="w-8 h-8 text-ink-3" />
                          <p className="text-sm font-semibold text-ink-2">Waiting in queue</p>
                          <p className="text-sm text-ink-3 max-w-sm">
                            Use “Start extraction” above, or “Extract” on the left to run just this page.
                          </p>
                        </div>
                      )}

                      {page.status === 'error' && (
                        <div className="callout callout-danger flex-col gap-3 p-4">
                          <div className="flex items-center gap-2 font-semibold text-sm">
                            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                            <span>Couldn’t extract this page</span>
                          </div>
                          <p className="text-sm text-rose-200/90 leading-relaxed">{page.errorMessage || 'Failed to extract this page.'}</p>

                          {page.errorMessage?.includes('timed out') ? (
                            <div className="callout callout-warning flex-col gap-1">
                              <p className="font-semibold flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                <span>AI browser tab timeout (extension bridge)</span>
                              </p>
                              <p className="text-ink-2">
                                1. Agar Chrome me AI tab (Gemini/ChatGPT/DeepSeek) ne likhna pura kar liya hai, to <strong>"Recapture"</strong> dabayein.<br/>
                                2. Ya fir bina extension/timeout ke fast server processing ke liye <strong>"Direct API"</strong> se extract karein.
                              </p>
                            </div>
                          ) : null}

                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => handleRetryPage(page, idx)}
                              className="btn btn-primary btn-sm"
                            >
                              <RotateCw />
                              Retry extraction
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRecaptureFromAiTab(page)}
                              className="btn btn-secondary btn-sm"
                              title="Read response from open AI tab in Chrome"
                            >
                              <Camera />
                              <span>Recapture from AI tab</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAiEngine('api');
                                setTimeout(() => handleRetryPage(page, idx, 'exact'), 50);
                              }}
                              className="btn btn-secondary btn-sm"
                              title="Switch to direct server Gemini API (fast, no browser tab needed)"
                            >
                              <Zap />
                              <span>Retry with direct API</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {page.status === 'ready' && pageQuestions.length === 0 && (
                        <div className="py-12 text-center flex flex-col items-center gap-2">
                          <AlertCircle className="w-7 h-7 text-ink-3" />
                          <p className="text-sm font-semibold text-ink-2">No questions found on page {page.pageNumber}</p>
                          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => {
                                setPasteCsvTargetPage(page.pageNumber);
                                setShowPasteCsvModal(true);
                              }}
                              className="btn btn-secondary btn-sm"
                              title={`Paste CSV data or missing questions into Page ${page.pageNumber}`}
                            >
                              <ClipboardPaste />
                              <span>Paste CSV</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAddQuestionTargetPage(page.pageNumber);
                                setShowAddQuestionModal(true);
                              }}
                              className="btn btn-secondary btn-sm"
                            >
                              <Sparkles />
                              <span>Add with AI / screenshot</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAddQuestionToPage(page)}
                              className="btn btn-ghost btn-sm"
                            >
                              <Plus />
                              Blank
                            </button>
                          </div>
                        </div>
                      )}
                      {/* Questions list for this page */}
                      {pageQuestions.length > 0 && (
                        <div className="space-y-4">
                          {pageQuestions.map((item) => {
                            const isEditing = editingItemId === item.id;
                            const isSolving = solvingId === item.id;
                            const isRepairing = repairingId === item.id;
                            const issues = detectItemFieldIssues(item);
                            const hasPassage = Boolean(item.passage_hi || (item.figure_notes && item.figure_notes.toLowerCase().includes('passage')) || /गद्यांश|काव्यांश|पद्यांश|निर्देश/i.test(item.question_hi));
                            const isRefVariant = Boolean(item.source_question_reference?.includes('Variant') || item.correction_notes?.includes('reference'));
                            const menuId = `q:${item.id}`;

                            return (
                              <article
                                key={item.id}
                                className={`rounded-xl border bg-surface-2/40 transition-colors ${
                                  issues.hasIssues
                                    ? 'border-amber-500/45'
                                    : isEditing
                                    ? 'border-accent/45'
                                    : 'border-line hover:border-line-strong'
                                }`}
                              >
                                {/* Card header */}
                                <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 border-b border-line">
                                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                    <span className="text-sm font-bold text-ink tabular-nums mr-1">Q{item.question_r}</span>

                                    <label className="badge badge-neutral h-7 pr-1 cursor-pointer" title="Subject">
                                      <span className="sr-only">Subject</span>
                                      <select
                                        value={item.subject || 'Current Affairs'}
                                        onChange={(e) => updateItem(item.id, { subject: normalizeStrictSubject(e.target.value) })}
                                        className="bg-transparent text-ink text-xs font-semibold focus:outline-none cursor-pointer max-w-[11rem]"
                                      >
                                        {STANDARD_SUBJECTS.map((s) => (
                                          <option key={s} value={s} className="bg-surface-2 text-ink">{s}</option>
                                        ))}
                                      </select>
                                    </label>

                                    <label className="badge badge-neutral h-7 font-medium" title="Subject level / exam">
                                      <span className="text-ink-3">Level</span>
                                      <input
                                        type="text"
                                        value={item.subject_level || ''}
                                        onChange={(e) => updateItem(item.id, { subject_level: e.target.value })}
                                        placeholder="RRB Level 01 Stage I 2025"
                                        className="bg-transparent text-ink text-xs focus:outline-none w-36 truncate placeholder:text-ink-3/70"
                                      />
                                    </label>

                                    <span className="badge badge-neutral h-7 capitalize">{item.difficulty_level}</span>

                                    {isRefVariant && (
                                      <span className="badge badge-accent h-7">
                                        <Sparkles />
                                        <span>Ref variant</span>
                                      </span>
                                    )}

                                    {hasPassage && (
                                      <span className="badge badge-info h-7" title="This question has a Reading Comprehension / गद्यांश passage attached">
                                        <BookOpen />
                                        <span>गद्यांश · Passage</span>
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-1.5">
                                    <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-3" title="Correct answer">
                                      Ans
                                      <input
                                        type="text"
                                        value={item.answer}
                                        onChange={(e) => updateItem(item.id, { answer: e.target.value })}
                                        className="input input-sm w-12 px-1 text-center font-bold text-emerald-300 border-emerald-500/40"
                                        aria-label="Correct answer"
                                      />
                                    </label>

                                    {issues.hasIssues && (
                                      <button
                                        type="button"
                                        onClick={() => handleAiRepairSingle(item)}
                                        disabled={isRepairing || isSolving}
                                        className="btn btn-primary btn-sm"
                                        title="Auto-fill missing options, deduce answer, and generate solutions"
                                      >
                                        {isRepairing ? <Loader2 className="animate-spin" /> : <Sparkles />}
                                        <span>Auto-fill</span>
                                      </button>
                                    )}

                                    <button
                                      type="button"
                                      onClick={() => setEditingItemId(isEditing ? null : item.id)}
                                      aria-pressed={isEditing}
                                      className={`btn btn-sm ${isEditing ? 'btn-secondary border-accent/50 text-accent-light' : 'btn-secondary'}`}
                                      title="Edit fields"
                                    >
                                      {isEditing ? <Check /> : <Edit3 />}
                                      <span className="hidden sm:inline">{isEditing ? 'Done' : 'Edit'}</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => setActiveChatQuestion(item)}
                                      className="btn btn-ghost btn-sm"
                                      title="Chat with AI to fix, modify, re-calculate, or improve this question"
                                    >
                                      <MessageSquare />
                                      <span className="hidden sm:inline">AI chat</span>
                                    </button>

                                    <div className="relative" data-menu-root>
                                      <button
                                        type="button"
                                        onClick={() => toggleMenu(menuId)}
                                        aria-haspopup="menu"
                                        aria-expanded={openMenu === menuId}
                                        aria-label={`More actions for question ${item.question_r}`}
                                        title="More actions"
                                        className="btn btn-ghost btn-sm btn-icon"
                                      >
                                        {isSolving || isRepairing || generatingSimilarId === item.id ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
                                      </button>
                                      {openMenu === menuId && (
                                        <div className="menu right-0 mt-1.5 w-72 animate-fadeIn" role="menu">
                                          <p className="menu-label">AI</p>
                                          <button
                                            type="button"
                                            role="menuitem"
                                            className="menu-item"
                                            disabled={isSolving || isRepairing}
                                            onClick={() => { setOpenMenu(null); handleSolveSingle(item); }}
                                          >
                                            <CheckCheck />
                                            <span>{item.solution_hi || item.solution_en ? 'Re-solve' : 'Auto-solve'}<span className="menu-item-desc">Deep step-by-step bilingual solution</span></span>
                                          </button>
                                          {!issues.hasIssues && (
                                            <button
                                              type="button"
                                              role="menuitem"
                                              className="menu-item"
                                              disabled={isRepairing || isSolving}
                                              onClick={() => { setOpenMenu(null); handleAiRepairSingle(item); }}
                                            >
                                              <Sparkles />
                                              <span>Repair with AI<span className="menu-item-desc">Fill options, deduce answer, regenerate solutions</span></span>
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            role="menuitem"
                                            className="menu-item"
                                            disabled={isRepairing || isSolving}
                                            onClick={() => { setOpenMenu(null); handleReverifyItem(item); }}
                                          >
                                            <Eye />
                                            <span>Re-verify from page image<span className="menu-item-desc">Recover missing fields without guessing</span></span>
                                          </button>
                                          <button
                                            type="button"
                                            role="menuitem"
                                            className="menu-item"
                                            disabled={generatingSimilarId === item.id || isSolving || isRepairing}
                                            onClick={() => { setOpenMenu(null); handleGenerateSimilarSingleItem(item); }}
                                          >
                                            <Plus />
                                            <span>Similar variant<span className="menu-item-desc">New practice MCQ testing the same concept</span></span>
                                          </button>
                                          <div className="menu-divider" />
                                          <p className="menu-label">Fix LaTeX</p>
                                          <div className="grid grid-cols-2 gap-0.5">
                                            {([
                                              ['entire_mcq', 'Entire MCQ'],
                                              ['question', 'Question'],
                                              ['options', 'Options'],
                                              ['solution', 'Solution'],
                                            ] as const).map(([scope, label]) => (
                                              <button
                                                key={scope}
                                                type="button"
                                                role="menuitem"
                                                className="menu-item py-1.5"
                                                onClick={() => { setOpenMenu(null); handleOpenLatexRepair(item, scope); }}
                                              >
                                                <span>{label}</span>
                                              </button>
                                            ))}
                                          </div>
                                          <div className="menu-divider" />
                                          <button
                                            type="button"
                                            role="menuitem"
                                            className="menu-item menu-item-danger"
                                            onClick={() => { setOpenMenu(null); deleteItem(item.id); }}
                                          >
                                            <Trash2 />
                                            <span>Delete question</span>
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <div className="p-3.5 space-y-3">
                                {/* Missing / blank fields warning */}
                                {issues.hasIssues && (
                                  <div className="callout callout-warning flex-wrap items-start justify-between">
                                    <div className="flex items-start gap-2 min-w-0">
                                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                                      <div className="min-w-0">
                                        <div className="font-semibold text-amber-200">
                                          रिक्त फ़ील्ड · Missing fields
                                        </div>
                                        <div className="text-ink-2 text-xs mt-0.5">
                                          {issues.issueSummary}
                                        </div>
                                        <div className="flex flex-wrap gap-1 mt-1.5">
                                          {issues.missingFieldNames.map((name) => (
                                            <span key={name} className="badge badge-warning">
                                              {name}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 ml-auto">
                                      <button
                                        type="button"
                                        onClick={() => handleReverifyItem(item)}
                                        disabled={isRepairing}
                                        className="btn btn-secondary btn-sm"
                                        title="Inspect original page images to recover missing fields without hallucinating"
                                      >
                                        {isRepairing ? <Loader2 className="animate-spin" /> : <Eye />}
                                        <span>Re-verify from image</span>
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {/* Extra metadata (edit mode) */}
                                {isEditing && (
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 panel p-3">
                                    <div>
                                      <label className="field-label" htmlFor={`test-date-${item.id}`}>Test date</label>
                                      <input
                                        id={`test-date-${item.id}`}
                                        type="text"
                                        value={item.test_date || ''}
                                        onChange={(e) => updateItem(item.id, { test_date: e.target.value })}
                                        placeholder="YYYY-MM-DD"
                                        className="input input-sm"
                                      />
                                    </div>
                                    <div>
                                      <label className="field-label" htmlFor={`test-time-${item.id}`}>Test time</label>
                                      <input
                                        id={`test-time-${item.id}`}
                                        type="text"
                                        value={item.test_time || ''}
                                        onChange={(e) => updateItem(item.id, { test_time: e.target.value })}
                                        placeholder="4:30 PM - 6:00 PM"
                                        className="input input-sm"
                                      />
                                    </div>
                                    <div>
                                      <label className="field-label" htmlFor={`source-pdf-${item.id}`}>Source PDF</label>
                                      <input
                                        id={`source-pdf-${item.id}`}
                                        type="text"
                                        value={item.source_pdf || ''}
                                        onChange={(e) => updateItem(item.id, { source_pdf: e.target.value })}
                                        placeholder="SHIFT 3.pdf"
                                        className="input input-sm"
                                      />
                                    </div>
                                    <div>
                                      <label className="field-label" htmlFor={`source-ref-${item.id}`}>Source ref</label>
                                      <input
                                        id={`source-ref-${item.id}`}
                                        type="text"
                                        value={item.source_question_reference || ''}
                                        onChange={(e) => updateItem(item.id, { source_question_reference: e.target.value })}
                                        placeholder={`Q.${item.question_r}`}
                                        className="input input-sm"
                                      />
                                    </div>
                                  </div>
                                )}
                                {/* Interactive Bilingual Content View */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-5">
                                  {/* HINDI SIDE */}
                                  <div className="space-y-3 min-w-0">
                                    <div className="flex items-center justify-between">
                                      <span className="field-label mb-0 whitespace-nowrap">
                                        हिन्दी · Hindi
                                      </span>
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => handleQuickCropForQuestion(item, 'question')}
                                          className="btn btn-ghost btn-xs"
                                          title="Crop diagram/figure and attach to Question"
                                        >
                                          <Scissors />
                                          <span>Crop figure</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleOpenLatexRepair(item, 'question')}
                                          className="btn btn-ghost btn-xs"
                                          title="Fix LaTeX in Question"
                                        >
                                          <Sparkles />
                                          <span>Fix LaTeX</span>
                                        </button>
                                      </div>
                                    </div>

                                    {isEditing ? (
                                      <HtmlLatexField
                                        rows={3}
                                        value={item.question_hi}
                                        onChange={(v) => updateItemDraft(item.id, { question_hi: v })}
                                      />
                                    ) : (
                                      <>
                                        <LatexRenderer 
                                          content={(item.question_hi || '').replace(/<p>\s*<img[^>]*>\s*<\/p>/gi, '').replace(/<img[^>]*>/gi, '').replace(/!\[[^\]]*\]\([^)]+\)/gi, '').replace(/\[(?:FIGURE|IMAGE|FIG)[^\]]*:\s*[^\s\]]+\]/gi, '').trim()} 
                                          className="text-[15px] leading-relaxed text-ink" 
                                        />
                                        {/* Live Attached Question Diagrams */}
                                        {(() => {
                                          const rawUrls = extractFigureUrls(item.question_hi);
                                          const qFigUrls = rawUrls.length > 0 ? rawUrls : extractFigureUrls(item.question_en);
                                          if (qFigUrls.length === 0) return null;
                                          return (
                                            <div className="mt-2.5 p-2.5 rounded-lg bg-white/[0.03] border border-line space-y-2">
                                              <div className="flex items-center justify-between text-xs font-semibold text-ink-2">
                                                <span className="flex items-center gap-1">
                                                  <ImageIcon className="w-3.5 h-3.5 text-ink-3" />
                                                  <span>Question Diagram ({qFigUrls.length})</span>
                                                </span>
                                                <span className="text-ink-3 text-xs font-normal">Click to zoom</span>
                                              </div>
                                              <div className="flex flex-wrap gap-2 pt-0.5">
                                                {qFigUrls.map((url, uIdx) => (
                                                  <div key={uIdx} className="relative group/qfig rounded-lg bg-white p-1.5 border border-white/20 shadow-md inline-block">
                                                    <img 
                                                      src={url} 
                                                      alt={`Question Figure ${uIdx + 1}`} 
                                                      className="max-h-36 max-w-full object-contain rounded cursor-pointer hover:opacity-90 transition-opacity"
                                                      onClick={() => setPreviewLightboxUrl(url)}
                                                      title="Click to view full size"
                                                    />
                                                    <button
                                                      type="button"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleRemoveFigureFromItem(item.id, 'question', url);
                                                      }}
                                                      className="absolute -top-2 -right-2 w-5 h-5 bg-rose-600 hover:bg-rose-500 text-white rounded-full flex items-center justify-center text-[11px] shadow"
                                                      title="Remove diagram"
                                                    >
                                                      ✕
                                                    </button>
                                                  </div>
                                                ))}
                                              </div>
                                            </div>
                                          );
                                        })()}
                                      </>
                                    )}

                                    {/* Options List */}
                                    <div className="space-y-2 pt-1">
                                      {(['option1_hi', 'option2_hi', 'option3_hi', 'option4_hi'] as const).map((key, optIdx) => {
                                        const optLetter = String.fromCharCode(65 + optIdx);
                                        const optNum = String(optIdx + 1);
                                        const isCorrect = item.answer === optLetter || item.answer === optNum || item.answer?.includes(optLetter) || item.answer?.includes(optNum);
                                        const enKey = `option${optIdx + 1}_en` as keyof MockTestMcqItem;
                                        const rawUrls = extractFigureUrls(item[key]);
                                        const optFigUrls = rawUrls.length > 0 ? rawUrls : extractFigureUrls(item[enKey] as string);
                                        const hasImg = optFigUrls.length > 0 || hasFigureImage(item[key]) || hasFigureImage(item[enKey] as string);
                                        const cleanOptText = (item[key] || '').replace(/<p>\s*<img[^>]*>\s*<\/p>/gi, '').replace(/<img[^>]*>/gi, '').replace(/!\[[^\]]*\]\([^)]+\)/gi, '').replace(/\[(?:FIGURE|IMAGE|FIG)[^\]]*:\s*[^\s\]]+\]/gi, '').trim();
                                        const optPlainText = htmlToPlainText(cleanOptText);
                                        const isBlank = !hasImg && (!optPlainText || optPlainText.toLowerCase() === 'blank');
                                        const targetOptField = `option${optIdx + 1}` as FigureTargetField;

                                        return (
                                          <div
                                            key={key}
                                            className={`group/opt flex flex-col gap-1.5 px-2.5 py-2 rounded-lg border text-sm transition-colors ${
                                              isCorrect
                                                ? 'bg-emerald-500/10 border-emerald-500/45 text-emerald-200'
                                                : isBlank
                                                ? 'bg-amber-500/5 border-dashed border-amber-500/40 text-amber-200'
                                                : 'bg-transparent border-line text-ink-2 hover:border-line-strong'
                                            }`}
                                          >
                                            <div className="flex items-center gap-2">
                                              <span className={`w-6 h-6 shrink-0 rounded-md text-xs font-bold flex items-center justify-center ${
                                                isCorrect ? 'bg-emerald-500 text-black' : isBlank ? 'bg-amber-500/20 text-amber-300' : 'bg-white/[0.06] text-ink-3'
                                              }`}>
                                                {optLetter}
                                              </span>
                                              {isEditing ? (
                                                <HtmlLatexField
                                                  singleLine
                                                  value={item[key] || ''}
                                                  onChange={(v) => updateItemDraft(item.id, { [key]: v })}
                                                  placeholder={`Option ${optLetter}`}
                                                />
                                              ) : (
                                                <span className="flex-1 min-w-0" title={htmlToPlainText(item[key] || '')}>
                                                  {optPlainText ? (
                                                    <LatexRenderer content={cleanOptText} inline={true} className={isCorrect ? 'text-emerald-100 font-semibold' : 'text-ink'} />
                                                  ) : hasImg ? (
                                                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-300/90">
                                                      <ImageIcon className="w-3.5 h-3.5 text-ink-3 shrink-0" />
                                                      <span>Figure Option ({optLetter})</span>
                                                    </span>
                                                  ) : (
                                                    <span className="inline-flex items-center gap-1 text-amber-400/90 font-semibold italic text-[11px]">
                                                      <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                                                      <span>Blank option — use Auto-fill or Crop</span>
                                                    </span>
                                                  )}
                                                </span>
                                              )}
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleQuickCropForQuestion(item, targetOptField);
                                                }}
                                                className="btn btn-ghost btn-xs shrink-0 opacity-50 hover:opacity-100 focus-visible:opacity-100 group-hover/opt:opacity-100"
                                                title={`Crop & attach diagram for Option ${optLetter}`}
                                              >
                                                <Scissors className="w-3 h-3" />
                                                <span className="hidden sm:inline">{hasImg ? 'Re-crop' : 'Crop'}</span>
                                              </button>
                                              {isCorrect && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                                            </div>

                                            {/* Live Image Thumbnail for Option */}
                                            {optFigUrls.length > 0 && (
                                              <div className="flex flex-wrap gap-2 pl-8 pt-0.5">
                                                {optFigUrls.map((url, uIdx) => (
                                                  <div key={uIdx} className="relative group/optfig rounded-lg bg-white p-1 border border-white/20 shadow-md inline-block">
                                                    <img
                                                      src={url}
                                                      alt={`Option ${optLetter} Diagram`}
                                                      className="max-h-20 max-w-[140px] object-contain rounded cursor-pointer hover:scale-105 transition-transform"
                                                      onClick={() => setPreviewLightboxUrl(url)}
                                                      title="Click to view full size"
                                                    />
                                                    <button
                                                      type="button"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleRemoveFigureFromItem(item.id, targetOptField, url);
                                                      }}
                                                      className="absolute -top-2 -right-2 w-5 h-5 bg-rose-600 hover:bg-rose-500 text-white rounded-full flex items-center justify-center text-[11px] shadow"
                                                      title="Remove figure"
                                                    >
                                                      ✕
                                                    </button>
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>

                                    {/* Hindi Solution */}
                                    <div className="pt-3 border-t border-line space-y-2">
                                      <div className="flex items-center justify-between">
                                        <span className="field-label mb-0 whitespace-nowrap">
                                          हल · Solution
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                          <button
                                            type="button"
                                            onClick={() => handleQuickCropForQuestion(item, 'solution')}
                                            className="btn btn-ghost btn-xs"
                                            title="Crop diagram/figure and attach to Hindi Solution"
                                          >
                                            <Scissors />
                                            <span>Crop figure</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleOpenLatexRepair(item, 'solution')}
                                            className="btn btn-ghost btn-xs"
                                            title="Fix LaTeX in Hindi Solution"
                                          >
                                            <Sparkles />
                                            <span>Fix LaTeX</span>
                                          </button>
                                        </div>
                                      </div>
                                      {isEditing ? (
                                        <HtmlLatexField
                                          rows={4}
                                          value={item.solution_hi}
                                          onChange={(v) => updateItemDraft(item.id, { solution_hi: v })}
                                          textClassName="text-ink-2"
                                        />
                                      ) : (
                                        <div className="p-3 rounded-lg bg-white/[0.025] border border-line space-y-2">
                                          <LatexRenderer 
                                            content={(item.solution_hi || '<p>हल उपलब्ध नहीं है</p>').replace(/<p>\s*<img[^>]*>\s*<\/p>/gi, '').replace(/<img[^>]*>/gi, '').replace(/!\[[^\]]*\]\([^)]+\)/gi, '').replace(/\[(?:FIGURE|IMAGE|FIG)[^\]]*:\s*[^\s\]]+\]/gi, '').trim() || '<p>हल उपलब्ध नहीं है</p>'} 
                                            className="text-ink-2 text-sm" 
                                          />
                                          {(() => {
                                            const rawUrls = extractFigureUrls(item.solution_hi);
                                            const solFigUrls = rawUrls.length > 0 ? rawUrls : extractFigureUrls(item.solution_en);
                                            if (solFigUrls.length === 0) return null;
                                            return (
                                              <div className="pt-2 border-t border-line space-y-1.5">
                                                <div className="flex items-center justify-between text-xs font-semibold text-ink-2">
                                                  <span className="flex items-center gap-1">
                                                    <ImageIcon className="w-3.5 h-3.5 text-ink-3" />
                                                    <span>Solution Diagram ({solFigUrls.length})</span>
                                                  </span>
                                                  <span className="text-ink-3 text-xs font-normal">Click to zoom</span>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                  {solFigUrls.map((url, uIdx) => (
                                                    <div key={uIdx} className="relative group/solfig rounded-lg bg-white p-1.5 border border-white/20 shadow-md inline-block">
                                                      <img 
                                                        src={url} 
                                                        alt={`Solution Figure ${uIdx + 1}`} 
                                                        className="max-h-36 max-w-full object-contain rounded cursor-pointer hover:opacity-90 transition-opacity"
                                                        onClick={() => setPreviewLightboxUrl(url)}
                                                        title="Click to view full size"
                                                      />
                                                      <button
                                                        type="button"
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          handleRemoveFigureFromItem(item.id, 'solution', url);
                                                        }}
                                                        className="absolute -top-2 -right-2 w-5 h-5 bg-rose-600 hover:bg-rose-500 text-white rounded-full flex items-center justify-center text-[11px] shadow"
                                                        title="Remove diagram"
                                                      >
                                                        ✕
                                                      </button>
                                                    </div>
                                                  ))}
                                                </div>
                                              </div>
                                            );
                                          })()}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {/* ENGLISH SIDE */}
                                  <div className="space-y-3 min-w-0 lg:border-l lg:border-line lg:pl-6">
                                    <div className="flex items-center justify-between">
                                      <span className="field-label mb-0 whitespace-nowrap">
                                        English
                                      </span>
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => handleQuickCropForQuestion(item, 'question')}
                                          className="btn btn-ghost btn-xs"
                                          title="Crop diagram/figure and attach to Question"
                                        >
                                          <Scissors />
                                          <span>Crop figure</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleOpenLatexRepair(item, 'question')}
                                          className="btn btn-ghost btn-xs"
                                          title="Fix LaTeX in Question"
                                        >
                                          <Sparkles />
                                          <span>Fix LaTeX</span>
                                        </button>
                                      </div>
                                    </div>

                                    {isEditing ? (
                                      <HtmlLatexField
                                        rows={3}
                                        value={item.question_en}
                                        onChange={(v) => updateItemDraft(item.id, { question_en: v })}
                                      />
                                    ) : (
                                      <>
                                        <LatexRenderer 
                                          content={(item.question_en || '').replace(/<p>\s*<img[^>]*>\s*<\/p>/gi, '').replace(/<img[^>]*>/gi, '').replace(/!\[[^\]]*\]\([^)]+\)/gi, '').replace(/\[(?:FIGURE|IMAGE|FIG)[^\]]*:\s*[^\s\]]+\]/gi, '').trim()} 
                                          className="text-[15px] leading-relaxed text-ink" 
                                        />
                                        {(() => {
                                          const rawUrls = extractFigureUrls(item.question_en);
                                          const qFigUrls = rawUrls.length > 0 ? rawUrls : extractFigureUrls(item.question_hi);
                                          if (qFigUrls.length === 0) return null;
                                          return (
                                            <div className="mt-2.5 p-2.5 rounded-lg bg-white/[0.03] border border-line space-y-2">
                                              <div className="flex items-center justify-between text-xs font-semibold text-ink-2">
                                                <span className="flex items-center gap-1">
                                                  <ImageIcon className="w-3.5 h-3.5 text-ink-3" />
                                                  <span>Question Diagram ({qFigUrls.length})</span>
                                                </span>
                                                <span className="text-ink-3 text-xs font-normal">Click to zoom</span>
                                              </div>
                                              <div className="flex flex-wrap gap-2 pt-0.5">
                                                {qFigUrls.map((url, uIdx) => (
                                                  <div key={uIdx} className="relative group/qfig rounded-lg bg-white p-1.5 border border-white/20 shadow-md inline-block">
                                                    <img 
                                                      src={url} 
                                                      alt={`Question Figure ${uIdx + 1}`} 
                                                      className="max-h-36 max-w-full object-contain rounded cursor-pointer hover:opacity-90 transition-opacity"
                                                      onClick={() => setPreviewLightboxUrl(url)}
                                                      title="Click to view full size"
                                                    />
                                                    <button
                                                      type="button"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleRemoveFigureFromItem(item.id, 'question', url);
                                                      }}
                                                      className="absolute -top-2 -right-2 w-5 h-5 bg-rose-600 hover:bg-rose-500 text-white rounded-full flex items-center justify-center text-[11px] shadow"
                                                      title="Remove diagram"
                                                    >
                                                      ✕
                                                    </button>
                                                  </div>
                                                ))}
                                              </div>
                                            </div>
                                          );
                                        })()}
                                      </>
                                    )}

                                    {/* Options List */}
                                    <div className="space-y-1.5 pt-1">
                                      {(['option1_en', 'option2_en', 'option3_en', 'option4_en'] as const).map((key, optIdx) => {
                                        const optLetter = String.fromCharCode(65 + optIdx);
                                        const optNum = String(optIdx + 1);
                                        const isCorrect = item.answer === optLetter || item.answer === optNum || item.answer?.includes(optLetter) || item.answer?.includes(optNum);
                                        const hiKey = `option${optIdx + 1}_hi` as keyof MockTestMcqItem;
                                        const rawUrls = extractFigureUrls(item[key]);
                                        const optFigUrls = rawUrls.length > 0 ? rawUrls : extractFigureUrls(item[hiKey] as string);
                                        const hasImg = optFigUrls.length > 0 || hasFigureImage(item[key]) || hasFigureImage(item[hiKey] as string);
                                        const cleanOptText = (item[key] || '').replace(/<p>\s*<img[^>]*>\s*<\/p>/gi, '').replace(/<img[^>]*>/gi, '').replace(/!\[[^\]]*\]\([^)]+\)/gi, '').replace(/\[(?:FIGURE|IMAGE|FIG)[^\]]*:\s*[^\s\]]+\]/gi, '').trim();
                                        const optPlainText = htmlToPlainText(cleanOptText);
                                        const isBlank = !hasImg && (!optPlainText || optPlainText.toLowerCase() === 'blank');
                                        const targetOptField = `option${optIdx + 1}` as FigureTargetField;

                                        return (
                                          <div
                                            key={key}
                                            className={`group/opt flex flex-col gap-1.5 px-2.5 py-2 rounded-lg border text-sm transition-colors ${
                                              isCorrect
                                                ? 'bg-emerald-500/10 border-emerald-500/45 text-emerald-200'
                                                : isBlank
                                                ? 'bg-amber-500/5 border-dashed border-amber-500/40 text-amber-200'
                                                : 'bg-transparent border-line text-ink-2 hover:border-line-strong'
                                            }`}
                                          >
                                            <div className="flex items-center gap-2">
                                              <span className={`w-6 h-6 shrink-0 rounded-md text-xs font-bold flex items-center justify-center ${
                                                isCorrect ? 'bg-emerald-500 text-black' : isBlank ? 'bg-amber-500/20 text-amber-300' : 'bg-white/[0.06] text-ink-3'
                                              }`}>
                                                {optLetter}
                                              </span>
                                              {isEditing ? (
                                                <HtmlLatexField
                                                  singleLine
                                                  value={item[key] || ''}
                                                  onChange={(v) => updateItemDraft(item.id, { [key]: v })}
                                                  placeholder={`Option ${optLetter}`}
                                                />
                                              ) : (
                                                <span className="flex-1 min-w-0" title={htmlToPlainText(item[key] || '')}>
                                                  {optPlainText ? (
                                                    <LatexRenderer content={cleanOptText} inline={true} className={isCorrect ? 'text-emerald-100 font-semibold' : 'text-ink'} />
                                                  ) : hasImg ? (
                                                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-300/90">
                           <ImageIcon className="w-3.5 h-3.5 text-ink-3 shrink-0" />
                           <span>Figure Option ({optLetter})</span>
                         </span>
                                                  ) : (
                                                    <span className="inline-flex items-center gap-1 text-amber-400/90 font-semibold italic text-[11px]">
                                                      <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                                                      <span>Blank option — use Auto-fill or Crop</span>
                                                    </span>
                                                  )}
                                                </span>
                                              )}
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleQuickCropForQuestion(item, targetOptField);
                                                }}
                                                className="btn btn-ghost btn-xs shrink-0 opacity-50 hover:opacity-100 focus-visible:opacity-100 group-hover/opt:opacity-100"
                                                title={`Crop & attach diagram for Option ${optLetter}`}
                                              >
                                                <Scissors className="w-3 h-3" />
                                                <span className="hidden sm:inline">{hasImg ? 'Re-crop' : 'Crop'}</span>
                                              </button>
                                              {isCorrect && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                                            </div>

                                            {/* Live Image Thumbnail for Option (English) */}
                                            {optFigUrls.length > 0 && (
                                              <div className="flex flex-wrap gap-2 pl-8 pt-0.5">
                                                {optFigUrls.map((url, uIdx) => (
                                                  <div key={uIdx} className="relative group/optfig rounded-lg bg-white p-1 border border-white/20 shadow-md inline-block">
                                                    <img 
                                                      src={url} 
                                                      alt={`Option ${optLetter} Diagram`} 
                                                      className="max-h-20 max-w-[140px] object-contain rounded cursor-pointer hover:scale-105 transition-transform"
                                                      onClick={() => setPreviewLightboxUrl(url)}
                                                      title="Click to view full size"
                                                    />
                                                    <button
                                                      type="button"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleRemoveFigureFromItem(item.id, targetOptField, url);
                                                      }}
                                                      className="absolute -top-2 -right-2 w-5 h-5 bg-rose-600 hover:bg-rose-500 text-white rounded-full flex items-center justify-center text-[11px] shadow"
                                                      title="Remove figure"
                                                    >
                                                      ✕
                                                    </button>
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>

                                    {/* English Solution */}
                                    <div className="pt-3 border-t border-line space-y-2">
                                      <div className="flex items-center justify-between">
                                        <span className="field-label mb-0 whitespace-nowrap">
                                          Solution
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                          <button
                                            type="button"
                                            onClick={() => handleQuickCropForQuestion(item, 'solution')}
                                            className="btn btn-ghost btn-xs"
                                            title="Crop diagram/figure and attach to English Solution"
                                          >
                                            <Scissors />
                                            <span>Crop figure</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleOpenLatexRepair(item, 'solution')}
                                            className="btn btn-ghost btn-xs"
                                            title="Fix LaTeX in English Solution"
                                          >
                                            <Sparkles />
                                            <span>Fix LaTeX</span>
                                          </button>
                                        </div>
                                      </div>
                                      {isEditing ? (
                                        <HtmlLatexField
                                          rows={4}
                                          value={item.solution_en}
                                          onChange={(v) => updateItemDraft(item.id, { solution_en: v })}
                                          textClassName="text-ink-2"
                                        />
                                      ) : (
                                        <div className="p-3 rounded-lg bg-white/[0.025] border border-line space-y-2">
                                          <LatexRenderer 
                                            content={(item.solution_en || '<p>Solution not available</p>').replace(/<p>\s*<img[^>]*>\s*<\/p>/gi, '').replace(/<img[^>]*>/gi, '').replace(/!\[[^\]]*\]\([^)]+\)/gi, '').replace(/\[(?:FIGURE|IMAGE|FIG)[^\]]*:\s*[^\s\]]+\]/gi, '').trim() || '<p>Solution not available</p>'} 
                                            className="text-ink-2 text-sm" 
                                          />
                                          {(() => {
                                            const rawUrls = extractFigureUrls(item.solution_en);
                          const solFigUrls = rawUrls.length > 0 ? rawUrls : extractFigureUrls(item.solution_hi);
                                            if (solFigUrls.length === 0) return null;
                                            return (
                                              <div className="pt-2 border-t border-line space-y-1.5">
                                                <div className="flex items-center justify-between text-xs font-semibold text-ink-2">
                                                  <span className="flex items-center gap-1">
                                                    <ImageIcon className="w-3.5 h-3.5 text-ink-3" />
                                                    <span>Solution Diagram ({solFigUrls.length})</span>
                                                  </span>
                                                  <span className="text-ink-3 text-xs font-normal">Click to zoom</span>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                  {solFigUrls.map((url, uIdx) => (
                                                    <div key={uIdx} className="relative group/solfig rounded-lg bg-white p-1.5 border border-white/20 shadow-md inline-block">
                                                      <img 
                                                        src={url} 
                                                        alt={`Solution Figure ${uIdx + 1}`} 
                                                        className="max-h-36 max-w-full object-contain rounded cursor-pointer hover:opacity-90 transition-opacity"
                                                        onClick={() => setPreviewLightboxUrl(url)}
                                                        title="Click to view full size"
                                                      />
                                                      <button
                                                        type="button"
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          handleRemoveFigureFromItem(item.id, 'solution', url);
                                                        }}
                                                        className="absolute -top-2 -right-2 w-5 h-5 bg-rose-600 hover:bg-rose-500 text-white rounded-full flex items-center justify-center text-[11px] shadow"
                                                        title="Remove diagram"
                                                      >
                                                        ✕
                                                      </button>
                                                    </div>
                                                  ))}
                                                </div>
                                              </div>
                                            );
                                          })()}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 2: LIVE 34-COLUMN CSV GRID VIEW */}
          {activeTab === 'grid' && (
            <div className="card overflow-hidden">
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="sticky top-0 z-10 border-b border-line-strong bg-surface-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3 whitespace-nowrap">
                      <th className="p-2">#</th>
                      <th className="p-2 min-w-[200px]">question_hi</th>
                      <th className="p-2 min-w-[100px]">opt1_hi</th>
                      <th className="p-2 min-w-[100px]">opt2_hi</th>
                      <th className="p-2 min-w-[100px]">opt3_hi</th>
                      <th className="p-2 min-w-[100px]">opt4_hi</th>
                      <th className="p-2 min-w-[100px]">opt5_hi</th>
                      <th className="p-2 min-w-[200px]">solution_hi</th>
                      <th className="p-2 min-w-[200px]">question_en</th>
                      <th className="p-2 min-w-[100px]">opt1_en</th>
                      <th className="p-2 min-w-[100px]">opt2_en</th>
                      <th className="p-2 min-w-[100px]">opt3_en</th>
                      <th className="p-2 min-w-[100px]">opt4_en</th>
                      <th className="p-2 min-w-[100px]">opt5_en</th>
                      <th className="p-2 min-w-[200px]">solution_en</th>
                      <th className="p-2 min-w-[70px]">answer</th>
                      <th className="p-2 min-w-[120px]">set_name</th>
                      <th className="p-2 min-w-[80px]">difficulty</th>
                      <th className="p-2 min-w-[100px]">test_date</th>
                      <th className="p-2 min-w-[110px]">test_time</th>
                      <th className="p-2 min-w-[130px] text-ink-2">subject (STRICT)</th>
                      <th className="p-2 min-w-[140px]">subject_level</th>
                      <th className="p-2 min-w-[100px]">figure_notes</th>
                      <th className="p-2 min-w-[120px]">correction_notes</th>
                      <th className="p-2 min-w-[100px]">source_pdf</th>
                      <th className="p-2 min-w-[70px]">source_pages</th>
                      <th className="p-2 min-w-[80px]">source_ref</th>
                      <th className="p-2 min-w-[70px]">latex_chk</th>
                      <th className="p-2 min-w-[70px]">html_chk</th>
                      <th className="p-2 min-w-[70px]">ans_chk</th>
                      <th className="p-2 min-w-[70px]">sol_chk</th>
                      <th className="p-2 min-w-[80px]">hash_fig</th>
                      <th className="p-2 min-w-[70px]">manual_rev</th>
                      <th className="p-2 min-w-[160px]">duplicate_stats</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line text-ink-2 whitespace-nowrap">
                    {extractedMcqs.map((row) => (
                      <tr key={row.id} className="hover:bg-white/[0.03]">
                        <td className="p-2 font-semibold text-ink">{row.question_r}</td>
                        <td className="p-2 truncate max-w-[200px]" title={row.question_hi}>{row.question_hi}</td>
                        <td className="p-2 truncate max-w-[100px]">{row.option1_hi}</td>
                        <td className="p-2 truncate max-w-[100px]">{row.option2_hi}</td>
                        <td className="p-2 truncate max-w-[100px]">{row.option3_hi}</td>
                        <td className="p-2 truncate max-w-[100px]">{row.option4_hi}</td>
                        <td className="p-2 truncate max-w-[100px]">{row.option5_hi || '—'}</td>
                        <td className="p-2 truncate max-w-[200px]" title={row.solution_hi}>{row.solution_hi}</td>
                        <td className="p-2 truncate max-w-[200px]" title={row.question_en}>{row.question_en}</td>
                        <td className="p-2 truncate max-w-[100px]">{row.option1_en}</td>
                        <td className="p-2 truncate max-w-[100px]">{row.option2_en}</td>
                        <td className="p-2 truncate max-w-[100px]">{row.option3_en}</td>
                        <td className="p-2 truncate max-w-[100px]">{row.option4_en}</td>
                        <td className="p-2 truncate max-w-[100px]">{row.option5_en || '—'}</td>
                        <td className="p-2 truncate max-w-[200px]" title={row.solution_en}>{row.solution_en}</td>
                        <td className="p-2 font-semibold text-emerald-300">{row.answer}</td>
                        <td className="p-2 truncate max-w-[120px]">{row.set_name}</td>
                        <td className="p-2 capitalize">{row.difficulty_level}</td>
                        <td className="p-2">{row.test_date || '—'}</td>
                        <td className="p-2">{row.test_time || '—'}</td>
                        <td className="p-2 font-medium text-ink">{row.subject || '—'}</td>
                        <td className="p-2">{row.subject_level || '—'}</td>
                        <td className="p-2">{row.figure_notes || '—'}</td>
                        <td className="p-2 truncate max-w-[140px]" title={row.correction_notes}>{row.correction_notes || '—'}</td>
                        <td className="p-2">{row.source_pdf || '—'}</td>
                        <td className="p-2">{row.source_pages || '—'}</td>
                        <td className="p-2">{row.source_question_reference || `Q.${row.question_r}`}</td>
                        <td className="p-2 text-slate-400">{row.latex_check || 'checked'}</td>
                        <td className="p-2 text-slate-400">{row.html_check || 'checked'}</td>
                        <td className="p-2 text-slate-400">{row.answer_check || 'checked'}</td>
                        <td className="p-2 text-slate-400">{row.solution_check || 'checked'}</td>
                        <td className="p-2 text-slate-500">{row.hash_figure || '—'}</td>
                        <td className="p-2 text-slate-400">{row.manually_review || 'checked'}</td>
                        <td className="p-2 truncate max-w-[160px]" title={row.duplicate_statistics}>{row.duplicate_statistics || 'Unique'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: RAW CSV VIEW */}
          {activeTab === 'csv' && (
            <div className="card overflow-hidden p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
                <span>RFC 4180 CSV with UTF-8 BOM (\uFEFF) • Ready for direct MockTest Portal Upload</span>
                <button
                  type="button"
                  onClick={handleCopyCsv}
                  className="btn btn-secondary btn-sm"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied!' : 'Copy to Clipboard'}</span>
                </button>
              </div>
              <pre className="p-4 bg-canvas rounded-lg border border-line text-xs text-ink-2 font-mono overflow-x-auto max-h-[60vh] whitespace-pre-wrap">
                {serializeMockTestToCsv(extractedMcqs, answerFormat)}
              </pre>
            </div>
          )}

          {/* Bottom summary bar */}
          {(() => {
            const incompleteTotal = extractedMcqs.filter(it => detectItemFieldIssues(it).hasIssues).length;
            return (
              <div className="card flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3 text-sm text-ink-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <span><strong className="text-ink font-semibold">{extractedMcqs.length}</strong> questions</span>
                  <span><strong className="text-ink font-semibold">{solvedCount}</strong> solved</span>
                  <span><strong className="text-ink font-semibold">{pages.filter(p => p.status === 'ready').length}/{pages.length}</strong> pages done</span>
                  {incompleteTotal > 0 && (
                    <span className="badge badge-warning">
                      <AlertTriangle />
                      <span>{incompleteTotal} incomplete</span>
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {incompleteTotal > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleReverifyMissingFields()}
                        disabled={isRepairingAll}
                        className="btn btn-secondary btn-sm"
                        title="Visually re-inspect page images to recover missing fields across the whole document"
                      >
                        {isRepairingAll ? <Loader2 className="animate-spin" /> : <Eye />}
                        <span>
                          {isRepairingAll
                            ? `Re-verifying (${repairProgress?.current || 0}/${repairProgress?.total || incompleteTotal})…`
                            : `Re-verify all (${incompleteTotal})`}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={handleAiRepairAllIncomplete}
                        disabled={isRepairingAll}
                        className="btn btn-secondary btn-sm"
                        title="AI will deduce options, verify answers, and generate solutions for all incomplete items"
                      >
                        {isRepairingAll ? <Loader2 className="animate-spin" /> : <Sparkles />}
                        <span>
                          {isRepairingAll
                            ? `Repairing (${repairProgress?.current || 0}/${repairProgress?.total || incompleteTotal})…`
                            : `AI auto-fill all (${incompleteTotal})`}
                        </span>
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={handleDownloadCsv}
                    disabled={extractedMcqs.length === 0}
                    className="btn btn-primary btn-sm"
                    title={`Download ${(outputFileName || setName || 'mocktest')}.csv`}
                  >
                    <Download />
                    <span>Export CSV</span>
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* High-Res Page Lightbox Modal: 500% Zoom, Zero-Lag Direct Pan, Multi-Crop Tool & ImgBB Cloud */}
      <HighResPageLightbox
        isOpen={zoomPageIndex !== null}
        pageIndex={zoomPageIndex}
        pages={pages}
        setName={setName}
        extractedMcqs={extractedMcqs}
        initialTargetQuestionId={selectedTargetQuestionId}
        initialTargetField={selectedTargetField}
        initialCropMode={isFigureCropMode}
        onClose={() => {
          setZoomPageIndex(null);
          setIsFigureCropMode(false);
        }}
        onUpdateQuestion={(questionId, updated) => {
          updateItem(questionId, updated);
        }}
        onPageIndexChange={(newIdx) => {
          setZoomPageIndex(newIdx);
        }}
      />

      {/* Modals for Settings and Connect */}
      <GeminiSettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
      />

      <GeminiConnectModal
        isOpen={showConnectModal}
        onClose={() => setShowConnectModal(false)}
        onConnected={() => setShowConnectModal(false)}
      />

      {/* Individual Question AI Chat Modal */}
      <MocktestAiChatModal
        isOpen={activeChatQuestion !== null}
        onClose={() => setActiveChatQuestion(null)}
        item={activeChatQuestion}
        onUpdateItem={(updated) => {
          updateItem(updated.id, updated);
          setActiveChatQuestion(updated);
        }}
      />

      {/* AI Quick Add & Screenshot Paste Question Modal */}
      <MocktestAddQuestionModal
        isOpen={showAddQuestionModal}
        onClose={() => setShowAddQuestionModal(false)}
        totalPages={pages.length}
        defaultPageNumber={addQuestionTargetPage}
        nextQuestionNumber={extractedMcqs.length + 1}
        setName={setName}
        onAddQuestion={handleInsertNewQuestion}
      />

      {/* Paste CSV / Add Missing Questions Modal */}
      <MocktestPasteCsvModal
        isOpen={showPasteCsvModal}
        onClose={() => {
          setShowPasteCsvModal(false);
          setPasteCsvTargetPage(undefined);
        }}
        existingItems={extractedMcqs}
        setName={setName}
        targetPageNumber={pasteCsvTargetPage}
        totalPages={pages.length}
        onAddItems={handlePasteCsvAddItems}
      />

      {/* AI LaTeX Repair Modal */}
      {latexRepairTarget && (
        <LatexRepairModal
          isOpen={latexRepairTarget !== null}
          onClose={() => setLatexRepairTarget(null)}
          item={latexRepairTarget.item}
          initialScope={latexRepairTarget.scope}
          onApply={handleApplyLatexRepair}
        />
      )}

      {/* Zoom / Lightbox Preview Modal for Cropped Figures */}
      {previewLightboxUrl && (
        <div 
          className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setPreviewLightboxUrl(null)}
        >
          <div 
            className="relative max-w-4xl max-h-[90vh] bg-slate-900 border border-white/20 rounded-2xl p-4 shadow-2xl flex flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between w-full px-1">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-orange-400" />
                <span className="text-xs font-bold text-slate-200">Figure Preview</span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={previewLightboxUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1 text-[11px] font-semibold bg-white/10 hover:bg-white/20 text-slate-200 rounded-lg transition-colors flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Open Raw</span>
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewLightboxUrl(null)}
                  className="p-1 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="bg-white rounded-xl p-3 max-h-[75vh] max-w-full flex items-center justify-center overflow-auto shadow-inner">
              <img 
                src={previewLightboxUrl} 
                alt="Figure Full Size" 
                className="max-h-[70vh] max-w-full object-contain rounded select-none"
              />
            </div>
            <span className="text-[11px] text-slate-400">Click outside or ✕ to close</span>
          </div>
        </div>
      )}

      {/* Floating Undo Toast for LaTeX Repair */}
      {undoToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 bg-zinc-900/95 border border-line-strong rounded-2xl shadow-2xl shadow-black/80 text-xs backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <span className="text-slate-200 font-medium">LaTeX repaired for <strong>Q#{undoToast.questionNum}</strong></span>
          </div>
          <button
            type="button"
            onClick={() => handleUndoRepair(undoToast.itemId)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-ink-2 font-bold border border-line-strong transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Undo</span>
          </button>
          <button
            type="button"
            onClick={() => setUndoToast(null)}
            className="p-1 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};

export default MocktestExtractor;
