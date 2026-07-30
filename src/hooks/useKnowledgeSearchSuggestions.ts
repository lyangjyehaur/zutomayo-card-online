import { useEffect, useState } from 'react';
import { suggestKnowledge, type KnowledgeSearchScope, type KnowledgeSearchSuggestion } from '../api/client';

export function useKnowledgeSearchSuggestions({
  query,
  locale,
  scopes = [],
  enabled = true,
  delay = 150,
}: {
  query: string;
  locale: string;
  scopes?: KnowledgeSearchScope[];
  enabled?: boolean;
  delay?: number;
}): { suggestions: KnowledgeSearchSuggestion[]; loading: boolean } {
  const [suggestions, setSuggestions] = useState<KnowledgeSearchSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const scopeKey = scopes.join(',');

  useEffect(() => {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    if (!enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setLoading(true);
      void suggestKnowledge(
        {
          query: cleanQuery,
          locale,
          scopes: scopeKey ? (scopeKey.split(',') as KnowledgeSearchScope[]) : undefined,
          limit: 8,
        },
        { signal: controller.signal },
      )
        .then((result) => setSuggestions(result.suggestions))
        .catch((caught) => {
          if (caught instanceof DOMException && caught.name === 'AbortError') return;
          setSuggestions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, delay);
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [delay, enabled, locale, query, scopeKey]);

  return { suggestions, loading };
}
