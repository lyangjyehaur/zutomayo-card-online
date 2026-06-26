import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { getLeaderboard } from '../api/client';


export function LeaderboardPage() {
  const navigate = useNavigate();
  interface LeaderboardEntry { id: string; nickname: string; elo: number; matchCount: number; wins: number; winRate: number; }

const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getLeaderboard(100)
      .then(data => setEntries(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="leaderboard-page app-screen">
      <header className="screen-header">
        <button className="back-btn" onClick={() => navigate('/')}>{t('common.backToLobby')}</button>
        <h1>🏆 {t('leaderboard.title')}</h1>
      </header>

      {loading && <p className="loading-text">載入中...</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && entries.length === 0 && (
        <p className="empty-text">尚無排行資料</p>
      )}

      {entries.length > 0 && (
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>#</th>
              <th>暱稱</th>
              <th>ELO</th>
              <th>勝/負</th>
              <th>勝率</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => (
              <tr key={entry.id} className={i < 3 ? `top-${i + 1}` : ''}>
                <td className="rank">
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                </td>
                <td className="player-name">{entry.nickname}</td>
                <td className="elo">{entry.elo}</td>
                <td className="wl">{entry.wins}/{entry.matchCount - entry.wins}</td>
                <td className="winrate">{entry.winRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
