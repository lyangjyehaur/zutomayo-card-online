import { describe, expect, it } from 'vitest';
import { createPresenceVisitorId, loadPresenceVisitorId, normalizePresenceVisitorId } from '../hooks/useOnlinePresence';

class FakeStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('online presence identity', () => {
  it('uses anonymous platform identity format for Colyseus lobby presence', () => {
    const visitorId = createPresenceVisitorId();
    expect(visitorId).toMatch(/^anon:presence:[a-zA-Z0-9_-]{8,82}$/);
    expect(visitorId.length).toBeLessThanOrEqual(96);
  });

  it('normalizes legacy HTTP presence ids into anonymous platform ids', () => {
    expect(normalizePresenceVisitorId('presence:abc_12345')).toBe('anon:presence:abc_12345');
    expect(normalizePresenceVisitorId('anon:presence:abc_12345')).toBe('anon:presence:abc_12345');
    expect(normalizePresenceVisitorId('presence:bad space')).toBeNull();
    expect(normalizePresenceVisitorId('guest:presence:abc_12345')).toBeNull();
    expect(normalizePresenceVisitorId(`presence:${'a'.repeat(83)}`)).toBeNull();
  });

  it('stores upgraded anonymous visitor ids for platform and HTTP presence reuse', () => {
    const storage = new FakeStorage();
    storage.setItem('zutomayo_presence_visitor_id', 'presence:abc_12345');

    expect(loadPresenceVisitorId(storage)).toBe('anon:presence:abc_12345');
    expect(storage.getItem('zutomayo_presence_visitor_id')).toBe('anon:presence:abc_12345');
  });
});
