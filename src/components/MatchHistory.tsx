import { useEffect, useState } from 'react';
import { Flag, Languages, MessageCircle } from 'lucide-react';
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
  fetchChatMessages,
  markChatRead,
  reportChatMessage,
  requestChatTranslation,
  type ChatMessage,
  type ChatMessageTranslation,
} from '../api/client';
import {
  ActionBar,
  AppHeader,
  Badge,
  Button,
  Card,
  Dialog,
  FilterToolbar,
  PageShell,
  Panel,
  StatCard,
  StatsGrid,
} from '../ui';

interface MatchHistoryProps {
  onBack: () => void;
}

const PAGE_SIZE = 6;

type HistoryChatStatus = 'idle' | 'loading' | 'ready' | 'unavailable';
type HistoryTranslationState = {
  status: ChatMessageTranslation['status'] | 'loading' | 'unavailable';
  targetLanguage: string;
  content?: string;
};

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

function chatTimeLabel(createdAt: string, locale: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function canShowChatMessage(message: ChatMessage): boolean {
  return message.moderationStatus !== 'blocked' && message.moderationStatus !== 'deleted';
}

function traceContext(entry: ActionLogEntry): string[] {
  const lines: string[] = [];
  if (entry.hp) lines.push(`${t('history.traceHp')} ${entry.hp[0]}/${entry.hp[1]}`);
  if (typeof entry.chronosPosition === 'number')
    lines.push(`${t('history.traceChronos')} ${entry.chronosPosition}/${CHRONOS_MAPPING.positions}`);
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
        {resultMessage && (
          <p className={entry.result?.ok ? 'text-accent-success' : 'text-accent-action'}>{resultMessage}</p>
        )}
        {context.length > 0 && <small className="text-content-primary/50">{context.join(' · ')}</small>}
      </Card>
    </li>
  );
}

function MatchDetail({
  record,
  onClose,
  onOpenChat,
}: {
  record: MatchRecord;
  onClose: () => void;
  onOpenChat: (record: MatchRecord) => void;
}) {
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
            <strong>
              {record.chronos.finalPosition}/{CHRONOS_MAPPING.positions}
            </strong>
          </Panel>
        </div>
        <div>
          <ActionBar mobileLayout="grid">
            <Button
              size="sm"
              variant="secondary"
              type="button"
              leftIcon={<MessageCircle size={14} />}
              disabled={!record.sourceMatchId}
              onClick={() => onOpenChat(record)}
            >
              {t('history.viewChat')}
            </Button>
            <Button size="sm" variant="secondary" type="button" onClick={() => downloadMatchActionLog(record)}>
              {t('history.downloadTrace')}
            </Button>
          </ActionBar>
        </div>
        <section>
          <h3 className="font-display text-lg font-bold">{t('history.traceTitle')}</h3>
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

function MatchChatDialog({ record, onClose }: { record: MatchRecord; onClose: () => void }) {
  const locale = useLocale();
  const { showToast } = useToast();
  const [status, setStatus] = useState<HistoryChatStatus>('idle');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reportedMessageIds, setReportedMessageIds] = useState<Set<string>>(() => new Set());
  const [translations, setTranslations] = useState<Record<string, HistoryTranslationState>>({});
  const sourceMatchId = record.sourceMatchId;

  useEffect(() => {
    if (!sourceMatchId) return;
    let cancelled = false;
    setStatus('loading');
    setMessages([]);
    setReportedMessageIds(new Set());
    setTranslations({});

    void fetchChatMessages({ conversationType: 'match', subjectId: sourceMatchId, limit: 100 }).then(
      (nextMessages) => {
        if (cancelled) return;
        const visibleMessages = nextMessages.filter(canShowChatMessage);
        setMessages(visibleMessages);
        setStatus('ready');
      },
      () => {
        if (!cancelled) setStatus('unavailable');
      },
    );

    return () => {
      cancelled = true;
    };
  }, [sourceMatchId]);

  useEffect(() => {
    if (!sourceMatchId || status !== 'ready') return;
    const latestPersisted = [...messages].reverse().find((message) => message.id);
    if (!latestPersisted) return;
    void markChatRead({
      conversationType: 'match',
      subjectId: sourceMatchId,
      lastReadMessageId: latestPersisted.id,
    }).catch(() => undefined);
  }, [messages, sourceMatchId, status]);

  const handleTranslate = async (message: ChatMessage) => {
    const targetLanguage = locale.toLowerCase();
    setTranslations((state) => ({
      ...state,
      [message.id]: { status: 'loading', targetLanguage },
    }));
    try {
      const result = await requestChatTranslation(message.id, targetLanguage);
      setTranslations((state) => ({
        ...state,
        [message.id]: {
          status: result.translation.status,
          targetLanguage: result.translation.targetLanguage,
          content: result.translation.translatedContent || undefined,
        },
      }));
    } catch {
      setTranslations((state) => ({
        ...state,
        [message.id]: { status: 'unavailable', targetLanguage },
      }));
    }
  };

  const handleReport = async (message: ChatMessage) => {
    if (reportedMessageIds.has(message.id)) return;
    setReportedMessageIds((ids) => new Set(ids).add(message.id));
    try {
      await reportChatMessage(message.id, { reason: 'post_match_history' });
      showToast({ title: t('chat.reported'), kind: 'success' });
    } catch {
      setReportedMessageIds((ids) => {
        const next = new Set(ids);
        next.delete(message.id);
        return next;
      });
      showToast({ title: t('chat.reportFailed'), kind: 'error' });
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={<span id="match-chat-title">{t('history.chatTitle')}</span>}
      size="lg"
    >
      <div className="grid gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <span className="text-sm text-content-primary/60">{new Date(record.date).toLocaleString(locale)}</span>
            <span className="font-mono text-xs text-content-primary/50">{sourceMatchId ?? record.id}</span>
          </div>
          <Badge tone={sourceMatchId ? 'jade' : 'neutral'}>
            {sourceMatchId ? t('history.chatDurable') : t('history.chatUnavailable')}
          </Badge>
        </header>

        {!sourceMatchId ? (
          <Panel className="text-sm text-content-primary/60">{t('history.chatNoOnlineMatch')}</Panel>
        ) : status === 'loading' || status === 'idle' ? (
          <Panel className="text-sm text-content-primary/60">{t('history.chatLoading')}</Panel>
        ) : status === 'unavailable' ? (
          <Panel className="text-sm text-content-primary/60">{t('chat.historyUnavailable')}</Panel>
        ) : messages.length === 0 ? (
          <Panel className="text-sm text-content-primary/60">{t('chat.empty')}</Panel>
        ) : (
          <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1">
            {messages.map((message) => {
              const translation = translations[message.id];
              return (
                <Panel key={message.id} variant="ghost" className="grid gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{message.authorDisplayName || message.authorUserId || 'Player'}</strong>
                      <Badge tone={message.authorRole === 'spectator' ? 'neutral' : 'gold'}>{message.authorRole}</Badge>
                      {message.moderationStatus === 'pending_review' && (
                        <Badge tone="vermilion">{message.moderationStatus}</Badge>
                      )}
                    </div>
                    <span className="text-xs text-content-primary/50">{chatTimeLabel(message.createdAt, locale)}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm text-content-primary">{message.content}</p>
                  {translation && (
                    <p className="whitespace-pre-wrap break-words border-l-2 border-accent-primary/40 pl-3 text-sm text-content-primary/70">
                      {translation.status === 'loading'
                        ? t('chat.translationTranslating')
                        : translation.status === 'unavailable'
                          ? t('chat.translationOffline')
                          : translation.content || t('chat.translationPending')}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      leftIcon={<Languages size={14} />}
                      disabled={translation?.status === 'loading'}
                      onClick={() => void handleTranslate(message)}
                    >
                      {t('chat.translate')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      leftIcon={<Flag size={14} />}
                      disabled={reportedMessageIds.has(message.id)}
                      onClick={() => void handleReport(message)}
                    >
                      {reportedMessageIds.has(message.id) ? t('chat.reported') : t('chat.report')}
                    </Button>
                  </div>
                </Panel>
              );
            })}
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function MatchHistory(_props: MatchHistoryProps) {
  const { showToast } = useToast();
  const [records, setRecords] = useState(() => getMatchRecords());
  const [page, setPage] = useState(0);
  const [selectedRecord, setSelectedRecord] = useState<MatchRecord | null>(null);
  const [chatRecord, setChatRecord] = useState<MatchRecord | null>(null);
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
    setChatRecord(null);
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
        setChatRecord(null);
        showToast({
          title: t('history.restoreSuccessTitle'),
          kind: 'success',
        });
      },
    });
  };

  return (
    <PageShell>
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute inset-0 opacity-[0.04] [background-image:var(--pattern-dot)] [background-size:var(--pattern-dot-size)]" />
      </div>
      <AppHeader
        title={t('history.title')}
        backTo="/"
        actions={
          <Button
            className="min-h-11 whitespace-nowrap px-3"
            variant="danger"
            size="sm"
            type="button"
            disabled={records.length === 0}
            onClick={clearHistory}
          >
            {t('history.clear')}
          </Button>
        }
      />
      <main className="relative z-[var(--z-dropdown)] h-full overflow-y-auto px-4 pb-10 pt-20 md:pt-24">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
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
                        leftIcon={<MessageCircle size={14} />}
                        className="!min-h-11 tracking-[var(--tracking-control)] xl:tracking-[var(--tracking-kicker)]"
                        disabled={!record.sourceMatchId}
                        onClick={() => setChatRecord(record)}
                      >
                        {t('history.viewChat')}
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
          {selectedRecord && (
            <MatchDetail
              record={selectedRecord}
              onClose={() => setSelectedRecord(null)}
              onOpenChat={(record) => setChatRecord(record)}
            />
          )}
          {chatRecord && <MatchChatDialog record={chatRecord} onClose={() => setChatRecord(null)} />}
        </div>
      </main>
    </PageShell>
  );
}
