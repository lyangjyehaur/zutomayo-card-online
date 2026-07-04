# 互動流程（Interaction Flow）

> 實作：`src/components/Board.tsx`（流程編排）＋ `src/ui/game/`（元件）
> 原則：玩家永遠知道「現在該做什麼」（PhaseIndicator + ActionDock 提示雙保險）；
> 所有可操作狀態有明確視覺（design-system.md §3.1 四態）；觸控端零 hover 依賴。

## 裝置互動模型

| 動作 | 桌面（fine pointer） | 觸控（coarse / 非桌面佈局） |
|------|--------------------|---------------------------|
| 查看手牌詳情 | hover → 側欄 Focus 即時更新 | tap 選中 → 再 tap 或「查看詳情」→ bottom sheet |
| 出牌 | click 手牌直接設置 | tap 選中 → ActionDock「設置這張」 |
| 查看場上卡 | hover 槽位 → 側欄 | tap 槽位 → bottom sheet |
| 撤回設置 | click 已設置槽位（金框提示） | tap 已設置槽位（優先於詳情） |
| 深淵/充能摘要 | click 堆疊 → ZoneSummarySheet | tap 堆疊 → ZoneSummarySheet |
| Log / Status | 側欄常駐（≥1180px）＋頂欄按鈕開 side sheet | 頂欄按鈕 → side sheet |

## 各流程

### 選中 / 取消選中卡牌
- 觸控：tap 手牌 → `selected` 狀態（琥珀實框 + 提起陰影），ActionDock 出現「設置這張」；tap 其他卡切換；階段/回合/ready 變化自動清除選中。
- 桌面：無需選中（click 即出牌）；hover 有金框 playable 呼吸提示。

### 出牌（initialSet / turnSet）
1. `canAct = (step ∈ {initialSet, turnSet}) ∧ !ready ∧ cardsSet < required`（引擎函數推導，UI 不硬編）。
2. initialSet → `setInitialCard(handIndex)`（進戰鬥區蓋牌）；turnSet → `setTurnCard(handIndex, A|B)`（A 佔用則 B）。
3. 設置後卡牌出現在槽位（蓋牌牌背），槽位轉 `undoable`（金框）。

### 設置卡牌撤回
- 未 confirmReady 前：tap/click 已設置的 A/B 槽（或 initialSet 的戰鬥區、本回合設置的 C 槽）→ `undoSetCard(slot)`。
- 已 ready：槽位不可點，ActionDock 顯示「等待對手」。

### 確認出牌
- ActionDock 主按鈕顯示 `確認出牌 (n/required)`；`canConfirm`（達最低張數）才可按。
- 按下 → 短暫「已確認」提示 → `confirmReady()` → 等待對手狀態。

### 選擇目標 / 效果選擇（pendingChoice / effectOrder）
- 置中 Modal 面板（BattleOverlayLayer）：prompt（已翻譯效果文字）+ 選項清單 + `已選 n/max · 至少 min` 即時計數。
- 選項 ≥44px 觸控目標；`reorderOpponentDeckTop` 顯示 #順序。
- min/max 未滿足時送出鈕 disabled（可見原因：計數列）。
- 非當事玩家顯示「等待對方選擇」。

### 攻擊 / 戰鬥
- 戰鬥由引擎在雙方 ready 後自動結算；UI 播放固定序列：公開 → 時間推進 → 戰鬥 → 結果（勝/敗/平 + 傷害），`prefers-reduced-motion` 時縮短。
- HP 變化 / 時鐘推進含明細（breakdown）者為需確認的置中面板；受傷側 PlayerStatus 顯示 `-n` 漂浮數字。

### 查看牌組 / 深淵 / 充能區摘要
- 深淵、充能區（雙方公開資訊）：tap 堆疊 → ZoneSummarySheet（完整卡列 + Power 總值）；sheet 內卡牌可再開詳情。
- 牌組：只顯示張數（資訊隱藏，UI 不提供內容入口）。

### 查看 log
- ≥1180px：右欄常駐（最近 20 條，tone 著色，卡名 chip 可 hover/tap 查看）。
- 其他尺寸：頂欄 Log 按鈕 → side sheet（focus trap、ESC/backdrop 關閉）。

### 階段切換 / 等待對手
- 頂欄階段軌（設置→效果→戰鬥→結算）高亮當前。
- PhaseIndicator 恆常顯示「標題 + 我該做什麼 + 進度 chips」；等待對手時明確顯示「等待對手…」。
- 回合切換：置中 turnStart 通知 + 頂欄回合數更新。

### 操作失敗 / 錯誤提示
- 非法操作在 UI 層預先禁用（disabled 態 + ActionDock 顯示原因）。
- 引擎拒絕（效果失敗等）→ log tone=effect + GameNotice。
- 危險操作（離開對戰）→ AppDrawer 確認對話框（danger 按鈕 + 取消）。

### 網路同步狀態
- NetworkStatusNotifier（全域）：斷線 / 重連 toast。
- 線上計時器：`G.turnStartTime` 伺服器權威；超時自動 `timeoutSkip` 並持續重試至伺服器確認。
- 等待 / loading / error：頁面殼層（OnlineGamePage）既有 LoadingState / ErrorState / 房主等待面板，不在對戰層重複。

## 可訪問性

- 所有互動元件可鍵盤操作（Enter/Space 激活）、可見 focus ring。
- Modal / Sheet：focus trap（useModalFocus）、ESC 關閉、`aria-modal`。
- PhaseIndicator `role=status aria-live=polite`；HP/通知 `aria-live`。
- 觸控目標 ≥44px（smoke 對 ≤767px 全按鈕強制檢查）。
- 蓋牌卡 `aria-label`＝「牌背」，不洩漏資訊。
