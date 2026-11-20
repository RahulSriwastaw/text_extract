export const claudeModels = [
  'Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5', 'Fable 5.2', 'Fable 5.1', 'Fable 5',
  'Opus 5', 'Opus 4.8', 'Opus 4.7', 'Opus 4.6', 'Opus 3', 'Sonnet 5', 'Sonnet 4.6',
] as const;
export type ClaudeModel = typeof claudeModels[number];
export const defaultClaudeModel: ClaudeModel = 'Opus 5.5';

export type DirectModel = ClaudeModel | `gemini:${string}` | `anthropic:${string}`;
export function directModelFields(model?: DirectModel) {
  return model?.startsWith('gemini:') ? { geminiModel: model.slice(7) } : { claudeModel: model };
}
