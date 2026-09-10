import React, { useState, useEffect } from 'react';
import PdfConverter from './components/PdfConverter';
import MocktestExtractor from './components/MocktestExtractor';
import ErrorBoundary from './components/ErrorBoundary';
import LandingPage from './components/LandingPage';
import Navbar from './components/Navbar';
import AdminPanel from './components/AdminPanel';
import { motion, AnimatePresence } from 'motion/react';

export type ActiveTool = 'landing' | 'text-converter' | 'mcq-extractor';

function App() {
  const [activeTool, setActiveTool] = useState<ActiveTool>('landing');
  const [isAdmin, setIsAdmin] = useState(false);

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
              <PdfConverter />
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
              <MocktestExtractor />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
}

export default App;

