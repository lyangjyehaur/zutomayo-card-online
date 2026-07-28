import type { ZutomayoSetupData } from '../game/types';
import type { AppVersionInfo } from '../version';

type InitialCard = { defId?: unknown };
type InitialPlayer = { deck?: unknown; hand?: unknown };
type InitialMatchState = { G?: { players?: unknown } };
type MatchMetadata = { setupData?: unknown };

function cardIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((card) => (card && typeof card === 'object' ? (card as InitialCard).defId : undefined))
    .filter((defId): defId is string => typeof defId === 'string' && defId.length > 0);
}

function playerDeckIds(initialState: InitialMatchState, playerIndex: 0 | 1): string[] {
  const players = initialState.G?.players;
  const player = Array.isArray(players) ? (players[playerIndex] as InitialPlayer | undefined) : undefined;
  if (!player) return [];
  return [...cardIds(player.deck), ...cardIds(player.hand)];
}

function optionalVersion(setupData: Record<string, unknown>, key: 'deck0Version' | 'deck1Version'): string | undefined {
  const value = setupData[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function createOnlineRematchSetupData(
  initialState: InitialMatchState,
  metadata: MatchMetadata,
  clientVersion: AppVersionInfo,
  rulesVersion: string,
): ZutomayoSetupData {
  const deck0Ids = playerDeckIds(initialState, 0);
  const deck1Ids = playerDeckIds(initialState, 1);
  if (deck0Ids.length !== 20 || deck1Ids.length !== 20) {
    throw new Error('Previous match decks are incomplete');
  }

  const previousSetup =
    metadata.setupData && typeof metadata.setupData === 'object' && !Array.isArray(metadata.setupData)
      ? (metadata.setupData as Record<string, unknown>)
      : {};
  return {
    deck0Ids,
    deck1Ids,
    deck0Version: optionalVersion(previousSetup, 'deck0Version'),
    deck1Version: optionalVersion(previousSetup, 'deck1Version'),
    rulesVersion,
    clientVersion,
  };
}
