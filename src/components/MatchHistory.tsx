import { useState } from 'react';
import {
  clearMatchRecords,
  downloadMatchActionLog,
  getMatchRecords,
  getMatchStats,
  replaceMatchRecords,
  type MatchRecord,
} from '../game/matchHistory';
import { CHRONOS_MAPPING, type ActionLogEntry } from '../game/types';
import { getTranslatedEffect } from '../game/cards/i18n';
import { t, useLocale } from '../i18n';
import { useToast } from './ToastProvider';
import {
  ActionBar,
  BackButton,
  Badge,
  Button,
  Card,
  Dialog,
  FilterToolbar,
  PageSectionHeader,
  Panel,
  ScrollPageLayout,
  StatCard,
  StatsGrid,
} from '../ui';

interface MatchHistoryProps {
  onBack: () => void;
}

const PAGE_SIZE = 6;

function winnerLabel(record: MatchRecord): string {
  if (record.winner === 0) return `${t('player.zero')} ${t('board.playerWins')}`;
  if (record.winner === 1) return `${t('player.one')} ${t('board.playerWins')}`;
  return t('history.draw');
}

function resultBadgeTone(record: MatchRecord): 'gold' | 'jade' {
  if (record.winner === null) return 'gold';
  return 'jade';
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
  if (typeof entry.chronosPosition === 'number') lines.push(`${t('history.traceChronos')} ${entry.chronosPosition}/${CHRONOS_MAPPING.positions}`);
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
    <li>
      <Card className="grid gap-2">
        <strong>
          #{entry.id ?? '-'} T{entry.turn} · P{entry.player + 1} · {entry.action}
        </strong>
        <span>{entry.step}</span>
        {payload && <p>{payload}</p>}
        {resultMessage && <p className={entry.result?.ok ? 'text-accent-success' : 'text-accent-action'}>{resultMessage}</p>}
        {context.length > 0 && <small className="text-content-primary/50">{context.join(' · ')}</small>}
      </Card>
    </li>
  );
}

function MatchDetail({ record, onClose }: { record: MatchRecord; onClose: () => void }) {
  const locale = useLocale();
  const trace = record.actionLog ?? [];
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={<span id="match-detail-title">{winnerLabel(record)}</span>}
      size="lg"
    >
      <div className="grid gap-4">
        <header className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <span className="text-sm text-content-primary/60">{new Date(record.date).toLocaleString(locale)}</span>
            <Badge tone={resultBadgeTone(record)}>{winnerLabel(record)}</Badge>
          </div>
        </header>
        <div className="grid gap-3 md:grid-cols-4">
          <Panel variant="ghost">
            <span className="text-xs text-content-primary/50">{t('history.turns')}</span>
            <strong>{record.turns}</strong>
          </Panel>
          <Panel variant="ghost">
            <span className="text-xs text-content-primary/50">{t('history.duration')}</span>
            <strong>{formatDuration(record.duration)}</strong>
          </Panel>
          <Panel variant="ghost">
            <span className="text-xs text-content-primary/50">{t('history.finalHp')}</span>
            <strong>
              {record.players[0].hp}/{record.players[1].hp}
            </strong>
          </Panel>
          <Panel variant="ghost">
            <span className="text-xs text-content-primary/50">{t('history.finalChronos')}</span>
            <strong>{record.chronos.finalPosition}/{CHRONOS_MAPPING.positions}</strong>
          </Panel>
        </div>
        <div>
          <Button size="sm" variant="secondary" type="button" onClick={() => downloadMatchActionLog(record)}>
            {t('history.downloadTrace')}
          </Button>
        </div>
        <section>
          <h3 className="font-display text-lg italic">{t('history.traceTitle')}</h3>
          {trace.length === 0 ? (
            <Panel className="mt-3 text-sm text-content-primary/60">{t('history.traceEmpty')}</Panel>
          ) : (
            <ol className="mt-3 flex flex-col gap-3">
              {trace.map((entry, index) => (
                <TraceEntry key={`${entry.id ?? index}-${entry.timestamp}`} entry={entry} locale={locale} />
              ))}
            </ol>
          )}
        </section>
      </div>
    </Dialog>
  );
}

export function MatchHistory({ onBack }: MatchHistoryProps) {
  const { showToast } = useToast();
  const [records, setRecords] = useState(() => getMatchRecords());
  const [page, setPage] = useState(0);
  const [selectedRecord, setSelectedRecord] = useState<MatchRecord | null>(null);
  const locale = useLocale();
  const stats = getMatchStats();
  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const visibleRecords = records.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const clearHistory = () => {
    const previousRecords = records;
    const previousPage = currentPage;
    if (previousRecords.length === 0) return;
    clearMatchRecords();
    setRecords([]);
    setPage(0);
    setSelectedRecord(null);
    showToast({
      title: t('history.clearSuccessTitle'),
      body: t('history.clearSuccessBody'),
      kind: 'warning',
      durationMs: 9000,
      actionLabel: t('history.undoClearAction'),
      onAction: () => {
        replaceMatchRecords(previousRecords);
        setRecords(previousRecords);
        setPage(previousPage);
        setSelectedRecord(null);
        showToast({
          title: t('history.restoreSuccessTitle'),
          kind: 'success',
        });
      },
    });
  };

  return (
    <ScrollPageLayout>
      <PageSectionHeader
        kicker={t('lobby.menu')}
        title={t('history.title')}
        actions={
          <ActionBar mobileLayout="grid">
            <BackButton
              className="!min-h-11 tracking-[var(--tracking-control)] xl:tracking-[var(--tracking-kicker)]"
              type="button"
              onClick={onBack}
            >
              {t('common.backToLobby')}
            </BackButton>
            <Button
              className="!min-h-11 tracking-[var(--tracking-control)] xl:tracking-[var(--tracking-kicker)]"
              variant="danger"
              size="sm"
              type="button"
              disabled={records.length === 0}
              onClick={clearHistory}
            >
              {t('history.clear')}
            </Button>
          </ActionBar>
        }
      />

      <StatsGrid>
        <StatCard label={t('history.total')} value={stats.totalMatches} />
        <StatCard label={t('history.p0Wins')} value={stats.wins[0]} />
        <StatCard label={t('history.p1Wins')} value={stats.wins[1]} />
        <StatCard label={t('history.avgTurns')} value={stats.avgTurns} />
      </StatsGrid>

      <section className="flex flex-col gap-3">
          <FilterToolbar
            className="sm:flex-row sm:items-center sm:justify-between"
            primary={<h2>{t('history.title')}</h2>}
            actions={
              <ActionBar mobileLayout="pagination">
                <Button
                  size="sm"
                  variant="secondary"
                  type="button"
                  className="!min-h-11 tracking-[var(--tracking-control)] xl:tracking-[var(--tracking-kicker)]"
                  disabled={currentPage === 0}
                  onClick={() => setPage((value) => Math.max(0, value - 1))}
                >
                  {t('common.prev')}
                </Button>
                <span className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/50">
                  {currentPage + 1}/{totalPages} {t('common.page')}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  type="button"
                  className="!min-h-11 tracking-[var(--tracking-control)] xl:tracking-[var(--tracking-kicker)]"
                  disabled={currentPage >= totalPages - 1}
                  onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
                >
                  {t('common.next')}
                </Button>
              </ActionBar>
            }
          />

          {records.length === 0 ? (
            <Panel className="text-sm text-content-primary/60">{t('history.noRecords')}</Panel>
          ) : (
            <div className="grid gap-3">
              {visibleRecords.map((record) => (
                <Card key={record.id} as="article" className="grid gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <Badge tone={resultBadgeTone(record)}>{winnerLabel(record)}</Badge>
                    <span className="text-sm text-content-primary/50">
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
                      {t('history.finalChronos')} {record.chronos.finalPosition}/{CHRONOS_MAPPING.positions}
                    </span>
                    <span>
                      {t('history.traceCount')} {(record.actionLog ?? []).length}
                    </span>
                  </div>
                  <ActionBar mobileLayout="grid">
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      className="!min-h-11 tracking-[var(--tracking-control)] xl:tracking-[var(--tracking-kicker)]"
                      onClick={() => setSelectedRecord(record)}
                    >
                      {t('history.viewTrace')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      type="button"
                      className="!min-h-11 tracking-[var(--tracking-control)] xl:tracking-[var(--tracking-kicker)]"
                      onClick={() => downloadMatchActionLog(record)}
                    >
                      {t('history.downloadTrace')}
                    </Button>
                  </ActionBar>
                </Card>
              ))}
            </div>
          )}
        </section>
        {selectedRecord && <MatchDetail record={selectedRecord} onClose={() => setSelectedRecord(null)} />}
    </ScrollPageLayout>
  );
}
