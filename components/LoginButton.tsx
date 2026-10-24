import React, { useState, useRef, useEffect } from 'react';
import { LogIn, LogOut, User as UserIcon, Loader2, Cloud } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCurrentUser, signInWithGoogle, signOutUser } from '../services/authService';

const LoginButton: React.FC = () => {
  const [user, loading] = useCurrentUser();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
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
    setSignInError(null);
    try {
      await signInWithGoogle();
    } catch (e: any) {
      console.error('[LoginButton] Sign-in failed:', e);
      setSignInError(e?.message || 'Sign-in failed. Please try again.');
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
      <div className="relative">
        <button
          type="button"
          onClick={handleSignIn}
          disabled={isSigningIn}
          title="Sign in to sync your history across devices"
          className="btn btn-secondary btn-sm"
        >
          {isSigningIn ? <Loader2 className="animate-spin" /> : <LogIn />}
          <span className="hidden sm:inline">Sign in</span>
        </button>
        {signInError && (
          <div className="absolute right-0 top-full mt-2 w-56 p-2.5 bg-rose-500/10 border border-rose-500/25 text-rose-300 text-[11px] rounded-xl shadow-xl z-50">
            {signInError}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        title={user.email || 'Account'}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="flex items-center gap-2 h-8 pl-1 pr-1 xl:pr-2.5 rounded-lg text-ink-2 hover:text-ink hover:bg-white/[0.06] transition-colors"
      >
        {user.photoURL ? (
          <img src={user.photoURL} alt={user.displayName || 'User'} className="w-6 h-6 rounded-full border border-white/[0.1]" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-6 h-6 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center text-accent-light">
            <UserIcon className="w-3.5 h-3.5" />
          </div>
        )}
        <span className="hidden xl:inline text-xs font-semibold max-w-[110px] truncate">
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
            className="menu right-0 top-full mt-2 w-64"
            role="menu"
          >
            <div className="px-2.5 py-2">
              <p className="text-sm font-semibold text-ink truncate">{user.displayName || 'Account'}</p>
              <p className="text-xs text-ink-3 truncate">{user.email}</p>
              <p className="text-xs text-emerald-400 flex items-center gap-1.5 mt-2">
                <Cloud className="w-3.5 h-3.5" /> History syncing to your account
              </p>
            </div>
            <div className="menu-divider" />
            <button
              type="button"
              role="menuitem"
              onClick={handleSignOut}
              className="menu-item menu-item-danger"
            >
              <LogOut />
              Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default LoginButton;
