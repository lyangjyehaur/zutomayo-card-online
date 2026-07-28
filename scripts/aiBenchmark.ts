import assert from 'node:assert/strict';
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
import type { ParsedEffect } from '../src/game/effects';
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
import type { CardDef, Element, GameState, PlayerIndex } from '../src/game/types';

export const MATRIX_ARCHETYPES = [
  { id: 'dark', element: '闇' },
  { id: 'flame', element: '炎' },
  { id: 'electric', element: '電気' },
  { id: 'wind', element: '風' },
] as const satisfies readonly { id: string; element: Element }[];

export interface DecisionSample {
  player: PlayerIndex;
  difficulty: AIDifficulty;
  kind: AIDecision<unknown>['kind'];
  durationMs: number;
  fallback?: string;
}

export interface AIMatchOptions {
  deckIds: [readonly string[], readonly string[]];
  difficulties: [AIDifficulty, AIDifficulty];
  seed: string;
  parsedEffects: Map<string, ParsedEffect[]>;
  maximumActions?: number;
}

export interface AIMatchResult {
  seed: string;
  winner: PlayerIndex | null;
  turns: number;
  actions: number;
  reason: string | null;
  finalHp: [number, number];
  mulliganCards: [number, number];
}

export interface RepresentativeDeck {
  id: string;
  element: Element;
  cardIds: string[];
  composition: Record<CardDef['type'], number>;
}

export interface DecisionTimingSummary {
  decisions: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  fallbacks: number;
}

export interface MatrixScheduleEntry {
  lowerDifficulty: 'easy' | 'normal';
  higherDifficulty: 'normal' | 'hard';
  profile0: string;
  profile1: string;
  higherPlayer: PlayerIndex;
  seed: string;
}

export function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, received: ${value}`);
  return parsed;
}

function stableSeededShuffle<T extends { id: string }>(items: readonly T[], seed: string): T[] {
  return seededShuffle(
    [...items].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    createSeededRng(seed),
  );
}

export function buildSoakDeckIds(cards: readonly CardDef[], seed: string): string[] {
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

export function buildRepresentativeDeck(
  cards: readonly CardDef[],
  archetype: (typeof MATRIX_ARCHETYPES)[number],
): RepresentativeDeck {
  const uniqueCards = [...new Map(cards.map((card) => [card.id, card])).values()];
  if (uniqueCards.length < 20) throw new Error('Representative deck requires at least 20 unique playable cards');

  const selected: CardDef[] = [];
  const selectedIds = new Set<string>();
  const take = (type: CardDef['type'], count: number): void => {
    const candidates = stableSeededShuffle(
      uniqueCards.filter((card) => card.type === type && card.element === archetype.element),
      `ai-matrix:${archetype.id}:${type}:element`,
    ).concat(
      stableSeededShuffle(
        uniqueCards.filter((card) => card.type === type && card.element === 'カオス'),
        `ai-matrix:${archetype.id}:${type}:chaos`,
      ),
      stableSeededShuffle(
        uniqueCards.filter(
          (card) => card.type === type && card.element !== archetype.element && card.element !== 'カオス',
        ),
        `ai-matrix:${archetype.id}:${type}:other`,
      ),
    );
    for (const card of candidates) {
      if (selected.length >= 20 || selected.filter((item) => item.type === type).length >= count) break;
      if (selectedIds.has(card.id)) continue;
      selected.push(card);
      selectedIds.add(card.id);
    }
  };

  take('Character', 12);
  take('Enchant', 6);
  take('Area Enchant', 2);

  const fillers = stableSeededShuffle(
    uniqueCards.filter((card) => !selectedIds.has(card.id) && card.element === archetype.element),
    `ai-matrix:${archetype.id}:fill:element`,
  ).concat(
    stableSeededShuffle(
      uniqueCards.filter((card) => !selectedIds.has(card.id) && card.element === 'カオス'),
      `ai-matrix:${archetype.id}:fill:chaos`,
    ),
    stableSeededShuffle(
      uniqueCards.filter(
        (card) => !selectedIds.has(card.id) && card.element !== archetype.element && card.element !== 'カオス',
      ),
      `ai-matrix:${archetype.id}:fill:other`,
    ),
  );
  for (const card of fillers) {
    if (selected.length >= 20) break;
    if (selectedIds.has(card.id)) continue;
    selected.push(card);
    selectedIds.add(card.id);
  }

  if (selected.length !== 20) throw new Error(`Could not build 20-card representative deck for ${archetype.id}`);
  const cardIds = stableSeededShuffle(selected, `ai-matrix:${archetype.id}:order`).map((card) => card.id);
  const composition = Object.fromEntries(
    (['Character', 'Enchant', 'Area Enchant'] as const).map((type) => [
      type,
      selected.filter((card) => card.type === type).length,
    ]),
  ) as RepresentativeDeck['composition'];
  return { id: archetype.id, element: archetype.element, cardIds, composition };
}

export function createMatrixSchedule(profileIds: readonly string[], repetitions: number): MatrixScheduleEntry[] {
  const comparisons = [
    { lower: 'easy', higher: 'normal' },
    { lower: 'normal', higher: 'hard' },
  ] as const;
  const schedule: MatrixScheduleEntry[] = [];
  for (let left = 0; left < profileIds.length; left++) {
    for (let right = left; right < profileIds.length; right++) {
      for (const comparison of comparisons) {
        for (let repetition = 0; repetition < repetitions; repetition++) {
          const pair = `${profileIds[left]}-${profileIds[right]}`;
          schedule.push({
            lowerDifficulty: comparison.lower,
            higherDifficulty: comparison.higher,
            profile0: profileIds[left],
            profile1: profileIds[right],
            higherPlayer: 1,
            seed: `ai-matrix:${comparison.lower}-${comparison.higher}:${pair}:${repetition}:forward`,
          });
          schedule.push({
            lowerDifficulty: comparison.lower,
            higherDifficulty: comparison.higher,
            profile0: profileIds[right],
            profile1: profileIds[left],
            higherPlayer: 0,
            seed: `ai-matrix:${comparison.lower}-${comparison.higher}:${pair}:${repetition}:reverse`,
          });
        }
      }
    }
  }
  return schedule;
}

function recordDecision<T>(
  samples: DecisionSample[],
  player: PlayerIndex,
  difficulty: AIDifficulty,
  decision: AIDecision<T>,
): void {
  samples.push({
    player,
    difficulty,
    kind: decision.kind,
    durationMs: decision.durationMs,
    ...(decision.fallback ? { fallback: decision.fallback } : {}),
  });
}

function matchDecisionSeed(seed: string, G: GameState, player: PlayerIndex, action: number): string {
  return [seed, player, G.step, G.turnNumber, G.jankenDrawCount, G.pendingChoice?.id ?? '', action].join(':');
}

export function playAIMatch(options: AIMatchOptions, samples: DecisionSample[]): AIMatchResult {
  const maximumActions = options.maximumActions ?? 600;
  const orderedDecks = options.deckIds.map((deck, player) =>
    seededShuffle(deck, createSeededRng(`${options.seed}:deck:${player}`)),
  ) as [string[], string[]];
  const G = setupGame(
    { deck0Ids: orderedDecks[0], deck1Ids: orderedDecks[1], skipShuffle: true },
    { allowSkipShuffle: true },
  );
  const mulliganCards: [number, number] = [0, 0];
  let actions = 0;

  while (G.step !== 'gameOver' && actions < maximumActions) {
    const stepBefore = G.step;
    const turnBefore = G.turnNumber;
    const actionBefore = G.actionLog.length;

    if (G.step === 'janken') {
      for (const player of [0, 1] as const) {
        if (G.jankenChoices[player]) continue;
        const difficulty = options.difficulties[player];
        const decision = aiSelectJanken(G, player, difficulty, {
          seed: matchDecisionSeed(options.seed, G, player, actions),
        });
        recordDecision(samples, player, difficulty, decision);
        assert.equal(chooseJanken(G, player, decision.action), true, `janken rejected for player ${player}`);
        actions++;
      }
    } else if (G.step === 'mulligan') {
      for (const player of [0, 1] as const) {
        if (G.mulliganUsed[player]) continue;
        const difficulty = options.difficulties[player];
        const decision = aiSelectMulligan(G, player, difficulty, {
          seed: matchDecisionSeed(options.seed, G, player, actions),
        });
        recordDecision(samples, player, difficulty, decision);
        mulliganCards[player] = decision.action.length;
        assert.equal(finishMulligan(G, player, decision.action), true, `mulligan rejected for player ${player}`);
        actions++;
      }
    } else if (G.pendingChoice) {
      const player = G.pendingChoice.player;
      const difficulty = options.difficulties[player];
      const decision = aiSelectPendingChoice(G, player, difficulty, {
        seed: matchDecisionSeed(options.seed, G, player, actions),
      });
      assert.ok(decision, `AI returned no decision for ${G.pendingChoice.type}`);
      recordDecision(samples, player, difficulty, decision);
      assert.equal(
        submitPendingChoice(G, player, decision.action, options.parsedEffects),
        true,
        `pending choice ${G.pendingChoice?.type ?? 'unknown'} rejected for player ${player}`,
      );
      actions++;
    } else if (G.step === 'effectOrder') {
      const player = G.pendingEffectPlayer;
      assert.notEqual(player, null, 'effectOrder requires pendingEffectPlayer');
      const difficulty = options.difficulties[player!];
      const decision = aiSelectEffect(G, player!, difficulty, {
        seed: matchDecisionSeed(options.seed, G, player!, actions),
      });
      assert.ok(decision, `AI returned no effect decision for player ${player}`);
      recordDecision(samples, player!, difficulty, decision);
      assert.equal(
        resolvePendingEffect(G, player!, decision.action, options.parsedEffects),
        true,
        `effect ${decision.action} rejected for player ${player}`,
      );
      actions++;
    } else if (G.step === 'initialSet' || G.step === 'turnSet') {
      for (const player of [0, 1] as const) {
        if (G.step !== 'initialSet' && G.step !== 'turnSet') break;
        if (G.ready[player]) continue;
        const placementStep: 'initialSet' | 'turnSet' = G.step;
        const difficulty = options.difficulties[player];
        const decision = aiPlanTurn(G, player, difficulty, {
          seed: matchDecisionSeed(options.seed, G, player, actions),
        });
        recordDecision(samples, player, difficulty, decision);
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
        assert.equal(confirmReady(G, player, options.parsedEffects), true, `ready rejected for player ${player}`);
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
    seed: options.seed,
    winner: G.winner,
    turns: G.turnNumber,
    actions,
    reason: G.gameoverReason,
    finalHp: [G.players[0].hp, G.players[1].hp],
    mulliganCards,
  };
}

export function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

export function summarizeDecisionTiming(samples: readonly DecisionSample[]): DecisionTimingSummary {
  const durations = samples.map((sample) => sample.durationMs);
  return {
    decisions: durations.length,
    p50Ms: Number(percentile(durations, 0.5).toFixed(2)),
    p95Ms: Number(percentile(durations, 0.95).toFixed(2)),
    p99Ms: Number(percentile(durations, 0.99).toFixed(2)),
    maxMs: Number(Math.max(0, ...durations).toFixed(2)),
    fallbacks: samples.filter((sample) => sample.fallback).length,
  };
}
