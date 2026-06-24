import { useState, useEffect } from 'react';
import { getLeaderboard } from '../api/client';

interface LeaderboardEntry {
  id: string;
  nickname: string;
  elo: number;
  matchCount: number;
  wins: number;
  winRate: number;
}

interface LeaderboardProps {
  onBack: () => void;
}

export function Leaderboard({ onBack }: LeaderboardProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getLeaderboard(100).then(data => {
      setEntries(data.leaderboard);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="leaderboard">
      <div className="leaderboard-header">
        <h2>🏆 Leaderboard</h2>
        <button className="back-btn" onClick={onBack}>← Back</button>
      </div>

      {loading ? (
        <p className="loading-text">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="no-entries">No players yet. Be the first to register!</p>
      ) : (
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>ELO</th>
              <th>W/L</th>
              <th>Win%</th>
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
    </div>
  );
}
