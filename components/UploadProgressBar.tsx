import React from 'react';
import { FileText, Loader2, CheckCircle2, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';

export interface UploadProgressData {
  fileName: string;
  fileSize?: number;
  current: number;
  total: number;
  percentage: number;
  statusText: string;
}

interface UploadProgressBarProps {
  progress: UploadProgressData;
}

const formatFileSize = (bytes?: number) => {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb < 1 ? `${(bytes / 1024).toFixed(1)} KB` : `${mb.toFixed(2)} MB`;
};

const UploadProgressBar: React.FC<UploadProgressBarProps> = ({ progress }) => {
  const isDone = progress.percentage >= 100;

  return (
    <motion.div 
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-[94%] max-w-2xl"
    >
      <div className="glass-panel p-4 sm:p-5 rounded-2xl shadow-2xl border-white/[0.15] bg-[#11141F]/95 backdrop-blur-2xl relative overflow-hidden ring-1 ring-[#FF6B2B]/30">
        {/* Background Ambient Glow */}
        <div className="absolute -top-12 -right-12 w-32 h-32 bg-[#FF6B2B]/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-12 -left-12 w-32 h-32 bg-blue-500/15 rounded-full blur-3xl pointer-events-none" />

        {/* Top File Meta & Status */}
        <div className="flex items-start justify-between gap-3 mb-2.5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#FF6B2B]/15 border border-[#FF6B2B]/30 flex items-center justify-center text-[#FF884D] flex-shrink-0 shadow-sm">
              {isDone ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              ) : (
                <FileText className="w-5 h-5 animate-pulse text-[#FF6B2B]" />
              )}
            </div>
            <div className="min-w-0">
              <h4 className="text-xs sm:text-sm font-bold text-white truncate font-display">
                {progress.fileName || "Processing Document..."}
              </h4>
              <p className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                {progress.fileSize ? <span>{formatFileSize(progress.fileSize)}</span> : null}
                {progress.total > 0 && (
                  <>
                    <span className="text-slate-600">•</span>
                    <span className="text-slate-300 font-mono font-medium">
                      Page {progress.current} of {progress.total}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Percentage Pill */}
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border shadow-inner flex-shrink-0 transition-all ${
            isDone 
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' 
              : 'bg-[#FF6B2B]/10 border-[#FF6B2B]/30 text-[#FF884D]'
          }`}>
            {!isDone && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {isDone && <Sparkles className="w-3.5 h-3.5" />}
            <span className="text-xs font-mono font-bold">
              {progress.percentage}%
            </span>
          </div>
        </div>

        {/* Progress Bar Track */}
        <div className="relative w-full h-2.5 bg-white/[0.08] rounded-full overflow-hidden p-0.5 border border-white/[0.08]">
          <motion.div 
            className={`h-full rounded-full relative shadow-md transition-all ${
              isDone 
                ? 'bg-gradient-to-r from-emerald-500 to-teal-400 shadow-emerald-500/30' 
                : 'bg-gradient-to-r from-[#FF6B2B] via-[#FF884D] to-amber-300 shadow-[#FF6B2B]/40'
            }`}
            initial={{ width: '0%' }}
            animate={{ width: `${Math.max(5, progress.percentage)}%` }}
            transition={{ ease: "easeOut", duration: 0.2 }}
          >
            {/* Animated Shimmer Stripe */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-[shimmer_2s_infinite] bg-[length:200%_100%]" />
          </motion.div>
        </div>

        {/* Bottom Status Caption */}
        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
          <span className="truncate pr-2 font-medium flex items-center gap-1.5">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${isDone ? 'bg-emerald-400' : 'bg-[#FF6B2B] animate-ping'}`} />
            {progress.statusText || "Rendering high-resolution pages..."}
          </span>
          <span className="text-slate-500 font-mono text-[10px] flex-shrink-0 uppercase tracking-wider">
            {isDone ? "Ready" : "Rendering"}
          </span>
        </div>
      </div>
    </motion.div>
  );
};

export default UploadProgressBar;
