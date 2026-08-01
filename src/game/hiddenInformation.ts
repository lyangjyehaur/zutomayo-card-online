import type { GameState } from './types';

/** Grand Rules 10.3/10.4: private-zone cards return to hidden state after effect resolution. */
export function restoreHiddenInformation(G: GameState): void {
  for (const player of G.players) {
    for (const card of player.deck) card.faceUp = false;
  }
  G.revealedHandCardIds = [[], []];
}
