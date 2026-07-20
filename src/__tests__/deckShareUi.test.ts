import { describe, expect, it } from 'vitest';
import type { DeckShareSummary } from '../api/client';
import {
  applyDeckShareLikeState,
  getDeckShareCopyIssue,
  mergeDeckSharePages,
  readDeckShareLobbyState,
  updateDeckShareSearchParam,
} from '../deckShareUi';

function share(id: string): DeckShareSummary {
  return {
    id,
    name: id,
    visibility: 'public',
    publicationStatus: 'published',
    moderationStatus: 'visible',
    publishedRulesVersion: 'test',
    publishedAt: null,
    updatedAt: null,
    owner: { userId: 'owner', nickname: 'Owner' },
    elements: [],
    characterCount: 0,
    representativeCardIds: [],
    likeCount: 2,
    copyCount: 0,
    viewerHasLiked: false,
  };
}

describe('deck share UI state', () => {
  it('parses supported query state and rejects invalid URL values', () => {
    expect(readDeckShareLobbyState(new URLSearchParams('sort=most-copied&element=%E7%82%8E&q=night'))).toEqual({
      sort: 'most-copied',
      element: '炎',
      query: 'night',
    });
    expect(readDeckShareLobbyState(new URLSearchParams('sort=oldest&element=water'))).toEqual({
      sort: 'popular',
      element: '',
      query: '',
    });
  });

  it('updates one query value without discarding the other filters', () => {
    const next = updateDeckShareSearchParam(new URLSearchParams('sort=newest&element=%E9%A2%A8'), 'q', '真夜中');
    expect(next.toString()).toBe('sort=newest&element=%E9%A2%A8&q=%E7%9C%9F%E5%A4%9C%E4%B8%AD');
    expect(updateDeckShareSearchParam(next, 'element', '').has('element')).toBe(false);
  });

  it('appends cursor pages without duplicating existing share IDs', () => {
    expect(
      mergeDeckSharePages([share('ds_a'), share('ds_b')], [share('ds_b'), share('ds_c')]).map(({ id }) => id),
    ).toEqual(['ds_a', 'ds_b', 'ds_c']);
  });

  it('explains why a shared snapshot cannot be copied under current rules', () => {
    expect(getDeckShareCopyIssue(['known'], () => true)).toEqual({ type: 'size', count: 1 });
    expect(
      getDeckShareCopyIssue(
        Array.from({ length: 20 }, (_, index) => `card_${index}`),
        (id) => id !== 'card_4',
      ),
    ).toEqual({
      type: 'unknown',
      cardIds: ['card_4'],
    });
    expect(
      getDeckShareCopyIssue(
        ['same', 'same', 'same', ...Array.from({ length: 17 }, (_, index) => `card_${index}`)],
        () => true,
      ),
    ).toEqual({
      type: 'copies',
      cardId: 'same',
      count: 3,
    });
  });

  it('supports optimistic like updates, server reconciliation, and rollback', () => {
    const original = share('ds_a');
    const optimistic = applyDeckShareLikeState(original, true);
    expect(optimistic).toMatchObject({ viewerHasLiked: true, likeCount: 3 });
    expect(applyDeckShareLikeState(optimistic, true, 8)).toMatchObject({ viewerHasLiked: true, likeCount: 8 });
    expect(applyDeckShareLikeState(optimistic, false, original.likeCount)).toEqual(original);
  });
});
