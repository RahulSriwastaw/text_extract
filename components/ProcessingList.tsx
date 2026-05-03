import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { ScannedPage } from '../types';
import { Loader2, CheckCircle2, AlertCircle, Edit2, Copy, Save, X, Check, RefreshCw, FileText } from 'lucide-react';

// KaTeX CSS is loaded via CDN in index.html

interface ProcessingListProps {
  pages: ScannedPage[];
  onUpdateText: (id: string, newText: string) => void;
  onRetry: (id: string) => void;
  onToggleSelection: (id: string) => void;
  includeImages: boolean;
}

const ProcessingList: React.FC<ProcessingListProps> = ({ pages, onUpdateText, onRetry, onToggleSelection, includeImages }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
    <div className="mt-8 grid grid-cols-1 gap-5">
      {pages.map((page) => (
        <div 
            key={page.id} 
            className={`bg-[#1A1A1A] border rounded-[8px] overflow-hidden  flex flex-col md:flex-row h-auto min-h-[200px] md:min-h-[250px] transition-all duration-200 ${
                page.isSelected ? 'border-[#252525] ring-1 ring-slate-100' : 'border-[#252525] opacity-90'
            }`}
        >
          
          {/* Image Side */}
          <div 
            className="w-full md:w-1/4 bg-[#111111] relative group border-b md:border-b-0 md:border-r border-[#252525] cursor-pointer"
            onClick={() => onToggleSelection(page.id)}
          >
            <img 
              src={page.imageUrl} 
              alt={`Page ${page.pageNumber}`} 
              className="w-full h-full object-contain p-3 transition-opacity group-hover:opacity-90" 
            />
            
            {/* Bounding Box Overlays */}
            {includeImages && page.status === 'done' && page.elements && page.elements.map((el, index) => (
                el.type === 'image' && el.bbox && (
                    <div 
                        key={`overlay-${el.id || index}`}
                        className="absolute border-2 border-[#252525] bg-[#141414]/10 pointer-events-none"
                        style={{
                            top: `${(Math.min(el.bbox.ymin, el.bbox.ymax) / 1000) * 100}%`,
                            left: `${(Math.min(el.bbox.xmin, el.bbox.xmax) / 1000) * 100}%`,
                            width: `${Math.abs(el.bbox.xmax - el.bbox.xmin) / 1000 * 100}%`,
                            height: `${Math.abs(el.bbox.ymax - el.bbox.ymin) / 1000 * 100}%`,
                        }}
                    >
                        <span className="absolute -top-4 left-0 bg-[#141414] text-white text-[8px] px-1 rounded font-semibold">Image</span>
                    </div>
                )
            ))}

            {/* Selection Checkbox */}
            <div className="absolute top-2 left-2 z-10">
                <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                    page.isSelected 
                        ? 'bg-[#141414] border-[#252525] text-white' 
                        : 'bg-[#1A1A1A]/90 border-[#252525] hover:border-slate-500'
                }`}>
                    {page.isSelected && <Check className="w-3.5 h-3.5" />}
                </div>
            </div>

            <div className="absolute top-2 left-9 bg-[#0F0F0F]/60 text-white text-[10px] font-medium px-2 py-0.5 rounded backdrop-blur-sm">
                Page {page.pageNumber}
            </div>
            
            {/* Status Badge */}
            <div className="absolute top-2 right-2">
               {page.status === 'processing' && (
                 <span className="bg-[#141414]/90 backdrop-blur text-white text-[10px] font-medium px-2 py-0.5 rounded-[20px] flex items-center gap-1 ">
                   <Loader2 className="w-3 h-3 animate-spin" /> Processing
                 </span>
               )}
               {page.status === 'done' && (
                 <span className="bg-emerald-600/90 backdrop-blur text-white text-[10px] font-medium px-2 py-0.5 rounded-[20px] flex items-center gap-1 ">
                   <CheckCircle2 className="w-3 h-3" /> Done
                 </span>
               )}
               {page.status === 'error' && (
                 <span className="bg-[#3A1A1A] text-[#F44336] border border-[#F44336]/30/90 backdrop-blur text-white text-[10px] font-medium px-2 py-0.5 rounded-[20px] flex items-center gap-1 ">
                   <AlertCircle className="w-3 h-3" /> Failed
                 </span>
               )}
            </div>
          </div>

          {/* Text/Editor Side */}
          <div className="w-full md:w-3/4 flex flex-col h-[300px] md:h-auto">
            {/* Toolbar */}
            <div className="flex justify-between items-center px-3 py-2 border-b border-[#252525] bg-[#111111]/50">
                <span className="text-[10px] font-bold text-[#555555] uppercase tracking-wider">
                    {editingId === page.id ? "Edit Mode" : "Content"}
                </span>
                
                {page.status === 'done' && page.extractedText && (
                    <div className="flex gap-1.5">
                        {editingId === page.id ? (
                            <>
                                <button 
                                    onClick={() => handleSave(page.id)}
                                    className="flex items-center gap-1 px-2.5 py-1 bg-[#0F0F0F] text-white text-[10px] font-semibold rounded hover:bg-[#141414] transition-colors "
                                >
                                    <Save className="w-3 h-3" /> Save
                                </button>
                                <button 
                                    onClick={handleCancel}
                                    className="flex items-center gap-1 px-2.5 py-1 bg-[#1A1A1A] border border-[#252525] text-[#EFEFEF] text-[10px] font-semibold rounded hover:bg-[#111111] transition-colors "
                                >
                                    <X className="w-3 h-3" /> Cancel
                                </button>
                            </>
                        ) : (
                            <>
                                <button 
                                    onClick={() => handleEditClick(page)}
                                    className="flex items-center gap-1 px-2.5 py-1 bg-[#1A1A1A] border border-[#252525] text-[#EFEFEF] text-[10px] font-semibold rounded hover:bg-[#111111] transition-colors "
                                    title="Edit Text"
                                >
                                    <Edit2 className="w-3 h-3" /> Edit
                                </button>
                                <button 
                                    onClick={() => handleCopy(page.id, page.extractedText || '')}
                                    className="flex items-center gap-1 px-2.5 py-1 bg-[#1A1A1A] border border-[#252525] text-[#EFEFEF] text-[10px] font-semibold rounded hover:bg-[#111111] transition-colors "
                                    title="Copy to Clipboard"
                                >
                                    {copiedId === page.id ? <Check className="w-3 h-3 text-[#4CAF50]" /> : <Copy className="w-3 h-3" />}
                                    {copiedId === page.id ? "Copied" : "Copy"}
                                </button>
                                <button 
                                    onClick={() => handleCopy(page.id, `\`\`\`markdown\n${page.extractedText || ''}\n\`\`\``)}
                                    className="flex items-center gap-1 px-2.5 py-1 bg-[#1A1A1A] border border-[#252525] text-[#EFEFEF] text-[10px] font-semibold rounded hover:bg-[#111111] transition-colors "
                                    title="Copy as Markdown Code"
                                >
                                    <FileText className="w-3 h-3" /> MD
                                </button>
                                <button 
                                    onClick={() => onRetry(page.id)}
                                    className="flex items-center gap-1 px-2.5 py-1 bg-[#1A1A1A] border border-[#252525] text-[#EFEFEF] text-[10px] font-semibold rounded hover:bg-[#141414] transition-colors "
                                    title="Regenerate Page"
                                >
                                    <RefreshCw className="w-3 h-3" /> Regenerate
                                </button>
                            </>
                        )}
                    </div>
                )}
                
                {page.status === 'error' && (
                    <div className="flex gap-1.5">
                        <button 
                            onClick={() => onRetry(page.id)}
                            className="flex items-center gap-1 px-2.5 py-1 bg-[#3A1A1A] text-[#F44336] border border-[#F44336]/30 text-white text-[10px] font-semibold rounded hover:bg-[#F44336]/20 transition-colors "
                        >
                            <RefreshCw className="w-3 h-3" /> Retry
                        </button>
                    </div>
                )}
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-auto bg-[#1A1A1A] p-0 relative">
               {editingId === page.id ? (
                   <textarea
                     value={editText}
                     onChange={(e) => setEditText(e.target.value)}
                     className="w-full h-full p-3 text-[11px] font-mono text-[#EFEFEF] resize-none focus:outline-none focus:border-[#FF6B2B] focus:ring-2 focus:ring-inset focus:ring-slate-100 leading-relaxed bg-[#111111]/30"
                     spellCheck={false}
                   />
               ) : (
                    <div className="w-full h-full p-3 overflow-auto">
                        {page.elements && page.elements.length > 0 ? (
                            <div className="space-y-4">
                                {page.elements.filter(el => includeImages || el.type !== 'image').map((el, index) => (
                                    <div key={el.id || `el-${index}`} className="relative group p-2 -mx-2 rounded-[8px] hover:bg-[#111111]/50 transition-colors">
                                        {el.content && (
                                            <button
                                                onClick={() => handleCopy(el.id || `el-${index}`, el.content || '')}
                                                className="absolute top-2 right-2 p-1.5 bg-[#1A1A1A] border border-[#252525] rounded-[6px] text-[#555555] opacity-0 group-hover:opacity-100 transition-opacity  hover:bg-[#111111] hover:text-[#EFEFEF] z-10"
                                                title="Copy Content"
                                            >
                                                {copiedId === (el.id || `el-${index}`) ? <Check className="w-3.5 h-3.5 text-[#4CAF50]" /> : <Copy className="w-3.5 h-3.5" />}
                                            </button>
                                        )}
                                        {el.type === 'text' || el.type === 'table' ? (
                                            <div className="flex flex-col gap-1.5 pr-8">
                                                <div className="markdown-body prose prose-slate prose-sm max-w-none text-[#EFEFEF] leading-relaxed">
                                                    <ReactMarkdown 
                                                        remarkPlugins={[remarkMath, remarkGfm]} 
                                                        rehypePlugins={[rehypeKatex]}
                                                    >
                                                        {el.content || ''}
                                                    </ReactMarkdown>
                                                </div>
                                                {el.type === 'table' && el.imageB64 && (
                                                    <div className="mt-1.5 p-1.5 border border-[#252525] rounded bg-[#111111]/50">
                                                        <div className="text-[9px] font-bold text-[#555555] uppercase mb-1">Original Table Source</div>
                                                        <img src={el.imageB64} className="max-w-full h-auto rounded opacity-80 hover:opacity-100 transition-opacity" alt="Original table" />
                                                    </div>
                                                )}
                                            </div>
                                        ) : (el.type === 'image' || el.type === 'table') && el.imageB64 ? (
                                            <div className="flex flex-col gap-1.5 pr-8">
                                                <div className="text-[9px] font-bold text-[#555555] uppercase tracking-tighter">Detected Image</div>
                                                <img 
                                                    src={el.imageB64} 
                                                    alt="Extracted region" 
                                                    className="max-w-full h-auto rounded border border-[#252525]  bg-[#111111]"
                                                />
                                                {el.content && <p className="text-[10px] text-[#555555] italic">{el.content}</p>}
                                            </div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        ) : page.extractedText ? (
                            <div className="markdown-body prose prose-slate prose-sm max-w-none text-[#EFEFEF] leading-relaxed">
                                <ReactMarkdown 
                                    remarkPlugins={[remarkMath, remarkGfm]} 
                                    rehypePlugins={[rehypeKatex]}
                                >
                                    {page.extractedText || ''}
                                </ReactMarkdown>
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-[#555555] text-[11px] gap-2">
                                <span className="italic flex items-center gap-1.5">
                                    {page.status === 'pending' && 'Waiting to process...'} 
                                    {page.status === 'processing' && (
                                       <>
                                         <Loader2 className="w-3.5 h-3.5 animate-spin text-[#EFEFEF]" />
                                         <span className="text-[#EFEFEF] font-medium">Extracting text...</span>
                                       </>
                                    )} 
                                    {page.status === 'error' && (
                                       <span className="text-[#F44336] flex items-center gap-1.5">
                                          <AlertCircle className="w-3.5 h-3.5" /> Extraction failed.
                                       </span>
                                    )}
                                    {page.status === 'done' && !page.extractedText && 'No text found.'}
                                </span>

                                {page.status === 'error' && (
                                    <button 
                                        onClick={() => onRetry(page.id)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1A1A1A] border border-rose-200 text-[#F44336] rounded-[8px] hover:bg-[#1A2A3A] transition-all  text-[10px] font-semibold"
                                    >
                                        <RefreshCw className="w-3 h-3" /> Retry Page
                                    </button>
                                )}
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