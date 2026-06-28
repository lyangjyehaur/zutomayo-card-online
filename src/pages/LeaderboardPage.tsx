import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { getLeaderboard, getProfile, isLoggedIn, type LeaderboardEntry } from '../api/client';

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
    <main className="min-h-screen container mx-auto flex flex-col gap-4 p-4">
      <header className="navbar rounded-box bg-base-200 shadow-xl">
        <button className="btn btn-ghost" type="button" onClick={() => navigate('/')}>
          {t('common.backToLobby')}
        </button>
        <h1 className="text-2xl font-bold text-primary">{t('leaderboard.title')}</h1>
        <div />
      </header>

      {loading && (
        <div className="alert alert-info">
          <span>{t('leaderboard.loading')}</span>
        </div>
      )}
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <div className="alert">
          <span>{t('leaderboard.empty')}</span>
        </div>
      )}

      {!loading && !error && entries.length > 0 && (
        <div className="overflow-x-auto rounded-box bg-base-200 shadow-xl">
          <table className="table table-zebra table-sm">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('leaderboard.nickname')}</th>
                <th>ELO</th>
                <th>{t('leaderboard.matches')}</th>
                <th>{t('leaderboard.wins')}</th>
                <th>{t('leaderboard.winRate')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <tr key={entry.id} className={entry.id === currentUserId ? 'bg-primary/10' : ''}>
                  <td>{i < 3 ? <span className="badge badge-primary">{i + 1}</span> : i + 1}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span>{entry.nickname}</span>
                      {entry.id === currentUserId && (
                        <span className="badge badge-success">{t('leaderboard.currentUser')}</span>
                      )}
                    </div>
                  </td>
                  <td>{entry.elo}</td>
                  <td>{entry.matchCount}</td>
                  <td>{entry.wins}</td>
                  <td>{entry.winRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
