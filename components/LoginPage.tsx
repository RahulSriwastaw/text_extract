import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  Sparkles,
  Zap,
  Cloud,
  ShieldCheck,
  Bot,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { signInWithGoogle } from '../services/authService';

const FEATURES = [
  {
    icon: <Zap className="w-4 h-4 text-[#FF884D]" />,
    text: 'Zero-token AI extraction via your own browser session',
  },
  {
    icon: <Cloud className="w-4 h-4 text-blue-400" />,
    text: 'Conversion history synced securely to your account',
  },
  {
    icon: <Bot className="w-4 h-4 text-emerald-400" />,
    text: 'Multi-AI bridge: Gemini, DeepSeek, ChatGPT & Claude',
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.12, delayChildren: 0.2 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const LoginPage: React.FC = () => {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setIsSigningIn(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e: any) {
      console.error('[LoginPage] Sign-in failed:', e);
      setError(e?.message || 'Sign-in failed. Please try again.');
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0D13] text-slate-100 overflow-hidden relative flex items-center justify-center px-4 py-12 selection:bg-[#FF6B2B]/30">
      {/* Ambient animated glows */}
      <motion.div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-5xl h-[520px] bg-gradient-to-b from-[#FF6B2B]/20 via-purple-600/10 to-transparent blur-[140px] pointer-events-none rounded-full"
        animate={{ opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-0 right-0 w-96 h-96 bg-blue-600/15 blur-[130px] pointer-events-none rounded-full"
        animate={{ x: [0, 30, 0], y: [0, -20, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-1/3 left-0 w-80 h-80 bg-emerald-600/10 blur-[120px] pointer-events-none rounded-full"
        animate={{ x: [0, -20, 0], y: [0, 25, 0] }}
        transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Faint grid texture */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="relative z-10 w-full max-w-md"
      >
        {/* Brand */}
        <motion.div variants={itemVariants} className="flex flex-col items-center text-center mb-8">
          <motion.div
            whileHover={{ scale: 1.05, rotate: 4 }}
            className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-[#FF6B2B] to-[#FF884D] shadow-xl shadow-[#FF6B2B]/30 flex items-center justify-center mb-4"
          >
            <Sparkles className="w-8 h-8 text-white" />
          </motion.div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight font-display text-white">
            Text<span className="text-[#FF6B2B]">Extract</span>{' '}
            <span className="px-2 py-0.5 rounded-md text-[11px] font-black uppercase tracking-widest bg-[#FF6B2B]/15 text-[#FF884D] border border-[#FF6B2B]/30 align-middle">
              PRO
            </span>
          </h1>
          <p className="text-sm text-slate-400 mt-2 max-w-xs">
            Sign in to unlock AI-powered document & MCQ digitization tools.
          </p>
        </motion.div>

        {/* Card */}
        <motion.div
          variants={itemVariants}
          className="bg-[#121524]/90 backdrop-blur-xl border border-white/[0.08] rounded-3xl shadow-2xl p-6 sm:p-8"
        >
          <motion.button
            type="button"
            onClick={handleSignIn}
            disabled={isSigningIn}
            whileHover={{ scale: isSigningIn ? 1 : 1.02 }}
            whileTap={{ scale: isSigningIn ? 1 : 0.98 }}
            className="w-full flex items-center justify-center gap-3 py-3.5 bg-white hover:bg-slate-100 text-slate-900 rounded-xl text-sm font-bold transition-all shadow-lg disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {isSigningIn ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                />
              </svg>
            )}
            {isSigningIn ? 'Signing in...' : 'Continue with Google'}
          </motion.button>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-3 p-3 bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs rounded-xl flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </motion.div>
          )}

          <div className="mt-6 pt-6 border-t border-white/[0.06] space-y-3">
            {FEATURES.map((f, i) => (
              <motion.div
                key={i}
                variants={itemVariants}
                className="flex items-center gap-3 text-xs text-slate-300"
              >
                <div className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shrink-0">
                  {f.icon}
                </div>
                <span>{f.text}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.div
          variants={itemVariants}
          className="flex items-center justify-center gap-2 mt-6 text-[11px] text-slate-500"
        >
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span>Secure Google sign-in · We never post or store your passwords</span>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default LoginPage;
