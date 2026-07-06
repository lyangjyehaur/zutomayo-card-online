# ZUTOMAYO CARD UI 實作深度分析報告

**報告日期：** 2026-07-04  
**分析範圍：** src/components/Board.tsx (3062 行)、src/App.css (11043 行)、UI primitives、頁面架構、響應式策略  
**分析目的：** 供 Design System 推倒重建參考

---

## A. 對戰頁 (Board) DOM/元件結構樹

### 頂層架構 (Board.tsx 主線 1500-3062 行)

```
<Board>  // boardgame.io wrapper (Props 1500-1530)
├─ <JankenScreen/>              // 1:1 猜拳階段 (750-797 行)
│  └ grid 3 choices
├─ <MulliganScreen/>            // 初始手牌調整 (799-887 行)
│  └ flex hand + actions
├─ <GameOverScreen/>            // 遊戲結束屏 (943-1035 行)
│  └ center victory/defeat + result grid + actions
├─ <main class="board">         // 核心對戰視圖 (1634-1950 行)
│  ├─ <BattlefieldCanvas/>      // 梯形戰場背景 Canvas (366-437 行)
│  │  └ gradient + glow
│  │
│  ├─ section (opponent area)   // 1680-1710
│  │  └─ <OpponentStatsBar/>    // 1271-1362
│  │     ├─ name + HP bar (LpBar)
│  │     ├─ hand thumbnails (9 個 card-back)
│  │     └─ 3x setZone (A/B/C)
│  │
│  ├─ section (central arena)   // 1711-1747
│  │  └─ <CentralArena/>        // 1458-1510
│  │     ├─ FieldZone opponent battle
│  │     ├─ Chronos (時鐘模組)
│  │     └─ FieldZone player battle
│  │
│  ├─ section (bottom zones)    // 1748-1818
│  │  └─ <BottomZones/>         // 1364-1456
│  │     ├─ powerCharger stack
│  │     ├─ 3x setZone (A/B/C)
│  │     ├─ deckZone
│  │     └─ player info + LP bar
│  │
│  ├─ section (hand area)       // 1819-1820
│  │  └─ flex hand cards
│  │     └─ .battle-hand-row (flexible layout)
│  │
│  ├─ <GameNoticeOverlay/>      // 641-740
│  │  └─ floating phase-message-panel (HP/chronos)
│  │
│  ├─ <FeedbackOverlay/>        // 439-462 (setup feedback)
│  │  └─ phase-message-overlay
│  │
│  └─ optional <BattleSidePanel/> // 隱藏實現位置
│     └─ focused card detail sheet
│
└─ toast/notice stack (global)
```

### CSS 架構

**App.css 11043 行總體組織**：

| 行號       | 段落                | 規模     | 狀態             |
| ---------- | ------------------- | -------- | ---------------- |
| 1-24       | @import + fonts     | compact  | ✓                |
| 25-116     | @theme inline       | ~100 行  | ✓                |
| 118-310    | :root CSS variables | ~200 行  | ✓ 完整           |
| 320-798    | Nav/Auth/Lobby      | ~500 行  | ✓                |
| 799-2500   | Battle board styles | ~1700 行 | ⚠️ 混亂          |
| 2500-3200  | Responsive queries  | ~700 行  | ⚠️ 多重 override |
| 3200-11043 | 頁面-specific CSS   | ~8000 行 | ⚠️ 孤島          |

### Token 現況

**已定義**（App.css 118-310）：

- **Color**: 18 primitive (oklch) + 14 semantic
- **Typography**: 3 font family + 10 size + 8 tracking
- **Spacing**: 10 scale (0-12) + 5 semantic
- **Shadow**: 11 elevation levels
- **Radius**: 6 levels
- **Z-index**: 9 layers (0-9999)
- **Motion**: 4 duration + 3 easing
- **Breakpoint**: 6 viewport sizes

**Magic Values** (未遷移)：

- 卡牌尺寸：88px, 130px, 100px, 75px (多處硬編)
- 顏色 hex: #f5d368, #994d5a, rgba() (80+ 次)
- Gap: gap-8, gap-6, gap-2 (150+ 次)
- Font size: text-[9px], text-[10px] (40+ 次)
- Min-height: min-h-[2.4rem] (20+ 次)

### 現存問題清單 (High Priority)

根據 docs/ui-ux-audit.md：

| 優先級 | 問題                                      | 嚴重度 | 檔案                         |
| ------ | ----------------------------------------- | ------ | ---------------------------- |
| 1      | Battle 360/390px 手機 stack-zone 貼邊越界 | High   | Board.tsx:2584               |
| 2      | Battle 手機混用桌面佈局模型               | High   | Board.tsx:2157-2680          |
| 3      | 操作按鈕 35-40px (< 44px)                 | High   | Board.tsx:2727, App.css:9362 |
| 4      | 卡牌 focus 依賴 hover                     | Medium | Board.tsx:1087, 1538         |
| 5      | 多套浮層 z-index 競爭                     | High   | Board.tsx:440, 2772          |
| 6      | Landing 首頁按鈕 27-29px                  | High   | LobbyPage.tsx:255            |
| 7      | Feedback modal 無 focus trap              | High   | FeedbackPage.tsx:1062        |
| 8      | App.css 11043 行混亂                      | High   | App.css 全檔                 |

---

## B. UI Primitives 清單 (src/components/ui/)

### 已實現的 15 個元件

| 名稱              | 尺寸        | 用途              | Variants                        |
| ----------------- | ----------- | ----------------- | ------------------------------- |
| Button            | ~110 行     | Primary action    | primary/secondary/danger/ghost  |
| IconButton        | (Button 內) | Icon-only action  | sm/md                           |
| BackButton        | (Button 內) | Back navigation   | md/lg                           |
| Panel             | ~32 行      | Card container    | md/lg/xl + solid/ghost          |
| Dialog            | ~80 行      | Modal (desktop)   | default/large                   |
| Sheet             | ~90 行      | Sheet (mobile)    | top/bottom/left/right           |
| Input             | ~60 行      | Text input        | sm/md + default/filled          |
| Badge             | ~40 行      | Status tag        | default/accent/success/danger   |
| Card              | ~40 行      | Card container    | elevated/default                |
| SegmentedControl  | ~80 行      | Tab-like selector | sm/md                           |
| ActionBar         | ~50 行      | Sticky actions    | sticky/position                 |
| ResponsiveToolbar | ~100 行     | Adaptive toolbar  | breakpoint-based                |
| PageHeader        | ~70 行      | Page title        | default/floating                |
| PageShell         | ~80 行      | Full-page         | screen/scroll/workspace/landing |
| DataList          | ~150 行     | Table/cards       | table/cards/compact             |
| State             | ~60 行      | Loading/error     | loading/empty/error             |

### 缺失的 Primitives

根據 ui-ux-audit.md（需要新增）：

- ❌ Toast (UI primitive，不只是 ToastProvider)
- ❌ FormField (label + input + error 合成)
- ❌ PopoverTrigger (統一 hover/tap)
- ❌ FilterPanel / FilterSheet
- ❌ Disclosure / Collapsible
- ❌ Modal (統一 Dialog + focus trap + a11y)

---

## C. 響應式斷點與策略

### 定義 (App.css 111-116, 272-277)

```css
--breakpoint-phone: 360px /* 狹窄手機 */ --breakpoint-phone-lg: 430px /* 大手機 */ --breakpoint-tablet: 768px
  /* 平板豎屏 */ --breakpoint-touch: 820px /* 觸控優先分界 */ --breakpoint-desktop-sidebar: 1180px
  --breakpoint-low-height: 780px /* 低高度桌面 */;
```

### Smoke 測試

**檔案**：scripts/battle-responsive-smoke.mjs (500+ 行)

**測試用例 (12 個)**：

```
1280x720__turn-set          (low-height desktop)
1024x768__turn-set          (tablet landscape)
768x1024__turn-set          (tablet portrait)
430x932__turn-set           (large phone)
390x844__turn-set           (standard phone)
360x740__turn-set           (small phone)
360x740__mulligan           (state variation)
360x740__effect-order       (state variation)
360x740__pending-choice     (state variation)
360x740__game-over          (state variation)
360x740__focus-sheet        (interaction)
1024x768__log-sheet         (interaction)
```

**依賴**：

- Google Chrome headless
- Chrome DevTools Protocol (WebSocket, port 9666)
- HTTP 調用查詢 CDP 狀態
- 截圖 + DOM 驗證表達式

**執行**：`npm run smoke:responsive`

**輸出**：

- /tmp/zutomayo-battle-responsive-screenshots/\*.png
- /tmp/zutomayo-battle-responsive-report.json

---

## D. 頁面架構與一致性現況

### 路由結構

```
/                → LobbyPage (Landing)
/ai              → AILobbyPage
/play/ai/:matchID → AIGamePage (Board)
/online          → OnlineLobbyPage
/play/online/:matchID → OnlineGamePage (Board)
/deck-editor     → DeckEditorPage
/feedback        → FeedbackPage
/match-history   → MatchHistoryPage
/leaderboard     → LeaderboardPage
/admin           → AdminPage
/i18n-manager    → I18nManager
/tutorial        → TutorialGamePage
```

### 風格一致性評分

| 面向          | 評分 | 現狀                                 |
| ------------- | ---- | ------------------------------------ |
| Button 樣式   | 4/10 | legacy + new 混雜                    |
| Panel/Card    | 7/10 | 基本一致                             |
| Typography    | 5/10 | 多數用 token，手機 text-[9px] 不合規 |
| Color         | 7/10 | Token 完整                           |
| Spacing       | 5/10 | 多處硬編 gap/padding                 |
| Z-index       | 3/10 | 多層競爭                             |
| Responsive    | 5/10 | 基線 PASS，邊界情況多                |
| Accessibility | 4/10 | 44px 缺失 + focus trap 缺失          |

**整體：6/10**

---

## E. 互動模式現況

### 選卡流程

**手牌選卡** (Board.tsx 1819-1820)：

- 點擊手牌 → moves.setCardToZone(index)
- hover 彈出 popover
- ⚠️ 手機無反饋

**Mulligan 選卡** (MulliganScreen.tsx 836-851)：

- 多選 + toggle
- ✓ ring-2 + shadow-selected 視覺反饋
- ⚠️ hover -translate-y-2 只能桌面用

### 卡牌詳情

**CardPopover** (Card.tsx 64-100)：

- computePopoverPosition 計算位置
- Portal to document.body
- ⚠️ 絕對定位在捲動時不跟隨
- ⚠️ 多卡同時 hover 重疊

**LogCardChip** (Board.tsx 248-306)：

- 獨立 hover/focus/tap 邏輯
- ⚠️ 與 Card popover 重複實裝

### 浮層堆棧

| 層              | Z 值 | 用途     | 問題              |
| --------------- | ---- | -------- | ----------------- |
| CardPopover     | 10   | 卡詳情   | 可被 overlay 蓋住 |
| BattleSidePanel | 50?  | 側面板   | 自訂，無標準      |
| phase-message   | 50   | 遊戲通知 | 與 side 同層競爭  |
| Dialog/Sheet    | 100  | 模態     | ✓ 正確            |
| Toast           | 200  | 吐司     | ✓ 正確            |

**問題**：

- ⚠️ 無 focus trap
- ⚠️ 多套 backdrop 與 scroll lock 邏輯

---

## 總結：優先行動項目

### Phase 優先級 (建議執行順序)

| Phase | 標題               | 時程   | 關鍵工作                                      |
| ----- | ------------------ | ------ | --------------------------------------------- |
| 1     | **理解與規劃**     | ✓ 完成 | 本報告 + rule-and-layout.md                   |
| 2     | **Design System**  | 1-2 週 | Token 補齊 + App.css 精簡                     |
| 3     | **Battle UI 重構** | 2-3 週 | Desktop 佈局 + 44px 按鈕 + 統一浮層           |
| 4     | **全終端響應式**   | 2-3 週 | Mobile compact + 768px 過渡 + container query |
| 5     | **頁面一致性**     | 2-3 週 | Landing/Lobby 統一 + a11y 補完                |
| 6     | **驗收與優化**     | 1-2 週 | Smoke 100% + QA + 最終文檔                    |

### 立即行動項

1. 創建 `design-system-tokens.md`，列出所有 token 與使用現狀
2. 建立 token 遷移清單（11043 行 CSS 中的 magic values）
3. 為 Phase 2 準備 Tailwind v4 config
4. 啟動 Battle Desktop (1180px+) 設計審查

---

**完成日期**：2026-07-04  
**下步**：啟動 Phase 2 Design System 建立
