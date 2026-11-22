import React, { useState, useRef, useEffect, useContext } from 'react';
import { LogIn, LogOut, User as UserIcon, Loader2, Cloud, Coins } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCurrentUser, signInWithGoogle, signOutUser } from '../services/authService';

import { QuestionBankSettings } from './QuestionBankSettings';
import AiPreferences from './AiPreferences';
import { UserStatusContext } from '../App';
import { formatPlanTokens } from '../services/apiClient';

/** The user's plan inside the profile card: tokens used / left and validity. */
function PlanSummary() {
  const status = useContext(UserStatusContext);
  const plan = status?.plan;
  if (!plan) {
    return (
      <div className="flex items-start gap-2">
        <Coins className="w-4 h-4 text-ink-3 mt-0.5 shrink-0" />
        <div>
          <p className="text-xs font-bold text-ink">No plan</p>
          <p className="text-[11px] text-ink-3">No plan is active on your account. Ask the admin to activate one.</p>
          {status?.support_whatsapp && (
            <a href={`https://wa.me/${status.support_whatsapp}`} target="_blank" rel="noreferrer"
              className="text-[11px] font-bold text-[#25D366] hover:underline">WhatsApp +{status.support_whatsapp}</a>
          )}
        </div>
      </div>
    );
  }
  const left = Math.max(0, plan.tokens - plan.used);
  const pct = plan.tokens > 0 ? Math.min(100, Math.round(plan.used / plan.tokens * 100)) : 0;
  const days = plan.expiresAt ? Math.ceil((Date.parse(plan.expiresAt) - Date.now()) / 86400000) : null;
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-xs font-bold text-ink flex items-center gap-1.5 min-w-0">
          <Coins className="w-4 h-4 text-accent shrink-0" /> <span className="truncate">{plan.name} plan</span>
        </p>
        <p className="text-xs font-bold text-ink whitespace-nowrap">{formatPlanTokens(left)} tokens left</p>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Plan tokens used">
        <div className={`h-full ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-orange-400' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[11px] text-ink-3 mt-1.5">
        {formatPlanTokens(plan.used)} of {formatPlanTokens(plan.tokens)} used
        {plan.expiresAt && (days! > 0
          ? ` · valid till ${new Date(plan.expiresAt).toLocaleDateString()} (${days} days left)`
          : ` · expired ${new Date(plan.expiresAt).toLocaleDateString()}`)}
      </p>
    </div>
  );
}

const LoginButton: React.FC = () => {
  const [user, loading] = useCurrentUser();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [showBank,setShowBank] = useState(false);
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

      {showBank && <QuestionBankSettings key={user.uid} close={()=>setShowBank(false)} />}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="menu right-0 top-full mt-2 w-80 max-w-[calc(100vw-1rem)]"
            role="menu"
            aria-label="Profile"
          >
            {/* Profile card: who you are, your plan, and your AI settings */}
            <div className="px-2.5 py-2 flex items-center gap-3">
              {user.photoURL ? (
                <img src={user.photoURL} alt="" className="w-10 h-10 rounded-full border border-white/[0.1]" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center text-accent-light">
                  <UserIcon className="w-5 h-5" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink truncate">{user.displayName || 'Account'}</p>
                <p className="text-xs text-ink-3 truncate">{user.email}</p>
                <p className="text-[11px] text-emerald-400 flex items-center gap-1 mt-0.5">
                  <Cloud className="w-3 h-3" /> History syncing to your account
                </p>
              </div>
            </div>

            <div className="mx-2.5 my-1.5 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <PlanSummary />
            </div>

            <div className="mx-2.5 my-1.5 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <AiPreferences />
            </div>

            <button type="button" className="menu-item" onClick={()=>{setMenuOpen(false);setShowBank(true);}}>My question bank</button>
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
