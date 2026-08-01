import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  HIGHLIGHT_POST_TAG,
  HIGHLIGHT_PRE_TAG,
  buildMeiliFilter,
  createKnowledgeSearchService,
  createMeiliHttpClient,
  parseHighlightedText,
  parseKnowledgeSearchScopes,
  replaceIndex,
  validateKnowledgeSearchConfig,
} = require('../knowledgeSearchService.cjs') as {
  HIGHLIGHT_POST_TAG: string;
  HIGHLIGHT_PRE_TAG: string;
  buildMeiliFilter: (params: Record<string, unknown>) => string[];
  createKnowledgeSearchService: (options: Record<string, unknown>) => {
    search: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
    suggest: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
    scheduleReindex: () => void;
  };
  createMeiliHttpClient: (config: Record<string, unknown>, fetchImpl: typeof fetch) => unknown;
  parseKnowledgeSearchScopes: (value: string) => string[] | null;
  parseHighlightedText: (
    value: string | undefined,
    fallback: string,
    query: string,
  ) => { text: string; ranges: Array<{ start: number; end: number }> };
  replaceIndex: (
    client: unknown,
    indexUid: string,
    documents: Array<Record<string, unknown>>,
    settings: Record<string, unknown>,
    now: () => number,
  ) => Promise<void>;
  validateKnowledgeSearchConfig: (env: Record<string, string>) => Record<string, unknown>;
};

function document(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'card__4th_106__zh-TW',
    type: 'card',
    locale: 'zh-TW',
    sourceId: '4th_106',
    title: '海膽栗子',
    subtitle: '測試歌曲',
    body: '將 Chronos 回溯一格。',
    aliases: ['うにぐり', 'Uniguri'],
    tags: ['4th', 'R'],
    keywords: ['Chronos'],
    relatedCardIds: ['4th_106'],
    url: '/cards/4th_106',
    image: '',
    pack: '4th',
    rarity: 'R',
    element: '闇',
    cardType: 'Character',
    distributionType: 'standard',
    documentId: '',
    sortNumber: 106,
    publishedAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('knowledge search service', () => {
  it('validates scopes and rejects unknown public index types', () => {
    expect(parseKnowledgeSearchScopes('all')).toEqual([]);
    expect(parseKnowledgeSearchScopes('card,qa,card')).toEqual(['card', 'qa']);
    expect(parseKnowledgeSearchScopes('card,private_deck')).toBeNull();
  });

  it('escapes filter values instead of interpolating filter syntax', () => {
    const filters = buildMeiliFilter({
      locale: 'zh-TW',
      scopes: ['card'],
      pack: '4th" OR type = "deck',
    });
    expect(filters).toContain('pack = "4th\\" OR type = \\"deck"');
  });

  it('requires a production master key when Meilisearch is enabled', () => {
    expect(() =>
      validateKnowledgeSearchConfig({ NODE_ENV: 'production', MEILI_HOST: 'http://meilisearch:7700' }),
    ).toThrow(/MEILI_MASTER_KEY/);
    expect(
      validateKnowledgeSearchConfig({
        NODE_ENV: 'production',
        MEILI_HOST: 'http://meilisearch:7700',
        MEILI_MASTER_KEY: '0123456789abcdef0123456789abcdef',
      }),
    ).toMatchObject({ enabled: true, host: 'http://meilisearch:7700' });
  });

  it('uses cached PostgreSQL-derived documents when Meilisearch is disabled', async () => {
    const documentLoader = vi.fn(async () => [
      document(),
      document({
        uid: 'card__4th_107__zh-TW',
        sourceId: '4th_107',
        title: '其他卡牌',
        body: '沒有命中',
        aliases: [],
      }),
      document({ uid: 'card__4th_106__ja', locale: 'ja', title: 'うにぐり' }),
    ]);
    const service = createKnowledgeSearchService({
      pool: {},
      env: {},
      documentLoader,
      now: () => 1000,
    });

    await expect(
      service.search({ query: 'uniguri', locale: 'zh-TW', scopes: ['card'], limit: 24, offset: 0 }),
    ).resolves.toMatchObject({
      engine: 'postgres-fallback',
      estimatedTotalHits: 1,
      hits: [{ sourceId: '4th_106', title: '海膽栗子' }],
    });
    await service.search({ query: 'Chronos', locale: 'zh-TW', scopes: ['card'], limit: 24, offset: 0 });
    expect(documentLoader).toHaveBeenCalledTimes(1);
  });

  it('converts Meilisearch markers into text ranges without returning markup', () => {
    expect(
      parseHighlightedText(
        `${HIGHLIGHT_PRE_TAG}海膽${HIGHLIGHT_POST_TAG}栗子與${HIGHLIGHT_PRE_TAG}Chronos${HIGHLIGHT_POST_TAG}`,
        '',
        '海膽 Chronos',
      ),
    ).toEqual({
      text: '海膽栗子與Chronos',
      ranges: [
        { start: 0, end: 2 },
        { start: 5, end: 12 },
      ],
    });
  });

  it('adds literal title and snippet highlights in PostgreSQL fallback results', async () => {
    const service = createKnowledgeSearchService({
      pool: {},
      env: {},
      documentLoader: async () => [document()],
    });

    await expect(
      service.search({ query: 'Chronos', locale: 'zh-TW', scopes: ['card'], limit: 24, offset: 0 }),
    ).resolves.toMatchObject({
      hits: [
        {
          titleHighlights: [],
          snippetHighlights: [{ start: 2, end: 9 }],
        },
      ],
    });
  });

  it('requests marker-based highlighting from Meilisearch', async () => {
    let searchBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      searchBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      return Response.json({
        hits: [
          {
            ...document(),
            _formatted: {
              title: `${HIGHLIGHT_PRE_TAG}海膽${HIGHLIGHT_POST_TAG}栗子`,
              body: `將 ${HIGHLIGHT_PRE_TAG}Chronos${HIGHLIGHT_POST_TAG} 回溯一格。`,
            },
          },
        ],
        estimatedTotalHits: 1,
        processingTimeMs: 1,
      });
    }) as typeof fetch;
    const service = createKnowledgeSearchService({
      pool: {},
      env: { MEILI_HOST: 'http://search.test' },
      fetchImpl,
      documentLoader: async () => [document()],
    });

    await expect(
      service.search({ query: 'Chronos', locale: 'zh-TW', scopes: ['card'], limit: 24, offset: 0 }),
    ).resolves.toMatchObject({
      engine: 'meilisearch',
      hits: [{ title: '海膽栗子', snippet: '將 Chronos 回溯一格。', snippetHighlights: [{ start: 2, end: 9 }] }],
    });
    expect(searchBody).toMatchObject({
      attributesToHighlight: ['title', 'body'],
      highlightPreTag: HIGHLIGHT_PRE_TAG,
      highlightPostTag: HIGHLIGHT_POST_TAG,
    });
  });

  it('caps and deduplicates compact suggestions', async () => {
    const documents = Array.from({ length: 10 }, (_, index) =>
      document({
        uid: `card__${index}__zh-TW`,
        sourceId: index < 2 ? '0_duplicate' : `card_${index}`,
        title: `Chronos ${index}`,
      }),
    );
    const service = createKnowledgeSearchService({
      pool: {},
      env: {},
      documentLoader: async () => documents,
    });

    await expect(
      service.suggest({ query: 'Chronos', locale: 'zh-TW', scopes: ['card'], limit: 99 }),
    ).resolves.toMatchObject({
      suggestions: expect.arrayContaining([expect.objectContaining({ sourceId: '0_duplicate' })]),
    });
    const result = (await service.suggest({
      query: 'Chronos',
      locale: 'zh-TW',
      scopes: ['card'],
      limit: 99,
    })) as { suggestions: Array<{ sourceId: string }> };
    expect(result.suggestions).toHaveLength(8);
    expect(result.suggestions.filter((item) => item.sourceId === '0_duplicate')).toHaveLength(1);
  });

  it('invalidates fallback documents after a searchable mutation', async () => {
    const documentLoader = vi.fn(async () => [document()]);
    const service = createKnowledgeSearchService({ pool: {}, env: {}, documentLoader });
    const params = { query: 'Chronos', locale: 'zh-TW', scopes: ['card'], limit: 24, offset: 0 };

    await service.search(params);
    service.scheduleReindex();
    await service.search(params);

    expect(documentLoader).toHaveBeenCalledTimes(2);
  });

  it('atomically swaps a completed temporary index into place', async () => {
    let taskUid = 0;
    const requests: Array<{ path: string; method: string; body: string }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method || 'GET';
      requests.push({ path: url.pathname + url.search, method, body: String(init?.body || '') });
      if (url.pathname === '/indexes/knowledge' && method === 'GET') {
        return new Response(JSON.stringify({ message: 'missing' }), { status: 404 });
      }
      if (url.pathname.startsWith('/tasks/')) {
        return Response.json({ taskUid: Number(url.pathname.split('/').at(-1)), status: 'succeeded' });
      }
      taskUid += 1;
      return Response.json({ taskUid });
    }) as typeof fetch;
    const client = createMeiliHttpClient({ host: 'http://search.test', apiKey: 'secret', timeoutMs: 1000 }, fetchImpl);

    await replaceIndex(client, 'knowledge', [document()], { searchableAttributes: ['title'] }, () => 1234);

    const swap = requests.find((request) => request.path === '/swap-indexes');
    expect(swap?.method).toBe('POST');
    expect(swap?.body).toContain('knowledge_build_1234_');
    expect(requests.some((request) => request.path.includes('/documents?primaryKey=uid'))).toBe(true);
    expect(requests.at(-2)?.path).toMatch(/^\/indexes\/knowledge_build_1234_/);
    expect(requests.at(-2)?.method).toBe('DELETE');
  });
});
