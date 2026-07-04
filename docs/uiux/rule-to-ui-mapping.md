# 官方規則 → UI 狀態映射表（Rule-to-UI Mapping）

> 規則來源：`docs/rules/official-start-guide-ui-analysis.md`
> 元件來源：`src/ui/game/`；互動細節：`docs/uiux/interaction-flow.md`

| 官方規則 / 概念 | UI 呈現 | 互動方式 | 狀態提示 | 響應式處理 |
|---|---|---|---|---|
| Deck 20 cards | `DeckZone`（牌背堆疊＋剩餘數） | 不可檢視（資訊隱藏） | 張數常駐；低張數即敗北風險由玩家讀數判斷 | 全斷點顯示；橫屏隱藏文字 label 保留數字 |
| 初始 5 張手牌 | MulliganScreen 手牌列 | 點選要重抽的卡 | 選中 ring；完成後「等待對手」 | 橫向捲動，觸控目標 ≥44px |
| 引き直し / mulligan | MulliganScreen（浮層） | 「重抽 N 張」/「保留手牌」雙按鈕 | 已確認顯示等待態 | 手機全寬面板 |
| HP 100 | `PlayerStatus` bar（雙方） | 唯讀 | ≤50 warning、≤25 danger 變色；受傷 `-n` 漂浮 | 所有斷點常駐可見 |
| HP 0 敗北 | GameOverScreen | 結果頁主行動（再戰/回大廳） | VICTORY/DEFEAT + 原因（HP 歸零） | 全斷點 |
| Chronos 起始位置（真夜中） | `ChronosDial` 18 段分段環＋游標 | 唯讀 | 位置 n/18 + 時段名 | 桌面大儀表→手機緊湊儀表，位置永遠可讀 |
| Chronos 夜/晝 | 錶盤雙弧：夜=青 `--time-night`、晝=紅 `--time-day`（官方配色） | 唯讀 | 頂欄 🌙/☀️ + 全場晝夜色偏移（chrono-night/day） | 同上 |
| 卡牌時計値推進 Chronos | GameNotice「時鐘推進」含明細（各卡貢獻） | 確認按鈕關閉 | from→to 位置與晝夜變化 | 置中面板，全斷點 |
| Character NIGHT/DAY 攻擊力 | 卡面詳情（CardDetail）雙値 + `BattleZone` 生效値 | hover / tap 開詳情 | 生效側著色（夜青/晝紅） | 詳情桌面側欄 / 觸控 bottom sheet |
| Power Cost 不足 → 攻擊力/效果不成立 | `BattleZone` 讀數顯示 0＋「PW不足」；效果 log `effectFailed` | 唯讀 | danger 色警示 | 全斷點 |
| SEND TO POWER | CardDetail「STP」欄；ZoneSummarySheet 每張標 STP | 唯讀 | — | — |
| Power Charger | `ChargeZone`：堆疊縮圖＋「總 Power N」 | 點擊開 ZoneSummarySheet 檢視來源卡 | 總値 accent 色 | 桌/平/手皆為堆疊+總値 |
| Abyss | `AbyssZone`：堆疊＋張數 | 點擊開 ZoneSummarySheet | — | 同上 |
| Battle Zone | `BattleZone`：卡槽＋常駐攻擊力讀數，居中與 Chronos 並列 | 觸控 tap 開詳情；initialSet 可點擊撤回 | undoable 金框；攻擊力比較一眼可見 | lg→md 槽位降級，讀數不省略 |
| Set Zone A | `SetZone slot="A"` hint「設置①」 | 未 ready 可點撤回 | undoable 呼吸框 | md→sm 降級 |
| Set Zone B | `SetZone slot="B"` hint「設置②・敗者」 | 同上（僅敗者回合可用，出牌上限由引擎控制） | 同上 | 同上 |
| Set Zone C | `SetZone slot="C"` hint「持續附魔」，虛線＋青色 | 本回合設置才可撤回 | 與 A/B 視覺區隔（跨回合常駐語義） | 同上 |
| Area Enchant | 進場動畫至 C 區；CardDetail 標類型 | — | C 區持續存在=效果持續 | — |
| 1 回合目準備流程 | Janken 浮層 → Mulligan 浮層 → initialSet（手牌→BattleZone 蓋牌） | 各步驟唯一主行動 | PhaseIndicator 逐步指示 | 全斷點浮層 |
| 2 回合目以後 set/reveal/chronos/battle/draw | PhaseIndicator + 頂欄階段軌（設置→效果→戰鬥→結算）＋固定結算動畫序列（公開→時間推進→戰鬥→結果） | 設置期出牌/撤回/確認 | 出牌數 n/required・至少 min chips | 手機階段軌隱藏、PhaseIndicator 精簡 |
| 出牌數：勝1/敗2/平手1 | ActionDock「確認出牌 (n/required)」；required 由引擎 `getRequiredSetCount` | 達 min 才可確認 | 進度 chips done 變綠 | 全斷點 |
| 牌組無法抽牌時敗北 | GameOverScreen 原因「牌組耗盡」 | — | DeckZone 張數為預警 | — |
| 效果處理（メダル側先） | EffectOrderPanel（置中 overlay） | 當事玩家逐項選擇結算順序 | 非當事玩家顯示等待 | 觸控目標 ≥44px |
| 效果目標選擇 | PendingChoicePanel | 選項多選 + min/max 校驗 | 「已選 n/max・至少 min」 | 同上 |
