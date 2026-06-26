# 卡牌效果一致性審查報告 V2（修復後復審）

> 審查日期：2026-06-27
> 審查基準：以卡牌日文效果原文為準，比對 [parser.ts](src/game/effects/parser.ts) 解析結果與 [executor.ts](src/game/effects/executor.ts) / [GameLogic.ts](src/game/GameLogic.ts) 實際生效邏輯。
> 對應修復 commit：`d124bd7 fix(audit): 修復 21 個卡牌效果問題`

---

## 審查範圍

| Pack | 審查張數 | 原問題 | 已修復 | 仍有問題 |
|------|---------|--------|--------|----------|
| 1st (THE WORLD IS CHANGING) | 48 | 2 | 1 | 1 + 1 新發現 |
| 2nd (ALL ALONG THE WATCHTOWER) | 72 | 5 | 4 | 1 + 1 邊界 |
| 3rd (Off Minor) | 68 | 4 | 4 | 0 |
| 4th (Fantasy Is Reality) | 62 | 10 | 8 | 2 |
| **合計** | **250** | **21** | **17** | **5**（含 1 新發現） |

rule-audit 結果：267/267 行全解析，`unparsedLines=0`、`parsedButPartial=0`。

---

## ⚠️ 重要前置說明

[data/parsed_effects.json](data/parsed_effects.json) 是**過時快照**（舊 schema 如 `forceAttackValue`/`sendToAbyss`/`revealTopDeck`），與目前 parser 實際產出（`forceOwnAttackTime`/`moveSelfAreaEnchant`/`revealOpponentHand`）完全不符。本審查以即時 parser 輸出為準，**強烈建議刪除或重新生成該檔**以免誤導後續開發。

---

## 剩餘問題清單（5 張）

### 🔴 高嚴重度（1 張，影響 2 卡）

#### handSizeModifier 從未被消費 — 1st_92 妙薬の調合 + 4th_89 アブダクション

- **1st_92 原文**：`デッキから１枚カードを引き、手札に加える\n※このカードを使用後、手札の数はバトル終了まで１枚増える`
- **4th_89 原文**：`バトルゾーンのカードが（TAIDADA）のキャラクターなら、カードを１枚引く。\nこのカードの効果でカードを引いたなら、手札の数はゲーム終了まで１枚増える`

**問題**：
- [executor.ts:779-788](src/game/effects/executor.ts#L779) 寫入 `G.handSizeModifier[player]`（game 期間）和 `G.modifiers.handSize[player]`（battle 期間），但**全專案從未讀取這兩個欄位**。
- `getRequiredSetCount`（[GameLogic.ts:355](src/game/GameLogic.ts#L355)）只讀 `extraSettableCards`，回合結束抽牌（[GameLogic.ts:711](src/game/GameLogic.ts#L711)）只抽 `cardsSetThisTurn` 張。
- 兩張卡的「手札の数は…増える」效果**完全無效**。

**誤判紀錄**：原審查 V1 誤判 1st_92 為正確（只驗證 parser 保留 `※` 行，未驗證 executor 消費）。本次復審發現此遺漏。

**附帶說明**：4th_89 的 `drawOccurredThisEffect` 條件追蹤已正確實作（commit 修復項），條件本身運作正常，問題僅在 handSizeModifier action 本身是 dead write。

**修復建議**：在 `getRequiredSetCount` 或回合結束抽牌邏輯讀取 `G.handSizeModifier` + `G.modifiers.handSize`，增加可設置卡數 / 抽牌數。

---

### 🟡 中嚴重度（1 張）

#### 4th_30 I'm CREAMY!!? — 部分修復

- **原文**：`相手のアビスにカードが置かれたとき、すぐにこのカードをアビスに置く`

**問題**：
- `onZoneEntered` 觸發已在 `sendToOwnerZone`、`replaceDestination`、choice abyss/powerCharger 等路徑接好（commit 修復項），主要場景已生效。
- 但 [`sendToAbyss`](src/game/effects/executor.ts#L638) 和 [`millDeckToAbyss`](src/game/effects/executor.ts#L645) 兩個 action 直接 `opponent.abyss.push(card)` **未呼叫 `resolveTimingEvent({type:'zoneEntered'...})`**。
- 若對手 abyss 入卡是透過這兩個 action（例如其他卡效果把對手角色送進 abyss、或磨對手牌進 abyss），4th_30 的反應式效果不會觸發。

**修復建議**：在 executor 這兩個 case 的 `abyss.push` 後呼叫 `resolveTimingEvent`。需傳入 `parsedEffects` 與 `G`，可能要調整 executor 簽名或改為 push 到 `G.timingEvents` 佇列由主迴圈消費。

---

### 🟢 低嚴重度（3 張）

#### 1st_5 しゃくま男（ヒューマノイド）— ※規則未實作

- **原文**：`相手の攻撃力を昼夜逆転する ※相手のエンチャント発動のち有効`
- **狀態**：主效果 `swapAttack` 目標正確（commit 確認 target=opponent）。`※相手のエンチャント発動のち有効` 優先序規則仍被 parser strip 丟棄，executor 無延後結算機制。commit 未觸及此項。
- **影響**：實務上依日夜優先序執行，多數情況結果正確，僅在與對手エンチャント同時區結算時可能順序偏差。

#### 2nd_5 グレイヌの一服 — 語義微妙偏移

- **原文**：`相手のキャラクターカードの時計を無効にする。昼と夜が入れ替わったターンの終了時にアビスに置く`
- **狀態**：commit 以 `nullifyOpponentClock` 取代舊 `clockRewindOpponentCharacter`，行為是扣減對手本回合 Character clock 總和（[executor.ts:574-581](src/game/effects/executor.ts#L574)）。
- **偏移**：原文「無効にする」是持續語義，實作只做一次扣減。單回合內功能近似，但若對手後續出 Character 卡，無法持續無效化。
- **修復建議**：改為抑制 clock 推進的 modifier 機制，或接受此近似。

#### 2nd_41 邊界互動 — moveOwnDeckTopByPower 未觸發 zoneEntered

- **狀態**：[`moveOwnDeckTopByPower`](src/game/effects/executor.ts#L666) 送入 powerCharger 時未呼叫 `resolveTimingEvent`，若與 2nd_58 同場會漏偵測此路徑的 Character 入場。
- **影響**：僅在特定卡牌組合下觸發，非阻斷。

---

## 已正確修復清單（17 張）

### 🔴 原高嚴重度（8 張全修）

| 卡號 | 卡名 | 修復內容 | 驗證結果 |
|------|------|---------|---------|
| 1st_63 | ふわふわの猫 | `swapAttack` 加 `target:'self'`，executor 依此反轉自己 | ✅ [executor.ts:558-563](src/game/effects/executor.ts#L558) |
| 2nd_5 | グレイヌの一服 | `nullifyOpponentClock` 扣減對手 Character clock（語義偏移見上） | ✅ 功能近似 |
| 2nd_15 | アカシュモクザメ遊具 | `useFromHand` choice + `followUpDrawCount` | ✅ 追加エンチャント + 抽牌皆實作 |
| 2nd_58 | 開店準備 | `boostPower` 寫 `sendToPower` + expiry zoneEntered | ✅ ★ 語義正確 |
| 3rd_27 | 惨めな解放だ | `healOpponent` + expiry `directDamage` | ✅ 補對手 + 打對手，trigger 正確 |
| 4th_33 | 終わりからの始まり | `zoneEntered` powerCharger 觸發 | ✅ |
| 4th_41 | インク猫 | `noEffect {scope:'enchantOnly'}` + `enchantEffectsDisabled` | ✅ [executor.ts:1250-1255](src/game/effects/executor.ts#L1250) 只禁 Enchant 類型卡 |
| 4th_65 | JK BIOSCOPE | `zoneEntered` battleZone 觸發（replaceDestination） | ✅ |

### 🟡 原中嚴重度（8 張全修）

| 卡號 | 卡名 | 修復內容 | 驗證結果 |
|------|------|---------|---------|
| 2nd_92 | 晩餐会 | `moveSelfAreaEnchant` 持久化 | ✅ 跨回合條件生效 |
| 2nd_104 | 荒廃した世界 | `moveSelfAreaEnchant` 持久化 | ✅ 同 2nd_92 |
| 3rd_64 | おそろのケータイ | `boostBothAttackByOwnHp` 持久化 | ✅ 跨回合加成 |
| 4th_6 | にらちゃん（海馬成長痛） | `suppressEffectActivation` + choice handler 兜底 | ✅ 行為正確 |
| 4th_32 | 継ぎ接ぎなメモ | `moveSelfAreaEnchant` 持久化 | ✅ 跨回合條件生效 |
| 4th_89 | アブダクション | `drawOccurredThisEffect` 條件追蹤 | ✅ 條件正確（action 本身 dead write 見上） |
| 4th_91 | 反撃の一打 | `moveSelfAreaEnchant` 持久化 | ✅ 跨回合條件生效 |
| 4th_94 | 捜索中！ | `moveSelfAreaEnchant` 持久化 | ✅ 跨回合條件生效 |

### 🟢 原低嚴重度（2 張全修）

| 卡號 | 卡名 | 修復內容 | 驗證結果 |
|------|------|---------|---------|
| 3rd_8 | メイドにらと執事にら | `specificElements` 子集檢查 | ✅ [executor.ts:161](src/game/effects/executor.ts#L161) `[...required].every(e => actual.has(e))` 子集語義正確 |
| 3rd_22 | にらちゃん（ハゼ馳せる果てるまで） | 同 3rd_8 | ✅ |

### onBattle 時序修正

| 卡號 | 卡名 | 修復內容 | 驗證結果 |
|------|------|---------|---------|
| 4th_95 | 笑えないジョーク | `resolveBattle` 內先設 `lastBattleResult` 再觸發 `onBattle` | ✅ [GameLogic.ts:630-632](src/game/GameLogic.ts#L630) 時序正確 |

---

## 修復 commit 技術摘要

commit `d124bd7` 主要改動：

### 新增 ActionType
- `boostPower`：`★` 語義，寫入 `G.modifiers.sendToPower`
- `healOpponent`：補對手 HP
- `nullifyOpponentClock`：扣減對手 Character clock

### 新增 ConditionType
- `specificElements`：列舉特定屬性集子集檢查
- `drawOccurredThisEffect`：本卡效果曾抽牌（用 `context.cardInstanceId` 追蹤）

### 新增 State 欄位
- `CombatModifiers.sendToPower` / `enchantEffectsDisabled`
- `GameState.drawEffectCardIdsThisTurn` / `drawOccurredThisEffect`

### 核心機制改動
- `swapAttack` executor 加 `target` 參數（self/opponent）
- `noEffect` 加 `scope: 'enchantOnly'` 參數
- `areEffectsDisabledForCard` 函式：`effectsDisabled` 禁所有；`enchantEffectsDisabled` 只禁 Enchant 類型卡
- `onZoneEntered` 觸發：GameLogic 在 `sendToOwnerZone`、`replaceDestination`、choice abyss/powerCharger 入場時呼叫 `resolveTimingEvent({type:'zoneEntered'...})`
- `isPersistentAreaEnchantEffect` 白名單擴充：`moveSelfAreaEnchant`、`boostBothAttackByOwnHp`、`boostPower`
- `getPlayerPower` 簽名改為 `(player, G?, playerIndex?)`，加總 `sendToPower` modifier
- `executeEffect` 新增 `context: {cardInstanceId?}` 參數，傳遞到 `evaluateCondition`
- `resolveBattle` 內先設 `lastBattleResult` 再觸發 `onBattle` 事件
- `handSizeModifier` parser 加 `drawOccurredThisEffect` 條件

---

## 修復優先建議

| 優先 | 項目 | 涵蓋卡 | 說明 |
|------|------|--------|------|
| 1 | 修 handSizeModifier 消費 | 1st_92、4th_89 | 在 `getRequiredSetCount` 或回合抽牌邏輯讀取修飾量 |
| 2 | 補 sendToAbyss/millDeckToAbyss zoneEntered 觸發 | 4th_30 | executor 這兩個 case 的 `abyss.push` 後觸發事件 |
| 3 | 刪除/重新生成 `data/parsed_effects.json` | — | 零風險清理過時快照 |
| 4 | 低嚴重三項（1st_5 ※、2nd_5 語義、2nd_41 邊界） | — | 可暫緩 |

---

## 附錄：審查工具

- [scripts/audit-dump.ts](scripts/audit-dump.ts) — dump 每張卡日文原文 + 即時 parser 輸出
- [scripts/rule-audit.ts](scripts/rule-audit.ts) — 統計未解析 / 部分解析行數
- `/tmp/audit-findings-{1st,2nd,3rd,4th}-v2.md` — 各 pack 逐卡詳細報告（含程式碼位置）
