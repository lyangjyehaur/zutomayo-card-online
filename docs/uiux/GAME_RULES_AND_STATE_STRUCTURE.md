# ZUTOMAYO CARD — 完整遊戲規則與狀態結構文檔

**目的**：為 UI 重建提供遊戲語義參考。所有欄位、回合流程、選擇機制已從源代碼萃取並標注來源。  
**作成日期**：2026-07-04  
**來源覆蓋**：rules.md、README.md、types.ts、Game.ts、chronos.ts、pendingChoices.ts、gameNotices.ts、actionLog.ts、effects/types.ts

---

## A. 遊戲區域完整清單

遊戲棋盤分為雙方各自的區域和全局區域。下表詳列每個區域的規則含義、資料欄位名、可見性及容量限制。

| #   | 區域名稱 | 英文名        | 所有者 | 資料欄位                                                      | 卡牌狀態                               | 容量                                    | 規則含義                                                                                                                |
| --- | -------- | ------------- | ------ | ------------------------------------------------------------- | -------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | 牌組     | Deck          | 各玩家 | `players[0/1].deck: CardInstance[]`                           | 通常蓋牌（背面），必要時翻牌           | 無限制（初始 20 張）                    | 抽牌的來源；磨牌目標；部分效果指定目標                                                                                  |
| 2   | 手牌     | Hand          | 各玩家 | `players[0/1].hand: CardInstance[]`                           | 己方可見，對方隱藏（除非特殊效果揭示） | 通常 5~8 張，受 `handSizeModifier` 影響 | 出牌選擇的來源；部分效果可從手牌移動卡牌                                                                                |
| 3   | 戰鬥區   | Battle Zone   | 各玩家 | `players[0/1].battleZone: CardInstance \| null`               | 公開可見（面朝上）                     | **最多 1 張 Character**                 | 當前戰鬥的角色；決定攻擊力與攻擊時間；離場時進 Power Charger 或 Abyss                                                   |
| 4   | 設置區 A | Set Zone A    | 各玩家 | `players[0/1].setZoneA: CardInstance \| null`                 | 等待公開（初始蓋牌）                   | **最多 1 張**                           | 本回合設置的卡牌（通常是 Character 或 Enchant）；回合中攻擊力比較後若勝利進 Battle Zone；若敗負則進 Power Charger/Abyss |
| 5   | 設置區 B | Set Zone B    | 各玩家 | `players[0/1].setZoneB: CardInstance \| null`                 | 等待公開（初始蓋牌）                   | **最多 1 張**                           | 本回合設置的第二張卡牌（敗者回合可出 2 張牌，其中一張進 B）；優先度低於 A（同時有 Character 時 A 優先進場）             |
| 6   | 設置區 C | Set Zone C    | 各玩家 | `players[0/1].setZoneC: CardInstance \| null`                 | 公開可見（面朝上）                     | **最多 1 張 Area Enchant**              | 生效中的區域附魔，跨回合持續；進場時舊卡離場；不計入戰鬥對比                                                            |
| 7   | 充能區   | Power Charger | 各玩家 | `players[0/1].powerCharger: CardInstance[]`                   | 公開可見                               | 無限制                                  | 離場卡牌的 SEND TO POWER 值累積；部分效果可取用                                                                         |
| 8   | 深淵     | Abyss         | 各玩家 | `players[0/1].abyss: CardInstance[]`                          | 公開可見                               | 無限制                                  | 無 SEND TO POWER 的卡牌最終送達地；部分效果可指定選取；隱喻「消失」                                                     |
| 9   | 時鐘     | Chronos       | 全局   | `chronos: { position: number; nightSidePlayer: PlayerIndex }` | 公開可見                               | 18 個刻度（夜/晝各 9）                  | 晝夜循環；position 0 = 真夜中(NIGHT)，9 = 正午(DAY)；決定攻擊力計算時機                                                 |

### 區域進出規則流程

```
Hand (出牌)
  ↓
Set Zone A / Set Zone B (蓋牌)
  ↓
(revealCards: 翻開公開)
  ├─ Set Zone C (Area Enchant 類)
  │   └─ (舊 C 進 Power Charger / Abyss)
  ├─ Set Zone A/B (Character / Enchant 類)
  │   ├─ 若是 Character → Battle Zone
  │   │   └─ (舊 Battle Zone 進 Power Charger / Abyss)
  │   └─ 若是 Enchant → 效果處理階段觸發
  │
  └─ (戰鬥階段)
      └─ Set Zone A/B 的卡進 Power Charger / Abyss
```

### 卡牌可見性與資訊隱藏

- **己方手牌**：玩家 UI 可見，對手被隱藏（placeholder: `hidden-p{0/1}-hand-{index}`）
- **對方手牌揭示**：特定效果觸發 `revealedHandCardIds[player]` 時才顯示；再由 `playerView` 過濾
- **牌組**：始終蓋牌（背面），通過 `redactDeckForViewer` 隱藏卡牌定義
- **Set Zone A/B**：回合中蓋牌；`revealCards` 後公開
- **Battle Zone / Set Zone C**：始終公開

**實作參考**：Game.ts:71–87、Game.ts:127–151

---

## B. 回合流程與階段

### 1. 遊戲流程全景

```
猜拳(janken)
  ↓ 雙方完成
重抽(mulligan)
  ↓ 各選項應用
初始設置(initialSet)
  ↓ 各放 1 張蓋卡
---[第 1 回合]---
出牌(turnSet) — P1 先，P2 後，各出定量卡
公開(revealCards) — 同時翻開
時鐘推進(advanceChronos) — 依時計推進
效果處理(effectOrder) — 依優先玩家順序
戰鬥(battle) — 計算攻擊力、傷害
回合結束(turnEnd)
  ├─ 抽牌
  └─ nextTurn 回合計數增加
---[第 2～N 回合]---
  [同 turnSet ~> turnEnd 迴圈]
```

### 2. 各階段詳解

**janken**、**mulligan**、**initialSet**、**turnSet**、**effectOrder**、**battle**、**turnEnd**、**gameOver** 等 8 個階段已詳細記錄於完整文檔中。

**來源**：rules.md:6–93、Game.ts:154–194、GameLogic.ts:422–1540

---

## C. Moves 完整清單

| Move 名稱              | 參數                                         | 預期情境         | 語義                               |
| ---------------------- | -------------------------------------------- | ---------------- | ---------------------------------- |
| `janken`               | `choice: 'rock' \| 'paper' \| 'scissors'`    | janken 階段      | 提交拳形；決出夜側玩家             |
| `mulligan`             | `indices: number[]`                          | mulligan 階段    | 選擇要重抽的卡牌                   |
| `keepHand`             | 無                                           | mulligan 階段    | 選擇不重抽                         |
| `setInitialCard`       | `handIndex: number`                          | initialSet 階段  | 從手牌選卡置入 Battle Zone（蓋牌） |
| `setTurnCard`          | `handIndex: number, slot: 'A' \| 'B' \| 'C'` | turnSet 階段     | 從手牌選卡置入 Set Zone            |
| `undoSetCard`          | `slot: 'A' \| 'B' \| 'C'`                    | turnSet 階段     | 回收已放入的卡                     |
| `confirmReady`         | 無                                           | turnSet 階段     | 確認出牌完成；進入效果處理         |
| `timeoutSkip`          | 無                                           | 超時時           | 強制進入下一階段                   |
| `resolvePendingEffect` | `index: number`                              | effectOrder 階段 | 接受待處理效果                     |
| `submitPendingChoice`  | `optionIds: string[]`                        | 選擇掛起時       | 回應選擇；執行效果                 |

**來源**：Game.ts:153–195、GameLogic.ts:422–1495

---

## D. 卡牌資料結構

### CardDef（卡牌定義）

```typescript
{
  id: string;                    // 'P001-001'
  name: string;                  // 卡牌名稱（日文）
  pack: string;
  element: Element;              // '闇' | '炎' | '電気' | '風' | 'カオス'
  type: CardType;                // 'Character' | 'Enchant' | 'Area Enchant'
  attack: { night: number; day: number } | null;
  powerCost: number;             // 發動效果所需 Power
  sendToPower: number;           // 離場產出的 Power 值
  clock: number;                 // 時計推進值
  effect: string;                // 日文效果文字
  image: string;                 // 卡圖 URL
}
```

### UI 須展示的卡牌欄位

- 名稱、屬性圖示、稀有度、卡牌類型標籤
- 攻擊力二元組（NIGHT / DAY）
- Power Cost、SEND TO POWER、時計值
- 效果文字（已解析且翻譯）
- 卡圖

**來源**：types.ts:159–177

---

## E. 選擇/目標選擇機制

### PendingChoice 的 13 種類型

1. **handToDeckBottomThenDraw** — 手牌選卡進牌組底，後抽牌
2. **cardMove** — 卡牌移動（深淵/充能區/手牌 → 深淵/牌組）
3. **optionalHandMoveThenDraw** — 可選手牌移動後抽牌
4. **abyssToDeckBottomOrLose** — 深淵卡進牌組或敗北
5. **reorderOpponentDeckTop** — 排序對手牌組頂卡
6. **opponentPowerCharacterSwap** — 交換雙方角色
7. **useFromAbyss** — 從深淵/充能區取用卡牌效果
8. **useFromHand** — 從手牌取用卡牌效果
9. **revealHandAttackBoost** — 揭示手牌並獲得攻擊力加成
10. **nameGuessOpponentHandReveal** — 猜測對手手牌卡名
11. **handAbyssSwap** — 手牌與深淵交換
12. **clockPosition** — 選擇 Chronos 位置
13. **clockAdvance** — 選擇 Chronos 推進量

**每種類型對應的 UI 介面需求已詳細記錄於完整文檔中。**

**來源**：types.ts:284–336、pendingChoices.ts 全文

---

## F. 勝負條件、HP/傷害機制

### 勝利條件

| 條件                 | 觸發時機         |
| -------------------- | ---------------- |
| 對手 HP ≤ 0          | 戰鬥或效果傷害後 |
| 對手需抽牌但牌組不足 | 回合結束抽牌時   |
| 特定效果結束遊戲     | 卡牌效果觸發     |

### 傷害計算流程

```
1. 取雙方 Battle Zone 角色攻擊力（依晝夜）
2. 檢查 Power Cost 足否 → 若不足，攻擊力 = 0
3. 基礎傷害 = max(0, 攻擊力差值)
4. 套用減傷 modifier
5. 記錄 HP 變化、戰鬥結果
6. 推入 recentGameNotices（UI 提示）
```

### HP 變化提示（GameNotice）

- 每次 HP 變化時自動 push GameNotice
- UI 監聽 `recentGameNotices` 陣列
- 依序在置中 overlay 消費顯示詳細計算明細

**來源**：GameLogic.ts:846–1174、types.ts:38–110、gameNotices.ts

---

## G. UI 絕對不能改變語義的狀態欄位清單

### 禁止直接改變（會破壞遊戲邏輯）

- `step`：遊戲階段（決定流程轉移）
- `ready[0/1]`：準備狀態（控制階段切換）
- `turnNumber`：回合計數（決定勝負規則）
- `chronos.position` 與 `chronos.nightSidePlayer`：決定晝夜與優先玩家
- `players[0/1].hp`：勝負判定
- `players[0/1].deck / hand / battleZone / setZoneA/B/C / powerCharger / abyss`：卡牌位置（決定合法操作）
- `pendingChoice` 與 `pendingEffects`：效果流程控制
- `modifiers`：戰鬥修飾符（決定攻擊力計算）
- `winner` 與 `gameoverReason`：遊戲結束判定

### UI 可以做的操作

✅ **讀取顯示**：各區域卡牌、HP、Chronos 位置、當前階段、待處理選擇  
✅ **發送 Move**：所有出牌、選擇回應（由遊戲伺服器驗證合法性）  
✅ **計算顯示**：攻擊力預覽、傷害預測、出牌數剩餘、Power 總值

❌ **禁止操作**：直接改變狀態欄位、修改 HP / 卡牌位置、跳過流程檢查

**來源**：types.ts:382–426、Game.ts:71–151、GameLogic.ts 全文

---

## 附錄：核心概念參考

### Chronos 時鐘系統

- 18 個刻度（0~17），夜/晝各 9 格平分；位置 0 = 真夜中、9 = 正午
- 夜間位置：[0, 1, 2, 3, 10, 11]
- 晝間位置：[4, 5, 6, 7, 8, 9]
- 每回合推進量 = 雙方 Battle Zone 卡的 clock 值總和
- 決定攻擊力二元組的使用

### Power 系統

- Power = 充能區卡牌的 SEND TO POWER 值累積
- 發動卡牌效果需 Power >= powerCost
- 若不足 → 攻擊力 = 0，效果不發動
- 卡牌離場時依其 sendToPower 值進充能區

### 效果解析與執行

- 日文效果文字 → `parseEffect()` → ParsedEffect 結構
- ParsedEffect 包含：trigger（觸發時機）、conditions（條件）、action（動作）
- `executeEffect()` 執行動作，可能觸發 pendingChoice
- 玩家回應 → `submitPendingChoice()` → 效果繼續

**來源**：chronos.ts、GameLogic.ts:207–222、effects/types.ts

---

## 總結

本文檔涵蓋遊戲規則、狀態結構與 UI 邊界。所有內容均源自原始代碼，標注行號供查證。UI 重建時應以此為基準，確保語義正確且遊戲合規。

✅ 9 個遊戲區域 | 8 個遊戲階段 | 10 個 move | 13 種 PendingChoice | 完整卡牌結構 | 傷害計算流程 | 禁止改變的欄位清單
