# 全終端響應式佈局系統（Responsive Layout System）

> 實作：`src/styles/battle.css`（佈局）＋ `src/styles/tokens.css`（尺寸 token）＋
> `src/components/battle/useViewportMode.ts`（行為切換）
> 驗證：`npm run smoke:battle-responsive`（16 案例全 PASS，含 1920×1080 ～ 360×740）

## 設計原則

1. **不是縮小桌面 UI**：單一語義 DOM（頂欄 → 階段提示 → 對手 → 中央 → 玩家 → 手牌/操作），由 CSS 依斷點重排；行為差異（fan vs strip、sidebar vs sheet）由 `useViewportMode` 切換 React 渲染。
2. **卡牌永遠 5:7 直向**；空間不足時降級為更小尺寸 token 或 CardStack/Counter，永不壓扁。
3. **關鍵操作永遠可見**：階段提示、確認按鈕、手牌在所有尺寸都在視口內（smoke 以 offscreen 檢查強制）。
4. **觸控裝置完全不依賴 hover**：`(hover: none), (pointer: coarse)` → 詳情走 sheet、手牌兩段式 tap。

## 佈局模式

`useViewportMode()` 回傳：

| mode | 條件 | 佈局 |
|------|------|------|
| `desktop` | ≥1024px 寬 | 橫向戰場；≥1180px 顯示右側資訊欄 |
| `tabletPortrait` | 768–1023px | 直向戰場（同 mobile 結構、放大尺寸） |
| `mobile` | <768px | 手機專用 UI |

正交屬性：`isTouch`（coarse pointer）→ 手牌 strip、詳情 sheet；`isShort`（≤780px 高）→ 壓縮裝飾。

## 斷點策略

### Desktop Large（≥1440px）
- 完整戰場感：對手上、玩家下、中央 Chronos + 戰鬥區（`--card-width-lg`）。
- 右側 18rem 資訊欄：CardDetailPanel（hover 即時更新）+ GameLog。
- 手牌扇形（fan）：hover 抬起、click 出牌。
- 桌面裝飾（梯形 Canvas、環境光）啟用。

### Desktop Low Resolution（1024–1366px 寬 × 600–768px 高）
- `@media (min-width:64rem) and (max-height:48.75rem)`：
  - 卡牌 token 改以 `vh` 錨定（tokens.css 覆寫），整體縮小一級。
  - 頂欄降為 36px、階段提示壓縮 padding、對手區 padding 減半。
  - 1024–1179px 間隱藏側欄（詳情/log 走 side sheet），戰場滿寬。
- 驗證尺寸：1366×768 ✅、1280×720 ✅、1024×768 ✅ — 無縱向滾動、確認按鈕可見。

### Tablet Landscape（1024–1366px 橫屏）
- 佈局同 desktop；`isTouch` → 手牌 strip、詳情 side sheet / bottom sheet、按鈕 ≥44px、不依賴 hover。

### Tablet Portrait（768–1023px 直屏）
- 直向戰場（`max-width:63.9375rem` 區塊）：
  - 對手狀態列全寬 + 區域列（充能/A/B/C/牌組/深淵）橫向排列，可橫滑。
  - 中央 Chronos 放大（垂直空間充裕）。
  - 玩家區域列 + 底部手牌 strip + ActionDock 全寬列（按鈕靠右拇指區）。
  - 對手手牌背隱藏（張數顯示在狀態列）。
- 驗證：768×1024 ✅。

### Mobile Landscape（640–932px 橫屏，≤500px 高）
- `@media (max-height:31.25rem) and (orientation:landscape)`：
  - 卡牌 token 全面改 `vh` 錨定（lg→~15vh），堆疊 label 隱藏。
  - 對手狀態改單行內聯、階段提示只留標題、ActionDock 提示文字隱藏。
  - Chronos 縮至 16vh；戰鬥槽降為 md。
- 驗證：932×430 ✅、844×390 ✅ — 不靠縱向滾動可完成出牌。

### Mobile Portrait（360–480px 直屏）
- 結構（上→下）：頂欄（回合/晝夜/倒數）→ 階段提示 → 對手簡版（狀態列＋區域 chips 橫滑）→ 中央（戰鬥槽 md ＋ Chronos sm）→ 玩家區域列 → 手牌橫滑 strip ＋ 主操作按鈕（拇指區、`env(safe-area-inset-bottom)`）。
- 卡牌詳情：tap 選中 → 再 tap / 「查看詳情」開 bottom sheet。
- 深淵/充能：堆疊+計數，tap 開 ZoneSummarySheet。
- 驗證：430×932 ✅、390×844 ✅、360×740 ✅（含 mulligan / effect-order / pending-choice / game-over / focus-sheet 狀態）。

## 卡牌尺寸降級表

| 區域 | Desktop | 低高度桌面 | Tablet portrait | Mobile portrait | Mobile landscape |
|------|---------|-----------|----------------|----------------|-----------------|
| 戰鬥區 | lg | lg(vh) | lg | md | md(vh) |
| 己方設置區 | md | md(vh) | md | md | md(vh) |
| 對手設置區 | sm | sm(vh) | sm | sm | sm(vh) |
| 手牌 | lg fan | lg(vh) fan | md strip | md strip | md(vh) strip |
| 堆疊縮圖 | 縮圖+計數 | 同左 | 同左 | 同左 | 計數為主 |

## 測試

```bash
npm run smoke:battle-responsive   # 16 尺寸×狀態案例；檢查橫向溢出、offscreen、44px 觸控目標
```

案例：1920×1080、1366×768、1280×720、1024×768、768×1024、932×430、844×390、430×932、390×844、360×740（turn-set / mulligan / effect-order / pending-choice / game-over / focus-sheet）＋ 1024×768 log-sheet。
