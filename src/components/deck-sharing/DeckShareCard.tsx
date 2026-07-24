import { ArrowRight, Copy, Heart, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { DeckShareSummary } from '../../api/client';
import { isLocalDeckShareDemo } from '../../deckShareDemo';
import { deckShareElementLabel } from '../../deckShareUi';
import { t, useLocale } from '../../i18n';
import { Badge } from '../../ui';
import { CardImage } from '../CardImage';

function relativeTime(iso: string | null, locale: string): string {
  if (!iso) return '';
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (absolute < 60) return formatter.format(seconds, 'second');
  if (absolute < 3600) return formatter.format(Math.round(seconds / 60), 'minute');
  if (absolute < 86400) return formatter.format(Math.round(seconds / 3600), 'hour');
  if (absolute < 2592000) return formatter.format(Math.round(seconds / 86400), 'day');
  return formatter.format(Math.round(seconds / 2592000), 'month');
}

export function DeckShareCard({ share }: { share: DeckShareSummary }) {
  const locale = useLocale();
  const localPreview = isLocalDeckShareDemo(share.id);

  return (
    <article className="h-full min-w-0">
      <Link
        to={`/deck-shares/${encodeURIComponent(share.id)}`}
        className="group flex h-full min-h-0 flex-col overflow-hidden rounded-sm border border-border-soft bg-surface-panel/70 shadow-floating backdrop-blur transition hover:border-accent-primary/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
        aria-label={`${share.name} · ${share.owner.nickname}`}
      >
        <div
          className="relative grid grid-cols-3 gap-2 border-b border-border-soft bg-surface-canvas/70 p-3"
          aria-hidden="true"
        >
          {share.representativeCardIds.map((cardId) => (
            <div key={cardId} className="overflow-hidden rounded-sm bg-surface-base/80 ring-1 ring-border-soft">
              <CardImage
                cardId={cardId}
                context="thumbnail"
                alt=""
                className="aspect-[5/7] h-full w-full object-contain transition duration-300 group-hover:scale-[1.025]"
              />
            </div>
          ))}
          {Array.from({ length: Math.max(0, 3 - share.representativeCardIds.length) }, (_, index) => (
            <div
              key={`placeholder-${index}`}
              className="aspect-[5/7] rounded-sm bg-surface-base/80 ring-1 ring-border-soft"
            />
          ))}
          {localPreview && (
            <Badge className="absolute left-3 top-3 shadow-floating" tone="gold">
              {t('deckShare.localPreview')}
            </Badge>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <div className="min-w-0">
            <p className="font-mono text-caption uppercase text-accent-primary">{t('deckShare.public')}</p>
            <h2 className="mt-1 break-words font-display text-title-sm font-bold leading-snug text-content-primary transition group-hover:text-accent-primary">
              {share.name}
            </h2>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-content-muted">
              <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{share.owner.nickname || t('deckShare.unknownAuthor')}</span>
              <span aria-hidden="true">·</span>
              <time dateTime={share.updatedAt || undefined}>{relativeTime(share.updatedAt, locale)}</time>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {share.elements.map((element) => (
              <Badge key={element} tone="neutral">
                {deckShareElementLabel(element, t)}
              </Badge>
            ))}
            <Badge tone={share.characterCount >= 10 ? 'jade' : 'gold'}>
              {t('deckShare.characters').replace('{count}', String(share.characterCount))}
            </Badge>
          </div>

          <div className="mt-auto flex items-center gap-3 border-t border-border-soft pt-3 font-mono text-caption text-content-muted">
            <span className="inline-flex items-center gap-1.5">
              <Heart className="size-3.5" aria-hidden="true" />
              <span>{share.likeCount}</span>
              <span className="sr-only">{t('deckShare.likes')}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Copy className="size-3.5" aria-hidden="true" />
              <span>{share.copyCount}</span>
              <span className="sr-only">{t('deckShare.copies')}</span>
            </span>
            <span className="ml-auto inline-flex items-center gap-2 text-content-dim transition group-hover:text-accent-primary">
              <span>{t('deckShare.openDeck')}</span>
              <ArrowRight className="size-4 transition group-hover:translate-x-1" aria-hidden="true" />
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}
