import React, { useState, useEffect } from 'react';
import { Sparkles, Layers, History, Settings, CheckCircle2, Shield, Bot, Zap, FileSpreadsheet, FileText, Split, LayoutGrid } from 'lucide-react';
import { motion } from 'motion/react';
import { checkUserGeminiAuth } from '../services/userGeminiService';
import { subscribeToExtensionStatus, pingStudyAiExtension, BridgeStatus } from '../services/studyAiBridgeService';
import GeminiConnectModal from './GeminiConnectModal';
import AiHistoryDrawer from './AiHistoryDrawer';
import GeminiSettingsModal from './GeminiSettingsModal';
import MocktestStudioModal from './MocktestStudioModal';
import LoginButton from './LoginButton';

type NavTool = 'landing' | 'tools' | 'text-converter' | 'mcq-extractor' | 'qa-stitcher';

interface NavbarProps {
  totalKeys?: number;
  activeTool?: NavTool;
  onSelectTool?: (tool: NavTool) => void;
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
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0B0D13]/85 backdrop-blur-2xl border-b border-white/[0.08] transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14 sm:h-15 gap-3">
            {/* Logo & Brand */}
            <div 
              className="flex items-center gap-2.5 cursor-pointer select-none group shrink-0"
              onClick={() => onSelectTool?.('landing')}
              title="Back to Home"
            >
              <motion.div
                whileHover={{ scale: 1.05, rotate: 4 }}
                whileTap={{ scale: 0.95 }}
                className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#FF6B2B] to-[#FF884D] shadow-md shadow-[#FF6B2B]/25 flex items-center justify-center"
              >
                <Sparkles className="w-4 h-4 text-white" />
              </motion.div>
              <div className="flex items-center gap-1.5">
                <span className="text-white font-black text-base sm:text-lg tracking-tight font-display">
                  Text<span className="text-[#FF6B2B]">Extract</span>
                </span>
                <span className="px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest bg-[#FF6B2B]/15 text-[#FF884D] border border-[#FF6B2B]/30">
                  PRO
                </span>
              </div>
            </div>

            {/* Middle Mode Switcher Tabs (Segmented Control) */}
            <div className="flex items-center p-1 bg-black/60 border border-white/[0.08] rounded-xl gap-0.5 shadow-inner">
              <button
                type="button"
                onClick={() => onSelectTool?.('tools')}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  activeTool === 'tools'
                    ? 'bg-white text-black shadow-md font-bold'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">All Tools</span>
                <span className="sm:hidden">Tools</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectTool?.('text-converter')}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  activeTool === 'text-converter'
                    ? 'bg-[#FF6B2B] text-white shadow-md shadow-[#FF6B2B]/20 font-bold'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                <FileText className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Text / Docx</span>
                <span className="sm:hidden">Text</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectTool?.('mcq-extractor')}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  activeTool === 'mcq-extractor'
                    ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-black shadow-md shadow-amber-500/20 font-extrabold'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">MCQs Extractor</span>
                <span className="sm:hidden">MCQs</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectTool?.('qa-stitcher')}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  activeTool === 'qa-stitcher'
                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-600/20 font-bold'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                <Split className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Page Stitcher</span>
                <span className="sm:hidden">Stitch</span>
              </button>
            </div>

            {/* Right Status Indicators & Action Controls */}
            <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
              {/* AI Engine Status Pill (Single Line) */}
              {bridgeStatus.connected ? (
                <button
                  type="button"
                  onClick={() => setShowConnectModal(true)}
                  title={`TextExtract Pro Bridge Active: ${(bridgeStatus.provider || 'AI').toUpperCase()} selected${bridgeStatus.openProviders?.length ? ` • Open tabs: ${bridgeStatus.openProviders.join(', ').toUpperCase()}` : ''} - Click to configure / switch model`}
                  className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 rounded-xl text-xs font-bold whitespace-nowrap transition-all shadow-sm"
                >
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
                  </span>
                  <span className="tracking-wide">{(bridgeStatus.provider || 'AI').toUpperCase()}</span>
                  <span className="hidden sm:inline-block text-[10px] text-emerald-300/80 font-semibold px-1.5 py-0.2 bg-emerald-500/20 rounded border border-emerald-500/30 uppercase tracking-wider">
                    Bridge
                  </span>
                </button>
              ) : authStatus !== 'none' ? (
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(true)}
                  title="Direct Gemini API Active - Click to configure"
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-300 rounded-xl text-xs font-bold whitespace-nowrap transition-all shadow-sm"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span>Gemini API</span>
                  <span className="hidden sm:inline-block text-[10px] text-blue-300/80 font-semibold px-1.5 py-0.2 bg-blue-500/20 rounded border border-blue-500/30 uppercase tracking-wider">
                    Direct
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowConnectModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-[#FF6B2B] to-[#FF884D] hover:opacity-95 text-white rounded-xl text-xs font-bold whitespace-nowrap shadow-md shadow-[#FF6B2B]/20 transition-all"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>Connect AI</span>
                </button>
              )}

              {/* Quick Mocktest Studio Drawer/Modal */}
              <button
                type="button"
                onClick={() => setShowMocktestStudio(true)}
                title="Open MockTest CSV Quick Editor"
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-white/[0.04] hover:bg-amber-500/15 border border-white/[0.08] hover:border-amber-500/30 text-slate-300 hover:text-amber-300 rounded-xl text-xs font-semibold whitespace-nowrap transition-all shadow-sm"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="hidden lg:inline">MockTest Studio</span>
              </button>

              {/* History Drawer */}
              <button
                type="button"
                onClick={() => setShowHistoryDrawer(true)}
                title="AI Explanations History"
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-slate-300 hover:text-white rounded-xl text-xs font-semibold whitespace-nowrap transition-all shadow-sm"
              >
                <History className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="hidden lg:inline">History</span>
              </button>

              {/* Settings */}
              <button
                type="button"
                onClick={() => setShowSettingsModal(true)}
                title="AI & API Settings"
                className="p-2 text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-xl transition-all"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>

              {/* Login / Account */}
              <LoginButton />
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
        onSelectConversionItem={() => {
          onSelectTool?.('text-converter');
        }}
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
