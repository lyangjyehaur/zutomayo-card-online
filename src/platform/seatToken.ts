import crypto from 'node:crypto';
import { requireSecret } from '../runtimeSecurityConfig';

const TOKEN_PREFIX = 'pst1';
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

interface PlatformSeatTokenPayload {
  matchID: string;
  playerID: '0' | '1';
  /** Server-derived identity bound to this seat. */
  userId: string;
  iat: number;
  exp: number;
}

function signingSecret(): string {
  // 開發用 fallback：僅供本機 / 測試環境使用。
  // 正式環境必須透過 PLATFORM_SEAT_TOKEN_SECRET 或 JWT_SECRET 提供，
  // 並由 platform server 啟動時的 validateSecurityConfig() 強制檢查。
  const configured = process.env.PLATFORM_SEAT_TOKEN_SECRET || process.env.JWT_SECRET || '';
  if (process.env.NODE_ENV === 'production')
    return requireSecret('PLATFORM_SEAT_TOKEN_SECRET or JWT_SECRET', configured);
  return configured || 'development-platform-seat-token-secret-change-me';
}

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(input: string): string {
  return crypto.createHmac('sha256', signingSecret()).update(input).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parsePayload(value: string): PlatformSeatTokenPayload | null {
  try {
    const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<PlatformSeatTokenPayload>;
    if (typeof payload.matchID !== 'string' || !payload.matchID.trim()) return null;
    if (payload.playerID !== '0' && payload.playerID !== '1') return null;
    if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) return null;
    const iat = Number(payload.iat);
    const exp = Number(payload.exp);
    const userId = typeof payload.userId === 'string' ? payload.userId.trim() : '';
    if (!userId) return null;
    return {
      matchID: payload.matchID,
      playerID: payload.playerID,
      userId,
      iat: Math.trunc(iat),
      exp: Math.trunc(exp),
    };
  } catch {
    return null;
  }
}

export function createPlatformSeatToken({
  matchID,
  playerID,
  userId,
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
}: {
  matchID: string;
  playerID: '0' | '1';
  userId: string;
  now?: number;
  ttlMs?: number;
}): string {
  const payload = base64urlJson({
    matchID,
    playerID,
    userId: userId.trim().slice(0, 128),
    iat: now,
    exp: now + ttlMs,
  } satisfies PlatformSeatTokenPayload);
  const input = `${TOKEN_PREFIX}.${payload}`;
  return `${input}.${sign(input)}`;
}

export function verifyPlatformSeatToken({
  token,
  matchID,
  playerID,
  userId,
  now = Date.now(),
}: {
  token: unknown;
  matchID: string | undefined;
  playerID: unknown;
  userId: string;
  now?: number;
}): boolean {
  if (typeof token !== 'string' || !matchID || (playerID !== '0' && playerID !== '1')) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [prefix, payloadPart, signature] = parts;
  if (prefix !== TOKEN_PREFIX || !payloadPart || !signature) return false;
  const expected = sign(`${prefix}.${payloadPart}`);
  if (!safeEqual(signature, expected)) return false;
  const payload = parsePayload(payloadPart);
  if (!payload) return false;
  if (payload.matchID !== matchID || payload.playerID !== playerID || payload.iat > now || payload.exp < now) {
    return false;
  }
  return payload.userId === userId;
}
