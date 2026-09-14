import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { 
  X, 
  Send, 
  Bot, 
  User, 
  Sparkles, 
  Check, 
  RotateCcw, 
  Loader2, 
  BookOpen, 
  MessageSquare,
  HelpCircle,
  Clock,
  ArrowRight
} from 'lucide-react';
import { MockTestMcqItem } from '../types';
import { chatFixMockTestItemWithAi } from '../services/mocktestService';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  itemSnapshot?: MockTestMcqItem;
}

interface MocktestAiChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: MockTestMcqItem | null;
  onUpdateItem: (updated: MockTestMcqItem) => void;
}

const LatexContent: React.FC<{ content: string; className?: string }> = ({ content, className }) => {
  if (!content) return null;
  const clean = content
    .replace(/<hr\s*\/?>/gi, '\n\n---\n\n')
    .replace(/<div[^>]*>/gi, '')
    .replace(/<\/div>/gi, '\n')
    .replace(/<(?:b|strong)[^>]*>(.*?)<\/(?:b|strong)>/gi, '**$1**')
    .replace(/<(?:i|em)[^>]*>(.*?)<\/(?:i|em)>/gi, '*$1*')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/^<p>/i, '')
    .replace(/<\/p>$/i, '')
    .trim();

  return (
    <div className={`prose prose-invert max-w-none text-xs leading-relaxed ${className || ''}`}>
      <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
        {clean}
      </ReactMarkdown>
    </div>
  );
};

export const MocktestAiChatModal: React.FC<MocktestAiChatModalProps> = ({
  isOpen,
  onClose,
  item,
  onUpdateItem
}) => {
  if (!isOpen || !item) return null;

  // Track original item state to allow full undo
  const [originalItem] = useState<MockTestMcqItem>(item);
  const [currentItem, setCurrentItem] = useState<MockTestMcqItem>(item);
  const [activeLang, setActiveLang] = useState<'hi' | 'en'>('hi');
  const [inputPrompt, setInputPrompt] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [hasModified, setHasModified] = useState<boolean>(false);

  // Chat message history
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome_msg',
      role: 'assistant',
      text: `नमस्ते! मैं इस प्रश्न (Q#${item.question_r || 1}) का समर्पित **AI Co-Pilot** हूँ।\n\nआप मुझसे इस प्रश्न में कोई भी सुधार करवा सकते हैं, जैसे:\n- 🎯 उत्तर बदलकर सही विकल्प सेट करना\n- 📝 हल (Solution) को Step-by-Step विस्तृत बनाना\n- 🔀 Option letters (A, B, C, D) हटाकर तथ्यपरक व्याख्या लिखना\n- 🌐 हिंदी व अंग्रेजी अनुवाद शुद्ध करना\n- 📅 Current Affairs को पिछले 1 वर्ष के प्रामाणिक डेटा के अनुसार अपडेट करना`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll chat to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  // Focus textarea on modal open
  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 150);
  }, []);

  // Quick suggestion chips
  const quickChips = [
    { label: '🎯 उत्तर B करो और हल अपडेट करो', prompt: 'इस प्रश्न का उत्तर B कर दो और हल (solution) को उसी के अनुसार चरणबद्ध (step-by-step) तरीके से अपडेट कर दो।' },
    { label: '📝 विस्तृत Step-by-Step हल बनाओ', prompt: 'इस प्रश्न का विस्तृत और परीक्षा-उपयोगी Step-by-Step हल तैयार करो ताकि कमजोर छात्र भी समझ सकें। दिया गया डेटा और सूत्र स्पष्ट लिखो।' },
    { label: '🔀 Shuffled Safe हल (No Option Letters)', prompt: 'हल (solution) में से ऑप्शन लेटर (A, B, C, D या 1, 2, 3, 4) के सभी संदर्भ हटा दो और सीधे वास्तविक तथ्य, वैज्ञानिक कारण या मान लिखो ताकि ऑप्शन्स शफल होने पर भी हल सही रहे।' },
    { label: '🌐 हिंदी व अंग्रेजी अनुवाद शुद्ध करो', prompt: 'इस प्रश्न और विकल्पों का हिंदी और अंग्रेजी दोनों भाषाओं में अनुवाद व्याकरण व परीक्षा मानक के अनुसार शुद्ध और सटीक करो।' },
    { label: '📅 Current Affairs (पिछले 1 साल का डेटा)', prompt: 'यदि यह करंट अफेयर्स या समसामयिकी का प्रश्न है, तो सुनिश्चित करो कि डेटा, योजना, नियुक्ति, बजट या खेल प्रतियोगिता पिछले 1 वर्ष (12 महीने) के प्रामाणिक रिकॉर्ड से ही हो।' },
    { label: '🔢 गणितीय सूत्र व गणना सुधारो', prompt: 'इस प्रश्न के गणितीय सूत्र, चिन्ह (×, ÷, −, ², √) और परिकलन को स्वच्छ व स्पष्ट बनाओ।' },
    { label: '⚡ 4 नए और बेहतर विकल्प बनाओ', prompt: 'इस प्रश्न के लिए 4 नए, प्रामाणिक और उच्च-गुणवत्ता वाले विकल्प (Distractors) तैयार करो।' }
  ];

  const handleSendMessage = async (promptToSend?: string) => {
    const prompt = (promptToSend || inputPrompt).trim();
    if (!prompt || isSending) return;

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      text: prompt,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setInputPrompt('');
    setIsSending(true);

    try {
      // Build conversation history for context
      const historyPayload = messages
        .filter(m => m.id !== 'welcome_msg')
        .map(m => ({ role: m.role, text: m.text }));

      const { updatedItem, reply } = await chatFixMockTestItemWithAi(
        currentItem,
        prompt,
        historyPayload
      );

      setCurrentItem(updatedItem);
      setHasModified(true);

      // Auto-notify parent state
      onUpdateItem(updatedItem);

      const aiMsg: ChatMessage = {
        id: `ai_${Date.now()}`,
        role: 'assistant',
        text: reply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        itemSnapshot: updatedItem
      };

      setMessages(prev => [...prev, aiMsg]);
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        role: 'assistant',
        text: `⚠️ त्रुटि (Error): ${err.message || 'AI से संवाद में समस्या आई। कृपया पुनः प्रयास करें।'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsSending(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleUndoAll = () => {
    if (confirm('क्या आप चैट के दौरान किए गए सभी बदलावों को रद्द करके मूल प्रश्न वापस लाना चाहते हैं?')) {
      setCurrentItem(originalItem);
      onUpdateItem(originalItem);
      setHasModified(false);
      setMessages(prev => [
        ...prev,
        {
          id: `undo_${Date.now()}`,
          role: 'assistant',
          text: '🔄 प्रश्न को मूल अवस्था (Original State) में पुनर्स्थापित कर दिया गया है।',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    }
  };

  const qText = activeLang === 'hi' ? currentItem.question_hi : currentItem.question_en;
  const solText = activeLang === 'hi' ? currentItem.solution_hi : currentItem.solution_en;
  const optA = activeLang === 'hi' ? currentItem.option1_hi : currentItem.option1_en;
  const optB = activeLang === 'hi' ? currentItem.option2_hi : currentItem.option2_en;
  const optC = activeLang === 'hi' ? currentItem.option3_hi : currentItem.option3_en;
  const optD = activeLang === 'hi' ? currentItem.option4_hi : currentItem.option4_en;
  const optE = activeLang === 'hi' ? currentItem.option5_hi : currentItem.option5_en;
  const normAns = (currentItem.answer || '').trim().toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-fade-in">
      <div 
        className="relative w-full max-w-6xl max-h-[92vh] flex flex-col bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-950/80 border-b border-white/[0.08]">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-500 shadow-md shadow-indigo-500/20 text-white">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-sm text-white">
                  Q#{currentItem.question_r || 1} AI Assistant & Live Editor
                </span>
                <span className="px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 font-bold text-[10px] border border-violet-500/30">
                  {currentItem.subject || 'General'}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-300 font-medium text-[10px] capitalize">
                  {currentItem.difficulty_level || 'Medium'}
                </span>
                {hasModified && (
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold text-[10px] border border-emerald-500/40 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    <span>Modified</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                Chat in Hindi or English to fix answer, stem, options, math, or solution step-by-step
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {hasModified && (
              <button
                type="button"
                onClick={handleUndoAll}
                className="flex items-center gap-1 px-2.5 py-1 text-xs text-rose-300 hover:text-rose-200 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 rounded-lg transition-all"
                title="Undo all changes made in this chat session"
              >
                <RotateCcw className="w-3 h-3" />
                <span className="hidden sm:inline">Reset</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.1] transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Main Body (2 Columns on desktop) */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12 min-h-0">
          {/* Left Column: Live Question Preview (5 cols) */}
          <div className="lg:col-span-5 flex flex-col border-b lg:border-b-0 lg:border-r border-white/[0.08] bg-slate-950/40 min-h-0 overflow-y-auto p-4 space-y-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Live Preview:</span>
                <span className="text-[10px] text-emerald-400 font-medium">(Updates in real time)</span>
              </div>

              {/* Language Switcher */}
              <div className="flex items-center p-0.5 bg-black/40 border border-white/[0.1] rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setActiveLang('hi')}
                  className={`px-2 py-0.5 font-bold rounded transition-all ${
                    activeLang === 'hi' ? 'bg-amber-500 text-black shadow-sm' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  हिन्दी
                </button>
                <button
                  type="button"
                  onClick={() => setActiveLang('en')}
                  className={`px-2 py-0.5 font-bold rounded transition-all ${
                    activeLang === 'en' ? 'bg-blue-500 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  English
                </button>
              </div>
            </div>

            {/* Question Stem */}
            <div className="p-3 rounded-xl bg-slate-900/90 border border-white/[0.08] space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Question Stem ({activeLang.toUpperCase()}):</span>
              <LatexContent content={qText} className="text-slate-100" />
            </div>

            {/* Options List */}
            <div className="space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Options:</span>
              {[
                { label: 'A', text: optA, key: ['A', '1'] },
                { label: 'B', text: optB, key: ['B', '2'] },
                { label: 'C', text: optC, key: ['C', '3'] },
                { label: 'D', text: optD, key: ['D', '4'] },
                ...(optE ? [{ label: 'E', text: optE, key: ['E', '5'] }] : [])
              ].map((opt) => {
                const isCorrect = opt.key.includes(normAns);
                return (
                  <div
                    key={opt.label}
                    className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition-all text-xs ${
                      isCorrect
                        ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200 shadow-sm shadow-emerald-500/10'
                        : 'border-white/[0.06] bg-slate-900/60 text-slate-300'
                    }`}
                  >
                    <span className={`flex items-center justify-center w-5 h-5 rounded-full shrink-0 font-extrabold text-[11px] ${
                      isCorrect ? 'bg-emerald-500 text-black' : 'bg-white/[0.08] text-slate-400'
                    }`}>
                      {opt.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <LatexContent content={opt.text} />
                    </div>
                    {isCorrect && (
                      <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider shrink-0 bg-emerald-500/20 px-1.5 py-0.5 rounded">
                        Correct Answer
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Solution Preview */}
            <div className="p-3 rounded-xl bg-slate-900/90 border border-indigo-500/30 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-indigo-400" />
                  <span>Step-by-Step Solution ({activeLang.toUpperCase()}):</span>
                </span>
                <span className="text-[10px] text-slate-500">Shuffle-Safe</span>
              </div>
              <LatexContent content={solText} className="text-slate-200" />
            </div>
          </div>

          {/* Right Column: Interactive Chat Interface (7 cols) */}
          <div className="lg:col-span-7 flex flex-col min-h-0 bg-slate-900/80">
            {/* Messages Scroll Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 min-h-0">
              {messages.map((msg) => {
                const isUser = msg.role === 'user';
                return (
                  <div
                    key={msg.id}
                    className={`flex items-start gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    {/* Avatar */}
                    <div className={`flex items-center justify-center w-7 h-7 rounded-xl shrink-0 text-xs ${
                      isUser
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-gradient-to-tr from-violet-600 to-indigo-500 text-white shadow-sm'
                    }`}>
                      {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                    </div>

                    {/* Bubble */}
                    <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed space-y-1 ${
                      isUser
                        ? 'bg-blue-600 text-white rounded-tr-none shadow-md shadow-blue-600/10'
                        : 'bg-slate-800/90 border border-white/[0.08] text-slate-200 rounded-tl-none shadow-md'
                    }`}>
                      <div className="prose prose-invert max-w-none text-xs leading-relaxed">
                        <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]}>
                          {msg.text}
                        </ReactMarkdown>
                      </div>
                      <div className={`text-[9px] text-right font-medium ${isUser ? 'text-blue-200/70' : 'text-slate-500'}`}>
                        {msg.timestamp}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* AI Thinking Spinner */}
              {isSending && (
                <div className="flex items-start gap-2.5">
                  <div className="flex items-center justify-center w-7 h-7 rounded-xl bg-violet-600 text-white shadow-sm">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div className="bg-slate-800/90 border border-violet-500/30 text-violet-300 rounded-2xl rounded-tl-none px-4 py-2.5 text-xs flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400" />
                    <span className="font-semibold">AI is analyzing & fixing this question...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Quick Action Suggestion Chips */}
            <div className="px-4 py-2 border-t border-white/[0.06] bg-slate-950/40">
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                {quickChips.map((chip, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSendMessage(chip.prompt)}
                    disabled={isSending}
                    className="shrink-0 px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-violet-500/20 border border-white/[0.08] hover:border-violet-500/40 text-[11px] font-semibold text-slate-300 hover:text-violet-200 transition-all disabled:opacity-40"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Chat Input Bar */}
            <div className="p-3.5 border-t border-white/[0.08] bg-slate-950/80">
              <div className="relative flex items-end gap-2 bg-slate-900 border border-white/[0.12] focus-within:border-violet-500/60 rounded-xl p-1.5 shadow-inner transition-all">
                <textarea
                  ref={textareaRef}
                  value={inputPrompt}
                  onChange={(e) => setInputPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="उदा: 'उत्तर B कर दो और solution में पूरा calculation लिखो' या 'अनुवाद ठीक करो'..."
                  rows={2}
                  disabled={isSending}
                  className="flex-1 bg-transparent px-2.5 py-1 text-xs text-slate-100 placeholder:text-slate-500 resize-none focus:outline-none max-h-32"
                />

                <button
                  type="button"
                  onClick={() => handleSendMessage()}
                  disabled={!inputPrompt.trim() || isSending}
                  className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold transition-all disabled:opacity-40 shadow-sm shrink-0"
                  title="Send instruction (Enter)"
                >
                  {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>

              <div className="flex items-center justify-between pt-2 px-1 text-[10px] text-slate-500">
                <span>Press <strong>Enter</strong> to send, <strong>Shift+Enter</strong> for new line</span>
                <span>Prompt follows strict YCT patterns & 0-option-letter safety</span>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Bottom Footer */}
        <div className="flex items-center justify-between px-5 py-3 bg-slate-950 border-t border-white/[0.08]">
          <div className="flex items-center gap-2 text-xs">
            {hasModified ? (
              <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
                <Check className="w-4 h-4 text-emerald-400" />
                <span>All changes auto-applied to test paper!</span>
              </span>
            ) : (
              <span className="text-slate-400">
                Ask anything about this question to modify it in real-time.
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold rounded-lg text-xs transition-all shadow-md shadow-emerald-600/20"
            >
              Done / Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
