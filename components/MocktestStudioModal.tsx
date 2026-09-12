import React, { useState, useMemo, useRef } from 'react';
import { 
  X, Download, Sparkles, Plus, Trash2, Copy, Check, FileSpreadsheet, 
  Upload, Eye, Edit3, ChevronDown, ChevronUp, AlertCircle, AlertTriangle,
  CheckCircle2, Loader2, BookOpen, Layers, ArrowUpDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MockTestMcqItem, QuestionType, DifficultyLevel } from '../types';
import { 
  downloadMockTestCsv, 
  serializeMockTestToCsv, 
  parseCsvToMockTestItems, 
  generateDeepSolutionForItem,
  ensureHtmlParagraph,
  STANDARD_SUBJECTS,
  normalizeStrictSubject,
  detectItemFieldIssues,
  autoRecoverItemOptionsFromStem,
  repairMockTestItemWithAi
} from '../services/mocktestService';

interface MocktestStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialItems?: MockTestMcqItem[];
  defaultSetName?: string;
}

export const MocktestStudioModal: React.FC<MocktestStudioModalProps> = ({
  isOpen,
  onClose,
  initialItems = [],
  defaultSetName = 'Exam Mock Test 01'
}) => {
  const [items, setItems] = useState<MockTestMcqItem[]>(initialItems);
  const [setName, setSetName] = useState<string>(defaultSetName);
  const [answerFormat, setAnswerFormat] = useState<'letters' | 'numbers'>('letters');
  const [activeTab, setActiveTab] = useState<'cards' | 'table'>('cards');
  const [langView, setLangView] = useState<'split' | 'hi' | 'en'>('split');
  const [solvingId, setSolvingId] = useState<string | null>(null);
  const [isSolvingAll, setIsSolvingAll] = useState(false);
  const [solveProgress, setSolveProgress] = useState<{ current: number; total: number } | null>(null);
  const [repairingId, setRepairingId] = useState<string | null>(null);
  const [isRepairingAll, setIsRepairingAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedDifficulty, setSelectedDifficulty] = useState<DifficultyLevel>('medium');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync initialItems if provided and local items are empty
  React.useEffect(() => {
    if (initialItems && initialItems.length > 0) {
      setItems(initialItems);
    }
  }, [initialItems]);

  const handleAddQuestion = () => {
    const nextNum = items.length + 1;
    const newItem: MockTestMcqItem = {
      id: `mt_manual_${Date.now()}`,
      question_r: nextNum,
      question_type: 'MCQ',
      question_hi: '<p>नया प्रश्न यहाँ लिखें...</p>',
      option1_hi: '<p>विकल्प A</p>',
      option2_hi: '<p>विकल्प B</p>',
      option3_hi: '<p>विकल्प C</p>',
      option4_hi: '<p>विकल्प D</p>',
      option5_hi: '',
      solution_hi: '<p>विस्तृत विवरण...</p>',
      question_en: '<p>Enter new question here...</p>',
      option1_en: '<p>Option A</p>',
      option2_en: '<p>Option B</p>',
      option3_en: '<p>Option C</p>',
      option4_en: '<p>Option D</p>',
      option5_en: '',
      solution_en: '<p>Detailed explanation and proof...</p>',
      answer: answerFormat === 'letters' ? 'A' : '1',
      set_name: setName,
      difficulty_level: selectedDifficulty,
      test_date: '',
      test_time: '',
      subject: 'Current Affairs',
      subject_level: 'RRB Level 01 Stage I 2025',
      figure_notes: '',
      correction_notes: '',
      source_pdf: '',
      source_pages: '1',
      source_question_reference: `Q.${nextNum}`,
      latex_check: 'checked',
      html_check: 'checked',
      answer_check: 'checked',
      solution_check: 'checked',
      hash_figure: '',
      manually_review: 'checked',
      duplicate_statistics: 'Unique within this shift; duplicate check completed.'
    };
    setItems(prev => [...prev, newItem]);
  };

  const handleUpdateItem = (id: string, updates: Partial<MockTestMcqItem>) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  const handleDeleteItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id).map((item, idx) => ({
      ...item,
      question_r: idx + 1
    })));
  };

  const handleBulkDifficulty = (diff: DifficultyLevel) => {
    setSelectedDifficulty(diff);
    setItems(prev => prev.map(item => ({ ...item, difficulty_level: diff })));
  };

  const handleBulkSetName = (name: string) => {
    setSetName(name);
    setItems(prev => prev.map(item => ({ ...item, set_name: name })));
  };

  // Repair single question with AI
  const handleAiRepairSingle = async (item: MockTestMcqItem) => {
    setRepairingId(item.id);
    try {
      const repaired = await repairMockTestItemWithAi(item);
      handleUpdateItem(item.id, repaired);
    } catch (e: any) {
      alert(`AI Repair failed: ${e?.message || e}`);
    } finally {
      setRepairingId(null);
    }
  };

  // Auto-repair all incomplete questions sequentially
  const handleAiRepairAllIncomplete = async () => {
    const targets = items.filter(it => detectItemFieldIssues(it).hasIssues);
    if (targets.length === 0) {
      alert('All questions already have complete options and solutions!');
      return;
    }
    setIsRepairingAll(true);
    for (const item of targets) {
      setRepairingId(item.id);
      try {
        const repaired = await repairMockTestItemWithAi(item);
        handleUpdateItem(item.id, repaired);
      } catch (e) {
        console.warn(`Repair failed for Q${item.question_r}:`, e);
      }
      await new Promise(r => setTimeout(r, 400));
    }
    setIsRepairingAll(false);
    setRepairingId(null);
  };

  // Solve single question with AI
  const handleSolveSingle = async (item: MockTestMcqItem) => {
    setSolvingId(item.id);
    try {
      const res = await generateDeepSolutionForItem(item);
      handleUpdateItem(item.id, {
        solution_hi: res.solution_hi || item.solution_hi,
        solution_en: res.solution_en || item.solution_en,
        difficulty_level: res.difficulty_level || item.difficulty_level
      });
    } catch (e: any) {
      alert(`AI Solve failed: ${e?.message || e}`);
    } finally {
      setSolvingId(null);
    }
  };

  // Auto-generate solutions for all questions sequentially
  const handleSolveAll = async () => {
    if (items.length === 0) return;
    setIsSolvingAll(true);
    setSolveProgress({ current: 0, total: items.length });

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setSolveProgress({ current: i + 1, total: items.length });
      try {
        const res = await generateDeepSolutionForItem(item);
        setItems(prev => prev.map(p => p.id === item.id ? {
          ...p,
          solution_hi: res.solution_hi || p.solution_hi,
          solution_en: res.solution_en || p.solution_en,
          difficulty_level: res.difficulty_level || p.difficulty_level
        } : p));
      } catch (e) {
        console.warn(`Failed solving Q${i + 1}:`, e);
      }
      // Brief pause between calls
      await new Promise(r => setTimeout(r, 600));
    }

    setIsSolvingAll(false);
    setSolveProgress(null);
  };

  const handleCopyCsv = () => {
    const csv = serializeMockTestToCsv(items, answerFormat);
    navigator.clipboard.writeText(csv);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const cleanFileName = (setName || 'mocktest').replace(/[^a-zA-Z0-9_-]/g, '_');
    downloadMockTestCsv(items, cleanFileName, answerFormat);
  };

  const handleImportCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      if (text) {
        const parsed = parseCsvToMockTestItems(text, setName);
        if (parsed.length > 0) {
          setItems(parsed);
          alert(`Successfully imported ${parsed.length} questions from CSV!`);
        } else {
          alert('Could not parse any valid questions from the selected CSV file.');
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-md">
        <motion.div 
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          className="relative w-full max-w-7xl h-[94vh] bg-[#0E111A] border border-white/[0.08] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-200"
        >
          {/* Header Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-white/[0.08] bg-white/[0.02]">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#FF6B2B] to-[#FF884D] flex items-center justify-center shadow-lg shadow-[#FF6B2B]/20">
                <FileSpreadsheet className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                  MockTest MCQ Studio
                  <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[10px] font-bold rounded-full uppercase tracking-wider">
                    18-Field CSV Format
                  </span>
                </h2>
                <p className="text-[11px] text-slate-400">
                  Bilingual HTML & LaTeX MCQs, step-by-step deep explanations, RFC 4180 CSV export
                </p>
              </div>
            </div>

            {/* Quick Actions & Close */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyCsv}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-xl text-xs font-semibold transition-all"
                title="Copy entire CSV to clipboard"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
                {copied ? 'Copied CSV' : 'Copy CSV'}
              </button>

              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-600/20 transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                Download CSV ({items.length})
              </button>

              <button
                onClick={onClose}
                className="p-1.5 hover:bg-white/[0.08] text-slate-400 hover:text-white rounded-xl transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Sub-toolbar / Settings Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 bg-white/[0.01] border-b border-white/[0.06] text-xs">
            <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
              {/* Set Name Input */}
              <div className="flex items-center gap-2 bg-white/[0.03] border border-white/[0.08] px-2.5 py-1 rounded-xl">
                <span className="text-[10px] uppercase font-bold text-slate-500">Set Name:</span>
                <input
                  type="text"
                  value={setName}
                  onChange={(e) => handleBulkSetName(e.target.value)}
                  className="bg-transparent text-white font-medium text-xs focus:outline-none w-48 sm:w-64"
                  placeholder="e.g. RRB NTPC CBT 1 Mock 01"
                />
              </div>

              {/* Bulk Difficulty Selector */}
              <div className="flex items-center gap-2 bg-white/[0.03] border border-white/[0.08] px-2.5 py-1 rounded-xl">
                <span className="text-[10px] uppercase font-bold text-slate-500">Difficulty:</span>
                <select
                  value={selectedDifficulty}
                  onChange={(e) => handleBulkDifficulty(e.target.value as DifficultyLevel)}
                  className="bg-transparent text-white font-medium text-xs focus:outline-none cursor-pointer"
                >
                  <option value="easy" className="bg-slate-900 text-slate-200">Easy</option>
                  <option value="medium" className="bg-slate-900 text-slate-200">Medium</option>
                  <option value="hard" className="bg-slate-900 text-slate-200">Hard</option>
                </select>
              </div>

              {/* Answer Key Format: Letters vs Numbers */}
              <div className="flex items-center gap-1.5 bg-white/[0.03] border border-white/[0.08] p-0.5 rounded-xl">
                <span className="text-[10px] uppercase font-bold text-slate-500 px-2">Answer Key:</span>
                <button
                  onClick={() => setAnswerFormat('letters')}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all ${answerFormat === 'letters' ? 'bg-[#FF6B2B] text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
                >
                  A, B, C, D
                </button>
                <button
                  onClick={() => setAnswerFormat('numbers')}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all ${answerFormat === 'numbers' ? 'bg-[#FF6B2B] text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
                >
                  1, 2, 3, 4
                </button>
              </div>
            </div>

            {/* Right side controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleSolveAll}
                disabled={isSolvingAll || items.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-[#FF6B2B] to-[#FF884D] hover:from-[#FF5500] hover:to-[#FF7733] text-white rounded-xl text-xs font-bold shadow-lg shadow-[#FF6B2B]/20 transition-all disabled:opacity-50"
              >
                {isSolvingAll ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Solving {solveProgress?.current}/{solveProgress?.total}...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    Auto-Solve All (AI)
                  </>
                )}
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.08] text-slate-300 rounded-xl text-xs font-medium transition-all"
                title="Import existing CSV"
              >
                <Upload className="w-3.5 h-3.5 text-blue-400" />
                Import CSV
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleImportCsv}
                className="hidden"
              />

              <button
                onClick={handleAddQuestion}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.08] text-slate-300 rounded-xl text-xs font-medium transition-all"
              >
                <Plus className="w-3.5 h-3.5 text-emerald-400" />
                Add Q
              </button>

              {/* View Switcher: Cards vs Table */}
              <div className="flex items-center bg-white/[0.04] p-0.5 rounded-xl border border-white/[0.06]">
                <button
                  onClick={() => setActiveTab('cards')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${activeTab === 'cards' ? 'bg-white/[0.1] text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  Cards ({items.length})
                </button>
                <button
                  onClick={() => setActiveTab('table')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${activeTab === 'table' ? 'bg-white/[0.1] text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  CSV Grid
                </button>
              </div>
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 custom-scrollbar">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-80 gap-3 text-slate-500">
                <BookOpen className="w-12 h-12 text-slate-600" />
                <p className="font-bold text-slate-300 text-sm">No MockTest MCQs Loaded</p>
                <p className="text-xs text-slate-500 max-w-md text-center">
                  You can convert previously scanned pages from the converter into this 18-column format, import an existing CSV, or click 'Add Q' to compose manually.
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={handleAddQuestion}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#FF6B2B] text-white rounded-xl text-xs font-bold shadow-md shadow-[#FF6B2B]/20"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add First Question
                  </button>
                </div>
              </div>
            ) : activeTab === 'table' ? (
              /* CSV Grid View */
              <div className="w-full overflow-x-auto border border-white/[0.08] rounded-xl bg-black/40">
                <table className="w-full text-left text-xs text-slate-300 border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="bg-white/[0.04] border-b border-white/[0.08] text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      <th className="p-2.5">Q#</th>
                      <th className="p-2.5">Subject (Strict)</th>
                      <th className="p-2.5">Level</th>
                      <th className="p-2.5">question_hi</th>
                      <th className="p-2.5">options_hi (1-4)</th>
                      <th className="p-2.5">solution_hi</th>
                      <th className="p-2.5">question_en</th>
                      <th className="p-2.5">options_en (1-4)</th>
                      <th className="p-2.5">solution_en</th>
                      <th className="p-2.5">Ans</th>
                      <th className="p-2.5">Difficulty</th>
                      <th className="p-2.5">Set</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {items.map((item, idx) => (
                      <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="p-2.5 font-bold font-mono text-[#FF884D]">{item.question_r || idx + 1}</td>
                        <td className="p-2.5 font-bold text-amber-300 bg-amber-500/5">{item.subject || 'Current Affairs'}</td>
                        <td className="p-2.5 text-slate-300">{item.subject_level || '—'}</td>
                        <td className="p-2.5 max-w-xs truncate" title={item.question_hi}>{item.question_hi}</td>
                        <td className="p-2.5 max-w-xs truncate">{item.option1_hi} | {item.option2_hi} | {item.option3_hi} | {item.option4_hi}</td>
                        <td className="p-2.5 max-w-xs truncate text-emerald-300" title={item.solution_hi}>{item.solution_hi || '—'}</td>
                        <td className="p-2.5 max-w-xs truncate" title={item.question_en}>{item.question_en}</td>
                        <td className="p-2.5 max-w-xs truncate">{item.option1_en} | {item.option2_en} | {item.option3_en} | {item.option4_en}</td>
                        <td className="p-2.5 max-w-xs truncate text-teal-300" title={item.solution_en}>{item.solution_en || '—'}</td>
                        <td className="p-2.5 font-bold font-mono text-white bg-white/[0.02] text-center">{item.answer}</td>
                        <td className="p-2.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${item.difficulty_level === 'easy' ? 'bg-emerald-500/15 text-emerald-400' : item.difficulty_level === 'hard' ? 'bg-rose-500/15 text-rose-400' : 'bg-amber-500/15 text-amber-400'}`}>
                            {item.difficulty_level}
                          </span>
                        </td>
                        <td className="p-2.5 text-slate-400 truncate max-w-[120px]">{item.set_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              /* Interactive Question Cards View */
              <div className="space-y-4">
                {items.map((item, idx) => {
                  const issues = detectItemFieldIssues(item);
                  const isRepairing = repairingId === item.id;

                  return (
                    <div 
                      key={item.id}
                      className={`glass-panel p-4 rounded-xl border transition-all flex flex-col gap-3 ${
                        issues.hasIssues
                          ? 'border-amber-500/60 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500/30 bg-black/60'
                          : 'border-white/[0.08] hover:border-white/[0.14]'
                      }`}
                    >
                      {/* Top Row: Q Number, Type, Answer, Difficulty, AI Solve, Delete */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-[#FF6B2B]/20 border border-[#FF6B2B]/40 text-[#FF884D] flex items-center justify-center text-xs font-bold font-mono">
                            Q{item.question_r || idx + 1}
                          </div>

                          {/* STRICT ACADEMIC SUBJECT SELECTOR */}
                          <div className="flex items-center gap-1 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-lg text-xs">
                            <span className="text-amber-400 font-bold text-[10px] uppercase">Subject:</span>
                            <select
                              value={item.subject || 'Current Affairs'}
                              onChange={(e) => handleUpdateItem(item.id, { subject: normalizeStrictSubject(e.target.value) })}
                              className="bg-transparent text-amber-300 font-extrabold text-xs focus:outline-none cursor-pointer"
                            >
                              {STANDARD_SUBJECTS.map((s) => (
                                <option key={s} value={s} className="bg-slate-900 text-slate-200">{s}</option>
                              ))}
                            </select>
                          </div>

                          {/* Subject Level */}
                          <div className="flex items-center gap-1 bg-white/[0.04] border border-white/[0.08] px-2 py-0.5 rounded-lg text-xs">
                            <span className="text-slate-400 font-bold text-[10px] uppercase">Level:</span>
                            <input
                              type="text"
                              value={item.subject_level || ''}
                              onChange={(e) => handleUpdateItem(item.id, { subject_level: e.target.value })}
                              placeholder="e.g. RRB Level 01 Stage I 2025"
                              className="bg-transparent text-slate-200 text-xs focus:outline-none w-32 truncate"
                            />
                          </div>

                          {/* Question Type: MCQ / MSQ / NAT */}
                          <select
                            value={item.question_type}
                            onChange={(e) => handleUpdateItem(item.id, { question_type: e.target.value as QuestionType })}
                            className="bg-white/[0.04] border border-white/[0.08] text-white text-[11px] font-bold px-2 py-1 rounded-lg focus:outline-none"
                          >
                            <option value="MCQ" className="bg-slate-900">MCQ (Single Choice)</option>
                            <option value="MSQ" className="bg-slate-900">MSQ (Multi Select)</option>
                            <option value="NAT" className="bg-slate-900">NAT (Numerical)</option>
                          </select>

                          {/* Answer Key Input */}
                          <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-lg">
                            <span className="text-[10px] font-bold text-emerald-400 uppercase">Answer:</span>
                            <input
                              type="text"
                              value={item.answer}
                              onChange={(e) => handleUpdateItem(item.id, { answer: e.target.value })}
                              className="bg-transparent font-bold text-xs text-white w-14 focus:outline-none text-center font-mono"
                              placeholder="e.g. D"
                            />
                          </div>

                          {/* Difficulty Selector */}
                          <select
                            value={item.difficulty_level}
                            onChange={(e) => handleUpdateItem(item.id, { difficulty_level: e.target.value as DifficultyLevel })}
                            className="bg-white/[0.04] border border-white/[0.08] text-[10px] font-bold px-2 py-1 rounded-lg focus:outline-none text-slate-300"
                          >
                            <option value="easy" className="bg-slate-900">Easy</option>
                            <option value="medium" className="bg-slate-900">Medium</option>
                            <option value="hard" className="bg-slate-900">Hard</option>
                          </select>
                        </div>

                        {/* Right Action buttons */}
                        <div className="flex items-center gap-2">
                          {/* AI Auto-Repair / Fill Button */}
                          <button
                            type="button"
                            onClick={() => handleAiRepairSingle(item)}
                            disabled={isRepairing || solvingId === item.id}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-extrabold transition-all disabled:opacity-50 ${
                              issues.hasIssues
                                ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black shadow-md shadow-amber-500/20'
                                : 'bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300'
                            }`}
                            title="Auto-fill missing options and step-by-step solution"
                          >
                            {isRepairing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                            <span>{issues.hasIssues ? '⚡ Auto-Fill' : 'Repair'}</span>
                          </button>

                          <button
                            onClick={() => handleSolveSingle(item)}
                            disabled={solvingId === item.id || isRepairing}
                            className="flex items-center gap-1.5 px-2.5 py-1 bg-gradient-to-r from-blue-600/30 to-indigo-600/30 hover:from-blue-600/50 hover:to-indigo-600/50 border border-blue-500/30 text-blue-300 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                          >
                            {solvingId === item.id ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Solving...
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-3 h-3 text-blue-400" />
                                Generate Deep Solution
                              </>
                            )}
                          </button>

                          <button
                            onClick={() => handleDeleteItem(item.id)}
                            className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                            title="Delete question"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* WARNING MESSAGE BANNER FOR MISSING/BLANK FIELDS */}
                      {issues.hasIssues && (
                        <div className="flex flex-wrap items-center justify-between gap-2.5 p-2.5 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-transparent border border-amber-500/40 rounded-xl text-xs">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 animate-bounce" />
                            <div>
                              <div className="font-extrabold text-amber-300 flex items-center gap-1.5">
                                <span>⚠️ चेतावनी: रिक्त विकल्प व फ़ील्ड (Blank Fields Detected)</span>
                                <span className="px-1.5 py-0.2 rounded bg-amber-500/30 text-amber-200 text-[10px]">Action Required</span>
                              </div>
                              <div className="text-slate-300 text-[11px] mt-0.5 font-medium">
                                {issues.issueSummary} — इस प्रश्न के विकल्प खाली हैं। कृपया <strong>⚡ Auto-Fill</strong> दबाएं।
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAiRepairSingle(item)}
                            disabled={isRepairing}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-extrabold rounded-lg text-xs shadow-md shadow-amber-500/20 transition-all disabled:opacity-50"
                          >
                            {isRepairing ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>AI Filling...</span>
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-3.5 h-3.5 fill-black" />
                                <span>⚡ AI Auto-Fill Missing Fields</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}

                      {/* Bilingual Side-by-Side Editor & Preview */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                        {/* Left: Hindi Side */}
                        <div className="flex flex-col gap-2.5 bg-white/[0.02] p-3 rounded-xl border border-white/[0.04]">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                              Hindi Version (question_hi)
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">HTML & LaTeX</span>
                          </div>

                          {/* Question Text Area */}
                          <textarea
                            rows={3}
                            value={item.question_hi}
                            onChange={(e) => handleUpdateItem(item.id, { question_hi: e.target.value })}
                            placeholder="<p>यहाँ हिंदी प्रश्न लिखें...</p>"
                            className="w-full p-2.5 bg-black/40 border border-white/[0.08] rounded-xl text-xs font-medium text-white focus:outline-none focus:border-[#FF6B2B]/60 custom-scrollbar"
                          />

                          {/* Hindi Options 1 to 4 */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {(['option1_hi', 'option2_hi', 'option3_hi', 'option4_hi'] as const).map((key, optIdx) => {
                              const label = String.fromCharCode(65 + optIdx);
                              const valClean = (item[key] || '').replace(/<[^>]*>/g, '').trim();
                              const isBlank = !valClean || valClean.toLowerCase() === 'blank';

                              return (
                                <div 
                                  key={key} 
                                  className={`flex items-center gap-1.5 p-1.5 rounded-lg border transition-all ${
                                    isBlank 
                                      ? 'bg-amber-500/5 border-dashed border-amber-500/40 text-amber-300' 
                                      : 'bg-black/30 border-white/[0.06]'
                                  }`}
                                >
                                  <span className={`text-[10px] font-bold w-4 text-center font-mono ${isBlank ? 'text-amber-400' : 'text-[#FF884D]'}`}>({label})</span>
                                  <input
                                    type="text"
                                    value={item[key] || ''}
                                    onChange={(e) => handleUpdateItem(item.id, { [key]: e.target.value })}
                                    placeholder={isBlank ? `⚠️ Blank (${label}) - Click AI Auto-Fill` : `विकल्प ${label}`}
                                    className={`bg-transparent text-xs focus:outline-none flex-1 ${isBlank ? 'text-amber-200 placeholder:text-amber-400/80 font-medium' : 'text-slate-200'}`}
                                  />
                                </div>
                              );
                            })}
                          </div>

                          {/* Hindi Solution (Detailed) */}
                          <div className="flex flex-col gap-1 mt-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">
                              Detailed Solution (solution_hi):
                            </span>
                            <textarea
                              rows={3}
                              value={item.solution_hi}
                              onChange={(e) => handleUpdateItem(item.id, { solution_hi: e.target.value })}
                              placeholder="<p>विस्तृत विवरण व गणना...</p>"
                              className="w-full p-2 bg-black/40 border border-white/[0.08] rounded-xl text-xs text-emerald-300 focus:outline-none focus:border-emerald-500/60 custom-scrollbar"
                            />
                          </div>
                        </div>

                        {/* Right: English Side */}
                        <div className="flex flex-col gap-2.5 bg-white/[0.02] p-3 rounded-xl border border-white/[0.04]">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                              English Version (question_en)
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">HTML & LaTeX</span>
                          </div>

                          {/* English Question Text Area */}
                          <textarea
                            rows={3}
                            value={item.question_en}
                            onChange={(e) => handleUpdateItem(item.id, { question_en: e.target.value })}
                            placeholder="<p>Write English question here...</p>"
                            className="w-full p-2.5 bg-black/40 border border-white/[0.08] rounded-xl text-xs font-medium text-white focus:outline-none focus:border-[#FF6B2B]/60 custom-scrollbar"
                          />

                          {/* English Options 1 to 4 */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {(['option1_en', 'option2_en', 'option3_en', 'option4_en'] as const).map((key, optIdx) => {
                              const label = String.fromCharCode(65 + optIdx);
                              const valClean = (item[key] || '').replace(/<[^>]*>/g, '').trim();
                              const isBlank = !valClean || valClean.toLowerCase() === 'blank';

                              return (
                                <div 
                                  key={key} 
                                  className={`flex items-center gap-1.5 p-1.5 rounded-lg border transition-all ${
                                    isBlank 
                                      ? 'bg-amber-500/5 border-dashed border-amber-500/40 text-amber-300' 
                                      : 'bg-black/30 border-white/[0.06]'
                                  }`}
                                >
                                  <span className={`text-[10px] font-bold w-4 text-center font-mono ${isBlank ? 'text-amber-400' : 'text-[#FF884D]'}`}>({label})</span>
                                  <input
                                    type="text"
                                    value={item[key] || ''}
                                    onChange={(e) => handleUpdateItem(item.id, { [key]: e.target.value })}
                                    placeholder={isBlank ? `⚠️ Blank (${label}) - Click AI Auto-Fill` : `Option ${label}`}
                                    className={`bg-transparent text-xs focus:outline-none flex-1 ${isBlank ? 'text-amber-200 placeholder:text-amber-400/80 font-medium' : 'text-slate-200'}`}
                                  />
                                </div>
                              );
                            })}
                          </div>

                          {/* English Solution (Detailed) */}
                          <div className="flex flex-col gap-1 mt-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">
                              Detailed Solution (solution_en):
                            </span>
                            <textarea
                              rows={3}
                              value={item.solution_en}
                              onChange={(e) => handleUpdateItem(item.id, { solution_en: e.target.value })}
                              placeholder="<p>Step-by-step derivation & formulas...</p>"
                              className="w-full p-2 bg-black/40 border border-white/[0.08] rounded-xl text-xs text-teal-300 focus:outline-none focus:border-teal-500/60 custom-scrollbar"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer Status Bar */}
          <div className="flex items-center justify-between px-5 py-2.5 border-t border-white/[0.08] bg-white/[0.02] text-xs text-slate-400">
            <div className="flex items-center gap-3">
              <span>Total Questions: <strong className="text-white">{items.length}</strong></span>
              <span>With Solutions: <strong className="text-emerald-400">{items.filter(i => i.solution_hi || i.solution_en).length}</strong></span>
              <span>Set Name: <strong className="text-blue-400">{setName}</strong></span>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[11px] text-slate-500">
                UTF-8 BOM + RFC 4180 Escaped for Excel & MockTest Web Applications
              </span>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                Export .CSV
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default MocktestStudioModal;
