import { shuffleDeck } from './cards/deckBuilder';
import { createGameRngState, GAME_RNG_ALGORITHM, nextGameRandom } from './rng';
import type { CardInstance, GameState, PlayerIndex } from './types';

export function createMatchInstanceFactory(player: PlayerIndex): (defId: string) => CardInstance {
  let counter = 0;
  return (defId) => ({
    instanceId: `match:${player}:${++counter}:${defId}`,
    defId,
    faceUp: false,
  });
}

/** Rebuild the canonical opening hands, decks, identities, and RNG position. */
export function rebuildOpeningStateFromManifest(G: GameState): void {
  const manifest = G.replayManifest;
  if (!manifest || manifest.schemaVersion !== 1) throw new Error('Replay manifest schema v1 is required');
  if (manifest.rngAlgorithm !== GAME_RNG_ALGORITHM) {
    throw new Error(`Unsupported replay RNG algorithm: ${manifest.rngAlgorithm}`);
  }
  if (manifest.deckDefIds.some((deck) => deck.length !== 20)) {
    throw new Error('Replay manifest must contain two complete 20-card decks');
  }

  const rng = createGameRngState(manifest.seed);
  for (const player of [0, 1] as const) {
    const instanceFactory = createMatchInstanceFactory(player);
    const shuffled = shuffleDeck(
      manifest.deckDefIds[player].map((defId) => instanceFactory(defId)),
      () => nextGameRandom(rng),
    );
    G.players[player].hand = shuffled.slice(0, 5).map((card) => ({ ...card, faceUp: true }));
    G.players[player].deck = shuffled.slice(5);
  }
  G.rng = rng;
}
