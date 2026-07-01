import type { BoardProps } from 'boardgame.io/react';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  ActionLogEntry,
  CardInstance,
  ChronosTime,
  GameState,
  GameNotice,
  HpChangeBreakdown,
  JankenChoice,
  PlayerIndex,
} from '../game/types';
import { getCardDef } from '../game/cards/loader';
import { Card, CardPopover, computePopoverPosition, type CardSize, type PopoverPosition } from './Card';
import { Chronos } from './Chronos';
import { AppDrawer } from './AppDrawer';
import {
  getBaseAttack,
  getChronosTime,
  getEffectiveAttack,
  getMinimumSetCount,
  getRequiredSetCount,
  isAttackPowerInsufficient,
} from '../game/GameLogic';
import { t, useLocale } from '../i18n';
import { getTranslatedEffect } from '../game/cards/i18n';
import { normalizeGameOverWinner, useOnlineMatchSubmission } from './board/useOnlineMatchSubmission';

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
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const def = getCardDef(cardDefId);

  useEffect(() => {
    if (!hovered) {
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
  }, [hovered]);

  if (!def) return <span>[{cardDefId}]</span>;
  return (
    <span
      ref={ref}
      className="cursor-help text-gold-soft underline decoration-dotted underline-offset-2"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      [{def.name}]{hovered && position && <CardPopover def={def} position={position} />}
    </span>
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
    <div className="ml-3 mt-0.5 flex flex-col gap-px border-l border-bone/10 pl-2">
      {breakdown.lines.map((line, idx) => {
        const valueDisplay = line.value.startsWith('board.') ? t(line.value as never) : line.value;
        return (
          <div key={idx} className="flex items-baseline gap-1 text-[8px] text-bone/45">
            <span className="text-bone/30">{t(line.label as never)}:</span>
            {line.cardDefId ? (
              <LogCardChip cardDefId={line.cardDefId} />
            ) : (
              <span
                className={
                  line.value.startsWith('-')
                    ? 'text-vermilion/70'
                    : line.value.startsWith('+')
                      ? 'text-[var(--teal)]/70'
                      : 'text-bone/55'
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

function BattlefieldCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const pathTrapezoid = (
        leftTop: number,
        rightTop: number,
        leftBottom: number,
        rightBottom: number,
        yTop: number,
        yBottom: number,
      ) => {
        ctx.beginPath();
        ctx.moveTo(leftTop, yTop);
        ctx.lineTo(rightTop, yTop);
        ctx.lineTo(rightBottom, yBottom);
        ctx.lineTo(leftBottom, yBottom);
        ctx.closePath();
      };

      const topY = height * 0.16;
      const bottomY = height * 0.96;
      const leftTop = width * 0.16;
      const rightTop = width * 0.84;
      const leftBottom = width * -0.08;
      const rightBottom = width * 1.08;

      const fieldGradient = ctx.createLinearGradient(0, topY, 0, bottomY);
      fieldGradient.addColorStop(0, 'rgba(38, 29, 54, 0.20)');
      fieldGradient.addColorStop(0.48, 'rgba(28, 21, 42, 0.38)');
      fieldGradient.addColorStop(1, 'rgba(8, 9, 18, 0.76)');

      pathTrapezoid(leftTop, rightTop, leftBottom, rightBottom, topY, bottomY);
      ctx.fillStyle = fieldGradient;
      ctx.fill();

      const glow = ctx.createRadialGradient(width * 0.5, height * 0.58, 0, width * 0.5, height * 0.58, width * 0.42);
      glow.addColorStop(0, 'rgba(199, 83, 180, 0.13)');
      glow.addColorStop(1, 'rgba(199, 83, 180, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
    };

    const observer = new ResizeObserver(draw);
    observer.observe(parent);
    draw();

    return () => observer.disconnect();
  }, []);

  return <canvas ref={canvasRef} className="battlefield-canvas" aria-hidden="true" />;
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
          <button className={`phase-message-action ${primaryActionClass()}`} type="button" onClick={onAction}>
            {message.actionLabel}
          </button>
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
    <div className="mt-1 min-w-[240px] max-w-[340px] border-t border-bone/10 pt-2">
      <div className="mb-1 font-mono text-[8px] uppercase tracking-[0.22em] text-gold/70">
        {t(breakdown.title as never)}
      </div>
      <div className="flex flex-col gap-0.5">
        {breakdown.lines.map((line, idx) => (
          <div key={idx} className="flex items-baseline justify-between gap-2 font-mono text-[9px] text-bone/80">
            <span className="text-bone/55">{t(line.label as never)}</span>
            <span
              className={
                line.cardDefId
                  ? 'max-w-[220px] truncate text-gold-soft'
                  : line.value.startsWith('-')
                    ? 'text-vermilion/85'
                    : line.value.startsWith('+')
                      ? 'text-[var(--teal)]/85'
                      : 'text-bone/85'
              }
              title={line.cardDefId ? formatBreakdownValue(line.value, line.cardDefId) : undefined}
            >
              {formatBreakdownValue(line.value, line.cardDefId)}
            </span>
          </div>
        ))}
      </div>
      {participantNames.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1 border-t border-bone/10 pt-1">
          <span className="font-mono text-[8px] uppercase tracking-[0.18em] text-bone/40">
            {t('board.hpChange.participants' as never)}
          </span>
          {participantNames.map((n, i) => (
            <span
              key={`${n}-${i}`}
              className="rounded-sm border border-jade/30 bg-jade/10 px-1 py-px font-mono text-[8px] text-jade"
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
            className={`phase-message-title font-display text-4xl italic ${isHeal ? 'text-[var(--teal)]' : 'text-vermilion'}`}
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
          <strong className="phase-message-title font-display text-3xl italic">
            {notice.chronosFrom} → {notice.chronosTo}
          </strong>
          <p className="mt-1 font-mono text-lg tracking-[0.1em] text-gold-soft">{deltaStr}</p>
          {(fromTime || toTime) && (
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-bone/50">
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
          <strong className="phase-message-title font-display text-2xl italic">{t(notice.titleKey as never)}</strong>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-bone/50">
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
          <strong className="phase-message-title font-display text-3xl italic">
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

function GameNoticeOverlay({ G, me }: { G: GameState; me?: PlayerIndex }) {
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
      <div className={`phase-message-panel ${needsConfirm ? 'hp-change-confirm' : 'hp-change-float'}`}>
        {content}
        {needsConfirm && (
          <button
            className="mt-3 bg-bone px-6 py-2 text-[10px] font-medium uppercase tracking-[0.3em] text-lacquer transition hover:bg-gold active:scale-95"
            type="button"
            onClick={dismissCurrent}
          >
            {t('common.confirm' as never)}
          </button>
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
          ? 'absolute inset-0 z-40 flex items-center justify-center bg-lacquer-deep/80 backdrop-blur-sm'
          : 'relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-lacquer-deep'
      } px-4 font-sans text-bone`}
    >
      {!floating && (
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-1/2 h-[60vh] w-[120vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-vermilion/8 blur-[120px]" />
        </div>
      )}
      <div
        className="relative z-10 w-full max-w-lg rounded-sm bg-lacquer p-6 text-center ring-1 ring-bone/10"
        data-tut="janken-panel"
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold/70">{t('board.janken')}</div>
        <h2 className="mt-3 font-display text-3xl italic">{t('board.jankenHint')}</h2>
        {choice ? (
          <p className="mt-4 text-sm leading-relaxed text-bone/60">
            {t('board.youChose')} {jankenLabel(choice)}。{t('board.waitingOpponent')}
          </p>
        ) : (
          <div className="mt-6 grid grid-cols-3 gap-3">
            {choices.map(({ value, mark }) => (
              <button
                key={value}
                className="group flex flex-col items-center gap-3 rounded-sm bg-lacquer-deep/60 px-4 py-5 ring-1 ring-bone/10 transition hover:-translate-y-1 hover:ring-gold/40"
                type="button"
                data-tut={`janken-${value}`}
                onClick={() => moves.janken(value)}
              >
                <span className="text-3xl" aria-hidden="true">
                  {mark}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-bone/60 group-hover:text-gold">
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
  floating = false,
}: Props & {
  onMulliganFeedback: (redrawCount: number) => void;
  floating?: boolean;
}) {
  const me = Number(playerID ?? '0') as PlayerIndex;
  const [selected, setSelected] = useState<number[]>([]);
  const done = G.mulliganUsed[me];
  const toggle = (index: number) =>
    setSelected((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index],
    );

  return (
    <div
      className={`${
        floating
          ? 'absolute inset-0 z-40 flex items-center justify-center bg-lacquer-deep/80 backdrop-blur-sm'
          : 'relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-lacquer-deep'
      } px-6 font-sans text-bone`}
    >
      {!floating && (
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-1/2 h-[60vh] w-[120vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-vermilion/8 blur-[120px]" />
        </div>
      )}
      <div
        className="relative z-10 flex w-full max-w-5xl flex-col items-center rounded-sm bg-lacquer p-6 ring-1 ring-bone/10"
        data-tut="mulligan-panel"
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold/70">{t('board.mulligan')}</div>
        <h2 className="mt-3 text-center font-display text-3xl italic">{t('board.mulliganHint')}</h2>
        <div className="mt-6 flex w-full justify-center gap-3 overflow-x-auto pb-4">
          {G.players[me].hand.map((card, index) => (
            <button
              key={card.instanceId}
              className={`shrink-0 rounded-sm bg-lacquer-deep/60 p-1 ring-1 ring-bone/10 transition hover:-translate-y-2 hover:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-50 ${
                selected.includes(index) ? 'ring-2 ring-gold shadow-[0_20px_40px_-10px] shadow-gold/30' : ''
              }`}
              type="button"
              disabled={done}
              data-tut-card={card.defId}
              onClick={() => toggle(index)}
            >
              <Card card={card} size="small" selected={selected.includes(index)} showPopover />
            </button>
          ))}
        </div>
        {done ? (
          <p className="mt-2 text-sm text-bone/60">
            {t('board.handConfirmed')}。{t('board.waitingOpponent')}
          </p>
        ) : (
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <button
              className={primaryActionClass()}
              type="button"
              data-tut="mulligan-redraw"
              onClick={() => {
                onMulliganFeedback(selected.length);
                moves.mulligan(selected);
              }}
            >
              {t('board.redraw')} {selected.length} {t('board.cardsUnit')}
            </button>
            <button
              className={secondaryActionClass()}
              type="button"
              data-tut="mulligan-keep"
              onClick={() => {
                onMulliganFeedback(0);
                moves.keepHand();
              }}
            >
              {t('board.keepHand')}
            </button>
          </div>
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
    'bg-bone px-8 py-3 text-[11px] font-medium uppercase tracking-[0.3em] text-lacquer transition',
    'hover:bg-gold active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-bone',
    extra,
  ]
    .filter(Boolean)
    .join(' ');
}

function secondaryActionClass(extra = ''): string {
  return [
    'border border-bone/20 px-8 py-3 text-[11px] uppercase tracking-[0.3em] text-bone/70 transition',
    'hover:bg-bone/5 hover:text-bone disabled:cursor-not-allowed disabled:opacity-40',
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
      <div className="text-[10px] uppercase tracking-widest text-bone/40">{label}</div>
      <div className={`mt-1 truncate font-display text-xl italic ${accent ? 'text-gold' : 'text-bone'}`}>{value}</div>
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
    <div className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-lacquer-deep px-4 font-sans text-bone">
      <div className="pointer-events-none absolute inset-0">
        <div
          className={`absolute left-1/2 top-1/2 h-[90vh] w-[90vh] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[160px] ${win ? 'bg-gold/15' : 'bg-vermilion/15'}`}
        />
        <div className="absolute inset-0 opacity-[0.04] [background-image:radial-gradient(rgba(255,255,255,0.6)_1px,transparent_1px)] [background-size:3px_3px]" />
      </div>

      <main className="relative z-10 flex w-full max-w-3xl flex-col items-center justify-center px-8 text-center">
        <div className={`font-mono text-[10px] uppercase tracking-[0.6em] ${win ? 'text-gold' : 'text-vermilion'}`}>
          {t('board.result.concluded')}
        </div>
        <h1
          className={`mt-4 font-display text-[6rem] italic leading-none sm:text-[10rem] ${win ? 'text-bone' : 'text-bone/70'}`}
        >
          {t(glyphKey)}
        </h1>
        <div className="mt-2 font-display text-2xl italic tracking-wide">
          {t(titleKey)} · {t('board.turn')} {G.turnNumber}
        </div>

        <div className="mt-10 grid w-full grid-cols-2 gap-3 border-y border-bone/10 py-6 sm:grid-cols-4">
          <ResultCell label={t('auth.eloChange')} value={eloNotice || '-'} accent={win} />
          <ResultCell label={t('board.result.duration')} value={formatDuration(durationSeconds)} />
          <ResultCell label={t('board.result.turns')} value={String(G.turnNumber)} />
          <ResultCell label={t('board.result.reason')} value={reason} />
        </div>

        {ctx.gameover &&
          (gameOverActions ? (
            <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-3">
              {gameOverActions.helperText && <p className="text-xs text-bone/45">{gameOverActions.helperText}</p>}
              <button
                className={gameOverActionClass(gameOverActions.primary)}
                type="button"
                onClick={gameOverActions.primary.onClick}
              >
                {gameOverActions.primary.label}
              </button>
              {gameOverActions.secondary && (
                <button
                  className={gameOverActionClass(gameOverActions.secondary)}
                  type="button"
                  onClick={gameOverActions.secondary.onClick}
                >
                  {gameOverActions.secondary.label}
                </button>
              )}
            </div>
          ) : (
            <button className={primaryActionClass('mt-10')} type="button" onClick={() => window.location.reload()}>
              {t('board.playAgain')}
            </button>
          ))}
      </main>
    </div>
  );
}

function powerTotal(G: GameState, player: PlayerIndex): number {
  return G.players[player].powerCharger.reduce((sum, card) => sum + (getCardDef(card.defId)?.sendToPower ?? 0), 0);
}

function hpClass(hp: number): string {
  if (hp <= 25) return 'danger';
  if (hp <= 50) return 'warning';
  return 'healthy';
}

type FocusedCard = { card: CardInstance; owner: PlayerIndex; zone: string } | null;

function cardDefinition(card: CardInstance | null) {
  if (!card || card.defId === '__hidden__') return undefined;
  return getCardDef(card.defId);
}

function wasSetThisTurn(G: GameState, player: PlayerIndex, card: CardInstance | null): boolean {
  return !!card && G.setCardsThisTurn[player].some((item) => item.instanceId === card.instanceId);
}

function actionTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function LpBar({ hp, tone }: { hp: number; tone: 'gold' | 'vermilion' }) {
  const hpPercent = Math.max(0, Math.min(100, hp));
  return (
    <div className="relative h-1 w-full bg-bone/10" aria-hidden="true">
      <div
        className={`absolute inset-y-0 left-0 ${tone === 'gold' ? 'bg-gold' : 'bg-vermilion'}`}
        style={{ width: `${hpPercent}%` }}
      />
    </div>
  );
}

/* Slot — 照搬 demo 的卡槽設計 + 佔位文字 */
function Slot({
  card,
  label,
  size: _size = 'small',
  owner,
  onFocusCard,
  onClick,
}: {
  card: CardInstance | null;
  label?: string;
  size?: CardSize;
  owner: PlayerIndex;
  onFocusCard?: (focus: FocusedCard) => void;
  onClick?: () => void;
}) {
  const def = card?.faceUp ? getCardDef(card.defId) : undefined;
  return (
    <div
      className={`grid size-[88px] place-items-center rounded-sm bg-lacquer-deep/60 ring-1 ring-bone/5 shadow-[inset_0_2px_6px_rgba(0,0,0,0.5)] ${onClick ? 'cursor-pointer transition hover:ring-gold/30' : ''}`}
      onClick={onClick}
      onMouseEnter={() => card && onFocusCard?.({ card, owner, zone: label ?? 'slot' })}
      onMouseLeave={() => onFocusCard?.(null)}
    >
      {card && def ? (
        <div className="h-[80px] w-[56px] overflow-hidden rounded-xs ring-1 ring-bone/10">
          <img
            src={def.image}
            alt={def.name}
            className="h-full w-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        </div>
      ) : card ? (
        <div className="h-[80px] w-[56px] rounded-xs bg-lacquer ring-1 ring-bone/10">
          <img src="/card-back.jpg" alt="" className="h-full w-full rounded-xs object-cover" loading="lazy" />
        </div>
      ) : label ? (
        <span className="font-display text-xl italic text-bone/20">{label}</span>
      ) : null}
    </div>
  );
}

function FieldZone({
  label,
  shortLabel,
  className,
  card,
  onClick,
  size = 'small',
  activeTime,
  owner,
  onFocusCard,
}: {
  label: string;
  shortLabel?: string;
  className: string;
  card: CardInstance | null;
  onClick?: () => void;
  size?: CardSize;
  activeTime?: ChronosTime;
  owner?: PlayerIndex;
  onFocusCard?: (focus: FocusedCard) => void;
}) {
  const focus = card && owner !== undefined ? { card, owner, zone: label } : null;
  const content = (
    <>
      <span className="absolute left-2 top-1.5 z-10 font-mono text-[8px] uppercase tracking-[0.2em] text-bone/25">
        {label}
      </span>
      {card ? (
        <div
          className="flex h-full w-full items-center justify-center pt-3"
          onMouseEnter={() => onFocusCard?.(focus)}
          onFocus={() => onFocusCard?.(focus)}
        >
          <Card card={card} size={size} activeTime={activeTime} showPopover />
        </div>
      ) : (
        <span className="font-display text-xl italic text-bone/20">{shortLabel ?? label}</span>
      )}
    </>
  );
  const slotClass = [
    'zone',
    `zone-${size}`,
    className,
    'relative flex size-[88px] shrink-0 items-center justify-center rounded-sm bg-lacquer-deep/60 ring-1 ring-bone/5',
    'shadow-[inset_0_2px_6px_rgba(0,0,0,0.5)] transition hover:ring-gold/30',
    onClick ? 'cursor-pointer' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (onClick) {
    return (
      <button
        className={slotClass}
        type="button"
        onClick={onClick}
        onMouseEnter={() => onFocusCard?.(focus)}
        onFocus={() => onFocusCard?.(focus)}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={slotClass} onMouseEnter={() => onFocusCard?.(focus)} onFocus={() => onFocusCard?.(focus)}>
      {content}
    </div>
  );
}

function StackZone({
  kind,
  label,
  value,
  cards,
}: {
  kind: 'deck' | 'power';
  label: string;
  value: number;
  cards?: CardInstance[];
}) {
  if (kind === 'deck') {
    return (
      <div className="flex flex-col items-center gap-2" aria-label={`${label}: ${value}`}>
        <div
          className="flex h-16 w-11 items-center justify-center rounded-xs bg-lacquer ring-1 ring-bone/10"
          aria-hidden="true"
        >
          <div className="font-display text-sm italic text-gold/60">ZC</div>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-bone/40" aria-hidden="true">
          {label} {value}
        </span>
      </div>
    );
  }

  if (cards && cards.length > 0) {
    return (
      <div className="relative flex min-w-24 flex-col gap-2" aria-label={`${label}: ${value}`}>
        <div className="relative h-16" aria-hidden="true">
          {cards.map((card, i) => {
            const def = getCardDef(card.defId);
            return (
              <div
                key={card.instanceId}
                className="absolute top-0 h-16 w-11 overflow-hidden rounded-xs bg-lacquer-deep ring-1 ring-bone/10"
                style={{ left: `${i * 12}px` }}
              >
                {def?.image && (
                  <img
                    className="h-full w-full object-cover opacity-70"
                    src={def.image}
                    alt={def.name}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                )}
              </div>
            );
          })}
        </div>
        <strong className="font-mono text-[10px] uppercase tracking-[0.25em] text-gold/70">
          {label} {value}
        </strong>
      </div>
    );
  }

  return (
    <div
      className="flex min-w-24 flex-col gap-2 rounded-sm bg-lacquer-deep/50 p-3 ring-1 ring-bone/5"
      aria-label={`${label}: ${value}`}
    >
      <strong className="font-mono text-[10px] uppercase tracking-[0.25em] text-bone/45">
        <span>{label}</span>
      </strong>
      <span className="font-display text-2xl italic text-gold/70">{value}</span>
    </div>
  );
}

export function OpponentStatsBar({
  G,
  opponentIndex,
  damageAmount,
  onFocusCard,
}: {
  G: GameState;
  opponentIndex: PlayerIndex;
  damageAmount?: number;
  onFocusCard?: (focus: FocusedCard) => void;
}) {
  const opponent = G.players[opponentIndex];

  return (
    <section
      className={`relative flex flex-col items-center gap-2 border-b border-bone/5 pb-3 ${damageAmount ? 'damaged' : ''}`}
      aria-label={t('player.opponent')}
    >
      {/* 名字 + LP 居中 */}
      <div className="flex items-center gap-6">
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.3em] text-bone/40">{t('player.opponent')}</div>
          <div className="font-display text-xl italic">{playerName(opponentIndex)}</div>
        </div>
        <div className="w-72">
          <LpBar hp={opponent.hp} tone="vermilion" />
          <div className="mt-1 flex justify-between font-mono text-[10px] text-bone/40">
            <span>
              {t('board.hp')} {opponent.hp}/100
            </span>
            <span>
              {t('board.hand')} · {opponent.hand.length}
            </span>
          </div>
        </div>
      </div>
      {/* 手牌背面 + 設置區 */}
      <div className="flex items-center gap-4">
        {/* 手牌背面居中 */}
        <div className="flex items-end gap-1.5" aria-label={t('board.hand')}>
          {opponent.hand.map((card, index) => (
            <div
              key={card.instanceId}
              className="h-12 w-9 overflow-hidden rounded-xs ring-1 ring-bone/10 shadow-[0_12px_30px_-18px_rgba(0,0,0,0.9)]"
              style={{ transform: `translateY(${Math.abs(index - (opponent.hand.length - 1) / 2) * 2}px)` }}
            >
              <img src="/card-back.jpg" alt="card back" className="h-full w-full object-cover" loading="lazy" />
            </div>
          ))}
        </div>
        {/* 對手設置區 */}
        <div className="flex gap-1.5">
          <FieldZone
            label={t('board.setZoneA')}
            shortLabel="A"
            className="set-zone set-zone-a"
            card={opponent.setZoneA}
            size="small"
            owner={opponentIndex}
            onFocusCard={onFocusCard}
          />
          <FieldZone
            label={t('board.setZoneB')}
            shortLabel="B"
            className="set-zone set-zone-b"
            card={opponent.setZoneB}
            size="small"
            owner={opponentIndex}
            onFocusCard={onFocusCard}
          />
          <FieldZone
            label={t('board.areaEnchant')}
            shortLabel="C"
            className="area-zone area-zone-c"
            card={opponent.setZoneC}
            size="small"
            owner={opponentIndex}
            onFocusCard={onFocusCard}
          />
        </div>
      </div>
      {damageAmount ? (
        <span
          className="damage-float absolute right-0 top-0 font-display text-3xl italic text-vermilion"
          key={`opp-${damageAmount}`}
        >
          -{damageAmount}
        </span>
      ) : null}
    </section>
  );
}

export function BottomZones({
  G,
  meIndex,
  moves,
  damageAmount,
  onFocusCard,
}: {
  G: GameState;
  meIndex: PlayerIndex;
  moves: Props['moves'];
  damageAmount?: number;
  onFocusCard?: (focus: FocusedCard) => void;
}) {
  const me = G.players[meIndex];

  return (
    <section
      className="relative flex flex-1 flex-col items-center justify-end gap-3 border-t border-bone/5 pt-3"
      aria-label={t('player.me')}
    >
      {/* 設置區 */}
      <div className="flex items-center justify-center gap-3">
        <StackZone
          kind="power"
          label={t('board.powerCharger')}
          value={powerTotal(G, meIndex)}
          cards={me.powerCharger}
        />
        <FieldZone
          label={t('board.setZoneA')}
          shortLabel="A"
          className="set-zone set-zone-a"
          card={me.setZoneA}
          onClick={me.setZoneA && !G.ready[meIndex] ? () => moves.undoSetCard('A') : undefined}
          size="normal"
          owner={meIndex}
          onFocusCard={onFocusCard}
        />
        <FieldZone
          label={t('board.setZoneB')}
          shortLabel="B"
          className="set-zone set-zone-b"
          card={me.setZoneB}
          onClick={me.setZoneB && !G.ready[meIndex] ? () => moves.undoSetCard('B') : undefined}
          size="normal"
          owner={meIndex}
          onFocusCard={onFocusCard}
        />
        <FieldZone
          label={t('board.areaEnchant')}
          shortLabel="C"
          className="area-zone area-zone-c"
          card={me.setZoneC}
          onClick={
            wasSetThisTurn(G, meIndex, me.setZoneC) && !G.ready[meIndex] ? () => moves.undoSetCard('C') : undefined
          }
          size="normal"
          owner={meIndex}
          onFocusCard={onFocusCard}
        />
        <StackZone kind="deck" label={t('board.deckZone')} value={me.deck.length} />
      </div>
      {/* 玩家資訊列 */}
      <div className="flex w-full items-end justify-between px-2">
        <div className="w-72">
          <div className="flex items-center gap-4">
            <div className="font-display text-xl italic">{playerName(meIndex)}</div>
          </div>
          <LpBar hp={me.hp} tone="gold" />
          <div className="mt-1 flex justify-between font-mono text-[10px] text-bone/40">
            <span>
              {t('board.hp')} {me.hp}/100
            </span>
            <span>
              {t('board.deck')} · {me.deck.length}
            </span>
          </div>
        </div>
        <div className={`font-mono text-[10px] uppercase tracking-[0.25em] text-bone/40 ${hpClass(me.hp)}`}>
          {t('board.powerCharger')} {powerTotal(G, meIndex)} · {t('board.abyss')} {me.abyss.length}
        </div>
      </div>
      {damageAmount ? (
        <span
          className="damage-float absolute left-0 top-2 font-display text-3xl italic text-vermilion"
          key={`me-${damageAmount}`}
        >
          -{damageAmount}
        </span>
      ) : null}
    </section>
  );
}

export function CentralArena({
  G,
  meIndex,
  opponentIndex,
  time,
  onFocusCard,
}: {
  G: GameState;
  meIndex: PlayerIndex;
  opponentIndex: PlayerIndex;
  time: ChronosTime;
  onFocusCard?: (focus: FocusedCard) => void;
}) {
  const me = G.players[meIndex];
  const opponent = G.players[opponentIndex];

  return (
    <section className="flex h-full items-center justify-center" aria-label={t('chronos.title')}>
      {/* 對手戰鬥區 | Chronos | 我方戰鬥區 */}
      <div className="flex items-center gap-8">
        <FieldZone
          label={`${t('player.opponent')} ${t('board.battleZone')}`}
          shortLabel={t('board.battleZoneShort')}
          className="battle-zone central-battle-zone opponent-battle-zone"
          card={opponent.battleZone}
          size="normal"
          activeTime={time}
          owner={opponentIndex}
          onFocusCard={onFocusCard}
        />

        <Chronos
          chronos={G.chronos}
          currentTime={time}
          nightSidePlayer={G.chronos.nightSidePlayer}
          currentPlayer={meIndex}
        />

        <FieldZone
          label={`${t('player.me')} ${t('board.battleZone')}`}
          shortLabel={t('board.battleZoneShort')}
          className="battle-zone central-battle-zone player-battle-zone"
          card={me.battleZone}
          size="normal"
          activeTime={time}
          owner={meIndex}
          onFocusCard={onFocusCard}
        />
      </div>
    </section>
  );
}

export function HandDrawer({
  cards,
  owner,
  onCardClick,
  onFocusCard,
  children,
}: {
  cards: CardInstance[];
  owner: PlayerIndex;
  expanded: boolean;
  onToggle: () => void;
  onCardClick?: (index: number) => void;
  onFocusCard?: (focus: FocusedCard) => void;
  children?: ReactNode;
}) {
  const center = (cards.length - 1) / 2;
  return (
    <section
      className="pointer-events-none fixed bottom-0 left-4 z-30 flex items-end justify-between gap-4 pb-4 [right:calc(280px+2rem)]"
      aria-label={t('board.hand')}
    >
      <div className="pointer-events-auto min-w-48">{children}</div>
      <div className="pointer-events-auto flex min-h-44 flex-1 items-end justify-center overflow-visible">
        <div className="flex items-end justify-center">
          {cards.map((card, index) => {
            const rotate = (index - center) * 4;
            const translateY = Math.abs(index - center) * 6;
            const fanStyle = {
              '--hand-rotate': `${rotate}deg`,
              '--hand-y': `${translateY}px`,
            } as CSSProperties;
            return (
              <div
                key={card.instanceId}
                className="-mx-2 h-36 w-24 shrink-0 rounded-sm bg-gradient-to-b from-bone/10 to-lacquer-deep p-0.5 ring-1 ring-bone/10 transition duration-200 [transform:rotate(var(--hand-rotate))_translateY(var(--hand-y))] hover:z-20 hover:ring-gold/60 hover:[transform:translateY(-1.5rem)_rotate(0deg)] focus-within:z-20 focus-within:ring-gold/60 focus-within:[transform:translateY(-1.5rem)_rotate(0deg)]"
                style={fanStyle}
                onMouseEnter={() => onFocusCard?.({ card, owner, zone: t('board.hand') })}
                onFocus={() => onFocusCard?.({ card, owner, zone: t('board.hand') })}
              >
                <Card
                  card={card}
                  size="normal"
                  className="hand-card !h-full !w-full"
                  showBadges={false}
                  showPopover
                  onClick={onCardClick ? () => onCardClick(index) : undefined}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function ActionsBar({
  ready,
  canConfirm,
  cardsSet,
  required,
  onConfirm,
}: {
  ready: boolean;
  canConfirm: boolean;
  cardsSet: number;
  required: number;
  onConfirm: () => void;
}) {
  return (
    <section className="actions-bar flex flex-col items-start gap-2">
      <button className={primaryActionClass()} disabled={!canConfirm} type="button" onClick={onConfirm}>
        {ready ? t('board.readyWaiting') : `${t('board.confirmSet')} (${cardsSet}/${required})`}
      </button>
    </section>
  );
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

function PhaseInstructionBanner({ instruction }: { instruction: ReturnType<typeof phaseInstruction> }) {
  return (
    <section className="board-phase-instruction pointer-events-none absolute inset-x-3 top-14 z-30 flex justify-center lg:inset-x-6">
      <div className="w-full max-w-3xl rounded-sm border border-bone/10 bg-lacquer-deep/82 px-3 py-2 text-bone shadow-[0_18px_50px_-35px_rgba(0,0,0,0.9)] backdrop-blur md:px-4">
        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between md:gap-4">
          <div className="min-w-0">
            <div className="font-mono text-[9px] uppercase tracking-[0.28em] text-gold/70">{instruction.title}</div>
            <p className="mt-1 text-xs leading-snug text-bone/70 md:text-sm">{instruction.body}</p>
          </div>
          {instruction.meta.length > 0 && (
            <div className="flex shrink-0 flex-wrap gap-1.5">
              {instruction.meta.map((item) => (
                <span
                  key={item.text}
                  className={
                    item.done
                      ? 'rounded-sm border border-jade/40 bg-jade/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-jade'
                      : 'rounded-sm border border-bone/10 bg-bone/5 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-bone/45'
                  }
                >
                  {item.text}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
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
            <button
              className="primary-action"
              type="button"
              disabled={!canSubmit}
              onClick={() => moves.submitPendingChoice(selected)}
            >
              {t('board.submitChoice')}
            </button>
          </div>
        </>
      ) : (
        <p>{t('board.waitingOpponent')}</p>
      )}
    </section>
  );
}

export function FocusPanel({ focus }: { focus: FocusedCard }) {
  const def = cardDefinition(focus?.card ?? null);
  const locale = useLocale();
  const translatedEffect = def ? getTranslatedEffect(def.id, locale) : null;
  return (
    <section className="flex flex-col rounded-sm bg-lacquer p-4 ring-1 ring-bone/10" style={{ height: '480px' }}>
      <div className="flex-shrink-0 font-mono text-[10px] uppercase tracking-[0.3em] text-gold/70">Focus</div>
      {focus && def ? (
        <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex-shrink-0 text-[10px] uppercase tracking-[0.25em] text-bone/35">
            {playerName(focus.owner)} · {focus.zone}
          </div>
          {/* 卡圖 — 固定高度 */}
          <div className="mt-2 flex-shrink-0 aspect-[3/4] w-full overflow-hidden rounded-sm ring-1 ring-bone/10">
            <img
              src={def.image}
              alt={def.name}
              className="h-full w-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </div>
          <h2 className="mt-2 flex-shrink-0 font-display text-xl italic text-bone">{def.name}</h2>
          <div className="mt-2 flex-shrink-0 grid grid-cols-2 gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-bone/45">
            <span>
              {t('card.energy')} <span className="text-gold">{def.powerCost}</span>
            </span>
            <span>
              {t('card.clock')} <span className="text-gold">{def.clock}</span>
            </span>
            {def.attack && (
              <>
                <span>
                  {t('card.night')} <span className="text-gold">{def.attack.night}</span>
                </span>
                <span>
                  {t('card.day')} <span className="text-gold">{def.attack.day}</span>
                </span>
              </>
            )}
          </div>
          {(translatedEffect || def.effect) && (
            <p className="mt-2 min-h-0 flex-1 overflow-y-auto text-xs leading-relaxed text-bone/60">
              {translatedEffect ?? def.effect}
            </p>
          )}
        </div>
      ) : (
        /* 無焦點時佔位，保持同樣高度 */
        <div className="mt-2 flex flex-1 flex-col items-center justify-center rounded-sm bg-lacquer-deep/50 ring-1 ring-bone/5">
          <div className="aspect-[3/4] w-32 rounded-sm bg-lacquer-deep/80 ring-1 ring-bone/10" />
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.25em] text-bone/25">{t('card.unknown')}</p>
        </div>
      )}
    </section>
  );
}

export function BattleLogPanel({ G }: { G: GameState }) {
  const locale = useLocale();
  const entries = (G.actionLog ?? []).slice(-14).reverse();
  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-sm bg-lacquer/60 p-4 ring-1 ring-bone/10">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold/70">Ritual Log</span>
        <span className="size-1.5 animate-pulse rounded-full bg-vermilion" />
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto font-mono text-[10px] leading-relaxed text-bone/40">
        {entries.map((entry) => {
          const { segments, breakdown } = formatLogEntry(entry, locale);
          return (
            <div key={`${entry.id ?? entry.timestamp}-${entry.action}`}>
              <p>
                <span className="text-bone/60">[{actionTime(entry.timestamp)}]</span>{' '}
                <span className="text-gold/50">
                  {t('board.turn')} {entry.turn}
                </span>{' '}
                {renderLogSegments(segments)}
              </p>
              {breakdown && <LogBreakdown breakdown={breakdown} />}
            </div>
          );
        })}
        {entries.length === 0 && <p className="text-bone/30">{t('board.waitingOpponent')}</p>}
      </div>
    </section>
  );
}

function BattleBoard({ G, moves, playerID, useServerTimer = false, opponentLabel, selfLabel }: Props) {
  const meIndex = Number(playerID ?? '0') as PlayerIndex;
  const opponentIndex = (1 - meIndex) as PlayerIndex;
  const me = G.players[meIndex];
  const opponent = G.players[opponentIndex];
  const locale = useLocale();
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
  const [timeLeft, setTimeLeft] = useState(TURN_TIMER_SECONDS);
  // P3-16：伺服器權威計時器超時後，每秒遞增 retryTick 以重試 timeoutSkip（處理時鐘漂移）。
  const [retryTick, setRetryTick] = useState(0);
  const [handExpanded, setHandExpanded] = useState(true);
  const [phaseMessage, setPhaseMessage] = useState<FeedbackMessage | null>(null);
  const [focusedCard, setFocusedCard] = useState<FocusedCard>(null);
  const [_damageFlash, setDamageFlash] = useState<{ target: PlayerIndex; amount: number; id: number } | null>(null);
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
    if ((G.step === 'initialSet' || G.step === 'turnSet') && !G.ready[meIndex]) setHandExpanded(true);
  }, [G.step, G.turnNumber, G.ready, meIndex]);

  useEffect(() => {
    if (G.ready[meIndex]) setHandExpanded(false);
  }, [G.ready, meIndex]);

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
  };

  const time = getChronosTime(G);
  const canConfirm = !G.ready[meIndex] && me.cardsSetThisTurn >= minimum && me.cardsSetThisTurn <= required;
  const currentInstruction = phaseInstruction(G, meIndex, required, minimum);

  return (
    <div
      className={`board chrono-${time} ${handExpanded ? 'drawer-expanded' : 'drawer-collapsed'} !block relative h-full min-h-0 w-full overflow-hidden bg-lacquer-deep text-bone font-sans`}
    >
      {/* 環境光暈 — 完全照搬 demo */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[60vh] w-[120vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-vermilion/8 blur-[120px]" />
      </div>

      {/* 頂欄 — demo 格式 + 階段指示器 */}
      <header className="absolute inset-x-0 top-0 z-30 flex h-12 items-center justify-between gap-3 overflow-x-auto border-b border-bone/5 bg-lacquer-deep/80 px-3 backdrop-blur md:px-6">
        <div className="flex shrink-0 items-center gap-4 font-mono text-[10px] uppercase tracking-[0.3em] md:gap-8">
          <span className="text-bone/40">
            {t('board.turn')} {G.turnNumber}
          </span>
          <span className="text-bone/40">{time === 'night' ? `🌙 ${t('board.night')}` : `☀️ ${t('board.day')}`}</span>
          <span className={`text-bone/40 ${timeLeft <= 10 ? 'text-vermilion' : ''}`}>
            {timeLeft}
            {t('board.secondsUnit')}
          </span>
        </div>
        <div className="hidden shrink-0 items-center gap-6 font-mono text-[10px] uppercase tracking-[0.3em] md:flex">
          {[
            { label: '設置', active: G.step === 'initialSet' || G.step === 'turnSet' },
            { label: '公開', active: false },
            { label: '時間', active: false },
            { label: '效果', active: G.step === 'effectOrder' || !!G.pendingChoice },
            { label: '戰鬥', active: Boolean(G.lastBattleResult?.damage) && G.turnNumber > 1 },
            { label: '結算', active: G.step === 'gameOver' },
          ].map((phase) => (
            <span key={phase.label} className={phase.active ? 'text-gold' : 'text-bone/20'}>
              {phase.label}
            </span>
          ))}
        </div>
        <div className="hidden shrink-0 items-center gap-3 font-mono text-[10px] uppercase tracking-[0.3em] lg:flex">
          <span className="text-bone/40">{currentInstruction.title}</span>
          <span className="text-gold">{currentInstruction.body}</span>
        </div>
      </header>

      <PhaseInstructionBanner instruction={currentInstruction} />

      {/* 雙欄佈局 — header 與階段提示浮在上方，pt-28 撐開頂部空間 */}
      <div className="relative z-10 grid h-full grid-cols-1 gap-3 overflow-y-auto px-3 pb-4 pt-28 lg:grid-cols-[minmax(0,1fr)_280px] lg:grid-rows-[minmax(0,1fr)] lg:gap-4 lg:overflow-hidden lg:px-6">
        {/* ===== 左欄：戰場 ===== */}
        <div className="battle-perspective-field flex min-h-0 flex-col overflow-visible lg:overflow-hidden">
          <BattlefieldCanvas />

          {/* 對手區域 — flex-1 justify-start（照搬 demo） */}
          <div className="flex h-auto min-h-[13rem] shrink-0 flex-col items-center justify-start gap-2 pt-2 lg:h-[240px] lg:gap-4 lg:pt-3">
            {/* 對手資訊：名字在右 + LP bar + 統計 */}
            <div className="flex flex-wrap items-center justify-center gap-3 lg:gap-6">
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-[0.3em] text-bone/40">{t('player.opponent')}</div>
                <div className="font-display text-xl italic">{playerName(opponentIndex)}</div>
              </div>
              <div className="relative w-56 sm:w-72" data-tut="opponent-hp">
                <div className="relative h-1 w-full bg-bone/10">
                  <div className="absolute inset-y-0 left-0 bg-vermilion" style={{ width: `${opponent.hp}%` }} />
                </div>
                <div className="mt-1 flex justify-between font-mono text-[10px] text-bone/40">
                  <span>{opponent.hp} / 100</span>
                  <span>
                    {t('board.hand')} · {opponent.hand.length}
                  </span>
                </div>
              </div>
            </div>
            {/* 對手手牌背 — 上下顛倒 */}
            <div className="flex gap-1.5">
              {opponent.hand.map((card, index) => (
                <div
                  key={card.instanceId}
                  className="h-12 w-9 overflow-hidden rounded-xs ring-1 ring-bone/10 rotate-180"
                  style={{
                    transform: `translateY(${Math.abs(index - (opponent.hand.length - 1) / 2) * 2}px) rotate(180deg)`,
                  }}
                >
                  <img src="/card-back.jpg" alt="" className="h-full w-full object-cover" loading="lazy" />
                </div>
              ))}
            </div>
            {/* 對手設置區 — CBA 從右到左 + 上下顛倒 + 充能/牌組/深淵 */}
            <div className="battlefield-depth-row battlefield-depth-far flex max-w-full items-start gap-2 overflow-x-auto pb-1 lg:gap-3">
              {/* 對手充能區 */}
              <div className="flex flex-col items-center gap-1">
                {opponent.powerCharger.length > 0 ? (
                  <div className="relative flex size-[88px] items-end justify-center overflow-hidden rounded-sm bg-lacquer-deep/60 ring-1 ring-bone/5">
                    {opponent.powerCharger.slice(-3).map((card, i) => {
                      const def = getCardDef(card.defId);
                      return (
                        <div
                          key={card.instanceId}
                          className="absolute bottom-1 h-14 w-10 overflow-hidden rounded-xs ring-1 ring-bone/10"
                          style={{ left: `${12 + i * 14}px` }}
                        >
                          {def?.image && (
                            <img
                              src={def.image}
                              alt=""
                              className="h-full w-full object-cover opacity-70"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          )}
                        </div>
                      );
                    })}
                    <span className="absolute top-1 right-1 font-mono text-[10px] text-gold/70">
                      {opponent.powerCharger.reduce((s, c) => s + (getCardDef(c.defId)?.sendToPower ?? 0), 0)}
                    </span>
                  </div>
                ) : (
                  <div className="flex size-[88px] items-center justify-center rounded-sm bg-lacquer-deep/60 ring-1 ring-bone/5">
                    <span className="font-mono text-lg text-gold/60">0</span>
                  </div>
                )}
                <span className="font-mono text-[9px] text-bone/30">⚡</span>
              </div>
              <Slot
                card={opponent.setZoneA}
                label="A"
                size="small"
                owner={opponentIndex}
                onFocusCard={setFocusedCard}
              />
              <Slot
                card={opponent.setZoneB}
                label="B"
                size="small"
                owner={opponentIndex}
                onFocusCard={setFocusedCard}
              />
              <Slot
                card={opponent.setZoneC}
                label="C"
                size="small"
                owner={opponentIndex}
                onFocusCard={setFocusedCard}
              />
              {/* 對手牌組 */}
              <div className="flex flex-col items-center gap-1">
                <div className="relative flex size-[88px] items-center justify-center overflow-hidden rounded-sm bg-lacquer-deep/60 ring-1 ring-bone/5">
                  {Array.from({ length: Math.min(opponent.deck.length, 3) }).map((_, i) => (
                    <img
                      key={i}
                      src="/card-back.jpg"
                      alt=""
                      className="absolute h-[72px] w-[48px] rounded-xs object-cover"
                      style={{ top: `${4 - i * 2}px`, left: `${16 + i * 2}px`, opacity: 1 - i * 0.15 }}
                      loading="lazy"
                    />
                  ))}
                  <span className="absolute bottom-1 right-1 font-mono text-[10px] text-bone/50">
                    {opponent.deck.length}
                  </span>
                </div>
                <span className="font-mono text-[9px] text-bone/30">🃏</span>
              </div>
              {/* 對手深淵 */}
              <div className="flex flex-col items-center gap-1">
                <div className="flex size-[88px] items-center justify-center rounded-sm bg-lacquer-deep/60 ring-1 ring-bone/5">
                  <span className="font-mono text-sm text-bone/30">🕳️ {opponent.abyss.length}</span>
                </div>
                <span className="font-mono text-[9px] text-bone/30">{t('board.abyss')}</span>
              </div>
            </div>
          </div>

          {/* Chronos + 戰鬥區 */}
          <div
            className="battle-perspective-stage battlefield-depth-row battlefield-depth-mid my-2 flex min-h-[10rem] items-center justify-center lg:flex-1 lg:min-h-0"
            data-tut="central-arena"
          >
            <FieldZone
              label={t('board.battleZone')}
              shortLabel={t('board.battleZoneShort')}
              className="battle-zone opponent-battle-zone"
              card={opponent.battleZone}
              size="normal"
              activeTime={time}
              owner={opponentIndex}
              onFocusCard={setFocusedCard}
            />
            <div data-tut="chronos-clock">
              <Chronos
                chronos={G.chronos}
                currentTime={time}
                nightSidePlayer={G.chronos.nightSidePlayer}
                currentPlayer={meIndex}
              />
            </div>
            <FieldZone
              label={t('board.battleZone')}
              shortLabel={t('board.battleZoneShort')}
              className="battle-zone player-battle-zone"
              card={me.battleZone}
              size="normal"
              activeTime={time}
              owner={meIndex}
              onFocusCard={setFocusedCard}
              onClick={
                G.step === 'initialSet' && me.battleZone && !G.ready[meIndex] ? () => moves.undoSetCard('A') : undefined
              }
            />
          </div>

          {/* 玩家區域 — flex-1 justify-end（照搬 demo） */}
          <div className="flex h-auto min-h-[18rem] shrink-0 flex-col items-center justify-end gap-3 pb-2 lg:h-[280px]">
            {/* 玩家設置區 + 充能/牌組 */}
            <div className="battlefield-depth-row battlefield-depth-near flex max-w-full items-end gap-2 overflow-x-auto pb-1 lg:gap-3">
              {/* 充能區 — 左邊 */}
              <div className="flex flex-col items-center gap-1" data-tut="player-power">
                {me.powerCharger.length > 0 ? (
                  <div className="relative flex size-[88px] items-end justify-center overflow-hidden rounded-sm bg-lacquer-deep/60 ring-1 ring-bone/5">
                    {me.powerCharger.slice(-3).map((card, i) => {
                      const def = getCardDef(card.defId);
                      return (
                        <div
                          key={card.instanceId}
                          className="absolute bottom-1 h-14 w-10 overflow-hidden rounded-xs ring-1 ring-bone/10"
                          style={{ left: `${12 + i * 14}px` }}
                        >
                          {def?.image && (
                            <img
                              src={def.image}
                              alt=""
                              className="h-full w-full object-cover opacity-70"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          )}
                        </div>
                      );
                    })}
                    <span className="absolute top-1 right-1 font-mono text-[10px] text-gold/70">
                      {powerTotal(G, meIndex)}
                    </span>
                  </div>
                ) : (
                  <div className="flex size-[88px] items-center justify-center rounded-sm bg-lacquer-deep/60 ring-1 ring-bone/5">
                    <span className="font-mono text-lg text-gold/60">{powerTotal(G, meIndex)}</span>
                  </div>
                )}
                <span className="font-mono text-[9px] text-bone/30">⚡ {t('board.powerCharger')}</span>
              </div>
              <div className="flex gap-1.5 lg:gap-2" data-tut="player-set-zones">
                <Slot
                  card={me.setZoneA}
                  label="A"
                  size="small"
                  owner={meIndex}
                  onFocusCard={setFocusedCard}
                  onClick={me.setZoneA && !G.ready[meIndex] ? () => moves.undoSetCard('A') : undefined}
                />
                <Slot
                  card={me.setZoneB}
                  label="B"
                  size="small"
                  owner={meIndex}
                  onFocusCard={setFocusedCard}
                  onClick={me.setZoneB && !G.ready[meIndex] ? () => moves.undoSetCard('B') : undefined}
                />
                <Slot
                  card={me.setZoneC}
                  label="C"
                  size="small"
                  owner={meIndex}
                  onFocusCard={setFocusedCard}
                  onClick={
                    wasSetThisTurn(G, meIndex, me.setZoneC) && !G.ready[meIndex]
                      ? () => moves.undoSetCard('C')
                      : undefined
                  }
                />
              </div>
              {/* 牌組 — 右邊 — 根據數量堆疊 */}
              <div className="flex flex-col items-center gap-1">
                <div className="relative flex size-[88px] items-center justify-center overflow-hidden rounded-sm bg-lacquer-deep/60 ring-1 ring-bone/5">
                  {Array.from({ length: Math.min(me.deck.length, 3) }).map((_, i) => (
                    <img
                      key={i}
                      src="/card-back.jpg"
                      alt=""
                      className="absolute h-[72px] w-[48px] rounded-xs object-cover"
                      style={{ top: `${4 - i * 2}px`, left: `${16 + i * 2}px`, opacity: 1 - i * 0.15 }}
                      loading="lazy"
                    />
                  ))}
                  <span className="absolute bottom-1 right-1 font-mono text-[10px] text-bone/50">{me.deck.length}</span>
                </div>
                <span className="font-mono text-[9px] text-bone/30">🃏</span>
              </div>
              {/* 深淵 */}
              <div className="flex flex-col items-center gap-1" data-tut="player-abyss">
                <div className="flex size-[88px] items-center justify-center rounded-sm bg-lacquer-deep/60 ring-1 ring-bone/5">
                  <span className="font-mono text-sm text-bone/30">🕳️ {me.abyss.length}</span>
                </div>
                <span className="font-mono text-[9px] text-bone/30">{t('board.abyss')}</span>
              </div>
            </div>
            {/* 玩家資訊列 — 照搬 demo 底部排列 */}
            <div
              className="flex w-full flex-col items-stretch justify-between gap-3 px-2 lg:flex-row lg:items-end"
              data-tut="player-actions"
            >
              {/* 左：LP bar */}
              <div className="relative w-full lg:w-72" data-tut="player-hp">
                <div className="relative h-1 w-full bg-bone/10">
                  <div className="absolute inset-y-0 left-0 bg-gold" style={{ width: `${me.hp}%` }} />
                </div>
                <div className="mt-1 flex justify-between font-mono text-[10px] text-bone/40">
                  <span>{me.hp} / 100</span>
                  <span>
                    {t('board.deck')} · {me.deck.length}
                  </span>
                </div>
              </div>
              {/* 中：手牌扇形 */}
              <div
                className="flex items-end gap-1 overflow-x-auto px-1 pb-2 lg:overflow-visible lg:px-4"
                data-zone="hand"
              >
                {me.hand.map((card, index) => {
                  const center = (me.hand.length - 1) / 2;
                  const rotate = (index - center) * 4;
                  const translateY = Math.abs(index - center) * 6;
                  return (
                    <div
                      key={card.instanceId}
                      className="h-28 w-[4.75rem] shrink-0 cursor-pointer transition-all duration-300 hover:-translate-y-6 hover:rotate-0 hover:ring-2 hover:ring-gold hover:shadow-[0_20px_40px_-10px] hover:shadow-gold/30 sm:h-32 sm:w-20 lg:h-36 lg:w-24"
                      style={{ transform: `rotate(${rotate}deg) translateY(${translateY}px)` }}
                      data-tut-card={card.defId}
                      onClick={!G.ready[meIndex] ? () => setFromHand(index) : undefined}
                      onMouseEnter={() => setFocusedCard({ card, owner: meIndex, zone: t('board.hand') })}
                      onMouseLeave={() => setFocusedCard(null)}
                    >
                      <Card
                        card={card}
                        size="normal"
                        className="!h-full !w-full !aspect-auto !border-0 !bg-transparent !shadow-none !rounded-none"
                        showBadges={false}
                        showPopover
                      />
                    </div>
                  );
                })}
              </div>
              {/* 右：操作按鈕 — 照搬 demo */}
              <div className="flex w-full flex-row gap-2 lg:w-44 lg:flex-col">
                {!G.ready[meIndex] ? (
                  <button
                    className="flex-1 bg-bone px-5 py-2.5 text-[10px] font-medium uppercase tracking-[0.3em] text-lacquer transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 lg:flex-none"
                    type="button"
                    data-tut="confirm-set"
                    disabled={!canConfirm}
                    onClick={() => {
                      showTransientPhaseMessage({ title: t('board.setConfirmed'), tone: 'neutral' });
                      moves.confirmReady();
                    }}
                  >
                    {t('board.confirmSet')} ({me.cardsSetThisTurn}/{required})
                  </button>
                ) : (
                  <button
                    className="flex-1 border border-bone/20 px-5 py-2 text-[10px] uppercase tracking-[0.3em] text-bone/60 lg:flex-none"
                    type="button"
                    disabled
                  >
                    {t('board.readyWaiting')}
                  </button>
                )}
                <button
                  className="flex-1 border border-bone/20 px-5 py-2 text-[10px] uppercase tracking-[0.3em] text-bone/60 transition hover:bg-bone/5 lg:flex-none"
                  type="button"
                  disabled
                >
                  {t('board.powerCharger')} {powerTotal(G, meIndex)}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ===== 右欄：側欄 — 照搬 demo aside 結構 ===== */}
        <aside className="flex max-h-[22rem] min-h-[18rem] flex-col gap-3 overflow-hidden lg:max-h-none lg:min-h-0">
          {/* Focus 卡牌詳情 — 照搬 demo rounded-sm bg-lacquer p-4 ring-1 ring-bone/10 */}
          <div className="rounded-sm bg-lacquer p-4 ring-1 ring-bone/10">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.3em] text-gold/70">Focus</span>
              {focusedCard && (
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-bone/35">
                  {playerName(focusedCard.owner)} · {focusedCard.zone}
                </span>
              )}
            </div>
            {focusedCard ? (
              <>
                <div className="aspect-[3/4] w-full overflow-hidden rounded-xs bg-gradient-to-br from-vermilion/30 via-lacquer-deep to-lacquer ring-1 ring-bone/10">
                  {cardDefinition(focusedCard.card)?.image && (
                    <img
                      src={cardDefinition(focusedCard.card)!.image}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  )}
                </div>
                <div className="mt-3 font-display text-lg italic">{cardDefinition(focusedCard.card)?.name ?? '?'}</div>
                <div className="mt-1 font-mono text-[9px] uppercase tracking-widest text-bone/40">
                  {cardDefinition(focusedCard.card)?.element} · {cardDefinition(focusedCard.card)?.type}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-bone/50">
                  <span>
                    ⚡ {t('card.energy')}{' '}
                    <span className="text-gold">{cardDefinition(focusedCard.card)?.powerCost}</span>
                  </span>
                  <span>
                    🕐 {t('card.clock')} <span className="text-gold">{cardDefinition(focusedCard.card)?.clock}</span>
                  </span>
                  {cardDefinition(focusedCard.card)?.attack && (
                    <>
                      <span>
                        🌙 {t('card.night')}{' '}
                        <span className="text-gold">{cardDefinition(focusedCard.card)!.attack!.night}</span>
                      </span>
                      <span>
                        ☀️ {t('card.day')}{' '}
                        <span className="text-gold">{cardDefinition(focusedCard.card)!.attack!.day}</span>
                      </span>
                    </>
                  )}
                  {/* 戰場卡牌顯示原始 vs 實際攻擊力（含附魔增益 / 能量不足歸零） */}
                  {focusedCard.zone === t('board.battleZone') && cardDefinition(focusedCard.card)?.attack && (
                    <>
                      <span className="col-span-2 mt-1 border-t border-bone/10 pt-1">
                        {t('board.hpChange.rawAttack' as never)}{' '}
                        <span className="text-gold">
                          {getBaseAttack(focusedCard.card, G, focusedCard.owner) ?? '—'}
                        </span>
                      </span>
                      <span className="col-span-2">
                        {t('board.hpChange.effectiveAttack' as never)}{' '}
                        <span
                          className={
                            isAttackPowerInsufficient(focusedCard.card, G, focusedCard.owner)
                              ? 'text-vermilion'
                              : 'text-[var(--teal)]'
                          }
                        >
                          {isAttackPowerInsufficient(focusedCard.card, G, focusedCard.owner)
                            ? t('board.hpChange.insufficientPower' as never)
                            : getEffectiveAttack(focusedCard.card, G, focusedCard.owner)}
                        </span>
                      </span>
                    </>
                  )}
                  <span>
                    ⚡→ STP <span className="text-gold">{cardDefinition(focusedCard.card)?.sendToPower ?? 0}</span>
                  </span>
                </div>
                {(getTranslatedEffect(cardDefinition(focusedCard.card)?.id ?? '', locale) ||
                  cardDefinition(focusedCard.card)?.effect) && (
                  <p className="mt-3 text-[11px] leading-relaxed text-bone/50">
                    {getTranslatedEffect(cardDefinition(focusedCard.card)?.id ?? '', locale) ??
                      cardDefinition(focusedCard.card)?.effect}
                  </p>
                )}
              </>
            ) : (
              <div className="aspect-[3/4] w-full rounded-xs bg-gradient-to-br from-vermilion/10 via-lacquer-deep to-lacquer ring-1 ring-bone/10" />
            )}
          </div>

          {/* Log — i18n 格式化 */}
          <div className="flex min-h-0 flex-1 flex-col rounded-sm bg-lacquer p-4 ring-1 ring-bone/10">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.3em] text-gold/70">Log</span>
              <span className="size-1.5 animate-pulse rounded-full bg-vermilion" />
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto font-mono text-[10px] leading-relaxed">
              {(G.actionLog ?? [])
                .slice(-20)
                .reverse()
                .map((entry) => {
                  const { segments, tone, breakdown } = formatLogEntry(entry, locale);
                  const toneClass =
                    tone === 'battle'
                      ? 'text-vermilion/80'
                      : tone === 'set'
                        ? 'text-gold/60'
                        : tone === 'effect'
                          ? 'text-bone/70'
                          : 'text-bone/40';
                  return (
                    <div key={entry.id}>
                      <p className={toneClass}>
                        <span className="text-bone/20">T{entry.turn}</span> {renderLogSegments(segments)}
                        {entry.hp && tone !== 'battle' && (
                          <span className="text-bone/25">
                            {' '}
                            [{entry.hp[0]}/{entry.hp[1]}]
                          </span>
                        )}
                        {typeof entry.chronosPosition === 'number' && (
                          <span className="text-bone/25"> ⏱{entry.chronosPosition}/12</span>
                        )}
                      </p>
                      {breakdown && <LogBreakdown breakdown={breakdown} />}
                    </div>
                  );
                })}
              {(!G.actionLog || G.actionLog.length === 0) && (
                <p className="text-bone/20">{t('board.waitingOpponent')}</p>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* 效果結算 — 居中覆蓋層 */}
      {(G.step === 'effectOrder' || G.pendingChoice) && (
        <div className="board-effect-overlay pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
          <div className="pointer-events-auto w-full max-w-md px-4">
            {G.pendingChoice ? (
              <PendingChoicePanel G={G} moves={moves} playerID={playerID} />
            ) : (
              <EffectOrderPanel G={G} moves={moves} playerID={playerID} />
            )}
          </div>
        </div>
      )}

      <FeedbackOverlay message={phaseMessage} />
      <GameNoticeOverlay G={G} me={meIndex} />
    </div>
  );
}

export function Board(props: Props) {
  const navigate = useNavigate();
  const matchStartedAt = useRef(Date.now());
  const me = Number(props.playerID ?? '0') as PlayerIndex;
  const previousStep = useRef(props.G.step);
  const setupFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [setupFeedback, setSetupFeedback] = useState<FeedbackMessage | null>(null);
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
      {props.G.step !== 'gameOver' && (
        <button
          className="fixed right-4 top-4 z-50 border border-bone/20 bg-lacquer-deep/90 px-3 py-1.5 text-[10px] uppercase tracking-[0.3em] text-bone/60 backdrop-blur transition hover:bg-bone/5 hover:text-bone"
          type="button"
          onClick={() => setShowExitConfirm(true)}
          aria-label={t('game.pause')}
        >
          {t('game.pause')}
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
    <MulliganScreen {...props} onMulliganFeedback={showMulliganFeedback} floating />
  ) : null;
  return renderWithSetupFeedback(
    <>
      <BattleBoard {...props} />
      {setupOverlay}
    </>,
  );
}
