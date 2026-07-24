import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createUmamiProxyMiddleware, parseUmamiUpstreamUrl, umamiProxyRoute } from '../server/umamiProxy';

function context(path: string, method: string, body = '') {
  const headers: Record<string, string> = { host: 'battle.example.test', 'user-agent': 'test-agent' };
  if (body) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(body));
  }
  const responseHeaders = new Map<string, string>();
  return {
    path,
    method,
    request: { headers },
    req: Object.assign(Readable.from(body ? [body] : []), { headers }),
    ip: '203.0.113.8',
    host: 'battle.example.test',
    protocol: 'https',
    status: 404,
    body: undefined as unknown,
    set(name: string, value: string) {
      responseHeaders.set(name.toLowerCase(), value);
    },
    responseHeaders,
  };
}

describe('Umami same-origin proxy', () => {
  it('normalizes a configured upstream base URL and rejects unsafe forms', () => {
    expect(parseUmamiUpstreamUrl(' https://u.example.test/umami ')?.href).toBe('https://u.example.test/umami/');
    expect(parseUmamiUpstreamUrl('')).toBeNull();
    expect(() => parseUmamiUpstreamUrl('file:///tmp/umami')).toThrow('http or https');
    expect(() => parseUmamiUpstreamUrl('https://user:secret@u.example.test')).toThrow('credentials');
    expect(() => parseUmamiUpstreamUrl('https://u.example.test?target=other')).toThrow('query string');
  });

  it('only maps the fixed script and event endpoints', () => {
    expect(umamiProxyRoute('/analytics/script.js', 'GET')).toEqual({ method: 'GET', upstreamPath: 'script.js' });
    expect(umamiProxyRoute('/analytics/api/send', 'POST')).toEqual({ method: 'POST', upstreamPath: 'api/send' });
    expect(umamiProxyRoute('/analytics/api/send', 'GET')).toBeNull();
    expect(umamiProxyRoute('/analytics/https://attacker.test', 'GET')).toBeNull();
  });

  it('proxies the script with cache validators and selected response headers', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response('window.umami = {};', {
          headers: { 'content-type': 'application/javascript', etag: 'script-v1', 'x-upstream-secret': 'no' },
        }),
    );
    const middleware = createUmamiProxyMiddleware({
      upstreamUrl: 'https://u.example.test/base',
      fetchImpl,
    });
    const ctx = context('/analytics/script.js', 'GET');
    ctx.request.headers['if-none-match'] = 'script-v0';

    await middleware(ctx as never, vi.fn());

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://u.example.test/base/script.js');
    expect((init?.headers as Headers).get('if-none-match')).toBe('script-v0');
    expect(ctx.status).toBe(200);
    expect(ctx.body?.toString()).toBe('window.umami = {};');
    expect(ctx.responseHeaders.get('content-type')).toBe('application/javascript');
    expect(ctx.responseHeaders.has('x-upstream-secret')).toBe(false);
  });

  it('proxies events with the trusted client IP in both the header and Umami payload', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }),
    );
    const middleware = createUmamiProxyMiddleware({
      upstreamUrl: 'https://u.example.test',
      fetchImpl,
      clientIp: () => '198.51.100.12',
    });
    const payload = '{"type":"event","payload":{"website":"site-id"}}';
    const ctx = context('/analytics/api/send', 'POST', payload);
    ctx.request.headers['x-forwarded-for'] = '192.0.2.99';

    await middleware(ctx as never, vi.fn());

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://u.example.test/api/send');
    expect((init?.headers as Headers).get('x-forwarded-for')).toBe('198.51.100.12');
    expect(JSON.parse(Buffer.from(init?.body as Uint8Array).toString())).toEqual({
      type: 'event',
      payload: { website: 'site-id', ip: '198.51.100.12' },
    });
    expect(ctx.status).toBe(200);
  });

  it('overrides a client supplied payload IP and leaves malformed JSON for Umami to reject', async () => {
    const forwardedBodies: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      forwardedBodies.push(Buffer.from(init?.body as Uint8Array).toString());
      return new Response(null, { status: 204 });
    });
    const middleware = createUmamiProxyMiddleware({
      upstreamUrl: 'https://u.example.test',
      fetchImpl,
      clientIp: () => '198.51.100.12',
    });
    const spoofed = context(
      '/analytics/api/send',
      'POST',
      '{"type":"event","payload":{"website":"site-id","ip":"192.0.2.99"}}',
    );
    const malformed = context('/analytics/api/send', 'POST', '{not-json');

    await middleware(spoofed as never, vi.fn());
    await middleware(malformed as never, vi.fn());

    expect(JSON.parse(forwardedBodies[0]).payload.ip).toBe('198.51.100.12');
    expect(forwardedBodies[1]).toBe('{not-json');
  });

  it('removes a client supplied payload IP when no valid canonical IP is available', async () => {
    let forwardedBody = '';
    const middleware = createUmamiProxyMiddleware({
      upstreamUrl: 'https://u.example.test',
      fetchImpl: vi.fn<typeof fetch>(async (_url, init) => {
        forwardedBody = Buffer.from(init?.body as Uint8Array).toString();
        return new Response(null, { status: 204 });
      }),
      clientIp: () => 'not-an-ip',
    });
    const ctx = context(
      '/analytics/api/send',
      'POST',
      '{"type":"event","payload":{"website":"site-id","ip":"192.0.2.99"}}',
    );

    await middleware(ctx as never, vi.fn());

    expect(JSON.parse(forwardedBody).payload).toEqual({ website: 'site-id' });
  });

  it('fails closed for missing configuration, unsupported methods, oversized events, and upstream errors', async () => {
    const next = vi.fn();
    const disabled = createUmamiProxyMiddleware();
    const disabledCtx = context('/analytics/script.js', 'GET');
    await disabled(disabledCtx as never, next);
    expect(disabledCtx.status).toBe(404);

    const configured = createUmamiProxyMiddleware({
      upstreamUrl: 'https://u.example.test',
      fetchImpl: vi.fn<typeof fetch>(async () => {
        throw new Error('offline');
      }),
    });
    const methodCtx = context('/analytics/script.js', 'POST');
    await configured(methodCtx as never, next);
    expect(methodCtx.status).toBe(405);
    expect(methodCtx.responseHeaders.get('allow')).toBe('GET, HEAD');

    const largeCtx = context('/analytics/api/send', 'POST');
    largeCtx.req.headers['content-length'] = String(65 * 1024);
    await configured(largeCtx as never, next);
    expect(largeCtx.status).toBe(413);

    const failedCtx = context('/analytics/script.js', 'GET');
    await configured(failedCtx as never, next);
    expect(failedCtx.status).toBe(502);

    const unrelatedCtx = context('/other', 'GET');
    await configured(unrelatedCtx as never, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
