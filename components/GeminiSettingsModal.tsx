import React, { useState, useEffect } from 'react';
import { 
  X, 
  Settings, 
  ShieldCheck, 
  CheckCircle2, 
  LogOut, 
  Trash2, 
  Languages, 
  HardDrive, 
  Sparkles,
  Key,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  getAiSettings, 
  saveAiSettings, 
  clearAiCredentials, 
  clearAllAiHistory, 
  getAllConversations, 
  AiSettings 
} from '../services/aiDbService';
import GeminiConnectModal from './GeminiConnectModal';

interface GeminiSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const GeminiSettingsModal: React.FC<GeminiSettingsModalProps> = ({ isOpen, onClose }) => {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [totalConversations, setTotalConversations] = useState(0);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadDetails();
    }
  }, [isOpen]);

  const loadDetails = async () => {
    const s = await getAiSettings();
    setSettings(s);
    const convs = await getAllConversations();
    setTotalConversations(convs.length);
  };

  const handleLanguageSelect = async (lang: 'Hindi' | 'English' | 'Hinglish') => {
    await saveAiSettings({ preferredLanguage: lang });
    await loadDetails();
    setNotification(`Default language set to ${lang}`);
    setTimeout(() => setNotification(null), 2000);
  };

  const handleDisconnect = async () => {
    if (confirm('Disconnect your Gemini connection? (Your local AI conversation history will be kept)')) {
      await clearAiCredentials();
      await loadDetails();
      setNotification('Gemini disconnected successfully.');
      setTimeout(() => setNotification(null), 2000);
    }
  };

  const handleDeleteAllHistory = async () => {
    if (confirm('Permanently delete all AI explanations stored in this browser? This cannot be undone.')) {
      await clearAllAiHistory();
      await loadDetails();
      setNotification('All local AI history deleted.');
      setTimeout(() => setNotification(null), 2000);
    }
  };

  const isConnected = settings && settings.authType !== 'none' && (settings.apiKey || settings.accessToken);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-[#0A0C14]/80 backdrop-blur-md z-50"
          />

          <div className="fixed inset-0 flex items-center justify-center p-4 z-50 pointer-events-none">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="w-full max-w-md bg-[#121524] border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden pointer-events-auto flex flex-col"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-white/[0.08] bg-white/[0.02]">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center text-slate-300">
                    <Settings className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white font-display">Gemini AI Settings</h3>
                    <p className="text-[11px] text-slate-400">User connection & device privacy</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-white/[0.08] rounded-xl transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {notification && (
                <div className="mx-4 mt-3 p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-xl text-xs text-center font-medium">
                  {notification}
                </div>
              )}

              {/* Body */}
              <div className="p-4 space-y-4">
                {/* Connection Section */}
                <div className="p-3.5 bg-white/[0.02] border border-white/[0.06] rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-white">Gemini Connection</p>
                      <p className="text-[11px] text-slate-400">
                        {isConnected 
                          ? settings.authType === 'apikey' ? 'Personal API Key' : 'Google OAuth Account'
                          : 'No Gemini account connected'}
                      </p>
                    </div>
                    {isConnected ? (
                      <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" />
                        Connected ✓
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium text-slate-500 bg-white/[0.04] px-2 py-0.5 rounded-full">
                        Not Connected
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    {isConnected ? (
                      <button
                        onClick={handleDisconnect}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 rounded-lg text-xs font-bold border border-rose-500/20 transition-all"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        Disconnect Gemini
                      </button>
                    ) : (
                      <button
                        onClick={() => setShowConnectModal(true)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-gradient-to-r from-[#FF6B2B] to-[#FF884D] text-white rounded-lg text-xs font-bold hover:shadow-lg transition-all"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        Connect Gemini (Free)
                      </button>
                    )}
                  </div>
                </div>

                {/* Preferred Language */}
                <div className="p-3.5 bg-white/[0.02] border border-white/[0.06] rounded-xl space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                    <Languages className="w-3.5 h-3.5 text-[#FF884D]" />
                    <span>Default Explanation Language</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 pt-1">
                    {(['Hindi', 'English', 'Hinglish'] as const).map((lang) => (
                      <button
                        key={lang}
                        onClick={() => handleLanguageSelect(lang)}
                        className={`py-1.5 rounded-lg text-xs font-bold transition-all border ${
                          settings?.preferredLanguage === lang
                            ? 'bg-[#FF6B2B] border-[#FF6B2B] text-white shadow'
                            : 'bg-white/[0.03] border-white/[0.06] text-slate-400 hover:text-white'
                        }`}
                      >
                        {lang}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Storage & Privacy */}
                <div className="p-3.5 bg-white/[0.02] border border-white/[0.06] rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                      <HardDrive className="w-3.5 h-3.5 text-blue-400" />
                      <span>Local Device Storage (IndexedDB)</span>
                    </div>
                    <span className="text-[11px] font-bold text-slate-300">
                      {totalConversations} questions
                    </span>
                  </div>

                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    All AI interactions stay 100% on this computer. They do not sync to mobile or upload to any central server.
                  </p>

                  <button
                    onClick={handleDeleteAllHistory}
                    disabled={totalConversations === 0}
                    className="w-full flex items-center justify-center gap-1.5 py-2 bg-white/[0.03] hover:bg-rose-500/10 text-slate-400 hover:text-rose-300 border border-white/[0.06] hover:border-rose-500/20 rounded-lg text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete All AI History
                  </button>
                </div>
              </div>
            </motion.div>
          </div>

          <GeminiConnectModal
            isOpen={showConnectModal}
            onClose={() => setShowConnectModal(false)}
            onConnected={() => {
              setShowConnectModal(false);
              loadDetails();
            }}
          />
        </>
      )}
    </AnimatePresence>
  );
};

export default GeminiSettingsModal;
