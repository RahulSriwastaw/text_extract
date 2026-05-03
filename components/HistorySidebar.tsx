import React from 'react';
import { Clock, Trash2, FileText, ChevronRight, Download, Copy } from 'lucide-react';
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
            className="fixed inset-0 bg-[#0F0F0F]/20 backdrop-blur-sm z-40"
          />
          
          {/* Sidebar */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 h-full w-full max-w-md bg-[#1A1A1A] z-50 flex flex-col"
          >
            <div className="p-3 border-b border-[#252525] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-[8px] bg-[#0F0F0F] text-white flex items-center justify-center">
                  <Clock className="w-4 h-4" />
                </div>
                <h2 className="text-[16px] font-bold text-[#EFEFEF]">History</h2>
              </div>
              <div className="flex items-center gap-2">
                {history.length > 0 && (
                  <button 
                    onClick={() => {
                      if (confirm("Are you sure you want to clear all history?")) {
                        onClearAll();
                      }
                    }}
                    className="p-1.5 text-[#555555] hover:text-[#F44336] hover:bg-[#1A2A3A] rounded-[8px] transition-colors"
                    title="Clear All"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button 
                  onClick={onClose}
                  className="p-1.5 hover:bg-[#141414] rounded-[8px] transition-colors text-[#555555]"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {history.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-[#555555] space-y-4">
                  <Clock className="w-12 h-12 opacity-20" />
                  <p className="text-[13px] font-medium">No history yet</p>
                </div>
              ) : (
                history.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).map((item) => {
                  const elements = item.elements || [];
                  const fullText = elements
                    .map(el => el.type === 'text' || el.type === 'table' ? (el.content || '') : `[Image: ${el.content || ''}]`)
                    .join('\n\n');
                  const previewText = fullText.replace(/\n/g, ' ').substring(0, 50) + (fullText.length > 50 ? '...' : '');

                  return (
                    <motion.div
                      layout
                      key={item.id}
                      className="group p-3 rounded-[8px] border border-[#252525] bg-[#1A1A1A] hover:border-[#FF6B2B] hover:shadow-[0_2px_8px_rgba(0,0,0,0.35)] transition-all cursor-pointer relative"
                      onClick={() => onSelectItem(item)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className="w-8 h-8 rounded-[8px] bg-[#111111] flex-shrink-0 flex items-center justify-center text-[#555555] group-hover:bg-[#141414] group-hover:text-[#EFEFEF] transition-colors">
                            <FileText className="w-4 h-4" />
                          </div>
                          <div className="overflow-hidden">
                            <h3 className="font-semibold text-[#EFEFEF] line-clamp-1 text-[13px]">{item.fileName}</h3>
                            <p className="text-[10px] text-[#555555] mt-0.5">
                              {new Date(item.timestamp).toLocaleDateString()} • {item.pagesCount} pages
                            </p>
                            {previewText && (
                              <p className="text-[10px] text-[#555555] mt-1 line-clamp-1 italic">
                                "{previewText}"
                              </p>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(fullText)
                                .then(() => alert("Text copied to clipboard!"))
                                .catch(err => console.error("Failed to copy text:", err));
                            }}
                            className="p-1.5 text-[#555555] hover:text-[#EFEFEF] hover:bg-[#141414] rounded-[6px] transition-all"
                            title="Copy Text"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteItem(item.id);
                            }}
                            className="p-1.5 text-[#555555] hover:text-[#F44336] hover:bg-[#1A2A3A] rounded-[6px] transition-all"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>

            <div className="p-3 border-t border-[#252525] bg-[#111111]/50">
              <p className="text-[11px] text-[#555555] text-center">
                History is saved locally on your device.
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default HistorySidebar;
