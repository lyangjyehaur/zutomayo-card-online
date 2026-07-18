import type { GameStep, PlayerIndex } from './game/types';

export const ONLINE_TIMEOUT_RETRY_MS = 5_000;
export const ONLINE_OPPONENT_TIMEOUT_GRACE_MS = 5_000;

export function onlinePhaseTimerStartedAt(input: {
  step: GameStep;
  serverStartedAt: number | undefined;
  phaseObservedAt: number;
}): number {
  const serverStartedAt = typeof input.serverStartedAt === 'number' ? input.serverStartedAt : input.phaseObservedAt;
  // A room can exist for minutes before the second player arrives. The initial
  // janken clock starts when the playable phase is first observed, not when the
  // room state was created.
  return input.step === 'janken' ? Math.max(serverStartedAt, input.phaseObservedAt) : serverStartedAt;
}

export function canSubmitOnlineTimeout(input: {
  target: PlayerIndex;
  localPlayer: PlayerIndex;
  expiredForMs: number;
  lastAttemptAt: number | undefined;
  now: number;
}): boolean {
  if (input.target !== input.localPlayer && input.expiredForMs < ONLINE_OPPONENT_TIMEOUT_GRACE_MS) return false;
  return input.lastAttemptAt === undefined || input.now - input.lastAttemptAt >= ONLINE_TIMEOUT_RETRY_MS;
}
