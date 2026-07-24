import type { GameState } from '../game/types';

export interface TutorialPresentationSnapshots {
  turn2Entry: GameState | null;
  effectOrder: GameState | null;
  postTurn2: GameState | null;
}

export const EMPTY_TUTORIAL_PRESENTATION_SNAPSHOTS: TutorialPresentationSnapshots = {
  turn2Entry: null,
  effectOrder: null,
  postTurn2: null,
};

export function cloneTutorialGameState(state: GameState): GameState {
  return structuredClone(state);
}

export function captureTutorialPresentationSnapshots(
  current: TutorialPresentationSnapshots,
  state: GameState,
): TutorialPresentationSnapshots {
  let changed = false;
  const next = { ...current };

  if (!next.turn2Entry && state.step === 'turnSet' && state.turnNumber === 2) {
    next.turn2Entry = cloneTutorialGameState(state);
    changed = true;
  }
  if (!next.effectOrder && state.step === 'effectOrder' && state.pendingEffects[0].length > 0) {
    next.effectOrder = cloneTutorialGameState(state);
    changed = true;
  }
  if (!next.postTurn2 && state.turnNumber >= 3) {
    next.postTurn2 = cloneTutorialGameState(state);
    changed = true;
  }

  return changed ? next : current;
}

function setHp(state: GameState, player: 0 | 1, hp: number): void {
  state.players[player].hp = hp;
}

/**
 * The production engine resolves a full turn atomically. The tutorial explains
 * that resolution in smaller moments, so the visible player board receives a
 * cloned display state while all moves and AI continue to use authoritative G.
 */
export function buildTutorialPresentationState({
  authoritative,
  snapshots,
  phase,
  secondHpCalculation,
}: {
  authoritative: GameState | null;
  snapshots: TutorialPresentationSnapshots;
  phase: string;
  secondHpCalculation: boolean;
}): GameState | undefined {
  if (!authoritative) return undefined;

  const earlyTurnOne =
    ['flow-recap', 'clock-advance', 'turn-end-draw-t1'].includes(phase) ||
    (phase === 'hp-calc' && !secondHpCalculation);
  const afterTurnTwo =
    ['choice-mechanics', 'turn-end-cleanup'].includes(phase) || (phase === 'hp-calc' && secondHpCalculation);

  const source = earlyTurnOne
    ? (snapshots.turn2Entry ?? authoritative)
    : phase === 'choice-mechanics'
      ? (snapshots.effectOrder ?? authoritative)
      : afterTurnTwo
        ? (snapshots.postTurn2 ?? authoritative)
        : authoritative;
  const display = cloneTutorialGameState(source);

  if (earlyTurnOne) {
    display.turnNumber = 1;
    display.chronos.position = phase === 'flow-recap' ? 0 : 3;
    display.chronosAtTurnStart = 0;
    setHp(display, 0, phase === 'hp-calc' ? 80 : 100);
    setHp(display, 1, 100);
  }

  if (phase === 'flow-recap' || phase === 'clock-advance' || (phase === 'hp-calc' && !secondHpCalculation)) {
    display.step = 'initialSet';
    display.ready = [true, true];
  }

  if (phase === 'choice-mechanics') {
    display.turnNumber = 2;
    display.step = 'effectOrder';
    setHp(display, 1, 100);
  }

  if (phase === 'hp-calc' && secondHpCalculation) {
    display.turnNumber = 2;
    setHp(display, 1, 30);
  }

  if (phase === 'turn-end-cleanup') {
    display.turnNumber = 2;
    setHp(display, 1, 30);
  }

  return display;
}
