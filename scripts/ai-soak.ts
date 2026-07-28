import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  aiPlanTurn,
  aiSelectEffect,
  aiSelectJanken,
  aiSelectMulligan,
  aiSelectPendingChoice,
  createSeededRng,
  seededShuffle,
  type AIDecision,
  type AIDifficulty,
} from '../src/game/ai';
import { getAllCardDefs, initCards } from '../src/game/cards/loader';
import { parseAllEffects } from '../src/game/effects';
import {
  chooseJanken,
  confirmReady,
  finishMulligan,
  resolvePendingEffect,
  setInitialCard,
  setTurnCard,
  setupGame,
  submitPendingChoice,
} from '../src/game/GameLogic';
import type { CardDef, GameState, PlayerIndex } from '../src/game/types';
import { loadCardsForScript } from './cardSource';

const difficulties: AIDifficulty[] = ['easy', 'normal', 'hard'];
const gamesPerDifficulty = positiveInteger(process.env.AI_SOAK_GAMES, 12);
const maximumActions = positiveInteger(process.env.AI_SOAK_MAX_ACTIONS, 600);
const cardFile = process.env.AI_SOAK_CARD_FILE;

interface DecisionSample {
  difficulty: AIDifficulty;
  kind: AIDecision<unknown>['kind'];
  durationMs: number;
  fallback?: string;
}

interface MatchResult {
  difficulty: AIDifficulty;
  seed: string;
  winner: PlayerIndex | null;
  turns: number;
  actions: number;
  reason: string | null;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, received: ${value}`);
  return parsed;
}

async function loadCards(): Promise<CardDef[]> {
  if (!cardFile) return loadCardsForScript();
  const source = JSON.parse(await readFile(resolve(cardFile), 'utf8')) as CardDef[] | { cards?: CardDef[] };
  const cards = Array.isArray(source) ? source : source.cards;
  if (!Array.isArray(cards) || cards.length === 0) throw new Error(`No cards found in ${cardFile}`);
  return cards;
}

function buildDeckIds(cards: readonly CardDef[], seed: string): string[] {
  const rng = createSeededRng(seed);
  const characters = seededShuffle(
    cards.filter((card) => card.type === 'Character'),
    rng,
  );
  const enchants = seededShuffle(
    cards.filter((card) => card.type === 'Enchant'),
    rng,
  );
  const areas = seededShuffle(
    cards.filter((card) => card.type === 'Area Enchant'),
    rng,
  );
  const selected = [...characters.slice(0, 12), ...enchants.slice(0, 6), ...areas.slice(0, 2)];
  const selectedIds = new Set(selected.map((card) => card.id));
  if (selected.length < 20) {
    selected.push(
      ...seededShuffle(
        cards.filter((card) => !selectedIds.has(card.id)),
        rng,
      ).slice(0, 20 - selected.length),
    );
  }
  assert.equal(selected.length, 20, 'card pool must contain at least 20 unique playable cards');
  return seededShuffle(selected, rng).map((card) => card.id);
}

function recordDecision<T>(samples: DecisionSample[], difficulty: AIDifficulty, decision: AIDecision<T>): void {
  samples.push({
    difficulty,
    kind: decision.kind,
    durationMs: decision.durationMs,
    ...(decision.fallback ? { fallback: decision.fallback } : {}),
  });
}

function decisionSeed(seed: string, G: GameState, player: PlayerIndex, action: number): string {
  return [seed, player, G.step, G.turnNumber, G.jankenDrawCount, G.pendingChoice?.id ?? '', action].join(':');
}

function playMatch(
  cards: readonly CardDef[],
  difficulty: AIDifficulty,
  seed: string,
  samples: DecisionSample[],
): MatchResult {
  const G = setupGame(
    {
      deck0Ids: buildDeckIds(cards, `${seed}:deck:0`),
      deck1Ids: buildDeckIds(cards, `${seed}:deck:1`),
      skipShuffle: true,
    },
    { allowSkipShuffle: true },
  );
  const parsedEffects = parseAllEffects(getAllCardDefs().map(({ id, effect }) => ({ id, effect })));
  let actions = 0;

  while (G.step !== 'gameOver' && actions < maximumActions) {
    const stepBefore = G.step;
    const turnBefore = G.turnNumber;
    const actionBefore = G.actionLog.length;

    if (G.step === 'janken') {
      for (const player of [0, 1] as const) {
        if (G.jankenChoices[player]) continue;
        const decision = aiSelectJanken(G, player, difficulty, {
          seed: decisionSeed(seed, G, player, actions),
        });
        recordDecision(samples, difficulty, decision);
        assert.equal(chooseJanken(G, player, decision.action), true, `janken rejected for player ${player}`);
        actions++;
      }
    } else if (G.step === 'mulligan') {
      for (const player of [0, 1] as const) {
        if (G.mulliganUsed[player]) continue;
        const decision = aiSelectMulligan(G, player, difficulty, {
          seed: decisionSeed(seed, G, player, actions),
        });
        recordDecision(samples, difficulty, decision);
        assert.equal(finishMulligan(G, player, decision.action), true, `mulligan rejected for player ${player}`);
        actions++;
      }
    } else if (G.pendingChoice) {
      const player = G.pendingChoice.player;
      const decision = aiSelectPendingChoice(G, player, difficulty, {
        seed: decisionSeed(seed, G, player, actions),
      });
      assert.ok(decision, `AI returned no decision for ${G.pendingChoice.type}`);
      recordDecision(samples, difficulty, decision);
      assert.equal(
        submitPendingChoice(G, player, decision.action, parsedEffects),
        true,
        `pending choice ${G.pendingChoice?.type ?? 'unknown'} rejected for player ${player}`,
      );
      actions++;
    } else if (G.step === 'effectOrder') {
      const player = G.pendingEffectPlayer;
      assert.notEqual(player, null, 'effectOrder requires pendingEffectPlayer');
      const decision = aiSelectEffect(G, player!, difficulty, {
        seed: decisionSeed(seed, G, player!, actions),
      });
      assert.ok(decision, `AI returned no effect decision for player ${player}`);
      recordDecision(samples, difficulty, decision);
      assert.equal(
        resolvePendingEffect(G, player!, decision.action, parsedEffects),
        true,
        `effect ${decision.action} rejected for player ${player}`,
      );
      actions++;
    } else if (G.step === 'initialSet' || G.step === 'turnSet') {
      for (const player of [0, 1] as const) {
        if (G.step !== 'initialSet' && G.step !== 'turnSet') break;
        if (G.ready[player]) continue;
        const placementStep: 'initialSet' | 'turnSet' = G.step;
        const decision = aiPlanTurn(G, player, difficulty, {
          seed: decisionSeed(seed, G, player, actions),
        });
        recordDecision(samples, difficulty, decision);
        assert.ok(decision.action.selections.length > 0, `AI returned an empty required plan for player ${player}`);
        for (const selection of decision.action.selections) {
          const handIndex = G.players[player].hand.findIndex((card) => card.instanceId === selection.cardInstanceId);
          assert.notEqual(handIndex, -1, `planned card ${selection.cardInstanceId} is no longer in hand`);
          const placed: boolean =
            placementStep === 'initialSet'
              ? setInitialCard(G, player, handIndex)
              : setTurnCard(G, player, handIndex, selection.slot);
          assert.equal(placed, true, `planned ${selection.slot} placement rejected for player ${player}`);
          actions++;
        }
        assert.equal(confirmReady(G, player, parsedEffects), true, `ready rejected for player ${player}`);
        actions++;
      }
    } else {
      assert.fail(`Unhandled game step: ${G.step}`);
    }

    assert.ok(
      G.step !== stepBefore || G.turnNumber !== turnBefore || G.actionLog.length !== actionBefore,
      `game made no progress at ${G.step} on turn ${G.turnNumber}`,
    );
  }

  assert.equal(G.step, 'gameOver', `match exceeded ${maximumActions} actions at ${G.step}, turn ${G.turnNumber}`);
  assert.equal(G.pendingChoice, null, 'completed match retained pendingChoice');
  assert.equal(G.pendingEffectPlayer, null, 'completed match retained pendingEffectPlayer');
  assert.deepEqual(G.pendingEffects, [[], []], 'completed match retained pendingEffects');
  return {
    difficulty,
    seed,
    winner: G.winner,
    turns: G.turnNumber,
    actions,
    reason: G.gameoverReason,
  };
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

const cards = await loadCards();
initCards(cards);
const samples: DecisionSample[] = [];
const matches: MatchResult[] = [];
const failures: { difficulty: AIDifficulty; seed: string; error: string }[] = [];

for (const difficulty of difficulties) {
  for (let index = 0; index < gamesPerDifficulty; index++) {
    const seed = `ai-soak:${difficulty}:${index}`;
    try {
      matches.push(playMatch(cards, difficulty, seed, samples));
    } catch (error) {
      failures.push({ difficulty, seed, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

const timing = Object.fromEntries(
  difficulties.map((difficulty) => {
    const durations = samples.filter((sample) => sample.difficulty === difficulty).map((sample) => sample.durationMs);
    return [
      difficulty,
      {
        decisions: durations.length,
        p50Ms: Number(percentile(durations, 0.5).toFixed(2)),
        p95Ms: Number(percentile(durations, 0.95).toFixed(2)),
        p99Ms: Number(percentile(durations, 0.99).toFixed(2)),
        maxMs: Number(Math.max(0, ...durations).toFixed(2)),
        fallbacks: samples.filter((sample) => sample.difficulty === difficulty && sample.fallback).length,
      },
    ];
  }),
);

console.log(
  JSON.stringify(
    {
      cards: cards.length,
      requestedMatches: gamesPerDifficulty * difficulties.length,
      completedMatches: matches.length,
      failures,
      timing,
      matchSummary: Object.fromEntries(
        difficulties.map((difficulty) => {
          const completed = matches.filter((match) => match.difficulty === difficulty);
          return [
            difficulty,
            {
              completed: completed.length,
              averageTurns: Number(
                (completed.reduce((sum, match) => sum + match.turns, 0) / Math.max(1, completed.length)).toFixed(2),
              ),
              draws: completed.filter((match) => match.winner === null).length,
            },
          ];
        }),
      ),
    },
    null,
    2,
  ),
);

if (failures.length > 0) process.exitCode = 1;
