import type { CardDef, CardInstance } from '../types';

let cardMap = new Map<string, CardDef>();
let currentCards: CardDef[] = [];
let currentConfig: Record<string, unknown> = {};
let cardsRefreshPromise: Promise<CardDef[]> | null = null;
let _initialized = false;

export function isCardsInitialized(): boolean {
  return _initialized;
}

/**
 * 從外部載入卡牌數據（遊戲伺服器啟動時呼叫，讀取 cards.json 檔案系統）。
 * 瀏覽器端請使用 loadCardsFromAPI() / refreshCards()。
 */
export function initCards(cards: CardDef[]): void {
  currentCards = cards;
  cardMap.clear();
  for (const card of cards) {
    cardMap.set(card.id, card);
  }
  _initialized = true;
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

/**
 * 從 API 載入卡牌數據。
 * API 不可用時 fallback 到靜態 /cards.json（Vite dev 或 server 提供）。
 */
async function loadCardsFromAPI(): Promise<CardDef[]> {
  // 先試 PG-backed API
  const cards = await fetchJson<unknown>('/api/cards');
  if (isCardDefArray(cards)) {
    initCards(cards);
    return getAllCardDefs();
  }
  // Fallback：靜態 cards.json
  const staticCards = await fetchJson<unknown>('/cards.json');
  if (isCardDefArray(staticCards)) {
    initCards(staticCards);
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
