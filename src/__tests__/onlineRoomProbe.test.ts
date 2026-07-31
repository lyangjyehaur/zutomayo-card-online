import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOnlineRoom } from '../onlineRoomProbe';

describe('online room probing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the server detail for a missing room', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('match has expired', { status: 404, headers: { 'x-request-id': 'req_room' } })),
    );

    const result = await fetchOnlineRoom('expired-match');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected room probing to fail');
    expect(result.reason).toBe('roomNotFound');
    expect(result.error.message).toBe('match has expired (HTTP 404, request req_room)');
  });

  it('keeps non-404 server failures distinct from network exceptions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('upstream unavailable', { status: 503 })),
    );

    const serverResult = await fetchOnlineRoom('match-1');

    expect(serverResult.ok).toBe(false);
    if (serverResult.ok) throw new Error('Expected room probing to fail');
    expect(serverResult.reason).toBe('connectionFailed');
    expect(serverResult.error.message).toBe('upstream unavailable (HTTP 503)');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('socket disconnected'))),
    );
    const networkResult = await fetchOnlineRoom('match-1');
    expect(networkResult.ok).toBe(false);
    if (networkResult.ok) throw new Error('Expected room probing to fail');
    expect(networkResult.error.message).toBe('socket disconnected');
  });
});
