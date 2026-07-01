import type { TutorialStep } from '../components/GameTutorialOverlay';

/**
 * 教學步驟定義（半操作式）。
 *
 * 流程順序：
 * 1. 歡迎
 * 2. 場地導覽（時鐘、戰鬥區、能量、深淵、HP）—— 開戰前先認識介面
 * 3. 猜拳（操作）
 * 4. 重抽（操作）
 * 5. 初始放置（操作）
 * 6.（效果順序·條件式操作）
 * 7. 戰鬥結算結果
 * 8. 追趕機制說明
 * 9. 第二回合放置（操作）
 * 10. 勝利條件與完成
 *
 * - 無 completeWhen：導覽步驟，用戶手動點 Next。
 * - 有 completeWhen：操作步驟，偵測遊戲狀態達成後自動推進，隱藏 Next 並高亮可操作區。
 * - 有 skipWhen：條件式步驟，進入時若為 true 自動跳過（如該回合無效果卡）。
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
  // 1. 歡迎
  {
    phase: 'intro',
    target: null,
    title: 'tutorial.game.intro.title',
    body: 'tutorial.game.intro.body',
    placement: 'center',
  },

  // 2. 場地導覽（遊戲一開始就渲染場地，先認識介面再開始猜拳）
  //    拆成獨立步驟，每個區域分別介紹
  {
    phase: 'zone-battle',
    target: '[data-tut="central-arena"]',
    title: 'tutorial.game.zone.battle.title',
    body: 'tutorial.game.zone.battle.body',
    placement: 'center',
    padding: 20,
  },
  {
    phase: 'zone-hand',
    target: '[data-zone="hand"]',
    title: 'tutorial.game.zone.hand.title',
    body: 'tutorial.game.zone.hand.body',
    placement: 'top',
    padding: 12,
  },
  {
    phase: 'zone-set',
    target: '[data-tut="player-set-zones"]',
    title: 'tutorial.game.zone.set.title',
    body: 'tutorial.game.zone.set.body',
    placement: 'top',
    padding: 12,
  },
  {
    phase: 'zone-abyss',
    target: '[data-tut="player-abyss"]',
    title: 'tutorial.game.zone.abyss.title',
    body: 'tutorial.game.zone.abyss.body',
    placement: 'top',
    padding: 12,
  },
  {
    phase: 'chronos-explain',
    target: '[data-tut="central-arena"]',
    title: 'tutorial.game.chronos.title',
    body: 'tutorial.game.chronos.body',
    placement: 'center',
    padding: 20,
  },
  {
    phase: 'resources-explain',
    target: '[data-tut="player-power"]',
    title: 'tutorial.game.resources.title',
    body: 'tutorial.game.resources.body',
    placement: 'top',
    padding: 12,
  },
  {
    phase: 'hp-explain',
    target: '[data-tut="player-hp"]',
    title: 'tutorial.game.victory.title',
    body: 'tutorial.game.victory.body',
    placement: 'top',
    padding: 12,
  },

  // 3. 猜拳
  {
    phase: 'janken-intro',
    target: null,
    title: 'tutorial.game.janken.intro.title',
    body: 'tutorial.game.janken.intro.body',
    placement: 'center',
  },
  {
    phase: 'janken-action',
    target: '[data-tut="janken-panel"]',
    title: 'tutorial.game.janken.action.title',
    body: 'tutorial.game.janken.action.body',
    placement: 'bottom',
    padding: 16,
    completeWhen: (G) => G.jankenChoices[0] !== null,
  },
  {
    phase: 'janken-result',
    target: null,
    title: 'tutorial.game.janken.result.title',
    body: 'tutorial.game.janken.result.body',
    placement: 'center',
  },

  // 4. 重抽
  {
    phase: 'mulligan-intro',
    target: null,
    title: 'tutorial.game.mulligan.intro.title',
    body: 'tutorial.game.mulligan.intro.body',
    placement: 'center',
  },
  {
    phase: 'mulligan-action',
    target: '[data-tut="mulligan-panel"]',
    title: 'tutorial.game.mulligan.action.title',
    body: 'tutorial.game.mulligan.action.body',
    placement: 'bottom',
    padding: 16,
    completeWhen: (G) => G.mulliganUsed[0],
  },

  // 5. 初始放置
  {
    phase: 'initialSet-intro',
    target: null,
    title: 'tutorial.game.initialSet.intro.title',
    body: 'tutorial.game.initialSet.intro.body',
    placement: 'center',
  },
  {
    phase: 'initialSet-action',
    target: '[data-tut="player-actions"]',
    title: 'tutorial.game.initialSet.action.title',
    body: 'tutorial.game.initialSet.action.body',
    placement: 'top',
    padding: 12,
    // 用戶放置卡牌並確認後，遊戲會離開 initialSet 階段
    completeWhen: (G, entry) => entry?.step === 'initialSet' && G.step !== 'initialSet',
  },

  // 6. 效果順序（條件式：僅 initialSet 後有效果卡才出現）
  {
    phase: 'effectOrder-intro',
    target: null,
    title: 'tutorial.game.effectOrder.intro.title',
    body: 'tutorial.game.effectOrder.intro.body',
    placement: 'center',
    // 若已離開 effectOrder（該回合無效果卡），跳過本段
    skipWhen: (G) => G.step !== 'effectOrder',
  },
  {
    phase: 'effectOrder-action',
    target: '.effect-order-panel',
    title: 'tutorial.game.effectOrder.action.title',
    body: 'tutorial.game.effectOrder.action.body',
    placement: 'center',
    padding: 16,
    skipWhen: (G) => G.step !== 'effectOrder',
    // 用戶結算完所有待處理效果後，遊戲離開 effectOrder
    completeWhen: (G, entry) => entry?.step === 'effectOrder' && G.step !== 'effectOrder',
  },

  // 6b. 待選卡牌提交（條件式：僅有效果產生 pendingChoice 才出現）
  {
    phase: 'pendingChoice-intro',
    target: null,
    title: 'tutorial.game.pendingChoice.intro.title',
    body: 'tutorial.game.pendingChoice.intro.body',
    placement: 'center',
    // 無 pendingChoice 時跳過
    skipWhen: (G) => !G.pendingChoice,
  },
  {
    phase: 'pendingChoice-action',
    target: '.pending-choice-panel',
    title: 'tutorial.game.pendingChoice.action.title',
    body: 'tutorial.game.pendingChoice.action.body',
    placement: 'center',
    padding: 16,
    skipWhen: (G) => !G.pendingChoice,
    // pendingChoice 被清空（用戶提交選擇）後推進
    completeWhen: (G) => !G.pendingChoice,
  },

  // 7. 戰鬥結算結果
  {
    phase: 'battle-result',
    target: null,
    title: 'tutorial.game.battle.result.title',
    body: 'tutorial.game.battle.result.body',
    placement: 'center',
  },

  // 8. 追趕機制說明（戰鬥後、第二回合前）—— 依上回合勝負分支
  {
    phase: 'catchup-explain',
    target: null,
    title: 'tutorial.game.catchup.title',
    body: 'tutorial.game.catchup.body',
    placement: 'center',
    resolveKeys: (G) => {
      const winner = G.lastBattleResult.winner;
      if (winner === null) {
        return {
          title: 'tutorial.game.catchup.draw.title',
          body: 'tutorial.game.catchup.draw.body',
        };
      }
      // 玩家是 player 0；winner === 1 表示玩家為輸家
      if (winner === 1) {
        return {
          title: 'tutorial.game.catchup.loser.title',
          body: 'tutorial.game.catchup.loser.body',
        };
      }
      return {
        title: 'tutorial.game.catchup.winner.title',
        body: 'tutorial.game.catchup.winner.body',
      };
    },
  },

  // 9. 第二回合放置（追趕實作）—— 同樣依上回合勝負分支
  {
    phase: 'turnSet-intro',
    target: null,
    title: 'tutorial.game.turnSet.intro.title',
    body: 'tutorial.game.turnSet.intro.body',
    placement: 'center',
    resolveKeys: (G) => {
      const winner = G.lastBattleResult.winner;
      if (winner === null) {
        return {
          title: 'tutorial.game.turnSet.intro.draw.title',
          body: 'tutorial.game.turnSet.intro.draw.body',
        };
      }
      if (winner === 1) {
        return {
          title: 'tutorial.game.turnSet.intro.loser.title',
          body: 'tutorial.game.turnSet.intro.loser.body',
        };
      }
      return {
        title: 'tutorial.game.turnSet.intro.winner.title',
        body: 'tutorial.game.turnSet.intro.winner.body',
      };
    },
  },
  {
    phase: 'turnSet-action',
    target: '[data-tut="player-actions"]',
    title: 'tutorial.game.turnSet.action.title',
    body: 'tutorial.game.turnSet.action.body',
    placement: 'top',
    padding: 12,
    completeWhen: (G, entry) => entry?.step === 'turnSet' && G.step !== 'turnSet',
    resolveKeys: (G) => {
      const winner = G.lastBattleResult.winner;
      if (winner === null) {
        return {
          title: 'tutorial.game.turnSet.action.draw.title',
          body: 'tutorial.game.turnSet.action.draw.body',
        };
      }
      if (winner === 1) {
        return {
          title: 'tutorial.game.turnSet.action.loser.title',
          body: 'tutorial.game.turnSet.action.loser.body',
        };
      }
      return {
        title: 'tutorial.game.turnSet.action.winner.title',
        body: 'tutorial.game.turnSet.action.winner.body',
      };
    },
  },

  // 10. 完成
  {
    phase: 'complete',
    target: null,
    title: 'tutorial.game.complete.title',
    body: 'tutorial.game.complete.body',
    placement: 'center',
  },
];
