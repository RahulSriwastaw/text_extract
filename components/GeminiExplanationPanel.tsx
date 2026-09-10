import React, { useState, useEffect, useRef } from 'react';
import { 
  Sparkles, 
  HelpCircle, 
  BookOpen, 
  GraduationCap, 
  Send, 
  Loader2, 
  ChevronDown, 
  ChevronUp, 
  Trash2, 
  CheckCircle2, 
  AlertTriangle,
  RotateCcw,
  ShieldCheck,
  Languages
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { 
  getConversation, 
  appendMessageToConversation, 
  deleteConversation, 
  AiConversation, 
  AiMessage, 
  getAiSettings, 
  saveAiSettings 
} from '../services/aiDbService';
import { 
  generateWithUserGemini, 
  checkUserGeminiAuth, 
  QuestionContext, 
  AiActionType 
} from '../services/userGeminiService';
import GeminiConnectModal from './GeminiConnectModal';

interface GeminiExplanationPanelProps {
  questionId: string;
  questionText: string;
  options: { label: string; text: string }[];
  userAnswer?: string;
  correctAnswer?: string;
  topic?: string;
}

export const GeminiExplanationPanel: React.FC<GeminiExplanationPanelProps> = ({
  questionId,
  questionText,
  options,
  userAnswer,
  correctAnswer,
  topic
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [conversation, setConversation] = useState<AiConversation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [activeAction, setActiveAction] = useState<AiActionType | null>(null);
  const [followUpText, setFollowUpText] = useState('');
  const [preferredLang, setPreferredLang] = useState<'Hindi' | 'English' | 'Hinglish'>('Hindi');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showConnectModal, setShowConnectModal] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load existing conversation on mount or question change
  useEffect(() => {
    loadExistingData();
  }, [questionId]);

  const loadExistingData = async () => {
    const existing = await getConversation(questionId);
    if (existing) {
      setConversation(existing);
    } else {
      setConversation(null);
    }
    const settings = await getAiSettings();
    setPreferredLang(settings.preferredLanguage || 'Hindi');
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleActionClick = async (action: AiActionType, customFollowUp?: string) => {
    setErrorMessage(null);

    // 1. Verify authorization
    const auth = await checkUserGeminiAuth();
    if (!auth.isAuthenticated) {
      setShowConnectModal(true);
      return;
    }

    setIsExpanded(true);
    setIsLoading(true);
    setActiveAction(action);
    setStreamingContent('');

    const context: QuestionContext = {
      questionId,
      questionText,
      options,
      userAnswer,
      correctAnswer,
      topic
    };

    const previousMessages = conversation?.messages || [];

    try {
      const fullResponse = await generateWithUserGemini(
        action,
        context,
        previousMessages,
        customFollowUp,
        (chunk) => {
          setStreamingContent(chunk);
          scrollToBottom();
        }
      );

      // Save to IndexedDB locally on device
      let userPromptDescription = '';
      if (action === 'explain') userPromptDescription = 'Explain Answer';
      else if (action === 'why_wrong') userPromptDescription = 'Why is my answer wrong?';
      else if (action === 'concept') userPromptDescription = 'Explain Concept';
      else if (action === 'teach') userPromptDescription = 'Teach Me This Topic';
      else if (action === 'followup') userPromptDescription = customFollowUp || 'Follow-up query';

      // Save user question if it was follow-up
      if (action === 'followup' && customFollowUp) {
        await appendMessageToConversation(questionId, context, {
          role: 'user',
          content: customFollowUp,
          actionType: 'followup'
        });
      }

      // Save AI answer
      const updated = await appendMessageToConversation(questionId, context, {
        role: 'assistant',
        content: fullResponse,
        actionType: action
      });

      setConversation(updated);
      setStreamingContent('');
    } catch (err: any) {
      console.error('[GeminiExplanationPanel] Error:', err);
      setErrorMessage(err.message || 'Failed to generate explanation from Gemini.');
    } finally {
      setIsLoading(false);
      setActiveAction(null);
      setFollowUpText('');
    }
  };

  const handleFollowUpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!followUpText.trim() || isLoading) return;
    const text = followUpText.trim();
    handleActionClick('followup', text);
  };

  const handleLanguageChange = async (lang: 'Hindi' | 'English' | 'Hinglish') => {
    setPreferredLang(lang);
    await saveAiSettings({ preferredLanguage: lang });
  };

  const handleDeleteConversation = async () => {
    if (confirm('Delete this AI conversation from this device?')) {
      await deleteConversation(questionId);
      setConversation(null);
      setStreamingContent('');
      setIsExpanded(false);
    }
  };

  const hasMessages = (conversation?.messages && conversation.messages.length > 0) || !!streamingContent;

  return (
    <div className="mt-2.5 pt-2.5 border-t border-white/[0.06]">
      {/* Quick Action Buttons */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => handleActionClick('explain')}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gradient-to-r from-[#FF6B2B]/20 to-[#FF884D]/20 hover:from-[#FF6B2B]/30 hover:to-[#FF884D]/30 border border-[#FF6B2B]/40 text-[#FF884D] hover:text-white rounded-lg text-[11px] font-bold transition-all disabled:opacity-50"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Gemini से Explain</span>
        </button>

        {userAnswer && userAnswer !== correctAnswer && (
          <button
            type="button"
            onClick={() => handleActionClick('why_wrong')}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-2 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-300 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-50"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Why Wrong?</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => handleActionClick('concept')}
          disabled={isLoading}
          className="flex items-center gap-1 px-2 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-300 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-50"
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Concept</span>
        </button>

        <button
          type="button"
          onClick={() => handleActionClick('teach')}
          disabled={isLoading}
          className="flex items-center gap-1 px-2 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 text-purple-300 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-50"
        >
          <GraduationCap className="w-3.5 h-3.5" />
          <span>Teach Topic</span>
        </button>

        {hasMessages && (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="ml-auto flex items-center gap-1 text-[10px] text-slate-400 hover:text-white px-1.5 py-1 rounded bg-white/[0.04] transition-all"
          >
            {isExpanded ? (
              <>
                <span>Hide AI Chat</span>
                <ChevronUp className="w-3 h-3" />
              </>
            ) : (
              <>
                <span className="text-[#FF884D] font-bold">Saved locally ({conversation?.messages?.length || 1})</span>
                <ChevronDown className="w-3 h-3" />
              </>
            )}
          </button>
        )}
      </div>

      {/* Expandable Explanation & Chat Panel */}
      {isExpanded && (
        <div className="mt-3 p-3.5 bg-[#0D101D] border border-white/[0.1] rounded-xl space-y-3">
          {/* Top Bar inside panel: Language pills & Local storage badge */}
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-2 text-[10px]">
            <div className="flex items-center gap-1">
              <Languages className="w-3 h-3 text-slate-400" />
              <span className="text-slate-400 mr-1">Language:</span>
              {(['Hindi', 'English', 'Hinglish'] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => handleLanguageChange(lang)}
                  className={`px-1.5 py-0.5 rounded transition-all font-medium ${
                    preferredLang === lang
                      ? 'bg-[#FF6B2B] text-white font-bold'
                      : 'bg-white/[0.04] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {lang}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-emerald-400">
                <ShieldCheck className="w-3 h-3" />
                <span>Device-Only</span>
              </span>
              {conversation && (
                <button
                  type="button"
                  onClick={handleDeleteConversation}
                  title="Delete local conversation"
                  className="p-1 text-slate-500 hover:text-rose-400 rounded transition-all"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Conversation Thread */}
          <div className="space-y-3 max-h-80 overflow-y-auto pr-1 custom-scrollbar text-xs">
            {conversation?.messages.map((msg, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-xl ${
                  msg.role === 'user'
                    ? 'bg-white/[0.06] ml-6 border border-white/[0.08] text-slate-200'
                    : 'bg-white/[0.02] mr-2 border border-[#FF6B2B]/20 text-slate-100'
                }`}
              >
                {msg.role === 'assistant' && (
                  <div className="flex items-center gap-1.5 mb-1.5 text-[10px] font-bold text-[#FF884D]">
                    <Sparkles className="w-3 h-3" />
                    <span>Gemini AI Mentor</span>
                  </div>
                )}
                <div className="prose prose-invert prose-xs max-w-none leading-relaxed">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
              </div>
            ))}

            {/* Currently Streaming Message */}
            {isLoading && streamingContent && (
              <div className="p-3 rounded-xl bg-white/[0.02] mr-2 border border-[#FF6B2B]/30 text-slate-100 animate-pulse">
                <div className="flex items-center gap-1.5 mb-1.5 text-[10px] font-bold text-[#FF884D]">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Gemini is generating explanation...</span>
                </div>
                <div className="prose prose-invert prose-xs max-w-none leading-relaxed">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                  >
                    {streamingContent}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {/* Loading placeholder when stream hasn't started yet */}
            {isLoading && !streamingContent && (
              <div className="flex items-center gap-2 p-3 bg-white/[0.02] rounded-xl text-slate-400 text-xs">
                <Loader2 className="w-4 h-4 animate-spin text-[#FF6B2B]" />
                <span>
                  {activeAction === 'explain' && 'Generating detailed explanation...'}
                  {activeAction === 'why_wrong' && 'Analyzing student answer mistake...'}
                  {activeAction === 'concept' && 'Synthesizing core concept...'}
                  {activeAction === 'teach' && 'Preparing topic micro-lesson...'}
                  {activeAction === 'followup' && 'Answering your query...'}
                </span>
              </div>
            )}

            {/* Error Display */}
            {errorMessage && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1">
                  <p>{errorMessage}</p>
                  <button
                    type="button"
                    onClick={() => setShowConnectModal(true)}
                    className="underline text-xs font-semibold text-rose-200"
                  >
                    Check Gemini Connection Settings
                  </button>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Follow-up Question Input Form */}
          <form onSubmit={handleFollowUpSubmit} className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
            <input
              type="text"
              value={followUpText}
              onChange={(e) => setFollowUpText(e.target.value)}
              placeholder="Ask Gemini a follow-up question (e.g. Is topic ko yaad rakhne ka trick kya hai?)..."
              disabled={isLoading}
              className="flex-1 px-3 py-2 bg-white/[0.04] border border-white/[0.1] focus:border-[#FF6B2B] rounded-xl text-white text-xs placeholder:text-slate-500 outline-none transition-all"
            />
            <button
              type="submit"
              disabled={isLoading || !followUpText.trim()}
              className="p-2 bg-gradient-to-r from-[#FF6B2B] to-[#FF884D] text-white rounded-xl hover:shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              title="Send query"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
        </div>
      )}

      {/* Connect Modal when needed */}
      <GeminiConnectModal
        isOpen={showConnectModal}
        onClose={() => setShowConnectModal(false)}
        onConnected={() => {
          setShowConnectModal(false);
          if (activeAction) {
            handleActionClick(activeAction);
          }
        }}
      />
    </div>
  );
};

export default GeminiExplanationPanel;
