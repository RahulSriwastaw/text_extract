import React, { useState, useEffect } from 'react';
import PdfConverter from './components/PdfConverter';
import ErrorBoundary from './components/ErrorBoundary';
import LandingPage from './components/LandingPage';
import Navbar from './components/Navbar';
import AdminPanel from './components/AdminPanel';
import { auth } from './services/firebase';
import { useAuthState } from 'react-firebase-hooks/auth';
import { motion, AnimatePresence } from 'motion/react';

function App() {
  const [user, loading] = useAuthState(auth);
  const [showConverter, setShowConverter] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    // Check for admin path or param
    const isPathAdmin = window.location.pathname === '/admin-secure-v3-panel-x92';
    const params = new URLSearchParams(window.location.search);
    
    if (isPathAdmin || params.get('admin') === 'true') {
      setIsAdmin(true);
    }
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0F0F0F] flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-10 h-10 border-2 border-[#FF6B2B] border-t-transparent rounded-full"
        />
      </div>
    );
  }

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
        <Navbar />
        <AnimatePresence mode="wait">
          {!showConverter ? (
            <motion.div
              key="landing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <LandingPage onStart={() => setShowConverter(true)} />
            </motion.div>
          ) : (
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
        </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
}

export default App;
