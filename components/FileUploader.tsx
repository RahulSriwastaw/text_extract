import React, { useCallback, useState } from 'react';
import { Upload, FileText, Image as ImageIcon, AlertCircle } from 'lucide-react';
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
    <div className="w-full" onPaste={handlePaste}>
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`relative border border-dashed rounded-[14px] px-6 py-12 text-center transition-colors ${
          isDragActive
            ? 'border-accent bg-accent/[0.06]'
            : 'border-line-strong bg-surface hover:border-accent/50 hover:bg-surface-2'
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
          <span className={`w-14 h-14 rounded-xl flex items-center justify-center border transition-colors ${
            isDragActive ? 'bg-accent text-on-accent border-accent' : 'bg-accent/10 border-accent/25 text-accent-light'
          }`}>
            <Upload className="w-6 h-6" />
          </span>

          <span className="space-y-1.5">
            <span className="block text-lg font-semibold text-ink font-display">
              {isDragActive ? 'Drop to upload' : 'Drop a PDF or scanned pages here'}
            </span>
            <span className="block text-sm text-ink-3">
              or <span className="text-accent-light font-semibold underline decoration-accent/40 underline-offset-4">browse your device</span>
              <span className="hidden sm:inline"> · paste with <kbd className="px-1.5 py-0.5 bg-surface-3 border border-line-strong rounded text-ink-2 font-mono text-[11px]">Ctrl</kbd> + <kbd className="px-1.5 py-0.5 bg-surface-3 border border-line-strong rounded text-ink-2 font-mono text-[11px]">V</kbd></span>
            </span>
          </span>

          <span className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <span className="badge badge-neutral"><FileText />PDF</span>
            <span className="badge badge-neutral"><ImageIcon />JPG, PNG, WEBP</span>
            <span className="text-xs text-ink-3">Up to 50 MB</span>
          </span>

          <span className="btn btn-primary mt-1">
            <Upload />
            Choose files
          </span>
        </label>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="callout callout-danger items-center justify-center mt-5 max-w-lg mx-auto"
              role="alert"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default FileUploader;
