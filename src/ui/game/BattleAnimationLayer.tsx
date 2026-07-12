import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { CardInstance, GameState, PlayerIndex } from '../../game/types';
import { CardView } from './CardView';

type ZoneName = 'hand' | 'battleZone' | 'setZoneA' | 'setZoneB' | 'setZoneC' | 'powerCharger' | 'abyss';
type SnapshotCard = Pick<CardInstance, 'instanceId' | 'defId' | 'faceUp'>;

interface VisualSnapshot {
  turn: number;
  battle: GameState['lastBattleResult'];
  chronosPosition: number;
  players: Array<Record<ZoneName, SnapshotCard[]>>;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface AnimationItem {
  id: string;
  kind: 'move' | 'lunge' | 'impact' | 'chronos';
  card?: SnapshotCard;
  rect: Rect;
  dx?: number;
  dy?: number;
  scaleX?: number;
  scaleY?: number;
}

const ANIMATION_DURATION = 680;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function copyCard(card: CardInstance | null): SnapshotCard[] {
  return card ? [{ instanceId: card.instanceId, defId: card.defId, faceUp: card.faceUp }] : [];
}

function snapshot(G: GameState): VisualSnapshot {
  return {
    turn: G.turnNumber,
    battle: { ...G.lastBattleResult },
    chronosPosition: G.chronos.position,
    players: G.players.map((player) => ({
      hand: player.hand.map((card) => ({ ...card })),
      battleZone: copyCard(player.battleZone),
      setZoneA: copyCard(player.setZoneA),
      setZoneB: copyCard(player.setZoneB),
      setZoneC: copyCard(player.setZoneC),
      powerCharger: player.powerCharger.map((card) => ({ ...card })),
      abyss: player.abyss.map((card) => ({ ...card })),
    })),
  };
}

function rectOf(element: Element | null): Rect | null {
  if (!element) return null;
  const { left, top, width, height } = element.getBoundingClientRect();
  return width > 0 && height > 0 ? { left, top, width, height } : null;
}

function captureCardRects(): Map<string, Rect> {
  const result = new Map<string, Rect>();
  // CardView 也會被 ZoneSummarySheet 使用；只取戰場主畫面的錨點，避免 modal 卡牌覆寫座標。
  document.querySelectorAll<HTMLElement>('.bf-main [data-anim-card]').forEach((element) => {
    const id = element.dataset.animCard;
    const rect = rectOf(element);
    if (id && rect) result.set(id, rect);
  });
  return result;
}

function captureZoneRects(): Map<string, Rect> {
  const result = new Map<string, Rect>();
  document.querySelectorAll<HTMLElement>('.bf-main [data-anim-zone]').forEach((element) => {
    const id = element.dataset.animZone;
    const rect = rectOf(element);
    if (id && rect) result.set(id, rect);
  });
  return result;
}

function findCard(
  player: Record<ZoneName, SnapshotCard[]>,
  instanceId: string,
): { card: SnapshotCard; zone: ZoneName } | null {
  for (const zone of Object.keys(player) as ZoneName[]) {
    const card = player[zone].find((candidate) => candidate.instanceId === instanceId);
    if (card) return { card, zone };
  }
  return null;
}

function styleFor(item: AnimationItem): CSSProperties {
  return {
    left: item.rect.left,
    top: item.rect.top,
    width: item.rect.width,
    height: item.rect.height,
    '--battle-animation-dx': `${item.dx ?? 0}px`,
    '--battle-animation-dy': `${item.dy ?? 0}px`,
    '--battle-animation-scale-x': String(item.scaleX ?? 1),
    '--battle-animation-scale-y': String(item.scaleY ?? 1),
  } as CSSProperties;
}

function zoneRect(
  player: PlayerIndex,
  zone: ZoneName | 'deck',
  card: SnapshotCard | undefined,
  cardRects: Map<string, Rect>,
  zoneRects: Map<string, Rect>,
): Rect | null {
  return (card ? cardRects.get(card.instanceId) : undefined) ?? zoneRects.get(`p${player}:${zone}`) ?? null;
}

/**
 * 規則狀態不等待視覺演出；本元件僅比較前後「已對該玩家公開」的畫面快照，
 * 以固定定位的卡牌複本補上飛牌與對戰節奏。這讓線上同步、重連、跳過動畫皆不影響權威狀態。
 */
export function BattleAnimationLayer({
  G,
  me,
  onAnimatingChange,
}: {
  G: GameState;
  me: PlayerIndex;
  onAnimatingChange?: (active: boolean) => void;
}) {
  const previous = useRef<VisualSnapshot | null>(null);
  const previousRects = useRef<Map<string, Rect>>(new Map());
  const previousZoneRects = useRef<Map<string, Rect>>(new Map());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [items, setItems] = useState<AnimationItem[]>([]);

  useLayoutEffect(() => {
    const next = snapshot(G);
    const nextRects = captureCardRects();
    const nextZoneRects = captureZoneRects();
    const before = previous.current;
    const generated: AnimationItem[] = [];

    if (before && !reducedMotion()) {
      // 只追蹤自己已公開的卡：這涵蓋打出、回收、Area Enchant 轉區，以及送入深淵／充能區。
      // 對手手牌與牌庫不以實例身分比較，避免由動畫洩漏隱藏資訊。
      for (const sourceZone of Object.keys(before.players[me]) as ZoneName[]) {
        for (const oldCard of before.players[me][sourceZone]) {
          const destination = findCard(next.players[me], oldCard.instanceId);
          if (!destination || destination.zone === sourceZone) continue;
          const from = zoneRect(me, sourceZone, oldCard, previousRects.current, previousZoneRects.current);
          const to = zoneRect(me, destination.zone, destination.card, nextRects, nextZoneRects);
          if (!from || !to) continue;
          generated.push({
            id: `move-${next.turn}-${oldCard.instanceId}-${sourceZone}-${destination.zone}`,
            kind: 'move',
            // 設置卡在規則上會立刻改為伏牌；飛行複本仍應先呈現玩家從手牌打出的正面。
            card: sourceZone === 'hand' ? oldCard : destination.card,
            rect: from,
            dx: to.left - from.left,
            dy: to.top - from.top,
            scaleX: to.width / from.width,
            scaleY: to.height / from.height,
          });
        }
      }

      // 抽牌與牌庫頂公開移動在舊快照中沒有可識別實例；以牌庫區域作來源，
      // 只對自己新取得或進入公開區域的卡播放。抽牌動畫固定使用卡背。
      const previousKnown = new Set(
        (Object.keys(before.players[me]) as ZoneName[]).flatMap((zone) =>
          before.players[me][zone].map((card) => card.instanceId),
        ),
      );
      // 行動版會隱藏牌庫區；此時從手牌工作列邊緣出現，避免抽牌回饋完全消失。
      const deckSource =
        zoneRect(me, 'deck', undefined, previousRects.current, previousZoneRects.current) ??
        previousZoneRects.current.get(`p${me}:hand`) ??
        null;
      if (deckSource) {
        for (const destinationZone of ['hand', 'abyss', 'powerCharger'] as const) {
          for (const card of next.players[me][destinationZone]) {
            if (previousKnown.has(card.instanceId)) continue;
            const to = zoneRect(me, destinationZone, card, nextRects, nextZoneRects);
            if (!to) continue;
            generated.push({
              id: `draw-${next.turn}-${card.instanceId}-${destinationZone}`,
              kind: 'move',
              card: destinationZone === 'hand' ? { ...card, faceUp: false } : card,
              rect: deckSource,
              dx: to.left - deckSource.left,
              dy: to.top - deckSource.top,
              scaleX: to.width / deckSource.width,
              scaleY: to.height / deckSource.height,
            });
          }
        }
      }

      if (before.chronosPosition !== next.chronosPosition) {
        const chronosRect = nextZoneRects.get('chronos');
        if (chronosRect)
          generated.push({ id: `chronos-${next.turn}-${next.chronosPosition}`, kind: 'chronos', rect: chronosRect });
      }

      // 回合結算時，保留正式卡牌在原位，改以複本向中央短衝，避免誤導規則上的場地移動。
      const battleChanged =
        next.battle.winner !== before.battle.winner ||
        next.battle.damage !== before.battle.damage ||
        next.battle.winnerAttack !== before.battle.winnerAttack ||
        next.battle.loserAttack !== before.battle.loserAttack;
      if ((next.turn > before.turn || battleChanged) && next.battle.winner !== null) {
        const winner = next.battle.winner;
        const loser = (1 - winner) as PlayerIndex;
        const winnerCard = next.players[winner].battleZone[0];
        const winnerRect = winnerCard ? nextRects.get(winnerCard.instanceId) : null;
        const loserCard = next.players[loser].battleZone[0];
        const loserRect = loserCard ? nextRects.get(loserCard.instanceId) : null;
        if (winnerCard && winnerRect && loserRect) {
          generated.push({
            id: `lunge-${next.turn}-${winnerCard.instanceId}`,
            kind: 'lunge',
            card: winnerCard,
            rect: winnerRect,
            dx: (loserRect.left - winnerRect.left) * 0.36,
            dy: (loserRect.top - winnerRect.top) * 0.36,
          });
          if (next.battle.damage > 0) {
            generated.push({ id: `impact-${next.turn}-${loser}`, kind: 'impact', rect: loserRect });
          }
        }
      }
    }

    previous.current = next;
    previousRects.current = nextRects;
    previousZoneRects.current = nextZoneRects;
    if (generated.length === 0) return;
    setItems((current) => [...current, ...generated]);
    const ids = new Set(generated.map((item) => item.id));
    const timer = setTimeout(() => {
      timers.current = timers.current.filter((activeTimer) => activeTimer !== timer);
      setItems((current) => current.filter((item) => !ids.has(item.id)));
    }, ANIMATION_DURATION);
    timers.current.push(timer);
  }, [G, me]);

  useLayoutEffect(() => {
    onAnimatingChange?.(items.length > 0);
  }, [items.length, onAnimatingChange]);

  useLayoutEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
      timers.current = [];
    },
    [],
  );

  if (items.length === 0) return null;
  return (
    <div className="battle-animation-layer" aria-hidden="true">
      {items.map((item) =>
        item.kind === 'impact' || item.kind === 'chronos' ? (
          <span
            key={item.id}
            className={item.kind === 'chronos' ? 'battle-animation-chronos' : 'battle-animation-impact'}
            style={styleFor(item)}
          />
        ) : (
          <div
            key={item.id}
            className={`battle-animation-card battle-animation-card-${item.kind}`}
            style={styleFor(item)}
          >
            {item.card && (
              <CardView card={item.card} size="md" showCost={false} className="battle-animation-card-face" />
            )}
          </div>
        ),
      )}
    </div>
  );
}
