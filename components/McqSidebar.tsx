import React, { useMemo, useState, useEffect } from 'react';
import { X, Edit, Trash2, BookOpen, FileText, Download, FileDown, Sparkles, Loader2, History, Settings, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ScannedPage, OptionArrangement, MockTestMcqItem } from '../types';
import { generateDocx, fixDanglingMathOnLine, formatChemicalReactions } from '../services/docxService';
import { proofreadMcqs } from '../services/geminiService';
import { ensureHtmlParagraph } from '../services/mocktestService';
import MocktestStudioModal from './MocktestStudioModal';
import GeminiExplanationPanel from './GeminiExplanationPanel';
import GeminiConnectModal from './GeminiConnectModal';
import AiHistoryDrawer from './AiHistoryDrawer';
import GeminiSettingsModal from './GeminiSettingsModal';
import { checkUserGeminiAuth } from '../services/userGeminiService';

interface McqOption {
  label: string;
  text: string;
}

interface McqItem {
  id: string;
  pageNumber: number;
  questionNumber: string;
  questionText: string;
  options: McqOption[];
  answer?: string;
  status: string;
}

interface McqItemAI {
  questionText: string;
  options: McqOption[];
  answer?: string;
}

interface McqSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  pages: ScannedPage[];
  mcqMode: boolean;
  autoProofread: boolean;
  isBilingual: boolean;
  showMcqNumbers: boolean;
  showAnswers: boolean;
}

const cleanBilingualDuplicates = (text: string): string => {
  if (!text) return text;

  // 1. Question level identical text: 'Question: 1. What is X? / What is X?' -> 'Question: 1. What is X?'
  let cleaned = text.replace(/^(\s*(?:(?:Question|Q)\.?\s*[:\-]?\s*\d+\.?|#\d+\.?|\d+\.)\s*)([^\n/]+?)\s*\/\s*([^\n/]+)$/gm, (match, prefix, left, right) => {
    const lNorm = left.trim();
    const rNorm = right.trim();
    if (lNorm.toLowerCase() === rNorm.toLowerCase()) {
      return prefix + lNorm;
    }
    return match;
  });

  // 2. Format single line bilingual questions into two lines WITHOUT slash (ONLY FOR QUESTIONS)
  // A bilingual question separator '/' must separate a Hindi question from an English question!
  // It MUST NOT match inside units like 'm/s', 'km/h', or formulas like '1/2', 'a/b'!
  cleaned = cleaned.replace(/^(\s*(?:(?:Question|Q)\.?\s*[:\-]?\s*\d+[\.\)\-:]?|#\d+[\.\)\-:]?|\d+[\.\)\-:]?)\s+[^\n]+?)\s+(?:\/|\|)\s+([A-Za-z][^\n]+)$/gm, (match, hindiPart, engPart) => {
    // If the slash is inside $...$ or $$...$$, DO NOT split!
    const dollarsBefore = (hindiPart.match(/\$/g) || []).length;
    if (dollarsBefore % 2 !== 0) return match;

    const cleanHindi = hindiPart.trim();
    const cleanEng = engPart.trim();
    
    const hasHindi = /[\u0900-\u097F]/.test(cleanHindi);
    const engHindiCharCount = (cleanEng.match(/[\u0900-\u097F]/g) || []).length;
    const engLatinCharCount = (cleanEng.match(/[a-zA-Z]/g) || []).length;

    // cleanEng must be an actual English question (more Latin letters than Devanagari letters)
    if (hasHindi && engLatinCharCount > 5 && engLatinCharCount > engHindiCharCount) {
      return cleanHindi + '\n' + cleanEng;
    }
    return match;
  });

  // 3. Ensure bilingual options stay on ONE single line with ' / ' (e.g. '(b) सम / Even')
  cleaned = cleaned.replace(/^(\s*\([a-eA-E]\)\s+[^\n/]+?)\r?\n\s*([a-zA-Z][^\n]+)$/gm, (match, optHindi, optEng) => {
    return optHindi.trim() + ' / ' + optEng.trim();
  });

  // 4. Option level duplicates: e.g. '(a) 123 / 123' -> '(a) 123', '(b) 45.5% / 45.5%' -> '(b) 45.5%'
  cleaned = cleaned.replace(/^(\s*(?:\([a-zA-Z0-9]+\)|[a-zA-Z0-9]+[\.\)])\s*)([^\n/]+?)\s*\/\s*([^\n/]+)$/gm, (match, prefix, left, right) => {
    const lNorm = left.trim();
    const rNorm = right.trim();
    if (lNorm.toLowerCase() === rNorm.toLowerCase() || lNorm.replace(/\s+/g, '').toLowerCase() === rNorm.replace(/\s+/g, '').toLowerCase()) {
      return prefix + lNorm;
    }
    return match;
  });

  // 5. Clean standalone numbers/formulas/symbols/units duplicated with / e.g. '123 / 123', '$$x=2$$ / $$x=2$$'
  // (Only replace if left and right are identical, never touching m/s or km/h)
  cleaned = cleaned.replace(/([^\n/]+?)\s*\/\s*([^\n/]+)/g, (match, left, right) => {
    const lTrim = left.trim();
    const rTrim = right.trim();
    if (lTrim && rTrim && lTrim.toLowerCase() === rTrim.toLowerCase()) {
      return lTrim;
    }
    return match;
  });

  return cleaned;
};

const McqSidebar: React.FC<McqSidebarProps> = ({ isOpen, onClose, pages, mcqMode, autoProofread, isBilingual, showMcqNumbers, showAnswers }) => {
  const [isProofreading, setIsProofreading] = useState(false);
  const [manualMcqs, setManualMcqs] = useState<McqItem[] | null>(null);
  const [lastProcessedPageCount, setLastProcessedPageCount] = useState(0);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showMocktestModal, setShowMocktestModal] = useState(false);
  const [authStatus, setAuthStatus] = useState<'none' | 'apikey' | 'oauth'>('none');

  useEffect(() => {
    checkAuth();
  }, [isOpen]);

  const checkAuth = async () => {
    const res = await checkUserGeminiAuth();
    setAuthStatus(res.isAuthenticated ? res.authType : 'none');
  };
  
  const autoMcqs = useMemo(() => {
    if (!mcqMode) return [];
    const extracted: McqItem[] = [];
    let currentQuestion: Partial<McqItem> | null = null;

    pages.forEach(page => {
      if (page.status !== 'done' || !page.elements) return;
      
      page.elements.forEach(el => {
        if (el.type !== 'text' || !el.content || typeof el.content !== 'string') return;
        
        // Pre-process: Force newlines before Q.1, #Q.1, etc. if the AI squashes them into the same line as the previous option
        // We include Hindi characters [\u0900-\u097F] in the lookbehind range
        const forceNewlines = el.content
          .replace(/([a-z0-9\u0900-\u097F])\s+(#?(?:Question|Q)\.?\s*[:\-]?\s*\d+\s*[\.\)\-:]?\s+)/gi, '$1\n$2')
          .replace(/([a-z0-9\u0900-\u097F])\s+(#\d+\s*[\.\)\-:]?\s+)/gi, '$1\n$2')
          .replace(/Ans\s+(#?Q)/gi, 'Ans\n$1')
          .replace(/([a-z0-9\u0900-\u097F])\s+([\(]?\s*[A-Ea-e]\s*[\.\)\]]\s+)/gi, '$1\n$2') // Also try to split options if squashed
          .replace(/([a-z0-9\u0900-\u097F])\s+(Answer\s*[:\-]?\s*[A-Ea-e])/gi, '$1\n$2'); // Force newline before Answer if squashed

        const lines = forceNewlines.split('\n').map(l => l.trim()).filter(l => l);
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const cleanLine = line.replace(/[\*\_]/g, '').trim();
          
          // Match Question: 1., Q.1, 1., #1, Question 1, 100. What, Q100, 100 . What
          // Updated to handle colon after Question/Q more broadly
          const qMatch = cleanLine.match(/^(?:(?:Question|Q)\.?\s*[:\-]?\s*|#\s*)(\d+)\s*[\.\)\-:]?\s*(.*)|^(\d+)\s*[\.\)\-:]\s*(.*)/i);
          if (qMatch) {
            const qNum = qMatch[1] || qMatch[3];
            const qText = qMatch[2] || qMatch[4];
            
            if (currentQuestion && currentQuestion.options && currentQuestion.options.length > 0) {
              extracted.push(currentQuestion as McqItem);
            }
            currentQuestion = {
              id: `mcq-${page.id}-${i}`,
              pageNumber: page.pageNumber,
              questionNumber: qNum,
              questionText: isBilingual ? cleanBilingualDuplicates(qText) : qText,
              options: [],
              status: 'DRAFT'
            };
            continue;
          }

          // Match Answer: A, Ans: A, Ans A, Answer A
          const ansMatch = cleanLine.match(/^(?:Answer|Ans)\s*[:\-]?\s*([A-Ea-e])/i);
          if (ansMatch && currentQuestion) {
            currentQuestion.answer = ansMatch[1].toUpperCase();
            continue;
          }
          
          // Match options: (A) text, a. text, Ans A. text, X A. text, ✓ A. text, A . text
          const optMatch = cleanLine.match(/^(?:Ans(?:wer)?\s*)?(?:[X✓x]\s*)?[\(\[]?([A-Ea-e])\s*[\.\)\]]\s*(.*)/);
          if (optMatch && currentQuestion) {
            const optText = isBilingual ? cleanBilingualDuplicates(optMatch[2]) : optMatch[2];
            currentQuestion.options!.push({
              label: optMatch[1].toUpperCase(),
              text: optText
            });
            continue;
          }
          
          if (currentQuestion) {
            if (currentQuestion.options!.length === 0) {
              // Continuation of question text
              const prevText = currentQuestion.questionText || '';
              const prevHasHindi = /[\u0900-\u097F]/.test(prevText);
              const currHasHindi = /[\u0900-\u097F]/.test(line);
              const currIsEnglishOnly = !currHasHindi && /[a-zA-Z]{3,}/.test(line);

              if (prevHasHindi && currIsEnglishOnly && !prevText.includes('\n')) {
                // English translation line
                currentQuestion.questionText = prevText + '\n' + line;
              } else {
                // Continuation of the same sentence
                currentQuestion.questionText = prevText ? (prevText + ' ' + line) : line;
              }
            } else {
              // Continuation of the last option
              const lastOption = currentQuestion.options![currentQuestion.options!.length - 1];
              lastOption.text = (lastOption.text ? (lastOption.text + ' ') : '') + line;
            }
          }
        }
      });
    });

    if (currentQuestion && currentQuestion.options && currentQuestion.options.length > 0) {
      extracted.push(currentQuestion as McqItem);
    }
    
    return extracted;
  }, [pages, mcqMode]);

  const mcqs = manualMcqs || autoMcqs;

  const mocktestItems = useMemo<MockTestMcqItem[]>(() => {
    return mcqs.map((m, idx) => {
      const getOpt = (letter: string) => m.options.find(o => o.label.toUpperCase() === letter)?.text || '';
      return {
        id: m.id || `mt_item_${idx + 1}`,
        question_r: idx + 1,
        question_type: 'MCQ',
        question_hi: ensureHtmlParagraph(m.questionText),
        option1_hi: getOpt('A'),
        option2_hi: getOpt('B'),
        option3_hi: getOpt('C'),
        option4_hi: getOpt('D'),
        option5_hi: getOpt('E'),
        solution_hi: '',
        question_en: ensureHtmlParagraph(m.questionText),
        option1_en: getOpt('A'),
        option2_en: getOpt('B'),
        option3_en: getOpt('C'),
        option4_en: getOpt('D'),
        option5_en: getOpt('E'),
        solution_en: '',
        answer: m.answer || 'A',
        set_name: 'Mock Test Paper',
        difficulty_level: 'medium'
      };
    });
  }, [mcqs]);

  // Auto-proofread effect
  React.useEffect(() => {
    if (!autoProofread || !mcqMode || isProofreading) return;
    
    const donePages = pages.filter(p => p.status === 'done');
    if (donePages.length > lastProcessedPageCount && donePages.length > 0) {
      setLastProcessedPageCount(donePages.length);
      handleProofread();
    }
  }, [pages, autoProofread, mcqMode]);

  const handleProofread = async () => {
    if (autoMcqs.length === 0) return;
    
    setIsProofreading(true);
    try {
      // Group all text content for proofreading
      const allText = pages
        .filter(p => p.status === 'done' && p.extractedText)
        .map(p => p.extractedText)
        .join('\n\n');
      
      const cleanedQuestions = await proofreadMcqs(allText, isBilingual);
      
      if (cleanedQuestions.length > 0) {
        const formattedMcqs: McqItem[] = (cleanedQuestions as McqItemAI[]).map((q, idx) => ({
          id: `proofread-${idx}-${Date.now()}`,
          pageNumber: 0, // AI cleaned version doesn't strictly follow pages
          questionNumber: (idx + 1).toString(),
          questionText: q.questionText,
          options: q.options,
          answer: q.answer,
          status: 'VERIFIED'
        }));
        setManualMcqs(formattedMcqs);
      } else {
        alert("AI could not find any clear MCQs to proofread.");
      }
    } catch (e) {
      console.error(e);
      alert("Proofreading failed. Please try again.");
    } finally {
      setIsProofreading(false);
    }
  };

  const exportToWord = async () => {
    if (mcqs.length === 0) return;
    
    const cleanMathSpacings = (str: string): string => {
      if (!str) return '';
      return str
        .replace(/([\u0900-\u097F])(\$+)(?!\$)/g, '$1 $2')
        .replace(/(\$+)([\u0900-\u097F])/g, '$1 $2')
        .replace(/\bm\s*\n\s*\/?\s*s(\$+)/g, 'm/s$1')
        .replace(/\bm\s*\n\s*\/?\s*s\b/g, 'm/s');
    };

    const elements = mcqs.map((mcq, idx) => {
      // Helper to ensure LaTeX is wrapped in $$ for docxService to pick it up
      const ensureLatexWrapped = (text: string) => {
        if (!text) return "";
        const t = cleanMathSpacings(fixDanglingMathOnLine(formatChemicalReactions(text)));
        // If it already has any math delimiters, it's probably fine
        if (t.includes('$') || t.includes('\\(') || t.includes('\\[')) return t;
        
        // If it looks like it has LaTeX but no delimiters, wrap it
        // A simple heuristic: check for backslashes followed by common math commands
        if (/\\[a-zA-Z]+/.test(t) || /[_^]/.test(t)) {
           return `$$ ${t} $$`;
        }
        return t;
      };

      const qText = ensureLatexWrapped(mcq.questionText);
      const optionsText = mcq.options.map(o => {
        return `(${o.label.toLowerCase()}) ${ensureLatexWrapped(o.text)}`;
      }).join('\n');

      let content = `**Question: ${showMcqNumbers ? (idx + 1) + '. ' : ''}** ${qText.trim()}\n${optionsText}`;
      if (mcq.answer && showAnswers) {
        content += `\n**Answer: ${mcq.answer}**`;
      }
      return { type: 'text', content };
    });
    
    try {
      const blob = await generateDocx(elements as any, OptionArrangement.VERTICAL);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `MCQ_Bank.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => window.URL.revokeObjectURL(url), 10000);
    } catch (e) {
      console.error(e);
      alert("Failed to export Word document.");
    }
  };

  const exportToPdf = () => {
    if (mcqs.length === 0) return;
    
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert("Please allow popups to generate PDF.");
      return;
    }
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>MCQ Bank</title>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; padding: 40px; max-width: 800px; margin: 0 auto; color: #333; }
            h1 { text-align: center; color: #1e293b; margin-bottom: 30px; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; }
            .question { margin-bottom: 24px; page-break-inside: avoid; }
            .q-text { font-weight: 600; margin-bottom: 10px; font-size: 16px; }
            .options { margin-left: 24px; }
            .option { margin-bottom: 6px; font-size: 15px; }
            @media print {
              body { padding: 0; }
            }
          </style>
        </head>
        <body>
          <h1>MCQ Bank</h1>
          ${mcqs.map((mcq, idx) => `
            <div class="question">
              <div class="q-text">Question: ${showMcqNumbers ? (idx + 1) + '. ' : ''}${mcq.questionText}</div>
              <div class="options">
                ${mcq.options.map(o => `<div class="option">(${o.label.toLowerCase()}) ${o.text}</div>`).join('')}
              </div>
              ${mcq.answer && showAnswers ? `<div class="answer" style="margin-top: 8px; font-weight: bold; color: #FF6B2B;">Answer: ${mcq.answer}</div>` : ''}
            </div>
          `).join('')}
          <script>
            window.onload = () => { 
              setTimeout(() => {
                window.print(); 
                window.close(); 
              }, 500);
            }
          </script>
        </body>
      </html>
    `;
    
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-[#0B0D13]/70 backdrop-blur-md z-50"
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 220 }}
            className="fixed inset-y-0 right-0 w-full max-w-md bg-[#11141F] z-50 flex flex-col border-l border-white/[0.08] shadow-2xl"
          >
            <div className="flex flex-col gap-3 p-4 bg-white/[0.02] border-b border-white/[0.08]">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-white font-display">MCQ Question Bank</h2>
                  <p className="text-[10px] text-slate-400">{mcqs.length} questions digitized</p>
                </div>
                <div className="flex items-center gap-1.5">
                  {authStatus !== 'none' ? (
                    <button
                      onClick={() => setShowSettingsModal(true)}
                      className="flex items-center gap-1 px-2 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 rounded-lg text-[10px] font-bold transition-all"
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Gemini ✓</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowConnectModal(true)}
                      className="flex items-center gap-1 px-2 py-1 bg-[#FF6B2B]/10 hover:bg-[#FF6B2B]/20 border border-[#FF6B2B]/30 text-[#FF884D] rounded-lg text-[10px] font-bold transition-all"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>Connect Gemini</span>
                    </button>
                  )}

                  <button
                    onClick={() => setShowHistoryDrawer(true)}
                    title="My AI Explanations"
                    className="p-1.5 text-slate-400 hover:text-white hover:bg-white/[0.08] rounded-lg transition-all"
                  >
                    <History className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => setShowSettingsModal(true)}
                    title="Gemini Settings"
                    className="p-1.5 text-slate-400 hover:text-white hover:bg-white/[0.08] rounded-lg transition-all"
                  >
                    <Settings className="w-4 h-4" />
                  </button>

                  <button
                    onClick={onClose}
                    className="p-1.5 text-slate-400 hover:text-white hover:bg-white/[0.08] rounded-lg transition-all"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              
              {/* Export Actions */}
              {mcqs.length > 0 && (
                <div className="flex flex-col gap-2 pt-2 border-t border-white/[0.06]">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={exportToWord}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-white/[0.04] border border-white/[0.08] text-slate-200 hover:bg-white/[0.08] rounded-xl text-xs font-bold transition-all"
                    >
                      <FileText className="w-3.5 h-3.5 text-blue-400" />
                      Export Word
                    </button>
                    <button 
                      onClick={exportToPdf}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-white/[0.04] border border-white/[0.08] text-slate-200 hover:bg-white/[0.08] rounded-xl text-xs font-bold transition-all"
                    >
                      <FileDown className="w-3.5 h-3.5 text-emerald-400" />
                      Export PDF
                    </button>
                  </div>

                  <button 
                    onClick={() => setShowMocktestModal(true)}
                    className="w-full flex items-center justify-center gap-1.5 py-2 bg-gradient-to-r from-emerald-600/20 to-teal-600/20 hover:from-emerald-600/30 hover:to-teal-600/30 border border-emerald-500/30 text-emerald-300 hover:text-white rounded-xl text-xs font-bold transition-all shadow-sm"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                    Open in MockTest Studio (18-Col CSV)
                  </button>
                  
                  <button 
                    onClick={handleProofread}
                    disabled={isProofreading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-[#FF6B2B] to-[#FF884D] text-white hover:shadow-lg hover:shadow-[#FF6B2B]/25 rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isProofreading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        AI Proofreading Questions...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Proofread with AI (Clean Content)
                      </>
                    )}
                  </button>
                  
                  {manualMcqs && (
                    <button 
                      onClick={() => setManualMcqs(null)}
                      className="text-[10px] text-slate-500 hover:text-slate-300 text-center underline"
                    >
                      Reset to auto-extracted version
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
              {!mcqMode ? (
                <div className="text-center py-16 text-slate-500">
                  <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-25" />
                  <p className="font-bold text-slate-300 text-xs">MCQ Mode is General</p>
                  <p className="text-[11px] mt-1 text-slate-500">Enable MCQ Mode from the top toolbar to automatically index questions.</p>
                </div>
              ) : mcqs.length === 0 ? (
                <div className="text-center py-16 text-slate-500">
                  <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-25" />
                  <p className="font-bold text-slate-300 text-xs">No MCQs Indexed</p>
                  <p className="text-[11px] mt-1 text-slate-500">Extract an exam paper containing multiple choice questions to see them here.</p>
                </div>
              ) : (
                mcqs.map((mcq, idx) => (
                  <div key={idx} className="glass-panel rounded-xl p-3.5 flex flex-col gap-2.5 hover:border-white/[0.15] transition-all">
                    {/* Top Row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg bg-[#FF6B2B]/15 border border-[#FF6B2B]/30 text-[#FF884D] flex items-center justify-center text-xs font-bold font-mono">
                          {idx + 1}
                        </div>
                        <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full uppercase tracking-wider">
                          Page {mcq.pageNumber}
                        </span>
                      </div>
                      <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full uppercase">
                        {mcq.status}
                      </span>
                    </div>

                    {/* Question Text */}
                    <p className="text-slate-100 text-xs font-medium leading-relaxed">
                      {showMcqNumbers ? (idx + 1) + '. ' : ''}{mcq.questionText}
                    </p>

                    {/* Options */}
                    <div className="space-y-1.5 pt-1">
                      {mcq.options.map((opt, oIdx) => (
                        <div key={oIdx} className="flex items-start gap-2 text-xs bg-white/[0.02] p-1.5 rounded-lg border border-white/[0.04]">
                          <span className="font-bold text-[#FF884D] w-4 font-mono">({opt.label.toLowerCase()})</span>
                          <span className="text-slate-300">{opt.text}</span>
                        </div>
                      ))}
                    </div>

                    {mcq.answer && showAnswers && (
                      <div className="py-1.5 px-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                        <p className="text-xs font-bold text-emerald-400">Answer: {mcq.answer}</p>
                      </div>
                    )}

                    {/* Integrated User-Owned Gemini Explanation & AI Assistant */}
                    <GeminiExplanationPanel
                      questionId={`mcq_${mcq.pageNumber}_${idx}_${mcq.questionText.slice(0, 30).replace(/\s+/g, '_')}`}
                      questionText={mcq.questionText}
                      options={mcq.options}
                      correctAnswer={mcq.answer}
                    />
                  </div>
                ))
              )}
            </div>
          </motion.div>

          <GeminiConnectModal
            isOpen={showConnectModal}
            onClose={() => {
              setShowConnectModal(false);
              checkAuth();
            }}
            onConnected={() => {
              setShowConnectModal(false);
              checkAuth();
            }}
          />

          <AiHistoryDrawer
            isOpen={showHistoryDrawer}
            onClose={() => setShowHistoryDrawer(false)}
          />

          <GeminiSettingsModal
            isOpen={showSettingsModal}
            onClose={() => {
              setShowSettingsModal(false);
              checkAuth();
            }}
          />

          <MocktestStudioModal
            isOpen={showMocktestModal}
            onClose={() => setShowMocktestModal(false)}
            initialItems={mocktestItems}
            defaultSetName="Mock Test Paper"
          />
        </>
      )}
    </AnimatePresence>
  );
};

export default McqSidebar;
