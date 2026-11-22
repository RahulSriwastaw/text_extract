import React, { useState, useEffect, useContext } from 'react';
import { Sparkles, History, CheckCircle2, Zap, FileSpreadsheet, FileText, Split, LayoutGrid, Gauge, Coins } from 'lucide-react';
import { formatPlanTokens } from '../services/apiClient';
import { UserStatusContext } from '../App';
import { subscribeToExtensionStatus, pingStudyAiExtension, BridgeStatus } from '../services/studyAiBridgeService';
import GeminiConnectModal from './GeminiConnectModal';
import AiHistoryDrawer from './AiHistoryDrawer';
import MocktestStudioModal from './MocktestStudioModal';
import LoginButton from './LoginButton';

type NavTool = 'landing' | 'tools' | 'text-converter' | 'mcq-extractor' | 'qa-stitcher';

const NAV_TABS: { id: NavTool; label: string; short: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'tools', label: 'All tools', short: 'Tools', Icon: LayoutGrid },
  { id: 'text-converter', label: 'Text / DOCX', short: 'Text', Icon: FileText },
  { id: 'mcq-extractor', label: 'MCQ extractor', short: 'MCQs', Icon: FileSpreadsheet },
  { id: 'qa-stitcher', label: 'Page stitcher', short: 'Stitch', Icon: Split },
];

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
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({ connected: false });
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [showMocktestStudio, setShowMocktestStudio] = useState(false);

  useEffect(() => {
    refreshAuth();
    const unsub = subscribeToExtensionStatus((status) => {
      setBridgeStatus(status);
    });
    pingStudyAiExtension().catch(() => {});
    return () => unsub();
  }, []);

  const refreshAuth = () => { pingStudyAiExtension().catch(() => {}); };

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 bg-canvas/90 backdrop-blur-xl border-b border-line">
        <div className="app-container">
          <div className="flex justify-between items-center h-14 gap-3">
            {/* Logo & Brand */}
            <button
              type="button"
              className="flex items-center gap-2.5 select-none shrink-0 rounded-lg"
              onClick={() => onSelectTool?.('landing')}
              title="Back to Home"
            >
              <span className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-on-accent" />
              </span>
              <span className="hidden lg:flex items-center gap-1.5">
                <span className="text-ink font-bold text-base tracking-tight font-display">
                  Text<span className="text-accent">Extract</span>
                </span>
                <span className="badge badge-accent h-5 px-1.5 text-[10.5px] tracking-wider">PRO</span>
              </span>
            </button>

            {/* Tool switcher */}
            <div className="seg min-w-0 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Tools">
              {NAV_TABS.map(({ id, label, short, Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={activeTool === id}
                  onClick={() => onSelectTool?.(id)}
                  className="seg-item"
                  title={label}
                >
                  <Icon className={activeTool === id ? 'text-accent' : ''} />
                  <span className="hidden lg:inline">{label}</span>
                  <span className="lg:hidden">{short}</span>
                </button>
              ))}
            </div>

            {/* Status & utilities */}
            <div className="flex items-center gap-1.5 shrink-0">
              {bridgeStatus.connected ? (
                <button
                  type="button"
                  onClick={() => setShowConnectModal(true)}
                  title={`TextExtract Pro Bridge Active: ${(bridgeStatus.provider || 'AI').toUpperCase()} selected${bridgeStatus.openProviders?.length ? ` • Open tabs: ${bridgeStatus.openProviders.join(', ').toUpperCase()}` : ''} - Click to configure / switch model`}
                  className="badge badge-success h-8 px-3 rounded-lg cursor-pointer hover:bg-emerald-500/20"
                >
                  <span className="dot text-emerald-400" />
                  <span>{(bridgeStatus.provider || 'AI').charAt(0).toUpperCase() + (bridgeStatus.provider || 'AI').slice(1)}</span>
                  <span className="hidden xl:inline text-emerald-300/70 font-medium">· Bridge</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowConnectModal(true)}
                  title="Connect the browser extension bridge"
                  className="btn btn-secondary btn-sm"
                >
                  <Zap className="text-accent" />
                  <span>Connect Bridge</span>
                </button>
              )}

              <div className="toolbar-divider mx-1 hidden sm:block" />

              <button
                type="button"
                onClick={() => setShowMocktestStudio(true)}
                title="MockTest Studio — quick CSV editor"
                aria-label="MockTest Studio"
                className="btn btn-ghost btn-sm max-xl:w-7 max-xl:px-0"
              >
                <FileSpreadsheet />
                <span className="hidden xl:inline">Studio</span>
              </button>

              <button
                type="button"
                onClick={() => setShowHistoryDrawer(true)}
                title="AI explanations history"
                aria-label="History"
                className="btn btn-ghost btn-sm max-xl:w-7 max-xl:px-0"
              >
                <History />
                <span className="hidden xl:inline">History</span>
              </button>

              {/* Token balance sits right beside the profile */}
              <UsageIndicator />
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
        activeTool={activeTool}
        onSelectTool={onSelectTool}
        onSelectConversionItem={() => {
          onSelectTool?.('text-converter');
        }}
      />

      <MocktestStudioModal
        isOpen={showMocktestStudio}
        onClose={() => setShowMocktestStudio(false)}
      />
    </>
  );
};

/** Small "used / limit" indicator shown when a daily limit applies. */
function UsageIndicator() {
  const status = useContext(UserStatusContext);
  if (status?.plan) {
    const { name, tokens, used, expiresAt } = status.plan;
    const left = Math.max(0, tokens - used);
    const low = tokens > 0 && left / tokens <= 0.2;
    const days = expiresAt ? Math.ceil((Date.parse(expiresAt) - Date.now()) / 86400000) : null;
    return (
      <div className="flex items-center gap-1.5 h-8 text-[11px] text-ink-2 px-2 rounded-lg bg-surface-2 border border-line whitespace-nowrap"
        title={`${name} plan: ${formatPlanTokens(used)} of ${formatPlanTokens(tokens)} tokens used${expiresAt ? `, valid till ${new Date(expiresAt).toLocaleDateString()}` : ''}`}>
        <Coins size={13} className={low ? 'text-orange-400' : 'text-accent'} />
        <span className={low ? 'text-orange-400 font-bold' : 'font-bold'}>
          {formatPlanTokens(left)}<span className="hidden md:inline font-medium"> tokens left</span>
        </span>
        {days != null && days <= 7 && <span className="text-orange-400 font-bold">· {Math.max(days, 0)}d</span>}
      </div>
    );
  }
  // Signed in but no plan yet: say so, instead of showing nothing beside the profile
  if (status && status.daily_limit == null) {
    return (
      <div className="flex items-center gap-1.5 h-8 text-[11px] text-ink-3 px-2 rounded-lg bg-surface-2 border border-line whitespace-nowrap"
        title="No plan is active on your account. Ask the admin to activate one.">
        <Coins size={13} />
        <span className="font-bold">No plan</span>
      </div>
    );
  }
  if (!status || status.daily_limit == null) return null;
  const pct = status.daily_limit > 0 ? Math.min(100, Math.round(status.used / status.daily_limit * 100)) : 0;
  const isHigh = pct >= 80;
  return (
    <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-ink-3 px-2 py-1 rounded-lg bg-surface-2 border border-line" title={`Server-key requests today: ${status.used} / ${status.daily_limit}`}>
      <Gauge size={13} className={isHigh ? 'text-orange-400' : 'text-ink-3'} />
      <span className={isHigh ? 'text-orange-400 font-bold' : ''}>{status.used}/{status.daily_limit}</span>
    </div>
  );
}

export default Navbar;
