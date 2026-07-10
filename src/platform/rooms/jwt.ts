import crypto from 'node:crypto';
import type { AuthContext } from '@colyseus/core';

const AUTH_COOKIE_NAME = 'zutomayo_session';

function signTokenInput(input: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(input).digest('base64url');
}

function tokenFromCookieHeader(cookieHeader: string | null): string {
  if (!cookieHeader) return '';
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName !== AUTH_COOKIE_NAME) continue;
    return decodeURIComponent(rawValue.join('=') || '');
  }
  return '';
}

function bearerTokenFromHeader(authorization: string | null): string {
  if (!authorization?.startsWith('Bearer ')) return '';
  return authorization.slice('Bearer '.length).trim();
}

export function platformAuthTokenFromContext(context: Pick<AuthContext, 'headers' | 'token'>): string {
  const bearerToken = bearerTokenFromHeader(context.headers.get('authorization'));
  if (bearerToken) return bearerToken;
  if (typeof context.token === 'string' && context.token.trim()) return context.token.trim();
  return tokenFromCookieHeader(context.headers.get('cookie'));
}

export function verifyPlatformJwtUserId(token: string, secret = process.env.JWT_SECRET || ''): string {
  try {
    if (!secret || typeof token !== 'string') return '';
    const parts = token.split('.');
    if (parts.length !== 3) return '';
    const [header, payloadPart, signature] = parts;
    const input = `${header}.${payloadPart}`;
    const expected = signTokenInput(input, secret);
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return '';
    }
    const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString()) as { alg?: unknown; typ?: unknown };
    if (parsedHeader.alg !== 'HS256' || parsedHeader.typ !== 'JWT') return '';
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString()) as {
      exp?: unknown;
      sub?: unknown;
      typ?: unknown;
      userId?: unknown;
    };
    if (!Number.isFinite(payload.exp) || Number(payload.exp) < Math.floor(Date.now() / 1000)) return '';
    if (payload.typ === 'refresh') return '';
    const userId = typeof payload.sub === 'string' ? payload.sub : payload.userId;
    return typeof userId === 'string' ? userId : '';
  } catch {
    return '';
  }
}
