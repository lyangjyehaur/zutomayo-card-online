import type { IncomingMessage } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalTrustedProxy = process.env.TRUSTED_PROXY;

function request(remoteAddress: string, forwardedFor?: string): IncomingMessage {
  return {
    socket: { remoteAddress } as IncomingMessage['socket'],
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
  } as IncomingMessage;
}

describe('rate-limit client IP canonicalization', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.TRUSTED_PROXY = '10.0.0.0/8';
  });

  afterEach(() => {
    if (originalTrustedProxy === undefined) delete process.env.TRUSTED_PROXY;
    else process.env.TRUSTED_PROXY = originalTrustedProxy;
  });

  it('ignores a spoofed XFF from an untrusted peer', async () => {
    const { getClientIpFromRequest } = await import('../rateLimit');
    expect(getClientIpFromRequest(request('192.0.2.10', '203.0.113.40'))).toBe('192.0.2.10');
  });

  it('uses the ingress-provided client IP when the peer is trusted', async () => {
    const { getClientIpFromRequest } = await import('../rateLimit');
    expect(getClientIpFromRequest(request('10.0.0.8', '203.0.113.40, 10.0.0.8'))).toBe('203.0.113.40');
  });

  it('walks through a configured CDN range without trusting a spoofed left side', async () => {
    process.env.TRUSTED_PROXY = '10.0.0.0/8,173.245.48.0/20';
    vi.resetModules();
    const { getClientIpFromRequest } = await import('../rateLimit');

    expect(getClientIpFromRequest(request('10.0.0.8', '192.0.2.99, 203.0.113.40, 173.245.48.7'))).toBe('203.0.113.40');
  });
});
