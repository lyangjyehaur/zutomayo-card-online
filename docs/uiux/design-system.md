# ZUTOMAYO CARD ONLINE — UI Design System

> 版本：**2.0**（Art Direction v2「深夜訊號」）
> Token 唯一來源：`src/ui/tokens/`（colors / spacing / typography / radius / shadow / motion / z-index / cards）
> 元件分層：`src/ui/{primitives, forms, layout, feedback, game}`（入口 `src/ui/index.ts`）
> 視覺方向：`new-art-direction.md`｜規則校準：`../rules/official-start-guide-ui-analysis.md`
> 開發流程：`how-to-add-new-feature.md`＋`ui-review-checklist.md`＋`component-usage-guide.md`
> 相關：`responsive-layout-system.md`、`interaction-flow.md`、`battlefield-online-adaptation.md`、`rule-to-ui-mapping.md`

---

## 3.1 Visual Direction / 視覺方向

### 風格關鍵詞（v2 —「深夜訊號 Midnight Signal」，詳見 new-art-direction.md）

- **深夜靛墨**畫布 ＋ 冷白文字 ＋ **電光黃**主行動 ＋ **官方晝夜雙色**（夜=青 / 晝=紅）敘事
- **粗體幾何無襯線**標題（直立、加寬字距）＋ 等寬字數值 — v1 襯線斜體已退役
- 卡牌是畫面的絕對主角：介面低飽和 hairline，彩度留給卡圖與規則語義色
- Chronos 晝夜循環是規則核心，也是整套視覺的雙色來源

### 不採用的風格

- ❌ 擬物木桌 / 皮革桌墊（干擾卡牌辨識）
- ❌ 賽博霓虹、大面積漸層光污染
- ❌ 概念海報式大字排版（犧牲操作密度）
- ❌ 手遊式金光特效堆砌、無意義粒子動畫
- ❌ 亮色主題（卡圖以深色調為主，深底最護卡面）

### 背景設計原則

1. 頁面底 `--color-bg-base`；面板 `--color-bg-surface`；浮層 `--color-bg-elevated` — 三層封頂。
2. 戰場氛圍（梯形透視 Canvas、環境光暈）只在 ≥1024px 寬且高度充足時渲染；行動端一律關閉，把像素留給資訊。
3. 背景任何裝飾的對比度不得高於卡牌邊框（`--color-border-subtle`）。

### 區域面板（ZonePanel）設計原則

- 區域用 1px `--color-border-subtle` ＋ `--color-bg-surface` 半透明底界定，不用重底色分區。
- 每個區域必有 label（等寬字、字距 `--tracking-meta`、`--color-text-muted`）；空區顯示區名水印。
- 己方區域可帶金系 hover 提示，對手區域不可（避免暗示可操作）。

### 卡牌容器設計原則

- 卡牌一律 5:7 直向比例（`--card-aspect-ratio`），**任何情況下不得壓扁、裁切成橫向**。
- 空間不足時的降級順序：縮小一級尺寸 → 改 CardStack（堆疊+計數）→ 改 Counter+入口（點擊開摘要）。
- 卡牌陰影只有一種（`--shadow-card`）；狀態靠 ring 表達，不靠多重陰影。

### 狀態提示設計原則（一眼分辨四態）

| 狀態                  | Token                | 視覺                                                    |
| --------------------- | -------------------- | ------------------------------------------------------- |
| 可操作 playable       | `--color-playable`   | 金色 ring（`--ring-playable`）＋緩慢呼吸                |
| 已選中 selected       | `--color-selected`   | 亮琥珀 2px 實框＋提起陰影（`--ring-selected`）          |
| 可作為目標 targetable | `--color-targetable` | 青綠 2px ring（`--ring-targetable`），與金/琥珀色相區隔 |
| 不可操作 disabled     | `--color-disabled`   | 整體降飽和 + opacity .45，`cursor: not-allowed`         |

### 裝飾元素使用邊界

- 允許：環境光暈（僅桌面）、dot pattern 水印（opacity ≤ 0.04）、Chronos 錶盤本身。
- 禁止：會移動的背景、覆蓋在卡牌上的裝飾、每回合都播放的過場動畫、非狀態驅動的閃爍。

---

## 3.2 Design Tokens

Token 分三層：**primitive**（`--ds-*`，只在 App.css 定義）→ **semantic**（`tokens.css`，元件唯一引用層）→ **component**（元件內組合）。禁止在元件/頁面中出現 hard-coded 色值、px 卡牌尺寸、magic spacing。

### Color Tokens（`src/ui/tokens/colors.css`）

```css
--color-bg-base        /* 頁面底（= surface-canvas） */
--color-bg-surface     /* 面板底（= surface-base） */
--color-bg-elevated    /* modal / popover（= surface-raised） */
--color-border-subtle  --color-border-strong
--color-text-primary   --color-text-secondary   --color-text-muted
--color-accent-primary   /* 金：己方、主行動 */
--color-accent-secondary /* 朱紫：對手、戰鬥 */
--color-danger --color-warning --color-success --color-info
--color-playable --color-selected --color-targetable --color-disabled
```

規則：

- 狀態色只用於卡牌/槽位互動狀態，不得挪作裝飾。
- 訊息色（danger/warning/success/info）只用於 toast、提示、log tone。
- 背景層永遠不使用 accent 色作為底色。

### Spacing Tokens

4px 基準：`--space-1`(4) `--space-2`(8) `--space-3`(12) `--space-4`(16) `--space-5`(20) `--space-6`(24) `--space-8`(32) `--space-10`(40) `--space-12`(48)。

- 戰場區域間距用流體 token：`--space-zone-gap`、`--space-slot-gap`（clamp，隨視口縮放，桌/平/手一致比例）。
- 頁面級：`--space-page-x/y`、`--space-panel`、`--space-section`。

### Typography Tokens

```css
--font-size-xs (10px)  meta、計數器、區域 label
--font-size-sm (12px)  輔助文字、log 行
--font-size-md (14px)  正文、按鈕
--font-size-lg (16px)  強調正文
--font-size-xl (20px)  面板標題
--font-weight-normal/medium/bold
--line-height-tight/normal
```

層級規範：卡牌名稱 `md/display italic`；區域名稱 `xs/mono/uppercase`；階段提示標題 `xs mono kicker` + 內文 `sm`；按鈕 `sm–md`；log `sm mono`。**行動端正文與按鈕不得小於 12px；10px 只允許用於非關鍵 meta。** 現存 `text-micro(8px)/text-minutia(9px)` 標記為 deprecated，僅桌面 meta 可暫用。

### Radius / Shadow / Border Tokens

```css
--radius-sm(4) --radius-md(8) --radius-lg(12) --radius-xl(16)
--shadow-card   /* 卡牌唯一陰影 */
--shadow-panel  /* 面板浮起 */
--border-panel  /* 1px subtle */
--border-active /* 2px 金 */
```

### Motion Tokens

```css
--motion-fast(120ms)   hover / 按壓回饋
--motion-normal(160ms) 狀態切換（ring、顏色）
--motion-slow(300ms)   卡牌移動、面板 / sheet 進出
--ease-standard --ease-emphasized
```

規則：動效只回應「狀態變化」與「玩家操作」；`prefers-reduced-motion` 時全部縮短或關閉；禁止 idle 循環動畫（唯一例外：playable 呼吸與計時警示）。

---

## 3.3 Card Sizing System

```css
--card-aspect-ratio: 5 / 7;          /* 唯一比例 */
--card-width-mini  32–40px   對手手牌背、log 縮圖、堆疊縮圖
--card-width-sm    44–56px   對手設置區/充能堆疊、低高度桌面己方槽
--card-width-md    56–76px   己方設置區、行動端手牌
--card-width-lg    72–96px   戰鬥區、桌面手牌
--card-width-xl    96–160px  詳情面板 / bottom sheet 預覽
--card-height-*    = width × 7/5（自動）
--slot-width/height-sm|md|lg = 卡牌 + --slot-pad×2
```

所有值皆 clamp 流體縮放；低高度桌面（≥1024px 寬 × ≤780px 高）有專屬 media 覆寫改以 `vh` 錨定。

### 元件對照

| 元件          | 用途                                                         |
| ------------- | ------------------------------------------------------------ | --------------------- |
| `CardView`    | 唯一卡牌渲染元件（正面/牌背/隱藏、四種互動狀態、尺寸=token） |
| `MiniCard`    | `CardView size="mini"`：只有卡圖，無 badge                   |
| `CompactCard` | `CardView size="sm                                           | md"`：卡圖＋cost chip |
| `FullCard`    | `CardView size="xl"`：詳情用，含完整數值                     |
| `CardStack`   | 牌組/深淵/充能堆疊：錯位縮圖 ≤3 張＋計數＋（可選）點擊開摘要 |
| `CardSlot`    | 空/占用槽位：label 水印、佔位虛框、undo 提示                 |

**禁止**：把直向卡牌塞進扁長區域。區域高度不足 `--card-height-sm` 時必須改為 `CardStack` 或 Counter＋入口，不得縮比例。

---

## 3.4 Component Standards

通則：所有互動元件觸控目標 ≥ `--touch-target-min`(44px)；可見 focus ring（`--focus-ring-*`）；行動端不得有 hover-only 功能。

| 元件                              | 使用場景                 | 尺寸                | 狀態                                                  | 桌面互動                | 行動端互動                          | A11y                             | 禁止                 |
| --------------------------------- | ------------------------ | ------------------- | ----------------------------------------------------- | ----------------------- | ----------------------------------- | -------------------------------- | -------------------- |
| **Button**（`ui/Button`）         | 主/次/危險行動           | h 36/44/48          | default·hover·active·disabled·loading                 | hover 變色              | ≥44px、active 按壓                  | `aria-disabled`、focus ring      | 一頁多個 primary     |
| **IconButton**                    | 工具列、關閉             | 44×44               | 同上＋pressed                                         | tooltip                 | 直接點                              | 必填 `label`                     | 無 label 圖示        |
| **Panel**（`ui/Panel`）           | 內容容器                 | pad `--space-panel` | solid·ghost                                           | —                       | —                                   | landmark/heading                 | 巢狀 Panel 超過 2 層 |
| **ZonePanel**（`battle/`）        | 遊戲區域容器             | 依 slot token       | idle·highlight                                        | hover 提示              | 點擊開摘要                          | `aria-label`=區名                | 用重底色分區         |
| **CardView**                      | 一切卡牌                 | `--card-width-*`    | faceup·facedown·playable·selected·targetable·disabled | hover 詳情（浮窗/側欄） | tap 選中、再 tap 確認；詳情走 sheet | `aria-label`=卡名；蓋牌=「牌背」 | 壓扁、自訂尺寸       |
| **CardSlot**                      | 空/占用槽位              | `--slot-*`          | empty·occupied·undoable·targetable                    | click undo/選目標       | 同左（目標 ≥44px）                  | `aria-label`=區名+卡名           | 無 label 空槽        |
| **CardStack**                     | 牌組/深淵/充能           | slot 尺寸           | empty·stacked                                         | click 開摘要            | tap 開摘要 sheet                    | `aria-label`=區名+數量           | 展開全部卡佔版面     |
| **PlayerStatus**                  | 雙方名+HP+計數           | bar h4px            | healthy·warning·danger·damaged                        | —                       | —                                   | `aria-live` HP 變化              | 遮擋戰場             |
| **PhaseIndicator**                | 當前階段/該做什麼        | 頂欄 h48            | 各 step·waiting                                       | —                       | —                                   | `role=status`                    | 一次顯示多個指令     |
| **ActionBar**（battle）           | 主行動按鈕組             | h ≥44               | confirm·waiting·choice                                | 按鈕                    | 拇指區固定底部                      | 主行動唯一                       | 超過 3 個按鈕        |
| **GameLog**                       | 歷史記錄                 | drawer/sheet        | open·closed                                           | 側欄常駐（≥1440）       | drawer                              | `aria-live=polite`               | 蓋住手牌             |
| **Toast**（ToastProvider）        | 操作結果、網路           | 頂部                | info·success·danger                                   | 自動消失                | 同左                                | `role=status`                    | 用 toast 問問題      |
| **Modal / Dialog**（`ui/Dialog`） | 危險確認、選擇           | max-w 32rem         | open·closed                                           | ESC/backdrop 關         | 同左                                | focus trap 必備                  | 巢狀 modal           |
| **Drawer**（AppDrawer）           | 次要功能、退出確認       | 右/底               | —                                                     | —                       | —                                   | focus trap                       | 放主流程             |
| **BottomSheet**（`ui/Sheet`）     | 行動端卡牌詳情、區域摘要 | ≤75vh               | peek·open·closed                                      | 不用                    | 下滑/backdrop 關                    | focus trap、handle               | 蓋滿全屏             |
| **Tabs**（SegmentedControl）      | 側欄 Focus/Status/Log    | h36+                | active·inactive                                       | click                   | tap ≥44px                           | `role=tablist`                   | 超過 4 tab           |
| **Tooltip**                       | 桌面補充說明             | —                   | —                                                     | hover/focus             | **不可用**（改 sheet）              | `aria-describedby`               | 放關鍵資訊           |
| **Badge**                         | 屬性/類型標籤            | h20                 | 語義色                                                | —                       | —                                   | 文字非僅色                       | 當按鈕用             |
| **Counter**                       | 張數/Power 數值          | mono                | normal·warn                                           | —                       | —                                   | `aria-label` 含單位              | 只有數字無語境       |
| **EmptyState**（`ui/State`)       | 空區/無資料              | —                   | —                                                     | —                       | —                                   | 描述性文字                       | 純空白               |

**元件檔案結構標準（single source of truth）**

```text
src/ui/index.ts          唯一匯入入口
src/ui/tokens/           design tokens（colors/spacing/typography/radius/shadow/motion/z-index/cards）
src/ui/primitives/       Button・IconButton・Panel・Badge・Tabs・Modal・Sheet(BottomSheet)・DataList…
src/ui/forms/            Input・Select・Checkbox・FormField・FormActions…
src/ui/layout/           PageShell・PageHeader・Workspace/Scroll/Status layouts・StatsGrid…
src/ui/feedback/         LoadingState・ErrorState・EmptyState（Toast＝ToastProvider）
src/ui/game/             CardView・CardSlot・CardStack・ZonePanel・BattleZone・SetZone・
                         ChargeZone・AbyssZone・DeckZone・HandZone・PlayerStatus/OpponentStatus・
                         ChronosPanel・PhaseIndicator・ActionDock・CardDetailPanel/Sheet・
                         ZoneSummarySheet・useViewportMode ＋ game.css
```

**已廢棄（禁止再使用）**：`src/components/ui`、`src/components/battle`（已移除）；
`--lacquer/--gold/--ds-*` 等 deprecated token 別名；`.board/.battle-*`（side-sheet 除外）舊 class；
`src/components/Card.tsx`（僅圖鑑/牌組編輯器過渡使用，遷移計畫見 page-redesign-plan.md）。

命名：layout 元件（`*Layout`、`*Grid`）不含遊戲邏輯；zone 元件收 props 不讀全域；UI 狀態（selected/inspected/sheet open）留在元件層，遊戲狀態（G.\*）唯讀。
