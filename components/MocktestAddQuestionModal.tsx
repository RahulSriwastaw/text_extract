import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { 
  X, 
  Send, 
  Sparkles, 
  Check, 
  Loader2, 
  Upload, 
  Image as ImageIcon, 
  FileText, 
  Plus, 
  RotateCcw,
  BookOpen,
  HelpCircle,
  Clock,
  ArrowRight,
  ClipboardPaste,
  Layers
} from 'lucide-react';
import { MockTestMcqItem, DifficultyLevel } from '../types';
import { LatexRenderer } from './MocktestExtractor';
import { 
  addMockTestQuestionWithAi, 
  chatFixMockTestItemWithAi,
  STANDARD_SUBJECTS 
} from '../services/mocktestService';

interface MocktestAddQuestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  totalPages: number;
  defaultPageNumber?: number;
  nextQuestionNumber: number;
  setName: string;
  onAddQuestion: (newItem: MockTestMcqItem, targetPageNumber: number) => void;
}

const LatexContent: React.FC<{ content: string; className?: string; inline?: boolean }> = ({ content, className, inline }) => {
  if (!content) return null;
  return <LatexRenderer content={content} className={className} inline={inline} />;
};

export const MocktestAddQuestionModal: React.FC<MocktestAddQuestionModalProps> = ({
  isOpen,
  onClose,
  totalPages,
  defaultPageNumber = 1,
  nextQuestionNumber,
  setName,
  onAddQuestion
}) => {
  if (!isOpen) return null;

  const [targetPage, setTargetPage] = useState<number>(defaultPageNumber);
  const [qNumber, setQNumber] = useState<number>(nextQuestionNumber);
  const [selectedDifficulty, setSelectedDifficulty] = useState<DifficultyLevel>('medium');
  const [inputText, setInputText] = useState<string>('');
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [generatedItem, setGeneratedItem] = useState<MockTestMcqItem | null>(null);
  const [aiSummary, setAiSummary] = useState<string>('');
  const [activeLang, setActiveLang] = useState<'hi' | 'en'>('hi');
  const [refinePrompt, setRefinePrompt] = useState<string>('');
  const [isRefining, setIsRefining] = useState<boolean>(false);
  const [keepOpen, setKeepOpen] = useState<boolean>(false);
  const [justAddedToast, setJustAddedToast] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Clipboard Paste Listener (Supports Ctrl+V anywhere in modal)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === 'string') {
                setAttachedImage(reader.result);
              }
            };
            reader.readAsDataURL(file);
            e.preventDefault();
            return;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  // Update qNumber when nextQuestionNumber changes
  useEffect(() => {
    setQNumber(nextQuestionNumber);
  }, [nextQuestionNumber]);

  // Image Upload handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAttachedImage(reader.result);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Generate / Extract question with AI
  const handleGenerate = async (customPrompt?: string) => {
    const textToUse = (customPrompt || inputText).trim();
    if (!textToUse && !attachedImage) {
      alert('कृपया प्रश्न का टेक्स्ट लिखें या स्क्रीनशॉट/इमेज पेस्ट करें (Ctrl+V).');
      return;
    }

    setIsProcessing(true);
    setJustAddedToast(null);

    try {
      const res = await addMockTestQuestionWithAi({
        text: textToUse,
        base64Image: attachedImage || undefined,
        setName,
        targetPageNumber: targetPage,
        nextQuestionNumber: qNumber,
        difficulty: selectedDifficulty
      });

      if (!res.item || (!res.item.question_hi && !res.item.question_en)) {
        throw new Error('AI ने प्रश्न तैयार नहीं किया या उत्तर खाली रहा। कृपया पुनः प्रयास करें।');
      }
      setGeneratedItem(res.item);
      setAiSummary(res.summary);
    } catch (err: any) {
      alert(`प्रश्न तैयार करने में त्रुटि: ${err.message || err}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Refine / Chat about the generated question
  const handleRefine = async () => {
    if (!generatedItem || !refinePrompt.trim() || isRefining) return;

    setIsRefining(true);
    try {
      const { updatedItem, reply } = await chatFixMockTestItemWithAi(
        generatedItem,
        refinePrompt.trim()
      );
      setGeneratedItem(updatedItem);
      setAiSummary(reply);
      setRefinePrompt('');
    } catch (err: any) {
      alert(`रिफाइन करने में त्रुटि: ${err.message || err}`);
    } finally {
      setIsRefining(false);
    }
  };

  // Add the finalized question to paper
  const handleCommitQuestion = () => {
    if (!generatedItem) return;

    onAddQuestion(generatedItem, targetPage);
    setJustAddedToast(`✓ Q#${generatedItem.question_r} को Page ${targetPage} में जोड़ दिया गया!`);

    if (keepOpen) {
      // Prepare for next question
      setGeneratedItem(null);
      setAttachedImage(null);
      setInputText('');
      setAiSummary('');
      setQNumber(prev => prev + 1);
    } else {
      setTimeout(() => {
        onClose();
      }, 500);
    }
  };

  const quickChips = [
    { label: '📸 स्क्रीनशॉट से प्रश्न व हल निकालो', prompt: 'अटैच किए गए स्क्रीनशॉट/इमेज में से प्रश्न, चारों विकल्प और सही उत्तर निकालकर पूर्ण 34-कॉलम MCQ और Step-by-Step हल तैयार करो।' },
    { label: '📅 Current Affairs (पिछले 1 साल का)', prompt: 'पिछले 1 वर्ष (12 महीने) की किसी प्रमुख राष्ट्रीय योजना, बजट या खेल प्रतियोगिता पर एक नया परीक्षा-उपयोगी Current Affairs प्रश्न तैयार करो।' },
    { label: '📐 गणित (Speed & Distance)', prompt: 'चाल, समय और दूरी (Speed, Time & Distance) पर एक नया परीक्षा-उपयोगी गणितीय प्रश्न तैयार करो जिसमें पूरा Step-by-Step हल Unicode में हो।' },
    { label: '🧩 रीजनिंग (कोडिंग-डिकोडिंग)', prompt: 'रीजनिंग में एक नया Coding-Decoding या Pattern Series प्रश्न 4 विकल्पों और विस्तृत लॉजिक के साथ तैयार करो।' },
    { label: '📜 भारतीय संविधान (Polity)', prompt: 'भारतीय संविधान के किसी महत्वपूर्ण अनुच्छेद या संशोधन पर एक उच्च-गुणवत्ता वाला MCQ प्रश्न तैयार करो।' },
    { label: '🧪 सामान्य विज्ञान (General Science)', prompt: 'भौतिकी या रसायन विज्ञान के एक मुख्य वैज्ञानिक नियम/कारण पर प्रश्न और विस्तृत व्याख्या तैयार करो।' }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-fade-in">
      <div 
        className="relative w-full max-w-5xl max-h-[92vh] flex flex-col bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-950/90 border-b border-white/[0.08]">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 shadow-md shadow-amber-500/20 text-black font-extrabold">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-extrabold text-sm text-white">
                  Add New Question via AI / Paste Screenshot
                </span>
                <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-extrabold text-[10px] border border-amber-500/30">
                  Ctrl+V Paste Support
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Paste a screenshot, raw text, or describe what question to create with full bilingual formatting
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.1] transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Controls Bar (Target Page, Q#, Difficulty) */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 bg-slate-950/60 border-b border-white/[0.06] text-xs">
          <div className="flex flex-wrap items-center gap-4">
            {/* Target Page Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-400 uppercase">Target Page:</span>
              <select
                value={targetPage}
                onChange={(e) => setTargetPage(Number(e.target.value))}
                className="bg-black/60 border border-white/[0.12] rounded-lg px-2.5 py-1 text-xs text-amber-300 font-bold focus:outline-none"
              >
                {Array.from({ length: Math.max(totalPages, 1) }, (_, i) => i + 1).map((num) => (
                  <option key={num} value={num} className="bg-slate-900 text-white">
                    Page {num}
                  </option>
                ))}
              </select>
            </div>

            {/* Question Number */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-400 uppercase">Question #:</span>
              <input
                type="number"
                value={qNumber}
                onChange={(e) => setQNumber(Number(e.target.value))}
                min={1}
                className="w-16 bg-black/60 border border-white/[0.12] rounded-lg px-2 py-1 text-xs text-white font-extrabold text-center focus:outline-none"
              />
            </div>

            {/* Difficulty */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-400 uppercase">Diff:</span>
              <select
                value={selectedDifficulty}
                onChange={(e) => setSelectedDifficulty(e.target.value as DifficultyLevel)}
                className="bg-black/60 border border-white/[0.12] rounded-lg px-2 py-1 text-xs text-slate-200 capitalize focus:outline-none"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
          </div>

          <div className="text-[11px] text-slate-400">
            Set: <strong className="text-white">{setName}</strong>
          </div>
        </div>

        {/* Modal Main Content Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          {/* Top Banner: Clipboard Paste Guide */}
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-gradient-to-r from-amber-500/10 via-violet-500/10 to-transparent border border-white/[0.08] text-xs">
            <div className="flex items-center gap-2 text-slate-300">
              <ClipboardPaste className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong>Quick Paste Tip:</strong> Take any screenshot using Windows Snip tool, then press <kbd className="px-1.5 py-0.5 rounded bg-black/50 border border-white/20 font-mono text-[10px] text-amber-300">Ctrl + V</kbd> to paste it here instantly!
              </span>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.1] text-xs font-semibold text-slate-200 transition-all shrink-0"
            >
              <Upload className="w-3.5 h-3.5 text-amber-400" />
              <span>Upload Image File</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {/* Attached Image Thumbnail (if any) */}
          {attachedImage && (
            <div className="p-3 rounded-xl bg-black/50 border border-amber-500/40 flex items-center justify-between gap-3 animate-fade-in">
              <div className="flex items-center gap-3">
                <img 
                  src={attachedImage} 
                  alt="Pasted Question Screenshot" 
                  className="w-24 h-16 object-contain rounded-lg border border-white/[0.1] bg-black"
                />
                <div>
                  <p className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span>Screenshot Attached ({attachedImage.length > 50000 ? `${Math.round(attachedImage.length / 1024)} KB` : 'Pasted'})</span>
                  </p>
                  <p className="text-[11px] text-slate-400">
                    AI will read the question text, options, and figure directly from this image.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setAttachedImage(null)}
                className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-white/[0.06] transition-colors"
                title="Remove image"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Raw Text or Prompt Textarea */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="font-bold text-slate-300">
                Question Text, Raw Question Content, or Generation Instruction:
              </label>
              <span className="text-[10px] text-slate-500">Bilingual translation & YCT proof generated automatically</span>
            </div>
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="उदा: यहाँ किसी भी प्रश्न का कच्चा टेक्स्ट पेस्ट करें, या लिखें: 'बजट 2026 में खेल विकास योजना पर 4 ऑप्शन वाला नया प्रश्न तैयार करो'..."
              rows={3}
              className="w-full bg-slate-950/80 border border-white/[0.1] focus:border-amber-500/60 rounded-xl p-3 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none resize-none shadow-inner"
            />
          </div>

          {/* Quick Suggestion Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
            {quickChips.map((chip, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setInputText(chip.prompt);
                  handleGenerate(chip.prompt);
                }}
                disabled={isProcessing}
                className="shrink-0 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-amber-500/20 border border-white/[0.06] hover:border-amber-500/30 text-[11px] font-semibold text-slate-300 hover:text-amber-200 transition-all disabled:opacity-40"
              >
                {chip.label}
              </button>
            ))}
          </div>

          {/* Generate Action Button */}
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => handleGenerate()}
              disabled={(!inputText.trim() && !attachedImage) || isProcessing}
              className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-extrabold rounded-xl text-xs transition-all disabled:opacity-40 shadow-lg shadow-amber-500/20"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>AI Parsing & Digitizing Question...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>{attachedImage ? '⚡ Extract & Format Question' : '⚡ Generate Full Question with AI'}</span>
                </>
              )}
            </button>
          </div>

          {/* AI Generated Question Live Preview Card */}
          {generatedItem && (
            <div className="p-4 rounded-xl bg-slate-950/80 border border-amber-500/40 space-y-3.5 shadow-xl animate-fade-in">
              <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-amber-500 text-black font-extrabold text-xs">
                    Q#{generatedItem.question_r}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 font-bold text-[10px] border border-violet-500/30">
                    {generatedItem.subject}
                  </span>
                  <span className="text-[11px] text-emerald-400 font-bold">
                    Ans: {generatedItem.answer}
                  </span>
                </div>

                {/* Language Switcher for Preview */}
                <div className="flex items-center p-0.5 bg-black/40 border border-white/[0.1] rounded-lg text-xs">
                  <button
                    type="button"
                    onClick={() => setActiveLang('hi')}
                    className={`px-2 py-0.5 font-bold rounded transition-all ${
                      activeLang === 'hi' ? 'bg-amber-500 text-black' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    हिन्दी
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveLang('en')}
                    className={`px-2 py-0.5 font-bold rounded transition-all ${
                      activeLang === 'en' ? 'bg-blue-500 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    English
                  </button>
                </div>
              </div>

              {/* Question Stem */}
              <div className="p-3 rounded-lg bg-slate-900 border border-white/[0.06]">
                <LatexContent 
                  content={activeLang === 'hi' ? generatedItem.question_hi : generatedItem.question_en} 
                  className="text-white"
                />
              </div>

              {/* Options Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { label: 'A', text: activeLang === 'hi' ? generatedItem.option1_hi : generatedItem.option1_en, isAns: generatedItem.answer === 'A' || generatedItem.answer === '1' },
                  { label: 'B', text: activeLang === 'hi' ? generatedItem.option2_hi : generatedItem.option2_en, isAns: generatedItem.answer === 'B' || generatedItem.answer === '2' },
                  { label: 'C', text: activeLang === 'hi' ? generatedItem.option3_hi : generatedItem.option3_en, isAns: generatedItem.answer === 'C' || generatedItem.answer === '3' },
                  { label: 'D', text: activeLang === 'hi' ? generatedItem.option4_hi : generatedItem.option4_en, isAns: generatedItem.answer === 'D' || generatedItem.answer === '4' }
                ].map((opt) => (
                  <div
                    key={opt.label}
                    className={`flex items-start gap-2 p-2.5 rounded-lg border text-xs ${
                      opt.isAns 
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200' 
                        : 'border-white/[0.06] bg-slate-900/60 text-slate-300'
                    }`}
                  >
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center font-extrabold text-[10px] shrink-0 ${
                      opt.isAns ? 'bg-emerald-500 text-black' : 'bg-white/[0.08] text-slate-400'
                    }`}>
                      {opt.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <LatexContent content={opt.text} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Solution Preview */}
              <div className="p-3 rounded-lg bg-slate-900 border border-indigo-500/30 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-indigo-400" />
                  <span>Step-by-Step Solution ({activeLang.toUpperCase()} - Shuffle Safe):</span>
                </span>
                <LatexContent 
                  content={activeLang === 'hi' ? generatedItem.solution_hi : generatedItem.solution_en} 
                  className="text-slate-200"
                />
              </div>

              {/* Refinement Chat Input Bar */}
              <div className="p-2.5 rounded-xl bg-black/40 border border-white/[0.08] flex items-center gap-2">
                <input
                  type="text"
                  value={refinePrompt}
                  onChange={(e) => setRefinePrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleRefine();
                    }
                  }}
                  placeholder="चैट सुधार: 'उत्तर B करो', 'हल और विस्तृत करो', या 'अनुवाद ठीक करो'..."
                  disabled={isRefining}
                  className="flex-1 bg-transparent px-2 text-xs text-white placeholder:text-slate-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleRefine}
                  disabled={!refinePrompt.trim() || isRefining}
                  className="px-3 py-1 bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-lg text-xs flex items-center gap-1 transition-all disabled:opacity-40 shrink-0"
                >
                  {isRefining ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  <span>Refine</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Bottom Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-950 border-t border-white/[0.08]">
          <div className="flex items-center gap-3">
            {justAddedToast ? (
              <span className="text-xs font-bold text-emerald-400 flex items-center gap-1 animate-fade-in">
                <Check className="w-4 h-4 text-emerald-400" />
                <span>{justAddedToast}</span>
              </span>
            ) : (
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={keepOpen}
                  onChange={(e) => setKeepOpen(e.target.checked)}
                  className="rounded border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
                />
                <span>Keep modal open to add more questions</span>
              </label>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 font-semibold rounded-lg text-xs transition-all"
            >
              Cancel / Close
            </button>

            {generatedItem && (
              <button
                type="button"
                onClick={handleCommitQuestion}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold rounded-lg text-xs transition-all shadow-md shadow-emerald-600/20"
              >
                <Plus className="w-4 h-4" />
                <span>Insert into Test Paper (Q#{generatedItem.question_r})</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
