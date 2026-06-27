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
      .then(data => {
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
        .then(profile => {
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
    <main className="leaderboard-page app-screen">
      <header className="screen-header">
        <button className="back-btn" type="button" onClick={() => navigate('/')}>{t('common.backToLobby')}</button>
        <h1>{t('leaderboard.title')}</h1>
      </header>

      {loading && <p className="loading-text">{t('leaderboard.loading')}</p>}
      {error && <p className="error-copy error-text" role="alert">{error}</p>}

      {!loading && !error && entries.length === 0 && (
        <p className="empty-text">{t('leaderboard.empty')}</p>
      )}

      {!loading && !error && entries.length > 0 && (
        <table className="leaderboard-table">
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
              <tr
                key={entry.id}
                className={`${i < 3 ? `top-${i + 1}` : ''} ${entry.id === currentUserId ? 'current-user' : ''}`.trim()}
              >
                <td className="rank">
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                </td>
                <td className="player-name">
                  {entry.nickname}
                  {entry.id === currentUserId && <span>{t('leaderboard.currentUser')}</span>}
                </td>
                <td className="elo">{entry.elo}</td>
                <td>{entry.matchCount}</td>
                <td>{entry.wins}</td>
                <td className="winrate">{entry.winRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
