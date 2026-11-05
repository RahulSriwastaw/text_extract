import React, { useState, useEffect, useRef } from 'react';
import { FileDown, RefreshCw, Wand2, AlertTriangle, AlertCircle, FileText, Copy, Check, Filter, Settings, Layout, Clock, Plus, ListChecks, Zap, Type, Sparkles, Layers, Bot, FileSpreadsheet, MoreHorizontal } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import FileUploader from './FileUploader';
import ProcessingList from './ProcessingList';
import HistorySidebar from './HistorySidebar';
import McqSidebar from './McqSidebar';
import MocktestStudioModal from './MocktestStudioModal';
import UploadProgressBar, { UploadProgressData } from './UploadProgressBar';
import { AppState, ScannedPage, NumberingStyle, OptionArrangement, HistoryItem, MockTestMcqItem, ExtractedElement } from '../types';
import { convertPdfToImages, readFileAsBase64, cropImage } from '../services/pdfUtils';
import { extractLayoutFromImage } from '../services/geminiService';
import { generateDocx, formatQuestionPrefix, renumberQuestionInLine } from '../services/docxService';
import { convertElementsToMockTestItems } from '../services/mocktestService';
import GeminiConnectModal from './GeminiConnectModal';
import GeminiSettingsModal from './GeminiSettingsModal';
import { checkUserGeminiAuth } from '../services/userGeminiService';
import { saveExtractedDocument } from '../services/aiDbService';
import { useCurrentUser } from '../services/authService';
import { addHistoryItem, getHistoryItems, deleteHistoryItem, clearAllHistory } from '../services/historyService';
import { 
  extractWithStudyAiBridge, 
  captureFromStudyAiBridge,
  resetStudyAiBridgeSession,
  parseExtensionOutputToElements,
  buildBridgePrompt, 
  pingStudyAiExtension, 
  subscribeToExtensionStatus,
  withBridgeRetry,
  BridgeStatus,
  getStoredAiProvider,
  setStoredAiProvider,
  shouldStartNewChat,
  AiProvider
} from '../services/studyAiBridgeService';

// Fallback UUID generator
const generateId = () => Math.random().toString(36).substr(2, 9);

export interface PdfConverterProps {
  initialImages?: string[];
  onClearInitialImages?: () => void;
}

/** Compact on/off chip for the output options row. */
const ToggleChip: React.FC<{ on: boolean; onClick: () => void; label: string; title?: string }> = ({ on, onClick, label, title }) => (
  <button
    type="button"
    aria-pressed={on}
    onClick={onClick}
    title={title}
    className={`h-7 px-2.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
      on
        ? 'bg-accent/10 border-accent/40 text-accent-light'
        : 'border-line-strong text-ink-3 hover:text-ink hover:border-white/25'
    }`}
  >
    <span className={`w-3.5 h-3.5 rounded-[4px] border flex items-center justify-center ${on ? 'bg-accent border-accent text-on-accent' : 'border-line-strong'}`}>
      {on && <Check className="w-2.5 h-2.5" strokeWidth={3} />}
    </span>
    {label}
  </button>
);

const PdfConverter: React.FC<PdfConverterProps> = ({ initialImages, onClearInitialImages }) => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [fileName, setFileName] = useState<string>("document");
  const [rangeInput, setRangeInput] = useState<string>("");
  const [autoDownload, setAutoDownload] = useState<boolean>(true);
  const [numberingStyle, setNumberingStyle] = useState<NumberingStyle>(NumberingStyle.HASH);
  const [userGeminiAuth, setUserGeminiAuth] = useState<{ isAuthenticated: boolean; authType: string }>({ isAuthenticated: false, authType: 'none' });
  const [showGeminiConnect, setShowGeminiConnect] = useState(false);
  const [showGeminiSettings, setShowGeminiSettings] = useState(false);
  const [isBilingual, setIsBilingual] = useState(false);
  const [includeImages, setIncludeImages] = useState<boolean>(false);
  const [optionArrangement, setOptionArrangement] = useState<OptionArrangement>(OptionArrangement.VERTICAL);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [user] = useCurrentUser();
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  useEffect(() => {
    if (!showMoreMenu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest?.('[data-menu-root]')) setShowMoreMenu(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowMoreMenu(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [showMoreMenu]);
  const [isMcqSidebarOpen, setIsMcqSidebarOpen] = useState(false);
  const [mcqMode, setMcqMode] = useState(false);
  const [showMcqNumbers, setShowMcqNumbers] = useState(true);
  const [showAnswers, setShowAnswers] = useState(true);
  const [refineMode, setRefineMode] = useState(false);
  const [autoProofread, setAutoProofread] = useState(false);
  const [selectedError, setSelectedError] = useState<string | null>(null);
  const [wordsConsumed, setWordsConsumed] = useState(0);
  const [pointsConsumed, setPointsConsumed] = useState(0);
  const [totalKeys, setTotalKeys] = useState(1);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressData | null>(null);

  // Study AI Chrome Extension Bridge state
  const [aiEngine, setAiEngine] = useState<'extension' | 'api'>('extension');
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({ connected: false });
  const [bridgeProgressMsg, setBridgeProgressMsg] = useState<string | null>(null);
  const [pdfChatUrl, setPdfChatUrl] = useState<string | null>(null);
  const isUsingBridge = aiEngine === 'extension' && bridgeStatus.connected;
  const [showMocktestStudio, setShowMocktestStudio] = useState(false);
  const [mocktestItems, setMocktestItems] = useState<MockTestMcqItem[]>([]);

  const handleOpenMocktestStudio = () => {
    const completedElements = pages
      .filter(p => p.status === 'done' && p.elements)
      .flatMap(p => p.elements || []);

    if (completedElements.length > 0) {
      const converted = convertElementsToMockTestItems(completedElements, fileName || 'Mock Test 01');
      setMocktestItems(converted);
    }
    setShowMocktestStudio(true);
  };

  // Helper to count words
  const countWords = (text: string) => {
    return text.trim().split(/\s+/).filter(Boolean).length;
  };

  // Crop figures and tables out of the page image. The direct API path already did this; the
  // bridge path skipped it, so "Keep images" silently did nothing on the extension engine.
  const attachCroppedFigures = async (imageUrl: string, elements: ExtractedElement[]): Promise<ExtractedElement[]> => {
    if (!includeImages) return elements;
    return Promise.all(elements.map(async (el) => {
      if ((el.type === 'image' || el.type === 'table') && el.bbox) {
        try {
          return { ...el, imageB64: await cropImage(imageUrl, el.bbox) };
        } catch {
          return el;
        }
      }
      return el;
    }));
  };

  useEffect(() => {
    checkAuth();
    const unsub = subscribeToExtensionStatus((status) => {
      setBridgeStatus(status);
    });
    pingStudyAiExtension().catch(() => {});
    fetch('/api/config')
      .then(r => r.json())
      .then(data => {
        if (data.totalKeys) setTotalKeys(data.totalKeys);
      })
      .catch(err => console.error("Config fetch failed:", err));
    return () => unsub();
  }, []);

  // Re-check the bridge whenever the user selects the extension engine: the mount-time ping can
  // land before the extension is ready, and nothing else would retry it.
  useEffect(() => {
    if (aiEngine === 'extension' && !bridgeStatus.connected) {
      pingStudyAiExtension().catch(() => {});
    }
  }, [aiEngine]);

  useEffect(() => {
    if (initialImages && initialImages.length > 0) {
      const newPages: ScannedPage[] = initialImages.map((base64, index) => ({
        id: generateId(),
        pageNumber: index + 1,
        imageUrl: base64,
        status: 'pending',
        isSelected: true
      }));
      setPages(newPages);
      setAppState(AppState.IDLE);
      setFileName("Stitched_QA_Doc");
      onClearInitialImages?.();
    }
  }, [initialImages]);

  const checkAuth = async () => {
    const auth = await checkUserGeminiAuth();
    setUserGeminiAuth({ isAuthenticated: auth.isAuthenticated, authType: auth.authType });
  };

  // Load history whenever user changes (or on initial mount)
  useEffect(() => {
    const currentUid = user?.uid || 'guest';
    getHistoryItems(currentUid)
      .then((items) => {
        setHistory(items);
      })
      .catch((e) => {
        console.error('[history] Failed to load history for user:', currentUid, e);
      });
  }, [user]);

  // Auto-save to history effect & local IndexedDB
  useEffect(() => {
    if (appState === AppState.COMPLETED) {
      const completedElements = pages
        .filter(p => p.status === 'done' && p.elements)
        .flatMap(p => p.elements || []);
      
      if (completedElements.length > 0) {
        const currentUid = user?.uid || 'guest';
        const docId = generateId();
        const fullHistoryItem: HistoryItem = {
          id: docId,
          userId: currentUid,
          fileName: fileName || 'Untitled Document',
          timestamp: Date.now(),
          pagesCount: pages.length,
          elements: completedElements
        };

        setHistory(prev => [fullHistoryItem, ...prev.filter(i => i.id !== docId)].slice(0, 30));

        // Save immediately to user ID history (local cache + cloud Firestore sync)
        addHistoryItem(currentUid, fullHistoryItem).catch((e) =>
          console.error('[history] Failed to save history for user:', currentUid, e)
        );

        // Save to browser IndexedDB (100% local device storage)
        const fullText = completedElements.map(e => e.type === 'text' ? (e.content || '') : '').join('\n\n');
        saveExtractedDocument({
          id: docId,
          fileName,
          pageCount: pages.length,
          extractedText: fullText,
          elements: completedElements,
          timestamp: Date.now()
        }).catch(err => console.error("Failed to save to local IndexedDB:", err));
      }

      if (autoDownload) {
        const timer = setTimeout(() => {
          downloadDocx();
        }, 500);
        return () => clearTimeout(timer);
      }
    }
  }, [appState]);

  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      // Don't intercept if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      if (appState === AppState.UPLOAD) return; // FileUploader handles it
      if (appState === AppState.ANALYZING || appState === AppState.PROCESSING_PDF) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const file = items[i].getAsFile();
        if (file && (file.type.startsWith('image/') || file.type === 'application/pdf')) {
          files.push(file);
        }
      }

      if (files.length > 0) {
        const dataTransfer = new DataTransfer();
        files.forEach(file => dataTransfer.items.add(file));
        handleFilesSelected(dataTransfer.files, true);
      }
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [appState]);

    // Triggers selection and processing for all failed pages
    const retryAllErrors = async () => {
        const errorPages = pages.filter(p => p.status === 'error');
        if (errorPages.length === 0) return;
        
        setErrorMsg(null);
        setAppState(AppState.ANALYZING);

        // Update pages and then trigger extraction
        setPages(prev => {
            const updated = prev.map(p => 
                p.status === 'error' 
                    ? { ...p, isSelected: true, status: 'processing' as const, errorMessage: undefined, elements: undefined, extractedText: undefined } 
                    : p
            );
            
            return updated;
        });

        // Small delay to ensure state batching finishes
        setTimeout(() => startExtraction(), 0);
    };

  const handleFilesSelected = async (fileList: FileList | null, append: boolean = false) => {
    if (!fileList || fileList.length === 0) return;

    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
    const validFiles: File[] = [];
    let hasOversizedFiles = false;

    for (let i = 0; i < fileList.length; i++) {
      if (fileList[i].size > MAX_FILE_SIZE) {
        hasOversizedFiles = true;
      } else {
        validFiles.push(fileList[i]);
      }
    }

    if (hasOversizedFiles) {
      setErrorMsg("Some files exceed the 50MB limit and were skipped.");
      if (validFiles.length === 0) {
        setAppState(AppState.ERROR);
        return;
      }
    }

    if (validFiles.length === 0) return;

    if (!append) {
      const firstFile = validFiles[0];
      const namePart = firstFile.name.substring(0, firstFile.name.lastIndexOf('.')) || firstFile.name;
      setFileName(namePart);
      setPages([]); // Clear previous
      setWordsConsumed(0);
      setPointsConsumed(0);
      resetStudyAiBridgeSession().catch(() => {});
      setPdfChatUrl(null);
    }
    
    setAppState(AppState.PROCESSING_PDF);
    setErrorMsg(null);

    const newPages: Omit<ScannedPage, 'pageNumber'>[] = [];

    try {
      for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          setUploadProgress({
            fileName: file.name,
            fileSize: file.size,
            current: 0,
            total: 0,
            percentage: 5,
            statusText: 'Loading PDF document...'
          });

          const images = await convertPdfToImages(file, (current, total, percentage) => {
            setUploadProgress({
              fileName: file.name,
              fileSize: file.size,
              current,
              total,
              percentage: Math.max(5, percentage),
              statusText: `Rendering page ${current} of ${total} (2.5x high-res)...`
            });
          });

          images.forEach(img => {
            newPages.push({
              id: generateId(),
              imageUrl: img,
              status: 'pending',
              isSelected: true
            });
          });
        } else if (file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(file.name)) {
          const percent = Math.round(((i + 1) / validFiles.length) * 100);
          setUploadProgress({
            fileName: file.name,
            fileSize: file.size,
            current: i + 1,
            total: validFiles.length,
            percentage: percent,
            statusText: `Processing image ${i + 1} of ${validFiles.length}...`
          });

          const base64 = await readFileAsBase64(file);
          newPages.push({
            id: generateId(),
            imageUrl: base64,
            status: 'pending',
            isSelected: true
          });
        }
      }
      
      setPages(prev => {
        let currentCounter = append ? prev.length + 1 : 1;
        const mappedNewPages = newPages.map(p => ({ ...p, pageNumber: currentCounter++ } as ScannedPage));
        return append ? [...prev, ...mappedNewPages] : mappedNewPages;
      });

      setUploadProgress(prev => prev ? {
        ...prev,
        percentage: 100,
        statusText: `Ready! Successfully loaded ${newPages.length} pages.`
      } : null);

      setTimeout(() => {
        setUploadProgress(null);
      }, 1800);

      setAppState(AppState.IDLE); // Ready to start AI
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || "Failed to process files. Please check if the file is valid.");
      setAppState(AppState.ERROR);
      setUploadProgress(null);
    }
  };

  const togglePageSelection = (id: string) => {
    setPages(prev => prev.map(p => p.id === id ? { ...p, isSelected: !p.isSelected } : p));
  };

  const toggleAllSelection = (select: boolean) => {
    setPages(prev => prev.map(p => ({ ...p, isSelected: select })));
  };

  const applyRangeSelection = () => {
      if (!rangeInput.trim()) return;

      const pagesToSelect = new Set<number>();
      const parts = rangeInput.split(',');

      parts.forEach(part => {
          const p = part.trim();
          if (p.includes('-')) {
              const rangeParts = p.split('-').map(s => s.trim());
              if (rangeParts.length === 2) {
                  const start = parseInt(rangeParts[0], 10);
                  const end = parseInt(rangeParts[1], 10);
                  if (!isNaN(start) && !isNaN(end)) {
                      const min = Math.min(start, end);
                      const max = Math.max(start, end);
                      for (let i = min; i <= max; i++) pagesToSelect.add(i);
                  }
              }
          } else {
              const num = parseInt(p, 10);
              if (!isNaN(num)) pagesToSelect.add(num);
          }
      });

      setPages(prev => prev.map(p => ({
          ...p,
          isSelected: pagesToSelect.has(p.pageNumber)
      })));
  };

  const startExtraction = async () => {
    setAppState(AppState.ANALYZING);
    setErrorMsg(null);
    setBridgeProgressMsg(null);
    
    // Check if using Study AI Bridge extension (Zero Token Mode)
    const useBridge = aiEngine === 'extension';
    if (useBridge) {
      const status = await pingStudyAiExtension(3000);
      if (!status.connected || status.protocolVersion !== 2) {
        setErrorMsg(status.error || 'Reload TextExtract Pro Bridge 2.5 and refresh this page to reconnect.');
        setShowGeminiConnect(true);
        setAppState(AppState.ERROR);
        return;
      }
    }

    // 1. Visually mark ALL selected pages as 'processing' immediately.
    setPages(prev => prev.map(p => 
      (!useBridge && p.isSelected && p.status !== 'done')
        ? { ...p, status: 'processing', elements: undefined, extractedText: undefined } 
        : p
    ));
    
    // Identify pages to process
    const pagesToProcess = pages.filter(p => p.isSelected && p.status !== 'done');
    let criticalErrorOccurred = false;

    if (useBridge) {
      // Process sequentially through the browser AI chat tab
      const extractedPageTexts: { [pageId: string]: string } = {};
      let activeChatUrl: string | undefined;

      for (let i = 0; i < pagesToProcess.length; i++) {
        if (criticalErrorOccurred) break;
        const page = pagesToProcess[i];

        // Explicitly update current page to processing status
        setPages(prev => prev.map(p => p.id === page.id ? {
          ...p,
          status: 'processing',
          extractedText: undefined,
          elements: undefined,
          errorMessage: `Processing page ${page.pageNumber} (${i + 1}/${pagesToProcess.length})...`
        } : p));

        // Get trailing chunk from previous page to handle questions split across page boundaries
        let prevTailChunk = '';
        const previousPage = pages.find(p => p.pageNumber === page.pageNumber - 1);
        if (previousPage && (extractedPageTexts[previousPage.id] || previousPage.status === 'done')) {
          const lastElement = previousPage.elements?.at(-1)?.content;
          prevTailChunk = (extractedPageTexts[previousPage.id] || lastElement || previousPage.extractedText || '').slice(-6000);
        }

        try {
          const prompt = buildBridgePrompt(
            numberingStyle,
            isBilingual,
            mcqMode,
            refineMode,
            showAnswers,
            prevTailChunk || undefined,
            includeImages,
            optionArrangement,
            showMcqNumbers,
            autoProofread
          );
          // Register a controller so this one page can be stopped without ending the whole run.
          pageAborters.current.get(page.id)?.abort();
          const pageAborter = new AbortController();
          pageAborters.current.set(page.id, pageAborter);

          // A transient bridge failure (lost job, stuck tab, timeout) is retried in a fresh chat with a
          // new marker, instead of ending the whole run on the first hiccup.
          let freshChatOnRetry = false;
          const bridgeRes = await withBridgeRetry(async attempt => {
            // Pin this page to its own reply. Without a marker the adapter falls back to guessing
            // which chat turn belongs to which page, which breaks as soon as a page is retried.
            const pageMarker = `---STUDY_AI_COMPLETE_P${page.pageNumber}_${generateId()}---`;
            setPages(prev => prev.map(p => p.id === page.id ? { ...p, expectedMarker: pageMarker } : p));
            const startNewChat = shouldStartNewChat(i) || freshChatOnRetry;
            const attemptTag = attempt > 1 ? ` (retry ${attempt - 1})` : '';

            return extractWithStudyAiBridge({
              base64Image: page.imageUrl,
              fileName: `${fileName}_page_${page.pageNumber}.png`,
              mimeType: 'image/png',
              prompt,
              expectedMarker: pageMarker,
              responseFormat: mcqMode ? 'json' : 'text',
              signal: pageAborter.signal,
              provider: getStoredAiProvider() || bridgeStatus.provider || 'gemini',
              // Rotate to a fresh chat every few pages: a long chat makes upload and the composer
              // unreliable. Continuation context travels in the prompt, not the chat history.
              continueChat: !startNewChat,
              chatUrl: startNewChat ? undefined : activeChatUrl,
              pageNumber: page.pageNumber,
              totalPages: pages.length,
              silent: true,
              onProgress: (step, detail, chatUrl) => {
                if (chatUrl) { activeChatUrl = chatUrl; setPdfChatUrl(chatUrl); }
                const msg = detail || `${step.toUpperCase()}...`;
                setBridgeProgressMsg(`Page ${i + 1}/${pagesToProcess.length}${attemptTag}: ${msg}`);
                setPages(prev => prev.map(p => p.id === page.id ? {
                  ...p,
                  errorMessage: msg
                } : p));
              }
            });
          }, {
            retries: 2,
            signal: pageAborter.signal,
            onRetry: ({ attempt, maxAttempts, error }) => {
              freshChatOnRetry = true;
              activeChatUrl = undefined;
              const msg = `Attempt ${attempt}/${maxAttempts} failed: ${error.message} — retrying in a fresh chat…`;
              console.warn(`[Bridge] Page ${page.pageNumber}: ${msg}`);
              setBridgeProgressMsg(`Page ${i + 1}/${pagesToProcess.length}: ${msg}`);
              setPages(prev => prev.map(p => p.id === page.id ? { ...p, errorMessage: msg } : p));
            },
          });

          if (bridgeRes.chatUrl) {
            activeChatUrl = bridgeRes.chatUrl;
            setPdfChatUrl(bridgeRes.chatUrl);
            setPages(prev => prev.map(p => p.id === page.id ? { ...p, chatUrl: bridgeRes.chatUrl } : p));
          }

          const { rawText } = bridgeRes;
          const elements = await attachCroppedFigures(page.imageUrl, bridgeRes.elements);

          // Calculate words and points
          const pageText = elements.map(e => e.type === 'text' ? (e.content || '') : '').join(' ');
          extractedPageTexts[page.id] = elements.at(-1)?.content || '';
          const pageWords = countWords(pageText);
          setWordsConsumed(prev => prev + pageWords);
          setPointsConsumed(prev => prev + 1);

          // If the first element completed a split question from the previous page, update previous page
          const firstElem = elements[0];
          if (firstElem?.continues_previous && previousPage && prevTailChunk) {
            const prevPage = previousPage;
            setPages(prev => prev.map(p => {
              if (p.id === prevPage.id && p.elements && p.elements.length > 0) {
                // If previous page had the partial question cut off, remove the trailing fragment
                const trimmed = p.elements.slice(0, -1);
                return {
                  ...p,
                  elements: trimmed,
                  extractedText: trimmed.map(e => e.type === 'text' ? (e.content || '') : `[Image: ${e.content || ''}]`).join('\n\n')
                };
              }
              return p;
            }));
          }

          // Mark success
          setPages(prev => prev.map(p => p.id === page.id ? { 
            ...p, 
            status: 'done', 
            elements,
            errorMessage: undefined,
            extractedText: elements.map(e => e.type === 'text' ? (e.content || '') : `[Image: ${e.content || ''}]`).join('\n\n')
          } : p));

          // Pause briefly between pages so browser tab and AI session settle
          if (i < pagesToProcess.length - 1) {
            await new Promise(r => setTimeout(r, 1200));
          }
        } catch (e: any) {
          console.error(`Error processing page ${page.pageNumber} via TextExtract Bridge:`, e);
          const errorStr = e?.message || String(e);
          setPages(prev => prev.map(p => p.id === page.id ? { ...p, status: 'error', errorMessage: errorStr } : p));
          setErrorMsg(`Page ${page.pageNumber}: ${errorStr}. Completed pages are saved; retry this page before continuing.`);
          criticalErrorOccurred = true;
        }
      }

      setBridgeProgressMsg(null);
      setAppState(AppState.COMPLETED);
      return;
    }

    // Direct Gemini API mode
    const BATCH_SIZE = Math.min(10, pagesToProcess.length);

    for (let i = 0; i < pagesToProcess.length; i += BATCH_SIZE) {
        if (criticalErrorOccurred) break;

        const batch = pagesToProcess.slice(i, i + BATCH_SIZE);
        
        await Promise.all(batch.map(async (page, index) => {
            if (criticalErrorOccurred) return;

            // Stagger requests by 600ms to avoid burst limits
            await new Promise(resolve => setTimeout(resolve, index * 600));

            pageAborters.current.get(page.id)?.abort();
            const pageAborter = new AbortController();
            pageAborters.current.set(page.id, pageAborter);

            try {
                const elements = await extractLayoutFromImage(
                  page.imageUrl, 
                  numberingStyle, 
                  includeImages, 
                  isBilingual, 
                  mcqMode, 
                  refineMode, 
                  showAnswers,
                  showMcqNumbers,
                  autoProofread,
                  optionArrangement
                );
                // Stop cannot cancel an in-flight API call, so discard its result instead.
                if (pageAborter.signal.aborted) return;

                // Calculate words and points
                const pageText = elements.map(e => e.type === 'text' ? (e.content || '') : '').join(' ');
                const pageWords = countWords(pageText);
                setWordsConsumed(prev => prev + pageWords);
                setPointsConsumed(prev => prev + 1);

                // Process images & tables
                const processedElements = await Promise.all(elements.map(async (el) => {
                    if (includeImages && (el.type === 'image' || el.type === 'table') && el.bbox) {
                        try {
                            const croppedB64 = await cropImage(page.imageUrl, el.bbox);
                            return { ...el, imageB64: croppedB64 };
                        } catch (cropErr) {
                            return el;
                        }
                    }
                    return el;
                }));

                // Mark success
                setPages(prev => prev.map(p => p.id === page.id ? { 
                    ...p, 
                    status: 'done', 
                    elements: processedElements,
                    extractedText: processedElements.map(e => e.type === 'text' ? (e.content || '') : `[Image: ${e.content || ''}]`).join('\n\n')
                } : p));
            } catch (e: any) {
                console.error(`Error processing page ${page.pageNumber}:`, e);
                const errorStr = e?.message || String(e);
                const errorLower = errorStr.toLowerCase();
                const isRateLimit = errorStr.includes("429") || errorStr.includes("quota") || errorStr.includes("exhausted");

                let displayError = errorStr;
                try {
                  const parsed = JSON.parse(errorStr);
                  if (parsed.message) displayError = parsed.message;
                } catch(e) {}

                setPages(prev => prev.map(p => p.id === page.id ? { ...p, status: 'error', errorMessage: displayError, elements: undefined, extractedText: undefined } : p));

                if (isRateLimit && totalKeys <= 1) {
                    setErrorMsg("API limit reached. Please wait a moment or add more keys."); 
                    criticalErrorOccurred = true; 
                } else if (errorLower.includes("authentication") || errorLower.includes("api key not valid")) {
                    // Only stop if we have no keys left
                    if (totalKeys <= 1) {
                        setErrorMsg(`Authentication Error: ${displayError}`);
                        criticalErrorOccurred = true; 
                    }
                }
            }
        }));

        // Dynamic delay between batches to respect API limits (15 RPM per key)
        if (i + BATCH_SIZE < pagesToProcess.length && !criticalErrorOccurred) {
            // If we have multiple keys, we can be much faster. 
            // 2000ms is a safe "cooldown" for 15RPM (1 req every 4s) when spread across multiple keys.
            const batchDelay = totalKeys > 1 ? 1000 : 4000;
            await new Promise(resolve => setTimeout(resolve, batchDelay)); 
        }
    }
    
    if (!criticalErrorOccurred) {
        setAppState(AppState.COMPLETED);
    }
  };

  // One controller per page so a single page can be stopped without touching the others.
  const pageAborters = useRef(new Map<string, AbortController>());

  const isAbort = (e: any) => e?.name === 'AbortError';

  const stopPage = (id: string) => {
    const controller = pageAborters.current.get(id);
    controller?.abort();
    pageAborters.current.delete(id);
    setPages(prev => prev.map(p => p.id === id && p.status === 'processing'
      ? { ...p, status: 'pending', errorMessage: 'Stopped. Press Start to run this page again.' }
      : p));
  };

  const retryPage = async (id: string) => {
    const page = pages.find(p => p.id === id);
    if (!page) return;

    // Reset global error msg if any, as user is attempting action
    setErrorMsg(null);

    pageAborters.current.get(id)?.abort();
    const aborter = new AbortController();
    pageAborters.current.set(id, aborter);

    // Update to processing
    setPages(prev => prev.map(p => p.id === id ? { ...p, status: 'processing', extractedText: undefined, elements: undefined, errorMessage: undefined } : p));

    // If using Study AI Bridge
    if (aiEngine === 'extension') {
      try {
        const pageIdx = pages.findIndex(p => p.id === id);
        let prevTailChunk = '';
        if (pageIdx > 0) {
          const prevP = pages[pageIdx - 1];
          if (prevP && prevP.extractedText) {
            const lines = prevP.extractedText.trim().split('\n').filter(Boolean);
            prevTailChunk = lines.slice(-5).join('\n');
          }
        }
        const prompt = buildBridgePrompt(
          numberingStyle,
          isBilingual,
          mcqMode,
          refineMode,
          showAnswers,
          prevTailChunk || undefined,
          includeImages,
          optionArrangement,
          showMcqNumbers,
          autoProofread
        );
        const pageMarker = `---STUDY_AI_COMPLETE_P${page.pageNumber}_${generateId()}---`;
        setPages(prev => prev.map(p => p.id === id ? { ...p, expectedMarker: pageMarker } : p));

        const { rawText, elements: bridgeElements, chatUrl } = await extractWithStudyAiBridge({
          base64Image: page.imageUrl,
          fileName: `${fileName}_page_${page.pageNumber}.png`,
          mimeType: 'image/png',
          prompt,
          expectedMarker: pageMarker,
          responseFormat: mcqMode ? 'json' : 'text',
          provider: getStoredAiProvider() || bridgeStatus.provider || 'gemini',
          continueChat: false,
          pageNumber: page.pageNumber,
          totalPages: pages.length,
          signal: aborter.signal,
          onProgress: (_step, detail) => {
            setPages(prev => prev.map(p => p.id === id ? { ...p, errorMessage: detail || undefined } : p));
          }
        });

        const elements = await attachCroppedFigures(page.imageUrl, bridgeElements);
        const pageText = elements.map(e => e.type === 'text' ? (e.content || '') : '').join(' ');
        const pageWords = countWords(pageText);
        setWordsConsumed(prev => prev + pageWords);
        setPointsConsumed(prev => prev + 1);

        if (chatUrl) setPdfChatUrl(chatUrl);
        setPages(prev => prev.map(p => p.id === id ? {
          ...p,
          status: 'done',
          elements,
          chatUrl: chatUrl || p.chatUrl,
          errorMessage: undefined,
          extractedText: elements.map(e => e.type === 'text' ? (e.content || '') : `[Image: ${e.content || ''}]`).join('\n\n')
        } : p));
        return;
      } catch (e: any) {
        // Stop already put the page back to pending; do not overwrite it with an error.
        if (!isAbort(e)) {
          setPages(prev => prev.map(p => p.id === id ? { ...p, status: 'error', errorMessage: e?.message || String(e) } : p));
        }
        return;
      } finally {
        if (pageAborters.current.get(id) === aborter) pageAborters.current.delete(id);
      }
    }

    try {
      const elements = await extractLayoutFromImage(
        page.imageUrl, 
        numberingStyle, 
        includeImages, 
        isBilingual, 
        mcqMode, 
        refineMode, 
        showAnswers,
        showMcqNumbers,
        autoProofread,
        optionArrangement
      );
      // The API call itself cannot be cancelled mid-flight; discard its result instead.
      if (aborter.signal.aborted) return;
      
      // Calculate words and points
      const pageText = elements.map(e => e.type === 'text' ? (e.content || '') : '').join(' ');
      const pageWords = countWords(pageText);
      setWordsConsumed(prev => prev + pageWords);
      setPointsConsumed(prev => prev + 1);

      const processedElements = await Promise.all(elements.map(async (el) => {
          if (includeImages && (el.type === 'image' || el.type === 'table') && el.bbox) {
              try {
                  const croppedB64 = await cropImage(page.imageUrl, el.bbox);
                  return { ...el, imageB64: croppedB64 };
              } catch (cropErr) {
                  return el;
              }
          }
          return el;
      }));

      setPages(prev => prev.map(p => p.id === id ? { 
          ...p, 
          status: 'done', 
          elements: processedElements,
          extractedText: processedElements.map(e => e.type === 'text' ? (e.content || '') : `[Image: ${e.content || ''}]`).join('\n\n')
      } : p));
    } catch (e: any) {
      if (isAbort(e) || aborter.signal.aborted) return;
      console.error("Retry Page Error:", e);
      const errorStr = e.message || String(e);
      let displayError = errorStr;
      try {
        const parsed = JSON.parse(errorStr);
        if (parsed.message) displayError = parsed.message;
        else if (parsed.error && typeof parsed.error === 'string') displayError = parsed.error;
      } catch(e) {}

      setPages(prev => prev.map(p => p.id === id ? { ...p, status: 'error', errorMessage: displayError } : p));
      setErrorMsg(displayError);
    } finally {
      if (pageAborters.current.get(id) === aborter) pageAborters.current.delete(id);
    }
  };

  const handleRecapturePage = async (id: string) => {
    const page = pages.find(p => p.id === id);
    if (!page) return;

    setPages(prev => prev.map(p => p.id === id ? { ...p, errorMessage: 'Reading complete response from AI tab...' } : p));

    try {
      const provider = getStoredAiProvider() || bridgeStatus.provider || 'gemini';
      const rawText = await captureFromStudyAiBridge({
        provider,
        fullChat: false,
        chatUrl: page.chatUrl || pdfChatUrl || undefined,
        pageNumber: page.pageNumber,
        totalPages: pages.length,
        expectedMarker: page.expectedMarker || undefined
      });
      if (!rawText || !rawText.trim()) {
        throw new Error('No response text detected on AI tab. Please verify the AI finished writing.');
      }

      const elements = await attachCroppedFigures(page.imageUrl, parseExtensionOutputToElements(rawText));
      const pageText = elements.map(e => e.type === 'text' ? (e.content || '') : '').join(' ');
      const pageWords = countWords(pageText);
      setWordsConsumed(prev => prev + pageWords);

      setPages(prev => prev.map(p => p.id === id ? {
        ...p,
        status: 'done',
        elements,
        errorMessage: undefined,
        extractedText: elements.map(e => e.type === 'text' ? (e.content || '') : `[Image: ${e.content || ''}]`).join('\n\n')
      } : p));
    } catch (err: any) {
      console.error('Recapture error:', err);
      const msg = err?.message || String(err);
      setPages(prev => prev.map(p => p.id === id ? { ...p, errorMessage: `Recapture failed: ${msg}` } : p));
    }
  };

  const updatePageText = (id: string, newText: string) => {
    setPages(prev => prev.map(p => p.id === id ? { ...p, extractedText: newText } : p));
  };

  const getFullText = () => {
    let qCounter = 1;
    return pages
      .filter(p => p.isSelected && p.status === 'done')
      .map(p => {
        if (p.elements) {
          return p.elements
            .filter(el => includeImages || el.type !== 'image')
            .map(el => {
              if (el.type === 'text' || el.type === 'table') {
                let content = el.content || '';
                if (!showAnswers) {
                  content = content
                    .replace(/([^\n]+?)\s*\/+\s*Answer\s*[:\-]\s*[a-eA-E]/gi, '$1')
                    .replace(/^\s*Answer\s*[:\-]\s*[a-eA-E]\s*$/gim, '')
                    .replace(/([^\n])\s+Answer\s*[:\-]\s*[a-eA-E]/gi, '$1')
                    .trim();
                } else {
                  content = content.replace(/([^\n]+?)\s*\/+\s*(Answer\s*[:\-]\s*[a-eA-E])/gi, '$1\n$2');
                }

                const lines = content.split('\n');
                const processed = lines.map(line => {
                  const cleanLineText = line.replace(/\*\*/g, '').trim();
                  const isAnswerLine = /^Answer\s*[:\-]\s*[A-Ea-e]/i.test(cleanLineText);
                  const isOption = !isAnswerLine && /^(\([a-eA-E0-9]\)|[a-eA-E0-9][\.\)]|[A-E][\.\)])\s/.test(cleanLineText);
                  const isSubQuestion = !isOption && /^(\([ivxIVX]+\)|[ivxIVX]+\.|[ivxIVX]+[\)]|[\(\[]\w+[\)\]])\s/i.test(cleanLineText);
                  const isMainQuestion = !isOption && !isAnswerLine && !isSubQuestion && (
                    /^#\s/i.test(cleanLineText) ||
                    /^(?:Q\.?\s*\d+|Prashn\s*[:\-]?\s*\d+|Question\s*[:\-]?\s*\d+|प्रश्न\s*[:\-]?\s*\d+|\d+|[\(\[]\d+[\)\]]|#\d+)[\.\)\-:]?\s/i.test(cleanLineText)
                  );

                  if (isMainQuestion) {
                    if (showMcqNumbers) {
                      return renumberQuestionInLine(line, qCounter++, numberingStyle);
                    } else {
                      const numMatch = cleanLineText.match(/^(?:#?(?:Question|Q)\.?\s*[:\-]?\s*|\bPrashn\s*[:\-]?\s*|\bप्रश्न\s*[:\-]?\s*|#\s*)?(?:\((\d+)\)|\[(\d+)\]|(\d+))/i);
                      const num = numMatch ? (numMatch[1] || numMatch[2] || numMatch[3]) : '';
                      return num ? renumberQuestionInLine(line, num, numberingStyle) : line;
                    }
                  }
                  return line;
                });
                return processed.join('\n');
              }
              return `[Image: ${el.content}]`;
            })
            .join('\n\n');
        }
        let raw = p.extractedText || '';
        if (!showAnswers) {
          raw = raw
            .replace(/([^\n]+?)\s*\/+\s*Answer\s*[:\-]\s*[a-eA-E]/gi, '$1')
            .replace(/^\s*Answer\s*[:\-]\s*[a-eA-E]\s*$/gim, '')
            .replace(/([^\n])\s+Answer\s*[:\-]\s*[a-eA-E]/gi, '$1')
            .trim();
        }
        return raw;
      })
      .join('\n\n---\n\n');
  };

  const downloadDocx = async () => {
    // Collect all elements from all selected and completed pages
    const allElements = pages
      .filter(p => p.isSelected && p.status === 'done')
      .flatMap(p => {
        if (p.elements && p.elements.length > 0) {
          return p.elements;
        }
        if (p.extractedText) {
          return [{ id: `el_${p.id}`, type: 'text' as const, content: p.extractedText }];
        }
        return [];
      })
      .filter(el => includeImages || el.type !== 'image');
    
    if (allElements.length === 0) {
        if (!autoDownload) setErrorMsg("No content extracted to save.");
        return;
    }

    try {
      const blob = await generateDocx(allElements, optionArrangement, showMcqNumbers, numberingStyle, showAnswers, mcqMode);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const chosenName = (fileName || 'document').trim();
      const safeBase = chosenName.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'document';
      const docxName = safeBase.toLowerCase().endsWith('.docx') ? safeBase : `${safeBase}.docx`;
      a.download = docxName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => window.URL.revokeObjectURL(url), 10000);
    } catch (e) {
      console.error(e);
      setErrorMsg("Failed to generate DOCX file.");
    }
  };

  const downloadTxt = () => {
    const fullText = getFullText();
    if (!fullText) return;

    const blob = new Blob([fullText], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const chosenName = (fileName || 'document').trim();
    const safeBase = chosenName.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'document';
    const txtName = safeBase.toLowerCase().endsWith('.txt') ? safeBase : `${safeBase}.txt`;
    a.download = txtName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const copyAllText = async () => {
    const fullText = getFullText();
    if (!fullText) return;
    
    try {
        await navigator.clipboard.writeText(fullText);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
        console.error('Failed to copy text: ', err);
    }
  };

  const copyAsMarkdown = async () => {
    const fullText = getFullText();
    if (!fullText) return;
    
    try {
        await navigator.clipboard.writeText(`\`\`\`markdown\n${fullText}\n\`\`\``);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
        console.error('Failed to copy markdown: ', err);
    }
  };

  const reset = () => {
    setPages([]);
    setAppState(AppState.IDLE);
    setErrorMsg(null);
    setFileName("document");
    setRangeInput("");
  };

  const handleSelectHistoryItem = (item: HistoryItem) => {
    // For now, we just download it again or we could populate the UI
    // To keep it simple and professional, let's offer to download the DOCX
    const downloadItem = async () => {
      try {
        const elements = item.elements || [];
        if (elements.length === 0) {
          setErrorMsg("No content found in this history item.");
          return;
        }
        const blob = await generateDocx(elements, optionArrangement, showMcqNumbers, numberingStyle, showAnswers, mcqMode);
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${item.fileName}.docx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => window.URL.revokeObjectURL(url), 10000);
      } catch (e) {
        console.error(e);
        setErrorMsg("Failed to generate DOCX from history.");
      }
    };
    downloadItem();
    setIsHistoryOpen(false);
  };

  const handleDeleteHistoryItem = (id: string) => {
    const currentUid = user?.uid || 'guest';
    setHistory(prev => prev.filter(item => item.id !== id));
    deleteHistoryItem(currentUid, id).catch((e) => console.error('[history] Failed to delete item:', e));
  };

  const handleClearAllHistory = () => {
    const currentUid = user?.uid || 'guest';
    setHistory([]);
    clearAllHistory(currentUid).catch((e) => console.error('[history] Failed to clear history:', e));
  };

  const hasCompletedPages = pages.some(p => p.status === 'done' && (p.extractedText || p.elements));
  const hasErrorPages = pages.some(p => p.status === 'error');
  
  // Selection Stats
  const selectedCount = pages.filter(p => p.isSelected).length;
  const totalCount = pages.length;
  const selectedPendingCount = pages.filter(p => p.isSelected && p.status !== 'done').length;

  return (
    <div className="min-h-screen bg-canvas font-sans relative">
      {/* Floating Top Upload Progress Bar */}
      <AnimatePresence>
        {uploadProgress && (
          <UploadProgressBar progress={uploadProgress} />
        )}
      </AnimatePresence>

      <div className="app-container py-6 space-y-5">

        {/* Error details modal */}
        <AnimatePresence>
          {selectedError && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="modal-backdrop"
              onClick={() => setSelectedError(null)}
            >
              <motion.div
                initial={{ scale: 0.97 }}
                animate={{ scale: 1 }}
                className="modal max-w-lg"
                role="dialog"
                aria-modal="true"
                onClick={e => e.stopPropagation()}
              >
                <div className="modal-header">
                  <h3 className="modal-title">Error details</h3>
                </div>
                <div className="modal-body">
                  <pre className="bg-canvas border border-line p-3 rounded-lg text-xs text-ink-2 overflow-auto max-h-60 whitespace-pre-wrap">
                    {selectedError}
                  </pre>
                </div>
                <div className="modal-footer">
                  <button onClick={() => setSelectedError(null)} className="btn btn-secondary">
                    Close
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Page header */}
        <section className="card">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-4 sm:p-5">
            <div className="min-w-0">
              <p className="page-eyebrow mb-1">Document to Word</p>
              <h1 className="page-title">Convert PDF to editable Word</h1>
              <p className="page-subtitle mt-1">
                Text, tables and math from scanned PDFs and images, exported as a clean <strong className="text-ink-2 font-semibold">.docx</strong>.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {aiEngine === 'extension' && bridgeStatus.connected ? (
                <button
                  onClick={() => setShowGeminiConnect(true)}
                  className="badge badge-success h-8 px-3 rounded-lg cursor-pointer hover:bg-emerald-500/20"
                  title={`TextExtract Pro Bridge is active with ${(bridgeStatus.provider || getStoredAiProvider()).toUpperCase()}`}
                >
                  <span className="dot" />
                  <span>{(bridgeStatus.provider || getStoredAiProvider()).toUpperCase()} bridge active</span>
                </button>
              ) : userGeminiAuth.isAuthenticated ? (
                <button
                  onClick={() => setShowGeminiSettings(true)}
                  className="badge badge-success h-8 px-3 rounded-lg cursor-pointer hover:bg-emerald-500/20"
                  title="Direct Gemini API is active"
                >
                  <Check />
                  <span>Gemini API active</span>
                </button>
              ) : pages.length > 0 && (
                <button
                  onClick={() => setShowGeminiConnect(true)}
                  className="btn btn-secondary"
                  title="Connect AI Bridge or Gemini account"
                >
                  <Sparkles className="text-accent" />
                  <span>Connect AI engine</span>
                </button>
              )}
              {pages.length > 0 && (
                <div className="relative" data-menu-root>
                  <button
                    type="button"
                    onClick={() => setShowMoreMenu(v => !v)}
                    aria-haspopup="menu"
                    aria-expanded={showMoreMenu}
                    aria-label="More actions"
                    className="btn btn-ghost btn-icon"
                  >
                    <MoreHorizontal />
                  </button>
                  {showMoreMenu && (
                    <div className="menu right-0 mt-1.5 w-60 animate-fadeIn" role="menu">
                      <button type="button" role="menuitem" className="menu-item" onClick={() => { setShowMoreMenu(false); setIsHistoryOpen(true); }}>
                        <Clock />
                        <span>Conversion history</span>
                      </button>
                      <button type="button" role="menuitem" className="menu-item" onClick={() => { setShowMoreMenu(false); setIsMcqSidebarOpen(true); }}>
                        <ListChecks />
                        <span>MCQ bank</span>
                      </button>
                      <button type="button" role="menuitem" className="menu-item" onClick={() => { setShowMoreMenu(false); handleOpenMocktestStudio(); }} title="Open in 18-Field MockTest CSV Studio">
                        <FileSpreadsheet />
                        <span>Open in MockTest Studio<span className="menu-item-desc">Edit as CSV questions</span></span>
                      </button>
                      <div className="menu-divider" />
                      <button type="button" role="menuitem" className="menu-item menu-item-danger" onClick={() => { setShowMoreMenu(false); reset(); }}>
                        <RefreshCw />
                        <span>Reset all pages</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Main Content */}
        <main className="relative">
           {pages.length === 0 ? (
             /* Empty state: upload + engine + how it works */
             <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-5">
                <FileUploader
                  onFilesSelected={handleFilesSelected}
                  isLoading={appState === AppState.PROCESSING_PDF}
                />

                <aside className="space-y-4">
                  <div className="card p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold text-ink">AI engine</h2>
                      {userGeminiAuth.isAuthenticated || (aiEngine === 'extension' && bridgeStatus.connected) ? (
                        <span className="badge badge-success"><span className="dot" />Connected</span>
                      ) : (
                        <span className="badge badge-warning">Not connected</span>
                      )}
                    </div>
                    <p className="text-sm text-ink-3 leading-relaxed">
                      {userGeminiAuth.isAuthenticated
                        ? 'Using your own Gemini quota. Results stay on this device.'
                        : 'Use your own Gemini key or the browser bridge. No server limits, and documents stay private.'}
                    </p>
                    {userGeminiAuth.isAuthenticated ? (
                      <button type="button" onClick={() => setShowGeminiSettings(true)} className="btn btn-secondary w-full">
                        <Settings />
                        Gemini settings
                      </button>
                    ) : (
                      <button type="button" onClick={() => setShowGeminiConnect(true)} className="btn btn-secondary w-full">
                        <Zap className="text-accent" />
                        Connect your Gemini (free)
                      </button>
                    )}
                  </div>

                  <div className="card p-4">
                    <h2 className="text-sm font-semibold text-ink mb-3">How it works</h2>
                    <ol className="space-y-3">
                      {[
                        { title: 'Upload', desc: 'PDF, scanned pages or a pasted screenshot.' },
                        { title: 'Extract', desc: 'AI reads text, tables, equations and Hindi/English pairs.' },
                        { title: 'Download', desc: 'Editable .docx with native Word math and tables.' },
                      ].map((step, i) => (
                        <li key={step.title} className="flex gap-3">
                          <span className="w-6 h-6 shrink-0 rounded-full bg-surface-3 border border-line-strong text-xs font-semibold text-ink flex items-center justify-center tabular-nums">{i + 1}</span>
                          <span>
                            <span className="block text-sm font-medium text-ink">{step.title}</span>
                            <span className="block text-sm text-ink-3">{step.desc}</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </aside>
             </div>
           ) : (
             <motion.div
               initial={{ opacity: 0, y: 8 }}
               animate={{ opacity: 1, y: 0 }}
               className="space-y-5"
             >
                {/* Sticky toolbar: status, engine, convert and export */}
                <div className="card sticky top-14 z-30 overflow-hidden shadow-[0_8px_24px_rgb(0_0_0/0.35)]">
                   {/* Progress bar */}
                   <AnimatePresence>
                        {appState === AppState.ANALYZING && (
                            <motion.div
                                initial={{ height: 0 }}
                                animate={{ height: 3 }}
                                exit={{ height: 0 }}
                                className="w-full bg-white/[0.05] relative overflow-hidden"
                            >
                                <motion.div
                                    className="h-full bg-accent"
                                    initial={{ width: 0 }}
                                    animate={{ width: `${Math.round(((pages.filter(p => p.isSelected && (p.status === 'done' || p.status === 'error')).length) / Math.max(1, pages.filter(p => p.isSelected).length)) * 100)}%` }}
                                    transition={{ type: "spring", bounce: 0, duration: 0.5 }}
                                />
                            </motion.div>
                        )}
                   </AnimatePresence>

                   <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 p-3">
                        {/* Left: status / selection */}
                        <div className="toolbar min-w-0">
                            {appState === AppState.ANALYZING ? (
                                <div className="flex items-center gap-3 min-w-0 max-w-md" role="status">
                                    <RefreshCw className="w-4 h-4 text-accent animate-spin shrink-0" />
                                    <div className="min-w-0">
                                        <div className="text-sm font-semibold text-ink truncate">Converting {fileName}</div>
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
                                            <span className="font-semibold text-accent-light tabular-nums">
                                                {Math.round(((pages.filter(p => p.isSelected && (p.status === 'done' || p.status === 'error')).length) / Math.max(1, pages.filter(p => p.isSelected).length)) * 100)}%
                                            </span>
                                            <span>{pages.filter(p => p.isSelected && (p.status === 'done' || p.status === 'error')).length}/{pages.filter(p => p.isSelected).length} pages</span>
                                            {isUsingBridge ? (
                                              <span className="badge badge-neutral h-5">Free bridge</span>
                                            ) : totalKeys > 1 ? (
                                              <span className="badge badge-success h-5">Turbo · {totalKeys} keys</span>
                                            ) : null}
                                            {pages.filter(p => p.isSelected && p.status === 'error').length > 0 && (
                                                <>
                                                    <button
                                                        onClick={() => setSelectedError(pages.find(p => p.isSelected && p.status === 'error')?.errorMessage || "No error details available.")}
                                                        className="text-rose-300 font-semibold hover:underline"
                                                    >
                                                        {pages.filter(p => p.isSelected && p.status === 'error').length} errors
                                                    </button>
                                                    <button onClick={retryAllErrors} className="btn btn-danger btn-xs">
                                                        <RefreshCw />
                                                        Retry all
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                        {bridgeProgressMsg && (
                                          <div className="text-xs text-ink-2 truncate">{bridgeProgressMsg}</div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center gap-1 text-xs text-ink-3">
                                    <span className="font-semibold text-ink tabular-nums px-1">{selectedCount}/{totalCount} selected</span>
                                    <button onClick={() => toggleAllSelection(true)} className="btn btn-ghost btn-xs">All</button>
                                    <button onClick={() => toggleAllSelection(false)} className="btn btn-ghost btn-xs">None</button>
                                </div>
                            )}

                            <label className="input-group h-8 w-36" title="Select a page range and press Enter">
                                <Filter className="w-3.5 h-3.5 text-ink-3 shrink-0" />
                                <input
                                    type="text"
                                    placeholder="Range, e.g. 1-5"
                                    aria-label="Page range"
                                    value={rangeInput}
                                    onChange={(e) => setRangeInput(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && applyRangeSelection()}
                                />
                            </label>

                            <span className="hidden md:inline-flex items-center gap-3 text-xs text-ink-3" title="Usage in this session">
                                <span className="flex items-center gap-1"><Type className="w-3.5 h-3.5" /><strong className="text-ink-2 font-semibold tabular-nums">{wordsConsumed.toLocaleString()}</strong> words</span>
                                <span className="flex items-center gap-1"><Zap className="w-3.5 h-3.5" /><strong className="text-ink-2 font-semibold tabular-nums">{pointsConsumed}</strong> points</span>
                            </span>
                        </div>

                        {/* Right: engine, add, export, convert */}
                        <div className="toolbar xl:justify-end">
                            {appState !== AppState.ANALYZING && (
                                <>
                                    <div className="seg" role="group" aria-label="AI engine">
                                        <button
                                            type="button"
                                            aria-pressed={aiEngine === 'extension'}
                                            onClick={() => {
                                                setAiEngine('extension');
                                                if (!bridgeStatus.connected) {
                                                    setShowGeminiConnect(true);
                                                }
                                            }}
                                            className="seg-item"
                                            title={bridgeStatus.connected
                                                ? "Zero Token Extension Mode Active"
                                                : bridgeStatus.state === 'connecting' || bridgeStatus.checking ? "Connecting to the extension…"
                                                : bridgeStatus.error || "Extension not detected - click to connect"}
                                        >
                                            <Bot />
                                            <span>Free bridge</span>
                                            <span className={`dot ${bridgeStatus.connected ? 'text-emerald-400'
                                                : bridgeStatus.state === 'error' ? 'text-rose-400'
                                                : bridgeStatus.state === 'connecting' || bridgeStatus.checking ? 'text-sky-400 animate-pulse'
                                                : 'text-amber-400'}`} />
                                        </button>
                                        <button
                                            type="button"
                                            aria-pressed={aiEngine === 'api'}
                                            onClick={() => setAiEngine('api')}
                                            className="seg-item"
                                            title="Direct Gemini API (Uses API Keys)"
                                        >
                                            <Zap />
                                            <span>API</span>
                                        </button>
                                    </div>

                                    {aiEngine === 'extension' && (
                                        <select
                                            value={getStoredAiProvider()}
                                            onChange={(e) => {
                                                const newModel = e.target.value as AiProvider;
                                                setStoredAiProvider(newModel);
                                                setBridgeStatus(prev => ({ ...prev, provider: newModel }));
                                            }}
                                            className="select w-36"
                                            aria-label="AI model"
                                            title="Select AI Model (Gemini, DeepSeek, ChatGPT, Claude)"
                                        >
                                            <option value="gemini">Gemini web</option>
                                            <option value="deepseek">DeepSeek web</option>
                                            <option value="chatgpt">ChatGPT web</option>
                                            <option value="claude">Claude web</option>
                                        </select>
                                    )}

                                    <label className="btn btn-secondary cursor-pointer" title="Add more PDFs or images">
                                        <Plus />
                                        Add files
                                        <input
                                            type="file"
                                            className="hidden"
                                            accept=".pdf,.jpg,.jpeg,.png"
                                            multiple
                                            onChange={(e) => handleFilesSelected(e.target.files, true)}
                                        />
                                    </label>
                                </>
                            )}

                            {hasCompletedPages && (
                                <>
                                    <div className="toolbar-divider hidden sm:block" />
                                    <label className="input-group w-44 sm:w-52" title="Output file name. Rename here before download!">
                                        <FileText className="w-4 h-4 text-ink-3 shrink-0" />
                                        <input
                                            type="text"
                                            value={fileName}
                                            onChange={(e) => setFileName(e.target.value)}
                                            placeholder="File name"
                                            aria-label="Output file name"
                                        />
                                        <span className="text-xs text-ink-3 shrink-0">.docx</span>
                                    </label>
                                    <button onClick={copyAllText} className="btn btn-ghost btn-icon" title="Copy all text" aria-label="Copy all text">
                                        {copySuccess ? <Check className="text-emerald-400" /> : <Copy />}
                                    </button>
                                    <button
                                        onClick={downloadDocx}
                                        className={`btn ${appState !== AppState.ANALYZING && selectedPendingCount === 0 && !hasErrorPages ? 'btn-primary' : 'btn-secondary'}`}
                                    >
                                        <FileDown />
                                        Download DOCX
                                    </button>
                                </>
                            )}

                            {appState !== AppState.ANALYZING ? (
                                (selectedPendingCount > 0 || hasErrorPages || !hasCompletedPages) && (
                                    <button
                                        onClick={startExtraction}
                                        disabled={selectedPendingCount === 0 && !hasErrorPages}
                                        className="btn btn-primary"
                                    >
                                        <Wand2 />
                                        {hasErrorPages && selectedPendingCount === 0
                                            ? 'Retry failed'
                                            : `Convert ${selectedPendingCount} page${selectedPendingCount === 1 ? '' : 's'}`}
                                    </button>
                                )
                            ) : (
                                <>
                                    {pages.filter(p => p.isSelected && p.status === 'error').length > 0 && (
                                        <button
                                            onClick={() => {
                                                setPages(prev => prev.map(p => p.isSelected && p.status === 'error' ? { ...p, status: 'pending', elements: undefined, extractedText: undefined } : p));
                                                startExtraction();
                                            }}
                                            className="btn btn-danger"
                                        >
                                            Retry failed
                                        </button>
                                    )}
                                    <span className="badge badge-accent h-[34px] px-3 rounded-lg">
                                        <RefreshCw className="animate-spin" />
                                        Converting…
                                    </span>
                                </>
                            )}
                        </div>
                   </div>

                   {/* Output options */}
                   <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-t border-line bg-white/[0.015]">
                        <span className="text-xs font-semibold text-ink-3 mr-1">Output</span>
                        <div className="seg seg-sm" role="group" aria-label="Extraction mode">
                            <button
                                type="button"
                                aria-pressed={!mcqMode}
                                onClick={() => setMcqMode(false)}
                                className="seg-item"
                                title="Full Text mode: extracts 100% of all text from each page"
                            >
                                Full text
                            </button>
                            <button
                                type="button"
                                aria-pressed={mcqMode}
                                onClick={() => setMcqMode(true)}
                                className="seg-item"
                                title="MCQ mode: questions, options and answers only"
                            >
                                MCQ only
                            </button>
                        </div>
                        <ToggleChip on={isBilingual} onClick={() => setIsBilingual(!isBilingual)} label="Bilingual" />
                        <ToggleChip on={refineMode} onClick={() => setRefineMode(!refineMode)} label="Refine" title="Remove exam tags, shift dates, page numbers and watermarks" />
                        <ToggleChip on={autoProofread} onClick={() => setAutoProofread(!autoProofread)} label="Auto proofread" />
                        <ToggleChip on={includeImages} onClick={() => setIncludeImages(!includeImages)} label="Keep images" />
                        <ToggleChip on={showMcqNumbers} onClick={() => setShowMcqNumbers(!showMcqNumbers)} label="Numbers" title="Show question numbers" />
                        <ToggleChip on={showAnswers} onClick={() => setShowAnswers(!showAnswers)} label="Answers" title="Show answers" />
                        <ToggleChip on={autoDownload} onClick={() => setAutoDownload(!autoDownload)} label="Auto-download" title="Download the DOCX automatically when conversion finishes" />
                        <select
                            value={numberingStyle}
                            onChange={(e) => setNumberingStyle(e.target.value as NumberingStyle)}
                            className="select select-sm w-auto"
                            aria-label="Question numbering pattern"
                            title="Question numbering pattern"
                        >
                            <option value={NumberingStyle.Q_DOT}>Q1.</option>
                            <option value={NumberingStyle.HASH}>#1.</option>
                            <option value={NumberingStyle.QUESTION_DOT}>Question 1.</option>
                            <option value={NumberingStyle.NUMBER_DOT}>1.</option>
                        </select>
                        <select
                            value={optionArrangement}
                            onChange={(e) => setOptionArrangement(e.target.value as OptionArrangement)}
                            className="select select-sm w-auto"
                            aria-label="Option layout"
                            title="Choose option arrangement for layout and DOCX export"
                        >
                            <option value={OptionArrangement.VERTICAL}>Options: vertical</option>
                            <option value={OptionArrangement.HORIZONTAL}>Options: inline</option>
                            <option value={OptionArrangement.GRID}>Options: 2×2 grid</option>
                        </select>
                   </div>
                </div>

                {/* Error banner */}
                <AnimatePresence>
                    {errorMsg && (
                        <motion.div
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            className="callout callout-danger flex-col gap-3 p-4"
                            role="alert"
                        >
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-rose-400" />
                                <div>
                                    <h4 className="font-semibold text-sm text-rose-200">Processing interrupted</h4>
                                    <p className="text-sm mt-1 text-ink-2 leading-relaxed">{errorMsg}</p>
                                </div>
                            </div>
                            <div className="flex gap-2 pl-8">
                                <button onClick={retryAllErrors} className="btn btn-danger-solid btn-sm">
                                    <RefreshCw />
                                    Retry failed pages
                                </button>
                                <button onClick={() => setErrorMsg(null)} className="btn btn-ghost btn-sm">
                                    Dismiss
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {hasErrorPages && !errorMsg && (
                    <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="callout callout-danger flex-col sm:flex-row sm:items-center justify-between gap-3 p-4"
                    >
                        <div className="flex items-center gap-3">
                            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
                            <div>
                                <h5 className="text-sm font-semibold text-ink">Some pages failed to convert</h5>
                                <p className="text-xs text-ink-3">Retry them all at once, or one by one below.</p>
                            </div>
                        </div>
                        <button onClick={retryAllErrors} className="btn btn-danger-solid btn-sm">
                            <RefreshCw />
                            Retry {pages.filter(p => p.status === 'error').length} failed pages
                        </button>
                    </motion.div>
                )}

                {/* Grid of Pages */}
                <ProcessingList
                    pages={pages}
                    onUpdateText={updatePageText}
                    onRetry={retryPage}
                    onRecapture={handleRecapturePage}
                    onToggleSelection={togglePageSelection}
                    includeImages={includeImages}
                    showAnswers={showAnswers}
                    showMcqNumbers={showMcqNumbers}
                    numberingStyle={numberingStyle}
                    mcqMode={mcqMode}
                />
             </motion.div>
           )}
        </main>

        <HistorySidebar
          history={history}
          isOpen={isHistoryOpen}
          onClose={() => setIsHistoryOpen(false)}
          onSelectItem={handleSelectHistoryItem}
          onDeleteItem={handleDeleteHistoryItem}
          onClearAll={handleClearAllHistory}
        />

        <McqSidebar
          isOpen={isMcqSidebarOpen}
          onClose={() => setIsMcqSidebarOpen(false)}
          pages={pages}
          mcqMode={mcqMode}
          autoProofread={autoProofread}
          isBilingual={isBilingual}
          showMcqNumbers={showMcqNumbers}
          showAnswers={showAnswers}
        />

        {/* Features & FAQ (only before a document is loaded) */}
        {pages.length === 0 && (
          <div className="pt-10 space-y-12">
            <section>
              <h2 className="font-display text-xl font-bold tracking-tight text-ink mb-5">What you get</h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { icon: <Wand2 />, title: 'Accurate OCR', desc: 'Reads blurry scans, shaded backgrounds and low-contrast prints.' },
                  { icon: <Layout />, title: 'Native Word math', desc: 'Fractions, roots and powers become editable OMML equations.' },
                  { icon: <Layers />, title: 'Layout aware', desc: 'Headers, columns, options (a)–(d) and multi-row tables stay in order.' },
                  { icon: <ListChecks />, title: 'Exam refiner', desc: 'Strips exam tags, shift dates and watermarks from questions.' },
                ].map((f) => (
                  <div key={f.title} className="panel p-4">
                    <span className="w-9 h-9 rounded-lg flex items-center justify-center bg-white/[0.04] border border-line text-ink-2 mb-3 [&>svg]:w-[18px] [&>svg]:h-[18px]">{f.icon}</span>
                    <h3 className="font-semibold text-ink mb-1">{f.title}</h3>
                    <p className="text-sm text-ink-3 leading-relaxed">{f.desc}</p>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="font-display text-xl font-bold tracking-tight text-ink mb-5">Frequently asked questions</h2>
              <div className="card divide-y divide-line">
                {[
                  {
                    q: "How does the AI handle complex mathematical formulas?",
                    a: "Formulas, fractions (\\frac{a}{b}), roots, and superscripts are transcribed into standard LaTeX and converted directly into native Microsoft Word Math (OMML) objects upon download."
                  },
                  {
                    q: "Can I extract large tables with multiple rows?",
                    a: "Yes. There are no row limits. Tables of any length are recreated as native, editable Word tables with borders and header shading."
                  },
                  {
                    q: "What does the Refine option do?",
                    a: "When Refine is on, the AI strips previous year exam tags (e.g. SSC CGL 2022 Shift-II), book headers, page numbers, and publisher branding to leave only questions and options."
                  },
                  {
                    q: "How does Bilingual mode work?",
                    a: "In Bilingual mode, a Hindi question gets its English translation below it, and options are formatted on a single line as '(a) Hindi / English'."
                  },
                  {
                    q: "Are my uploaded documents private?",
                    a: "Files are sent over encrypted HTTPS and processed in memory without permanent cloud storage."
                  },
                  {
                    q: "What file formats can I upload?",
                    a: "PDF documents, scanned images (JPG, JPEG, PNG, WEBP), or screenshots pasted with Ctrl+V."
                  }
                ].map((faq) => (
                  <details key={faq.q} className="group px-4 sm:px-5">
                    <summary className="flex items-center justify-between gap-4 py-4 cursor-pointer list-none text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
                      {faq.q}
                      <Plus className="w-4 h-4 text-ink-3 shrink-0 transition-transform group-open:rotate-45" />
                    </summary>
                    <p className="pb-4 -mt-1 text-sm text-ink-3 leading-relaxed">{faq.a}</p>
                  </details>
                ))}
              </div>
            </section>

            <footer className="pt-6 border-t border-line flex flex-wrap items-center justify-between gap-3 text-xs text-ink-3">
              <span>© 2026 TextExtract AI Pro · Gemini Vision OCR and Word OMML</span>
              <span className="flex gap-4">
                <a href="#" className="hover:text-ink">Privacy</a>
                <a href="#" className="hover:text-ink">Terms</a>
                <a href="#" className="hover:text-ink">Support</a>
              </span>
            </footer>
          </div>
        )}
      </div>

      <GeminiConnectModal
        isOpen={showGeminiConnect}
        onClose={() => {
          setShowGeminiConnect(false);
          checkAuth();
        }}
        onConnected={() => {
          setShowGeminiConnect(false);
          checkAuth();
        }}
      />

      <GeminiSettingsModal
        isOpen={showGeminiSettings}
        onClose={() => {
          setShowGeminiSettings(false);
          checkAuth();
        }}
      />

      <MocktestStudioModal
        isOpen={showMocktestStudio}
        onClose={() => setShowMocktestStudio(false)}
        initialItems={mocktestItems}
        defaultSetName={fileName || 'Exam Mock Test 01'}
      />
    </div>
  );
};

export default PdfConverter;
