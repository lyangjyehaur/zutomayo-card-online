import { describe, expect, it } from 'vitest';
import { createPresenceVisitorId, normalizePresenceVisitorId } from '../hooks/useOnlinePresence';

describe('online presence identity', () => {
  it('uses anonymous platform identity format for Colyseus lobby presence', () => {
    expect(createPresenceVisitorId()).toMatch(/^anon:presence:[a-zA-Z0-9_-]{8,83}$/);
  });

  it('normalizes legacy HTTP presence ids into anonymous platform ids', () => {
    expect(normalizePresenceVisitorId('presence:abc_12345')).toBe('anon:presence:abc_12345');
    expect(normalizePresenceVisitorId('anon:presence:abc_12345')).toBe('anon:presence:abc_12345');
    expect(normalizePresenceVisitorId('presence:bad space')).toBeNull();
    expect(normalizePresenceVisitorId('guest:presence:abc_12345')).toBeNull();
  });
});
