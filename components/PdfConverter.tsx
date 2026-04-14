import React, { useState, useEffect } from 'react';
import { FileDown, RefreshCw, Wand2, AlertTriangle, FileText, Copy, Check, Filter, Settings, Layout, Clock, Plus, ListChecks } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import FileUploader from './FileUploader';
import ProcessingList from './ProcessingList';
import HistorySidebar from './HistorySidebar';
import McqSidebar from './McqSidebar';
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
  const [includeImages, setIncludeImages] = useState<boolean>(true);
  const [optionArrangement, setOptionArrangement] = useState<OptionArrangement>(OptionArrangement.VERTICAL);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isMcqSidebarOpen, setIsMcqSidebarOpen] = useState(false);

  // Load history on mount
  useEffect(() => {
    const savedHistory = localStorage.getItem('conversion_history');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }
  }, []);

  // Save history when it changes
  useEffect(() => {
    try {
      localStorage.setItem('conversion_history', JSON.stringify(history));
    } catch (e) {
      console.error("Failed to save history to localStorage", e);
    }
  }, [history]);

  // Auto-download effect
  useEffect(() => {
    if (appState === AppState.COMPLETED) {
      // Save to history
      const completedElements = pages
        .filter(p => p.status === 'done' && p.elements)
        .flatMap(p => p.elements || []);
      
      if (completedElements.length > 0) {
        const newItem: HistoryItem = {
          id: generateId(),
          fileName: fileName,
          timestamp: Date.now(),
          pagesCount: pages.length,
          elements: completedElements
        };
        setHistory(prev => [newItem, ...prev].slice(0, 20)); // Keep last 20
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
      alert("Some files exceed the 50MB limit and were skipped.");
    }

    if (validFiles.length === 0) return;

    if (!append) {
      // Capture the name of the first file for saving later
      const firstFile = validFiles[0];
      const namePart = firstFile.name.substring(0, firstFile.name.lastIndexOf('.')) || firstFile.name;
      setFileName(namePart);
      setPages([]); // Clear previous
    }
    
    setAppState(AppState.PROCESSING_PDF);
    setErrorMsg(null);

    const newPages: Omit<ScannedPage, 'pageNumber'>[] = [];

    try {
      for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        
        if (file.type === 'application/pdf') {
          const images = await convertPdfToImages(file);
          images.forEach(img => {
            newPages.push({
              id: generateId(),
              imageUrl: img,
              status: 'pending',
              isSelected: true // Default selected
            });
          });
        } else if (file.type.startsWith('image/')) {
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
      setAppState(AppState.IDLE); // Ready to start AI
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || "Failed to process files. Please check if the file is valid.");
      setAppState(AppState.ERROR);
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
    
    // 1. Visually mark ALL selected pages as 'processing' immediately.
    setPages(prev => prev.map(p => 
      (p.isSelected && p.status !== 'done') 
        ? { ...p, status: 'processing' } 
        : p
    ));
    
    // Identify pages to process
    const pagesToProcess = pages.filter(p => p.isSelected && p.status !== 'done');
    
    // Batch configuration: Process 1 page at a time to stay within rate limits 
    // for free/standard tier API keys.
    const BATCH_SIZE = 1;
    let criticalErrorOccurred = false;

    for (let i = 0; i < pagesToProcess.length; i += BATCH_SIZE) {
        if (criticalErrorOccurred) break;

        const batch = pagesToProcess.slice(i, i + BATCH_SIZE);
        
        // Process current batch
        await Promise.all(batch.map(async (page) => {
            if (criticalErrorOccurred) return;

            try {
                const elements = await extractLayoutFromImage(page.imageUrl, numberingStyle, includeImages, isBilingual);
                
                // Process images & tables: Crop them from the original page
                const processedElements = await Promise.all(elements.map(async (el) => {
                    if (includeImages && (el.type === 'image' || el.type === 'table') && el.bbox) {
                        try {
                            const croppedB64 = await cropImage(page.imageUrl, el.bbox);
                            return { ...el, imageB64: croppedB64 };
                        } catch (cropErr) {
                            console.error("Cropping failed for element:", el.id, cropErr);
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
                const isAuthOrQuota = errorStr.includes("API Key") || 
                                     errorStr.includes("Usage limit") || 
                                     errorStr.includes("Authentication") ||
                                     errorStr.includes("429") ||
                                     errorStr.includes("RESOURCE_EXHAUSTED") ||
                                     errorStr.includes("quota");

                // Mark page as error
                setPages(prev => prev.map(p => p.id === page.id ? { ...p, status: 'error' } : p));

                if (isAuthOrQuota) {
                    setErrorMsg("API Rate Limit Reached: The AI is busy processing your pages. It will automatically retry with a delay. Please wait a moment."); 
                    criticalErrorOccurred = false; // Don't stop everything, let the internal retry handle it
                }
            }
        }));

        // Delay between batches to respect API limits
        if (i + BATCH_SIZE < pagesToProcess.length && !criticalErrorOccurred) {
            await new Promise(resolve => setTimeout(resolve, 5000)); // Increased from 3000 to 5000
        }
    }
    
    // Final state update
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
    setPages(prev => prev.map(p => p.id === id ? { ...p, status: 'processing', extractedText: undefined } : p));

    try {
      const elements = await extractLayoutFromImage(page.imageUrl, numberingStyle, includeImages, isBilingual);
      
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
      setPages(prev => prev.map(p => p.id === id ? { ...p, status: 'error' } : p));
      setErrorMsg(e.message);
    }
  };

  const updatePageText = (id: string, newText: string) => {
    setPages(prev => prev.map(p => p.id === id ? { ...p, extractedText: newText } : p));
  };

  const getFullText = () => {
    return pages
      .filter(p => p.isSelected && p.status === 'done')
      .map(p => {
        if (p.elements) {
          return p.elements
            .filter(el => includeImages || el.type !== 'image')
            .map(el => el.type === 'text' || el.type === 'table' ? el.content : `[Image: ${el.content}]`)
            .join('\n\n');
        }
        return p.extractedText || '';
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
        if (!autoDownload) alert("No content extracted to save.");
        return;
    }

    try {
      const blob = await generateDocx(allElements, optionArrangement);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert("Failed to generate DOCX file.");
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
        alert("Copied as Markdown!");
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
          alert("No content found in this history item.");
          return;
        }
        const blob = await generateDocx(elements, optionArrangement);
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${item.fileName}.docx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      } catch (e) {
        console.error(e);
        alert("Failed to generate DOCX from history.");
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
    <div className="min-h-screen bg-[#F8FAFC] font-sans selection:bg-orange-100 selection:text-orange-900">
      <div className="max-w-7xl mx-auto px-4 py-8 md:px-8 md:py-12">
        
        {/* Header - More Compact */}
        <header className="mb-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-left">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex-shrink-0 w-8 h-8 rounded-lg bg-slate-900 text-white shadow-md flex items-center justify-center"
            >
              <Wand2 className="w-4 h-4" />
            </motion.div>
            <div>
              <h1 className="text-lg md:text-xl font-bold text-slate-900 tracking-tight">
                PDF to Word
              </h1>
              <p className="text-slate-500 text-[10px] md:text-xs">
                Professional document conversion
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsMcqSidebarOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-md text-xs font-semibold text-orange-700 hover:bg-orange-100 transition-all shadow-sm"
            >
              <ListChecks className="w-3.5 h-3.5" />
              MCQ Bank
            </button>
            <button
              onClick={() => setIsHistoryOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-md text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
            >
              <Clock className="w-3.5 h-3.5" />
              History
            </button>
            {pages.length > 0 && (
              <button 
                onClick={reset}
                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                title="Reset All"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
          </div>
        </header>

        {/* Main Content */}
        <main className="relative">
           {/* Upload Area */}
           {pages.length === 0 ? (
             <div className="max-w-3xl mx-auto">
                <FileUploader 
                  onFilesSelected={handleFilesSelected} 
                  isLoading={appState === AppState.PROCESSING_PDF}
                />
                {appState === AppState.PROCESSING_PDF && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-8 flex flex-col items-center gap-3"
                  >
                    <div className="w-8 h-8 border-2 border-slate-900/20 border-t-slate-900 rounded-full animate-spin" />
                    <p className="text-slate-600 font-semibold tracking-wider uppercase text-[10px]">
                      Analyzing document...
                    </p>
                  </motion.div>
                )}
             </div>
           ) : (
             <motion.div
               initial={{ opacity: 0, y: 10 }}
               animate={{ opacity: 1, y: 0 }}
               className="space-y-6"
             >
                {/* Action Bar - More Compact & Responsive */}
                <div className="bg-white/90 backdrop-blur-xl p-2 rounded-xl border border-slate-200 shadow-sm flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-2 sticky top-4 z-30">
                   
                   <div className="flex flex-wrap items-center gap-2 md:gap-3">
                        <div className="flex items-center gap-1.5">
                             <div className="px-1.5 py-0.5 bg-slate-100 rounded-md text-[10px] font-semibold text-slate-700">
                                {selectedCount} / {totalCount}
                             </div>
                             <div className="flex gap-0.5">
                                <button 
                                    onClick={() => toggleAllSelection(true)}
                                    className="text-[9px] font-bold text-slate-700 hover:bg-slate-100 px-1.5 py-0.5 rounded transition-colors"
                                >
                                    ALL
                                </button>
                                <button 
                                    onClick={() => toggleAllSelection(false)}
                                    className="text-[9px] font-bold text-slate-400 hover:bg-slate-50 px-1.5 py-0.5 rounded transition-colors"
                                >
                                    NONE
                                </button>
                            </div>
                        </div>

                        <div className="h-4 w-px bg-slate-200 hidden sm:block" />

                        <div className="flex items-center gap-1.5">
                             <div className="relative">
                                <Filter className="w-3 h-3 text-slate-400 absolute left-1.5 top-1/2 -translate-y-1/2" />
                                <input 
                                    type="text" 
                                    placeholder="Range (1-5)" 
                                    className="pl-5 pr-1.5 py-0.5 text-[10px] bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition-all w-20"
                                    value={rangeInput}
                                    onChange={(e) => setRangeInput(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && applyRangeSelection()}
                                />
                             </div>
                        </div>

                        <div className="h-4 w-px bg-slate-200 hidden lg:block" />

                        <div className="flex items-center gap-1.5">
                             <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Pattern</span>
                             <select 
                                value={numberingStyle}
                                onChange={(e) => setNumberingStyle(e.target.value as NumberingStyle)}
                                className="text-[10px] font-semibold bg-slate-50 border border-slate-200 rounded-md px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition-all text-slate-700"
                             >
                                <option value={NumberingStyle.Q_DOT}>Q1.</option>
                                <option value={NumberingStyle.HASH}>#1.</option>
                                <option value={NumberingStyle.QUESTION_DOT}>Question 1.</option>
                                <option value={NumberingStyle.NUMBER_DOT}>1.</option>
                             </select>
                        </div>

                        <div className="flex items-center gap-2">
                             <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Bilingual</span>
                             <button
                                onClick={() => setIsBilingual(!isBilingual)}
                                className={`w-7 h-3.5 rounded-full transition-colors flex items-center px-0.5 ${isBilingual ? 'bg-slate-800' : 'bg-slate-300'}`}
                             >
                                <div className={`w-2.5 h-2.5 rounded-full bg-white transition-transform ${isBilingual ? 'translate-x-3.5' : 'translate-x-0'}`} />
                             </button>
                        </div>

                        <div className="h-4 w-px bg-slate-200 hidden lg:block" />

                        <div className="flex items-center gap-2">
                             <label className="flex items-center gap-1 cursor-pointer group">
                                <div className="relative flex items-center">
                                    <input 
                                        type="checkbox" 
                                        checked={autoDownload}
                                        onChange={(e) => setAutoDownload(e.target.checked)}
                                        className="peer sr-only"
                                    />
                                    <div className="w-6 h-3 bg-slate-200 rounded-full peer peer-checked:bg-slate-800 transition-colors" />
                                    <div className="absolute left-0.5 top-0.5 w-2 h-2 bg-white rounded-full transition-transform peer-checked:translate-x-3" />
                                </div>
                                <span className="text-[8px] font-bold text-slate-500 group-hover:text-slate-700 transition-colors uppercase tracking-wider">Save</span>
                             </label>

                             <label className="flex items-center gap-1 cursor-pointer group">
                                <div className="relative flex items-center">
                                    <input 
                                        type="checkbox" 
                                        checked={includeImages}
                                        onChange={(e) => setIncludeImages(e.target.checked)}
                                        className="peer sr-only"
                                    />
                                    <div className="w-6 h-3 bg-slate-200 rounded-full peer peer-checked:bg-slate-800 transition-colors" />
                                    <div className="absolute left-0.5 top-0.5 w-2 h-2 bg-white rounded-full transition-transform peer-checked:translate-x-3" />
                                </div>
                                <span className="text-[8px] font-bold text-slate-500 group-hover:text-slate-700 transition-colors uppercase tracking-wider">Images</span>
                             </label>
                        </div>
                   </div>
                   
                   <div className="flex items-center gap-2 w-full lg:w-auto">
                        {hasCompletedPages && (
                            <div className="flex gap-1.5 flex-1 lg:flex-none">
                                <button 
                                    onClick={copyAllText}
                                    className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-md transition-colors"
                                    title="Copy All"
                                >
                                    {copySuccess ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                                </button>
                                <button 
                                    onClick={copyAsMarkdown}
                                    className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-md transition-colors"
                                    title="Copy All as Markdown"
                                >
                                    <FileText className="w-4 h-4" />
                                </button>
                                <button 
                                    onClick={downloadDocx}
                                    className="flex-1 lg:flex-none px-3 py-1.5 bg-slate-900 text-white rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-slate-800 transition-all shadow-sm"
                                >
                                    <FileDown className="w-3.5 h-3.5" />
                                    DOCX
                                </button>
                            </div>
                        )}

                        {appState !== AppState.ANALYZING ? (
                            <div className="flex gap-2 flex-1 lg:flex-none">
                                <label className="px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-sm">
                                    <Plus className="w-3.5 h-3.5" />
                                    <span className="hidden sm:inline">ADD</span>
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
                                    className={`px-4 py-1.5 rounded-md flex items-center justify-center gap-1.5 text-xs font-semibold transition-all ${
                                        selectedPendingCount === 0 && !hasErrorPages
                                            ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                            : 'bg-slate-900 text-white hover:bg-slate-800 shadow-sm'
                                    }`}
                                >
                                    <Wand2 className="w-3.5 h-3.5" /> 
                                    {hasErrorPages && selectedPendingCount === 0 
                                        ? 'RETRY' 
                                        : `CONVERT (${selectedPendingCount})`
                                    }
                                </button>
                            </div>
                        ) : (
                            <div className="flex-1 lg:flex-none px-4 py-1.5 bg-slate-100 text-slate-600 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5">
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                BUSY...
                            </div>
                        )}
                   </div>
                </div>

                {/* Error Banner */}
                <AnimatePresence>
                    {errorMsg && (
                        <motion.div 
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="p-4 bg-rose-50 text-rose-700 rounded-2xl border border-rose-100 flex items-start gap-3"
                        >
                            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                            <div>
                                <h4 className="font-bold text-sm uppercase tracking-wider">Processing Error</h4>
                                <p className="text-sm mt-1">{errorMsg}</p>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Grid of Pages */}
                <ProcessingList 
                    pages={pages} 
                    onUpdateText={updatePageText} 
                    onRetry={retryPage} 
                    onToggleSelection={togglePageSelection}
                    includeImages={includeImages}
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
        />
      </div>
    </div>
  );
};

export default PdfConverter;
