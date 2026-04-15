import React, { useState } from 'react';
import { X, Key, Plus, Trash2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKeys: string[];
  setApiKeys: (keys: string[]) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, apiKeys, setApiKeys }) => {
  const [newKey, setNewKey] = useState('');

  const handleAdd = () => {
    const trimmed = newKey.trim();
    if (trimmed && !apiKeys.includes(trimmed)) {
      setApiKeys([...apiKeys, trimmed]);
      setNewKey('');
    }
  };

  const handleRemove = (keyToRemove: string) => {
    setApiKeys(apiKeys.filter(k => k !== keyToRemove));
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-50"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white rounded-2xl shadow-2xl z-50 overflow-hidden border border-slate-200"
          >
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2 text-slate-800">
                <Key className="w-5 h-5 text-orange-500" />
                <h2 className="font-bold text-lg">API Settings</h2>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="bg-blue-50 text-blue-800 p-3 rounded-xl text-xs flex gap-2 items-start border border-blue-100">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-blue-600" />
                <p>
                  <strong>Parallel Processing:</strong> Add multiple Gemini API keys to process multiple pages simultaneously. 
                  If you add 10 keys, the app will process 10 pages at the exact same time, drastically reducing wait times!
                </p>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-bold text-slate-700">Add Gemini API Key</label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                    placeholder="AIzaSy..."
                    className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all text-sm"
                  />
                  <button
                    onClick={handleAdd}
                    disabled={!newKey.trim()}
                    className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-bold hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" />
                    Add
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-slate-700">Active Keys ({apiKeys.length})</label>
                  {apiKeys.length === 0 && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full">Using Default System Key</span>
                  )}
                </div>
                
                <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                  {apiKeys.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 text-sm border-2 border-dashed border-slate-100 rounded-xl">
                      No custom keys added.<br/>The app will process 1 page at a time.
                    </div>
                  ) : (
                    apiKeys.map((key, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-lg group">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded bg-orange-100 text-orange-600 flex items-center justify-center text-xs font-bold">
                            {idx + 1}
                          </div>
                          <span className="text-sm text-slate-600 font-mono">
                            {key.substring(0, 8)}...{key.substring(key.length - 4)}
                          </span>
                        </div>
                        <button
                          onClick={() => handleRemove(key)}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
            
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                onClick={onClose}
                className="px-6 py-2 bg-slate-900 text-white rounded-lg text-sm font-bold hover:bg-slate-800 transition-colors"
              >
                Done
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default SettingsModal;
