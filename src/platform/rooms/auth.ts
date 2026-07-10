import type { AuthContext } from '@colyseus/core';
import type { LobbyJoinOptions, PlatformAuth, PlatformRole } from './types';
import { platformAuthTokenFromContext, verifyPlatformJwtUserId } from './jwt';

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
  if (userId.startsWith('u_') || userId.startsWith('user:')) return fallback;
  return userId;
}

function normalizeRole(value: unknown): PlatformRole {
  if (value === 'player' || value === 'spectator' || value === 'moderator') return value;
  return 'spectator';
}

export function authenticatePlatformClient(options: LobbyJoinOptions, context: AuthContext): PlatformAuth {
  const fallbackUserId = `${FALLBACK_GUEST_PREFIX}:${context.ip}:${cryptoRandomFragment()}`;
  const verifiedUserId = cleanUserId(verifyPlatformJwtUserId(platformAuthTokenFromContext(context)), '');
  const userId = verifiedUserId || cleanGuestUserId(options.userId, fallbackUserId);
  const displayName = cleanText(options.displayName, userId, 40);
  return {
    userId,
    displayName,
    role: normalizeRole(options.role),
    authenticated: Boolean(verifiedUserId),
  };
}

function cryptoRandomFragment(): string {
  return Math.random().toString(36).slice(2, 10);
}
