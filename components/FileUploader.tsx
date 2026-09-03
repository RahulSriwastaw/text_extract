import React, { useCallback, useState } from 'react';
import { Upload, FileText, Image as ImageIcon, Sparkles, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface FileUploaderProps {
  onFilesSelected: (files: FileList | File[] | null) => void;
  isLoading: boolean;
}

const FileUploader: React.FC<FileUploaderProps> = ({ onFilesSelected, isLoading }) => {
  const [isDragActive, setIsDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateFiles = (files: FileList | File[]): boolean => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const filesArray = Array.from(files);
    for (const file of filesArray) {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const isAllowedExt = ['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(ext);
      
      if (!allowedTypes.includes(file.type) && !isAllowedExt) {
        setError(`Invalid file type: ${file.name}. Only PDF and images (JPG, PNG, WEBP) are supported.`);
        return false;
      }
    }
    setError(null);
    return true;
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);
    if (isLoading) return;
    const files = e.dataTransfer.files;
    if (files && validateFiles(files)) {
      onFilesSelected(files);
    }
  }, [isLoading, onFilesSelected]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isLoading) return;
    const files = e.target.files;
    if (files && validateFiles(files)) {
      onFilesSelected(files);
    }
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (isLoading) return;
    const items = e.clipboardData.items;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const file = items[i].getAsFile();
      if (file) {
        files.push(file);
      }
    }
    if (files.length > 0) {
      if (validateFiles(files)) {
        onFilesSelected(files);
      }
    }
  }, [isLoading, onFilesSelected]);

  return (
    <div className="w-full max-w-3xl mx-auto" onPaste={handlePaste}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`relative group border-2 border-dashed rounded-3xl p-6 sm:p-10 text-center transition-all duration-300 ease-in-out ${
          isDragActive 
            ? 'border-[#FF6B2B] bg-[#FF6B2B]/10 scale-[1.01] shadow-2xl shadow-[#FF6B2B]/20' 
            : 'border-white/[0.12] bg-[#11141F]/80 backdrop-blur-xl hover:border-[#FF6B2B]/60 hover:bg-[#141824]'
        } ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <input
          type="file"
          id="fileInput"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          multiple
          onChange={handleChange}
          disabled={isLoading}
        />
        <label htmlFor="fileInput" className="cursor-pointer flex flex-col items-center gap-4">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-300 shadow-xl ${
            isDragActive 
              ? 'bg-gradient-to-tr from-[#FF6B2B] to-[#FF884D] text-white scale-110 shadow-[#FF6B2B]/40' 
              : 'bg-white/[0.05] border border-white/[0.08] text-slate-400 group-hover:text-white group-hover:bg-[#FF6B2B]/15 group-hover:border-[#FF6B2B]/30'
          }`}>
            <Upload className="w-7 h-7" />
          </div>
          
          <div className="space-y-1.5">
            <h3 className="text-lg sm:text-xl font-bold text-white font-display tracking-tight">
              Drop your documents or exam papers here
            </h3>
            <p className="text-slate-400 text-xs sm:text-sm">
              or <span className="text-[#FF884D] font-semibold underline decoration-[#FF6B2B]/50 underline-offset-4 hover:text-[#FF6B2B]">browse your device</span>
            </p>
            <p className="text-slate-500 text-xs pt-1 flex items-center justify-center gap-1.5">
              <span>Paste directly using</span> 
              <kbd className="px-2 py-0.5 bg-white/[0.06] border border-white/[0.1] rounded-md text-slate-300 font-mono text-[10px] shadow-sm">Ctrl+V</kbd> / <kbd className="px-2 py-0.5 bg-white/[0.06] border border-white/[0.1] rounded-md text-slate-300 font-mono text-[10px] shadow-sm">Cmd+V</kbd>
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] border border-white/[0.06] rounded-xl text-xs font-semibold text-slate-300">
              <FileText className="w-3.5 h-3.5 text-blue-400" />
              PDF Documents
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] border border-white/[0.06] rounded-xl text-xs font-semibold text-slate-300">
              <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
              Scanned Images (JPG, PNG)
            </div>
            <div className="text-xs text-slate-500 font-medium px-2 py-1">
              Max 50MB
            </div>
          </div>
        </label>

        <AnimatePresence>
          {isDragActive && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-[#FF6B2B]/10 rounded-3xl pointer-events-none border-2 border-[#FF6B2B]"
            />
          )}
        </AnimatePresence>
        
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-4 p-3 bg-rose-500/15 border border-rose-500/30 text-rose-300 rounded-xl text-xs flex items-center justify-center gap-2"
            >
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>{error}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

export default FileUploader;
