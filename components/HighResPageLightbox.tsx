import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Hand,
  Scissors,
  Save,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Loader2,
  CheckCheck,
  Cloud,
  HardDrive,
  Key,
  Check
} from 'lucide-react';
import {
  cropImageRegion,
  uploadFigureImage,
  buildQuestionFigureTag,
  buildOptionFigureTag,
  FigureTargetField,
  StagedCropItem,
  getStoredImgbbApiKey,
  setStoredImgbbApiKey,
  DEFAULT_IMGBB_API_KEY
} from '../services/figureStorageService';
import { MockTestMcqItem } from '../types';

export interface PageLightboxItem {
  id: string;
  pageNumber: number;
  imageUrl: string;
  items?: MockTestMcqItem[];
}

export interface HighResPageLightboxProps {
  isOpen: boolean;
  pageIndex: number | null;
  pages: PageLightboxItem[];
  setName?: string;
  extractedMcqs: MockTestMcqItem[];
  initialTargetQuestionId?: string;
  initialTargetField?: FigureTargetField;
  initialCropMode?: boolean;
  onClose: () => void;
  onUpdateQuestion: (questionId: string, updated: MockTestMcqItem) => void;
  onPageIndexChange?: (newIndex: number) => void;
}

export const HighResPageLightbox: React.FC<HighResPageLightboxProps> = ({
  isOpen,
  pageIndex,
  pages,
  setName,
  extractedMcqs,
  initialTargetQuestionId,
  initialTargetField = 'question',
  initialCropMode = true,
  onClose,
  onUpdateQuestion,
  onPageIndexChange
}) => {
  // If closed or invalid page, do not render modal
  if (!isOpen || pageIndex === null || !pages[pageIndex]) {
    return null;
  }

  const activePage = pages[pageIndex];
  const canPrev = pageIndex > 0;
  const canNext = pageIndex < pages.length - 1;

  // Zoom & Tool State
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [toolMode, setToolMode] = useState<'crop' | 'pan'>(initialCropMode ? 'crop' : 'pan');
  const [stagedCrops, setStagedCrops] = useState<StagedCropItem[]>([]);
  const [selectedTargetQuestionId, setSelectedTargetQuestionId] = useState<string>(initialTargetQuestionId || '');
  const [useCloudForFigures, setUseCloudForFigures] = useState<boolean>(true); // default to ImgBB Cloud
  const [isUploadingFigure, setIsUploadingFigure] = useState<boolean>(false);
  const [figureSuccessToast, setFigureSuccessToast] = useState<string | null>(null);

  // ImgBB API Key Management
  const [showKeyInput, setShowKeyInput] = useState<boolean>(false);
  const [customKeyInput, setCustomKeyInput] = useState<string>(getStoredImgbbApiKey());
  const [keySavedNotice, setKeySavedNotice] = useState<boolean>(false);

  // Smooth Direct DOM References (Bypasses React Re-renders during Mouse Moves for 60-120fps performance!)
  const panRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const zoomLevelRef = useRef<number>(1);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isSpacePressedRef = useRef<boolean>(false);

  // Crop drawing direct DOM references
  const isDrawingCropRef = useRef<boolean>(false);
  const cropStartRef = useRef<{ xPct: number; yPct: number }>({ xPct: 0, yPct: 0 });
  const activeCropBoxRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  const imageContainerRef = useRef<HTMLDivElement | null>(null);
  const lightboxImgRef = useRef<HTMLImageElement | null>(null);
  const cropBoxOverlayRef = useRef<HTMLDivElement | null>(null);
  const cropBadgeRef = useRef<HTMLDivElement | null>(null);

  // Sync zoomLevelRef
  useEffect(() => {
    zoomLevelRef.current = zoomLevel;
    if (imageContainerRef.current) {
      imageContainerRef.current.style.transition = 'transform 0.15s ease-out';
      imageContainerRef.current.style.transform = `translate3d(${panRef.current.x}px, ${panRef.current.y}px, 0) scale(${zoomLevel})`;
    }
  }, [zoomLevel]);

  // Preselect target question for this page if not already set
  useEffect(() => {
    if (initialTargetQuestionId) {
      setSelectedTargetQuestionId(initialTargetQuestionId);
      return;
    }
    const pageQuestions = extractedMcqs.filter(
      q => q.pageNumber === activePage.pageNumber || q.source_pages == activePage.pageNumber
    );
    if (pageQuestions.length > 0) {
      setSelectedTargetQuestionId(pageQuestions[0].id);
    } else if (extractedMcqs.length > 0 && !selectedTargetQuestionId) {
      setSelectedTargetQuestionId(extractedMcqs[0].id);
    }
  }, [pageIndex, activePage.pageNumber, extractedMcqs, initialTargetQuestionId]);

  // Reset pan on page change
  const handlePageSwitch = useCallback((newIdx: number) => {
    if (newIdx < 0 || newIdx >= pages.length) return;
    panRef.current = { x: 0, y: 0 };
    setZoomLevel(1);
    if (imageContainerRef.current) {
      imageContainerRef.current.style.transition = 'none';
      imageContainerRef.current.style.transform = `translate3d(0px, 0px, 0) scale(1)`;
    }
    if (onPageIndexChange) {
      onPageIndexChange(newIdx);
    }
  }, [pages.length, onPageIndexChange]);

  // Smooth Direct Drag / Pan Handler
  const handleMouseDown = (e: React.MouseEvent) => {
    const isPanAction =
      e.button === 1 || // Middle click
      e.button === 2 || // Right click
      isSpacePressedRef.current ||
      toolMode === 'pan';

    if (!isPanAction && e.button === 0 && toolMode === 'crop') {
      // Start Crop Drawing directly on Image
      handleCropMouseDown(e);
      return;
    }

    // Start Pan Dragging
    isDraggingRef.current = true;
    dragStartRef.current = {
      x: e.clientX - panRef.current.x,
      y: e.clientY - panRef.current.y
    };

    if (imageContainerRef.current) {
      imageContainerRef.current.style.transition = 'none'; // CRITICAL: Disable transition while dragging for 0ms lag!
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    // 1. Image Panning (Move)
    if (isDraggingRef.current) {
      const newX = e.clientX - dragStartRef.current.x;
      const newY = e.clientY - dragStartRef.current.y;
      panRef.current = { x: newX, y: newY };

      if (imageContainerRef.current) {
        imageContainerRef.current.style.transform = `translate3d(${newX}px, ${newY}px, 0) scale(${zoomLevelRef.current})`;
      }
      return;
    }

    // 2. Crop Box Drawing (Direct DOM update - 0 React re-renders)
    if (isDrawingCropRef.current) {
      handleCropMouseMove(e);
    }
  };

  const handleMouseUp = () => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
    }
    if (isDrawingCropRef.current) {
      handleCropMouseUp();
    }
  };

  // Direct Crop Selection Down
  const handleCropMouseDown = (e: React.MouseEvent) => {
    if (!lightboxImgRef.current) return;
    const rect = lightboxImgRef.current.getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    ) {
      return;
    }

    const xPct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const yPct = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));

    isDrawingCropRef.current = true;
    cropStartRef.current = { xPct, yPct };
    activeCropBoxRef.current = { x: xPct, y: yPct, width: 0, height: 0 };

    if (cropBoxOverlayRef.current) {
      cropBoxOverlayRef.current.style.display = 'block';
      cropBoxOverlayRef.current.style.left = `${xPct}%`;
      cropBoxOverlayRef.current.style.top = `${yPct}%`;
      cropBoxOverlayRef.current.style.width = '0%';
      cropBoxOverlayRef.current.style.height = '0%';
    }
    if (cropBadgeRef.current) {
      cropBadgeRef.current.textContent = '0% × 0%';
    }
  };

  // Direct Crop Selection Move
  const handleCropMouseMove = (e: React.MouseEvent) => {
    if (!isDrawingCropRef.current || !lightboxImgRef.current) return;
    const rect = lightboxImgRef.current.getBoundingClientRect();

    const curX = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const curY = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));

    const boxX = Math.min(cropStartRef.current.xPct, curX);
    const boxY = Math.min(cropStartRef.current.yPct, curY);
    const boxW = Math.abs(curX - cropStartRef.current.xPct);
    const boxH = Math.abs(curY - cropStartRef.current.yPct);

    activeCropBoxRef.current = {
      x: Number(boxX.toFixed(2)),
      y: Number(boxY.toFixed(2)),
      width: Number(boxW.toFixed(2)),
      height: Number(boxH.toFixed(2))
    };

    if (cropBoxOverlayRef.current) {
      cropBoxOverlayRef.current.style.left = `${boxX}%`;
      cropBoxOverlayRef.current.style.top = `${boxY}%`;
      cropBoxOverlayRef.current.style.width = `${boxW}%`;
      cropBoxOverlayRef.current.style.height = `${boxH}%`;
    }
    if (cropBadgeRef.current) {
      cropBadgeRef.current.textContent = `${Math.round(boxW)}% × ${Math.round(boxH)}%`;
    }
  };

  // Direct Crop Selection Up
  const handleCropMouseUp = async () => {
    if (!isDrawingCropRef.current) return;
    isDrawingCropRef.current = false;

    if (cropBoxOverlayRef.current) {
      cropBoxOverlayRef.current.style.display = 'none';
    }

    const box = activeCropBoxRef.current;
    if (!box || box.width < 1.5 || box.height < 1.5) {
      activeCropBoxRef.current = null;
      return;
    }

    try {
      const croppedUrl = await cropImageRegion(activePage.imageUrl, box);

      // Auto-sequence target field starting from initialTargetField if available
      const startField = initialTargetField || 'question';
      const seqFields: FigureTargetField[] = ['question', 'option1', 'option2', 'option3', 'option4', 'solution'];
      const startIdx = seqFields.indexOf(startField) !== -1 ? seqFields.indexOf(startField) : 0;
      const nextField = seqFields[(startIdx + stagedCrops.length) % seqFields.length];

      const newItem: StagedCropItem = {
        id: `crop_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        box,
        dataUrl: croppedUrl,
        targetField: nextField
      };

      setStagedCrops(prev => [...prev, newItem]);
      activeCropBoxRef.current = null;
    } catch (err) {
      console.error('Failed to crop figure region:', err);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    const delta = e.deltaY < 0 ? 0.25 : -0.25;
    setZoomLevel(prev => Math.max(0.5, Math.min(5, Number((prev + delta).toFixed(2)))));
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (toolMode === 'crop') return;
    e.stopPropagation();
    if (zoomLevel === 1) {
      setZoomLevel(2.5);
    } else {
      setZoomLevel(1);
      panRef.current = { x: 0, y: 0 };
    }
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isInput = targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select';

      if (!isInput && e.code === 'Space') {
        e.preventDefault();
        isSpacePressedRef.current = true;
        return;
      }
      if (!isInput && (e.key === 'c' || e.key === 'C')) {
        setToolMode('crop');
        return;
      }
      if (!isInput && (e.key === 'h' || e.key === 'H' || e.key === 'v' || e.key === 'V')) {
        setToolMode('pan');
        return;
      }

      if (e.key === 'Escape') {
        if (stagedCrops.length > 0) {
          setStagedCrops([]);
          return;
        }
        onClose();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        if (canPrev) handlePageSwitch(pageIndex - 1);
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        if (canNext) handlePageSwitch(pageIndex + 1);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoomLevel(prev => Math.min(5, Number((prev + 0.5).toFixed(2))));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setZoomLevel(prev => Math.max(0.5, Number((prev - 0.5).toFixed(2))));
      } else if (e.key === '0') {
        e.preventDefault();
        setZoomLevel(1);
        panRef.current = { x: 0, y: 0 };
        if (imageContainerRef.current) {
          imageContainerRef.current.style.transform = `translate3d(0px, 0px, 0) scale(1)`;
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressedRef.current = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [pageIndex, canPrev, canNext, stagedCrops.length, onClose, handlePageSwitch]);

  const handleRemoveStagedCrop = (cropId: string) => {
    setStagedCrops(prev => prev.filter(c => c.id !== cropId));
  };

  const handleUpdateStagedCropField = (cropId: string, newField: FigureTargetField) => {
    setStagedCrops(prev => prev.map(c => c.id === cropId ? { ...c, targetField: newField } : c));
  };

  const handleAutoSequenceStagedCrops = () => {
    const seq: FigureTargetField[] = ['question', 'option1', 'option2', 'option3', 'option4', 'solution'];
    setStagedCrops(prev => prev.map((c, i) => ({
      ...c,
      targetField: seq[i % seq.length]
    })));
  };

  // Upload Figures with ImgBB Primary & Server Fallback
  const handleSaveAndAttachAllFigures = async () => {
    if (stagedCrops.length === 0 || !selectedTargetQuestionId) return;
    setIsUploadingFigure(true);
    try {
      const targetQuestion = extractedMcqs.find(q => q.id === selectedTargetQuestionId);
      const qNum = targetQuestion ? targetQuestion.question_r : '';
      const currentApiKey = getStoredImgbbApiKey();

      // Parallel uploads
      const uploadPromises = stagedCrops.map(async (crop) => {
        const res = await uploadFigureImage({
          imageData: crop.dataUrl,
          questionNumber: qNum,
          targetField: crop.targetField,
          setName,
          useCloud: useCloudForFigures,
          imgbbApiKey: currentApiKey
        });
        return {
          cropId: crop.id,
          targetField: crop.targetField,
          url: res.url,
          storageProvider: res.storageProvider || (res.isCloud ? 'imgbb' : 'local')
        };
      });

      const uploadedResults = await Promise.all(uploadPromises);

      if (targetQuestion) {
        const updated = { ...targetQuestion };
        const attachedUrls: string[] = [];

        for (const res of uploadedResults) {
          const imgUrl = res.url;
          attachedUrls.push(imgUrl);
          const optLetter = res.targetField.startsWith('option')
            ? String.fromCharCode(64 + parseInt(res.targetField.replace('option', ''), 10))
            : undefined;
          const imgTag = res.targetField.startsWith('option')
            ? buildOptionFigureTag(imgUrl, optLetter)
            : buildQuestionFigureTag(imgUrl, `${qNum} ${res.targetField}`);

          if (res.targetField === 'question') {
            updated.question_hi = updated.question_hi ? `${updated.question_hi}\n${imgTag}` : imgTag;
            updated.question_en = updated.question_en ? `${updated.question_en}\n${imgTag}` : imgTag;
          } else if (res.targetField === 'solution') {
            updated.solution_hi = updated.solution_hi ? `${updated.solution_hi}\n${imgTag}` : imgTag;
            updated.solution_en = updated.solution_en ? `${updated.solution_en}\n${imgTag}` : imgTag;
          } else if (res.targetField === 'option1') {
            updated.option1_hi = imgTag;
            updated.option1_en = imgTag;
          } else if (res.targetField === 'option2') {
            updated.option2_hi = imgTag;
            updated.option2_en = imgTag;
          } else if (res.targetField === 'option3') {
            updated.option3_hi = imgTag;
            updated.option3_en = imgTag;
          } else if (res.targetField === 'option4') {
            updated.option4_hi = imgTag;
            updated.option4_en = imgTag;
          } else if (res.targetField === 'option5') {
            updated.option5_hi = imgTag;
            updated.option5_en = imgTag;
          }
        }

        const existingHash = updated.hash_figure ? updated.hash_figure.split(',').map(s => s.trim()) : [];
        const combined = Array.from(new Set([...existingHash, ...attachedUrls])).filter(Boolean).join(', ');
        updated.hash_figure = combined;
        updated.figure_notes = `Attached ${uploadedResults.length} figure(s) (${uploadedResults.map(r => `${r.targetField}@${r.storageProvider}`).join(', ')})`;

        onUpdateQuestion(selectedTargetQuestionId, updated);
      }

      setFigureSuccessToast(`✓ Successfully attached ${uploadedResults.length} figure(s) to Q.${qNum}!`);
      setTimeout(() => setFigureSuccessToast(null), 4000);

      // Reset staged crops and close modal
      setStagedCrops([]);
      onClose();
    } catch (err: any) {
      alert(`Failed to save figures: ${err?.message || err}`);
    } finally {
      setIsUploadingFigure(false);
    }
  };

  const handleSaveCustomKey = () => {
    setStoredImgbbApiKey(customKeyInput);
    setKeySavedNotice(true);
    setTimeout(() => {
      setKeySavedNotice(false);
      setShowKeyInput(false);
    }, 1500);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col select-none overflow-hidden animate-fade-in"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onContextMenu={(e) => e.preventDefault()}
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
            (Right-Click or Space to Drag Move • Scroll to Zoom up to 500%)
          </span>
        </div>

        {/* Zoom Controls Bar */}
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
            onClick={() => {
              setZoomLevel(1);
              panRef.current = { x: 0, y: 0 };
              if (imageContainerRef.current) {
                imageContainerRef.current.style.transform = `translate3d(0px, 0px, 0) scale(1)`;
              }
            }}
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
            onClick={() => {
              setZoomLevel(1);
              panRef.current = { x: 0, y: 0 };
              if (imageContainerRef.current) {
                imageContainerRef.current.style.transform = `translate3d(0px, 0px, 0) scale(1)`;
              }
            }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.1] transition-all"
            title="Reset Zoom and Center (Hotkey: 0)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Tool Mode Switcher & Close Controls */}
        <div className="flex items-center gap-2">
          {/* Pan / Move Tool */}
          <button
            type="button"
            onClick={() => setToolMode('pan')}
            className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all ${
              toolMode === 'pan'
                ? 'bg-amber-500 text-black border-amber-400 shadow-md shadow-amber-500/30'
                : 'bg-white/[0.06] hover:bg-white/[0.12] border-white/[0.15] text-slate-200'
            }`}
            title="Pan / Move Mode (Hotkeys: Space or H / Right-click drag)"
          >
            <Hand className="w-3.5 h-3.5" />
            <span>Move</span>
          </button>

          {/* Multi-Crop Tool */}
          <button
            type="button"
            onClick={() => setToolMode('crop')}
            className={`px-3 py-1.5 rounded-xl border text-xs font-black flex items-center gap-1.5 transition-all shadow-md ${
              toolMode === 'crop'
                ? 'bg-gradient-to-r from-[#FF6B2B] to-[#FF884D] border-orange-400 text-white ring-2 ring-orange-500/40 shadow-orange-500/20'
                : 'bg-white/[0.06] hover:bg-white/[0.12] border-white/[0.15] text-slate-200'
            }`}
            title="Multi-Crop Mode (Hotkey: C) - Draw multiple crops on page and save all in 1-Click"
          >
            <Scissors className="w-3.5 h-3.5 text-amber-300" />
            <span>✂ Multi-Crop {stagedCrops.length > 0 ? `(${stagedCrops.length})` : ''}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
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
          toolMode === 'pan' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'
        }`}
        onMouseDown={handleMouseDown}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Cropping Mode Hint Pill */}
        {toolMode === 'crop' && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 rounded-full bg-black/85 border border-[#FF6B2B]/60 text-orange-200 text-xs font-semibold shadow-2xl backdrop-blur flex items-center gap-2 pointer-events-none">
            <span className="w-2 h-2 rounded-full bg-[#FF6B2B] animate-ping" />
            <span>
              Click & drag across figures to multi-crop • <b>Right-click or Space</b> to drag move • Staged: <b className="text-amber-300">{stagedCrops.length}</b>
            </span>
          </div>
        )}

        {/* Toast Notification */}
        {figureSuccessToast && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-2xl bg-emerald-600 text-white text-xs font-black shadow-2xl flex items-center gap-2 animate-in fade-in zoom-in duration-150">
            <CheckCheck className="w-4 h-4" />
            <span>{figureSuccessToast}</span>
          </div>
        )}

        {/* Floating Previous Page Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (canPrev) handlePageSwitch(pageIndex - 1);
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
            if (canNext) handlePageSwitch(pageIndex + 1);
          }}
          disabled={!canNext}
          className="absolute right-4 top-1/2 -translate-y-1/2 z-30 p-3 rounded-2xl bg-black/80 hover:bg-amber-500 border border-white/[0.15] text-white hover:text-black shadow-2xl transition-all disabled:opacity-20 disabled:pointer-events-none group"
          title="Next Page (Hotkey: Right Arrow →)"
        >
          <ChevronRight className="w-6 h-6 group-hover:translate-x-0.5 transition-transform" />
        </button>

        {/* Zoomable & Draggable Page Image Container (Zero-lag Direct Transform) */}
        <div
          ref={imageContainerRef}
          className="select-none relative inline-block will-change-transform"
          style={{
            transform: `translate3d(${panRef.current.x}px, ${panRef.current.y}px, 0) scale(${zoomLevel})`,
            transformOrigin: 'center center'
          }}
        >
          <img
            ref={lightboxImgRef}
            src={activePage.imageUrl}
            alt={`Page ${activePage.pageNumber} High-Res`}
            draggable={false}
            className={`max-w-[85vw] max-h-[82vh] object-contain rounded-lg shadow-2xl border border-white/[0.1] ${
              toolMode === 'crop' ? 'cursor-crosshair' : 'pointer-events-none'
            }`}
          />

          {/* Staged Crops Overlays on the Page with Badges and Remove Buttons */}
          {stagedCrops.map((crop, idx) => {
            const badgeLabel = crop.targetField === 'question'
              ? 'Q'
              : crop.targetField === 'solution'
              ? 'Sol'
              : crop.targetField.replace('option', 'Opt ');

            return (
              <div
                key={crop.id}
                className="absolute border-2 border-emerald-400 bg-emerald-500/20 shadow-[0_0_10px_rgba(52,211,153,0.5)] rounded z-25 group"
                style={{
                  left: `${crop.box.x}%`,
                  top: `${crop.box.y}%`,
                  width: `${crop.box.width}%`,
                  height: `${crop.box.height}%`,
                }}
              >
                <div className="absolute -top-6 left-0 flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-950/95 text-emerald-200 font-mono text-[10px] font-black whitespace-nowrap shadow border border-emerald-400/60 pointer-events-auto">
                  <span>#{idx + 1} [{badgeLabel}]</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveStagedCrop(crop.id);
                    }}
                    className="ml-1 text-slate-300 hover:text-white hover:bg-red-500/80 rounded px-1 transition-colors"
                    title="Remove this crop"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}

          {/* Direct DOM Active Drawing Cropping Selection Box Overlay (0 React Re-renders!) */}
          <div
            ref={cropBoxOverlayRef}
            className="absolute border-2 border-[#FF6B2B] bg-[#FF6B2B]/20 shadow-[0_0_12px_rgba(255,107,43,0.7)] pointer-events-none rounded z-30"
            style={{ display: 'none', left: '0%', top: '0%', width: '0%', height: '0%' }}
          >
            <div
              ref={cropBadgeRef}
              className="absolute -top-6 left-0 px-1.5 py-0.5 rounded bg-black/90 text-white font-mono text-[10px] font-bold whitespace-nowrap shadow border border-[#FF6B2B]/60"
            >
              0% × 0%
            </div>
          </div>
        </div>

        {/* Floating Multi-Crop Batch Panel */}
        {stagedCrops.length > 0 && (
          <div
            className="absolute right-6 top-6 z-40 w-96 bg-slate-900/95 border border-white/20 rounded-2xl p-4 shadow-2xl backdrop-blur-xl flex flex-col gap-3 text-white animate-in slide-in-from-right-4 duration-200 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-[#FF6B2B]/20 text-[#FF6B2B]">
                  <Scissors className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wide text-white">
                    Multi-Crop Staged ({stagedCrops.length})
                  </h4>
                  <p className="text-[10px] text-slate-400">Save all cropped diagrams in 1-Click</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setStagedCrops([])}
                className="p-1 text-slate-400 hover:text-rose-400 text-[11px] font-bold flex items-center gap-1 hover:bg-white/5 rounded-lg px-2"
                title="Clear all staged crops"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear All</span>
              </button>
            </div>

            {/* Target Question Picker */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-slate-300">Target Question for All Crops:</label>
              <select
                value={selectedTargetQuestionId}
                onChange={(e) => setSelectedTargetQuestionId(e.target.value)}
                className="bg-black/60 border border-white/15 rounded-xl px-2.5 py-1.5 text-xs text-white outline-none focus:border-[#FF6B2B]"
              >
                {extractedMcqs.length === 0 ? (
                  <option value="">No questions extracted yet</option>
                ) : (
                  extractedMcqs.map((q) => (
                    <option key={q.id} value={q.id} className="bg-slate-900 text-white">
                      Q.{q.question_r || '?'} (Page {q.pageNumber || '?'}) - {q.question_hi ? q.question_hi.replace(/<[^>]*>/g, '').substring(0, 32) : 'Question'}...
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Auto-Order Sequence Button */}
            <div className="flex items-center justify-between bg-white/[0.04] p-1.5 rounded-xl border border-white/10">
              <span className="text-[10px] text-slate-400">Need standard sequence?</span>
              <button
                type="button"
                onClick={handleAutoSequenceStagedCrops}
                className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold text-[10px] flex items-center gap-1 border border-amber-500/30 transition-all"
                title="Auto-assign: 1st=Q, 2nd=Opt A, 3rd=Opt B, 4th=Opt C, 5th=Opt D, 6th=Sol"
              >
                <Sparkles className="w-3 h-3" />
                <span>Auto-Order (Q ➔ A ➔ B ➔ C ➔ D)</span>
              </button>
            </div>

            {/* Staged Crops List */}
            <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
              {stagedCrops.map((crop, idx) => (
                <div
                  key={crop.id}
                  className="flex items-center gap-2 p-2 rounded-xl bg-black/40 border border-white/10"
                >
                  {/* Number Badge & Thumbnail */}
                  <div className="relative shrink-0 w-12 h-12 bg-white rounded-lg flex items-center justify-center overflow-hidden border border-white/20">
                    <img
                      src={crop.dataUrl}
                      alt={`Crop ${idx + 1}`}
                      className="max-h-full max-w-full object-contain"
                    />
                    <span className="absolute bottom-0 right-0 px-1 rounded-tl bg-black/80 text-[9px] font-mono text-white font-extrabold">
                      #{idx + 1}
                    </span>
                  </div>

                  {/* Target Field Selector Pills */}
                  <div className="flex-1 flex flex-col gap-1">
                    <span className="text-[10px] text-slate-400 font-medium">Assign To:</span>
                    <div className="flex flex-wrap gap-1">
                      {[
                        { id: 'question', label: 'Q' },
                        { id: 'option1', label: 'A' },
                        { id: 'option2', label: 'B' },
                        { id: 'option3', label: 'C' },
                        { id: 'option4', label: 'D' },
                        { id: 'solution', label: 'Sol' }
                      ].map((tgt) => (
                        <button
                          key={tgt.id}
                          type="button"
                          onClick={() => handleUpdateStagedCropField(crop.id, tgt.id as FigureTargetField)}
                          className={`px-2 py-0.5 rounded text-[10px] font-black transition-all ${
                            crop.targetField === tgt.id
                              ? 'bg-[#FF6B2B] text-white shadow-sm'
                              : 'bg-white/5 hover:bg-white/10 text-slate-300'
                          }`}
                        >
                          {tgt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Remove this crop button */}
                  <button
                    type="button"
                    onClick={() => handleRemoveStagedCrop(crop.id)}
                    className="p-1 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Remove crop"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Storage Option Badge & ImgBB Key Settings */}
            <div className="flex flex-col gap-1.5 bg-black/40 p-2.5 rounded-xl border border-white/10 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Storage Backend:</span>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 font-bold text-xs flex items-center gap-1">
                    <Cloud className="w-3.5 h-3.5" /> ImgBB Cloud (Primary)
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowKeyInput(v => !v)}
                    className="p-1 rounded bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white"
                    title="ImgBB API Key Settings"
                  >
                    <Key className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Collapsible ImgBB Key Customization */}
              {showKeyInput && (
                <div className="mt-1 pt-1.5 border-t border-white/10 flex flex-col gap-1">
                  <span className="text-[10px] text-slate-400">ImgBB API Key (https://api.imgbb.com/):</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={customKeyInput}
                      onChange={e => setCustomKeyInput(e.target.value)}
                      placeholder="892c1e1f1ac46345ab6252ee885858cd"
                      className="flex-1 bg-black/60 border border-white/20 rounded px-2 py-1 text-[11px] text-white font-mono outline-none focus:border-amber-400"
                    />
                    <button
                      type="button"
                      onClick={handleSaveCustomKey}
                      className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] flex items-center gap-1"
                    >
                      {keySavedNotice ? <Check className="w-3 h-3 text-white" /> : 'Save'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1 border-t border-white/10">
              <button
                type="button"
                onClick={() => setStagedCrops([])}
                className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveAndAttachAllFigures}
                disabled={isUploadingFigure || !selectedTargetQuestionId}
                className="flex-1 px-4 py-2 rounded-xl bg-gradient-to-r from-[#FF6B2B] to-[#FF884D] hover:shadow-lg hover:shadow-orange-500/25 text-white text-xs font-black flex items-center justify-center gap-1.5 transition-all disabled:opacity-40"
              >
                {isUploadingFigure ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving All ({stagedCrops.length})...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>🚀 Save & Attach All ({stagedCrops.length}) Figures</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Bottom Quick Page Thumbnails Strip */}
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-slate-950/90 border border-white/[0.15] shadow-2xl backdrop-blur-md max-w-[90vw] overflow-x-auto no-scrollbar"
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              if (canPrev) handlePageSwitch(pageIndex - 1);
            }}
            disabled={!canPrev}
            className="px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-bold text-slate-300 disabled:opacity-30 flex items-center gap-1"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Prev</span>
          </button>

          {pages.map((p, idx) => (
            <button
              key={p.id}
              type="button"
              onClick={() => handlePageSwitch(idx)}
              className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 ${
                idx === pageIndex
                  ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/30'
                  : 'bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 hover:text-white'
              }`}
            >
              <span>P.{p.pageNumber}</span>
              {(p.items && p.items.length > 0) && (
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                    idx === pageIndex ? 'bg-black/20 text-black' : 'bg-emerald-500/20 text-emerald-300'
                  }`}
                >
                  {p.items.length}
                </span>
              )}
            </button>
          ))}

          <button
            type="button"
            onClick={() => {
              if (canNext) handlePageSwitch(pageIndex + 1);
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
};
