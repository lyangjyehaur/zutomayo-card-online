import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AIDifficulty } from '../src/game/ai';
import { initCards } from '../src/game/cards/loader';
import { parseAllEffects } from '../src/game/effects';
import type { CardDef, PlayerIndex } from '../src/game/types';
import {
  MATRIX_ARCHETYPES,
  buildRepresentativeDeck,
  createMatrixSchedule,
  playAIMatch,
  positiveInteger,
  summarizeDecisionTiming,
  type AIMatchResult,
  type DecisionSample,
  type MatrixScheduleEntry,
} from './aiBenchmark';
import { loadCardsForScript } from './cardSource';

const repetitions = positiveInteger(process.env.AI_MATRIX_GAMES, 1);
const maximumActions = positiveInteger(process.env.AI_MATRIX_MAX_ACTIONS, 600);
const cardFile = process.env.AI_MATRIX_CARD_FILE;

interface CompletedMatrixMatch {
  schedule: MatrixScheduleEntry;
  result: AIMatchResult;
}

async function loadCards(): Promise<CardDef[]> {
  if (!cardFile) return loadCardsForScript();
  const source = JSON.parse(await readFile(resolve(cardFile), 'utf8')) as CardDef[] | { cards?: CardDef[] };
  const cards = Array.isArray(source) ? source : source.cards;
  if (!Array.isArray(cards) || cards.length === 0) throw new Error(`No cards found in ${cardFile}`);
  return cards;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function matchupSummary(matches: readonly CompletedMatrixMatch[]) {
  const higherWins = matches.filter(({ schedule, result }) => result.winner === schedule.higherPlayer).length;
  const lowerWins = matches.filter(
    ({ schedule, result }) => result.winner === ((1 - schedule.higherPlayer) as PlayerIndex),
  ).length;
  const playerDecisions = matches.length * 2;
  const mulliganCounts = matches.flatMap(({ result }) => result.mulliganCards);
  return {
    completed: matches.length,
    higherDifficultyWins: higherWins,
    lowerDifficultyWins: lowerWins,
    draws: matches.length - higherWins - lowerWins,
    firstPlayerWins: matches.filter(({ result }) => result.winner === 0).length,
    averageTurns: mean(matches.map(({ result }) => result.turns)),
    averageHigherDifficultyHpDelta: mean(
      matches.map(({ schedule, result }) => {
        const lowerPlayer = (1 - schedule.higherPlayer) as PlayerIndex;
        return result.finalHp[schedule.higherPlayer] - result.finalHp[lowerPlayer];
      }),
    ),
    mulliganPlayerRate: round(mulliganCounts.filter((count) => count > 0).length / Math.max(1, playerDecisions)),
    averageCardsRedrawn: mean(mulliganCounts),
  };
}

const cards = await loadCards();
initCards(cards);
const parsedEffects = parseAllEffects(cards.map(({ id, effect }) => ({ id, effect })));
const profiles = MATRIX_ARCHETYPES.map((archetype) => buildRepresentativeDeck(cards, archetype));
const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
const schedule = createMatrixSchedule(
  profiles.map((profile) => profile.id),
  repetitions,
);
const samples: DecisionSample[] = [];
const matches: CompletedMatrixMatch[] = [];
const failures: { seed: string; error: string }[] = [];

for (const entry of schedule) {
  const profile0 = profilesById.get(entry.profile0);
  const profile1 = profilesById.get(entry.profile1);
  if (!profile0 || !profile1) throw new Error(`Unknown matrix profile: ${entry.profile0}/${entry.profile1}`);
  const lowerPlayer = (1 - entry.higherPlayer) as PlayerIndex;
  const difficulties: [AIDifficulty, AIDifficulty] = ['easy', 'easy'];
  difficulties[lowerPlayer] = entry.lowerDifficulty;
  difficulties[entry.higherPlayer] = entry.higherDifficulty;
  try {
    matches.push({
      schedule: entry,
      result: playAIMatch(
        {
          deckIds: [profile0.cardIds, profile1.cardIds],
          difficulties,
          seed: entry.seed,
          parsedEffects,
          maximumActions,
        },
        samples,
      ),
    });
  } catch (error) {
    failures.push({ seed: entry.seed, error: error instanceof Error ? error.message : String(error) });
  }
}

const comparisonKeys = ['easy-normal', 'normal-hard'] as const;
const matrix = Object.fromEntries(
  comparisonKeys.map((comparison) => [
    comparison,
    Object.fromEntries(
      profiles.flatMap((left, leftIndex) =>
        profiles.slice(leftIndex).map((right) => {
          const pairIds = [left.id, right.id].sort();
          const completed = matches.filter(({ schedule: entry }) => {
            const entryPair = [entry.profile0, entry.profile1].sort();
            return (
              `${entry.lowerDifficulty}-${entry.higherDifficulty}` === comparison &&
              entryPair[0] === pairIds[0] &&
              entryPair[1] === pairIds[1]
            );
          });
          return [`${left.id}-${right.id}`, matchupSummary(completed)];
        }),
      ),
    ),
  ]),
);

const timing = Object.fromEntries(
  (['easy', 'normal', 'hard'] as const).map((difficulty) => [
    difficulty,
    summarizeDecisionTiming(samples.filter((sample) => sample.difficulty === difficulty)),
  ]),
);

console.log(
  JSON.stringify(
    {
      cards: cards.length,
      cardSource: cardFile ? resolve(cardFile) : process.env.CARD_API_URL ? 'card-api' : 'postgres',
      repetitions,
      requestedMatches: schedule.length,
      completedMatches: matches.length,
      failures,
      profiles: profiles.map(({ id, element, cardIds, composition }) => ({
        id,
        element,
        composition,
        cardIds,
      })),
      overall: Object.fromEntries(
        comparisonKeys.map((comparison) => [
          comparison,
          matchupSummary(
            matches.filter(
              ({ schedule: entry }) => `${entry.lowerDifficulty}-${entry.higherDifficulty}` === comparison,
            ),
          ),
        ]),
      ),
      matrix,
      timing,
      decisionCoverage: Object.fromEntries(
        (['janken', 'mulligan', 'turnPlan', 'effectOrder', 'pendingChoice'] as const).map((kind) => [
          kind,
          samples.filter((sample) => sample.kind === kind).length,
        ]),
      ),
    },
    null,
    2,
  ),
);

if (failures.length > 0) process.exitCode = 1;
