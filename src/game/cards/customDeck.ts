export const CUSTOM_DECK_NAME = 'custom';
export const CUSTOM_DECK_STORAGE_KEY = 'zutomayo_custom_deck';
export const CUSTOM_DECK_LIBRARY_STORAGE_KEY = 'zutomayo_custom_decks_v2';
export const CUSTOM_DECK_ACTIVE_ID_STORAGE_KEY = 'zutomayo_custom_deck_active_id';
export const CUSTOM_DECK_OPTION_PREFIX = 'custom:';

export interface SavedCustomDeck {
  id: string;
  name: string;
  cardIds: string[];
  updatedAt: string;
}

export interface DeckExportData {
  type: 'zutomayo-card-online.deck';
  version: 1;
  name: string;
  cardIds: string[];
  exportedAt: string;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === 'string');
}

function normalizeDeckName(name: string | undefined): string {
  const trimmed = name?.trim();
  return trimmed || 'Custom Deck';
}

function createDeckId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `deck-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSavedDeck(value: unknown): SavedCustomDeck | null {
  if (!value || typeof value !== 'object') return null;
  const deck = value as Partial<SavedCustomDeck>;
  if (typeof deck.id !== 'string' || !deck.id) return null;
  if (!isStringArray(deck.cardIds)) return null;
  return {
    id: deck.id,
    name: normalizeDeckName(deck.name),
    cardIds: deck.cardIds,
    updatedAt: typeof deck.updatedAt === 'string' ? deck.updatedAt : new Date().toISOString(),
  };
}

function loadLegacyCustomDeckIds(): string[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const data = localStorage.getItem(CUSTOM_DECK_STORAGE_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    if (!isStringArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function loadCustomDeckIds(): string[] | null {
  const activeDeck = loadActiveCustomDeck();
  if (activeDeck) return activeDeck.cardIds;
  const firstDeck = loadSavedCustomDecks()[0];
  if (firstDeck) return firstDeck.cardIds;
  return loadLegacyCustomDeckIds();
}

export function loadSavedCustomDecks(): SavedCustomDeck[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const data = localStorage.getItem(CUSTOM_DECK_LIBRARY_STORAGE_KEY);
    if (!data) {
      const legacyCardIds = loadLegacyCustomDeckIds();
      return legacyCardIds
        ? [
            {
              id: 'legacy-custom',
              name: 'Custom Deck',
              cardIds: legacyCardIds,
              updatedAt: new Date(0).toISOString(),
            },
          ]
        : [];
    }
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeSavedDeck).filter((deck): deck is SavedCustomDeck => Boolean(deck));
  } catch {
    return [];
  }
}

export function loadActiveCustomDeckId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  const activeId = localStorage.getItem(CUSTOM_DECK_ACTIVE_ID_STORAGE_KEY);
  if (activeId && loadSavedCustomDecks().some((deck) => deck.id === activeId)) return activeId;
  return loadSavedCustomDecks()[0]?.id ?? null;
}

export function loadActiveCustomDeck(): SavedCustomDeck | null {
  const activeId = loadActiveCustomDeckId();
  if (!activeId) return null;
  return loadSavedCustomDecks().find((deck) => deck.id === activeId) ?? null;
}

export function setActiveCustomDeckId(deckId: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(CUSTOM_DECK_ACTIVE_ID_STORAGE_KEY, deckId);
}

export function saveCustomDeck(name: string, cardIds: string[], deckId?: string | null): SavedCustomDeck {
  if (typeof localStorage === 'undefined') {
    return {
      id: deckId || createDeckId(),
      name: normalizeDeckName(name),
      cardIds,
      updatedAt: new Date().toISOString(),
    };
  }
  const decks = loadSavedCustomDecks();
  const now = new Date().toISOString();
  const id = deckId && decks.some((deck) => deck.id === deckId) ? deckId : createDeckId();
  const savedDeck: SavedCustomDeck = {
    id,
    name: normalizeDeckName(name),
    cardIds,
    updatedAt: now,
  };
  const nextDecks = [savedDeck, ...decks.filter((deck) => deck.id !== id)];
  localStorage.setItem(CUSTOM_DECK_LIBRARY_STORAGE_KEY, JSON.stringify(nextDecks));
  localStorage.setItem(CUSTOM_DECK_STORAGE_KEY, JSON.stringify(cardIds));
  setActiveCustomDeckId(id);
  return savedDeck;
}

export function removeSavedCustomDecks(deckIds: string[]): SavedCustomDeck[] {
  if (typeof localStorage === 'undefined' || deckIds.length === 0) return loadSavedCustomDecks();
  const removeIds = new Set(deckIds);
  const nextDecks = loadSavedCustomDecks().filter((deck) => !removeIds.has(deck.id));
  localStorage.setItem(CUSTOM_DECK_LIBRARY_STORAGE_KEY, JSON.stringify(nextDecks));

  const activeDeck = nextDecks[0];
  if (activeDeck) localStorage.setItem(CUSTOM_DECK_STORAGE_KEY, JSON.stringify(activeDeck.cardIds));
  else localStorage.removeItem(CUSTOM_DECK_STORAGE_KEY);

  const activeId = localStorage.getItem(CUSTOM_DECK_ACTIVE_ID_STORAGE_KEY);
  if (activeId && removeIds.has(activeId)) {
    const nextActiveId = nextDecks[0]?.id;
    if (nextActiveId) localStorage.setItem(CUSTOM_DECK_ACTIVE_ID_STORAGE_KEY, nextActiveId);
    else localStorage.removeItem(CUSTOM_DECK_ACTIVE_ID_STORAGE_KEY);
  }

  if (nextDecks.length === 0) localStorage.removeItem(CUSTOM_DECK_ACTIVE_ID_STORAGE_KEY);

  return nextDecks;
}

export function customDeckOptionId(deckId: string): string {
  return `${CUSTOM_DECK_OPTION_PREFIX}${deckId}`;
}

export function customDeckIdFromOption(optionId: string): string | null {
  return optionId.startsWith(CUSTOM_DECK_OPTION_PREFIX) ? optionId.slice(CUSTOM_DECK_OPTION_PREFIX.length) : null;
}

export function loadCustomDeckIdsForOption(optionId: string): string[] | null {
  const deckId = customDeckIdFromOption(optionId);
  if (!deckId) return optionId === CUSTOM_DECK_NAME ? loadCustomDeckIds() : null;
  return loadSavedCustomDecks().find((deck) => deck.id === deckId)?.cardIds ?? null;
}

export function createDeckExport(name: string, cardIds: string[]): DeckExportData {
  return {
    type: 'zutomayo-card-online.deck',
    version: 1,
    name: normalizeDeckName(name),
    cardIds,
    exportedAt: new Date().toISOString(),
  };
}

export function parseDeckImport(value: unknown): { name?: string; cardIds: string[] } | null {
  if (isStringArray(value)) return { cardIds: value };
  if (!value || typeof value !== 'object') return null;
  const data = value as { name?: unknown; cardIds?: unknown; deckIds?: unknown };
  const cardIds = isStringArray(data.cardIds) ? data.cardIds : isStringArray(data.deckIds) ? data.deckIds : null;
  if (!cardIds) return null;
  return {
    name: typeof data.name === 'string' ? data.name : undefined,
    cardIds,
  };
}

export function hasStoredCustomDeck(): boolean {
  const candidateDecks = loadSavedCustomDecks();
  const candidates = candidateDecks.length > 0 ? candidateDecks.map((deck) => deck.cardIds) : [loadCustomDeckIds()];
  return candidates.some((ids) => {
    if (!ids || ids.length !== 20) return false;
    const counts = new Map<string, number>();
    for (const id of ids) {
      const count = (counts.get(id) ?? 0) + 1;
      if (count > 2) return false;
      counts.set(id, count);
    }
    return true;
  });
}
