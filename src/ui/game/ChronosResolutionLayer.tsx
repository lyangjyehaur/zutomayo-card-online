import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { normalizeChronosPosition } from '../../game/chronos';
import { getCardDef } from '../../game/cards/loader';
import { getLocalizedCardName } from '../../game/cards/i18n';
import type { ChronosContribution, GameNotice, GameState } from '../../game/types';
import { getLocale, t } from '../../i18n';
import { battleAssetUrl } from './battleAssets';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PositionedContribution {
  contribution: ChronosContribution;
  rect: Rect | null;
}

interface SlotPoint {
  left: number;
  top: number;
  size: number;
}

interface ChronosLayout {
  centerLeft: number;
  centerTop: number;
  bottom: number;
  slots: Record<number, SlotPoint>;
}

type SequencePhase = 'overview' | 'pop' | 'fly' | 'advance' | 'complete';

interface SequenceState {
  noticeId: number;
  currentIndex: number;
  phase: SequencePhase;
  medalPosition: number;
  runningTotal: number;
  completedCount: number;
}

type EffectSequencePhase = 'source' | 'flight' | 'move' | 'complete';

interface EffectSequenceState {
  noticeId: number;
  phase: EffectSequencePhase;
  medalPosition: number;
}

const POP_DURATION_MS = 380;
const FLY_DURATION_MS = 620;
const OVERVIEW_HOLD_MS = 900;
const MEDAL_STEP_MS = 160;
const ZERO_VALUE_PAUSE_MS = 300;
const BETWEEN_CARDS_MS = 220;
const FINAL_HOLD_MS = 1300;
const REDUCED_MOTION_HOLD_MS = 2800;
const RECENT_MOUNT_WINDOW_MS = 5000;
const EFFECT_SOURCE_HOLD_MS = 800;
const EFFECT_FLIGHT_MS = 560;
const EFFECT_MEDAL_STEP_MS = 175;
const EFFECT_SET_MOVE_MS = 500;
const EFFECT_FINAL_HOLD_MS = 1250;
const CHRONOS_MEDAL_ASSET = battleAssetUrl('/battle/medal.png');

function contributionLabel(contribution: ChronosContribution): string {
  const def = getCardDef(contribution.cardDefId);
  const cardName = def ? getLocalizedCardName(def, getLocale()) : contribution.cardDefId;
  const value = contribution.nullified
    ? `0 (${t('board.hpChange.nullified' as never)})`
    : `+${contribution.appliedValue}`;
  return `${cardName} · ${t('board.hpChange.clockContribution' as never)} ${value}`;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function captureChronosLayout(): ChronosLayout | null {
  const chronos = document.querySelector<HTMLElement>('.bf-main [data-anim-zone="chronos"]');
  if (!chronos) return null;
  const chronosRect = chronos.getBoundingClientRect();
  if (!chronosRect || chronosRect.width <= 0 || chronosRect.height <= 0) return null;

  const slots: Record<number, SlotPoint> = {};
  chronos.querySelectorAll<HTMLElement>('.chronosdial-slot[data-position]').forEach((slot) => {
    const position = Number(slot.dataset.position);
    const rect = slot.getBoundingClientRect();
    if (!Number.isInteger(position) || rect.width <= 0 || rect.height <= 0) return;
    slots[position] = {
      left: rect.left + rect.width / 2,
      top: rect.top + rect.height / 2,
      size: Math.max(rect.width, rect.height),
    };
  });

  return {
    centerLeft: chronosRect.left + chronosRect.width / 2,
    centerTop: chronosRect.top + chronosRect.height / 2,
    bottom: chronosRect.bottom,
    slots,
  };
}

function captureContributions(notice: GameNotice): PositionedContribution[] {
  return (notice.chronosContributions ?? []).map((contribution) => {
    const card = document.querySelector<HTMLElement>(
      `.bf-main [data-anim-card="${CSS.escape(contribution.cardInstanceId)}"]`,
    );
    const rect = card?.getBoundingClientRect();
    return {
      contribution,
      rect:
        rect && rect.width > 0 && rect.height > 0
          ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
          : null,
    };
  });
}

function captureEffectSource(notice: GameNotice): Rect | null {
  const instanceId = notice.chronosSourceCardInstanceId;
  if (!instanceId) return null;
  const card = document.querySelector<HTMLElement>(`.bf-main [data-anim-card="${CSS.escape(instanceId)}"]`);
  const rect = card?.getBoundingClientRect();
  return rect && rect.width > 0 && rect.height > 0
    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    : null;
}

export function ChronosResolutionLayer({
  G,
  notice,
  onResolved,
}: {
  G: GameState;
  notice?: GameNotice | null;
  onResolved?: (noticeId: number) => void;
}) {
  const controlled = notice !== undefined;
  const chronosNotices = useMemo(
    () => (G.recentGameNotices ?? []).filter((notice) => notice.kind === 'chronosChange'),
    [G.recentGameNotices],
  );
  const newestChronosNoticeId = chronosNotices.at(-1)?.id ?? 0;
  const lastSeenIdRef = useRef(0);
  const startedNoticeIdRef = useRef(0);
  const timersRef = useRef<number[]>([]);
  const [internalActive, setInternalActive] = useState<GameNotice | null>(null);
  const active = controlled ? (notice ?? null) : internalActive;
  const [queue, setQueue] = useState<GameNotice[]>([]);
  const [positions, setPositions] = useState<PositionedContribution[]>([]);
  const [effectSourceRect, setEffectSourceRect] = useState<Rect | null>(null);
  const [layout, setLayout] = useState<ChronosLayout | null>(null);
  const [sequence, setSequence] = useState<SequenceState>({
    noticeId: 0,
    currentIndex: -1,
    phase: 'complete',
    medalPosition: 0,
    runningTotal: 0,
    completedCount: 0,
  });
  const [effectSequence, setEffectSequence] = useState<EffectSequenceState>({
    noticeId: 0,
    phase: 'complete',
    medalPosition: 0,
  });

  useEffect(() => {
    if (controlled) return;
    const unseen = chronosNotices.filter((notice) => notice.id > lastSeenIdRef.current).sort((a, b) => a.id - b.id);
    if (unseen.length === 0) return;
    lastSeenIdRef.current = unseen.at(-1)?.id ?? lastSeenIdRef.current;
    const recent = unseen.filter((notice) => Date.now() - notice.timestamp <= RECENT_MOUNT_WINDOW_MS);
    if (recent.length === 0) return;
    setQueue((current) => {
      const knownIds = new Set(current.map((notice) => notice.id));
      return [...current, ...recent.filter((notice) => !knownIds.has(notice.id))];
    });
  }, [chronosNotices, controlled, newestChronosNoticeId]);

  useEffect(() => {
    if (controlled || internalActive || queue.length === 0) return;
    setInternalActive(queue[0]);
    setQueue((current) => current.slice(1));
  }, [controlled, internalActive, queue]);

  const finishActive = useCallback(() => {
    if (!active) return;
    if (controlled) onResolved?.(active.id);
    else setInternalActive(null);
  }, [active, controlled, onResolved]);

  useLayoutEffect(() => {
    if (!active) {
      setPositions([]);
      setEffectSourceRect(null);
      setLayout(null);
      return;
    }

    const updateLayout = () => {
      setLayout(captureChronosLayout());
      setPositions(captureContributions(active));
      setEffectSourceRect(captureEffectSource(active));
    };

    const frame = requestAnimationFrame(updateLayout);
    window.addEventListener('resize', updateLayout);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateLayout);
    };
  }, [active]);

  useEffect(() => {
    if (!active && queue.length === 0) {
      delete document.documentElement.dataset.chronosResolving;
      startedNoticeIdRef.current = 0;
      return;
    }
    document.documentElement.dataset.chronosResolving = 'true';
    return () => {
      delete document.documentElement.dataset.chronosResolving;
    };
  }, [active, queue.length]);

  const layoutReady = Boolean(layout);
  useEffect(() => {
    if (!active || !layoutReady || startedNoticeIdRef.current === active.id) return;
    startedNoticeIdRef.current = active.id;

    const contributions = active.chronosContributions ?? [];
    const total = active.chronosAdvanceAmount ?? contributions.reduce((sum, item) => sum + item.appliedValue, 0);
    const startPosition = normalizeChronosPosition(active.chronosFrom ?? G.chronos.position - total);
    const finalPosition = normalizeChronosPosition(active.chronosTo ?? G.chronos.position);

    const schedule = (delay: number, callback: () => void) => {
      const timer = window.setTimeout(callback, delay);
      timersRef.current.push(timer);
    };

    if (active.chronosSourceKind === 'cardEffect') {
      const mode = active.chronosEffectMode ?? ((active.chronosDelta ?? 0) < 0 ? 'rewind' : 'advance');
      const moveAmount =
        active.chronosMoveAmount ??
        (mode === 'set'
          ? 0
          : mode === 'rewind'
            ? normalizeChronosPosition(startPosition - finalPosition)
            : normalizeChronosPosition(finalPosition - startPosition));

      if (prefersReducedMotion()) {
        setEffectSequence({
          noticeId: active.id,
          phase: 'complete',
          medalPosition: finalPosition,
        });
        schedule(REDUCED_MOTION_HOLD_MS, finishActive);
        return () => {
          for (const timer of timersRef.current) window.clearTimeout(timer);
          timersRef.current = [];
        };
      }

      setEffectSequence({
        noticeId: active.id,
        phase: 'source',
        medalPosition: startPosition,
      });
      schedule(EFFECT_SOURCE_HOLD_MS, () => {
        setEffectSequence((current) => ({ ...current, phase: 'flight' }));
      });

      const moveStart = EFFECT_SOURCE_HOLD_MS + EFFECT_FLIGHT_MS;
      schedule(moveStart, () => {
        setEffectSequence((current) => ({
          ...current,
          phase: 'move',
          ...(mode === 'set' ? { medalPosition: finalPosition } : {}),
        }));
      });

      let moveDuration = EFFECT_SET_MOVE_MS;
      if (mode !== 'set') {
        const direction = mode === 'rewind' ? -1 : 1;
        for (let step = 1; step <= moveAmount; step++) {
          const stepPosition = normalizeChronosPosition(startPosition + direction * step);
          schedule(moveStart + step * EFFECT_MEDAL_STEP_MS, () => {
            setEffectSequence((current) => ({ ...current, medalPosition: stepPosition }));
          });
        }
        moveDuration = Math.max(EFFECT_MEDAL_STEP_MS, moveAmount * EFFECT_MEDAL_STEP_MS);
      }

      const completeAt = moveStart + moveDuration;
      schedule(completeAt, () => {
        setEffectSequence({
          noticeId: active.id,
          phase: 'complete',
          medalPosition: finalPosition,
        });
      });
      schedule(completeAt + EFFECT_FINAL_HOLD_MS, finishActive);

      return () => {
        for (const timer of timersRef.current) window.clearTimeout(timer);
        timersRef.current = [];
      };
    }

    if (prefersReducedMotion() || contributions.length === 0) {
      setSequence({
        noticeId: active.id,
        currentIndex: -1,
        phase: 'complete',
        medalPosition: finalPosition,
        runningTotal: total,
        completedCount: contributions.length,
      });
      schedule(REDUCED_MOTION_HOLD_MS, finishActive);
      return () => {
        for (const timer of timersRef.current) window.clearTimeout(timer);
        timersRef.current = [];
      };
    }

    setSequence({
      noticeId: active.id,
      currentIndex: -1,
      phase: 'overview',
      medalPosition: startPosition,
      runningTotal: 0,
      completedCount: 0,
    });

    let cursor = OVERVIEW_HOLD_MS;
    let medalPosition = startPosition;
    let runningTotal = 0;

    contributions.forEach((contribution, index) => {
      const indexStart = cursor;
      const startMedalPosition = medalPosition;
      const startRunningTotal = runningTotal;
      schedule(indexStart, () => {
        setSequence({
          noticeId: active.id,
          currentIndex: index,
          phase: 'pop',
          medalPosition: startMedalPosition,
          runningTotal: startRunningTotal,
          completedCount: index,
        });
      });
      schedule(indexStart + POP_DURATION_MS, () => {
        setSequence((current) => ({ ...current, phase: 'fly' }));
      });

      const advanceStart = indexStart + POP_DURATION_MS + FLY_DURATION_MS;
      schedule(advanceStart, () => {
        setSequence((current) => ({ ...current, phase: 'advance' }));
      });

      const steps = Math.max(0, contribution.appliedValue);
      for (let step = 1; step <= steps; step++) {
        medalPosition = normalizeChronosPosition(medalPosition + 1);
        const stepPosition = medalPosition;
        schedule(advanceStart + step * MEDAL_STEP_MS, () => {
          setSequence((current) => ({ ...current, medalPosition: stepPosition }));
        });
      }

      const advanceDuration = steps > 0 ? steps * MEDAL_STEP_MS : ZERO_VALUE_PAUSE_MS;
      cursor = advanceStart + advanceDuration;
      runningTotal += contribution.appliedValue;
      const completedTotal = runningTotal;
      schedule(cursor, () => {
        setSequence((current) => ({
          ...current,
          runningTotal: completedTotal,
          completedCount: index + 1,
        }));
      });
      cursor += BETWEEN_CARDS_MS;
    });

    schedule(cursor, () => {
      setSequence({
        noticeId: active.id,
        currentIndex: -1,
        phase: 'complete',
        medalPosition: finalPosition,
        runningTotal: total,
        completedCount: contributions.length,
      });
    });
    schedule(cursor + FINAL_HOLD_MS, finishActive);

    return () => {
      for (const timer of timersRef.current) window.clearTimeout(timer);
      timersRef.current = [];
    };
  }, [active, finishActive, G.chronos.position, layoutReady]);

  const total =
    active?.chronosAdvanceAmount ??
    active?.chronosContributions?.reduce((sum, item) => sum + item.appliedValue, 0) ??
    0;
  const equation = useMemo(
    () => (active?.chronosContributions ?? []).map((item) => item.appliedValue).join(' + '),
    [active],
  );
  const completedEquation = useMemo(
    () =>
      (active?.chronosContributions ?? [])
        .slice(0, sequence.completedCount)
        .map((item) => item.appliedValue)
        .join(' + '),
    [active, sequence.completedCount],
  );

  if (!active || !layout) return null;
  const isCardEffect = active.chronosSourceKind === 'cardEffect';
  if (isCardEffect ? effectSequence.noticeId !== active.id : sequence.noticeId !== active.id) return null;

  if (isCardEffect) {
    const mode = active.chronosEffectMode ?? ((active.chronosDelta ?? 0) < 0 ? 'rewind' : 'advance');
    const startPosition = normalizeChronosPosition(active.chronosFrom ?? G.chronos.position);
    const finalPosition = normalizeChronosPosition(active.chronosTo ?? G.chronos.position);
    const moveAmount =
      active.chronosMoveAmount ??
      (mode === 'set'
        ? 0
        : mode === 'rewind'
          ? normalizeChronosPosition(startPosition - finalPosition)
          : normalizeChronosPosition(finalPosition - startPosition));
    const actionLabel =
      mode === 'set'
        ? t('board.chronosResolution.setPosition' as never)
        : mode === 'rewind'
          ? `${t('board.chronosResolution.rewind' as never)} ${moveAmount} ${t('board.chronosResolution.spaces' as never)}`
          : `${t('board.chronosResolution.advance' as never)} ${moveAmount} ${t('board.chronosResolution.spaces' as never)}`;
    const token = mode === 'set' ? '◎' : `${mode === 'rewind' ? '−' : '+'}${moveAmount}`;
    const sourceDef = active.chronosSourceCardDefId ? getCardDef(active.chronosSourceCardDefId) : undefined;
    const sourceName = sourceDef ? getLocalizedCardName(sourceDef, getLocale()) : '';
    const sourceLeft = effectSourceRect ? effectSourceRect.left + effectSourceRect.width / 2 : layout.centerLeft;
    const sourceTop = effectSourceRect ? effectSourceRect.top + effectSourceRect.height / 2 : layout.centerTop;
    const placement = effectSourceRect && effectSourceRect.top < layout.centerTop ? 'below' : 'above';
    const targetPoint = layout.slots[finalPosition] ?? {
      left: layout.centerLeft,
      top: layout.centerTop,
      size: 24,
    };
    const medalPoint = layout.slots[effectSequence.medalPosition] ?? targetPoint;
    const effectMedalStyle = {
      left: medalPoint.left,
      top: medalPoint.top,
      width: medalPoint.size * 1.46,
    } satisfies CSSProperties;
    const effectFlightStyle = {
      left: sourceLeft,
      top: sourceTop,
      '--chronos-flight-x': `${layout.centerLeft - sourceLeft}px`,
      '--chronos-flight-y': `${layout.centerTop - sourceTop}px`,
      '--chronos-flight-duration': `${EFFECT_FLIGHT_MS}ms`,
    } as CSSProperties;

    return (
      <div
        className="chronos-resolution-layer chronos-effect-resolution"
        role="status"
        aria-live="polite"
        data-mode={mode}
        data-phase={effectSequence.phase}
        data-notice-id={active.id}
      >
        <span className="sr-only">
          {sourceName ? `${sourceName} · ` : ''}
          {actionLabel}
        </span>

        {effectSourceRect && effectSequence.phase !== 'move' && effectSequence.phase !== 'complete' && (
          <span
            className="chronos-sequence-card-highlight chronos-effect-card-highlight"
            style={{
              left: effectSourceRect.left,
              top: effectSourceRect.top,
              width: effectSourceRect.width,
              height: effectSourceRect.height,
            }}
          />
        )}

        {effectSourceRect && effectSequence.phase === 'source' && (
          <span
            className="chronos-effect-bubble"
            data-mode={mode}
            data-placement={placement}
            style={{
              left: sourceLeft,
              top:
                placement === 'below' ? effectSourceRect.top + effectSourceRect.height + 7 : effectSourceRect.top - 7,
            }}
          >
            <strong>{token}</strong>
            <span>{actionLabel}</span>
          </span>
        )}

        {effectSequence.phase === 'flight' && (
          <span
            className="chronos-flight-value chronos-flight-value-fly chronos-effect-flight"
            data-mode={mode}
            style={effectFlightStyle}
          >
            {token}
          </span>
        )}

        {mode === 'set' && (effectSequence.phase === 'flight' || effectSequence.phase === 'move') && (
          <span
            className="chronos-effect-target"
            style={{
              left: targetPoint.left,
              top: targetPoint.top,
              width: targetPoint.size * 1.9,
              height: targetPoint.size * 1.9,
            }}
          />
        )}

        <span
          className="chronos-sequence-medal chronos-effect-medal"
          data-effect-mode={mode}
          data-moving={effectSequence.phase === 'move' || undefined}
          data-position={effectSequence.medalPosition}
          style={effectMedalStyle}
          aria-hidden="true"
        >
          <span className="chronos-sequence-medal-pulse" key={effectSequence.medalPosition} />
          <img src={CHRONOS_MEDAL_ASSET} alt="" draggable={false} />
        </span>

        {(effectSequence.phase === 'move' || effectSequence.phase === 'complete') && (
          <span
            className="chronos-sequence-total chronos-effect-summary"
            data-complete={effectSequence.phase === 'complete' || undefined}
            data-mode={mode}
            style={{ left: layout.centerLeft, top: layout.bottom + 4 }}
            aria-hidden="true"
          >
            {sourceName ? `${sourceName} · ` : ''}
            {actionLabel}
          </span>
        )}
      </div>
    );
  }

  const current = sequence.currentIndex >= 0 ? positions[sequence.currentIndex] : undefined;
  const currentRect = current?.rect;
  const flightLeft = currentRect ? currentRect.left + currentRect.width / 2 : layout.centerLeft;
  const flightTop = currentRect ? currentRect.top + currentRect.height / 2 : layout.centerTop;
  const medalPoint = layout.slots[sequence.medalPosition] ?? {
    left: layout.centerLeft,
    top: layout.centerTop,
    size: 24,
  };
  const flightStyle = {
    left: flightLeft,
    top: flightTop,
    '--chronos-flight-x': `${layout.centerLeft - flightLeft}px`,
    '--chronos-flight-y': `${layout.centerTop - flightTop}px`,
    '--chronos-pop-duration': `${POP_DURATION_MS}ms`,
    '--chronos-flight-duration': `${FLY_DURATION_MS}ms`,
  } as CSSProperties;
  const medalStyle = {
    left: medalPoint.left,
    top: medalPoint.top,
    width: medalPoint.size * 1.46,
  } satisfies CSSProperties;
  const totalStyle = {
    left: layout.centerLeft,
    top: layout.bottom + 4,
  } satisfies CSSProperties;

  return (
    <div
      className="chronos-resolution-layer"
      role="status"
      aria-live="polite"
      data-phase={sequence.phase}
      data-notice-id={active.id}
    >
      <span className="sr-only">
        {(active.chronosContributions ?? []).map(contributionLabel).join(' · ')} ·{' '}
        {t('board.chronosResolution.advance' as never)} {total} {t('board.chronosResolution.spaces' as never)}
      </span>

      {sequence.phase !== 'complete' &&
        positions.map(({ contribution, rect }, index) => {
          if (!rect || index < sequence.completedCount) return null;
          const placement = rect.top < layout.centerTop ? 'below' : 'above';
          const isActive = index === sequence.currentIndex;
          const isInTransit = isActive && sequence.phase !== 'pop';
          return (
            <span
              className="chronos-contribution-bubble"
              data-active={isActive || undefined}
              data-hidden={isInTransit || undefined}
              data-nullified={contribution.nullified || undefined}
              data-placement={placement}
              key={contribution.cardInstanceId}
              style={{
                left: rect.left + rect.width / 2,
                top: placement === 'below' ? rect.top + rect.height + 7 : rect.top - 7,
              }}
            >
              {t('card.clock' as never)} +{contribution.appliedValue}
            </span>
          );
        })}

      {currentRect && sequence.phase !== 'complete' && (
        <span
          className="chronos-sequence-card-highlight"
          data-nullified={current?.contribution.nullified || undefined}
          style={{
            left: currentRect.left,
            top: currentRect.top,
            width: currentRect.width,
            height: currentRect.height,
          }}
        />
      )}

      {current && sequence.phase !== 'complete' && sequence.phase !== 'advance' && (
        <span
          className={`chronos-flight-value chronos-flight-value-${sequence.phase}`}
          data-nullified={current.contribution.nullified || undefined}
          key={`${active.id}-${sequence.currentIndex}-${sequence.phase}`}
          style={flightStyle}
        >
          +{current.contribution.appliedValue}
        </span>
      )}

      <span
        className="chronos-sequence-medal"
        data-advancing={sequence.phase === 'advance' || undefined}
        data-position={sequence.medalPosition}
        style={medalStyle}
        aria-hidden="true"
      >
        <span className="chronos-sequence-medal-pulse" key={sequence.medalPosition} />
        <img src={CHRONOS_MEDAL_ASSET} alt="" draggable={false} />
      </span>

      {(sequence.phase === 'complete' || sequence.completedCount > 0) && (
        <span
          className="chronos-sequence-total"
          data-complete={sequence.phase === 'complete' || undefined}
          style={totalStyle}
          aria-hidden="true"
        >
          {sequence.phase === 'complete' ? (
            <>
              {equation || '0'} = {total} · {t('board.chronosResolution.advance' as never)} {total}{' '}
              {t('board.chronosResolution.spaces' as never)}
            </>
          ) : sequence.completedCount === 1 ? (
            <>
              {t('board.chronosResolution.total' as never)} {sequence.runningTotal}
            </>
          ) : (
            <>
              {t('board.chronosResolution.total' as never)} {completedEquation || '0'} = {sequence.runningTotal}
            </>
          )}
        </span>
      )}
    </div>
  );
}
