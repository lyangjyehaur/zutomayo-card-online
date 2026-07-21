import { BookOpenCheck, CalendarDays, ExternalLink, FileText, Hash, ListTree, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchOfficialRuleDocument, type OfficialRuleDocument, type OfficialRuleDocumentId } from '../api/client';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import {
  RulesSearchField,
  RulesTabs,
  SourceTextToggle,
  TranslationNotice,
  TranslationStatusBadge,
} from '../components/rules/OfficialRulesComponents';
import { t, useLocale } from '../i18n';
import { Alert, AppHeader, Badge, EmptyState, LoadingState, PageShell, cn } from '../ui';

function normalizeSearch(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function sectionAnchor(id: string): string {
  return `rule-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function RuleBody({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter(Boolean);
  return (
    <div className="grid gap-3 text-body leading-relaxed text-content-primary/85">
      {blocks.map((block, index) => (
        <p key={`${index}-${block.slice(0, 24)}`} className="whitespace-pre-line">
          {block}
        </p>
      ))}
    </div>
  );
}

export function OfficialRuleDocumentPage({ documentId }: { documentId: OfficialRuleDocumentId }) {
  const locale = useLocale();
  const [document, setDocument] = useState<OfficialRuleDocument | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setDocument(null);
    void fetchOfficialRuleDocument(documentId, locale)
      .then((result) => {
        if (active) setDocument(result);
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
  }, [documentId, locale]);

  const visibleSections = useMemo(() => {
    if (!document) return [];
    const needle = normalizeSearch(query);
    if (!needle) return document.sections;
    return document.sections.filter((section) =>
      normalizeSearch(
        [
          section.number,
          section.localized.title,
          section.localized.body,
          section.source.title,
          section.source.body,
        ].join('\n'),
      ).includes(needle),
    );
  }, [document, query]);

  const title =
    document?.localized.title ??
    (documentId === 'grand' ? t('officialRules.grandTitle') : t('officialRules.floorTitle'));
  const subtitle = documentId === 'grand' ? 'GRAND RULES' : 'BASIC FLOOR RULES';

  return (
    <PageShell variant="scroll" glow={{ color: documentId === 'grand' ? 'gold' : 'vermilion', size: 'lg' }}>
      <AppHeader title={title} subtitle={subtitle} backTo="/" actions={<LanguageSwitcher />} />
      <main className="relative mx-auto grid w-full max-w-6xl gap-6 px-4 pb-16 pt-24 md:px-6 md:pt-28">
        <RulesTabs />

        {loading ? (
          <LoadingState label={t('officialRules.loading')} />
        ) : error || !document ? (
          <Alert tone="danger" role="alert">
            {error || t('officialRules.notFound')}
          </Alert>
        ) : (
          <>
            <header className="grid gap-5 border-b border-border-soft pb-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div className="min-w-0">
                <p className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary">
                  {t('officialRules.officialDocument')}
                </p>
                <h1 className="mt-1 font-display text-title-lg font-bold text-content-primary">
                  {document.localized.title}
                </h1>
                <p className="mt-3 max-w-3xl text-body-sm leading-relaxed text-content-muted">
                  {document.localized.summary}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-caption text-content-dim">
                  <span className="inline-flex items-center gap-1.5">
                    <Hash className="size-3.5" aria-hidden="true" />v{document.version}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="size-3.5" aria-hidden="true" />
                    <time dateTime={document.publishedAt}>{document.publishedAt}</time>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <FileText className="size-3.5" aria-hidden="true" />
                    {t('officialRules.pageCount').replace('{count}', String(document.pageCount))}
                  </span>
                  <TranslationStatusBadge status={document.translationStatus} />
                </div>
              </div>
              <a
                href={document.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-border-strong px-4 text-body-sm text-content-muted transition hover:border-accent-primary/60 hover:text-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                {t('officialRules.openPdf')}
              </a>
            </header>

            <TranslationNotice status={document.translationStatus} />
            {documentId === 'floor' && (
              <Alert tone="info">
                <strong className="font-semibold">{t('officialRules.floorScopeTitle')}</strong>{' '}
                {t('officialRules.floorScopeBody')}
              </Alert>
            )}

            <RulesSearchField
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery('')}
              placeholder={t('officialRules.documentSearchPlaceholder')}
            />

            <div className="grid min-w-0 gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
              <aside className="min-w-0 lg:sticky lg:top-28 lg:self-start" aria-label={t('officialRules.contents')}>
                <details className="group border-y border-border-soft py-3 lg:border-0 lg:py-0" open>
                  <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 font-mono text-caption uppercase text-content-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color] [&::-webkit-details-marker]:hidden">
                    <ListTree className="size-4" aria-hidden="true" />
                    {t('officialRules.contents')}
                  </summary>
                  <nav className="mt-2 max-h-[calc(100vh-12rem)] overflow-y-auto pr-2">
                    <ol className="grid gap-0.5">
                      {document.sections
                        .filter((section) => section.level <= 2)
                        .map((section) => (
                          <li key={section.id}>
                            <a
                              href={`#${sectionAnchor(section.id)}`}
                              className={cn(
                                'block rounded-xs py-2 text-caption leading-snug text-content-muted transition hover:bg-surface-panel hover:text-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]',
                                section.level === 1 ? 'px-2 font-semibold' : 'pl-5 pr-2',
                              )}
                            >
                              {section.number ? `${section.number} ` : ''}
                              {section.localized.title}
                            </a>
                          </li>
                        ))}
                    </ol>
                  </nav>
                </details>
              </aside>

              <section className="min-w-0" aria-label={t('officialRules.documentSections')}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p
                    className="inline-flex items-center gap-2 font-mono text-caption text-content-dim"
                    aria-live="polite"
                  >
                    <BookOpenCheck className="size-4" aria-hidden="true" />
                    {t('officialRules.sectionCount').replace('{count}', String(visibleSections.length))}
                  </p>
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      className="inline-flex min-h-10 items-center gap-1.5 text-caption text-content-dim transition hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                      {t('officialRules.clearSearch')}
                    </button>
                  )}
                </div>

                {visibleSections.length === 0 ? (
                  <EmptyState title={t('officialRules.empty')} description={t('officialRules.emptyDescription')} />
                ) : (
                  <div className="divide-y divide-border-soft border-y border-border-soft">
                    {visibleSections.map((section) => (
                      <article
                        key={section.id}
                        id={sectionAnchor(section.id)}
                        className="scroll-mt-28 py-7 first:pt-5 md:py-9"
                      >
                        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            {section.number && (
                              <p className="font-mono text-caption text-accent-primary">{section.number}</p>
                            )}
                            <h2
                              className={cn(
                                'mt-1 font-display font-bold text-content-primary',
                                section.level === 1 ? 'text-title-md' : 'text-title-sm',
                              )}
                            >
                              {section.localized.title}
                            </h2>
                          </div>
                          <Badge>
                            {t('officialRules.sourcePages').replace(
                              '{pages}',
                              section.pages.start === section.pages.end
                                ? String(section.pages.start)
                                : `${section.pages.start}-${section.pages.end}`,
                            )}
                          </Badge>
                        </div>
                        <RuleBody text={section.localized.body} />
                        {locale !== 'ja' && (
                          <div className="mt-5">
                            <SourceTextToggle>
                              {section.source.title}
                              {'\n\n'}
                              {section.source.body}
                            </SourceTextToggle>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <footer className="border-t border-border-soft pt-5 font-mono text-minutia leading-relaxed text-content-dim">
              <p>{t('officialRules.sourceFingerprint').replace('{hash}', document.sourceSha256)}</p>
              <p className="mt-1">
                {t('officialRules.lastSynced')} {new Date(document.sourceCheckedAt).toLocaleString(locale)}
              </p>
            </footer>
          </>
        )}
      </main>
    </PageShell>
  );
}
