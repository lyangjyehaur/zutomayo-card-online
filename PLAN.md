# ZUTOMAYO CARD Online — 實施計劃

> **目標：** 基於 boardgame.io + React + TypeScript 搭建 ZUTOMAYO CARD 線上對戰平台
>
> **數據現況：** 422 張卡（JSON）、74 條 Q&A、完整規則文檔
>
> **核心策略：** 先跑通無效果的純戰鬥循環，再逐步疊加效果引擎

---

## Phase 0: 項目腳手架

### Task 0.1: 初始化 Vite + React + TypeScript 項目

**目標：** 建立可運行的前端項目骨架

```bash
cd ~/projects/zutomayo-card-online
npm create vite@latest . -- --template react-ts
npm install
```

確認 `npm run dev` 能跑起來。

### Task 0.2: 安裝 boardgame.io

```bash
npm install boardgame.io
```

### Task 0.3: 建立目錄結構

```
src/
├── game/              # 遊戲邏輯（boardgame.io Game 定義）
│   ├── types.ts       # TypeScript 類型定義
│   ├── Game.ts        # boardgame.io Game 主文件
│   ├── phases/        # 各階段邏輯
│   │   ├── setup.ts
│   │   ├── set.ts
│   │   ├── reveal.ts
│   │   ├── time.ts
│   │   ├── swap.ts
│   │   ├── effect.ts
│   │   ├── battle.ts
│   │   └── end.ts
│   ├── effects/       # 效果引擎（Phase 4）
│   └── cards/         # 卡牌數據加載
├── components/        # React UI
│   ├── Board.tsx      # 遊戲主畫面
│   ├── Field.tsx      # 場地渲染
│   ├── Hand.tsx       # 手牌區
│   ├── Card.tsx       # 單張卡牌
│   ├── Chronos.tsx    # 時鐘 UI
│   └── HpMeter.tsx    # HP 條
├── assets/            # 卡圖、場地圖等
└── App.tsx
```

---

## Phase 1: 核心遊戲狀態（無效果版本）

> 目標：兩個人能跑完一整局遊戲，只比攻擊力，不處理任何卡牌效果

### Task 1.1: 定義 TypeScript 類型

**建立：** `src/game/types.ts`

```typescript
export type Element = '闇' | '炎' | '電気' | '風' | 'カオス';
export type CardType = 'Character' | 'Enchant' | 'Area Enchant';
export type Rarity = 'N' | 'R' | 'SR' | 'UR' | 'SE';
export type ChronosTime = 'night' | 'day';
export type Phase = 'setup' | 'set' | 'reveal' | 'time' | 'swap' | 'effect' | 'battle' | 'end';

export interface CardDef {
  id: string;
  name: string;
  pack: string;
  element: Element;
  type: CardType;
  clock: number;
  attack: { night: number; day: number } | null; // null for non-Character
  powerCost: number;
  sendToPower: number;
  effect: string;
  image: string;
  errata: string;
}

export interface CardInstance {
  instanceId: string;    // 唯一實例 ID
  defId: string;         // 對應 CardDef.id
  faceUp: boolean;
}

export interface PlayerState {
  hp: number;
  deck: CardInstance[];
  hand: CardInstance[];
  battleZone: CardInstance | null;
  setZoneA: CardInstance | null;
  setZoneB: CardInstance | null;
  setZoneC: CardInstance | null; // Area Enchant
  powerCharger: CardInstance[];
  abyss: CardInstance[];
}

export interface GameState {
  players: [PlayerState, PlayerState];
  chronos: {
    medalPosition: number;  // 0~11 (0=midnight, 3=dawn, 6=noon, 9=dusk)
    nightSidePlayer: 0 | 1; // 猜拳決定
  };
  turn: number;
  lastBattleResult: {
    winner: 0 | 1 | null;
    damage: number;
  };
  phase: Phase;
}
```

### Task 1.2: 實作 setup 階段

**建立：** `src/game/phases/setup.ts`

邏輯：
1. 用 CardInstance 包裝雙方牌組（20 張）
2. 洗牌 → 交換洗牌 → 交換回來
3. 各抽 5 張
4. medal 放位置 0（真夜中）
5. HP 設為 100

### Task 1.3: 實作 set 階段

**建立：** `src/game/phases/set.ts`

- 第 1 回合：各選 1 張蓋放 Battle Zone
- 第 2 回合+：上回合勝者出 1 張 / 敗者出 2 張 / 平手各 1 張
- 放入 Set Zone A（和 B）

### Task 1.4: 實作 reveal 階段

同時翻開 Set Zone 的卡。
- 非角色卡 → 立即送 Power Charger 或 Abyss（依 SEND TO POWER）

### Task 1.5: 實作 time 階段

合計雙方出牌的 clock 值，推進 medal。
- medalPosition = (medalPosition + totalClock) % 12
- 判斷晝夜：0-5 = night, 6-11 = day（取決於 nightSidePlayer 的位置）

### Task 1.6: 實作 swap 階段

- 新角色卡 → Battle Zone（舊的依 SEND TO POWER 送 Power Charger/Abyss）
- 新 Area Enchant → Set Zone C（舊的送走）

### Task 1.7: 實作 battle 階段

- 根據晝夜選攻擊力
- 比較攻擊力，低者承受差值傷害
- Power Cost 不足 → 攻擊力 = 0

### Task 1.8: 實作 end 階段

- Set Zone A/B 的本回合卡送走
- 抽本回合出牌數量的牌
- 檢查勝負（HP=0 或牌組空）

### Task 1.9: 組裝 Game.ts

**建立：** `src/game/Game.ts`

```typescript
import { Game, INVALID_MOVE } from 'boardgame.io';
import { GameState } from './types';

export const ZutomayoCard: Game<GameState> = {
  name: 'zutomayo-card',
  
  setup: () => { /* 調用 setup.ts */ },
  
  phases: {
    setup: { /* ... */ },
    set:   { moves: { selectCard }, next: 'reveal' },
    reveal:{ onBegin: revealCards, next: 'time' },
    time:  { onBegin: advanceChronos, next: 'swap' },
    swap:  { onBegin: swapCards, next: 'effect' },
    effect:{ onBegin: processEffects, next: 'battle' },
    battle:{ onBegin: resolveBattle, next: 'end' },
    end:   { onBegin: endTurn, next: 'set' },
  },
  
  endIf: (G) => {
    if (G.players[0].hp <= 0) return { winner: '1' };
    if (G.players[1].hp <= 0) return { winner: '0' };
    if (G.players[0].deck.length === 0) return { winner: '1' };
    if (G.players[1].deck.length === 0) return { winner: '0' };
  },
};
```

### Task 1.10: 最小可玩驗證

用 boardgame.io 的 `Local` 模式跑一局完整遊戲，確認：
- 回合流程正確
- 攻擊力比較和傷害計算正確
- 抽牌和牌組消耗正確
- HP 歸零時遊戲結束

---

## Phase 2: 卡牌數據整合

### Task 2.1: 建立卡牌加載器

**建立：** `src/game/cards/loader.ts`

從 `cards.json` 載入卡牌定義，建立 `Map<string, CardDef>` 索引。

### Task 2.2: 牌組構建器

**建立：** `src/game/cards/deckBuilder.ts`

- 從卡牌池中選 20 張構建牌組
- 驗證規則：同卡包+同編號最多 2 張
- 隨機洗牌

### Task 2.3: 建立 4 組預設牌組

**建立：** `src/game/cards/presetDecks.ts`

設計 4 組簡單的預設牌組（不需要玩家自己選牌），方便快速開始遊戲。

---

## Phase 3: 基礎 UI

### Task 3.1: Board 主組件

**建立：** `src/components/Board.tsx`

boardgame.io 的 Board 組件，接收 `G` (GameState) 和 `moves`。

### Task 3.2: Card 組件

**建立：** `src/components/Card.tsx`

顯示單張卡牌：卡圖、名稱、攻擊力、屬性。支援正面/背面翻轉。

### Task 3.3: Field 場地渲染

**建立：** `src/components/Field.tsx`

渲染雙方場地：
```
┌─────────────────────────────────┐
│  [Opponent HP]                  │
│  [Set A] [Battle] [Set B] [C]  │
│  [Power] [Deck] [Abyss]        │
│─────────────── Chronos ────────│
│  [Power] [Deck] [Abyss]        │
│  [Set A] [Battle] [Set B] [C]  │
│  [My HP]                       │
│  [Hand: card card card card]   │
└─────────────────────────────────┘
```

### Task 3.4: Chronos 時鐘組件

**建立：** `src/components/Chronos.tsx`

圓形時鐘，顯示 medal 位置、晝夜區域。

### Task 3.5: Hand 手牌組件

**建立：** `src/components/Hand.tsx`

顯示手牌，支援點選出牌。

---

## Phase 4: 效果引擎

> 這是最核心的部分。先支援最常見的效果模式，再逐步擴展。

### Task 4.1: 定義效果 DSL

**建立：** `src/game/effects/types.ts`

```typescript
export interface Effect {
  trigger: 'onBattle' | 'onUse' | 'onEnter' | 'onLeave' 
         | 'onTurnStart' | 'onTurnEnd' | 'onDamageReceived';
  condition?: Condition;
  action: Action;
}

export interface Condition {
  type: 'chronos' | 'opponentElement' | 'powerAtLeast' 
      | 'abyssCount' | 'handCount' | 'chronosChanged';
  value: any;
}

export interface Action {
  type: 'boostAttack' | 'reduceAttack' | 'directDamage' 
      | 'heal' | 'drawCards' | 'sendToAbyss' | 'recoverFromAbyss'
      | 'swapAttack' | 'noEffect' | 'clockAdvance' | 'clockReset';
  params: Record<string, any>;
}
```

### Task 4.2: 效果解析器

**建立：** `src/game/effects/parser.ts`

把卡牌的 effect 文字解析成 Effect 結構。先處理最常見的模式：

```typescript
// 攻撃力+50 → { action: { type: 'boostAttack', params: { value: 50 } } }
// 夜なら攻撃力+30 → { condition: { type: 'chronos', value: 'night' }, action: { ... } }
// 相手の属性が風なら攻撃力+50 → { condition: { type: 'opponentElement', value: '風' }, ... }
```

### Task 4.3: 效果執行器

**建立：** `src/game/effects/executor.ts`

根據 Effect 結構修改 GameState。處理優先玩家順序。

### Task 4.4: 分批實作效果（按數量排序）

| 批次 | 效果類型 | 影響卡數 | 複雜度 |
|------|----------|----------|--------|
| 4.4a | attack_boost（純數值加減） | 163 | ⭐ |
| 4.4b | attribute_cond（屬性條件） | 52 | ⭐⭐ |
| 4.4c | chronos_cond（晝夜條件） | 23 | ⭐ |
| 4.4d | heal / damage_reduce | 20 | ⭐⭐ |
| 4.4e | drawCards | 14 | ⭐ |
| 4.4f | clock_effect | 12 | ⭐⭐⭐ |
| 4.4g | directDamage | 10 | ⭐ |
| 4.4h | abyss_to_field / discard | 35 | ⭐⭐⭐ |
| 4.4i | swap_attack / no_effect | 4 | ⭐⭐ |
| 4.4j | 其他/複合效果（手寫） | ~20 | ⭐⭐⭐⭐ |

### Task 4.5: Q&A Edge Case 測試

用 74 條 Q&A 作為測試用例，驗證效果引擎的正確性。特別是：
- 效果處理順序（優先玩家先）
- Power Cost 判斷時機
- Area Enchant 換入換出
- 同時觸發的處理

---

## Phase 5: 多人對戰

### Task 5.1: boardgame.io Server

```bash
npm install @boardgame.io/server
```

**建立：** `src/server.ts`

```typescript
import { Server } from 'boardgame.io/server';
import { ZutomayoCard } from './game/Game';

const server = Server({ games: [ZutomayoCard] });
server.run(8000);
```

### Task 5.2: Client 連接

用 boardgame.io 的 `SocketIO` transport 替換 `Local`。

### Task 5.3: 配對大廳

簡單的配對 UI：創建房間 / 加入房間。

### Task 5.4: 斷線處理

boardgame.io 內建基本的斷線重連，需要測試和調整。

---

## Phase 6: 卡圖與資源

### Task 6.1: 下載卡圖

422 張卡圖從 CloudFront CDN 下載到 `public/cards/`。

```bash
# 從 cards.json 提取所有圖片 URL，批量下載
node scripts/downloadCardImages.js
```

### Task 6.2: 場地圖設計

設計數位版的場地墊 (Field Mat)。

### Task 6.3: 卡牌渲染優化

卡圖懶加載、縮略圖、hover 放大。

---

## Phase 7: 打磨

### Task 7.1: 回合計時器

每回合 60 秒倒計時，超時自動棄權。

### Task 7.2: 對戰紀錄

記錄每回合的操作，可回放。

### Task 7.3: 牌組編輯器

讓玩家從 422 張卡中自選 20 張構建牌組。

### Task 7.4: 互動式引導教學

> 不是文字幻燈片，而是讓玩家在實際操作中學習。

帶新手走一遍完整遊戲流程的互動教學，玩家在每個步驟親自操作：
- 第 1 局：引導出牌（高亮可點擊的卡 → 點選 → 放入指定位置）
- 翻開後解釋晝夜和攻擊力
- 戰鬥後解釋傷害計算
- 第 2 局：引導敗者出 2 張（解釋 catch-up 機制）
- 引導查看 Power Charger / Abyss
- 逐步解鎖 UI 元素，未互動的區域加遮罩
- 教學結束後進入 AI 練習（Easy 難度）鞏固

技術要點：
- 使用 overlay + highlight 高亮當前目標區域
- 每步需要玩家實際點選才能繼續（不是「下一頁」）
- 教學狀態機：step → wait for interaction → validate → next step
- 可選跳過（但首次訪問建議看完）

---

## 執行順序

```
Phase 0 (1天) → Phase 1 (3天) → Phase 2 (1天) → Phase 3 (2天)
                                                          ↓
Phase 7 (持續) ← Phase 6 (2天) ← Phase 5 (2天) ← Phase 4 (5天)
```

**MVP 目標：** Phase 0-3 完成後，可以在本地跑一局無效果的完整對戰。
**Beta 目標：** Phase 0-5 完成後，可以兩人線上對戰，大部分效果正確執行。
**完整版：** 全部 Phase 完成。

---

## Phase 8: 帳號系統

> 可匿名遊玩，也可註冊帳號。匿名遊玩的數據可在綁定帳號後合併到正式帳號。

### Task 8.1: 匿名身份

- 遊客自動生成匿名 ID（localStorage uuid）
- 匿名玩家可正常對戰，戰績記錄在本地
- 進入大廳時自動識別：已登入 / 匿名

### Task 8.2: 帳號註冊/登入

- Email + 密碼註冊（bcrypt hashing）
- JWT token 認證
- 登入後可選：從匿名帳號合併戰績

### Task 8.3: 匿名數據合併

- 匿名期間的對戰紀錄、勝率、牌組使用數據 → 合併到正式帳號
- 合併後清除本地匿名數據，避免重複計算
- 合併是單向的（不可撤銷）

### Task 8.4: 用戶資料頁

- 個人資料（暱稱、頭像、註冊時間）
- 戰績統計（總場數、勝率、最高連勝、常用牌組）
- 對戰歷史列表

---

## Phase 9: 排行榜

### Task 9.1: ELO 評分系統

- 初始 ELO 1000
- 對戰結束後根據雙方 ELO 差值計算新評分
- 匿名玩家也有 ELO（但不顯示在排行榜）
- 匿名合併到帳號後 ELO 繼承

### Task 9.2: 排行榜頁面

- 全局排行榜（Top 100）
- 顯示：排名、暱稱、ELO、勝率、總場數
- 每日/每週/全部時間篩選

### Task 9.3: 賽季系統（選做）

- 每月重置賽季
- 賽季結算時發放稱號/徽章
- 歷史賽季紀錄

---

## Phase 10: AI 對戰（練習模式）

> 不需要連線，純本地計算，用於新手練習和測試牌組。

### Task 10.1: 基礎 AI（規則引擎）

- 基於規則的簡單 AI：
  - 優先出高攻擊力的角色卡
  - 有條件效果時優先觸發條件滿足的效果
  - 敗者出 2 張時優先出低 Cost 高 Value 的卡
- 難度等級：簡單 / 普通 / 困難

### Task 10.2: AI 難度調整

- 簡單：隨機出牌（帶基本規則）
- 普通：評估攻擊力和效果價值後選擇最優出牌
- 困難：模擬多步 lookahead（預測對方出牌 + 自己最佳應對）

### Task 10.3: AI 對戰 UI

- 選擇「與電腦對戰」進入練習模式
- 可選 AI 難度
- AI 使用預設牌組或隨機牌組
- 對戰結束後顯示結果（不影響 ELO）

---

## Phase 11: 後端服務（配合 Phase 8-10）

### Task 11.1: API Server

- Node.js/Express 或 Fastify
- REST API：帳號、對戰、排行榜
- PostgreSQL 或 SQLite 存儲用戶數據

### Task 11.2: 數據庫設計

```
users: id, email, password_hash, nickname, elo, created_at
matches: id, player0_id, player1_id, winner_id, elo_change, deck0, deck1, duration, created_at
seasons: id, name, start_date, end_date
```

### Task 11.3: 對戰結果上報

- boardgame.io 的 `endIf` hook 觸發時，client 上報對戰結果到 API
- API 更新雙方 ELO、戰績、排行榜

---

## 更新後的執行順序

```
Phase 0-7（核心遊戲，已完成 ~75%）
         ↓
Phase 8: 帳號系統（匿名 + 註冊 + 數據合併）
         ↓
Phase 9: 排行榜（ELO + 排名 + 賽季）
         ↓
Phase 10: AI 對戰（規則引擎 + 難度等級）
         ↓
Phase 11: 後端服務（API + DB + 數據上報）
```

**新 MVP 目標：** Phase 8-9 完成後，有帳號系統和排行榜的線上對戰。
**完整版：** 全部 Phase 完成，包含 AI 練習和賽季系統。
