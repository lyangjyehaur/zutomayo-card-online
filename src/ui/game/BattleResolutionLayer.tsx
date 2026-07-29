import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ShieldCheck } from 'lucide-react';
import { getCardDef } from '../../game/cards/loader';
import { getLocalizedCardName } from '../../game/cards/i18n';
import type { AttackModifierSource, DamageReductionSource, GameNotice, GameState, PlayerIndex } from '../../game/types';
import { getLocale, t } from '../../i18n';
import { CardView } from './CardView';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface BattleLayout {
  centerLeft: number;
  centerTop: number;
  attackRects: Record<PlayerIndex, Rect | null>;
  cardRects: Record<PlayerIndex, Rect | null>;
  statusRects: Record<PlayerIndex, Rect | null>;
  hpBarRects: Record<PlayerIndex, Rect | null>;
  hpReadoutRects: Record<PlayerIndex, Rect | null>;
  hpReadoutColors: Record<PlayerIndex, string | null>;
  cardInstanceRects: Record<string, Rect>;
}

type BattlePhase = 'compare' | 'equation' | 'strike' | 'damage';

interface BattleSequence {
  noticeId: number;
  phase: BattlePhase;
}

interface BattleResultView {
  winner: PlayerIndex | null;
  loser: PlayerIndex | null;
  noAttack: boolean;
  attacks: Record<PlayerIndex, number>;
  baseAttacks: Record<PlayerIndex, number>;
  attackAdjustments: Record<PlayerIndex, number>;
  attackSources: Record<PlayerIndex, AttackModifierSource[]>;
  insufficient: Record<PlayerIndex, boolean>;
  rawDamage: number;
  finalDamage: number;
  hpLoss: number;
  reduction: number;
  reductionSources: DamageReductionSource[];
  hpBefore: number | null;
  hpAfter: number | null;
  title: string;
}

const RECENT_MOUNT_WINDOW_MS = 5000;
const CHRONOS_START_GRACE_MS = 180;
const COMPARE_HOLD_MS = 900;
const EQUATION_HOLD_MS = 1200;
const STRIKE_HOLD_MS = 720;
const MITIGATED_STRIKE_HOLD_MS = 1200;
const DAMAGE_HOLD_MS = 1500;
const REDUCED_MOTION_HOLD_MS = 2400;
const LAYOUT_CAPTURE_TIMEOUT_MS = 1000;

function latestBattleNotice(G: GameState): GameNotice | null {
  const notices = G.recentGameNotices ?? [];
  for (let index = notices.length - 1; index >= 0; index--) {
    const notice = notices[index];
    if (notice.kind === 'hpChange' && notice.reason === 'battle') return notice;
    if (notice.kind === 'battleResult') return notice;
  }
  return null;
}

function rectOf(element: Element | null): Rect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function captureBattleLayout(): BattleLayout | null {
  const chronos = document.querySelector<HTMLElement>('.bf-main [data-anim-zone="chronos"]');
  const chronosRect = rectOf(chronos);
  if (!chronosRect) return null;

  const zone = (player: PlayerIndex) =>
    document.querySelector<HTMLElement>(`.bf-main [data-anim-zone="p${player}:battleZone"]`);
  const player0Zone = zone(0);
  const player1Zone = zone(1);
  const status = (player: PlayerIndex) =>
    document.querySelector<HTMLElement>(`.bf-main [data-anim-zone="p${player}:status"]`);
  const player0Status = status(0);
  const player1Status = status(1);
  const hpReadout = (element: HTMLElement | null) =>
    element?.querySelector<HTMLElement>('.playerstatus-hp-readout') ?? null;
  const player0HpReadout = hpReadout(player0Status);
  const player1HpReadout = hpReadout(player1Status);
  const cardInstanceRects: Record<string, Rect> = {};
  document.querySelectorAll<HTMLElement>('.bf-main [data-anim-card]').forEach((card) => {
    const instanceId = card.dataset.animCard;
    const rect = rectOf(card);
    if (instanceId && rect) cardInstanceRects[instanceId] = rect;
  });

  return {
    centerLeft: chronosRect.left + chronosRect.width / 2,
    centerTop: chronosRect.top + chronosRect.height / 2,
    attackRects: {
      0: rectOf(player0Zone?.querySelector('.battlezone-attack') ?? null),
      1: rectOf(player1Zone?.querySelector('.battlezone-attack') ?? null),
    },
    cardRects: {
      0: rectOf(player0Zone?.querySelector('[data-anim-card]') ?? null) ?? rectOf(player0Zone),
      1: rectOf(player1Zone?.querySelector('[data-anim-card]') ?? null) ?? rectOf(player1Zone),
    },
    statusRects: {
      0: rectOf(player0Status),
      1: rectOf(player1Status),
    },
    hpBarRects: {
      0: rectOf(player0Status?.querySelector('.playerstatus-bar') ?? null),
      1: rectOf(player1Status?.querySelector('.playerstatus-bar') ?? null),
    },
    hpReadoutRects: {
      0: rectOf(player0HpReadout),
      1: rectOf(player1HpReadout),
    },
    hpReadoutColors: {
      0: player0HpReadout ? getComputedStyle(player0HpReadout).color : null,
      1: player1HpReadout ? getComputedStyle(player1HpReadout).color : null,
    },
    cardInstanceRects,
  };
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function numericBreakdownValue(notice: GameNotice, label: string): number | null {
  const line = notice.breakdown?.lines.find((candidate) => candidate.label === label);
  if (!line) return null;
  const value = Number(line.value);
  return Number.isFinite(value) ? value : null;
}

function breakdownValue(notice: GameNotice, label: string): string | null {
  return notice.breakdown?.lines.find((candidate) => candidate.label === label)?.value ?? null;
}

function battleNoticeWinner(notice: GameNotice): PlayerIndex | null {
  if (notice.winner !== undefined) return notice.winner;
  return notice.kind === 'hpChange' && notice.player !== undefined ? ((1 - notice.player) as PlayerIndex) : null;
}

export function battleResultView(notice: GameNotice): BattleResultView {
  const winner = battleNoticeWinner(notice);
  const loser = winner === null ? null : ((1 - winner) as PlayerIndex);
  const winnerAttack = notice.winnerAttack ?? 0;
  const loserAttack = notice.loserAttack ?? 0;
  const attacks: Record<PlayerIndex, number> =
    winner === null
      ? { 0: winnerAttack, 1: loserAttack }
      : winner === 0
        ? { 0: winnerAttack, 1: loserAttack }
        : { 0: loserAttack, 1: winnerAttack };
  const baseAttacks = { ...attacks };
  const insufficient: Record<PlayerIndex, boolean> = { 0: false, 1: false };
  for (const player of [0, 1] as const) {
    const role = winner === null ? `p${player}` : player === winner ? 'winner' : 'loser';
    const rawLabel = `board.hpChange.${role}RawAttack`;
    const attackLabel = `board.hpChange.${role}Attack`;
    baseAttacks[player] = numericBreakdownValue(notice, rawLabel) ?? attacks[player];
    insufficient[player] = breakdownValue(notice, attackLabel) === 'board.hpChange.insufficientPower';
  }
  const attackAdjustments: Record<PlayerIndex, number> = {
    0: attacks[0] - baseAttacks[0],
    1: attacks[1] - baseAttacks[1],
  };
  const attackSources: Record<PlayerIndex, AttackModifierSource[]> = {
    0: (notice.attackModifierSources?.[0] ?? []).filter(
      (source) => source.kind !== 'set' || source.from === undefined || source.from !== source.setTo,
    ),
    1: (notice.attackModifierSources?.[1] ?? []).filter(
      (source) => source.kind !== 'set' || source.from === undefined || source.from !== source.setTo,
    ),
  };
  for (const player of [0, 1] as const) {
    const setSource = attackSources[player].find((source) => source.kind === 'set' && source.from !== undefined);
    if (setSource?.from !== undefined) baseAttacks[player] = setSource.from;
  }
  const rawDamage = winner === null ? 0 : Math.max(0, winnerAttack - loserAttack);
  const finalDamage = Math.max(0, notice.damage ?? (notice.kind === 'hpChange' ? Math.abs(notice.delta ?? 0) : 0));
  const reduction = Math.max(0, rawDamage - finalDamage);
  const hpAfter = loser === null ? null : (notice.hpAfter ?? null);
  const hpBefore = hpAfter === null ? null : (notice.hpBefore ?? Math.min(100, hpAfter + finalDamage));
  const hpLoss =
    hpBefore !== null && hpAfter !== null
      ? Math.max(0, hpBefore - hpAfter)
      : notice.kind === 'hpChange'
        ? Math.abs(notice.delta ?? 0)
        : finalDamage;
  const noAttack = winner === null && attacks[0] === 0 && attacks[1] === 0;
  const title = noAttack
    ? t('board.notice.battleNoAttack' as never)
    : winner === null
      ? t('board.notice.battleDraw' as never)
      : finalDamage === 0
        ? t('board.notice.battleNoDamage' as never)
        : t('board.hpChange.battle' as never);

  return {
    winner,
    loser,
    noAttack,
    attacks,
    baseAttacks,
    attackAdjustments,
    attackSources,
    insufficient,
    rawDamage,
    finalDamage,
    hpLoss,
    reduction,
    reductionSources: notice.damageReductionSources ?? [],
    hpBefore,
    hpAfter,
    title,
  };
}

function fixedRectStyle(rect: Rect): CSSProperties {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function hpLevel(hp: number): 'healthy' | 'warning' | 'danger' {
  if (hp <= 25) return 'danger';
  if (hp <= 50) return 'warning';
  return 'healthy';
}

export function BattleResolutionLayer({
  G,
  notice,
  onResolved,
  onAnimatingChange,
}: {
  G: GameState;
  notice?: GameNotice | null;
  onResolved?: (noticeId: number) => void;
  onAnimatingChange?: (active: boolean) => void;
}) {
  const controlled = notice !== undefined;
  const latest = latestBattleNotice(G);
  const latestId = latest?.id ?? 0;
  const lastSeenIdRef = useRef(0);
  const startedNoticeIdRef = useRef(0);
  const timersRef = useRef<number[]>([]);
  const observerRef = useRef<MutationObserver | null>(null);
  const [internalActive, setInternalActive] = useState<GameNotice | null>(null);
  const active = controlled ? (notice ?? null) : internalActive;
  const [layout, setLayout] = useState<BattleLayout | null>(null);
  const [sequence, setSequence] = useState<BattleSequence>({ noticeId: 0, phase: 'compare' });
  const [displayedHp, setDisplayedHp] = useState<number | null>(null);
  const [trailSettled, setTrailSettled] = useState(false);

  useEffect(() => {
    if (controlled) return;
    if (!latest || latestId <= lastSeenIdRef.current) return;
    lastSeenIdRef.current = latestId;
    if (Date.now() - latest.timestamp > RECENT_MOUNT_WINDOW_MS) return;
    setInternalActive(latest);
  }, [controlled, latest, latestId]);

  const finishActive = useCallback(() => {
    if (!active) return;
    if (controlled) onResolved?.(active.id);
    else setInternalActive(null);
  }, [active, controlled, onResolved]);

  useEffect(() => {
    onAnimatingChange?.(Boolean(active));
  }, [active, onAnimatingChange]);

  useLayoutEffect(() => {
    if (!active) {
      setLayout(null);
      return;
    }
    const updateLayout = () => setLayout(captureBattleLayout());
    const frame = requestAnimationFrame(updateLayout);
    window.addEventListener('resize', updateLayout);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateLayout);
    };
  }, [active]);

  const layoutReady = Boolean(layout);
  useEffect(() => {
    if (!active || layoutReady) return;
    const timer = window.setTimeout(finishActive, LAYOUT_CAPTURE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [active, finishActive, layoutReady]);

  useEffect(() => {
    if (!active || !layoutReady || startedNoticeIdRef.current === active.id) return;

    const schedule = (delay: number, callback: () => void) => {
      const timer = window.setTimeout(callback, delay);
      timersRef.current.push(timer);
    };

    const start = () => {
      if (startedNoticeIdRef.current === active.id) return;
      startedNoticeIdRef.current = active.id;
      const reduced = prefersReducedMotion();
      const winner = battleNoticeWinner(active);
      setSequence({ noticeId: active.id, phase: reduced && winner !== null ? 'damage' : 'compare' });

      if (reduced) {
        schedule(REDUCED_MOTION_HOLD_MS, finishActive);
        return;
      }

      schedule(COMPARE_HOLD_MS, () => setSequence({ noticeId: active.id, phase: 'equation' }));
      if (winner === null) {
        schedule(COMPARE_HOLD_MS + EQUATION_HOLD_MS, finishActive);
        return;
      }

      const strikeDuration = battleResultView(active).reduction > 0 ? MITIGATED_STRIKE_HOLD_MS : STRIKE_HOLD_MS;
      schedule(COMPARE_HOLD_MS + EQUATION_HOLD_MS, () => setSequence({ noticeId: active.id, phase: 'strike' }));
      schedule(COMPARE_HOLD_MS + EQUATION_HOLD_MS + strikeDuration, () =>
        setSequence({ noticeId: active.id, phase: 'damage' }),
      );
      schedule(COMPARE_HOLD_MS + EQUATION_HOLD_MS + strikeDuration + DAMAGE_HOLD_MS, finishActive);
    };

    if (controlled) {
      start();
      return () => {
        for (const timer of timersRef.current) window.clearTimeout(timer);
        timersRef.current = [];
      };
    }

    const graceTimer = window.setTimeout(() => {
      if (document.documentElement.dataset.chronosResolving !== 'true') {
        start();
        return;
      }
      const observer = new MutationObserver(() => {
        if (document.documentElement.dataset.chronosResolving === 'true') return;
        observer.disconnect();
        if (observerRef.current === observer) observerRef.current = null;
        start();
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-chronos-resolving'] });
      observerRef.current = observer;
    }, CHRONOS_START_GRACE_MS);
    timersRef.current.push(graceTimer);

    return () => {
      for (const timer of timersRef.current) window.clearTimeout(timer);
      timersRef.current = [];
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [active, controlled, finishActive, layoutReady]);

  const result = useMemo(() => (active ? battleResultView(active) : null), [active]);

  useEffect(() => {
    if (!active || !layout || !result || result.loser === null || result.hpBefore === null || result.hpAfter === null) {
      return;
    }
    const status = document.querySelector<HTMLElement>(`.bf-main [data-anim-zone="p${result.loser}:status"]`);
    if (!status) return;
    status.dataset.battleHpOverlay = 'true';
    return () => {
      delete status.dataset.battleHpOverlay;
    };
  }, [active, layout, result]);

  useEffect(() => {
    if (!active || !result || result.hpBefore === null || result.hpAfter === null) {
      setDisplayedHp(null);
      setTrailSettled(false);
      return;
    }
    if (sequence.noticeId !== active.id || sequence.phase !== 'damage') {
      setDisplayedHp(result.hpBefore);
      setTrailSettled(false);
      return;
    }
    if (prefersReducedMotion() || result.hpBefore === result.hpAfter) {
      setDisplayedHp(result.hpAfter);
      setTrailSettled(true);
      return;
    }

    setDisplayedHp(result.hpBefore);
    setTrailSettled(false);
    const start = performance.now();
    const duration = 620;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayedHp(Math.round(result.hpBefore! + (result.hpAfter! - result.hpBefore!) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const trailTimer = window.setTimeout(() => setTrailSettled(true), 260);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(trailTimer);
    };
  }, [active, result, sequence]);

  if (!active || !layout || !result || sequence.noticeId !== active.id) return null;

  const leftAttack = result.winner === null ? result.attacks[0] : result.attacks[result.winner];
  const rightAttack = result.loser === null ? result.attacks[1] : result.attacks[result.loser];
  const equation = `${leftAttack} ${result.winner === null ? '=' : '−'} ${rightAttack}${
    result.winner === null ? '' : ` = ${result.rawDamage}`
  }`;
  const winnerRect = result.winner === null ? null : layout.cardRects[result.winner];
  const loserRect = result.loser === null ? null : layout.cardRects[result.loser];
  const statusRect = result.loser === null ? null : layout.statusRects[result.loser];
  const hpBarRect = result.loser === null ? null : layout.hpBarRects[result.loser];
  const hpReadoutRect = result.loser === null ? null : layout.hpReadoutRects[result.loser];
  const hpReadoutColor = result.loser === null ? null : layout.hpReadoutColors[result.loser];
  const damagePlacement = statusRect && statusRect.top < layout.centerTop ? 'below' : 'above';
  const reductionSourceNames = [
    ...new Set(
      result.reductionSources.map((source) => {
        const def = getCardDef(source.cardDefId);
        return def ? getLocalizedCardName(def, getLocale()) : source.cardDefId;
      }),
    ),
  ];
  const reductionSourceRects = [
    ...new Map(
      result.reductionSources.flatMap((source) => {
        if (!source.cardInstanceId) return [];
        const rect = layout.cardInstanceRects[source.cardInstanceId];
        return rect ? [[source.cardInstanceId, rect] as const] : [];
      }),
    ).entries(),
  ];
  const mitigationLinkStyles = statusRect
    ? reductionSourceRects.map(([instanceId, rect]) => {
        const startLeft = rect.left + rect.width / 2;
        const startTop = rect.top + rect.height / 2;
        const endLeft = statusRect.left + statusRect.width / 2;
        const endTop = statusRect.top + statusRect.height / 2;
        const dx = endLeft - startLeft;
        const dy = endTop - startTop;
        return {
          instanceId,
          style: {
            left: startLeft,
            top: startTop,
            width: Math.hypot(dx, dy),
            transform: `rotate(${Math.atan2(dy, dx)}rad)`,
          } satisfies CSSProperties,
        };
      })
    : [];
  const strikeStartRect = result.winner === null ? null : (layout.attackRects[result.winner] ?? winnerRect);
  const strikeStyle = (() => {
    if (!strikeStartRect || !loserRect) return undefined;
    const startLeft = strikeStartRect.left + strikeStartRect.width / 2;
    const startTop = strikeStartRect.top + strikeStartRect.height / 2;
    const endLeft = loserRect.left + loserRect.width / 2;
    const endTop = loserRect.top + loserRect.height / 2;
    const dx = endLeft - startLeft;
    const dy = endTop - startTop;
    return {
      left: startLeft,
      top: startTop,
      width: Math.hypot(dx, dy),
      transform: `rotate(${Math.atan2(dy, dx)}rad)`,
    } satisfies CSSProperties;
  })();

  return (
    <div className="battle-resolution-layer" role="status" aria-live="polite" data-phase={sequence.phase}>
      <span className="sr-only">
        {t('board.notice.battle' as never)} · {equation}
        {result.reduction > 0 ? ` · ${t('board.hpChange.damageReduction' as never)} ${result.reduction}` : ''} ·{' '}
        {result.title}
      </span>

      {active.battleCards?.map((card, player) => {
        const playerIndex = player as PlayerIndex;
        const currentCard = G.players[playerIndex].battleZone;
        const rect = layout.cardRects[playerIndex];
        if (!card || !rect || currentCard?.instanceId === card.instanceId) return null;
        return (
          <div className="battle-resolution-card-snapshot" key={card.instanceId} style={fixedRectStyle(rect)}>
            <CardView card={card} size="md" />
          </div>
        );
      })}

      {([0, 1] as const).map((player) => {
        const rect = layout.attackRects[player];
        if (!rect || sequence.phase === 'strike' || sequence.phase === 'damage') return null;
        const finalSource = result.attackSources[player].at(-1);
        const finalSourceContainsResult =
          finalSource?.kind === 'set' && (finalSource.setTo ?? result.attacks[player]) === result.attacks[player];
        const hasCalculation =
          result.baseAttacks[player] !== result.attacks[player] || result.attackSources[player].length > 0;
        const focusWidth = hasCalculation ? Math.max(rect.width + 140, 200) : rect.width;
        const focusHeight = hasCalculation ? Math.max(rect.height + 26, 68) : rect.height;
        return (
          <span
            className="battle-resolution-attack-focus"
            data-calculation={hasCalculation || undefined}
            data-insufficient={result.insufficient[player] || undefined}
            data-winner={result.winner === player || undefined}
            key={player}
            style={{
              left: rect.left + rect.width / 2 - focusWidth / 2,
              top: rect.top + rect.height / 2 - focusHeight / 2,
              width: focusWidth,
              height: focusHeight,
            }}
          >
            {hasCalculation ? (
              <>
                <span className="battle-resolution-attack-calculation">
                  <small>{result.baseAttacks[player]}</small>
                  {!result.insufficient[player] && result.attackSources[player].length > 0
                    ? result.attackSources[player].map((source, index) => (
                        <em key={`${source.cardInstanceId ?? source.cardDefId ?? source.kind}-${index}`}>
                          {source.kind === 'set'
                            ? `=${source.setTo ?? result.attacks[player]}`
                            : `${source.kind === 'reduce' ? '−' : '+'}${Math.abs(source.amount)}`}
                        </em>
                      ))
                    : !result.insufficient[player] &&
                      result.attackAdjustments[player] !== 0 && (
                        <em>
                          {result.attackAdjustments[player] > 0 ? '+' : '−'}
                          {Math.abs(result.attackAdjustments[player])}
                        </em>
                      )}
                  {!finalSourceContainsResult && (
                    <>
                      <span>→</span>
                      <strong>{result.attacks[player]}</strong>
                    </>
                  )}
                </span>
                <span className="battle-resolution-attack-reason">
                  {result.insufficient[player]
                    ? t('board.hpChange.insufficientPower' as never)
                    : t('board.hpChange.effectiveAttack' as never)}
                </span>
                {result.attackSources[player].length > 0 && (
                  <span className="battle-resolution-attack-sources">
                    {result.attackSources[player].map((source, index) => {
                      const def = source.cardDefId ? getCardDef(source.cardDefId) : undefined;
                      const name = def ? getLocalizedCardName(def, getLocale()) : t('board.phaseEffectTitle' as never);
                      const value =
                        source.kind === 'set'
                          ? `=${source.setTo ?? result.attacks[player]}`
                          : `${source.kind === 'reduce' ? '−' : '+'}${Math.abs(source.amount)}`;
                      return (
                        <span key={`${source.cardInstanceId ?? source.cardDefId ?? source.kind}-${index}`}>
                          {name} {value}
                        </span>
                      );
                    })}
                  </span>
                )}
              </>
            ) : (
              <strong className="battle-resolution-attack-direct">{result.attacks[player]}</strong>
            )}
          </span>
        );
      })}

      {sequence.phase === 'equation' && (
        <span
          className="battle-resolution-equation"
          data-draw={result.winner === null || undefined}
          data-no-attack={result.noAttack || undefined}
          style={{ left: layout.centerLeft, top: layout.centerTop }}
        >
          <span>{t('board.attackLabel')}</span>
          <strong>{equation}</strong>
          {result.winner === null && <em>{result.title}</em>}
        </span>
      )}

      {sequence.phase === 'strike' && result.reduction > 0 && result.loser !== null && statusRect && (
        <>
          {reductionSourceRects.map(([instanceId, rect]) => (
            <span className="battle-resolution-reduction-source" key={instanceId} style={fixedRectStyle(rect)}>
              <ShieldCheck aria-hidden="true" />
            </span>
          ))}
          {mitigationLinkStyles.map(({ instanceId, style }) => (
            <span className="battle-resolution-mitigation-link" key={instanceId} style={style}>
              <span />
            </span>
          ))}
          <span
            className="battle-resolution-mitigation-summary"
            data-placement={damagePlacement}
            style={{
              left: statusRect.left + statusRect.width / 2,
              top: damagePlacement === 'below' ? statusRect.top + statusRect.height + 8 : statusRect.top - 8,
            }}
          >
            <ShieldCheck aria-hidden="true" />
            <span>
              {reductionSourceNames.length > 0
                ? reductionSourceNames.join(' · ')
                : t('board.hpChange.damageReduction' as never)}
            </span>
            <strong>
              {t('board.hpChange.damageReduction' as never)} {result.reduction}
            </strong>
          </span>
        </>
      )}

      {sequence.phase === 'strike' && loserRect && strikeStyle && (
        <>
          <span className="battle-resolution-strike-line" style={strikeStyle}>
            <span />
          </span>
          <span
            className="battle-resolution-impact"
            data-guard={result.finalDamage === 0 || undefined}
            style={fixedRectStyle(loserRect)}
          />
        </>
      )}

      {result.loser !== null &&
        result.hpBefore !== null &&
        result.hpAfter !== null &&
        displayedHp !== null &&
        hpBarRect &&
        hpReadoutRect && (
          <>
            <span
              className="battle-resolution-hp-readout"
              data-hp={hpLevel(displayedHp)}
              data-damage={sequence.phase === 'damage' && result.hpLoss > 0 ? 'true' : undefined}
              style={{
                left: hpReadoutRect.left - 14,
                top: hpReadoutRect.top,
                width: hpReadoutRect.width + 14,
                height: hpReadoutRect.height,
                color: hpReadoutColor ?? undefined,
              }}
            >
              {sequence.phase === 'damage' && result.hpLoss > 0 && (
                <span className="battle-resolution-hp-loss">−{result.hpLoss}</span>
              )}
              <span>{t('board.hp')}</span>
              <strong>{displayedHp}</strong>
              <span>/100</span>
            </span>
            <span
              className="battle-resolution-hp-bar"
              data-hp={hpLevel(displayedHp)}
              data-damage={sequence.phase === 'damage' && result.hpLoss > 0 ? 'true' : undefined}
              style={fixedRectStyle(hpBarRect)}
            >
              <span
                className="battle-resolution-hp-trail"
                style={{
                  width: `${sequence.phase === 'damage' && trailSettled ? result.hpAfter : result.hpBefore}%`,
                }}
              />
              <span
                className="battle-resolution-hp-fill"
                style={{ width: `${sequence.phase === 'damage' ? result.hpAfter : result.hpBefore}%` }}
              />
              <span className="battle-resolution-hp-ticks" />
            </span>
            {sequence.phase === 'damage' && result.hpLoss > 0 && statusRect && (
              <span className="battle-resolution-status-hit" style={fixedRectStyle(statusRect)} />
            )}
          </>
        )}

      {sequence.phase === 'damage' && result.loser !== null && statusRect && (
        <span
          className="battle-resolution-damage"
          data-zero={result.finalDamage === 0 || undefined}
          data-placement={damagePlacement}
          style={{
            left: statusRect.left + statusRect.width / 2,
            top: damagePlacement === 'below' ? statusRect.top + statusRect.height + 8 : statusRect.top - 8,
          }}
        >
          <span>{result.title}</span>
          <strong
            aria-label={`${
              result.reduction > 0
                ? `${result.rawDamage} − ${result.reduction} = ${result.finalDamage}`
                : result.finalDamage
            } ${t('board.damage')}`}
          >
            {result.reduction > 0 && (
              <>
                <span className="battle-resolution-damage-raw">{result.rawDamage}</span>
                <span className="battle-resolution-damage-operator">−</span>
                <span className="battle-resolution-damage-reduction">{result.reduction}</span>
                <span className="battle-resolution-damage-operator">=</span>
              </>
            )}
            <span className="battle-resolution-damage-final">{result.finalDamage}</span>
            <span className="battle-resolution-damage-unit">{t('board.damage')}</span>
          </strong>
          {result.hpBefore !== null && result.hpAfter !== null && (
            <em>
              {t('board.hp')} {result.hpBefore} → {result.hpAfter}
            </em>
          )}
        </span>
      )}
    </div>
  );
}
