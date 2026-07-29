const CARD_ID_COLLATOR = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
});

export function compareCardIds(left: unknown, right: unknown): number {
  const leftId = String(left || '');
  const rightId = String(right || '');
  return CARD_ID_COLLATOR.compare(leftId, rightId) || (leftId < rightId ? -1 : leftId > rightId ? 1 : 0);
}

export function compareCardsById<T extends { id?: unknown }>(left: T, right: T): number {
  return compareCardIds(left?.id, right?.id);
}

export function sortCardsById<T extends { id?: unknown }>(cards: readonly T[]): T[] {
  return [...cards].sort(compareCardsById);
}
