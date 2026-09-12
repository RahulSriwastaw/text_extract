import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, Download, Sparkles, RefreshCw, FileSpreadsheet, 
  FileText, Trash2, ArrowDownUp, Check, AlertCircle, 
  ChevronRight, ChevronLeft, Scissors, Eye, Undo2, ArrowLeftRight, 
  Layers, Plus, CheckCircle2, Split, ZoomIn, ZoomOut,
  Maximize2, RotateCw, CheckSquare, Square, Copy, RefreshCcw,
  GripVertical, ChevronUp, ChevronDown, Search, ArrowLeft, ArrowRight, X,
  ChevronsLeft, ChevronsRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { convertPdfToImages } from '../services/pdfUtils';
import { 
  PageCard, 
  PageCardItem,
  CropBox,
  renderMergedCardToA4, 
  exportMergedCardsToPdf,
  cropImageByPercentage,
  ensureCardItems
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
  
  // All Raw PDF Pages for quick switching in Crop Modal & Add Page Modal
  const [allPdfPages, setAllPdfPages] = useState<{ pageNum: number; image: string }[]>([]);

  // Global Page Search Query in header
  const [pageSearchQuery, setPageSearchQuery] = useState<string>('');

  // Pagination & Responsive Windowing for Large 200+ Page PDFs
  const [pageSize, setPageSize] = useState<number>(24);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [jumpCardInput, setJumpCardInput] = useState<string>('');

  // Add Page to Card Modal State & Pagination
  const [activeAddModalCardId, setActiveAddModalCardId] = useState<string | null>(null);
  const [searchModalPageQuery, setSearchModalPageQuery] = useState<string>('');
  const [directPageNumberInput, setDirectPageNumberInput] = useState<string>('');
  const [addModalPage, setAddModalPage] = useState<number>(1);
  const ADD_MODAL_PAGE_SIZE = 24;

  // Card Reorder Drag State
  const [reorderDragCardId, setReorderDragCardId] = useState<string | null>(null);
  const [reorderDropTargetId, setReorderDropTargetId] = useState<string | null>(null);

  // Move to position dialog
  const [positionDialogCardId, setPositionDialogCardId] = useState<string | null>(null);
  const [targetPositionInput, setTargetPositionInput] = useState<string>('');

  // Drag & Drop State for Merging
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [dragOverTargetId, setDragOverTargetId] = useState<string | null>(null);

  // Manual Merge Picker
  const [manualMergeSourceId, setManualMergeSourceId] = useState<string | null>(null);

  // Visual Cropper Modal State
  const [cropTarget, setCropTarget] = useState<{ cardId: string; itemIndex: number; type?: 'question' | 'solution' } | null>(null);
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
        const items = ensureCardItems(card);
        const item = items[cropTarget.itemIndex] || items[0];
        if (item) {
          setActiveCropBox(item.crop || { x: 0, y: 0, width: 100, height: 100 });
          setActiveScale(item.scale || 1.0);
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

      const rawPages = images.map((img, idx) => ({ pageNum: idx + 1, image: img }));
      setAllPdfPages(rawPages);

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
      setCurrentPage(1);
      setPageSize(images.length > 30 ? 24 : images.length);
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
    setReorderDragCardId(null);
    setDragOverTargetId(null);
    setReorderDropTargetId(null);
  };

  const syncCardFromItems = (card: PageCard, items: PageCardItem[]): PageCard => {
    const item0 = items[0];
    const item1 = items[1];
    return {
      ...card,
      items,
      isMerged: items.length > 1,
      originalPageNum: item0 ? item0.pageNum : card.originalPageNum,
      questionImage: item0 ? item0.image : card.questionImage,
      croppedQuestionImage: item0?.croppedImage,
      qCrop: item0?.crop,
      qScale: item0?.scale || 1.0,
      solutionPageNum: item1?.pageNum,
      solutionImage: item1?.image,
      croppedSolutionImage: item1?.croppedImage,
      solCrop: item1?.crop,
      solScale: item1?.scale || 1.0,
    };
  };

  const executeMerge = (sourceId: string, targetId: string) => {
    const sourceCard = cards.find(c => c.id === sourceId);
    const targetCard = cards.find(c => c.id === targetId);

    if (!sourceCard || !targetCard) return;

    setCards(prev => {
      const sourceItems = ensureCardItems(sourceCard);
      const targetItems = ensureCardItems(targetCard);
      const combinedItems = [...targetItems, ...sourceItems];

      const updated = prev.map(c => {
        if (c.id === targetId) {
          return syncCardFromItems(c, combinedItems);
        }
        return c;
      });

      return updated.filter(c => c.id !== sourceId);
    });

    setManualMergeSourceId(null);
  };

  const handleUnmerge = (cardId: string) => {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;

    const items = ensureCardItems(card);
    if (items.length <= 1) return;

    const newCards: PageCard[] = items.map((item, idx) => ({
      id: `card-split-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 4)}`,
      originalPageNum: item.pageNum,
      questionImage: item.image,
      croppedQuestionImage: item.croppedImage,
      isMerged: false,
      isSelected: true,
      qCrop: item.crop,
      qScale: item.scale || 1.0,
      showDivider: true,
      items: [item],
    }));

    setCards(prev => {
      const cardIdx = prev.findIndex(c => c.id === cardId);
      if (cardIdx === -1) return prev;
      const copy = [...prev];
      copy.splice(cardIdx, 1, ...newCards);
      return copy;
    });
  };

  const handleSwap = (cardId: string) => {
    setCards(prev => prev.map(c => {
      if (c.id === cardId) {
        const items = [...ensureCardItems(c)];
        if (items.length >= 2) {
          const temp = items[0];
          items[0] = items[1];
          items[1] = temp;
          return syncCardFromItems(c, items);
        }
      }
      return c;
    }));
  };

  // Duplicate Card Handler
  const handleDuplicate = (cardId: string) => {
    const idx = cards.findIndex(c => c.id === cardId);
    if (idx === -1) return;
    const original = cards[idx];
    const originalItems = ensureCardItems(original);

    const duplicateCard: PageCard = {
      ...original,
      id: `card-copy-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      items: originalItems.map(it => ({ ...it, id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 5)}` })),
    };

    const nextCards = [...cards];
    nextCards.splice(idx + 1, 0, duplicateCard);
    setCards(nextCards);
  };

  const handleDelete = (cardId: string) => {
    setCards(prev => prev.filter(c => c.id !== cardId));
  };

  // Add a specific Page Number into a Card
  const handleAddPageToCard = (cardId: string, pageNum: number) => {
    if (pageNum < 1 || pageNum > allPdfPages.length) {
      alert(`Invalid page number. Please enter between 1 and ${allPdfPages.length}.`);
      return;
    }
    const pageData = allPdfPages[pageNum - 1];
    if (!pageData) return;

    setCards(prev => prev.map(c => {
      if (c.id === cardId) {
        const items = ensureCardItems(c);
        const newItemIndex = items.length;
        const newItem: PageCardItem = {
          id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          pageNum: pageNum,
          image: pageData.image,
          scale: 1.0,
          label: newItemIndex === 0 ? 'Question' : newItemIndex === 1 ? 'Solution' : `Part ${newItemIndex + 1} (P.${pageNum})`,
        };
        const nextItems = [...items, newItem];
        return syncCardFromItems(c, nextItems);
      }
      return c;
    }));
  };

  // Remove individual snippet/page from card
  const handleRemoveItemFromCard = (cardId: string, itemIndex: number) => {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;
    const items = ensureCardItems(card);
    if (items.length <= 1) {
      handleDelete(cardId);
      return;
    }

    const removedItem = items[itemIndex];
    const remainingItems = items.filter((_, idx) => idx !== itemIndex);

    const restoredCard: PageCard = {
      id: `card-detached-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      originalPageNum: removedItem.pageNum,
      questionImage: removedItem.image,
      croppedQuestionImage: removedItem.croppedImage,
      isMerged: false,
      isSelected: true,
      qCrop: removedItem.crop,
      qScale: removedItem.scale || 1.0,
      showDivider: true,
      items: [removedItem],
    };

    setCards(prev => {
      const updated = prev.map(c => {
        if (c.id === cardId) {
          return syncCardFromItems(c, remainingItems);
        }
        return c;
      });
      const cardIdx = updated.findIndex(c => c.id === cardId);
      const nextList = [...updated];
      nextList.splice(cardIdx + 1, 0, restoredCard);
      return nextList;
    });
  };

  // Move snippet up/down inside a card
  const handleMoveItemInsideCard = (cardId: string, fromIndex: number, direction: 'up' | 'down') => {
    setCards(prev => prev.map(c => {
      if (c.id === cardId) {
        const items = [...ensureCardItems(c)];
        const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
        if (toIndex < 0 || toIndex >= items.length) return c;
        const temp = items[fromIndex];
        items[fromIndex] = items[toIndex];
        items[toIndex] = temp;
        return syncCardFromItems(c, items);
      }
      return c;
    }));
  };

  // Move Whole Card Left/Right in Document Grid
  const handleMoveCard = (cardId: string, direction: 'prev' | 'next' | 'left' | 'right') => {
    setCards(prev => {
      const idx = prev.findIndex(c => c.id === cardId);
      if (idx === -1) return prev;
      const targetIdx = (direction === 'prev' || direction === 'left') ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const copy = [...prev];
      const temp = copy[idx];
      copy[idx] = copy[targetIdx];
      copy[targetIdx] = temp;
      return copy;
    });
  };

  // Move Card to a specific position number
  const handleMoveCardToPosition = (cardId: string, targetPos1Indexed: number) => {
    setCards(prev => {
      const idx = prev.findIndex(c => c.id === cardId);
      if (idx === -1) return prev;
      const targetIdx = Math.max(0, Math.min(prev.length - 1, targetPos1Indexed - 1));
      if (targetIdx === idx) return prev;
      const copy = [...prev];
      const [removed] = copy.splice(idx, 1);
      copy.splice(targetIdx, 0, removed);
      return copy;
    });
    setPositionDialogCardId(null);
  };

  // Drag-and-drop handlers for Reordering & Merging
  const handleReorderDragStart = (e: React.DragEvent, cardId: string) => {
    e.stopPropagation();
    setReorderDragCardId(cardId);
    e.dataTransfer.setData('text/card-reorder', cardId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleCardDragOver = (e: React.DragEvent, targetCardId: string) => {
    e.preventDefault();
    if (reorderDragCardId && reorderDragCardId !== targetCardId) {
      setReorderDropTargetId(targetCardId);
      e.dataTransfer.dropEffect = 'move';
      return;
    }
    if (draggedCardId && draggedCardId !== targetCardId) {
      setDragOverTargetId(targetCardId);
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleCardDrop = (e: React.DragEvent, targetCardId: string) => {
    e.preventDefault();
    const reorderSource = e.dataTransfer.getData('text/card-reorder') || reorderDragCardId;
    if (reorderSource && reorderSource !== targetCardId) {
      setReorderDragCardId(null);
      setReorderDropTargetId(null);
      setCards(prev => {
        const fromIdx = prev.findIndex(c => c.id === reorderSource);
        const toIdx = prev.findIndex(c => c.id === targetCardId);
        if (fromIdx === -1 || toIdx === -1) return prev;
        const copy = [...prev];
        const [moved] = copy.splice(fromIdx, 1);
        copy.splice(toIdx, 0, moved);
        return copy;
      });
      return;
    }

    // Merge drop
    const sourceId = e.dataTransfer.getData('text/plain') || draggedCardId;
    setDragOverTargetId(null);
    setDraggedCardId(null);
    setReorderDragCardId(null);
    setReorderDropTargetId(null);

    if (!sourceId || sourceId === targetCardId) return;
    executeMerge(sourceId, targetCardId);
  };

  // -------------------------------------------------------------
  // Interactive Visual Crop Mouse Handlers & Navigation
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

  // Helper to build list of all croppable page targets across cards in order
  const getFlatTargets = (cardList: PageCard[]) => {
    return cardList.flatMap(card => {
      const items = ensureCardItems(card);
      return items.map((item, itemIdx) => ({
        cardId: card.id,
        itemIndex: itemIdx,
        label: item.label || (items.length === 1 ? `Page ${item.pageNum}` : itemIdx === 0 ? `Question (P.${item.pageNum})` : itemIdx === 1 ? `Solution (P.${item.pageNum})` : `Part ${itemIdx + 1} (P.${item.pageNum})`),
        pageNum: item.pageNum,
      }));
    });
  };

  const saveCropForTarget = async (
    target: { cardId: string; itemIndex: number },
    box: CropBox,
    scale: number
  ) => {
    const card = cards.find(c => c.id === target.cardId);
    if (!card) return;

    try {
      const isFull = box.width >= 99.5 && box.height >= 99.5 && box.x <= 0.5 && box.y <= 0.5;
      const items = ensureCardItems(card);
      const activeItem = items[target.itemIndex] || items[0];
      if (!activeItem) return;

      let croppedBase64: string | undefined = undefined;
      if (!isFull && box.width > 2 && box.height > 2) {
        croppedBase64 = await cropImageByPercentage(activeItem.image, box);
      }

      const updatedItems = items.map((it, idx) => {
        if (idx === target.itemIndex) {
          return {
            ...it,
            croppedImage: croppedBase64,
            crop: isFull ? undefined : box,
            scale,
          };
        }
        return it;
      });

      setCards(prev => prev.map(c => {
        if (c.id === target.cardId) {
          return syncCardFromItems(c, updatedItems);
        }
        return c;
      }));
    } catch (err: any) {
      console.warn('Failed to crop:', err);
    }
  };

  const handleApplyCrop = async () => {
    if (!cropTarget || !currentCroppingCard) return;
    await saveCropForTarget(cropTarget, activeCropBox, activeScale);
    setCropTarget(null);
  };

  const handleNavigateCrop = async (direction: 'prev' | 'next') => {
    if (!cropTarget) return;

    // Auto-save current crop before moving
    await saveCropForTarget(cropTarget, activeCropBox, activeScale);

    const targets = getFlatTargets(cards);
    const targetIndex = targets.findIndex(
      t => t.cardId === cropTarget.cardId && t.itemIndex === cropTarget.itemIndex
    );
    if (targetIndex === -1) return;

    const nextIndex = direction === 'next' ? targetIndex + 1 : targetIndex - 1;
    if (nextIndex >= 0 && nextIndex < targets.length) {
      const nextT = targets[nextIndex];
      setCropTarget({ cardId: nextT.cardId, itemIndex: nextT.itemIndex });
    }
  };

  const handleChangeSourcePage = (newPageNum: number) => {
    if (!cropTarget || !currentCroppingCard || allPdfPages.length === 0) return;
    if (newPageNum < 1 || newPageNum > allPdfPages.length) return;

    const targetPage = allPdfPages[newPageNum - 1];
    if (!targetPage) return;

    setCards(prev => prev.map(c => {
      if (c.id === cropTarget.cardId) {
        const items = ensureCardItems(c);
        const updatedItems = items.map((it, idx) => {
          if (idx === cropTarget.itemIndex) {
            return {
              ...it,
              pageNum: newPageNum,
              image: targetPage.image,
              croppedImage: undefined,
              crop: undefined,
              scale: 1.0,
              label: it.label ? it.label.replace(/\(P\.\d+\)/, `(P.${newPageNum})`) : `Page ${newPageNum}`,
            };
          }
          return it;
        });
        return syncCardFromItems(c, updatedItems);
      }
      return c;
    }));

    setActiveCropBox({ x: 0, y: 0, width: 100, height: 100 });
    setActiveScale(1.0);
  };

  const handleResetCropOnCard = (cardId: string, itemIndex: number) => {
    setCards(prev => prev.map(c => {
      if (c.id === cardId) {
        const items = ensureCardItems(c);
        const updatedItems = items.map((it, idx) => {
          if (idx === itemIndex) {
            return { ...it, croppedImage: undefined, crop: undefined, scale: 1.0 };
          }
          return it;
        });
        return syncCardFromItems(c, updatedItems);
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

  const flatTargets = getFlatTargets(cards);
  const currentTargetIndex = cropTarget
    ? flatTargets.findIndex(t => t.cardId === cropTarget.cardId && t.itemIndex === cropTarget.itemIndex)
    : -1;
  const hasPrevPage = currentTargetIndex > 0;
  const hasNextPage = currentTargetIndex >= 0 && currentTargetIndex < flatTargets.length - 1;
  const prevTarget = hasPrevPage ? flatTargets[currentTargetIndex - 1] : null;
  const nextTarget = hasNextPage ? flatTargets[currentTargetIndex + 1] : null;

  const currentCroppingCard = cropTarget ? cards.find(c => c.id === cropTarget.cardId) : null;
  const currentCroppingItems = currentCroppingCard ? ensureCardItems(currentCroppingCard) : [];
  const currentItemIndex = cropTarget?.itemIndex ?? 0;
  const currentCroppingItem = currentCroppingItems[currentItemIndex] || currentCroppingItems[0];
  const currentDisplayedPageNum = currentCroppingItem ? currentCroppingItem.pageNum : 1;
  const currentCroppingImageSrc = currentCroppingItem 
    ? (currentCroppingItem.croppedImage || currentCroppingItem.image) 
    : '';

  // Filtered Cards based on pageSearchQuery
  const displayedCards = cards.filter(card => {
    if (!pageSearchQuery.trim()) return true;
    const q = pageSearchQuery.trim().toLowerCase();
    const items = ensureCardItems(card);
    return items.some(it => String(it.pageNum).includes(q) || (it.label && it.label.toLowerCase().includes(q)));
  });

  // Pagination for displayed cards (optimizes rendering for 200+ pages)
  const totalDisplayedCards = displayedCards.length;
  const totalPages = pageSize === -1 ? 1 : Math.max(1, Math.ceil(totalDisplayedCards / pageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const paginatedCards = pageSize === -1
    ? displayedCards
    : displayedCards.slice((safeCurrentPage - 1) * pageSize, safeCurrentPage * pageSize);

  const handleJumpToCardNumber = (targetNumStr: string) => {
    const num = parseInt(targetNumStr.trim(), 10);
    if (isNaN(num) || num < 1 || num > cards.length) {
      alert(`Please enter a valid card number between 1 and ${cards.length}`);
      return;
    }
    if (pageSize !== -1) {
      const targetPage = Math.ceil(num / pageSize);
      setCurrentPage(targetPage);
    }
    setTimeout(() => {
      const targetCard = cards[num - 1];
      if (targetCard) {
        const el = document.getElementById(`stitch-card-${targetCard.id}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 120);
  };

  const renderPaginationBar = (position: 'top' | 'bottom') => {
    if (cards.length === 0 || totalDisplayedCards <= 12) return null;

    const startIdx = pageSize === -1 ? 1 : (safeCurrentPage - 1) * pageSize + 1;
    const endIdx = pageSize === -1 ? totalDisplayedCards : Math.min(safeCurrentPage * pageSize, totalDisplayedCards);

    return (
      <div className={`flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-2xl bg-[#141824]/90 border border-white/[0.08] text-xs shadow-lg backdrop-blur-md ${position === 'top' ? 'mb-5' : 'mt-6'}`}>
        {/* Left: Card count summary */}
        <div className="flex items-center gap-2 font-medium text-slate-300">
          <span className="px-2 py-0.5 rounded-md bg-white/[0.06] text-amber-400 font-mono font-bold text-[11px]">
            {startIdx} – {endIdx}
          </span>
          <span>of <strong className="text-white">{totalDisplayedCards}</strong> cards</span>
          {cards.length !== totalDisplayedCards && (
            <span className="text-slate-500 text-[11px]">(Filtered from {cards.length})</span>
          )}
        </div>

        {/* Center: Pagination Controls */}
        {pageSize !== -1 && totalPages > 1 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCurrentPage(1)}
              disabled={safeCurrentPage <= 1}
              className="p-1.5 rounded-lg border border-white/[0.08] hover:bg-white/[0.1] text-slate-300 disabled:opacity-20 transition-all"
              title="First Page"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={safeCurrentPage <= 1}
              className="p-1.5 rounded-lg border border-white/[0.08] hover:bg-white/[0.1] text-slate-300 disabled:opacity-20 transition-all"
              title="Previous Page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-black/40 border border-white/[0.08] text-slate-300">
              <span className="text-slate-400 text-[11px]">Page</span>
              <input
                type="number"
                min={1}
                max={totalPages}
                value={safeCurrentPage}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val >= 1 && val <= totalPages) {
                    setCurrentPage(val);
                  }
                }}
                className="w-10 bg-transparent text-center font-bold text-white outline-none border-b border-[#FF6B2B]"
              />
              <span className="text-slate-400 text-[11px]">of {totalPages}</span>
            </div>

            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={safeCurrentPage >= totalPages}
              className="p-1.5 rounded-lg border border-white/[0.08] hover:bg-white/[0.1] text-slate-300 disabled:opacity-20 transition-all"
              title="Next Page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage(totalPages)}
              disabled={safeCurrentPage >= totalPages}
              className="p-1.5 rounded-lg border border-white/[0.08] hover:bg-white/[0.1] text-slate-300 disabled:opacity-20 transition-all"
              title="Last Page"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Right: Jump to card & Page size */}
        <div className="flex items-center gap-3">
          {/* Quick Jump Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleJumpToCardNumber(jumpCardInput);
              setJumpCardInput('');
            }}
            className="flex items-center gap-1"
          >
            <input
              type="number"
              placeholder="Jump to card #..."
              min={1}
              max={cards.length}
              value={jumpCardInput}
              onChange={(e) => setJumpCardInput(e.target.value)}
              className="w-28 px-2 py-1 rounded-lg bg-black/40 border border-white/[0.1] text-white text-[11px] placeholder-slate-500 outline-none focus:border-[#FF6B2B]"
            />
            <button
              type="submit"
              disabled={!jumpCardInput}
              className="px-2.5 py-1 bg-white/[0.08] hover:bg-[#FF6B2B] hover:text-white rounded-lg text-slate-300 text-[11px] font-bold transition-all disabled:opacity-30"
            >
              Go
            </button>
          </form>

          {/* Cards per view */}
          <div className="flex items-center gap-1 pl-2 border-l border-white/[0.08]">
            <span className="text-slate-400 text-[11px] hidden sm:inline">Show:</span>
            {[24, 48, 96, -1].map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => {
                  setPageSize(size);
                  setCurrentPage(1);
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${
                  pageSize === size
                    ? 'bg-[#FF6B2B] text-white shadow'
                    : 'bg-white/[0.04] text-slate-400 hover:text-white'
                }`}
              >
                {size === -1 ? 'All' : size}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // Keyboard arrow keys for crop navigation
  useEffect(() => {
    if (!cropTarget) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

      if (e.key === 'ArrowLeft' && hasPrevPage) {
        e.preventDefault();
        handleNavigateCrop('prev');
      } else if (e.key === 'ArrowRight' && hasNextPage) {
        e.preventDefault();
        handleNavigateCrop('next');
      } else if (e.key === 'Escape') {
        setCropTarget(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cropTarget, currentTargetIndex, flatTargets, hasPrevPage, hasNextPage, activeCropBox, activeScale]);

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
              {/* Global Page Search Input */}
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Find Page # (e.g. 63)..."
                  value={pageSearchQuery}
                  onChange={(e) => setPageSearchQuery(e.target.value)}
                  className="pl-8 pr-7 py-1.5 bg-white/[0.05] hover:bg-white/[0.08] focus:bg-black/60 border border-white/[0.1] focus:border-[#FF6B2B] rounded-xl text-xs text-white placeholder-slate-500 outline-none w-36 sm:w-44 transition-all"
                  title="Search cards containing this page number"
                />
                {pageSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setPageSearchQuery('')}
                    className="absolute right-2 text-slate-400 hover:text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

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

      {/* High-Performance Loading Modal Overlay */}
      <AnimatePresence>
        {isLoadingPdf && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              className="w-full max-w-md bg-[#141824] border border-orange-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl text-center space-y-5"
            >
              <div className="w-16 h-16 rounded-2xl bg-orange-500/15 border border-orange-500/30 flex items-center justify-center mx-auto text-[#FF6B2B] shadow-lg shadow-orange-500/10">
                <RefreshCw className="w-8 h-8 animate-spin" />
              </div>

              <div>
                <h3 className="text-lg font-black text-white tracking-tight">Optimizing & Loading PDF</h3>
                <p className="text-xs text-slate-400 mt-1 truncate max-w-xs mx-auto font-mono">
                  {fileName}
                </p>
              </div>

              {/* Progress bar with percentage */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-mono font-bold">
                  <span className="text-orange-400">
                    Page {loadingProgress?.current || 0} of {loadingProgress?.total || 0}
                  </span>
                  <span className="text-white">
                    {loadingProgress?.total 
                      ? Math.round(((loadingProgress.current || 0) / loadingProgress.total) * 100)
                      : 0}%
                  </span>
                </div>

                <div className="w-full h-2.5 rounded-full bg-white/[0.08] overflow-hidden p-0.5 border border-white/[0.06]">
                  <div 
                    className="h-full rounded-full bg-gradient-to-r from-amber-500 via-orange-500 to-[#FF6B2B] transition-all duration-150 shadow-sm"
                    style={{
                      width: `${loadingProgress?.total ? Math.min(100, Math.round(((loadingProgress.current || 0) / loadingProgress.total) * 100)) : 5}%`
                    }}
                  />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[11px] text-slate-400 leading-relaxed">
                ⚡ Adaptive high-speed memory streaming active. 200+ pages render smoothly with zero browser freezing.
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Active Search Filter Banner */}
      {pageSearchQuery.trim() && (
        <div className="bg-blue-600/20 border-b border-blue-500/30 px-6 py-2 flex items-center justify-between text-xs font-semibold text-blue-200">
          <div className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-blue-400" />
            <span>
              Showing cards matching Page <strong>&ldquo;{pageSearchQuery}&rdquo;</strong> ({displayedCards.length} found)
            </span>
          </div>
          <button
            type="button"
            onClick={() => setPageSearchQuery('')}
            className="underline text-white hover:text-slate-300"
          >
            Clear Filter (Show All {cards.length})
          </button>
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
          <div className="flex flex-col">
            {/* Top Pagination Bar */}
            {renderPaginationBar('top')}

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-6">
              {paginatedCards.map((card) => {
                const cardIdx = cards.findIndex(c => c.id === card.id);
                const items = ensureCardItems(card);
                const isTargetHovered = dragOverTargetId === card.id;
                const isReorderHovered = reorderDropTargetId === card.id;
                const isSourceBeingDragged = draggedCardId === card.id || reorderDragCardId === card.id;
                const isManualSource = manualMergeSourceId === card.id;
                const isMulti = items.length > 1;

                return (
                  <div
                    key={card.id}
                    id={`stitch-card-${card.id}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, card.id)}
                  onDragOver={(e) => handleCardDragOver(e, card.id)}
                  onDragLeave={() => {
                    if (dragOverTargetId === card.id) setDragOverTargetId(null);
                    if (reorderDropTargetId === card.id) setReorderDropTargetId(null);
                  }}
                  onDrop={(e) => handleCardDrop(e, card.id)}
                  onClick={() => {
                    if (manualMergeSourceId && manualMergeSourceId !== card.id) {
                      executeMerge(manualMergeSourceId, card.id);
                    }
                  }}
                  className={`relative flex flex-col rounded-2xl border transition-all duration-150 overflow-hidden group shadow-xl ${
                    card.isSelected === false ? 'opacity-40 grayscale-[0.4] hover:opacity-85' : 'opacity-100'
                  } ${
                    isReorderHovered
                      ? 'border-blue-400 ring-4 ring-blue-500/40 bg-blue-950/40 scale-[1.02]'
                      : isTargetHovered
                      ? 'border-emerald-400 ring-4 ring-emerald-500/30 bg-emerald-950/40 scale-[1.02]'
                      : isMulti
                      ? (card.isSelected !== false ? 'border-orange-500/50 bg-[#121622] hover:border-orange-500/80' : 'border-orange-500/20 bg-[#121622]/60')
                      : isManualSource
                      ? 'border-[#FF6B2B] ring-2 ring-[#FF6B2B] bg-[#FF6B2B]/10'
                      : (card.isSelected !== false ? 'border-white/[0.12] bg-[#0E111A] hover:border-white/[0.25] hover:shadow-2xl' : 'border-white/[0.04] bg-[#0E111A]/60')
                  } ${isSourceBeingDragged ? 'opacity-40' : ''} ${
                    manualMergeSourceId && manualMergeSourceId !== card.id ? 'cursor-pointer hover:ring-2 hover:ring-emerald-400' : ''
                  }`}
                >
                  {/* Drop Merge Indicator Overlay */}
                  {isTargetHovered && (
                    <div className="absolute inset-0 z-30 bg-emerald-600/30 backdrop-blur-xs flex flex-col items-center justify-center p-4 text-center pointer-events-none">
                      <div className="p-3 rounded-full bg-emerald-500 text-black mb-2 animate-bounce">
                        <ArrowDownUp className="w-6 h-6" />
                      </div>
                      <span className="text-sm font-extrabold text-white">
                        Drop to Merge All Pages Here!
                      </span>
                    </div>
                  )}

                  {/* Drop Reorder Indicator Overlay */}
                  {isReorderHovered && (
                    <div className="absolute inset-0 z-30 bg-blue-600/30 backdrop-blur-xs flex flex-col items-center justify-center p-4 text-center pointer-events-none">
                      <div className="p-3 rounded-full bg-blue-500 text-white mb-2 animate-pulse">
                        <ArrowLeftRight className="w-6 h-6" />
                      </div>
                      <span className="text-sm font-extrabold text-white">
                        Move Card to Position #{cardIdx + 1}
                      </span>
                    </div>
                  )}

                  {/* CARD HEADER */}
                  <div className={`p-2.5 border-b flex items-center justify-between gap-1.5 ${
                    isMulti 
                      ? (card.isSelected !== false ? 'bg-orange-500/10 border-orange-500/20 text-orange-300' : 'bg-orange-500/5 border-orange-500/10 text-orange-400/60')
                      : (card.isSelected !== false ? 'bg-white/[0.03] border-white/[0.06] text-slate-300' : 'bg-white/[0.01] border-white/[0.03] text-slate-500')
                  }`}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      {/* Grip handle for reordering card position */}
                      <div
                        draggable
                        onDragStart={(e) => handleReorderDragStart(e, card.id)}
                        className="cursor-grab active:cursor-grabbing p-0.5 rounded hover:bg-white/[0.12] text-slate-400 hover:text-white transition-colors"
                        title="Drag to change card position in document"
                      >
                        <GripVertical className="w-4 h-4" />
                      </div>

                      {/* Position Badge (Clickable to change position) */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPositionDialogCardId(card.id);
                          setTargetPositionInput(String(cardIdx + 1));
                        }}
                        className="px-1.5 py-0.5 rounded bg-white/[0.07] hover:bg-[#FF6B2B]/20 text-[10px] font-mono font-black text-slate-300 hover:text-orange-300 border border-white/[0.1] transition-all shrink-0"
                        title="Click to jump to a specific page position"
                      >
                        #{cardIdx + 1}
                      </button>

                      {/* Move Left / Right buttons */}
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleMoveCard(card.id, 'left'); }}
                          disabled={cardIdx === 0}
                          className="p-0.5 rounded hover:bg-white/[0.12] text-slate-400 hover:text-white disabled:opacity-20 transition-all"
                          title="Move card left / earlier"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleMoveCard(card.id, 'right'); }}
                          disabled={cardIdx === cards.length - 1}
                          className="p-0.5 rounded hover:bg-white/[0.12] text-slate-400 hover:text-white disabled:opacity-20 transition-all"
                          title="Move card right / later"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Select / Deselect Checkbox */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleSelectCard(card.id); }}
                        className={`p-1 rounded-md transition-all flex items-center justify-center shrink-0 ${
                          card.isSelected !== false 
                            ? 'text-[#FF884D] bg-[#FF884D]/15 hover:bg-[#FF884D]/25 ring-1 ring-[#FF884D]/30' 
                            : 'text-slate-500 bg-white/[0.04] hover:bg-white/[0.08] hover:text-slate-300'
                        }`}
                        title={card.isSelected !== false ? "Click to Deselect from Export" : "Click to Select for Export"}
                      >
                        {card.isSelected !== false ? (
                          <CheckSquare className="w-3.5 h-3.5 text-[#FF884D]" />
                        ) : (
                          <Square className="w-3.5 h-3.5 text-slate-500" />
                        )}
                      </button>

                      {/* Card Title & Badges */}
                      <div className="flex items-center gap-1 min-w-0 truncate">
                        <span className="text-[11px] font-extrabold text-white truncate" title={items.map(it => `P.${it.pageNum}`).join(' + ')}>
                          {items.length > 1
                            ? `Set: P.${items.map(it => it.pageNum).join('+')}`
                            : `Page ${items[0]?.pageNum || card.originalPageNum}`}
                        </span>
                        {items.length > 1 ? (
                          <span className="text-[9px] font-bold px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0">
                            {items.length}P
                          </span>
                        ) : (
                          <span className="text-[9px] font-bold px-1 py-0.2 rounded bg-white/[0.06] text-slate-400 shrink-0">
                            1P
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Top Action Icons: Add Page, Duplicate & Delete */}
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Search & Add Page Button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveAddModalCardId(card.id);
                          setSearchModalPageQuery('');
                        }}
                        className="px-1.5 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold flex items-center gap-0.5 transition-all"
                        title="Search & attach another page number to this card"
                      >
                        <span>+ Page</span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDuplicate(card.id); }}
                        className="p-1 rounded bg-white/[0.04] hover:bg-white/[0.12] text-slate-300 hover:text-white transition-all"
                        title="Duplicate card"
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

                  {/* CARD BODY: MULTI-SNIPPET STACK (Supports 1, 2, 3, 4, 5+ Pages) */}
                  <div className="p-2.5 flex-1 flex flex-col gap-2 bg-white/[0.01]">
                    {items.map((item, itemIdx) => {
                      const isCropped = Boolean(item.croppedImage);
                      const displayImg = item.croppedImage || item.image;

                      return (
                        <div key={item.id || `${card.id}-${itemIdx}`} className="flex flex-col">
                          {/* Mini header for item in card */}
                          <div className="flex items-center justify-between pb-1 px-1 text-[10px] text-slate-400 font-semibold">
                            <span className="flex items-center gap-1 font-bold text-slate-300">
                              <span className="px-1 rounded bg-white/[0.08] text-[9px] text-amber-400 font-mono">#{itemIdx + 1}</span>
                              <span>{item.label || (itemIdx === 0 ? 'Question' : `Part ${itemIdx + 1}`)} (P.{item.pageNum})</span>
                            </span>

                            <div className="flex items-center gap-0.5">
                              {items.length > 1 && (
                                <>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleMoveItemInsideCard(card.id, itemIdx, 'up'); }}
                                    disabled={itemIdx === 0}
                                    className="p-0.5 rounded hover:bg-white/[0.12] text-slate-400 hover:text-white disabled:opacity-20 transition-all"
                                    title="Move snippet up"
                                  >
                                    <ChevronUp className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleMoveItemInsideCard(card.id, itemIdx, 'down'); }}
                                    disabled={itemIdx === items.length - 1}
                                    className="p-0.5 rounded hover:bg-white/[0.12] text-slate-400 hover:text-white disabled:opacity-20 transition-all"
                                    title="Move snippet down"
                                  >
                                    <ChevronDown className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleRemoveItemFromCard(card.id, itemIdx); }}
                                    className="p-0.5 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 ml-1 transition-all"
                                    title="Detach this page to a separate card"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Image preview box with Crop button */}
                          <div className="relative group/preview rounded-xl border border-white/[0.08] overflow-hidden bg-white p-1 flex items-center justify-center">
                            <img
                              src={displayImg}
                              alt={`Page ${item.pageNum}`}
                              loading="lazy"
                              decoding="async"
                              className={`w-full h-auto object-contain block mx-auto ${
                                items.length > 2 ? 'max-h-32' : items.length === 2 ? 'max-h-44' : 'max-h-72'
                              }`}
                              style={{
                                transform: item.scale && item.scale !== 1 ? `scale(${item.scale})` : undefined,
                                transformOrigin: 'center center'
                              }}
                            />

                            {/* Floating Action Buttons */}
                            <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1 opacity-90 group-hover/preview:opacity-100 transition-all">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCropTarget({
                                    cardId: card.id,
                                    itemIndex: itemIdx,
                                    type: itemIdx === 0 ? 'question' : 'solution'
                                  });
                                }}
                                className="px-2 py-1 rounded bg-black/85 hover:bg-[#FF6B2B] text-white text-[10px] font-bold flex items-center gap-1 shadow-md transition-all"
                              >
                                <Scissors className="w-3 h-3 text-amber-400" />
                                <span>{isCropped ? 'Re-Crop' : 'Crop'}</span>
                              </button>

                              {isCropped && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handleResetCropOnCard(card.id, itemIdx); }}
                                  className="p-1 rounded bg-black/85 hover:bg-rose-600 text-white text-[10px] transition-all"
                                  title="Reset to full page"
                                >
                                  <RefreshCcw className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Divider line between snippets */}
                          {showDividerLine && itemIdx < items.length - 1 && (
                            <div className="w-full my-1.5 border-t border-dashed border-slate-700/80" />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* CARD FOOTER */}
                  <div className="p-2.5 border-t border-white/[0.06] bg-black/20 flex items-center justify-between gap-1.5 flex-wrap">
                    {items.length > 1 ? (
                      <>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleUnmerge(card.id)}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-rose-500/20 hover:text-rose-300 text-slate-300 text-[11px] font-semibold transition-all"
                            title="Separate all pages back into individual cards"
                          >
                            <Undo2 className="w-3 h-3" />
                            <span>Unmerge All</span>
                          </button>

                          {items.length === 2 && (
                            <button
                              type="button"
                              onClick={() => handleSwap(card.id)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 hover:text-white text-[11px] transition-all"
                              title="Swap Top & Bottom"
                            >
                              <ArrowLeftRight className="w-3 h-3" />
                              <span>Swap</span>
                            </button>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setActiveAddModalCardId(card.id);
                            setSearchModalPageQuery('');
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-[11px] font-bold transition-all border border-emerald-500/30 ml-auto"
                          title="Search & attach another page number to this card"
                        >
                          <span>+ Add Page</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setManualMergeSourceId(isManualSource ? null : card.id)}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                            isManualSource 
                              ? 'bg-[#FF6B2B] text-white' 
                              : 'bg-white/[0.06] hover:bg-white/[0.1] text-slate-300'
                          }`}
                        >
                          <ArrowDownUp className="w-3 h-3 text-orange-400" />
                          <span>{isManualSource ? 'Cancel' : 'Merge into...'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setActiveAddModalCardId(card.id);
                            setSearchModalPageQuery('');
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-emerald-500/20 hover:text-emerald-300 text-slate-300 text-[11px] font-semibold transition-all border border-white/[0.08]"
                          title="Search & attach another page number to this card"
                        >
                          <span>+ Add Page</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

            {/* Bottom Pagination Bar */}
            {renderPaginationBar('bottom')}
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-5xl bg-[#141824] border border-white/[0.1] rounded-2xl flex flex-col max-h-[94vh] shadow-2xl overflow-hidden"
            >
              {/* Modal Header */}
              <div className="p-3 sm:p-4 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3 bg-[#0E111A]">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 rounded-xl bg-orange-500/20 text-orange-400 shrink-0">
                    <Scissors className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-white">
                        Crop {currentCroppingItem?.label || (currentItemIndex === 0 ? 'Question' : `Part ${currentItemIndex + 1}`)} (Page {currentDisplayedPageNum})
                      </h3>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#FF6B2B]/15 text-[#FF884D] border border-[#FF6B2B]/30 uppercase tracking-wider">
                        {currentCroppingItem?.label || (currentItemIndex === 0 ? 'Question' : `Part ${currentItemIndex + 1}`)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 truncate">
                      Click & drag your mouse over the page to select the exact question or solution area.
                    </p>
                  </div>
                </div>

                {/* Center / Action Navigation: Prev / Next Page & Snippet Tabs */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Next / Previous Page Navigation Pill */}
                  <div className="flex items-center gap-1 bg-black/50 border border-white/[0.1] p-1 rounded-xl shadow-inner">
                    <button
                      type="button"
                      onClick={() => handleNavigateCrop('prev')}
                      disabled={!hasPrevPage}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-300 hover:text-white hover:bg-white/[0.08] active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all"
                      title={prevTarget ? `Previous: ${prevTarget.label} (Arrow Left)` : 'No previous page'}
                    >
                      <ChevronLeft className="w-4 h-4 text-orange-400" />
                      <span>Prev</span>
                    </button>

                    <div className="px-2.5 py-1 text-xs font-mono font-extrabold text-amber-400 bg-white/[0.05] rounded-md border border-white/[0.06] flex items-center gap-1">
                      <span>{currentTargetIndex >= 0 ? `${currentTargetIndex + 1}/${flatTargets.length}` : ''}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleNavigateCrop('next')}
                      disabled={!hasNextPage}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-300 hover:text-white hover:bg-white/[0.08] active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all"
                      title={nextTarget ? `Next: ${nextTarget.label} (Arrow Right)` : 'No next page'}
                    >
                      <span>Next</span>
                      <ChevronRight className="w-4 h-4 text-orange-400" />
                    </button>
                  </div>

                  {/* Dynamic Snippet Tabs for this Card */}
                  <div className="flex items-center gap-1 bg-white/[0.04] p-0.5 rounded-lg border border-white/[0.08] flex-wrap max-w-sm sm:max-w-md overflow-x-auto">
                    {currentCroppingItems.map((item, idx) => {
                      const isActive = idx === currentItemIndex;
                      return (
                        <button
                          key={item.id || idx}
                          type="button"
                          onClick={() => {
                            saveCropForTarget(cropTarget, activeCropBox, activeScale);
                            setCropTarget({ cardId: currentCroppingCard.id, itemIndex: idx });
                          }}
                          className={`px-2.5 py-1 rounded text-xs font-bold transition-all shrink-0 ${
                            isActive ? 'bg-[#FF6B2B] text-white shadow' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {item.label || (idx === 0 ? 'Question' : `Part ${idx + 1}`)} (P.{item.pageNum})
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => {
                        saveCropForTarget(cropTarget, activeCropBox, activeScale);
                        setActiveAddModalCardId(currentCroppingCard.id);
                        setSearchModalPageQuery('');
                      }}
                      className="px-2 py-1 rounded text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 shrink-0 transition-colors"
                      title="Search & add another page to this card"
                    >
                      + Add Page
                    </button>
                  </div>

                  {/* Source PDF Page Selector */}
                  {allPdfPages.length > 1 && (
                    <div className="hidden lg:flex items-center gap-1 text-xs bg-white/[0.04] border border-white/[0.08] px-2 py-1 rounded-xl">
                      <span className="text-slate-400 text-[11px] font-medium">PDF:</span>
                      <button
                        type="button"
                        onClick={() => handleChangeSourcePage(currentDisplayedPageNum - 1)}
                        disabled={currentDisplayedPageNum <= 1}
                        className="p-1 rounded hover:bg-white/[0.1] text-slate-300 disabled:opacity-30 transition-all"
                        title="Previous PDF Page"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <select
                        value={currentDisplayedPageNum}
                        onChange={(e) => handleChangeSourcePage(Number(e.target.value))}
                        className="bg-transparent text-white font-bold text-xs border-none outline-none cursor-pointer py-0.5"
                        title="Change source PDF page for this crop"
                      >
                        {allPdfPages.map((p) => (
                          <option key={p.pageNum} value={p.pageNum} className="bg-[#141824] text-white">
                            Page {p.pageNum}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => handleChangeSourcePage(currentDisplayedPageNum + 1)}
                        disabled={currentDisplayedPageNum >= allPdfPages.length}
                        className="p-1 rounded hover:bg-white/[0.1] text-slate-300 disabled:opacity-30 transition-all"
                        title="Next PDF Page"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setCropTarget(null)}
                    className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/[0.08] transition-all ml-1"
                    title="Close (Esc)"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Crop Canvas Body with Floating Side Arrows */}
              <div className="flex-1 overflow-auto p-4 bg-[#07090E] flex items-center justify-center min-h-[420px] relative group">
                {/* Floating Left Navigation Arrow */}
                {hasPrevPage && (
                  <button
                    type="button"
                    onClick={() => handleNavigateCrop('prev')}
                    className="absolute left-4 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-black/80 hover:bg-[#FF6B2B] text-white/80 hover:text-white border border-white/10 hover:border-transparent shadow-2xl backdrop-blur-md transition-all active:scale-90"
                    title={prevTarget ? `Previous: ${prevTarget.label} (Arrow Left)` : 'Previous'}
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                )}

                {/* Floating Right Navigation Arrow */}
                {hasNextPage && (
                  <button
                    type="button"
                    onClick={() => handleNavigateCrop('next')}
                    className="absolute right-4 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-black/80 hover:bg-[#FF6B2B] text-white/80 hover:text-white border border-white/10 hover:border-transparent shadow-2xl backdrop-blur-md transition-all active:scale-90"
                    title={nextTarget ? `Next: ${nextTarget.label} (Arrow Right)` : 'Next'}
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                )}

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
              <div className="p-3 sm:p-4 border-t border-white/[0.08] bg-[#0E111A] flex flex-wrap items-center justify-between gap-3">
                {/* Scale / Zoom Slider */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <ZoomIn className="w-4 h-4 text-orange-400" />
                    <span>Zoom:</span>
                    <input
                      type="range"
                      min={0.8}
                      max={1.8}
                      step={0.05}
                      value={activeScale}
                      onChange={(e) => setActiveScale(Number(e.target.value))}
                      className="w-28 sm:w-32 accent-[#FF6B2B]"
                    />
                    <span className="font-mono text-white font-bold w-10 text-right">
                      {Math.round(activeScale * 100)}%
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setActiveCropBox({ x: 0, y: 0, width: 100, height: 100 });
                      setActiveScale(1.0);
                    }}
                    className="px-2.5 py-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-xs text-slate-300 transition-all"
                  >
                    Reset Full Page
                  </button>
                </div>

                {/* Footer Navigation & Apply / Cancel */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => handleNavigateCrop('prev')}
                    disabled={!hasPrevPage}
                    className="flex items-center gap-1 px-3 py-2 text-xs font-bold rounded-xl border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all"
                    title={prevTarget ? `Previous: ${prevTarget.label}` : 'No previous page'}
                  >
                    <ChevronLeft className="w-4 h-4 text-orange-400" />
                    <span>Prev Page</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleNavigateCrop('next')}
                    disabled={!hasNextPage}
                    className="flex items-center gap-1 px-3 py-2 text-xs font-bold rounded-xl border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all"
                    title={nextTarget ? `Next: ${nextTarget.label}` : 'No next page'}
                  >
                    <span>Next Page</span>
                    <ChevronRight className="w-4 h-4 text-orange-400" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setCropTarget(null)}
                    className="px-3.5 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-all"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={handleApplyCrop}
                    className="flex items-center gap-1.5 px-5 py-2 bg-gradient-to-r from-[#FF6B2B] to-[#FF884D] text-white rounded-xl text-xs font-bold shadow-lg shadow-[#FF6B2B]/25 hover:shadow-[#FF6B2B]/40 active:scale-95 transition-all"
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

      {/* 5. SEARCH & ADD PAGE TO CARD MODAL */}
      <AnimatePresence>
        {activeAddModalCardId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-2xl bg-[#141824] border border-white/[0.1] rounded-2xl p-5 shadow-2xl flex flex-col max-h-[88vh] space-y-4 overflow-hidden"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-white/[0.08] pb-3 shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
                    <Plus className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      Attach Any Page to Card #{cards.findIndex(c => c.id === activeAddModalCardId) + 1}
                    </h3>
                    <p className="text-xs text-slate-400">
                      Search or enter page number to add another question, solution, or continuation snippet to this card.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveAddModalCardId(null)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/[0.08]"
                >
                  ✕
                </button>
              </div>

              {/* Direct Page Input Form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const num = parseInt(directPageNumberInput, 10);
                  if (!isNaN(num) && num >= 1 && num <= allPdfPages.length) {
                    handleAddPageToCard(activeAddModalCardId, num);
                    setDirectPageNumberInput('');
                  }
                }}
                className="flex items-center gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] shrink-0"
              >
                <span className="text-xs text-slate-300 font-bold shrink-0">Quick Add by Page #:</span>
                <input
                  type="number"
                  min={1}
                  max={allPdfPages.length}
                  placeholder={`1 - ${allPdfPages.length}`}
                  value={directPageNumberInput}
                  onChange={(e) => setDirectPageNumberInput(e.target.value)}
                  className="w-28 px-3 py-1.5 bg-black/50 border border-white/[0.12] focus:border-emerald-500 rounded-lg text-white font-mono text-sm outline-none"
                />
                <button
                  type="submit"
                  disabled={!directPageNumberInput}
                  className="px-4 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-40 shadow-sm"
                >
                  + Add to Card
                </button>
              </form>

              {/* Filter Search Input */}
              <div className="relative shrink-0">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Filter PDF pages (e.g. 219, 63)..."
                  value={searchModalPageQuery}
                  onChange={(e) => setSearchModalPageQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-black/40 border border-white/[0.1] focus:border-[#FF6B2B] rounded-xl text-xs text-white placeholder-slate-500 outline-none"
                />
                {searchModalPageQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchModalPageQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Thumbnail Grid of Pages (Paginated for 200+ pages) */}
              <div className="flex-1 overflow-y-auto pr-1">
                {(() => {
                  const filteredModalPages = allPdfPages.filter((p) =>
                    searchModalPageQuery.trim()
                      ? String(p.pageNum).includes(searchModalPageQuery.trim())
                      : true
                  );
                  const modalTotalPages = Math.max(1, Math.ceil(filteredModalPages.length / ADD_MODAL_PAGE_SIZE));
                  const safeModalPage = Math.min(Math.max(1, addModalPage), modalTotalPages);
                  const paginatedModalPages = filteredModalPages.slice((safeModalPage - 1) * ADD_MODAL_PAGE_SIZE, safeModalPage * ADD_MODAL_PAGE_SIZE);

                  return (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {paginatedModalPages.map((p) => (
                          <button
                            key={p.pageNum}
                            type="button"
                            onClick={() => handleAddPageToCard(activeAddModalCardId, p.pageNum)}
                            className="group flex flex-col rounded-xl border border-white/[0.08] hover:border-emerald-500 bg-white/[0.02] hover:bg-emerald-950/20 p-2 text-left transition-all relative overflow-hidden cursor-pointer"
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-mono font-bold text-slate-300 group-hover:text-white">
                                Page {p.pageNum}
                              </span>
                              <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                                + Add
                              </span>
                            </div>
                            <div className="rounded-lg overflow-hidden bg-white aspect-[3/4] flex items-center justify-center p-0.5">
                              <img
                                src={p.image}
                                alt={`Page ${p.pageNum}`}
                                loading="lazy"
                                decoding="async"
                                className="w-full h-full object-contain pointer-events-none"
                              />
                            </div>
                          </button>
                        ))}
                      </div>

                      {/* Modal Pagination Footer */}
                      <div className="flex items-center justify-between pt-3 mt-3 border-t border-white/[0.08] shrink-0">
                        <div className="text-xs text-slate-400">
                          <span>Page <strong>{safeModalPage}</strong> of {modalTotalPages} ({filteredModalPages.length} pages)</span>
                        </div>

                        {modalTotalPages > 1 && (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setAddModalPage(p => Math.max(1, p - 1))}
                              disabled={safeModalPage <= 1}
                              className="px-3 py-1 rounded-lg border border-white/[0.08] text-xs font-bold text-slate-300 disabled:opacity-20 hover:bg-white/[0.08] transition-all"
                            >
                              Prev
                            </button>
                            <button
                              type="button"
                              onClick={() => setAddModalPage(p => Math.min(modalTotalPages, p + 1))}
                              disabled={safeModalPage >= modalTotalPages}
                              className="px-3 py-1 rounded-lg border border-white/[0.08] text-xs font-bold text-slate-300 disabled:opacity-20 hover:bg-white/[0.08] transition-all"
                            >
                              Next
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>

              <div className="flex justify-end pt-2 border-t border-white/[0.08] shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveAddModalCardId(null)}
                  className="px-4 py-1.5 text-xs text-slate-400 hover:text-white rounded-lg bg-white/[0.05]"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 6. MOVE CARD POSITION DIALOG */}
      <AnimatePresence>
        {positionDialogCardId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm bg-[#141824] border border-white/[0.1] rounded-2xl p-5 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between border-b border-white/[0.08] pb-2.5">
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <ArrowLeftRight className="w-4 h-4 text-[#FF6B2B]" />
                  <span>Move Card Position</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setPositionDialogCardId(null)}
                  className="text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <p className="text-xs text-slate-400">
                Enter the target position number in the PDF (1 to {cards.length}):
              </p>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const pos = parseInt(targetPositionInput, 10);
                  if (!isNaN(pos) && pos >= 1 && pos <= cards.length) {
                    handleMoveCardToPosition(positionDialogCardId, pos - 1);
                  }
                }}
                className="space-y-4"
              >
                <div className="flex items-center justify-center gap-3">
                  <span className="text-xs font-bold text-slate-300">Position #:</span>
                  <input
                    type="number"
                    min={1}
                    max={cards.length}
                    value={targetPositionInput}
                    onChange={(e) => setTargetPositionInput(e.target.value)}
                    className="w-24 px-3 py-1.5 bg-black/50 border border-white/[0.15] focus:border-[#FF6B2B] rounded-xl text-center text-white font-mono font-bold text-base outline-none"
                    autoFocus
                  />
                  <span className="text-xs text-slate-500 font-mono">/ {cards.length}</span>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.08]">
                  <button
                    type="button"
                    onClick={() => setPositionDialogCardId(null)}
                    className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-gradient-to-r from-[#FF6B2B] to-[#FF884D] text-white rounded-xl text-xs font-bold shadow-md hover:shadow-orange-500/20 active:scale-95 transition-all"
                  >
                    Move Position
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default QaPageStitcher;
