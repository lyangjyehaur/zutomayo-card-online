export function shouldRunBoardTurnTimer({
  spectator,
  useServerTimer,
  playerID,
}: {
  spectator: boolean;
  useServerTimer: boolean;
  playerID: string | null | undefined;
}): boolean {
  if (spectator) return false;
  // Local AI mounts a hidden player-1 client to drive the bot. Only the visible
  // player-0 board may own the client timer; online clients use server authority.
  return useServerTimer || playerID !== '1';
}
