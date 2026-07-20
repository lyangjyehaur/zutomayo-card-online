import type { TutorialStep } from '../components/GameTutorialOverlay';

/**
 * 教學步驟定義（半操作式）。
 *
 * 搭配固定劇本（tutorialScenario.ts），玩家會經歷兩回合對戰：
 * - T1（initialSet）：玩家出低費角色卡，AI 出較強角色卡，玩家輸（受傷）
 * - T2（turnSet）：玩家為敗者可出 2 張卡（角色+Area Enchant），透過效果逆轉獲勝
 *
 * 流程順序：
 * 1. 從 CH.04 直接進入猜拳，第一步就是實際操作。
 * 2. 查看五張起手牌後，完成重抽與 T1 初始放置。
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
  // === CH.04 戰鬥準備：每一步只開放劇本指定的操作 ===
  // 1. 猜拳（AI 劇本保證玩家選石頭時獲勝）
  {
    chapter: 'preparation',
    phase: 'janken',
    target: '[data-tut="janken-panel"]',
    interactionTarget: '[data-tut="janken-rock"]',
    title: 'tutorial.game.janken.intro.title',
    body: 'tutorial.game.janken.intro.body',
    placement: 'bottom',
    padding: 16,
    completeWhen: (G) => G.jankenChoices[0] !== null,
  },
  {
    chapter: 'preparation',
    phase: 'janken-result',
    backBehavior: { type: 'restart', checkpoint: 'preparation' },
    target: '[data-tut="setup-feedback"]',
    interactionTarget: '[data-tut="setup-feedback"] button',
    title: 'tutorial.game.janken.result.title',
    body: 'tutorial.game.janken.result.body',
    placement: 'top',
    padding: 16,
    // 隱藏 Next/Prev，只能點擊猜拳結果彈窗的確認按鈕推進
    hideNext: true,
  },

  // 3. 檢視起手牌後，只允許選擇劇本指定的高費卡。
  {
    chapter: 'preparation',
    phase: 'opening-hand',
    backBehavior: { type: 'restart', checkpoint: 'preparation' },
    target: '.mulligan-hand',
    interactionTarget: '[data-tut-mulligan-card="1st_2"]',
    title: 'tutorial.game.openingHand.title',
    body: 'tutorial.game.openingHand.body',
    placement: 'bottom',
    padding: 8,
    actionOnly: true,
  },

  // 4. 確認重抽；「保留手牌」與其他卡都不放行。
  {
    chapter: 'preparation',
    phase: 'mulligan-confirm',
    backBehavior: { type: 'restart', checkpoint: 'preparation' },
    target: '[data-tut="mulligan-redraw"]',
    interactionTarget: '[data-tut="mulligan-redraw"]',
    title: 'tutorial.game.mulligan.confirm.title',
    body: 'tutorial.game.mulligan.confirm.body',
    placement: 'bottom',
    padding: 16,
    completeWhen: (G) => G.mulliganUsed[0],
  },

  // 5. 選擇劇本指定的初始角色卡。
  {
    chapter: 'preparation',
    phase: 'initialSet-select',
    backBehavior: { type: 'restart', checkpoint: 'preparation' },
    target: '[data-tut-card="1st_70"]',
    interactionTarget: '[data-tut-card="1st_70"]',
    title: 'tutorial.game.initialSet.select.title',
    body: 'tutorial.game.initialSet.select.body',
    placement: 'top',
    padding: 12,
    actionOnly: true,
  },

  // 6. 將已選中的卡放入戰鬥區。
  {
    chapter: 'preparation',
    phase: 'initialSet-place',
    backBehavior: { type: 'restart', checkpoint: 'preparation' },
    target: '[data-tut="set-selected-card"]',
    interactionTarget: '[data-tut="set-selected-card"]',
    title: 'tutorial.game.initialSet.place.title',
    body: 'tutorial.game.initialSet.place.body',
    placement: 'top',
    padding: 12,
    actionOnly: true,
  },

  // 7. 確認初始放置，完成 CH.04。
  {
    chapter: 'preparation',
    phase: 'initialSet-confirm',
    backBehavior: { type: 'restart', checkpoint: 'preparation' },
    target: '[data-tut="confirm-set"]',
    interactionTarget: '[data-tut="confirm-set"]',
    title: 'tutorial.game.initialSet.confirm.title',
    body: 'tutorial.game.initialSet.confirm.body',
    placement: 'top',
    padding: 12,
    // 只接受 initialSet 之後的合法階段，避免教學 UI 比遊戲狀態先進入本步驟時，
    // 暫時仍為 mulligan 的狀態被誤判成已完成。
    completeWhen: (G) => G.step === 'turnSet' || G.step === 'effectOrder' || G.step === 'gameOver',
  },

  // === CH.05 對戰流程：先銜接 CH.04，再對照真實結算 ===
  {
    chapter: 'flow',
    phase: 'flow-recap',
    target: null,
    title: 'tutorial.game.flowRecap.title',
    body: 'tutorial.game.flowRecap.body',
    placement: 'center',
  },
  {
    chapter: 'flow',
    phase: 'clock-advance',
    backBehavior: { type: 'direct' },
    target: '[data-tut="game-notice-panel"]',
    interactionTarget: '[data-tut="game-notice-panel"] button',
    title: 'tutorial.game.clockAdvance.title',
    body: 'tutorial.game.clockAdvance.body',
    placement: 'bottom',
    padding: 12,
    hideNext: true,
    advanceOnNoticeDismiss: true,
  },
  {
    chapter: 'flow',
    phase: 'hp-calc',
    backBehavior: { type: 'restart', checkpoint: 'flow' },
    target: '[data-tut="game-notice-panel"]',
    interactionTarget: '[data-tut="game-notice-panel"] button',
    title: 'tutorial.game.hpCalc.title',
    body: 'tutorial.game.hpCalc.body',
    placement: 'bottom',
    padding: 12,
    hideNext: true,
    advanceOnNoticeDismiss: true,
  },
  {
    chapter: 'flow',
    phase: 'turn-end-draw-t1',
    backBehavior: { type: 'restart', checkpoint: 'flow' },
    target: '[data-tut="player-hand"]',
    title: 'tutorial.game.turnEndDraw.title',
    body: 'tutorial.game.turnEndDraw.body',
    placement: 'top',
    padding: 10,
  },

  // 第二回合：敗者依序將角色與區域附魔放入 A／B。
  {
    chapter: 'flow',
    phase: 'turnSet-character-select',
    backBehavior: { type: 'direct' },
    target: '[data-tut-card="1st_46"]',
    interactionTarget: '[data-tut-card="1st_46"]',
    title: 'tutorial.game.turnSet.characterSelect.title',
    body: 'tutorial.game.turnSet.characterSelect.body',
    placement: 'top',
    padding: 12,
    actionOnly: true,
  },
  {
    chapter: 'flow',
    phase: 'turnSet-character-place',
    backBehavior: { type: 'restart', checkpoint: 'turn2' },
    target: '[data-tut="set-selected-card"]',
    interactionTarget: '[data-tut="set-selected-card"]',
    title: 'tutorial.game.turnSet.characterPlace.title',
    body: 'tutorial.game.turnSet.characterPlace.body',
    placement: 'top',
    padding: 12,
    actionOnly: true,
  },
  {
    chapter: 'flow',
    phase: 'turnSet-area-select',
    backBehavior: { type: 'restart', checkpoint: 'turn2' },
    target: '[data-tut-card="2nd_98"]',
    interactionTarget: '[data-tut-card="2nd_98"]',
    title: 'tutorial.game.turnSet.areaSelect.title',
    body: 'tutorial.game.turnSet.areaSelect.body',
    placement: 'top',
    padding: 12,
    actionOnly: true,
  },
  {
    chapter: 'flow',
    phase: 'turnSet-area-place',
    backBehavior: { type: 'restart', checkpoint: 'turn2' },
    target: '[data-tut="set-selected-card"]',
    interactionTarget: '[data-tut="set-selected-card"]',
    title: 'tutorial.game.turnSet.areaPlace.title',
    body: 'tutorial.game.turnSet.areaPlace.body',
    placement: 'top',
    padding: 12,
    actionOnly: true,
  },
  {
    chapter: 'flow',
    phase: 'turnSet-confirm',
    backBehavior: { type: 'restart', checkpoint: 'turn2' },
    target: '[data-tut="confirm-set"]',
    interactionTarget: '[data-tut="confirm-set"]',
    title: 'tutorial.game.turnSet.confirm.title',
    body: 'tutorial.game.turnSet.confirm.body',
    placement: 'top',
    padding: 12,
    completeWhen: (G) => G.step === 'effectOrder' || G.step === 'gameOver',
  },
  {
    chapter: 'flow',
    phase: 'reveal-clock',
    backBehavior: { type: 'restart', checkpoint: 'turn2' },
    target: '[data-tut="game-notice-panel"]',
    interactionTarget: '[data-tut="game-notice-panel"] button',
    title: 'tutorial.game.revealClock.title',
    body: 'tutorial.game.revealClock.body',
    placement: 'bottom',
    padding: 12,
    hideNext: true,
    advanceOnNoticeDismiss: true,
  },
  {
    chapter: 'flow',
    phase: 'character-replacement',
    backBehavior: { type: 'restart', checkpoint: 'turn2' },
    target: '[data-tut="player-battle-zone"]',
    title: 'tutorial.game.characterReplacement.title',
    body: 'tutorial.game.characterReplacement.body',
    placement: 'right',
    padding: 10,
  },
  {
    chapter: 'flow',
    phase: 'power-charging',
    backBehavior: { type: 'direct' },
    target: '[data-tut="player-power"]',
    title: 'tutorial.game.powerCharging.title',
    body: 'tutorial.game.powerCharging.body',
    placement: 'right',
    padding: 10,
  },
  {
    chapter: 'flow',
    phase: 'area-enchant',
    backBehavior: { type: 'direct' },
    target: '[data-tut="player-area-enchant"]',
    title: 'tutorial.game.areaEnchant.title',
    body: 'tutorial.game.areaEnchant.body',
    placement: 'left',
    padding: 10,
  },
  {
    chapter: 'flow',
    phase: 'effectOrder-action',
    backBehavior: { type: 'direct' },
    target: '.effect-order-panel',
    interactionTarget: '[data-tut-effect-card="2nd_98"]',
    title: 'tutorial.game.effectOrder.action.title',
    body: 'tutorial.game.effectOrder.action.body',
    placement: 'center',
    padding: 16,
    skipWhen: (G) => G.step !== 'effectOrder',
    completeWhen: (G, entry) => entry?.step === 'effectOrder' && G.step !== 'effectOrder',
  },
  {
    chapter: 'flow',
    phase: 'choice-mechanics',
    backBehavior: { type: 'restart', checkpoint: 'effects' },
    target: null,
    title: 'tutorial.game.choiceMechanics.title',
    body: 'tutorial.game.choiceMechanics.body',
    placement: 'center',
  },
  {
    chapter: 'flow',
    phase: 'hp-calc',
    backBehavior: { type: 'direct' },
    target: '[data-tut="game-notice-panel"]',
    interactionTarget: '[data-tut="game-notice-panel"] button',
    title: 'tutorial.game.hpCalc.turn2.title',
    body: 'tutorial.game.hpCalc.turn2.body',
    placement: 'bottom',
    padding: 12,
    hideNext: true,
    advanceOnNoticeDismiss: true,
  },
  {
    chapter: 'flow',
    phase: 'turn-end-cleanup',
    backBehavior: { type: 'restart', checkpoint: 'effects' },
    target: '[data-tut="opponent-abyss"]',
    title: 'tutorial.game.turnEndCleanup.title',
    body: 'tutorial.game.turnEndCleanup.body',
    placement: 'left',
    padding: 10,
  },
  {
    chapter: 'flow',
    phase: 'complete',
    backBehavior: { type: 'direct' },
    target: null,
    title: 'tutorial.game.complete.title',
    body: 'tutorial.game.complete.body',
    placement: 'center',
  },
];
