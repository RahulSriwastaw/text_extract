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
        className={`relative group border-2 border-dashed rounded-2xl p-6 md:p-8 text-center transition-all duration-300 ease-in-out ${
          isDragActive 
            ? 'border-slate-500 bg-slate-50/50 scale-[1.01] shadow-xl shadow-slate-500/10' 
            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50'
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
        <label htmlFor="fileInput" className="cursor-pointer flex flex-col items-center gap-3 md:gap-4">
          <div className={`w-12 h-12 md:w-14 md:h-14 rounded-xl flex items-center justify-center transition-all duration-300 ${
            isDragActive ? 'bg-slate-800 text-white scale-110' : 'bg-slate-100 text-slate-400 group-hover:bg-slate-200 group-hover:text-slate-600'
          }`}>
            <Upload className="w-6 h-6 md:w-7 md:h-7" />
          </div>
          
          <div className="space-y-1">
            <h3 className="text-lg md:text-xl font-semibold text-slate-900 tracking-tight">
              Drop your documents here
            </h3>
            <p className="text-slate-500 text-sm md:text-base">
              or <span className="text-slate-800 font-medium hover:underline">browse your files</span>
            </p>
            <p className="text-slate-400 text-xs mt-2">
              You can also press <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded-md text-slate-600 font-mono text-[10px]">Ctrl+V</kbd> / <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded-md text-slate-600 font-mono text-[10px]">Cmd+V</kbd> to paste images
            </p>
          </div>

          <div className="flex items-center gap-3 pt-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 rounded-md text-xs font-medium text-slate-600">
              <FileText className="w-3.5 h-3.5" />
              PDF
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 rounded-md text-xs font-medium text-slate-600">
              <ImageIcon className="w-3.5 h-3.5" />
              Images
            </div>
            <div className="text-xs text-slate-400 font-medium">
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
              className="absolute inset-0 bg-slate-500/5 rounded-2xl pointer-events-none border-4 border-slate-500/20"
            />
          )}
        </AnimatePresence>
        
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm font-medium"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      
      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { title: 'Hindi & English', desc: 'Full support for bilingual papers' },
          { title: 'Math Formulas', desc: 'Accurate LaTeX conversion' },
          { title: 'Editable Word', desc: 'Download as professional DOCX' }
        ].map((feature, i) => (
          <div key={i} className="p-3 rounded-xl bg-white border border-slate-100 shadow-sm flex flex-col justify-center">
            <h4 className="font-semibold text-slate-800 text-sm">{feature.title}</h4>
            <p className="text-slate-500 text-xs mt-0.5">{feature.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FileUploader;
