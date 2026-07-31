export type KnowledgeSearchScope = 'card' | 'qa' | 'rule' | 'errata' | 'deck';

export interface KnowledgeSearchHighlight {
  start: number;
  end: number;
}

export interface KnowledgeSearchHit {
  uid: string;
  type: KnowledgeSearchScope;
  sourceId: string;
  title: string;
  titleHighlights: KnowledgeSearchHighlight[];
  subtitle: string;
  snippet: string;
  snippetHighlights: KnowledgeSearchHighlight[];
  tags: string[];
  relatedCardIds: string[];
  url: string;
  image: string;
  pack: string;
  rarity: string;
  element: string;
  cardType: string;
  distributionType: string;
  documentId: string;
  sortNumber: number;
  publishedAt: number;
  updatedAt: number;
}

export interface KnowledgeSearchResult {
  hits: KnowledgeSearchHit[];
  estimatedTotalHits: number;
  limit: number;
  offset: number;
  processingTimeMs: number;
  engine: 'meilisearch' | 'postgres-fallback';
}

export interface KnowledgeSearchParams {
  query: string;
  scopes?: KnowledgeSearchScope[];
  locale: string;
  pack?: string;
  rarity?: string;
  element?: string;
  cardType?: string;
  distributionType?: string;
  documentId?: 'grand' | 'floor';
  tag?: string;
  cardId?: string;
  limit?: number;
  offset?: number;
}

export interface KnowledgeSearchIdsResult {
  ids: string[];
  estimatedTotalHits: number;
  engine: 'meilisearch' | 'postgres-fallback';
}

export interface KnowledgeSearchSuggestion {
  uid: string;
  type: KnowledgeSearchScope;
  sourceId: string;
  title: string;
  titleHighlights: KnowledgeSearchHighlight[];
  subtitle: string;
  url: string;
}

export interface KnowledgeSearchSuggestionsResult {
  suggestions: KnowledgeSearchSuggestion[];
  engine: 'meilisearch' | 'postgres-fallback';
  processingTimeMs: number;
}

export interface AdminKnowledgeSearchZeroResult {
  query: string;
  locale: string;
  scope: 'all' | KnowledgeSearchScope;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export type ApiRequest = <T = unknown>(path: string, options?: RequestInit) => Promise<T>;

export interface KnowledgeClientDependencies {
  request: ApiRequest;
  adminAuthHeaders: () => Record<string, string>;
}

export function createKnowledgeClient({ request, adminAuthHeaders }: KnowledgeClientDependencies) {
  async function suggestKnowledge(
    params: Pick<KnowledgeSearchParams, 'query' | 'locale' | 'scopes'> & { limit?: number },
    options: { signal?: AbortSignal } = {},
  ): Promise<KnowledgeSearchSuggestionsResult> {
    const query = new URLSearchParams({ q: params.query, lang: params.locale });
    if (params.scopes?.length) query.set('scope', params.scopes.join(','));
    if (params.limit) query.set('limit', String(params.limit));
    return request<KnowledgeSearchSuggestionsResult>(`/search/suggest?${query.toString()}`, {
      signal: options.signal,
    });
  }

  async function searchKnowledgeIds(
    params: KnowledgeSearchParams & {
      scopes: [Exclude<KnowledgeSearchScope, 'deck'>];
      limit?: number;
      analytics?: boolean;
    },
    options: { signal?: AbortSignal } = {},
  ): Promise<KnowledgeSearchIdsResult> {
    const query = new URLSearchParams({
      q: params.query,
      scope: params.scopes[0],
      lang: params.locale,
    });
    for (const [key, value] of Object.entries({
      pack: params.pack,
      rarity: params.rarity,
      element: params.element,
      cardType: params.cardType,
      distributionType: params.distributionType,
      documentId: params.documentId,
      tag: params.tag,
      cardId: params.cardId,
      limit: params.limit,
      analytics: params.analytics === false ? 0 : undefined,
    })) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    return request<KnowledgeSearchIdsResult>(`/search/ids?${query.toString()}`, { signal: options.signal });
  }

  async function searchKnowledge(
    params: KnowledgeSearchParams,
    options: { signal?: AbortSignal } = {},
  ): Promise<KnowledgeSearchResult> {
    const query = new URLSearchParams({ q: params.query, lang: params.locale });
    if (params.scopes?.length) query.set('scope', params.scopes.join(','));
    for (const [key, value] of Object.entries({
      pack: params.pack,
      rarity: params.rarity,
      element: params.element,
      cardType: params.cardType,
      distributionType: params.distributionType,
      documentId: params.documentId,
      tag: params.tag,
      cardId: params.cardId,
      limit: params.limit,
      offset: params.offset,
    })) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    return request<KnowledgeSearchResult>(`/search?${query.toString()}`, { signal: options.signal });
  }

  async function adminGetKnowledgeSearchZeroResults(
    params: { limit?: number; days?: number } = {},
  ): Promise<AdminKnowledgeSearchZeroResult[]> {
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', String(params.limit));
    if (params.days) query.set('days', String(params.days));
    const data = await request<{ items: AdminKnowledgeSearchZeroResult[] }>(
      `/admin/search/zero-results?${query.toString()}`,
      { headers: adminAuthHeaders() },
    );
    return data.items;
  }

  return {
    suggestKnowledge,
    searchKnowledgeIds,
    searchKnowledge,
    adminGetKnowledgeSearchZeroResults,
  };
}
