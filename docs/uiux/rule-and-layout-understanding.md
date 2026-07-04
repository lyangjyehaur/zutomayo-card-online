# 規則與佈局理解（Rule & Layout Understanding）

> UI/UX 推倒重建的第一階段產物。本文件整理遊戲區域的規則語義、每個區域在線上 UI 中的職責、
> 現有 UI/UX 的問題清單，以及重建時**絕對不能改變**的規則語義邊界。
>
> 詳細的狀態結構與行號對照見同目錄：
> - `GAME_RULES_AND_STATE_STRUCTURE.md`（規則 / 狀態 / moves / PendingChoice 全表）
> - `current-ui-analysis.md`（現有 UI 實作深度分析）

---

## 1. 遊戲區域清單與 UI 職責

| 區域 | 資料欄位 | 規則含義 | 線上 UI 需承擔的功能 |
|------|---------|---------|--------------------|
| 牌組 Deck | `players[i].deck` | 抽牌來源；抽不到牌即敗北 | 顯示剩餘張數（勝負攸關資訊）；始終蓋牌；效果選擇時作為目標入口 |
| 手牌 Hand | `players[i].hand` | 出牌選擇來源 | 己方：可瀏覽、可選中、可出牌；對手：只顯示張數/牌背（除非 `revealedHandCardIds` 揭示） |
| 戰鬥區 Battle Zone | `players[i].battleZone`（最多 1 張 Character） | 當前戰鬥角色，決定攻擊力與時計推進 | 雙方各 1 格，中央核心位置；顯示晝/夜生效攻擊力與 Power 不足警示 |
| 設置區 A | `players[i].setZoneA` | 本回合設置的第 1 張卡；蓋牌直到公開 | 可設置/可撤回（`undoSetCard`）；蓋牌狀態顯示牌背 |
| 設置區 B | `players[i].setZoneB` | 本回合第 2 張卡（敗者回合可出 2 張） | 同 A |
| 設置區 C | `players[i].setZoneC`（Area Enchant） | 跨回合持續的區域附魔，公開 | 顯示生效中的附魔；本回合設置的才能撤回 |
| 充能區 Power Charger | `players[i].powerCharger` | 離場卡累積 Power（SEND TO POWER 總和） | 顯示 Power 總值（效果發動門檻）＋堆疊卡牌；可展開摘要 |
| 深淵 Abyss | `players[i].abyss` | 無 SEND TO POWER 卡牌的最終去處 | 顯示張數；效果選擇時作為目標入口；可展開摘要 |
| Chronos 時鐘 | `chronos.position`（0–11）、`nightSidePlayer` | 晝夜循環；決定用 night/day 攻擊力 | 全局中央顯示；位置、晝/夜、夜側玩家必須一眼可讀 |

其他 UI 必須呈現的全局狀態：

| 狀態 | 欄位 | UI 職責 |
|------|------|--------|
| 當前階段 | `G.step`（janken → mulligan → initialSet → turnSet → effectOrder → battle → turnEnd → gameOver） | PhaseIndicator：目前在哪、我該做什麼 |
| 回合數 / 回合玩家 | `G.turnNumber`、`ready[]` | 頂欄顯示；等待對手時明確提示 |
| 可執行行動 | 由 `step` + `ready` + `cardsSetThisTurn` + `getRequiredSetCount/getMinimumSetCount` 推導 | ActionBar 唯一主行動按鈕 + 提示 |
| 待處理效果 / 選擇 | `pendingEffects`、`pendingChoice`（13 種型別） | 置中 Modal/Sheet 選擇介面，min/max 張數校驗 |
| HP | `players[i].hp`（0–100） | 雙方 HP bar；變化時 GameNotice 明細 |
| 計時器 | `turnStartTime`（線上權威） / 客戶端倒數 | 頂欄倒數；≤10 秒警示色 |
| Log | `G.actionLog` | 可開關的歷史面板，卡名可查看詳情 |
| 通知 | `G.recentGameNotices` | 佇列式置中提示（HP/時鐘含明細需確認） |

## 2. Moves（UI 行動入口全表）

`janken(choice)`、`mulligan(indices)`、`keepHand()`、`setInitialCard(handIndex)`、
`setTurnCard(handIndex, slot)`、`undoSetCard(slot)`、`confirmReady()`、`timeoutSkip()`、
`resolvePendingEffect(index)`、`submitPendingChoice(optionIds)`。

UI 只能透過這些 moves 改變遊戲狀態；所有合法性由引擎驗證。

## 3. 現有 UI/UX 的主要問題

### 視覺風格
- 「漆器塔羅」方向本身成立（深漆黑 + 骨白 + 金/朱雙色），但**狀態語義色缺失**：
  可操作 / 已選中 / 可作為目標 / 不可操作沒有系統化 token，散落在各處的 ring/opacity 組合。
- 裝飾（梯形 Canvas 戰場、環境光暈）與資訊層搶對比，小螢幕上仍照常渲染。

### 佈局 / 資訊架構
- `Board.tsx` 3062 行單檔：Slot / FieldZone / StackZone / 充能堆疊 ×4 份複製貼上的實作。
- 對戰頁只有**一套桌面佈局**靠 media query 硬壓到手機（`current-ui-analysis.md` F 節）。
- 卡槽 `size-[88px]` 等 magic number 直接寫死在 JSX。
- 深淵/牌組/充能區只有數字，無法查看內容摘要（效果選擇時玩家缺乏資訊）。

### 響應式
- 360–430px 直屏：zone strip 橫向溢出、操作按鈕 35–40px（< 44px 觸控最小值）。
- 1366×768 / 1280×720 低高度桌面：頂欄 + instruction banner + 戰場 + 手牌垂直堆疊超出視高，依賴滾動。
- 平板直屏（768×1024）沒有專屬策略，只是縮小的桌面。
- hover 依賴：手牌 popover、focus panel 都以 mouseenter 為主，觸控端體驗是補丁（pointerdown 開側欄）。

### 可維護性
- `App.css` 11,043 行；battle 相關 ~1,700 行與頁面孤島混雜。
- Token 已定義約 50+ 但落地率低（88px、hex、text-[9px] 大量未遷移）。
- 浮層 z-index 多套競爭（popover / side sheet / phase message / notice）。

## 4. 推倒重建時必須保留的語義

1. **狀態唯讀**：UI 不得直接改 `step / ready / hp / chronos / players[i].* / pendingChoice / modifiers / winner`；只能讀取、推導顯示、發送 moves。
2. **資訊隱藏**：對手手牌、牌組內容由 `playerView` 過濾（`__hidden__` defId）；UI 不得嘗試繞過；蓋牌卡（`faceUp === false`）一律顯示牌背。
3. **出牌流程**：initialSet 設 1 張進 battleZone（蓋牌）→ turnSet 依 `getRequiredSetCount`（夜側/敗者 2 張、勝者 1 張，Assumption: 依 GameLogic 推導）設置 A/B/C → `confirmReady` 雙方就緒才公開。
4. **撤回規則**：只有未 `confirmReady` 前、且（C 區限本回合設置的卡）才可 `undoSetCard`。
5. **選擇流程**：`pendingChoice.min/max` 校驗必須保留；非當事玩家只能看到等待狀態。
6. **計時器**：線上模式以 `G.turnStartTime` 伺服器權威計時，超時發 `timeoutSkip`；本機/AI 客戶端倒數 — 此邏輯不可改。
7. **教學 hooks**：`data-tut="janken-panel|mulligan-redraw|mulligan-keep|chronos-clock|confirm-set|player-hp|player-power|player-abyss|player-set-zones|game-notice-panel|setup-feedback"`、`data-tut-card`、`data-tut-mulligan-card` 為 GameTutorialOverlay 定位錨點，重建後必須保留。
8. **測試 hooks**：`scripts/battle-responsive-smoke.mjs` 依賴 `.board / .battle-content-grid / .battle-perspective-field / .battle-player-area / .battle-perspective-stage / .battle-hand-row / .battle-action-stack / .board-pause-button / .battle-side-panel-actions / .battle-side-sheet` 等 class；重建後保留這些結構 class（或同步更新 smoke script）。

Assumption: 以上第 3 點出牌張數規則由 `GameLogic.getRequiredSetCount/getMinimumSetCount` 的呼叫方式推斷，UI 一律以函數回傳值為準，不自行硬編。
