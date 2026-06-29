import { type DeckResponse } from '../../api/client';
import type { PlayerIndex, ZutomayoSetupData } from '../../game/types';
import { CUSTOM_DECK_NAME, loadCustomDeckIds } from '../../game/cards/customDeck';
import { PRESET_DECKS } from '../../game/cards/presetDecks';
import { RANDOM_DECK_NAME } from '../../game/cards/deckBuilder';
import { t } from '../../i18n';

export type DeckOption = {
  id: string;
  name: string;
  description: string;
  previewIds: string[];
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

export function selectedDeckName(deckName: string, customDeckAvailable: boolean): string | undefined {
  if (serverDeckIdFromOption(deckName)) return DEFAULT_DECK_NAME;
  if (deckName === CUSTOM_DECK_NAME && !customDeckAvailable) return DEFAULT_DECK_NAME;
  return deckName || undefined;
}

export function onlineDeckName(player: PlayerIndex, deckName: string, serverDecks: DeckResponse[]): ZutomayoSetupData {
  const serverDeckId = serverDeckIdFromOption(deckName);
  if (serverDeckId) {
    const serverDeck = serverDecks.find((deck) => deck.id === serverDeckId);
    if (serverDeck) return player === 0 ? { deck0Ids: serverDeck.cardIds } : { deck1Ids: serverDeck.cardIds };
    return player === 0 ? { deck0Name: DEFAULT_DECK_NAME } : { deck1Name: DEFAULT_DECK_NAME };
  }
  const selectedName = deckName === CUSTOM_DECK_NAME ? DEFAULT_DECK_NAME : deckName;
  if (!selectedName) return {};
  return player === 0 ? { deck0Name: selectedName } : { deck1Name: selectedName };
}

export function buildDeckOptions(customDeckAvailable: boolean): DeckOption[] {
  const presetOptions = Object.entries(PRESET_DECKS).map(([id, deck]) => {
    const copy = DECK_COPY[id];
    return {
      id,
      name: copy ? t(copy.nameKey) : deck.name,
      description: copy ? t(copy.descKey) : deck.name,
      previewIds: deck.ids.slice(0, 3),
    };
  });

  return [
    {
      id: RANDOM_DECK_NAME,
      name: t('deck.random'),
      description: t('deck.randomDesc'),
      previewIds: [],
    },
    ...presetOptions,
    {
      id: CUSTOM_DECK_NAME,
      name: t('deck.custom'),
      description: customDeckAvailable ? t('deck.customDesc') : t('lobby.customDeckLocked'),
      previewIds: loadCustomDeckIds()?.slice(0, 3) ?? presetOptions[0]?.previewIds ?? [],
      disabled: !customDeckAvailable,
    },
  ];
}

export function buildServerDeckOptions(serverDecks: DeckResponse[]): DeckOption[] {
  return serverDecks.map((deck) => ({
    id: serverDeckOptionId(deck.id),
    name: deck.name,
    description: t('deck.synced'),
    previewIds: deck.cardIds.slice(0, 3),
    synced: true,
  }));
}
