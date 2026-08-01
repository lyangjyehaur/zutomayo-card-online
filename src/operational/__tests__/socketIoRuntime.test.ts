import { describe, expect, it, vi } from 'vitest';
import { resolveSocketClientIp, resolveSocketIoRuntime } from '../socketIoRuntime';

describe('Socket.IO runtime resolution', () => {
  it('returns the raw Socket.IO server attached to the Koa app', () => {
    const rawServer = { of: vi.fn(), close: vi.fn() };
    const koaSocketWrapper = { attach: vi.fn() };

    expect(resolveSocketIoRuntime({ _io: rawServer, context: { io: koaSocketWrapper } })).toBe(rawServer);
  });

  it('does not mistake the koa-socket wrapper for the raw server', () => {
    expect(resolveSocketIoRuntime({ context: { io: { attach: vi.fn() } } })).toBeUndefined();
    expect(resolveSocketIoRuntime({ _io: { of: vi.fn() } })).toBeUndefined();
  });

  it('uses distinct forwarded client IPs from a trusted ingress', () => {
    const trustedProxy = '172.16.0.0/12';
    const first = resolveSocketClientIp(
      { address: '172.18.0.1', headers: { 'x-forwarded-for': '203.0.113.10, 172.18.0.1' } },
      trustedProxy,
    );
    const second = resolveSocketClientIp(
      { address: '172.18.0.1', headers: { 'x-forwarded-for': '203.0.113.11, 172.18.0.1' } },
      trustedProxy,
    );

    expect(first).toBe('203.0.113.10');
    expect(second).toBe('203.0.113.11');
  });

  it('ignores spoofed forwarding headers from an untrusted peer', () => {
    expect(
      resolveSocketClientIp({ address: '192.0.2.10', headers: { 'x-forwarded-for': '203.0.113.40' } }, '172.16.0.0/12'),
    ).toBe('192.0.2.10');
  });

  it('walks through a trusted CDN and ingress chain', () => {
    expect(
      resolveSocketClientIp(
        {
          address: '172.18.0.1',
          headers: { 'x-forwarded-for': '192.0.2.99, 203.0.113.40, 173.245.48.7' },
        },
        '172.16.0.0/12,173.245.48.0/20',
      ),
    ).toBe('203.0.113.40');
  });
});
