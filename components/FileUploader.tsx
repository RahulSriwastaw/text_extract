import React, { useCallback, useState } from 'react';
import { Upload, FileText, Image as ImageIcon, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface FileUploaderProps {
  onFilesSelected: (files: FileList | null) => void;
  isLoading: boolean;
}

const FileUploader: React.FC<FileUploaderProps> = ({ onFilesSelected, isLoading }) => {
  const [isDragActive, setIsDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateFiles = (files: FileList | File[]): boolean => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    const filesArray = Array.from(files);
    for (const file of filesArray) {
      if (!allowedTypes.includes(file.type)) {
        setError(`Invalid file type: ${file.name}. Only PDF and images (JPG, PNG) are allowed.`);
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
        const dataTransfer = new DataTransfer();
        files.forEach(file => dataTransfer.items.add(file));
        onFilesSelected(dataTransfer.files);
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
        className={`relative group border-2 border-dashed rounded-[8px] p-3 md:p-3 text-center transition-all duration-300 ease-in-out ${
          isDragActive 
            ? 'border-slate-500 bg-[#111111]/50 scale-[1.01]  -slate-500/10' 
            : 'border-[#252525] bg-[#1A1A1A] hover:border-[#252525] hover:bg-[#111111]/50'
        } ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <input
          type="file"
          id="fileInput"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png"
          multiple
          onChange={handleChange}
          disabled={isLoading}
        />
        <label htmlFor="fileInput" className="cursor-pointer flex flex-col items-center gap-3 md:gap-3">
          <div className={`w-12 h-12 md:w-14 md:h-14 rounded-[8px] flex items-center justify-center transition-all duration-300 ${
            isDragActive ? 'bg-[#141414] text-white scale-110' : 'bg-[#141414] text-[#555555] group-hover:bg-[#2A2A2A] group-hover:text-[#EFEFEF]'
          }`}>
            <Upload className="w-6 h-6 md:w-7 md:h-7" />
          </div>
          
          <div className="space-y-1">
            <h3 className="text-[16px] md:text-[18px] font-semibold text-[#EFEFEF] tracking-tight">
              Drop your documents here
            </h3>
            <p className="text-[#555555] text-[13px] md:text-[14px]">
              or <span className="text-[#EFEFEF] font-medium hover:underline">browse your files</span>
            </p>
            <p className="text-[#555555] text-[11px] mt-2">
              You can also press <kbd className="px-1.5 py-0.5 bg-[#141414] border border-[#252525] rounded-[6px] text-[#EFEFEF] font-mono text-[10px]">Ctrl+V</kbd> / <kbd className="px-1.5 py-0.5 bg-[#141414] border border-[#252525] rounded-[6px] text-[#EFEFEF] font-mono text-[10px]">Cmd+V</kbd> to paste images
            </p>
          </div>

          <div className="flex items-center gap-3 pt-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#141414] rounded-[6px] text-[11px] font-medium text-[#EFEFEF]">
              <FileText className="w-3.5 h-3.5" />
              PDF
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#141414] rounded-[6px] text-[11px] font-medium text-[#EFEFEF]">
              <ImageIcon className="w-3.5 h-3.5" />
              Images
            </div>
            <div className="text-[11px] text-[#555555] font-medium">
              Max 50MB per file
            </div>
          </div>
        </label>

        <AnimatePresence>
          {isDragActive && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-[#111111]0/5 rounded-[8px] pointer-events-none border-4 border-slate-500/20"
            />
          )}
        </AnimatePresence>
        
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-4 p-3 bg-red-50 text-red-700 rounded-[8px] text-[13px] font-medium"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      
      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { title: 'Hindi & English', desc: 'Full support for bilingual papers' },
          { title: 'Math Formulas', desc: 'Accurate LaTeX conversion' },
          { title: 'Editable Word', desc: 'Download as professional DOCX' }
        ].map((feature, i) => (
          <div key={i} className="p-3 rounded-[8px] bg-[#1A1A1A] border border-[#252525]  flex flex-col justify-center">
            <h4 className="font-semibold text-[#EFEFEF] text-[13px]">{feature.title}</h4>
            <p className="text-[#555555] text-[11px] mt-0.5">{feature.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FileUploader;
