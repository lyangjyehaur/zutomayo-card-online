import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require_ = createRequire(import.meta.url);
const { assertOfficialCardData, loadExpectedErrataCardIds, loadOfficialCardDataManifest, officialCardDataChecksum } =
  require_('../card-data-gate.cjs') as {
    assertOfficialCardData: (
      pool: { query: ReturnType<typeof vi.fn> },
      options?: {
        expectedCardCount?: number;
        expectedErrataCardIds?: string[];
        requireLedger?: boolean;
        requireExact?: boolean;
        manifest?: Record<string, unknown>;
      },
    ) => Promise<{ cardCount: number; errataCount: number; checksum: string }>;
    loadExpectedErrataCardIds: () => string[];
    loadOfficialCardDataManifest: () => {
      datasetSha256: string;
      extractionSha256: string;
      errataSha256: string;
      reviewProvenanceSha256: string;
      cardCount: number;
      errataCount: number;
    };
    officialCardDataChecksum: () => string;
  };

function completeQuery() {
  return vi
    .fn()
    .mockResolvedValueOnce({
      rows: [{ card_count: 2, missing_english_names: 0, missing_english_effects: 0 }],
    })
    .mockResolvedValueOnce({
      rows: [
        {
          japanese_rows: 2,
          english_rows: 2,
          invalid_japanese_statuses: 0,
          pending_english_rows: 0,
          missing_localized_english_names: 0,
          missing_localized_english_effects: 0,
        },
      ],
    })
    .mockResolvedValueOnce({
      rows: [{ errata_count: 1, card_ids: ['card-2'], incomplete_errata: 0 }],
    })
    .mockResolvedValueOnce({ rows: [{ mismatch_count: 0 }] });
}

describe('official card data release gate', () => {
  it('binds the gate to the complete versioned errata dataset', () => {
    expect(loadExpectedErrataCardIds()).toHaveLength(12);
    expect(new Set(loadExpectedErrataCardIds()).size).toBe(12);
    expect(officialCardDataChecksum()).toMatch(/^[a-f0-9]{64}$/);
  });

  it('accepts complete official text and errata rows', async () => {
    const query = completeQuery();
    await expect(
      assertOfficialCardData(
        { query },
        {
          expectedCardCount: 2,
          expectedErrataCardIds: ['card-2'],
          requireLedger: false,
        },
      ),
    ).resolves.toMatchObject({ cardCount: 2, errataCount: 1 });
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('fails closed on partial English data, unreviewed errata, or flag drift', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ card_count: 2, missing_english_names: 1, missing_english_effects: 1 }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            japanese_rows: 2,
            english_rows: 1,
            invalid_japanese_statuses: 0,
            pending_english_rows: 1,
            missing_localized_english_names: 1,
            missing_localized_english_effects: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ errata_count: 1, card_ids: ['wrong-card'], incomplete_errata: 1 }],
      })
      .mockResolvedValueOnce({ rows: [{ mismatch_count: 1 }] });

    await expect(
      assertOfficialCardData(
        { query },
        {
          expectedCardCount: 2,
          expectedErrataCardIds: ['card-2'],
          requireLedger: false,
        },
      ),
    ).rejects.toThrow(/missing official English names[\s\S]*errata card IDs[\s\S]*flags disagree/);
  });

  it('requires a matching signed dataset ledger row', async () => {
    const manifest = loadOfficialCardDataManifest();
    const query = completeQuery().mockResolvedValueOnce({
      rows: [
        {
          dataset_sha256: manifest.datasetSha256,
          extraction_sha256: manifest.extractionSha256,
          errata_sha256: manifest.errataSha256,
          review_provenance_sha256: manifest.reviewProvenanceSha256,
          release_sha: 'a'.repeat(40),
          card_count: manifest.cardCount,
          errata_count: manifest.errataCount,
        },
      ],
    });
    await expect(
      assertOfficialCardData(
        { query },
        {
          expectedCardCount: 2,
          expectedErrataCardIds: ['card-2'],
        },
      ),
    ).resolves.toMatchObject({ checksum: manifest.datasetSha256 });
    expect(query).toHaveBeenCalledTimes(5);
  });

  it('rejects a missing dataset ledger even when row counts look complete', async () => {
    const query = completeQuery().mockResolvedValueOnce({ rows: [] });
    await expect(
      assertOfficialCardData(
        { query },
        {
          expectedCardCount: 2,
          expectedErrataCardIds: ['card-2'],
        },
      ),
    ).rejects.toThrow('has no completed release ledger row');
  });

  it('can require exact signed rows before the import transaction commits', async () => {
    const query = completeQuery()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      assertOfficialCardData(
        { query },
        {
          expectedCardCount: 2,
          expectedErrataCardIds: ['card-2'],
          requireLedger: false,
          requireExact: true,
        },
      ),
    ).rejects.toThrow(/card text rows differ[\s\S]*localized rows differ[\s\S]*errata rows differ/);
  });

  it('accepts exact signed card, localized, and errata values and rejects a tampered value', async () => {
    const manifest = {
      cards: [
        {
          id: 'card-1',
          japaneseName: '公式名',
          japaneseEffect: '公式効果',
          enNameOfficial: 'OFFICIAL NAME',
          enEffectOfficial: 'Printed effect.',
        },
      ],
      errata: [
        {
          errataId: '001',
          cardId: 'card-1',
          publishedAt: '2026-01-02',
          fields: ['effect'],
          incorrectText: 'old',
          correctedJapaneseText: '公式効果',
          correctedEnglishText: 'Corrected effect.',
          correctedEnglishStatus: 'verified',
          correctedEnglishSource: 'official_japanese_errata_translation',
          sourceUrl: 'https://example.test/errata/001',
        },
      ],
      cardCount: 1,
      errataCount: 1,
      datasetSha256: 'a'.repeat(64),
      extractionSha256: 'b'.repeat(64),
      errataSha256: 'c'.repeat(64),
      reviewProvenanceSha256: 'd'.repeat(64),
    };
    const exactRows = (tampered = false) =>
      vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ card_count: 1, missing_english_names: 0, missing_english_effects: 0 }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              japanese_rows: 1,
              english_rows: 1,
              invalid_japanese_statuses: 0,
              pending_english_rows: 0,
              missing_localized_english_names: 0,
              missing_localized_english_effects: 0,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ errata_count: 1, card_ids: ['card-1'], incomplete_errata: 0 }] })
        .mockResolvedValueOnce({ rows: [{ mismatch_count: 0 }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'card-1',
              name: '公式名',
              effect: '公式効果',
              en_name_official: 'OFFICIAL NAME',
              en_effect_official: 'Printed effect.',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              card_id: 'card-1',
              lang: 'en',
              name_text: 'OFFICIAL NAME',
              effect_text: tampered ? 'Tampered effect.' : 'Corrected effect.',
              name_source: 'official_card_print',
              effect_source: 'official_japanese_errata_translation',
              review_status: 'verified',
              review_note: 'Official errata 001: https://example.test/errata/001',
            },
            {
              card_id: 'card-1',
              lang: 'ja',
              name_text: '公式名',
              effect_text: '公式効果',
              name_source: 'official_card_print',
              effect_source: 'official_errata_notice',
              review_status: 'official',
              review_note: 'Official errata 001: https://example.test/errata/001',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              errata_id: '001',
              card_id: 'card-1',
              published_at: '2026-01-02',
              affects_name: false,
              affects_effect: true,
              incorrect_text: 'old',
              corrected_japanese_text: '公式効果',
              corrected_english_text: 'Corrected effect.',
              corrected_english_status: 'verified',
              corrected_english_source: 'official_japanese_errata_translation',
              source_url: 'https://example.test/errata/001',
            },
          ],
        });

    await expect(
      assertOfficialCardData({ query: exactRows() }, { manifest, requireLedger: false, requireExact: true }),
    ).resolves.toMatchObject({ cardCount: 1, errataCount: 1 });
    await expect(
      assertOfficialCardData({ query: exactRows(true) }, { manifest, requireLedger: false, requireExact: true }),
    ).rejects.toThrow('ja/en localized rows differ');
  });
});
