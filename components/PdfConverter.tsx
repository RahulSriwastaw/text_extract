import React, { useState, useEffect } from 'react';
import { FileDown, RefreshCw, Wand2, AlertTriangle, FileText, Copy, Check, Filter, Settings, Layout, Clock, Plus, ListChecks, Zap, Type } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import FileUploader from './FileUploader';
import ProcessingList from './ProcessingList';
import HistorySidebar from './HistorySidebar';
import McqSidebar from './McqSidebar';
import { AppState, ScannedPage, NumberingStyle, OptionArrangement, HistoryItem } from '../types';
import { convertPdfToImages, readFileAsBase64, cropImage } from '../services/pdfUtils';
import { extractLayoutFromImage } from '../services/geminiService';
import { generateDocx } from '../services/docxService';
import { auth, db } from '../services/firebase';
import { useAuthState } from 'react-firebase-hooks/auth';
import { collection, query, orderBy, limit, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';

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

  // Helper to count words
  const countWords = (text: string) => {
    return text.trim().split(/\s+/).filter(Boolean).length;
  };

  const [user] = useAuthState(auth);

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(data => {
        if (data.totalKeys) setTotalKeys(data.totalKeys);
      })
      .catch(err => console.error("Config fetch failed:", err));
  }, []);

  // Load history on mount or when user changes
  useEffect(() => {
    if (user) {
      // Load from Firestore
      const historyQuery = query(
        collection(db, `users/${user.uid}/history`),
        orderBy('timestamp', 'desc'),
        limit(20)
      );

      const unsubscribe = onSnapshot(historyQuery, (snapshot) => {
        const cloudHistory = snapshot.docs.map(doc => ({
          ...doc.data(),
          id: doc.id
        })) as HistoryItem[];
        setHistory(cloudHistory);
      }, (error) => {
        console.error("Firestore history error:", error);
      });

      return () => unsubscribe();
    } else {
      // Load from localStorage for anonymous users
      const savedHistory = localStorage.getItem('conversion_history');
      if (savedHistory) {
        try { setHistory(JSON.parse(savedHistory)); } catch (e) { console.error("Failed to load history", e); }
      }
    }
  }, [user]);

  // Save history when it changes (only for anonymous users, Firestore handles its own)
  useEffect(() => {
    if (!user) {
      try { localStorage.setItem('conversion_history', JSON.stringify(history)); } catch (e) {}
    }
  }, [history, user]);

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

        if (user) {
          // Save to Firestore
          const historyId = generateId();
          setDoc(doc(db, `users/${user.uid}/history`, historyId), {
            ...newItem,
            id: historyId,
            userId: user.uid
          }).catch(err => console.error("Failed to save to Firestore:", err));
        } else {
          // Save to state (which saves to localStorage via effect)
          setHistory(prev => [{ ...newItem, id: generateId() } as HistoryItem, ...prev].slice(0, 20));
        }
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
      setErrorMsg("Some files exceed the 50MB limit and were skipped.");
      if (validFiles.length === 0) {
        setAppState(AppState.ERROR);
        return;
      }
    }

    if (validFiles.length === 0) return;

    if (!append) {
      // Capture the name of the first file for saving later
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
          const images = await convertPdfToImages(file);
          images.forEach(img => {
            newPages.push({
              id: generateId(),
              imageUrl: img,
              status: 'pending',
              isSelected: true // Default selected
            });
          });
        } else if (file.type.startsWith('image/') || /\.(jpg|jpeg|png)$/i.test(file.name)) {
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
        
        // Process current batch in parallel with a slight stagger
        await Promise.all(batch.map(async (page, index) => {
            if (criticalErrorOccurred) return;

            // Stagger requests by 250ms to avoid hitting API rate limits on the exact same millisecond
            await new Promise(resolve => setTimeout(resolve, index * 250));

            try {
                const elements = await extractLayoutFromImage(page.imageUrl, numberingStyle, includeImages, isBilingual, mcqMode, refineMode);
                
                // Calculate words and points
                const pageText = elements.map(e => e.type === 'text' ? (e.content || '') : '').join(' ');
                const pageWords = countWords(pageText);
                setWordsConsumed(prev => prev + pageWords);
                setPointsConsumed(prev => prev + 1); // 1 point per page

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

                const errorLower = errorStr.toLowerCase();
                const isRateLimit = errorStr.includes("429") || 
                                     errorStr.includes("RESOURCE_EXHAUSTED") ||
                                     errorStr.includes("quota") ||
                                     errorStr.includes("limit");

                // Try to extract a clean message if it's JSON
                let displayError = errorStr;
                try {
                  const parsed = JSON.parse(errorStr);
                  if (parsed.error && typeof parsed.error === 'string') {
                    try {
                      const inner = JSON.parse(parsed.error);
                      if (inner.error?.message) displayError = inner.error.message;
                    } catch(e) {
                      displayError = parsed.error;
                    }
                  } else if (parsed.message) {
                    displayError = parsed.message;
                  }
                } catch(e) {}

                // Mark page as error
                setPages(prev => prev.map(p => p.id === page.id ? { ...p, status: 'error', errorMessage: displayError } : p));

                if (isRateLimit) {
                    setErrorMsg("Gemini Free Tier Quota Reached. The AI is currently overwhelmed by high demand. Please try again in a few minutes or process pages one by one."); 
                    criticalErrorOccurred = true; 
                } else if (errorLower.includes("api key") || errorLower.includes("authentication")) {
                    setErrorMsg(`Authentication Error: ${displayError}`);
                    criticalErrorOccurred = true; 
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
    setPages(prev => prev.map(p => p.id === id ? { ...p, status: 'processing', extractedText: undefined, elements: undefined } : p));

    try {
      const elements = await extractLayoutFromImage(page.imageUrl, numberingStyle, includeImages, isBilingual, mcqMode, refineMode);
      
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
        if (!autoDownload) setErrorMsg("No content extracted to save.");
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
        setErrorMsg("Failed to generate DOCX from history.");
      }
    };
    downloadItem();
    setIsHistoryOpen(false);
  };

  const handleDeleteHistoryItem = (id: string) => {
    if (user) {
      deleteDoc(doc(db, `users/${user.uid}/history`, id)).catch(err => console.error("Failed to delete history:", err));
    } else {
      setHistory(prev => prev.filter(item => item.id !== id));
    }
  };

  const hasCompletedPages = pages.some(p => p.status === 'done' && (p.extractedText || p.elements));
  const hasErrorPages = pages.some(p => p.status === 'error');
  
  // Selection Stats
  const selectedCount = pages.filter(p => p.isSelected).length;
  const totalCount = pages.length;
  const selectedPendingCount = pages.filter(p => p.isSelected && p.status !== 'done').length;

  return (
    <div className="min-h-screen bg-[#0F0F0F] font-sans selection:bg-[#FF6B2B]/20 selection:text-[#FF6B2B]">
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
                  className="text-center mb-16 space-y-4"
                >
                    <h2 className="text-[32px] md:text-[48px] font-bold text-white tracking-tight leading-tight">
                        Convert <span className="text-[#FF6B2B]">PDF to Text</span> <br className="hidden md:block" /> with Human-Like Accuracy
                    </h2>
                    <p className="text-[#888888] text-[16px] md:text-[18px] max-w-2xl mx-auto leading-relaxed">
                        The ultimate AI-powered OCR tool designed for researchers, students, and professionals. 
                        Preserve layouts, tables, and formatting perfectly.
                    </p>
                    <div className="flex flex-wrap justify-center gap-4 pt-4">
                        <div className="flex items-center gap-2 bg-[#1A1A1A] px-4 py-2 rounded-full border border-[#252525]">
                            <Check className="w-4 h-4 text-green-500" />
                            <span className="text-[13px] font-medium text-[#EFEFEF]">99.9% Accuracy</span>
                        </div>
                        <div className="flex items-center gap-2 bg-[#1A1A1A] px-4 py-2 rounded-full border border-[#252525]">
                            <Check className="w-4 h-4 text-green-500" />
                            <span className="text-[13px] font-medium text-[#EFEFEF]">Layout Aware</span>
                        </div>
                        <div className="flex items-center gap-2 bg-[#1A1A1A] px-4 py-2 rounded-full border border-[#252525]">
                            <Check className="w-4 h-4 text-green-500" />
                            <span className="text-[13px] font-medium text-[#EFEFEF]">Secure Cloud Sync</span>
                        </div>
                    </div>
                </motion.div>

                <FileUploader 
                  onFilesSelected={handleFilesSelected} 
                  isLoading={appState === AppState.PROCESSING_PDF}
                />

                {/* How it works section */}
                <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-8">
                    {[
                        { step: "01", title: "Upload PDF", desc: "Drag and drop your scanned PDFs or images into the secure converter." },
                        { step: "02", title: "AI Analysis", desc: "Our Gemini-powered AI identifies text, tables, and layouts in real-time." },
                        { step: "03", title: "Export Word", desc: "Download the refined, layout-preserved DOCX or TXT file instantly." }
                    ].map((item, i) => (
                        <div key={i} className="bg-[#141414] p-8 rounded-[16px] border border-[#252525] relative overflow-hidden group">
                            <div className="text-[48px] font-black text-white/5 absolute -right-2 -bottom-2 group-hover:text-[#FF6B2B]/10 transition-colors">
                                {item.step}
                            </div>
                            <h3 className="text-[18px] font-bold text-white mb-2 relative z-10">{item.title}</h3>
                            <p className="text-[#888888] text-[14px] leading-relaxed relative z-10">{item.desc}</p>
                        </div>
                    ))}
                </div>

                {appState === AppState.PROCESSING_PDF && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-8 flex flex-col items-center gap-3"
                  >
                    <div className="w-8 h-8 border-2 border-[#252525] border-t-[#FF6B2B] rounded-[20px] animate-spin" />
                    <p className="text-[#EFEFEF] font-semibold tracking-wider uppercase text-[10px]">
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
                <div className="bg-[#1A1A1A] rounded-[8px] border border-[#252525] sticky top-0 z-50 overflow-hidden">
                   {/* Integrated Progress Bar (Top edge) */}
                   <AnimatePresence>
                        {appState === AppState.ANALYZING && (
                            <motion.div 
                                initial={{ height: 0 }}
                                animate={{ height: 4 }}
                                exit={{ height: 0 }}
                                className="w-full bg-[#141414] relative overflow-hidden"
                            >
                                <motion.div 
                                    className="h-full bg-[#FF6B2B] relative"
                                    initial={{ width: 0 }}
                                    animate={{ width: `${Math.round(((pages.filter(p => p.isSelected && (p.status === 'done' || p.status === 'error')).length) / Math.max(1, pages.filter(p => p.isSelected).length)) * 100)}%` }}
                                    transition={{ type: "spring", bounce: 0, duration: 0.5 }}
                                >
                                </motion.div>
                            </motion.div>
                        )}
                   </AnimatePresence>

                   <div className="p-3 flex flex-col gap-3">
                        {/* Top Row: Processing Info (Conditional) & Main Actions */}
                        <div className="flex flex-col md:flex-row justify-between items-center gap-3">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                {appState === AppState.ANALYZING ? (
                                    <div className="flex items-center gap-3 bg-[#1A1A1A] px-3 py-1.5 rounded-[8px] border border-[#252525] min-w-0 max-w-md">
                                        <RefreshCw className="w-4 h-4 text-[#FF6B2B] animate-spin flex-shrink-0" />
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-[10px] font-bold text-[#EFEFEF] truncate">Processing: {fileName}</span>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[9px] text-[#FF6B2B] font-bold tabular-nums">
                                                    {Math.round(((pages.filter(p => p.isSelected && (p.status === 'done' || p.status === 'error')).length) / Math.max(1, pages.filter(p => p.isSelected).length)) * 100)}%
                                                </span>
                                                <span className="text-[9px] text-[#888888] font-medium">
                                                    {pages.filter(p => p.isSelected && (p.status === 'done' || p.status === 'error')).length}/{pages.filter(p => p.isSelected).length} pages
                                                </span>
                                                {totalKeys > 1 && (
                                                  <span className="px-1.5 py-0.5 bg-green-500/10 text-green-500 text-[8px] font-black rounded uppercase tracking-tighter border border-green-500/20">
                                                    Turbo: {totalKeys} Keys
                                                  </span>
                                                )}
                                                {pages.filter(p => p.isSelected && p.status === 'error').length > 0 && (
                                                    <button 
                                                        onClick={() => setSelectedError(pages.find(p => p.isSelected && p.status === 'error')?.errorMessage || "No error details available.")}
                                                        className="text-[9px] text-[#F44336] font-bold hover:underline"
                                                    >
                                                        {pages.filter(p => p.isSelected && p.status === 'error').length} errors
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2 px-2 py-1 bg-[#141414] rounded-[8px]">
                                        <span className="text-[11px] font-bold text-[#EFEFEF]">{selectedCount}/{totalCount}</span>
                                        <div className="flex gap-1">
                                            <button 
                                                onClick={() => toggleAllSelection(true)}
                                                className="text-[10px] font-bold text-[#EFEFEF] hover:bg-[#1A1A1A] px-2 py-0.5 rounded  transition-all"
                                            >
                                                ALL
                                            </button>
                                            <button 
                                                onClick={() => toggleAllSelection(false)}
                                                className="text-[10px] font-bold text-[#555555] hover:bg-[#1A1A1A] px-2 py-0.5 rounded  transition-all"
                                            >
                                                NONE
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Live Consumption Stats */}
                                <div className="hidden sm:flex items-center gap-2">
                                    <div className="flex items-center gap-1.5 bg-[#1A1A1A] px-2 py-1 rounded-[8px] border border-[#252525]">
                                        <Type className="w-3 h-3 text-[#2196F3]" />
                                        <span className="text-[10px] font-bold text-[#EFEFEF] tabular-nums">{wordsConsumed.toLocaleString()} <span className="text-[8px] text-[#555555]">WORDS</span></span>
                                    </div>
                                    <div className="flex items-center gap-1.5 bg-[#1A1A1A] px-2 py-1 rounded-[8px] border border-[#252525]">
                                        <Zap className="w-3 h-3 text-[#FF6B2B]" />
                                        <span className="text-[10px] font-bold text-[#EFEFEF] tabular-nums">{pointsConsumed} <span className="text-[8px] text-[#555555]">POINTS</span></span>
                                    </div>
                                </div>

                                <div className="relative">
                                    <Filter className="w-3 h-3 text-[#555555] absolute left-2 top-1/2 -translate-y-1/2" />
                                    <input 
                                        type="text" 
                                        placeholder="Range (e.g. 1-5)" 
                                        className="pl-6 pr-2 py-1 text-[11px] bg-[#111111] border border-[#252525] rounded-[8px] focus:outline-none focus:border-[#FF6B2B] focus:ring-2 focus:ring-slate-200 transition-all w-28"
                                        value={rangeInput}
                                        onChange={(e) => setRangeInput(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && applyRangeSelection()}
                                    />
                                </div>
                            </div>

                            <div className="flex items-center gap-2 w-full md:w-auto">
                                {hasCompletedPages && (
                                    <div className="flex gap-2 mr-2">
                                        <button 
                                            onClick={copyAllText}
                                            className="p-2 text-[#555555] hover:bg-[#141414] rounded-[8px] transition-colors"
                                            title="Copy All"
                                        >
                                            {copySuccess ? <Check className="w-4 h-4 text-[#4CAF50]" /> : <Copy className="w-4 h-4" />}
                                        </button>
                                        <button 
                                            onClick={downloadDocx}
                                            className="px-3 py-2 transparent text-[#EFEFEF] border border-[#2A2A2A] hover:bg-[#1A1A1A] rounded-[6px] text-[11px] font-bold flex items-center gap-2 transition-all "
                                        >
                                            <FileDown className="w-4 h-4" />
                                            DOCX
                                        </button>
                                    </div>
                                )}

                                {appState !== AppState.ANALYZING ? (
                                    <div className="flex gap-2 flex-1 md:flex-none">
                                        <label className="px-3 py-2 transparent text-[#EFEFEF] border border-[#2A2A2A] hover:bg-[#1A1A1A] rounded-[6px] text-[11px] font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors">
                                            <Plus className="w-4 h-4" />
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
                                            className={`flex-1 md:flex-none px-3 py-2 rounded-[6px] flex items-center justify-center gap-2 text-[11px] font-bold transition-all ${
                                                selectedPendingCount === 0 && !hasErrorPages
                                                    ? 'bg-[#141414] text-[#555555] cursor-not-allowed'
                                                    : 'bg-[#FF6B2B] text-white hover:bg-[#E55A1A]'
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
                                    <div className="flex gap-2 flex-1 md:flex-none">
                                        {pages.filter(p => p.isSelected && p.status === 'error').length > 0 && (
                                            <button 
                                                onClick={() => {
                                                    setPages(prev => prev.map(p => p.isSelected && p.status === 'error' ? { ...p, status: 'pending', elements: undefined, extractedText: undefined } : p));
                                                    startExtraction();
                                                }}
                                                className="px-3 py-2 bg-[#3A1A1A] text-[#F44336] border border-[#F44336]/30 text-white rounded-[8px] text-[11px] font-bold hover:bg-[#F44336]/20 transition-colors "
                                            >
                                                Retry Failed
                                            </button>
                                        )}
                                        <div className="px-3 py-2 bg-[#141414] text-[#EFEFEF] rounded-[8px] text-[11px] font-bold flex items-center justify-center gap-2">
                                            <RefreshCw className="w-4 h-4 animate-spin" />
                                            PROCESSING...
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Bottom Row: Tools & Settings Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 pt-2 border-t border-[#252525]">
                        {/* MCQ Mode */}
                        <div className="flex flex-col gap-1.5 p-2 rounded-[8px] bg-[#1A1A1A] border border-[#252525]">
                            <span className="text-[10px] font-bold text-[#FF6B2B] uppercase tracking-wider">MCQ Mode</span>
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-[#555555] font-medium">{mcqMode ? 'Active' : 'Disabled'}</span>
                                <button
                                    onClick={() => setMcqMode(!mcqMode)}
                                    className={`w-8 h-4 rounded-[20px] transition-all flex items-center px-0.5 ${mcqMode ? 'bg-[#FF6B2B]' : 'bg-[#2A2A2A]'}`}
                                >
                                    <div className={`w-3 h-3 rounded-[20px] bg-[#1A1A1A]  transition-transform ${mcqMode ? 'translate-x-4' : 'translate-x-0'}`} />
                                </button>
                            </div>
                        </div>

                        {/* Auto Proofread */}
                        <div className="flex flex-col gap-1.5 p-2 rounded-[8px] bg-[#1A1A1A] border border-[#252525]">
                            <span className="text-[10px] font-bold text-purple-600 uppercase tracking-wider">Proofread</span>
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-[#555555] font-medium">{autoProofread ? 'Auto' : 'Manual'}</span>
                                <button
                                    onClick={() => setAutoProofread(!autoProofread)}
                                    className={`w-8 h-4 rounded-[20px] transition-all flex items-center px-0.5 ${autoProofread ? 'bg-[#FF6B2B]' : 'bg-[#2A2A2A]'}`}
                                >
                                    <div className={`w-3 h-3 rounded-[20px] bg-[#1A1A1A]  transition-transform ${autoProofread ? 'translate-x-4' : 'translate-x-0'}`} />
                                </button>
                            </div>
                        </div>

                        {/* Numbering Style */}
                        <div className="flex flex-col gap-1.5 p-2 rounded-[8px] bg-[#1A1A1A] border border-[#252525]">
                            <span className="text-[10px] font-bold text-[#2196F3] uppercase tracking-wider">Pattern</span>
                            <select 
                                value={numberingStyle}
                                onChange={(e) => setNumberingStyle(e.target.value as NumberingStyle)}
                                className="text-[10px] font-bold bg-transparent border-none p-0 focus:ring-0 text-[#EFEFEF] cursor-pointer"
                            >
                                <option value={NumberingStyle.Q_DOT}>Q1.</option>
                                <option value={NumberingStyle.HASH}>#1.</option>
                                <option value={NumberingStyle.QUESTION_DOT}>Question 1.</option>
                                <option value={NumberingStyle.NUMBER_DOT}>1.</option>
                            </select>
                        </div>

                        {/* Bilingual */}
                        <div className="flex flex-col gap-1.5 p-2 rounded-[8px] bg-[#1A1A1A] border border-[#252525]">
                            <span className="text-[10px] font-bold text-[#4CAF50] uppercase tracking-wider">Bilingual</span>
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-[#555555] font-medium">{isBilingual ? 'On' : 'Off'}</span>
                                <button
                                    onClick={() => setIsBilingual(!isBilingual)}
                                    className={`w-8 h-4 rounded-[20px] transition-all flex items-center px-0.5 ${isBilingual ? 'bg-[#FF6B2B]' : 'bg-[#2A2A2A]'}`}
                                >
                                    <div className={`w-3 h-3 rounded-[20px] bg-[#1A1A1A]  transition-transform ${isBilingual ? 'translate-x-4' : 'translate-x-0'}`} />
                                </button>
                            </div>
                        </div>

                        {/* Images */}
                        <div className="flex flex-col gap-1.5 p-2 rounded-[8px] bg-[#111111] border border-[#252525]">
                            <span className="text-[10px] font-bold text-[#EFEFEF] uppercase tracking-wider">Images</span>
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-[#555555] font-medium">{includeImages ? 'Keep' : 'Skip'}</span>
                                <button
                                    onClick={() => setIncludeImages(!includeImages)}
                                    className={`w-8 h-4 rounded-[20px] transition-all flex items-center px-0.5 ${includeImages ? 'bg-[#141414]' : 'bg-[#2A2A2A]'}`}
                                >
                                    <div className={`w-3 h-3 rounded-[20px] bg-[#1A1A1A]  transition-transform ${includeImages ? 'translate-x-4' : 'translate-x-0'}`} />
                                </button>
                            </div>
                        </div>

                        {/* Auto Save */}
                        <div className="flex flex-col gap-1.5 p-2 rounded-[8px] bg-[#111111] border border-[#252525]">
                            <span className="text-[10px] font-bold text-[#EFEFEF] uppercase tracking-wider">Auto Save</span>
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-[#555555] font-medium">{autoDownload ? 'On' : 'Off'}</span>
                                <button
                                    onClick={() => setAutoDownload(!autoDownload)}
                                    className={`w-8 h-4 rounded-[20px] transition-all flex items-center px-0.5 ${autoDownload ? 'bg-[#141414]' : 'bg-[#2A2A2A]'}`}
                                >
                                    <div className={`w-3 h-3 rounded-[20px] bg-[#1A1A1A]  transition-transform ${autoDownload ? 'translate-x-4' : 'translate-x-0'}`} />
                                </button>
                            </div>
                        </div>

                        {/* History */}
                        <div className="flex flex-col gap-1.5 p-2 rounded-[8px] bg-[#111111] border border-[#252525]">
                            <span className="text-[10px] font-bold text-[#EFEFEF] uppercase tracking-wider">History</span>
                            <button
                                onClick={() => setIsHistoryOpen(true)}
                                className="flex items-center justify-between text-[#EFEFEF] hover:text-[#EFEFEF] transition-colors"
                            >
                                <span className="text-[10px] font-medium">View Past</span>
                                <Clock className="w-3.5 h-3.5" />
                            </button>
                        </div>

                        {/* MCQ Bank */}
                        <div className="flex flex-col gap-1.5 p-2 rounded-[8px] bg-[#1A1A1A] border border-[#252525]">
                            <span className="text-[10px] font-bold text-[#FF6B2B] uppercase tracking-wider">MCQ Bank</span>
                            <button
                                onClick={() => setIsMcqSidebarOpen(true)}
                                className="flex items-center justify-between text-orange-700 hover:text-orange-900 transition-colors"
                            >
                                <span className="text-[10px] font-medium">Open Bank</span>
                                <ListChecks className="w-3.5 h-3.5" />
                            </button>
                        </div>

                        {/* MCQ Numbers */}
                        <div className="flex flex-col gap-1.5 p-2 rounded-[8px] bg-[#1A1A1A] border border-[#252525]">
                            <span className="text-[10px] font-bold text-[#FF6B2B] uppercase tracking-wider">Numbers</span>
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-[#555555] font-medium">{showMcqNumbers ? 'On' : 'Off'}</span>
                                <button
                                    onClick={() => setShowMcqNumbers(!showMcqNumbers)}
                                    className={`w-8 h-4 rounded-[20px] transition-all flex items-center px-0.5 ${showMcqNumbers ? 'bg-[#FF6B2B]' : 'bg-[#2A2A2A]'}`}
                                >
                                    <div className={`w-3 h-3 rounded-[20px] bg-[#1A1A1A]  transition-transform ${showMcqNumbers ? 'translate-x-4' : 'translate-x-0'}`} />
                                </button>
                            </div>
                        </div>

                        {/* Refine Mode */}
                        <div className="flex flex-col gap-1.5 p-2 rounded-[8px] bg-[#1A1A1A] border border-[#252525]">
                            <span className="text-[10px] font-bold text-[#FF6B2B] uppercase tracking-wider">Refine</span>
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-[#555555] font-medium">{refineMode ? 'Active' : 'A-Z'}</span>
                                <button
                                    onClick={() => setRefineMode(!refineMode)}
                                    className={`w-8 h-4 rounded-[20px] transition-all flex items-center px-0.5 ${refineMode ? 'bg-[#FF6B2B]' : 'bg-[#2A2A2A]'}`}
                                >
                                    <div className={`w-3 h-3 rounded-[20px] bg-[#1A1A1A]  transition-transform ${refineMode ? 'translate-x-4' : 'translate-x-0'}`} />
                                </button>
                            </div>
                        </div>

                        {/* Answers Toggle */}
                        <div className="flex flex-col gap-1.5 p-2 rounded-[8px] bg-[#1A1A1A] border border-[#252525]">
                            <span className="text-[10px] font-bold text-[#FF6B2B] uppercase tracking-wider">Answers</span>
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-[#555555] font-medium">{showAnswers ? 'On' : 'Off'}</span>
                                <button
                                    onClick={() => setShowAnswers(!showAnswers)}
                                    className={`w-8 h-4 rounded-[20px] transition-all flex items-center px-0.5 ${showAnswers ? 'bg-[#FF6B2B]' : 'bg-[#2A2A2A]'}`}
                                >
                                    <div className={`w-3 h-3 rounded-[20px] bg-[#1A1A1A]  transition-transform ${showAnswers ? 'translate-x-4' : 'translate-x-0'}`} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                </div>

                {/* Error Banner */}
                <AnimatePresence>
                    {errorMsg && (
                        <motion.div 
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="p-3 bg-[#3A1A1A] text-[#F44336] rounded-[8px] border border-[#F44336]/30 flex items-start gap-3 mt-4"
                        >
                            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5 text-[#F44336]" />
                            <div>
                                <h4 className="font-bold text-[13px] uppercase tracking-wider text-[#F44336]">Processing Error</h4>
                                <p className="text-[13px] mt-1 text-[#EFEFEF]">{errorMsg}</p>
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
          mcqMode={mcqMode}
          autoProofread={autoProofread}
          isBilingual={isBilingual}
          showMcqNumbers={showMcqNumbers}
          showAnswers={showAnswers}
        />

        {/* SEO Content Section */}
        <div className="mt-32 border-t border-[#252525] pt-24 pb-20">
            <div className="max-w-5xl mx-auto px-4 box-border">
                
                <motion.div 
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    className="text-center mb-20"
                >
                    <h2 className="text-[32px] md:text-[42px] font-bold text-white mb-6 tracking-tight">
                        Why Choose Our <span className="text-[#FF6B2B]">AI PDF to Text</span> Converter?
                    </h2>
                    <p className="text-[#888888] text-[16px] max-w-3xl mx-auto leading-relaxed">
                        We don't just extract text; we understand your documents. Our vision-language models 
                        bridge the gap between flat images and structured, editable content.
                    </p>
                </motion.div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-32">
                    {[
                        { 
                            title: "Human-Quality OCR", 
                            desc: "Handles pixelated scans, handwritten notes, and low-contrast documents that standard tools fail on.",
                            icon: <Wand2 className="w-6 h-6 text-[#FF6B2B]" />
                        },
                        { 
                            title: "Smart Layout Detection", 
                            desc: "Automatically detects multi-column layouts, tables, and nested lists to maintain reading order.",
                            icon: <Layout className="w-6 h-6 text-[#2196F3]" />
                        },
                        { 
                            title: "MCQ & Exam Optimized", 
                            desc: "Tuned specifically for digitizing question papers with automated answer extraction and pattern recognition.",
                            icon: <ListChecks className="w-6 h-6 text-[#4CAF50]" />
                        }
                    ].map((feature, i) => (
                        <motion.div 
                            key={i}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: i * 0.1 }}
                            className="bg-[#141414] p-8 rounded-[20px] border border-[#252525] hover:border-[#FF6B2B]/30 transition-all flex flex-col items-center text-center"
                        >
                            <div className="w-12 h-12 bg-[#1A1A1A] rounded-[12px] flex items-center justify-center mb-6 border border-[#252525]">
                                {feature.icon}
                            </div>
                            <h3 className="text-[18px] font-bold text-white mb-3">{feature.title}</h3>
                            <p className="text-[#888888] text-[14px] leading-relaxed">{feature.desc}</p>
                        </motion.div>
                    ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center mb-32">
                    <motion.div 
                        initial={{ opacity: 0, x: -20 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                    >
                        <h2 className="text-[28px] font-bold text-white mb-6">Advanced <span className="text-[#FF6B2B]">PDF to Text</span> Processing</h2>
                        <div className="space-y-6 text-[#888888] text-[15px] leading-relaxed">
                            <p>
                                When you convert a **pdf to text** with our tool, you're using the same technology that powers 
                                some of the world's most advanced AI researchers. We utilize **Gemini 1.5 Pro** to analyze the visual 
                                context of every page.
                            </p>
                            <p>
                                This means our **pdf to text converter** can distinguish between a footer and a main paragraph, 
                                correctly identify headings even if they aren't marked in the file metadata, and 
                                accurately recreate tables that would normally come out as a jumbled mess of text.
                            </p>
                            <div className="pt-4 flex gap-4">
                                <div className="bg-[#1A1A1A] border border-[#252525] p-4 rounded-[12px] flex-1 text-center">
                                    <div className="text-[20px] font-bold text-white">4x</div>
                                    <div className="text-[11px] uppercase tracking-wider font-bold text-[#555555]">Better Results</div>
                                </div>
                                <div className="bg-[#1A1A1A] border border-[#252525] p-4 rounded-[12px] flex-1 text-center">
                                    <div className="text-[20px] font-bold text-white">0s</div>
                                    <div className="text-[11px] uppercase tracking-wider font-bold text-[#555555]">Setup Time</div>
                                </div>
                                <div className="bg-[#1A1A1A] border border-[#252525] p-4 rounded-[12px] flex-1 text-center">
                                    <div className="text-[20px] font-bold text-white">Free</div>
                                    <div className="text-[11px] uppercase tracking-wider font-bold text-[#555555]">AI Access</div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                    <motion.div 
                        initial={{ opacity: 0, x: 20 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        className="bg-[#1A1A1A] p-4 rounded-[20px] border border-[#252525] shadow-2xl relative"
                    >
                        <div className="absolute inset-0 bg-[#FF6B2B]/5 rounded-[20px] blur-3xl -z-10" />
                        <div className="aspect-video bg-[#141414] rounded-[12px] border border-[#252525] flex items-center justify-center overflow-hidden">
                            <div className="p-8 w-full">
                                <div className="h-2 w-1/2 bg-[#252525] rounded-full mb-4" />
                                <div className="h-2 w-3/4 bg-[#FF6B2B]/30 rounded-full mb-4" />
                                <div className="h-2 w-2/3 bg-[#252525] rounded-full mb-8" />
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="h-20 bg-[#1A1A1A] rounded-[8px] border border-[#252525] border-dashed" />
                                    <div className="h-20 bg-[#1A1A1A] rounded-[8px] border border-[#252525] border-dashed" />
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </div>

                <section className="mb-32">
                    <h2 className="text-[28px] font-bold text-white mb-12 text-center">Frequently Asked Questions</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {[
                            {
                                q: "How accurate is the AI PDF to Text converter?",
                                a: "Our tool achieves near-perfect accuracy even on messy documents. By leveraging Gemini's visual understanding, it resolves ambiguous characters using linguistic context, making it the most reliable pdf to text converter available."
                            },
                            {
                                q: "Is it safe to upload sensitive documents?",
                                a: "Security is our priority. Files are processed over encrypted channels (HTTPS) and are purged after analysis. We do not store your raw file content permanently, ensuring your data remains private."
                            },
                            {
                                q: "Does it support languages other than English?",
                                a: "Yes, our **pdf to text** engine is natively multilingual. It can process Hindi, Spanish, French, Chinese, and many other languages accurately, even within the same document."
                            },
                            {
                                q: "Can I convert images (JPG/PNG) to text?",
                                a: "Yes. The same powerful engine handles images exactly like PDFs. Simply drag your image into the converter to extract text instantly."
                            },
                            {
                                q: "What makes this different from regular OCR?",
                                a: "Traditional OCR 'guesses' letters. Our **AI PDF to Text** 'understands' the document. It knows when a list starts, when a table spans multiple lines, and how to ignore irrelevant watermarks."
                            },
                            {
                                q: "Can I export the results to Microsoft Word?",
                                a: "Absolutely. Once extracted, you can download a professionally formatted DOCX file that maintains the structure and styling of your original document."
                            }
                        ].map((faq, i) => (
                            <motion.div 
                                key={i}
                                initial={{ opacity: 0 }}
                                whileInView={{ opacity: 1 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.05 }}
                                className="bg-[#141414] border border-[#252525] p-6 rounded-[16px] hover:bg-[#1A1A1A] transition-colors"
                            >
                                <h4 className="text-[15px] font-bold text-[#FF6B2B] mb-3">{faq.q}</h4>
                                <p className="text-[#888888] text-[13px] leading-relaxed">{faq.a}</p>
                            </motion.div>
                        ))}
                    </div>
                </section>

                <footer className="pt-20 border-t border-[#252525] text-center space-y-4">
                    <div className="flex justify-center gap-6 text-[#555555] text-[13px] font-medium">
                        <a href="#" className="hover:text-[#FF6B2B] transition-colors">Privacy Policy</a>
                        <a href="#" className="hover:text-[#FF6B2B] transition-colors">Terms of Service</a>
                        <a href="#" className="hover:text-[#FF6B2B] transition-colors">Contact Us</a>
                    </div>
                    <p className="text-[#555555] text-[12px] pt-4">
                        © 2026 AI PDF to Text Converter. Powered by Next-Gen Vision OCR. Accurate. Fast. Secure.
                    </p>
                </footer>
            </div>
        </div>
      </div>
    </div>
  );
};

export default PdfConverter;
