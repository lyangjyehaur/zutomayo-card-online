import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Crosshair, HeartPulse } from 'lucide-react';
import { getCardDef } from '../../game/cards/loader';
import { getLocalizedCardName } from '../../game/cards/i18n';
import type { GameNotice, GameState, PlayerIndex } from '../../game/types';
import { getLocale, t } from '../../i18n';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface EffectHpLayout {
  sourceRect: Rect | null;
  statusRect: Rect;
  hpBarRect: Rect;
  hpReadoutRect: Rect;
  hpReadoutColor: string | null;
}

type EffectHpPhase = 'source' | 'equation' | 'apply';

export interface EffectHpChangeView {
  player: PlayerIndex;
  delta: number;
  amount: number;
  hpBefore: number;
  hpAfter: number;
  healing: boolean;
  equation: string;
  title: string;
  sourceName?: string;
}

const SOURCE_HOLD_MS = 800;
const EQUATION_HOLD_MS = 1050;
const APPLY_HOLD_MS = 1500;
const REDUCED_MOTION_HOLD_MS = 1800;
const LAYOUT_CAPTURE_TIMEOUT_MS = 1000;

function rectOf(element: Element | null): Rect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function visibleSourceCard(notice: GameNotice): HTMLElement | null {
  const cards = [...document.querySelectorAll<HTMLElement>('.bf-main [data-anim-card]')];
  if (notice.sourceCardInstanceId) {
    const exact = cards.find((card) => card.dataset.animCard === notice.sourceCardInstanceId);
    if (exact) return exact;
  }
  if (!notice.sourceCardDefId) return null;
  return cards.find((card) => card.dataset.tutCard === notice.sourceCardDefId) ?? null;
}

function captureLayout(notice: GameNotice): EffectHpLayout | null {
  if (notice.player !== 0 && notice.player !== 1) return null;
  const status = document.querySelector<HTMLElement>(`.bf-main [data-anim-zone="p${notice.player}:status"]`);
  const hpBar = status?.querySelector<HTMLElement>('.playerstatus-bar') ?? null;
  const hpReadout = status?.querySelector<HTMLElement>('.playerstatus-hp-readout') ?? null;
  const statusRect = rectOf(status);
  const hpBarRect = rectOf(hpBar);
  const hpReadoutRect = rectOf(hpReadout);
  if (!statusRect || !hpBarRect || !hpReadoutRect) return null;
  return {
    sourceRect: rectOf(visibleSourceCard(notice)),
    statusRect,
    hpBarRect,
    hpReadoutRect,
    hpReadoutColor: hpReadout ? getComputedStyle(hpReadout).color : null,
  };
}

function fixedRectStyle(rect: Rect): CSSProperties {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function hpLevel(hp: number): 'healthy' | 'warning' | 'danger' {
  if (hp <= 25) return 'danger';
  if (hp <= 50) return 'warning';
  return 'healthy';
}

export function effectHpChangeView(notice: GameNotice, currentHp?: number): EffectHpChangeView | null {
  if (
    notice.kind !== 'hpChange' ||
    notice.reason === 'battle' ||
    (notice.player !== 0 && notice.player !== 1) ||
    typeof notice.delta !== 'number'
  ) {
    return null;
  }
  const hpAfter = notice.hpAfter ?? currentHp;
  if (typeof hpAfter !== 'number') return null;
  const hpBefore = notice.hpBefore ?? hpAfter - notice.delta;
  const healing = notice.delta > 0;
  const amount = Math.abs(notice.delta);
  const operator = healing ? '+' : '−';
  const sourceDef = notice.sourceCardDefId ? getCardDef(notice.sourceCardDefId) : undefined;
  return {
    player: notice.player,
    delta: notice.delta,
    amount,
    hpBefore,
    hpAfter,
    healing,
    equation: `${hpBefore} ${operator} ${amount} = ${hpAfter}`,
    title: t(notice.titleKey as never),
    ...(sourceDef ? { sourceName: getLocalizedCardName(sourceDef, getLocale()) } : {}),
  };
}

export function EffectHpResolutionLayer({
  G,
  notice,
  onResolved,
  onAnimatingChange,
}: {
  G: GameState;
  notice: GameNotice | null;
  onResolved?: (noticeId: number) => void;
  onAnimatingChange?: (active: boolean) => void;
}) {
  const timersRef = useRef<number[]>([]);
  const startedNoticeIdRef = useRef(0);
  const [layout, setLayout] = useState<EffectHpLayout | null>(null);
  const [sequence, setSequence] = useState<{ noticeId: number; phase: EffectHpPhase }>({
    noticeId: 0,
    phase: 'source',
  });
  const [displayedHp, setDisplayedHp] = useState<number | null>(null);
  const currentHp = notice?.player === 0 || notice?.player === 1 ? G.players[notice.player].hp : undefined;
  const view = useMemo(() => (notice ? effectHpChangeView(notice, currentHp) : null), [currentHp, notice]);

  useEffect(() => {
    if (notice && !view) onResolved?.(notice.id);
  }, [notice, onResolved, view]);

  useEffect(() => {
    onAnimatingChange?.(Boolean(notice && view));
  }, [notice, onAnimatingChange, view]);

  useLayoutEffect(() => {
    if (!notice) {
      setLayout(null);
      return;
    }
    const updateLayout = () => setLayout(captureLayout(notice));
    updateLayout();
    window.addEventListener('resize', updateLayout);
    return () => {
      window.removeEventListener('resize', updateLayout);
    };
  }, [notice]);

  const finish = useCallback(() => {
    if (notice) onResolved?.(notice.id);
  }, [notice, onResolved]);

  useEffect(() => {
    if (!notice || !view || layout) return;
    const timer = window.setTimeout(finish, LAYOUT_CAPTURE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [finish, layout, notice, view]);

  useEffect(() => {
    if (!notice || !view || !layout || startedNoticeIdRef.current === notice.id) return;
    startedNoticeIdRef.current = notice.id;
    const schedule = (delay: number, callback: () => void) => {
      const timer = window.setTimeout(callback, delay);
      timersRef.current.push(timer);
    };

    setSequence({ noticeId: notice.id, phase: 'source' });
    if (prefersReducedMotion()) {
      setSequence({ noticeId: notice.id, phase: 'apply' });
      schedule(REDUCED_MOTION_HOLD_MS, finish);
    } else {
      schedule(SOURCE_HOLD_MS, () => setSequence({ noticeId: notice.id, phase: 'equation' }));
      schedule(SOURCE_HOLD_MS + EQUATION_HOLD_MS, () => setSequence({ noticeId: notice.id, phase: 'apply' }));
      schedule(SOURCE_HOLD_MS + EQUATION_HOLD_MS + APPLY_HOLD_MS, finish);
    }

    return () => {
      for (const timer of timersRef.current) window.clearTimeout(timer);
      timersRef.current = [];
    };
  }, [finish, layout, notice, view]);

  useEffect(() => {
    if (!notice || !layout || !view) return;
    const status = document.querySelector<HTMLElement>(`.bf-main [data-anim-zone="p${view.player}:status"]`);
    if (!status) return;
    status.dataset.effectHpOverlay = 'true';
    return () => {
      delete status.dataset.effectHpOverlay;
    };
  }, [layout, notice, view]);

  useEffect(() => {
    if (!notice || !view || sequence.noticeId !== notice.id || sequence.phase !== 'apply') {
      setDisplayedHp(view?.hpBefore ?? null);
      return;
    }
    if (prefersReducedMotion() || view.hpBefore === view.hpAfter) {
      setDisplayedHp(view.hpAfter);
      return;
    }
    setDisplayedHp(view.hpBefore);
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 760);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayedHp(Math.round(view.hpBefore + (view.hpAfter - view.hpBefore) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [notice, sequence, view]);

  if (!notice || !view || !layout || displayedHp === null || sequence.noticeId !== notice.id) return null;

  const placement = layout.statusRect.top < window.innerHeight / 2 ? 'below' : 'above';
  const summaryTop =
    placement === 'below' ? layout.statusRect.top + layout.statusRect.height + 9 : layout.statusRect.top - 9;
  const sourceLink = (() => {
    if (!layout.sourceRect) return null;
    const startLeft = layout.sourceRect.left + layout.sourceRect.width / 2;
    const startTop = layout.sourceRect.top + layout.sourceRect.height / 2;
    const endLeft = layout.statusRect.left + layout.statusRect.width / 2;
    const endTop = layout.statusRect.top + layout.statusRect.height / 2;
    return {
      left: startLeft,
      top: startTop,
      width: Math.hypot(endLeft - startLeft, endTop - startTop),
      transform: `rotate(${Math.atan2(endTop - startTop, endLeft - startLeft)}rad)`,
    } satisfies CSSProperties;
  })();
  const applying = sequence.phase === 'apply';
  const deltaStart = Math.min(view.hpBefore, view.hpAfter);
  const deltaWidth = Math.abs(view.hpAfter - view.hpBefore);
  const ChangeIcon = view.healing ? HeartPulse : Crosshair;

  return (
    <div
      className="effect-hp-resolution-layer"
      role="status"
      aria-live="polite"
      data-phase={sequence.phase}
      data-healing={view.healing || undefined}
    >
      <span className="sr-only">
        {view.sourceName ? `${view.sourceName} · ` : ''}
        {view.title} · {view.equation}
      </span>

      {sequence.phase === 'source' && layout.sourceRect && (
        <span className="effect-hp-resolution-source" style={fixedRectStyle(layout.sourceRect)}>
          <ChangeIcon aria-hidden="true" />
        </span>
      )}
      {sequence.phase === 'source' && sourceLink && (
        <span className="effect-hp-resolution-link" style={sourceLink}>
          <span />
        </span>
      )}

      {sequence.phase !== 'source' && (
        <span
          className="effect-hp-resolution-summary"
          data-placement={placement}
          style={{ left: layout.statusRect.left + layout.statusRect.width / 2, top: summaryTop }}
        >
          <ChangeIcon aria-hidden="true" />
          <span>{view.sourceName ?? view.title}</span>
          <strong>{view.equation}</strong>
          {view.sourceName && <em>{view.title}</em>}
        </span>
      )}

      <span
        className="effect-hp-resolution-hp-readout"
        data-healing={view.healing || undefined}
        data-applying={applying || undefined}
        data-hp={hpLevel(displayedHp)}
        style={{
          left: layout.hpReadoutRect.left - 14,
          top: layout.hpReadoutRect.top,
          width: layout.hpReadoutRect.width + 14,
          height: layout.hpReadoutRect.height,
          color: layout.hpReadoutColor ?? undefined,
        }}
      >
        {applying && (
          <span className="effect-hp-resolution-delta">
            {view.healing ? '+' : '−'}
            {view.amount}
          </span>
        )}
        <span>{t('board.hp')}</span>
        <strong>{displayedHp}</strong>
        <span>/100</span>
      </span>

      <span
        className="effect-hp-resolution-hp-bar"
        data-healing={view.healing || undefined}
        data-hp={hpLevel(displayedHp)}
        style={fixedRectStyle(layout.hpBarRect)}
      >
        <span className="effect-hp-resolution-hp-fill" style={{ width: `${displayedHp}%` }} />
        {applying && deltaWidth > 0 && (
          <span className="effect-hp-resolution-hp-delta" style={{ left: `${deltaStart}%`, width: `${deltaWidth}%` }} />
        )}
        <span className="effect-hp-resolution-hp-ticks" />
      </span>

      {applying && <span className="effect-hp-resolution-status" style={fixedRectStyle(layout.statusRect)} />}
    </div>
  );
}
