import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { validateSnapshot, verifyCurrentOfficialSources } from '../release-official-rule-documents';

const locales = ['zh-TW', 'zh-CN', 'zh-HK', 'en', 'ko'] as const;
const floorSectionIds = [
  'overview',
  'chapter-1',
  'chapter-1-spectators',
  'chapter-2',
  'chapter-3',
  'chapter-3-organizer',
  'chapter-3-judge',
  'chapter-3-staff',
  'chapter-3-player',
  'chapter-3-spectator',
  'chapter-4',
  'chapter-4-cards',
  'chapter-4-proxies',
  'chapter-4-sleeves',
  'chapter-4-playmat',
  'chapter-4-clock',
  'chapter-4-notes',
  'chapter-5',
  'chapter-6',
  'chapter-6-procedure',
  'chapter-6-precautions',
  'chapter-6-judge',
  'chapter-7',
  'chapter-7-game-result',
  'chapter-7-turn-end',
  'chapter-7-match-result',
  'chapter-7-bo3',
  'chapter-7-bo3-time',
  'chapter-7-reporting',
  'chapter-7-concession',
  'chapter-8',
  'chapter-9',
  'chapter-10',
  'chapter-10-caution',
  'chapter-10-warning',
  'chapter-10-game-loss',
  'chapter-10-disqualification',
  'chapter-10-suspension',
];

function snapshot(pdfHashes = { grand: 'a'.repeat(64), floor: 'b'.repeat(64) }) {
  const completeGrandBody = Array.from(
    { length: 190 },
    (_, index) =>
      `1.${index + 1} 公式 PDF に記載された規則本文を省略せず収録するための検証用テキストです。章節、条項、例外、処理順をすべて保持します。`,
  ).join('\n');
  const completeTranslatedBody = Array.from(
    { length: 190 },
    (_, index) => `1.${index + 1} Complete reviewed translation text is preserved for release validation.`,
  ).join('\n');
  const completeFloorBody = `${'公式 PDF の本文を省略せず保持する検証テキストです。'.repeat(500)}\n${Array.from(
    { length: 145 },
    (_, index) => `● 項目 ${index + 1}`,
  ).join('\n')}`;
  const completeFloorTranslation = `${'Complete reviewed Floor Rules translation text is preserved. '.repeat(
    500,
  )}\n${Array.from({ length: 145 }, (_, index) => `● Item ${index + 1}`).join('\n')}`;
  const createDocument = (id: 'grand' | 'floor') => ({
    id,
    version: '1.0.0',
    publishedAt: '2026-07-21',
    titleJa: `${id} title`,
    summaryJa: `${id} summary`,
    sourceUrl: `https://cdn.example.test/${id}.pdf`,
    sourceSha256: pdfHashes[id],
    pageCount: 2,
    sections:
      id === 'grand'
        ? [
            {
              id: 'overview',
              number: '',
              level: 1,
              order: 0,
              pageStart: 1,
              pageEnd: 1,
              titleJa: `${id} title`,
              bodyJa: completeGrandBody,
              translations: Object.fromEntries(
                locales.map((locale) => [
                  locale,
                  {
                    title: `Title ${locale}`,
                    body: completeTranslatedBody,
                  },
                ]),
              ),
            },
            ...Array.from({ length: 10 }, (_, index) => ({
              id: `section-${index + 1}`,
              number: String(index + 1),
              level: 1,
              order: index + 1,
              pageStart: 2,
              pageEnd: 2,
              titleJa: '章',
              bodyJa: '本文',
              translations: Object.fromEntries(
                locales.map((locale) => [locale, { title: `Title ${locale}`, body: `Rule text ${locale}` }]),
              ),
            })),
          ]
        : floorSectionIds.map((sectionId, index) => ({
            id: sectionId,
            number: index === 0 ? '' : /^chapter-(\d+)$/.exec(sectionId)?.[1] || '',
            parentId: index === 0 || /^chapter-\d+$/.test(sectionId) ? undefined : sectionId.match(/^chapter-\d+/)?.[0],
            level: index === 0 || /^chapter-\d+$/.test(sectionId) ? 1 : 2,
            order: index,
            pageStart: 1,
            pageEnd: 2,
            titleJa: `章 ${sectionId}`,
            bodyJa: index === 0 ? completeFloorBody : '公式 PDF の節本文です。',
            translations: Object.fromEntries(
              locales.map((locale) => [
                locale,
                {
                  title: `Title ${locale}`,
                  body: index === 0 ? completeFloorTranslation : 'Complete section text.',
                },
              ]),
            ),
          })),
  });
  return {
    schemaVersion: 1 as const,
    sourceCheckedAt: '2026-07-21T00:00:00.000Z',
    provider: 'direct' as const,
    locales: [...locales],
    documents: [createDocument('grand'), createDocument('floor')],
  };
}

describe('official rule document release', () => {
  it('requires both documents and all five translations', () => {
    const input = snapshot();
    expect(validateSnapshot(input).documents).toHaveLength(2);

    delete (input.documents[0].sections[0].translations as Record<string, unknown>).ko;
    expect(() => validateSnapshot(input)).toThrow('grand.overview.ko is missing');
  });

  it('rejects a Grand Rules release that merges official chapters', () => {
    const input = snapshot();
    input.documents[0].sections[2].number = '2-3';
    expect(() => validateSnapshot(input)).toThrow('official chapter structure from 1 through 10');
  });

  it('rejects a Grand Rules release that contains only chapter summaries', () => {
    const input = snapshot();
    input.documents[0].sections[0].bodyJa = '概要だけです。';
    for (const locale of locales) input.documents[0].sections[0].translations[locale].body = 'Summary only.';
    expect(() => validateSnapshot(input)).toThrow('full numbered source text');
  });

  it('rejects Floor Rules that collapse the official chapters into summaries', () => {
    const input = snapshot();
    input.documents[1].sections = input.documents[1].sections.slice(0, 8);
    expect(() => validateSnapshot(input)).toThrow('official chapter structure from 1 through 10');
  });

  it('rejects a Floor Rules translation that omits a list item', () => {
    const input = snapshot();
    input.documents[1].sections[0].translations.en.body = input.documents[1].sections[0].translations.en.body
      .split('\n')
      .slice(0, -1)
      .join('\n');
    expect(() => validateSnapshot(input)).toThrow('does not preserve every list item and numbered step');
  });

  it('allows structural headings to omit invented body text', () => {
    const input = snapshot();
    input.documents[0].sections[1].bodyJa = '';
    for (const locale of locales) input.documents[0].sections[1].translations[locale].body = '';
    expect(validateSnapshot(input).documents[0].sections[1].bodyJa).toBe('');
  });

  it('rejects a translation that omits a numbered rule', () => {
    const input = snapshot();
    input.documents[0].sections[0].translations.en.body = input.documents[0].sections[0].translations.en.body
      .split('\n')
      .slice(0, -1)
      .join('\n');
    expect(() => validateSnapshot(input)).toThrow('does not preserve every numbered rule');
  });

  it('verifies that current official links and PDF fingerprints all match', async () => {
    const grandPdf = Buffer.from('grand rules');
    const floorPdf = Buffer.from('floor rules');
    const input = snapshot({
      grand: createHash('sha256').update(grandPdf).digest('hex'),
      floor: createHash('sha256').update(floorPdf).digest('hex'),
    });
    const documents = validateSnapshot(input).documents;
    const fetchImpl = vi.fn<typeof fetch>(async (request) => {
      const url = String(request);
      if (url === 'https://zutomayocard.net/rule/') {
        return new Response(documents.map((document) => document.sourceUrl).join('\n'));
      }
      return new Response(url.endsWith('/grand.pdf') ? grandPdf : floorPdf);
    });

    await expect(verifyCurrentOfficialSources(documents, fetchImpl)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('fails before activation when a reviewed PDF is no longer current', async () => {
    const documents = validateSnapshot(snapshot()).documents;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('no current PDF links'));

    await expect(verifyCurrentOfficialSources(documents, fetchImpl)).rejects.toThrow('grand PDF is no longer listed');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
