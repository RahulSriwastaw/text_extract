import React, { useMemo, useState } from 'react';
import { X, Edit, Trash2, BookOpen, FileText, Download, FileDown, Sparkles, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ScannedPage, OptionArrangement } from '../types';
import { generateDocx } from '../services/docxService';
import { proofreadMcqs } from '../services/geminiService';

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
  let cleaned = text.replace(/^(\s*(?:(?:Question|Q)\.?\s*[:\-]?\s*\d+\.?|#\d+\.?|\d+\.)\s*)([^\n/]+?)\s*\/\s*([^\n/]+)$/gm, (match, prefix, left, right) => {
    const lNorm = left.trim();
    const rNorm = right.trim();
    if (lNorm.toLowerCase() === rNorm.toLowerCase()) {
      return prefix + lNorm;
    }
    return match;
  });
  cleaned = cleaned.replace(/^(\s*(?:(?:Question|Q)\.?\s*[:\-]?\s*\d+[\.\)\-:]?|#\d+[\.\)\-:]?|\d+[\.\)\-:]?)\s+[^\n/]+?)\s*\/+\s*([A-Za-z\$\\\(\[\{\d][^\n]+)$/gm, (match, hindiPart, engPart) => {
    const cleanHindi = hindiPart.replace(/\s*\/+$/, '').trim();
    const cleanEng = engPart.trim();
    if (/[\u0900-\u097F]/.test(cleanHindi) || /[a-zA-Z]/.test(cleanEng)) {
      return cleanHindi + '\n' + cleanEng;
    }
    return match;
  });
  cleaned = cleaned.replace(/^(\s*\([a-eA-E]\)\s+[^\n/]+?)\r?\n\s*([a-zA-Z][^\n]+)$/gm, (match, optHindi, optEng) => {
    return optHindi.trim() + ' / ' + optEng.trim();
  });
  cleaned = cleaned.replace(/^(\s*(?:\([a-zA-Z0-9]+\)|[a-zA-Z0-9]+[\.\)])\s*)([^\n/]+?)\s*\/\s*([^\n/]+)$/gm, (match, prefix, left, right) => {
    const lNorm = left.trim();
    const rNorm = right.trim();
    if (lNorm.toLowerCase() === rNorm.toLowerCase() || lNorm.replace(/\s+/g, '').toLowerCase() === rNorm.replace(/\s+/g, '').toLowerCase()) {
      return prefix + lNorm;
    }
    return match;
  });
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
              currentQuestion.questionText += (currentQuestion.questionText ? '\n' : '') + line;
            } else {
              // Continuation of the last option
              const lastOption = currentQuestion.options![currentQuestion.options!.length - 1];
              lastOption.text += '\n' + line;
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
    
    const elements = mcqs.map((mcq, idx) => {
      // Helper to ensure LaTeX is wrapped in $$ for docxService to pick it up
      const ensureLatexWrapped = (text: string) => {
        if (!text) return "";
        // If it already has any math delimiters, it's probably fine
        if (text.includes('$') || text.includes('\\(') || text.includes('\\[')) return text;
        
        // If it looks like it has LaTeX but no delimiters, wrap it
        // A simple heuristic: check for backslashes followed by common math commands
        if (/\\[a-zA-Z]+/.test(text) || /[_^]/.test(text)) {
           return `$$ ${text} $$`;
        }
        return text;
      };

      const qText = ensureLatexWrapped(mcq.questionText);
      const optionsText = mcq.options.map(o => {
        return `(${o.label.toLowerCase()}) ${ensureLatexWrapped(o.text)}`;
      }).join('\n');

      let content = `**Question: ${showMcqNumbers ? (idx + 1) + '. ' : ''}**${qText}\n${optionsText}`;
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
                <button
                  onClick={onClose}
                  className="p-2 text-slate-400 hover:text-white hover:bg-white/[0.08] rounded-xl transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
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
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default McqSidebar;
