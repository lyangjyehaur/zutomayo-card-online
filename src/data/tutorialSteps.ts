import type { TutorialStep } from '../components/GameTutorialOverlay';

/**
 * 教學步驟定義（半操作式）。
 *
 * 搭配固定劇本（tutorialScenario.ts），玩家會經歷兩回合對戰：
 * - T1（initialSet）：玩家出低費角色卡，AI 出較強角色卡，玩家輸（受傷）
 * - T2（turnSet）：玩家為敗者可出 2 張卡（角色+Area Enchant），透過效果逆轉獲勝
 *
 * 流程順序：
 * 1. 歡迎後立即進入猜拳，第一個操作發生在第 2 步。
 * 2. 重抽與 T1 初始放置。
 * 3. 透過實際通知說明時計推進與 HP 計算。
 * 4. T2 追趕回合放置角色卡與 Area Enchant。
 * 5. 有效果或待選卡牌時直接操作，不再先顯示重複的說明頁。
 * 6. 完成 T2 結算並結束教學。
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

  // 2. 猜拳（歡迎後立即操作，教學模式下 AI 必出會輸的拳）
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

  // 3. 重抽（高亮高費卡與重抽/保留按鈕，操作後自動推進）
  {
    phase: 'mulligan',
    target: [
      '[data-tut-mulligan-card="1st_2"]',
      '[data-tut="mulligan-toggle-redraw"]',
      '[data-tut="mulligan-redraw"]',
      '[data-tut="mulligan-keep"]',
    ],
    title: 'tutorial.game.mulligan.intro.title',
    body: 'tutorial.game.mulligan.intro.body',
    placement: 'bottom',
    padding: 16,
    completeWhen: (G) => G.mulliganUsed[0],
  },

  // === T1（initialSet，無效果卡）===
  // 4. T1 初始放置（高亮劇本指定卡與確認按鈕，操作後自動推進）
  {
    phase: 'initialSet',
    target: ['[data-tut-card="1st_70"]', '[data-tut="set-selected-card"]', '[data-tut="confirm-set"]'],
    title: 'tutorial.game.initialSet.intro.title',
    body: 'tutorial.game.initialSet.intro.body',
    placement: 'top',
    padding: 12,
    // 只接受 initialSet 之後的合法階段，避免教學 UI 比遊戲狀態先進入本步驟時，
    // 暫時仍為 mulligan 的狀態被誤判成已完成。
    completeWhen: (G) => G.step === 'turnSet' || G.step === 'effectOrder' || G.step === 'gameOver',
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

  // === T2（turnSet，有效果卡：2nd_86 Area Enchant + 1st_98 Enchant）===
  // 5. T2 追趕回合放置（動態文案直接說明敗者可放置兩張卡）
  //    依上回合勝負分支：敗者出 2 張（1st_34 + 2nd_86），勝者出 1 張
  {
    phase: 'turnSet',
    target: [
      '[data-tut-card="1st_34"]',
      '[data-tut-card="2nd_86"]',
      '[data-tut="set-selected-card"]',
      '[data-tut="confirm-set"]',
    ],
    title: 'tutorial.game.turnSet.intro.title',
    body: 'tutorial.game.turnSet.intro.body',
    placement: 'top',
    padding: 12,
    completeWhen: (G) => G.step === 'effectOrder' || G.step === 'gameOver',
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

  // 6. 效果順序（條件式：直接進入操作，不再顯示重複的 intro 頁）
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

  // 7. 待選卡牌提交（條件式：直接進入操作）
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

  // 9. 完成
  {
    phase: 'complete',
    target: null,
    title: 'tutorial.game.complete.title',
    body: 'tutorial.game.complete.body',
    placement: 'center',
  },
];
