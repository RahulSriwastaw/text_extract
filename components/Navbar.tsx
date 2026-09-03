import React from 'react';
import { Sparkles, Cpu, Layers } from 'lucide-react';
import { motion } from 'motion/react';

interface NavbarProps {
  totalKeys?: number;
}

const Navbar: React.FC<NavbarProps> = ({ totalKeys = 23 }) => {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0B0D13]/80 backdrop-blur-xl border-b border-white/[0.08]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-14">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <motion.div
              whileHover={{ scale: 1.05, rotate: 5 }}
              whileTap={{ scale: 0.95 }}
              className="relative p-2 bg-gradient-to-tr from-[#FF6B2B] to-[#FF884D] rounded-xl shadow-lg shadow-[#FF6B2B]/25 flex items-center justify-center"
            >
              <Sparkles className="w-4 h-4 text-white" />
            </motion.div>
            <div className="flex items-center gap-2">
              <span className="text-white font-extrabold text-base sm:text-lg tracking-tight font-display">
                Text<span className="text-[#FF6B2B]">Extract</span>
              </span>
              <span className="hidden xs:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FF6B2B]/15 text-[#FF884D] border border-[#FF6B2B]/30 tracking-wider uppercase">
                AI Pro
              </span>
            </div>
          </div>

          {/* Right Status Indicators */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-slate-300 font-medium hidden sm:inline">Engine Active</span>
              <span className="text-[10px] font-mono font-bold text-slate-400 bg-white/[0.06] px-1.5 py-0.5 rounded">
                {totalKeys} Keys
              </span>
            </div>

            <div className="hidden md:flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/[0.03] text-slate-400 text-xs border border-white/[0.05]">
              <Layers className="w-3.5 h-3.5 text-slate-400" />
              <span>Universal OCR & Math</span>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
