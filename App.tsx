import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import PdfConverter from './components/PdfConverter';
import MocktestExtractor from './components/MocktestExtractor';
import QaPageStitcher from './components/QaPageStitcher';
import ErrorBoundary from './components/ErrorBoundary';
import LandingPage from './components/LandingPage';
import ToolsPage from './components/ToolsPage';
import LoginPage from './components/LoginPage';
import Navbar from './components/Navbar';
import AdminPanel from './components/AdminPanel';
import type { DesignInput } from './components/DesignStudio';
import { useCurrentUser, signOutUser } from './services/authService';
import { apiFetchJson, PLAN_CHANGED_EVENT, formatPlanTokens } from './services/apiClient';
import { Sparkles, Ban, AlertTriangle, MessageCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// ---------------------------------------------------------------------------
// User status context (blocked / limit info from /api/me)
// ---------------------------------------------------------------------------
export interface UserStatus {
  status: string;
  daily_limit: number | null;
  used: number;
  blocked_reason?: string;
  plan?: { name: string; tokens: number; used: number; expiresAt: string | null } | null;
  /** 'ok', or why the plan does not let this user in. Always 'ok' while plans are not required. */
  plan_state?: 'ok' | 'no_plan' | 'plan_expired' | 'token_limit';
  /** Admin's WhatsApp number (digits with country code) for plan requests; '' when not set. */
  support_whatsapp?: string;
}

const PLAN_LOCK: Record<string, { title: string; text: string }> = {
  no_plan: { title: 'Activate a Plan to Use This Tool', text: 'Your account has no active plan yet. Contact the admin to get a plan activated.' },
  plan_expired: { title: 'Plan Expired', text: 'Your plan has expired. Ask the admin to renew it.' },
  token_limit: { title: 'Tokens Used Up', text: 'You have used all the tokens in your plan. Ask the admin to renew the plan or add tokens.' },
};

export const UserStatusContext = createContext<UserStatus | null>(null);
export const useUserStatus = () => useContext(UserStatusContext);

const UniversalCsvConverter = React.lazy(() => import('./components/UniversalCsvConverter'));
const PdfSplitter = React.lazy(() => import('./components/PdfSplitter'));

const DesignStudio = React.lazy(() => import('./components/DesignStudio'));

export type ActiveTool = 'landing' | 'tools' | 'text-converter' | 'mcq-extractor' | 'qa-stitcher' | 'design-studio';

/**
 * Every tool has its own address, so a refresh, the Back button or a shared link opens
 * the same tool instead of the home page. (The CSV converter, the PDF splitter and the
 * admin panel already have /csv-converter, /pdf-splitter and /admin.)
 */
export const TOOL_PATHS: Record<ActiveTool, string> = {
  landing: '/',
  tools: '/tools',
  'text-converter': '/text-to-docx',
  'mcq-extractor': '/mcq-extractor',
  'qa-stitcher': '/page-stitcher',
  'design-studio': '/design-studio',
};

export function toolFromPath(pathname: string): ActiveTool {
  const path = pathname.replace(/\/+$/, '') || '/';
  return (Object.keys(TOOL_PATHS) as ActiveTool[]).find(tool => TOOL_PATHS[tool] === path) || 'landing';
}

function App() {
  if (window.location.pathname.replace(/\/$/, '') === '/csv-converter') {
    return (
      <ErrorBoundary>
        <React.Suspense fallback={<div className="p-8 text-ink-2">Loading CSV converter…</div>}>
          <UniversalCsvConverter />
        </React.Suspense>
      </ErrorBoundary>
    );
  }
  if (window.location.pathname.replace(/\/$/, '') === '/pdf-splitter') {
    return (
      <ErrorBoundary>
        <React.Suspense fallback={<div className="p-8 text-ink-2">Loading PDF splitter…</div>}>
          <PdfSplitter />
        </React.Suspense>
      </ErrorBoundary>
    );
  }
  return <ExistingApp />;
}

function ExistingApp() {
  // The address bar is the source of truth for which tool is open.
  const [activeTool, showTool] = useState<ActiveTool>(() => toolFromPath(window.location.pathname));
  const setActiveTool = useCallback((tool: ActiveTool) => {
    showTool(tool);
    if (window.location.pathname !== TOOL_PATHS[tool]) {
      window.history.pushState({ tool }, '', TOOL_PATHS[tool]);
      window.scrollTo(0, 0);
    }
  }, []);
  useEffect(() => {
    const onNavigate = () => showTool(toolFromPath(window.location.pathname));   // Back / Forward buttons
    window.addEventListener('popstate', onNavigate);
    return () => window.removeEventListener('popstate', onNavigate);
  }, []);
  const [isAdmin, setIsAdmin] = useState(false);
  const [preloadedPages, setPreloadedPages] = useState<string[]>([]);
  // Extracted content handed from the Text tool to Design Studio
  const [designInput, setDesignInput] = useState<DesignInput | null>(null);
  const [user, authLoading] = useCurrentUser();
  const [userStatus, setUserStatus] = useState<UserStatus | null>(null);
  const [statusCheck, setStatusCheck] = useState(0);

  useEffect(() => {
    // Admin panel at /admin only (old secret paths removed)
    if (window.location.pathname === '/admin') {
      setIsAdmin(true);
    }
  }, []);

  // Fetch user status (blocked / limit) from /api/me
  useEffect(() => {
    if (!user) { setUserStatus(null); return; }
    let active = true;
    const refresh = () => {
      if (document.hidden) return;
      apiFetchJson('/api/me')
      .then((data: any) => active && setUserStatus({
        status: data.status || 'active',
        daily_limit: data.daily_limit,
        used: data.used || 0,
        blocked_reason: data.blocked_reason,
        plan: data.plan || null,
        plan_state: data.plan_state || 'ok',
        support_whatsapp: data.support_whatsapp || '',
      }))
      .catch(() => active && setUserStatus(null));
    };
    refresh();
    const timer = setInterval(refresh, 120000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener(PLAN_CHANGED_EVENT, refresh);
    return () => {
      active = false; clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener(PLAN_CHANGED_EVENT, refresh);
    };
  }, [user, statusCheck]);

  if (isAdmin) {
    return (
      <ErrorBoundary>
        <AdminPanel />
      </ErrorBoundary>
    );
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <motion.div
          animate={{ scale: [1, 1.08, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          className="w-14 h-14 rounded-2xl bg-accent flex items-center justify-center shadow-lg "
        >
          <Sparkles className="w-7 h-7 text-white" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <ErrorBoundary>
        <LoginPage />
      </ErrorBoundary>
    );
  }

  // Blocked screen
  if (userStatus?.status === 'blocked') {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
        <div className="max-w-md bg-surface p-8 rounded-2xl border border-line text-center">
          <Ban className="w-14 h-14 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Account Blocked</h2>
          <p className="text-ink-3 text-sm mb-4">
            {userStatus.blocked_reason || 'Your account has been blocked by an administrator. Contact support if you think this is a mistake.'}
          </p>
          <p className="text-xs text-ink-3">Signed in as {user.email}</p>
        </div>
      </div>
    );
  }

  // Plan lock: the home and tools pages stay open, but starting any tool without a usable
  // plan (none / expired / tokens used up) asks the user to get one activated on WhatsApp.
  const planLock = activeTool !== 'landing' && activeTool !== 'tools'
    && userStatus?.plan_state && PLAN_LOCK[userStatus.plan_state];
  if (planLock) {
    const plan = userStatus!.plan;
    const whatsapp = userStatus!.support_whatsapp;
    const message = `Hello, please activate a plan for my TextExtract account: ${user.email || ''}`;
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
        <div className="max-w-md bg-surface p-8 rounded-2xl border border-line text-center">
          <AlertTriangle className="w-14 h-14 text-orange-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">{planLock.title}</h2>
          <p className="text-ink-3 text-sm mb-4">{planLock.text}</p>
          {plan && (
            <p className="text-xs text-ink-3 mb-4">
              {plan.name}: {formatPlanTokens(plan.used)} / {formatPlanTokens(plan.tokens)} tokens used
              {plan.expiresAt && ` · valid till ${new Date(plan.expiresAt).toLocaleDateString()}`}
            </p>
          )}
          {whatsapp && (
            <div className="mb-5">
              <a href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-[#25D366] hover:bg-[#1ebe5b] text-black font-bold text-sm transition-colors">
                <MessageCircle className="w-5 h-5" /> Chat on WhatsApp to activate
              </a>
              <p className="text-xs text-ink-3 mt-2">WhatsApp: +{whatsapp}</p>
            </div>
          )}
          <p className="text-xs text-ink-3 mb-5">Signed in as {user.email}</p>
          <div className="flex flex-wrap gap-2 justify-center">
            <button className="btn btn-secondary btn-sm" onClick={() => setActiveTool('landing')}>Back to home</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setStatusCheck(v => v + 1)}>Check again</button>
            <button className="btn btn-secondary btn-sm" onClick={() => signOutUser()}>Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <UserStatusContext.Provider value={userStatus}>
      <div className="min-h-screen bg-canvas">
        <Navbar 
          activeTool={activeTool}
          onSelectTool={(tool) => setActiveTool(tool)}
        />
        <AnimatePresence mode="wait">
          {activeTool === 'landing' && (
            <motion.div
              key="landing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <LandingPage
                onExploreTools={() => setActiveTool('tools')}
                onOpenTool={(tool) => setActiveTool(tool)}
              />
            </motion.div>
          )}

          {activeTool === 'tools' && (
            <motion.div
              key="tools"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <ToolsPage
                onBack={() => setActiveTool('landing')}
                onStartTextConverter={() => setActiveTool('text-converter')}
                onStartMcqExtractor={() => setActiveTool('mcq-extractor')}
                onStartQaStitcher={() => setActiveTool('qa-stitcher')}
                onStartDesignStudio={() => setActiveTool('design-studio')}
              />
            </motion.div>
          )}

          {activeTool === 'text-converter' && (
            <motion.div
              key="converter"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="pt-14"
            >
              <PdfConverter key={user.uid} uid={user.uid}
                initialImages={preloadedPages}
                onClearInitialImages={() => setPreloadedPages([])}
                onSendToDesign={(elements, title) => { setDesignInput({ elements, title }); setActiveTool('design-studio'); }}
              />
            </motion.div>
          )}

          {activeTool === 'design-studio' && (
            <motion.div
              key="design-studio"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="pt-14"
            >
              <React.Suspense fallback={<div className="p-8 text-ink-2">Loading Design Studio…</div>}>
                <DesignStudio
                  input={designInput}
                  onClearInput={() => setDesignInput(null)}
                  onOpenTextTool={() => setActiveTool('text-converter')}
                />
              </React.Suspense>
            </motion.div>
          )}

          {activeTool === 'mcq-extractor' && (
            <motion.div
              key="mcq-extractor"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="pt-14"
            >
              <MocktestExtractor key={user.uid} uid={user.uid}
                initialPages={preloadedPages}
                onClearInitialPages={() => setPreloadedPages([])}
              />
            </motion.div>
          )}

          {activeTool === 'qa-stitcher' && (
            <motion.div
              key="qa-stitcher"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="pt-14"
            >
              <QaPageStitcher 
                onSendToMcqExtractor={(images) => {
                  setPreloadedPages(images);
                  setActiveTool('mcq-extractor');
                }}
                onSendToDocxConverter={(images) => {
                  setPreloadedPages(images);
                  setActiveTool('text-converter');
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      </UserStatusContext.Provider>
    </ErrorBoundary>
  );
}

export default App;


