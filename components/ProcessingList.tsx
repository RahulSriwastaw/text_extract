import React, { useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import { svgBlocksToMarkdown } from '../services/htmlLatex';

/** remark-math only understands $…$ / $$…$$; convert \( \) and \[ \] and tidy common LaTeX glitches. */
function normalizePreviewMath(text: string): string {
  if (!text) return text;
  return text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, t) => `\n\n$$\n${t.trim()}\n$$\n\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, t) => `$${t.trim()}$`)
    .replace(/\\begin\{align\*?\}/g, '\\begin{aligned}')
    .replace(/\\end\{align\*?\}/g, '\\end{aligned}')
    .replace(/\\begin\{gather\*?\}/g, '\\begin{gathered}')
    .replace(/\\end\{gather\*?\}/g, '\\end{gathered}')
    .replace(/\\cosec\b/g, '\\csc');
}
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { ScannedPage, NumberingStyle } from '../types';
import { Loader2, CheckCircle2, AlertCircle, Edit2, Copy, Save, X, Check, RefreshCw, FileText, Image as ImageIcon, Sparkles, Camera } from 'lucide-react';
import { formatQuestionPrefix, renumberQuestionInLine } from '../services/docxService';
import GeminiExplanationPanel from './GeminiExplanationPanel';

interface ProcessingListProps {
  pages: ScannedPage[];
  onUpdateText: (id: string, newText: string) => void;
  onRetry: (id: string) => void;
  onRecapture?: (id: string) => void;
  onToggleSelection: (id: string) => void;
  includeImages: boolean;
  showAnswers?: boolean;
  showMcqNumbers?: boolean;
  numberingStyle?: NumberingStyle;
  mcqMode?: boolean;
}

const processTextForDisplay = (
  rawText: string,
  startCounter: number,
  showMcqNumbers: boolean,
  numberingStyle: NumberingStyle,
  showAnswers: boolean,
  mcqMode: boolean = false
): { text: string; nextCounter: number } => {
  if (!rawText) return { text: '', nextCounter: startCounter };
  if (!mcqMode) {
    return { text: rawText, nextCounter: startCounter };
  }
  
  let res = rawText;
  if (!showAnswers) {
    res = res
      .replace(/([^\n]+?)\s*\/+\s*Answer\s*[:\-]\s*[a-eA-E]/gi, '$1')
      .replace(/^\s*Answer\s*[:\-]\s*[a-eA-E]\s*$/gim, '')
      .replace(/([^\n])\s+Answer\s*[:\-]\s*[a-eA-E]/gi, '$1')
      .trim();
  } else {
    res = res.replace(/([^\n]+?)\s*\/+\s*(Answer\s*[:\-]\s*[a-eA-E])/gi, '$1\n$2');
  }

  let currentCounter = startCounter;
  const lines = res.split('\n');
  const processedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cleanLineText = line.replace(/\*\*/g, '').trim();

    const isAnswerLine = /^Answer\s*[:\-]\s*[A-Ea-e]/i.test(cleanLineText);
    const isOption = !isAnswerLine && /^(\([a-eA-E0-9]\)|[a-eA-E0-9][\.\)]|[A-E][\.\)])\s/.test(cleanLineText);
    const isSubQuestion = !isOption && /^(\([ivxIVX]+\)|[ivxIVX]+\.|[ivxIVX]+[\)]|[\(\[]\w+[\)\]])\s/i.test(cleanLineText);
    const isMainQuestion = !isOption && !isAnswerLine && !isSubQuestion && (
      /^#\s*\d+/i.test(cleanLineText) ||
      /^(?:Q\.?\s*\d+|Prashn\s*[:\-]?\s*\d+|Question\s*[:\-]?\s*\d+|प्रश्न\s*[:\-]?\s*\d+|\d+|[\(\[]\d+[\)\]]|#\d+)[\.\)\-:]?\s/i.test(cleanLineText)
    );

    if (isMainQuestion) {
      if (showMcqNumbers) {
        processedLines.push(renumberQuestionInLine(line, currentCounter++, numberingStyle));
      } else {
        const numMatch = cleanLineText.match(/^(?:#?(?:Question|Q)\.?\s*[:\-]?\s*|\bPrashn\s*[:\-]?\s*|\bप्रश्न\s*[:\-]?\s*|#\s*)?(?:\((\d+)\)|\[(\d+)\]|(\d+))/i);
        const num = numMatch ? (numMatch[1] || numMatch[2] || numMatch[3]) : '';
        if (num) {
          processedLines.push(renumberQuestionInLine(line, num, numberingStyle));
        } else {
          processedLines.push(line);
        }
      }
    } else {
      processedLines.push(line);
    }
  }

  return { text: processedLines.join('\n'), nextCounter: currentCounter };
};

const ProcessingList: React.FC<ProcessingListProps> = ({ 
  pages, 
  onUpdateText, 
  onRetry, 
  onRecapture,
  onToggleSelection, 
  includeImages, 
  showAnswers = true,
  showMcqNumbers = true,
  numberingStyle = NumberingStyle.QUESTION_DOT,
  mcqMode = false
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [aiPanelOpenId, setAiPanelOpenId] = useState<string | null>(null);

  const processedPagesMap = React.useMemo(() => {
    let currentCounter = 1;
    const map = new Map<string, string>();
    for (const page of pages) {
      if (page.status === 'done' && page.extractedText) {
        const { text, nextCounter } = processTextForDisplay(
          page.extractedText,
          currentCounter,
          showMcqNumbers,
          numberingStyle,
          showAnswers,
          mcqMode
        );
        map.set(page.id, text);
        currentCounter = nextCounter;
      }
    }
    return map;
  }, [pages, showMcqNumbers, numberingStyle, showAnswers, mcqMode]);

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
    <div className="grid grid-cols-1 gap-4">
      {pages.map((page) => (
        <article
            key={page.id}
            className={`card overflow-hidden flex flex-col md:flex-row min-h-[260px] transition-colors ${
                page.isSelected ? 'border-accent/35' : 'opacity-80 hover:opacity-100'
            }`}
        >
          {/* Page image side (click toggles selection) */}
          <div className="w-full md:w-1/4 md:min-w-[220px] bg-canvas/60 border-b md:border-b-0 md:border-r border-line p-3 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 cursor-pointer select-none" title="Include this page in conversion">
                <input
                  type="checkbox"
                  checked={!!page.isSelected}
                  onChange={() => onToggleSelection(page.id)}
                  className="w-4 h-4 cursor-pointer"
                />
                <span className="text-sm font-semibold text-ink">Page {page.pageNumber}</span>
              </label>
              {page.status === 'processing' && (
                <span className="badge badge-accent"><Loader2 className="animate-spin" /> Converting</span>
              )}
              {page.status === 'done' && (
                <span className="badge badge-success"><CheckCircle2 /> Ready</span>
              )}
              {page.status === 'error' && (
                <span className="badge badge-danger"><AlertCircle /> Error</span>
              )}
              {page.status === 'pending' && (
                <span className="badge badge-neutral">Pending</span>
              )}
            </div>

            <button
              type="button"
              className="relative rounded-[10px] overflow-hidden border border-line bg-white/[0.03] flex items-center justify-center"
              onClick={() => onToggleSelection(page.id)}
              title={page.isSelected ? 'Deselect page' : 'Select page'}
            >
              <img
                src={page.imageUrl}
                alt={`Page ${page.pageNumber}`}
                className="w-full max-h-[300px] object-contain"
              />

              {/* Detected diagram overlays */}
              {includeImages && page.status === 'done' && page.elements && page.elements.map((el, index) => (
                  el.type === 'image' && el.bbox && (
                      <span
                          key={`overlay-${el.id || index}`}
                          className="absolute border-2 border-emerald-400 bg-emerald-400/10 pointer-events-none rounded"
                          style={{
                              top: `${(Math.min(el.bbox.ymin, el.bbox.ymax) / 1000) * 100}%`,
                              left: `${(Math.min(el.bbox.xmin, el.bbox.xmax) / 1000) * 100}%`,
                              width: `${Math.abs(el.bbox.xmax - el.bbox.xmin) / 1000 * 100}%`,
                              height: `${Math.abs(el.bbox.ymax - el.bbox.ymin) / 1000 * 100}%`,
                          }}
                      >
                          <span className="absolute -top-4 left-0 bg-emerald-500 text-slate-950 text-[10px] px-1 rounded font-semibold">Diagram</span>
                      </span>
                  )
              ))}
            </button>
          </div>

          {/* Extracted text side */}
          <div className="w-full md:flex-1 min-w-0 flex flex-col h-[380px] md:h-auto">
            <div className="flex flex-wrap justify-between items-center gap-2 px-4 py-2.5 border-b border-line">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-semibold text-ink">
                      {editingId === page.id ? 'Editing text' : 'Extracted text'}
                  </span>
                  {page.extractedText && (
                    <>
                      <span className="text-xs text-ink-3 tabular-nums">
                        {page.extractedText.split(/\s+/).filter(Boolean).length} words
                      </span>
                      {page.extractedText.split(/\s+/).filter(Boolean).length < 20 && onRecapture && (
                        <button
                          onClick={() => onRecapture(page.id)}
                          className="badge badge-warning cursor-pointer hover:bg-amber-500/20"
                          title="Click to recapture complete response from AI chat tab"
                        >
                          <Camera />
                          <span>Short response? Recapture</span>
                        </button>
                      )}
                    </>
                  )}
                </div>

                {page.status === 'done' && page.extractedText && (
                    <div className="flex items-center gap-1">
                        {editingId === page.id ? (
                            <>
                                <button onClick={handleCancel} className="btn btn-ghost btn-sm">
                                    <X /> Cancel
                                </button>
                                <button onClick={() => handleSave(page.id)} className="btn btn-primary btn-sm">
                                    <Save /> Save
                                </button>
                            </>
                        ) : (
                            <>
                                <button onClick={() => handleEditClick(page)} className="btn btn-secondary btn-sm" title="Edit text">
                                    <Edit2 /> Edit
                                </button>
                                <button
                                    onClick={() => handleCopy(page.id, processedPagesMap.get(page.id) || page.extractedText || '')}
                                    className="btn btn-ghost btn-sm"
                                    title="Copy text"
                                >
                                    {copiedId === page.id ? <Check className="text-emerald-400" /> : <Copy />}
                                    {copiedId === page.id ? 'Copied' : 'Copy'}
                                </button>
                                <button
                                    onClick={() => handleCopy(page.id, `\`\`\`markdown\n${processedPagesMap.get(page.id) || page.extractedText || ''}\n\`\`\``)}
                                    className="btn btn-ghost btn-sm"
                                    title="Copy as Markdown code"
                                >
                                    <FileText /> MD
                                </button>
                                <button
                                    onClick={() => setAiPanelOpenId(aiPanelOpenId === page.id ? null : page.id)}
                                    aria-pressed={aiPanelOpenId === page.id}
                                    className={`btn btn-ghost btn-sm ${aiPanelOpenId === page.id ? 'bg-white/[0.06] text-ink' : ''}`}
                                    title="Ask Gemini or explain extracted content"
                                >
                                    <Sparkles /> Ask AI
                                </button>
                                {onRecapture && (
                                    <button
                                        type="button"
                                        onClick={() => onRecapture(page.id)}
                                        className="btn btn-ghost btn-sm btn-icon"
                                        title="Recapture full finished response from AI chat tab without re-uploading"
                                        aria-label="Recapture from AI tab"
                                    >
                                        <Camera />
                                    </button>
                                )}
                                <button
                                    onClick={() => onRetry(page.id)}
                                    className="btn btn-ghost btn-sm btn-icon"
                                    title="Convert this page again"
                                    aria-label="Convert this page again"
                                >
                                    <RefreshCw />
                                </button>
                            </>
                        )}
                    </div>
                )}

                {page.status === 'error' && (
                    <div className="flex items-center gap-1.5">
                        {onRecapture && (
                            <button
                                type="button"
                                onClick={() => onRecapture(page.id)}
                                className="btn btn-secondary btn-sm"
                                title="Recapture from AI tab"
                            >
                                <Camera /> Recapture
                            </button>
                        )}
                        <button onClick={() => onRetry(page.id)} className="btn btn-primary btn-sm">
                            <RefreshCw /> Retry page
                        </button>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-auto p-4 sm:p-5 relative">
               {editingId === page.id ? (
                   <textarea
                     value={editText}
                     onChange={(e) => setEditText(e.target.value)}
                     className="textarea h-full min-h-[240px] font-mono text-xs resize-none"
                     placeholder="Edit extracted content..."
                     autoFocus
                   />
               ) : (
                   <div>
                      {page.status === 'done' && page.extractedText ? (
                          <>
                            <div className="markdown-body max-w-none text-sm leading-relaxed">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm, remarkMath]}
                                  rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore', errorColor: '#f87171' }]]}
                                  urlTransform={(url) => (/^data:image\//i.test(url) ? url : defaultUrlTransform(url))}
                                >
                                  {svgBlocksToMarkdown(normalizePreviewMath(processedPagesMap.get(page.id) || page.extractedText))}
                                </ReactMarkdown>
                            </div>

                            {/* Inline Gemini AI Assistant for Extracted Page */}
                            {aiPanelOpenId === page.id && (
                              <div className="mt-4 pt-3 border-t border-line">
                                <GeminiExplanationPanel
                                  questionId={`extracted_page_${page.id}_${page.pageNumber}`}
                                  questionText={processedPagesMap.get(page.id) || page.extractedText || ''}
                                  options={[]}
                                />
                              </div>
                            )}
                          </>
                      ) : page.status === 'processing' ? (
                          <div className="flex flex-col items-center justify-center h-48 gap-3 text-ink-3" role="status">
                             <Loader2 className="w-7 h-7 text-accent animate-spin" />
                             <span className="text-sm">Reading layout, math and text…</span>
                          </div>
                      ) : page.status === 'error' ? (
                          <div className="flex flex-col items-center justify-center h-48 gap-3 text-rose-300">
                             <AlertCircle className="w-7 h-7" />
                             <span className="text-sm text-center max-w-sm">
                               {page.errorMessage || "Extraction failed. Use “Retry page” above to try again."}
                             </span>
                          </div>
                      ) : (
                          <div className="flex flex-col items-center justify-center h-48 gap-1 text-center">
                             <span className="text-sm font-medium text-ink-2">Waiting to convert</span>
                             <span className="text-sm text-ink-3">Use “Convert” in the toolbar to start.</span>
                          </div>
                      )}
                   </div>
               )}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
};

export default ProcessingList;