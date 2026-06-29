import type { GameState, HpChangeBreakdown, HpChangeReason, PlayerIndex } from './types';

/**
 * HP 變化事件保留上限，避免 recentHpChanges 陣列無限增長。
 * 超過時從前端（最舊）裁切，保留最近一次戰鬥與效果結算的視覺提示來源。
 */
export const MAX_HP_CHANGES_KEPT = 20;

/**
 * 統一記錄 HP 變化事件，供 UI 顯示雙方浮動提示（+HP / -HP 與原因）。
 *
 * 設計考量：
 * - delta 為「實際變動量」（已套用 0~100 clamp），正值為回復、負值為扣減，
 *   避免UI 顯示與實際 HP 不一致（例如滿血回復或 0 HP 時的扣減）。
 * - reason 區分戰鬥傷害、直接傷害、回復等，讓提示能標註成因。
 * - sourceCardDefId 為觸發效果之卡牌定義 ID（戰鬥傷害時為 undefined），
 *   供 UI 顯示卡名（若有）。
 *
 * 抽成獨立模組以避免 GameLogic ↔ effects/executor 之間的循環依賴。
 */
export function pushHpChange(
  G: GameState,
  player: PlayerIndex,
  delta: number,
  reason: HpChangeReason,
  sourceCardDefId?: string,
  breakdown?: HpChangeBreakdown,
): void {
  if (delta === 0) return;
  if (!Array.isArray(G.recentHpChanges)) G.recentHpChanges = [];
  const id =
    G.recentHpChanges.reduce((max, entry) => (Number.isInteger(entry.id) ? Math.max(max, entry.id) : max), 0) + 1;
  G.recentHpChanges.push({
    id,
    player,
    delta,
    reason,
    ...(sourceCardDefId ? { sourceCardDefId } : {}),
    ...(breakdown ? { breakdown } : {}),
    turn: G.turnNumber,
    timestamp: Date.now(),
  });
  if (G.recentHpChanges.length > MAX_HP_CHANGES_KEPT) {
    G.recentHpChanges.splice(0, G.recentHpChanges.length - MAX_HP_CHANGES_KEPT);
  }
}
