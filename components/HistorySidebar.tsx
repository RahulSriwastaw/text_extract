import React, { useState } from 'react';
import { Clock, Trash2, FileText, ChevronRight, Search } from 'lucide-react';
import { HistoryItem } from '../types';
import { motion, AnimatePresence } from 'motion/react';

interface HistorySidebarProps {
  history: HistoryItem[];
  onSelectItem: (item: HistoryItem) => void;
  onDeleteItem: (id: string) => void;
  onClearAll: () => void;
  isOpen: boolean;
  onClose: () => void;
}

const HistorySidebar: React.FC<HistorySidebarProps> = ({ 
  history, 
  onSelectItem, 
  onDeleteItem, 
  onClearAll,
  isOpen, 
  onClose 
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredHistory = history
    .filter(item => item.fileName.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-[#0B0D13]/70 backdrop-blur-md z-50"
          />
          
          {/* Sidebar */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 220 }}
            className="fixed right-0 top-0 h-full w-full max-w-md bg-[#11141F] border-l border-white/[0.08] shadow-2xl z-50 flex flex-col"
          >
            {/* Header */}
            <div className="p-4 border-b border-white/[0.08] flex items-center justify-between bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-400 flex items-center justify-center">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white font-display">Conversion History</h2>
                  <p className="text-[10px] text-slate-400">{history.length} saved sessions</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {history.length > 0 && (
                  <button 
                    onClick={() => {
                      if (confirm("Are you sure you want to clear all history?")) {
                        onClearAll();
                      }
                    }}
                    className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/15 rounded-xl transition-all"
                    title="Clear All History"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button 
                  onClick={onClose}
                  className="p-2 hover:bg-white/[0.08] rounded-xl text-slate-400 hover:text-white transition-all"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Search Box */}
            {history.length > 0 && (
              <div className="p-3 border-b border-white/[0.06]">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search documents..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-[#08090D] text-xs text-white pl-8 pr-3 py-1.5 rounded-xl border border-white/[0.08] focus:outline-none focus:border-blue-500 transition-all placeholder:text-slate-500"
                  />
                </div>
              </div>
            )}

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
              {filteredHistory.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-3 py-16">
                  <Clock className="w-12 h-12 opacity-25" />
                  <p className="text-xs font-medium">No history items found</p>
                </div>
              ) : (
                filteredHistory.map((item) => {
                  const elements = item.elements || [];
                  const fullText = elements
                    .map(el => el.type === 'text' || el.type === 'table' ? (el.content || '') : `[Image: ${el.content || ''}]`)
                    .join('\n\n');
                  const previewText = fullText.replace(/\n/g, ' ').substring(0, 65) + (fullText.length > 65 ? '...' : '');

                  return (
                    <motion.div
                      layout
                      key={item.id}
                      className="group p-3.5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-[#FF6B2B]/40 hover:shadow-lg transition-all cursor-pointer relative"
                      onClick={() => onSelectItem(item)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.08] flex-shrink-0 flex items-center justify-center text-slate-400 group-hover:text-white group-hover:bg-[#FF6B2B]/15 group-hover:border-[#FF6B2B]/30 transition-all">
                            <FileText className="w-4 h-4" />
                          </div>
                          <div className="overflow-hidden">
                            <h4 className="text-xs font-bold text-slate-200 truncate group-hover:text-white transition-colors">
                              {item.fileName}
                            </h4>
                            <p className="text-[11px] text-slate-400 truncate mt-0.5">
                              {previewText || "Empty session"}
                            </p>
                          </div>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteItem(item.id);
                          }}
                          className="p-1 text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all rounded"
                          title="Delete Session"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="mt-2.5 flex items-center justify-between text-[10px] text-slate-500 border-t border-white/[0.04] pt-2">
                        <span>{new Date(item.timestamp || Date.now()).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="font-mono text-slate-400">{elements.length} elements</span>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default HistorySidebar;
