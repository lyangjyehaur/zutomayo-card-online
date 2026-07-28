import { getCardDef } from '../cards/loader';
import { combinations } from './candidates';
import { scoreCard } from './evaluate';
import type { AIDecision, AIDecisionContext, AIKnowledgeState, AITraceFactor } from './types';

interface MulliganCandidate {
  indices: number[];
  score: number;
  factors: AITraceFactor[];
}

function retainedHandScore(
  knowledge: AIKnowledgeState,
  redraw: readonly number[],
  hard: boolean,
): { score: number; factors: AITraceFactor[] } {
  const { game: G, player } = knowledge;
  const redrawSet = new Set(redraw);
  const retained = G.players[player].hand.filter((_, index) => !redrawSet.has(index));
  const definitions = retained.map((card) => getCardDef(card.defId)).filter(Boolean);
  const characters = definitions.filter((def) => def?.type === 'Character');
  const affordableCharacters = characters.filter(
    (def) => def && scoreCard(G.players[player].hand.find((card) => card.defId === def.id)!, G, player).score > 0,
  );
  const cardQuality = retained.reduce((sum, card) => sum + Math.max(-30, scoreCard(card, G, player).score), 0);
  const replacementExpectation = redraw.length * (hard ? 38 : 32);
  const playableOpening = affordableCharacters.length > 0 ? 85 : -150;
  const typeBalance = new Set(definitions.map((def) => def?.type)).size * (hard ? 14 : 8);
  const duplicates = definitions.length - new Set(definitions.map((def) => def?.id)).size;
  const duplicatePenalty = -duplicates * (hard ? 16 : 8);
  return {
    score: cardQuality + replacementExpectation + playableOpening + typeBalance + duplicatePenalty,
    factors: [
      { label: 'retainedQuality', value: cardQuality },
      { label: 'replacementExpectation', value: replacementExpectation },
      { label: 'playableOpening', value: playableOpening },
      { label: 'typeBalance', value: typeBalance },
      { label: 'duplicates', value: duplicatePenalty },
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
  if (context.difficulty === 'easy') {
    selected = easyMulligan(knowledge, context);
  } else {
    const candidates = allMulliganCandidates(knowledge, context.difficulty === 'hard');
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
  };
}
