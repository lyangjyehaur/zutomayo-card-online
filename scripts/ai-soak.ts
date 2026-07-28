import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AIDifficulty } from '../src/game/ai';
import { initCards } from '../src/game/cards/loader';
import { parseAllEffects } from '../src/game/effects';
import type { CardDef } from '../src/game/types';
import {
  buildSoakDeckIds,
  playAIMatch,
  positiveInteger,
  summarizeDecisionTiming,
  type AIMatchResult,
  type DecisionSample,
} from './aiBenchmark';
import { loadCardsForScript } from './cardSource';

const difficulties: AIDifficulty[] = ['easy', 'normal', 'hard'];
const gamesPerDifficulty = positiveInteger(process.env.AI_SOAK_GAMES, 12);
const maximumActions = positiveInteger(process.env.AI_SOAK_MAX_ACTIONS, 600);
const cardFile = process.env.AI_SOAK_CARD_FILE;

interface SoakMatchResult extends AIMatchResult {
  difficulty: AIDifficulty;
}

async function loadCards(): Promise<CardDef[]> {
  if (!cardFile) return loadCardsForScript();
  const source = JSON.parse(await readFile(resolve(cardFile), 'utf8')) as CardDef[] | { cards?: CardDef[] };
  const cards = Array.isArray(source) ? source : source.cards;
  if (!Array.isArray(cards) || cards.length === 0) throw new Error(`No cards found in ${cardFile}`);
  return cards;
}

const cards = await loadCards();
initCards(cards);
const parsedEffects = parseAllEffects(cards.map(({ id, effect }) => ({ id, effect })));
const samples: DecisionSample[] = [];
const matches: SoakMatchResult[] = [];
const failures: { difficulty: AIDifficulty; seed: string; error: string }[] = [];

for (const difficulty of difficulties) {
  for (let index = 0; index < gamesPerDifficulty; index++) {
    const seed = `ai-soak:${difficulty}:${index}`;
    try {
      matches.push({
        difficulty,
        ...playAIMatch(
          {
            deckIds: [buildSoakDeckIds(cards, `${seed}:deck:0`), buildSoakDeckIds(cards, `${seed}:deck:1`)],
            difficulties: [difficulty, difficulty],
            seed,
            parsedEffects,
            maximumActions,
          },
          samples,
        ),
      });
    } catch (error) {
      failures.push({ difficulty, seed, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

const timing = Object.fromEntries(
  difficulties.map((difficulty) => [
    difficulty,
    summarizeDecisionTiming(samples.filter((sample) => sample.difficulty === difficulty)),
  ]),
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
