const LOCAL_CARD_COLLECTION_KEY = 'zutomayo_card_collection_v1';

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readLocalOwnedCardIds(storage: Storage | null = browserStorage()): string[] {
  if (!storage) return [];
  try {
    const value = JSON.parse(storage.getItem(LOCAL_CARD_COLLECTION_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((cardId): cardId is string => typeof cardId === 'string' && cardId !== ''))].sort();
  } catch {
    return [];
  }
}

export function writeLocalOwnedCardIds(
  cardIds: Iterable<string>,
  storage: Storage | null = browserStorage(),
): string[] {
  const normalized = [...new Set([...cardIds].filter(Boolean))].sort();
  try {
    storage?.setItem(LOCAL_CARD_COLLECTION_KEY, JSON.stringify(normalized));
  } catch {
    // Browsers may deny or exhaust local storage; retain the in-memory UI state.
  }
  return normalized;
}

export function setLocalCardOwned(
  cardId: string,
  owned: boolean,
  storage: Storage | null = browserStorage(),
): string[] {
  const cardIds = new Set(readLocalOwnedCardIds(storage));
  if (owned) cardIds.add(cardId);
  else cardIds.delete(cardId);
  return writeLocalOwnedCardIds(cardIds, storage);
}

export function clearLocalOwnedCardIds(storage: Storage | null = browserStorage()): void {
  try {
    storage?.removeItem(LOCAL_CARD_COLLECTION_KEY);
  } catch {
    // A failed cleanup is harmless; a later merge remains additive and idempotent.
  }
}
