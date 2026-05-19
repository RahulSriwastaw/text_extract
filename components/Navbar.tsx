import React from 'react';
import { auth, googleProvider } from '../services/firebase';
import { signInWithPopup, signOut } from 'firebase/auth';
import { useAuthState } from 'react-firebase-hooks/auth';
import { LogIn, LogOut, FileText, User as UserIcon, Wand2 } from 'lucide-react';
import { motion } from 'motion/react';

const Navbar: React.FC = () => {
  const [user] = useAuthState(auth);

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#1A1A1A] border-b border-[#252525]">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6">
        <div className="flex justify-between items-center h-[52px]">
          <div className="flex items-center gap-2">
            <motion.div
              initial={{ rotate: -10, scale: 0.9 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={{ duration: 0.5 }}
              className="bg-[#FF6B2B] p-1.5 rounded-[6px]"
            >
              <Wand2 className="w-[18px] h-[18px] text-white" />
            </motion.div>
            <span className="text-white font-bold text-[18px] tracking-tight">AI PDF to Text Converter</span>
          </div>

          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex flex-col items-end">
                  <span className="text-[#EFEFEF] text-[13px] font-medium">{user.displayName}</span>
                  <span className="text-[#555555] text-[11px]">{user.email}</span>
                </div>
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt="Profile"
                    className="w-8 h-8 rounded-full border border-[#252525]"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-[#141414] flex items-center justify-center border border-[#252525]">
                    <UserIcon className="w-4 h-4 text-gray-400" />
                  </div>
                )}
                <button
                  onClick={logout}
                  className="flex items-center gap-1.5 bg-transparent text-[#EFEFEF] hover:text-white px-2.5 py-1.5 rounded-[6px] transition-all text-[13px] font-medium border border-[#2A2A2A] hover:bg-[#252525]"
                  id="logout-btn"
                >
                  <LogOut className="w-[16px] h-[16px]" />
                  <span className="hidden sm:inline">Logout</span>
                </button>
              </div>
            ) : (
              <button
                onClick={login}
                className="flex items-center gap-1.5 bg-[#FF6B2B] hover:bg-[#E55A1A] text-white px-3 py-1.5 rounded-[6px] transition-colors text-[13px] font-medium"
                id="login-btn"
              >
                <LogIn className="w-[16px] h-[16px]" />
                Login with Google
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
