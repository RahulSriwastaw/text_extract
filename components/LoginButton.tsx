import React, { useState, useRef, useEffect } from 'react';
import { LogIn, LogOut, User as UserIcon, Loader2, Cloud } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useAuthState } from 'react-firebase-hooks/auth';
import { auth } from '../services/firebase';
import { signInWithGoogle, signOutUser } from '../services/authService';

const LoginButton: React.FC = () => {
  const [user, loading] = useAuthState(auth);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSignIn = async () => {
    setIsSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      console.error('[LoginButton] Sign-in failed:', e);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    setMenuOpen(false);
    await signOutUser();
  };

  if (loading) {
    return (
      <div className="p-2 text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <button
        type="button"
        onClick={handleSignIn}
        disabled={isSigningIn}
        title="Sign in to sync your history across devices"
        className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-slate-300 hover:text-white rounded-xl text-xs font-semibold whitespace-nowrap transition-all shadow-sm disabled:opacity-50"
      >
        {isSigningIn ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
        <span className="hidden sm:inline">Sign in</span>
      </button>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        title={user.email || 'Account'}
        className="flex items-center gap-1.5 pl-1.5 pr-2 sm:pr-2.5 py-1 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-slate-200 rounded-xl transition-all shadow-sm"
      >
        {user.photoURL ? (
          <img src={user.photoURL} alt={user.displayName || 'User'} className="w-6 h-6 rounded-full border border-white/[0.1]" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-6 h-6 rounded-full bg-[#FF6B2B]/20 border border-[#FF6B2B]/30 flex items-center justify-center text-[#FF884D]">
            <UserIcon className="w-3.5 h-3.5" />
          </div>
        )}
        <span className="hidden sm:inline text-xs font-semibold max-w-[100px] truncate">
          {user.displayName || user.email}
        </span>
      </button>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-56 bg-[#121524] border border-white/[0.1] rounded-xl shadow-2xl overflow-hidden z-50"
          >
            <div className="p-3 border-b border-white/[0.08]">
              <p className="text-xs font-bold text-white truncate">{user.displayName || 'Account'}</p>
              <p className="text-[11px] text-slate-400 truncate">{user.email}</p>
              <p className="text-[10px] text-emerald-400 flex items-center gap-1 mt-1.5">
                <Cloud className="w-3 h-3" /> History syncing to your account
              </p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/10 transition-all"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default LoginButton;
