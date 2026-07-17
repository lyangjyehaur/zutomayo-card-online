export const ONLINE_MOVE_ACK_TIMEOUT_MS = 4_000;

const BACKGROUND_RECOVERY_MOVES = new Set(['timeoutAdvance', 'timeoutSkip']);

export function shouldTrackOnlineMove(moveName: string): boolean {
  return !BACKGROUND_RECOVERY_MOVES.has(moveName);
}

export function didOnlineStateAdvance(submittedStateID: number, observedStateID: number | null): boolean {
  return observedStateID !== null && observedStateID > submittedStateID;
}
