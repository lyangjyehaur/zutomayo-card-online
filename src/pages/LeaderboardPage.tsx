import { useEffect, useState } from 'react';
import {
  getCurrentSeason,
  getLeaderboard,
  getProfile,
  getSeasonLeaderboard,
  isLoggedIn,
  type LeaderboardEntry,
  type Season,
  type SeasonLeaderboardEntry,
} from '../api/client';
import { t } from '../i18n';
import { AppHeader, Badge, Card, DataListCell, DataListTable, Panel, PageShell, SegmentedControl } from '../ui';

type LeaderboardMode = 'global' | 'season';

type DisplayEntry = {
  id: string;
  nickname: string;
  rating: number;
  matchCount: number;
  wins: number;
  detail: string;
};

function globalDisplayEntry(entry: LeaderboardEntry): DisplayEntry {
  return {
    id: entry.id,
    nickname: entry.nickname,
    rating: entry.elo,
    matchCount: entry.matchCount,
    wins: entry.wins,
    detail: `${entry.winRate}%`,
  };
}

function seasonDisplayEntry(entry: SeasonLeaderboardEntry): DisplayEntry {
  return {
    id: entry.userId,
    nickname: entry.nickname,
    rating: entry.rating,
    matchCount: entry.matchCount,
    wins: entry.wins,
    detail: entry.placementComplete ? t('leaderboard.placementComplete') : t('leaderboard.placementPending'),
  };
}

export function LeaderboardPage() {
  const [mode, setMode] = useState<LeaderboardMode>('global');
  const [globalEntries, setGlobalEntries] = useState<LeaderboardEntry[]>([]);
  const [seasonEntries, setSeasonEntries] = useState<SeasonLeaderboardEntry[]>([]);
  const [season, setSeason] = useState<Season | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    Promise.all([getLeaderboard(100), getCurrentSeason().catch(() => null)])
      .then(async ([entries, currentSeason]) => {
        const currentSeasonEntries = currentSeason ? await getSeasonLeaderboard(100).catch(() => []) : [];
        if (cancelled) return;
        setGlobalEntries(entries);
        setSeason(currentSeason);
        setSeasonEntries(currentSeasonEntries);
      })
      .catch(() => {
        if (!cancelled) setError(t('leaderboard.loadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    if (isLoggedIn()) {
      getProfile()
        .then((profile) => {
          if (!cancelled) setCurrentUserId(profile.id);
        })
        .catch(() => {
          if (!cancelled) setCurrentUserId(null);
        });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const entries = mode === 'global' ? globalEntries.map(globalDisplayEntry) : seasonEntries.map(seasonDisplayEntry);
  const ratingLabel = mode === 'global' ? 'ELO' : t('leaderboard.rating');
  const detailLabel = mode === 'global' ? t('leaderboard.winRate') : t('leaderboard.placement');
  const emptyLabel = mode === 'season' && !season ? t('leaderboard.noSeason') : t('leaderboard.empty');

  return (
    <PageShell>
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute inset-0 opacity-[0.04] [background-image:var(--pattern-dot)] [background-size:var(--pattern-dot-size)]" />
      </div>
      <AppHeader title={t('leaderboard.title')} backTo="/" />
      <main className="relative z-[var(--z-dropdown)] h-full overflow-y-auto px-4 pb-10 pt-20 md:pt-24">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
          <Panel className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SegmentedControl
              behavior="tabs"
              ariaLabel={t('leaderboard.title')}
              options={[
                { value: 'global', label: t('leaderboard.global') },
                { value: 'season', label: t('leaderboard.season') },
              ]}
              value={mode}
              onChange={setMode}
            />
            {mode === 'season' && season && (
              <div className="min-w-0 text-right">
                <strong className="block truncate text-body-sm">{season.name}</strong>
                <span className="text-caption text-content-muted">
                  {t('leaderboard.seasonEnds')} · {new Date(season.endsAt).toLocaleDateString()}
                </span>
              </div>
            )}
          </Panel>

          {loading && (
            <Panel className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/50">
              {t('leaderboard.loading')}
            </Panel>
          )}
          {error && (
            <Panel
              className="border-l-2 border-accent-action/50 bg-accent-action/10 text-xs text-accent-action/80"
              role="alert"
            >
              {error}
            </Panel>
          )}

          {!loading && !error && entries.length === 0 && (
            <Panel className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40">
              {emptyLabel}
            </Panel>
          )}

          {!loading && !error && entries.length > 0 && (
            <>
              <Panel className="hidden overflow-x-auto lg:block" size="lg">
                <DataListTable>
                  <thead className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40">
                    <tr className="border-b border-content-primary/10">
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">{t('leaderboard.nickname')}</th>
                      <th className="px-3 py-2">{ratingLabel}</th>
                      <th className="px-3 py-2">{t('leaderboard.matches')}</th>
                      <th className="px-3 py-2">{t('leaderboard.wins')}</th>
                      <th className="px-3 py-2">{detailLabel}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry, index) => (
                      <tr
                        key={entry.id}
                        className={entry.id === currentUserId ? 'bg-accent-primary/10' : 'odd:bg-surface-canvas/30'}
                      >
                        <DataListCell label="#">
                          {index < 3 ? <Badge tone="gold">{index + 1}</Badge> : index + 1}
                        </DataListCell>
                        <DataListCell label={t('leaderboard.nickname')}>
                          <div className="flex items-center gap-2">
                            <span>{entry.nickname}</span>
                            {entry.id === currentUserId && <Badge tone="jade">{t('leaderboard.currentUser')}</Badge>}
                          </div>
                        </DataListCell>
                        <DataListCell label={ratingLabel}>{entry.rating}</DataListCell>
                        <DataListCell label={t('leaderboard.matches')}>{entry.matchCount}</DataListCell>
                        <DataListCell label={t('leaderboard.wins')}>{entry.wins}</DataListCell>
                        <DataListCell label={detailLabel}>{entry.detail}</DataListCell>
                      </tr>
                    ))}
                  </tbody>
                </DataListTable>
              </Panel>

              <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
                {entries.map((entry, index) => (
                  <Card
                    key={entry.id}
                    as="article"
                    className={entry.id === currentUserId ? 'ring-accent-primary/50' : ''}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {index < 3 ? (
                            <Badge tone="gold">{index + 1}</Badge>
                          ) : (
                            <span className="text-sm text-content-primary/50">#{index + 1}</span>
                          )}
                          {entry.id === currentUserId && <Badge tone="jade">{t('leaderboard.currentUser')}</Badge>}
                        </div>
                        <h2 className="mt-2 truncate text-base font-semibold text-content-primary">{entry.nickname}</h2>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="font-mono text-minutia uppercase tracking-[var(--tracking-control)] text-content-primary/40">
                          {ratingLabel}
                        </span>
                        <strong className="block text-xl text-accent-primary">{entry.rating}</strong>
                      </div>
                    </div>
                    <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
                      <div className="rounded-sm bg-surface-canvas/45 p-2">
                        <dt className="font-mono text-minutia uppercase tracking-[var(--tracking-compact)] text-content-primary/40">
                          {t('leaderboard.matches')}
                        </dt>
                        <dd className="mt-1 font-semibold">{entry.matchCount}</dd>
                      </div>
                      <div className="rounded-sm bg-surface-canvas/45 p-2">
                        <dt className="font-mono text-minutia uppercase tracking-[var(--tracking-compact)] text-content-primary/40">
                          {t('leaderboard.wins')}
                        </dt>
                        <dd className="mt-1 font-semibold">{entry.wins}</dd>
                      </div>
                      <div className="rounded-sm bg-surface-canvas/45 p-2">
                        <dt className="font-mono text-minutia uppercase tracking-[var(--tracking-compact)] text-content-primary/40">
                          {detailLabel}
                        </dt>
                        <dd className="mt-1 font-semibold">{entry.detail}</dd>
                      </div>
                    </dl>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
    </PageShell>
  );
}
