import { describe, expect, it } from 'vitest';
import {
  getLocalDeckShareDemo,
  getLocalDeckShareDemos,
  getLocalDeckShareDemoPage,
  isLocalDeckShareDemo,
  LOCAL_DECK_SHARE_DEMO_ID,
} from '../deckShareDemo';

describe('local deck-share preview', () => {
  it('provides four valid 20-card, maximum-two-copy decks', () => {
    const demos = getLocalDeckShareDemos('zh-TW');

    expect(demos).toHaveLength(4);
    for (const demo of demos) {
      const counts = new Map<string, number>();
      for (const cardId of demo.cardIds) counts.set(cardId, (counts.get(cardId) ?? 0) + 1);

      expect(demo.cardIds).toHaveLength(20);
      expect(Math.max(...counts.values())).toBe(2);
      expect(demo.representativeCardIds).toHaveLength(3);
      expect(getLocalDeckShareDemo(demo.id, 'zh-TW')?.id).toBe(demo.id);
    }
    expect(isLocalDeckShareDemo(LOCAL_DECK_SHARE_DEMO_ID)).toBe(true);
    expect(isLocalDeckShareDemo('not-a-preview')).toBe(false);
    expect(getLocalDeckShareDemo('not-a-preview', 'zh-TW')).toBeNull();
  });

  it('uses the same query and element semantics as the lobby', () => {
    expect(getLocalDeckShareDemoPage('zh-TW', { q: 'Chronos', element: '炎' }).shares).toHaveLength(1);
    expect(getLocalDeckShareDemoPage('zh-TW', { element: '闇' }).shares).toHaveLength(1);
    expect(getLocalDeckShareDemoPage('en', { q: 'local preview' }).shares).toHaveLength(4);
  });

  it('sorts previews with the same semantics as the API', () => {
    expect(getLocalDeckShareDemoPage('en', { sort: 'popular' }).shares[0]?.likeCount).toBe(47);
    expect(getLocalDeckShareDemoPage('en', { sort: 'most-copied' }).shares[0]?.copyCount).toBe(27);
    expect(getLocalDeckShareDemoPage('en', { sort: 'newest' }).shares[0]?.id).toBe(LOCAL_DECK_SHARE_DEMO_ID);
  });
});
