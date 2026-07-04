# UI Review Checklist

> 每次新增功能 / 頁面 / 元件，提交前逐項自檢。任何一項不通過都不應合併。
> 規範出處：`how-to-add-new-feature.md`、`design-system.md`、`new-art-direction.md`。

## Token 與樣式
- [ ] 只使用 `src/ui/tokens/` 的 token；無 hard-coded color / spacing / shadow / radius / z-index / 動效時長
- [ ] 無新增的 magic number 卡牌尺寸（一律 `--card-width-*` / `--slot-*`）
- [ ] 未使用 deprecated token（`--lacquer/--gold/--ds-*`、`--type-micro/minutia`）

## 元件復用
- [ ] 復用 `src/ui` primitives / forms / layout / feedback / game，未重複造輪子
- [ ] 頁面內沒有一次性 div 堆疊出的「準元件」（重複 ≥2 次的結構已抽出）
- [ ] 沒有與既有元件語義重疊的新元件（popover、第二種按鈕…）
- [ ] 新元件已補進 `component-usage-guide.md`

## 響應式
- [ ] mobile / tablet / desktop 三種佈局都確認過（含 1366×768 低高度與手機橫屏）
- [ ] 斷點值與 `responsive-layout-system.md` 一致；未自創斷點
- [ ] 觸控目標 ≥44px；手機不出現 <12px 關鍵文字
- [ ] 無橫向溢出；關鍵操作不需捲動即可見

## 狀態完整性
- [ ] loading / error / empty 三態齊備（`LoadingState/ErrorState/EmptyState`）
- [ ] 互動元件有 hover / focus-visible / active / disabled 態
- [ ] keyboard 可操作（Enter/Space），focus ring 可見
- [ ] hover-only 功能有觸控替代（tap / sheet），用 `useViewportMode` 而非 UA 嗅探
- [ ] Modal/Sheet 有 focus trap、ESC、backdrop 關閉

## 視覺一致性
- [ ] 符合 Art Direction v2（靛墨底、volt 主行動、晝夜雙色只用於時間語義）
- [ ] 一個視圖只有一個 primary 行動
- [ ] display 文字直立（無新增 `italic` 標題）
- [ ] 無舊 UI 殘留（禁用清單見 how-to-add-new-feature.md §13）
- [ ] 沒有只為單一頁面寫死的全域樣式（App.css 不再新增規則）

## 遊戲語義（對戰相關才適用）
- [ ] 未改變遊戲狀態語義：只讀 `G`、只發 moves（見 rule-and-layout-understanding.md §4）
- [ ] 區域使用語義元件（BattleZone/SetZone/ChargeZone/AbyssZone/DeckZone），命名對齊官方
- [ ] 資訊隱藏未破壞（對手手牌/牌組內容不可見）
- [ ] `data-tut` 教學錨點與 smoke 測試選擇器未破壞（`scripts/battle-responsive-smoke.mjs`）
- [ ] 新狀態已補進 `rule-to-ui-mapping.md`

## 驗證
- [ ] `npm run typecheck`、`npm run build` 通過
- [ ] 涉及對戰頁：`npm run smoke:battle-responsive` 全 PASS
- [ ] 截圖比對無非預期視覺回歸
