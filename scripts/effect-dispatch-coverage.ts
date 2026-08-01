import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { executeEffect } from '../src/game/effects/executor';
import { parseAllEffects } from '../src/game/effects/parser';
import type { ActionType, ParsedEffect } from '../src/game/effects/types';
import { initCards } from '../src/game/cards/loader';
import { setupGame } from '../src/game/GameLogic';
import type { CardDef, GameState } from '../src/game/types';
import { loadCardsForScript } from './cardSource';

export const EFFECT_DISPATCH_COVERAGE_THRESHOLD = 100;

export interface EffectDispatchCoverageEntry {
  id: string;
  cardId: string;
  effectIndex: number;
  action: ActionType;
  choiceType?: string;
  rawText: string;
  message?: string;
}

export interface EffectDispatchCoverageBucket {
  registered: number;
  dispatched: number;
  missing: number;
}

export interface EffectDispatchCoverageReport {
  schemaVersion: 1;
  thresholdPercent: number;
  sourceEffectLines: number;
  registered: number;
  dispatched: number;
  missingCount: number;
  coveragePercent: number;
  missing: EffectDispatchCoverageEntry[];
  byAction: Record<string, EffectDispatchCoverageBucket>;
  byChoiceType: Record<string, EffectDispatchCoverageBucket>;
}

function bucketRecord(
  entries: EffectDispatchCoverageEntry[],
  dispatchedIds: Set<string>,
  key: 'action' | 'choiceType',
) {
  const buckets: Record<string, EffectDispatchCoverageBucket> = {};
  for (const entry of entries) {
    const value = entry[key];
    if (!value) continue;
    const bucket = (buckets[value] ??= { registered: 0, dispatched: 0, missing: 0 });
    bucket.registered++;
    if (dispatchedIds.has(entry.id)) bucket.dispatched++;
    else bucket.missing++;
  }
  return Object.fromEntries(Object.entries(buckets).sort(([left], [right]) => left.localeCompare(right)));
}

function coverageEntry(cardId: string, effectIndex: number, effect: ParsedEffect): EffectDispatchCoverageEntry {
  const choiceType = effect.action.type === 'requestChoice' ? String(effect.action.params.choiceType ?? '') : undefined;
  return {
    id: `${cardId}:${effectIndex}`,
    cardId,
    effectIndex,
    action: effect.action.type,
    ...(choiceType ? { choiceType } : {}),
    rawText: effect.rawText,
  };
}

function coverageStateFactory(cards: CardDef[]): () => GameState {
  const fillerCards: CardDef[] = Array.from({ length: 20 }, (_, index) => ({
    id: `dispatch-fixture-${index}`,
    name: `Dispatch Fixture ${index}`,
    pack: 'dispatch-fixture',
    song: '',
    illustrator: '',
    rarity: 'N',
    element: '闇',
    type: index < 10 ? 'Character' : 'Enchant',
    clock: 1,
    attack: index < 10 ? { night: 10, day: 10 } : null,
    powerCost: 0,
    sendToPower: 1,
    effect: '',
    image: '',
    errata: '',
  }));
  initCards([...cards, ...fillerCards]);
  const deckIds = fillerCards.map((card) => card.id);
  return () =>
    setupGame({
      deck0Ids: deckIds,
      deck1Ids: deckIds,
      rngSeed: 1,
      skipShuffle: true,
    });
}

export function buildEffectDispatchCoverage(
  cards: CardDef[],
  stateFactory?: () => GameState,
  thresholdPercent = EFFECT_DISPATCH_COVERAGE_THRESHOLD,
): EffectDispatchCoverageReport {
  const makeState = stateFactory ?? coverageStateFactory(cards);
  const registered: EffectDispatchCoverageEntry[] = [];
  const dispatchedIds = new Set<string>();
  const runtimeEffects = parseAllEffects(cards.map(({ id, effect }) => ({ id, effect: effect ?? '' })));

  for (const [cardId, effects] of runtimeEffects) {
    effects.forEach((effect, effectIndex) => {
      const entry = coverageEntry(cardId, effectIndex, effect);
      registered.push(entry);
      let actionDispatched = false;
      const result = executeEffect({ ...effect, conditions: [] }, makeState(), 0, {
        cardDefId: cardId,
        onDispatch: () => {
          actionDispatched = true;
        },
      });
      const choiceDispatched = effect.action.type !== 'requestChoice' || result.message !== 'Unsupported choice type';
      if (actionDispatched && choiceDispatched) dispatchedIds.add(entry.id);
      else entry.message = result.message;
    });
  }

  const missing = registered.filter((entry) => !dispatchedIds.has(entry.id));
  const sourceEffectLines = cards.reduce(
    (count, card) => count + (card.effect ?? '').split('\n').filter((line) => line.trim()).length,
    0,
  );
  const coveragePercent = registered.length === 0 ? 100 : (dispatchedIds.size / registered.length) * 100;
  return {
    schemaVersion: 1,
    thresholdPercent,
    sourceEffectLines,
    registered: registered.length,
    dispatched: dispatchedIds.size,
    missingCount: missing.length,
    coveragePercent: Number(coveragePercent.toFixed(2)),
    missing,
    byAction: bucketRecord(registered, dispatchedIds, 'action'),
    byChoiceType: bucketRecord(registered, dispatchedIds, 'choiceType'),
  };
}

export function effectDispatchCoverageFailures(report: EffectDispatchCoverageReport): string[] {
  const failures: string[] = [];
  if (report.coveragePercent < report.thresholdPercent) {
    failures.push(
      `effect dispatch coverage ${report.coveragePercent}% is below ${report.thresholdPercent}% ` +
        `(${report.dispatched}/${report.registered})`,
    );
  }
  if (report.missingCount !== report.missing.length) failures.push('effect dispatch missing count is inconsistent');
  return failures;
}

async function main(): Promise<void> {
  const report = buildEffectDispatchCoverage(await loadCardsForScript());
  console.log(JSON.stringify(report, null, 2));
  const failures = effectDispatchCoverageFailures(report);
  if (failures.length > 0) {
    console.error(`effect dispatch coverage failed: ${failures.join('; ')}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
