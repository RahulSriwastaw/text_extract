import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  Search, 
  Trash2, 
  Download, 
  Calendar, 
  BookOpen, 
  Sparkles, 
  ShieldCheck, 
  MessageSquare,
  ChevronRight,
  FileText,
  FileSpreadsheet,
  User as UserIcon,
  Cloud,
  Layers,
  Copy,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useCurrentUser } from '../services/authService';
import { 
  getHistoryItems, 
  deleteHistoryItem, 
  clearAllHistory, 
  getMocktestHistoryItems, 
  deleteMocktestHistoryItem, 
  clearAllMocktestHistory 
} from '../services/historyService';
import { 
  getAllConversations, 
  deleteConversation, 
  clearAllAiHistory, 
  exportHistoryAsJson, 
  AiConversation 
} from '../services/aiDbService';
import { HistoryItem, MocktestHistoryItem } from '../types';
import { downloadMockTestCsv } from '../services/mocktestService';

interface AiHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectQuestion?: (questionId: string) => void;
  onSelectConversionItem?: (item: HistoryItem) => void;
}

type HistoryTab = 'conversions' | 'mocktests' | 'explanations';

const AiHistoryDrawer: React.FC<AiHistoryDrawerProps> = ({ 
  isOpen, 
  onClose, 
  onSelectQuestion,
  onSelectConversionItem
}) => {
  const [user] = useCurrentUser();
  const [activeTab, setActiveTab] = useState<HistoryTab>('conversions');
  
  // Data states
  const [conversionItems, setConversionItems] = useState<HistoryItem[]>([]);
  const [mocktestItems, setMocktestItems] = useState<MocktestHistoryItem[]>([]);
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const currentUid = user?.uid || 'guest';

  useEffect(() => {
    if (isOpen) {
      loadAllData();
    }
  }, [isOpen, user]);

  const loadAllData = async () => {
    try {
      const [convs, mtests, explains] = await Promise.all([
        getHistoryItems(currentUid),
        getMocktestHistoryItems(currentUid),
        getAllConversations(),
      ]);
      setConversionItems(convs);
      setMocktestItems(mtests);
      setConversations(explains);
    } catch (e) {
      console.error('[AiHistoryDrawer] Error loading history:', e);
    }
  };

  // --- Deletion handlers ---
  const handleDeleteConversion = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this conversion history record?')) {
      await deleteHistoryItem(currentUid, id);
      setConversionItems(prev => prev.filter(i => i.id !== id));
    }
  };

  const handleDeleteMocktest = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this saved mock test set?')) {
      await deleteMocktestHistoryItem(currentUid, id);
      setMocktestItems(prev => prev.filter(i => i.id !== id));
    }
  };

  const handleDeleteExplanation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this AI explanation from this device?')) {
      await deleteConversation(id);
      setConversations(prev => prev.filter(c => c.questionId !== id));
    }
  };

  const handleClearCurrentTab = async () => {
    if (activeTab === 'conversions') {
      if (confirm(`Are you sure you want to clear all document conversion history for ${user ? user.email : 'guest'}?`)) {
        await clearAllHistory(currentUid);
        setConversionItems([]);
      }
    } else if (activeTab === 'mocktests') {
      if (confirm(`Are you sure you want to clear all saved mock tests for ${user ? user.email : 'guest'}?`)) {
        await clearAllMocktestHistory(currentUid);
        setMocktestItems([]);
      }
    } else {
      if (confirm('Are you sure you want to delete ALL AI explanation history on this device?')) {
        await clearAllAiHistory();
        setConversations([]);
      }
    }
  };

  // --- Export handlers ---
  const handleExportJson = async () => {
    const jsonStr = await exportHistoryAsJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my_gemini_explanations_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadMocktestCsv = (item: MocktestHistoryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    downloadMockTestCsv(item.questions, item.setName || 'Mocktest_Export');
  };

  const handleCopyText = (item: HistoryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const elements = item.elements || [];
    const fullText = elements
      .map(el => el.type === 'text' || el.type === 'table' ? (el.content || '') : `[Image: ${el.content || ''}]`)
      .join('\n\n');
    navigator.clipboard.writeText(fullText);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // --- Search filter ---
  const q = searchQuery.toLowerCase().trim();

  const filteredConversions = useMemo(() => {
    if (!q) return conversionItems;
    return conversionItems.filter(i => 
      i.fileName.toLowerCase().includes(q) ||
      (i.elements && i.elements.some(e => e.content?.toLowerCase().includes(q)))
    );
  }, [conversionItems, q]);

  const filteredMocktests = useMemo(() => {
    if (!q) return mocktestItems;
    return mocktestItems.filter(i => 
      i.setName.toLowerCase().includes(q) ||
      (i.questions && i.questions.some(qn => 
        (qn.question_hi && qn.question_hi.toLowerCase().includes(q)) ||
        (qn.question_en && qn.question_en.toLowerCase().includes(q))
      ))
    );
  }, [mocktestItems, q]);

  const filteredConversations = useMemo(() => {
    if (!q) return conversations;
    return conversations.filter(c => 
      c.questionText.toLowerCase().includes(q) ||
      (c.topic && c.topic.toLowerCase().includes(q)) ||
      c.messages.some(m => m.content.toLowerCase().includes(q))
    );
  }, [conversations, q]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-[#0B0D13]/75 backdrop-blur-md z-50"
          />

          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 220 }}
            className="fixed inset-y-0 right-0 w-full max-w-xl bg-[#111420] z-50 flex flex-col border-l border-white/[0.08] shadow-2xl"
          >
            {/* Header */}
            <div className="p-4 border-b border-white/[0.08] bg-white/[0.02]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[#FF6B2B]/20 text-[#FF884D] flex items-center justify-center">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white font-display">Account History</h3>
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                      {user ? (
                        <span className="text-emerald-400 flex items-center gap-1 font-medium">
                          <Cloud className="w-3 h-3" />
                          Saved to User ID: <span className="text-white font-semibold truncate max-w-[140px]">{user.email || user.uid}</span>
                        </span>
                      ) : (
                        <span className="text-amber-400/90 flex items-center gap-1">
                          <UserIcon className="w-3 h-3" />
                          Guest Session (Saved on this device)
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {((activeTab === 'conversions' && conversionItems.length > 0) ||
                    (activeTab === 'mocktests' && mocktestItems.length > 0) ||
                    (activeTab === 'explanations' && conversations.length > 0)) && (
                    <button
                      onClick={handleClearCurrentTab}
                      title="Clear history for this tab"
                      className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {activeTab === 'explanations' && conversations.length > 0 && (
                    <button
                      onClick={handleExportJson}
                      title="Export AI Explanations JSON"
                      className="p-2 text-slate-400 hover:text-white hover:bg-white/[0.08] rounded-lg transition-all"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={onClose}
                    className="p-2 text-slate-400 hover:text-white hover:bg-white/[0.08] rounded-lg transition-all"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Segmented Tabs */}
              <div className="mt-3.5 grid grid-cols-3 p-1 bg-black/50 border border-white/[0.08] rounded-xl gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveTab('conversions')}
                  className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg font-bold transition-all ${
                    activeTab === 'conversions'
                      ? 'bg-[#FF6B2B] text-white shadow-md shadow-[#FF6B2B]/20'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>PDF / Docs</span>
                  <span className="text-[10px] opacity-80">({conversionItems.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('mocktests')}
                  className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg font-bold transition-all ${
                    activeTab === 'mocktests'
                      ? 'bg-amber-500 text-black shadow-md shadow-amber-500/20'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Mock Tests</span>
                  <span className="text-[10px] opacity-80">({mocktestItems.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('explanations')}
                  className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg font-bold transition-all ${
                    activeTab === 'explanations'
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>AI Explains</span>
                  <span className="text-[10px] opacity-80">({conversations.length})</span>
                </button>
              </div>
            </div>

            {/* Search Input */}
            <div className="p-3 border-b border-white/[0.06] bg-white/[0.01]">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search ${activeTab === 'conversions' ? 'documents' : activeTab === 'mocktests' ? 'test papers' : 'explanations'}...`}
                  className="w-full pl-9 pr-3 py-1.5 bg-white/[0.04] border border-white/[0.08] focus:border-[#FF6B2B] rounded-lg text-white text-xs placeholder:text-slate-500 outline-none transition-all"
                />
              </div>
            </div>

            {/* Content List Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
              {/* 1. Conversions Tab */}
              {activeTab === 'conversions' && (
                filteredConversions.length === 0 ? (
                  <div className="text-center py-20 text-slate-500 space-y-2">
                    <FileText className="w-10 h-10 mx-auto opacity-30 text-slate-400" />
                    <p className="text-xs font-bold text-slate-400">No Document Conversions Yet</p>
                    <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                      Any document you convert in "Text / Docx" will be automatically saved here on your user account.
                    </p>
                  </div>
                ) : (
                  filteredConversions.map((item) => {
                    const elements = item.elements || [];
                    const fullText = elements
                      .map(el => el.type === 'text' || el.type === 'table' ? (el.content || '') : `[Image: ${el.content || ''}]`)
                      .join('\n\n');
                    const previewText = fullText.replace(/\n/g, ' ').substring(0, 75) + (fullText.length > 75 ? '...' : '');

                    return (
                      <div
                        key={item.id}
                        className="p-3.5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-[#FF6B2B]/40 transition-all cursor-pointer group flex flex-col gap-2"
                        onClick={() => {
                          if (onSelectConversionItem) {
                            onSelectConversionItem(item);
                            onClose();
                          }
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3 overflow-hidden">
                            <div className="w-9 h-9 rounded-xl bg-[#FF6B2B]/10 border border-[#FF6B2B]/30 flex-shrink-0 flex items-center justify-center text-[#FF884D]">
                              <FileText className="w-4 h-4" />
                            </div>
                            <div className="overflow-hidden">
                              <h4 className="text-xs font-bold text-slate-200 truncate group-hover:text-white transition-colors">
                                {item.fileName}
                              </h4>
                              <p className="text-[11px] text-slate-400 truncate mt-0.5">
                                {previewText || 'Empty conversion session'}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={(e) => handleCopyText(item, e)}
                              className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-white/[0.06] rounded-lg transition-all"
                              title="Copy text"
                            >
                              {copiedId === item.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={(e) => handleDeleteConversion(item.id, e)}
                              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                              title="Delete from history"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-slate-500 border-t border-white/[0.04] pt-2">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(item.timestamp || Date.now()).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-slate-400">{item.pagesCount || 1} pages</span>
                            <span>•</span>
                            <span className="font-mono text-slate-400">{elements.length} elements</span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )
              )}

              {/* 2. Mock Tests Tab */}
              {activeTab === 'mocktests' && (
                filteredMocktests.length === 0 ? (
                  <div className="text-center py-20 text-slate-500 space-y-2">
                    <FileSpreadsheet className="w-10 h-10 mx-auto opacity-30 text-amber-400" />
                    <p className="text-xs font-bold text-slate-400">No Saved Mock Tests</p>
                    <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                      In the "MCQs Extractor", click "Save Set to Account" to store test papers safely under your User ID.
                    </p>
                  </div>
                ) : (
                  filteredMocktests.map((item) => (
                    <div
                      key={item.id}
                      className="p-3.5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-amber-500/40 transition-all flex flex-col gap-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex-shrink-0 flex items-center justify-center text-amber-400">
                            <FileSpreadsheet className="w-4 h-4" />
                          </div>
                          <div className="overflow-hidden">
                            <h4 className="text-xs font-bold text-white truncate">
                              {item.setName || 'Mock Test'}
                            </h4>
                            <p className="text-[11px] text-amber-300/80 mt-0.5 font-mono">
                              {item.questionCount || (item.questions ? item.questions.length : 0)} Questions Loaded
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={(e) => handleDownloadMocktestCsv(item, e)}
                            className="flex items-center gap-1 px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 rounded-lg text-xs font-bold transition-all"
                            title="Download standard 34-column CSV"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>CSV</span>
                          </button>
                          <button
                            onClick={(e) => handleDeleteMocktest(item.id, e)}
                            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                            title="Delete mock test"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-500 border-t border-white/[0.04] pt-2">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(item.timestamp || Date.now()).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="text-[10px] text-emerald-400 font-semibold">User Account Sync Ready</span>
                      </div>
                    </div>
                  ))
                )
              )}

              {/* 3. AI Explanations Tab */}
              {activeTab === 'explanations' && (
                filteredConversations.length === 0 ? (
                  <div className="text-center py-20 text-slate-500 space-y-2">
                    <BookOpen className="w-10 h-10 mx-auto opacity-30 text-slate-400" />
                    <p className="text-xs font-bold text-slate-400">No Explanations Saved Yet</p>
                    <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                      Click "Gemini से Explain" on any mock question to view and save explanations locally on your device.
                    </p>
                  </div>
                ) : (
                  filteredConversations.map((item) => (
                    <div
                      key={item.questionId}
                      onClick={() => {
                        if (onSelectQuestion) onSelectQuestion(item.questionId);
                        onClose();
                      }}
                      className="p-3 bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.12] rounded-xl transition-all cursor-pointer group flex items-start justify-between gap-3"
                    >
                      <div className="space-y-1 flex-1">
                        <p className="text-xs text-slate-200 line-clamp-2 font-medium">
                          {item.questionText}
                        </p>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400">
                          <span className="text-emerald-400 font-bold">Ans: {item.correctAnswer || 'N/A'}</span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <MessageSquare className="w-3 h-3 text-[#FF6B2B]" />
                            {item.messages.length} messages
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={(e) => handleDeleteExplanation(item.questionId, e)}
                          title="Delete explanation"
                          className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-all" />
                      </div>
                    </div>
                  ))
                )
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default AiHistoryDrawer;
