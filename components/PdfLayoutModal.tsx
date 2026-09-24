import React, { useState, useMemo } from 'react';
import {
  X,
  FileText,
  Download,
  Info,
  Check,
  Sparkles,
  ArrowRight,
  Maximize2,
  Minimize2,
  RefreshCw,
  Loader2,
  Grid
} from 'lucide-react';
import {
  PdfLayoutConfig,
  DEFAULT_PDF_LAYOUT_CONFIG,
  PagesPerSheetOption,
  PageSizeOption,
  OrientationOption,
  ReadingDirectionOption,
  ReadingOrderOption,
  getSheetDimensions,
  getGridDimensions,
} from '../services/pdfLayoutService';

interface PdfLayoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  totalItemsCount: number;
  initialFileName?: string;
  onExport: (config: PdfLayoutConfig) => Promise<void>;
  onQuickDownload?: () => Promise<void>;
  onApplyToCards?: (pagesPerSheet: number) => void;
  isExporting: boolean;
  exportProgress?: { current: number; total: number } | null;
}

export const PdfLayoutModal: React.FC<PdfLayoutModalProps> = ({
  isOpen,
  onClose,
  totalItemsCount,
  initialFileName = '',
  onExport,
  onQuickDownload,
  onApplyToCards,
  isExporting,
  exportProgress,
}) => {
  const defaultCleanName = useMemo(() => {
    const raw = (initialFileName || 'document').replace(/\.pdf$/i, '').trim();
    return `${raw} - converted`;
  }, [initialFileName]);

  const [config, setConfig] = useState<PdfLayoutConfig>({
    ...DEFAULT_PDF_LAYOUT_CONFIG,
    outputFileName: `${defaultCleanName}.pdf`,
  });

  const [marginUnit, setMarginUnit] = useState<'mm' | 'pt'>('mm');

  // Compute sheet calculations for UI preview
  const numPagesPerSheet =
    config.layoutMode === 'single'
      ? 1
      : config.pagesPerSheet === 'custom'
      ? (config.customRows || 2) * (config.customCols || 2)
      : (config.pagesPerSheet as number);

  const { width: sheetW, height: sheetH, isLandscape } = getSheetDimensions(
    config.pageSize,
    config.orientation,
    numPagesPerSheet === 1 ? 1 : (config.pagesPerSheet as PagesPerSheetOption),
    config.customRows,
    config.customCols
  );

  const { rows, cols } = getGridDimensions(
    numPagesPerSheet === 1 ? 1 : config.pagesPerSheet,
    isLandscape,
    config.customRows,
    config.customCols
  );

  const estimatedSheets = Math.ceil(totalItemsCount / numPagesPerSheet);

  // Generate numbered preview slots (All hooks must execute before any conditional return)
  const previewSlots = useMemo(() => {
    const totalSlots = rows * cols;
    const slots: { index: number; r: number; c: number; label: number }[] = [];

    for (let k = 0; k < totalSlots; k++) {
      let r = 0;
      let c = 0;

      if (config.readingDirection === 'row-by-row') {
        r = Math.floor(k / cols);
        const rawC = k % cols;
        c = config.readingOrder === 'rtl' ? cols - 1 - rawC : rawC;
      } else {
        const rawC = Math.floor(k / rows);
        c = config.readingOrder === 'rtl' ? cols - 1 - rawC : rawC;
        r = k % rows;
      }

      slots.push({
        index: k,
        r,
        c,
        label: k + 1,
      });
    }

    return slots;
  }, [rows, cols, config.readingDirection, config.readingOrder]);

  if (!isOpen) return null;

  const handleFileNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    if (val.toLowerCase().endsWith('.pdf')) {
      val = val.slice(0, -4);
    }
    setConfig(prev => ({ ...prev, outputFileName: `${val.trim()}.pdf` }));
  };

  const handleStartExport = () => {
    onExport(config);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-[#12151F] border border-white/10 rounded-2xl shadow-2xl overflow-hidden my-6 flex flex-col text-slate-100 animate-in fade-in zoom-in-95 duration-150">
        
        {/* MODAL HEADER */}
        <div className="px-6 py-4 border-b border-white/[0.08] bg-gradient-to-r from-blue-950/40 via-indigo-950/30 to-purple-950/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20">
              <Grid className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white tracking-tight">
                PDF Page Layout & N-Up Export
              </h2>
              <p className="text-xs text-slate-400">
                Define a new PDF layout (multiple pages per sheet) or customize paper size, borders and margins.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* INFO CALLOUT BANNER (Replicating PDF24 Blue Info Box) */}
        <div className="mx-6 mt-4 p-3.5 bg-blue-500/10 border border-blue-400/30 rounded-xl flex items-start gap-3 text-xs text-blue-200 leading-relaxed shadow-sm">
          <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-blue-100">Define a new PDF layout</span> (e.g. multiple pages per sheet like 2-Up, 4-Up, 8-Up) or change an existing layout (e.g. from A3 to A4, add sheet borders, and customize margins).
          </div>
        </div>

        {/* MODAL BODY */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[calc(85vh-180px)]">

          {/* SECTION 1: PDF PAGE LAYOUT */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pb-5 border-b border-white/[0.08] items-center">
            <div className="md:col-span-4">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 block">
                PDF page layout:
              </span>
              <span className="text-[11px] text-slate-400">
                Format, size, pages per sheet...
              </span>
            </div>

            <div className="md:col-span-5 space-y-2.5">
              {/* Layout Mode Dropdown */}
              <div className="flex items-center gap-2">
                <select
                  value={config.layoutMode}
                  onChange={(e) => setConfig(p => ({ ...p, layoutMode: e.target.value as any }))}
                  className="w-full bg-[#1A1E2C] border border-white/15 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-semibold text-white outline-none cursor-pointer"
                >
                  <option value="multiple">Multiple pages per sheet</option>
                  <option value="single">Single page per sheet</option>
                </select>
              </div>

              {/* Pages Per Sheet & Border */}
              {config.layoutMode === 'multiple' && (
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <select
                      value={config.pagesPerSheet}
                      onChange={(e) => {
                        const val = e.target.value === 'custom' ? 'custom' : Number(e.target.value);
                        setConfig(p => ({
                          ...p,
                          pagesPerSheet: val as any,
                          customRows: p.customRows || 2,
                          customCols: p.customCols || 2,
                        }));
                      }}
                      className="w-56 bg-[#1A1E2C] border border-white/15 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-semibold text-white outline-none cursor-pointer"
                    >
                      <option value={1}>1 page per sheet</option>
                      <option value={2}>2 pages per sheet</option>
                      <option value={4}>4 pages per sheet (2 × 2)</option>
                      <option value={6}>6 pages per sheet (3 × 2)</option>
                      <option value={8}>8 pages per sheet (4 × 2)</option>
                      <option value={9}>9 pages per sheet (3 × 3)</option>
                      <option value={16}>16 pages per sheet (4 × 4)</option>
                      <option value="custom">Custom (Rows × Columns)...</option>
                    </select>

                    <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={config.withBorder}
                        onChange={(e) => setConfig(p => ({ ...p, withBorder: e.target.checked }))}
                        className="w-4 h-4 rounded text-blue-600 bg-white/10 border-white/20 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                      />
                      <span>with border</span>
                    </label>
                  </div>

                  {/* CUSTOM GRID CONTROLS (Rows × Columns) */}
                  {config.pagesPerSheet === 'custom' && (
                    <div className="p-3 bg-blue-950/25 border border-blue-500/30 rounded-xl space-y-2.5 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-blue-300 flex items-center gap-1.5">
                          <Grid className="w-3.5 h-3.5 text-blue-400" />
                          <span>Custom Grid Configuration</span>
                        </span>
                        <span className="text-[11px] font-mono font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                          {(config.customRows || 2) * (config.customCols || 2)} pages/sheet ({config.customRows || 2}R × {config.customCols || 2}C)
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Rows (Horizontal)</label>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={1}
                              max={12}
                              value={config.customRows ?? 2}
                              onChange={(e) => {
                                const val = Math.max(1, Math.min(12, parseInt(e.target.value, 10) || 1));
                                setConfig(p => ({ ...p, customRows: val }));
                              }}
                              className="w-full bg-[#131622] border border-white/15 focus:border-blue-500 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono font-bold text-center outline-none"
                            />
                            <div className="flex flex-col gap-0.5">
                              <button
                                type="button"
                                onClick={() => setConfig(p => ({ ...p, customRows: Math.min(12, (p.customRows || 2) + 1) }))}
                                className="px-1.5 py-0.5 bg-white/10 hover:bg-white/20 rounded text-[9px] text-white"
                                title="Increase rows"
                              >
                                ▲
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfig(p => ({ ...p, customRows: Math.max(1, (p.customRows || 2) - 1) }))}
                                className="px-1.5 py-0.5 bg-white/10 hover:bg-white/20 rounded text-[9px] text-white"
                                title="Decrease rows"
                              >
                                ▼
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Columns (Vertical)</label>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={1}
                              max={12}
                              value={config.customCols ?? 2}
                              onChange={(e) => {
                                const val = Math.max(1, Math.min(12, parseInt(e.target.value, 10) || 1));
                                setConfig(p => ({ ...p, customCols: val }));
                              }}
                              className="w-full bg-[#131622] border border-white/15 focus:border-blue-500 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono font-bold text-center outline-none"
                            />
                            <div className="flex flex-col gap-0.5">
                              <button
                                type="button"
                                onClick={() => setConfig(p => ({ ...p, customCols: Math.min(12, (p.customCols || 2) + 1) }))}
                                className="px-1.5 py-0.5 bg-white/10 hover:bg-white/20 rounded text-[9px] text-white"
                                title="Increase columns"
                              >
                                ▲
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfig(p => ({ ...p, customCols: Math.max(1, (p.customCols || 2) - 1) }))}
                                className="px-1.5 py-0.5 bg-white/10 hover:bg-white/20 rounded text-[9px] text-white"
                                title="Decrease columns"
                              >
                                ▼
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Quick preset buttons */}
                      <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-white/5">
                        <span className="text-[10px] text-slate-400 font-medium">Quick Grids:</span>
                        {[
                          { r: 1, c: 2, label: '1 × 2 (2)' },
                          { r: 2, c: 1, label: '2 × 1 (2)' },
                          { r: 2, c: 3, label: '2 × 3 (6)' },
                          { r: 3, c: 1, label: '3 × 1 (3)' },
                          { r: 1, c: 3, label: '1 × 3 (3)' },
                          { r: 3, c: 4, label: '3 × 4 (12)' },
                          { r: 4, c: 3, label: '4 × 3 (12)' },
                          { r: 5, c: 2, label: '5 × 2 (10)' },
                        ].map(preset => (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => setConfig(p => ({ ...p, customRows: preset.r, customCols: preset.c }))}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all border ${
                              (config.customRows === preset.r && config.customCols === preset.c)
                                ? 'bg-blue-600 text-white border-blue-400'
                                : 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10'
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* DYNAMIC VISUAL MINI-DIAGRAM */}
            <div className="md:col-span-3 flex justify-end">
              <div
                className={`w-28 p-2 rounded-xl border bg-black/40 shadow-inner flex flex-col items-center justify-center transition-all ${
                  isLandscape ? 'h-20' : 'h-28'
                } ${config.withBorder ? 'border-blue-500/40 shadow-blue-500/5' : 'border-white/10'}`}
                title={`Reading order preview: ${rows} rows × ${cols} cols (${isLandscape ? 'Landscape' : 'Portrait'}). Final placement auto-fits each page to fill the sheet.`}
              >
                <div
                  className="w-full h-full grid gap-1 p-1 rounded-lg bg-zinc-900/80"
                  style={{
                    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
                  }}
                >
                  {previewSlots.slice(0, rows * cols).map((s) => (
                    <div
                      key={s.index}
                      className={`flex items-center justify-center rounded text-[10px] font-black transition-all ${
                        config.withBorder
                          ? 'border border-amber-400/60 bg-gradient-to-tr from-amber-500/20 to-orange-500/20 text-amber-200'
                          : 'bg-white/10 text-slate-300 border border-white/5'
                      }`}
                    >
                      {s.label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2: READING DIRECTION */}
          {config.layoutMode === 'multiple' && numPagesPerSheet > 1 && (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pb-5 border-b border-white/[0.08] items-center">
              <div className="md:col-span-4">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300 block">
                  Reading direction:
                </span>
                <span className="text-[11px] text-slate-400">
                  In which direction should the pages be arranged?
                </span>
              </div>

              <div className="md:col-span-8 flex items-center gap-3 flex-wrap">
                <select
                  value={config.readingDirection}
                  onChange={(e) => setConfig(p => ({ ...p, readingDirection: e.target.value as any }))}
                  className="bg-[#1A1E2C] border border-white/15 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-semibold text-white outline-none cursor-pointer"
                >
                  <option value="row-by-row">Row by row (Horizontal)</option>
                  <option value="col-by-col">Column by column (Vertical)</option>
                </select>

                <select
                  value={config.readingOrder}
                  onChange={(e) => setConfig(p => ({ ...p, readingOrder: e.target.value as any }))}
                  className="bg-[#1A1E2C] border border-white/15 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-semibold text-white outline-none cursor-pointer"
                >
                  <option value="ltr">Left to right</option>
                  <option value="rtl">Right to left</option>
                </select>

                <span className="text-xs text-slate-400 italic">
                  Flow: {config.readingDirection === 'row-by-row' ? 'Across rows first' : 'Down columns first'} ({config.readingOrder === 'ltr' ? 'L → R' : 'R → L'})
                </span>
              </div>
            </div>
          )}

          {/* SECTION 3: PAGE LAYOUT (SIZE & ORIENTATION) */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pb-5 border-b border-white/[0.08] items-center">
            <div className="md:col-span-4">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 block">
                Page layout:
              </span>
              <span className="text-[11px] text-slate-400">
                Target size and orientation for the converted PDF?
              </span>
            </div>

            <div className="md:col-span-5 flex items-center gap-3">
              <select
                value={config.pageSize}
                onChange={(e) => setConfig(p => ({ ...p, pageSize: e.target.value as any }))}
                className="w-28 bg-[#1A1E2C] border border-white/15 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-semibold text-white outline-none cursor-pointer"
              >
                <option value="A4">A4</option>
                <option value="A3">A3</option>
                <option value="A5">A5</option>
                <option value="Letter">Letter</option>
                <option value="Legal">Legal</option>
              </select>

              <select
                value={config.orientation}
                onChange={(e) => setConfig(p => ({ ...p, orientation: e.target.value as any }))}
                className="w-60 bg-[#1A1E2C] border border-white/15 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-semibold text-white outline-none cursor-pointer"
              >
                <option value="auto">Automatic orientation (Standard)</option>
                <option value="portrait">Portrait (Vertical)</option>
                <option value="landscape">Landscape (Horizontal)</option>
              </select>
            </div>

            <div className="md:col-span-3 flex justify-end">
              <div className="flex items-center gap-2 p-2 bg-black/30 border border-white/10 rounded-xl text-xs text-slate-300">
                <span className="text-[11px] font-semibold text-slate-400">
                  {config.pageSize} ({config.orientation === 'auto'
                    ? 'Auto-fit'
                    : isLandscape ? 'Landscape' : 'Portrait'})
                </span>
                <span className="text-[10px] text-slate-500">
                  {Math.round(sheetW)} × {Math.round(sheetH)} pt
                </span>
              </div>
            </div>
          </div>

          {/* SECTION 4: OUTER MARGIN */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pb-5 border-b border-white/[0.08] items-center">
            <div className="md:col-span-4">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 block">
                Outer margin:
              </span>
              <span className="text-[11px] text-slate-400">
                Space between content and page edge.
              </span>
            </div>

            <div className="md:col-span-8 flex items-center justify-center sm:justify-start">
              {/* PDF24 Style Outer Margin Box */}
              <div className="relative p-4 rounded-2xl bg-black/40 border border-white/10 flex flex-col items-center gap-2 max-w-sm w-full">
                {/* Top Input */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-400 font-semibold w-10 text-right">Top:</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={config.outerMargin.top}
                    onChange={(e) => {
                      const v = Math.max(0, Number(e.target.value));
                      setConfig(p => ({ ...p, outerMargin: { ...p.outerMargin, top: v } }));
                    }}
                    className="w-16 bg-[#1A1E2C] border border-white/15 focus:border-blue-500 rounded-lg px-2 py-1 text-xs text-center text-white outline-none"
                  />
                  <span className="text-[11px] text-slate-400">mm</span>
                </div>

                {/* Middle Row: Left - Page Box - Right */}
                <div className="flex items-center justify-between w-full px-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400 font-semibold">Left:</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={config.outerMargin.left}
                      onChange={(e) => {
                        const v = Math.max(0, Number(e.target.value));
                        setConfig(p => ({ ...p, outerMargin: { ...p.outerMargin, left: v } }));
                      }}
                      className="w-16 bg-[#1A1E2C] border border-white/15 focus:border-blue-500 rounded-lg px-2 py-1 text-xs text-center text-white outline-none"
                    />
                    <span className="text-[11px] text-slate-400">mm</span>
                  </div>

                  <div className="w-12 h-14 border border-dashed border-blue-400/40 rounded bg-blue-500/5 flex items-center justify-center">
                    <span className="text-[9px] text-blue-300 font-bold uppercase">Page</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400 font-semibold">Right:</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={config.outerMargin.right}
                      onChange={(e) => {
                        const v = Math.max(0, Number(e.target.value));
                        setConfig(p => ({ ...p, outerMargin: { ...p.outerMargin, right: v } }));
                      }}
                      className="w-16 bg-[#1A1E2C] border border-white/15 focus:border-blue-500 rounded-lg px-2 py-1 text-xs text-center text-white outline-none"
                    />
                    <span className="text-[11px] text-slate-400">mm</span>
                  </div>
                </div>

                {/* Bottom Input */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-400 font-semibold w-10 text-right">Bottom:</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={config.outerMargin.bottom}
                    onChange={(e) => {
                      const v = Math.max(0, Number(e.target.value));
                      setConfig(p => ({ ...p, outerMargin: { ...p.outerMargin, bottom: v } }));
                    }}
                    className="w-16 bg-[#1A1E2C] border border-white/15 focus:border-blue-500 rounded-lg px-2 py-1 text-xs text-center text-white outline-none"
                  />
                  <span className="text-[11px] text-slate-400">mm</span>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 5: INNER MARGIN */}
          {config.layoutMode === 'multiple' && numPagesPerSheet > 1 && (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pb-5 border-b border-white/[0.08] items-center">
              <div className="md:col-span-4">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300 block">
                  Inner margin:
                </span>
                <span className="text-[11px] text-slate-400">
                  The space / gap between the pages on a sheet.
                </span>
              </div>

              <div className="md:col-span-8 flex items-center gap-3">
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={config.innerMargin}
                  onChange={(e) => {
                    const v = Math.max(0, Number(e.target.value));
                    setConfig(p => ({ ...p, innerMargin: v }));
                  }}
                  className="w-20 bg-[#1A1E2C] border border-white/15 focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-center font-semibold text-white outline-none"
                />
                <span className="text-xs text-slate-300 font-bold">mm</span>
                <span className="text-xs text-slate-400 italic">
                  (Gap between {rows} rows & {cols} columns)
                </span>
              </div>
            </div>
          )}

          {/* SECTION 6: FILENAME AFTER CONVERSION */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
            <div className="md:col-span-4">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 block">
                Filename after conversion:
              </span>
            </div>

            <div className="md:col-span-8">
              <div className="flex items-center gap-2 px-3 py-2 bg-[#1A1E2C] border border-white/15 focus-within:border-blue-500 rounded-xl shadow-inner">
                <FileText className="w-4 h-4 text-red-400 shrink-0" />
                <input
                  type="text"
                  value={config.outputFileName.replace(/\.pdf$/i, '')}
                  onChange={handleFileNameChange}
                  placeholder="Filename after conversion..."
                  className="w-full bg-transparent text-xs text-white placeholder-slate-500 outline-none font-medium"
                />
                <span className="text-xs font-bold text-slate-400 select-none">.pdf</span>
              </div>
            </div>
          </div>

          {/* SUMMARY STATS BADGE */}
          <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-between text-xs text-slate-300 flex-wrap gap-2">
            <div>
              <span className="text-slate-400">Total Cards:</span>{' '}
              <span className="font-extrabold text-white">{totalItemsCount}</span>
              <span className="mx-2 text-white/20">|</span>
              <span className="text-slate-400">Layout:</span>{' '}
              <span className="font-extrabold text-blue-300">
                {numPagesPerSheet === 1 ? '1-Up (Standard)' : `${numPagesPerSheet}-Up (${rows}×${cols})`}
              </span>
            </div>
            <div>
              <span className="text-slate-400">Resulting PDF:</span>{' '}
              <span className="font-black text-emerald-400 text-sm">
                ~{estimatedSheets} Sheets ({config.pageSize})
              </span>
            </div>
          </div>

          {/* PROGRESS BAR (DURING EXPORT) */}
          {isExporting && exportProgress && (
            <div className="space-y-2 p-3.5 bg-blue-500/10 border border-blue-500/30 rounded-xl">
              <div className="flex items-center justify-between text-xs text-blue-200">
                <span className="font-bold flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                  Generating & Compiling PDF...
                </span>
                <span className="font-black">
                  {exportProgress.current} / {exportProgress.total} Pages ({Math.round((exportProgress.current / exportProgress.total) * 100)}%)
                </span>
              </div>
              <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-150"
                  style={{ width: `${(exportProgress.current / exportProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

        </div>

        {/* MODAL FOOTER */}
        <div className="px-6 py-4 border-t border-white/[0.08] bg-[#0E111A] flex items-center justify-between flex-wrap gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-30"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2.5 flex-wrap">
            {onApplyToCards && (
              <button
                type="button"
                onClick={() => {
                  onApplyToCards(numPagesPerSheet);
                  onClose();
                }}
                disabled={isExporting}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-extrabold text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 transition-all shadow-sm disabled:opacity-30"
                title="Partition all document pages into sheet cards of this size right in your workspace"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Apply {numPagesPerSheet}-Up to Workspace</span>
              </button>
            )}

            {onQuickDownload && (
              <button
                type="button"
                onClick={onQuickDownload}
                disabled={isExporting}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-300 bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 transition-all disabled:opacity-30"
                title="Bypass layout and directly download standard 1-page A4 PDF"
              >
                Quick 1-Page PDF
              </button>
            )}

            <button
              type="button"
              onClick={handleStartExport}
              disabled={isExporting}
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-extrabold rounded-xl text-xs transition-all shadow-lg shadow-blue-600/30 disabled:opacity-50"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Compiling PDF...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Convert & Download PDF (~{estimatedSheets} Sheets)</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

export default PdfLayoutModal;
