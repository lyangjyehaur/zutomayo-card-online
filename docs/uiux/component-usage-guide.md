# Component Usage Guide（元件使用指南）

> 對應程式碼：`src/ui/`；匯入一律 `import { X } from '../ui'`。
> 每個元件：使用場景 / props 語義 / 正確・錯誤用法 / 桌面・行動端互動 / 響應式 / a11y。

## primitives（`src/ui/primitives`）

### Button / IconButton / BackButton
- **場景**：一切行動入口。`variant`: `primary`（視圖唯一主行動）/`secondary`/`danger`（破壞性）/`ghost`（低干擾）；`size`: sm(36)/md(44)/lg(48)。
- ✅ `<Button variant="primary" onClick={submit}>確認出牌</Button>`
- ❌ 一頁多個 primary；❌ 用 div+onClick 自製按鈕；❌ IconButton 不給 `label`。
- 桌面 hover 變色；行動端 ≥44px、active 按壓；a11y：focus ring、`aria-disabled`。

### Panel
- **場景**：內容容器。`variant`: `solid`/`ghost`；`size` 控 padding。
- ❌ 巢狀超過兩層；❌ 拿來當按鈕。

### Badge / Tag / Counter 用法
- **場景**：狀態標籤、屬性、計數。`tone` 對應訊息色。數值計數用 mono 字（`Counter` 語義由 Badge+mono 組成）。
- ❌ 當按鈕用（可點的用 `TagButton`）。

### Modal（Dialog）
- **場景**：阻斷式決策、危險確認。自帶 focus trap、ESC、backdrop。
- ✅ 內容短、行動明確（1 primary + 1 secondary）。❌ 巢狀 modal；❌ 放長流程。

### Sheet / BottomSheet
- **場景**：`side="bottom"`＝行動端詳情/摘要（卡牌詳情、區域摘要）；`side="right"`＝桌面輔助內容。
- 行動端下滑/backdrop 關閉；≤75vh；a11y 同 Modal。
- ❌ 桌面把 bottom sheet 當主要導航；❌ 蓋滿全屏。

### Tabs（SegmentedControl）
- **場景**：同層內容切換（如 Focus/Status/Log）。`behavior="tabs"` 提供 `role=tablist`。
- ❌ 超過 4 個 tab；❌ 拿來做導航路由。

### Tooltip
- 現階段以 `title`/`aria-describedby` 輔助為主；**行動端禁止 hover tooltip**，改 sheet。關鍵資訊不得只放 tooltip。

## forms（`src/ui/forms`）

### Input / Select / Textarea / Checkbox / SearchInput
- `variant` `default`/`filled`；尺寸 sm/md。
- ✅ 一律包在 **FormField**（label、hint、error 一體）；送出列用 **FormActions**。
- ❌ 裸 input + 即席 class；❌ 只用 placeholder 當 label。
- a11y：FormField 自動關聯 label/id/error `aria-describedby`。

## layout（`src/ui/layout`）

### PageShell / WorkspaceLayout / ScrollPageLayout / StatusPageLayout
- **場景**：頁面殼層三選一（工作區/捲動內容/狀態頁）。內建 `--space-page-*` 與 AmbientGlow 裝飾（僅桌面渲染）。
- ❌ 頁面自寫 100vh/overflow 佈局。

### PageHeader / PageSectionHeader / FilterToolbar / StatsGrid
- 頁首（含 BackButton）、區塊標題、工具列、統計格。
- 響應式已內建（Toolbar 摺疊）；❌ 自製 sticky header。

## feedback（`src/ui/feedback`）

### LoadingState / ErrorState / EmptyState
- 每個非同步視圖三態齊備。ErrorState（=Alert）必附重試或說明。
- ❌ 空白 div 當 loading；❌ console.error 代替 UI 錯誤。

### Toast（ToastProvider）
- 操作結果、網路狀態。自動消失。❌ 用 toast 問問題/要求決策（改 Modal）。

### ConfirmDialog 模式
- 危險操作：`AppDrawer` actions 模式或 `Modal` + `variant="danger"` 按鈕 + 取消。

## game（`src/ui/game`）— 對戰專用

### CardView
- **唯一**的卡牌渲染元件。`size`: mini/sm/md/lg/xl（token 尺寸、5:7）；`state`: idle/playable/selected/targetable/disabled（data-state 驅動視覺）。
- 詳情不在元件內：`onInspect` 交給 CardDetail 層。
- ❌ 自訂寬高 / 壓扁；❌ 在外面再包 popover。

### CardSlot / CardStack
- 槽位（label 水印、undoable/targetable 態）與堆疊（縮圖≤3+計數、`onOpen` 開摘要）。
- ❌ 空槽無 label；❌ 堆疊全展開佔版面。

### ZonePanel
- 區域外框：官方區名＋用途 hint。所有區域元件的基座。

### BattleZone
- 對戰區：卡槽＋**常駐攻擊力讀數**（`attack: { value, insufficient }`，晝夜著色、PW 不足=0+警示）。
- Board 用 `getEffectiveAttack`/`isAttackPowerInsufficient` 計算後傳入。
- ❌ 把攻擊力藏回詳情；❌ 自行計算規則數值。

### SetZone
- `slot="A"|"B"|"C"`，自帶官方用途 hint（設置①/設置②・敗者/持續附魔）；C 區自動虛線＋青色。
- ❌ 用泛用 CardSlot 直接排 A/B/C。

### ChargeZone / AbyssZone / DeckZone
- 充能（總 Power 常駐＋來源摘要）/ 深淵（張數＋摘要）/ 牌組（張數，**無**內容入口）。
- ❌ DeckZone 加 onOpen（資訊隱藏）；❌ 只顯示充能張數不顯示總 Power。

### PlayerStatus / OpponentStatus
- 名稱＋HP bar＋meta＋受傷漂浮。`side` 決定配色（me=volt / opponent=晝紅）。HP 永遠可見。

### ChronosPanel / ChronosDial
- Chronos 儀表：12 段分段環（夜青/晝紅=官方配色 token `--time-*`），環心顯示時段/位置/時刻名。
- `size` md/sm；夜側玩家視角自動旋轉 180°。
- ❌ 縮成角落小圖示；❌ 復活舊版擬真時鐘（指針/獎章/錶面）。

### PhaseIndicator / ActionDock
- 「現在該做什麼」唯一提示 ＋ 唯一主行動列（confirm-set data-tut 錨點）。❌ 在別處再放一個主行動按鈕。

### HandZone
- `variant="fan"`（桌面 hover 抬起、click 出牌）/ `"strip"`（觸控橫滑、兩段式 tap）。由 `useViewportMode` 決定。

### CardDetailPanel / CardDetailSheet
- 同一 `CardDetailBody`：桌面右欄常駐 / 觸控 bottom sheet。❌ 新增第三種詳情呈現。

### ZoneSummarySheet
- 深淵/充能內容摘要（含每張 STP）；sheet 內卡牌可再開詳情。

### useViewportMode
- `{ mode: desktop|tabletPortrait|mobile, isTouch, isShort }`。佈局與互動分支唯一依據。❌ 自寫 resize listener / UA 判斷。
