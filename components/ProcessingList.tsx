import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { ScannedPage } from '../types';
import { Loader2, CheckCircle2, AlertCircle, Edit2, Copy, Save, X, Check, RefreshCw, FileText, Image as ImageIcon } from 'lucide-react';

interface ProcessingListProps {
  pages: ScannedPage[];
  onUpdateText: (id: string, newText: string) => void;
  onRetry: (id: string) => void;
  onToggleSelection: (id: string) => void;
  includeImages: boolean;
  showAnswers?: boolean;
}

const ProcessingList: React.FC<ProcessingListProps> = ({ 
  pages, 
  onUpdateText, 
  onRetry, 
  onToggleSelection, 
  includeImages, 
  showAnswers = true 
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const formatDisplayContent = (content: string) => {
    if (!content) return content;
    let res = content;
    if (!showAnswers) {
      res = res
        .replace(/([^\n]+?)\s*\/+\s*Answer\s*[:\-]\s*[a-eA-E]/gi, '$1')
        .replace(/^\s*Answer\s*[:\-]\s*[a-eA-E]\s*$/gim, '')
        .replace(/([^\n])\s+Answer\s*[:\-]\s*[a-eA-E]/gi, '$1')
        .trim();
    } else {
      res = res.replace(/([^\n]+?)\s*\/+\s*(Answer\s*[:\-]\s*[a-eA-E])/gi, '$1\n$2');
    }
    return res;
  };

  if (pages.length === 0) return null;

  const handleEditClick = (page: ScannedPage) => {
    if (page.extractedText) {
      setEditingId(page.id);
      setEditText(page.extractedText);
    }
  };

  const handleSave = (id: string) => {
    onUpdateText(id, editText);
    setEditingId(null);
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditText('');
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  return (
    <div className="mt-8 grid grid-cols-1 gap-6">
      {pages.map((page) => (
        <div 
            key={page.id} 
            className={`glass-panel rounded-2xl overflow-hidden shadow-xl flex flex-col md:flex-row h-auto min-h-[260px] transition-all duration-300 ${
                page.isSelected 
                  ? 'border-white/[0.15] ring-2 ring-[#FF6B2B]/40 bg-[#11141F]/80' 
                  : 'border-white/[0.05] opacity-80 hover:opacity-100 bg-[#0B0D13]/60'
            }`}
        >
          
          {/* Image Thumbnail Side */}
          <div 
            className="w-full md:w-1/4 bg-[#08090D] relative group border-b md:border-b-0 md:border-r border-white/[0.08] cursor-pointer flex items-center justify-center p-3"
            onClick={() => onToggleSelection(page.id)}
          >
            <img 
              src={page.imageUrl} 
              alt={`Page ${page.pageNumber}`} 
              className="w-full max-h-[300px] object-contain rounded-lg transition-transform duration-300 group-hover:scale-[1.02]" 
            />
            
            {/* Bounding Box Overlays */}
            {includeImages && page.status === 'done' && page.elements && page.elements.map((el, index) => (
                el.type === 'image' && el.bbox && (
                    <div 
                        key={`overlay-${el.id || index}`}
                        className="absolute border-2 border-emerald-400 bg-emerald-400/10 pointer-events-none rounded"
                        style={{
                            top: `${(Math.min(el.bbox.ymin, el.bbox.ymax) / 1000) * 100}%`,
                            left: `${(Math.min(el.bbox.xmin, el.bbox.xmax) / 1000) * 100}%`,
                            width: `${Math.abs(el.bbox.xmax - el.bbox.xmin) / 1000 * 100}%`,
                            height: `${Math.abs(el.bbox.ymax - el.bbox.ymin) / 1000 * 100}%`,
                        }}
                    >
                        <span className="absolute -top-3.5 left-0 bg-emerald-500 text-slate-950 text-[8px] px-1 rounded font-black uppercase">Diagram</span>
                    </div>
                )
            ))}

            {/* Selection Checkbox */}
            <div className="absolute top-3 left-3 z-10">
                <div className={`w-5 h-5 rounded-lg border flex items-center justify-center transition-all ${
                    page.isSelected 
                        ? 'bg-gradient-to-r from-[#FF6B2B] to-[#FF884D] border-[#FF6B2B] text-white shadow-md shadow-[#FF6B2B]/30' 
                        : 'bg-[#0B0D13]/80 border-white/[0.2] hover:border-white/[0.4]'
                }`}>
                    {page.isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </div>
            </div>

            <div className="absolute top-3 left-10 bg-slate-900/80 text-slate-200 text-[10px] font-bold px-2 py-0.5 rounded-md backdrop-blur-md border border-white/[0.08]">
                Page {page.pageNumber}
            </div>
            
            {/* Status Badge */}
            <div className="absolute top-3 right-3">
               {page.status === 'processing' && (
                 <span className="bg-blue-500/15 border border-blue-500/30 text-blue-400 text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-sm">
                   <Loader2 className="w-3 h-3 animate-spin" /> Digitizing...
                 </span>
               )}
               {page.status === 'done' && (
                 <span className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-sm">
                   <CheckCircle2 className="w-3 h-3" /> Ready
                 </span>
               )}
               {page.status === 'error' && (
                 <span className="bg-rose-500/15 border border-rose-500/30 text-rose-400 text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-sm">
                   <AlertCircle className="w-3 h-3" /> Error
                 </span>
               )}
            </div>
          </div>

          {/* Text & Content Viewer / Editor Side */}
          <div className="w-full md:w-3/4 flex flex-col h-[360px] md:h-auto bg-[#0E111A]">
            {/* Content Toolbar */}
            <div className="flex justify-between items-center px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-display">
                      {editingId === page.id ? "Live Editor" : "Extracted Document"}
                  </span>
                  {page.extractedText && (
                    <span className="text-[10px] text-slate-500 font-mono">
                      ({page.extractedText.split(/\s+/).filter(Boolean).length} words)
                    </span>
                  )}
                </div>
                
                {page.status === 'done' && page.extractedText && (
                    <div className="flex items-center gap-1.5">
                        {editingId === page.id ? (
                            <>
                                <button 
                                    onClick={() => handleSave(page.id)}
                                    className="flex items-center gap-1 px-3 py-1 bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-bold rounded-lg transition-all shadow-sm"
                                >
                                    <Save className="w-3.5 h-3.5" /> Save
                                </button>
                                <button 
                                    onClick={handleCancel}
                                    className="flex items-center gap-1 px-3 py-1 bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 text-xs font-bold rounded-lg border border-white/[0.08] transition-all"
                                >
                                    <X className="w-3.5 h-3.5" /> Cancel
                                </button>
                            </>
                        ) : (
                            <>
                                <button 
                                    onClick={() => handleEditClick(page)}
                                    className="flex items-center gap-1 px-2.5 py-1 bg-white/[0.03] hover:bg-white/[0.08] text-slate-300 hover:text-white text-xs font-semibold rounded-lg border border-white/[0.06] transition-all"
                                    title="Edit Text"
                                >
                                    <Edit2 className="w-3.5 h-3.5 text-slate-400" /> Edit
                                </button>
                                <button 
                                    onClick={() => handleCopy(page.id, formatDisplayContent(page.extractedText || ''))}
                                    className="flex items-center gap-1 px-2.5 py-1 bg-white/[0.03] hover:bg-white/[0.08] text-slate-300 hover:text-white text-xs font-semibold rounded-lg border border-white/[0.06] transition-all"
                                    title="Copy Text"
                                >
                                    {copiedId === page.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
                                    {copiedId === page.id ? "Copied" : "Copy"}
                                </button>
                                <button 
                                    onClick={() => handleCopy(page.id, `\`\`\`markdown\n${formatDisplayContent(page.extractedText || '')}\n\`\`\``)}
                                    className="flex items-center gap-1 px-2.5 py-1 bg-white/[0.03] hover:bg-white/[0.08] text-slate-300 hover:text-white text-xs font-semibold rounded-lg border border-white/[0.06] transition-all"
                                    title="Copy Markdown Code"
                                >
                                    <FileText className="w-3.5 h-3.5 text-slate-400" /> MD
                                </button>
                                <button 
                                    onClick={() => onRetry(page.id)}
                                    className="flex items-center gap-1 px-2.5 py-1 bg-white/[0.03] hover:bg-white/[0.08] text-slate-400 hover:text-[#FF884D] text-xs font-semibold rounded-lg border border-white/[0.06] transition-all"
                                    title="Reprocess Page"
                                >
                                    <RefreshCw className="w-3.5 h-3.5" />
                                </button>
                            </>
                        )}
                    </div>
                )}
                
                {page.status === 'error' && (
                    <div className="flex gap-1.5">
                        <button 
                            onClick={() => onRetry(page.id)}
                            className="flex items-center gap-1.5 px-3 py-1 bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-bold rounded-lg hover:bg-rose-500/25 transition-all"
                        >
                            <RefreshCw className="w-3 h-3" /> Retry Page
                        </button>
                    </div>
                )}
            </div>

            {/* Content Display Area */}
            <div className="flex-1 overflow-auto p-4 sm:p-5 relative custom-scrollbar">
               {editingId === page.id ? (
                   <textarea
                     value={editText}
                     onChange={(e) => setEditText(e.target.value)}
                     className="w-full h-full bg-[#08090D] text-slate-100 p-3 rounded-xl border border-white/[0.1] font-mono text-xs focus:outline-none focus:border-[#FF6B2B] focus:ring-1 focus:ring-[#FF6B2B]/50 resize-none leading-relaxed"
                     placeholder="Edit extracted content..."
                     autoFocus
                   />
               ) : (
                   <div>
                      {page.status === 'done' && page.extractedText ? (
                          <div className="markdown-body prose prose-invert max-w-none text-xs sm:text-sm leading-relaxed">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm, remarkMath]}
                                rehypePlugins={[rehypeKatex]}
                              >
                                {formatDisplayContent(page.extractedText)}
                              </ReactMarkdown>
                          </div>
                      ) : page.status === 'processing' ? (
                          <div className="flex flex-col items-center justify-center h-48 gap-3 text-slate-400">
                             <Loader2 className="w-7 h-7 text-[#FF6B2B] animate-spin" />
                             <span className="text-xs font-medium tracking-wide">Transcribing layout, math & text...</span>
                          </div>
                      ) : page.status === 'error' ? (
                          <div className="flex flex-col items-center justify-center h-48 gap-3 text-rose-400">
                             <AlertCircle className="w-8 h-8" />
                             <span className="text-xs font-semibold text-center max-w-sm">
                               {page.errorMessage || "Extraction failed. Click 'Retry Page' above to try again."}
                             </span>
                          </div>
                      ) : (
                          <div className="flex items-center justify-center h-48 text-slate-500 text-xs">
                             Pending conversion... Click CONVERT to start.
                          </div>
                      )}
                   </div>
               )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ProcessingList;