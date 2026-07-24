export const QUICK_MATCH_LONG_WAIT_MS = 45_000;

export function quickMatchWaitSeconds(startedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - startedAt) / 1_000));
}

export function formatQuickMatchWait(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

export function shouldOfferQuickMatchFallback(elapsedSeconds: number): boolean {
  return elapsedSeconds * 1_000 >= QUICK_MATCH_LONG_WAIT_MS;
}
