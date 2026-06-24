import { getMatchRecords, getMatchStats, clearMatchRecords, type MatchRecord } from '../game/matchHistory';

interface MatchHistoryProps {
  onBack: () => void;
}

export function MatchHistory({ onBack }: MatchHistoryProps) {
  const records = getMatchRecords();
  const stats = getMatchStats();

  return (
    <div className="match-history">
      <div className="match-history-header">
        <h2>📊 Match History</h2>
        <button className="back-btn" onClick={onBack}>← Back</button>
      </div>

      <div className="stats-bar">
        <div className="stat">
          <span className="stat-value">{stats.totalMatches}</span>
          <span className="stat-label">Total</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.wins[0]}</span>
          <span className="stat-label">P0 Wins</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.wins[1]}</span>
          <span className="stat-label">P1 Wins</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.avgTurns}</span>
          <span className="stat-label">Avg Turns</span>
        </div>
      </div>

      {records.length === 0 ? (
        <p className="no-records">No matches recorded yet.</p>
      ) : (
        <div className="records-list">
          {records.map((r, i) => (
            <div key={r.id} className="record-item">
              <div className="record-result">
                {r.winner === 0 ? '🟢 P0' : r.winner === 1 ? '🔴 P1' : '⚪ Draw'}
              </div>
              <div className="record-details">
                <span>Turn {r.turns}</span>
                <span>P0 HP: {r.players[0].hp} | P1 HP: {r.players[1].hp}</span>
                <span>{r.chronos.nightSidePlayer === 0 ? '🌙' : '☀️'} Side {r.chronos.nightSidePlayer}</span>
              </div>
              <div className="record-date">
                {new Date(r.date).toLocaleDateString()} {new Date(r.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ))}
        </div>
      )}

      {records.length > 0 && (
        <button className="clear-btn" onClick={() => {
          clearMatchRecords();
          onBack();
        }}>
          Clear History
        </button>
      )}
    </div>
  );
}
