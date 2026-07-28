# 互動流程（Interaction Flow）

> 實作：`src/components/Board.tsx`（流程編排）＋ `src/ui/game/`（元件）
> 原則：玩家永遠知道「現在該做什麼」（PhaseIndicator + ActionDock 提示雙保險）；
> 所有可操作狀態有明確視覺（design-system.md §3.1 四態）；觸控端零 hover 依賴。

## 裝置互動模型

| 動作          | 桌面（fine pointer）                       | 觸控（coarse / 非桌面佈局）                    |
| ------------- | ------------------------------------------ | ---------------------------------------------- |
| 查看手牌詳情  | hover → 側欄 Focus 即時更新                | tap 選中 → 再 tap 或「查看詳情」→ bottom sheet |
| 出牌          | click 手牌直接設置                         | tap 選中 → ActionDock「設置這張」              |
| 查看場上卡    | hover 槽位 → 側欄                          | tap 槽位 → bottom sheet                        |
| 撤回設置      | click 已設置槽位（金框提示）               | tap 已設置槽位（優先於詳情）                   |
| 深淵/充能摘要 | click 堆疊 → ZoneSummarySheet              | tap 堆疊 → ZoneSummarySheet                    |
| Log / Status  | 側欄常駐（≥1180px）＋頂欄按鈕開 side sheet | 頂欄按鈕 → side sheet                          |

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

- 效果互動必須等前置時計／HP／戰鬥結算時間線完全播放後才開放，不以固定延遲猜測動畫完成時間。
- 只有一個合法下一步的效果會自動發動，不顯示只有單一按鈕的效果順序面板；同一張卡的多段效果依卡面順序自動接續。兩個以上不同來源效果同時可發動時，才顯示效果順序面板。
- 真正需要玩家決策的 `pendingChoice`（選卡、選目標、可選支付、指定時計位置等）仍顯示 BattleOverlayLayer：prompt（已翻譯效果文字）+ 選項清單 + `已選 n/max · 至少 min` 即時計數。
- 選項 ≥44px 觸控目標；`reorderOpponentDeckTop` 顯示 #順序。
- min/max 未滿足時送出鈕 disabled（可見原因：計數列）。
- 非當事玩家顯示「等待對方選擇」。
- `clockPosition` 是唯一例外：不列出 `0–17` 數字選項；玩家直接點擊 Chronos 錶盤上的 18 個刻度，選中刻度脈衝提示，並在緊湊確認面板送出。錶盤刻度維持 ≥44px 點擊目標。

### 攻擊 / 戰鬥

- 戰鬥由引擎在雙方 ready 後自動結算；UI 播放固定序列：公開 → 時計推進 → 攻擊力比較 → 卡牌交鋒 → HP 傷害，`prefers-reduced-motion` 時改為靜態摘要。
- 時計推進採非阻塞序列：全部卡牌先同時浮出時計值 → 逐張數字飛向 Chronos → 徽章逐格推進 → 下一張，最後短暫顯示合計。
- 結算節奏優先保障可讀性：時計數值的移動保持連續，但卡牌總覽、最終時計合計、攻擊力公式與 HP 起訖結果使用較長的靜止停留；不要求玩家依賴回合記錄才能看懂剛才的結算。
- 卡牌效果直接操作 Chronos 時不套用時計合計動畫：先高亮效果來源卡並浮出操作提示；「推進」讓徽章逐格順時針移動，「回溯」逐格逆時針移動，「指定位置」先標示目標刻度，再讓徽章直接移至目標。`+18/-18` 即使終點不變也完整播放 18 格並觸發時計變更事件。可見文案只說明移動格數或「指定位置」，不顯示虛構的具體時刻數字，也不另開中央 Chronos 通知。
- 手動效果、延遲效果與回合開始／結束自動觸發的 Chronos 操作共用同一套規則事件、來源歸因與動畫路徑；連鎖 Chronos 效果依觸發因果順序排隊。
- 一般對戰由單一 resolution timeline 依 `recentGameNotices.id` 逐筆播放時計、戰鬥、效果 HP／時計與回合開始提示；任何時刻只會有一個結算 renderer 活動，後發生的回合結束效果不得插隊到戰鬥之前。
- 每筆戰鬥 notice 保存所屬回合、雙方卡牌、勝負、攻擊力、傷害與 HP 起訖快照。即使規則狀態已進入後一回合並換上新卡，佇列中的前一回合動畫仍以自己的快照播放，不讀取後續 `lastBattleResult`。
- `BattleResolutionLayer` 等待時計演出完成後，在雙方戰鬥區亮起實際攻擊力；有修正時先顯示「基礎攻擊力 ± 修正 → 實際攻擊力」，Power 不足時顯示「卡面攻擊力 → 0／充能不足」。接著顯示「勝方攻擊力 − 敗方攻擊力 = 原始傷害」，公式收起後再以攻擊軌跡／命中提示結果（卡牌本身不位移）。若有減傷，來源卡護盾與攻擊軌跡同時發動。傷害階段前 PlayerStatus 暫時保留扣血前數值；進入傷害階段才閃紅、倒數 HP、縮短主血條並以延遲紅色殘影呈現損失量，同時顯示最終傷害與 `HP before → after`。一般對戰不另開中央 HP 明細窗；教學手動確認流程維持既有面板。
- 減傷不與攻擊公式同時堆疊數字：原始傷害公式收起後，攻擊軌跡出現的同時，實際提供減傷的來源卡以藍色護盾框高亮，連線指向受擊方並只顯示一次「減傷 N」；最後傷害階段以 `原始傷害 − 減傷 = 最終傷害` 收束計算並顯示 `HP before → after`，其中原始值與運算符為中性色、減傷值為護盾藍、最終傷害為紅色（0 傷害則為護盾藍）。沒有減傷時只顯示單一最終傷害，不產生 `N − 0 = N`。戰鬥 notice 保存來源卡實例、定義與實際套用值，跨回合延遲播放仍按當時快照歸因。
- 遊戲結束時，結果頁以最後 notice ID 和時間線完成回報握手；最後一批 Chronos／戰鬥／HP 動畫全部 drain 且場上位移動畫 idle 後才切換結果頁，不使用固定秒數強制中斷。
- 特殊結果分流：普通平手只顯示 `A = B／勢均力敵`，不播放命中；差值傷害被全數減免時仍依序顯示原始傷害與來源減傷，最後以 `原始傷害 − 減傷 = 0 傷害` 收束，命中改為護盾效果且不閃紅或倒數 HP；雙方實際攻擊力皆為 0 時顯示 `0 = 0／攻擊未成立`；負修正一律顯示為 `基礎 − 修正值 → 實際`，不得出現 `+ -N`。

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
