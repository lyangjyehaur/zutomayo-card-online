import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { getLeaderboard, getProfile, isLoggedIn, type LeaderboardEntry } from '../api/client';
import { BackButton, Badge, Panel, PageShell } from '../components/ui';

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
        <header className="grid grid-cols-[1fr_auto_1fr] items-center border-b border-bone/5 pb-4">
          <BackButton type="button" onClick={() => navigate('/')}>
            {t('common.backToLobby')}
          </BackButton>
          <h1 className="font-display text-3xl italic text-gold">{t('leaderboard.title')}</h1>
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
          <Panel className="overflow-x-auto" size="lg">
            <table className="w-full border-collapse text-left text-sm">
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
                    <td className="px-3 py-2">{i < 3 ? <Badge tone="gold">{i + 1}</Badge> : i + 1}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span>{entry.nickname}</span>
                        {entry.id === currentUserId && <Badge tone="jade">{t('leaderboard.currentUser')}</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2">{entry.elo}</td>
                    <td className="px-3 py-2">{entry.matchCount}</td>
                    <td className="px-3 py-2">{entry.wins}</td>
                    <td className="px-3 py-2">{entry.winRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </div>
    </PageShell>
  );
}
