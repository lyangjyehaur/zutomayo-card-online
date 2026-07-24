import type { DeckShareSort, DeckShareSummary } from './api/client';
import type { TranslationKey } from './i18n';

export const DECK_SHARE_SORTS: DeckShareSort[] = ['popular', 'newest', 'most-copied'];
export const DECK_SHARE_ELEMENTS = ['', '闇', '炎', '電気', '風', 'カオス'] as const;
const DECK_SHARE_ELEMENT_KEYS: Record<string, TranslationKey> = {
  闇: 'card.element.dark',
  炎: 'card.element.flame',
  電気: 'card.element.electric',
  風: 'card.element.wind',
  カオス: 'card.element.chaos',
};

export function deckShareElementLabel(element: string, translate: (key: TranslationKey) => string): string {
  const key = DECK_SHARE_ELEMENT_KEYS[element];
  return key ? translate(key) : element;
}

export interface DeckShareLobbyState {
  sort: DeckShareSort;
  element: string;
  query: string;
}

export function readDeckShareLobbyState(searchParams: URLSearchParams): DeckShareLobbyState {
  const requestedSort = searchParams.get('sort') as DeckShareSort;
  const requestedElement = searchParams.get('element') || '';
  return {
    sort: DECK_SHARE_SORTS.includes(requestedSort) ? requestedSort : 'popular',
    element: DECK_SHARE_ELEMENTS.includes(requestedElement as (typeof DECK_SHARE_ELEMENTS)[number])
      ? requestedElement
      : '',
    query: (searchParams.get('q') || '').slice(0, 120),
  };
}

export function updateDeckShareSearchParam(current: URLSearchParams, key: string, value: string): URLSearchParams {
  const next = new URLSearchParams(current);
  if (value) next.set(key, value);
  else next.delete(key);
  return next;
}

export function mergeDeckSharePages(current: DeckShareSummary[], incoming: DeckShareSummary[]): DeckShareSummary[] {
  const ids = new Set(current.map((share) => share.id));
  return [...current, ...incoming.filter((share) => !ids.has(share.id))];
}

export type DeckShareCopyIssue =
  | { type: 'size'; count: number }
  | { type: 'copies'; cardId: string; count: number }
  | { type: 'unknown'; cardIds: string[] };

export function getDeckShareCopyIssue(
  cardIds: string[],
  isKnownCard: (cardId: string) => boolean,
): DeckShareCopyIssue | null {
  if (cardIds.length !== 20) return { type: 'size', count: cardIds.length };
  const unknownCardIds = [...new Set(cardIds.filter((cardId) => !isKnownCard(cardId)))];
  if (unknownCardIds.length > 0) return { type: 'unknown', cardIds: unknownCardIds };
  const counts = new Map<string, number>();
  for (const cardId of cardIds) {
    const count = (counts.get(cardId) ?? 0) + 1;
    if (count > 2) return { type: 'copies', cardId, count };
    counts.set(cardId, count);
  }
  return null;
}

export function applyDeckShareLikeState<T extends Pick<DeckShareSummary, 'viewerHasLiked' | 'likeCount'>>(
  share: T,
  liked: boolean,
  likeCount?: number,
): T {
  const optimisticCount = Math.max(0, share.likeCount + (liked === share.viewerHasLiked ? 0 : liked ? 1 : -1));
  return {
    ...share,
    viewerHasLiked: liked,
    likeCount: likeCount === undefined ? optimisticCount : Math.max(0, likeCount),
  };
}
