import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, Download, Sparkles, RefreshCw, FileSpreadsheet, 
  FileText, Trash2, ArrowDownUp, Check, AlertCircle, 
  ChevronRight, Scissors, Eye, Undo2, ArrowLeftRight, 
  Layers, Plus, CheckCircle2, Split, ZoomIn, ZoomOut,
  Maximize2, RotateCw, CheckSquare, Square, Copy, RefreshCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { convertPdfToImages } from '../services/pdfUtils';
import { 
  PageCard, 
  CropBox,
  renderMergedCardToA4, 
  exportMergedCardsToPdf,
  cropImageByPercentage 
} from '../services/pdfStitchService';

interface QaPageStitcherProps {
  onSendToMcqExtractor?: (images: string[]) => void;
  onSendToDocxConverter?: (images: string[]) => void;
  onClose?: () => void;
}

export const QaPageStitcher: React.FC<QaPageStitcherProps> = ({
  onSendToMcqExtractor,
  onSendToDocxConverter,
  onClose
}) => {
  const [cards, setCards] = useState<PageCard[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<{ current: number; total: number } | null>(null);
  
  // Drag & Drop State
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [dragOverTargetId, setDragOverTargetId] = useState<string | null>(null);

  // Manual Merge Picker
  const [manualMergeSourceId, setManualMergeSourceId] = useState<string | null>(null);

  // Visual Cropper Modal State
  const [cropTarget, setCropTarget] = useState<{ cardId: string; type: 'question' | 'solution' } | null>(null);
  const [activeCropBox, setActiveCropBox] = useState<CropBox>({ x: 0, y: 0, width: 100, height: 100 });
  const [activeScale, setActiveScale] = useState<number>(1.0);
  const [isDrawingCrop, setIsDrawingCrop] = useState(false);
  const cropStartPos = useRef<{ x: number; y: number } | null>(null);
  const cropImageRef = useRef<HTMLImageElement | null>(null);

  // Global Settings
  const [showDividerLine, setShowDividerLine] = useState<boolean>(true);

  // Batch Range Modal
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchQStart, setBatchQStart] = useState<number>(1);
  const [batchQEnd, setBatchQEnd] = useState<number>(10);
  const [batchSolStart, setBatchSolStart] = useState<number>(11);
  const [batchSolEnd, setBatchSolEnd] = useState<number>(20);

  // Export State
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number } | null>(null);

  // Initialize crop modal values when opened
  useEffect(() => {
    if (cropTarget) {
      const card = cards.find(c => c.id === cropTarget.cardId);
      if (card) {
        if (cropTarget.type === 'question') {
          setActiveCropBox(card.qCrop || { x: 0, y: 0, width: 100, height: 100 });
          setActiveScale(card.qScale || 1.0);
        } else {
          setActiveCropBox(card.solCrop || { x: 0, y: 0, width: 100, height: 100 });
          setActiveScale(card.solScale || 1.0);
        }
      }
    }
  }, [cropTarget]);

  // Window mouse event listeners for smooth drawing of crop box
  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
      if (!cropStartPos.current || !cropImageRef.current) return;
      const rect = cropImageRef.current.getBoundingClientRect();
      const currentX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const currentY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

      const x = Math.min(cropStartPos.current.x, currentX);
      const y = Math.min(cropStartPos.current.y, currentY);
      const width = Math.abs(currentX - cropStartPos.current.x);
      const height = Math.abs(currentY - cropStartPos.current.y);

      setActiveCropBox({
        x: Number(((x / rect.width) * 100).toFixed(2)),
        y: Number(((y / rect.height) * 100).toFixed(2)),
        width: Number(((width / rect.width) * 100).toFixed(2)),
        height: Number(((height / rect.height) * 100).toFixed(2)),
      });
    };

    const handleWindowMouseUp = () => {
      if (cropStartPos.current) {
        cropStartPos.current = null;
        setIsDrawingCrop(false);
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, []);

  // File Upload Handler
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoadingPdf(true);
    setFileName(file.name);
    try {
      const images = await convertPdfToImages(file, (current, total) => {
        setLoadingProgress({ current, total });
      });

      const initialCards: PageCard[] = images.map((img, idx) => ({
        id: `card-${Date.now()}-${idx}`,
        originalPageNum: idx + 1,
        questionImage: img,
        isMerged: false,
        isSelected: true,
        qScale: 1.0,
        solScale: 1.0,
        showDivider: true,
      }));

      setCards(initialCards);
      setBatchQStart(1);
      setBatchQEnd(Math.floor(images.length / 2));
      setBatchSolStart(Math.floor(images.length / 2) + 1);
      setBatchSolEnd(images.length);
    } catch (err: any) {
      alert('Error loading PDF: ' + (err?.message || err));
    } finally {
      setIsLoadingPdf(false);
      setLoadingProgress(null);
    }
  };

  // -------------------------------------------------------------
  // Card Selection Handlers
  // -------------------------------------------------------------
  const toggleSelectCard = (cardId: string) => {
    setCards(prev => prev.map(c => c.id === cardId ? { ...c, isSelected: c.isSelected === false ? true : false } : c));
  };

  const toggleSelectAll = () => {
    const allSelected = cards.length > 0 && cards.every(c => c.isSelected !== false);
    const nextState = !allSelected;
    setCards(prev => prev.map(c => ({ ...c, isSelected: nextState })));
  };

  const selectMergedOnly = () => {
    setCards(prev => prev.map(c => ({ ...c, isSelected: c.isMerged })));
  };

  // -------------------------------------------------------------
  // Drag-and-Drop Merge Handlers
  // -------------------------------------------------------------
  const handleDragStart = (e: React.DragEvent, cardId: string) => {
    setDraggedCardId(cardId);
    e.dataTransfer.setData('text/plain', cardId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, targetCardId: string) => {
    e.preventDefault();
    if (draggedCardId && draggedCardId !== targetCardId) {
      setDragOverTargetId(targetCardId);
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleDragLeave = (targetCardId: string) => {
    if (dragOverTargetId === targetCardId) {
      setDragOverTargetId(null);
    }
  };

  const handleDrop = (e: React.DragEvent, targetCardId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData('text/plain') || draggedCardId;
    setDragOverTargetId(null);
    setDraggedCardId(null);

    if (!sourceId || sourceId === targetCardId) return;

    executeMerge(sourceId, targetCardId);
  };

  const executeMerge = (sourceId: string, targetId: string) => {
    const sourceCard = cards.find(c => c.id === sourceId);
    const targetCard = cards.find(c => c.id === targetId);

    if (!sourceCard || !targetCard) return;

    setCards(prev => {
      const updated = prev.map(c => {
        if (c.id === targetId) {
          return {
            ...c,
            solutionImage: sourceCard.questionImage,
            croppedSolutionImage: sourceCard.croppedQuestionImage,
            solutionPageNum: sourceCard.originalPageNum,
            isMerged: true,
            solCrop: sourceCard.qCrop,
            solScale: sourceCard.qScale || 1.0,
            showDivider: showDividerLine,
          };
        }
        return c;
      });

      return updated.filter(c => c.id !== sourceId);
    });

    setManualMergeSourceId(null);
  };

  const handleUnmerge = (cardId: string) => {
    const mergedCard = cards.find(c => c.id === cardId);
    if (!mergedCard || !mergedCard.solutionImage) return;

    const restoredCard: PageCard = {
      id: `card-restored-${Date.now()}-${Math.random()}`,
      originalPageNum: mergedCard.solutionPageNum || (mergedCard.originalPageNum + 1),
      questionImage: mergedCard.solutionImage,
      croppedQuestionImage: mergedCard.croppedSolutionImage,
      isMerged: false,
      isSelected: true,
      qCrop: mergedCard.solCrop,
      qScale: mergedCard.solScale || 1.0,
      showDivider: true,
    };

    setCards(prev => {
      const updated = prev.map(c => {
        if (c.id === cardId) {
          return {
            ...c,
            solutionImage: undefined,
            croppedSolutionImage: undefined,
            solutionPageNum: undefined,
            isMerged: false,
            solCrop: undefined,
            solScale: 1.0,
          };
        }
        return c;
      });

      const nextList = [...updated, restoredCard];
      nextList.sort((a, b) => a.originalPageNum - b.originalPageNum);
      return nextList;
    });
  };

  const handleSwap = (cardId: string) => {
    setCards(prev => prev.map(c => {
      if (c.id === cardId && c.solutionImage) {
        return {
          ...c,
          originalPageNum: c.solutionPageNum || c.originalPageNum,
          solutionPageNum: c.originalPageNum,
          questionImage: c.solutionImage,
          croppedQuestionImage: c.croppedSolutionImage,
          solutionImage: c.questionImage,
          croppedSolutionImage: c.croppedQuestionImage,
          qCrop: c.solCrop,
          solCrop: c.qCrop,
          qScale: c.solScale,
          solScale: c.qScale,
        };
      }
      return c;
    }));
  };

  // Duplicate Card Handler (allows multi-question extraction from same page)
  const handleDuplicate = (cardId: string) => {
    const idx = cards.findIndex(c => c.id === cardId);
    if (idx === -1) return;
    const original = cards[idx];

    const duplicateCard: PageCard = {
      ...original,
      id: `card-copy-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      isMerged: original.isMerged,
    };

    const nextCards = [...cards];
    nextCards.splice(idx + 1, 0, duplicateCard);
    setCards(nextCards);
  };

  const handleDelete = (cardId: string) => {
    setCards(prev => prev.filter(c => c.id !== cardId));
  };

  // -------------------------------------------------------------
  // Interactive Visual Crop Mouse Handlers
  // -------------------------------------------------------------
  const handleCropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!cropImageRef.current) return;
    const rect = cropImageRef.current.getBoundingClientRect();
    const startX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const startY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

    cropStartPos.current = { x: startX, y: startY };
    setIsDrawingCrop(true);

    const xPct = (startX / rect.width) * 100;
    const yPct = (startY / rect.height) * 100;
    setActiveCropBox({ x: xPct, y: yPct, width: 0, height: 0 });
  };

  const handleApplyCrop = async () => {
    if (!cropTarget || !currentCroppingCard) return;

    try {
      const isFull = activeCropBox.width >= 99.5 && activeCropBox.height >= 99.5 && activeCropBox.x <= 0.5 && activeCropBox.y <= 0.5;
      const imageSrc = cropTarget.type === 'question' 
        ? currentCroppingCard.questionImage 
        : (currentCroppingCard.solutionImage || currentCroppingCard.questionImage);

      let croppedBase64: string | undefined = undefined;
      if (!isFull && activeCropBox.width > 2 && activeCropBox.height > 2) {
        croppedBase64 = await cropImageByPercentage(imageSrc, activeCropBox);
      }

      setCards(prev => prev.map(c => {
        if (c.id === cropTarget.cardId) {
          if (cropTarget.type === 'question') {
            return {
              ...c,
              croppedQuestionImage: croppedBase64,
              qCrop: isFull ? undefined : activeCropBox,
              qScale: activeScale,
            };
          } else {
            return {
              ...c,
              croppedSolutionImage: croppedBase64,
              solCrop: isFull ? undefined : activeCropBox,
              solScale: activeScale,
            };
          }
        }
        return c;
      }));

      setCropTarget(null);
    } catch (err: any) {
      alert('Failed to crop: ' + err.message);
    }
  };

  const handleResetCropOnCard = (cardId: string, type: 'question' | 'solution') => {
    setCards(prev => prev.map(c => {
      if (c.id === cardId) {
        if (type === 'question') {
          return { ...c, croppedQuestionImage: undefined, qCrop: undefined, qScale: 1.0 };
        } else {
          return { ...c, croppedSolutionImage: undefined, solCrop: undefined, solScale: 1.0 };
        }
      }
      return c;
    }));
  };

  // -------------------------------------------------------------
  // Batch Auto-Pair Handler
  // -------------------------------------------------------------
  const handleExecuteBatchPair = () => {
    setShowBatchModal(false);
    const count = Math.min(batchQEnd - batchQStart + 1, batchSolEnd - batchSolStart + 1);
    if (count <= 0) return;

    let updatedCards = [...cards];

    for (let i = 0; i < count; i++) {
      const qPageNum = batchQStart + i;
      const solPageNum = batchSolStart + i;

      const qCard = updatedCards.find(c => c.originalPageNum === qPageNum && !c.isMerged);
      const solCard = updatedCards.find(c => c.originalPageNum === solPageNum && !c.isMerged);

      if (qCard && solCard && qCard.id !== solCard.id) {
        updatedCards = updatedCards.map(c => {
          if (c.id === qCard.id) {
            return {
              ...c,
              solutionImage: solCard.questionImage,
              croppedSolutionImage: solCard.croppedQuestionImage,
              solutionPageNum: solCard.originalPageNum,
              isMerged: true,
              showDivider: showDividerLine,
            };
          }
          return c;
        }).filter(c => c.id !== solCard.id);
      }
    }

    setCards(updatedCards);
  };

  // -------------------------------------------------------------
  // Exports & AI Transfers (Filtered by isSelected)
  // -------------------------------------------------------------
  const handleDownloadPdf = async () => {
    const selectedCards = cards.filter(c => c.isSelected !== false);
    if (selectedCards.length === 0) {
      alert('Please select at least one page to download.');
      return;
    }
    setIsExporting(true);
    try {
      const cardsToExport = selectedCards.map(c => ({ ...c, showDivider: showDividerLine }));
      const blob = await exportMergedCardsToPdf(cardsToExport, (current, total) => {
        setExportProgress({ current, total });
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Merged_QA_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert('Failed to generate PDF: ' + err.message);
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
  };

  const handleSendToMcq = async () => {
    if (!onSendToMcqExtractor) return;
    const selectedCards = cards.filter(c => c.isSelected !== false);
    if (selectedCards.length === 0) {
      alert('Please select at least one page to send to MCQ Tool.');
      return;
    }
    setIsExporting(true);
    try {
      const images: string[] = [];
      for (const card of selectedCards) {
        const rendered = await renderMergedCardToA4({ ...card, showDivider: showDividerLine });
        images.push(rendered);
      }
      onSendToMcqExtractor(images);
    } catch (err: any) {
      alert('Failed to transfer to MCQ Extractor: ' + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  const handleSendToDocx = async () => {
    if (!onSendToDocxConverter) return;
    const selectedCards = cards.filter(c => c.isSelected !== false);
    if (selectedCards.length === 0) {
      alert('Please select at least one page to send to Docx Converter.');
      return;
    }
    setIsExporting(true);
    try {
      const images: string[] = [];
      for (const card of selectedCards) {
        const rendered = await renderMergedCardToA4({ ...card, showDivider: showDividerLine });
        images.push(rendered);
      }
      onSendToDocxConverter(images);
    } catch (err: any) {
      alert('Failed to transfer to Docx Converter: ' + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  const mergedCount = cards.filter(c => c.isMerged).length;
  const selectedCards = cards.filter(c => c.isSelected !== false);
  const selectedCount = selectedCards.length;
  const allSelected = cards.length > 0 && selectedCount === cards.length;
  const currentCroppingCard = cropTarget ? cards.find(c => c.id === cropTarget.cardId) : null;
  const currentCroppingImageSrc = currentCroppingCard 
    ? (cropTarget?.type === 'question' ? currentCroppingCard.questionImage : currentCroppingCard.solutionImage || currentCroppingCard.questionImage) 
    : '';

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#0B0D13] text-slate-100 flex flex-col select-none">
      {/* 1. TOP HEADER & ACTION BAR (With Prominent Final Page Count Badge) */}
      <header className="sticky top-14 z-30 border-b border-white/[0.08] bg-[#0E111A]/95 backdrop-blur-xl px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-tr from-[#FF6B2B] to-[#FF884D] text-white shadow-md shadow-[#FF6B2B]/20">
            <Split className="w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base font-extrabold text-white tracking-tight">Q&A Page Merger & Cropper</h1>
              
              {/* FINAL PAGES COUNT BADGE & SELECTION CONTROLS */}
              {cards.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-gradient-to-r from-blue-600/25 to-indigo-600/25 border border-blue-400/40 text-blue-200 rounded-full text-xs font-bold shadow-sm shadow-blue-500/10">
                    <span className="text-slate-300">Final PDF:</span>
                    <span className="text-white text-sm font-black tracking-wide">{cards.length} Pages</span>
                    {mergedCount > 0 && (
                      <span className="text-emerald-400 font-bold border-l border-white/20 pl-2">
                        {mergedCount} Merged
                      </span>
                    )}
                  </div>

                  {/* Select All / Deselect All Toggle */}
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-bold transition-all shadow-sm ${
                      allSelected 
                        ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300 hover:bg-emerald-500/30' 
                        : selectedCount > 0 
                        ? 'bg-amber-500/20 border-amber-400/50 text-amber-300 hover:bg-amber-500/30'
                        : 'bg-white/[0.04] border-white/[0.1] text-slate-400 hover:bg-white/[0.08]'
                    }`}
                    title="Click to Select All or Deselect All"
                  >
                    {allSelected ? (
                      <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Square className="w-3.5 h-3.5" />
                    )}
                    <span>Selected: {selectedCount}/{cards.length}</span>
                  </button>

                  {mergedCount > 0 && mergedCount < cards.length && (
                    <button
                      type="button"
                      onClick={selectMergedOnly}
                      className="text-[11px] font-semibold text-slate-400 hover:text-white underline px-1"
                    >
                      Merged Only
                    </button>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-slate-400">
              Select specific pages to download or send. Drag solutions onto questions with 0 unwanted tags!
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {cards.length > 0 && (
            <>
              {/* Divider Line Toggle */}
              <button
                type="button"
                onClick={() => setShowDividerLine(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                  showDividerLine 
                    ? 'bg-white/[0.08] border-white/[0.2] text-white' 
                    : 'bg-white/[0.02] border-white/[0.06] text-slate-400'
                }`}
                title="Toggle divider line between question and solution"
              >
                {showDividerLine ? <CheckSquare className="w-3.5 h-3.5 text-[#FF6B2B]" /> : <Square className="w-3.5 h-3.5" />}
                <span>Divider Line</span>
              </button>

              {/* Batch Auto-Pair */}
              <button
                type="button"
                onClick={() => setShowBatchModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 rounded-xl text-xs font-bold transition-all shadow-sm"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>⚡ Batch Range</span>
              </button>
            </>
          )}

          {/* Upload Button */}
          <label className="flex items-center gap-1.5 px-3.5 py-1.5 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] text-slate-200 rounded-xl text-xs font-semibold cursor-pointer transition-all">
            <Upload className="w-3.5 h-3.5 text-[#FF884D]" />
            <span>{cards.length > 0 ? 'Replace PDF' : 'Upload PDF'}</span>
            <input 
              type="file" 
              accept="application/pdf" 
              className="hidden" 
              onChange={handlePdfUpload}
            />
          </label>

          {/* Download PDF */}
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={selectedCount === 0 || isExporting}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-xl text-xs transition-all shadow-md shadow-blue-600/20 disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            <span>
              {isExporting && exportProgress 
                ? `Compiling PDF (${exportProgress.current}/${exportProgress.total})...` 
                : `Download PDF (${selectedCount})`}
            </span>
          </button>

          {/* Send to MCQ Extractor */}
          <button
            type="button"
            onClick={handleSendToMcq}
            disabled={selectedCount === 0 || isExporting}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-extrabold rounded-xl text-xs transition-all shadow-md shadow-amber-500/20 disabled:opacity-40"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Send to MCQ Tool ({selectedCount})</span>
          </button>
        </div>
      </header>

      {/* Loading Progress Banner */}
      {isLoadingPdf && (
        <div className="p-4 bg-orange-500/10 border-b border-orange-500/25 text-orange-300 text-xs flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>Rendering PDF pages ({loadingProgress?.current || 0}/{loadingProgress?.total || 0})...</span>
        </div>
      )}

      {/* Manual Selection Notification Bar */}
      {manualMergeSourceId && (
        <div className="bg-[#FF6B2B]/20 border-b border-[#FF6B2B]/40 px-6 py-2 flex items-center justify-between text-xs font-semibold text-orange-200 animate-in fade-in">
          <span>
            Selected <strong>Page {cards.find(c => c.id === manualMergeSourceId)?.originalPageNum}</strong> as Solution. Now click on any Question card below to merge!
          </span>
          <button
            type="button"
            onClick={() => setManualMergeSourceId(null)}
            className="underline text-white hover:text-slate-300"
          >
            Cancel
          </button>
        </div>
      )}

      {/* 2. MAIN PAGE CARDS GRID */}
      <main className="flex-1 p-6 max-w-[1600px] mx-auto w-full">
        {cards.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-6">
            {cards.map((card) => {
              const isTargetHovered = dragOverTargetId === card.id;
              const isSourceBeingDragged = draggedCardId === card.id;
              const isManualSource = manualMergeSourceId === card.id;

              return (
                <div
                  key={card.id}
                  draggable={!card.isMerged}
                  onDragStart={(e) => handleDragStart(e, card.id)}
                  onDragOver={(e) => handleDragOver(e, card.id)}
                  onDragLeave={() => handleDragLeave(card.id)}
                  onDrop={(e) => handleDrop(e, card.id)}
                  onClick={() => {
                    if (manualMergeSourceId && manualMergeSourceId !== card.id) {
                      executeMerge(manualMergeSourceId, card.id);
                    }
                  }}
                  className={`relative flex flex-col rounded-2xl border transition-all duration-150 overflow-hidden group shadow-xl ${
                    card.isSelected === false ? 'opacity-40 grayscale-[0.4] hover:opacity-85' : 'opacity-100'
                  } ${
                    isTargetHovered
                      ? 'border-emerald-400 ring-4 ring-emerald-500/30 bg-emerald-950/40 scale-[1.02]'
                      : card.isMerged
                      ? (card.isSelected !== false ? 'border-orange-500/50 bg-[#121622] hover:border-orange-500/80' : 'border-orange-500/20 bg-[#121622]/60')
                      : isManualSource
                      ? 'border-[#FF6B2B] ring-2 ring-[#FF6B2B] bg-[#FF6B2B]/10'
                      : (card.isSelected !== false ? 'border-white/[0.12] bg-[#0E111A] hover:border-white/[0.25] hover:shadow-2xl' : 'border-white/[0.04] bg-[#0E111A]/60')
                  } ${isSourceBeingDragged ? 'opacity-40' : ''} ${
                    manualMergeSourceId && manualMergeSourceId !== card.id ? 'cursor-pointer hover:ring-2 hover:ring-emerald-400' : ''
                  }`}
                >
                  {/* Drop Indicator Overlay */}
                  {isTargetHovered && (
                    <div className="absolute inset-0 z-30 bg-emerald-600/30 backdrop-blur-xs flex flex-col items-center justify-center p-4 text-center pointer-events-none">
                      <div className="p-3 rounded-full bg-emerald-500 text-black mb-2 animate-bounce">
                        <ArrowDownUp className="w-6 h-6" />
                      </div>
                      <span className="text-sm font-extrabold text-white">
                        Drop to Merge as Solution!
                      </span>
                    </div>
                  )}

                  {/* CARD HEADER */}
                  <div className={`p-3 border-b flex items-center justify-between gap-2 ${
                    card.isMerged 
                      ? (card.isSelected !== false ? 'bg-orange-500/10 border-orange-500/20 text-orange-300' : 'bg-orange-500/5 border-orange-500/10 text-orange-400/60')
                      : (card.isSelected !== false ? 'bg-white/[0.03] border-white/[0.06] text-slate-300' : 'bg-white/[0.01] border-white/[0.03] text-slate-500')
                  }`}>
                    <div className="flex items-center gap-2">
                      {/* Checkbox for selecting / deselecting this page */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleSelectCard(card.id); }}
                        className={`p-1 rounded-md transition-all flex items-center justify-center ${
                          card.isSelected !== false 
                            ? 'text-[#FF884D] bg-[#FF884D]/15 hover:bg-[#FF884D]/25 ring-1 ring-[#FF884D]/30' 
                            : 'text-slate-500 bg-white/[0.04] hover:bg-white/[0.08] hover:text-slate-300'
                        }`}
                        title={card.isSelected !== false ? "Click to Deselect from Export" : "Click to Select for Export"}
                      >
                        {card.isSelected !== false ? (
                          <CheckSquare className="w-4 h-4 text-[#FF884D]" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-500" />
                        )}
                      </button>

                      <span className="text-xs font-extrabold text-white">
                        {card.isMerged 
                          ? `Set: Page ${card.originalPageNum} + ${card.solutionPageNum}` 
                          : `Page ${card.originalPageNum}`}
                      </span>
                      {card.isMerged ? (
                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          Merged
                        </span>
                      ) : (
                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-white/[0.06] text-slate-400">
                          Single
                        </span>
                      )}
                    </div>

                    {/* Top Action Icons: Duplicate & Delete */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDuplicate(card.id); }}
                        className="p-1 rounded bg-white/[0.04] hover:bg-white/[0.12] text-slate-300 hover:text-white transition-all"
                        title="Duplicate page (to crop another question from the same page)"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDelete(card.id); }}
                        className="p-1 rounded bg-white/[0.04] hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-all"
                        title="Delete card"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* CARD BODY: 100% WYSIWYG PREVIEW (Actual Clean Cropped Images) */}
                  <div className="p-3 flex-1 flex flex-col gap-2 bg-white/[0.01]">
                    {card.isMerged ? (
                      /* MERGED SET: QUESTION TOP, SOLUTION BOTTOM */
                      <div className="flex-1 flex flex-col gap-2">
                        {/* Question Snippet */}
                        <div className="relative group/preview rounded-xl border border-orange-500/30 overflow-hidden bg-white p-1">
                          <img
                            src={card.croppedQuestionImage || card.questionImage}
                            alt="Question"
                            className="w-full h-auto max-h-44 object-contain block mx-auto"
                            style={{
                              transform: card.qScale && card.qScale !== 1 ? `scale(${card.qScale})` : undefined,
                              transformOrigin: 'center center'
                            }}
                          />
                          <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1 opacity-90 group-hover/preview:opacity-100 transition-all">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setCropTarget({ cardId: card.id, type: 'question' }); }}
                              className="px-2 py-1 rounded bg-black/80 hover:bg-[#FF6B2B] text-white text-[10px] font-bold flex items-center gap-1 shadow-md"
                            >
                              <Scissors className="w-3 h-3 text-amber-400" />
                              <span>{card.croppedQuestionImage ? 'Re-Crop Q' : 'Crop Q'}</span>
                            </button>
                            {card.croppedQuestionImage && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleResetCropOnCard(card.id, 'question'); }}
                                className="p-1 rounded bg-black/80 hover:bg-rose-600 text-white text-[10px]"
                                title="Reset Question to full page"
                              >
                                <RefreshCcw className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Divider Line */}
                        {showDividerLine && (
                          <div className="w-full my-0.5 border-t border-slate-700" />
                        )}

                        {/* Solution Snippet */}
                        {card.solutionImage && (
                          <div className="relative group/preview rounded-xl border border-emerald-500/30 overflow-hidden bg-white p-1">
                            <img
                              src={card.croppedSolutionImage || card.solutionImage}
                              alt="Solution"
                              className="w-full h-auto max-h-44 object-contain block mx-auto"
                              style={{
                                transform: card.solScale && card.solScale !== 1 ? `scale(${card.solScale})` : undefined,
                                transformOrigin: 'center center'
                              }}
                            />
                            <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1 opacity-90 group-hover/preview:opacity-100 transition-all">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setCropTarget({ cardId: card.id, type: 'solution' }); }}
                                className="px-2 py-1 rounded bg-black/80 hover:bg-emerald-600 text-white text-[10px] font-bold flex items-center gap-1 shadow-md"
                              >
                                <Scissors className="w-3 h-3 text-emerald-400" />
                                <span>{card.croppedSolutionImage ? 'Re-Crop Sol' : 'Crop Sol'}</span>
                              </button>
                              {card.croppedSolutionImage && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handleResetCropOnCard(card.id, 'solution'); }}
                                  className="p-1 rounded bg-black/80 hover:bg-rose-600 text-white text-[10px]"
                                  title="Reset Solution to full page"
                                >
                                  <RefreshCcw className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* SINGLE STANDALONE PAGE */
                      <div className="relative group/preview rounded-xl border border-white/[0.08] overflow-hidden bg-white p-1 flex items-center justify-center">
                        <img
                          src={card.croppedQuestionImage || card.questionImage}
                          alt={`Page ${card.originalPageNum}`}
                          className="w-full h-auto max-h-72 object-contain block mx-auto"
                          style={{
                            transform: card.qScale && card.qScale !== 1 ? `scale(${card.qScale})` : undefined,
                            transformOrigin: 'center center'
                          }}
                        />
                        <div className="absolute bottom-2 right-2 flex items-center gap-1 opacity-90 group-hover/preview:opacity-100 transition-all">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setCropTarget({ cardId: card.id, type: 'question' }); }}
                            className="px-2.5 py-1 rounded bg-black/80 hover:bg-[#FF6B2B] text-white text-[10px] font-bold flex items-center gap-1 shadow-md"
                          >
                            <Scissors className="w-3 h-3 text-amber-400" />
                            <span>{card.croppedQuestionImage ? 'Re-Crop Box' : 'Crop Box'}</span>
                          </button>
                          {card.croppedQuestionImage && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleResetCropOnCard(card.id, 'question'); }}
                              className="p-1 rounded bg-black/80 hover:bg-rose-600 text-white text-[10px]"
                              title="Reset to full page"
                            >
                              <RefreshCcw className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* CARD FOOTER */}
                  <div className="p-3 border-t border-white/[0.06] bg-black/20 flex items-center justify-between gap-1.5">
                    {card.isMerged ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleUnmerge(card.id)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-rose-500/20 hover:text-rose-300 text-slate-300 text-xs font-semibold transition-all"
                          title="Separate back into 2 cards"
                        >
                          <Undo2 className="w-3.5 h-3.5" />
                          <span>Unmerge</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleSwap(card.id)}
                          className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 hover:text-white text-xs transition-all"
                          title="Swap Top & Bottom"
                        >
                          <ArrowLeftRight className="w-3.5 h-3.5" />
                          <span>Swap</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setManualMergeSourceId(isManualSource ? null : card.id)}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            isManualSource 
                              ? 'bg-[#FF6B2B] text-white' 
                              : 'bg-white/[0.06] hover:bg-white/[0.1] text-slate-300'
                          }`}
                        >
                          <ArrowDownUp className="w-3 h-3 text-orange-400" />
                          <span>{isManualSource ? 'Cancel' : 'Merge into...'}</span>
                        </button>

                        <span className="text-[10px] text-slate-500 italic">
                          Drag onto Question
                        </span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* EMPTY STATE */
          <div className="py-20 flex flex-col items-center justify-center text-center max-w-md mx-auto">
            <div className="p-5 rounded-3xl bg-white/[0.03] border border-white/[0.08] text-[#FF6B2B] mb-5 shadow-2xl">
              <Upload className="w-12 h-12" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Upload Question Paper & Solutions</h2>
            <p className="text-xs text-slate-400 mb-6 leading-relaxed">
              Upload your PDF to display all pages as interactive cards. You can then simply drag any solution card onto its question card to merge them into 1 page!
            </p>
            <label className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-[#FF6B2B] to-[#FF884D] hover:shadow-xl hover:shadow-[#FF6B2B]/25 text-white font-bold rounded-2xl text-sm cursor-pointer transition-all shadow-lg">
              <Upload className="w-4 h-4" />
              <span>Select PDF File</span>
              <input 
                type="file" 
                accept="application/pdf" 
                className="hidden" 
                onChange={handlePdfUpload}
              />
            </label>
          </div>
        )}
      </main>

      {/* 3. INTERACTIVE VISUAL CROP & SCALE MODAL */}
      <AnimatePresence>
        {cropTarget && currentCroppingCard && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-4xl bg-[#141824] border border-white/[0.1] rounded-2xl flex flex-col max-h-[92vh] shadow-2xl overflow-hidden"
            >
              {/* Modal Header */}
              <div className="p-4 border-b border-white/[0.08] flex items-center justify-between bg-[#0E111A]">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-orange-500/20 text-orange-400">
                    <Scissors className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      Crop {cropTarget.type === 'question' ? 'Question' : 'Solution'} (Page {cropTarget.type === 'question' ? currentCroppingCard.originalPageNum : currentCroppingCard.solutionPageNum})
                    </h3>
                    <p className="text-xs text-slate-400">
                      Click & drag your mouse over the page to select the exact question or solution area.
                    </p>
                  </div>
                </div>

                {/* Switch Q / Sol tabs if merged */}
                {currentCroppingCard.isMerged && (
                  <div className="flex items-center gap-1 bg-white/[0.04] p-0.5 rounded-lg border border-white/[0.08]">
                    <button
                      type="button"
                      onClick={() => setCropTarget({ cardId: currentCroppingCard.id, type: 'question' })}
                      className={`px-3 py-1 rounded text-xs font-bold transition-all ${
                        cropTarget.type === 'question' ? 'bg-[#FF6B2B] text-white shadow' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Question (P.{currentCroppingCard.originalPageNum})
                    </button>
                    <button
                      type="button"
                      onClick={() => setCropTarget({ cardId: currentCroppingCard.id, type: 'solution' })}
                      className={`px-3 py-1 rounded text-xs font-bold transition-all ${
                        cropTarget.type === 'solution' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Solution (P.{currentCroppingCard.solutionPageNum})
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setCropTarget(null)}
                  className="text-slate-400 hover:text-white p-1"
                >
                  ✕
                </button>
              </div>

              {/* Crop Canvas Body */}
              <div className="flex-1 overflow-auto p-4 bg-[#07090E] flex items-center justify-center min-h-[420px]">
                <div 
                  className="relative cursor-crosshair border border-white/[0.1] rounded shadow-2xl overflow-hidden max-w-full"
                  onMouseDown={handleCropMouseDown}
                >
                  <img
                    ref={cropImageRef}
                    src={currentCroppingImageSrc}
                    alt="Page to Crop"
                    className="max-w-full h-auto max-h-[60vh] object-contain block pointer-events-none select-none"
                  />

                  {/* Active Selection Box */}
                  {activeCropBox && activeCropBox.width > 0 && activeCropBox.height > 0 && (
                    <div
                      className="absolute border-2 border-[#FF6B2B] bg-[#FF6B2B]/20 pointer-events-none transition-none shadow-sm"
                      style={{
                        left: `${activeCropBox.x}%`,
                        top: `${activeCropBox.y}%`,
                        width: `${activeCropBox.width}%`,
                        height: `${activeCropBox.height}%`,
                      }}
                    >
                      <div className="absolute top-0 left-0 -translate-y-full bg-[#FF6B2B] text-black font-extrabold text-[9px] px-1.5 py-0.5 rounded-t tracking-wider uppercase">
                        Selected Region
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Footer Controls */}
              <div className="p-4 border-t border-white/[0.08] bg-[#0E111A] flex flex-wrap items-center justify-between gap-4">
                {/* Scale / Zoom Slider */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <ZoomIn className="w-4 h-4 text-orange-400" />
                    <span>Zoom / Scale:</span>
                    <input
                      type="range"
                      min={0.8}
                      max={1.8}
                      step={0.05}
                      value={activeScale}
                      onChange={(e) => setActiveScale(Number(e.target.value))}
                      className="w-32 accent-[#FF6B2B]"
                    />
                    <span className="font-mono text-white font-bold w-12 text-right">
                      {Math.round(activeScale * 100)}%
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setActiveCropBox({ x: 0, y: 0, width: 100, height: 100 });
                      setActiveScale(1.0);
                    }}
                    className="px-2.5 py-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-xs text-slate-300"
                  >
                    Reset Full Page
                  </button>
                </div>

                {/* Apply / Cancel */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCropTarget(null)}
                    className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyCrop}
                    className="flex items-center gap-1.5 px-5 py-2 bg-gradient-to-r from-[#FF6B2B] to-[#FF884D] text-white rounded-xl text-xs font-bold shadow-lg shadow-[#FF6B2B]/25"
                  >
                    <Check className="w-4 h-4" />
                    <span>Apply & Save Crop</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 4. BATCH AUTO-PAIR MODAL */}
      <AnimatePresence>
        {showBatchModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-[#141824] border border-white/[0.1] rounded-2xl p-6 shadow-2xl space-y-5"
            >
              <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-amber-400" />
                  <h3 className="text-sm font-bold text-white">Batch Range Auto-Pair</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowBatchModal(false)}
                  className="text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <p className="text-xs text-slate-400">
                Specify the Question page range and Solution page range to auto-merge all pairs in order.
              </p>

              <div className="grid grid-cols-2 gap-4 text-xs">
                {/* Question Range */}
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-2">
                  <span className="font-bold text-orange-400">Question Pages</span>
                  <div className="flex items-center gap-2">
                    <div>
                      <label className="text-[10px] text-slate-400 block">From</label>
                      <input
                        type="number"
                        value={batchQStart}
                        min={1}
                        onChange={(e) => setBatchQStart(Number(e.target.value))}
                        className="w-full bg-white/[0.06] border border-white/[0.1] rounded px-2 py-1 text-white"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block">To</label>
                      <input
                        type="number"
                        value={batchQEnd}
                        min={1}
                        onChange={(e) => setBatchQEnd(Number(e.target.value))}
                        className="w-full bg-white/[0.06] border border-white/[0.1] rounded px-2 py-1 text-white"
                      />
                    </div>
                  </div>
                </div>

                {/* Solution Range */}
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-2">
                  <span className="font-bold text-emerald-400">Solution Pages</span>
                  <div className="flex items-center gap-2">
                    <div>
                      <label className="text-[10px] text-slate-400 block">From</label>
                      <input
                        type="number"
                        value={batchSolStart}
                        min={1}
                        onChange={(e) => setBatchSolStart(Number(e.target.value))}
                        className="w-full bg-white/[0.06] border border-white/[0.1] rounded px-2 py-1 text-white"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block">To</label>
                      <input
                        type="number"
                        value={batchSolEnd}
                        min={1}
                        onChange={(e) => setBatchSolEnd(Number(e.target.value))}
                        className="w-full bg-white/[0.06] border border-white/[0.1] rounded px-2 py-1 text-white"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setShowBatchModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExecuteBatchPair}
                  className="px-4 py-1.5 bg-gradient-to-r from-[#FF6B2B] to-[#FF884D] text-white rounded-xl text-xs font-bold shadow-md"
                >
                  Auto-Pair Now
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default QaPageStitcher;
