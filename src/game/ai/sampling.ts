import { getAllCardDefs } from '../cards/loader';
import type { CardInstance, GameState, PlayerIndex } from '../types';
import { createSeededRng, seededShuffle } from './rng';
import type { AIKnowledgeState } from './types';

const HIDDEN_DEF_ID = '__hidden__';
let playablePoolSignature = '';
let playablePool: string[] = [];

function legalCardPool(): readonly string[] {
  const cards = getAllCardDefs();
  const signature = cards.map((card) => `${card.id}:${card.playStatus ?? 'playable'}`).join('|');
  if (signature !== playablePoolSignature) {
    playablePool = cards
      .filter((card) => card.playStatus === undefined || card.playStatus === 'playable')
      .sort((left, right) => left.id.localeCompare(right.id))
      .flatMap((card) => [card.id, card.id]);
    playablePoolSignature = signature;
  }
  return playablePool;
}

function publicOpponentDefIds(knowledge: AIKnowledgeState): string[] {
  const opponent = knowledge.game.players[knowledge.opponent];
  const cards = [
    ...opponent.hand,
    ...opponent.deck,
    ...opponent.powerCharger,
    ...opponent.abyss,
    opponent.battleZone,
    opponent.setZoneA,
    opponent.setZoneB,
    opponent.setZoneC,
  ];
  return cards.flatMap((card) => (card && card.defId !== HIDDEN_DEF_ID ? [card.defId] : []));
}

function opponentSamplePool(knowledge: AIKnowledgeState, seed: string): string[] {
  const copies = new Map<string, number>();
  for (const defId of publicOpponentDefIds(knowledge)) copies.set(defId, (copies.get(defId) ?? 0) + 1);
  const retained = new Map<string, number>();
  const candidates = legalCardPool().filter((defId) => {
    const count = retained.get(defId) ?? 0;
    retained.set(defId, count + 1);
    return count + (copies.get(defId) ?? 0) < 2;
  });
  return seededShuffle(candidates, createSeededRng(`${seed}|opponent-pool`));
}

function materializeCards(
  cards: CardInstance[],
  definitions: readonly string[],
  assignments: Map<string, string>,
  cursor: { value: number },
): void {
  for (const card of cards) {
    if (card.defId !== HIDDEN_DEF_ID) continue;
    let defId = assignments.get(card.instanceId);
    if (!defId) {
      defId = definitions[cursor.value % definitions.length];
      cursor.value += 1;
      if (!defId) continue;
      assignments.set(card.instanceId, defId);
    }
    card.defId = defId;
  }
}

function playerCards(G: GameState, player: PlayerIndex): CardInstance[][] {
  const state = G.players[player];
  return [
    state.deck,
    state.hand,
    state.battleZone ? [state.battleZone] : [],
    state.setZoneA ? [state.setZoneA] : [],
    state.setZoneB ? [state.setZoneB] : [],
    state.setZoneC ? [state.setZoneC] : [],
    state.powerCharger,
    state.abyss,
    G.setCardsThisTurn[player],
    G.swappedCardsThisTurn[player],
  ];
}

export function hasUnknownOpponentCommitment(knowledge: AIKnowledgeState): boolean {
  const state = knowledge.game.players[knowledge.opponent];
  return [state.battleZone, state.setZoneA, state.setZoneB].some((card) => card?.defId === HIDDEN_DEF_ID);
}

/** Materializes a simulation state from information available to the AI only. */
export function sampleUnknownState(
  knowledge: AIKnowledgeState,
  decisionSeed: string | number,
  planToken: string,
  sampleIndex: number,
): AIKnowledgeState {
  const seed = `${decisionSeed}|${knowledge.visibleStateKey}|${planToken}|${sampleIndex}`;
  const game = structuredClone(knowledge.game) as GameState;

  const ownDefinitions = seededShuffle(knowledge.knownOwnDeckDefIds, createSeededRng(`${seed}|own-deck`));
  materializeCards(game.players[knowledge.player].deck, ownDefinitions, new Map(), { value: 0 });
  game.players[knowledge.player].knownDeckDefIds = undefined;

  const opponentDefinitions = opponentSamplePool(knowledge, seed);
  const opponentAssignments = new Map<string, string>();
  const opponentCursor = { value: 0 };
  for (const cards of playerCards(game, knowledge.opponent)) {
    materializeCards(cards, opponentDefinitions, opponentAssignments, opponentCursor);
  }

  return { ...knowledge, game };
}
