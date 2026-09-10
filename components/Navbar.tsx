import React, { useState, useEffect } from 'react';
import { Sparkles, Layers, History, Settings, CheckCircle2, Shield, Bot, Zap, FileSpreadsheet, FileText } from 'lucide-react';
import { motion } from 'motion/react';
import { checkUserGeminiAuth } from '../services/userGeminiService';
import { subscribeToExtensionStatus, pingStudyAiExtension, BridgeStatus } from '../services/studyAiBridgeService';
import GeminiConnectModal from './GeminiConnectModal';
import AiHistoryDrawer from './AiHistoryDrawer';
import GeminiSettingsModal from './GeminiSettingsModal';
import MocktestStudioModal from './MocktestStudioModal';

interface NavbarProps {
  totalKeys?: number;
  activeTool?: 'landing' | 'text-converter' | 'mcq-extractor';
  onSelectTool?: (tool: 'landing' | 'text-converter' | 'mcq-extractor') => void;
}

const Navbar: React.FC<NavbarProps> = ({ 
  totalKeys = 23,
  activeTool = 'landing',
  onSelectTool
}) => {
  const [authStatus, setAuthStatus] = useState<'none' | 'apikey' | 'oauth'>('none');
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({ connected: false });
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showMocktestStudio, setShowMocktestStudio] = useState(false);

  useEffect(() => {
    refreshAuth();
    const unsub = subscribeToExtensionStatus((status) => {
      setBridgeStatus(status);
    });
    pingStudyAiExtension().catch(() => {});
    return () => unsub();
  }, []);

  const refreshAuth = async () => {
    const res = await checkUserGeminiAuth();
    setAuthStatus(res.isAuthenticated ? res.authType : 'none');
    pingStudyAiExtension().catch(() => {});
  };

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0B0D13]/80 backdrop-blur-xl border-b border-white/[0.08]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14">
            {/* Logo & Brand */}
            <div 
              className="flex items-center gap-3 cursor-pointer select-none"
              onClick={() => onSelectTool?.('landing')}
              title="Back to Home"
            >
              <motion.div
                whileHover={{ scale: 1.05, rotate: 5 }}
                whileTap={{ scale: 0.95 }}
                className="relative p-2 bg-gradient-to-tr from-[#FF6B2B] to-[#FF884D] rounded-xl shadow-lg shadow-[#FF6B2B]/25 flex items-center justify-center cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-white" />
              </motion.div>
              <div className="flex items-center gap-2">
                <span className="text-white font-extrabold text-base sm:text-lg tracking-tight font-display">
                  Text<span className="text-[#FF6B2B]">Extract</span>
                </span>
                <span className="hidden xs:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FF6B2B]/15 text-[#FF884D] border border-[#FF6B2B]/30 tracking-wider uppercase">
                  AI Pro
                </span>
              </div>
            </div>

            {/* Middle Mode Switcher Tabs */}
            <div className="hidden md:flex items-center gap-1 p-1 bg-white/[0.04] border border-white/[0.08] rounded-xl shadow-inner">
              <button
                type="button"
                onClick={() => onSelectTool?.('text-converter')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTool === 'text-converter'
                    ? 'bg-gradient-to-r from-[#FF6B2B] to-[#FF884D] text-white shadow-md shadow-[#FF6B2B]/20'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Text / Docx Extract</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectTool?.('mcq-extractor')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTool === 'mcq-extractor'
                    ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-black shadow-md shadow-amber-500/20 font-extrabold'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>MockTest MCQ Extract (18-Col CSV)</span>
              </button>
            </div>

            {/* Right Status Indicators & Controls */}
            <div className="flex items-center gap-2 sm:gap-2.5">
              {/* Study AI Bridge Extension Badge (Zero Token Cost) */}
              {bridgeStatus.connected ? (
                <button
                  type="button"
                  onClick={() => setShowConnectModal(true)}
                  title="TextExtract Pro Bridge Active - 100% Free Unlimited Extraction"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 text-emerald-400 rounded-lg text-xs font-bold transition-all"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span className="hidden sm:inline">Free Bridge:</span>
                  <span>{(bridgeStatus.provider || 'AI').toUpperCase()} Active</span>
                </button>
              ) : authStatus !== 'none' ? (
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 rounded-lg text-xs font-bold transition-all"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Your Gemini:</span>
                  <span>Connected ✓</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowConnectModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-[#FF6B2B] to-[#FF884D] hover:shadow-lg hover:shadow-[#FF6B2B]/20 text-white rounded-lg text-xs font-bold transition-all"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>Connect Free AI</span>
                </button>
              )}

              {/* Mocktest Studio (18-Col CSV) */}
              <button
                type="button"
                onClick={() => setShowMocktestStudio(true)}
                title="MockTest Studio (18-Column Bilingual CSV)"
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gradient-to-r from-amber-500/15 to-orange-500/15 hover:from-amber-500/25 hover:to-orange-500/25 border border-amber-500/30 text-amber-300 hover:text-white rounded-lg text-xs font-semibold transition-all shadow-sm"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">MockTest Studio</span>
              </button>

              {/* My AI Explanations */}
              <button
                type="button"
                onClick={() => setShowHistoryDrawer(true)}
                title="My AI Explanations (Local History)"
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-slate-300 hover:text-white rounded-lg text-xs font-semibold transition-all"
              >
                <History className="w-3.5 h-3.5 text-[#FF884D]" />
                <span className="hidden md:inline">AI History</span>
              </button>

              {/* Settings */}
              <button
                type="button"
                onClick={() => setShowSettingsModal(true)}
                title="AI Settings"
                className="p-1.5 text-slate-400 hover:text-white hover:bg-white/[0.08] rounded-lg transition-all"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Modals */}
      <GeminiConnectModal
        isOpen={showConnectModal}
        onClose={() => {
          setShowConnectModal(false);
          refreshAuth();
        }}
        onConnected={() => {
          setShowConnectModal(false);
          refreshAuth();
        }}
      />

      <AiHistoryDrawer
        isOpen={showHistoryDrawer}
        onClose={() => setShowHistoryDrawer(false)}
      />

      <GeminiSettingsModal
        isOpen={showSettingsModal}
        onClose={() => {
          setShowSettingsModal(false);
          refreshAuth();
        }}
      />

      <MocktestStudioModal
        isOpen={showMocktestStudio}
        onClose={() => setShowMocktestStudio(false)}
      />
    </>
  );
};

export default Navbar;
