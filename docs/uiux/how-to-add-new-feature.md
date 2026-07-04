# 新增功能開發指南（How to Add a New Feature）

> 這是新增任何頁面/功能前的必讀文件。搭配 `ui-review-checklist.md`（提交前自檢）
> 與 `component-usage-guide.md`（每個元件怎麼用）。
> UI 體系唯一入口：`import { ... } from '../ui'`（`src/ui/index.ts`）。

## 0. 從哪裡開始查

1. 視覺規範 → `docs/uiux/new-art-direction.md` + `design-system.md`
2. 有沒有現成元件 → `component-usage-guide.md` → `src/ui/*/index.ts`
3. 對戰相關 → `src/ui/game/` + `rule-to-ui-mapping.md`
4. 響應式 → `responsive-layout-system.md`

## 1. 新增頁面

- 殼層一律 `PageShell`（`src/ui/layout`）：
  - 滿版工作區（編輯器類）→ `WorkspaceLayout`
  - 可捲動內容頁 → `ScrollPageLayout`
  - 狀態/結果頁 → `StatusPageLayout`
- 頁首用 `PageHeader`（含返回鍵 `BackButton`）。
- 頁面檔案只做「組合元件＋接資料」；出現 3 個以上裸 `div` 排版就該抽 layout 元件。

## 2. 新增區塊

- 內容容器 → `Panel`（`solid`/`ghost`）；區塊標題 → `PageSectionHeader`。
- 統計數字 → `StatCard` + `StatsGrid`；清單/表格 → `DataListTable`。
- 遊戲區域 → 一律 `ZonePanel` 包裹（label+hint 必填其一）。

## 3. 新增表單

- 只用 `src/ui/forms`：`Input` / `Select` / `Textarea` / `Checkbox` / `SearchInput`。
- label+錯誤訊息 → `FormField`；送出列 → `FormActions`。
- 禁止裸 `<input>` 配 Tailwind 即席樣式。

## 4. 按鈕 variant 選擇

- 一個視圖只有一個 `variant="primary"`（當前主行動）。
- 次要 → `secondary`；破壞性 → `danger`；低干擾 → `ghost`。
- 只有圖示 → `IconButton`（`label` 必填）；返回 → `BackButton`。

## 5. Modal / Drawer / BottomSheet 選擇原則

- 需要玩家立刻決定、阻斷操作 → `Modal`（=Dialog；自帶 focus trap/ESC）。
- 桌面側邊輔助內容 → `Sheet side="right"`；行動端一切詳情/摘要 → `BottomSheet`（=Sheet）。
- 確認離開/刪除等危險動作 → `AppDrawer` 確認模式（現有）或 `Modal` + danger 按鈕。
- 禁止自製 overlay/z-index；浮層層級只用 `--z-*` token。

## 6. Loading / Error / Empty 標準

- 一律 `src/ui/feedback`：`LoadingState` / `ErrorState`（Alert）/ `EmptyState`。
- 每個非同步視圖三態齊備才算完成（checklist 會查）。
- 操作結果回饋 → `ToastProvider` 的 toast，不要自製浮字。

## 7. 對戰相關 UI

- 卡牌渲染只准 `CardView`（尺寸=token、四態=data-state）；槽位 `CardSlot`；堆疊 `CardStack`。
- 區域必用語義元件：`BattleZone` / `SetZone` / `ChargeZone` / `AbyssZone` / `DeckZone`，不要用泛用 div 拼。
- 詳情：桌面 `CardDetailPanel`、觸控 `CardDetailSheet`（共用 CardDetailBody，禁止新增 popover）。
- 新狀態/新區域先查 `rule-to-ui-mapping.md`，語義以官方 start-guide 為準。

## 8. 響應式

- 斷點只用 `responsive-layout-system.md` 定義的六段；元件內 media query 用 rem 值對齊 token。
- 佈局模式/觸控行為切換用 `useViewportMode()`，不要自寫 resize listener。
- 觸控目標 ≥ `--touch-target-min`；hover-only 功能必須有 tap 等價路徑。

## 9. 不允許 hard-code 的內容

顏色（含 rgba/hex/oklch 字面值）、間距 px、字級 px、圓角、陰影、z-index、
卡牌尺寸、動效時長。全部走 `src/ui/tokens/`。

## 10. 什麼時候新增 token

- 同一個視覺值第 2 次出現、且語義相同 → 提為 token。
- 新語義（例如新的稀有度色）→ 在對應 tokens 檔加 primitive+semantic，並更新 design-system.md。
- 只是「想要一個更亮的黃」→ 不加，用既有 token 的 oklch 透明度變化。

## 11. 什麼時候新增元件

- 同一結構在 ≥2 處出現，或互動模式會被多頁使用 → 抽到對應層（primitives/forms/layout/feedback/game）。
- 新元件必須：props 有語義、含四態（hover/focus/active/disabled 適用者）、觸控可用、寫進 component-usage-guide.md。

## 12. 什麼時候**不能**新增元件

- 既有元件加一個 variant/prop 就能滿足 → 改既有元件。
- 只有單一頁面用、且只是排版 → 頁面內組合即可，不進 src/ui。
- 和既有元件語義重疊（例如再做一個 popover/另一種按鈕）→ 禁止，先廢再立。

## 13. 禁用清單（舊 UI 不得回流）

- `src/components/ui`、`src/components/battle`（已移除，import 會直接編譯失敗）。
- 舊 class：`.board`、`.battle-*`（side-sheet/panel-actions 除外）、`.zone-*`、`.hand-area`、`.card-selected` 等 v1 戰場 class。
- 舊 token 別名：`--lacquer/--bone/--gold/--vermilion/--ds-*`（僅過渡期存在）。
- 襯線斜體標題（`font-display italic` 組合）、`text-micro`/`text-minutia` 新用途。
