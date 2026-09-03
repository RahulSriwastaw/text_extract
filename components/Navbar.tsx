import React from 'react';
import { Wand2 } from 'lucide-react';
import { motion } from 'motion/react';

const Navbar: React.FC = () => {
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
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
