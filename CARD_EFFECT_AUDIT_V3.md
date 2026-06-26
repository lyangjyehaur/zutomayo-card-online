# 卡牌效果一致性審查報告 V3（V3 修復後復審）

> 審查日期：2026-06-27
> 審查基準：以卡牌日文效果原文為準，比對 [parser.ts](src/game/effects/parser.ts) 解析結果與 [executor.ts](src/game/effects/executor.ts) / [GameLogic.ts](src/game/GameLogic.ts) 實際生效邏輯。
> 對應修復 commit：`73b937f fix(v2): 修復 V2 審計剩餘 5 個問題`

---

## 審查範圍

| Pack | 審查張數 | V2 剩餘 | V3 已修復 | 仍有問題 |
|------|---------|---------|-----------|----------|
| 1st (THE WORLD IS CHANGING) | 48 | 2 | 2 | 0 |
| 2nd (ALL ALONG THE WATCHTOWER) | 72 | 2 | 2 | 0 |
| 3rd (Off Minor) | 68 | 0 | 0 | 1（既有問題，V3 加劇） |
| 4th (Fantasy Is Reality) | 62 | 1 | 1 | 0 |
| **合計** | **250** | **5** | **5** | **1**（既有 bug） |

rule-audit 結果：267/267 行全解析，`unparsedLines=0`、`parsedButPartial=0`。

---

## V2 剩餘問題修復驗證（5 張全修）

### 🔴 handSizeModifier 消費 — 1st_92 + 4th_89 ✅ 已修復

**V3 修復**：
- [`getRequiredSetCount`](src/game/GameLogic.ts#L357) 加 `G.handSizeModifier?.[player]`（game duration → 設置卡數）
- [`endOfTurnDrawCount`](src/game/GameLogic.ts#L723) = `cardsSetThisTurn + G.modifiers.handSize?.[player]`（battle duration → 回合抽牌數）
- `finishTurn` 用 `drawCounts` 抽牌（[:747](src/game/GameLogic.ts#L747)）

**驗證**：
- 1st_92（battle duration）寫 `G.modifiers.handSize`，由 `endOfTurnDrawCount` 消費 → 該回合抽牌 +1 ✅
- 4th_89（game duration）寫 `G.handSizeModifier`，由 `getRequiredSetCount` 消費 → 後續每回合可設置卡數 +1 ✅
- battle / game duration 分流設計正確，與原文語義一致

### 🟡 zoneEntered 補全 — 4th_30 + 2nd_41 ✅ 已修復

**V3 修復**：
- [`sendToAbyss`](src/game/effects/executor.ts#L676)、[`millDeckToAbyss`](src/game/effects/executor.ts#L695)、[`moveOwnDeckTopByPower`](src/game/effects/executor.ts#L711) 加 `emitZoneEntered`
- 透過 `context.onTimingEvent` 回呼 `resolveTimingEvent`，正確傳遞至 `resolvePendingEffect` 與 `resolveTimingEvent` 路徑

**驗證**：
- 4th_30（對手 abyss 入卡觸發 onZoneEntered）：`sendToAbyss`/`millDeckToAbyss` 路徑現會觸發 ✅
- 2nd_41（`moveOwnDeckTopByPower` 送入 powerCharger/abyss）：兩處 `emitZoneEntered` 已補 ✅
- `processTurnEffects` 路徑未傳 `onTimingEvent`，但僅影響 `scripts/game-smoke.ts`，實際遊戲走 `resolvePendingEffect` 有傳 ✅

### 🟢 ※優先序規則 — 1st_5 ✅ 已修復

**V3 修復**：
- [parser.ts](src/game/effects/parser.ts#L60) 偵測 `※相手のエンチャント発動のち有効` 加 `priority: 'late'`
- [`collectTurnEffects`](src/game/effects/executor.ts#L435) 排序 late 在後
- [`processTurnEffects`](src/game/effects/executor.ts#L1314) 分 normal/late 兩階段執行
- [`nextPendingEffectPlayer`](src/game/GameLogic.ts#L816)/[`resolvePendingEffect`](src/game/GameLogic.ts#L863) 分階段處理

**驗證**：1st_5 parsed 結構含 `priority: 'late'`，兩階段執行邏輯正確，late 效果延後到 normal 之後結算 ✅

### 🟢 clockReset 語義 — 2nd_5 ✅ 已修復

**V3 修復**：
- [`nullifyOpponentClock`](src/game/effects/executor.ts#L601) 設 `G.modifiers.clockContributionDisabled[opponent]=true` 並 rewind 已推進量
- [`applyPreChronosModifiers`](src/game/GameLogic.ts#L456) 在 `advanceChronos` 前掃描 setCardsThisTurn + setZoneC 卡，預設 modifier
- [`advanceChronos`](src/game/GameLogic.ts#L434) 跳過被禁玩家的 Character clock

**驗證**：
- 出卡當回合：executor 設 modifier + rewind 已推進量 ✅
- 後續回合（expiry 前）：`applyPreChronosModifiers` 掃 setZoneC 預設 modifier，`advanceChronos` 持續跳過 ✅
- expiry 後卡牌離場，modifier 不再被設定 ✅
- 冪等保護：`wasDisabled` 檢查避免重複 rewind ✅

---

## 剩餘問題（1 張，既有 bug，V3 加劇）

### 🟡 G.timingEvents 永不清除 — 影響 2nd_7、3rd_55、3rd_91

**問題本質**：
- [`G.timingEvents`](src/game/types.ts#L285) 只在 `setupGame` 初始化為空，之後只有 `push`（[executor.ts:48](src/game/effects/executor.ts#L48)、[GameLogic.ts:513](src/game/GameLogic.ts#L513)、[GameLogic.ts:598](src/game/GameLogic.ts#L598)），**從不清除**。
- `zoneEntered` 條件（[executor.ts:253](src/game/effects/executor.ts#L253)）用 `G.timingEvents.some(...)` 檢查，因此一旦對手做過對應動作，**之後每回合**條件都會成立。
- V3 的 `emitZoneEntered` 補全讓更多路徑產生 zoneEntered 事件，**加劇**了這個問題。

**受影響卡**（onTurnEnd + zoneEntered 條件的 expiry）：

| 卡號 | 卡名 | 原文 expiry 條件 | 預期行為 | 實際行為 |
|------|------|-----------------|---------|---------|
| 2nd_7 | 風をあつめて | 相手がエリアエンチャントを出したターンの終了時にアビスに置く | 僅對手出 Area Enchant 那回合 turnEnd 觸發 | 對手曾出過 Area Enchant 後，每回合 turnEnd 都觸發 |
| 3rd_55 | 適当ラリーもう終わり | 相手がアビスにカードを置いたターンの終了時にパワーチャージャーに置く | 僅對手 abyss 入卡那回合 turnEnd 觸發 | 對手 abyss 曾入卡後，每回合 turnEnd 都觸發 |
| 3rd_91 | 被験者 | 相手がアビスにカードを置いたターンの終了時にパワーチャージャーに置く | 同 3rd_55 | 同 3rd_55 |

**修復建議**：在 `finishTurn` 清空 `G.timingEvents`，或改為 `zoneEntered` 條件只檢查「本回合」事件（需為 `timingEvents` 加 `turnNumber` 欄位並在 evaluateCondition 過濾）。

---

## 邊界互動缺失（低嚴重，不影響原問題卡）

### 🟢 moveOpponentDeckTopByPowerCost / revealOpponentDeckTopBySendToPower 未 emitZoneEntered

- [`moveOpponentDeckTopByPowerCost`](src/game/effects/executor.ts#L721)（3rd_97）與 [`revealOpponentDeckTopBySendToPower`](src/game/effects/executor.ts#L734)（3rd_103）把卡送進 powerCharger 時未 `emitZoneEntered`。
- 若與 4th_33（powerCharger 入卡觸發 onZoneEntered）同場，4th_33 不會被這兩個路徑觸發。
- 3rd_97/3rd_103 本身效果正常，僅跨 pack 連動缺失。

---

## V3 修復 commit 技術摘要

commit `73b937f` 主要改動：

### 新增欄位
- `CombatModifiers.clockContributionDisabled: [boolean, boolean]`
- `ParsedEffect.priority?: 'late'`

### 核心機制改動
- **handSizeModifier 消費**：`getRequiredSetCount` + `endOfTurnDrawCount` 讀取修飾量
- **zoneEntered 補全**：`sendToAbyss`/`millDeckToAbyss`/`moveOwnDeckTopByPower` 加 `emitZoneEntered`，透過 `context.onTimingEvent` 回呼
- **priority 分階段**：`collectTurnEffects` 排序、`processTurnEffects`/`nextPendingEffectPlayer`/`resolvePendingEffect` 分 normal/late 兩階段
- **clockContributionDisabled**：`nullifyOpponentClock` 設 modifier + rewind；`applyPreChronosModifiers` 在 `advanceChronos` 前預設；`advanceChronos` 跳過被禁玩家
- `EffectExecutionContext` 加 `onTimingEvent?: (event) => void`
- 刪除過時的 `data/parsed_effects.json`

### 清理
- 刪除 `data/parsed_effects.json`（過時快照）

---

## 修復優先建議

| 優先 | 項目 | 涵蓋卡 | 說明 |
|------|------|--------|------|
| 1 | 修 `G.timingEvents` 永不清除 | 2nd_7、3rd_55、3rd_91 | 在 `finishTurn` 清空，或為事件加 `turnNumber` 過濾 |
| 2 | 補 `moveOpponentDeckTopByPowerCost`/`revealOpponentDeckTopBySendToPower` 的 `emitZoneEntered` | 3rd_97、3rd_103（跨 pack 連動 4th_33） | 與 V3 補全風格一致 |

---

## 附錄：審查工具與資料

- [scripts/audit-dump.ts](scripts/audit-dump.ts) — dump 每張卡日文原文 + 即時 parser 輸出
- [scripts/rule-audit.ts](scripts/rule-audit.ts) — 統計未解析 / 部分解析行數
- `/tmp/audit-findings-v3-1st2nd.md` — 1st + 2nd pack 逐卡詳細報告
- `/tmp/audit-findings-v3-3rd4th.md` — 3rd + 4th pack 逐卡詳細報告
- `/tmp/audit-dump-v3.json` — V3 完整 dump 資料
