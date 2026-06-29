import type { ActionLogEntry, GameState, PendingChoice, PlayerIndex } from './types';

/**
 * 統一記錄玩家動作到 G.actionLog，自動填入回合 / 步驟 / 時鐘位置 / HP 快照與時間戳，
 * 並嘗試從當前 pendingEffect / pendingChoice 推導效果來源與選擇類型 context。
 *
 * 抽成獨立模組以避免 GameLogic ↔ hpChange 之間的循環依賴：
 * hpChange.ts 需要在 HP 變化時寫入 actionLog，但不能反向 import GameLogic.ts。
 */
export function recordAction(
  G: GameState,
  player: PlayerIndex,
  action: string,
  payload?: ActionLogEntry['payload'],
  options: {
    result?: ActionLogEntry['result'];
    context?: Partial<Pick<ActionLogEntry, 'pendingEffectCardDefId' | 'pendingChoiceType'>>;
  } = {},
): void {
  if (!Array.isArray(G.actionLog)) G.actionLog = [];
  const pendingEffectPlayer = G.pendingEffectPlayer;
  const pendingEffectCardDefId =
    options.context?.pendingEffectCardDefId ??
    (pendingEffectPlayer === null ? undefined : G.pendingEffects[pendingEffectPlayer]?.[0]?.cardDefId);
  const pendingChoiceType = options.context?.pendingChoiceType ?? G.pendingChoice?.type;
  const nextId =
    G.actionLog.reduce((max, entry) => (Number.isInteger(entry.id) ? Math.max(max, Number(entry.id)) : max), 0) + 1;
  const entry: ActionLogEntry = {
    id: nextId,
    turn: G.turnNumber,
    step: G.step,
    player,
    action,
    chronosPosition: G.chronos.position,
    hp: [G.players[0].hp, G.players[1].hp],
    timestamp: Date.now(),
  };
  if (payload !== undefined) entry.payload = payload;
  if (options.result) {
    entry.result = {
      ok: Boolean(options.result.ok),
      ...(options.result.message ? { message: options.result.message.slice(0, 240) } : {}),
    };
  }
  if (pendingEffectCardDefId) entry.pendingEffectCardDefId = pendingEffectCardDefId;
  if (pendingChoiceType) entry.pendingChoiceType = pendingChoiceType as PendingChoice['type'];
  G.actionLog.push(entry);
}
