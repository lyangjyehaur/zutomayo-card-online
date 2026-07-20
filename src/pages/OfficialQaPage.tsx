import { BookOpenText, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchOfficialQa, type OfficialQaItem } from '../api/client';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { RelatedCardLinks, RulesTabs, TranslationStatusBadge } from '../components/rules/OfficialRulesComponents';
import { t, useLocale } from '../i18n';
import { Alert, AppHeader, EmptyState, LoadingState, PageShell, Panel, SearchInput, TagButton } from '../ui';

export function OfficialQaPage() {
  const locale = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<OfficialQaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const query = searchParams.get('query') ?? '';
  const selectedTag = searchParams.get('tag') ?? '';
  const cardId = searchParams.get('cardId') ?? '';

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void fetchOfficialQa(locale)
      .then((result) => {
        if (active) setItems(result);
      })
      .catch(() => {
        if (active) setError(t('officialRules.loadError'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [locale]);

  const tags = useMemo(() => [...new Set(items.flatMap((item) => item.tags))].sort(), [items]);
  const visibleItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    return items.filter((item) => {
      if (selectedTag && !item.tags.includes(selectedTag)) return false;
      if (cardId && !item.relatedCardIds.includes(cardId)) return false;
      if (!needle) return true;
      return [item.localized.question, item.localized.answer, item.source.question, item.source.answer, ...item.tags]
        .join('\n')
        .toLocaleLowerCase(locale)
        .includes(needle);
    });
  }, [cardId, items, locale, query, selectedTag]);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  return (
    <PageShell variant="scroll" glow={{ color: 'gold', size: 'lg' }}>
      <AppHeader title={t('officialRules.qaTitle')} subtitle="RULE / Q&A" backTo="/" actions={<LanguageSwitcher />} />
      <div className="relative mx-auto grid w-full max-w-6xl gap-5 px-4 pb-12 pt-24 md:px-6 md:pt-28">
        <RulesTabs />
        <Panel className="grid gap-4 bg-surface-panel/70 backdrop-blur" size="lg">
          <div>
            <p className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary/70">
              {t('officialRules.databaseKicker')}
            </p>
            <h1 className="mt-1 font-display text-title-lg font-bold">{t('officialRules.qaHeading')}</h1>
            <p className="mt-2 max-w-3xl text-body-sm leading-relaxed text-content-muted">
              {t('officialRules.qaDescription')}
            </p>
          </div>
          <SearchInput
            value={query}
            onChange={(event) => updateParam('query', event.target.value)}
            placeholder={t('officialRules.searchPlaceholder')}
            aria-label={t('officialRules.searchPlaceholder')}
            icon={<Search className="size-4 text-content-dim" aria-hidden="true" />}
          />
          <div className="flex flex-wrap gap-2" aria-label={t('officialRules.categories')}>
            <TagButton
              className={!selectedTag ? 'border-accent-primary/60 text-accent-primary' : undefined}
              onClick={() => updateParam('tag', '')}
            >
              {t('officialRules.all')}
            </TagButton>
            {tags.map((tag) => (
              <TagButton
                key={tag}
                className={selectedTag === tag ? 'border-accent-primary/60 text-accent-primary' : undefined}
                onClick={() => updateParam('tag', selectedTag === tag ? '' : tag)}
              >
                {tag}
              </TagButton>
            ))}
          </div>
          {cardId && (
            <Alert tone="info">
              {t('officialRules.cardFilterActive')} <code>{cardId}</code>{' '}
              <button className="underline" type="button" onClick={() => updateParam('cardId', '')}>
                {t('officialRules.clearFilter')}
              </button>
            </Alert>
          )}
        </Panel>

        {loading ? (
          <LoadingState label={t('officialRules.loading')} />
        ) : error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : visibleItems.length === 0 ? (
          <EmptyState title={t('officialRules.empty')} description={t('officialRules.emptyDescription')} />
        ) : (
          <section className="grid gap-3" aria-label={t('officialRules.qaResults')}>
            <p className="font-mono text-caption text-content-dim">
              {t('officialRules.resultCount').replace('{count}', String(visibleItems.length))}
            </p>
            {visibleItems.map((item) => (
              <article
                key={item.id}
                className="rounded-sm border border-border-soft bg-surface-panel/75 shadow-floating backdrop-blur transition hover:border-accent-primary/50 focus-within:border-accent-primary/50"
              >
                <Link
                  to={`/rules/qa/${item.number}`}
                  className="group block rounded-sm p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color] md:p-5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 font-mono text-caption text-accent-primary">
                      <BookOpenText className="size-4" aria-hidden="true" />
                      Q.{item.number}
                    </span>
                    <div className="flex items-center gap-2">
                      <TranslationStatusBadge status={item.translationStatus} />
                      <time className="font-mono text-caption text-content-dim" dateTime={item.publishedAt}>
                        {item.publishedAt}
                      </time>
                    </div>
                  </div>
                  <h2 className="mt-3 text-body-lg font-semibold leading-relaxed text-content-primary transition group-hover:text-accent-primary">
                    {item.localized.question}
                  </h2>
                  <p className="mt-2 line-clamp-3 whitespace-pre-line text-body-sm leading-relaxed text-content-muted">
                    {item.localized.answer}
                  </p>
                </Link>
                {item.relatedCardIds.length > 0 && (
                  <div className="border-t border-border-soft px-4 py-3 md:px-5">
                    <RelatedCardLinks cardIds={item.relatedCardIds} />
                  </div>
                )}
              </article>
            ))}
          </section>
        )}
      </div>
    </PageShell>
  );
}
