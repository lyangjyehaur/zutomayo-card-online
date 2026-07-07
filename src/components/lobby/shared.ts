import { type DeckResponse } from '../../api/client';
import type { PlayerIndex, ZutomayoSetupData } from '../../game/types';
import {
  CUSTOM_DECK_NAME,
  customDeckIdFromOption,
  customDeckOptionId,
  loadCustomDeckIdsForOption,
  loadSavedCustomDecks,
} from '../../game/cards/customDeck';
import { PRESET_DECKS } from '../../game/cards/presetDecks';
import { COUNTER_DECK_NAME, isValidConstructedDeck, RANDOM_DECK_NAME } from '../../game/cards/deckBuilder';
import { t } from '../../i18n';

export type DeckOption = {
  id: string;
  name: string;
  description: string;
  synced?: boolean;
  disabled?: boolean;
};

export type DeckOptionGroup = {
  label: string;
  options: DeckOption[];
};

const DECK_COPY: Record<string, { nameKey: Parameters<typeof t>[0]; descKey: Parameters<typeof t>[0] }> = {
  dark: { nameKey: 'deck.dark', descKey: 'deck.darkDesc' },
  flame: { nameKey: 'deck.flame', descKey: 'deck.flameDesc' },
  electric: { nameKey: 'deck.electric', descKey: 'deck.electricDesc' },
  wind: { nameKey: 'deck.wind', descKey: 'deck.windDesc' },
};

export const DEFAULT_DECK_NAME = Object.keys(PRESET_DECKS)[0] ?? '';
const SERVER_DECK_PREFIX = 'server:';

export function serverDeckOptionId(deckId: string): string {
  return `${SERVER_DECK_PREFIX}${deckId}`;
}

export function serverDeckIdFromOption(optionId: string): string | null {
  return optionId.startsWith(SERVER_DECK_PREFIX) ? optionId.slice(SERVER_DECK_PREFIX.length) : null;
}

/**
 * 統一的牌組名稱 sanitization：把不該出現在某脈絡的名稱降級為安全值。
 *
 * - 克制牌組（COUNTER_DECK_NAME）僅 AI 對戰可用，線上/本地對戰 fallback 為隨機牌組。
 * - 自訂牌組（CUSTOM_DECK_NAME）在未解鎖時 fallback 為 undefined（呼叫端各自處理）。
 * - server deck 僅在登入且有對應資料時有效，否則 fallback 為隨機牌組。
 *
 * 抽出此函數是為了解決線上模式繞過 sanitization 導致克制牌組被送進 setupData 的 bug。
 */
export function sanitizeDeckName(
  deckName: string,
  options: { customDeckAvailable?: boolean; allowCounter?: boolean } = {},
): string | undefined {
  const { customDeckAvailable = true, allowCounter = false } = options;
  if (serverDeckIdFromOption(deckName)) return DEFAULT_DECK_NAME;
  if (customDeckIdFromOption(deckName)) return customDeckAvailable ? deckName : undefined;
  if (deckName === CUSTOM_DECK_NAME && !customDeckAvailable) return undefined;
  if (deckName === COUNTER_DECK_NAME && !allowCounter) return RANDOM_DECK_NAME;
  return deckName || undefined;
}

export function selectedDeckName(deckName: string, customDeckAvailable: boolean): string | undefined {
  return sanitizeDeckName(deckName, { customDeckAvailable, allowCounter: false });
}

export function aiOpponentDeckName(deckName: string): string {
  return sanitizeDeckName(deckName || RANDOM_DECK_NAME, { allowCounter: true }) ?? RANDOM_DECK_NAME;
}

export function canStartAI({
  cardsReady,
  deck0Name,
}: {
  cardsReady: boolean;
  deck0Name: string;
  deck1Name?: string;
}): boolean {
  return cardsReady && !!deck0Name;
}

export function onlineDeckName(player: PlayerIndex, deckName: string, serverDecks: DeckResponse[]): ZutomayoSetupData {
  // 線上模式先 sanitization：克制牌組降級為隨機牌組，避免線上對手拿到針對性牌組。
  const safeName = sanitizeDeckName(deckName, { customDeckAvailable: true, allowCounter: false });
  const serverDeckId = serverDeckIdFromOption(deckName);
  if (serverDeckId) {
    const serverDeck = serverDecks.find((deck) => deck.id === serverDeckId);
    if (serverDeck) return player === 0 ? { deck0Ids: serverDeck.cardIds } : { deck1Ids: serverDeck.cardIds };
    return {};
  }
  if (safeName === CUSTOM_DECK_NAME || customDeckIdFromOption(safeName ?? '')) {
    const cardIds = loadCustomDeckIdsForOption(safeName ?? '');
    if (cardIds) return player === 0 ? { deck0Ids: cardIds } : { deck1Ids: cardIds };
    return {};
  }
  if (!safeName) return {};
  return player === 0 ? { deck0Name: safeName } : { deck1Name: safeName };
}

export function buildDeckOptions(customDeckAvailable: boolean): DeckOption[] {
  const presetOptions = Object.entries(PRESET_DECKS).map(([id, deck]) => {
    const copy = DECK_COPY[id];
    return {
      id,
      name: copy ? t(copy.nameKey) : deck.name,
      description: copy ? t(copy.descKey) : deck.name,
    };
  });

  const customDeckOptions = loadSavedCustomDecks()
    .filter((deck) => isValidConstructedDeck(deck.cardIds))
    .map((deck) => ({
      id: customDeckOptionId(deck.id),
      name: deck.name,
      description: t('deck.customDesc'),
    }));

  return [
    {
      id: RANDOM_DECK_NAME,
      name: t('deck.random'),
      description: t('deck.randomDesc'),
    },
    ...presetOptions,
    ...(customDeckOptions.length > 0
      ? customDeckOptions
      : [
          {
            id: CUSTOM_DECK_NAME,
            name: t('deck.custom'),
            description: customDeckAvailable ? t('deck.customDesc') : t('lobby.customDeckLocked'),
            disabled: !customDeckAvailable,
          },
        ]),
  ];
}

/**
 * AI 對手專用牌組選項：移除自訂牌組與伺服器牌組（AI 不該用玩家自訂牌組），新增克制牌組。
 * 克制牌組會在開局時分析玩家牌組特性，從卡池組出克制牌組。
 */
export function buildAIOpponentDeckOptions(): DeckOption[] {
  const presetOptions = Object.entries(PRESET_DECKS).map(([id, deck]) => {
    const copy = DECK_COPY[id];
    return {
      id,
      name: copy ? t(copy.nameKey) : deck.name,
      description: copy ? t(copy.descKey) : deck.name,
    };
  });

  return [
    {
      id: RANDOM_DECK_NAME,
      name: t('deck.random'),
      description: t('deck.randomDesc'),
    },
    {
      id: COUNTER_DECK_NAME,
      name: t('deck.counter'),
      description: t('deck.counterDesc'),
    },
    ...presetOptions,
  ];
}

export function buildServerDeckOptions(serverDecks: DeckResponse[]): DeckOption[] {
  return serverDecks.map((deck) => ({
    id: serverDeckOptionId(deck.id),
    name: deck.name,
    description: t('deck.synced'),
    synced: true,
  }));
}
