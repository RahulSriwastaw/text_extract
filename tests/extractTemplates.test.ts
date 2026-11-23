import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EXTRACT_TEMPLATE_IDS, extractTemplateInstruction } from '../services/extractTemplates.ts';
import { buildBridgePrompt } from '../services/studyAiBridgeService.ts';
import { NumberingStyle, OptionArrangement } from '../types.ts';

describe('extraction templates', () => {
  it('no template leaves the prompt exactly as it was', () => {
    assert.equal(extractTemplateInstruction('none'), '');
    assert.equal(extractTemplateInstruction('made-up'), '');
    assert.equal(extractTemplateInstruction(undefined), '');
    assert.equal(extractTemplateInstruction('constructor'), '');
    for (const mcq of [true, false]) {
      const args = [NumberingStyle.NUMBER_DOT, false, mcq, false, false, undefined, false, OptionArrangement.GRID, true, false, 'crop'] as const;
      assert.equal(buildBridgePrompt(...args, 'none'), buildBridgePrompt(...args));
    }
  });

  it('the board exam template adds its rules to both prompts, before the output format', () => {
    assert.ok(EXTRACT_TEMPLATE_IDS.includes('board-exam'));
    const rules = extractTemplateInstruction('board-exam');
    assert.match(rules, /PRINTED BOARD EXAM QUESTION PAPER/);
    for (const mcq of [true, false]) {
      const prompt = buildBridgePrompt(NumberingStyle.NUMBER_DOT, false, mcq, false, false, undefined, false, OptionArrangement.GRID, true, false, 'crop', 'board-exam');
      assert.ok(prompt.includes(rules));
      assert.ok(prompt.indexOf(rules) < prompt.indexOf('OUTPUT FORMAT:'));
      assert.match(prompt, /---STUDY_AI_COMPLETE---$/);
    }
  });
});
