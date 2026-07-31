import { describe, expect, it, vi } from 'vitest';
import { resolveSocketIoRuntime } from '../socketIoRuntime';

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
});
