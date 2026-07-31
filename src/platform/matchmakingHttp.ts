import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type http from 'node:http';
import { createRouter } from '@colyseus/core';
import {
  checkPlatformAdmission,
  isPlatformMatchmakeRequest,
  platformAdmissionClientIp,
  type PlatformAdmissionLimiter,
} from './admission';
import { resolvePlatformCorsOrigin } from './config';
import { recordPlatformHttpRequest } from './metrics';

interface MatchmakingRequestContext {
  method: string;
  path: string;
  origin?: string;
  requestId: string;
  startedAt: bigint;
}

interface CreatePlatformMatchmakingRouterOptions {
  limiter: PlatformAdmissionLimiter;
  corsOrigins: string[];
  verifyUserId?: (token: string) => Promise<string>;
}

const PLATFORM_STATUS_BY_CODE: Readonly<Record<number, number>> = {
  520: 404,
  521: 404,
  522: 404,
  523: 500,
  524: 410,
  525: 401,
  526: 500,
  4217: 400,
};

function requestId(value: string | null): string {
  const candidate = value?.trim();
  return candidate && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : crypto.randomUUID();
}

function corsHeaders(origin: string | undefined, allowedOrigins: string[]): HeadersInit {
  const allowedOrigin = resolvePlatformCorsOrigin(origin, allowedOrigins);
  return {
    'Access-Control-Allow-Origin': allowedOrigin || 'null',
    Vary: 'Origin',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token',
  };
}

function errorHttpStatus(code: number): number {
  return PLATFORM_STATUS_BY_CODE[code] ?? 500;
}

async function normalizeMatchmakingResponse(
  response: Response,
  context: MatchmakingRequestContext,
  allowedOrigins: string[],
): Promise<Response> {
  const platformCode = PLATFORM_STATUS_BY_CODE[response.status] ? response.status : undefined;
  const status = platformCode ? errorHttpStatus(platformCode) : response.status;
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(context.origin, allowedOrigins))) {
    if (value !== undefined) headers.set(key, value);
  }
  headers.set('x-request-id', context.requestId);

  let body: BodyInit | null = response.body;
  if (platformCode) {
    let parsed: { code?: unknown; error?: unknown } = {};
    try {
      parsed = (await response.json()) as typeof parsed;
    } catch {
      // Preserve a useful platform code even when an upstream error body is malformed.
    }
    const detail =
      typeof parsed.error === 'string' && parsed.error.trim() ? parsed.error.trim() : 'Platform request failed';
    const message = `${detail} (platform code ${platformCode}, HTTP ${status}, request ${context.requestId})`;
    body = JSON.stringify({
      ...parsed,
      code: platformCode,
      platformCode,
      error: message,
      requestId: context.requestId,
    });
    headers.set('content-type', 'application/json');
    headers.set('x-platform-error-code', String(platformCode));
    headers.delete('content-length');
  }

  recordPlatformHttpRequest(context.method, context.path, status, context.startedAt);
  return new Response(body, { status, headers });
}

export function createPlatformMatchmakingRouter(options: CreatePlatformMatchmakingRouterOptions) {
  const contexts = new AsyncLocalStorage<MatchmakingRequestContext>();
  return createRouter(
    {},
    {
      openapi: { disabled: true },
      onRequest: async (request) => {
        const url = new URL(request.url);
        const context: MatchmakingRequestContext = {
          method: request.method,
          path: url.pathname,
          origin: request.headers.get('origin') || undefined,
          requestId: requestId(request.headers.get('x-request-id')),
          startedAt: process.hrtime.bigint(),
        };
        contexts.enterWith(context);
        if (!isPlatformMatchmakeRequest(context.method, context.path)) return request;

        const decision = await checkPlatformAdmission({
          limiter: options.limiter,
          ip: request.headers.get('x-forwarded-for') || '',
          cookieHeader: request.headers.get('cookie') || undefined,
          verifyUserId: options.verifyUserId,
        });
        if (decision.allowed) return request;

        const status = decision.status ?? 503;
        recordPlatformHttpRequest(context.method, context.path, status, context.startedAt);
        return new Response(JSON.stringify({ error: decision.error, requestId: context.requestId }), {
          status,
          headers: {
            ...corsHeaders(context.origin, options.corsOrigins),
            'content-type': 'application/json',
            'x-request-id': context.requestId,
            ...(decision.retryAfter ? { 'Retry-After': decision.retryAfter } : {}),
          },
        });
      },
      onResponse: async (response) => {
        const context = contexts.getStore();
        if (!context || !isPlatformMatchmakeRequest(context.method, context.path)) return response;
        return normalizeMatchmakingResponse(response, context, options.corsOrigins);
      },
    },
  );
}

export function canonicalizePlatformHttpRequest(request: http.IncomingMessage, trustedProxy: string | undefined): void {
  const ip = platformAdmissionClientIp(
    request.socket.remoteAddress,
    request.headers['x-forwarded-for'] ?? request.headers['x-real-ip'] ?? request.headers['x-client-ip'],
    trustedProxy,
  );
  if (ip) {
    request.headers['x-forwarded-for'] = ip;
    request.headers['x-real-ip'] = ip;
  }
  request.headers['x-request-id'] = requestId(
    Array.isArray(request.headers['x-request-id'])
      ? request.headers['x-request-id'][0]
      : request.headers['x-request-id'] || null,
  );
}

export function platformMatchmakingCorsHeaders(
  origin: string | null,
  allowedOrigins: string[],
): Record<string, string> {
  return corsHeaders(origin || undefined, allowedOrigins) as Record<string, string>;
}
