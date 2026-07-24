import { describe, expect, it } from 'vitest';
import type { GameState } from '../../game/types';
import { TUTORIAL_STEPS } from '../tutorialSteps';

describe('TUTORIAL_STEPS', () => {
  it('starts with a real player action instead of a separate welcome step', () => {
    expect(TUTORIAL_STEPS[0].phase).toBe('janken');
    expect(TUTORIAL_STEPS[0].completeWhen).toBeTypeOf('function');
  });

  it('keeps the mandatory tutorial concise without dropping the scripted match phases', () => {
    expect(TUTORIAL_STEPS).toHaveLength(25);
    expect(TUTORIAL_STEPS.map((step) => step.phase)).toEqual([
      'janken',
      'janken-result',
      'opening-hand',
      'mulligan-confirm',
      'initialSet-select',
      'initialSet-place',
      'initialSet-confirm',
      'flow-recap',
      'clock-advance',
      'hp-calc',
      'turn-end-draw-t1',
      'turnSet-character-select',
      'turnSet-character-place',
      'turnSet-area-select',
      'turnSet-area-place',
      'turnSet-confirm',
      'reveal-clock',
      'character-replacement',
      'power-charging',
      'area-enchant',
      'effectOrder-action',
      'choice-mechanics',
      'hp-calc',
      'turn-end-cleanup',
      'complete',
    ]);
  });

  it('introduces the five-card opening hand before enabling the mulligan action', () => {
    const openingHand = TUTORIAL_STEPS.find((step) => step.phase === 'opening-hand');
    const mulligan = TUTORIAL_STEPS.find((step) => step.phase === 'mulligan-confirm');

    expect(openingHand?.target).toBe('.mulligan-hand');
    expect(openingHand?.interactionTarget).toBe('[data-tut-mulligan-card="1st_2"]');
    expect(openingHand?.actionOnly).toBe(true);
    expect(mulligan?.completeWhen).toBeTypeOf('function');
  });

  it('locks battle preparation to one exact scripted target per step', () => {
    const preparation = TUTORIAL_STEPS.filter((step) => step.chapter === 'preparation');
    expect(preparation).toHaveLength(7);
    expect(preparation.map((step) => step.interactionTarget)).toEqual([
      '[data-tut="janken-rock"]',
      '[data-tut="setup-feedback"] button',
      '[data-tut-mulligan-card="1st_2"]',
      '[data-tut="mulligan-redraw"]',
      '[data-tut-card="1st_70"]',
      '[data-tut="set-selected-card"]',
      '[data-tut="confirm-set"]',
    ]);
    expect(TUTORIAL_STEPS.filter((step) => step.chapter === 'flow')).toHaveLength(18);
  });

  it('recaps the prepared board before the first battle-flow calculation', () => {
    const flow = TUTORIAL_STEPS.filter((step) => step.chapter === 'flow');

    expect(flow[0]).toMatchObject({
      phase: 'flow-recap',
      target: null,
      placement: 'center',
    });
    expect(flow[1].phase).toBe('clock-advance');
  });

  it('defines a safe previous-step policy for every step after each chapter entry', () => {
    for (const chapter of ['preparation', 'flow'] as const) {
      const steps = TUTORIAL_STEPS.filter((step) => step.chapter === chapter);
      expect(steps[0].backBehavior).toBeUndefined();
      for (const step of steps.slice(1)) {
        expect(step.backBehavior, `${chapter}:${step.phase}`).toBeDefined();
      }
    }

    expect(TUTORIAL_STEPS.find((step) => step.phase === 'clock-advance')?.backBehavior).toEqual({ type: 'direct' });
    expect(TUTORIAL_STEPS.find((step) => step.phase === 'mulligan-confirm')?.backBehavior).toEqual({
      type: 'restart',
      checkpoint: 'preparation',
    });
    expect(TUTORIAL_STEPS.find((step) => step.phase === 'turnSet-area-select')?.backBehavior).toEqual({
      type: 'restart',
      checkpoint: 'turn2',
    });
    expect(TUTORIAL_STEPS.find((step) => step.phase === 'choice-mechanics')?.backBehavior).toEqual({
      type: 'restart',
      checkpoint: 'effects',
    });
  });

  it('exposes exactly one interactive target at every scripted battle-flow action', () => {
    const expectedTargets = new Map([
      ['clock-advance', '[data-tut="game-notice-panel"] button'],
      ['turnSet-character-select', '[data-tut-card="1st_46"]'],
      ['turnSet-character-place', '[data-tut="set-selected-card"]'],
      ['turnSet-area-select', '[data-tut-card="2nd_98"]'],
      ['turnSet-area-place', '[data-tut="set-selected-card"]'],
      ['turnSet-confirm', '[data-tut="confirm-set"]'],
      ['reveal-clock', '[data-tut="game-notice-panel"] button'],
      ['effectOrder-action', '[data-tut-effect-card="2nd_98"]'],
    ]);
    const flow = TUTORIAL_STEPS.filter((step) => step.chapter === 'flow');
    const actionSteps = flow.filter((step) => step.actionOnly || step.completeWhen || step.advanceOnNoticeDismiss);

    expect(actionSteps).toHaveLength(10);
    for (const step of actionSteps) {
      const expected =
        step.phase === 'hp-calc' ? '[data-tut="game-notice-panel"] button' : expectedTargets.get(step.phase);
      expect(step.interactionTarget, step.phase).toBe(expected);
      expect(Array.isArray(step.target), `${step.phase} visual target`).toBe(false);
      expect(Array.isArray(step.interactionTarget), `${step.phase} interaction target`).toBe(false);
    }
  });

  it('advances placement steps from the authoritative phase even when the entry snapshot raced', () => {
    const initialSet = TUTORIAL_STEPS.find((step) => step.phase === 'initialSet-confirm');
    const turnSet = TUTORIAL_STEPS.find((step) => step.phase === 'turnSet-confirm');
    const staleEntry = { step: 'mulligan', turnNumber: 1 };

    expect(initialSet?.completeWhen?.({ step: 'mulligan' } as GameState, staleEntry)).toBe(false);
    expect(initialSet?.completeWhen?.({ step: 'turnSet' } as GameState, staleEntry)).toBe(true);
    expect(turnSet?.completeWhen?.({ step: 'turnSet' } as GameState, staleEntry)).toBe(false);
    expect(turnSet?.completeWhen?.({ step: 'effectOrder' } as GameState, staleEntry)).toBe(true);
  });
});
