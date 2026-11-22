import React from 'react';
import { X, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import AiPreferences from './AiPreferences';

interface GeminiSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * AI preferences (explanation language, local history). The same settings live in the
 * profile card; personal API key connection was removed — usage runs on the user's plan.
 */
const GeminiSettingsModal: React.FC<GeminiSettingsModalProps> = ({ isOpen, onClose }) => (
  <AnimatePresence>
    {isOpen && (
      <>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-[rgb(4_5_8/0.75)] backdrop-blur-[3px] z-50"
        />
        <div className="fixed inset-0 flex items-center justify-center p-4 z-50 pointer-events-none">
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 15 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 15 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="w-full max-w-md bg-surface border border-line-strong rounded-2xl shadow-2xl overflow-hidden pointer-events-auto flex flex-col"
          >
            <div className="flex items-center justify-between p-4 border-b border-white/[0.08] bg-white/[0.02]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center text-slate-300">
                  <Settings className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white font-display">AI Settings</h3>
                  <p className="text-[11px] text-slate-400">Language & history on this device</p>
                </div>
              </div>
              <button onClick={onClose} aria-label="Close" className="p-1.5 text-slate-400 hover:text-white hover:bg-white/[0.08] rounded-xl transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4">
              <AiPreferences />
            </div>
          </motion.div>
        </div>
      </>
    )}
  </AnimatePresence>
);

export default GeminiSettingsModal;
