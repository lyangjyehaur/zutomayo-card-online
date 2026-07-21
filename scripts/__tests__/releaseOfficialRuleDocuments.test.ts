import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { validateSnapshot, verifyCurrentOfficialSources } from '../release-official-rule-documents';

const locales = ['zh-TW', 'zh-CN', 'zh-HK', 'en', 'ko'] as const;

function snapshot(pdfHashes = { grand: 'a'.repeat(64), floor: 'b'.repeat(64) }) {
  const translations = Object.fromEntries(
    locales.map((locale) => [locale, { title: `Title ${locale}`, body: `Rule text ${locale}` }]),
  );
  const createDocument = (id: 'grand' | 'floor') => ({
    id,
    version: '1.0.0',
    publishedAt: '2026-07-21',
    titleJa: `${id} title`,
    summaryJa: `${id} summary`,
    sourceUrl: `https://cdn.example.test/${id}.pdf`,
    sourceSha256: pdfHashes[id],
    pageCount: 2,
    sections: [
      {
        id: 'overview',
        number: '',
        level: 1,
        order: 0,
        pageStart: 1,
        pageEnd: 1,
        titleJa: `${id} title`,
        bodyJa: `${id} summary`,
        translations,
      },
      {
        id: 'section-1',
        number: '1',
        level: 1,
        order: 1,
        pageStart: 2,
        pageEnd: 2,
        titleJa: '章',
        bodyJa: '本文',
        translations,
      },
    ],
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
