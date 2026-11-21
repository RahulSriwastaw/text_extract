import React, { useEffect, useState } from 'react';
import { defaultClaudeModel, type DirectModel } from '../services/claudeModels';
import { getAiSettings } from '../services/aiDbService';
import { apiFetch } from '../services/apiClient';

type Model = { id: string; name: string; disabled: boolean };

export function ClaudeModelSelect({ value, onChange }: { value: DirectModel; onChange: (value: DirectModel) => void }) {
  const provider = value.startsWith('gemini:') ? 'gemini' : 'claude';
  const prefix = provider === 'gemini' ? 'gemini:' : 'anthropic:';
  const [models, setModels] = useState<Model[]>([]);
  const [status, setStatus] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setModels([]);
    setStatus('Loading models…');
    (async () => {
      const { apiKey } = await getAiSettings();
      const response = await apiFetch('/api/models/' + provider, {
        headers: apiKey ? { 'x-user-key': apiKey.trim() } : {}, signal: controller.signal,
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!controller.signal.aborted) {
        setModels(data.models);
        setStatus('');
      }
    })().catch(() => { if (!controller.signal.aborted) setStatus('Model list unavailable. Check API settings.'); });
    return () => controller.abort();
  }, [provider]);
  return <div className="inline-flex flex-wrap items-center gap-2 text-xs text-ink-2">
    <select className="select" aria-label="API provider" value={provider} onChange={e => onChange(e.target.value === 'gemini' ? 'gemini:gemini-2.5-flash' : defaultClaudeModel)}>
      <option value="claude">Claude API</option><option value="gemini">Gemini API</option>
    </select>
    <select className="select" aria-label="API model" value={value} onChange={e => onChange(e.target.value as DirectModel)}>
      {!models.some(m => prefix + m.id === value) && <option value={value}>{value.replace(/^(gemini|anthropic):/, '')}</option>}
      {models.map(m => <option key={m.id} value={prefix + m.id} disabled={m.disabled}>{m.name} · {m.id}{m.disabled ? ' (unsupported for extraction)' : ''}</option>)}
    </select>
    {status && <span role="status">{status}</span>}
  </div>;
}
