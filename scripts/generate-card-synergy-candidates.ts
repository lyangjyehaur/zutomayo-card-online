import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CardDef } from '../src/game/types';
import { loadCardsFromDatabase } from './cardSource';
import {
  buildSynergyGroups,
  buildSynergyRelations,
  deriveSynergyProfiles,
  SYNERGY_CATEGORIES,
  SYNERGY_CATEGORY_LABELS,
  type SynergyCard,
} from './cardSynergyModel';
import { toVerifiedUnlistedSynergyCard } from './unlistedCardSynergy';

type Extraction = {
  cards: Array<{
    id: string;
    japaneseName: string;
    japaneseEffect: string;
  }>;
};

type LocalCardSnapshot = {
  cards: CardDef[];
};

type UnlistedManifest = {
  cards: Array<{ candidateId: string }>;
};

type UnlistedSuggestionFile = {
  cards: Record<string, { review: Record<string, unknown> }>;
};

type UnlistedReviewFile = {
  reviews: Record<string, Record<string, unknown>>;
};

const root = process.cwd();
const outputPath = path.join(root, 'data', 'card-synergy-candidates.json');

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(root, file), 'utf8')) as T;
}

async function optionalJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return await readJson<T>(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}

function fromPostgres(cards: CardDef[]): SynergyCard[] {
  return cards.map((card) => ({
    ...card,
    source: 'postgres',
  }));
}

async function officialFallbackCards(): Promise<SynergyCard[]> {
  const [extraction, snapshot] = await Promise.all([
    readJson<Extraction>('data/card-english-extraction.json'),
    optionalJson<LocalCardSnapshot>('data/e2e-card-seed.json', { cards: [] }),
  ]);
  if (!Array.isArray(extraction.cards) || extraction.cards.length !== 422) {
    throw new Error('Reviewed local extraction must contain the 422-card official baseline');
  }
  const snapshotById = new Map(snapshot.cards.map((card) => [card.id, card]));
  return extraction.cards.map((card) => {
    const metadata = snapshotById.get(card.id);
    return {
      ...(metadata ?? {}),
      id: card.id,
      name: card.japaneseName,
      effect: card.japaneseEffect || '',
      playStatus: metadata?.playStatus ?? 'playable',
      source: 'reviewed-extraction' as const,
    };
  });
}

type UnlistedCardsResult = {
  discoveredCount: number;
  verifiedCards: SynergyCard[];
  excludedUnverifiedCount: number;
};

async function unlistedCards(): Promise<UnlistedCardsResult> {
  const [manifest, suggestions, reviews] = await Promise.all([
    readJson<UnlistedManifest>('data/card-unlisted-sources.json'),
    readJson<UnlistedSuggestionFile>('data/card-unlisted-review-suggestions.json'),
    optionalJson<UnlistedReviewFile>('data/card-unlisted-human-reviews.json', { reviews: {} }),
  ]);
  const verifiedCards = manifest.cards.flatMap((source) => {
    const suggestion = suggestions.cards[source.candidateId]?.review ?? {};
    const humanReview = reviews.reviews[source.candidateId];
    const card = toVerifiedUnlistedSynergyCard(source.candidateId, suggestion, humanReview);
    return card ? [card] : [];
  });
  return {
    discoveredCount: manifest.cards.length,
    verifiedCards,
    excludedUnverifiedCount: manifest.cards.length - verifiedCards.length,
  };
}

function hasPostgresConfig(): boolean {
  return Boolean(process.env.DATABASE_URL || process.env.PG_HOST || process.env.PG_DATABASE);
}

async function main(): Promise<void> {
  const officialCards = hasPostgresConfig()
    ? fromPostgres(await loadCardsFromDatabase())
    : await officialFallbackCards();
  const unlisted = await unlistedCards();
  const candidates = [...officialCards, ...unlisted.verifiedCards];
  const cards = [...new Map(candidates.map((card) => [card.id, card])).values()];
  const profiles = deriveSynergyProfiles(cards);
  const relations = buildSynergyRelations(profiles);
  const groups = buildSynergyGroups(profiles, relations);
  const linkedCardIds = new Set(relations.flatMap((relation) => [relation.sourceCardId, relation.targetCardId]));
  const highConfidenceRelations = relations.filter((relation) => relation.confidence === 'high');
  const reviewableRelations = relations.filter((relation) => relation.confidence !== 'low');
  const highConfidenceCardIds = new Set(
    highConfidenceRelations.flatMap((relation) => [relation.sourceCardId, relation.targetCardId]),
  );
  const reviewableCardIds = new Set(
    reviewableRelations.flatMap((relation) => [relation.sourceCardId, relation.targetCardId]),
  );
  const categoryRelationCounts = Object.fromEntries(
    SYNERGY_CATEGORIES.map((category) => [
      category,
      relations.filter((relation) => relation.categories.includes(category)).length,
    ]),
  );
  const output = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    status: 'candidate_requires_human_review',
    sourceMode: hasPostgresConfig() ? 'postgres-plus-unlisted-review' : 'reviewed-extraction-plus-unlisted-review',
    summary: {
      cardCount: cards.length,
      officialCardCount: officialCards.length,
      unlistedCardCount: cards.length - officialCards.length,
      unlistedDiscoveredCount: unlisted.discoveredCount,
      verifiedUnlistedIncludedCount: unlisted.verifiedCards.length,
      unverifiedUnlistedExcludedCount: unlisted.excludedUnverifiedCount,
      effectTextCardCount: cards.filter((card) => Boolean(card.effect.trim())).length,
      parsedEffectCards: profiles.filter((profile) => profile.parsedEffectCount > 0).length,
      linkedCardCount: linkedCardIds.size,
      highConfidenceLinkedCardCount: highConfidenceCardIds.size,
      reviewableLinkedCardCount: reviewableCardIds.size,
      unlinkedCardCount: cards.length - linkedCardIds.size,
      relationCount: relations.length,
      highConfidenceRelationCount: highConfidenceRelations.length,
      mediumConfidenceRelationCount: relations.filter((relation) => relation.confidence === 'medium').length,
      lowConfidenceRelationCount: relations.filter((relation) => relation.confidence === 'low').length,
      playabilityEligibleRelationCount: relations.filter((relation) => relation.playabilityEligible).length,
      approvedRecommendationCount: 0,
      conflictCount: relations.filter((relation) => relation.kind === 'conflicts').length,
      groupCount: groups.length,
      categoryRelationCounts,
    },
    categoryLabels: SYNERGY_CATEGORY_LABELS,
    groups,
    relations,
    profiles: profiles.map((profile) => ({
      cardId: profile.card.id,
      cardName: profile.card.name,
      cardEffect: profile.card.effect,
      cardElement: profile.card.element,
      cardType: profile.card.type,
      source: profile.card.source,
      playStatus: profile.card.playStatus || 'playable',
      outputs: profile.outputs,
      inputs: profile.inputs,
      blockers: profile.blockers,
      parsedEffectCount: profile.parsedEffectCount,
    })),
  };
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(output.summary, null, 2));
  console.log(`Wrote candidate synergy graph to ${outputPath}`);
}

await main();
