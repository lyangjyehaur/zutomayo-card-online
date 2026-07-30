import { useEffect, useState } from 'react';
import {
  searchKnowledge,
  searchKnowledgeIds,
  type KnowledgeSearchParams,
  type KnowledgeSearchResult,
  type KnowledgeSearchScope,
} from '../api/client';

const EMPTY_RESULT: KnowledgeSearchResult = {
  hits: [],
  estimatedTotalHits: 0,
  limit: 0,
  offset: 0,
  processingTimeMs: 0,
  engine: 'postgres-fallback',
};

export function useKnowledgeSearch({
  query,
  locale,
  scopes = [],
  limit = 24,
  offset = 0,
  filters = {},
  enabled = true,
}: {
  query: string;
  locale: string;
  scopes?: KnowledgeSearchScope[];
  limit?: number;
  offset?: number;
  filters?: Omit<KnowledgeSearchParams, 'query' | 'locale' | 'scopes' | 'limit' | 'offset'>;
  enabled?: boolean;
}): {
  result: KnowledgeSearchResult;
  loading: boolean;
  error: boolean;
} {
  const [result, setResult] = useState<KnowledgeSearchResult>(EMPTY_RESULT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const scopeKey = scopes.join(',');
  const filterKey = JSON.stringify(filters);

  useEffect(() => {
    const cleanQuery = query.trim();
    if (!enabled || !cleanQuery) {
      setResult(EMPTY_RESULT);
      setLoading(false);
      setError(false);
      return;
    }
    const controller = new AbortController();
    setResult(EMPTY_RESULT);
    setLoading(true);
    setError(false);
    void searchKnowledge(
      {
        query: cleanQuery,
        locale,
        scopes: scopeKey ? (scopeKey.split(',') as KnowledgeSearchScope[]) : undefined,
        limit,
        offset,
        ...(JSON.parse(filterKey) as typeof filters),
      },
      { signal: controller.signal },
    )
      .then(setResult)
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [enabled, filterKey, limit, locale, offset, query, scopeKey]);

  return { result, loading, error };
}

export function useKnowledgeSearchIds({
  query,
  locale,
  scope,
  limit = 500,
  filters = {},
  enabled = true,
  analytics = true,
}: {
  query: string;
  locale: string;
  scope: Exclude<KnowledgeSearchScope, 'deck'>;
  limit?: number;
  filters?: Omit<KnowledgeSearchParams, 'query' | 'locale' | 'scopes' | 'limit' | 'offset'>;
  enabled?: boolean;
  analytics?: boolean;
}): { ids: string[]; loading: boolean; error: boolean } {
  const [ids, setIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const filterKey = JSON.stringify(filters);

  useEffect(() => {
    const cleanQuery = query.trim();
    if (!enabled || !cleanQuery) {
      setIds([]);
      setLoading(false);
      setError(false);
      return;
    }
    const controller = new AbortController();
    setIds([]);
    setLoading(true);
    setError(false);
    void searchKnowledgeIds(
      {
        query: cleanQuery,
        locale,
        scopes: [scope],
        limit,
        analytics,
        ...(JSON.parse(filterKey) as typeof filters),
      },
      { signal: controller.signal },
    )
      .then((result) => setIds(result.ids))
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [analytics, enabled, filterKey, limit, locale, query, scope]);

  return { ids, loading, error };
}
