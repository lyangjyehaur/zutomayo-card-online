import { useState } from 'react';
import { clearMatchRecords, getMatchRecords, getMatchStats, type MatchRecord } from '../game/matchHistory';
import { t } from '../i18n';

interface MatchHistoryProps {
  onBack: () => void;
}

const PAGE_SIZE = 6;

function winnerLabel(record: MatchRecord): string {
  if (record.winner === 0) return `${t('player.zero')} ${t('board.playerWins')}`;
  if (record.winner === 1) return `${t('player.one')} ${t('board.playerWins')}`;
  return t('history.draw');
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

export function MatchHistory({ onBack }: MatchHistoryProps) {
  const [records, setRecords] = useState(() => getMatchRecords());
  const [page, setPage] = useState(0);
  const stats = getMatchStats();
  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const visibleRecords = records.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const clearHistory = () => {
    clearMatchRecords();
    setRecords([]);
    setPage(0);
  };

  return (
    <main className="match-history app-screen">
      <header className="screen-header">
        <div>
          <span>{t('lobby.menu')}</span>
          <h1>{t('history.title')}</h1>
        </div>
        <div className="screen-actions">
          <button className="secondary-action" type="button" onClick={onBack}>{t('common.backToLobby')}</button>
          <button className="danger-action" type="button" disabled={records.length === 0} onClick={clearHistory}>
            {t('history.clear')}
          </button>
        </div>
      </header>

      <section className="history-stats">
        <div className="stat">
          <span>{t('history.total')}</span>
          <strong>{stats.totalMatches}</strong>
        </div>
        <div className="stat">
          <span>{t('history.p0Wins')}</span>
          <strong>{stats.wins[0]}</strong>
        </div>
        <div className="stat">
          <span>{t('history.p1Wins')}</span>
          <strong>{stats.wins[1]}</strong>
        </div>
        <div className="stat">
          <span>{t('history.avgTurns')}</span>
          <strong>{stats.avgTurns}</strong>
        </div>
      </section>

      <section className="records-panel">
        <div className="panel-title-row">
          <h2>{t('history.title')}</h2>
          <div className="pager">
            <button type="button" disabled={currentPage === 0} onClick={() => setPage(value => Math.max(0, value - 1))}>
              {t('common.prev')}
            </button>
            <span>{currentPage + 1}/{totalPages} {t('common.page')}</span>
            <button type="button" disabled={currentPage >= totalPages - 1} onClick={() => setPage(value => Math.min(totalPages - 1, value + 1))}>
              {t('common.next')}
            </button>
          </div>
        </div>

        {records.length === 0 ? (
          <div className="empty-state">{t('history.noRecords')}</div>
        ) : (
          <div className="records-list">
            {visibleRecords.map(record => (
              <article key={record.id} className="record-item">
                <div className="record-result">
                  <strong>{winnerLabel(record)}</strong>
                  <span>{new Date(record.date).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="record-details">
                  <span>{t('history.turns')} {record.turns}</span>
                  <span>{t('history.duration')} {formatDuration(record.duration)}</span>
                  <span>{t('history.finalHp')} {record.players[0].hp}/{record.players[1].hp}</span>
                  <span>{t('history.finalChronos')} {record.chronos.finalPosition}/12</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
