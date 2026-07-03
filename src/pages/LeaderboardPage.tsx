import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { getLeaderboard, getProfile, isLoggedIn, type LeaderboardEntry } from '../api/client';
import { BackButton, Badge, Card, DataListCell, DataListTable, Panel, PageShell } from '../components/ui';

export function LeaderboardPage() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getLeaderboard(100)
      .then((data) => {
        if (!cancelled) setEntries(data);
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

  return (
    <PageShell className="overflow-y-auto px-4 py-4 md:px-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <header className="flex flex-col gap-3 border-b border-bone/5 pb-4 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <BackButton className="min-h-10 self-start xl:min-h-0" type="button" onClick={() => navigate('/')}>
            {t('common.backToLobby')}
          </BackButton>
          <h1 className="font-display text-2xl italic text-gold sm:text-3xl">{t('leaderboard.title')}</h1>
          <div />
        </header>

        {loading && (
          <Panel className="font-mono text-[10px] uppercase tracking-[0.3em] text-bone/50">
            {t('leaderboard.loading')}
          </Panel>
        )}
        {error && (
          <Panel className="border-l-2 border-vermilion/50 bg-vermilion/10 text-xs text-vermilion/80" role="alert">
            {error}
          </Panel>
        )}

        {!loading && !error && entries.length === 0 && (
          <Panel className="font-mono text-[10px] uppercase tracking-[0.3em] text-bone/40">
            {t('leaderboard.empty')}
          </Panel>
        )}

        {!loading && !error && entries.length > 0 && (
          <>
            <Panel className="hidden overflow-x-auto lg:block" size="lg">
              <DataListTable>
                <thead className="font-mono text-[10px] uppercase tracking-[0.3em] text-bone/40">
                  <tr className="border-b border-bone/10">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">{t('leaderboard.nickname')}</th>
                    <th className="px-3 py-2">ELO</th>
                    <th className="px-3 py-2">{t('leaderboard.matches')}</th>
                    <th className="px-3 py-2">{t('leaderboard.wins')}</th>
                    <th className="px-3 py-2">{t('leaderboard.winRate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, i) => (
                    <tr key={entry.id} className={entry.id === currentUserId ? 'bg-gold/10' : 'odd:bg-lacquer-deep/30'}>
                      <DataListCell label="#">{i < 3 ? <Badge tone="gold">{i + 1}</Badge> : i + 1}</DataListCell>
                      <DataListCell label={t('leaderboard.nickname')}>
                        <div className="flex items-center gap-2">
                          <span>{entry.nickname}</span>
                          {entry.id === currentUserId && <Badge tone="jade">{t('leaderboard.currentUser')}</Badge>}
                        </div>
                      </DataListCell>
                      <DataListCell label="ELO">{entry.elo}</DataListCell>
                      <DataListCell label={t('leaderboard.matches')}>{entry.matchCount}</DataListCell>
                      <DataListCell label={t('leaderboard.wins')}>{entry.wins}</DataListCell>
                      <DataListCell label={t('leaderboard.winRate')}>{entry.winRate}%</DataListCell>
                    </tr>
                  ))}
                </tbody>
              </DataListTable>
            </Panel>

            <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
              {entries.map((entry, i) => (
                <Card key={entry.id} as="article" className={entry.id === currentUserId ? 'ring-gold/50' : ''}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {i < 3 ? (
                          <Badge tone="gold">{i + 1}</Badge>
                        ) : (
                          <span className="text-sm text-bone/50">#{i + 1}</span>
                        )}
                        {entry.id === currentUserId && <Badge tone="jade">{t('leaderboard.currentUser')}</Badge>}
                      </div>
                      <h2 className="mt-2 truncate text-base font-semibold text-bone">{entry.nickname}</h2>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-bone/40">ELO</span>
                      <strong className="block text-xl text-gold">{entry.elo}</strong>
                    </div>
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
                    <div className="rounded-sm bg-lacquer-deep/45 p-2">
                      <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-bone/40">
                        {t('leaderboard.matches')}
                      </dt>
                      <dd className="mt-1 font-semibold">{entry.matchCount}</dd>
                    </div>
                    <div className="rounded-sm bg-lacquer-deep/45 p-2">
                      <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-bone/40">
                        {t('leaderboard.wins')}
                      </dt>
                      <dd className="mt-1 font-semibold">{entry.wins}</dd>
                    </div>
                    <div className="rounded-sm bg-lacquer-deep/45 p-2">
                      <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-bone/40">
                        {t('leaderboard.winRate')}
                      </dt>
                      <dd className="mt-1 font-semibold">{entry.winRate}%</dd>
                    </div>
                  </dl>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
