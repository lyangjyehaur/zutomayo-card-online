import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDeckShareAnalyticsPayload, trackDeckShareEvent } from '../deckShareAnalytics';

describe('deck share analytics', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds an allowlisted payload without share or deck identifiers', () => {
    const payload = buildDeckShareAnalyticsPayload({
      visibility: 'public',
      sort: 'popular',
      element: '炎',
      is_logged_in: true,
      source: 'detail',
    });
    expect(payload).toMatchObject({
      visibility: 'public',
      sort: 'popular',
      element: '炎',
      is_logged_in: true,
      source: 'detail',
    });
    expect(payload).not.toHaveProperty('shareId');
    expect(payload).not.toHaveProperty('deckName');
    expect(payload).not.toHaveProperty('cardIds');
  });

  it('tracks through Umami when available and otherwise fails safely', () => {
    const track = vi.fn();
    vi.stubGlobal('window', { innerWidth: 390, umami: { track } });
    expect(() => trackDeckShareEvent('deck_share_copy', { is_logged_in: false, source: 'detail' })).not.toThrow();
    expect(track).toHaveBeenCalledWith(
      'deck_share_copy',
      expect.objectContaining({ is_logged_in: false, source: 'detail', viewport: 'mobile' }),
    );
  });
});
