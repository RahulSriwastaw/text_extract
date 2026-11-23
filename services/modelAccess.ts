/**
 * Which AI models users may pick.
 *
 * The admin switches models on and off in the admin panel (Models tab). Users see only the
 * active ones, and the server refuses to run anything else. Until the admin saves a choice,
 * the built-in rule applies: every model except the costly Opus / Fable families.
 *
 * Pure functions, shared by the server (enforcement), the model picker and the tests.
 */
export type ModelProvider = 'claude' | 'gemini';
export const MODEL_PROVIDERS: ModelProvider[] = ['claude', 'gemini'];

/** The admin's choice: the model ids switched on per provider, and the one used by default. */
export interface ModelAccess {
  claude: string[];
  gemini: string[];
  defaultClaude?: string;
  defaultGemini?: string;
}

/** Families that cost several times more per token; off unless the admin turns them on. */
export const isCostlyModel = (id?: string) => /opus|fable/i.test(id || '');

const MODEL_ID = /^[a-zA-Z0-9._-]{1,80}$/;
const DEFAULT_KEY = { claude: 'defaultClaude', gemini: 'defaultGemini' } as const;

/** Untrusted input (the admin form, or the stored setting) → a clean ModelAccess, or null if it is not one. */
export function sanitizeModelAccess(input: unknown): ModelAccess | null {
  if (!input || typeof input !== 'object') return null;
  const s = input as Record<string, unknown>;
  if (!Array.isArray(s.claude) && !Array.isArray(s.gemini)) return null;
  const ids = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).filter((id): id is string => typeof id === 'string' && MODEL_ID.test(id)))].slice(0, 200);
  const access: ModelAccess = { claude: ids(s.claude), gemini: ids(s.gemini) };
  for (const provider of MODEL_PROVIDERS) {
    const wanted = s[DEFAULT_KEY[provider]];
    // The default must be one of the active models; otherwise the first active one takes its place.
    const chosen = typeof wanted === 'string' && access[provider].includes(wanted) ? wanted : access[provider][0];
    if (chosen) access[DEFAULT_KEY[provider]] = chosen;
  }
  return access;
}

/** May a user run this model? `access` null = the admin has not chosen yet (built-in rule). */
export function isModelAllowed(access: ModelAccess | null, provider: ModelProvider, id: string): boolean {
  return access ? access[provider].includes(id) : !isCostlyModel(id);
}

/** The provider's default active model, if it has any. */
export function defaultModel(access: ModelAccess | null, provider: ModelProvider): string | undefined {
  if (!access) return undefined;
  const chosen = access[DEFAULT_KEY[provider]];
  return chosen && access[provider].includes(chosen) ? chosen : access[provider][0];
}

/**
 * What a request may actually run.
 *  - the requested model, when it is active
 *  - otherwise the provider's default active model (a switched-off or unknown model never runs)
 *  - `model` undefined: use the server's own default chain (nothing was chosen by the admin for this case)
 *  - `blocked`: the user asked for this provider but the admin has switched all of its models off
 */
export function resolveAllowedModel(access: ModelAccess | null, provider: ModelProvider, requested?: string): { model?: string; blocked?: boolean } {
  if (requested && isModelAllowed(access, provider, requested)) return { model: requested };
  const fallback = defaultModel(access, provider);
  if (fallback) return { model: fallback };
  return access && requested ? { blocked: true } : {};
}

/** The models of a provider's catalog a user may see. */
export function visibleModels<T extends { id: string }>(access: ModelAccess | null, provider: ModelProvider, catalog: T[]): T[] {
  return catalog.filter(model => isModelAllowed(access, provider, model.id));
}
