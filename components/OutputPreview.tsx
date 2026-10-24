import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, EyeOff, Loader2, Maximize2, Settings2, X } from 'lucide-react';
import { PageCard } from '../services/pdfStitchService';
import { exportCardsWithPdfLayout, PdfLayoutConfig, SheetPlan } from '../services/pdfLayoutService';

interface OutputPreviewProps {
  cards: PageCard[];
  config: PdfLayoutConfig;
  onOpenSettings: () => void;
  /** Move a page so it sits right before/after another page in the document order. */
  onMoveCard: (cardId: string, targetCardId: string, position: 'before' | 'after') => void;
  /** Leave a page out of the exported PDF. */
  onExcludeCard: (cardId: string) => void;
}

interface SheetThumb {
  src: string;
  width: number;
  height: number;
}

const THUMB_WIDTH = 460;
const ZOOM_WIDTH = 1300;

/**
 * Shows the exact pages the PDF download will contain. The preview is produced by running
 * the same export code as the download button and rasterising the resulting PDF, so layout,
 * page breaks, margins and borders can never drift from the real output.
 */
export const OutputPreview: React.FC<OutputPreviewProps> = ({ cards, config, onOpenSettings, onMoveCard, onExcludeCard }) => {
  const [sheets, setSheets] = useState<SheetThumb[]>([]);
  const [isBuilding, setIsBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [plans, setPlans] = useState<SheetPlan[]>([]);
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [dropCardId, setDropCardId] = useState<string | null>(null);
  const [zoomIndex, setZoomIndex] = useState<number | null>(null);
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);

  const blobRef = useRef<Blob | null>(null);
  const pdfRef = useRef<any>(null);
  const runId = useRef(0);

  useEffect(() => {
    const myRun = ++runId.current;
    setError(null);

    if (cards.length === 0) {
      setSheets([]);
      blobRef.current = null;
      pdfRef.current = null;
      return;
    }

    setIsBuilding(true);
    const timer = window.setTimeout(async () => {
      try {
        if (!window.pdfjsLib) throw new Error('PDF.js is not loaded.');
        let builtPlans: SheetPlan[] = [];
        const blob = await exportCardsWithPdfLayout(cards, config, (current, total) => {
          if (myRun === runId.current) setProgress(`Preparing page ${current} of ${total}`);
        }, p => { builtPlans = p; });
        if (myRun !== runId.current) return;

        const pdf = await window.pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
        if (myRun !== runId.current) return;

        blobRef.current = blob;
        pdfRef.current = pdf;
        setPlans(builtPlans);

        const thumbs: SheetThumb[] = [];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not create canvas context');

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width });
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (myRun !== runId.current) return;
          setProgress(`Drawing sheet ${i} of ${pdf.numPages}`);

          thumbs.push({ src: canvas.toDataURL('image/jpeg', 0.85), width: base.width, height: base.height });
          if (i % 4 === 0 || i === pdf.numPages) setSheets([...thumbs]);
        }
        setSheets(thumbs);
      } catch (err: any) {
        console.error('Output preview failed', err);
        if (myRun === runId.current) setError(err?.message || String(err));
      } finally {
        if (myRun === runId.current) {
          setIsBuilding(false);
          setProgress('');
        }
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [cards, config]);

  useEffect(() => {
    if (zoomIndex === null || !pdfRef.current) {
      setZoomSrc(null);
      return;
    }
    let cancelled = false;
    setZoomSrc(null);
    (async () => {
      const page = await pdfRef.current.getPage(zoomIndex + 1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: ZOOM_WIDTH / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      if (!cancelled) setZoomSrc(canvas.toDataURL('image/jpeg', 0.92));
    })();
    return () => { cancelled = true; };
  }, [zoomIndex]);

  const handleDownload = () => {
    if (!blobRef.current) return;
    const url = URL.createObjectURL(blobRef.current);
    const a = document.createElement('a');
    a.href = url;
    const name = (config.outputFileName || 'converted').trim();
    a.download = name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const first = sheets[0];
  const orientation = first ? (first.width > first.height ? 'Landscape' : 'Portrait') : '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-2.5 rounded-2xl bg-white/[0.03] border border-white/[0.08]">
        <div className="flex items-center gap-2 text-xs text-slate-300">
          {isBuilding && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#FF884D]" />}
          <span className="font-bold text-white">Exact output preview</span>
          <span className="text-slate-400">
            {sheets.length > 0
              ? `${sheets.length} page${sheets.length === 1 ? '' : 's'} · ${config.pageSize} ${orientation}`
              : isBuilding ? 'Building…' : 'Nothing selected'}
            {isBuilding && progress && ` — ${progress}`}
          </span>
          <span className="text-slate-500 hidden md:inline">— the downloaded PDF will look exactly like this</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-xs font-semibold text-slate-200"
          >
            <Settings2 className="w-3.5 h-3.5 text-blue-300" />
            <span>Layout settings</span>
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={isBuilding || sheets.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download this PDF</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200">
          Could not build the preview: {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-6">
        {sheets.map((sheet, idx) => {
          const plan = isBuilding ? [] : plans[idx] || [];
          const prevLast = plans[idx - 1]?.[plans[idx - 1].length - 1];
          const nextFirst = plans[idx + 1]?.[0];
          const lastOnSheet = plan[plan.length - 1];

          return (
            <div
              key={idx}
              className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-[#0E111A] border border-white/[0.1] hover:border-[#FF884D]/60 transition-colors"
              onDragOver={e => { if (dragCardId && lastOnSheet) e.preventDefault(); }}
              onDrop={e => {
                if (!dragCardId || !lastOnSheet || dragCardId === lastOnSheet.cardId) return;
                e.preventDefault();
                onMoveCard(dragCardId, lastOnSheet.cardId, 'after');
                setDragCardId(null);
                setDropCardId(null);
              }}
            >
              <div className="relative w-full">
                <img
                  src={sheet.src}
                  alt={`Output page ${idx + 1}`}
                  draggable={false}
                  className="w-full h-auto bg-white shadow-lg block"
                  style={{ aspectRatio: `${sheet.width} / ${sheet.height}` }}
                />

                {plan.map((spot, spotIdx) => (
                  <div
                    key={`${spot.cardId}-${spotIdx}`}
                    draggable
                    onDragStart={e => {
                      e.dataTransfer.setData('text/plain', spot.cardId);
                      e.dataTransfer.effectAllowed = 'move';
                      setDragCardId(spot.cardId);
                    }}
                    onDragEnd={() => { setDragCardId(null); setDropCardId(null); }}
                    onDragOver={e => {
                      if (dragCardId && dragCardId !== spot.cardId) {
                        e.preventDefault();
                        e.stopPropagation();
                        setDropCardId(spot.cardId);
                      }
                    }}
                    onDrop={e => {
                      if (!dragCardId || dragCardId === spot.cardId) return;
                      e.preventDefault();
                      e.stopPropagation();
                      onMoveCard(dragCardId, spot.cardId, 'before');
                      setDragCardId(null);
                      setDropCardId(null);
                    }}
                    className={`group/spot absolute cursor-grab active:cursor-grabbing border transition-colors ${
                      dropCardId === spot.cardId
                        ? 'border-emerald-400 bg-emerald-400/25'
                        : dragCardId === spot.cardId
                        ? 'border-blue-400 bg-blue-400/20'
                        : 'border-transparent hover:border-[#FF6B2B] hover:bg-[#FF6B2B]/10'
                    }`}
                    style={{
                      left: `${spot.x * 100}%`,
                      top: `${spot.y * 100}%`,
                      width: `${spot.width * 100}%`,
                      height: `${spot.height * 100}%`,
                    }}
                    title={`Page ${spot.label} — drag onto another page to move it before that page`}
                  >
                    <span className="absolute top-0.5 left-0.5 px-1 rounded bg-black/80 text-[9px] font-mono font-bold text-amber-300 opacity-0 group-hover/spot:opacity-100">
                      P.{spot.label}
                    </span>
                    <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 flex items-center gap-0.5 opacity-0 group-hover/spot:opacity-100 transition-opacity">
                      <button
                        type="button"
                        disabled={!prevLast}
                        onClick={() => prevLast && onMoveCard(spot.cardId, prevLast.cardId, 'before')}
                        className="p-1 rounded bg-black/85 hover:bg-blue-600 text-white disabled:opacity-30"
                        title="Move to previous sheet"
                      >
                        <ArrowLeft className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={!nextFirst}
                        onClick={() => nextFirst && onMoveCard(spot.cardId, nextFirst.cardId, 'after')}
                        className="p-1 rounded bg-black/85 hover:bg-blue-600 text-white disabled:opacity-30"
                        title="Move to next sheet"
                      >
                        <ArrowRight className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onExcludeCard(spot.cardId)}
                        className="p-1 rounded bg-black/85 hover:bg-rose-600 text-white"
                        title="Leave this page out of the PDF"
                      >
                        <EyeOff className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => setZoomIndex(idx)}
                  className="absolute top-1 right-1 p-1 rounded bg-black/80 hover:bg-cyan-600 text-white"
                  title="Zoom this sheet"
                >
                  <Maximize2 className="w-3 h-3" />
                </button>
              </div>
              <span className="text-[11px] font-mono font-bold text-slate-400">
                Page {idx + 1} / {sheets.length}
              </span>
            </div>
          );
        })}
      </div>

      {zoomIndex !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col"
          onClick={() => setZoomIndex(null)}
        >
          <div className="flex items-center justify-between px-5 py-3 text-xs text-slate-200" onClick={e => e.stopPropagation()}>
            <span className="font-bold">Output page {zoomIndex + 1} / {sheets.length}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={zoomIndex === 0}
                onClick={() => setZoomIndex(zoomIndex - 1)}
                className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30"
              >
                Prev
              </button>
              <button
                type="button"
                disabled={zoomIndex >= sheets.length - 1}
                onClick={() => setZoomIndex(zoomIndex + 1)}
                className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30"
              >
                Next
              </button>
              <button type="button" onClick={() => setZoomIndex(null)} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4" onClick={e => e.stopPropagation()}>
            {zoomSrc ? (
              <img src={zoomSrc} alt={`Output page ${zoomIndex + 1}`} className="mx-auto max-w-full h-auto bg-white shadow-2xl" />
            ) : (
              <div className="flex justify-center pt-20">
                <Loader2 className="w-6 h-6 animate-spin text-[#FF884D]" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default OutputPreview;
