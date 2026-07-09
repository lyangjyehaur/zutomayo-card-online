import type { BoardProps } from 'boardgame.io/react';
import { Activity, BookOpen, Info, Pause, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { CHRONOS_MAPPING } from '../game/types';
import type {
  ActionLogEntry,
  CardDef,
  CardInstance,
  ChronosTime,
  GameState,
  GameNotice,
  HpChangeBreakdown,
  JankenChoice,
  PlayerIndex,
} from '../game/types';
import { getCardDef } from '../game/cards/loader';
import { AppDrawer } from './AppDrawer';
import { Button, IconButton, SegmentedControl, Sheet } from '../ui';
import { useModalFocus } from '../ui';
import {
  AbyssZone,
  ActionDock,
  BattleZone,
  CardDetailBody,
  CardDetailPanel,
  CardDetailSheet,
  CardView,
  ChargeZone,
  ChronosPanel,
  DeckZone,
  HandZone,
  PhaseIndicator,
  PlayerStatus,
  SetZone,
  ZoneSummarySheet,
  useViewportMode,
  type BattleZoneAttack,
  type FocusedCard,
} from '../ui/game';
import {
  getChronosTime,
  getEffectiveAttack,
  getMinimumSetCount,
  getRequiredSetCount,
  isAttackPowerInsufficient,
} from '../game/GameLogic';
import { t, useLocale } from '../i18n';
import { getTranslatedEffect } from '../game/cards/i18n';
import { normalizeGameOverWinner, useOnlineMatchSubmission } from './board/useOnlineMatchSubmission';

export type PopoverPlacement = 'right' | 'left' | 'top' | 'bottom';

export type PopoverPosition = {
  top: number;
  left: number;
  placement: PopoverPlacement;
};

/**
 * 根據錨點元素的 DOMRect 計算 popover 顯示位置。
 * 抽成獨立函數供 log 卡牌 chip 共用，避免重複實作定位邏輯。
 */
function computePopoverPosition(rect: DOMRect): PopoverPosition {
  const popoverWidth = Math.min(Math.max(window.innerWidth * 0.16, 184), 248);
  const popoverHeight = Math.min(Math.max(window.innerHeight * 0.2, 220), 288);
  const gap = 12;
  const margin = 8;
  const centerY = rect.top + rect.height / 2;
  const centerX = rect.left + rect.width / 2;

  let placement: PopoverPlacement = 'right';
  let top = centerY;
  let left = rect.right + gap;

  if (left + popoverWidth > window.innerWidth - margin) {
    placement = 'left';
    left = rect.left - gap;
  }

  if (placement === 'right' || placement === 'left') {
    top = Math.min(Math.max(centerY, margin + popoverHeight / 2), window.innerHeight - margin - popoverHeight / 2);
  }

  if (placement === 'left' && left - popoverWidth < margin) {
    placement = 'bottom';
    left = Math.min(Math.max(centerX, margin + popoverWidth / 2), window.innerWidth - margin - popoverWidth / 2);
    top = rect.bottom + gap;
    if (top + popoverHeight > window.innerHeight - margin) {
      placement = 'top';
      top = rect.top - gap;
      if (top - popoverHeight < margin) {
        placement = 'bottom';
        top = rect.bottom + gap;
      }
    }
  }

  return { top, left, placement };
}

function CardPopover({
  def,
  activeTime,
  position,
}: {
  def: CardDef;
  activeTime?: ChronosTime;
  position: PopoverPosition;
}) {
  const locale = useLocale();
  const translatedEffect = getTranslatedEffect(def.id, locale);
  const style: CSSProperties = {
    top: `${position.top}px`,
    left: `${position.left}px`,
  };

  return createPortal(
    <aside className={`card-popover popover-${position.placement}`} style={style} aria-hidden="true">
      <strong>{def.name}</strong>
      <span className="popover-meta">
        {t(`card.element.${def.element}` as never)} • {t(`card.type.${def.type}` as never)}
      </span>
      <div className="popover-rule" />
      {def.attack && (
        <>
          <span className={activeTime === 'night' ? 'active-stat' : ''}>
            {t('card.night')}: {def.attack.night}
          </span>
          <span className={activeTime === 'day' ? 'active-stat' : ''}>
            {t('card.day')}: {def.attack.day}
          </span>
        </>
      )}
      <span>
        {t('card.energy')}: {def.powerCost}
      </span>
      <span>
        {t('card.clock')}: {def.clock}
      </span>
      {def.sendToPower > 0 && (
        <span>
          {t('card.charge')}: {def.sendToPower}
        </span>
      )}
      {def.effect && (
        <>
          <div className="popover-rule" />
          <p className="popover-effect">{translatedEffect || def.effect}</p>
        </>
      )}
    </aside>,
    document.body,
  );
}

const TURN_TIMER_SECONDS = 60;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export type BoardGameOverAction = {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
};

export type BoardGameOverActions = {
  helperText?: string;
  primary: BoardGameOverAction;
  secondary?: BoardGameOverAction;
};

type Props = BoardProps<GameState> & {
  gameOverActions?: BoardGameOverActions;
  // P3-16：線上模式用伺服器權威計時器（G.turnStartTime）；本機/AI 維持客戶端 setInterval。
  useServerTimer?: boolean;
  // 對手顯示名稱 override（如 AI 對戰時傳入「電腦」），未傳則用 player.one i18n key。
  opponentLabel?: string;
  // 我方顯示名稱 override（如 AI 對戰時傳入「玩家」），未傳則用 player.zero i18n key。
  selfLabel?: string;
  // 教學模式：隱藏 janken/mulligan 浮層，等教學進度到了才顯示
  hideSetupOverlay?: boolean;
  // 教學模式：setupFeedback 彈窗（如猜拳結果）確認按鈕點擊時的通知
  onSetupFeedbackDismiss?: () => void;
  // 教學模式：GameNoticeOverlay 彈窗（時鐘推進、HP 計算）確認按鈕點擊時的通知
  onNoticeDismiss?: () => void;
};

type FeedbackTone = 'phase' | 'success' | 'danger' | 'neutral';
type FeedbackMessage = {
  title: string;
  kicker?: string;
  lines?: string[];
  tone?: FeedbackTone;
  actionLabel?: string;
};
// 對手/我方名稱 override（AI 對戰時設為「電腦」/「玩家」等），由 Board 元件 mount 時設定。
// formatLogEntry 等純函數無法存取 prop，故用 module-level 變數統一覆寫顯示。
let opponentLabelOverride: string | null = null;
let selfLabelOverride: string | null = null;

function playerName(index: PlayerIndex): string {
  if (index === 0 && selfLabelOverride) return selfLabelOverride;
  if (index === 1 && opponentLabelOverride) return opponentLabelOverride;
  return index === 0 ? t('player.zero') : t('player.one');
}

function translatedActionLogEffect(entry: ActionLogEntry, locale: string): string | null {
  if (!entry.pendingEffectCardDefId) return null;
  return getTranslatedEffect(entry.pendingEffectCardDefId, locale);
}

type LogSegment = { type: 'text'; text: string } | { type: 'card'; cardDefId: string };

type LogTone = 'battle' | 'set' | 'effect' | 'info';

function seg(text: string): LogSegment {
  return { type: 'text', text };
}
function cardSeg(cardDefId: string): LogSegment {
  return { type: 'card', cardDefId };
}

function zoneLabel(zone: string): string {
  if (zone === 'powerCharger') return t('board.powerCharger');
  if (zone === 'abyss') return t('board.abyss');
  if (zone === 'battleZone') return t('board.battleZone');
  return zone;
}

function slotLabel(slot: string): string {
  if (slot === 'A') return t('board.setZoneA');
  if (slot === 'B') return t('board.setZoneB');
  if (slot === 'C') return t('board.setZoneC' as never);
  return slot;
}

function formatLogEntry(
  entry: ActionLogEntry,
  locale: string,
): { segments: LogSegment[]; tone: LogTone; breakdown?: HpChangeBreakdown } {
  const p = playerName(entry.player);
  const a = entry.action;
  const payload = entry.payload as Record<string, unknown> | undefined;
  const msg = entry.result?.message;
  const effectText = translatedActionLogEffect(entry, locale);
  const payloadBreakdown = payload?.breakdown as HpChangeBreakdown | undefined;

  if (a === 'janken') {
    const choice = payload?.choice as string;
    const mark = choice === 'rock' ? '✊' : choice === 'paper' ? '✋' : '✌️';
    return { segments: [seg(`${p} ${t('board.janken')} ${mark}`)], tone: 'info' };
  }
  if (a === 'jankenResult') {
    const draw = Boolean(payload?.draw);
    const choice0 = payload?.choice0 as string;
    const choice1 = payload?.choice1 as string;
    const mark0 = choice0 === 'rock' ? '✊' : choice0 === 'paper' ? '✋' : '✌️';
    const mark1 = choice1 === 'rock' ? '✊' : choice1 === 'paper' ? '✋' : '✌️';
    const winnerName = payload?.winner !== undefined ? playerName(payload.winner as PlayerIndex) : '';
    const text = draw
      ? `${t('board.janken')} ${mark0} vs ${mark1} — ${t('board.jankenDraw' as never)}`
      : `${t('board.janken')} ${mark0} vs ${mark1} — ${winnerName} ${t('board.jankenWin' as never)}`;
    return { segments: [seg(text)], tone: 'info' };
  }
  if (a === 'mulligan') {
    const count = (payload?.redrawnCount as number) ?? 0;
    const text =
      count > 0 ? `${p} ${t('board.redrewCards')} ${count} ${t('board.cardsUnit')}` : `${p} ${t('board.keepHand')}`;
    return { segments: [seg(text)], tone: 'info' };
  }
  if (a === 'setInitialCard') {
    const cardDefId = payload?.cardDefId as string | undefined;
    const segments: LogSegment[] = [seg(`${p} ${t('board.initialSet')} `)];
    if (cardDefId) segments.push(cardSeg(cardDefId));
    segments.push(seg(` → ${t('board.battleZone')}`));
    return { segments, tone: 'set' };
  }
  if (a === 'setTurnCard') {
    const cardDefId = payload?.cardDefId as string | undefined;
    const slot = (payload?.slot as string) ?? '?';
    const segments: LogSegment[] = [seg(`${p} ${t('board.setCards')} `)];
    if (cardDefId) segments.push(cardSeg(cardDefId));
    segments.push(seg(` → ${slotLabel(slot)}`));
    return { segments, tone: 'set' };
  }
  if (a === 'zoneEntered') {
    const cardDefId = payload?.cardDefId as string | undefined;
    const zone = (payload?.zone as string) ?? '';
    const segments: LogSegment[] = [seg(`${p} `)];
    if (cardDefId) segments.push(cardSeg(cardDefId));
    segments.push(seg(` → ${zoneLabel(zone)}`));
    return { segments, tone: 'set' };
  }
  if (a === 'hpChange') {
    const delta = (payload?.delta as number) ?? 0;
    const reason = (payload?.reason as string) ?? '';
    const before = (payload?.before as number) ?? 0;
    const after = (payload?.after as number) ?? 0;
    const sourceCardDefId = payload?.sourceCardDefId as string | undefined;
    const reasonLabel = reason ? t(`board.hpChange.${reason}` as never) : '';
    const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
    const segments: LogSegment[] = [seg(`${p} HP ${before}→${after} (${deltaStr}) ${reasonLabel}`)];
    if (sourceCardDefId) {
      segments.push(seg(' · '));
      segments.push(cardSeg(sourceCardDefId));
    }
    return { segments, tone: 'battle', breakdown: payloadBreakdown };
  }
  if (a === 'battleDraw') {
    const p0Attack = (payload?.p0Attack as number) ?? 0;
    const p1Attack = (payload?.p1Attack as number) ?? 0;
    const p0CardDefId = payload?.p0CardDefId as string | undefined;
    const p1CardDefId = payload?.p1CardDefId as string | undefined;
    const segments: LogSegment[] = [seg(`${t('board.battleDraw' as never)} ${p0Attack} vs ${p1Attack} · `)];
    if (p0CardDefId) segments.push(cardSeg(p0CardDefId));
    segments.push(seg(' vs '));
    if (p1CardDefId) segments.push(cardSeg(p1CardDefId));
    return { segments, tone: 'battle', breakdown: payloadBreakdown };
  }
  if (a === 'effectFailed') {
    const cardDefId = payload?.cardDefId as string | undefined;
    const reason = (payload?.reason as string) ?? '';
    const reasonKey =
      reason === 'powerCost'
        ? 'board.effectFailed.powerCost'
        : reason === 'disabled'
          ? 'board.effectFailed.disabled'
          : 'board.effectFailed.condition';
    const segments: LogSegment[] = [seg(`${p} `)];
    if (cardDefId) segments.push(cardSeg(cardDefId));
    segments.push(seg(` ${t(reasonKey as never)}`));
    return { segments, tone: 'effect' };
  }
  if (a === 'confirmReady') {
    return { segments: [seg(`${p} ${t('board.readyWaiting')}`)], tone: 'set' };
  }
  if (a === 'timeoutSkip') {
    return { segments: [seg(`${p} ${t('board.timer')} ⏱`)], tone: 'info' };
  }
  if (a === 'chooseEffectOrder') {
    return { segments: [seg(`${p} ${t('board.chooseEffect')}`)], tone: 'effect' };
  }
  if (a === 'submitPendingChoice') {
    return { segments: [seg(`${p} ${t('board.submitChoice')}`)], tone: 'effect' };
  }
  if (a === 'resolvePendingEffect' && effectText) {
    return { segments: [seg(`${p}: ${effectText}`)], tone: 'effect' };
  }
  if (a === 'gameOver') {
    return { segments: [seg(msg ?? t('board.gameOver'))], tone: 'battle' };
  }
  if (msg) {
    if (effectText) return { segments: [seg(`${p}: ${effectText}`)], tone: 'effect' };
    const isBattle = msg.includes('damage') || msg.includes('HP') || msg.includes('battle');
    const isEffect = msg.includes('effect') || msg.includes('draw') || msg.includes('discard') || msg.includes('send');
    return { segments: [seg(msg)], tone: isBattle ? 'battle' : isEffect ? 'effect' : 'info' };
  }
  return { segments: [seg(`${p}: ${a}`)], tone: 'info' };
}

/**
 * log 行中的卡牌片段：顯示為 [卡名] 並支援 hover/touch 顯示 CardPopover 詳細資訊。
 * 與戰場卡共用 CardPopover 和 computePopoverPosition，定位以 chip 的 DOM rect 為錨點。
 */
function LogCardChip({ cardDefId }: { cardDefId: string }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [tappedOpen, setTappedOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const def = getCardDef(cardDefId);
  const visible = hovered || focused || tappedOpen;

  useEffect(() => {
    if (!visible) {
      setPosition(null);
      return;
    }
    const element = ref.current;
    if (!element) return;
    const update = () => setPosition(computePopoverPosition(element.getBoundingClientRect()));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [visible]);

  useEffect(() => {
    if (!tappedOpen) return;
    const handleDocumentDown = (event: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setTappedOpen(false);
      }
    };
    document.addEventListener('mousedown', handleDocumentDown);
    document.addEventListener('touchstart', handleDocumentDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentDown);
      document.removeEventListener('touchstart', handleDocumentDown);
    };
  }, [tappedOpen]);

  if (!def) return <span>[{cardDefId}]</span>;
  return (
    <button
      type="button"
      ref={ref}
      className="inline-flex min-h-10 cursor-help items-center rounded-sm bg-transparent p-0 text-left text-accent-primary-soft underline decoration-dotted underline-offset-2 transition hover:text-accent-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:ring-offset-2 focus:ring-offset-surface-base"
      aria-label={def.name}
      aria-expanded={visible}
      onClick={() => setTappedOpen((open) => !open)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      [{def.name}]{visible && position && <CardPopover def={def} position={position} />}
    </button>
  );
}

function renderLogSegments(segments: LogSegment[]): ReactNode {
  return segments.map((s, i) => {
    if (s.type === 'card') return <LogCardChip key={i} cardDefId={s.cardDefId} />;
    return <span key={i}>{s.text}</span>;
  });
}

/**
 * log 行下方的精簡 breakdown 顯示：縮排小字，每行 label: value。
 * 與 notice 的 BreakdownBlock 相比更精簡，適合 log 面板的緊湊空間。
 * value 若為 i18n key（board. 開頭）會翻譯；附帶 cardDefId 的行顯示為可 hover 卡牌 chip。
 */
function LogBreakdown({ breakdown }: { breakdown: HpChangeBreakdown }) {
  return (
    <div className="ml-3 mt-0.5 flex flex-col gap-px border-l border-content-primary/10 pl-2">
      {breakdown.lines.map((line, idx) => {
        const valueDisplay = line.value.startsWith('board.') ? t(line.value as never) : line.value;
        return (
          <div key={idx} className="flex items-baseline gap-1 text-micro text-content-primary/45">
            <span className="text-content-primary/30">{t(line.label as never)}:</span>
            {line.cardDefId ? (
              <LogCardChip cardDefId={line.cardDefId} />
            ) : (
              <span
                className={
                  line.value.startsWith('-')
                    ? 'text-accent-action/70'
                    : line.value.startsWith('+')
                      ? 'text-accent-info/70'
                      : 'text-content-primary/55'
                }
              >
                {valueDisplay}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function jankenMark(choice: JankenChoice | null): string {
  if (choice === 'rock') return '✊';
  if (choice === 'paper') return '✋';
  if (choice === 'scissors') return '✌️';
  return '?';
}

function jankenLabel(choice: JankenChoice): string {
  const labels: Record<JankenChoice, string> = {
    rock: t('board.rock'),
    paper: t('board.paper'),
    scissors: t('board.scissors'),
  };
  return labels[choice];
}

function FeedbackOverlay({ message, onAction }: { message: FeedbackMessage | null; onAction?: () => void }) {
  if (!message) return null;

  return (
    <div
      className={`phase-message-overlay phase-message-${message.tone ?? 'neutral'}`}
      role="status"
      aria-live="polite"
    >
      <div className="phase-message-panel pointer-events-auto" data-tut="setup-feedback">
        {message.kicker && <div className="phase-message-kicker">{message.kicker}</div>}
        <strong className="phase-message-title">{message.title}</strong>
        {message.lines?.map((line) => (
          <p key={line}>{line}</p>
        ))}
        {message.actionLabel && onAction && (
          <Button
            className={`phase-message-action ${primaryActionClass()}`}
            type="button"
            variant="primary"
            onClick={onAction}
          >
            {message.actionLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * 格式化 breakdown 明細行的 value。
 * - 若該行附帶 cardDefId，同時顯示卡名與數值（如「卡名 30」）。
 * - 若 value 是 i18n key（以 'board.' 開頭），翻譯後顯示。
 * - 否則直接顯示原始 value（數字、+/- 等）。
 */
function formatBreakdownValue(value: string, cardDefId?: string): string {
  if (cardDefId) {
    const def = getCardDef(cardDefId);
    if (def?.name) return `${def.name} ${value}`;
  }
  if (value.startsWith('board.')) return t(value as never);
  return value;
}

/**
 * 統一遊戲事件提示 overlay（置中面板、無遮罩）。
 *
 * 監聯 G.recentGameNotices 的新增項目（以 id 去重），佇列依序顯示：
 * HP 變化、時鐘推進、戰鬥結果（平手 / 傷害減免）、回合切換。
 * 每筆顯示固定時長後自動消失，期間累積的事件排隊播放，避免多個浮層互相競爭定位。
 *
 * 採用 phase-message-panel 樣式，與 FeedbackOverlay 視覺一致。
 * 元件首次 mount 時跳過歷史 notice（lastSeenId 初始化為 -1，首次設為當前 max 並 return），
 * 僅顯示 mount 後新增的事件。
 */
function noticeDuration(notice: GameNotice): number {
  const reduced = prefersReducedMotion();
  if (notice.breakdown && notice.breakdown.lines.length > 0) return reduced ? 3000 : 5200;
  return reduced ? 2200 : 3800;
}

function chronosTimeLabel(time: ChronosTime): string {
  return time === 'night' ? t('board.notice.night' as never) : t('board.notice.day' as never);
}

function BreakdownBlock({ breakdown }: { breakdown: HpChangeBreakdown }) {
  const participantNames = breakdown.participantCardDefIds
    .map((id) => getCardDef(id)?.name)
    .filter((n): n is string => Boolean(n));
  return (
    <div className="mt-1 min-w-[240px] max-w-[340px] border-t border-content-primary/10 pt-2">
      <div className="mb-1 font-mono text-micro uppercase tracking-[var(--tracking-meta)] text-accent-primary/70">
        {t(breakdown.title as never)}
      </div>
      <div className="flex flex-col gap-0.5">
        {breakdown.lines.map((line, idx) => (
          <div
            key={idx}
            className="flex items-baseline justify-between gap-2 font-mono text-minutia text-content-primary/80"
          >
            <span className="text-content-primary/55">{t(line.label as never)}</span>
            <span
              className={
                line.cardDefId
                  ? 'max-w-[220px] truncate text-accent-primary-soft'
                  : line.value.startsWith('-')
                    ? 'text-accent-action/85'
                    : line.value.startsWith('+')
                      ? 'text-accent-info/85'
                      : 'text-content-primary/85'
              }
              title={line.cardDefId ? formatBreakdownValue(line.value, line.cardDefId) : undefined}
            >
              {formatBreakdownValue(line.value, line.cardDefId)}
            </span>
          </div>
        ))}
      </div>
      {participantNames.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1 border-t border-content-primary/10 pt-1">
          <span className="font-mono text-micro uppercase tracking-[var(--tracking-control)] text-content-primary/40">
            {t('board.hpChange.participants' as never)}
          </span>
          {participantNames.map((n, i) => (
            <span
              key={`${n}-${i}`}
              className="rounded-sm border border-accent-success/30 bg-accent-success/10 px-1 py-px font-mono text-micro text-accent-success"
            >
              {n}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function renderNoticeContent(notice: GameNotice, me?: PlayerIndex): ReactNode {
  switch (notice.kind) {
    case 'hpChange': {
      const isHeal = (notice.delta ?? 0) > 0;
      const cardName = notice.sourceCardDefId ? getCardDef(notice.sourceCardDefId)?.name : undefined;
      const ownerName = notice.player !== undefined ? playerName(notice.player) : '';
      return (
        <>
          <div className="phase-message-kicker">
            {ownerName}
            {cardName ? ` · ${cardName}` : ''}
          </div>
          <strong
            className={`phase-message-title font-display text-4xl font-bold ${isHeal ? 'text-accent-info' : 'text-accent-action'}`}
          >
            {isHeal ? '+' : ''}
            {notice.delta}
          </strong>
          {notice.breakdown && <BreakdownBlock breakdown={notice.breakdown} />}
        </>
      );
    }
    case 'chronosChange': {
      const sourceCardName = notice.chronosSourceCardDefId
        ? getCardDef(notice.chronosSourceCardDefId)?.name
        : undefined;
      const fromTime = notice.chronosFromTime ? chronosTimeLabel(notice.chronosFromTime) : '';
      const toTime = notice.chronosToTime ? chronosTimeLabel(notice.chronosToTime) : '';
      const delta = notice.chronosDelta ?? 0;
      const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
      const isCardEffect = notice.chronosSourceKind === 'cardEffect';
      const sideLabel =
        isCardEffect && notice.player !== undefined && me !== undefined
          ? notice.player === me
            ? t('board.me' as never)
            : t('board.opponent' as never)
          : undefined;
      return (
        <>
          <div className="phase-message-kicker">
            {t(notice.titleKey as never)}
            {sideLabel ? ` · ${sideLabel}` : ''}
            {sourceCardName ? ` · ${sourceCardName}` : ''}
          </div>
          <strong className="phase-message-title font-display text-3xl font-bold">
            {notice.chronosFrom} → {notice.chronosTo}
          </strong>
          <p className="mt-1 font-mono text-lg tracking-[var(--tracking-fine)] text-accent-primary-soft">{deltaStr}</p>
          {(fromTime || toTime) && (
            <p className="mt-1 font-mono text-caption uppercase tracking-[var(--tracking-meta)] text-content-primary/50">
              {fromTime} → {toTime}
            </p>
          )}
          {notice.breakdown && <BreakdownBlock breakdown={notice.breakdown} />}
        </>
      );
    }
    case 'battleResult': {
      return (
        <>
          <div className="phase-message-kicker">{t('board.notice.battle' as never)}</div>
          <strong className="phase-message-title font-display text-2xl font-bold">{t(notice.titleKey as never)}</strong>
          <p className="mt-1 font-mono text-caption uppercase tracking-[var(--tracking-meta)] text-content-primary/50">
            {notice.winnerAttack} vs {notice.loserAttack}
          </p>
          {notice.breakdown && <BreakdownBlock breakdown={notice.breakdown} />}
        </>
      );
    }
    case 'turnStart': {
      return (
        <>
          <div className="phase-message-kicker">{t('board.notice.turnStart' as never)}</div>
          <strong className="phase-message-title font-display text-3xl font-bold">
            {notice.turn} {t('board.notice.turnUnit' as never)}
          </strong>
        </>
      );
    }
    default:
      return null;
  }
}

/** 判斷 notice 是否需要手動確認（時鐘推進、HP 計算等含明細的彈框）。
 *  這些 notice 點擊確定按鈕才關閉，方便玩家看清資訊；其餘 notice 維持自動消失。 */
function noticeNeedsConfirm(notice: GameNotice): boolean {
  if (notice.kind === 'chronosChange') return true;
  if (notice.kind === 'hpChange' && notice.breakdown) return true;
  return false;
}

function GameNoticeOverlay({
  G,
  me,
  onNoticeDismiss,
}: {
  G: GameState;
  me?: PlayerIndex;
  onNoticeDismiss?: () => void;
}) {
  const lastSeenIdRef = useRef<number>(-1);
  const [queue, setQueue] = useState<GameNotice[]>([]);
  const [current, setCurrent] = useState<GameNotice | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 用原始型別（最後一筆 id + 數量）作為 effect 依賴，避免 boardgame.io immer/playerView
  // 淺拷貝導致 recentGameNotices 參考比較失效的邊界情況。
  const notices = G.recentGameNotices ?? [];
  const lastNoticeId = notices.length > 0 ? notices[notices.length - 1].id : 0;
  const noticeCount = notices.length;

  useEffect(() => {
    const arr = G.recentGameNotices ?? [];
    const maxId = arr.reduce((max, n) => Math.max(max, n.id), 0);
    if (lastSeenIdRef.current === -1) {
      lastSeenIdRef.current = maxId;
      return;
    }
    const newOnes = arr.filter((n) => n.id > lastSeenIdRef.current);
    lastSeenIdRef.current = maxId;
    if (newOnes.length === 0) return;
    setQueue((prev) => [...prev, ...newOnes]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastNoticeId, noticeCount]);

  useEffect(() => {
    if (current || queue.length === 0) return;
    const next = queue[0];
    setCurrent(next);
    setQueue((prev) => prev.slice(1));
    // 需要手動確認的 notice 不設自動消失 timer，等玩家點確定按鈕
    if (noticeNeedsConfirm(next)) return;
    timerRef.current = setTimeout(() => setCurrent(null), noticeDuration(next));
  }, [current, queue]);

  const dismissCurrent = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setCurrent(null);
    // 教學模式：通知教學引擎彈窗已確認關閉（用於 clock-advance/hp-calc 步驟推進）
    if (current && noticeNeedsConfirm(current)) {
      onNoticeDismiss?.();
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!current) return null;

  let content: ReactNode;
  try {
    content = renderNoticeContent(current, me);
  } catch {
    content = <strong>Notice render error</strong>;
  }

  const needsConfirm = noticeNeedsConfirm(current);

  return (
    <div
      className={`phase-message-overlay game-notice-overlay phase-message-${current.tone}`}
      role="status"
      aria-live="polite"
    >
      {needsConfirm && <div className="game-notice-backdrop" />}
      <div
        className={`phase-message-panel ${needsConfirm ? 'hp-change-confirm' : 'hp-change-float'}`}
        data-tut="game-notice-panel"
      >
        {content}
        {needsConfirm && (
          <Button
            className="mt-3 bg-content-primary px-6 py-2 text-caption font-medium uppercase tracking-[var(--tracking-kicker)] text-surface-base transition hover:bg-accent-primary active:scale-95"
            type="button"
            variant="primary"
            size="sm"
            onClick={dismissCurrent}
          >
            {t('common.confirm' as never)}
          </Button>
        )}
      </div>
    </div>
  );
}

function JankenScreen({ G, moves, playerID, floating = false }: Props & { floating?: boolean }) {
  const me = Number(playerID ?? '0') as PlayerIndex;
  const choice = G.jankenChoices[me];
  const choices: { value: JankenChoice; mark: string }[] = [
    { value: 'rock', mark: '✊' },
    { value: 'paper', mark: '✋' },
    { value: 'scissors', mark: '✌️' },
  ];

  return (
    <div
      className={`${
        floating
          ? 'absolute inset-0 z-[var(--z-overlay)] flex items-center justify-center bg-surface-canvas/80 backdrop-blur-sm'
          : 'relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-surface-canvas'
      } px-4 font-sans text-content-primary`}
    >
      {!floating && (
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute left-1/2 top-1/2 h-[60vh] w-[120vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-action/8 blur-[120px]" />
        </div>
      )}
      <div
        className="relative z-[var(--z-dropdown)] w-full max-w-lg rounded-sm bg-surface-base p-6 text-center ring-1 ring-content-primary/10"
        data-tut="janken-panel"
      >
        <div className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary/70">
          {t('board.janken')}
        </div>
        <h2 className="mt-3 font-display text-3xl font-bold">{t('board.jankenHint')}</h2>
        {choice ? (
          <p className="mt-4 text-sm leading-relaxed text-content-primary/60">
            {t('board.youChose')} {jankenLabel(choice)}。{t('board.waitingOpponent')}
          </p>
        ) : (
          <div className="mt-6 grid grid-cols-3 gap-3">
            {choices.map(({ value, mark }) => (
              <button
                key={value}
                className="group flex flex-col items-center gap-3 rounded-sm bg-surface-canvas/60 px-4 py-5 ring-1 ring-content-primary/10 transition hover:-translate-y-1 hover:ring-accent-primary/40"
                type="button"
                data-tut={`janken-${value}`}
                onClick={() => moves.janken(value)}
              >
                <span className="text-3xl" aria-hidden="true">
                  {mark}
                </span>
                <span className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/60 group-hover:text-accent-primary">
                  {jankenLabel(value)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MulliganScreen({
  G,
  moves,
  playerID,
  onMulliganFeedback,
  focusedCard,
  onFocusCard,
  floating = false,
}: Props & {
  onMulliganFeedback: (redrawCount: number) => void;
  focusedCard?: FocusedCard;
  onFocusCard?: (focus: NonNullable<FocusedCard>) => void;
  floating?: boolean;
}) {
  const me = Number(playerID ?? '0') as PlayerIndex;
  const viewport = useViewportMode();
  const touchLike = viewport.isTouch || viewport.mode !== 'desktop';
  const [selected, setSelected] = useState<number[]>([]);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const done = G.mulliganUsed[me];
  const firstHandCard = G.players[me].hand[0];
  const toggle = (index: number) =>
    setSelected((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index],
    );
  const focusCard = (card: CardInstance) => {
    const focus = { card, owner: me, zone: t('board.hand') };
    onFocusCard?.(focus);
    return focus;
  };
  const openCardDetail = (card: CardInstance) => {
    focusCard(card);
    setDetailSheetOpen(true);
  };
  const activateCard = (card: CardInstance, index: number) => {
    if (done) return;
    if (touchLike) {
      openCardDetail(card);
      return;
    }
    toggle(index);
  };

  useEffect(() => {
    if (focusedCard || !firstHandCard) return;
    onFocusCard?.({ card: firstHandCard, owner: me, zone: t('board.hand') });
  }, [firstHandCard, focusedCard, me, onFocusCard]);

  useEffect(() => {
    if (!done) return;
    setDetailSheetOpen(false);
  }, [done]);

  const focusedIndex = focusedCard
    ? G.players[me].hand.findIndex((card) => card.instanceId === focusedCard.card.instanceId)
    : -1;
  const focusedSelected = focusedIndex >= 0 && selected.includes(focusedIndex);
  const detailTitle =
    focusedCard && focusedCard.card.faceUp && focusedCard.card.defId !== '__hidden__'
      ? (getCardDef(focusedCard.card.defId)?.name ?? t('card.unknown'))
      : t('card.back');

  return (
    <div
      className={`${
        floating
          ? 'absolute inset-0 z-[var(--z-overlay)] flex items-center justify-center bg-surface-canvas/80 backdrop-blur-sm'
          : 'relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-surface-canvas'
      } px-6 font-sans text-content-primary`}
    >
      {!floating && (
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute left-1/2 top-1/2 h-[60vh] w-[120vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-action/8 blur-[120px]" />
        </div>
      )}
      <div
        className="relative z-[var(--z-dropdown)] flex w-full max-w-5xl flex-col items-center rounded-sm bg-surface-base p-6 ring-1 ring-content-primary/10"
        data-tut="mulligan-panel"
      >
        <div className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary/70">
          {t('board.mulligan')}
        </div>
        <h2 className="mt-3 text-center font-display text-3xl font-bold">{t('board.mulliganHint')}</h2>
        <div className="mt-6 grid w-full items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="mulligan-hand flex min-w-0 self-start overflow-x-auto pb-4 lg:self-center lg:pb-0">
            {G.players[me].hand.map((card, index) => (
              <div
                key={card.instanceId}
                className={`mulligan-card-shell relative shrink-0 rounded-sm bg-surface-canvas/60 p-1 ring-1 ring-content-primary/10 transition hover:-translate-y-2 hover:ring-accent-primary/40 ${
                  selected.includes(index) ? 'ring-2 ring-accent-primary shadow-selected' : ''
                } ${done ? 'opacity-70' : ''}`}
                data-tut-mulligan-card={card.defId}
                data-card-defid={card.defId}
              >
                <CardView
                  card={card}
                  size="md"
                  imageContext="hand"
                  state={done ? 'disabled' : selected.includes(index) ? 'selected' : 'idle'}
                  onActivate={done ? undefined : () => activateCard(card, index)}
                  onInspect={() => focusCard(card)}
                />
              </div>
            ))}
          </div>
          <aside className="mulligan-detail-panel hidden border-l border-content-primary/10 pl-4 lg:block">
            <CardDetailBody
              focus={focusedCard ?? null}
              G={G}
              ownerName={focusedCard ? playerName(focusedCard.owner) : undefined}
            />
          </aside>
        </div>
        {done ? (
          <p className="mt-2 text-sm text-content-primary/60">
            {t('board.handConfirmed')}。{t('board.waitingOpponent')}
          </p>
        ) : (
          <div className="mulligan-actions mt-4 flex flex-wrap justify-center gap-3">
            <Button
              className={primaryActionClass()}
              type="button"
              variant="primary"
              data-tut="mulligan-redraw"
              onClick={() => {
                onMulliganFeedback(selected.length);
                moves.mulligan(selected);
              }}
            >
              {t('board.redraw')} {selected.length} {t('board.cardsUnit')}
            </Button>
            <Button
              className={secondaryActionClass()}
              type="button"
              variant="secondary"
              data-tut="mulligan-keep"
              onClick={() => {
                onMulliganFeedback(0);
                moves.keepHand();
              }}
            >
              {t('board.keepHand')}
            </Button>
          </div>
        )}
        {touchLike && (
          <Sheet
            open={detailSheetOpen}
            onOpenChange={setDetailSheetOpen}
            title={detailTitle}
            closeLabel={t('common.close')}
            footer={
              !done && focusedIndex >= 0 ? (
                <Button
                  className={focusedSelected ? secondaryActionClass('w-full') : primaryActionClass('w-full')}
                  type="button"
                  variant={focusedSelected ? 'secondary' : 'primary'}
                  onClick={() => toggle(focusedIndex)}
                >
                  {focusedSelected
                    ? `${t('common.cancel')} ${t('board.redraw')}`
                    : `${t('common.select')} ${t('board.redraw')}`}
                </Button>
              ) : null
            }
          >
            <CardDetailBody
              focus={focusedCard ?? null}
              G={G}
              ownerName={focusedCard ? playerName(focusedCard.owner) : undefined}
            />
          </Sheet>
        )}
      </div>
    </div>
  );
}

function translateGameOverReason(reason: string | null): string {
  if (!reason) return t('board.reason');
  if (reason.includes('simultaneous overdraw')) return t('board.reasonBothDeckEmpty');
  if (reason.includes('not enough cards')) return t('board.reasonDeckEmpty');
  if (reason.includes('effect attempted to draw')) return t('board.reasonEffectDraw');
  if (reason.includes('0 HP')) return t('board.reasonHpZero');
  return t('board.reason');
}

function primaryActionClass(extra = ''): string {
  return [
    'bg-content-primary px-8 py-3 text-control font-medium uppercase tracking-[var(--tracking-kicker)] text-surface-base transition',
    'hover:bg-accent-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-content-primary',
    extra,
  ]
    .filter(Boolean)
    .join(' ');
}

function secondaryActionClass(extra = ''): string {
  return [
    'border border-content-primary/20 px-8 py-3 text-control uppercase tracking-[var(--tracking-kicker)] text-content-primary/70 transition',
    'hover:bg-content-primary/5 hover:text-content-primary disabled:cursor-not-allowed disabled:opacity-40',
    extra,
  ]
    .filter(Boolean)
    .join(' ');
}

function gameOverActionClass(action: BoardGameOverAction): string {
  return action.variant === 'secondary' ? secondaryActionClass() : primaryActionClass();
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// 從當前玩家視角判斷勝負：線上對戰 playerID 為自己座位，AI 對戰玩家預設為 0。
function myPlayerIndex(playerID: string | null | undefined): PlayerIndex {
  if (playerID === '0' || playerID === '1') return Number(playerID) as PlayerIndex;
  return 0;
}

function ResultCell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-caption uppercase tracking-normal text-content-primary/40">{label}</div>
      <div
        className={`mt-1 truncate font-display text-xl font-bold ${accent ? 'text-accent-primary' : 'text-content-primary'}`}
      >
        {value}
      </div>
    </div>
  );
}

function GameOverScreen({
  G,
  ctx,
  matchStartedAt,
  playerID,
  matchID,
  gameOverActions,
}: Props & { matchStartedAt: number }) {
  const eloNotice = useOnlineMatchSubmission({
    G,
    gameover: ctx.gameover as { winner?: string | number; draw?: boolean } | undefined,
    matchID,
    matchStartedAt,
    playerID,
  });

  const gameover = ctx.gameover as { winner?: string | number; draw?: boolean } | undefined;
  const winner = normalizeGameOverWinner(G, gameover);
  const myPlayer = myPlayerIndex(playerID);
  const outcome: 'victory' | 'defeat' | 'draw' = winner === null ? 'draw' : winner === myPlayer ? 'victory' : 'defeat';
  const win = outcome === 'victory';
  const durationSeconds = (Date.now() - matchStartedAt) / 1000;
  const reason = translateGameOverReason(G.gameoverReason);
  const glyphKey =
    outcome === 'victory'
      ? 'board.result.glyph.victory'
      : outcome === 'defeat'
        ? 'board.result.glyph.defeat'
        : 'board.result.glyph.draw';
  const titleKey =
    outcome === 'victory' ? 'board.result.victory' : outcome === 'defeat' ? 'board.result.defeat' : 'board.result.draw';

  return (
    <div className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-surface-canvas px-4 font-sans text-content-primary">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div
          className={`absolute left-1/2 top-1/2 h-[90vh] w-[90vh] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[160px] ${win ? 'bg-accent-primary/15' : 'bg-accent-action/15'}`}
        />
        <div className="absolute inset-0 opacity-[0.04] [background-image:var(--pattern-dot)] [background-size:var(--pattern-dot-size)]" />
      </div>

      <main className="relative z-[var(--z-dropdown)] flex w-full max-w-3xl flex-col items-center justify-center px-8 text-center">
        <div
          className={`font-mono text-caption uppercase tracking-[var(--tracking-hero)] ${win ? 'text-accent-primary' : 'text-accent-action'}`}
        >
          {t('board.result.concluded')}
        </div>
        <h1
          className={`mt-4 font-display text-battle-result-title font-bold leading-none md:text-battle-result-title-lg ${win ? 'text-content-primary' : 'text-content-primary/70'}`}
        >
          {t(glyphKey)}
        </h1>
        <div className="mt-2 font-display text-2xl font-bold tracking-wide">
          {t(titleKey)} · {t('board.turn')} {G.turnNumber}
        </div>

        <div className="mt-10 grid w-full grid-cols-2 gap-3 border-y border-content-primary/10 py-6 md:grid-cols-4">
          <ResultCell label={t('auth.eloChange')} value={eloNotice || '-'} accent={win} />
          <ResultCell label={t('board.result.duration')} value={formatDuration(durationSeconds)} />
          <ResultCell label={t('board.result.turns')} value={String(G.turnNumber)} />
          <ResultCell label={t('board.result.reason')} value={reason} />
        </div>

        {ctx.gameover &&
          (gameOverActions ? (
            <div className="mt-10 flex flex-col items-center gap-3 md:flex-row">
              {gameOverActions.helperText && (
                <p className="text-xs text-content-primary/45">{gameOverActions.helperText}</p>
              )}
              <Button
                className={gameOverActionClass(gameOverActions.primary)}
                type="button"
                variant={gameOverActions.primary.variant === 'secondary' ? 'secondary' : 'primary'}
                onClick={gameOverActions.primary.onClick}
              >
                {gameOverActions.primary.label}
              </Button>
              {gameOverActions.secondary && (
                <Button
                  className={gameOverActionClass(gameOverActions.secondary)}
                  type="button"
                  variant={gameOverActions.secondary.variant === 'secondary' ? 'secondary' : 'primary'}
                  onClick={gameOverActions.secondary.onClick}
                >
                  {gameOverActions.secondary.label}
                </Button>
              )}
            </div>
          ) : (
            <Button
              className={primaryActionClass('mt-10')}
              type="button"
              variant="primary"
              onClick={() => window.location.reload()}
            >
              {t('board.playAgain')}
            </Button>
          ))}
      </main>
    </div>
  );
}

function powerTotal(G: GameState, player: PlayerIndex): number {
  return G.players[player].powerCharger.reduce((sum, card) => sum + (getCardDef(card.defId)?.sendToPower ?? 0), 0);
}

function wasSetThisTurn(G: GameState, player: PlayerIndex, card: CardInstance | null): boolean {
  return !!card && G.setCardsThisTurn[player].some((item) => item.instanceId === card.instanceId);
}

function battleFeedback(G: GameState, meIndex: PlayerIndex, opponentIndex: PlayerIndex): FeedbackMessage {
  const result = G.lastBattleResult;
  if (result.winner === null) {
    return {
      title: t('board.battleDrawTitle'),
      lines: [t('board.noBattleDamage')],
      tone: 'neutral',
    };
  }

  if (result.winner === meIndex) {
    return {
      title: t('board.youWinBattle'),
      lines: [
        `${t('board.dealtDamage')} ${result.damage} ${t('board.damagePointSuffix')}`,
        `${t('board.opponentHp')}: ${G.players[opponentIndex].hp}`,
      ],
      tone: 'success',
    };
  }

  return {
    title: t('board.youLoseBattle'),
    lines: [
      `${t('board.receivedDamage')} ${result.damage} ${t('board.damagePointSuffix')}`,
      `${t('board.yourHp')}: ${G.players[meIndex].hp}`,
    ],
    tone: 'danger',
  };
}

function effectSummary(effect: GameState['pendingEffects'][number][number]): string {
  const action = effect.effect.action;
  const value = action.params.value ?? action.params.count ?? action.params.max;
  return value === undefined ? action.type : `${action.type} ${value}`;
}

function translatedPendingEffectText(effect: GameState['pendingEffects'][number][number], locale: string): string {
  return getTranslatedEffect(effect.cardDefId, locale) ?? effect.rawText ?? effectSummary(effect);
}

function translatedChoicePrompt(G: GameState, locale: string): string | null {
  const choice = G.pendingChoice;
  if (!choice?.prompt) return null;
  if (choice.sourceCardDefId) {
    return getTranslatedEffect(choice.sourceCardDefId, locale) ?? choice.prompt;
  }
  const sourceEffect = G.pendingEffects.flat().find((effect) => effect.rawText === choice.prompt);
  if (!sourceEffect) return choice.prompt;
  return getTranslatedEffect(sourceEffect.cardDefId, locale) ?? choice.prompt;
}

function choiceInstruction(type: string): string {
  if (type === 'handToDeckBottomThenDraw') return t('board.choiceHintDeckBottomDraw');
  if (type === 'reorderOpponentDeckTop') return t('board.choiceHintReorder');
  if (type === 'opponentPowerCharacterSwap') return t('board.choiceHintSwap');
  if (type === 'abyssToDeckBottomOrLose') return t('board.choiceHintAbyss');
  if (type.includes('Hand') || type.includes('hand')) return t('board.choiceHintHand');
  return t('board.choiceHintDefault');
}

function phaseInstruction(
  G: GameState,
  meIndex: PlayerIndex,
  required: number,
  minimum: number,
): { title: string; body: string; meta: { text: string; done: boolean }[] } {
  const me = G.players[meIndex];
  if (G.pendingChoice) {
    const mine = G.pendingChoice.player === meIndex;
    return {
      title: mine ? t('board.phaseChoiceTitle') : t('board.phaseChoiceWaitingTitle'),
      body: mine
        ? choiceInstruction(G.pendingChoice.type)
        : `${playerName(G.pendingChoice.player)} ${t('board.phaseChoosing')}`,
      meta: [{ text: `${t('board.choiceCount')} ${G.pendingChoice.min}-${G.pendingChoice.max}`, done: false }],
    };
  }
  if (G.step === 'effectOrder') {
    const player = G.pendingEffectPlayer;
    const pendingCount = player === null ? 0 : G.pendingEffects[player].length;
    return {
      title: player === meIndex ? t('board.phaseEffectTitle') : t('board.phaseEffectWaitingTitle'),
      body:
        player === meIndex
          ? t('board.phaseEffectBody')
          : player === null
            ? t('board.phaseEffectResolving')
            : `${playerName(player)} ${t('board.phaseResolvingEffects')}`,
      meta: [{ text: `${t('board.phasePendingEffects')} ${pendingCount}`, done: false }],
    };
  }
  if (G.step === 'initialSet') {
    return {
      title: t('board.phaseInitialSetTitle'),
      body: G.ready[meIndex] ? t('board.phaseWaitingOpponentReady') : t('board.phaseInitialSetBody'),
      meta: [{ text: `${t('board.phaseSetCount')} ${me.cardsSetThisTurn}/1`, done: me.cardsSetThisTurn >= 1 }],
    };
  }
  if (G.step === 'turnSet') {
    return {
      title: G.ready[meIndex] ? t('board.phaseWaitingTitle') : t('board.phaseTurnSetTitle'),
      body: G.ready[meIndex] ? t('board.phaseWaitingOpponentReady') : t('board.phaseTurnSetBody'),
      meta: [
        {
          text: `${t('board.phaseSetCount')} ${me.cardsSetThisTurn}/${required}`,
          done: me.cardsSetThisTurn >= required,
        },
        { text: `${t('board.phaseMinimum')} ${minimum}`, done: me.cardsSetThisTurn >= minimum },
      ],
    };
  }
  return { title: t('board.gameOver'), body: t('online.gameOverHelper'), meta: [] };
}

function EffectOrderPanel({
  G,
  moves,
  playerID,
}: {
  G: GameState;
  moves: Props['moves'];
  playerID: Props['playerID'];
}) {
  const locale = useLocale();
  const meIndex = Number(playerID ?? '0') as PlayerIndex;
  const currentPlayer = G.pendingEffectPlayer;
  if (currentPlayer === null) return null;

  const isCurrentPlayer = currentPlayer === meIndex;
  const pending = G.pendingEffects[currentPlayer];

  return (
    <section className="effect-order-panel" aria-label={t('board.effectOrder')}>
      <div className="effect-order-heading">
        <strong>{isCurrentPlayer ? t('board.chooseEffect') : t('board.waitingEffectPlayer')}</strong>
        <span>{playerName(currentPlayer)}</span>
      </div>
      {isCurrentPlayer ? (
        <div className="effect-order-list">
          {pending.map((effect, index) => {
            const card = getCardDef(effect.cardDefId);
            const effectText = translatedPendingEffectText(effect, locale);
            return (
              <button
                key={effect.id}
                className="effect-order-item"
                type="button"
                onClick={() => moves.resolvePendingEffect(index)}
              >
                <span className="effect-order-card">{card?.name ?? effect.cardDefId}</span>
                <span className="effect-order-text">{effectText}</span>
                <span className="effect-order-action">{t('common.select')}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p>{t('board.waitingOpponent')}</p>
      )}
    </section>
  );
}

function PendingChoicePanel({
  G,
  moves,
  playerID,
}: {
  G: GameState;
  moves: Props['moves'];
  playerID: Props['playerID'];
}) {
  const locale = useLocale();
  const choice = G.pendingChoice;
  const meIndex = Number(playerID ?? '0') as PlayerIndex;
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    setSelected([]);
  }, [choice?.id]);

  if (!choice) return null;

  const isCurrentPlayer = choice.player === meIndex;
  const canSubmit = selected.length >= choice.min && selected.length <= choice.max;
  const prompt = translatedChoicePrompt(G, locale) ?? choiceInstruction(choice.type);
  const toggle = (optionId: string) => {
    setSelected((current) => {
      if (current.includes(optionId)) return current.filter((item) => item !== optionId);
      if (current.length >= choice.max) return current;
      return [...current, optionId];
    });
  };

  return (
    <section className="effect-order-panel pending-choice-panel" aria-label={t('board.pendingChoice')}>
      <div className="effect-order-heading">
        <strong>{isCurrentPlayer ? t('board.chooseCards') : t('board.waitingChoicePlayer')}</strong>
        <span>{playerName(choice.player)}</span>
      </div>
      {isCurrentPlayer ? (
        <>
          <p>{prompt}</p>
          <p className="pending-choice-range">
            {t('board.choiceCount')} {selected.length}/{choice.max} · {t('board.phaseMinimum')} {choice.min}
          </p>
          <div className="effect-order-list">
            {choice.options.map((option) => {
              const isSelected = selected.includes(option.id);
              const order = selected.indexOf(option.id) + 1;
              return (
                <button
                  key={option.id}
                  className={`effect-order-item pending-choice-option ${isSelected ? 'selected' : ''}`}
                  type="button"
                  onClick={() => toggle(option.id)}
                >
                  <span className="effect-order-card">{option.label}</span>
                  <span className="effect-order-action">
                    {isSelected && choice.type === 'reorderOpponentDeckTop'
                      ? `#${order}`
                      : isSelected
                        ? t('common.selected')
                        : t('common.select')}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="pending-choice-footer">
            <span>
              {t('board.choiceCount')} {selected.length}/{choice.max}
            </span>
            <Button
              variant="primary"
              type="button"
              disabled={!canSubmit}
              onClick={() => moves.submitPendingChoice(selected)}
            >
              {t('board.submitChoice')}
            </Button>
          </div>
        </>
      ) : (
        <p>{t('board.waitingOpponent')}</p>
      )}
    </section>
  );
}

type BattleSidePanel = 'focus' | 'status' | 'log';

function BattleLogSidebarPanel({ G }: { G: GameState }) {
  const locale = useLocale();

  return (
    <div className="battle-log-panel flex min-h-0 flex-1 flex-col rounded-sm bg-surface-base p-4 ring-1 ring-content-primary/10">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary/70">Log</span>
        <span className="size-1.5 animate-pulse rounded-full bg-accent-action" />
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto font-mono text-caption leading-relaxed">
        {(G.actionLog ?? [])
          .slice(-20)
          .reverse()
          .map((entry) => {
            const { segments, tone, breakdown } = formatLogEntry(entry, locale);
            const toneClass =
              tone === 'battle'
                ? 'text-accent-action/80'
                : tone === 'set'
                  ? 'text-accent-primary/60'
                  : tone === 'effect'
                    ? 'text-content-primary/70'
                    : 'text-content-primary/40';
            return (
              <div key={entry.id}>
                <p className={toneClass}>
                  <span className="text-content-primary/20">T{entry.turn}</span> {renderLogSegments(segments)}
                  {entry.hp && tone !== 'battle' && (
                    <span className="text-content-primary/25">
                      {' '}
                      [{entry.hp[0]}/{entry.hp[1]}]
                    </span>
                  )}
                  {typeof entry.chronosPosition === 'number' && (
                    <span className="text-content-primary/25">
                      {' '}
                      ⏱{entry.chronosPosition}/{CHRONOS_MAPPING.positions}
                    </span>
                  )}
                </p>
                {breakdown && <LogBreakdown breakdown={breakdown} />}
              </div>
            );
          })}
        {(!G.actionLog || G.actionLog.length === 0) && (
          <p className="text-content-primary/20">{t('board.waitingOpponent')}</p>
        )}
      </div>
    </div>
  );
}

function BattleStatusSidebarPanel({ G }: { G: GameState }) {
  const chronosTime = getChronosTime(G);
  const statusRows = [
    { label: 'Step', value: G.step },
    { label: 'Turn', value: String(G.turnNumber) },
    { label: 'Chronos', value: `${G.chronos.position}/${CHRONOS_MAPPING.positions} · ${chronosTime}` },
    { label: 'Night', value: playerName(G.chronos.nightSidePlayer) },
  ];

  return (
    <div className="battle-status-panel flex min-h-0 flex-1 flex-col rounded-sm bg-surface-base p-4 ring-1 ring-content-primary/10">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary/70">Status</span>
        <span className="font-mono text-minutia uppercase tracking-[var(--tracking-meta)] text-content-primary/35">
          {G.pendingChoice ? 'Choice' : G.pendingEffects.some((queue) => queue.length > 0) ? 'Effect' : 'Live'}
        </span>
      </div>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-2">
          {G.players.map((player, index) => (
            <div key={index} className="rounded-sm bg-surface-canvas/70 p-3 ring-1 ring-content-primary/10">
              <div className="font-mono text-minutia uppercase tracking-[var(--tracking-meta)] text-content-primary/35">
                {playerName(index as PlayerIndex)}
              </div>
              <div className="mt-2 font-display text-2xl font-bold text-accent-primary">{player.hp}</div>
              <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-caption text-content-primary/45">
                <span>
                  {t('board.deck')} {player.deck.length}
                </span>
                <span>
                  {t('board.hand')} {player.hand.length}
                </span>
                <span>
                  {t('board.powerCharger')} {player.powerCharger.length}
                </span>
                <span>
                  {t('board.abyss')} {player.abyss.length}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="grid gap-2">
          {statusRows.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between gap-3 rounded-sm bg-surface-canvas/55 px-3 py-2 font-mono text-caption ring-1 ring-content-primary/10"
            >
              <span className="uppercase tracking-[var(--tracking-meta)] text-content-primary/35">{row.label}</span>
              <span className="text-right text-content-primary/70">{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const BATTLE_SIDE_PANELS: Array<{
  id: BattleSidePanel;
  label: string;
  Icon: typeof Info;
}> = [
  { id: 'focus', label: 'Focus', Icon: Info },
  { id: 'status', label: 'Status', Icon: Activity },
  { id: 'log', label: 'Log', Icon: BookOpen },
];

function BoardLayout({ time, children }: { time: ChronosTime; children: ReactNode }) {
  return (
    <div className={`bf-root chrono-${time}`} data-board-layout="responsive">
      {children}
    </div>
  );
}

/**
 * BattleHud — 浮動 HUD（取代通欄頂欄）。
 * 左上：回合/晝夜/倒數膠囊；右上：面板按鈕膠囊；
 * 階段軌內嵌於狀態膠囊下緣。全部懸浮在錶盤戰場上，不佔通欄。
 */
function BattleHud({
  G,
  activePanel,
  time,
  timeLeft,
  onPause,
  onPanelChange,
}: {
  G: GameState;
  activePanel: BattleSidePanel | null;
  time: ChronosTime;
  timeLeft: number;
  onPause: () => void;
  onPanelChange: (panel: BattleSidePanel) => void;
}) {
  return (
    <>
      <div className="bf-hud bf-hud-left" data-time={time}>
        <div className="bf-hud-pill bf-hud-status">
          <span className="bf-hud-turn">
            <span className="bf-hud-turn-label">{t('board.turn')}</span>
            <strong className="bf-hud-turn-value">{String(G.turnNumber).padStart(2, '0')}</strong>
          </span>
          <span className="bf-hud-divider" aria-hidden="true" />
          <span className="bf-hud-time" data-time={time}>
            {time === 'night' ? '🌙' : '☀️'} {time === 'night' ? t('board.night') : t('board.day')}
          </span>
          <span className="bf-hud-divider" aria-hidden="true" />
          <span className="bf-hud-timer" data-urgent={timeLeft <= 10}>
            {String(timeLeft).padStart(2, '0')}
            <span className="bf-hud-timer-unit">{t('board.secondsUnit')}</span>
          </span>
        </div>
      </div>
      <div className="bf-hud bf-hud-right">
        <div className="bf-hud-pill battle-side-panel-actions" aria-label="Battle panels">
          {BATTLE_SIDE_PANELS.map(({ id, label, Icon }) => (
            <IconButton
              key={id}
              label={label}
              icon={<Icon className="size-4" aria-hidden="true" />}
              data-panel-id={id}
              aria-pressed={activePanel === id}
              onClick={() => onPanelChange(id)}
            />
          ))}
          <button
            className="board-pause-button board-pause-button-inline"
            type="button"
            onClick={onPause}
            aria-label={t('game.pause')}
          >
            <Pause className="board-pause-icon size-4" aria-hidden="true" />
            <span className="board-pause-label">{t('game.pause')}</span>
          </button>
        </div>
      </div>
    </>
  );
}

function BattleOverlayLayer({ children }: { children: ReactNode }) {
  return (
    <div className="board-effect-overlay pointer-events-none absolute inset-0 z-[var(--z-overlay)] flex items-center justify-center">
      <div className="pointer-events-auto w-full max-w-md px-4">{children}</div>
    </div>
  );
}

function BattleSideSheet({
  activePanel,
  focusedCard,
  G,
  onClose,
  onPanelChange,
}: {
  activePanel: BattleSidePanel | null;
  focusedCard: FocusedCard;
  G: GameState;
  onClose: () => void;
  onPanelChange: (panel: BattleSidePanel) => void;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  useModalFocus(Boolean(activePanel), sheetRef, overlayRef);

  if (!activePanel) return null;
  const activePanelMeta = BATTLE_SIDE_PANELS.find((panel) => panel.id === activePanel);
  const title = activePanelMeta?.label ?? 'Battle Panel';

  return (
    <div ref={overlayRef} className="battle-side-sheet-overlay" role="presentation" onClick={onClose}>
      <section
        ref={sheetRef}
        className="battle-side-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="battle-side-sheet-header">
          <SegmentedControl
            className="battle-side-sheet-tabs"
            optionClassName="battle-side-sheet-tab"
            behavior="tabs"
            size="sm"
            ariaLabel="Battle panels"
            options={BATTLE_SIDE_PANELS.map(({ id, label, Icon }) => ({
              value: id,
              label: (
                <>
                  <Icon className="size-3.5" aria-hidden="true" />
                  <span>{label}</span>
                </>
              ),
            }))}
            value={activePanel}
            onChange={onPanelChange}
          />
          <IconButton
            className="battle-side-sheet-close"
            label={t('common.close')}
            icon={<X className="size-4" aria-hidden="true" />}
            onClick={onClose}
          />
        </header>
        <div className="battle-side-sheet-body">
          {activePanel === 'focus' && (
            <div className="battle-focus-panel carddetail-panel">
              <CardDetailBody
                focus={focusedCard}
                G={G}
                ownerName={focusedCard ? playerName(focusedCard.owner) : undefined}
              />
            </div>
          )}
          {activePanel === 'status' && <BattleStatusSidebarPanel G={G} />}
          {activePanel === 'log' && <BattleLogSidebarPanel G={G} />}
        </div>
      </section>
    </div>
  );
}

function BattleBoard({
  G,
  moves,
  playerID,
  useServerTimer = false,
  opponentLabel,
  selfLabel,
  onNoticeDismiss,
  onPause,
}: Props & { onPause: () => void }) {
  const meIndex = Number(playerID ?? '0') as PlayerIndex;
  const opponentIndex = (1 - meIndex) as PlayerIndex;
  const me = G.players[meIndex];
  const opponent = G.players[opponentIndex];
  // 設定名稱 override（AI 對戰時為「玩家」/「電腦」），formatLogEntry 等純函數透過 module-level 變數讀取。
  useEffect(() => {
    opponentLabelOverride = opponentLabel ?? null;
    selfLabelOverride = selfLabel ?? null;
    return () => {
      opponentLabelOverride = null;
      selfLabelOverride = null;
    };
  }, [opponentLabel, selfLabel]);
  const minimum = getMinimumSetCount(G, meIndex);
  const required = getRequiredSetCount(G, meIndex);
  const viewport = useViewportMode();
  // 觸控互動模式：coarse pointer 或非桌面佈局。手牌 tap=選中、詳情走 sheet。
  const touchLike = viewport.isTouch || viewport.mode !== 'desktop';
  const [timeLeft, setTimeLeft] = useState(TURN_TIMER_SECONDS);
  // P3-16：伺服器權威計時器超時後，每秒遞增 retryTick 以重試 timeoutSkip（處理時鐘漂移）。
  const [retryTick, setRetryTick] = useState(0);
  const [phaseMessage, setPhaseMessage] = useState<FeedbackMessage | null>(null);
  const [focusedCard, setFocusedCard] = useState<FocusedCard>(null);
  const [activeSidePanel, setActiveSidePanel] = useState<BattleSidePanel | null>(null);
  const [selectedHandIndex, setSelectedHandIndex] = useState<number | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [zoneSheet, setZoneSheet] = useState<{ kind: 'abyss' | 'power'; owner: PlayerIndex } | null>(null);
  const [damageFlash, setDamageFlash] = useState<{ target: PlayerIndex; amount: number; id: number } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const previousTurnNumber = useRef(G.turnNumber);

  const clearPhaseTimers = useCallback(() => {
    for (const phaseTimer of phaseTimers.current) clearTimeout(phaseTimer);
    phaseTimers.current = [];
  }, []);

  const showTransientPhaseMessage = (message: FeedbackMessage, duration = 1500) => {
    clearPhaseTimers();
    setPhaseMessage(message);
    const effectiveDuration = prefersReducedMotion() ? Math.min(duration, 600) : duration;
    phaseTimers.current.push(setTimeout(() => setPhaseMessage(null), effectiveDuration));
  };

  const playBattleFeedbackSequence = useCallback(
    (resultMessage: FeedbackMessage) => {
      clearPhaseTimers();
      const reduced = prefersReducedMotion();
      const phaseDuration = reduced ? 250 : 700;
      const resultDuration = reduced ? 1200 : 2600;
      const sequence: { message: FeedbackMessage; duration: number }[] = [
        { message: { title: t('board.phaseReveal'), tone: 'phase' }, duration: phaseDuration },
        { message: { title: t('board.phaseTimeAdvance'), tone: 'phase' }, duration: phaseDuration },
        { message: { title: t('board.phaseBattleStart'), tone: 'phase' }, duration: phaseDuration },
        { message: resultMessage, duration: resultDuration },
      ];

      let offset = 0;
      for (const item of sequence) {
        phaseTimers.current.push(setTimeout(() => setPhaseMessage(item.message), offset));
        offset += item.duration;
      }
      phaseTimers.current.push(setTimeout(() => setPhaseMessage(null), offset));
    },
    [clearPhaseTimers],
  );

  useEffect(() => () => clearPhaseTimers(), [clearPhaseTimers]);

  useEffect(() => {
    if (useServerTimer) {
      // P3-16：伺服器權威計時器。根據 G.turnStartTime 計算剩餘秒數，避免兩端 setInterval 漂移。
      const compute = () => {
        if (typeof G.turnStartTime !== 'number') return TURN_TIMER_SECONDS;
        const elapsed = Math.floor((Date.now() - G.turnStartTime) / 1000);
        return Math.max(0, TURN_TIMER_SECONDS - elapsed);
      };
      setTimeLeft(compute());
      if (G.step !== 'turnSet') return;
      timer.current = setInterval(() => {
        const next = compute();
        setTimeLeft(next);
        // 超時後持續 tick，讓超時 effect 重試 timeoutSkip 直到伺服器確認。
        if (next === 0) setRetryTick((tick) => tick + 1);
      }, 1000);
      return () => {
        if (timer.current) clearInterval(timer.current);
      };
    }
    // 本機/AI：維持原客戶端 setInterval 倒數行為。
    setTimeLeft(TURN_TIMER_SECONDS);
    if (timer.current) clearInterval(timer.current);
    if (G.step !== 'turnSet') return;
    timer.current = setInterval(() => setTimeLeft((value) => Math.max(0, value - 1)), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [G.turnNumber, G.step, G.turnStartTime, useServerTimer]);

  useEffect(() => {
    if (G.step !== 'turnSet' || timeLeft > 0 || G.ready[meIndex]) return;
    if (useServerTimer) {
      // P3-16：線上模式超時由伺服器權威 timeoutSkip 處理，允許未達最低出牌數時跳過該玩家回合。
      moves.timeoutSkip();
      return;
    }
    // 本機/AI：維持原行為，僅達最低出牌數時自動 confirmReady。
    if (me.cardsSetThisTurn >= minimum && me.cardsSetThisTurn <= required) {
      moves.confirmReady();
    }
  }, [G.step, timeLeft, G.ready, me.cardsSetThisTurn, minimum, required, meIndex, moves, useServerTimer, retryTick]);

  useEffect(() => {
    setSelectedHandIndex(null);
  }, [G.step, G.turnNumber, G.ready, meIndex]);

  useEffect(() => {
    if (G.turnNumber > previousTurnNumber.current) {
      playBattleFeedbackSequence(battleFeedback(G, meIndex, opponentIndex));
      const result = G.lastBattleResult;
      if (result.winner !== null && result.damage > 0) {
        const target = (1 - result.winner) as PlayerIndex;
        setDamageFlash({ target, amount: result.damage, id: Date.now() });
        const flashTimer = setTimeout(() => setDamageFlash(null), 900);
        phaseTimers.current.push(flashTimer);
      }
    }
    previousTurnNumber.current = G.turnNumber;
  }, [G, meIndex, opponentIndex, playBattleFeedbackSequence]);

  const setFromHand = (handIndex: number) => {
    if (G.ready[meIndex] || me.cardsSetThisTurn >= required) return;
    if (G.step === 'initialSet') moves.setInitialCard(handIndex);
    else moves.setTurnCard(handIndex, me.setZoneA ? 'B' : 'A');
    setSelectedHandIndex(null);
  };

  const time = getChronosTime(G);
  const canAct =
    (G.step === 'initialSet' || G.step === 'turnSet') && !G.ready[meIndex] && me.cardsSetThisTurn < required;
  const canConfirm = !G.ready[meIndex] && me.cardsSetThisTurn >= minimum && me.cardsSetThisTurn <= required;
  const currentInstruction = phaseInstruction(G, meIndex, required, minimum);
  const selectedHandCard =
    selectedHandIndex !== null && selectedHandIndex < me.hand.length ? me.hand[selectedHandIndex] : null;
  const canSetSelected = Boolean(selectedHandCard) && canAct;
  const primaryActionTitle = G.ready[meIndex]
    ? t('board.readyWaiting')
    : G.pendingChoice
      ? t('board.chooseCards')
      : G.step === 'effectOrder'
        ? t('board.chooseEffect')
        : canConfirm
          ? t('board.confirmSet')
          : canSetSelected
            ? t('board.setInspectedCard')
            : t('board.inspectHandCard');
  const primaryActionBody = G.ready[meIndex]
    ? t('board.phaseWaitingOpponentReady')
    : G.pendingChoice || G.step === 'effectOrder'
      ? currentInstruction.body
      : canConfirm
        ? `${t('board.phaseSetCount')} ${me.cardsSetThisTurn}/${required} · ${t('board.phaseMinimum')} ${minimum}`
        : touchLike
          ? t('board.touchInspectHint')
          : currentInstruction.body;

  const inspect = (card: CardInstance, owner: PlayerIndex, zone: string) => setFocusedCard({ card, owner, zone });
  // 觸控端：點擊卡牌開啟詳情 sheet；桌面端 hover 已更新側欄，不攔截 click。
  const openDetail = (card: CardInstance, owner: PlayerIndex, zone: string) => {
    inspect(card, owner, zone);
    if (touchLike) setDetailSheetOpen(true);
  };
  const detailActivate = (card: CardInstance | null, owner: PlayerIndex, zone: string) =>
    touchLike && card ? () => openDetail(card, owner, zone) : undefined;

  const handleHandTap = (index: number) => {
    const card = me.hand[index];
    if (!card) return;
    inspect(card, meIndex, t('board.hand'));
    if (touchLike) {
      // 兩段式：第一次 tap 選中（ActionDock 顯示「設置這張」），再 tap 開詳情。
      if (selectedHandIndex === index) {
        setDetailSheetOpen(true);
        return;
      }
      setSelectedHandIndex(index);
      return;
    }
    if (canAct) setFromHand(index);
  };

  const zoneNames = {
    A: t('board.setZoneA'),
    B: t('board.setZoneB'),
    C: t('board.areaEnchant'),
    battle: t('board.battleZone'),
    power: t('board.powerCharger'),
    abyss: t('board.abyss'),
    deck: t('board.deck'),
  };

  const meSlotUndo = (slot: 'A' | 'B' | 'C', card: CardInstance | null): (() => void) | undefined => {
    if (!card || G.ready[meIndex]) return undefined;
    if (slot === 'C' && !wasSetThisTurn(G, meIndex, card)) return undefined;
    return () => moves.undoSetCard(slot);
  };

  const initialSetUndo =
    G.step === 'initialSet' && me.battleZone && !G.ready[meIndex] ? () => moves.undoSetCard('A') : undefined;
  const fieldNightSide = G.chronos.nightSidePlayer === meIndex ? 'me' : 'opponent';
  const setZoneChronosSide = (owner: PlayerIndex): ChronosTime =>
    owner === G.chronos.nightSidePlayer ? 'night' : 'day';

  // 官方規則：戰鬥區攻擊力（依晝夜、Power 不足時視為 0）必須常駐可見。
  const battleAttack = (card: CardInstance | null, owner: PlayerIndex): BattleZoneAttack | null => {
    if (!card || !card.faceUp || card.defId === '__hidden__') return null;
    const def = getCardDef(card.defId);
    if (!def?.attack) return null;
    return {
      value: getEffectiveAttack(card, G, owner),
      insufficient: isAttackPowerInsufficient(card, G, owner),
    };
  };
  const opponentMeta = touchLike
    ? `${t('board.hand')} · ${opponent.hand.length} / ${t('board.deck')} · ${opponent.deck.length}`
    : undefined;
  const meMeta = touchLike ? `${t('board.deck')} · ${me.deck.length}` : undefined;
  const mobileAbyssButton = (owner: PlayerIndex, count: number) =>
    touchLike ? (
      <button
        className="mobile-zone-button mobile-zone-button-abyss"
        type="button"
        data-chronos-side={setZoneChronosSide(owner)}
        aria-label={`${playerName(owner)} ${zoneNames.abyss}: ${count}`}
        onClick={() => setZoneSheet({ kind: 'abyss', owner })}
      >
        <span>{zoneNames.abyss}</span>
        <strong>{count}</strong>
      </button>
    ) : null;

  return (
    <BoardLayout time={time}>
      <BattleHud
        G={G}
        activePanel={activeSidePanel}
        time={time}
        timeLeft={timeLeft}
        onPause={onPause}
        onPanelChange={setActiveSidePanel}
      />

      <PhaseIndicator instruction={currentInstruction} compact={viewport.mode !== 'desktop'} />

      <div className="bf-main" data-night-side={fieldNightSide}>
        {/* ===== 戰場 ===== */}
        <div className="bf-field" data-time={time} data-night-side={fieldNightSide}>
          {/* 對手區 */}
          <section className="bf-opponent" aria-label={t('player.opponent')}>
            <div className={touchLike ? 'mobile-status-row' : 'playerstatus-row'}>
              <PlayerStatus
                side="opponent"
                name={playerName(opponentIndex)}
                hp={opponent.hp}
                meta={opponentMeta}
                damageAmount={damageFlash?.target === opponentIndex ? damageFlash.amount : undefined}
                tutId="opponent-hp"
              />
              {mobileAbyssButton(opponentIndex, opponent.abyss.length)}
            </div>
            <div className="bf-opponent-handbacks" aria-label={`${t('board.hand')} ${opponent.hand.length}`}>
              {opponent.hand.map((card) => (
                <img key={card.instanceId} src="/card-back.jpg" alt="" loading="lazy" decoding="async" />
              ))}
            </div>
            <div className="bf-strip">
              <ChargeZone
                side="opponent"
                size="sm"
                cards={opponent.powerCharger}
                totalPower={powerTotal(G, opponentIndex)}
                chronosSide={setZoneChronosSide(opponentIndex)}
                onOpen={() => setZoneSheet({ kind: 'power', owner: opponentIndex })}
              />
              <SetZone
                slot="A"
                side="opponent"
                size="sm"
                card={opponent.setZoneA}
                chronosSide={setZoneChronosSide(opponentIndex)}
                onActivate={detailActivate(opponent.setZoneA, opponentIndex, zoneNames.A)}
                onInspect={(card) => inspect(card, opponentIndex, zoneNames.A)}
              />
              <SetZone
                slot="B"
                side="opponent"
                size="sm"
                card={opponent.setZoneB}
                chronosSide={setZoneChronosSide(opponentIndex)}
                onActivate={detailActivate(opponent.setZoneB, opponentIndex, zoneNames.B)}
                onInspect={(card) => inspect(card, opponentIndex, zoneNames.B)}
              />
              <SetZone
                slot="C"
                side="opponent"
                size="sm"
                card={opponent.setZoneC}
                chronosSide={setZoneChronosSide(opponentIndex)}
                onActivate={detailActivate(opponent.setZoneC, opponentIndex, zoneNames.C)}
                onInspect={(card) => inspect(card, opponentIndex, zoneNames.C)}
              />
              {!touchLike && (
                <>
                  <DeckZone
                    side="opponent"
                    size="sm"
                    count={opponent.deck.length}
                    chronosSide={setZoneChronosSide(opponentIndex)}
                  />
                  <AbyssZone
                    side="opponent"
                    size="sm"
                    cards={opponent.abyss}
                    chronosSide={setZoneChronosSide(opponentIndex)}
                    onOpen={() => setZoneSheet({ kind: 'abyss', owner: opponentIndex })}
                  />
                </>
              )}
            </div>
          </section>

          {/* 中央：戰鬥區 + Chronos */}
          <section className="bf-stage" data-tut="central-arena" aria-label={t('chronos.title')}>
            <BattleZone
              side="opponent"
              card={opponent.battleZone}
              time={time}
              attack={battleAttack(opponent.battleZone, opponentIndex)}
              onActivate={detailActivate(opponent.battleZone, opponentIndex, zoneNames.battle)}
              onInspect={(card) => inspect(card, opponentIndex, zoneNames.battle)}
              tutId="opponent-battle-zone"
            />
            <ChronosPanel
              chronos={G.chronos}
              currentTime={time}
              currentPlayer={meIndex}
              size={viewport.mode === 'mobile' ? 'sm' : 'md'}
            />
            <BattleZone
              side="me"
              card={me.battleZone}
              time={time}
              attack={battleAttack(me.battleZone, meIndex)}
              state={initialSetUndo ? 'undoable' : 'idle'}
              onActivate={initialSetUndo ?? detailActivate(me.battleZone, meIndex, zoneNames.battle)}
              onInspect={(card) => inspect(card, meIndex, zoneNames.battle)}
              tutId="player-battle-zone"
            />
          </section>

          {/* 玩家區 */}
          <section className="bf-player" aria-label={t('player.me')}>
            <div className="bf-strip">
              <ChargeZone
                side="me"
                cards={me.powerCharger}
                totalPower={powerTotal(G, meIndex)}
                chronosSide={setZoneChronosSide(meIndex)}
                onOpen={() => setZoneSheet({ kind: 'power', owner: meIndex })}
                tutId="player-power"
              />
              <div className="bf-slot-group" data-tut="player-set-zones">
                <SetZone
                  slot="A"
                  side="me"
                  card={me.setZoneA}
                  chronosSide={setZoneChronosSide(meIndex)}
                  state={meSlotUndo('A', me.setZoneA) ? 'undoable' : 'idle'}
                  onActivate={meSlotUndo('A', me.setZoneA) ?? detailActivate(me.setZoneA, meIndex, zoneNames.A)}
                  onInspect={(card) => inspect(card, meIndex, zoneNames.A)}
                />
                <SetZone
                  slot="B"
                  side="me"
                  card={me.setZoneB}
                  chronosSide={setZoneChronosSide(meIndex)}
                  state={meSlotUndo('B', me.setZoneB) ? 'undoable' : 'idle'}
                  onActivate={meSlotUndo('B', me.setZoneB) ?? detailActivate(me.setZoneB, meIndex, zoneNames.B)}
                  onInspect={(card) => inspect(card, meIndex, zoneNames.B)}
                />
                <SetZone
                  slot="C"
                  side="me"
                  card={me.setZoneC}
                  chronosSide={setZoneChronosSide(meIndex)}
                  state={meSlotUndo('C', me.setZoneC) ? 'undoable' : 'idle'}
                  onActivate={meSlotUndo('C', me.setZoneC) ?? detailActivate(me.setZoneC, meIndex, zoneNames.C)}
                  onInspect={(card) => inspect(card, meIndex, zoneNames.C)}
                />
              </div>
              {!touchLike && (
                <>
                  <DeckZone side="me" count={me.deck.length} chronosSide={setZoneChronosSide(meIndex)} />
                  <AbyssZone
                    side="me"
                    cards={me.abyss}
                    chronosSide={setZoneChronosSide(meIndex)}
                    onOpen={() => setZoneSheet({ kind: 'abyss', owner: meIndex })}
                    tutId="player-abyss"
                  />
                </>
              )}
            </div>
            <div className="bf-hand-dock" data-tut="player-actions">
              <div className={touchLike ? 'mobile-status-row' : 'playerstatus-row'}>
                <PlayerStatus
                  side="me"
                  name={playerName(meIndex)}
                  hp={me.hp}
                  meta={meMeta}
                  damageAmount={damageFlash?.target === meIndex ? damageFlash.amount : undefined}
                  tutId="player-hp"
                />
                {mobileAbyssButton(meIndex, me.abyss.length)}
              </div>
              <HandZone
                cards={me.hand}
                variant={touchLike ? 'strip' : 'fan'}
                selectedIndex={selectedHandIndex}
                canAct={canAct}
                onCardTap={handleHandTap}
                onCardHover={
                  touchLike
                    ? undefined
                    : (index) => {
                        if (index === null) return;
                        const card = me.hand[index];
                        if (card) inspect(card, meIndex, t('board.hand'));
                      }
                }
              />
              <ActionDock
                hintTitle={primaryActionTitle}
                hintBody={primaryActionBody}
                ready={G.ready[meIndex]}
                canConfirm={canConfirm}
                cardsSet={me.cardsSetThisTurn}
                required={required}
                canSetSelected={canSetSelected}
                onSetSelected={() => {
                  if (selectedHandIndex !== null) setFromHand(selectedHandIndex);
                }}
                onConfirm={() => {
                  showTransientPhaseMessage({ title: t('board.setConfirmed'), tone: 'neutral' });
                  moves.confirmReady();
                }}
                onShowDetail={touchLike && selectedHandCard ? () => setDetailSheetOpen(true) : undefined}
              />
            </div>
          </section>
        </div>

        {/* ===== 桌面側欄（>=1180px，CSS 控制顯示）===== */}
        <aside className="bf-sidebar" aria-label="Battle info">
          <CardDetailPanel
            focus={focusedCard}
            G={G}
            ownerName={focusedCard ? playerName(focusedCard.owner) : undefined}
          />
          <BattleLogSidebarPanel G={G} />
        </aside>
      </div>

      {/* 效果結算 — 居中覆蓋層 */}
      {(G.step === 'effectOrder' || G.pendingChoice) && (
        <BattleOverlayLayer>
          {G.pendingChoice ? (
            <PendingChoicePanel G={G} moves={moves} playerID={playerID} />
          ) : (
            <EffectOrderPanel G={G} moves={moves} playerID={playerID} />
          )}
        </BattleOverlayLayer>
      )}

      <BattleSideSheet
        activePanel={activeSidePanel}
        focusedCard={focusedCard}
        G={G}
        onClose={() => setActiveSidePanel(null)}
        onPanelChange={setActiveSidePanel}
      />

      {/* 觸控端卡牌詳情 bottom sheet */}
      <CardDetailSheet
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
        focus={focusedCard}
        G={G}
        ownerName={focusedCard ? playerName(focusedCard.owner) : undefined}
      />

      {/* 深淵 / 充能區摘要 */}
      {zoneSheet && (
        <ZoneSummarySheet
          open
          onOpenChange={(open) => {
            if (!open) setZoneSheet(null);
          }}
          title={`${playerName(zoneSheet.owner)} · ${zoneSheet.kind === 'power' ? zoneNames.power : zoneNames.abyss}`}
          totalValue={zoneSheet.kind === 'power' ? powerTotal(G, zoneSheet.owner) : undefined}
          cards={
            zoneSheet.kind === 'power' ? G.players[zoneSheet.owner].powerCharger : G.players[zoneSheet.owner].abyss
          }
          onInspectCard={(card) => {
            inspect(card, zoneSheet.owner, zoneSheet.kind === 'power' ? zoneNames.power : zoneNames.abyss);
            setZoneSheet(null);
            setDetailSheetOpen(true);
          }}
        />
      )}

      <FeedbackOverlay message={phaseMessage} />
      <GameNoticeOverlay G={G} me={meIndex} onNoticeDismiss={onNoticeDismiss} />
    </BoardLayout>
  );
}

export function Board(props: Props) {
  const navigate = useNavigate();
  const matchStartedAt = useRef(Date.now());
  const me = Number(props.playerID ?? '0') as PlayerIndex;
  const previousStep = useRef(props.G.step);
  const setupFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [setupFeedback, setSetupFeedback] = useState<FeedbackMessage | null>(null);
  const [mulliganFocusedCard, setMulliganFocusedCard] = useState<FocusedCard>(null);
  // 戰敗延遲：step 變成 gameOver 時，延遲顯示 GameOverScreen，
  // 讓最後的 HP 變化 breakdown 等 notice 有時間播完。
  const [gameOverDelayed, setGameOverDelayed] = useState(false);
  const gameOverTriggeredRef = useRef(false);
  // 暫停/離開確認對話框
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  useEffect(
    () => () => {
      if (setupFeedbackTimer.current) clearTimeout(setupFeedbackTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (props.G.step === 'mulligan') return;
    setMulliganFocusedCard(null);
  }, [props.G.step]);

  useEffect(() => {
    if (props.G.step === 'gameOver' && !gameOverTriggeredRef.current) {
      gameOverTriggeredRef.current = true;
      setGameOverDelayed(true);
      const timer = setTimeout(() => setGameOverDelayed(false), prefersReducedMotion() ? 4500 : 6500);
      return () => clearTimeout(timer);
    }
  }, [props.G.step]);

  useEffect(() => {
    if (
      previousStep.current === 'janken' &&
      props.G.step === 'mulligan' &&
      props.G.jankenChoices[0] &&
      props.G.jankenChoices[1]
    ) {
      const opponent = (1 - me) as PlayerIndex;
      const nightSidePlayer = props.G.chronos.nightSidePlayer;
      setSetupFeedback({
        kicker: `${jankenMark(props.G.jankenChoices[me])} vs ${jankenMark(props.G.jankenChoices[opponent])}`,
        title: nightSidePlayer === me ? t('board.youWinNightSide') : t('board.youLoseNightSide'),
        tone: nightSidePlayer === me ? 'success' : 'danger',
        actionLabel: t('common.continue'),
      });
    }
    previousStep.current = props.G.step;
  }, [props.G.step, props.G.jankenChoices, props.G.chronos.nightSidePlayer, me]);

  // 猜拳平手提示：resolveJanken 平手時不改 step，僅遞增 jankenDrawCount 並重置 choices。
  // 以 ref 記錄上次 drawCount，變化時顯示短暫提示，避免與「初次進入 janken」混淆。
  const previousDrawCountRef = useRef<number>(props.G.jankenDrawCount ?? 0);
  useEffect(() => {
    const drawCount = props.G.jankenDrawCount ?? 0;
    if (drawCount > previousDrawCountRef.current && props.G.step === 'janken') {
      setSetupFeedback({
        title: t('board.jankenDraw'),
        tone: 'neutral',
      });
      if (setupFeedbackTimer.current) clearTimeout(setupFeedbackTimer.current);
      setupFeedbackTimer.current = setTimeout(() => setSetupFeedback(null), prefersReducedMotion() ? 1000 : 1600);
    }
    previousDrawCountRef.current = drawCount;
  }, [props.G.jankenDrawCount, props.G.step]);

  const showMulliganFeedback = (redrawCount: number) => {
    if (setupFeedbackTimer.current) clearTimeout(setupFeedbackTimer.current);
    setSetupFeedback({
      title:
        redrawCount > 0
          ? `${t('board.redrewCards')} ${redrawCount} ${t('board.cardsUnit')}卡`
          : t('board.handConfirmed'),
      tone: 'success',
    });
    setupFeedbackTimer.current = setTimeout(() => setSetupFeedback(null), prefersReducedMotion() ? 1000 : 1600);
  };

  const handleExitGame = () => {
    setShowExitConfirm(false);
    navigate('/');
  };

  const renderWithSetupFeedback = (node: ReactNode) => (
    <div className="board-feedback-root">
      {node}
      <FeedbackOverlay
        message={setupFeedback}
        onAction={() => {
          setSetupFeedback(null);
          props.onSetupFeedbackDismiss?.();
        }}
      />

      {/* 暫停/離開按鈕 */}
      {props.G.step !== 'gameOver' && (props.G.step === 'janken' || props.G.step === 'mulligan') && (
        <button
          className="board-pause-button"
          type="button"
          onClick={() => setShowExitConfirm(true)}
          aria-label={t('game.pause')}
        >
          <Pause className="board-pause-icon hidden size-4" aria-hidden="true" />
          <span className="board-pause-label">{t('game.pause')}</span>
        </button>
      )}

      {/* 離開確認對話框 */}
      <AppDrawer
        open={showExitConfirm}
        title={t('game.confirmExit')}
        description={t('game.exitWarning')}
        kicker="Warning"
        actions={[
          {
            label: t('game.exitGame'),
            onClick: handleExitGame,
            tone: 'danger',
            eventName: 'game-exit-confirm',
          },
          {
            label: t('common.cancel'),
            onClick: () => setShowExitConfirm(false),
            tone: 'secondary',
            eventName: 'game-exit-cancel',
          },
        ]}
      />
    </div>
  );

  if (props.G.step === 'gameOver' && !gameOverDelayed) {
    return <GameOverScreen {...props} matchStartedAt={matchStartedAt.current} />;
  }
  // janken/mulligan 階段也渲染 BattleBoard 場地，操作面板作為浮層疊加
  // 教學模式時，若 hideSetupOverlay=true 則隱藏浮層（等教學進度到了才顯示）
  const setupOverlay = props.hideSetupOverlay ? null : props.G.step === 'janken' ? (
    <JankenScreen {...props} floating />
  ) : props.G.step === 'mulligan' ? (
    <MulliganScreen
      {...props}
      focusedCard={mulliganFocusedCard}
      onFocusCard={setMulliganFocusedCard}
      onMulliganFeedback={showMulliganFeedback}
      floating
    />
  ) : null;
  return renderWithSetupFeedback(
    <>
      <BattleBoard {...props} onPause={() => setShowExitConfirm(true)} />
      {setupOverlay}
    </>,
  );
}
