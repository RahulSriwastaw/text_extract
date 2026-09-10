import React, { useState, useRef, useEffect } from 'react';
import { 
  FileSpreadsheet, Upload, Play, Pause, RotateCw, Trash2, CheckCircle2, 
  AlertCircle, Loader2, Sparkles, Download, Copy, Check, Plus, 
  BookOpen, CheckSquare, Square, Zap, Settings, Shield, Globe, Cpu, RefreshCw, Key
} from 'lucide-react';
import { convertPdfToImages, readFileAsBase64 } from '../services/pdfUtils';
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
  cleanMockTestItem
} from '../services/mocktestService';
import { 
  extractWithStudyAiBridge, 
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
}

export const MocktestExtractor: React.FC = () => {
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
  const [batchSize, setBatchSize] = useState<number>(3); // Multi-page parallel batch size (e.g. 3 pages at once)
  const [selectedProvider, setSelectedProvider] = useState<AiProvider>(getStoredAiProvider());

  // Configuration state
  const [setName, setSetName] = useState<string>('RRB NTPC 2024 CBT-1');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('medium');
  const [answerFormat, setAnswerFormat] = useState<'letters' | 'numbers'>('letters');
  const [autoDeepSolveAll, setAutoDeepSolveAll] = useState<boolean>(true); // One-shot all fields & deep solutions auto-fill

  // Extracted MCQs state
  const [extractedMcqs, setExtractedMcqs] = useState<MockTestMcqItem[]>([]);
  const [activeTab, setActiveTab] = useState<'cards' | 'grid' | 'csv'>('cards');
  const [solvingId, setSolvingId] = useState<string | null>(null);
  const [isSolvingAll, setIsSolvingAll] = useState(false);
  const [copied, setCopied] = useState(false);

  // Modals & Bridge status
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({ connected: false });
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvImportInputRef = useRef<HTMLInputElement>(null);
  const pauseRef = useRef<boolean>(false);

  useEffect(() => {
    pauseRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    const unsub = subscribeToExtensionStatus(st => {
      setBridgeStatus(st);
      if (!st.connected && aiEngine === 'bridge') {
        // keep bridge mode ready or allow fallback
      }
    });
    pingStudyAiExtension().catch(() => {});
    return () => unsub();
  }, [aiEngine]);

  const handleProviderChange = (prov: AiProvider) => {
    setSelectedProvider(prov);
    setStoredAiProvider(prov);
  };

  // Handle files dropped / chosen
  const handleFiles = async (files: FileList | File[]) => {
    const validFiles = Array.from(files);
    if (validFiles.length === 0) return;

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
              isSelected: true
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
            isSelected: true
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

  // Process a single page item
  const processPageItem = async (page: PageQueueItem, pageIndex: number, totalPages: number): Promise<MockTestMcqItem[]> => {
    setActivePageIndex(pageIndex);
    setPages(prev => prev.map(p => p.id === page.id ? { ...p, status: 'processing', errorMessage: undefined } : p));
    setLiveStatusText(`Page ${page.pageNumber}: Starting AI extraction...`);

    const isUsingBridge = aiEngine === 'bridge' && bridgeStatus.connected;

    try {
      let formattedItems: MockTestMcqItem[] = [];

      if (isUsingBridge) {
        const prompt = buildMockTestBridgePrompt(setName);
        const { rawText, elements } = await extractWithStudyAiBridge({
          base64Image: page.imageUrl,
          fileName: `mocktest_page_${page.pageNumber}.png`,
          mimeType: 'image/png',
          prompt,
          provider: selectedProvider || getStoredAiProvider() || 'gemini',
          continueChat: pageIndex > 0,
          onProgress: (step, detail) => {
            const msg = detail || `${step.toUpperCase()}...`;
            setLiveStatusText(`Page ${page.pageNumber}: ${msg}`);
            setPages(prev => prev.map(p => p.id === page.id ? { ...p, errorMessage: msg } : p));
          }
        });

        // 1. FIRST: Parse AI rawText as JSON (which contains the full 18-column fields!)
        const startIndex = extractedMcqs.length + 1;
        formattedItems = parseAiOutputToMockTestItems(rawText, setName, startIndex);

        // 2. Fallback: if JSON parse produced nothing, convert elements
        if (formattedItems.length === 0 && elements && elements.length > 0) {
          formattedItems = convertElementsToMockTestItems(elements, setName);
        }
      } else {
        // Direct API mode (Zero dependence on extension!)
        setLiveStatusText(`Page ${page.pageNumber}: Calling Gemini API...`);
        const startIndex = extractedMcqs.length + 1;
        formattedItems = await extractMockTestWithDirectApi(page.imageUrl, setName, startIndex);
      }

      // Apply current difficulty and set name
      formattedItems = formattedItems.map(item => ({
        ...item,
        set_name: setName,
        difficulty_level: difficulty
      }));

      // If One-Shot Auto-Fill All Fields is enabled, perform deep research & solution pass immediately
      if (autoDeepSolveAll && formattedItems.length > 0) {
        setLiveStatusText(`Page ${page.pageNumber}: Deep-researching solutions for ${formattedItems.length} question(s)...`);
        setPages(prev => prev.map(p => p.id === page.id ? {
          ...p,
          errorMessage: `Deep-researching solutions (${formattedItems.length} MCQs)...`
        } : p));

        const solvedItems = await Promise.all(
          formattedItems.map(async (item) => {
            // If solution is already rich and detailed (>35 chars), keep it
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
        formattedItems = solvedItems;
      }

      // Update page state
      setPages(prev => prev.map(p => p.id === page.id ? {
        ...p,
        status: 'ready',
        mcqCount: formattedItems.length,
        errorMessage: undefined
      } : p));

      // Append to global extracted MCQs list
      if (formattedItems.length > 0) {
        setExtractedMcqs(prev => {
          const nextList = [...prev, ...formattedItems];
          return nextList.map((it, idx) => ({ ...it, question_r: idx + 1 }));
        });
      }

      return formattedItems;
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

  // Multi-Page Batch & Concurrency Loop ("ek saath multiple pages send karna")
  const handleStartExtraction = async () => {
    const selectedPages = pages.filter(p => p.isSelected && p.status !== 'ready');
    if (selectedPages.length === 0) {
      alert('No pending pages selected for extraction.');
      return;
    }

    // Auto-check bridge connection if bridge engine is selected
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
      const effectiveBatchSize = Math.max(1, batchSize);

      // Process in chunks of batchSize
      for (let i = 0; i < selectedPages.length; i += effectiveBatchSize) {
        if (pauseRef.current) {
          setLiveStatusText('Processing paused by user.');
          break;
        }

        const currentBatch = selectedPages.slice(i, i + effectiveBatchSize);
        const batchNum = Math.floor(i / effectiveBatchSize) + 1;
        const totalBatches = Math.ceil(selectedPages.length / effectiveBatchSize);

        setLiveStatusText(
          `Batch ${batchNum}/${totalBatches}: Processing ${currentBatch.length} page(s) simultaneously (P.${currentBatch.map(p => p.pageNumber).join(', ')})...`
        );

        // Execute batch in parallel!
        await Promise.allSettled(
          currentBatch.map(async (page, indexInBatch) => {
            // Stagger parallel requests by 200ms for network stability
            if (indexInBatch > 0) {
              await new Promise(r => setTimeout(r, indexInBatch * 200));
            }
            return processPageItem(page, i + indexInBatch, selectedPages.length);
          })
        );

        // Pause briefly between batches
        await new Promise(res => setTimeout(res, 500));
      }

      setLiveStatusText('All selected batches completed!');
    } catch (err: any) {
      console.error('Batch extraction error:', err);
      setLiveStatusText(`Extraction stopped: ${err.message || err}`);
    } finally {
      setIsProcessingAll(false);
      setActivePageIndex(null);
    }
  };

  // Single page retry
  const handleRetryPage = async (page: PageQueueItem, idx: number) => {
    try {
      await processPageItem(page, idx, pages.length);
    } catch (err: any) {
      alert(`Page ${page.pageNumber} extraction failed: ${err.message}`);
    } finally {
      setActivePageIndex(null);
    }
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
          setExtractedMcqs(prev => prev.map(q => q.id === item.id ? {
            ...q,
            solution_hi: res.solution_hi || q.solution_hi,
            solution_en: res.solution_en || q.solution_en,
            difficulty_level: res.difficulty_level || q.difficulty_level
          } : q));
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
      setExtractedMcqs(prev => prev.map(q => q.id === item.id ? {
        ...q,
        solution_hi: res.solution_hi || q.solution_hi,
        solution_en: res.solution_en || q.solution_en,
        difficulty_level: res.difficulty_level || q.difficulty_level
      } : q));
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
    const safeName = setName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    downloadMockTestCsv(extractedMcqs, `${safeName}_mocktest.csv`, answerFormat);
  };

  // Copy CSV to clipboard
  const handleCopyCsv = () => {
    if (extractedMcqs.length === 0) return;
    const csv = serializeMockTestToCsv(extractedMcqs, answerFormat);
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
          setExtractedMcqs(parsed);
          alert(`Successfully imported ${parsed.length} MCQs!`);
        } else {
          alert('Could not parse any MCQs from this CSV file. Verify headers.');
        }
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  // Deep AI Proofreading: cleans OCR errors, aligns translations, strips all exam tags
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
      setLiveStatusText(`✓ All ${cleaned.length} questions proofread and cleaned error-free!`);
      alert(`✨ AI Proofreading Complete!\n\nSuccessfully proofread ${cleaned.length} questions. All previous-year exam tags, shifts, dates, and OCR errors have been cleanly eliminated.`);
    } catch (err: any) {
      console.error('Proofreading error:', err);
      // Fallback: apply local offline sanitizer
      setExtractedMcqs(prev => prev.map(cleanMockTestItem));
      alert(`AI proofreading encountered an issue (${err.message || err}), but all exam tags and math delimiters were successfully cleaned using the offline sanitization engine!`);
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
    setExtractedMcqs(prev => prev.map(cleanMockTestItem));
    setLiveStatusText('🧹 Cleaned all exam tags, shift references, and math delimiters!');
    alert('Exam citations, shifts, LaTeX delimiters ($$), percentages, and rupee signs cleaned successfully!');
  };

  // Add question manually
  const handleAddQuestion = () => {
    const nextNum = extractedMcqs.length + 1;
    const newItem: MockTestMcqItem = {
      id: `mt_manual_${Date.now()}`,
      question_r: nextNum,
      question_type: 'MCQ',
      question_hi: '<p>प्रश्न यहाँ लिखें...</p>',
      option1_hi: 'विकल्प A',
      option2_hi: 'विकल्प B',
      option3_hi: 'विकल्प C',
      option4_hi: 'विकल्प D',
      solution_hi: '<p><b>हल:</b> विस्तृत विवरण...</p>',
      question_en: '<p>Enter question text here...</p>',
      option1_en: 'Option A',
      option2_en: 'Option B',
      option3_en: 'Option C',
      option4_en: 'Option D',
      solution_en: '<p><b>Solution:</b> Detailed step-by-step proof...</p>',
      answer: answerFormat === 'letters' ? 'A' : '1',
      set_name: setName,
      difficulty_level: difficulty
    };
    setExtractedMcqs(prev => [...prev, newItem]);
  };

  const updateItem = (id: string, updates: Partial<MockTestMcqItem>) => {
    setExtractedMcqs(prev => prev.map(it => it.id === id ? { ...it, ...updates } : it));
  };

  const deleteItem = (id: string) => {
    setExtractedMcqs(prev => prev.filter(it => it.id !== id).map((it, idx) => ({
      ...it,
      question_r: idx + 1
    })));
  };

  const solvedCount = extractedMcqs.filter(i => (i.solution_hi && i.solution_hi.length > 10) || (i.solution_en && i.solution_en.length > 10)).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header Banner */}
      <div className="relative rounded-2xl bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-amber-600/10 border border-amber-500/20 p-6 backdrop-blur-xl">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-bold tracking-wide uppercase">
              <FileSpreadsheet className="w-3.5 h-3.5 text-amber-400" />
              <span>Dedicated MockTest MCQ Extractor • 18-Column Engine</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white font-display">
              Bilingual MockTest MCQ Extractor
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 max-w-2xl">
              Extract bilingual MCQs page-by-page from PDFs & scanned papers with LaTeX math, 
              deep step-by-step explanations, and export ready-to-upload 18-column CSV files.
            </p>
          </div>

          {/* Quick Stats & Engine Selector */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="px-3 py-2 bg-black/40 border border-white/[0.08] rounded-xl flex items-center gap-2.5">
              <span className="text-xs text-slate-400">Total MCQs:</span>
              <span className="text-base font-extrabold text-amber-400">{extractedMcqs.length}</span>
            </div>

            <div className="px-3 py-2 bg-black/40 border border-white/[0.08] rounded-xl flex items-center gap-2.5">
              <span className="text-xs text-slate-400">Pages:</span>
              <span className="text-base font-extrabold text-blue-400">{pages.length}</span>
            </div>

            <div className="px-3 py-2 bg-black/40 border border-white/[0.08] rounded-xl flex items-center gap-2.5">
              <span className="text-xs text-slate-400">Solved:</span>
              <span className="text-base font-extrabold text-emerald-400">{solvedCount}/{extractedMcqs.length}</span>
            </div>
          </div>
        </div>

        {/* AI Engine Switcher & Bridge Connect/Disconnect Bar */}
        <div className="mt-5 p-3 rounded-xl bg-black/50 border border-white/[0.08] flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Mode Switcher */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              AI Engine:
            </span>
            <div className="flex items-center p-0.5 bg-black/60 border border-white/[0.1] rounded-lg">
              <button
                type="button"
                onClick={() => setAiEngine('bridge')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                  aiEngine === 'bridge'
                    ? 'bg-emerald-500 text-black shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Free Extension Bridge</span>
              </button>

              <button
                type="button"
                onClick={() => setAiEngine('api')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                  aiEngine === 'api'
                    ? 'bg-blue-500 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Key className="w-3.5 h-3.5" />
                <span>Direct Gemini API</span>
              </button>
            </div>
          </div>

          {/* Dynamic Settings based on Engine */}
          <div className="flex flex-wrap items-center gap-2.5">
            {aiEngine === 'bridge' ? (
              <>
                {/* Provider Selector for Bridge */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-400">Provider:</span>
                  <select
                    value={selectedProvider}
                    onChange={(e) => handleProviderChange(e.target.value as AiProvider)}
                    className="px-2.5 py-1 bg-black/60 border border-white/[0.1] rounded-lg text-xs text-amber-300 font-bold focus:outline-none"
                  >
                    <option value="gemini">Gemini</option>
                    <option value="deepseek">DeepSeek</option>
                    <option value="chatgpt">ChatGPT</option>
                    <option value="claude">Claude</option>
                  </select>
                </div>

                {/* Bridge Connection Status & Connect/Disconnect Button */}
                {bridgeStatus.connected ? (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-lg text-xs font-bold">
                      <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>Bridge Connected</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setAiEngine('api')}
                      className="px-2 py-1 bg-white/[0.04] hover:bg-rose-500/20 border border-white/[0.08] hover:border-rose-500/30 text-slate-400 hover:text-rose-300 rounded-lg text-xs font-semibold transition-all"
                      title="Disconnect Bridge and switch to Direct API"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowConnectModal(true)}
                      className="px-3 py-1 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-black font-extrabold rounded-lg text-xs shadow transition-all"
                    >
                      Connect Extension Bridge
                    </button>
                    <button
                      type="button"
                      onClick={() => pingStudyAiExtension().catch(() => {})}
                      title="Refresh Bridge status"
                      className="p-1 bg-white/[0.04] text-slate-400 hover:text-white rounded-lg"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <span className="text-xs text-blue-400 font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
                  <span>Direct Gemini API Mode Active</span>
                </span>
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(true)}
                  className="flex items-center gap-1 px-2.5 py-1 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-blue-300 rounded-lg text-xs font-bold transition-all"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>Configure API Key</span>
                </button>
              </>
            )}

            {/* Multi-Page Parallel Batch Control ("ek saath multiple pages send karna") */}
            <div className="flex items-center gap-1.5 pl-2 border-l border-white/[0.1]">
              <span className="text-xs font-bold text-slate-300" title="How many pages to send simultaneously">
                Parallel Batch:
              </span>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 5].map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setBatchSize(count)}
                    className={`px-2 py-1 text-xs font-bold rounded-lg border transition-all ${
                      batchSize === count
                        ? 'bg-amber-500 border-amber-400 text-black shadow'
                        : 'bg-black/60 border-white/[0.1] text-slate-400 hover:text-white'
                    }`}
                    title={`Send ${count} page(s) at once`}
                  >
                    {count} {count === 1 ? 'Page' : 'Pages'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Global Settings Toolbar */}
        <div className="mt-4 pt-4 border-t border-white/[0.08] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Paper Set Name */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Set / Paper Name (set_name)
            </label>
            <input
              type="text"
              value={setName}
              onChange={(e) => {
                setSetName(e.target.value);
                setExtractedMcqs(prev => prev.map(i => ({ ...i, set_name: e.target.value })));
              }}
              placeholder="e.g. RRB NTPC 2024 CBT-1"
              className="px-3 py-1.5 bg-black/40 border border-white/[0.1] rounded-lg text-xs text-white focus:outline-none focus:border-amber-500/60 font-medium"
            />
          </div>

          {/* Answer Format */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Answer Format
            </label>
            <div className="flex items-center gap-1 p-0.5 bg-black/40 border border-white/[0.1] rounded-lg">
              <button
                type="button"
                onClick={() => setAnswerFormat('letters')}
                className={`flex-1 py-1 text-xs font-bold rounded ${
                  answerFormat === 'letters'
                    ? 'bg-amber-500 text-black shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Letters (A, B, C, D)
              </button>
              <button
                type="button"
                onClick={() => setAnswerFormat('numbers')}
                className={`flex-1 py-1 text-xs font-bold rounded ${
                  answerFormat === 'numbers'
                    ? 'bg-amber-500 text-black shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Numbers (1, 2, 3, 4)
              </button>
            </div>
          </div>

          {/* Default Difficulty */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Default Difficulty
            </label>
            <select
              value={difficulty}
              onChange={(e) => {
                const diff = e.target.value as DifficultyLevel;
                setDifficulty(diff);
                setExtractedMcqs(prev => prev.map(i => ({ ...i, difficulty_level: diff })));
              }}
              className="px-3 py-1.5 bg-black/40 border border-white/[0.1] rounded-lg text-xs text-white focus:outline-none focus:border-amber-500/60 font-medium"
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-col gap-1 justify-end">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadCsv}
                disabled={extractedMcqs.length === 0}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-extrabold rounded-lg text-xs shadow-md transition-all disabled:opacity-40"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
              <button
                type="button"
                onClick={handleCopyCsv}
                disabled={extractedMcqs.length === 0}
                title="Copy CSV to clipboard"
                className="p-1.5 bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.1] text-slate-200 rounded-lg text-xs transition-all disabled:opacity-40"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={() => csvImportInputRef.current?.click()}
                title="Import existing MockTest CSV"
                className="p-1.5 bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.1] text-slate-200 rounded-lg text-xs transition-all"
              >
                <Upload className="w-4 h-4" />
              </button>
              <input
                ref={csvImportInputRef}
                type="file"
                accept=".csv"
                onChange={handleImportCsv}
                className="hidden"
              />
            </div>
          </div>
        </div>

        {/* One-Shot All Fields & Deep Solutions Checkbox Option */}
        <div className="mt-4 pt-3.5 border-t border-white/[0.08] flex items-center justify-between flex-wrap gap-3 bg-amber-500/[0.03] p-3 rounded-xl border border-amber-500/20">
          <label className="flex items-center gap-3 cursor-pointer select-none group flex-1">
            <input
              type="checkbox"
              checked={autoDeepSolveAll}
              onChange={(e) => setAutoDeepSolveAll(e.target.checked)}
              className="w-4 h-4 rounded border-amber-500/50 text-amber-500 focus:ring-amber-400 bg-black/80 cursor-pointer accent-amber-500"
            />
            <div className="flex flex-col">
              <span className="text-xs font-extrabold text-amber-300 flex items-center gap-1.5 group-hover:text-amber-200 transition-colors">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                <span>One-Shot Auto-Fill All 18 Fields + Deep Solutions (सभी Fields & Solutions एक साथ भरें)</span>
              </span>
              <span className="text-[11px] text-slate-300">
                Image bhejte hi Question, Options, Answer, aur <strong>Deep Research Step-by-Step Solutions</strong> (Hindi + English with LaTeX & HTML) ek saath fill hokar final store hoga.
              </span>
            </div>
          </label>

          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all ${
            autoDeepSolveAll 
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' 
              : 'bg-white/[0.05] text-slate-400 border-white/[0.1]'
          }`}>
            {autoDeepSolveAll ? '✓ All 18 Fields Auto-Fill Active' : 'Extraction Only (Fast)'}
          </span>
        </div>
      </div>

      {/* File Upload Dropzone */}
      <div 
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
          pages.length === 0 
            ? 'border-amber-500/40 bg-amber-500/[0.03] hover:bg-amber-500/[0.06] py-12' 
            : 'border-white/[0.1] bg-white/[0.02] hover:bg-white/[0.04]'
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

        <div className="flex flex-col items-center justify-center gap-2">
          <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20">
            <Upload className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-white">
            {pages.length === 0 ? 'Upload PDF or Question Paper Images' : 'Add More Pages (PDF / Images)'}
          </h3>
          <p className="text-xs text-slate-400 max-w-md">
            Drag & drop exam PDF files or photos. Each page is converted to 2.5x high-res images and processed in parallel batches of {batchSize} page(s).
          </p>
        </div>

        {uploadProgress && (
          <div className="mt-4 max-w-md mx-auto p-3 bg-black/60 rounded-xl border border-amber-500/30 flex items-center gap-3">
            <Loader2 className="w-4 h-4 text-amber-400 animate-spin flex-shrink-0" />
            <span className="text-xs text-amber-300 font-medium">{uploadProgress.text}</span>
          </div>
        )}
      </div>

      {/* Page Queue Section */}
      {pages.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-white/[0.03] border border-white/[0.08] rounded-xl">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                Page Queue ({pages.length} Pages • Batch: {batchSize} parallel)
              </span>
              <button
                type="button"
                onClick={() => {
                  const allSelected = pages.every(p => p.isSelected);
                  setPages(prev => prev.map(p => ({ ...p, isSelected: !allSelected })));
                }}
                className="text-xs text-amber-400 hover:text-amber-300 underline font-medium"
              >
                {pages.every(p => p.isSelected) ? 'Deselect All' : 'Select All'}
              </button>
              {liveStatusText && (
                <span className="text-xs text-slate-300 font-medium animate-pulse flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  {liveStatusText}
                </span>
              )}
            </div>

            {/* Queue Controls */}
            <div className="flex items-center gap-2">
              {!isProcessingAll ? (
                <button
                  type="button"
                  onClick={handleStartExtraction}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-extrabold rounded-xl text-xs shadow-lg shadow-amber-500/20 transition-all"
                >
                  <Play className="w-3.5 h-3.5 fill-black" />
                  <span>Start MCQ Extraction ({batchSize} Pages Parallel)</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsPaused(!isPaused)}
                  className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs shadow-lg transition-all"
                >
                  {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                  <span>{isPaused ? 'Resume' : 'Pause'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  if (confirm('Clear all pages from the queue?')) {
                    setPages([]);
                  }
                }}
                disabled={isProcessingAll}
                className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-all disabled:opacity-40"
                title="Clear all pages"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Visual Page Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {pages.map((page, idx) => {
              return (
                <div
                  key={page.id}
                  className={`group relative rounded-xl overflow-hidden border transition-all ${
                    page.status === 'processing'
                      ? 'border-amber-500 ring-2 ring-amber-500/30 bg-amber-500/5'
                      : page.status === 'ready'
                      ? 'border-emerald-500/40 bg-emerald-500/5'
                      : page.status === 'error'
                      ? 'border-rose-500/40 bg-rose-500/5'
                      : 'border-white/[0.08] bg-black/40 hover:border-white/[0.2]'
                  }`}
                >
                  {/* Select Checkbox & Page Badge */}
                  <div className="absolute top-2 left-2 right-2 z-10 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setPages(prev => prev.map(p => p.id === page.id ? { ...p, isSelected: !p.isSelected } : p))}
                      className="p-1 rounded bg-black/60 text-white hover:text-amber-400 backdrop-blur-md"
                    >
                      {page.isSelected ? (
                        <CheckSquare className="w-3.5 h-3.5 text-amber-400" />
                      ) : (
                        <Square className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </button>

                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-black/70 text-white backdrop-blur-md border border-white/[0.1]">
                      P.{page.pageNumber}
                    </span>
                  </div>

                  {/* Thumbnail */}
                  <div className="relative aspect-[3/4] bg-neutral-900 overflow-hidden flex items-center justify-center">
                    <img
                      src={page.imageUrl}
                      alt={`Page ${page.pageNumber}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />

                    {/* Status Overlay */}
                    {page.status === 'processing' && (
                      <div className="absolute inset-0 bg-black/70 backdrop-blur-xs flex flex-col items-center justify-center p-2 text-center">
                        <Loader2 className="w-6 h-6 text-amber-400 animate-spin mb-1" />
                        <span className="text-[10px] text-amber-300 font-bold uppercase tracking-wider">
                          Extracting...
                        </span>
                        {page.errorMessage && (
                          <span className="text-[9px] text-slate-300 line-clamp-2 mt-1">
                            {page.errorMessage}
                          </span>
                        )}
                      </div>
                    )}

                    {page.status === 'ready' && (
                      <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-600 text-white shadow-md flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>{page.mcqCount} MCQs</span>
                      </div>
                    )}

                    {page.status === 'error' && (
                      <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-600 text-white shadow-md flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        <span>Error</span>
                      </div>
                    )}
                  </div>

                  {/* Card Bottom Bar */}
                  <div className="p-2 flex items-center justify-between bg-black/60 border-t border-white/[0.06] text-xs">
                    <span className="text-[10px] text-slate-400 truncate">
                      {page.status === 'ready' ? `${page.mcqCount} extracted` : page.status}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleRetryPage(page, idx)}
                      disabled={isProcessingAll}
                      title="Re-extract this page"
                      className="p-1 text-slate-400 hover:text-amber-400 rounded transition-all"
                    >
                      <RotateCw className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Extracted MCQs Live Studio Section */}
      <div className="rounded-2xl border border-white/[0.08] bg-black/40 backdrop-blur-xl overflow-hidden shadow-2xl">
        {/* Studio Tabs & Action Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3 border-b border-white/[0.08] bg-white/[0.02]">
          {/* Tabs */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('cards')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'cards'
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Interactive Cards ({extractedMcqs.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('grid')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'grid'
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Live 18-Column CSV Grid</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('csv')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'csv'
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Raw CSV</span>
            </button>
          </div>

          {/* Right Toolbar Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Auto Solve All */}
            <button
              type="button"
              onClick={handleAutoSolveAll}
              disabled={isSolvingAll || extractedMcqs.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg text-xs font-bold shadow transition-all disabled:opacity-40"
              title="Automatically generate deep step-by-step Hindi & English solutions with LaTeX & HTML"
            >
              {isSolvingAll ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              )}
              <span>{isSolvingAll ? 'Generating Solutions...' : '⚡ Auto-Solve All (AI)'}</span>
            </button>

            {/* AI Proofread & Clean Tags */}
            <button
              type="button"
              onClick={handleProofreadAll}
              disabled={isProofreading || extractedMcqs.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white rounded-lg text-xs font-bold shadow transition-all disabled:opacity-40"
              title="AI Proofread: Deeply analyzes questions, fixes OCR typos, and strips all exam shift citations and junk text"
            >
              {isProofreading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-cyan-300" />
              )}
              <span>{isProofreading ? 'Proofreading...' : '✨ AI Proofread (Clean Tags)'}</span>
            </button>

            {/* Clean Tags & Math Delimiters */}
            <button
              type="button"
              onClick={handleCleanAllMath}
              disabled={extractedMcqs.length === 0}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 rounded-lg text-xs font-bold transition-all disabled:opacity-40"
              title="Clean exam shift tags, junk text, raw $$ formatting, percentages, and rupee signs for mocktest portals"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>🧹 Clean Tags & Math</span>
            </button>

            {/* Add Custom Question */}
            <button
              type="button"
              onClick={handleAddQuestion}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.1] text-slate-200 rounded-lg text-xs font-semibold transition-all"
            >
              <Plus className="w-3.5 h-3.5 text-amber-400" />
              <span>Add MCQ</span>
            </button>

            {/* Download CSV */}
            <button
              type="button"
              onClick={handleDownloadCsv}
              disabled={extractedMcqs.length === 0}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-extrabold shadow-md transition-all disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download 18-Col CSV</span>
            </button>
          </div>
        </div>

        {/* Tab 1: Interactive Bilingual Cards */}
        {activeTab === 'cards' && (
          <div className="p-5 space-y-4 max-h-[700px] overflow-y-auto custom-scrollbar">
            {extractedMcqs.length === 0 ? (
              <div className="py-16 text-center text-slate-500 space-y-2">
                <FileSpreadsheet className="w-12 h-12 mx-auto text-slate-600" />
                <p className="text-sm font-semibold">No questions extracted yet.</p>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Upload PDF pages or images above and click "Start MCQ Extraction" to extract questions into this studio.
                </p>
              </div>
            ) : (
              extractedMcqs.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3 hover:border-white/[0.15] transition-all"
                >
                  {/* Card Header */}
                  <div className="flex items-center justify-between gap-3 pb-2 border-b border-white/[0.06]">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-extrabold text-xs border border-amber-500/30">
                        #{item.question_r}
                      </span>
                      <span className="text-xs font-semibold text-slate-400">
                        Type: <strong className="text-white">{item.question_type}</strong>
                      </span>
                      <span className="text-xs text-slate-400">
                        Difficulty: <strong className="text-white capitalize">{item.difficulty_level}</strong>
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Solve Single Button */}
                      <button
                        type="button"
                        onClick={() => handleSolveSingle(item)}
                        disabled={solvingId === item.id}
                        className="flex items-center gap-1 px-2.5 py-1 bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-300 rounded text-xs font-semibold transition-all disabled:opacity-50"
                      >
                        {solvingId === item.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Sparkles className="w-3 h-3" />
                        )}
                        <span>{item.solution_hi || item.solution_en ? 'Regenerate Solution' : 'Auto-Solve'}</span>
                      </button>

                      {/* Correct Answer Selector */}
                      <div className="flex items-center gap-1 text-xs">
                        <span className="text-slate-400 font-bold">Ans:</span>
                        <input
                          type="text"
                          value={item.answer}
                          onChange={(e) => updateItem(item.id, { answer: e.target.value })}
                          className="w-12 px-1.5 py-0.5 bg-black/60 border border-emerald-500/40 rounded text-center text-xs font-extrabold text-emerald-400 focus:outline-none"
                        />
                      </div>

                      {/* Delete */}
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

                  {/* Bilingual Columns */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Hindi Column */}
                    <div className="space-y-2 p-3 bg-black/30 rounded-xl border border-white/[0.05]">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-extrabold text-amber-400 uppercase tracking-wider">
                          Hindi (question_hi & options)
                        </span>
                      </div>

                      {/* Hindi Question Text */}
                      <textarea
                        rows={2}
                        value={item.question_hi}
                        onChange={(e) => updateItem(item.id, { question_hi: e.target.value })}
                        placeholder="<p>प्रश्न हिंदी में यहाँ लिखें...</p>"
                        className="w-full p-2 bg-black/40 border border-white/[0.08] rounded-lg text-xs text-slate-200 focus:outline-none focus:border-amber-500/50 custom-scrollbar"
                      />

                      {/* Hindi Options 1-4 */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {(['option1_hi', 'option2_hi', 'option3_hi', 'option4_hi'] as const).map((key, optIdx) => (
                          <div key={key} className="flex items-center gap-1.5 px-2 py-1 bg-black/40 border border-white/[0.06] rounded-lg">
                            <span className="text-[10px] font-bold text-amber-400">{String.fromCharCode(65 + optIdx)}</span>
                            <input
                              type="text"
                              value={item[key] || ''}
                              onChange={(e) => updateItem(item.id, { [key]: e.target.value })}
                              placeholder={`विकल्प ${String.fromCharCode(65 + optIdx)}`}
                              className="w-full bg-transparent text-xs text-slate-300 focus:outline-none"
                            />
                          </div>
                        ))}
                      </div>

                      {/* Hindi Solution */}
                      <div className="space-y-1 mt-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">
                          Detailed Hindi Solution (solution_hi)
                        </span>
                        <textarea
                          rows={3}
                          value={item.solution_hi}
                          onChange={(e) => updateItem(item.id, { solution_hi: e.target.value })}
                          placeholder="<p><b>हल:</b> विस्तृत विवरण, सूत्र एवं गणना...</p>"
                          className="w-full p-2 bg-black/40 border border-white/[0.08] rounded-lg text-xs text-amber-200/90 focus:outline-none focus:border-amber-500/50 custom-scrollbar"
                        />
                      </div>
                    </div>

                    {/* English Column */}
                    <div className="space-y-2 p-3 bg-black/30 rounded-xl border border-white/[0.05]">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-extrabold text-blue-400 uppercase tracking-wider">
                          English (question_en & options)
                        </span>
                      </div>

                      {/* English Question Text */}
                      <textarea
                        rows={2}
                        value={item.question_en}
                        onChange={(e) => updateItem(item.id, { question_en: e.target.value })}
                        placeholder="<p>Enter English question here...</p>"
                        className="w-full p-2 bg-black/40 border border-white/[0.08] rounded-lg text-xs text-slate-200 focus:outline-none focus:border-blue-500/50 custom-scrollbar"
                      />

                      {/* English Options 1-4 */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {(['option1_en', 'option2_en', 'option3_en', 'option4_en'] as const).map((key, optIdx) => (
                          <div key={key} className="flex items-center gap-1.5 px-2 py-1 bg-black/40 border border-white/[0.06] rounded-lg">
                            <span className="text-[10px] font-bold text-blue-400">{String.fromCharCode(65 + optIdx)}</span>
                            <input
                              type="text"
                              value={item[key] || ''}
                              onChange={(e) => updateItem(item.id, { [key]: e.target.value })}
                              placeholder={`Option ${String.fromCharCode(65 + optIdx)}`}
                              className="w-full bg-transparent text-xs text-slate-300 focus:outline-none"
                            />
                          </div>
                        ))}
                      </div>

                      {/* English Solution */}
                      <div className="space-y-1 mt-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">
                          Detailed English Solution (solution_en)
                        </span>
                        <textarea
                          rows={3}
                          value={item.solution_en}
                          onChange={(e) => updateItem(item.id, { solution_en: e.target.value })}
                          placeholder="<p><b>Solution:</b> Step-by-step derivation, formula & proofs...</p>"
                          className="w-full p-2 bg-black/40 border border-white/[0.08] rounded-lg text-xs text-teal-200/90 focus:outline-none focus:border-blue-500/50 custom-scrollbar"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Tab 2: Live 18-Column CSV Grid */}
        {activeTab === 'grid' && (
          <div className="p-4 max-h-[700px] overflow-auto custom-scrollbar">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-white/[0.1] bg-white/[0.04] text-[11px] font-bold text-amber-400 whitespace-nowrap">
                  <th className="p-2">#</th>
                  <th className="p-2 min-w-[200px]">question_hi</th>
                  <th className="p-2 min-w-[100px]">opt1_hi</th>
                  <th className="p-2 min-w-[100px]">opt2_hi</th>
                  <th className="p-2 min-w-[100px]">opt3_hi</th>
                  <th className="p-2 min-w-[100px]">opt4_hi</th>
                  <th className="p-2 min-w-[200px]">solution_hi</th>
                  <th className="p-2 min-w-[200px]">question_en</th>
                  <th className="p-2 min-w-[100px]">opt1_en</th>
                  <th className="p-2 min-w-[100px]">opt2_en</th>
                  <th className="p-2 min-w-[100px]">opt3_en</th>
                  <th className="p-2 min-w-[100px]">opt4_en</th>
                  <th className="p-2 min-w-[200px]">solution_en</th>
                  <th className="p-2 min-w-[70px]">answer</th>
                  <th className="p-2 min-w-[120px]">set_name</th>
                  <th className="p-2 min-w-[80px]">difficulty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05] text-slate-300">
                {extractedMcqs.map((row) => (
                  <tr key={row.id} className="hover:bg-white/[0.02]">
                    <td className="p-2 font-bold text-amber-400">{row.question_r}</td>
                    <td className="p-2 truncate max-w-[220px]" title={row.question_hi}>{row.question_hi}</td>
                    <td className="p-2 truncate max-w-[100px]">{row.option1_hi}</td>
                    <td className="p-2 truncate max-w-[100px]">{row.option2_hi}</td>
                    <td className="p-2 truncate max-w-[100px]">{row.option3_hi}</td>
                    <td className="p-2 truncate max-w-[100px]">{row.option4_hi}</td>
                    <td className="p-2 truncate max-w-[220px]" title={row.solution_hi}>{row.solution_hi}</td>
                    <td className="p-2 truncate max-w-[220px]" title={row.question_en}>{row.question_en}</td>
                    <td className="p-2 truncate max-w-[100px]">{row.option1_en}</td>
                    <td className="p-2 truncate max-w-[100px]">{row.option2_en}</td>
                    <td className="p-2 truncate max-w-[100px]">{row.option3_en}</td>
                    <td className="p-2 truncate max-w-[100px]">{row.option4_en}</td>
                    <td className="p-2 truncate max-w-[220px]" title={row.solution_en}>{row.solution_en}</td>
                    <td className="p-2 font-bold text-emerald-400">{row.answer}</td>
                    <td className="p-2 truncate max-w-[120px]">{row.set_name}</td>
                    <td className="p-2 capitalize">{row.difficulty_level}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 3: Raw CSV Preview */}
        {activeTab === 'csv' && (
          <div className="p-4 space-y-2">
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

        {/* Footer Status Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3 border-t border-white/[0.08] bg-white/[0.02] text-xs text-slate-400">
          <div className="flex items-center gap-4">
            <span>Total: <strong className="text-white">{extractedMcqs.length}</strong></span>
            <span>Solved: <strong className="text-emerald-400">{solvedCount}</strong></span>
            <span>Unsolved: <strong className="text-amber-400">{extractedMcqs.length - solvedCount}</strong></span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleDownloadCsv}
              disabled={extractedMcqs.length === 0}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-extrabold rounded-lg text-xs shadow transition-all disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download 18-Column CSV</span>
            </button>
          </div>
        </div>
      </div>

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
    </div>
  );
};

export default MocktestExtractor;
