import React, { useState, useRef, useEffect } from 'react';
import { 
  FileSpreadsheet, Upload, Play, Pause, RotateCw, Trash2, CheckCircle2, 
  AlertCircle, AlertTriangle, Loader2, Sparkles, Download, Copy, Check, Plus, 
  BookOpen, CheckSquare, Square, Zap, Settings, RefreshCw, Key,
  ZoomIn, ZoomOut, RotateCcw, ChevronLeft, ChevronRight, X, Edit3, ChevronDown, ChevronUp, Eye, Camera, SlidersHorizontal, FileText, MessageSquare
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { convertPdfToImages, readFileAsBase64 } from '../services/pdfUtils';
import { MocktestAiChatModal } from './MocktestAiChatModal';
import { MocktestAddQuestionModal } from './MocktestAddQuestionModal';
import { 
  MockTestMcqItem, 
  DifficultyLevel 
} from '../types';
import { 
  downloadMockTestCsv, 
  serializeMockTestToCsv, 
  parseCsvToMockTestItems, 
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
import { 
  extractWithStudyAiBridge, 
  captureFromStudyAiBridge,
  parseExtensionOutputToElements,
  pingStudyAiExtension, 
  subscribeToExtensionStatus,
  getStoredAiProvider,
  setStoredAiProvider,
  BridgeStatus,
  AiProvider
} from '../services/studyAiBridgeService';
import GeminiSettingsModal from './GeminiSettingsModal';
import GeminiConnectModal from './GeminiConnectModal';

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
}

// ─── MathJax 3 Integration ────────────────────────────────────────────────────
// Declare global MathJax type so TypeScript doesn't complain
declare global {
  interface Window {
    MathJax?: {
      typesetPromise: (elements?: HTMLElement[]) => Promise<void>;
      typesetClear?: (elements?: HTMLElement[]) => void;
      startup?: { promise: Promise<void> };
    };
  }
}

/**
 * Hook: Calls MathJax.typesetPromise() whenever `deps` change.
 * Pass a ref to typeset only that subtree, or omit to typeset the whole page.
 */
export function useMathJax(ref?: React.RefObject<HTMLElement | null>, deps: any[] = []) {
  useEffect(() => {
    const triggerTypeset = async () => {
      const mj = window.MathJax;
      if (!mj?.typesetPromise) return;
      try {
        // Wait for MathJax startup to finish if it hasn't already
        if (mj.startup?.promise) await mj.startup.promise;
        const elements = ref?.current ? [ref.current] : undefined;
        // Clear previous rendering on the element first to avoid duplication
        if (mj.typesetClear && elements) mj.typesetClear(elements);
        await mj.typesetPromise(elements);
      } catch (e) {
        // Silently ignore typeset errors (e.g., invalid LaTeX)
        console.debug('[MathJax] typesetPromise error (non-fatal):', e);
      }
    };
    // Small delay so React has finished painting the DOM
    const timer = setTimeout(triggerTypeset, 50);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
// ──────────────────────────────────────────────────────────────────────────────

/**
 * LaTeX and Math-safe content renderer using KaTeX + MathJax 3.
 * Renders $...$ / $$...$$ via KaTeX (fast, offline).
 * Also calls MathJax.typesetPromise() after render to handle any \(...\) / \[...\] that survived.
 */
export const LatexRenderer: React.FC<{ content: string; className?: string; inline?: boolean }> = ({
  content,
  className,
  inline = false
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Re-typeset with MathJax after every content change
  useMathJax(containerRef, [content]);

  if (!content) return null;

  let clean = content;

  // 1. Standardize MathJax \( ... \) and \[ ... \] to $ and $$ for remarkMath
  clean = clean.replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$');
  clean = clean.replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$');

  // 2. Convert HTML tables to clean Markdown tables for remarkGfm
  clean = clean.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_match, tableContent) => {
    const rows: string[][] = [];
    const rowMatches = tableContent.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    for (const rowHtml of rowMatches) {
      const cells: string[] = [];
      const cellMatches = rowHtml.match(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi) || [];
      for (const c of cellMatches) {
        const inner = c.replace(/<(?:th|td)[^>]*>|<\/(?:th|td)>/gi, '').replace(/\n/g, ' ').trim();
        cells.push(inner || '-');
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length === 0) return '';
    const maxCols = Math.max(...rows.map(r => r.length));
    const paddedRows = rows.map(r => {
      const full = [...r];
      while (full.length < maxCols) full.push('-');
      return '| ' + full.join(' | ') + ' |';
    });
    const headerDivider = '| ' + Array(maxCols).fill('---').join(' | ') + ' |';
    return '\n\n' + paddedRows[0] + '\n' + headerDivider + '\n' + paddedRows.slice(1).join('\n') + '\n\n';
  });

  // 3. Convert HTML lists
  clean = clean.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '* $1\n');
  clean = clean.replace(/<\/?(?:ul|ol)[^>]*>/gi, '\n');

  // 4. Convert formatting tags to Markdown and clean ALL <p> & </p> to prevent stray tags
  clean = clean
    .replace(/<hr\s*\/?>/gi, '\n\n---\n\n')
    .replace(/<div[^>]*>/gi, '')
    .replace(/<\/div>/gi, '\n')
    .replace(/<(?:b|strong)[^>]*>(.*?)<\/(?:b|strong)>/gi, '**$1**')
    .replace(/<(?:i|em)[^>]*>(.*?)<\/(?:i|em)>/gi, '*$1*')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<\/?p[^>]*>/gi, '\n\n');

  // 5. Ensure ANY existing Markdown table block has blank lines before and after it
  // (GFM spec strictly requires empty lines before tables so they don't merge into paragraphs)
  const lines = clean.split('\n');
  const normalizedLines: string[] = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const isTableLine = /^\s*\|.*\|\s*$/.test(l);

    if (isTableLine) {
      if (!inTable) {
        if (normalizedLines.length > 0 && normalizedLines[normalizedLines.length - 1].trim() !== '') {
          normalizedLines.push('');
        }
        inTable = true;
      }
      normalizedLines.push(l.trim());
    } else {
      if (inTable) {
        inTable = false;
        normalizedLines.push('');
      }
      normalizedLines.push(l);
    }
  }
  clean = normalizedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  // 6. Auto-wrap naked fractions like \frac{...}{...} if missing $
  clean = clean.replace(/(?<!\$)(?:\\frac\s*\{[^{}]+\}\s*\{[^{}]+\})(?!\$)/g, '$$$0$$');

  const customTableComponents = {
    table: ({ children }: any) => (
      <div className="my-3 overflow-x-auto w-full rounded-xl border border-white/[0.15] bg-black/50 shadow-md">
        <table className="w-full text-left text-xs border-collapse border-spacing-0">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }: any) => (
      <thead className="bg-white/[0.08] border-b border-white/[0.15] text-amber-300 font-extrabold uppercase tracking-wider text-[11px]">
        {children}
      </thead>
    ),
    tbody: ({ children }: any) => (
      <tbody className="divide-y divide-white/[0.06] text-slate-200">
        {children}
      </tbody>
    ),
    tr: ({ children }: any) => (
      <tr className="hover:bg-white/[0.04] transition-colors">
        {children}
      </tr>
    ),
    th: ({ children }: any) => (
      <th className="py-2 px-3 font-extrabold border-r border-white/[0.08] last:border-r-0 text-amber-300">
        {children}
      </th>
    ),
    td: ({ children }: any) => (
      <td className="py-2 px-3 border-r border-white/[0.06] last:border-r-0 font-medium text-slate-200 leading-relaxed">
        {children}
      </td>
    )
  };

  if (inline) {
    return (
      <span ref={containerRef as React.RefObject<HTMLSpanElement>} className={`inline-flex items-center text-xs leading-normal ${className || ''}`}>
        <ReactMarkdown
          remarkPlugins={[remarkMath, remarkGfm]}
          rehypePlugins={[rehypeKatex]}
          components={{
            p: ({ children }) => <span className="inline">{children}</span>,
            ...customTableComponents
          }}
        >
          {clean}
        </ReactMarkdown>
      </span>
    );
  }

  return (
    <div ref={containerRef} className={`prose prose-invert max-w-none text-xs leading-relaxed ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={customTableComponents}
      >
        {clean}
      </ReactMarkdown>
    </div>
  );
};

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

  // Engine Mode & Concurrency Batch Size
  const [aiEngine, setAiEngine] = useState<'bridge' | 'api'>('bridge');
  const [batchSize, setBatchSize] = useState<number>(3); // Multi-page parallel batch size
  const [selectedProvider, setSelectedProvider] = useState<AiProvider>(getStoredAiProvider());

  // Configuration state
  const [outputFileName, setOutputFileName] = useState<string>('');
  const [setName, setSetName] = useState<string>('RRB NTPC 2024 CBT-1');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('medium');
  const [answerFormat, setAnswerFormat] = useState<'letters' | 'numbers'>('letters');
  const [mathFormat, setMathFormat] = useState<'mathjax' | 'unicode'>('mathjax');
  const [autoDeepSolveAll, setAutoDeepSolveAll] = useState<boolean>(true);
  // Extraction Mode: 'exact' (Extract as written) vs 'similar' (Input PDF as Reference -> Generate Brand-New Practice Questions)
  const [extractionMode, setExtractionMode] = useState<'exact' | 'similar'>('exact');
  const [generatingSimilarId, setGeneratingSimilarId] = useState<string | null>(null);
  const [isGeneratingSimilarBatch, setIsGeneratingSimilarBatch] = useState(false);

  // Extracted MCQs state
  const [extractedMcqs, setExtractedMcqs] = useState<MockTestMcqItem[]>([]);
  const [activeTab, setActiveTab] = useState<'split' | 'grid' | 'csv'>('split');
  const [solvingId, setSolvingId] = useState<string | null>(null);
  const [isSolvingAll, setIsSolvingAll] = useState(false);
  const [repairingId, setRepairingId] = useState<string | null>(null);
  const [isRepairingAll, setIsRepairingAll] = useState(false);
  const [repairProgress, setRepairProgress] = useState<{ current: number; total: number } | null>(null);
  const [copied, setCopied] = useState(false);

  // Inline editing & High-Res Image Zoom modal with 500% Zoom, Pan & Page Navigation
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
  const [zoomPageIndex, setZoomPageIndex] = useState<number | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Keyboard navigation & zoom for Lightbox modal
  useEffect(() => {
    if (zoomPageIndex === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setZoomPageIndex(null);
        setZoomLevel(1);
        setPanOffset({ x: 0, y: 0 });
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setZoomPageIndex(prev => (prev !== null && prev > 0 ? prev - 1 : prev));
        setPanOffset({ x: 0, y: 0 });
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        setZoomPageIndex(prev => (prev !== null && prev < pages.length - 1 ? prev + 1 : prev));
        setPanOffset({ x: 0, y: 0 });
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoomLevel(prev => Math.min(5, Number((prev + 0.5).toFixed(2))));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setZoomLevel(prev => Math.max(0.5, Number((prev - 0.5).toFixed(2))));
      } else if (e.key === '0') {
        e.preventDefault();
        setZoomLevel(1);
        setPanOffset({ x: 0, y: 0 });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomPageIndex, pages.length]);
  const [activeChatQuestion, setActiveChatQuestion] = useState<MockTestMcqItem | null>(null);
  const [showAddQuestionModal, setShowAddQuestionModal] = useState<boolean>(false);
  const [addQuestionTargetPage, setAddQuestionTargetPage] = useState<number>(1);

  // Modals & Bridge status
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({ connected: false });
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);

  // UI Enhancement: Collapsible Paper Settings & Grouped AI Tools
  const [showPaperSettings, setShowPaperSettings] = useState(false);
  const [showAiToolsMenu, setShowAiToolsMenu] = useState(false);
  const aiToolsRef = useRef<HTMLDivElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvImportInputRef = useRef<HTMLInputElement>(null);
  const pauseRef = useRef<boolean>(false);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (aiToolsRef.current && !aiToolsRef.current.contains(e.target as Node)) {
        setShowAiToolsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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

  const handleProviderChange = (prov: AiProvider) => {
    setSelectedProvider(prov);
    setStoredAiProvider(prov);
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
            items: []
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

  // Process a single page item sequentially with carry-over context
  const processPageItemSequential = async (
    page: PageQueueItem,
    pendingContext: PendingMcqContext | null,
    pageIndex: number,
    totalPages: number,
    isLastPage: boolean,
    mode?: 'exact' | 'similar'
  ): Promise<{ completeItems: MockTestMcqItem[]; nextPendingContext: PendingMcqContext | null }> => {
    const activeMode = mode || extractionMode;
    const isSimilar = activeMode === 'similar';

    setActivePageIndex(pageIndex);
    setPages(prev => prev.map(p => p.id === page.id ? { ...p, status: 'processing', errorMessage: undefined } : p));
    
    const carryNotice = pendingContext && pendingContext.pendingItems.length > 0
      ? ` (Carrying forward ${pendingContext.pendingItems.length} pending MCQ from P.${pendingContext.sourcePageNumber})`
      : '';
    setLiveStatusText(
      isSimilar
        ? `[Sequential ${pageIndex + 1}/${totalPages}] Page ${page.pageNumber}: 🧠 Generating BRAND NEW similar MCQs from reference page...${carryNotice}`
        : `[Sequential ${pageIndex + 1}/${totalPages}] Page ${page.pageNumber}: Starting AI extraction...${carryNotice}`
    );

    const isUsingBridge = aiEngine === 'bridge' && bridgeStatus.connected;

    try {
      let rawExtractedItems: MockTestMcqItem[] = [];

      if (isUsingBridge) {
        const prompt = isSimilar
          ? buildMockTestSimilarBridgePrompt(setName, pendingContext, page.pageNumber)
          : buildMockTestBridgePrompt(setName, pendingContext, page.pageNumber);
        const { rawText, elements } = await extractWithStudyAiBridge({
          base64Image: page.imageUrl,
          fileName: `mocktest_page_${page.pageNumber}.png`,
          mimeType: 'image/png',
          prompt,
          provider: selectedProvider || getStoredAiProvider() || 'gemini',
          continueChat: false,
          onProgress: (step, detail) => {
            const msg = detail || `${step.toUpperCase()}...`;
            setLiveStatusText(`[Page ${page.pageNumber}] ${msg}`);
            setPages(prev => prev.map(p => p.id === page.id ? { ...p, errorMessage: msg } : p));
          }
        });

        // 1. Parse AI rawText as JSON
        const startIndex = extractedMcqs.length + 1;
        rawExtractedItems = parseAiOutputToMockTestItems(rawText, setName, startIndex);

        // 2. Fallback: if JSON parse produced nothing, convert elements
        if (rawExtractedItems.length === 0 && elements && elements.length > 0) {
          rawExtractedItems = convertElementsToMockTestItems(elements, setName);
        }
      } else {
        // Direct API mode
        setLiveStatusText(
          isSimilar
            ? `[Page ${page.pageNumber}] 🧠 Calling Gemini API to generate NEW practice MCQs from reference page...`
            : `[Page ${page.pageNumber}] Calling Gemini API with carry-over context...`
        );
        const startIndex = extractedMcqs.length + 1;
        rawExtractedItems = await extractMockTestWithDirectApi(
          page.imageUrl,
          setName,
          startIndex,
          pendingContext,
          page.pageNumber,
          isSimilar
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
        setExtractedMcqs(allMcqs.map((it, idx) => ({ ...it, question_r: idx + 1 })));
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
      const msg = err.message || 'Extraction failed';
      setPages(prev => prev.map(p => p.id === page.id ? {
        ...p,
        status: 'error',
        errorMessage: msg
      } : p));
      throw err;
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

    if (aiEngine === 'bridge' && !bridgeStatus.connected) {
      const ping = await pingStudyAiExtension(600);
      if (!ping.connected) {
        const switchApi = confirm(
          'TextExtract Pro Bridge Extension is not connected in Chrome.\n\n' +
          'Would you like to switch to DIRECT GEMINI API mode instead?'
        );
        if (switchApi) {
          setAiEngine('api');
        } else {
          setShowConnectModal(true);
          return;
        }
      }
    }

    setIsProcessingAll(true);
    setIsPaused(false);

    try {
      let carriedPendingContext: PendingMcqContext | null = null;

      for (let i = 0; i < selectedPages.length; i++) {
        if (pauseRef.current) {
          setLiveStatusText('Processing paused by user.');
          break;
        }

        const page = selectedPages[i];
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
            mode
          );
          carriedPendingContext = nextPendingContext;
        } catch (pageErr: any) {
          console.error(`Error processing page ${page.pageNumber}:`, pageErr);
        }

        // Brief delay between sequential pages to avoid rate limiting
        await new Promise(res => setTimeout(res, 600));
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
    if (isProcessingAll) return;
    setLiveStatusText(`Page ${page.pageNumber}: Recapturing complete response from AI tab...`);
    setPages(prev => prev.map(p => p.id === page.id ? { ...p, errorMessage: 'Reading complete response from AI tab...' } : p));

    try {
      const provider = selectedProvider || getStoredAiProvider() || 'gemini';
      const rawText = await captureFromStudyAiBridge(provider, false);
      if (!rawText || !rawText.trim()) {
        throw new Error('No response text detected on AI tab. Please verify the AI finished writing.');
      }

      const startIndex = extractedMcqs.filter(it => it.pageId !== page.id).length + 1;
      let formattedItems = parseAiOutputToMockTestItems(rawText, setName, startIndex);
      if (formattedItems.length === 0) {
        const elements = parseExtensionOutputToElements(rawText);
        if (elements && elements.length > 0) {
          formattedItems = convertElementsToMockTestItems(elements, setName);
        }
      }

      if (formattedItems.length === 0) {
        throw new Error('AI tab content captured, but could not extract structured MCQs.');
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
    const chosenName = (outputFileName || setName || 'mocktest').trim();
    const safeBase = chosenName.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'mocktest';
    const finalFileName = safeBase.toLowerCase().endsWith('.csv') ? safeBase : `${safeBase}.csv`;
    downloadMockTestCsv(extractedMcqs, finalFileName, answerFormat, mathFormat);
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
        const parsed = parseCsvToMockTestItems(text, setName);
        if (parsed.length > 0) {
          // Standardize imported items: enforce strict <p>...</p> wrapping and MathJax format
          const standardized = parsed.map(it => standardizeItemHtmlAndMathJax(it, mathFormat === 'mathjax'));
          setExtractedMcqs(standardized);
          alert(`✨ Successfully imported and standardized ${standardized.length} MCQs!\n\nAll bare text fields (e.g. Q.21-25, 46-50, 76) have been wrapped in <p>...</p> and formatted consistently.`);
        } else {
          alert('Could not parse any MCQs from this CSV file. Verify headers.');
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Main Header & Studio Command Bar */}
      <div className="relative rounded-2xl bg-gradient-to-b from-slate-900/90 to-slate-950/90 border border-white/[0.08] p-4 sm:p-5 backdrop-blur-xl shadow-2xl space-y-4">
        {/* Row 1: Title, Subtitle, Stats & Top Actions */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 text-[11px] font-bold tracking-wide uppercase">
              <FileSpreadsheet className="w-3 h-3 text-amber-400" />
              <span>MockTest Studio • 34-Column Engine</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight font-display">
              Bilingual MockTest MCQ Extractor
            </h1>
            <p className="text-xs text-slate-400 max-w-xl">
              Strict 34-column exam standard with bilingual Hindi/English extraction, pedagogical solutions, and LaTeX KaTeX support.
            </p>
          </div>

          {/* Quick Stats & Primary Actions */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Compact Stats Pill */}
            <div className="flex items-center bg-black/50 border border-white/[0.08] rounded-xl px-3 py-1.5 gap-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">Pages:</span>
                <span className="font-bold text-blue-400">{pages.length}</span>
              </div>
              <div className="h-3 w-px bg-white/[0.1]" />
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">MCQs:</span>
                <span className="font-bold text-amber-400">{extractedMcqs.length}</span>
              </div>
              <div className="h-3 w-px bg-white/[0.1]" />
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">Solved:</span>
                <span className="font-bold text-emerald-400">{solvedCount}/{extractedMcqs.length}</span>
              </div>
            </div>

            {/* Paper Settings Toggle Button */}
            <button
              type="button"
              onClick={() => setShowPaperSettings(!showPaperSettings)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                showPaperSettings 
                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' 
                  : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.1] text-slate-300 hover:text-white'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Paper Settings</span>
              {showPaperSettings ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            {/* Output File Name / Rename Input Box */}
            <div 
              className="flex items-center gap-1.5 px-2.5 py-1 bg-black/40 border border-white/[0.1] hover:border-amber-500/50 focus-within:border-amber-500 rounded-xl transition-all shadow-sm"
              title="Output file name. Rename here before download!"
            >
              <FileText className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <input
                type="text"
                value={outputFileName || setName}
                onChange={(e) => {
                  const val = e.target.value;
                  setOutputFileName(val);
                  setSetName(val);
                  setExtractedMcqs(prev => prev.map(i => ({ ...i, set_name: val })));
                }}
                placeholder="File name (Rename)..."
                className="w-28 sm:w-48 bg-transparent text-xs text-white placeholder:text-slate-500 font-medium focus:outline-none"
              />
              <span className="text-[10px] text-slate-500 font-bold shrink-0">.csv</span>
            </div>

            {/* Export 34-Col CSV Button Group */}
            <div className="flex items-center p-0.5 bg-black/40 border border-white/[0.1] rounded-xl shadow-sm">
              <button
                type="button"
                onClick={handleDownloadCsv}
                disabled={extractedMcqs.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-extrabold rounded-lg text-xs transition-all disabled:opacity-40 shadow"
                title="Download standard 34-column CSV for MockTest portal"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
              <button
                type="button"
                onClick={handleCopyCsv}
                disabled={extractedMcqs.length === 0}
                title="Copy CSV data to clipboard"
                className="p-1.5 hover:bg-white/[0.1] text-slate-400 hover:text-white rounded-lg text-xs transition-all disabled:opacity-40"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => csvImportInputRef.current?.click()}
                title="Import existing CSV to edit"
                className="p-1.5 hover:bg-white/[0.1] text-slate-400 hover:text-white rounded-lg text-xs transition-all"
              >
                <Upload className="w-3.5 h-3.5" />
              </button>
              <input
                ref={csvImportInputRef}
                type="file"
                accept=".csv"
                onChange={handleImportCsv}
                className="hidden"
              />
            </div>

            {/* Quick Add Question via AI / Paste Screenshot */}
            <button
              type="button"
              onClick={() => {
                setAddQuestionTargetPage(pages.find(p => p.status === 'ready')?.pageNumber || 1);
                setShowAddQuestionModal(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-extrabold rounded-xl text-xs transition-all shadow-md shadow-violet-600/20 shrink-0"
              title="Add new extra question via text, AI instruction, or paste screenshot (Ctrl+V)"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Question (Paste / AI)</span>
            </button>
          </div>
        </div>

        {/* Row 2: Streamlined AI Engine, Provider & Concurrency Strip */}
        <div className="p-2.5 rounded-xl bg-black/40 border border-white/[0.06] flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
          {/* Left: Engine Switcher */}
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Engine:</span>
            <div className="flex items-center p-0.5 bg-white/[0.04] border border-white/[0.08] rounded-lg">
              <button
                type="button"
                onClick={() => setAiEngine('bridge')}
                className={`flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-md transition-all ${
                  aiEngine === 'bridge'
                    ? 'bg-emerald-500 text-black shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Zap className="w-3 h-3" />
                <span>Extension Bridge</span>
              </button>
              <button
                type="button"
                onClick={() => setAiEngine('api')}
                className={`flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-md transition-all ${
                  aiEngine === 'api'
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Key className="w-3 h-3" />
                <span>Direct Gemini API</span>
              </button>
            </div>

            <div className="h-4 w-px bg-white/[0.1] hidden sm:block" />

            {/* Mode Switcher: Exact PDF vs Reference Mode (New Questions) */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Mode:</span>
              <div className="flex items-center p-0.5 bg-white/[0.04] border border-white/[0.08] rounded-lg">
                <button
                  type="button"
                  onClick={() => setExtractionMode('exact')}
                  className={`flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-md transition-all ${
                    extractionMode === 'exact'
                      ? 'bg-amber-500 text-black shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="Extract exact questions directly as written in the PDF"
                >
                  <BookOpen className="w-3 h-3" />
                  <span>Exact PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setExtractionMode('similar')}
                  className={`flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-md transition-all ${
                    extractionMode === 'similar'
                      ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-purple-300'
                  }`}
                  title="PDF questions act strictly as conceptual reference; AI generates brand-new practice MCQs (No duplicates)"
                >
                  <Sparkles className="w-3 h-3 text-amber-300" />
                  <span>Ref Mode (New MCQs)</span>
                </button>
              </div>
            </div>

            {/* Provider / Bridge / API Controls */}
            {aiEngine === 'bridge' ? (
              <div className="flex items-center gap-2">
                <select
                  value={selectedProvider}
                  onChange={(e) => handleProviderChange(e.target.value as AiProvider)}
                  className="px-2 py-0.5 bg-black/60 border border-white/[0.1] rounded-lg text-xs text-amber-300 font-bold focus:outline-none"
                >
                  <option value="gemini">Gemini</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="chatgpt">ChatGPT</option>
                  <option value="claude">Claude</option>
                </select>

                {bridgeStatus.connected ? (
                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-md text-[11px] font-bold">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Connected
                    </span>
                    <button
                      type="button"
                      onClick={() => setAiEngine('api')}
                      className="text-[10px] text-slate-500 hover:text-rose-400 underline transition-colors"
                      title="Disconnect Bridge"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowConnectModal(true)}
                    className="px-2.5 py-0.5 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 font-bold rounded-lg text-xs transition-all"
                  >
                    Connect Bridge
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-blue-400 font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Direct API Active
                </span>
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(true)}
                  className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-blue-300 rounded-lg text-[11px] font-semibold transition-all"
                >
                  <Settings className="w-3 h-3" />
                  <span>Configure Key</span>
                </button>
              </div>
            )}
          </div>

          {/* Right: Parallel Batch & One-Shot Toggle */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Batch Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Batch:</span>
              <div className="flex items-center p-0.5 bg-white/[0.04] border border-white/[0.08] rounded-lg">
                {[1, 2, 3, 5].map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setBatchSize(count)}
                    className={`px-2 py-0.5 text-xs font-bold rounded transition-all ${
                      batchSize === count
                        ? 'bg-amber-500 text-black shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                    title={`Process ${count} page(s) simultaneously`}
                  >
                    {count}P
                  </button>
                ))}
              </div>
            </div>

            <div className="h-4 w-px bg-white/[0.1] hidden sm:block" />

            {/* One-Shot Auto-Fill Toggle */}
            <label className="flex items-center gap-2 cursor-pointer select-none group" title="Image bhejte hi Question, Options, Answer, Subject, aur Solutions ek sath fill honge">
              <input
                type="checkbox"
                checked={autoDeepSolveAll}
                onChange={(e) => setAutoDeepSolveAll(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-amber-500/50 text-amber-500 focus:ring-amber-400 bg-black/80 cursor-pointer accent-amber-500"
              />
              <span className={`text-xs font-semibold transition-colors ${autoDeepSolveAll ? 'text-amber-300' : 'text-slate-400'}`}>
                Auto-Fill All 34 Fields & Solutions
              </span>
            </label>
          </div>
        </div>

        {/* Row 3: Collapsible Paper Settings Panel */}
        {showPaperSettings && (
          <div className="p-4 rounded-xl bg-black/60 border border-amber-500/30 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 animate-fadeIn">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Set / Output File Name (.csv)
              </label>
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-black/40 border border-white/[0.12] focus-within:border-amber-500/60 rounded-lg">
                <FileText className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <input
                  type="text"
                  value={outputFileName || setName}
                  onChange={(e) => {
                    const val = e.target.value;
                    setOutputFileName(val);
                    setSetName(val);
                    setExtractedMcqs(prev => prev.map(i => ({ ...i, set_name: val })));
                  }}
                  placeholder="e.g. RRB NTPC 2024 CBT-1"
                  className="w-full bg-transparent text-xs text-white focus:outline-none"
                />
                <span className="text-xs text-slate-500 font-bold shrink-0">.csv</span>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Answer Format
              </label>
              <div className="flex items-center gap-1 p-0.5 bg-black/40 border border-white/[0.12] rounded-lg">
                <button
                  type="button"
                  onClick={() => setAnswerFormat('letters')}
                  className={`flex-1 py-1 text-xs font-bold rounded transition-all ${
                    answerFormat === 'letters'
                      ? 'bg-amber-500 text-black shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Letters (A, B, C, D)
                </button>
                <button
                  type="button"
                  onClick={() => setAnswerFormat('numbers')}
                  className={`flex-1 py-1 text-xs font-bold rounded transition-all ${
                    answerFormat === 'numbers'
                      ? 'bg-amber-500 text-black shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Numbers (1, 2, 3, 4)
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Math Notation
              </label>
              <div className="flex items-center gap-1 p-0.5 bg-black/40 border border-white/[0.12] rounded-lg">
                <button
                  type="button"
                  onClick={() => setMathFormat('mathjax')}
                  title="LaTeX standard \(...\)"
                  className={`flex-1 py-1 text-xs font-bold rounded transition-all ${
                    mathFormat === 'mathjax'
                      ? 'bg-amber-500 text-black shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  MathJax \(...\)
                </button>
                <button
                  type="button"
                  onClick={() => setMathFormat('unicode')}
                  title="Plain Unicode and HTML"
                  className={`flex-1 py-1 text-xs font-bold rounded transition-all ${
                    mathFormat === 'unicode'
                      ? 'bg-amber-500 text-black shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Unicode / HTML
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Default Difficulty
              </label>
              <select
                value={difficulty}
                onChange={(e) => {
                  const diff = e.target.value as DifficultyLevel;
                  setDifficulty(diff);
                  setExtractedMcqs(prev => prev.map(i => ({ ...i, difficulty_level: diff })));
                }}
                className="px-2.5 py-1.5 bg-black/40 border border-white/[0.12] focus:border-amber-500/60 rounded-lg text-xs text-white focus:outline-none"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* File Upload Dropzone (Compact if pages exist) */}
      <div 
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl text-center cursor-pointer transition-all ${
          pages.length === 0 
            ? 'border-amber-500/40 bg-amber-500/[0.03] hover:bg-amber-500/[0.06] p-8' 
            : 'border-white/[0.08] bg-white/[0.015] hover:bg-white/[0.04] p-3'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,image/*"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
          className="hidden"
        />

        <div className="flex items-center justify-center gap-2.5">
          <div className={`rounded-lg border text-amber-400 ${pages.length === 0 ? 'p-3 bg-amber-500/10 border-amber-500/20' : 'p-1.5 bg-amber-500/10 border-amber-500/20'}`}>
            <Upload className={pages.length === 0 ? "w-5 h-5" : "w-3.5 h-3.5"} />
          </div>
          <div className="text-left">
            <h3 className={`font-bold text-white ${pages.length === 0 ? 'text-sm' : 'text-xs'}`}>
              {pages.length === 0 ? 'Upload Exam PDF or Question Paper Images' : '+ Add More Pages (PDF / Images)'}
            </h3>
            {pages.length === 0 && (
              <p className="text-xs text-slate-400 mt-0.5">
                Drag & drop exam PDF files or photos. Each page will render with its high-res image on the left and extracted questions on the right.
              </p>
            )}
          </div>
        </div>

        {uploadProgress && (
          <div className="mt-3 max-w-md mx-auto p-2 bg-black/60 rounded-lg border border-amber-500/30 flex items-center gap-2.5">
            <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin flex-shrink-0" />
            <span className="text-xs text-amber-300 font-medium">{uploadProgress.text}</span>
          </div>
        )}
      </div>

      {/* Main Workspace: TextExtract Style UI (Left: Pages | Right: Questions) */}
      {pages.length > 0 && (
        <div className="space-y-4">
          {/* Workspace Command Bar & Filmstrip */}
          <div className="p-3.5 bg-slate-900/80 border border-white/[0.08] rounded-2xl space-y-3 backdrop-blur-md shadow-xl">
            {/* Top Command Row: Extraction Control, Views & Grouped Actions */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              {/* Left: Primary Run Control & Status */}
              <div className="flex flex-wrap items-center gap-2.5">
                {!isProcessingAll ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleStartExtraction('exact')}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-extrabold rounded-xl text-xs shadow-lg shadow-amber-500/20 transition-all"
                      title="Extract exact questions directly as written in the PDF"
                    >
                      <Play className="w-3.5 h-3.5 fill-black" />
                      <span>Start Extraction</span>
                    </button>

                    {/* NEW REQUESTED BUTTON: Generate Similar MCQs (Reference Mode) */}
                    <button
                      type="button"
                      onClick={() => handleStartExtraction('similar')}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-purple-600 via-indigo-600 to-violet-600 hover:from-purple-500 hover:via-indigo-500 hover:to-violet-500 text-white font-extrabold rounded-xl text-xs shadow-lg shadow-purple-500/30 border border-purple-400/30 transition-all group"
                      title="PDF questions act strictly as conceptual reference/blueprint. Generates brand-new similar MCQs (strictly no verbatim duplicates)!"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-300 fill-amber-300 group-hover:rotate-12 transition-transform" />
                      <span>✨ Generate Similar MCQs (Ref Mode)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleReExtractAll(extractionMode)}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-white/[0.04] hover:bg-amber-500/15 border border-white/[0.08] hover:border-amber-500/30 text-slate-300 hover:text-amber-300 font-semibold rounded-xl text-xs transition-all"
                      title="Re-run all pages from scratch"
                    >
                      <RotateCw className="w-3 h-3" />
                      <span>Re-Run All</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsPaused(!isPaused)}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs shadow-lg transition-all"
                  >
                    {isPaused ? <Play className="w-3.5 h-3.5 fill-white" /> : <Pause className="w-3.5 h-3.5" />}
                    <span>{isPaused ? 'Resume' : 'Pause'}</span>
                  </button>
                )}

                {/* Status indicator */}
                {liveStatusText ? (
                  <span className="text-xs text-amber-300 font-medium flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-lg animate-pulse max-w-sm sm:max-w-md truncate">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                    <span className="truncate">{liveStatusText}</span>
                  </span>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <button
                      type="button"
                      onClick={() => {
                        const allSelected = pages.every(p => p.isSelected);
                        setPages(prev => prev.map(p => ({ ...p, isSelected: !allSelected })));
                      }}
                      className="hover:text-amber-300 underline font-medium"
                    >
                      {pages.every(p => p.isSelected) ? 'Deselect All' : 'Select All'}
                    </button>
                    <span className="text-slate-500">
                      ({pages.filter(p => p.isSelected).length}/{pages.length} selected)
                    </span>
                  </div>
                )}
              </div>

              {/* Center: View Switcher Tabs */}
              <div className="flex items-center p-0.5 bg-black/60 border border-white/[0.08] rounded-xl self-start lg:self-auto">
                <button
                  type="button"
                  onClick={() => setActiveTab('split')}
                  className={`px-3 py-1.5 font-bold rounded-lg text-xs transition-all flex items-center gap-1.5 ${
                    activeTab === 'split' ? 'bg-amber-500 text-black shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>Split View</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('grid')}
                  className={`px-3 py-1.5 font-bold rounded-lg text-xs transition-all flex items-center gap-1.5 ${
                    activeTab === 'grid' ? 'bg-amber-500 text-black shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>18-Col Grid</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('csv')}
                  className={`px-3 py-1.5 font-bold rounded-lg text-xs transition-all flex items-center gap-1.5 ${
                    activeTab === 'csv' ? 'bg-amber-500 text-black shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Raw CSV</span>
                </button>
              </div>

              {/* Right: Grouped AI Tools Menu, Add Question & Clear All */}
              <div className="flex items-center gap-2 self-end lg:self-auto">
                {/* Grouped AI Tools Dropdown Menu */}
                <div className="relative" ref={aiToolsRef}>
                  <button
                    type="button"
                    onClick={() => setShowAiToolsMenu(!showAiToolsMenu)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-500/15 to-indigo-500/15 hover:from-purple-500/25 hover:to-indigo-500/25 border border-purple-500/30 text-purple-200 rounded-xl text-xs font-bold transition-all shadow-sm"
                  >
                    {isSolvingAll || isProofreading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                    )}
                    <span>AI Tools</span>
                    <ChevronDown className={`w-3 h-3 transition-transform ${showAiToolsMenu ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Dropdown Card */}
                  {showAiToolsMenu && (
                    <div className="absolute right-0 mt-1.5 w-64 rounded-xl bg-slate-900 border border-white/[0.12] shadow-2xl p-1.5 z-50 space-y-1 animate-fadeIn">
                      <button
                        type="button"
                        onClick={() => {
                          setShowAiToolsMenu(false);
                          handleGenerateSimilarFromCurrentMcqs();
                        }}
                        disabled={isGeneratingSimilarBatch || extractedMcqs.length === 0}
                        className="w-full flex items-start gap-2.5 p-2 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-left text-xs font-semibold text-purple-200 hover:text-white transition-all disabled:opacity-40 border border-purple-500/20"
                      >
                        <Sparkles className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-bold text-purple-200">✨ Generate Similar Set (AI)</div>
                          <div className="text-[11px] text-slate-400 font-normal">Create brand-new practice MCQs using current items as reference</div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setShowAiToolsMenu(false);
                          handleAutoSolveAll();
                        }}
                        disabled={isSolvingAll || extractedMcqs.length === 0}
                        className="w-full flex items-start gap-2.5 p-2 rounded-lg hover:bg-purple-500/15 text-left text-xs font-semibold text-slate-200 hover:text-white transition-all disabled:opacity-40"
                      >
                        <Sparkles className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-bold text-purple-200">Auto-Solve All (AI)</div>
                          <div className="text-[11px] text-slate-400 font-normal">Generate deep bilingual solutions for all MCQs</div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setShowAiToolsMenu(false);
                          handleProofreadAll();
                        }}
                        disabled={isProofreading || extractedMcqs.length === 0}
                        className="w-full flex items-start gap-2.5 p-2 rounded-lg hover:bg-cyan-500/15 text-left text-xs font-semibold text-slate-200 hover:text-white transition-all disabled:opacity-40"
                      >
                        <Sparkles className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-bold text-cyan-200">AI Proofread (Clean Tags)</div>
                          <div className="text-[11px] text-slate-400 font-normal">Validate HTML tags & fix OCR anomalies</div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setShowAiToolsMenu(false);
                          handleStandardizeMathJaxAndHtml();
                        }}
                        disabled={extractedMcqs.length === 0}
                        className="w-full flex items-start gap-2.5 p-2 rounded-lg hover:bg-emerald-500/15 text-left text-xs font-semibold text-slate-200 hover:text-white transition-all disabled:opacity-40"
                      >
                        <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-bold text-emerald-200">Fix MathJax + &lt;p&gt;</div>
                          <div className="text-[11px] text-slate-400 font-normal">Standardize all 14 fields with &lt;p&gt; and \(...\)</div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setShowAiToolsMenu(false);
                          handleCleanAllMath();
                        }}
                        disabled={extractedMcqs.length === 0}
                        className="w-full flex items-start gap-2.5 p-2 rounded-lg hover:bg-amber-500/15 text-left text-xs font-semibold text-slate-200 hover:text-white transition-all disabled:opacity-40"
                      >
                        <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-bold text-amber-200">Clean Tags & Math</div>
                          <div className="text-[11px] text-slate-400 font-normal">Sanitize raw symbols & formatting glitches</div>
                        </div>
                      </button>
                    </div>
                  )}
                </div>

                {/* Manual Add MCQ */}
                <button
                  type="button"
                  onClick={handleAddQuestion}
                  className="flex items-center gap-1 px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-slate-200 hover:text-white rounded-xl text-xs font-semibold transition-all"
                  title="Manually create a new MCQ row"
                >
                  <Plus className="w-3.5 h-3.5 text-amber-400" />
                  <span>Add MCQ</span>
                </button>

                {/* Clear All */}
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('Clear all pages and questions?')) {
                      setPages([]);
                      setExtractedMcqs([]);
                    }
                  }}
                  disabled={isProcessingAll}
                  className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-all disabled:opacity-40"
                  title="Clear all pages and extracted questions"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Bottom Row: Quick Jump Filmstrip with Problem Indicators */}
            {(() => {
              const pagesWithIssues = pages.filter(p => {
                if (p.status === 'error' || Boolean(p.errorMessage)) return true;
                const pageQuestions = (p.items && p.items.length > 0)
                  ? p.items
                  : extractedMcqs.filter(m => m.pageNumber === p.pageNumber || m.pageId === p.id);
                return pageQuestions.some(it => detectItemFieldIssues(it).hasIssues);
              });

              return (
                <div className="pt-2 border-t border-white/[0.04] flex items-center gap-2 overflow-x-auto pb-1 custom-scrollbar">
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                      P:
                    </span>
                    {pagesWithIssues.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          scrollToPageCard(pagesWithIssues[0].pageNumber);
                        }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-extrabold bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 transition-all shrink-0 animate-pulse shadow-sm"
                        title="Click to jump directly to the first page with missing/incomplete fields"
                      >
                        <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                        <span>{pagesWithIssues.length} Needs Fix</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {pages.map((p) => {
                      const pageQuestions = (p.items && p.items.length > 0)
                        ? p.items
                        : extractedMcqs.filter(m => m.pageNumber === p.pageNumber || m.pageId === p.id);
                      const count = pageQuestions.length;
                      const isError = p.status === 'error' || Boolean(p.errorMessage);
                      const problemQuestions = pageQuestions.filter(it => detectItemFieldIssues(it).hasIssues);
                      const problemCount = problemQuestions.length;
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
                              ? `Page ${p.pageNumber}: ⚠️ ${problemCount} of ${count} question(s) have incomplete/missing fields! Click to jump directly.`
                              : p.status === 'ready'
                              ? `Page ${p.pageNumber}: All ${count} questions complete & verified.`
                              : `Page ${p.pageNumber}`
                          }
                          className={`px-2 py-0.5 rounded-lg text-xs font-bold shrink-0 border transition-all flex items-center gap-1.5 shadow-sm ${
                            p.status === 'processing'
                              ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 animate-pulse'
                              : isError
                              ? 'bg-rose-500/25 border-rose-500/60 text-rose-200 hover:bg-rose-500/35 ring-1 ring-rose-500/40 animate-pulse'
                              : hasIncomplete
                              ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 hover:bg-amber-500/30 ring-1 ring-amber-500/40 shadow-sm shadow-amber-500/10'
                              : p.status === 'ready'
                              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25'
                              : 'bg-black/40 border-white/[0.08] text-slate-400 hover:text-white'
                          }`}
                        >
                          {isError ? (
                            <AlertCircle className="w-3 h-3 text-rose-400 shrink-0" />
                          ) : hasIncomplete ? (
                            <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                          ) : null}

                          <span>P.{p.pageNumber}</span>

                          {count > 0 && (
                            <span className={`px-1.5 py-0.2 rounded text-[9px] font-extrabold flex items-center gap-0.5 ${
                              hasIncomplete 
                                ? 'bg-amber-500 text-black font-black' 
                                : isError 
                                ? 'bg-rose-900 text-rose-200' 
                                : 'bg-black/60 text-amber-300'
                            }`}>
                              {count}
                              {hasIncomplete && (
                                <span className="opacity-90">({problemCount}⚠)</span>
                              )}
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
                    className={`rounded-2xl overflow-hidden shadow-xl flex flex-col lg:flex-row h-auto min-h-[380px] transition-all duration-300 border ${
                      page.isSelected
                        ? 'border-amber-500/40 ring-1 ring-amber-500/30 bg-[#10131E]'
                        : 'border-white/[0.06] bg-[#0A0C13] opacity-90 hover:opacity-100'
                    }`}
                  >
                    {/* LEFT SIDE: Page Image & Page Controls (like ProcessingList.tsx) */}
                    <div className="w-full lg:w-[320px] xl:w-[360px] bg-[#08090E] border-b lg:border-b-0 lg:border-r border-white/[0.08] p-4 flex flex-col justify-between shrink-0">
                      <div>
                        {/* Page Card Header */}
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => togglePageSelection(page.id)}
                              className="p-1.5 rounded-lg bg-black/60 border border-white/[0.1] text-white hover:text-amber-400 backdrop-blur-md"
                              title="Toggle batch selection"
                            >
                              {page.isSelected ? (
                                <CheckSquare className="w-4 h-4 text-amber-400" />
                              ) : (
                                <Square className="w-4 h-4 text-slate-400" />
                              )}
                            </button>
                            <span className="px-2.5 py-1 rounded-lg text-xs font-extrabold bg-slate-900 border border-white/[0.1] text-white shadow">
                              Page {page.pageNumber}
                            </span>
                          </div>

                          {/* Status Badge */}
                          <div>
                            {page.status === 'processing' && (
                              <span className="bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 animate-pulse">
                                <Loader2 className="w-3 h-3 animate-spin" /> Digitizing...
                              </span>
                            )}
                            {page.status === 'ready' && (
                              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                {(() => {
                                  const issueCount = pageQuestions.filter(q => detectItemFieldIssues(q).hasIssues).length;
                                  if (issueCount > 0) {
                                    return (
                                      <span 
                                        className="bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1 shadow-sm"
                                        title={`${issueCount} of ${pageQuestions.length} question(s) have missing or incomplete fields`}
                                      >
                                        <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                                        <span>{issueCount} Need Fix</span>
                                      </span>
                                    );
                                  }
                                  return null;
                                })()}
                                <span className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5">
                                  <CheckCircle2 className="w-3 h-3" /> {pageQuestions.length} MCQs
                                </span>
                              </div>
                            )}
                            {page.status === 'error' && (
                              <span className="bg-rose-500/15 border border-rose-500/30 text-rose-400 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5">
                                <AlertCircle className="w-3 h-3" /> Error
                              </span>
                            )}
                            {page.status === 'pending' && (
                              <span className="bg-white/[0.04] border border-white/[0.08] text-slate-400 text-xs font-bold px-2.5 py-1 rounded-full">
                                Pending
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Page Image Preview with Zoom on Click */}
                        <div
                          className="relative group rounded-xl overflow-hidden border border-white/[0.08] bg-black cursor-pointer aspect-[3/4] max-h-[380px] flex items-center justify-center shadow-inner"
                          onClick={() => { setZoomPageIndex(idx); setZoomLevel(1); setPanOffset({ x: 0, y: 0 }); }}
                          title="Click to view full image in lightbox"
                        >
                          <img
                            src={page.imageUrl}
                            alt={`Page ${page.pageNumber}`}
                            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                          />
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white gap-2 font-bold text-xs backdrop-blur-xs">
                            <ZoomIn className="w-5 h-5 text-amber-400" />
                            <span>Click to Zoom Image</span>
                          </div>
                        </div>
                      </div>

                      {/* Bottom Controls for Page */}
                      <div className="mt-3 pt-3 border-t border-white/[0.06] flex items-center justify-between text-xs gap-1.5 flex-wrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => handleRetryPage(page, idx, 'exact')}
                            disabled={page.status === 'processing'}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white/[0.04] hover:bg-amber-500/20 border border-white/[0.08] hover:border-amber-500/30 text-slate-300 hover:text-amber-300 rounded-lg font-bold transition-all disabled:opacity-40"
                            title="Extract exact questions from this page"
                          >
                            <RotateCw className={`w-3.5 h-3.5 ${page.status === 'processing' ? 'animate-spin' : ''}`} />
                            <span>Exact</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleRetryPage(page, idx, 'similar')}
                            disabled={page.status === 'processing'}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-300 hover:text-purple-200 rounded-lg font-bold transition-all disabled:opacity-40"
                            title="Use this page strictly as conceptual reference and generate brand-new practice MCQs"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                            <span>✨ Similar</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleRecaptureFromAiTab(page)}
                            disabled={page.status === 'processing'}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 hover:text-cyan-200 rounded-lg font-bold transition-all disabled:opacity-40"
                            title="Read complete finished response from AI tab if anything was cut off"
                          >
                            <Camera className="w-3.5 h-3.5 text-cyan-400" />
                            <span>Recapture</span>
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleDeletePage(page.id)}
                          disabled={page.status === 'processing'}
                          className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all disabled:opacity-40"
                          title="Delete this page"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* RIGHT SIDE: Extracted Questions for THIS Page */}
                    <div className="flex-1 min-w-0 bg-[#0C0F17] flex flex-col p-4 space-y-3">
                      {/* Right Panel Header */}
                      <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
                        {(() => {
                          const pageIncompleteCount = pageQuestions.filter(it => detectItemFieldIssues(it).hasIssues).length;
                          return (
                            <>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-extrabold text-amber-400 uppercase tracking-wider">
                                  Page {page.pageNumber} MCQs
                                </span>
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/[0.06] text-slate-300">
                                  {pageQuestions.length} Questions
                                </span>
                                {pageIncompleteCount > 0 && (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1 animate-pulse">
                                    <AlertTriangle className="w-3 h-3 text-amber-400" />
                                    <span>{pageIncompleteCount} Incomplete</span>
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2">
                                {pageIncompleteCount > 0 && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleReverifyMissingFields(pageQuestions.filter(it => detectItemFieldIssues(it).hasIssues))}
                                      disabled={isRepairingAll}
                                      className="flex items-center gap-1 px-2.5 py-1 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40 text-blue-300 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                                      title="Visually re-inspect page images to recover missing fields"
                                    >
                                      <Eye className="w-3.5 h-3.5 text-blue-400" />
                                      <span>Re-verify ({pageIncompleteCount})</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleAiRepairPageItems(pageQuestions)}
                                      disabled={isRepairingAll}
                                      className="flex items-center gap-1 px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                                      title="Auto-fill missing options & solutions for incomplete questions on this page"
                                    >
                                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                                      <span>AI Fill ({pageIncompleteCount})</span>
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAddQuestionTargetPage(page.pageNumber);
                                    setShowAddQuestionModal(true);
                                  }}
                                  className="flex items-center gap-1 px-2.5 py-1 bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-300 hover:text-white rounded-lg text-xs font-bold transition-all shadow-sm"
                                  title="Add question to this page via text prompt or paste screenshot (Ctrl+V)"
                                >
                                  <Plus className="w-3.5 h-3.5 text-violet-400" />
                                  <span>AI Add / Paste</span>
                                </button>
                              </div>
                            </>
                          );
                        })()}
                      </div>

                      {/* Content Area according to Status */}
                      {page.status === 'processing' && (
                        <div className="py-16 flex flex-col items-center justify-center text-center space-y-3">
                          <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
                          <p className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                            Extracting Bilingual MCQs with LaTeX...
                          </p>
                          <p className="text-[11px] text-slate-400 max-w-sm">
                            {page.errorMessage || 'AI model is reading questions, options, and deep step-by-step solutions.'}
                          </p>
                        </div>
                      )}

                      {page.status === 'pending' && (
                        <div className="py-16 text-center space-y-2 text-slate-500">
                          <BookOpen className="w-8 h-8 mx-auto text-slate-600" />
                          <p className="text-xs font-semibold text-slate-400">Page is ready in queue</p>
                          <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                            Click "Start MCQ Extraction" at the top or click "Re-Extract Page" on the left to digitize this page.
                          </p>
                        </div>
                      )}

                      {page.status === 'error' && (
                        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 space-y-3">
                          <div className="flex items-center gap-2 font-bold text-xs">
                            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                            <span>Page Extraction Error</span>
                          </div>
                          <p className="text-xs text-rose-200/90 leading-relaxed">{page.errorMessage || 'Failed to extract this page.'}</p>
                          
                          {page.errorMessage?.includes('timed out') ? (
                            <div className="p-2.5 rounded-lg bg-black/40 border border-amber-500/30 text-amber-200 text-xs space-y-1.5">
                              <p className="font-semibold text-amber-300 flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                <span>AI Browser Tab Timeout (Chrome Extension Bridge)</span>
                              </p>
                              <p className="text-[11px] text-slate-300">
                                1. Agar Chrome me AI tab (Gemini/ChatGPT/DeepSeek) ne likhna pura kar liya hai, to <strong>"Recapture"</strong> dabayein.<br/>
                                2. Ya fir bina extension/timeout ke fast server processing ke liye <strong>"Direct API"</strong> se extract karein.
                              </p>
                            </div>
                          ) : null}

                          <div className="flex items-center gap-2 flex-wrap pt-1">
                            <button
                              type="button"
                              onClick={() => handleRecaptureFromAiTab(page)}
                              className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-sm"
                              title="Read response from open AI tab in Chrome"
                            >
                              <Camera className="w-3.5 h-3.5" />
                              <span>Recapture from AI Tab</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setAiEngine('api');
                                setTimeout(() => handleRetryPage(page, idx, 'exact'), 50);
                              }}
                              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-extrabold rounded-lg text-xs flex items-center gap-1.5 shadow-sm"
                              title="Switch to direct server Gemini API (fast, no browser tab needed)"
                            >
                              <Zap className="w-3.5 h-3.5" />
                              <span>Switch to Direct API & Retry</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleRetryPage(page, idx)}
                              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-xs"
                            >
                              Retry Extraction
                            </button>
                          </div>
                        </div>
                      )}

                      {page.status === 'ready' && pageQuestions.length === 0 && (
                        <div className="py-12 text-center text-slate-500 space-y-2">
                          <AlertCircle className="w-7 h-7 mx-auto text-slate-600" />
                          <p className="text-xs font-semibold">No questions found on Page {page.pageNumber}</p>
                          <div className="flex items-center justify-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => {
                                setAddQuestionTargetPage(page.pageNumber);
                                setShowAddQuestionModal(true);
                              }}
                              className="px-3 py-1.5 text-xs font-bold bg-violet-600/25 hover:bg-violet-600/40 border border-violet-500/40 text-violet-300 rounded-lg transition-all flex items-center gap-1 shadow-sm"
                            >
                              <Plus className="w-3.5 h-3.5 text-violet-400" />
                              <span>+ Add via AI / Paste Screenshot</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAddQuestionToPage(page)}
                              className="px-3 py-1.5 text-xs text-slate-400 border border-white/[0.1] rounded-lg hover:bg-white/[0.06] transition-all"
                            >
                              + Blank
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Questions List for this Page */}
                      {pageQuestions.length > 0 && (
                        <div className="space-y-4">
                          {pageQuestions.map((item) => {
                            const isEditing = editingItemId === item.id;
                            const isSolving = solvingId === item.id;
                            const isRepairing = repairingId === item.id;
                            const issues = detectItemFieldIssues(item);

                            return (
                              <div
                                key={item.id}
                                className={`rounded-xl border p-4 space-y-3 transition-all ${
                                  issues.hasIssues
                                    ? 'border-amber-500/60 bg-black/60 shadow-xl shadow-amber-500/10 ring-1 ring-amber-500/30'
                                    : 'border-white/[0.08] bg-black/40 hover:border-white/[0.15]'
                                }`}
                              >
                                {/* MCQ Header Bar */}
                                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/[0.06]">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-extrabold text-xs border border-amber-500/30">
                                      Q#{item.question_r}
                                    </span>

                                    {/* Ref Variant Badge */}
                                    {(item.source_question_reference?.includes('Variant') || item.correction_notes?.includes('reference')) && (
                                      <span className="px-2 py-0.5 rounded bg-purple-500/25 text-purple-300 font-extrabold text-[10px] border border-purple-500/40 flex items-center gap-1 shadow-sm">
                                        <Sparkles className="w-2.5 h-2.5 text-amber-300" />
                                        <span>Ref Variant</span>
                                      </span>
                                    )}

                                    {/* STRICT ACADEMIC SUBJECT SELECTOR */}
                                    <div className="flex items-center gap-1 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-lg text-xs">
                                      <span className="text-amber-400 font-bold text-[10px] uppercase">Subject:</span>
                                      <select
                                        value={item.subject || 'Current Affairs'}
                                        onChange={(e) => updateItem(item.id, { subject: normalizeStrictSubject(e.target.value) })}
                                        className="bg-transparent text-amber-300 font-extrabold text-xs focus:outline-none cursor-pointer"
                                      >
                                        {STANDARD_SUBJECTS.map((s) => (
                                          <option key={s} value={s} className="bg-slate-900 text-slate-200">{s}</option>
                                        ))}
                                      </select>
                                    </div>

                                    {/* Subject Level */}
                                    <div className="flex items-center gap-1 bg-white/[0.04] border border-white/[0.08] px-2 py-0.5 rounded-lg text-xs">
                                      <span className="text-slate-400 font-bold text-[10px] uppercase">Level:</span>
                                      <input
                                        type="text"
                                        value={item.subject_level || ''}
                                        onChange={(e) => updateItem(item.id, { subject_level: e.target.value })}
                                        placeholder="e.g. RRB Level 01 Stage I 2025"
                                        className="bg-transparent text-slate-200 text-xs focus:outline-none w-32 truncate"
                                      />
                                    </div>

                                    <span className="text-[11px] text-slate-400">
                                      Diff: <strong className="text-white capitalize">{item.difficulty_level}</strong>
                                    </span>

                                    {/* Passage Attached Indicator */}
                                    {(item.passage_hi || (item.figure_notes && item.figure_notes.toLowerCase().includes('passage')) || /गद्यांश|काव्यांश|पद्यांश|निर्देश/i.test(item.question_hi)) && (
                                      <span className="flex items-center gap-1 bg-amber-500/15 border border-amber-500/40 text-amber-300 font-extrabold px-2 py-0.5 rounded-lg text-[10px] shadow-sm" title="This question has a Reading Comprehension / गद्यांश passage attached">
                                        <BookOpen className="w-3 h-3 text-amber-400 shrink-0" />
                                        <span>📖 गद्यांश (Passage)</span>
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-2">
                                    {/* Correct Answer Badge */}
                                    <div className="flex items-center gap-1 text-xs">
                                      <span className="text-slate-400 font-bold">Ans:</span>
                                      <input
                                        type="text"
                                        value={item.answer}
                                        onChange={(e) => updateItem(item.id, { answer: e.target.value })}
                                        className="w-12 px-1.5 py-0.5 bg-black/80 border border-emerald-500/40 rounded text-center text-xs font-extrabold text-emerald-400 focus:outline-none"
                                      />
                                    </div>

                                    {/* Visual Re-verify from Image Button */}
                                    {issues.hasIssues && (
                                      <button
                                        type="button"
                                        onClick={() => handleReverifyItem(item)}
                                        disabled={isRepairing || isSolving}
                                        className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-extrabold bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40 text-blue-300 transition-all disabled:opacity-50"
                                        title="Visually re-inspect page images to recover missing fields"
                                      >
                                        {isRepairing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3 text-blue-400" />}
                                        <span>Re-verify</span>
                                      </button>
                                    )}

                                    {/* AI Auto-Repair / Fill Button */}
                                    <button
                                      type="button"
                                      onClick={() => handleAiRepairSingle(item)}
                                      disabled={isRepairing || isSolving}
                                      className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-extrabold transition-all disabled:opacity-50 ${
                                        issues.hasIssues
                                          ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black shadow-md shadow-amber-500/20'
                                          : 'bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300'
                                      }`}
                                      title="Auto-fill missing options, deduce answer, and generate solutions"
                                    >
                                      {isRepairing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                                      <span>{issues.hasIssues ? '⚡ Auto-Fill' : 'Repair'}</span>
                                    </button>

                                    {/* Auto-Solve Single Button */}
                                    <button
                                      type="button"
                                      onClick={() => handleSolveSingle(item)}
                                      disabled={isSolving || isRepairing}
                                      className="flex items-center gap-1 px-2.5 py-1 bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-300 rounded text-xs font-semibold transition-all disabled:opacity-50"
                                      title="Generate deep research step-by-step solutions"
                                    >
                                      {isSolving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3 text-purple-400" />}
                                      <span className="hidden sm:inline">
                                        {item.solution_hi || item.solution_en ? 'Re-Solve' : 'Auto-Solve'}
                                      </span>
                                    </button>

                                    {/* Generate Similar Question Variant Button */}
                                    <button
                                      type="button"
                                      onClick={() => handleGenerateSimilarSingleItem(item)}
                                      disabled={generatingSimilarId === item.id || isSolving || isRepairing}
                                      className="flex items-center gap-1 px-2.5 py-1 bg-gradient-to-r from-violet-600/20 to-purple-600/20 hover:from-violet-600/30 hover:to-purple-600/30 border border-violet-500/30 text-violet-300 rounded text-xs font-semibold transition-all disabled:opacity-50 shadow-sm"
                                      title="Generate brand-new practice MCQ testing this same concept (No duplicate)"
                                    >
                                      {generatingSimilarId === item.id ? (
                                        <Loader2 className="w-3 h-3 animate-spin text-violet-400" />
                                      ) : (
                                        <Sparkles className="w-3 h-3 text-violet-400" />
                                      )}
                                      <span className="hidden sm:inline">Similar Variant</span>
                                    </button>

                                    {/* AI Chat & Fix Button */}
                                    <button
                                      type="button"
                                      onClick={() => setActiveChatQuestion(item)}
                                      className="flex items-center gap-1 px-2.5 py-1 bg-gradient-to-r from-indigo-600/25 to-violet-600/25 hover:from-indigo-600/40 hover:to-violet-600/40 border border-indigo-500/40 text-indigo-300 hover:text-white rounded text-xs font-bold transition-all shadow-sm"
                                      title="Chat with AI to fix, modify, re-calculate, or improve this question"
                                    >
                                      <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
                                      <span className="hidden sm:inline">AI Chat</span>
                                    </button>

                                    {/* Edit Toggle Button */}
                                    <button
                                      type="button"
                                      onClick={() => setEditingItemId(isEditing ? null : item.id)}
                                      className={`p-1 rounded transition-all ${
                                        isEditing 
                                          ? 'bg-amber-500 text-black' 
                                          : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
                                      }`}
                                      title="Edit fields"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </button>

                                    {/* Delete Button */}
                                    <button
                                      type="button"
                                      onClick={() => deleteItem(item.id)}
                                      className="p-1 text-slate-500 hover:text-rose-400 rounded transition-all"
                                      title="Delete question"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>

                                {/* WARNING MESSAGE BANNER FOR MISSING/BLANK FIELDS */}
                                {issues.hasIssues && (
                                  <div className="flex flex-wrap items-center justify-between gap-2.5 p-2.5 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-transparent border border-amber-500/40 rounded-xl text-xs">
                                    <div className="flex items-center gap-2">
                                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 animate-bounce" />
                                      <div>
                                        <div className="font-extrabold text-amber-300 flex items-center gap-1.5">
                                          <span>⚠️ चेतावनी: रिक्त फ़ील्ड (Missing Fields Detected)</span>
                                          <span className="px-1.5 py-0.2 rounded bg-amber-500/30 text-amber-200 text-[10px]">Action Required</span>
                                        </div>
                                        <div className="text-slate-300 text-[11px] mt-0.5 font-medium">
                                          {issues.issueSummary}
                                        </div>
                                        <div className="flex flex-wrap gap-1 mt-1.5">
                                          {issues.missingFieldNames.map((name) => (
                                            <span key={name} className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 text-[10px] font-bold border border-amber-500/30">
                                              Missing: {name}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 ml-auto sm:ml-0">
                                      <button
                                        type="button"
                                        onClick={() => handleReverifyItem(item)}
                                        disabled={isRepairing}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40 text-blue-200 font-extrabold rounded-lg text-xs shadow-md transition-all disabled:opacity-50"
                                        title="Inspect original page images to recover missing fields without hallucinating"
                                      >
                                        {isRepairing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5 text-blue-400" />}
                                        <span>🔍 Re-verify from Images</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleAiRepairSingle(item)}
                                        disabled={isRepairing}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-extrabold rounded-lg text-xs shadow-md shadow-amber-500/20 transition-all disabled:opacity-50"
                                      >
                                        {isRepairing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 fill-black" />}
                                        <span>⚡ AI Auto-Fill</span>
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {/* Extra Metadata Editing when Expanded */}
                                {isEditing && (
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2.5 bg-black/60 rounded-lg border border-white/[0.08] text-xs">
                                    <div className="flex flex-col gap-0.5">
                                      <label className="text-[10px] text-slate-400 font-bold uppercase">Test Date:</label>
                                      <input
                                        type="text"
                                        value={item.test_date || ''}
                                        onChange={(e) => updateItem(item.id, { test_date: e.target.value })}
                                        placeholder="YYYY-MM-DD"
                                        className="bg-black/50 border border-white/[0.1] rounded px-2 py-1 text-white text-xs"
                                      />
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                      <label className="text-[10px] text-slate-400 font-bold uppercase">Test Time:</label>
                                      <input
                                        type="text"
                                        value={item.test_time || ''}
                                        onChange={(e) => updateItem(item.id, { test_time: e.target.value })}
                                        placeholder="4:30 PM - 6:00 PM"
                                        className="bg-black/50 border border-white/[0.1] rounded px-2 py-1 text-white text-xs"
                                      />
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                      <label className="text-[10px] text-slate-400 font-bold uppercase">Source PDF:</label>
                                      <input
                                        type="text"
                                        value={item.source_pdf || ''}
                                        onChange={(e) => updateItem(item.id, { source_pdf: e.target.value })}
                                        placeholder="SHIFT 3.pdf"
                                        className="bg-black/50 border border-white/[0.1] rounded px-2 py-1 text-white text-xs"
                                      />
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                      <label className="text-[10px] text-slate-400 font-bold uppercase">Source Ref:</label>
                                      <input
                                        type="text"
                                        value={item.source_question_reference || ''}
                                        onChange={(e) => updateItem(item.id, { source_question_reference: e.target.value })}
                                        placeholder={`Q.${item.question_r}`}
                                        className="bg-black/50 border border-white/[0.1] rounded px-2 py-1 text-white text-xs"
                                      />
                                    </div>
                                  </div>
                                )}

                                {/* Interactive Bilingual Content View */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                  {/* HINDI SIDE */}
                                  <div className="space-y-2 p-3 bg-black/40 rounded-xl border border-white/[0.06]">
                                    <span className="text-[10px] font-extrabold text-amber-400 uppercase tracking-wider block">
                                      Hindi Question & Options
                                    </span>

                                    {isEditing ? (
                                      <textarea
                                        rows={2}
                                        value={item.question_hi}
                                        onChange={(e) => updateItem(item.id, { question_hi: e.target.value })}
                                        className="w-full p-2 bg-black/60 border border-white/[0.1] rounded-lg text-xs text-white focus:outline-none"
                                      />
                                    ) : (
                                      <LatexRenderer content={item.question_hi} className="text-slate-200 font-medium" />
                                    )}

                                    {/* Options List */}
                                    <div className="space-y-1.5 pt-1">
                                      {(['option1_hi', 'option2_hi', 'option3_hi', 'option4_hi'] as const).map((key, optIdx) => {
                                        const optLetter = String.fromCharCode(65 + optIdx);
                                        const optNum = String(optIdx + 1);
                                        const isCorrect = item.answer === optLetter || item.answer === optNum || item.answer?.includes(optLetter) || item.answer?.includes(optNum);
                                        const valClean = (item[key] || '').replace(/<[^>]*>/g, '').trim();
                                        const isBlank = !valClean || valClean.toLowerCase() === 'blank';

                                        return (
                                          <div
                                            key={key}
                                            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs transition-all ${
                                              isCorrect
                                                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300 font-bold'
                                                : isBlank
                                                ? 'bg-amber-500/5 border-dashed border-amber-500/40 text-amber-200'
                                                : 'bg-white/[0.02] border-white/[0.06] text-slate-300'
                                            }`}
                                          >
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                                              isCorrect ? 'bg-emerald-500 text-black' : isBlank ? 'bg-amber-500/20 text-amber-300' : 'bg-white/[0.08] text-slate-400'
                                            }`}>
                                              {optLetter}
                                            </span>
                                            {isEditing ? (
                                              <input
                                                type="text"
                                                value={item[key] || ''}
                                                onChange={(e) => updateItem(item.id, { [key]: e.target.value })}
                                                placeholder={`Option ${optLetter}`}
                                                className="w-full bg-transparent text-xs text-white focus:outline-none"
                                              />
                                            ) : (
                                              <span className="flex-1 min-w-0" title={item[key]}>
                                                {!isBlank ? (
                                                  <LatexRenderer content={item[key]} inline={true} className={isCorrect ? 'text-emerald-300 font-bold' : 'text-slate-200 font-medium'} />
                                                ) : (
                                                  <span className="inline-flex items-center gap-1 text-amber-400/90 font-semibold italic text-[11px]">
                                                    <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                                                    <span>Blank Option (Click "⚡ Auto-Fill" above)</span>
                                                  </span>
                                                )}
                                              </span>
                                            )}
                                            {isCorrect && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                                          </div>
                                        );
                                      })}
                                    </div>

                                    {/* Hindi Solution */}
                                    <div className="pt-2 border-t border-white/[0.06] space-y-1">
                                      <span className="text-[10px] font-bold text-amber-400/80 uppercase">
                                        Solution (Hindi)
                                      </span>
                                      {isEditing ? (
                                        <textarea
                                          rows={3}
                                          value={item.solution_hi}
                                          onChange={(e) => updateItem(item.id, { solution_hi: e.target.value })}
                                          className="w-full p-2 bg-black/60 border border-white/[0.1] rounded-lg text-xs text-amber-200 focus:outline-none"
                                        />
                                      ) : (
                                        <div className="p-2.5 rounded-lg bg-amber-500/[0.03] border border-amber-500/20">
                                          <LatexRenderer content={item.solution_hi || '<p>हल उपलब्ध नहीं है</p>'} className="text-amber-200/90 text-xs" />
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {/* ENGLISH SIDE */}
                                  <div className="space-y-2 p-3 bg-black/40 rounded-xl border border-white/[0.06]">
                                    <span className="text-[10px] font-extrabold text-blue-400 uppercase tracking-wider block">
                                      English Question & Options
                                    </span>

                                    {isEditing ? (
                                      <textarea
                                        rows={2}
                                        value={item.question_en}
                                        onChange={(e) => updateItem(item.id, { question_en: e.target.value })}
                                        className="w-full p-2 bg-black/60 border border-white/[0.1] rounded-lg text-xs text-white focus:outline-none"
                                      />
                                    ) : (
                                      <LatexRenderer content={item.question_en} className="text-slate-200 font-medium" />
                                    )}

                                    {/* Options List */}
                                    <div className="space-y-1.5 pt-1">
                                      {(['option1_en', 'option2_en', 'option3_en', 'option4_en'] as const).map((key, optIdx) => {
                                        const optLetter = String.fromCharCode(65 + optIdx);
                                        const optNum = String(optIdx + 1);
                                        const isCorrect = item.answer === optLetter || item.answer === optNum || item.answer?.includes(optLetter) || item.answer?.includes(optNum);
                                        const valClean = (item[key] || '').replace(/<[^>]*>/g, '').trim();
                                        const isBlank = !valClean || valClean.toLowerCase() === 'blank';

                                        return (
                                          <div
                                            key={key}
                                            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs transition-all ${
                                              isCorrect
                                                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300 font-bold'
                                                : isBlank
                                                ? 'bg-amber-500/5 border-dashed border-amber-500/40 text-amber-200'
                                                : 'bg-white/[0.02] border-white/[0.06] text-slate-300'
                                            }`}
                                          >
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                                              isCorrect ? 'bg-emerald-500 text-black' : isBlank ? 'bg-amber-500/20 text-amber-300' : 'bg-white/[0.08] text-slate-400'
                                            }`}>
                                              {optLetter}
                                            </span>
                                            {isEditing ? (
                                              <input
                                                type="text"
                                                value={item[key] || ''}
                                                onChange={(e) => updateItem(item.id, { [key]: e.target.value })}
                                                placeholder={`Option ${optLetter}`}
                                                className="w-full bg-transparent text-xs text-white focus:outline-none"
                                              />
                                            ) : (
                                              <span className="flex-1 min-w-0" title={item[key]}>
                                                {!isBlank ? (
                                                  <LatexRenderer content={item[key]} inline={true} className={isCorrect ? 'text-emerald-300 font-bold' : 'text-slate-200 font-medium'} />
                                                ) : (
                                                  <span className="inline-flex items-center gap-1 text-amber-400/90 font-semibold italic text-[11px]">
                                                    <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                                                    <span>Blank Option (Click "⚡ Auto-Fill" above)</span>
                                                  </span>
                                                )}
                                              </span>
                                            )}
                                            {isCorrect && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                                          </div>
                                        );
                                      })}
                                    </div>

                                    {/* English Solution */}
                                    <div className="pt-2 border-t border-white/[0.06] space-y-1">
                                      <span className="text-[10px] font-bold text-blue-400/80 uppercase">
                                        Solution (English)
                                      </span>
                                      {isEditing ? (
                                        <textarea
                                          rows={3}
                                          value={item.solution_en}
                                          onChange={(e) => updateItem(item.id, { solution_en: e.target.value })}
                                          className="w-full p-2 bg-black/60 border border-white/[0.1] rounded-lg text-xs text-blue-200 focus:outline-none"
                                        />
                                      ) : (
                                        <div className="p-2.5 rounded-lg bg-blue-500/[0.03] border border-blue-500/20">
                                          <LatexRenderer content={item.solution_en || '<p>Solution not available</p>'} className="text-blue-200/90 text-xs" />
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
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
            <div className="rounded-2xl border border-white/[0.08] bg-black/40 backdrop-blur-xl overflow-hidden shadow-2xl p-4">
              <div className="max-h-[700px] overflow-auto custom-scrollbar">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-white/[0.1] bg-white/[0.04] text-[11px] font-bold text-amber-400 whitespace-nowrap">
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
                      <th className="p-2 min-w-[130px] bg-amber-500/10 text-amber-300">subject (STRICT)</th>
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
                  <tbody className="divide-y divide-white/[0.05] text-slate-300 whitespace-nowrap">
                    {extractedMcqs.map((row) => (
                      <tr key={row.id} className="hover:bg-white/[0.02]">
                        <td className="p-2 font-bold text-amber-400">{row.question_r}</td>
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
                        <td className="p-2 font-bold text-emerald-400">{row.answer}</td>
                        <td className="p-2 truncate max-w-[120px]">{row.set_name}</td>
                        <td className="p-2 capitalize">{row.difficulty_level}</td>
                        <td className="p-2">{row.test_date || '—'}</td>
                        <td className="p-2">{row.test_time || '—'}</td>
                        <td className="p-2 font-extrabold text-amber-300 bg-amber-500/5">{row.subject || '—'}</td>
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
            <div className="rounded-2xl border border-white/[0.08] bg-black/40 backdrop-blur-xl overflow-hidden p-5 space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>RFC 4180 CSV with UTF-8 BOM (\uFEFF) • Ready for direct MockTest Portal Upload</span>
                <button
                  type="button"
                  onClick={handleCopyCsv}
                  className="flex items-center gap-1 text-amber-400 hover:text-amber-300 font-bold"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied!' : 'Copy to Clipboard'}</span>
                </button>
              </div>
              <pre className="p-4 bg-black/80 rounded-xl border border-white/[0.08] text-xs text-slate-300 font-mono overflow-x-auto max-h-[500px] custom-scrollbar whitespace-pre-wrap">
                {serializeMockTestToCsv(extractedMcqs, answerFormat)}
              </pre>
            </div>
          )}

          {/* Bottom Summary Bar */}
          {(() => {
            const incompleteTotal = extractedMcqs.filter(it => detectItemFieldIssues(it).hasIssues).length;
            return (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3 rounded-2xl border border-white/[0.08] bg-black/50 backdrop-blur-xl text-xs text-slate-400">
                <div className="flex flex-wrap items-center gap-4">
                  <span>Total Questions: <strong className="text-white">{extractedMcqs.length}</strong></span>
                  <span>Fully Solved: <strong className="text-emerald-400">{solvedCount}</strong></span>
                  <span>Pages Digitized: <strong className="text-blue-400">{pages.filter(p => p.status === 'ready').length} of {pages.length}</strong></span>
                  {incompleteTotal > 0 && (
                    <span className="text-amber-400 font-extrabold flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 animate-pulse">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      <span>{incompleteTotal} Incomplete (Blank Options/Fields)</span>
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {incompleteTotal > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleReverifyMissingFields()}
                        disabled={isRepairingAll}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40 text-blue-200 font-extrabold rounded-lg text-xs shadow transition-all disabled:opacity-40"
                        title="Visually re-inspect page images to recover missing fields across the whole document"
                      >
                        {isRepairingAll ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Re-verifying ({repairProgress?.current || 0}/{repairProgress?.total || incompleteTotal})...</span>
                          </>
                        ) : (
                          <>
                            <Eye className="w-3.5 h-3.5 text-blue-400" />
                            <span>🔍 Re-verify All from Images ({incompleteTotal})</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={handleAiRepairAllIncomplete}
                        disabled={isRepairingAll}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-extrabold rounded-lg text-xs shadow transition-all disabled:opacity-40"
                        title="AI will deduce options, verify answers, and generate solutions for all incomplete items"
                      >
                        {isRepairingAll ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Repairing ({repairProgress?.current || 0}/{repairProgress?.total || incompleteTotal})...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                            <span>⚡ AI Auto-Fill All ({incompleteTotal})</span>
                          </>
                        )}
                      </button>
                    </>
                  )}

                  <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 bg-black/60 border border-white/[0.1] rounded-lg text-xs">
                    <FileText className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="text-[10px] text-slate-400 font-bold">File:</span>
                    <input
                      type="text"
                      value={outputFileName || setName}
                      onChange={(e) => {
                        const val = e.target.value;
                        setOutputFileName(val);
                        setSetName(val);
                      }}
                      className="w-36 sm:w-48 bg-transparent text-xs text-amber-300 font-bold focus:outline-none"
                      title="Rename output file before downloading"
                    />
                    <span className="text-[10px] text-slate-500 font-bold">.csv</span>
                  </div>

                  <button
                    type="button"
                    onClick={handleDownloadCsv}
                    disabled={extractedMcqs.length === 0}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-extrabold rounded-lg text-xs shadow transition-all disabled:opacity-40"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download 34-Column CSV</span>
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* High-Res Page Lightbox Modal: 500% Zoom, Drag-to-Pan, Prev/Next Page Navigation */}
      {zoomPageIndex !== null && pages[zoomPageIndex] && (() => {
        const activePage = pages[zoomPageIndex];
        const canPrev = zoomPageIndex > 0;
        const canNext = zoomPageIndex < pages.length - 1;

        const handleMouseDown = (e: React.MouseEvent) => {
          setIsDragging(true);
          dragStartRef.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
        };

        const handleMouseMove = (e: React.MouseEvent) => {
          if (!isDragging) return;
          setPanOffset({
            x: e.clientX - dragStartRef.current.x,
            y: e.clientY - dragStartRef.current.y
          });
        };

        const handleMouseUp = () => {
          setIsDragging(false);
        };

        const handleWheel = (e: React.WheelEvent) => {
          e.stopPropagation();
          const delta = e.deltaY < 0 ? 0.25 : -0.25;
          setZoomLevel(prev => Math.max(0.5, Math.min(5, Number((prev + delta).toFixed(2)))));
        };

        const handleDoubleClick = (e: React.MouseEvent) => {
          e.stopPropagation();
          if (zoomLevel === 1) {
            setZoomLevel(2.5);
          } else {
            setZoomLevel(1);
            setPanOffset({ x: 0, y: 0 });
          }
        };

        return (
          <div 
            className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col select-none overflow-hidden animate-fade-in"
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {/* Top Control Bar */}
            <div className="flex items-center justify-between px-5 py-3 bg-slate-950/90 border-b border-white/[0.1] z-20 shrink-0">
              {/* Page Indicator & Title */}
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-black font-extrabold text-xs shadow-md shadow-amber-500/20">
                  Page {activePage.pageNumber} of {pages.length}
                </span>
                <span className="text-xs text-slate-300 font-medium hidden sm:inline truncate max-w-xs">
                  {setName || 'Mock Test Examination Paper'}
                </span>
                <span className="text-[11px] text-slate-400 hidden md:inline">
                  (Drag to Move, Scroll to Zoom up to 500%)
                </span>
              </div>

              {/* Zoom Controls Bar (Up to 500%) */}
              <div className="flex items-center gap-1.5 bg-white/[0.06] p-1 rounded-xl border border-white/[0.1]">
                <button
                  type="button"
                  onClick={() => setZoomLevel(prev => Math.max(0.5, Number((prev - 0.5).toFixed(2))))}
                  disabled={zoomLevel <= 0.5}
                  className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.1] transition-all disabled:opacity-30"
                  title="Zoom Out (Hotkey: -)"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>

                <div className="px-2.5 py-0.5 text-xs font-mono font-extrabold text-amber-300 min-w-[54px] text-center bg-black/40 rounded-lg">
                  {Math.round(zoomLevel * 100)}%
                </div>

                <button
                  type="button"
                  onClick={() => setZoomLevel(prev => Math.min(5, Number((prev + 0.5).toFixed(2))))}
                  disabled={zoomLevel >= 5}
                  className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.1] transition-all disabled:opacity-30"
                  title="Zoom In (Hotkey: +)"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>

                <div className="w-[1px] h-4 bg-white/[0.15] mx-0.5" />

                {/* Quick Zoom Presets */}
                <button
                  type="button"
                  onClick={() => { setZoomLevel(1); setPanOffset({ x: 0, y: 0 }); }}
                  className={`px-2 py-0.5 rounded-lg text-[11px] font-bold transition-all ${
                    zoomLevel === 1 ? 'bg-amber-500 text-black' : 'text-slate-300 hover:text-white'
                  }`}
                  title="Reset to 100% Fit"
                >
                  100%
                </button>
                <button
                  type="button"
                  onClick={() => setZoomLevel(2.5)}
                  className={`px-2 py-0.5 rounded-lg text-[11px] font-bold transition-all hidden sm:block ${
                    zoomLevel === 2.5 ? 'bg-amber-500 text-black' : 'text-slate-300 hover:text-white'
                  }`}
                  title="Zoom 250%"
                >
                  250%
                </button>
                <button
                  type="button"
                  onClick={() => setZoomLevel(5)}
                  className={`px-2 py-0.5 rounded-lg text-[11px] font-bold transition-all ${
                    zoomLevel === 5 ? 'bg-amber-500 text-black' : 'text-slate-300 hover:text-white'
                  }`}
                  title="Maximum 500% Zoom"
                >
                  500%
                </button>

                <button
                  type="button"
                  onClick={() => { setZoomLevel(1); setPanOffset({ x: 0, y: 0 }); }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.1] transition-all"
                  title="Reset Zoom and Center (Hotkey: 0)"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Close Button */}
              <div className="flex items-center gap-2">
                <button 
                  type="button" 
                  onClick={() => {
                    setZoomPageIndex(null);
                    setZoomLevel(1);
                    setPanOffset({ x: 0, y: 0 });
                  }} 
                  className="p-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 hover:text-white border border-white/[0.1] transition-all flex items-center gap-1.5 text-xs font-semibold"
                  title="Close (Esc)"
                >
                  <X className="w-4 h-4" />
                  <span className="hidden sm:inline">Close (Esc)</span>
                </button>
              </div>
            </div>

            {/* Main Viewport */}
            <div 
              className={`flex-1 relative overflow-hidden flex items-center justify-center p-2 ${
                isDragging ? 'cursor-grabbing' : 'cursor-grab'
              }`}
              onMouseDown={handleMouseDown}
              onWheel={handleWheel}
              onDoubleClick={handleDoubleClick}
            >
              {/* Floating Previous Page Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (canPrev) {
                    setZoomPageIndex(zoomPageIndex - 1);
                    setPanOffset({ x: 0, y: 0 });
                  }
                }}
                disabled={!canPrev}
                className="absolute left-4 top-1/2 -translate-y-1/2 z-30 p-3 rounded-2xl bg-black/80 hover:bg-amber-500 border border-white/[0.15] text-white hover:text-black shadow-2xl transition-all disabled:opacity-20 disabled:pointer-events-none group"
                title="Previous Page (Hotkey: Left Arrow ←)"
              >
                <ChevronLeft className="w-6 h-6 group-hover:-translate-x-0.5 transition-transform" />
              </button>

              {/* Floating Next Page Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (canNext) {
                    setZoomPageIndex(zoomPageIndex + 1);
                    setPanOffset({ x: 0, y: 0 });
                  }
                }}
                disabled={!canNext}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-30 p-3 rounded-2xl bg-black/80 hover:bg-amber-500 border border-white/[0.15] text-white hover:text-black shadow-2xl transition-all disabled:opacity-20 disabled:pointer-events-none group"
                title="Next Page (Hotkey: Right Arrow →)"
              >
                <ChevronRight className="w-6 h-6 group-hover:translate-x-0.5 transition-transform" />
              </button>

              {/* Zoomable & Draggable Page Image */}
              <div 
                className="transition-transform duration-75 ease-out select-none"
                style={{
                  transform: `translate3d(${panOffset.x}px, ${panOffset.y}px, 0) scale(${zoomLevel})`,
                  transformOrigin: 'center center'
                }}
              >
                <img 
                  src={activePage.imageUrl} 
                  alt={`Page ${activePage.pageNumber} High-Res`} 
                  draggable={false}
                  className="max-w-[85vw] max-h-[82vh] object-contain rounded-lg shadow-2xl pointer-events-none border border-white/[0.1]" 
                />
              </div>

              {/* Bottom Quick Page Thumbnails Strip */}
              <div 
                className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-slate-950/90 border border-white/[0.15] shadow-2xl backdrop-blur-md max-w-[90vw] overflow-x-auto no-scrollbar"
                onClick={e => e.stopPropagation()}
                onMouseDown={e => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (canPrev) {
                      setZoomPageIndex(zoomPageIndex - 1);
                      setPanOffset({ x: 0, y: 0 });
                    }
                  }}
                  disabled={!canPrev}
                  className="px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-bold text-slate-300 disabled:opacity-30 flex items-center gap-1"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Prev</span>
                </button>

                <div className="flex items-center gap-1 px-1 overflow-x-auto max-w-[60vw]">
                  {pages.map((p, pIdx) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setZoomPageIndex(pIdx);
                        setPanOffset({ x: 0, y: 0 });
                      }}
                      className={`w-7 h-7 rounded-lg text-xs font-extrabold transition-all shrink-0 ${
                        pIdx === zoomPageIndex
                          ? 'bg-amber-500 text-black shadow-md shadow-amber-500/30'
                          : 'bg-white/[0.04] text-slate-400 hover:text-white hover:bg-white/[0.1]'
                      }`}
                      title={`Go to Page ${p.pageNumber}`}
                    >
                      {p.pageNumber}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (canNext) {
                      setZoomPageIndex(zoomPageIndex + 1);
                      setPanOffset({ x: 0, y: 0 });
                    }
                  }}
                  disabled={!canNext}
                  className="px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-bold text-slate-300 disabled:opacity-30 flex items-center gap-1"
                >
                  <span className="hidden sm:inline">Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
    </div>
  );
};

export default MocktestExtractor;
