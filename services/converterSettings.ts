import { useEffect, useRef, useState } from 'react';
import { doc, getFirestore, onSnapshot, setDoc } from 'firebase/firestore';
import { NumberingStyle, OptionArrangement } from '../types';
import type { AiProvider } from './studyAiBridgeService';
import type { FigureMode } from '../types';

const defaults = {
  autoDownload: true, numberingStyle: NumberingStyle.HASH, isBilingual: false,
  includeImages: false, figureMode: 'crop' as FigureMode, optionArrangement: OptionArrangement.VERTICAL, mcqMode: false,
  showMcqNumbers: true, showAnswers: true, refineMode: false, autoProofread: false,
  aiEngine: 'extension' as 'extension' | 'api', provider: 'claude' as AiProvider,
};
type Settings = typeof defaults;
type Cache = { values: Settings; pending: Partial<Settings> };

export function useConverterSettings(uid: string) {
  const key = 'converter-preferences:' + uid;
  const [initial] = useState<Cache>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      return { values: { ...defaults, ...saved.values }, pending: saved.pending || {} };
    } catch {
      return { values: { ...defaults }, pending: {} };
    }
  });
  const cache = useRef(initial);
  const [values, setValues] = useState(initial.values);
  const [error, setError] = useState('');
  const reference = () => doc(getFirestore(), 'users', uid, 'preferences', 'converter');
  function persist() {
    try { localStorage.setItem(key, JSON.stringify(cache.current)); }
    catch { setError('Browser storage is unavailable.'); }
  }
  function sync(patch: Partial<Settings>) {
    if (!Object.keys(patch).length) return;
    void setDoc(reference(), patch, { merge: true }).then(() => {
      for (const field of Object.keys(patch) as (keyof Settings)[]) {
        if (cache.current.pending[field] === patch[field]) delete cache.current.pending[field];
      }
      persist();
      setError('');
    }).catch(() => setError('Account sync unavailable. Settings are kept on this device.'));
  }
  useEffect(() => {
    sync({ ...cache.current.pending });
    return onSnapshot(reference(), snapshot => {
      if (!snapshot.exists() || snapshot.metadata.hasPendingWrites) return;
      cache.current.values = { ...defaults, ...snapshot.data(), ...cache.current.pending };
      setValues(cache.current.values);
      persist();
    }, () => setError('Account sync unavailable. Settings are kept on this device.'));
  }, [uid]);
  function update<K extends keyof Settings>(field: K, value: Settings[K]) {
    cache.current.values = { ...cache.current.values, [field]: value };
    cache.current.pending[field] = value;
    setValues(cache.current.values);
    persist();
    sync({ [field]: value });
  }
  return [values, update, error] as const;
}
