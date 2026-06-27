import type { CardDef, CardInstance } from '../types';
import cardsData from '../../../cards.json';

const STATIC_CARDS = cardsData as CardDef[];

const cardMap = new Map<string, CardDef>();
let currentCards: CardDef[] = STATIC_CARDS;
let currentConfig: Record<string, unknown> = {};
let cardsRefreshPromise: Promise<CardDef[]> | null = null;

function replaceCards(cards: CardDef[]): void {
  currentCards = cards;
  cardMap.clear();
  for (const card of cards) {
    cardMap.set(card.id, card);
  }
}

function isCardDefArray(value: unknown): value is CardDef[] {
  return (
    Array.isArray(value) &&
    value.every((card) =>
      Boolean(card && typeof card === 'object' && typeof (card as { id?: unknown }).id === 'string'),
    )
  );
}

async function fetchJson<T>(path: string): Promise<T | null> {
  if (typeof fetch === 'undefined') return null;
  try {
    const response = await fetch(path, { cache: 'force-cache' });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

replaceCards(STATIC_CARDS);

export async function loadCardsFromAPI(): Promise<CardDef[]> {
  const cards = await fetchJson<unknown>('/api/cards');
  if (isCardDefArray(cards)) {
    replaceCards(cards);
  }
  return getAllCardDefs();
}

export async function loadConfigFromAPI(): Promise<Record<string, unknown>> {
  const config = await fetchJson<unknown>('/api/config');
  if (config && typeof config === 'object' && !Array.isArray(config)) {
    currentConfig = config as Record<string, unknown>;
  }
  return currentConfig;
}

export async function refreshCards(): Promise<CardDef[]> {
  cardsRefreshPromise ??= loadCardsFromAPI().finally(() => {
    cardsRefreshPromise = null;
  });
  return cardsRefreshPromise;
}

export function getGameConfig(): Record<string, unknown> {
  return currentConfig;
}

export function getCardDef(id: string): CardDef | undefined {
  return cardMap.get(id);
}

export function getAllCardDefs(): CardDef[] {
  return [...currentCards];
}

export function getCardsByPack(pack: string): CardDef[] {
  return currentCards.filter((c) => c.pack === pack);
}

// Create a CardInstance from a CardDef
let instanceCounter = 0;

export function createInstance(defId: string, faceUp = false): CardInstance {
  return {
    instanceId: `inst_${defId}_${++instanceCounter}`,
    defId,
    faceUp,
  };
}

// Reset counter (for testing)
export function resetInstanceCounter(): void {
  instanceCounter = 0;
}
