import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  Search, 
  Trash2, 
  Download, 
  Printer, 
  Calendar, 
  BookOpen, 
  Sparkles, 
  ShieldCheck, 
  MessageSquare,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  getAllConversations, 
  deleteConversation, 
  clearAllAiHistory, 
  exportHistoryAsJson, 
  AiConversation 
} from '../services/aiDbService';

interface AiHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectQuestion?: (questionId: string) => void;
}

const AiHistoryDrawer: React.FC<AiHistoryDrawerProps> = ({ isOpen, onClose, onSelectQuestion }) => {
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedConversation, setSelectedConversation] = useState<AiConversation | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen]);

  const loadHistory = async () => {
    const list = await getAllConversations();
    setConversations(list);
  };

  const handleDeleteOne = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this AI explanation from this device?')) {
      await deleteConversation(id);
      await loadHistory();
      if (selectedConversation?.questionId === id) {
        setSelectedConversation(null);
      }
    }
  };

  const handleDeleteAll = async () => {
    if (confirm('Are you sure you want to delete ALL AI history stored on this device? This cannot be undone.')) {
      await clearAllAiHistory();
      await loadHistory();
      setSelectedConversation(null);
    }
  };

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

  const handlePrint = () => {
    window.print();
  };

  // Group by date
  const groupedConversations = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const filtered = conversations.filter(c => 
      c.questionText.toLowerCase().includes(query) ||
      (c.topic && c.topic.toLowerCase().includes(query)) ||
      c.messages.some(m => m.content.toLowerCase().includes(query))
    );

    const today: AiConversation[] = [];
    const yesterday: AiConversation[] = [];
    const earlier: AiConversation[] = [];

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;

    filtered.forEach(c => {
      const time = c.updatedAt || c.createdAt;
      if (time >= todayStart) {
        today.push(c);
      } else if (time >= yesterdayStart) {
        yesterday.push(c);
      } else {
        earlier.push(c);
      }
    });

    return { today, yesterday, earlier, total: filtered.length };
  }, [conversations, searchQuery]);

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
            className="fixed inset-y-0 right-0 w-full max-w-xl bg-[#111420] z-50 flex flex-col border-l border-white/[0.08] shadow-2xl"
          >
            {/* Header */}
            <div className="p-4 border-b border-white/[0.08] bg-white/[0.02] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#FF6B2B]/20 text-[#FF884D] flex items-center justify-center">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white font-display">My AI Explanations</h3>
                  <div className="flex items-center gap-1.5 text-[10px] text-emerald-400">
                    <ShieldCheck className="w-3 h-3" />
                    <span>Saved strictly on this browser ({conversations.length} items)</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1">
                {conversations.length > 0 && (
                  <>
                    <button
                      onClick={handleExportJson}
                      title="Export as JSON"
                      className="p-2 text-slate-400 hover:text-white hover:bg-white/[0.08] rounded-lg transition-all text-xs flex items-center gap-1"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleDeleteAll}
                      title="Delete all history from device"
                      className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
                <button
                  onClick={onClose}
                  className="p-2 text-slate-400 hover:text-white hover:bg-white/[0.08] rounded-lg transition-all"
                >
                  <X className="w-5 h-5" />
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
                  placeholder="Search explanations by question text, keyword..."
                  className="w-full pl-9 pr-3 py-1.5 bg-white/[0.04] border border-white/[0.08] focus:border-[#FF6B2B] rounded-lg text-white text-xs placeholder:text-slate-500 outline-none transition-all"
                />
              </div>
            </div>

            {/* List Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
              {groupedConversations.total === 0 ? (
                <div className="text-center py-20 text-slate-500 space-y-2">
                  <BookOpen className="w-10 h-10 mx-auto opacity-30 text-slate-400" />
                  <p className="text-xs font-bold text-slate-400">No Explanations Saved Yet</p>
                  <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                    Click "Gemini से Explain" on any mock question to view and save explanations locally on your device.
                  </p>
                </div>
              ) : (
                <>
                  {/* Today */}
                  {groupedConversations.today.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#FF884D] uppercase tracking-wider">
                        <Calendar className="w-3 h-3" />
                        <span>Today</span>
                        <span className="text-slate-500 font-normal">({groupedConversations.today.length})</span>
                      </div>
                      <div className="space-y-1.5">
                        {groupedConversations.today.map((item) => (
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
                                onClick={(e) => handleDeleteOne(item.questionId, e)}
                                title="Delete from device"
                                className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                              <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-all" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Yesterday */}
                  {groupedConversations.yesterday.length > 0 && (
                    <div className="space-y-2 pt-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        <Calendar className="w-3 h-3" />
                        <span>Yesterday</span>
                        <span className="text-slate-500 font-normal">({groupedConversations.yesterday.length})</span>
                      </div>
                      <div className="space-y-1.5">
                        {groupedConversations.yesterday.map((item) => (
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
                                onClick={(e) => handleDeleteOne(item.questionId, e)}
                                title="Delete from device"
                                className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                              <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-all" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Earlier */}
                  {groupedConversations.earlier.length > 0 && (
                    <div className="space-y-2 pt-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        <Calendar className="w-3 h-3" />
                        <span>Earlier</span>
                        <span className="text-slate-500 font-normal">({groupedConversations.earlier.length})</span>
                      </div>
                      <div className="space-y-1.5">
                        {groupedConversations.earlier.map((item) => (
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
                                onClick={(e) => handleDeleteOne(item.questionId, e)}
                                title="Delete from device"
                                className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                              <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-all" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default AiHistoryDrawer;
