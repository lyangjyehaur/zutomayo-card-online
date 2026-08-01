export const PLATFORM_PENDING_INVITE_DISCOVERY_PATH = '/matchmake/invites/pending';
export const PLATFORM_PENDING_INVITE_POLL_MS = 15_000;
export const PLATFORM_PENDING_INVITE_FETCH_TIMEOUT_MS = 5_000;

export interface PlatformPendingInviteDiscovery {
  pendingInvite: { roomId: string } | null;
}

function validRoomId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function platformPendingInviteDiscoveryFromMessage(value: unknown): PlatformPendingInviteDiscovery | null {
  if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, 'pendingInvite')) return null;
  const pendingInvite = (value as { pendingInvite?: unknown }).pendingInvite;
  if (pendingInvite === null) return { pendingInvite: null };
  if (!pendingInvite || typeof pendingInvite !== 'object') return null;
  const roomId = (pendingInvite as { roomId?: unknown }).roomId;
  return validRoomId(roomId) ? { pendingInvite: { roomId } } : null;
}

export function isPlatformInviteRoomId(value: unknown): value is string {
  return validRoomId(value);
}
