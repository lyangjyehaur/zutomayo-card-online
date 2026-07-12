import { describe, expect, it, vi } from 'vitest';
import { drainNetwork } from '../networkDrain';

describe('network drain', () => {
  it('announces drain, closes new HTTP connections, waits, then closes sockets', async () => {
    const closeHttp = vi.fn((callback: (error?: Error) => void) => callback());
    const closeIdleConnections = vi.fn();
    const closeAllConnections = vi.fn();
    const emit = vi.fn();
    const disconnectSockets = vi.fn();
    const closeSocketServer = vi.fn(async () => undefined);
    const sleep = vi.fn(async () => undefined);
    const httpServer = { listening: true, close: closeHttp, closeIdleConnections, closeAllConnections };

    await drainNetwork({
      httpServer,
      socketNamespace: { emit, disconnectSockets },
      socketServer: { close: closeSocketServer },
      graceMs: 5_000,
      sleep,
    });

    expect(emit).toHaveBeenCalledWith('serverDraining', { retryAfterMs: 5_000 });
    expect(closeHttp).toHaveBeenCalledOnce();
    expect(closeIdleConnections).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(5_000);
    expect(disconnectSockets).toHaveBeenCalledWith(true);
    expect(closeSocketServer).toHaveBeenCalledOnce();
    expect(closeAllConnections).toHaveBeenCalledOnce();
  });

  it('keeps shutdown moving when socket close reports an error', async () => {
    const error = new Error('already closed');
    const onSocketCloseError = vi.fn();
    await drainNetwork({
      socketServer: { close: vi.fn(async () => Promise.reject(error)) },
      graceMs: 0,
      onSocketCloseError,
    });
    expect(onSocketCloseError).toHaveBeenCalledWith(error);
  });
});
