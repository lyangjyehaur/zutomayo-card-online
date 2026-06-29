import type { GameNotice, GameState } from './types';

/**
 * 遊戲事件提示保留上限，避免 recentGameNotices 陣列無限增長。
 * 超過時從前端（最舊）裁切，保留最近數次提示供 UI 顯示。
 */
export const MAX_GAME_NOTICES_KEPT = 30;

/**
 * 統一記錄遊戲事件提示（HP 變化、時鐘推進、戰鬥結果、回合切換），
 * 供 UI 單一置中 overlay 依序消費顯示。
 *
 * 抽成獨立模組以避免 GameLogic ↔ effects/executor 之間的循環依賴，
 * 與 hpChange.ts 同理。
 */
export function pushGameNotice(G: GameState, notice: Omit<GameNotice, 'id' | 'timestamp'>): void {
  if (!Array.isArray(G.recentGameNotices)) G.recentGameNotices = [];
  const id =
    G.recentGameNotices.reduce((max, entry) => (Number.isInteger(entry.id) ? Math.max(max, entry.id) : max), 0) + 1;
  G.recentGameNotices.push({ ...notice, id, timestamp: Date.now() });
  if (G.recentGameNotices.length > MAX_GAME_NOTICES_KEPT) {
    G.recentGameNotices.splice(0, G.recentGameNotices.length - MAX_GAME_NOTICES_KEPT);
  }
}
