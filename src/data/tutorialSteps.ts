import type { TutorialStep } from '../components/GameTutorialOverlay';

/**
 * 教學步驟定義（半操作式）。
 *
 * 搭配固定劇本（tutorialScenario.ts），玩家會經歷兩回合對戰：
 * - T1（initialSet）：玩家出低費角色卡，AI 出較強角色卡，玩家輸（受傷）
 * - T2（turnSet）：玩家為敗者可出 2 張卡（角色+Area Enchant），透過效果逆轉獲勝
 *
 * 流程順序：
 * 1. 歡迎
 * 2. 場地導覽（時鐘、戰鬥區、能量、深淵、HP）—— 開戰前先認識介面
 * 3. 猜拳（操作）—— 玩家贏成為夜側玩家
 * 4. 重抽（操作）—— 引導重抽高費卡，說明 powerCost 不足攻擊力為 0
 * 5. T1 初始放置（操作）—— 引導出低費角色卡
 * 5b. T1 時鐘推進說明
 * 5c. T1 HP 計算說明
 * 6. T1 戰鬥結算結果 —— 玩家輸
 * 6b. 充能區教學 —— SEND TO POWER 機制，為 T2 powerCost 支付做鋪墊
 * 7. 追趕機制說明 —— 敗者可出 2 張卡
 * 8. T2 第二回合放置（操作）—— 引導出角色卡 + Area Enchant
 * 8b. T2 時鐘推進說明
 * 8c. 區域附魔教學 —— Area Enchant 放置於 Set Zone C，持續影響全場
 * 9.（效果順序·條件式操作）—— T2 才有效果卡
 * 9b.（待選卡牌·條件式操作）
 * 9c. T2 HP 計算說明
 * 10. T2 戰鬥結算結果 —— 玩家贏
 * 10b. 深淵教學 —— 附魔卡效果結算後送入深淵
 * 11. 勝利條件與完成
 *
 * - 無 completeWhen：導覽步驟，用戶手動點 Next。
 * - 有 completeWhen：操作步驟，偵測遊戲狀態達成後自動推進，隱藏 Next 並高亮可操作區。
 * - 有 skipWhen：條件式步驟，進入時若為 true 自動跳過（如該回合無效果卡）。
 * - 有 advanceOnNoticeDismiss：由 GameNotice 彈窗確認按鈕推進（如時鐘/HP 彈窗）。
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
    target: ['.opponent-battle-zone', '.player-battle-zone'],
    title: 'tutorial.game.zone.battle.title',
    body: 'tutorial.game.zone.battle.body',
    placement: 'right',
    padding: 12,
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
    target: '[data-tut="chronos-clock"]',
    title: 'tutorial.game.chronos.title',
    body: 'tutorial.game.chronos.body',
    placement: 'bottom',
    padding: 12,
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

  // 3. 猜拳（規則說明 + 操作合併為單一步驟，教學模式下 AI 必出會輸的拳）
  {
    phase: 'janken',
    target: '[data-tut="janken-panel"]',
    title: 'tutorial.game.janken.intro.title',
    body: 'tutorial.game.janken.intro.body',
    placement: 'bottom',
    padding: 16,
    completeWhen: (G) => G.jankenChoices[0] !== null,
  },
  {
    phase: 'janken-result',
    target: '[data-tut="setup-feedback"]',
    title: 'tutorial.game.janken.result.title',
    body: 'tutorial.game.janken.result.body',
    placement: 'top',
    padding: 16,
    // 隱藏 Next/Prev，只能點擊猜拳結果彈窗的確認按鈕推進
    hideNext: true,
  },

  // 4. 重抽（合併為操作步驟：高亮重抽彈框內的高費卡 + 重抽/保留按鈕，操作後自動推進）
  {
    phase: 'mulligan',
    target: ['[data-tut-mulligan-card="1st_2"]', '[data-tut="mulligan-redraw"]', '[data-tut="mulligan-keep"]'],
    title: 'tutorial.game.mulligan.intro.title',
    body: 'tutorial.game.mulligan.intro.body',
    placement: 'bottom',
    padding: 16,
    completeWhen: (G) => G.mulliganUsed[0],
  },

  // === T1（initialSet，無效果卡）===
  // 5. T1 初始放置（合併為操作步驟：高亮劇本指定卡 + 確認按鈕，操作後自動推進）
  {
    phase: 'initialSet',
    target: ['[data-tut-card="1st_70"]', '[data-tut="confirm-set"]'],
    title: 'tutorial.game.initialSet.intro.title',
    body: 'tutorial.game.initialSet.intro.body',
    placement: 'top',
    padding: 12,
    // 用戶放置卡牌並確認後，遊戲會離開 initialSet 階段
    completeWhen: (G, entry) => entry?.step === 'initialSet' && G.step !== 'initialSet',
  },

  // 5b. T1 時鐘推進說明（高亮時鐘推進彈窗，點彈窗確認按鈕推進）
  {
    phase: 'clock-advance',
    target: '[data-tut="game-notice-panel"]',
    title: 'tutorial.game.clockAdvance.title',
    body: 'tutorial.game.clockAdvance.body',
    placement: 'bottom',
    padding: 12,
    hideNext: true,
    advanceOnNoticeDismiss: true,
  },

  // 5c. T1 HP 計算說明（高亮 HP 計算彈窗，點彈窗確認按鈕推進）
  {
    phase: 'hp-calc',
    target: '[data-tut="game-notice-panel"]',
    title: 'tutorial.game.hpCalc.title',
    body: 'tutorial.game.hpCalc.body',
    placement: 'bottom',
    padding: 12,
    hideNext: true,
    advanceOnNoticeDismiss: true,
  },

  // 6. T1 戰鬥結算結果（依勝負分支：T1 玩家輸）
  {
    phase: 'battle-result',
    target: null,
    title: 'tutorial.game.battle.result.title',
    body: 'tutorial.game.battle.result.body',
    placement: 'center',
    resolveKeys: (G) => {
      const winner = G.lastBattleResult.winner;
      if (winner === null) {
        return {
          title: 'tutorial.game.battle.result.draw.title',
          body: 'tutorial.game.battle.result.draw.body',
        };
      }
      // 玩家是 player 0；winner === 1 表示 AI 贏（玩家輸）
      if (winner === 1) {
        return {
          title: 'tutorial.game.battle.result.lose.title',
          body: 'tutorial.game.battle.result.lose.body',
        };
      }
      return {
        title: 'tutorial.game.battle.result.win.title',
        body: 'tutorial.game.battle.result.win.body',
      };
    },
  },

  // 6a. 回合結束抽牌教學（T1 戰鬥後說明抽牌規則）
  {
    phase: 'turn-end-draw',
    target: '[data-zone="hand"]',
    title: 'tutorial.game.turnEndDraw.title',
    body: 'tutorial.game.turnEndDraw.body',
    placement: 'top',
    padding: 12,
  },

  // 6b. 充能區教學（T1 戰鬥後說明 SEND TO POWER 機制，為 T2 powerCost 支付做鋪墊）
  {
    phase: 'power-charging',
    target: '[data-tut="player-power"]',
    title: 'tutorial.game.powerCharging.title',
    body: 'tutorial.game.powerCharging.body',
    placement: 'top',
    padding: 12,
  },

  // 7. 追趕機制說明（戰鬥後、第二回合前）—— 依上回合勝負分支
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

  // === T2（turnSet，有效果卡：2nd_86 Area Enchant + 1st_98 Enchant）===
  // 8. T2 第二回合放置（合併為操作步驟：高亮劇本指定卡 + 確認按鈕，操作後自動推進）
  //    依上回合勝負分支：敗者出 2 張（1st_34 + 2nd_86），勝者出 1 張
  {
    phase: 'turnSet',
    target: ['[data-tut-card="1st_34"]', '[data-tut-card="2nd_86"]', '[data-tut="confirm-set"]'],
    title: 'tutorial.game.turnSet.intro.title',
    body: 'tutorial.game.turnSet.intro.body',
    placement: 'top',
    padding: 12,
    completeWhen: (G, entry) => entry?.step === 'turnSet' && G.step !== 'turnSet',
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

  // 8b. T2 時鐘推進說明（高亮時鐘推進彈窗，點彈窗確認按鈕推進）
  {
    phase: 'clock-advance',
    target: '[data-tut="game-notice-panel"]',
    title: 'tutorial.game.clockAdvance.title',
    body: 'tutorial.game.clockAdvance.body',
    placement: 'bottom',
    padding: 12,
    hideNext: true,
    advanceOnNoticeDismiss: true,
  },

  // 8c. 區域附魔教學（T2 卡牌翻開後，說明 Area Enchant 機制）
  {
    phase: 'area-enchant',
    target: '[data-tut="player-set-zones"]',
    title: 'tutorial.game.areaEnchant.title',
    body: 'tutorial.game.areaEnchant.body',
    placement: 'top',
    padding: 12,
  },

  // 9. 效果順序（條件式：僅 T2 後有效果卡才出現）
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

  // 9b. 待選卡牌提交（條件式：僅有效果產生 pendingChoice 才出現）
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

  // 9c. T2 HP 計算說明（高亮 HP 計算彈窗，點彈窗確認按鈕推進）
  {
    phase: 'hp-calc',
    target: '[data-tut="game-notice-panel"]',
    title: 'tutorial.game.hpCalc.title',
    body: 'tutorial.game.hpCalc.body',
    placement: 'bottom',
    padding: 12,
    hideNext: true,
    advanceOnNoticeDismiss: true,
  },

  // 10. T2 戰鬥結算結果（依勝負分支：T2 玩家贏）
  {
    phase: 'battle-result',
    target: null,
    title: 'tutorial.game.battle.result.title',
    body: 'tutorial.game.battle.result.body',
    placement: 'center',
    resolveKeys: (G) => {
      const winner = G.lastBattleResult.winner;
      if (winner === null) {
        return {
          title: 'tutorial.game.battle.result.draw.title',
          body: 'tutorial.game.battle.result.draw.body',
        };
      }
      if (winner === 1) {
        return {
          title: 'tutorial.game.battle.result.lose.title',
          body: 'tutorial.game.battle.result.lose.body',
        };
      }
      return {
        title: 'tutorial.game.battle.result.win.title',
        body: 'tutorial.game.battle.result.win.body',
      };
    },
  },

  // 10b. 深淵教學（T2 戰鬥後說明附魔卡送深淵機制）
  {
    phase: 'abyss-explain',
    target: '[data-tut="player-abyss"]',
    title: 'tutorial.game.abyss.title',
    body: 'tutorial.game.abyss.body',
    placement: 'top',
    padding: 12,
  },

  // 11. 完成
  {
    phase: 'complete',
    target: null,
    title: 'tutorial.game.complete.title',
    body: 'tutorial.game.complete.body',
    placement: 'center',
  },
];
