import { useEffect } from 'react';
import { ExternalLink, FileText, Mail, Scale, ShieldCheck } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';
import { useLocale } from '../i18n';
import {
  getLegalContent,
  LEGAL_CONTACT_EMAIL,
  LEGAL_EFFECTIVE_DATE,
  LEGAL_OPERATOR,
  OFFICIAL_FAN_GUIDELINE_URL,
  type LegalDocumentId,
} from '../legalContent';
import { AppHeader, PageShell, Panel } from '../ui';

const DOCUMENTS: Array<{ id: LegalDocumentId; path: string; Icon: typeof Scale }> = [
  { id: 'overview', path: '/legal', Icon: Scale },
  { id: 'privacy', path: '/legal/privacy', Icon: ShieldCheck },
  { id: 'terms', path: '/legal/terms', Icon: FileText },
  { id: 'contact', path: '/legal/contact', Icon: Mail },
];

export function LegalPage({ documentId }: { documentId: LegalDocumentId }) {
  const locale = useLocale();
  const content = getLegalContent(locale);
  const document = content.documents[documentId];

  useEffect(() => {
    const previousTitle = window.document.title;
    window.document.title = `${document.title} · ZUTOMAYO CARD ONLINE`;
    return () => {
      window.document.title = previousTitle;
    };
  }, [document.title]);

  return (
    <PageShell variant="scroll" glow={{ color: 'gold', size: 'md' }}>
      <AppHeader title={content.pageTitle} subtitle={LEGAL_OPERATOR} backTo="/" />
      <main className="relative z-[var(--z-dropdown)] px-4 pb-12 pt-20 md:pt-24">
        <div className="mx-auto grid w-full max-w-5xl gap-5">
          <header className="grid gap-3 pt-3">
            <p className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary">
              Public Beta Trust Center
            </p>
            <h1 className="font-display text-title-lg font-bold text-content-primary">{document.title}</h1>
            <p className="max-w-3xl text-body leading-relaxed text-content-muted">{document.summary}</p>
            <p className="text-caption text-content-dim">
              {content.updatedLabel}: <time dateTime={LEGAL_EFFECTIVE_DATE}>{LEGAL_EFFECTIVE_DATE}</time>
            </p>
          </header>

          <nav aria-label={content.navigationLabel} className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {DOCUMENTS.map(({ id, path, Icon }) => (
              <NavLink
                key={id}
                to={path}
                end={id === 'overview'}
                className={({ isActive }) =>
                  `flex min-h-12 items-center gap-2 rounded-sm border px-3 text-control transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color] ${
                    isActive
                      ? 'border-accent-primary/65 bg-accent-primary/10 text-accent-primary'
                      : 'border-border-soft bg-surface-base/45 text-content-muted hover:border-accent-primary/40 hover:text-content-primary'
                  }`
                }
              >
                <Icon className="size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                <span>{content.documents[id].title}</span>
              </NavLink>
            ))}
          </nav>

          <Panel size="lg">
            <article className="grid gap-8">
              {document.sections.map((section) => (
                <section key={section.heading} className="grid gap-3">
                  <h2 className="font-display text-title-sm font-bold text-content-primary">{section.heading}</h2>
                  {section.paragraphs?.map((paragraph) => (
                    <p key={paragraph} className="max-w-none text-body leading-7 text-content-muted">
                      {paragraph}
                    </p>
                  ))}
                  {section.bullets && (
                    <ul className="grid list-disc gap-2 pl-5 text-body leading-7 text-content-muted marker:text-accent-primary/70">
                      {section.bullets.map((bullet) => (
                        <li key={bullet}>{bullet}</li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </article>
          </Panel>

          <Panel className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center" size="md">
            <div>
              <h2 className="font-display text-body-lg font-bold text-content-primary">{LEGAL_OPERATOR}</h2>
              <p className="mt-1 text-body-sm text-content-muted">{content.authoritativeNotice}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-border-soft px-3 text-control text-content-muted transition hover:border-accent-primary/50 hover:text-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
                href={`mailto:${LEGAL_CONTACT_EMAIL}`}
              >
                <Mail className="size-4" aria-hidden="true" />
                {LEGAL_CONTACT_EMAIL}
              </a>
              <a
                className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-border-soft px-3 text-control text-content-muted transition hover:border-accent-primary/50 hover:text-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
                href={OFFICIAL_FAN_GUIDELINE_URL}
                target="_blank"
                rel="noreferrer"
              >
                ZUTOMAYO Guideline
                <ExternalLink className="size-4" aria-hidden="true" />
              </a>
            </div>
          </Panel>

          {documentId !== 'contact' && (
            <p className="text-center text-caption text-content-dim">
              <Link
                className="inline-flex min-h-11 items-center underline-offset-4 hover:text-accent-primary hover:underline"
                to="/legal/contact"
              >
                {content.documents.contact.title}
              </Link>
            </p>
          )}
        </div>
      </main>
    </PageShell>
  );
}
