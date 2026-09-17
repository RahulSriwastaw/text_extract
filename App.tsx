import React, { useState, useEffect } from 'react';
import PdfConverter from './components/PdfConverter';
import MocktestExtractor from './components/MocktestExtractor';
import QaPageStitcher from './components/QaPageStitcher';
import ErrorBoundary from './components/ErrorBoundary';
import LandingPage from './components/LandingPage';
import LoginPage from './components/LoginPage';
import Navbar from './components/Navbar';
import AdminPanel from './components/AdminPanel';
import { useCurrentUser } from './services/authService';
import { Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export type ActiveTool = 'landing' | 'text-converter' | 'mcq-extractor' | 'qa-stitcher';

function App() {
  const [activeTool, setActiveTool] = useState<ActiveTool>('landing');
  const [isAdmin, setIsAdmin] = useState(false);
  const [preloadedPages, setPreloadedPages] = useState<string[]>([]);
  const [user, authLoading] = useCurrentUser();

  useEffect(() => {
    // Check for admin path or param
    const isPathAdmin = window.location.pathname === '/admin-secure-v3-panel-x92';
    const params = new URLSearchParams(window.location.search);

    if (isPathAdmin || params.get('admin') === 'true') {
      setIsAdmin(true);
    }
  }, []);

  if (isAdmin) {
    return (
      <ErrorBoundary>
        <AdminPanel />
      </ErrorBoundary>
    );
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0B0D13] flex items-center justify-center">
        <motion.div
          animate={{ scale: [1, 1.08, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-[#FF6B2B] to-[#FF884D] flex items-center justify-center shadow-lg shadow-[#FF6B2B]/30"
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

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#0F0F0F]">
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
                onStartTextConverter={() => setActiveTool('text-converter')}
                onStartMcqExtractor={() => setActiveTool('mcq-extractor')}
                onStartQaStitcher={() => setActiveTool('qa-stitcher')}
              />
            </motion.div>
          )}

          {activeTool === 'text-converter' && (
            <motion.div
              key="converter"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="pt-16"
            >
              <PdfConverter 
                initialImages={preloadedPages}
                onClearInitialImages={() => setPreloadedPages([])}
              />
            </motion.div>
          )}

          {activeTool === 'mcq-extractor' && (
            <motion.div
              key="mcq-extractor"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="pt-16"
            >
              <MocktestExtractor 
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
    </ErrorBoundary>
  );
}

export default App;


