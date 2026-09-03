import React, { useState, useEffect } from 'react';
import { FileDown, RefreshCw, Wand2, AlertTriangle, AlertCircle, FileText, Copy, Check, Filter, Settings, Layout, Clock, Plus, ListChecks, Zap, Type, Sparkles, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import FileUploader from './FileUploader';
import ProcessingList from './ProcessingList';
import HistorySidebar from './HistorySidebar';
import McqSidebar from './McqSidebar';
import UploadProgressBar, { UploadProgressData } from './UploadProgressBar';
import { AppState, ScannedPage, NumberingStyle, OptionArrangement, HistoryItem } from '../types';
import { convertPdfToImages, readFileAsBase64, cropImage } from '../services/pdfUtils';
import { extractLayoutFromImage } from '../services/geminiService';
import { generateDocx } from '../services/docxService';

// Fallback UUID generator
const generateId = () => Math.random().toString(36).substr(2, 9);

const PdfConverter: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [fileName, setFileName] = useState<string>("document");
  const [rangeInput, setRangeInput] = useState<string>("");
  const [autoDownload, setAutoDownload] = useState<boolean>(true);
  const [numberingStyle, setNumberingStyle] = useState<NumberingStyle>(NumberingStyle.HASH);
  const [isBilingual, setIsBilingual] = useState(false);
  const [includeImages, setIncludeImages] = useState<boolean>(false);
  const [optionArrangement, setOptionArrangement] = useState<OptionArrangement>(OptionArrangement.VERTICAL);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isMcqSidebarOpen, setIsMcqSidebarOpen] = useState(false);
  const [mcqMode, setMcqMode] = useState(true);
  const [showMcqNumbers, setShowMcqNumbers] = useState(true);
  const [showAnswers, setShowAnswers] = useState(true);
  const [refineMode, setRefineMode] = useState(false);
  const [autoProofread, setAutoProofread] = useState(false);
  const [selectedError, setSelectedError] = useState<string | null>(null);
  const [wordsConsumed, setWordsConsumed] = useState(0);
  const [pointsConsumed, setPointsConsumed] = useState(0);
  const [totalKeys, setTotalKeys] = useState(1);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressData | null>(null);

  // Helper to count words
  const countWords = (text: string) => {
    return text.trim().split(/\s+/).filter(Boolean).length;
  };

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(data => {
        if (data.totalKeys) setTotalKeys(data.totalKeys);
      })
      .catch(err => console.error("Config fetch failed:", err));
  }, []);

  // Load history on mount
  useEffect(() => {
    const savedHistory = localStorage.getItem('conversion_history');
    if (savedHistory) {
      try { setHistory(JSON.parse(savedHistory)); } catch (e) { console.error("Failed to load history", e); }
    }
  }, []);

  // Save history to localStorage
  useEffect(() => {
    try { localStorage.setItem('conversion_history', JSON.stringify(history)); } catch (e) {}
  }, [history]);

  // Auto-save to history effect
  useEffect(() => {
    if (appState === AppState.COMPLETED) {
      const completedElements = pages
        .filter(p => p.status === 'done' && p.elements)
        .flatMap(p => p.elements || []);
      
      if (completedElements.length > 0) {
        const newItem: Omit<HistoryItem, 'id'> = {
          fileName: fileName,
          timestamp: Date.now(),
          pagesCount: pages.length,
          elements: completedElements
        };

        setHistory(prev => [{ ...newItem, id: generateId() } as HistoryItem, ...prev].slice(0, 20));
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
    
    // Process pages in parallel batches
    // We can confidently process up to 10 pages in parallel if multiple keys are available
    // Even with 1 key, Gemini 1.5 Flash supports concurrent requests well (up to 15 RPM).
    const BATCH_SIZE = Math.min(10, pages.filter(p => p.isSelected).length);
    let criticalErrorOccurred = false;

    // 1. Visually mark ALL selected pages as 'processing' immediately.
    setPages(prev => prev.map(p => 
      (p.isSelected && p.status !== 'done') 
        ? { ...p, status: 'processing', elements: undefined, extractedText: undefined } 
        : p
    ));
    
    // Identify pages to process
    const pagesToProcess = pages.filter(p => p.isSelected && p.status !== 'done');

    for (let i = 0; i < pagesToProcess.length; i += BATCH_SIZE) {
        if (criticalErrorOccurred) break;

        const batch = pagesToProcess.slice(i, i + BATCH_SIZE);
        
        await Promise.all(batch.map(async (page, index) => {
            if (criticalErrorOccurred) return;

            // Stagger requests by 600ms to avoid burst limits
            await new Promise(resolve => setTimeout(resolve, index * 600));

            try {
                const elements = await extractLayoutFromImage(page.imageUrl, numberingStyle, includeImages, isBilingual, mcqMode, refineMode, showAnswers);
                
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

  const retryPage = async (id: string) => {
    const page = pages.find(p => p.id === id);
    if (!page) return;
    
    // Reset global error msg if any, as user is attempting action
    setErrorMsg(null);

    // Update to processing
    setPages(prev => prev.map(p => p.id === id ? { ...p, status: 'processing', extractedText: undefined, elements: undefined, errorMessage: undefined } : p));

    try {
      const elements = await extractLayoutFromImage(page.imageUrl, numberingStyle, includeImages, isBilingual, mcqMode, refineMode, showAnswers);
      
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
    }
  };

  const updatePageText = (id: string, newText: string) => {
    setPages(prev => prev.map(p => p.id === id ? { ...p, extractedText: newText } : p));
  };

  const formatPrefix = (num: string | number, style: NumberingStyle) => {
    switch (style) {
      case NumberingStyle.Q_DOT: return `Q${num}. `;
      case NumberingStyle.HASH: return `#${num}. `;
      case NumberingStyle.NUMBER_DOT: return `${num}. `;
      case NumberingStyle.QUESTION_DOT:
      default: return `Question: ${num}. `;
    }
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
                if (showMcqNumbers && content) {
                  content = content.replace(/^(\s*(?:#?(?:Question|Q)\.?\s*[:\-]?\s*|\bPrashn\s*|\bप्रश्न\s*)?)(\d+)?([\.\)\-:]?\s+)/gim, (_m, prefix, num) => {
                    if (/Question|Q|Prashn|प्रश्न|#/i.test(prefix) || num) {
                      return formatPrefix(qCounter++, numberingStyle);
                    }
                    return _m;
                  });
                } else if (!showMcqNumbers && content) {
                  content = content.replace(/^(\s*(?:#?(?:Question|Q)\.?\s*[:\-]?\s*|\bPrashn\s*|\bप्रश्न\s*)?)(\d+)([\.\)\-:]?\s+)/gim, (_m, _prefix, num) => {
                    return formatPrefix(num, numberingStyle);
                  });
                }
                return content;
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
      .filter(p => p.isSelected && p.status === 'done' && p.elements)
      .flatMap(p => p.elements || [])
      .filter(el => includeImages || el.type !== 'image');
    
    if (allElements.length === 0) {
        if (!autoDownload) setErrorMsg("No content extracted to save.");
        return;
    }

    try {
      const blob = await generateDocx(allElements, optionArrangement, showMcqNumbers, numberingStyle, showAnswers);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}.docx`;
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
    a.download = `${fileName}.txt`;
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
        const blob = await generateDocx(elements, optionArrangement, showMcqNumbers, numberingStyle, showAnswers);
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
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const hasCompletedPages = pages.some(p => p.status === 'done' && (p.extractedText || p.elements));
  const hasErrorPages = pages.some(p => p.status === 'error');
  
  // Selection Stats
  const selectedCount = pages.filter(p => p.isSelected).length;
  const totalCount = pages.length;
  const selectedPendingCount = pages.filter(p => p.isSelected && p.status !== 'done').length;

  return (
    <div className="min-h-screen bg-[#0F0F0F] font-sans selection:bg-[#FF6B2B]/20 selection:text-[#FF6B2B] relative">
      {/* Floating Top Upload Progress Bar */}
      <AnimatePresence>
        {uploadProgress && (
          <UploadProgressBar progress={uploadProgress} />
        )}
      </AnimatePresence>

      <div className="max-w-7xl mx-auto px-3 py-3 md:px-3 md:py-12">
        
        <header className="mb-6 flex items-center justify-end">
          <div className="flex items-center gap-2">
            {pages.length > 0 && (
              <button 
                onClick={reset}
                className="flex items-center gap-2 px-3 py-1.5 text-[12px] font-medium text-[#555555] hover:text-[#F44336] hover:bg-[#3A1A1A] rounded-[6px] transition-colors border border-[#252525]"
                title="Reset All"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reset All</span>
              </button>
            )}
          </div>
        </header>

        {/* Main Content */}
        <main className="relative">
           {/* Upload Area */}
           {pages.length === 0 ? (
             <div className="max-w-4xl mx-auto">
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                  className="text-center mb-12 space-y-4"
                >
                    <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-[#FF884D] text-xs uppercase tracking-wider font-bold mb-2 shadow-inner">
                        <Sparkles className="w-3.5 h-3.5 text-[#FF6B2B]" />
                        <span>AI-Powered Layout & Math OCR</span>
                    </div>

                    <h2 className="text-3xl sm:text-5xl md:text-6xl font-extrabold text-white tracking-tight leading-tight font-display">
                        Convert <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#FF6B2B] via-[#FFA477] to-amber-300">PDF to Text</span> <br className="hidden md:block" /> with Human-Like Accuracy
                    </h2>
                    <p className="text-slate-400 text-sm sm:text-base md:text-lg max-w-2xl mx-auto leading-relaxed">
                        The ultimate AI OCR engine designed for exam papers, formulas, tables, and bilingual documents. 
                        Preserves original hierarchy and exports directly to <strong className="text-white font-semibold">Microsoft Word (.docx)</strong>.
                    </p>

                    <div className="flex flex-wrap justify-center gap-3 pt-2">
                        <div className="flex items-center gap-2 bg-white/[0.03] px-3.5 py-1.5 rounded-full border border-white/[0.06] text-xs font-semibold text-slate-200">
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span>99.9% Accuracy</span>
                        </div>
                        <div className="flex items-center gap-2 bg-white/[0.03] px-3.5 py-1.5 rounded-full border border-white/[0.06] text-xs font-semibold text-slate-200">
                            <Check className="w-3.5 h-3.5 text-blue-400" />
                            <span>Real Word Math (OMML)</span>
                        </div>
                        <div className="flex items-center gap-2 bg-white/[0.03] px-3.5 py-1.5 rounded-full border border-white/[0.06] text-xs font-semibold text-slate-200">
                            <Check className="w-3.5 h-3.5 text-purple-400" />
                            <span>Full Table Extraction</span>
                        </div>
                    </div>
                </motion.div>

                <FileUploader 
                  onFilesSelected={handleFilesSelected} 
                  isLoading={appState === AppState.PROCESSING_PDF}
                />

                {/* How it works section */}
                <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-5">
                    {[
                        { step: "01", title: "Upload Paper or PDF", desc: "Drag & drop your scanned question papers, notes, or books into the secure converter." },
                        { step: "02", title: "AI Vision Analysis", desc: "Gemini vision model identifies text, equations, tables, and Hindi/English bilingual pairs." },
                        { step: "03", title: "Instant Word Export", desc: "Download refined, layout-preserved .docx documents with editable math and clean tables." }
                    ].map((item, i) => (
                        <div key={i} className="glass-panel glass-panel-hover p-6 rounded-2xl relative overflow-hidden group">
                            <div className="text-4xl font-black text-white/[0.04] absolute -right-2 -bottom-2 group-hover:text-[#FF6B2B]/15 transition-colors font-mono">
                                {item.step}
                            </div>
                            <div className="text-xs font-bold text-[#FF884D] font-mono mb-2 uppercase tracking-wider">Step {item.step}</div>
                            <h3 className="text-base font-bold text-white mb-2 relative z-10 font-display">{item.title}</h3>
                            <p className="text-slate-400 text-xs sm:text-sm leading-relaxed relative z-10">{item.desc}</p>
                        </div>
                    ))}
                </div>

             </div>
           ) : (
             <motion.div
               initial={{ opacity: 0, y: 10 }}
               animate={{ opacity: 1, y: 0 }}
               className="space-y-6"
             >

                {/* Error Modal */}
                <AnimatePresence>
                  {selectedError && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 bg-[#0F0F0F]/50 z-[100] flex items-center justify-center p-3"
                      onClick={() => setSelectedError(null)}
                    >
                      <motion.div 
                        initial={{ scale: 0.9 }}
                        animate={{ scale: 1 }}
                        className="bg-[#1A1A1A] p-3 rounded-[8px] max-w-lg w-full"
                        onClick={e => e.stopPropagation()}
                      >
                        <h3 className="text-[16px] font-bold text-[#EFEFEF] mb-4">Error Details</h3>
                        <pre className="bg-[#141414] p-3 rounded-[8px] text-[11px] text-[#EFEFEF] overflow-auto max-h-60 whitespace-pre-wrap">
                          {selectedError}
                        </pre>
                        <button 
                          onClick={() => setSelectedError(null)}
                          className="mt-4 w-full bg-transparent border border-[#2A2A2A] text-[#EFEFEF] py-2 rounded-[6px] hover:bg-[#1A1A1A] transition-colors font-medium text-[13px]"
                        >
                          Close
                        </button>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Main Tool Header - Combined Progress & Actions */}
                <div className="bg-[#11141F]/90 backdrop-blur-xl rounded-2xl border border-white/[0.08] shadow-2xl sticky top-16 z-40 overflow-hidden">
                   {/* Integrated Progress Bar (Top edge) */}
                   <AnimatePresence>
                        {appState === AppState.ANALYZING && (
                            <motion.div 
                                initial={{ height: 0 }}
                                animate={{ height: 4 }}
                                exit={{ height: 0 }}
                                className="w-full bg-white/[0.05] relative overflow-hidden"
                            >
                                <motion.div 
                                    className="h-full bg-gradient-to-r from-[#FF6B2B] to-[#FF884D] shadow-[0_0_12px_#FF6B2B]"
                                    initial={{ width: 0 }}
                                    animate={{ width: `${Math.round(((pages.filter(p => p.isSelected && (p.status === 'done' || p.status === 'error')).length) / Math.max(1, pages.filter(p => p.isSelected).length)) * 100)}%` }}
                                    transition={{ type: "spring", bounce: 0, duration: 0.5 }}
                                />
                            </motion.div>
                        )}
                   </AnimatePresence>

                   <div className="p-3 sm:p-4 flex flex-col gap-3">
                        {/* Top Row: Processing Info & Main Actions */}
                        <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-3">
                            <div className="flex flex-wrap items-center gap-2 sm:gap-3 flex-1 min-w-0">
                                {appState === AppState.ANALYZING ? (
                                    <div className="flex items-center gap-3 bg-white/[0.04] px-3 py-1.5 rounded-xl border border-white/[0.08] min-w-0 max-w-md">
                                        <RefreshCw className="w-4 h-4 text-[#FF6B2B] animate-spin flex-shrink-0" />
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-xs font-bold text-white truncate">Processing: {fileName}</span>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] text-[#FF884D] font-bold tabular-nums">
                                                    {Math.round(((pages.filter(p => p.isSelected && (p.status === 'done' || p.status === 'error')).length) / Math.max(1, pages.filter(p => p.isSelected).length)) * 100)}%
                                                </span>
                                                <span className="text-[10px] text-slate-400 font-medium">
                                                    {pages.filter(p => p.isSelected && (p.status === 'done' || p.status === 'error')).length}/{pages.filter(p => p.isSelected).length} pages
                                                </span>
                                                {totalKeys > 1 && (
                                                  <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 text-[9px] font-black rounded uppercase tracking-wider border border-emerald-500/20">
                                                    Turbo: {totalKeys} Keys
                                                  </span>
                                                )}
                                                {pages.filter(p => p.isSelected && p.status === 'error').length > 0 && (
                                                    <div className="flex items-center gap-2">
                                                        <button 
                                                            onClick={() => setSelectedError(pages.find(p => p.isSelected && p.status === 'error')?.errorMessage || "No error details available.")}
                                                            className="text-[10px] text-rose-400 font-bold hover:underline"
                                                        >
                                                            {pages.filter(p => p.isSelected && p.status === 'error').length} errors
                                                        </button>
                                                        <button 
                                                            onClick={retryAllErrors}
                                                            className="flex items-center gap-1 px-2 py-0.5 bg-rose-500/15 border border-rose-500/30 text-rose-400 rounded-lg hover:bg-rose-500/25 transition-all text-[10px] font-bold"
                                                        >
                                                            <RefreshCw className="w-2.5 h-2.5" />
                                                            Retry All
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/[0.04] rounded-xl border border-white/[0.06]">
                                        <span className="text-xs font-bold text-white tabular-nums px-1">{selectedCount}/{totalCount}</span>
                                        <div className="flex gap-1">
                                            <button 
                                                onClick={() => toggleAllSelection(true)}
                                                className="text-[10px] font-bold text-white hover:bg-white/[0.08] px-2 py-1 rounded-lg transition-all"
                                            >
                                                ALL
                                            </button>
                                            <button 
                                                onClick={() => toggleAllSelection(false)}
                                                className="text-[10px] font-bold text-slate-400 hover:bg-white/[0.08] px-2 py-1 rounded-lg transition-all"
                                            >
                                                NONE
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Live Consumption Stats */}
                                <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-1.5 bg-white/[0.03] px-2.5 py-1 rounded-xl border border-white/[0.05]">
                                        <Type className="w-3.5 h-3.5 text-blue-400" />
                                        <span className="text-xs font-bold text-slate-200 tabular-nums">{wordsConsumed.toLocaleString()} <span className="text-[9px] text-slate-500 uppercase">Words</span></span>
                                    </div>
                                    <div className="flex items-center gap-1.5 bg-white/[0.03] px-2.5 py-1 rounded-xl border border-white/[0.05]">
                                        <Zap className="w-3.5 h-3.5 text-amber-400" />
                                        <span className="text-xs font-bold text-slate-200 tabular-nums">{pointsConsumed} <span className="text-[9px] text-slate-500 uppercase">Points</span></span>
                                    </div>
                                </div>

                                <div className="relative">
                                    <Filter className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                                    <input 
                                        type="text" 
                                        placeholder="Range (e.g. 1-5)" 
                                        className="pl-7 pr-2.5 py-1 text-xs bg-white/[0.03] border border-white/[0.08] rounded-xl focus:outline-none focus:border-[#FF6B2B] focus:ring-1 focus:ring-[#FF6B2B]/50 transition-all w-28 text-white placeholder:text-slate-500"
                                        value={rangeInput}
                                        onChange={(e) => setRangeInput(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && applyRangeSelection()}
                                    />
                                </div>
                            </div>

                            <div className="flex items-center gap-2 justify-end">
                                {hasCompletedPages && (
                                    <div className="flex gap-2">
                                        <button 
                                            onClick={copyAllText}
                                            className="p-2 text-slate-400 hover:text-white bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] rounded-xl transition-all"
                                            title="Copy All"
                                        >
                                            {copySuccess ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                                        </button>
                                        <button 
                                            onClick={downloadDocx}
                                            className="px-3.5 py-2 text-white bg-gradient-to-r from-blue-600/20 to-blue-500/10 border border-blue-500/30 hover:bg-blue-500/20 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-sm"
                                        >
                                            <FileDown className="w-4 h-4 text-blue-400" />
                                            DOCX
                                        </button>
                                    </div>
                                )}

                                {appState !== AppState.ANALYZING ? (
                                    <div className="flex gap-2 flex-1 sm:flex-none">
                                        <label className="px-3.5 py-2 text-slate-200 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-all">
                                            <Plus className="w-4 h-4 text-[#FF6B2B]" />
                                            ADD
                                            <input 
                                                type="file" 
                                                className="hidden" 
                                                accept=".pdf,.jpg,.jpeg,.png" 
                                                multiple 
                                                onChange={(e) => handleFilesSelected(e.target.files, true)} 
                                            />
                                        </label>
                                        <button
                                            onClick={startExtraction}
                                            disabled={selectedPendingCount === 0 && !hasErrorPages}
                                            className={`px-4 py-2 rounded-xl flex items-center justify-center gap-2 text-xs font-bold transition-all shadow-md ${
                                                selectedPendingCount === 0 && !hasErrorPages
                                                    ? 'bg-white/[0.05] text-slate-500 border border-white/[0.04] cursor-not-allowed'
                                                    : 'bg-gradient-to-r from-[#FF6B2B] to-[#FF884D] text-white hover:shadow-lg hover:shadow-[#FF6B2B]/25 hover:scale-[1.02] active:scale-[0.98]'
                                            }`}
                                        >
                                            <Wand2 className="w-4 h-4" /> 
                                            {hasErrorPages && selectedPendingCount === 0 
                                                ? 'RETRY' 
                                                : `CONVERT (${selectedPendingCount})`
                                            }
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex gap-2 flex-1 sm:flex-none">
                                        {pages.filter(p => p.isSelected && p.status === 'error').length > 0 && (
                                            <button 
                                                onClick={() => {
                                                    setPages(prev => prev.map(p => p.isSelected && p.status === 'error' ? { ...p, status: 'pending', elements: undefined, extractedText: undefined } : p));
                                                    startExtraction();
                                                }}
                                                className="px-3 py-2 bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-bold hover:bg-rose-500/30 transition-all"
                                            >
                                                Retry Failed
                                            </button>
                                        )}
                                        <div className="px-4 py-2 bg-[#FF6B2B]/15 border border-[#FF6B2B]/30 text-[#FF884D] rounded-xl text-xs font-bold flex items-center justify-center gap-2">
                                            <RefreshCw className="w-4 h-4 animate-spin" />
                                            PROCESSING...
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Bottom Row: Tools & Settings Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-2 pt-2.5 border-t border-white/[0.06]">
                            {/* MCQ Mode */}
                            <div className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-amber-500/30 transition-all">
                                <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">MCQ Mode</span>
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-slate-400 font-medium">{mcqMode ? 'Active' : 'General'}</span>
                                    <button
                                        onClick={() => setMcqMode(!mcqMode)}
                                        className={`w-8 h-4 rounded-full transition-all flex items-center px-0.5 ${mcqMode ? 'bg-amber-500' : 'bg-white/[0.1]'}`}
                                    >
                                        <div className={`w-3 h-3 rounded-full bg-slate-900 transition-transform ${mcqMode ? 'translate-x-4' : 'translate-x-0'}`} />
                                    </button>
                                </div>
                            </div>

                            {/* Auto Proofread */}
                            <div className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-purple-500/30 transition-all">
                                <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">Proofread</span>
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-slate-400 font-medium">{autoProofread ? 'Auto' : 'Manual'}</span>
                                    <button
                                        onClick={() => setAutoProofread(!autoProofread)}
                                        className={`w-8 h-4 rounded-full transition-all flex items-center px-0.5 ${autoProofread ? 'bg-purple-500' : 'bg-white/[0.1]'}`}
                                    >
                                        <div className={`w-3 h-3 rounded-full bg-slate-900 transition-transform ${autoProofread ? 'translate-x-4' : 'translate-x-0'}`} />
                                    </button>
                                </div>
                            </div>

                            {/* Numbering Style */}
                            <div className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-blue-500/30 transition-all">
                                <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Pattern</span>
                                <select 
                                    value={numberingStyle}
                                    onChange={(e) => setNumberingStyle(e.target.value as NumberingStyle)}
                                    className="text-[10px] font-bold bg-[#0B0D13] border border-white/[0.1] rounded-lg px-1.5 py-1 text-slate-200 cursor-pointer focus:outline-none focus:border-blue-500"
                                >
                                    <option value={NumberingStyle.Q_DOT} className="bg-[#11141F] text-slate-200">Q1.</option>
                                    <option value={NumberingStyle.HASH} className="bg-[#11141F] text-slate-200">#1.</option>
                                    <option value={NumberingStyle.QUESTION_DOT} className="bg-[#11141F] text-slate-200">Question 1.</option>
                                    <option value={NumberingStyle.NUMBER_DOT} className="bg-[#11141F] text-slate-200">1.</option>
                                </select>
                            </div>

                            {/* Bilingual */}
                            <div className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-emerald-500/30 transition-all">
                                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Bilingual</span>
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-slate-400 font-medium">{isBilingual ? 'On' : 'Off'}</span>
                                    <button
                                        onClick={() => setIsBilingual(!isBilingual)}
                                        className={`w-8 h-4 rounded-full transition-all flex items-center px-0.5 ${isBilingual ? 'bg-emerald-500' : 'bg-white/[0.1]'}`}
                                    >
                                        <div className={`w-3 h-3 rounded-full bg-slate-900 transition-transform ${isBilingual ? 'translate-x-4' : 'translate-x-0'}`} />
                                    </button>
                                </div>
                            </div>

                            {/* Images */}
                            <div className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-cyan-500/30 transition-all">
                                <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider">Images</span>
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-slate-400 font-medium">{includeImages ? 'Keep' : 'Skip'}</span>
                                    <button
                                        onClick={() => setIncludeImages(!includeImages)}
                                        className={`w-8 h-4 rounded-full transition-all flex items-center px-0.5 ${includeImages ? 'bg-cyan-500' : 'bg-white/[0.1]'}`}
                                    >
                                        <div className={`w-3 h-3 rounded-full bg-slate-900 transition-transform ${includeImages ? 'translate-x-4' : 'translate-x-0'}`} />
                                    </button>
                                </div>
                            </div>

                            {/* Auto Save */}
                            <div className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-teal-500/30 transition-all">
                                <span className="text-[10px] font-bold text-teal-400 uppercase tracking-wider">Auto Save</span>
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-slate-400 font-medium">{autoDownload ? 'On' : 'Off'}</span>
                                    <button
                                        onClick={() => setAutoDownload(!autoDownload)}
                                        className={`w-8 h-4 rounded-full transition-all flex items-center px-0.5 ${autoDownload ? 'bg-teal-500' : 'bg-white/[0.1]'}`}
                                    >
                                        <div className={`w-3 h-3 rounded-full bg-slate-900 transition-transform ${autoDownload ? 'translate-x-4' : 'translate-x-0'}`} />
                                    </button>
                                </div>
                            </div>

                            {/* Refine Mode */}
                            <div className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-rose-500/30 transition-all">
                                <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">Refine</span>
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-slate-400 font-medium">{refineMode ? 'Active' : 'A-Z'}</span>
                                    <button
                                        onClick={() => setRefineMode(!refineMode)}
                                        className={`w-8 h-4 rounded-full transition-all flex items-center px-0.5 ${refineMode ? 'bg-rose-500' : 'bg-white/[0.1]'}`}
                                    >
                                        <div className={`w-3 h-3 rounded-full bg-slate-900 transition-transform ${refineMode ? 'translate-x-4' : 'translate-x-0'}`} />
                                    </button>
                                </div>
                            </div>

                            {/* Answers Toggle */}
                            <div className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-[#FF6B2B]/30 transition-all">
                                <span className="text-[10px] font-bold text-[#FF884D] uppercase tracking-wider">Answers</span>
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-slate-400 font-medium">{showAnswers ? 'On' : 'Off'}</span>
                                    <button
                                        onClick={() => setShowAnswers(!showAnswers)}
                                        className={`w-8 h-4 rounded-full transition-all flex items-center px-0.5 ${showAnswers ? 'bg-[#FF6B2B]' : 'bg-white/[0.1]'}`}
                                    >
                                        <div className={`w-3 h-3 rounded-full bg-slate-900 transition-transform ${showAnswers ? 'translate-x-4' : 'translate-x-0'}`} />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Extra Navigation Badges */}
                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.04]">
                            <button
                                onClick={() => setIsHistoryOpen(true)}
                                className="flex items-center gap-1.5 px-3 py-1 bg-white/[0.03] hover:bg-white/[0.08] text-slate-300 hover:text-white rounded-lg text-xs font-medium border border-white/[0.06] transition-all"
                            >
                                <Clock className="w-3.5 h-3.5 text-blue-400" />
                                <span>History</span>
                            </button>
                            <button
                                onClick={() => setIsMcqSidebarOpen(true)}
                                className="flex items-center gap-1.5 px-3 py-1 bg-white/[0.03] hover:bg-white/[0.08] text-slate-300 hover:text-white rounded-lg text-xs font-medium border border-white/[0.06] transition-all"
                            >
                                <ListChecks className="w-3.5 h-3.5 text-[#FF6B2B]" />
                                <span>MCQ Bank</span>
                            </button>
                        </div>
                   </div>
                </div>

                {/* Error Banner */}
                <AnimatePresence>
                    {errorMsg && (
                        <motion.div 
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="p-4 bg-[#3A1A1A] text-[#F44336] rounded-[12px] border border-[#F44336]/30 flex flex-col gap-3 mt-4 shadow-xl"
                        >
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5 text-[#F44336]" />
                                <div>
                                    <h4 className="font-bold text-[14px] uppercase tracking-wider text-[#F44336]">Processing Interrupted</h4>
                                    <p className="text-[13px] mt-1 text-[#EFEFEF] leading-relaxed">{errorMsg}</p>
                                </div>
                            </div>
                            <div className="flex gap-2 pl-8">
                                <button 
                                    onClick={retryAllErrors}
                                    className="px-4 py-2 bg-[#F44336] text-white rounded-[8px] text-[12px] font-bold flex items-center gap-2 hover:bg-[#d32f2f] transition-all shadow-lg active:scale-95"
                                >
                                    <RefreshCw className="w-3.5 h-3.5" />
                                    Retry All Failed Pages
                                </button>
                                <button 
                                    onClick={() => setErrorMsg(null)}
                                    className="px-4 py-2 bg-transparent border border-[#F44336]/30 text-[#F44336] rounded-[8px] text-[12px] font-bold hover:bg-[#F44336]/10 transition-all active:scale-95"
                                >
                                    Dismiss
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {hasErrorPages && !errorMsg && (
                    <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-3 p-4 bg-[#1A1111] border border-[#F44336]/20 rounded-[12px]"
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-[#3A1A1A] flex items-center justify-center">
                                <AlertCircle className="w-4 h-4 text-[#F44336]" />
                            </div>
                            <div>
                                <h5 className="text-[12px] font-bold text-[#EFEFEF]">Some pages failed to process</h5>
                                <p className="text-[11px] text-[#888888]">You can retry them all at once or individually.</p>
                            </div>
                        </div>
                        <button 
                            onClick={retryAllErrors}
                            className="w-full sm:w-auto px-4 py-2 bg-[#F44336] text-white rounded-[8px] text-[12px] font-bold flex items-center justify-center gap-2 hover:bg-[#d32f2f] transition-all shadow-md active:scale-95"
                        >
                            <RefreshCw className="w-3.5 h-3.5" />
                            Retry {pages.filter(p => p.status === 'error').length} Failed Pages
                        </button>
                    </motion.div>
                )}

                {/* Grid of Pages */}
                <ProcessingList 
                    pages={pages} 
                    onUpdateText={updatePageText} 
                    onRetry={retryPage} 
                    onToggleSelection={togglePageSelection}
                    includeImages={includeImages}
                    showAnswers={showAnswers}
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
          onClearAll={() => setHistory([])}
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

        {/* SEO & Feature Deep Dive Section */}
        <div className="mt-28 border-t border-white/[0.08] pt-20 pb-16">
            <div className="max-w-5xl mx-auto px-4 box-border">
                
                <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="text-center mb-16"
                >
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-xs font-bold text-[#FF884D] uppercase tracking-wider mb-4">
                        <Layers className="w-3.5 h-3.5 text-[#FF6B2B]" />
                        <span>Why Choose Our AI Digitizer?</span>
                    </div>
                    <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-white mb-4 tracking-tight font-display">
                        Engineered specifically for <br className="hidden sm:block" />
                        <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#FF6B2B] via-[#FFA477] to-amber-300">
                            Exams, Formulas & Structured Books
                        </span>
                    </h2>
                    <p className="text-slate-400 text-sm sm:text-base max-w-2xl mx-auto leading-relaxed">
                        We don't just dump plain OCR text. Our vision model reads document hierarchy, cleans exam junk tags, extracts formulas into Word Math, and arranges bilingual lines automatically.
                    </p>
                </motion.div>

                {/* 3 Pillars Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-24">
                    {[
                        { 
                            title: "Human-Quality OCR", 
                            desc: "Deciphers blurry scans, handwritten notes, shaded backgrounds, and low-contrast test prints without mangling words.",
                            icon: <Wand2 className="w-6 h-6 text-[#FF6B2B]" />,
                            color: "from-orange-500/20 to-transparent"
                        },
                        { 
                            title: "Real Word Math (OMML)", 
                            desc: "Transforms continued fractions, roots, square powers, and algebraic symbols into native editable Microsoft Word math objects.",
                            icon: <Layout className="w-6 h-6 text-blue-400" />,
                            color: "from-blue-500/20 to-transparent"
                        },
                        { 
                            title: "MCQ & Exam Refiner", 
                            desc: "Filters out previous year exam tags, shift dates, and watermarks to output clean Questions, Options, and Answers.",
                            icon: <ListChecks className="w-6 h-6 text-emerald-400" />,
                            color: "from-emerald-500/20 to-transparent"
                        }
                    ].map((feature, i) => (
                        <motion.div 
                            key={i}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: i * 0.1 }}
                            className="glass-panel glass-panel-hover p-6 sm:p-7 rounded-2xl flex flex-col items-start text-left relative overflow-hidden group"
                        >
                            <div className="w-12 h-12 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                                {feature.icon}
                            </div>
                            <h3 className="text-base sm:text-lg font-bold text-white mb-2 font-display">{feature.title}</h3>
                            <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">{feature.desc}</p>
                        </motion.div>
                    ))}
                </div>

                {/* Interactive Preview Mockup Section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center mb-28">
                    <motion.div 
                        initial={{ opacity: 0, x: -20 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                    >
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs font-bold text-blue-400 mb-4">
                            <span>Universal Vision Intelligence</span>
                        </div>
                        <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white mb-4 font-display">
                            Intelligent <span className="text-[#FF6B2B]">Document Layout</span> Understanding
                        </h2>
                        <div className="space-y-4 text-slate-400 text-xs sm:text-sm leading-relaxed">
                            <p>
                                Traditional OCR engines read text line-by-line without understanding structure, causing multi-column text to overlap and formulas to turn into broken characters.
                            </p>
                            <p>
                                TextExtract's vision pipeline understands document geometry: distinguishing headers, nested equations, question numbers, options <strong className="text-slate-200">(a)-(d)</strong>, and multi-row tables effortlessly.
                            </p>
                            <div className="pt-3 grid grid-cols-3 gap-3">
                                <div className="glass-panel p-3.5 rounded-xl text-center">
                                    <div className="text-xl font-extrabold text-white font-display">4x</div>
                                    <div className="text-[10px] uppercase font-bold text-slate-500 mt-0.5">Faster Digitizing</div>
                                </div>
                                <div className="glass-panel p-3.5 rounded-xl text-center">
                                    <div className="text-xl font-extrabold text-emerald-400 font-display">100%</div>
                                    <div className="text-[10px] uppercase font-bold text-slate-500 mt-0.5">Math Accuracy</div>
                                </div>
                                <div className="glass-panel p-3.5 rounded-xl text-center">
                                    <div className="text-xl font-extrabold text-[#FF884D] font-display">DOCX</div>
                                    <div className="text-[10px] uppercase font-bold text-slate-500 mt-0.5">Word Native</div>
                                </div>
                            </div>
                        </div>
                    </motion.div>

                    {/* Realistic Visual Mockup */}
                    <motion.div 
                        initial={{ opacity: 0, x: 20 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        className="glass-panel p-5 rounded-2xl relative shadow-2xl border-white/[0.1] bg-[#0E111A]"
                    >
                        <div className="flex items-center justify-between pb-3 border-b border-white/[0.06] mb-3">
                            <div className="flex items-center gap-1.5">
                                <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                                <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                            </div>
                            <span className="text-[10px] font-mono text-slate-500">Live Digitizer Preview</span>
                        </div>

                        <div className="space-y-3 font-mono text-xs">
                            <div className="p-2.5 bg-white/[0.03] rounded-lg border border-white/[0.05]">
                                <span className="text-[#FF884D] font-bold">Question 1.</span> <span className="text-slate-200">सबसे छोटी अभाज्य संख्या कौन-सी है?</span>
                                <div className="text-slate-400 text-[11px] mt-0.5">Which is the smallest prime number?</div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                                <div className="p-2 bg-white/[0.02] rounded-md border border-white/[0.04] text-slate-300">
                                    <span className="text-amber-400 font-bold">(a)</span> 0
                                </div>
                                <div className="p-2 bg-white/[0.02] rounded-md border border-white/[0.04] text-slate-300">
                                    <span className="text-amber-400 font-bold">(b)</span> 1
                                </div>
                                <div className="p-2 bg-white/[0.02] rounded-md border border-white/[0.04] text-slate-300">
                                    <span className="text-amber-400 font-bold">(c)</span> 2
                                </div>
                                <div className="p-2 bg-white/[0.02] rounded-md border border-white/[0.04] text-slate-300">
                                    <span className="text-amber-400 font-bold">(d)</span> 3
                                </div>
                            </div>
                            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-md text-[11px] text-emerald-400 font-bold flex items-center justify-between">
                                <span>Answer: C</span>
                                <span className="text-[9px] bg-emerald-500/20 px-1.5 py-0.5 rounded text-emerald-300">Verified</span>
                            </div>
                        </div>
                    </motion.div>
                </div>

                {/* FAQ Section */}
                <section className="mb-24">
                    <div className="text-center mb-12">
                        <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-2 font-display">Frequently Asked Questions</h2>
                        <p className="text-slate-400 text-xs sm:text-sm">Everything you need to know about the conversion engine.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                        {[
                            {
                                q: "How does the AI handle complex mathematical formulas?",
                                a: "Formulas, fractions (\\frac{a}{b}), roots, and superscripts are transcribed into standard LaTeX and converted directly into native Microsoft Word Math (OMML) objects upon download."
                            },
                            {
                                q: "Can I extract large tables with multiple rows?",
                                a: "Yes! There are no row limits. Tables of any length (15, 50, 100+ rows) are recreated as 100% native, editable Word tables with custom borders and header shading."
                            },
                            {
                                q: "What does the 'Refine' toggle do?",
                                a: "When Refine is active, the AI automatically strips previous year exam tags (e.g. SSC CGL 2022 Shift-II), book headers, page numbers, and publisher branding to leave only pure questions and options."
                            },
                            {
                                q: "How does Bilingual translation work?",
                                a: "In Bilingual mode, if a question is in Hindi, it automatically adds the English translation below it. Options are neatly formatted on a single line as '(a) Hindi / English'."
                            },
                            {
                                q: "Are my uploaded documents secure and private?",
                                a: "Yes. Files are transmitted over encrypted HTTPS channels and processed transiently in memory without permanent cloud storage. Your data remains 100% private."
                            },
                            {
                                q: "What file formats can I upload?",
                                a: "You can upload PDF documents, scanned images (JPG, JPEG, PNG, WEBP), or paste screenshots directly using Ctrl+V."
                            }
                        ].map((faq, i) => (
                            <motion.div 
                                key={i}
                                initial={{ opacity: 0, y: 15 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.05 }}
                                className="glass-panel p-5 sm:p-6 rounded-2xl hover:border-[#FF6B2B]/40 transition-all"
                            >
                                <h4 className="text-sm sm:text-base font-bold text-white mb-2 font-display flex items-start gap-2">
                                    <span className="text-[#FF6B2B]">•</span>
                                    <span>{faq.q}</span>
                                </h4>
                                <p className="text-slate-400 text-xs sm:text-sm leading-relaxed pl-3.5">{faq.a}</p>
                            </motion.div>
                        ))}
                    </div>
                </section>

                {/* Footer */}
                <footer className="pt-12 border-t border-white/[0.08] text-center space-y-4">
                    <div className="flex flex-wrap justify-center gap-6 text-slate-400 text-xs font-semibold">
                        <a href="#" className="hover:text-[#FF884D] transition-colors">Privacy Policy</a>
                        <a href="#" className="hover:text-[#FF884D] transition-colors">Terms of Service</a>
                        <a href="#" className="hover:text-[#FF884D] transition-colors">Contact Support</a>
                    </div>
                    <p className="text-slate-500 text-xs font-medium">
                        © 2026 TextExtract AI Pro. Powered by Google Gemini Vision OCR & Word OMML Engine.
                    </p>
                </footer>
            </div>
        </div>
      </div>
    </div>
  );
};

export default PdfConverter;
