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
  status: string;
}

interface McqSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  pages: ScannedPage[];
  mcqMode: boolean;
  autoProofread: boolean;
}

const McqSidebar: React.FC<McqSidebarProps> = ({ isOpen, onClose, pages, mcqMode, autoProofread }) => {
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
        
        const lines = el.content.split('\n').map(l => l.trim()).filter(l => l);
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const cleanLine = line.replace(/[\*\_]/g, '').trim();
          
          // Match Q.1, 1., #1, Question 1, 100. What, Q100, 100 . What
          const qMatch = cleanLine.match(/^(?:Q(?:uestion)?\.?\s*|#\s*)(\d+)\s*[\.\)\-:]?\s*(.*)|^(\d+)\s*[\.\)\-:]\s*(.*)/i);
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
              questionText: qText,
              options: [],
              status: 'DRAFT'
            };
            continue;
          }
          
          // Match options: (A) text, A. text, Ans A. text, X A. text, ✓ A. text, A . text
          const optMatch = cleanLine.match(/^(?:Ans(?:wer)?\s*)?(?:[X✓x]\s*)?[\(\[]?([A-Ea-e])\s*[\.\)\]]\s*(.*)/);
          if (optMatch && currentQuestion) {
            currentQuestion.options!.push({
              label: optMatch[1].toUpperCase(),
              text: optMatch[2]
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
      
      const cleanedQuestions = await proofreadMcqs(allText);
      
      if (cleanedQuestions.length > 0) {
        const formattedMcqs: McqItem[] = cleanedQuestions.map((q, idx) => ({
          id: `proofread-${idx}-${Date.now()}`,
          pageNumber: 0, // AI cleaned version doesn't strictly follow pages
          questionNumber: (idx + 1).toString(),
          questionText: q.questionText,
          options: q.options,
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
      const content = `**Q.${idx + 1}** ${mcq.questionText}\n` + 
                      mcq.options.map(o => `(${o.label}) ${o.text}`).join('\n');
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
      window.URL.revokeObjectURL(url);
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
              <div class="q-text">Q.${idx + 1} ${mcq.questionText}</div>
              <div class="options">
                ${mcq.options.map(o => `<div class="option">(${o.label}) ${o.text}</div>`).join('')}
              </div>
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
            className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-40"
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 right-0 w-full max-w-md bg-slate-50 shadow-2xl z-50 flex flex-col border-l border-slate-200"
          >
            <div className="flex flex-col gap-3 p-4 bg-white border-b border-slate-200">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-800">MCQ Bank</h2>
                  <p className="text-xs text-slate-500">{mcqs.length} questions extracted</p>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              {/* Export Actions */}
              {mcqs.length > 0 && (
                <div className="flex flex-col gap-2 pt-2 border-t border-slate-100">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={exportToWord}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-sm font-semibold transition-colors"
                    >
                      <FileText className="w-4 h-4" />
                      Export Word
                    </button>
                    <button 
                      onClick={exportToPdf}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-lg text-sm font-semibold transition-colors"
                    >
                      <FileDown className="w-4 h-4" />
                      Export PDF
                    </button>
                  </div>
                  
                  <button 
                    onClick={handleProofread}
                    disabled={isProofreading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:from-orange-600 hover:to-amber-600 rounded-lg text-sm font-bold shadow-md shadow-orange-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isProofreading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        AI Proofreading...
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
                      className="text-[10px] text-slate-400 hover:text-slate-600 text-center underline"
                    >
                      Reset to auto-extracted version
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {!mcqMode ? (
                <div className="text-center py-12 text-slate-500">
                  <BookOpen className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                  <p className="font-bold">MCQ Mode is Disabled</p>
                  <p className="text-sm mt-1">Enable MCQ Mode from the top bar to extract questions.</p>
                </div>
              ) : mcqs.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <BookOpen className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                  <p>No MCQs found yet.</p>
                  <p className="text-sm mt-1">Convert a document containing multiple choice questions.</p>
                </div>
              ) : (
                mcqs.map((mcq, idx) => (
                  <div key={idx} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col gap-3">
                    {/* Top Row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <input type="checkbox" className="w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500" />
                        <div className="min-w-[24px] h-6 px-1.5 rounded-full bg-orange-50 text-orange-600 flex items-center justify-center text-xs font-bold">
                          {idx + 1}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-full">
                        <div className="w-2 h-2 rounded-full bg-slate-300" />
                        <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">{mcq.status}</span>
                      </div>
                    </div>

                    {/* Tags - Centered */}
                    <div className="flex flex-col items-center gap-1.5 -mt-2 mb-1">
                      <span className="px-3 py-0.5 bg-orange-50 text-orange-600 rounded-full text-[10px] font-bold uppercase tracking-wider">
                        MCQ
                      </span>
                      <span className="px-3 py-0.5 bg-orange-50 text-orange-600 rounded-full text-[10px] font-bold uppercase tracking-wider">
                        PAGE {mcq.pageNumber}
                      </span>
                    </div>

                    {/* Question Text */}
                    <p className="text-slate-800 text-sm font-medium line-clamp-3 whitespace-pre-wrap">
                      {mcq.questionText}
                    </p>

                    {/* Options */}
                    <div className="mt-1">
                      <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Options:</h4>
                      <div className="space-y-2">
                        {mcq.options.map((opt, oIdx) => (
                          <div key={oIdx} className="flex items-start gap-2 text-sm">
                            <span className="font-bold text-slate-400 w-4">{opt.label}.</span>
                            <span className="text-slate-700">{opt.text}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <hr className="border-slate-100 my-2" />

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button className="flex-1 flex items-center justify-center gap-1.5 py-1.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                        <Edit className="w-4 h-4" />
                        Edit
                      </button>
                      <button className="flex-1 flex items-center justify-center gap-1.5 py-1.5 border border-red-100 text-red-500 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors">
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    </div>

                    {/* Bottom Tags */}
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 border border-slate-100 rounded-lg text-xs text-slate-500">
                        <BookOpen className="w-3.5 h-3.5" />
                        Question Bank
                      </div>
                      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 border border-slate-100 rounded-lg text-xs text-slate-500">
                        <FileText className="w-3.5 h-3.5" />
                        1 Test
                      </div>
                    </div>
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
