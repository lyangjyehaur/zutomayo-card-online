import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import type { Next, ParameterizedContext } from 'koa';

export const UMAMI_PROXY_BASE_PATH = '/analytics';

export const UMAMI_SCRIPT_PATH = `${UMAMI_PROXY_BASE_PATH}/script.js`;
export const UMAMI_SEND_PATH = `${UMAMI_PROXY_BASE_PATH}/api/send`;
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;

interface UmamiProxyRoute {
  method: 'GET' | 'HEAD' | 'POST';
  upstreamPath: 'script.js' | 'api/send';
}

interface UmamiProxyContext extends ParameterizedContext {
  req: IncomingMessage;
}

interface UmamiProxyOptions {
  upstreamUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  clientIp?: (ctx: UmamiProxyContext) => string;
  onError?: (error: unknown, path: string) => void;
}

class PayloadTooLargeError extends Error {}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseUmamiUpstreamUrl(rawValue: string | undefined): URL | null {
  const raw = rawValue?.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('UMAMI_UPSTREAM_URL must be a valid absolute URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('UMAMI_UPSTREAM_URL must use http or https');
  }
  if (url.username || url.password) {
    throw new Error('UMAMI_UPSTREAM_URL must not contain credentials');
  }
  if (url.search || url.hash) {
    throw new Error('UMAMI_UPSTREAM_URL must not contain a query string or fragment');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url;
}

export function umamiProxyRoute(path: string, method: string): UmamiProxyRoute | null {
  if (path === UMAMI_SCRIPT_PATH && (method === 'GET' || method === 'HEAD')) {
    return { method, upstreamPath: 'script.js' };
  }
  if (path === UMAMI_SEND_PATH && method === 'POST') {
    return { method, upstreamPath: 'api/send' };
  }
  return null;
}

function allowedMethod(path: string): string | null {
  if (path === UMAMI_SCRIPT_PATH) return 'GET, HEAD';
  if (path === UMAMI_SEND_PATH) return 'POST';
  return null;
}

async function readRequestBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const declaredLength = Number(firstHeaderValue(request.headers['content-length']));
  if (Number.isFinite(declaredLength) && declaredLength > limit) throw new PayloadTooLargeError();

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > limit) throw new PayloadTooLargeError();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readResponseBody(response: Response, limit: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > limit) throw new PayloadTooLargeError();
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel();
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

function copyRequestHeader(target: Headers, source: IncomingHttpHeaders, name: string): void {
  const value = firstHeaderValue(source[name]);
  if (value) target.set(name, value);
}

function copyResponseHeaders(ctx: UmamiProxyContext, response: Response): void {
  for (const name of ['content-type', 'cache-control', 'etag', 'last-modified', 'expires']) {
    const value = response.headers.get(name);
    if (value) ctx.set(name, value);
  }
}

export function createUmamiProxyMiddleware(options: UmamiProxyOptions = {}) {
  const upstream = parseUmamiUpstreamUrl(options.upstreamUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  return async (ctx: UmamiProxyContext, next: Next): Promise<void> => {
    const allow = allowedMethod(ctx.path);
    if (!allow) {
      await next();
      return;
    }

    const route = umamiProxyRoute(ctx.path, ctx.method);
    if (!route) {
      ctx.set('Allow', allow);
      ctx.status = 405;
      return;
    }
    if (!upstream) {
      ctx.status = 404;
      return;
    }

    const headers = new Headers();
    for (const name of ['accept', 'accept-language', 'user-agent']) {
      copyRequestHeader(headers, ctx.request.headers, name);
    }
    if (route.upstreamPath === 'script.js') {
      copyRequestHeader(headers, ctx.request.headers, 'if-none-match');
      copyRequestHeader(headers, ctx.request.headers, 'if-modified-since');
    } else {
      copyRequestHeader(headers, ctx.request.headers, 'content-type');
      headers.set('x-forwarded-for', options.clientIp?.(ctx) || ctx.ip);
      headers.set('x-forwarded-host', firstHeaderValue(ctx.request.headers.host) || ctx.host);
      headers.set('x-forwarded-proto', ctx.protocol);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const body = route.method === 'POST' ? await readRequestBody(ctx.req, MAX_EVENT_BYTES) : undefined;
      const response = await fetchImpl(new URL(route.upstreamPath, upstream), {
        method: route.method,
        headers,
        body: body ? new Uint8Array(body) : undefined,
        redirect: 'error',
        signal: controller.signal,
      });
      ctx.status = response.status;
      copyResponseHeaders(ctx, response);
      if (route.method === 'HEAD' || response.status === 204 || response.status === 304) {
        await response.body?.cancel();
        ctx.body = null;
        return;
      }
      ctx.body = await readResponseBody(response, MAX_RESPONSE_BYTES);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        ctx.status = 413;
        ctx.body = { error: 'Analytics payload is too large' };
      } else if (controller.signal.aborted) {
        options.onError?.(error, ctx.path);
        ctx.status = 504;
        ctx.body = { error: 'Analytics upstream timeout' };
      } else {
        options.onError?.(error, ctx.path);
        ctx.status = 502;
        ctx.body = { error: 'Analytics upstream unavailable' };
      }
    } finally {
      clearTimeout(timeout);
    }
  };
}
