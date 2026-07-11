import crypto from 'node:crypto';

const TOKEN_PREFIX = 'pst1';
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

interface PlatformSeatTokenPayload {
  matchID: string;
  playerID: '0' | '1';
  iat: number;
  exp: number;
}

function signingSecret(): string {
  return (
    process.env.PLATFORM_SEAT_TOKEN_SECRET ||
    process.env.JWT_SECRET ||
    'development-platform-seat-token-secret-change-me'
  );
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
    return {
      matchID: payload.matchID,
      playerID: payload.playerID,
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
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
}: {
  matchID: string;
  playerID: '0' | '1';
  now?: number;
  ttlMs?: number;
}): string {
  const payload = base64urlJson({
    matchID,
    playerID,
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
  now = Date.now(),
}: {
  token: unknown;
  matchID: string | undefined;
  playerID: unknown;
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
  return payload.matchID === matchID && payload.playerID === playerID && payload.iat <= now && payload.exp >= now;
}
