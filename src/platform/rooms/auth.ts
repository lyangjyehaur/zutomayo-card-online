import type { AuthContext } from '@colyseus/core';
import type { LobbyJoinOptions, PlatformAuth, PlatformRole } from './types';
import { platformAuthTokenFromContext, verifyPlatformJwtUserId, verifyPlatformJwtUserIdAsync } from './jwt';

const FALLBACK_GUEST_PREFIX = 'guest';

function cleanText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLength);
}

function cleanUserId(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9:_-]{3,128}$/.test(trimmed)) return fallback;
  return trimmed;
}

function cleanGuestUserId(value: unknown, fallback: string): string {
  const userId = cleanUserId(value, fallback);
  if (userId === fallback) return fallback;
  if (!userId.startsWith('guest:') && !userId.startsWith('anon:')) return fallback;
  return userId;
}

function normalizeRole(value: unknown): PlatformRole {
  if (value === 'player' || value === 'spectator') return value;
  return 'spectator';
}

function platformAuth(
  options: LobbyJoinOptions,
  context: AuthContext,
  accessToken: string,
  verifiedUserId: string,
): PlatformAuth {
  const fallbackUserId = `${FALLBACK_GUEST_PREFIX}:${context.ip}:${cryptoRandomFragment()}`;
  const userId = verifiedUserId || cleanGuestUserId(options.userId, fallbackUserId);
  const displayName = cleanText(options.displayName, userId, 40);
  return {
    userId,
    displayName,
    role: normalizeRole(options.role),
    authenticated: Boolean(verifiedUserId),
    ...(verifiedUserId && accessToken ? { accessToken } : {}),
  };
}

export function authenticatePlatformClient(options: LobbyJoinOptions, context: AuthContext): PlatformAuth {
  const accessToken = platformAuthTokenFromContext(context);
  const verifiedUserId = cleanUserId(verifyPlatformJwtUserId(accessToken), '');
  return platformAuth(options, context, accessToken, verifiedUserId);
}

export async function authenticatePlatformClientCurrent(
  options: LobbyJoinOptions,
  context: AuthContext,
): Promise<PlatformAuth> {
  const accessToken = platformAuthTokenFromContext(context);
  const verifiedUserId = cleanUserId(await verifyPlatformJwtUserIdAsync(accessToken), '');
  return platformAuth(options, context, accessToken, verifiedUserId);
}

export async function assertPlatformAuthCurrent(auth: PlatformAuth): Promise<void> {
  if (!auth.authenticated || !auth.accessToken) return;
  const userId = await verifyPlatformJwtUserIdAsync(auth.accessToken);
  if (!userId || userId !== auth.userId) throw new Error('Authentication revoked');
}

function cryptoRandomFragment(): string {
  return Math.random().toString(36).slice(2, 10);
}
