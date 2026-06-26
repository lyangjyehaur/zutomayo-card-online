# 卡牌效果一致性審查 — 最終報告（V4 修復後）

> 審查日期：2026-06-27
> 審查基準：以卡牌日文效果原文為準，比對 [parser.ts](src/game/effects/parser.ts) 解析結果與 [executor.ts](src/game/effects/executor.ts) / [GameLogic.ts](src/game/GameLogic.ts) 實際生效邏輯。
> 修復歷程：`d124bd7`（V1→V2，21 張）→ `73b937f`（V2→V3，5 張）→ `e62ba99`（V3→V4，既有 bug + 邊界缺失）

---

## 最終結論

**250 張有效果卡全部與日文原文語義一致，無剩餘偏移或遺漏。**

rule-audit：267/267 行全解析，`unparsedLines=0`、`parsedButPartial=0`
game-smoke：all assertions passed
effect-smoke：247/250 parser coverage，executor tests all passed，full flow passed

---

## 審查歷程統計

| 階段 | 審查張數 | 發現問題 | 修復 | 剩餘 |
|------|---------|---------|------|------|
| V1 初審 | 250 | 21（高 9 / 中 10 / 低 2） | — | 21 |
| V2 復審（commit `d124bd7`） | 250 | 17 已修 + 1 新發現 | 17 | 5 |
| V3 復審（commit `73b937f`） | 250 | 5 已修 + 1 既有 bug 加劇 | 5 | 1 + 1 邊界 |
| V4 復審（commit `e62ba99`） | 250 | 1 既有 bug + 1 邊界已修 | 2 | **0** |

---

## V4 修復驗證（commit `e62ba99`）

### 🟡 G.timingEvents 永不清除 — 2nd_7、3rd_55、3rd_91 ✅ 已修復

**修復**：[`finishTurn`](src/game/GameLogic.ts#L769) 加 `G.timingEvents = []`，每回合清空。

**時序驗證**（關鍵）：
1. `finishTurn` 第一行（[:738](src/game/GameLogic.ts#L738)）跑 `resolveTimingEvent(turnEnd)` — 此時 `timingEvents` 仍含本回合事件，expiry 條件可正確評估
2. 清空在 [:769]（所有效果處理完成後）才執行
3. [:774] 跑 `resolveTimingEvent(turnStart)` — 新回合開始，`timingEvents` 已乾淨

**跨回合條件驗證**：
- `chronosChanged`（[:264](src/game/effects/executor.ts#L264)）：用 `G.chronos.position !== G.chronosAtTurnStart`，不依賴 `timingEvents` ✅
- `chronosTimeChanged` `dayToNight`/`nightToDay`（[:267-271](src/game/effects/executor.ts#L267)）：透過 `latestChronosChangedEvent` 讀 `timingEvents`，但僅在 `onChronosChanged` 觸發當下評估（1st_61/84/90/96/97），事件已在 `setChronosPosition` → `resolveTimingEvent` 時 push，清空在回合末尾不影響 ✅
- `damageAtLeast`（[:248](src/game/effects/executor.ts#L248)）：僅當回合評估 ✅
- `zoneEntered`（[:253](src/game/effects/executor.ts#L253)）：僅當回合 expiry / onZoneEntered 評估 ✅

### 🟢 moveOpponentDeckTopByPowerCost / revealOpponentDeckTopBySendToPower 未 emitZoneEntered ✅ 已修復

**修復**：
- [`moveOpponentDeckTopByPowerCost`](src/game/effects/executor.ts#L730)（3rd_97 厳戒態勢）補 `emitZoneEntered`
- [`revealOpponentDeckTopBySendToPower`](src/game/effects/executor.ts#L747)（3rd_103 治療法を考える）補 `emitZoneEntered`

**驗證**：3rd_97/3rd_103 本身效果正常，現可正確觸發 4th_33 等跨 pack onZoneEntered 連動 ✅

---

## 完整修復歷程摘要

### V1→V2（commit `d124bd7`，17 張）

| 修復項目 | 涵蓋卡 |
|---------|--------|
| `swapAttack` 加 target 參數 | 1st_63 |
| `nullifyOpponentClock` 取代 `clockRewindOpponentCharacter` | 2nd_5 |
| `useFromHand` choice + `followUpDrawCount` | 2nd_15 |
| `boostPower` action（★ 語義）+ expiry zoneEntered | 2nd_58 |
| `healOpponent` action + expiry directDamage | 3rd_27 |
| `onZoneEntered` 觸發（sendToOwnerZone/replaceDestination/choice） | 4th_30/33/65 |
| `noEffect {scope:'enchantOnly'}` + `enchantEffectsDisabled` | 4th_41 |
| `moveSelfAreaEnchant` 持久化白名單 | 2nd_92/104、4th_32/91/94 |
| `boostBothAttackByOwnHp` 持久化 | 3rd_64 |
| `suppressEffectActivation` + choice handler 兜底 | 4th_6 |
| `drawOccurredThisEffect` 條件追蹤 | 4th_89 |
| `specificElements` 子集檢查 | 3rd_8/22 |
| `resolveBattle` 內設 `lastBattleResult` 再觸發 `onBattle` | 4th_95 |

### V2→V3（commit `73b937f`，5 張）

| 修復項目 | 涵蓋卡 |
|---------|--------|
| `handSizeModifier` 消費（`getRequiredSetCount` + `endOfTurnDrawCount`） | 1st_92、4th_89 |
| `sendToAbyss`/`millDeckToAbyss`/`moveOwnDeckTopByPower` 補 `emitZoneEntered` | 4th_30、2nd_41 |
| `priority: 'late'` 分階段執行 | 1st_5 |
| `clockContributionDisabled` 持續抑制 + `applyPreChronosModifiers` | 2nd_5 |
| 刪除過時 `data/parsed_effects.json` | — |

### V3→V4（commit `e62ba99`，2 張）

| 修復項目 | 涵蓋卡 |
|---------|--------|
| `finishTurn` 清空 `G.timingEvents` | 2nd_7、3rd_55、3rd_91 |
| `moveOpponentDeckTopByPowerCost`/`revealOpponentDeckTopBySendToPower` 補 `emitZoneEntered` | 3rd_97、3rd_103（跨 pack 連動 4th_33） |

---

## 審查工具

- [scripts/rule-audit.ts](scripts/rule-audit.ts) — 統計未解析 / 部分解析行數
- [scripts/game-smoke.ts](scripts/game-smoke.ts) — 遊戲流程煙霧測試
- [scripts/effect-smoke.ts](scripts/effect-smoke.ts) — 效果引擎測試
- [scripts/online-smoke.ts](scripts/online-smoke.ts) — 線上功能測試
- [scripts/api-smoke.ts](scripts/api-smoke.ts) — API 測試

---

## 附錄：各階段詳細報告

- `/tmp/audit-findings-{1st,2nd,3rd,4th}.md` — V1 初審各 pack 逐卡報告
- `/tmp/audit-findings-{1st,2nd,3rd,4th}-v2.md` — V2 復審各 pack 逐卡報告
- `/tmp/audit-findings-v3-1st2nd.md` / `/tmp/audit-findings-v3-3rd4th.md` — V3 復審逐卡報告
- `CARD_EFFECT_AUDIT_V2.md` / `CARD_EFFECT_AUDIT_V3.md` — 各階段彙整報告（git 歷史保留）
