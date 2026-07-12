import crypto from 'node:crypto';
import type { AuthContext } from '@colyseus/core';

const AUTH_COOKIE_NAME = 'zutomayo_session';

export interface PlatformJwtRevocationStore {
  get(key: string): Promise<string | null>;
}

interface ParsedPlatformJwt {
  userId: string;
  jti?: string;
  iat?: number;
  sessionIat?: number;
  exp: number;
}

let revocationStore: PlatformJwtRevocationStore | null = null;

function signTokenInput(input: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(input).digest('base64url');
}

export function platformAuthTokenFromCookieHeader(cookieHeader: string | null | undefined): string {
  if (!cookieHeader) return '';
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName !== AUTH_COOKIE_NAME) continue;
    return decodeURIComponent(rawValue.join('=') || '');
  }
  return '';
}

export function platformAuthTokenFromContext(context: Pick<AuthContext, 'headers' | 'token'>): string {
  return platformAuthTokenFromCookieHeader(context.headers.get('cookie'));
}

export function configurePlatformJwtRevocationStore(store: PlatformJwtRevocationStore | null): void {
  revocationStore = store;
}

export function hasPlatformJwtRevocationStore(): boolean {
  return revocationStore !== null;
}

function parsePlatformJwt(token: string, secret: string): ParsedPlatformJwt | null {
  try {
    if (!secret || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payloadPart, signature] = parts;
    const input = `${header}.${payloadPart}`;
    const expected = signTokenInput(input, secret);
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return null;
    }
    const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString()) as { alg?: unknown; typ?: unknown };
    if (parsedHeader.alg !== 'HS256' || parsedHeader.typ !== 'JWT') return null;
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString()) as {
      exp?: unknown;
      sub?: unknown;
      iat?: unknown;
      jti?: unknown;
      sessionIat?: unknown;
      typ?: unknown;
      userId?: unknown;
    };
    if (!Number.isFinite(payload.exp) || Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;
    if (payload.typ === 'refresh') return null;
    const userId = typeof payload.sub === 'string' ? payload.sub : payload.userId;
    if (typeof userId !== 'string' || !userId) return null;
    return {
      userId,
      jti: typeof payload.jti === 'string' && payload.jti ? payload.jti : undefined,
      iat: Number.isFinite(payload.iat) ? Number(payload.iat) : undefined,
      sessionIat: Number.isFinite(payload.sessionIat) ? Number(payload.sessionIat) : undefined,
      exp: Number(payload.exp),
    };
  } catch {
    return null;
  }
}

export function verifyPlatformJwtUserId(token: string, secret = process.env.JWT_SECRET || ''): string {
  return parsePlatformJwt(token, secret)?.userId || '';
}

/** Verify an access token against the API's shared Redis revocation keys. */
export async function verifyPlatformJwtUserIdAsync(
  token: string,
  secret = process.env.JWT_SECRET || '',
  store: PlatformJwtRevocationStore | null | undefined = revocationStore,
): Promise<string> {
  const parsed = parsePlatformJwt(token, secret);
  if (!parsed) return '';
  // In production an absent revocation store is an authentication outage.
  // Never accept a token that may have been revoked by the API service.
  if (!store) return process.env.NODE_ENV === 'production' ? '' : parsed.userId;
  try {
    if (parsed.jti && (await store.get(`blacklist:${parsed.jti}`)) === '1') return '';
    const revokedBefore = await store.get(`auth:revoked-before:${parsed.userId}`);
    if (revokedBefore !== null) {
      const cutoff = Number(revokedBefore);
      const sessionIssuedAt = parsed.sessionIat ?? parsed.iat;
      if (!Number.isFinite(cutoff) || !Number.isFinite(sessionIssuedAt) || Number(sessionIssuedAt) <= cutoff) return '';
    }
    return parsed.userId;
  } catch {
    return '';
  }
}
