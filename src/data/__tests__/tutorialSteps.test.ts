import { describe, expect, it } from 'vitest';
import type { GameState } from '../../game/types';
import { TUTORIAL_STEPS } from '../tutorialSteps';

describe('TUTORIAL_STEPS', () => {
  it('reaches the first player action immediately after the welcome step', () => {
    expect(TUTORIAL_STEPS[0].phase).toBe('intro');
    expect(TUTORIAL_STEPS[1].phase).toBe('janken');
    expect(TUTORIAL_STEPS[1].completeWhen).toBeTypeOf('function');
  });

  it('keeps the mandatory tutorial concise without dropping the scripted match phases', () => {
    expect(TUTORIAL_STEPS).toHaveLength(15);
    expect(TUTORIAL_STEPS.map((step) => step.phase)).toEqual([
      'intro',
      'janken',
      'janken-result',
      'mulligan',
      'initialSet',
      'clock-advance',
      'hp-calc',
      'turnSet',
      'clock-advance',
      'area-enchant',
      'effectOrder-action',
      'pendingChoice-action',
      'hp-calc',
      'battle-result',
      'complete',
    ]);
  });

  it('allows every control required by the two-step card placement interaction', () => {
    for (const phase of ['initialSet', 'turnSet']) {
      const step = TUTORIAL_STEPS.find((candidate) => candidate.phase === phase);
      expect(step?.target).toContain('[data-tut="set-selected-card"]');
      expect(step?.target).toContain('[data-tut="confirm-set"]');
    }
  });

  it('advances placement steps from the authoritative phase even when the entry snapshot raced', () => {
    const initialSet = TUTORIAL_STEPS.find((step) => step.phase === 'initialSet');
    const turnSet = TUTORIAL_STEPS.find((step) => step.phase === 'turnSet');
    const staleEntry = { step: 'mulligan', turnNumber: 1 };

    expect(initialSet?.completeWhen?.({ step: 'mulligan' } as GameState, staleEntry)).toBe(false);
    expect(initialSet?.completeWhen?.({ step: 'turnSet' } as GameState, staleEntry)).toBe(true);
    expect(turnSet?.completeWhen?.({ step: 'turnSet' } as GameState, staleEntry)).toBe(false);
    expect(turnSet?.completeWhen?.({ step: 'effectOrder' } as GameState, staleEntry)).toBe(true);
  });
});
