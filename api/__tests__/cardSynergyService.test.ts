import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { listCardSynergies, normalizeInput, upsertCardSynergy } = require('../cardSynergyService.cjs') as {
  listCardSynergies: (
    pool: { query: ReturnType<typeof vi.fn> },
    filters?: Record<string, unknown>,
  ) => Promise<unknown[]>;
  normalizeInput: (id: string, input: Record<string, unknown>) => Record<string, unknown> | null;
  upsertCardSynergy: (
    pool: { query: ReturnType<typeof vi.fn> },
    id: string,
    input: Record<string, unknown>,
    adminUserId: string,
  ) => Promise<{ ok: boolean; status?: number; error?: string; body?: Record<string, unknown> }>;
};

const input = {
  sourceCardId: 'card-a',
  targetCardId: 'card-b',
  kind: 'enables',
  primaryCategory: 'chronos',
  categories: ['chronos'],
  confidence: 'high',
  score: 90,
  rationaleJa: 'クロノス条件を直接満たす。',
  rationaleI18n: { 'zh-TW': '直接滿足 Chronos 條件。' },
  evidence: [{ concept: 'chronos-position:4' }],
  reviewStatus: 'approved',
  recommendationEligible: true,
  sourceVersion: 'analysis-2026-07-24',
  rulesVersion: 'grand-2025-05-30',
};

describe('card synergy service', () => {
  it('only allows approved relations to become recommendation eligible', () => {
    expect(normalizeInput('relation-1', input)).toMatchObject({
      primaryCategory: 'chronos',
      recommendationEligible: true,
    });
    expect(
      normalizeInput('relation-2', { ...input, reviewStatus: 'candidate', recommendationEligible: true }),
    ).toMatchObject({ recommendationEligible: false });
    expect(normalizeInput('bad', { ...input, primaryCategory: 'unknown' })).toBeNull();
  });

  it('lists relations with card names and review metadata', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: 'relation-1',
            source_card_id: 'card-a',
            source_card_name: 'A',
            target_card_id: 'card-b',
            target_card_name: 'B',
            kind: 'enables',
            primary_category: 'chronos',
            categories: ['chronos'],
            confidence: 'high',
            score: 90,
            rationale_ja: '理由',
            rationale_i18n: {},
            evidence: [],
            review_status: 'approved',
            recommendation_eligible: true,
            source_version: 'v1',
            rules_version: 'r1',
            updated_at: '2026-07-24T00:00:00Z',
          },
        ],
      })),
    };
    await expect(listCardSynergies(pool, { status: 'approved', query: 'card', limit: 20 })).resolves.toEqual([
      expect.objectContaining({
        id: 'relation-1',
        sourceCardName: 'A',
        targetCardName: 'B',
        recommendationEligible: true,
      }),
    ]);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('relation.review_status'), [
      'approved',
      '%card%',
      20,
    ]);
    expect(String(pool.query.mock.calls[0]?.[0])).toContain("localized.review_status = 'verified'");
  });

  it('rejects missing cards before writing a relation', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ id: 'card-a' }] })) };
    await expect(upsertCardSynergy(pool, 'relation-1', input, 'admin-1')).resolves.toMatchObject({
      ok: false,
      status: 400,
      error: 'Both cards must exist',
    });
  });
});
