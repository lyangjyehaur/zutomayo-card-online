import { ZutomayoCard, resetParsedEffects } from '../Game';
import { TURN_TIMER_MS, setupGame } from '../GameLogic';
import { initCards } from '../cards/loader';
import type { CardDef, GameState, PlayerIndex, ReplayDecisionRecord, ReplayManifest, ReplayMoveName } from '../types';

export interface ReplayGoldenScenario {
  name: string;
  category: 'engine' | 'full-flow';
  manifest: ReplayManifest;
  decisions: ReplayDecisionRecord[];
}

function goldenCard(index: number): CardDef {
  const attack = 10 + (index % 5) * 10;
  return {
    id: `golden-character-${String(index).padStart(2, '0')}`,
    name: `Golden Character ${index}`,
    pack: 'replay-golden-v1',
    song: 'test',
    illustrator: 'test',
    rarity: 'N',
    element: index % 2 === 0 ? '闇' : '炎',
    type: 'Character',
    clock: index % 3,
    attack: { night: attack, day: 60 - attack },
    powerCost: 0,
    sendToPower: 0,
    effect: '',
    image: '',
    errata: '',
  };
}

const goldenCards = Array.from({ length: 20 }, (_, index) => goldenCard(index));
const goldenDeckIds = goldenCards.map((card) => card.id);

function runMove(G: GameState, move: ReplayMoveName, player: PlayerIndex, ...args: unknown[]): void {
  const registered = ZutomayoCard.moves?.[move] as unknown as {
    move: (context: { G: GameState; playerID: string }, ...moveArgs: unknown[]) => unknown;
  };
  if (!registered || typeof registered.move !== 'function')
    throw new Error(`Replay golden move ${move} is not registered`);
  if (registered.move({ G, playerID: String(player) }, ...args) === 'INVALID_MOVE') {
    throw new Error(`Replay golden move ${move} was rejected for player ${player}`);
  }
}

function createGame(seed: number): GameState {
  return setupGame(
    { deck0Ids: goldenDeckIds, deck1Ids: goldenDeckIds, rngSeed: seed },
    { allowBrowserCustomDeckName: true },
  );
}

function completeOpening(G: GameState, mulligan = false): void {
  runMove(G, 'janken', 0, 'rock');
  runMove(G, 'janken', 1, 'scissors');
  if (mulligan) runMove(G, 'mulligan', 0, [0, 2]);
  else runMove(G, 'keepHand', 0);
  runMove(G, 'keepHand', 1);
  runMove(G, 'setInitialCard', 0, 0);
  runMove(G, 'setInitialCard', 1, 0);
  runMove(G, 'confirmReady', 0);
  runMove(G, 'confirmReady', 1);
  if (G.step !== 'turnSet') throw new Error('Replay golden opening did not reach turnSet');
}

function finishMatch(G: GameState): void {
  let turns = 0;
  while (G.step !== 'gameOver' && turns < 40) {
    if (G.step !== 'turnSet') throw new Error(`Replay golden full flow stopped at ${G.step}`);
    runMove(G, 'setTurnCard', 0, 0, 'A');
    runMove(G, 'setTurnCard', 1, 0, 'A');
    runMove(G, 'confirmReady', 0);
    runMove(G, 'confirmReady', 1);
    turns += 1;
  }
  if (G.step !== 'gameOver') throw new Error('Replay golden full flow exceeded 40 turns');
}

function scenario(name: string, category: ReplayGoldenScenario['category'], G: GameState): ReplayGoldenScenario {
  if (!G.replayManifest || !G.decisionTrace) throw new Error(`Replay golden scenario ${name} has no replay inputs`);
  return {
    name,
    category,
    manifest: structuredClone(G.replayManifest),
    decisions: structuredClone(G.decisionTrace),
  };
}

export function buildReplayGoldenScenarios(): ReplayGoldenScenario[] {
  initCards(goldenCards);
  resetParsedEffects();

  const mulliganOpening = createGame(0x10203040);
  completeOpening(mulliganOpening, true);

  const timeoutRng = createGame(0x55667788);
  timeoutRng.interactionStartTime = Date.now() - TURN_TIMER_MS - 1;
  runMove(timeoutRng, 'timeoutAdvance', 0);

  const fullMatch = createGame(0x90abcdef);
  completeOpening(fullMatch);
  finishMatch(fullMatch);

  return [
    scenario('engine-mulligan-opening', 'engine', mulliganOpening),
    scenario('engine-timeout-rng', 'engine', timeoutRng),
    scenario('full-flow-match', 'full-flow', fullMatch),
  ];
}
