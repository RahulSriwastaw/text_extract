import React, { useEffect, useState } from 'react';
import type { DirectModel } from '../services/claudeModels';
import type { ModelProvider } from '../services/modelAccess';
import { apiFetch } from '../services/apiClient';

type Model = { id: string; name: string; disabled: boolean };
/** What /api/models returns: per provider, only the models the admin has switched on. */
type Catalog = { claude: Model[]; gemini: Model[]; defaults: Partial<Record<ModelProvider, string>> };

const PREFIX: Record<ModelProvider, string> = { claude: 'anthropic:', gemini: 'gemini:' };
const PROVIDER_LABEL: Record<ModelProvider, string> = { claude: 'Claude API', gemini: 'Gemini API' };

// Every picker on the page shares one request. A picker opened more than a minute later
// reads the list again, so an admin's change shows up without reloading the app.
let shared: { at: number; promise: Promise<Catalog> } | null = null;
function loadCatalog(): Promise<Catalog> {
  if (shared && Date.now() - shared.at < 60_000) return shared.promise;
  const promise = apiFetch('/api/models').then(async response => {
    if (!response.ok) throw new Error('Model list unavailable');
    return response.json() as Promise<Catalog>;
  });
  shared = { at: Date.now(), promise };
  promise.catch(() => { if (shared?.promise === promise) shared = null; });
  return promise;
}

export function ClaudeModelSelect({ value, onChange }: { value: DirectModel; onChange: (value: DirectModel) => void }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [status, setStatus] = useState('Loading models…');
  useEffect(() => {
    let active = true;
    loadCatalog()
      .then(data => { if (active) { setCatalog(data); setStatus(''); } })
      .catch(() => { if (active) setStatus('Model list unavailable. Try again in a minute.'); });
    return () => { active = false; };
  }, []);

  const provider: ModelProvider = value.startsWith('gemini:') ? 'gemini' : 'claude';
  const usable = (p: ModelProvider) => (catalog?.[p] || []).filter(m => !m.disabled);
  /** The model a provider opens with: the admin's default, else its first active model. */
  const first = (p: ModelProvider): DirectModel | undefined => {
    const list = usable(p);
    const id = list.find(m => m.id === catalog?.defaults[p])?.id || list[0]?.id;
    return id ? (PREFIX[p] + id) as DirectModel : undefined;
  };
  const valid = usable(provider).some(m => PREFIX[provider] + m.id === value);

  // A saved model that is no longer on offer (switched off by the admin, or an old name)
  // moves to the default active model, so the picker never shows something that cannot run.
  useEffect(() => {
    if (!catalog || valid) return;
    const next = first(provider) || first(provider === 'claude' ? 'gemini' : 'claude');
    if (next && next !== value) onChange(next);
  }, [catalog, valid, value]);

  const providers = catalog ? (['claude', 'gemini'] as const).filter(p => usable(p).length) : [provider];
  const models = catalog?.[provider] || [];
  return <div className="inline-flex flex-wrap items-center gap-2 text-xs text-ink-2">
    <select className="select" aria-label="API provider" value={provider} disabled={providers.length < 2}
      onChange={e => { const next = first(e.target.value as ModelProvider); if (next) onChange(next); }}>
      {providers.map(p => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
    </select>
    <select className="select" aria-label="API model" value={value} onChange={e => onChange(e.target.value as DirectModel)}>
      {!valid && <option value={value}>{catalog ? 'Choose a model' : value.replace(/^(gemini|anthropic):/, '')}</option>}
      {models.map(m => <option key={m.id} value={PREFIX[provider] + m.id} disabled={m.disabled}>{m.name} · {m.id}{m.disabled ? ' (unsupported for extraction)' : ''}</option>)}
    </select>
    {status && <span role="status">{status}</span>}
    {catalog && !providers.length && <span role="status">No AI model is switched on. Ask the admin.</span>}
  </div>;
}
