import type { BattleViewportMode } from '../../ui/game/useViewportMode';

export type RevealedCardSourceZone = 'hand' | 'deck';

/**
 * 手牌在桌面戰場已有固定位置，公開時直接翻面；行動裝置及牌庫頂公開才使用集中浮層。
 */
export function shouldRevealCardsInOpponentHand(
  viewportMode: BattleViewportMode,
  sourceZone: RevealedCardSourceZone,
): boolean {
  return viewportMode === 'desktop' && sourceZone === 'hand';
}
