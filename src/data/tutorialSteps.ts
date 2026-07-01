import type { TutorialStep } from '../components/GameTutorialOverlay';

export const TUTORIAL_STEPS: TutorialStep[] = [
  // 1. Introduction
  {
    phase: 'intro',
    target: null,
    title: 'tutorial.game.intro.title',
    body: 'tutorial.game.intro.body',
    placement: 'center',
  },

  // 2. Janken Phase (3 steps)
  {
    phase: 'janken-intro',
    target: null,
    title: 'tutorial.game.janken.intro.title',
    body: 'tutorial.game.janken.intro.body',
    placement: 'center',
    waitForGamePhase: 'janken',
  },
  {
    phase: 'janken-action',
    target: '.janken-screen',
    title: 'tutorial.game.janken.action.title',
    body: 'tutorial.game.janken.action.body',
    placement: 'bottom',
    padding: 16,
    waitForUserAction: true,
    allowedInteractions: ['.janken-screen button'],
  },
  {
    phase: 'janken-result',
    target: null,
    title: 'tutorial.game.janken.result.title',
    body: 'tutorial.game.janken.result.body',
    placement: 'center',
  },

  // 3. Mulligan Phase (2 steps)
  {
    phase: 'mulligan-intro',
    target: null,
    title: 'tutorial.game.mulligan.intro.title',
    body: 'tutorial.game.mulligan.intro.body',
    placement: 'center',
    waitForGamePhase: 'mulligan',
  },
  {
    phase: 'mulligan-action',
    target: '.mulligan-screen',
    title: 'tutorial.game.mulligan.action.title',
    body: 'tutorial.game.mulligan.action.body',
    placement: 'bottom',
    padding: 16,
    waitForUserAction: true,
    allowedInteractions: ['.mulligan-screen button', '.mulligan-hand button'],
  },

  // 4. Initial Set Phase (2 steps)
  {
    phase: 'initial-set-intro',
    target: null,
    title: 'tutorial.game.initialSet.intro.title',
    body: 'tutorial.game.initialSet.intro.body',
    placement: 'center',
    waitForGamePhase: 'initialSet',
  },
  {
    phase: 'initial-set-action',
    target: '[data-zone="hand"]',
    title: 'tutorial.game.initialSet.action.title',
    body: 'tutorial.game.initialSet.action.body',
    placement: 'top',
    padding: 12,
    waitForUserAction: true,
    allowedInteractions: ['[data-zone="hand"]', '.set-zone', '.set-confirm-button'],
  },

  // 5. Core Mechanics Explanation (5 steps)
  {
    phase: 'zones-explain',
    target: '.battle-board',
    title: 'tutorial.game.zones.title',
    body: 'tutorial.game.zones.body',
    placement: 'center',
    padding: 20,
  },
  {
    phase: 'chronos-explain',
    target: '.chronos',
    title: 'tutorial.game.chronos.title',
    body: 'tutorial.game.chronos.body',
    placement: 'bottom',
    padding: 16,
  },
  {
    phase: 'resources-explain',
    target: '.power-charger-zone',
    title: 'tutorial.game.resources.title',
    body: 'tutorial.game.resources.body',
    placement: 'top',
    padding: 12,
  },
  {
    phase: 'catchup-explain',
    target: null,
    title: 'tutorial.game.catchup.title',
    body: 'tutorial.game.catchup.body',
    placement: 'center',
  },
  {
    phase: 'victory-explain',
    target: '.hp-display',
    title: 'tutorial.game.victory.title',
    body: 'tutorial.game.victory.body',
    placement: 'bottom',
    padding: 12,
  },

  // 6. Turn Set Phase (2 steps)
  {
    phase: 'turn-set-intro',
    target: null,
    title: 'tutorial.game.turnSet.intro.title',
    body: 'tutorial.game.turnSet.intro.body',
    placement: 'center',
    waitForGamePhase: 'turnSet',
  },
  {
    phase: 'turn-set-action',
    target: '[data-zone="hand"]',
    title: 'tutorial.game.turnSet.action.title',
    body: 'tutorial.game.turnSet.action.body',
    placement: 'top',
    padding: 12,
    waitForUserAction: true,
    allowedInteractions: ['[data-zone="hand"]', '.set-zone', '.set-confirm-button'],
  },

  // 7. Effect Order (2 steps)
  {
    phase: 'effect-order-intro',
    target: null,
    title: 'tutorial.game.effectOrder.intro.title',
    body: 'tutorial.game.effectOrder.intro.body',
    placement: 'center',
    waitForGamePhase: 'effectOrder',
  },
  {
    phase: 'effect-order-action',
    target: '.effect-order-panel',
    title: 'tutorial.game.effectOrder.action.title',
    body: 'tutorial.game.effectOrder.action.body',
    placement: 'center',
    padding: 16,
    waitForUserAction: true,
    allowedInteractions: ['.effect-order-panel button'],
  },

  // 8. Battle Phase (2 steps)
  {
    phase: 'battle-intro',
    target: '.battle-zone',
    title: 'tutorial.game.battle.intro.title',
    body: 'tutorial.game.battle.intro.body',
    placement: 'top',
    padding: 16,
  },
  {
    phase: 'battle-result',
    target: null,
    title: 'tutorial.game.battle.result.title',
    body: 'tutorial.game.battle.result.body',
    placement: 'center',
  },

  // 9. Completion
  {
    phase: 'complete',
    target: null,
    title: 'tutorial.game.complete.title',
    body: 'tutorial.game.complete.body',
    placement: 'center',
  },
];
