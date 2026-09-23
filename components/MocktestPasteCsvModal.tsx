import React, { useState, useMemo, useRef } from 'react';
import { 
  X, 
  FileSpreadsheet, 
  ClipboardPaste, 
  Upload, 
  Check, 
  AlertCircle, 
  Layers, 
  Sparkles, 
  HelpCircle,
  ArrowRight,
  Plus,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  BookOpen,
  FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MockTestMcqItem } from '../types';
import { 
  parseAnyMockTestPastedText,
  parseCsvToMockTestItems, 
  detectMissingQuestionNumbers, 
  mergeOrAppendMockTestItems 
} from '../services/mocktestService';
import { LatexRenderer } from './LatexRenderer';

interface MocktestPasteCsvModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingItems: MockTestMcqItem[];
  setName: string;
  targetPageNumber?: number;
  totalPages?: number;
  onAddItems: (newItems: MockTestMcqItem[], targetPageNumber?: number) => void;
}

const SAMPLE_4_OPTIONS_CSV = `question_r,question_hi,option1_hi,option2_hi,option3_hi,option4_hi,solution_hi,question_en,option1_en,option2_en,option3_en,option4_en,solution_en,answer,subject,difficulty_level
1,"<p>भारत का राष्ट्रीय जलीय जीव कौन सा है?</p>","<p>गंगा डॉल्फिन</p>","<p>मगरमच्छ</p>","<p>घड़ियाल</p>","<p>कछुआ</p>","<p>गंगा नदी की डॉल्फिन भारत का राष्ट्रीय जलीय जीव है।</p>","<p>Which is the national aquatic animal of India?</p>","<p>Ganges River Dolphin</p>","<p>Crocodile</p>","<p>Gharial</p>","<p>Turtle</p>","<p>The Ganges River Dolphin is the national aquatic animal of India.</p>",A,Current Affairs,easy`;

const SAMPLE_5_OPTIONS_CSV = `question_r,question_hi,option1_hi,option2_hi,option3_hi,option4_hi,option5_hi,solution_hi,question_en,option1_en,option2_en,option3_en,option4_en,option5_en,solution_en,answer,subject,difficulty_level
1,"<p>बिहार में 1857 के विद्रोह का नेतृत्व किसने किया था?</p>","<p>नाना साहेब</p>","<p>तात्या टोपे</p>","<p>कुंवर सिंह</p>","<p>रानी लक्ष्मीबाई</p>","<p>उपर्युक्त में से कोई नहीं / उपर्युक्त में से एक से अधिक</p>","<p>वीर कुंवर सिंह ने जगदीशपुर से 1857 के स्वतंत्रता संग्राम का नेतृत्व किया।</p>","<p>Who led the 1857 revolt in Bihar?</p>","<p>Nana Saheb</p>","<p>Tatya Tope</p>","<p>Kunwar Singh</p>","<p>Rani Laxmibai</p>","<p>None of the above / More than one of the above</p>","<p>Veer Kunwar Singh led the revolt from Jagdishpur, Bihar.</p>",C,History,medium`;

export const MocktestPasteCsvModal: React.FC<MocktestPasteCsvModalProps> = ({
  isOpen,
  onClose,
  existingItems,
  setName,
  targetPageNumber,
  totalPages = 1,
  onAddItems
}) => {
  const [csvText, setCsvText] = useState<string>('');
  const [mode, setMode] = useState<'smart_fill' | 'append' | 'replace'>('smart_fill');
  const [selectedPage, setSelectedPage] = useState<number | 'auto'>(targetPageNumber || 'auto');
  const [previewTab, setPreviewTab] = useState<'cards' | 'table' | 'summary'>('cards');
  const [previewLang, setPreviewLang] = useState<'both' | 'hi' | 'en'>('both');
  const [isCsvInputCollapsed, setIsCsvInputCollapsed] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync selectedPage if targetPageNumber changes when modal opens
  React.useEffect(() => {
    if (targetPageNumber) {
      setSelectedPage(targetPageNumber);
    } else {
      setSelectedPage('auto');
    }
  }, [targetPageNumber, isOpen]);

  // Missing gaps in the current set
  const missingGaps = useMemo(() => {
    return detectMissingQuestionNumbers(existingItems);
  }, [existingItems]);

  // Parse input in real-time (supports CSV, TSV, and JSON arrays/objects)
  const parsedItems = useMemo(() => {
    if (!csvText.trim()) return [];
    try {
      return parseAnyMockTestPastedText(csvText, setName);
    } catch {
      return [];
    }
  }, [csvText, setName]);

  // Count 5-option items (only when actual Option 5 content exists or answer is explicitly E)
  const fiveOptionCount = useMemo(() => {
    return parsedItems.filter(
      item => (item.option5_hi && item.option5_hi.trim().length > 0) || 
              (item.option5_en && item.option5_en.trim().length > 0) ||
              item.answer === 'E'
    ).length;
  }, [parsedItems]);

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setCsvText(text);
        setIsCsvInputCollapsed(false);
      }
    } catch {
      alert('Clipboard access denied. Please use Ctrl + V directly inside the textarea.');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      if (text) {
        setCsvText(text);
        setIsCsvInputCollapsed(false);
      }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  const handleApply = () => {
    if (parsedItems.length === 0) {
      alert('कृपया पहले मान्य CSV / TSV डेटा पेस्ट करें।');
      return;
    }

    const targetPage = selectedPage !== 'auto' ? selectedPage : targetPageNumber;
    
    // If a specific target page is chosen, tag each question with that page number and source_pages
    const itemsWithPage = parsedItems.map(item => {
      if (typeof targetPage === 'number') {
        return {
          ...item,
          pageNumber: targetPage,
          source_pages: String(targetPage)
        };
      }
      return item;
    });

    const merged = mergeOrAppendMockTestItems(existingItems, itemsWithPage, mode);
    onAddItems(merged, typeof targetPage === 'number' ? targetPage : undefined);
    onClose();
    setCsvText('');
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="relative w-full max-w-5xl max-h-[94vh] bg-[#0E111A] border border-white/[0.1] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-200"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-white/[0.08] bg-white/[0.02]">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-teal-500/20 shrink-0">
                <ClipboardPaste className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                  Paste CSV / Add Missing Questions
                  <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold rounded-full">
                    4 & 5 Options Ready
                  </span>
                  {selectedPage !== 'auto' && (
                    <span className="px-2 py-0.5 bg-blue-500/15 text-blue-300 border border-blue-500/30 text-[10px] font-bold rounded-full">
                      Target: Page {selectedPage}
                    </span>
                  )}
                </h2>
                <p className="text-[11px] text-slate-400">
                  Copy from Excel, Google Sheets, or CSV and paste directly to fill missing questions on this page or across the test
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 hover:bg-white/[0.08] text-slate-400 hover:text-white rounded-xl transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Current Set Status, Target Page Selector & Gap Banner */}
          <div className="px-4 sm:px-6 py-2.5 bg-white/[0.01] border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2 sm:gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">Current Questions:</span>
                <span className="font-bold text-white bg-white/[0.05] px-2 py-0.5 rounded-lg border border-white/[0.08]">
                  {existingItems.length}
                </span>
              </div>

              {/* Target Page Selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 font-medium">Assign to Page:</span>
                <select
                  value={selectedPage}
                  onChange={(e) => setSelectedPage(e.target.value === 'auto' ? 'auto' : Number(e.target.value))}
                  className="bg-black/50 border border-white/[0.12] text-teal-300 font-bold text-xs rounded-lg px-2.5 py-1 focus:outline-none focus:border-teal-500"
                >
                  <option value="auto">Auto (from CSV / All Pages)</option>
                  {Array.from({ length: Math.max(totalPages, targetPageNumber || 1) }, (_, i) => i + 1).map(p => (
                    <option key={p} value={p}>
                      Page {p} {targetPageNumber === p ? '(Current Page)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {missingGaps.length > 0 ? (
              <div className="flex items-center gap-1.5 text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 rounded-xl font-medium text-[11px]">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Missing Gaps: <strong>Q.{missingGaps.slice(0, 8).join(', Q.')}{missingGaps.length > 8 ? '...' : ''}</strong> ({missingGaps.length} missing)
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-xl font-medium text-[11px]">
                <Check className="w-3.5 h-3.5 shrink-0" />
                <span>No numbering gaps (1 to {existingItems.length})</span>
              </div>
            )}
          </div>

          {/* Scrollable Content Body */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 custom-scrollbar">
            {/* Import Mode Selection */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <span>Select How to Add Questions:</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {/* Mode 1: Smart Fill */}
                <button
                  type="button"
                  onClick={() => setMode('smart_fill')}
                  className={`p-3 rounded-xl border text-left transition-all flex flex-col gap-1 ${
                    mode === 'smart_fill'
                      ? 'bg-emerald-500/10 border-emerald-500/50 shadow-md shadow-emerald-500/10'
                      : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-bold ${mode === 'smart_fill' ? 'text-emerald-400' : 'text-slate-200'}`}>
                      🧩 Smart Fill Missing
                    </span>
                    {mode === 'smart_fill' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Fills missing question numbers first, then appends any remaining questions.
                  </p>
                </button>

                {/* Mode 2: Append to End */}
                <button
                  type="button"
                  onClick={() => setMode('append')}
                  className={`p-3 rounded-xl border text-left transition-all flex flex-col gap-1 ${
                    mode === 'append'
                      ? 'bg-blue-500/10 border-blue-500/50 shadow-md shadow-blue-500/10'
                      : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-bold ${mode === 'append' ? 'text-blue-400' : 'text-slate-200'}`}>
                      ➕ Append to End
                    </span>
                    {mode === 'append' && <Check className="w-3.5 h-3.5 text-blue-400" />}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Adds all pasted questions at the bottom (renumbers from Q.{existingItems.length + 1}).
                  </p>
                </button>

                {/* Mode 3: Replace All */}
                <button
                  type="button"
                  onClick={() => setMode('replace')}
                  className={`p-3 rounded-xl border text-left transition-all flex flex-col gap-1 ${
                    mode === 'replace'
                      ? 'bg-rose-500/10 border-rose-500/50 shadow-md shadow-rose-500/10'
                      : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-bold ${mode === 'replace' ? 'text-rose-400' : 'text-slate-200'}`}>
                      🔄 Replace Entire Set
                    </span>
                    {mode === 'replace' && <Check className="w-3.5 h-3.5 text-rose-400" />}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Overwrites existing questions with the newly pasted question set.
                  </p>
                </button>
              </div>
            </div>

            {/* Helper Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={handlePasteClipboard}
                  className="flex items-center gap-1 px-2.5 py-1 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-slate-200 rounded-lg text-xs font-medium transition-all"
                  title="Paste from clipboard"
                >
                  <ClipboardPaste className="w-3.5 h-3.5 text-teal-400" />
                  <span>Paste Clipboard</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const promptText = `Extract ALL Multiple Choice Questions (MCQs) from this test paper into a clean CSV format.

Output ONLY the raw CSV text (without markdown code fences, backticks, or explanation).

Required CSV Header:
question_r,question_hi,question_en,option1_hi,option2_hi,option3_hi,option4_hi,option1_en,option2_en,option3_en,option4_en,answer,solution_hi,solution_en

Rules:
1. LANGUAGE PAPERS & BILINGUAL RULES (CRITICAL):
   - For English Language tests (English Comprehension, Grammar, Vocab, Error Spotting, etc.):
     DO NOT translate into Hindi! Both _hi and _en columns (question_hi and question_en, option1_hi and option1_en, etc.) MUST contain ONLY the original English text.
   - For Hindi Language tests (हिंदी भाषा, गद्यांश, व्याकरण, मुहावरे, पर्यायवाची आदि):
     DO NOT translate into English! Both _hi and _en columns (question_hi and question_en, option1_hi and option1_en, etc.) MUST contain ONLY the original Hindi text.
   - For other general subjects (Maths, Reasoning, Science, GS, Social Studies):
     Place Hindi in _hi columns and English in _en columns as normal.
2. The "answer" column must be the single uppercase letter: A, B, C, D, or E.
3. Every field containing commas or quotes must be enclosed in double quotes ("...").
4. Keep all mathematical formulas in clean LaTeX notation (e.g., $x^2 + y^2 = r^2$).
5. Provide a detailed, step-by-step explanatory solution for every question.
6. READING COMPREHENSION / PASSAGE SETS (CRITICAL):
   - If questions are based on a Passage, Comprehension text, Directions, or गद्यांश / काव्यांश (e.g., "SET - 34 [Q. 164. to Q. 168.]", "Directions (439-443)", "गद्यांश को पढ़कर..."):
     YOU MUST INCLUDE THE FULL PASSAGE TEXT WITH EVERY SINGLE QUESTION IN THAT SET!
   - Prepend the complete passage to both question_hi and question_en, separated by "\\n---\\n" (e.g., "[Full Passage Text]\\n---\\n[Question Text]").
   - NEVER output the passage only once or only with the first question! Every question belonging to that passage set (e.g. Q.164, Q.165, Q.166, Q.167, Q.168) MUST have the complete passage text attached so each question can be understood and answered independently.`;
                    navigator.clipboard.writeText(promptText);
                    alert('📋 AI Extraction Prompt copied to clipboard!\n\nPaste this into ChatGPT / Claude with your page image. Once it outputs the CSV, copy its CSV and click "Paste Clipboard" here!');
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 rounded-lg text-xs font-medium transition-all"
                  title="Copy AI Prompt to give to ChatGPT / Claude"
                >
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Copy AI Prompt</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCsvText(SAMPLE_4_OPTIONS_CSV);
                    setIsCsvInputCollapsed(false);
                  }}
                  className="px-2 py-1 bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] text-slate-300 rounded-lg text-xs font-medium transition-all"
                  title="Insert 4-options sample CSV"
                >
                  4-Options Sample
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCsvText(SAMPLE_5_OPTIONS_CSV);
                    setIsCsvInputCollapsed(false);
                  }}
                  className="px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 rounded-lg text-xs font-medium transition-all"
                  title="Insert 5-options (Option E) sample CSV"
                >
                  5-Options (A-E) Sample
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1 px-2 py-1 bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] text-slate-300 rounded-lg text-xs font-medium transition-all"
                  title="Upload a .csv file"
                >
                  <Upload className="w-3.5 h-3.5 text-blue-400" />
                  <span>File</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,.tsv,.json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </div>

              <div className="flex items-center gap-3">
                {parsedItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setIsCsvInputCollapsed(!isCsvInputCollapsed)}
                    className="flex items-center gap-1 text-xs text-teal-400 hover:text-teal-300 font-semibold transition-colors"
                  >
                    {isCsvInputCollapsed ? <Eye className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                    <span>{isCsvInputCollapsed ? 'Show Raw CSV' : 'Minimize Raw CSV'}</span>
                  </button>
                )}

                {csvText && (
                  <button
                    type="button"
                    onClick={() => setCsvText('')}
                    className="text-xs text-slate-400 hover:text-rose-400 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Paste Textarea (Collapsible when preview is ready) */}
            {!isCsvInputCollapsed ? (
              <div className="relative">
                <textarea
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  placeholder="Paste your CSV, TSV (Excel copy), or JSON question array here (Ctrl + V)...&#10;&#10;Supported formats: CSV rows, TSV, or JSON array [ { question_hi, option1_hi... } ]"
                  rows={parsedItems.length > 0 ? 4 : 6}
                  className="w-full p-3.5 bg-black/60 border border-white/[0.08] focus:border-teal-500/60 rounded-xl text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none custom-scrollbar resize-y"
                />
              </div>
            ) : (
              <div 
                onClick={() => setIsCsvInputCollapsed(false)}
                className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-between text-xs text-slate-400 hover:border-teal-500/40 cursor-pointer transition-all"
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-teal-400" />
                  <span>Raw CSV Input ({parsedItems.length} questions parsed)</span>
                </div>
                <span className="text-[11px] text-teal-400 font-medium">Click to expand & edit</span>
              </div>
            )}

            {/* Real-time Parsed Preview Section */}
            {csvText.trim() && (
              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-3.5">
                {/* Preview Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                      Parsing Result:
                    </span>
                    {parsedItems.length > 0 ? (
                      <span className="px-2.5 py-0.5 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-xs font-bold rounded-lg flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        <span>{parsedItems.length} Valid Question{parsedItems.length > 1 ? 's' : ''} Detected</span>
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 bg-rose-500/15 text-rose-400 border border-rose-500/30 text-xs font-bold rounded-lg">
                        0 Valid Questions Found
                      </span>
                    )}

                    {fiveOptionCount > 0 && (
                      <span className="px-2 py-0.5 bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[11px] font-bold rounded-lg">
                        {fiveOptionCount} with 5 Options (Option E)
                      </span>
                    )}
                  </div>

                  {parsedItems.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Bilingual View Toggle */}
                      <div className="flex items-center bg-black/50 p-0.5 rounded-lg border border-white/[0.08] text-[11px]">
                        <button
                          type="button"
                          onClick={() => setPreviewLang('both')}
                          className={`px-2.5 py-0.5 rounded font-bold transition-all ${
                            previewLang === 'both' ? 'bg-teal-500 text-black shadow' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Both (Hi + En)
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewLang('hi')}
                          className={`px-2.5 py-0.5 rounded font-bold transition-all ${
                            previewLang === 'hi' ? 'bg-amber-500 text-black shadow' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          हिन्दी
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewLang('en')}
                          className={`px-2.5 py-0.5 rounded font-bold transition-all ${
                            previewLang === 'en' ? 'bg-blue-500 text-white shadow' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          English
                        </button>
                      </div>

                      {/* View Mode Switcher */}
                      <div className="flex items-center bg-black/50 p-0.5 rounded-lg border border-white/[0.08] text-[11px]">
                        <button
                          type="button"
                          onClick={() => setPreviewTab('cards')}
                          className={`px-2.5 py-0.5 rounded font-bold transition-all ${
                            previewTab === 'cards' ? 'bg-white/[0.12] text-white shadow' : 'text-slate-400 hover:text-white'
                          }`}
                          title="View full questions with options and solutions"
                        >
                          Full Cards
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewTab('table')}
                          className={`px-2.5 py-0.5 rounded font-bold transition-all ${
                            previewTab === 'table' ? 'bg-white/[0.12] text-white shadow' : 'text-slate-400 hover:text-white'
                          }`}
                          title="Compact table view of all questions"
                        >
                          Table View
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewTab('summary')}
                          className={`px-2.5 py-0.5 rounded font-bold transition-all ${
                            previewTab === 'summary' ? 'bg-white/[0.12] text-white shadow' : 'text-slate-400 hover:text-white'
                          }`}
                          title="Stats summary of insertion"
                        >
                          Stats
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {parsedItems.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-2">
                    Could not parse questions from the pasted text. Please make sure the rows contain question text, options, and answers.
                  </p>
                ) : previewTab === 'cards' ? (
                  /* ================= FULL CARDS PREVIEW ================= */
                  <div className="max-h-[440px] overflow-y-auto space-y-4 custom-scrollbar pr-1.5">
                    {parsedItems.map((item, idx) => {
                      const hasOpt5 = Boolean(
                        (item.option5_hi && item.option5_hi.trim().length > 0) ||
                        (item.option5_en && item.option5_en.trim().length > 0) ||
                        item.answer === 'E'
                      );

                      const optionsList = [
                        { key: 'A', num: '1', hi: item.option1_hi, en: item.option1_en },
                        { key: 'B', num: '2', hi: item.option2_hi, en: item.option2_en },
                        { key: 'C', num: '3', hi: item.option3_hi, en: item.option3_en },
                        { key: 'D', num: '4', hi: item.option4_hi, en: item.option4_en },
                        ...(hasOpt5 ? [{ key: 'E', num: '5', hi: item.option5_hi, en: item.option5_en }] : [])
                      ];

                      return (
                        <div
                          key={item.id || idx}
                          className="p-4 rounded-xl bg-black/50 border border-white/[0.08] hover:border-white/[0.15] space-y-3.5 transition-all shadow-lg"
                        >
                          {/* MCQ Card Header */}
                          <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-white/[0.06]">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="px-2.5 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 font-extrabold text-xs border border-amber-500/30">
                                #{item.question_r || idx + 1}
                              </span>
                              {item.subject && (
                                <span className="px-2 py-0.5 rounded-md bg-white/[0.05] text-slate-300 text-[11px] font-semibold border border-white/[0.08]">
                                  {item.subject}
                                </span>
                              )}
                              {item.difficulty_level && (
                                <span className="px-2 py-0.5 rounded-md bg-white/[0.05] text-slate-400 text-[10px] font-semibold uppercase tracking-wider">
                                  {item.difficulty_level}
                                </span>
                              )}
                              {hasOpt5 && (
                                <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold">
                                  5 Options (A-E)
                                </span>
                              )}
                            </div>

                            {/* Correct Answer Badge */}
                            <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-extrabold text-xs shadow-sm shadow-emerald-500/10">
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Correct Answer: Option {item.answer}</span>
                            </div>
                          </div>

                          {/* Question Stems (Hindi and/or English) */}
                          <div className="space-y-2.5">
                            {previewLang !== 'en' && item.question_hi && (
                              <div className="p-3.5 rounded-xl bg-slate-900/90 border border-white/[0.07] space-y-1">
                                {previewLang === 'both' && item.question_en && (
                                  <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block">
                                    हिन्दी प्रश्न:
                                  </span>
                                )}
                                <LatexRenderer 
                                  content={item.question_hi} 
                                  className="text-white text-xs sm:text-sm leading-relaxed" 
                                />
                              </div>
                            )}

                            {previewLang !== 'hi' && item.question_en && (
                              <div className="p-3.5 rounded-xl bg-slate-900/90 border border-white/[0.07] space-y-1">
                                {previewLang === 'both' && item.question_hi && (
                                  <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider block">
                                    English Question:
                                  </span>
                                )}
                                <LatexRenderer 
                                  content={item.question_en} 
                                  className="text-slate-200 text-xs sm:text-sm leading-relaxed" 
                                />
                              </div>
                            )}
                          </div>

                          {/* Options Grid */}
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block pl-0.5">
                              Options ({optionsList.length} Options):
                            </span>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {optionsList.map((opt) => {
                                const isAns = item.answer === opt.key || item.answer === opt.num;
                                return (
                                  <div
                                    key={opt.key}
                                    className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs transition-all ${
                                      isAns
                                        ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200 shadow-md shadow-emerald-500/10 ring-1 ring-emerald-500/40'
                                        : 'border-white/[0.08] bg-black/40 text-slate-300'
                                    }`}
                                  >
                                    <span
                                      className={`w-6 h-6 rounded-full flex items-center justify-center font-extrabold text-xs shrink-0 ${
                                        isAns
                                          ? 'bg-emerald-500 text-black shadow-sm'
                                          : 'bg-white/[0.08] text-slate-400'
                                      }`}
                                    >
                                      {opt.key}
                                    </span>
                                    <div className="flex-1 min-w-0 space-y-1">
                                      {previewLang !== 'en' && opt.hi && (
                                        <LatexRenderer
                                          content={opt.hi}
                                          className={`leading-relaxed ${isAns ? 'text-emerald-100 font-semibold' : 'text-slate-200 font-medium'}`}
                                        />
                                      )}
                                      {previewLang !== 'hi' && opt.en && (
                                        <LatexRenderer
                                          content={opt.en}
                                          className={`leading-relaxed text-[11px] ${isAns ? 'text-emerald-300/90' : 'text-slate-400'}`}
                                        />
                                      )}
                                    </div>
                                    {isAns && (
                                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold shrink-0">
                                        ✓ Correct
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Solution / Explanation Box */}
                          {(item.solution_hi || item.solution_en) && (
                            <div className="p-3.5 rounded-xl bg-indigo-950/25 border border-indigo-500/30 space-y-1.5">
                              <div className="flex items-center gap-1.5 text-indigo-300 font-bold text-xs">
                                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                                <span>Step-by-Step Solution & Explanation:</span>
                              </div>
                              {previewLang !== 'en' && item.solution_hi && (
                                <div className="space-y-0.5">
                                  {previewLang === 'both' && item.solution_en && (
                                    <span className="text-[10px] font-bold text-amber-400/80 uppercase">Hindi Explanation:</span>
                                  )}
                                  <LatexRenderer content={item.solution_hi} className="text-indigo-100 text-xs leading-relaxed" />
                                </div>
                              )}
                              {previewLang !== 'hi' && item.solution_en && (
                                <div className="space-y-0.5 pt-1 border-t border-indigo-500/20">
                                  {previewLang === 'both' && item.solution_hi && (
                                    <span className="text-[10px] font-bold text-blue-400/80 uppercase">English Explanation:</span>
                                  )}
                                  <LatexRenderer content={item.solution_en} className="text-indigo-200 text-xs leading-relaxed" />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : previewTab === 'table' ? (
                  /* ================= COMPACT TABLE VIEW ================= */
                  <div className="max-h-[380px] overflow-x-auto overflow-y-auto custom-scrollbar border border-white/[0.08] rounded-xl">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-black/60 text-slate-400 border-b border-white/[0.08] sticky top-0 backdrop-blur-md font-bold text-[11px]">
                        <tr>
                          <th className="p-2.5 w-12">#</th>
                          <th className="p-2.5">Question Stem</th>
                          <th className="p-2.5 w-20">Options</th>
                          <th className="p-2.5 w-16 text-center">Ans</th>
                          <th className="p-2.5 w-28">Subject</th>
                          <th className="p-2.5">Solution Snippet</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.04] text-slate-200 bg-black/20">
                        {parsedItems.map((item, idx) => {
                          const hasOpt5 = Boolean(
                            (item.option5_hi && item.option5_hi.trim().length > 0) ||
                            (item.option5_en && item.option5_en.trim().length > 0) ||
                            item.answer === 'E'
                          );
                          const cleanStem = (item.question_hi || item.question_en || '').replace(/<[^>]*>/g, '');
                          const cleanSol = (item.solution_hi || item.solution_en || '').replace(/<[^>]*>/g, '');

                          return (
                            <tr key={item.id || idx} className="hover:bg-white/[0.02]">
                              <td className="p-2.5 font-bold font-mono text-teal-400">
                                #{item.question_r || idx + 1}
                              </td>
                              <td className="p-2.5 max-w-xs truncate font-medium" title={cleanStem}>
                                {cleanStem}
                              </td>
                              <td className="p-2.5">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  hasOpt5 ? 'bg-amber-500/20 text-amber-300' : 'bg-white/[0.06] text-slate-300'
                                }`}>
                                  {hasOpt5 ? '5 Opts' : '4 Opts'}
                                </span>
                              </td>
                              <td className="p-2.5 text-center">
                                <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-extrabold text-xs">
                                  {item.answer}
                                </span>
                              </td>
                              <td className="p-2.5 text-slate-400 truncate max-w-[110px]">
                                {item.subject || '-'}
                              </td>
                              <td className="p-2.5 text-slate-400 max-w-xs truncate" title={cleanSol}>
                                {cleanSol || <span className="text-slate-600 italic">No solution</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  /* ================= STATS SUMMARY ================= */
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="p-3 rounded-xl bg-black/40 border border-white/[0.06]">
                      <span className="text-[10px] text-slate-500 uppercase font-bold block mb-0.5">Action Mode</span>
                      <span className="font-bold text-teal-300 capitalize text-sm">
                        {mode === 'smart_fill' ? '🧩 Smart Gap Fill' : mode === 'append' ? '➕ Append Bottom' : '🔄 Replace All'}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl bg-black/40 border border-white/[0.06]">
                      <span className="text-[10px] text-slate-500 uppercase font-bold block mb-0.5">Gaps to Fill</span>
                      <span className="font-bold text-amber-300 text-sm">
                        {mode === 'smart_fill' ? Math.min(missingGaps.length, parsedItems.length) : 0} Gaps
                      </span>
                    </div>
                    <div className="p-3 rounded-xl bg-black/40 border border-white/[0.06]">
                      <span className="text-[10px] text-slate-500 uppercase font-bold block mb-0.5">5-Option Qs</span>
                      <span className="font-bold text-amber-400 text-sm">{fiveOptionCount} / {parsedItems.length}</span>
                    </div>
                    <div className="p-3 rounded-xl bg-black/40 border border-white/[0.06]">
                      <span className="text-[10px] text-slate-500 uppercase font-bold block mb-0.5">Final Total</span>
                      <span className="font-bold text-emerald-400 text-sm">
                        {mode === 'replace' ? parsedItems.length : existingItems.length + (mode === 'smart_fill' ? Math.max(0, parsedItems.length - missingGaps.length) : parsedItems.length)} Questions
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-t border-white/[0.08] bg-white/[0.02]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-white/[0.08] text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/[0.04] transition-all"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleApply}
              disabled={parsedItems.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-400 hover:to-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-teal-500/20 transition-all disabled:opacity-40"
            >
              <Check className="w-4 h-4" />
              <span>
                {parsedItems.length > 0 
                  ? `Import & ${mode === 'smart_fill' ? 'Fill Missing' : mode === 'append' ? 'Append' : 'Replace'} (${parsedItems.length} Qs)` 
                  : 'Import Questions'}
              </span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
