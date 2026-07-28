import { getCardDef } from '../cards/loader';
import { getPlayerPower } from '../GameLogic';
import { combinations } from './candidates';
import { scoreCard, scoreCardDefinition } from './evaluate';
import { createSeededRng, isDecisionTimedOut, seededShuffle } from './rng';
import type { AIDecision, AIDecisionContext, AIKnowledgeState, AITraceFactor } from './types';

interface MulliganCandidate {
  indices: number[];
  score: number;
  factors: AITraceFactor[];
}

const HARD_MULLIGAN_SAMPLES = 8;
// Require a material sampled gain before replacing a known playable card.
const HARD_REDRAW_RISK_PER_CARD = 65;

function handFactors(
  knowledge: AIKnowledgeState,
  definitions: NonNullable<ReturnType<typeof getCardDef>>[],
  hard: boolean,
): { score: number; factors: AITraceFactor[] } {
  const { game: G, player } = knowledge;
  const power = getPlayerPower(G.players[player], G, player);
  const characters = definitions.filter((definition) => definition.type === 'Character');
  const affordableCharacters = characters.filter((definition) => power >= definition.powerCost);
  const cardQuality = definitions.reduce(
    (sum, definition) => sum + Math.max(-30, scoreCardDefinition(definition, G, player).score),
    0,
  );
  const playableOpening = affordableCharacters.length > 0 ? 85 : -150;
  const typeBalance = new Set(definitions.map((definition) => definition.type)).size * (hard ? 14 : 8);
  const duplicates = definitions.length - new Set(definitions.map((definition) => definition.id)).size;
  const duplicatePenalty = -duplicates * (hard ? 16 : 8);
  return {
    score: cardQuality + playableOpening + typeBalance + duplicatePenalty,
    factors: [
      { label: 'handQuality', value: cardQuality },
      { label: 'playableOpening', value: playableOpening },
      { label: 'typeBalance', value: typeBalance },
      { label: 'duplicates', value: duplicatePenalty },
    ],
  };
}

function retainedHandScore(
  knowledge: AIKnowledgeState,
  redraw: readonly number[],
  hard: boolean,
): { score: number; factors: AITraceFactor[] } {
  const { game: G, player } = knowledge;
  const redrawSet = new Set(redraw);
  const retained = G.players[player].hand.filter((_, index) => !redrawSet.has(index));
  const definitions = retained.map((card) => getCardDef(card.defId)).filter((def) => def !== undefined);
  const retainedScore = handFactors(knowledge, definitions, hard);
  const replacementExpectation = redraw.length * (hard ? 38 : 32);
  return {
    score: retainedScore.score + replacementExpectation,
    factors: [
      ...retainedScore.factors.map((factor) =>
        factor.label === 'handQuality' ? { ...factor, label: 'retainedQuality' } : factor,
      ),
      { label: 'replacementExpectation', value: replacementExpectation },
    ],
  };
}

function allMulliganCandidates(knowledge: AIKnowledgeState, hard: boolean): MulliganCandidate[] {
  const indices = knowledge.game.players[knowledge.player].hand.map((_, index) => index);
  const candidates: MulliganCandidate[] = [];
  for (let count = 0; count <= indices.length; count++) {
    for (const redraw of combinations(indices, count)) {
      const evaluated = retainedHandScore(knowledge, redraw, hard);
      candidates.push({ indices: redraw, ...evaluated });
    }
  }
  return candidates;
}

function hardMulliganCandidates(
  knowledge: AIKnowledgeState,
  context: AIDecisionContext,
): { candidates: MulliganCandidate[]; timedOut: boolean } {
  const hand = knowledge.game.players[knowledge.player].hand;
  const indices = hand.map((_, index) => index);
  const sampledDecks = Array.from({ length: HARD_MULLIGAN_SAMPLES }, (_, sampleIndex) =>
    seededShuffle(
      knowledge.knownOwnDeckDefIds,
      createSeededRng(`${context.seed}|${knowledge.visibleStateKey}|mulligan-world|${sampleIndex}`),
    ),
  );
  const candidates: MulliganCandidate[] = [];
  for (let count = 0; count <= Math.min(indices.length, knowledge.knownOwnDeckDefIds.length); count++) {
    for (const redraw of combinations(indices, count)) {
      if (isDecisionTimedOut(context)) return { candidates, timedOut: true };
      const redrawSet = new Set(redraw);
      const retainedDefinitions = hand
        .filter((_, index) => !redrawSet.has(index))
        .map((card) => getCardDef(card.defId))
        .filter((definition) => definition !== undefined);
      const samples = sampledDecks.map((deck) => {
        const replacements = deck
          .slice(0, redraw.length)
          .map((defId) => getCardDef(defId))
          .filter((definition) => definition !== undefined);
        return handFactors(knowledge, [...retainedDefinitions, ...replacements], true);
      });
      const redrawRisk = redraw.length * HARD_REDRAW_RISK_PER_CARD;
      const score = samples.reduce((sum, sample) => sum + sample.score, 0) / samples.length - redrawRisk;
      const labels = ['handQuality', 'playableOpening', 'typeBalance', 'duplicates'];
      const factors: AITraceFactor[] = labels.map((label) => ({
        label: `sampled${label[0].toUpperCase()}${label.slice(1)}`,
        value:
          samples.reduce(
            (sum, sample) => sum + (sample.factors.find((factor) => factor.label === label)?.value ?? 0),
            0,
          ) / samples.length,
        detail: `${samples.length}`,
      }));
      factors.push({ label: 'redrawRisk', value: -redrawRisk });
      candidates.push({ indices: redraw, score, factors });
    }
  }
  return { candidates, timedOut: false };
}

function easyMulligan(knowledge: AIKnowledgeState, context: AIDecisionContext): MulliganCandidate {
  const hand = knowledge.game.players[knowledge.player].hand;
  const scored = hand.map((card, index) => ({ index, ...scoreCard(card, knowledge.game, knowledge.player) }));
  const redraw = scored.filter((card) => card.score < 0 && context.rng.next() < 0.8).map((card) => card.index);
  const hasCharacter = hand.some((card) => getCardDef(card.defId)?.type === 'Character');
  if (!hasCharacter && redraw.length === 0 && hand.length > 0) redraw.push(context.rng.int(hand.length));
  const evaluated = retainedHandScore(knowledge, redraw, false);
  return { indices: redraw.sort((a, b) => a - b), ...evaluated };
}

export function chooseMulligan(knowledge: AIKnowledgeState, context: AIDecisionContext): AIDecision<number[]> {
  const startedAt = context.startedAt;
  let selected: MulliganCandidate;
  let fallback: string | undefined;
  if (context.difficulty === 'easy') {
    selected = easyMulligan(knowledge, context);
  } else if (context.difficulty === 'hard') {
    const sampled = hardMulliganCandidates(knowledge, context);
    if (sampled.candidates.length > 0 && !sampled.timedOut) {
      selected = sampled.candidates.reduce((best, candidate) => (candidate.score > best.score ? candidate : best));
    } else {
      const normal = allMulliganCandidates(knowledge, false);
      selected = normal.reduce((best, candidate) => (candidate.score > best.score ? candidate : best));
      fallback = 'mulligan-sampling-budget-exhausted';
    }
  } else {
    const candidates = allMulliganCandidates(knowledge, false);
    selected = candidates.reduce((best, candidate) => (candidate.score > best.score ? candidate : best));
  }
  return {
    kind: 'mulligan',
    action: selected.indices,
    score: selected.score,
    factors: selected.factors,
    reason: selected.indices.length === 0 ? 'keep-playable-opening' : 'replace-low-value-opening-cards',
    token: `mulligan:${knowledge.visibleStateKey}:${selected.indices.join(',')}`,
    durationMs: context.now() - startedAt,
    ...(fallback ? { fallback } : {}),
  };
}
