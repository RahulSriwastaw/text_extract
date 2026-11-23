import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeModelAccess, isModelAllowed, defaultModel, resolveAllowedModel, visibleModels, isCostlyModel, type ModelAccess } from '../services/modelAccess.ts';

const catalog = [{ id: 'claude-opus-5-5' }, { id: 'claude-sonnet-5-5' }, { id: 'claude-haiku-5-5' }, { id: 'claude-fable-5-2' }];
const access: ModelAccess = { claude: ['claude-haiku-5-5', 'claude-sonnet-5-5'], gemini: [], defaultClaude: 'claude-sonnet-5-5' };

describe('built-in rule (the admin has not chosen yet)', () => {
  it('shows everything except Opus and Fable', () => {
    assert.deepEqual(visibleModels(null, 'claude', catalog).map(m => m.id), ['claude-sonnet-5-5', 'claude-haiku-5-5']);
    assert.ok(isCostlyModel('claude-fable-5-2') && isCostlyModel('claude-opus-4-8') && !isCostlyModel('claude-sonnet-5-5'));
  });

  it('runs an allowed model as asked, and sends a costly one to the server default', () => {
    assert.deepEqual(resolveAllowedModel(null, 'claude', 'claude-haiku-5-5'), { model: 'claude-haiku-5-5' });
    assert.deepEqual(resolveAllowedModel(null, 'claude', 'claude-opus-5-5'), {});
    assert.deepEqual(resolveAllowedModel(null, 'gemini', undefined), {});
  });
});

describe("the admin's choice", () => {
  it('only the active models are visible and allowed', () => {
    assert.deepEqual(visibleModels(access, 'claude', catalog).map(m => m.id), ['claude-sonnet-5-5', 'claude-haiku-5-5']);
    assert.ok(isModelAllowed(access, 'claude', 'claude-haiku-5-5'));
    assert.ok(!isModelAllowed(access, 'claude', 'claude-opus-5-5'));
  });

  it('the admin can switch a costly model on', () => {
    const withOpus: ModelAccess = { ...access, claude: [...access.claude, 'claude-opus-5-5'] };
    assert.ok(isModelAllowed(withOpus, 'claude', 'claude-opus-5-5'));
    assert.deepEqual(resolveAllowedModel(withOpus, 'claude', 'claude-opus-5-5'), { model: 'claude-opus-5-5' });
  });

  it('a switched-off or unknown model is replaced by the default active one', () => {
    assert.deepEqual(resolveAllowedModel(access, 'claude', 'claude-opus-5-5'), { model: 'claude-sonnet-5-5' });
    assert.deepEqual(resolveAllowedModel(access, 'claude', 'made-up-model'), { model: 'claude-sonnet-5-5' });
    assert.deepEqual(resolveAllowedModel(access, 'claude', undefined), { model: 'claude-sonnet-5-5' });   // features with no picker
  });

  it('a provider with every model switched off is refused when asked for', () => {
    assert.deepEqual(resolveAllowedModel(access, 'gemini', 'gemini-2.5-flash'), { blocked: true });
    assert.deepEqual(resolveAllowedModel(access, 'gemini', undefined), {});
  });

  it('the default falls back to the first active model', () => {
    assert.equal(defaultModel({ claude: ['a', 'b'], gemini: [], defaultClaude: 'gone' }, 'claude'), 'a');
    assert.equal(defaultModel(access, 'gemini'), undefined);
  });
});

describe('sanitizeModelAccess', () => {
  it('keeps valid ids once, drops junk, and repairs the default', () => {
    const clean = sanitizeModelAccess({
      claude: ['claude-sonnet-5-5', 'claude-sonnet-5-5', 'bad id with spaces', 42, '<script>'],
      gemini: ['gemini-2.5-flash'], defaultClaude: 'claude-opus-5-5', defaultGemini: 'gemini-2.5-flash',
    });
    assert.deepEqual(clean, { claude: ['claude-sonnet-5-5'], gemini: ['gemini-2.5-flash'], defaultClaude: 'claude-sonnet-5-5', defaultGemini: 'gemini-2.5-flash' });
  });

  it('is null for anything that is not a choice', () => {
    assert.equal(sanitizeModelAccess(null), null);
    assert.equal(sanitizeModelAccess('all'), null);
    assert.equal(sanitizeModelAccess({ enabled: true }), null);
  });

  it('an empty choice is valid (everything off) and has no default', () => {
    assert.deepEqual(sanitizeModelAccess({ claude: [], gemini: [] }), { claude: [], gemini: [] });
  });
});
