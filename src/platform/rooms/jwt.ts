import crypto from 'node:crypto';
import type { AuthContext } from '@colyseus/core';
import type { Pool } from 'pg';

const AUTH_COOKIE_NAME = 'zutomayo_session';

export interface PlatformJwtRevocationStore {
  get(key: string): Promise<string | null>;
}

export interface PlatformJwtAccountStore {
  currentAuthVersion(userId: string): Promise<number | null>;
}

interface ParsedPlatformJwt {
  userId: string;
  jti?: string;
  iat?: number;
  sessionIat?: number;
  authVersion?: number;
  exp: number;
}

let revocationStore: PlatformJwtRevocationStore | null = null;
let revocationStoreTimeoutMs = 750;
let accountStore: PlatformJwtAccountStore | null = null;
let accountStoreRequired = false;

function signTokenInput(input: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(input).digest('base64url');
}

export function platformAuthTokenFromCookieHeader(cookieHeader: string | null | undefined): string {
  if (!cookieHeader) return '';
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName !== AUTH_COOKIE_NAME) continue;
    try {
      return decodeURIComponent(rawValue.join('=') || '');
    } catch {
      return '';
    }
  }
  return '';
}

export function platformAuthTokenFromContext(context: Pick<AuthContext, 'headers' | 'token'>): string {
  return platformAuthTokenFromCookieHeader(context.headers.get('cookie'));
}

export function configurePlatformJwtRevocationStore(
  store: PlatformJwtRevocationStore | null,
  options: { timeoutMs?: number } = {},
): void {
  revocationStore = store;
  const timeoutMs = Number(options.timeoutMs);
  revocationStoreTimeoutMs = Number.isFinite(timeoutMs) ? Math.min(5_000, Math.max(50, timeoutMs)) : 750;
}

export function hasPlatformJwtRevocationStore(): boolean {
  return revocationStore !== null;
}

export function createPostgresPlatformJwtAccountStore(pool: Pick<Pool, 'query'>): PlatformJwtAccountStore {
  return {
    async currentAuthVersion(userId) {
      const row = (
        await pool.query<{ auth_version: number | string | null; deleted_at: Date | string | null }>(
          'SELECT auth_version, deleted_at FROM users WHERE id = $1',
          [userId],
        )
      ).rows[0];
      if (!row || row.deleted_at) return null;
      const version = Number(row.auth_version);
      return Number.isInteger(version) && version > 0 ? version : 1;
    },
  };
}

export function configurePlatformJwtAccountStore(
  store: PlatformJwtAccountStore | null,
  options: { required?: boolean } = {},
): void {
  accountStore = store;
  accountStoreRequired = options.required === true;
}

export function hasPlatformJwtAccountStore(): boolean {
  return accountStore !== null;
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
      authVersion?: unknown;
      typ?: unknown;
      userId?: unknown;
    };
    if (!Number.isFinite(payload.exp) || Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;
    if (payload.typ === 'refresh') return null;
    if (
      payload.authVersion !== undefined &&
      (!Number.isInteger(payload.authVersion) || Number(payload.authVersion) <= 0)
    ) {
      return null;
    }
    const userId = typeof payload.sub === 'string' ? payload.sub : payload.userId;
    if (typeof userId !== 'string' || !userId) return null;
    return {
      userId,
      jti: typeof payload.jti === 'string' && payload.jti ? payload.jti : undefined,
      iat: Number.isFinite(payload.iat) ? Number(payload.iat) : undefined,
      sessionIat: Number.isFinite(payload.sessionIat) ? Number(payload.sessionIat) : undefined,
      authVersion: payload.authVersion === undefined ? undefined : Number(payload.authVersion),
      exp: Number(payload.exp),
    };
  } catch {
    return null;
  }
}

export function verifyPlatformJwtUserId(token: string, secret = process.env.JWT_SECRET || ''): string {
  return parsePlatformJwt(token, secret)?.userId || '';
}

async function boundedRevocationRead(store: PlatformJwtRevocationStore, key: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      store.get(key),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('platform JWT revocation read timeout')), revocationStoreTimeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Verify an access token against PostgreSQL durable state and Redis immediate revocation keys. */
export async function verifyPlatformJwtUserIdAsync(
  token: string,
  secret = process.env.JWT_SECRET || '',
  store: PlatformJwtRevocationStore | null | undefined = revocationStore,
  durableAccountStore: PlatformJwtAccountStore | null | undefined = accountStore,
): Promise<string> {
  const parsed = parsePlatformJwt(token, secret);
  if (!parsed) return '';
  // In production an absent revocation store is an authentication outage.
  // Never accept a token that may have been revoked by the API service.
  if (!store && process.env.NODE_ENV === 'production') return '';
  if (!durableAccountStore && accountStoreRequired) return '';
  try {
    const [currentAuthVersion, blacklisted, revokedBefore] = await Promise.all([
      durableAccountStore ? durableAccountStore.currentAuthVersion(parsed.userId) : undefined,
      store && parsed.jti ? boundedRevocationRead(store, `blacklist:${parsed.jti}`) : undefined,
      store ? boundedRevocationRead(store, `auth:revoked-before:${parsed.userId}`) : undefined,
    ]);
    if (durableAccountStore) {
      // Legacy access tokens predate authVersion and are equivalent to the
      // initial durable version. Any password/reset/delete bump still revokes them.
      if (!currentAuthVersion || currentAuthVersion !== (parsed.authVersion ?? 1)) return '';
    }
    if (store) {
      if (blacklisted === '1') return '';
      if (revokedBefore !== null) {
        const cutoff = Number(revokedBefore);
        const sessionIssuedAt = parsed.sessionIat ?? parsed.iat;
        if (!Number.isFinite(cutoff) || !Number.isFinite(sessionIssuedAt) || Number(sessionIssuedAt) <= cutoff)
          return '';
      }
    }
    return parsed.userId;
  } catch {
    return '';
  }
}
