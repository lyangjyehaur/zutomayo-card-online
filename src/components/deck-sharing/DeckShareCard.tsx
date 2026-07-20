import { Copy, Heart, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { DeckShareSummary } from '../../api/client';
import { t, useLocale } from '../../i18n';
import { Badge, Card } from '../../ui';
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
  const navigate = useNavigate();
  const locale = useLocale();
  const openShare = () => navigate(`/deck-shares/${encodeURIComponent(share.id)}`);

  return (
    <Card
      as="article"
      interactive
      className="group grid min-h-full cursor-pointer gap-4 overflow-hidden"
      role="link"
      tabIndex={0}
      aria-label={`${share.name} · ${share.owner.nickname}`}
      onClick={openShare}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openShare();
        }
      }}
    >
      <div className="grid grid-cols-3 gap-2" aria-hidden="true">
        {share.representativeCardIds.map((cardId) => (
          <div key={cardId} className="overflow-hidden rounded-sm bg-surface-canvas ring-1 ring-border-soft">
            <CardImage
              cardId={cardId}
              context="thumbnail"
              alt=""
              className="aspect-[5/7] h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
            />
          </div>
        ))}
        {Array.from({ length: Math.max(0, 3 - share.representativeCardIds.length) }, (_, index) => (
          <div
            key={`placeholder-${index}`}
            className="aspect-[5/7] rounded-sm bg-surface-canvas ring-1 ring-border-soft"
          />
        ))}
      </div>

      <div className="grid gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-display text-title-sm font-bold text-content-primary">{share.name}</h2>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-body-sm text-content-muted">
            <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{share.owner.nickname || t('deckShare.unknownAuthor')}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={share.updatedAt || undefined}>{relativeTime(share.updatedAt, locale)}</time>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {share.elements.map((element) => (
            <Badge key={element} tone="neutral">
              {element}
            </Badge>
          ))}
          <Badge tone={share.characterCount >= 10 ? 'jade' : 'gold'}>
            {t('deckShare.characters').replace('{count}', String(share.characterCount))}
          </Badge>
        </div>

        <div className="flex items-center gap-4 border-t border-border-soft pt-3 font-mono text-caption text-content-muted">
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
        </div>
      </div>
    </Card>
  );
}
