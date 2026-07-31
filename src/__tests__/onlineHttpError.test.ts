import { describe, expect, it } from 'vitest';
import { OnlineHttpError, onlineErrorDetail, onlineHttpError } from '../onlineHttpError';

describe('online HTTP errors', () => {
  it('preserves JSON server errors, HTTP status, and request ID', async () => {
    const error = await onlineHttpError(
      new Response(JSON.stringify({ error: 'Deck reservation expired' }), {
        status: 409,
        headers: { 'x-request-id': 'req_123' },
      }),
      'joinMatch',
    );

    expect(error).toBeInstanceOf(OnlineHttpError);
    expect(error.status).toBe(409);
    expect(error.requestId).toBe('req_123');
    expect(error.message).toBe('Deck reservation expired (HTTP 409, request req_123)');
  });

  it('preserves plain-text server errors and provides a fallback for unknown failures', async () => {
    const error = await onlineHttpError(new Response('player not available', { status: 409 }), 'resume');

    expect(error.message).toBe('player not available (HTTP 409)');
    expect(onlineErrorDetail('not-an-error', 'Connection failed')).toBe('Connection failed');
  });
});
