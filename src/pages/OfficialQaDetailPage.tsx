import { CalendarDays } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { fetchOfficialQaItem, type OfficialQaItem } from '../api/client';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import {
  FormattedText,
  OfficialSourceLink,
  RelatedCardLinks,
  RulesTabs,
  SourceTextToggle,
  TranslationNotice,
  TranslationStatusBadge,
} from '../components/rules/OfficialRulesComponents';
import { t, useLocale } from '../i18n';
import { Alert, AppHeader, LoadingState, PageShell, Tag } from '../ui';

export function OfficialQaDetailPage() {
  const locale = useLocale();
  const location = useLocation();
  const params = useParams();
  const number = Number(params.number);
  const [item, setItem] = useState<OfficialQaItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const backTo =
    typeof location.state === 'object' && location.state && 'from' in location.state
      ? String(location.state.from)
      : '/rules/qa';

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void fetchOfficialQaItem(number, locale)
      .then((result) => {
        if (active) setItem(result);
      })
      .catch(() => {
        if (active) setError(t('officialRules.notFound'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [locale, number]);

  return (
    <PageShell variant="scroll" glow={{ color: 'gold', size: 'lg' }}>
      <AppHeader
        title={item ? `Q.${item.number}` : t('officialRules.qaTitle')}
        backTo={backTo}
        actions={<LanguageSwitcher />}
      />
      <div className="relative mx-auto grid w-full max-w-4xl gap-6 px-4 pb-12 pt-24 md:px-6 md:pt-28">
        <RulesTabs />
        {loading ? (
          <LoadingState label={t('officialRules.loading')} />
        ) : error || !item ? (
          <Alert tone="danger" role="alert">
            {error || t('officialRules.notFound')}
          </Alert>
        ) : (
          <>
            <article>
              <header className="border-b border-border-soft pb-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="font-mono text-caption text-accent-primary">Q.{item.number}</span>
                    <time
                      className="inline-flex items-center gap-1.5 font-mono text-caption text-content-dim"
                      dateTime={item.publishedAt}
                    >
                      <CalendarDays className="size-3.5" aria-hidden="true" />
                      {item.publishedAt}
                    </time>
                  </div>
                  <TranslationStatusBadge status={item.translationStatus} />
                </div>
                <h1 className="mt-5 max-w-3xl font-display text-title-md font-bold leading-relaxed md:text-title-lg">
                  {item.localized.question}
                </h1>
                {item.tags.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {[...new Set(item.tags)].map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </div>
                )}
              </header>

              <section className="my-7 border-l-2 border-accent-primary/60 bg-accent-primary/5 px-4 py-5 md:px-6">
                <h2 className="mb-3 font-mono text-caption uppercase tracking-[var(--tracking-control)] text-accent-primary">
                  {t('officialRules.answer')}
                </h2>
                <FormattedText className="text-body-lg leading-loose">{item.localized.answer}</FormattedText>
              </section>

              <div className="grid gap-5 border-y border-border-soft py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <TranslationNotice status={item.translationStatus} />
                <OfficialSourceLink href={item.sourceUrl} />
              </div>
            </article>

            {item.relatedCardIds.length > 0 && (
              <section aria-labelledby="qa-related-cards">
                <h2
                  id="qa-related-cards"
                  className="mb-3 font-mono text-caption uppercase tracking-[var(--tracking-control)] text-content-dim"
                >
                  {t('officialRules.relatedCards')}
                </h2>
                <RelatedCardLinks cardIds={item.relatedCardIds} />
              </section>
            )}

            {item.effectiveLocale !== 'ja' && (
              <SourceTextToggle>
                <strong className="mb-3 block text-content-primary">{item.source.question}</strong>
                <FormattedText className="text-content-muted">{item.source.answer}</FormattedText>
              </SourceTextToggle>
            )}

            <p className="text-right font-mono text-caption text-content-dim">
              {t('officialRules.lastSynced')}{' '}
              {item.lastSyncedAt ? new Date(item.lastSyncedAt).toLocaleString(locale) : '—'}
            </p>
          </>
        )}
      </div>
    </PageShell>
  );
}
