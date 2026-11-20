import { createHash } from 'node:crypto';
import { claudeModels, type ClaudeModel } from '../services/claudeModels.js';

// Account catalogs can differ. Resolve the actual API ID from the account's model list.
const cache = new Map<string, { until: number; models: Map<string, string> }>();
export async function resolveClaudeModel(label: ClaudeModel, key: string, signal?: AbortSignal) {
  if (!claudeModels.includes(label)) throw new Error('Unknown Claude model selection.');
  const account = createHash('sha256').update(key).digest('hex');
  let entry = cache.get(account);
  if (!entry || entry.until <= Date.now()) {
    const models = new Map<string, string>();
    const url = new URL('https://api.anthropic.com/v1/models?limit=100');
    while (true) {
      const response = await fetch(url, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal });
      if (!response.ok) throw new Error(`Cannot check Claude models for this API key (HTTP ${response.status}).`);
      const page = await response.json();
      for (const model of page.data) {
        const name = String(model.display_name).replace(/^Claude\s+/i, '').trim().toLowerCase();
        if (!models.has(name)) models.set(name, model.id);
        // E.g. "Claude 3 Opus" is displayed as "Opus 3" in the web picker.
        const reverse = name.match(/^(\d+(?:\.\d+)?)\s+(opus|sonnet|haiku|fable)$/);
        if (reverse) models.set(reverse[2] + ' ' + reverse[1], model.id);
      }
      if (!page.has_more || !page.last_id || url.searchParams.get('after_id') === page.last_id) break;
      url.searchParams.set('after_id', page.last_id);
    }
    entry = { until: Date.now() + 300000, models };
    cache.set(account, entry);
  }
  const id = entry.models.get(label.toLowerCase());
  if (!id) throw new Error(`${label} is unavailable for this API key. Select another model or use Claude Bridge.`);
  return id;
}
