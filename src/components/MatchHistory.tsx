import { useState } from 'react';
import {
  clearMatchRecords,
  downloadMatchActionLog,
  getMatchRecords,
  getMatchStats,
  type MatchRecord,
} from '../game/matchHistory';
import type { ActionLogEntry } from '../game/types';
import { getTranslatedEffect } from '../game/cards/i18n';
import { t, useLocale } from '../i18n';

interface MatchHistoryProps {
  onBack: () => void;
}

const PAGE_SIZE = 6;

function winnerLabel(record: MatchRecord): string {
  if (record.winner === 0) return `${t('player.zero')} ${t('board.playerWins')}`;
  if (record.winner === 1) return `${t('player.one')} ${t('board.playerWins')}`;
  return t('history.draw');
}

function resultBadgeClass(record: MatchRecord): string {
  if (record.winner === null) return 'badge badge-warning';
  return 'badge badge-success';
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

function traceResultMessage(entry: ActionLogEntry, locale: string): string | null {
  if (entry.pendingEffectCardDefId) {
    return getTranslatedEffect(entry.pendingEffectCardDefId, locale) ?? entry.result?.message ?? null;
  }
  return entry.result?.message ?? null;
}

function TraceEntry({ entry, locale }: { entry: ActionLogEntry; locale: string }) {
  const payload = formatTracePayload(entry.payload);
  const context = traceContext(entry);
  const resultMessage = traceResultMessage(entry, locale);
  return (
    <li className="card bg-base-200 shadow">
      <div className="card-body gap-2">
        <strong>
          #{entry.id ?? '-'} T{entry.turn} · P{entry.player + 1} · {entry.action}
        </strong>
        <span>{entry.step}</span>
        {payload && <p>{payload}</p>}
        {resultMessage && (
          <p className={entry.result?.ok ? 'text-success' : 'text-error'}>{resultMessage}</p>
        )}
        {context.length > 0 && <small>{context.join(' · ')}</small>}
      </div>
    </li>
  );
}

function MatchDetail({ record, onClose }: { record: MatchRecord; onClose: () => void }) {
  const locale = useLocale();
  const trace = record.actionLog ?? [];
  return (
    <div className="modal modal-open" role="presentation">
      <section className="modal-box max-w-4xl" role="dialog" aria-modal="true" aria-labelledby="match-detail-title">
        <header className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <span>{new Date(record.date).toLocaleString(locale)}</span>
            <h2 id="match-detail-title">
              <span className={resultBadgeClass(record)}>{winnerLabel(record)}</span>
            </h2>
          </div>
          <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>
            {t('common.close')}
          </button>
        </header>
        <div className="stats shadow w-full">
          <div className="stat">
            <span>{t('history.turns')}</span>
            <strong>{record.turns}</strong>
          </div>
          <div className="stat">
            <span>{t('history.duration')}</span>
            <strong>{formatDuration(record.duration)}</strong>
          </div>
          <div className="stat">
            <span>{t('history.finalHp')}</span>
            <strong>
              {record.players[0].hp}/{record.players[1].hp}
            </strong>
          </div>
          <div className="stat">
            <span>{t('history.finalChronos')}</span>
            <strong>{record.chronos.finalPosition}/12</strong>
          </div>
        </div>
        <div className="card-actions justify-start">
          <button className="btn btn-sm btn-outline" type="button" onClick={() => downloadMatchActionLog(record)}>
            {t('history.downloadTrace')}
          </button>
        </div>
        <section className="mt-4">
          <h3>{t('history.traceTitle')}</h3>
          {trace.length === 0 ? (
            <div className="alert">
              <span>{t('history.traceEmpty')}</span>
            </div>
          ) : (
            <ol className="flex flex-col gap-3">
              {trace.map((entry, index) => (
                <TraceEntry key={`${entry.id ?? index}-${entry.timestamp}`} entry={entry} locale={locale} />
              ))}
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
  const locale = useLocale();
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
    <main className="min-h-screen container mx-auto flex flex-col gap-4 p-4">
      <header className="navbar rounded-box bg-base-200 shadow-xl">
        <div className="flex-1">
          <span>{t('lobby.menu')}</span>
          <h1 className="text-2xl font-bold text-primary">{t('history.title')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost" type="button" onClick={onBack}>
            {t('common.backToLobby')}
          </button>
          <button className="btn btn-error btn-sm" type="button" disabled={records.length === 0} onClick={clearHistory}>
            {t('history.clear')}
          </button>
        </div>
      </header>

      <section className="stats shadow">
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

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2>{t('history.title')}</h2>
          <div className="join">
            <button
              className="btn btn-sm join-item"
              type="button"
              disabled={currentPage === 0}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              {t('common.prev')}
            </button>
            <span className="btn btn-sm join-item btn-disabled">
              {currentPage + 1}/{totalPages} {t('common.page')}
            </span>
            <button
              className="btn btn-sm join-item"
              type="button"
              disabled={currentPage >= totalPages - 1}
              onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
            >
              {t('common.next')}
            </button>
          </div>
        </div>

        {records.length === 0 ? (
          <div className="alert">
            <span>{t('history.noRecords')}</span>
          </div>
        ) : (
          <div className="grid gap-3">
            {visibleRecords.map((record) => (
              <article key={record.id} className="card bg-base-200 shadow">
                <div className="card-body gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className={resultBadgeClass(record)}>{winnerLabel(record)}</span>
                    <span>
                      {new Date(record.date).toLocaleString(locale, {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-3">
                    <span>
                      {t('history.turns')} {record.turns}
                    </span>
                    <span>
                      {t('history.duration')} {formatDuration(record.duration)}
                    </span>
                    <span>
                      {t('history.finalHp')} {record.players[0].hp}/{record.players[1].hp}
                    </span>
                    <span>
                      {t('history.finalChronos')} {record.chronos.finalPosition}/12
                    </span>
                    <span>
                      {t('history.traceCount')} {(record.actionLog ?? []).length}
                    </span>
                  </div>
                  <div className="card-actions justify-end">
                    <button className="btn btn-sm btn-ghost" type="button" onClick={() => setSelectedRecord(record)}>
                      {t('history.viewTrace')}
                    </button>
                    <button
                      className="btn btn-sm btn-outline"
                      type="button"
                      onClick={() => downloadMatchActionLog(record)}
                    >
                      {t('history.downloadTrace')}
                    </button>
                  </div>
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
