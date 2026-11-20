import { defaultClaudeModel, type DirectModel } from './claudeModels';
import { useEffect, useRef, useState } from 'react';
import { doc, getFirestore, onSnapshot, setDoc } from 'firebase/firestore';
import { NumberingStyle, OptionArrangement } from '../types';
import type { AiProvider } from './studyAiBridgeService';
import type { DifficultyLevel, FigureMode } from '../types';

const defaults = {
  claudeModel: defaultClaudeModel as DirectModel,
  autoDownload: true, numberingStyle: NumberingStyle.HASH, isBilingual: false,
  includeImages: false, figureMode: 'crop' as FigureMode, optionArrangement: OptionArrangement.VERTICAL, mcqMode: false,
  showMcqNumbers: true, showAnswers: true, refineMode: false, autoProofread: false,
  aiEngine: 'extension' as 'extension' | 'api', provider: 'claude' as AiProvider,
};
const mcqDefaults = {
  claudeModel: defaultClaudeModel as DirectModel,
  figureMode: 'off' as 'off' | FigureMode,
  aiEngine: 'bridge' as 'bridge' | 'api', selectedProvider: 'claude' as AiProvider,
  pagesPerRequest: 1, batchSize: 3, extractionMode: 'exact' as 'exact' | 'similar',
  autoDeepSolveAll: true, answerFormat: 'letters' as 'letters' | 'numbers',
  mathFormat: 'mathjax' as 'mathjax' | 'unicode', difficulty: 'medium' as DifficultyLevel,
};
type Cache<T> = { values: T; pending: Partial<T> };

export function useConverterSettings(uid: string) {
  return useAccountPreferences(uid, 'converter', defaults);
}

export function useMcqSettings(uid: string) {
  return useAccountPreferences(uid, 'mcq', mcqDefaults, readLegacyMcqSettings);
}

function readLegacyMcqSettings(): Partial<typeof mcqDefaults> {
  const count = Number(localStorage.getItem('study_ai_pages_per_request'));
  const provider = localStorage.getItem('study_ai_provider');
  return {
    ...([1, 2, 3, 5].includes(count) && { pagesPerRequest: count }),
    ...(['claude', 'deepseek', 'chatgpt'].includes(provider) && { selectedProvider: provider as AiProvider }),
  };
}

function useAccountPreferences<Settings extends object>(uid: string, tool: string, defaults: Settings, readLegacy?: () => Partial<Settings>) {
  const key = tool + '-preferences:' + uid;
  const [initial] = useState<Cache<Settings>>(() => {
    try {
      const existing = localStorage.getItem(key);
      const saved = JSON.parse(existing || '{}');
      if (!existing && readLegacy && !localStorage.getItem('mcq-legacy-preferences-owner')) {
        const legacy = readLegacy();
        return { values: { ...defaults, ...legacy }, pending: legacy };
      }
      return { values: { ...defaults, ...saved.values }, pending: saved.pending || {} };
    } catch {
      return { values: { ...defaults }, pending: {} };
    }
  });
  const cache = useRef(initial);
  const mounted = useRef(true);
  const [values, setValues] = useState(initial.values);
  const [error, setError] = useState('');
  const reference = () => doc(getFirestore(), 'users', uid, 'preferences', tool);
  function persist() {
    try { localStorage.setItem(key, JSON.stringify(cache.current)); }
    catch { setError('Browser storage is unavailable.'); }
  }
  function sync(patch: Partial<Settings>) {
    if (!Object.keys(patch).length) return;
    void setDoc(reference(), patch, { merge: true }).then(() => {
      if (!mounted.current) return;
      for (const field of Object.keys(patch) as (keyof Settings)[]) {
        if (cache.current.pending[field] === patch[field]) delete cache.current.pending[field];
      }
      persist();
      setError('');
    }).catch(() => setError('Account sync unavailable. Settings are kept on this device.'));
  }
  useEffect(() => {
    mounted.current = true;
    if (tool === 'mcq') {
      persist();
      try {
        if (!localStorage.getItem('mcq-legacy-preferences-owner')) localStorage.setItem('mcq-legacy-preferences-owner', uid);
      } catch { setError('Browser storage is unavailable.'); }
    }
    sync({ ...cache.current.pending });
    const unsubscribe = onSnapshot(reference(), snapshot => {
      if (!snapshot.exists() || snapshot.metadata.hasPendingWrites) return;
      cache.current.values = { ...defaults, ...snapshot.data(), ...cache.current.pending };
      setValues(cache.current.values);
      persist();
    }, () => setError('Account sync unavailable. Settings are kept on this device.'));
    return () => { mounted.current = false; unsubscribe(); };
  }, [uid, tool]);
  function update<K extends keyof Settings>(field: K, value: Settings[K]) {
    cache.current.values = { ...cache.current.values, [field]: value };
    cache.current.pending[field] = value;
    setValues(cache.current.values);
    persist();
    const patch: Partial<Settings> = {};
    patch[field] = value;
    sync(patch);
  }
  return [values, update, error] as const;
}
