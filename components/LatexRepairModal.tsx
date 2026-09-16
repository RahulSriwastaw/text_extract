import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  X, Sparkles, Check, RefreshCw, AlertTriangle, CheckCircle2, 
  HelpCircle, Eye, Code, ArrowRight, CornerDownLeft, Undo2, 
  Wand2, Sigma, ShieldAlert, SplitSquareVertical, Columns
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MockTestMcqItem, LatexRepairScope, LatexRepairStatus, LatexRepairResponse } from '../types';
import { LatexRenderer } from './LatexRenderer';
import { repairLatexViaApi, validateFormulaClient } from '../services/latexRepairService';

interface LatexRepairModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: MockTestMcqItem;
  initialScope?: LatexRepairScope;
  onApply: (repairedItem: MockTestMcqItem) => void;
}

const MATH_CHIPS = [
  { label: '\\frac{a}{b}', snippet: '\\frac{a}{b}' },
  { label: '\\sqrt{x}', snippet: '\\sqrt{x}' },
  { label: '\\sqrt[n]{x}', snippet: '\\sqrt[n]{x}' },
  { label: 'x^{2}', snippet: 'x^{2}' },
  { label: 'x_{i}', snippet: 'x_{i}' },
  { label: '\\times', snippet: '\\times ' },
  { label: '\\div', snippet: '\\div ' },
  { label: '\\pm', snippet: '\\pm ' },
  { label: '\\approx', snippet: '\\approx ' },
  { label: '\\neq', snippet: '\\neq ' },
  { label: '\\le', snippet: '\\le ' },
  { label: '\\ge', snippet: '\\ge ' },
  { label: '\\degree', snippet: '^\\circ' },
  { label: '\\pi', snippet: '\\pi ' },
  { label: '\\theta', snippet: '\\theta ' },
  { label: '\\alpha', snippet: '\\alpha ' },
  { label: '\\beta', snippet: '\\beta ' },
  { label: '→', snippet: '\\rightarrow ' },
  { label: '⇒', snippet: '\\Rightarrow ' },
  { label: '$...$', snippet: '$formula$' },
  { label: '$$...$$', snippet: '$$formula$$' }
];

export const LatexRepairModal: React.FC<LatexRepairModalProps> = ({
  isOpen,
  onClose,
  item,
  initialScope = 'entire_mcq',
  onApply
}) => {
  const [scope, setScope] = useState<LatexRepairScope>(initialScope);
  const [loading, setLoading] = useState(false);
  const [repairResult, setRepairResult] = useState<LatexRepairResponse | null>(null);
  const [workingItem, setWorkingItem] = useState<MockTestMcqItem>({ ...item });
  const [viewMode, setViewMode] = useState<'split' | 'before' | 'after'>('split');
  const [showRawCode, setShowRawCode] = useState(false);
  const [activeFieldTab, setActiveFieldTab] = useState<'question' | 'options' | 'solution'>('question');

  // Manual Editor state
  const [manualField, setManualField] = useState<keyof MockTestMcqItem>('question_hi');
  const [manualText, setManualText] = useState('');
  const manualInputRef = useRef<HTMLTextAreaElement | null>(null);

  // Sync state when modal opens or item changes
  useEffect(() => {
    if (isOpen) {
      setWorkingItem({ ...item });
      setScope(initialScope);
      setRepairResult(null);
      runRepair(initialScope, item);
    }
  }, [isOpen, item.id]);

  // Sync manual editor text when manualField or workingItem changes
  useEffect(() => {
    const val = String(workingItem[manualField] || '');
    setManualText(val);
  }, [manualField, workingItem]);

  // Run repair action
  const runRepair = async (targetScope: LatexRepairScope, sourceItem: MockTestMcqItem) => {
    setLoading(true);
    try {
      const response = await repairLatexViaApi({
        item: sourceItem,
        scope: targetScope
      });
      setRepairResult(response);
      if (response.repairedItem) {
        setWorkingItem(response.repairedItem);
      }
    } catch (err: any) {
      setRepairResult({
        status: 'review_required',
        original: JSON.stringify(sourceItem, null, 2),
        repaired: JSON.stringify(sourceItem, null, 2),
        changes: [`Repair request failed: ${err.message || 'Unknown network error'}. You can inspect and edit formulas manually below.`],
        confidence: 0,
        repairedItem: sourceItem,
        error: err.message
      });
    } finally {
      setLoading(false);
    }
  };

  // Real-time client KaTeX validation on manual editor text
  const manualValidation = useMemo(() => {
    return validateFormulaClient(manualText);
  }, [manualText]);

  // Handle manual text changes
  const handleManualTextChange = (newVal: string) => {
    setManualText(newVal);
    setWorkingItem(prev => ({
      ...prev,
      [manualField]: newVal
    }));
  };

  // Insert formula snippet into manual editor
  const insertSnippet = (snippet: string) => {
    const el = manualInputRef.current;
    if (!el) {
      handleManualTextChange(manualText + snippet);
      return;
    }
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    const updated = manualText.substring(0, start) + snippet + manualText.substring(end);
    handleManualTextChange(updated);
    setTimeout(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    }, 20);
  };

  if (!isOpen) return null;

  const currentStatus: LatexRepairStatus = repairResult?.status || 'valid';
  const confidencePercent = Math.round((repairResult?.confidence || 1.0) * 100);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative w-full max-w-5xl max-h-[92vh] flex flex-col bg-gradient-to-b from-[#18181B] to-[#121214] border border-white/15 rounded-2xl shadow-2xl shadow-black/80 overflow-hidden text-slate-100"
        >
          {/* Top Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.03]">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-tr from-amber-500/20 to-orange-500/20 border border-amber-500/30 text-amber-300">
                <Sigma className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold tracking-wide text-white">
                    AI LaTeX Formula Repair
                  </h3>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-white/10 text-slate-300 border border-white/10">
                    Q#{item.question_r || 1}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Inspect, repair, and live-preview LaTeX formulas & math delimiters without altering content.
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Scope Selection Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 bg-black/40 border-b border-white/10 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 font-bold mr-1">Scope:</span>
              {(['entire_mcq', 'question', 'options', 'solution'] as LatexRepairScope[]).map(sc => (
                <button
                  key={sc}
                  onClick={() => {
                    setScope(sc);
                    runRepair(sc, item);
                  }}
                  disabled={loading}
                  className={`px-3 py-1 rounded-lg font-bold capitalize transition-all ${
                    scope === sc
                      ? 'bg-amber-500 text-black shadow-md shadow-amber-500/20'
                      : 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/5'
                  }`}
                >
                  {sc.replace('_', ' ')}
                </button>
              ))}
            </div>

            {/* View Mode Toggles */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowRawCode(!showRawCode)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-colors ${
                  showRawCode
                    ? 'bg-purple-500/20 border-purple-500/40 text-purple-300'
                    : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200'
                }`}
                title="Toggle raw LaTeX code display"
              >
                <Code className="w-3.5 h-3.5" />
                <span>{showRawCode ? 'LaTeX Source' : 'Formatted Preview'}</span>
              </button>

              <div className="flex items-center p-0.5 rounded-lg bg-white/5 border border-white/10">
                <button
                  onClick={() => setViewMode('split')}
                  className={`px-2 py-0.5 rounded text-xs font-bold ${
                    viewMode === 'split' ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Side-by-side comparison"
                >
                  <Columns className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setViewMode('before')}
                  className={`px-2 py-0.5 rounded text-xs font-bold ${
                    viewMode === 'before' ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Before
                </button>
                <button
                  onClick={() => setViewMode('after')}
                  className={`px-2 py-0.5 rounded text-xs font-bold ${
                    viewMode === 'after' ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  After
                </button>
              </div>
            </div>
          </div>

          {/* Status & Confidence Banner */}
          <div className="px-6 py-2.5 border-b border-white/10 bg-white/[0.01]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {currentStatus === 'valid' && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>KaTeX Valid — Math syntax is valid & clean</span>
                  </div>
                )}
                {currentStatus === 'fixed' && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-xs font-bold">
                    <Sparkles className="w-4 h-4 text-cyan-400" />
                    <span>AI Repaired — Syntax normalized to KaTeX</span>
                  </div>
                )}
                {currentStatus === 'review_required' && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-bold">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span>Review Required — Verify formula or edit manually below</span>
                  </div>
                )}

                <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-white/5 px-2 py-1 rounded-lg">
                  <span className="font-medium">Confidence:</span>
                  <span className="font-extrabold text-slate-200">{confidencePercent}%</span>
                  <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${
                        confidencePercent >= 90 ? 'bg-emerald-400' : confidencePercent >= 70 ? 'bg-amber-400' : 'bg-red-400'
                      }`}
                      style={{ width: `${confidencePercent}%` }}
                    />
                  </div>
                </div>
              </div>

              <button
                onClick={() => runRepair(scope, item)}
                disabled={loading}
                className="flex items-center gap-1.5 text-xs font-bold text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>{loading ? 'Analyzing...' : 'Re-Run Repair'}</span>
              </button>
            </div>

            {/* Changes list if present */}
            {repairResult?.changes && repairResult.changes.length > 0 && (
              <div className="mt-2 text-xs text-slate-300 bg-black/30 p-2 rounded-lg border border-white/5 space-y-1">
                <span className="font-bold text-slate-400 uppercase text-[10px] tracking-wider block">Detected Changes & Fixes:</span>
                <ul className="list-disc list-inside space-y-0.5 text-slate-300">
                  {repairResult.changes.map((c, i) => (
                    <li key={i} className="leading-snug">{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Main Scrollable Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Section tabs for field selection */}
            <div className="flex items-center gap-2 border-b border-white/10 pb-2">
              <button
                type="button"
                onClick={() => setActiveFieldTab('question')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  activeFieldTab === 'question'
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Questions (Hindi & English)
              </button>
              <button
                type="button"
                onClick={() => setActiveFieldTab('options')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  activeFieldTab === 'options'
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Options (1, 2, 3, 4)
              </button>
              <button
                type="button"
                onClick={() => setActiveFieldTab('solution')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  activeFieldTab === 'solution'
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Solutions (Hindi & English)
              </button>
            </div>

            {/* Side-by-Side / Before-After Comparison Container */}
            <div className={`grid gap-4 ${viewMode === 'split' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
              {/* ORIGINAL / BEFORE */}
              {(viewMode === 'split' || viewMode === 'before') && (
                <div className="flex flex-col bg-black/40 border border-white/10 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between pb-2 mb-3 border-b border-white/10">
                    <span className="text-xs font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-slate-500" />
                      Original (Before)
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">Unmodified</span>
                  </div>

                  <div className="space-y-4 text-xs">
                    {activeFieldTab === 'question' && (
                      <>
                        <div>
                          <span className="text-[11px] font-bold text-amber-400 block mb-1">Hindi Question:</span>
                          {showRawCode ? (
                            <pre className="p-2.5 bg-black/80 rounded border border-white/10 font-mono text-[11px] text-amber-200/80 whitespace-pre-wrap break-all">
                              {item.question_hi || '(Empty)'}
                            </pre>
                          ) : (
                            <div className="p-2.5 bg-white/[0.02] rounded border border-white/5">
                              <LatexRenderer content={item.question_hi || '<p>खाली प्रश्न</p>'} />
                            </div>
                          )}
                        </div>
                        <div>
                          <span className="text-[11px] font-bold text-blue-400 block mb-1">English Question:</span>
                          {showRawCode ? (
                            <pre className="p-2.5 bg-black/80 rounded border border-white/10 font-mono text-[11px] text-blue-200/80 whitespace-pre-wrap break-all">
                              {item.question_en || '(Empty)'}
                            </pre>
                          ) : (
                            <div className="p-2.5 bg-white/[0.02] rounded border border-white/5">
                              <LatexRenderer content={item.question_en || '<p>Empty question</p>'} />
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    {activeFieldTab === 'options' && (
                      <div className="space-y-2">
                        {[1, 2, 3, 4].map(idx => {
                          const kHi = `option${idx}_hi` as keyof MockTestMcqItem;
                          const kEn = `option${idx}_en` as keyof MockTestMcqItem;
                          return (
                            <div key={idx} className="p-2 rounded bg-white/[0.02] border border-white/5">
                              <span className="font-bold text-slate-400 block mb-0.5">Option {idx}:</span>
                              <div className="text-slate-300">
                                {showRawCode ? (
                                  <div className="font-mono text-[11px] text-slate-400">
                                    <div>HI: {String(item[kHi] || '')}</div>
                                    <div>EN: {String(item[kEn] || '')}</div>
                                  </div>
                                ) : (
                                  <div className="space-y-1">
                                    <LatexRenderer content={String(item[kHi] || '')} inline={true} />
                                    {item[kEn] && <div className="text-slate-400"><LatexRenderer content={String(item[kEn])} inline={true} /></div>}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {activeFieldTab === 'solution' && (
                      <>
                        <div>
                          <span className="text-[11px] font-bold text-amber-400 block mb-1">Hindi Solution:</span>
                          {showRawCode ? (
                            <pre className="p-2.5 bg-black/80 rounded border border-white/10 font-mono text-[11px] text-amber-200/80 whitespace-pre-wrap break-all">
                              {item.solution_hi || '(Empty)'}
                            </pre>
                          ) : (
                            <div className="p-2.5 bg-white/[0.02] rounded border border-white/5">
                              <LatexRenderer content={item.solution_hi || '<p>हल उपलब्ध नहीं</p>'} />
                            </div>
                          )}
                        </div>
                        <div>
                          <span className="text-[11px] font-bold text-blue-400 block mb-1">English Solution:</span>
                          {showRawCode ? (
                            <pre className="p-2.5 bg-black/80 rounded border border-white/10 font-mono text-[11px] text-blue-200/80 whitespace-pre-wrap break-all">
                              {item.solution_en || '(Empty)'}
                            </pre>
                          ) : (
                            <div className="p-2.5 bg-white/[0.02] rounded border border-white/5">
                              <LatexRenderer content={item.solution_en || '<p>Solution not available</p>'} />
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* REPAIRED / AFTER */}
              {(viewMode === 'split' || viewMode === 'after') && (
                <div className="flex flex-col bg-emerald-950/10 border border-emerald-500/20 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between pb-2 mb-3 border-b border-emerald-500/20">
                    <span className="text-xs font-extrabold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      Suggested Repair (After)
                    </span>
                    <span className="text-[10px] text-emerald-400 font-mono font-bold">KaTeX Standard</span>
                  </div>

                  <div className="space-y-4 text-xs">
                    {activeFieldTab === 'question' && (
                      <>
                        <div>
                          <span className="text-[11px] font-bold text-amber-400 block mb-1">Hindi Question:</span>
                          {showRawCode ? (
                            <pre className="p-2.5 bg-black/80 rounded border border-emerald-500/20 font-mono text-[11px] text-amber-200 whitespace-pre-wrap break-all">
                              {workingItem.question_hi || '(Empty)'}
                            </pre>
                          ) : (
                            <div className="p-2.5 bg-emerald-500/[0.03] rounded border border-emerald-500/20">
                              <LatexRenderer content={workingItem.question_hi || '<p>खाली प्रश्न</p>'} />
                            </div>
                          )}
                        </div>
                        <div>
                          <span className="text-[11px] font-bold text-blue-400 block mb-1">English Question:</span>
                          {showRawCode ? (
                            <pre className="p-2.5 bg-black/80 rounded border border-emerald-500/20 font-mono text-[11px] text-blue-200 whitespace-pre-wrap break-all">
                              {workingItem.question_en || '(Empty)'}
                            </pre>
                          ) : (
                            <div className="p-2.5 bg-emerald-500/[0.03] rounded border border-emerald-500/20">
                              <LatexRenderer content={workingItem.question_en || '<p>Empty question</p>'} />
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    {activeFieldTab === 'options' && (
                      <div className="space-y-2">
                        {[1, 2, 3, 4].map(idx => {
                          const kHi = `option${idx}_hi` as keyof MockTestMcqItem;
                          const kEn = `option${idx}_en` as keyof MockTestMcqItem;
                          return (
                            <div key={idx} className="p-2 rounded bg-emerald-500/[0.03] border border-emerald-500/20">
                              <span className="font-bold text-emerald-300 block mb-0.5">Option {idx}:</span>
                              <div className="text-slate-200">
                                {showRawCode ? (
                                  <div className="font-mono text-[11px] text-emerald-200/90">
                                    <div>HI: {String(workingItem[kHi] || '')}</div>
                                    <div>EN: {String(workingItem[kEn] || '')}</div>
                                  </div>
                                ) : (
                                  <div className="space-y-1">
                                    <LatexRenderer content={String(workingItem[kHi] || '')} inline={true} />
                                    {workingItem[kEn] && <div className="text-slate-300"><LatexRenderer content={String(workingItem[kEn])} inline={true} /></div>}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {activeFieldTab === 'solution' && (
                      <>
                        <div>
                          <span className="text-[11px] font-bold text-amber-400 block mb-1">Hindi Solution:</span>
                          {showRawCode ? (
                            <pre className="p-2.5 bg-black/80 rounded border border-emerald-500/20 font-mono text-[11px] text-amber-200 whitespace-pre-wrap break-all">
                              {workingItem.solution_hi || '(Empty)'}
                            </pre>
                          ) : (
                            <div className="p-2.5 bg-emerald-500/[0.03] rounded border border-emerald-500/20">
                              <LatexRenderer content={workingItem.solution_hi || '<p>हल उपलब्ध नहीं</p>'} />
                            </div>
                          )}
                        </div>
                        <div>
                          <span className="text-[11px] font-bold text-blue-400 block mb-1">English Solution:</span>
                          {showRawCode ? (
                            <pre className="p-2.5 bg-black/80 rounded border border-emerald-500/20 font-mono text-[11px] text-blue-200 whitespace-pre-wrap break-all">
                              {workingItem.solution_en || '(Empty)'}
                            </pre>
                          ) : (
                            <div className="p-2.5 bg-emerald-500/[0.03] rounded border border-emerald-500/20">
                              <LatexRenderer content={workingItem.solution_en || '<p>Solution not available</p>'} />
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* MANUAL FORMULA EDITOR SECTION */}
            <div className="p-4 rounded-xl bg-black/50 border border-white/10 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-indigo-500/20 border border-indigo-500/30 text-indigo-300">
                    <Code className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-extrabold text-white uppercase tracking-wider">
                      Interactive Manual Formula Editor
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Directly edit LaTeX formulas and see live KaTeX validation in real time.
                    </p>
                  </div>
                </div>

                {/* Field selector for manual editor */}
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-slate-400 font-bold">Edit Target:</span>
                  <select
                    value={manualField}
                    onChange={(e) => setManualField(e.target.value as keyof MockTestMcqItem)}
                    className="px-2.5 py-1 rounded bg-black/80 border border-white/15 text-slate-200 font-medium text-xs focus:outline-none focus:border-amber-500"
                  >
                    <option value="question_hi">Question (Hindi)</option>
                    <option value="question_en">Question (English)</option>
                    <option value="option1_hi">Option 1 (Hindi)</option>
                    <option value="option2_hi">Option 2 (Hindi)</option>
                    <option value="option3_hi">Option 3 (Hindi)</option>
                    <option value="option4_hi">Option 4 (Hindi)</option>
                    <option value="option1_en">Option 1 (English)</option>
                    <option value="option2_en">Option 2 (English)</option>
                    <option value="option3_en">Option 3 (English)</option>
                    <option value="option4_en">Option 4 (English)</option>
                    <option value="solution_hi">Solution (Hindi)</option>
                    <option value="solution_en">Solution (English)</option>
                  </select>
                </div>
              </div>

              {/* Quick Math Symbol Insertion Chips */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 mr-1">Quick Palette:</span>
                {MATH_CHIPS.map((chip, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => insertSnippet(chip.snippet)}
                    className="px-2 py-0.5 rounded bg-white/5 hover:bg-amber-500/20 hover:text-amber-300 border border-white/10 hover:border-amber-500/40 text-[11px] font-mono text-slate-300 transition-colors"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              {/* Editor Textarea */}
              <div className="space-y-1">
                <textarea
                  ref={manualInputRef}
                  value={manualText}
                  onChange={(e) => handleManualTextChange(e.target.value)}
                  rows={3}
                  className="w-full p-2.5 rounded-lg bg-black/90 border border-white/15 text-slate-100 font-mono text-xs focus:outline-none focus:border-amber-500 transition-all resize-y"
                  placeholder="Enter or edit LaTeX formulas with $...$ or $$...$$"
                />
              </div>

              {/* Live Render & Real-time Validation Box */}
              <div className="flex flex-col md:flex-row gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/10">
                <div className="flex-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Live KaTeX Render:
                  </span>
                  <div className="min-h-[36px] flex items-center p-2 rounded bg-black/50 border border-white/5 text-xs text-slate-200">
                    <LatexRenderer content={manualText || '<span class="text-slate-500 italic">No content</span>'} />
                  </div>
                </div>

                <div className="w-full md:w-64 flex flex-col justify-center">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Syntax Validation:
                  </span>
                  {manualValidation.valid ? (
                    <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-2 rounded border border-emerald-500/20">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>KaTeX syntax valid</span>
                    </div>
                  ) : (
                    <div className="flex items-start gap-1.5 text-xs font-medium text-red-400 bg-red-500/10 px-2.5 py-1.5 rounded border border-red-500/20 break-words">
                      <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
                      <span className="leading-snug">{manualValidation.error}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 bg-white/[0.03]">
            <div className="text-xs text-slate-400 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
              <span>Original content will be backed up for 1-click Undo.</span>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
              >
                Reject / Cancel
              </button>

              <button
                type="button"
                onClick={() => {
                  onApply(workingItem);
                  onClose();
                }}
                disabled={loading}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-extrabold bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-black shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                <span>Apply Repair</span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
