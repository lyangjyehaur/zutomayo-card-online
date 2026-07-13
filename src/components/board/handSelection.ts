import type { GameStep, PlayerIndex } from '../../game/types';

export type HandSelectionResetKey = {
  step: GameStep;
  turnNumber: number;
  ready: readonly boolean[];
  playerIndex: PlayerIndex;
  playerID: string | null;
};

export function handSelectionResetKey({
  step,
  turnNumber,
  ready,
  playerIndex,
  playerID,
}: HandSelectionResetKey): string {
  return `${step}:${turnNumber}:${ready[playerIndex] ? 'ready' : 'active'}:${playerID ?? 'spectator'}`;
}
