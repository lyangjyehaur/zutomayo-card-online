# ZUTOMAYO CARD 遊戲規則

> 來源: zutomayocard.net/start-guide + ルールガイド Ver.1.0.0 (2026/2/16)

## 遊戲概要

- 2 人對戰 TCG
- 每人 20 張牌組
- 初始 HP 100
- 先將對方 HP 歸零者獲勝
- 核心機制: Chronos 晝夜循環改變攻擊力

## 卡牌種類

| 種類         | 說明                         |
| ------------ | ---------------------------- |
| Character    | 有攻擊力，用於戰鬥           |
| Enchant      | 一次性效果，附在角色或玩家上 |
| Area Enchant | 跨回合持續效果               |

## 卡牌屬性

闇(闇) / 炎(火) / 電気(雷) / 風(風) / カオス(混沌)

## 卡牌欄位

| 欄位          | 說明                     |
| ------------- | ------------------------ |
| 時計 (clock)  | 推進 Chronos 的數值      |
| 攻擊力        | NIGHT(夜) / DAY(晝) 兩種 |
| Power Cost    | 發動效果所需 Power       |
| SEND TO POWER | 離場時產出的 Power 值    |

## 牌組構築

- 20 張
- 同卡包+同編號最多 2 張
- 建議角色卡 ≥ 50%

## 場地

| 區域          | 功能                                |
| ------------- | ----------------------------------- |
| Battle Zone   | 戰鬥中的角色 (各1張)                |
| Set Zone A/B  | 從手牌打出的卡                      |
| Set Zone C    | 生效中的 Area Enchant               |
| Power Charger | SEND TO POWER 的卡離場後放這裡      |
| Deck Zone     | 牌組                                |
| Abyss         | 沒有 SEND TO POWER 的卡離場後放這裡 |
| HP Meter      | HP (100→0)                          |
| Chronos       | 晝夜時鐘                            |

## Chronos 系統

- 分為夜(藍)和晝(紅)
- 從真夜中開始，順時針推進
- 推進量 = 雙方出牌的時計總和
- NIGHT → 用夜攻擊力; DAY → 用晝攻擊力

## 對戰流程

### 準備

1. 各準備 20 張牌組 + HP 計數器
2. 猜拳，勝者為「夜側」
3. medal 放真夜中，HP 放 100
4. 洗牌 → 交換洗牌 → 交換回來
5. 各抽 5 張
6. 可重抽一次（選任意張蓋放，從牌組抽等量，舊卡洗回）
7. 各選 1 張蓋放 Battle Zone
8. 同時喊「嫌（やぁ）」翻開
9. 非角色卡 → 立即送 Power Charger/Abyss

### 第 1 回合

1. **時間推進**: 合計時計數值，推 medal
2. **效果處理**: 根據晝夜，優先玩家先處理效果
3. **攻擊力決定**: 依晝夜選 NIGHT/DAY 攻擊力
4. **傷害計算**: 攻擊力低者承受差值傷害
5. **回合結束**: 抽本回合出牌數量的牌

### 第 2 回合起

1. **卡牌設定**: 勝者出 1 張 / 敗者出 2 張 / 平手各 1 張
2. **公開**: 同時翻開
3. **時間推進**: 合計時計推 medal
4. **角色替換**: 新角色 → Battle Zone（舊的送 Power Charger/Abyss）
5. **AE 替換**: 新 Area Enchant → Set Zone C（舊的送走）
6. **效果處理**: 優先玩家先處理所有效果
7. **攻擊力決定**: 依晝夜
8. **傷害計算**: 攻擊力低者承受差值
9. **回合結束**: Set Zone A/B 本回合卡送走，抽牌

> Power Cost 不足 → 攻擊力=0，效果不發動

## 勝負條件

- HP 歸零 → 該玩家敗北
- 必須抽 N 張但牌組少於 N 張 → 立即敗北；不進行部分抽牌

## 規則指南 (ルールガイド v1.0.0)

### 優先玩家

Chronos medal 所在時段對應側為優先玩家，先處理效果。

### Power Cost 判斷

以「效果處理當下」的 Power 總數判斷。

### 效果發動時機

無特別指定的角色效果，在使用該卡的回合「效果處理」時發動。

### 非效果處理時機發動的效果

立即各自處理。

## 本專案的實作邊界

- `GameState.step` 與雙方 `ready` 決定流程；boardgame.io 的交替回合不是規則模型。
- Set Zone A/B 同目的地衝突時 A 優先；只有 B 有 Character 或 Area Enchant 時仍會正常進場。
- Enchant 保留到效果處理後離場；Area Enchant 進 Set Zone C 並持續存在。
- 每個效果處理前各自檢查當下 Power Cost。攻擊加減、傷害減免、HP、抽牌與部分 Chronos 效果會實際改變狀態。
- 422 張卡牌資料與 250 張有效果卡已進入目前 parser/executor 覆蓋基準；267/267 效果行可解析，`unparsedLines=0`、`parsedButPartial=0`。
- 玩家選擇效果順序、同一卡多段效果順序、傷害減免時機、Chronos transition、zone-entry events、Area Enchant 離場、手牌/移動選牌、Abyss 支付選牌、對手 Character 入替、手牌支付抽牌、Clock 選擇、deck top reorder 與持續型 modifier 皆有 runtime 支援與 smoke regression。
- 目前規則與效果現況詳見 [RULE_ENGINE_AUDIT.md](RULE_ENGINE_AUDIT.md) 與 [CARD_EFFECT_AUDIT_FINAL.md](CARD_EFFECT_AUDIT_FINAL.md)。
