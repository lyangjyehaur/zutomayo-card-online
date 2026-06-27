import { useState } from 'react';
import { clearMatchRecords, downloadMatchActionLog, getMatchRecords, getMatchStats, type MatchRecord } from '../game/matchHistory';
import type { ActionLogEntry } from '../game/types';
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

function formatTracePayload(payload: ActionLogEntry['payload']): string {
  if (!payload || typeof payload !== 'object') return '';
  const parts = Object.entries(payload)
    .filter(([, value]) => value !== undefined && value !== null && typeof value !== 'object')
    .map(([key, value]) => `${key}: ${String(value)}`);
  return parts.join(' · ');
}

function traceContext(entry: ActionLogEntry): string[] {
  const lines: string[] = [];
  if (entry.hp) lines.push(`${t('history.traceHp')} ${entry.hp[0]}/${entry.hp[1]}`);
  if (typeof entry.chronosPosition === 'number') lines.push(`${t('history.traceChronos')} ${entry.chronosPosition}/12`);
  if (entry.pendingEffectCardDefId) lines.push(`${t('history.traceEffectCard')} ${entry.pendingEffectCardDefId}`);
  if (entry.pendingChoiceType) lines.push(`${t('history.traceChoice')} ${entry.pendingChoiceType}`);
  return lines;
}

function TraceEntry({ entry }: { entry: ActionLogEntry }) {
  const payload = formatTracePayload(entry.payload);
  const context = traceContext(entry);
  return (
    <li className="trace-entry">
      <div className="trace-entry-main">
        <strong>#{entry.id ?? '-'} T{entry.turn} · P{entry.player + 1} · {entry.action}</strong>
        <span>{entry.step}</span>
      </div>
      {payload && <p>{payload}</p>}
      {entry.result?.message && <p className={entry.result.ok ? 'trace-ok' : 'trace-fail'}>{entry.result.message}</p>}
      {context.length > 0 && <small>{context.join(' · ')}</small>}
    </li>
  );
}

function MatchDetail({ record, onClose }: { record: MatchRecord; onClose: () => void }) {
  const trace = record.actionLog ?? [];
  return (
    <div className="match-detail-backdrop" role="presentation">
      <section className="match-detail-panel" role="dialog" aria-modal="true" aria-labelledby="match-detail-title">
        <header className="match-detail-header">
          <div>
            <span>{new Date(record.date).toLocaleString()}</span>
            <h2 id="match-detail-title">{winnerLabel(record)}</h2>
          </div>
          <button className="secondary-action" type="button" onClick={onClose}>{t('common.close')}</button>
        </header>
        <div className="match-detail-grid">
          <div><span>{t('history.turns')}</span><strong>{record.turns}</strong></div>
          <div><span>{t('history.duration')}</span><strong>{formatDuration(record.duration)}</strong></div>
          <div><span>{t('history.finalHp')}</span><strong>{record.players[0].hp}/{record.players[1].hp}</strong></div>
          <div><span>{t('history.finalChronos')}</span><strong>{record.chronos.finalPosition}/12</strong></div>
        </div>
        <div className="match-detail-actions">
          <button className="secondary-action" type="button" onClick={() => downloadMatchActionLog(record)}>
            {t('history.downloadTrace')}
          </button>
        </div>
        <section className="trace-panel">
          <h3>{t('history.traceTitle')}</h3>
          {trace.length === 0 ? (
            <p className="empty-state">{t('history.traceEmpty')}</p>
          ) : (
            <ol className="trace-list">
              {trace.map((entry, index) => <TraceEntry key={`${entry.id ?? index}-${entry.timestamp}`} entry={entry} />)}
            </ol>
          )}
        </section>
      </section>
    </div>
  );
}

export function MatchHistory({ onBack }: MatchHistoryProps) {
  const [records, setRecords] = useState(() => getMatchRecords());
  const [page, setPage] = useState(0);
  const [selectedRecord, setSelectedRecord] = useState<MatchRecord | null>(null);
  const stats = getMatchStats();
  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const visibleRecords = records.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const clearHistory = () => {
    clearMatchRecords();
    setRecords([]);
    setPage(0);
    setSelectedRecord(null);
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
        <div className="stat"><span>{t('history.total')}</span><strong>{stats.totalMatches}</strong></div>
        <div className="stat"><span>{t('history.p0Wins')}</span><strong>{stats.wins[0]}</strong></div>
        <div className="stat"><span>{t('history.p1Wins')}</span><strong>{stats.wins[1]}</strong></div>
        <div className="stat"><span>{t('history.avgTurns')}</span><strong>{stats.avgTurns}</strong></div>
      </section>

      <section className="records-panel">
        <div className="panel-title-row">
          <h2>{t('history.title')}</h2>
          <div className="pager">
            <button type="button" disabled={currentPage === 0} onClick={() => setPage(value => Math.max(0, value - 1))}>{t('common.prev')}</button>
            <span>{currentPage + 1}/{totalPages} {t('common.page')}</span>
            <button type="button" disabled={currentPage >= totalPages - 1} onClick={() => setPage(value => Math.min(totalPages - 1, value + 1))}>{t('common.next')}</button>
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
                  <span>{t('history.traceCount')} {(record.actionLog ?? []).length}</span>
                </div>
                <div className="record-actions">
                  <button className="secondary-action" type="button" onClick={() => setSelectedRecord(record)}>{t('history.viewTrace')}</button>
                  <button className="secondary-action" type="button" onClick={() => downloadMatchActionLog(record)}>{t('history.downloadTrace')}</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {selectedRecord && <MatchDetail record={selectedRecord} onClose={() => setSelectedRecord(null)} />}
    </main>
  );
}
