import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
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
import { Alert, AppHeader, LoadingState, PageShell, Panel } from '../ui';

export function OfficialQaDetailPage() {
  const locale = useLocale();
  const params = useParams();
  const number = Number(params.number);
  const [item, setItem] = useState<OfficialQaItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
        backTo="/rules/qa"
        actions={<LanguageSwitcher />}
      />
      <div className="relative mx-auto grid w-full max-w-4xl gap-5 px-4 pb-12 pt-24 md:px-6 md:pt-28">
        <RulesTabs />
        {loading ? (
          <LoadingState label={t('officialRules.loading')} />
        ) : error || !item ? (
          <Alert tone="danger" role="alert">
            {error || t('officialRules.notFound')}
          </Alert>
        ) : (
          <>
            <Panel className="grid gap-5 bg-surface-panel/75 backdrop-blur" size="lg">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-caption text-accent-primary">Q.{item.number}</p>
                  <time className="font-mono text-caption text-content-dim" dateTime={item.publishedAt}>
                    {item.publishedAt}
                  </time>
                </div>
                <TranslationStatusBadge status={item.translationStatus} />
              </div>
              <h1 className="font-display text-title-md font-bold leading-relaxed">{item.localized.question}</h1>
              <div className="border-l-2 border-accent-primary/50 pl-4">
                <p className="mb-2 font-mono text-caption uppercase tracking-[var(--tracking-control)] text-accent-primary">
                  {t('officialRules.answer')}
                </p>
                <FormattedText>{item.localized.answer}</FormattedText>
              </div>
              <TranslationNotice status={item.translationStatus} />
              <RelatedCardLinks cardIds={item.relatedCardIds} />
            </Panel>
            {item.effectiveLocale !== 'ja' && (
              <SourceTextToggle>
                <strong className="mb-3 block text-content-primary">{item.source.question}</strong>
                <FormattedText className="text-content-muted">{item.source.answer}</FormattedText>
              </SourceTextToggle>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <OfficialSourceLink href={item.sourceUrl} />
              <span className="font-mono text-caption text-content-dim">
                {t('officialRules.lastSynced')}{' '}
                {item.lastSyncedAt ? new Date(item.lastSyncedAt).toLocaleString(locale) : '—'}
              </span>
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
