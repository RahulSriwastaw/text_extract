import React, { useEffect, useState } from 'react';
import { Languages, HardDrive, Trash2 } from 'lucide-react';
import { getAiSettings, saveAiSettings, clearAllAiHistory, getAllConversations, AiSettings } from '../services/aiDbService';

const LANGUAGES = ['Hindi', 'English', 'Hinglish'] as const;

/** Explanation language + local AI history. Shown in the profile card and the settings modal. */
const AiPreferences: React.FC = () => {
  const [language, setLanguage] = useState<AiSettings['preferredLanguage'] | null>(null);
  const [conversations, setConversations] = useState(0);
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLanguage((await getAiSettings()).preferredLanguage);
    setConversations((await getAllConversations().catch(() => [])).length);
  };
  useEffect(() => { load(); }, []);

  const flash = (text: string) => { setNotice(text); setTimeout(() => setNotice(''), 2000); };

  const chooseLanguage = async (lang: AiSettings['preferredLanguage']) => {
    await saveAiSettings({ preferredLanguage: lang });
    setLanguage(lang);
    flash(`Explanation language: ${lang}`);
  };

  const deleteHistory = async () => {
    if (!confirm('Permanently delete all AI explanations stored in this browser? This cannot be undone.')) return;
    await clearAllAiHistory();
    await load();
    flash('All local AI history deleted.');
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="flex items-center gap-1.5 text-xs font-bold text-ink mb-1.5">
          <Languages className="w-3.5 h-3.5 text-accent-light" /> Explanation language
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {LANGUAGES.map(lang => (
            <button key={lang} type="button" onClick={() => chooseLanguage(lang)} aria-pressed={language === lang}
              className={`py-1.5 rounded-lg text-xs font-bold transition-all border ${
                language === lang
                  ? 'bg-surface-3 text-ink border-transparent shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]'
                  : 'bg-white/[0.03] border-white/[0.06] text-ink-3 hover:text-ink'
              }`}>
              {lang}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="flex items-center justify-between text-xs font-bold text-ink mb-1">
          <span className="flex items-center gap-1.5"><HardDrive className="w-3.5 h-3.5 text-blue-400" /> AI history on this device</span>
          <span className="text-[11px] text-ink-2">{conversations} questions</span>
        </p>
        <p className="text-[11px] text-ink-3 leading-relaxed mb-2">AI explanations are saved only in this browser. They do not sync to other devices.</p>
        <button type="button" onClick={deleteHistory} disabled={conversations === 0}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-white/[0.03] hover:bg-rose-500/10 text-ink-3 hover:text-rose-300 border border-white/[0.06] hover:border-rose-500/20 rounded-lg text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed">
          <Trash2 className="w-3.5 h-3.5" /> Delete all AI history
        </button>
      </div>

      {notice && <p role="status" className="text-[11px] text-emerald-300 text-center">{notice}</p>}
    </div>
  );
};

export default AiPreferences;
