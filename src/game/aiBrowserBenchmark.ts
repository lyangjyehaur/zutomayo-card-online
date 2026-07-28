import { aiPlanTurn, createSeededRng, seededShuffle } from './ai';
import { getAllCardDefs } from './cards/loader';
import { setupGame } from './GameLogic';
import type { CardDef, Element, GameState } from './types';

const BENCHMARK_ELEMENTS: readonly Element[] = ['闇', '炎', '電気', '風'];
const DEFAULT_ITERATIONS = 3;

export interface AIBrowserBenchmarkDecision {
  seed: string;
  element: Element;
  durationMs: number;
  wallDurationMs: number;
  selections: number;
  score: number;
  fallback?: string;
  sampledSimulation?: string;
}

export interface AIBrowserBenchmarkReport {
  schemaVersion: 1;
  cardCount: number;
  cardFingerprint: string;
  iterations: number;
  startedAt: number;
  finishedAt: number;
  decisions: AIBrowserBenchmarkDecision[];
}

async function cardFingerprint(cards: readonly CardDef[]): Promise<string> {
  const strategyFields = cards
    .map((card) => ({
      id: card.id,
      element: card.element,
      type: card.type,
      clock: card.clock,
      attack: card.attack,
      powerCost: card.powerCost,
      sendToPower: card.sendToPower,
      effect: card.effect,
      publicationStatus: card.publicationStatus,
      playStatus: card.playStatus,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(strategyFields)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface AIBrowserBenchmarkOptions {
  iterations?: number;
}

interface AIBrowserBenchmarkApi {
  run(options?: AIBrowserBenchmarkOptions): Promise<AIBrowserBenchmarkReport>;
}

declare global {
  interface Window {
    __zutomayoAiBrowserBenchmark?: AIBrowserBenchmarkApi;
  }
}

function preferredCards(cards: readonly CardDef[], element: Element, seed: string): CardDef[] {
  const rng = createSeededRng(seed);
  return seededShuffle(
    [...cards].sort((left, right) => left.id.localeCompare(right.id)),
    rng,
  ).sort((left, right) => {
    const priority = (card: CardDef): number => (card.element === element ? 0 : card.element === 'カオス' ? 1 : 2);
    return priority(left) - priority(right);
  });
}

export function buildAIBrowserBenchmarkDeck(cards: readonly CardDef[], element: Element, seed: string): string[] {
  const uniqueCards = [...new Map(cards.map((card) => [card.id, card])).values()];
  const ordered = preferredCards(uniqueCards, element, seed);
  const selected: CardDef[] = [];
  const selectedIds = new Set<string>();
  const take = (type: CardDef['type'], count: number): void => {
    for (const card of ordered) {
      if (selected.filter((candidate) => candidate.type === type).length >= count) break;
      if (card.type !== type || selectedIds.has(card.id)) continue;
      selected.push(card);
      selectedIds.add(card.id);
    }
  };

  take('Character', 12);
  take('Enchant', 6);
  take('Area Enchant', 2);
  for (const card of ordered) {
    if (selected.length >= 20) break;
    if (selectedIds.has(card.id)) continue;
    selected.push(card);
    selectedIds.add(card.id);
  }
  if (selected.length !== 20) throw new Error(`AI browser benchmark requires 20 unique cards, got ${selected.length}`);
  return seededShuffle(
    selected.map((card) => card.id),
    createSeededRng(`${seed}:deck-order`),
  );
}

function benchmarkState(
  cards: readonly CardDef[],
  iteration: number,
): { state: GameState; element: Element; seed: string } {
  const element = BENCHMARK_ELEMENTS[iteration % BENCHMARK_ELEMENTS.length];
  const seed = `ai-browser:${element}:${iteration}`;
  const deck0Ids = buildAIBrowserBenchmarkDeck(cards, element, `${seed}:player`);
  const deck1Ids = buildAIBrowserBenchmarkDeck(
    cards,
    BENCHMARK_ELEMENTS[(iteration + 1) % BENCHMARK_ELEMENTS.length],
    `${seed}:opponent`,
  );
  const state = setupGame({ deck0Ids, deck1Ids, skipShuffle: true }, { allowBrowserCustomDeckName: true });
  state.step = 'turnSet';
  state.turnNumber = iteration + 2;
  state.chronos.position = (iteration * 3) % 12;
  state.chronosAtTurnStart = state.chronos.position;
  for (const player of state.players) {
    player.knownDeckDefIds = player.deck.map((card) => card.defId).sort();
  }
  return { state, element, seed };
}

export async function runAIBrowserBenchmark(
  options: AIBrowserBenchmarkOptions = {},
): Promise<AIBrowserBenchmarkReport> {
  const iterations = Math.max(1, Math.floor(options.iterations ?? DEFAULT_ITERATIONS));
  const cards = getAllCardDefs();
  if (cards.length < 20) throw new Error(`AI browser benchmark requires loaded production cards, got ${cards.length}`);

  const fingerprint = await cardFingerprint(cards);
  const startedAt = performance.now();
  const decisions: AIBrowserBenchmarkDecision[] = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const { state, element, seed } = benchmarkState(cards, iteration);
    const wallStartedAt = performance.now();
    const decision = aiPlanTurn(state, 0, 'hard', { seed });
    const wallDurationMs = performance.now() - wallStartedAt;
    decisions.push({
      seed,
      element,
      durationMs: decision.durationMs,
      wallDurationMs,
      selections: decision.action.selections.length,
      score: decision.score,
      ...(decision.fallback ? { fallback: decision.fallback } : {}),
      ...(decision.factors.find((factor) => factor.label === 'sampledSimulation')?.detail
        ? {
            sampledSimulation: decision.factors.find((factor) => factor.label === 'sampledSimulation')!.detail,
          }
        : {}),
    });
  }
  return {
    schemaVersion: 1,
    cardCount: cards.length,
    cardFingerprint: fingerprint,
    iterations,
    startedAt,
    finishedAt: performance.now(),
    decisions,
  };
}

export function installAIBrowserBenchmark(): () => void {
  const api: AIBrowserBenchmarkApi = { run: runAIBrowserBenchmark };
  window.__zutomayoAiBrowserBenchmark = api;
  window.dispatchEvent(new Event('zutomayo:ai-browser-benchmark-ready'));
  return () => {
    if (window.__zutomayoAiBrowserBenchmark === api) delete window.__zutomayoAiBrowserBenchmark;
  };
}
