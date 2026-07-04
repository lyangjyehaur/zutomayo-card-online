# UI Style Guide — ZUTOMAYO CARD Online

> 本規範定義整站統一視覺方向，**之後新增 UI 必須遵守這份規範**。
> 視覺方向：偏遊戲感、卡牌桌面感、ZUTOMAYO fan-made 氛圍。漆器質感的深色桌面 + 骨白 + 金箔 + 朱紅 + 翡翠的東方卡牌桌面語彙。
> 對應問題分析見 [ui-audit.md](./ui-audit.md)。
> 技術基盤：Tailwind v4 + 自訂 token（移除 daisyUI）。原則「Tailwind 為主，自訂 class 僅用於 SVG 漸層、複雜 keyframes、boardgame.io 容器」。

---

## 1. 色彩系統（Color）

### 1.1 語意色票（全部 oklch，定義於 `:root`）

| Token | 值 | 用途 | Tailwind class |
|---|---|---|---|
| `--lacquer-deep` | `oklch(0.11 0.005 270)` | 最深背景（全螢幕頁底色） | `bg-lacquer-deep` |
| `--lacquer` | `oklch(0.16 0.005 270)` | 次深背景 / 面板底色 | `bg-lacquer` |
| `--bg-2` | `oklch(0.2 0.005 270)` | 淺一階背景（hover/分層） | （自訂） |
| `--bone` | `oklch(0.965 0.012 90)` | 主文字色 / 高對比前景 | `text-bone` |
| `--gold` | `oklch(0.74 0.09 80)` | 主強調色（primary action、標題、focus） | `text-gold` / `bg-gold` |
| `--gold-soft` | `oklch(0.62 0.07 80)` | 次強調、金色文字較暗處 | `text-gold-soft` |
| `--vermilion` | `oklch(0.6 0.19 295)` | 危險/錯誤/對手/朱紅強調 | `text-vermilion` / `bg-vermilion` |
| `--jade` | `oklch(0.72 0.14 155)` | 成功/玩家/翡翠強調 | `text-jade` / `bg-jade` |

### 1.2 元素色票（卡牌屬性，提升為 token，**禁止硬編碼 hex**）

| Token | 值（hex 對應） | 用途 |
|---|---|---|
| `--element-dark` | `#aaa4e8` | 闇屬性 |
| `--element-flame` | `#ff8a8e` | 炎屬性 |
| `--element-electric` | `#f5d368` | 電気屬性 |
| `--element-wind` | `#42d7c6` | 風屬性 |
| `--element-chaos` | `#d8a5ff` | カオス屬性 |

> 統一由 `src/data/cardMetadata.ts` 匯出，Card.tsx 與 DeckSelector.tsx 共用，禁止兩處重複定義。

### 1.3 透明度語意（取代隨意 `/60`、`/8`）

| 語意 | 用途 | 範例 |
|---|---|---|
| `/5` | 極淡邊框/分隔線 | `border-bone/5` |
| `/10` | 面板邊框、ring | `ring-bone/10`、`border-bone/10` |
| `/30` | placeholder、disabled 文字 | `placeholder:text-bone/30` |
| `/40` | 次要文字、kicker 較暗 | `text-bone/40` |
| `/50` | 次要文字、返回按鈕 | `text-bone/50` |
| `/70` | muted 文字 | `text-bone/70`（取代舊 `--muted`） |
| `/8` | 背景光暈專用 | `bg-vermilion/8`（僅 `<AmbientGlow>`） |

### 1.4 色彩使用規則

1. **禁止硬編碼 hex / rgb / oklch 散落於組件**。所有顏色必須走 token 或 Tailwind class。
2. **文字色僅用**：`text-bone`（主）、`text-bone/70`（muted）、`text-bone/50`（dim）、`text-bone/40`（kicker）、`text-gold`（強調）、`text-vermilion`（錯誤）、`text-jade`（成功）。
3. **背景色僅用**：`bg-lacquer-deep`、`bg-lacquer`、`bg-lacquer/60`（半透明面板）、`bg-gold`/`bg-bone`（primary 按鈕）、`bg-vermilion`（danger）。
4. **daisyUI 色票（`bg-base-200`、`text-primary`、`text-success`、`text-error`）全面禁用**。

---

## 2. 字體系統（Typography）

### 2.1 字體家族（定義於 `:root`，已透過 `@theme inline` 橋接 Tailwind）

| Token | 字體 | Tailwind class | 用途 |
|---|---|---|---|
| `--font-display` | `'Kaisei Tokumin', 'EB Garamond', 'Songti SC', serif` | `font-display` | 標題、卡牌名、戰鬥結果 |
| `--font-sans` | `'Inter', 'PingFang TC', 'Noto Sans TC', sans-serif` | `font-sans` | 內文（預設 body） |
| `--font-mono` | `'JetBrains Mono', ui-monospace, monospace` | `font-mono` | kicker、數字、代碼、ID |

> i18n 字體覆寫（`html[lang='zh-CN']` → `Jiangcheng Jiexing`；`zh-TW`/`zh-HK` → `Uoq Mun Then Khung`）保留於 `:root`。

### 2.2 字級階梯（禁止散落任意值）

| 語意 | Tailwind class | 用途 |
|---|---|---|
| 顯示標題 | `font-display text-3xl italic` | 頁面主標（如 lobby 標題） |
| 區塊標題 | `font-display text-xl italic` | 面板標題、modal 標題 |
| 次標題 | `font-display text-lg italic` | 列表項標題（DeckSelector/Difficulty） |
| 內文 | `text-sm` | 一般文字、表單 |
| 小字 | `text-xs` | 輔助文字、meta |
| Kicker / Label | `font-mono text-[10px] uppercase tracking-[0.3em]` | 章節小標、按鈕文字、label |
| 極小字 | `font-mono text-[9px]` | badge、status（僅 badge 用） |

**規則**：
- `text-[10px] uppercase tracking-[0.3em]` 僅用於 kicker/label/按鈕，且**必須**透過 `<Kicker>` 或 `<PrimaryButton>` 等共用組件產出，禁止散落。
- `tracking-[0.35em]`、`tracking-widest` **禁用**（與 `tracking-[0.3em]` 近似卻不一致，統一用 `tracking-[0.3em]`）。
- 主要內文用 Tailwind 標準級距（`text-xs`/`text-sm`/`text-base`），禁止 `text-[13px]` 等任意值。

---

## 3. 間距系統（Spacing）

使用 Tailwind 標準級距，**禁止任意值**（`px-[13px]`、`py-[7px]`）。

| 語意 | Tailwind class | 用途 |
|---|---|---|
| 緊湊 | `p-1` / `px-1.5 py-1` | badge、極小控件 |
| 控件內距 | `px-3 py-2` | input、select、小按鈕 |
| 按鈕內距 | `px-4 py-1.5`（小）/ `px-5 py-2.5`（中）/ `px-8 py-3`（大） | 按鈕尺寸階梯 |
| 面板內距 | `p-4`（緊湊）/ `p-5`（標準）/ `p-6`（寬鬆） | `<Panel>` |
| 區塊間距 | `gap-2`（緊）/ `gap-4`（標準）/ `gap-6`（鬆） | flex/grid |
| 頁面邊距 | `px-4 md:px-6` | header、頁面水平邊距 |

**規則**：頁面水平邊距統一 `px-4 md:px-6`；面板統一 `p-4` 或 `p-5`；禁止 `px-3 py-1.5` 與 `px-3 py-2` 兩種近似值混用（input 統一 `px-3 py-2`）。

---

## 4. 圓角系統（Radius）

| Token | 值 | Tailwind class | 用途 |
|---|---|---|---|
| `--radius-sm` | `0.25rem` | `rounded-xs` | badge、小控件 |
| `--radius` | `0.375rem` | `rounded-sm` | **預設**：面板、按鈕、卡牌、input |
| `--radius-md` | `0.5rem` | `rounded-md` | modal、大型面板 |
| `--radius-full` | `9999px` | `rounded-full` | 頭像、小圓點、進度條 |

**規則**：
- 預設圓角統一 `rounded-sm`（取代散落 45 處的 `border-radius: var(--radius)`）。
- 卡牌、面板、按鈕、input 皆 `rounded-sm`。
- 僅頭像/圓點/進度條用 `rounded-full`。
- **禁用** `rounded-box`（daisyUI）、`rounded-lg` 以上於一般面板。

---

## 5. 陰影系統（Shadow）

| Token | 值 | 用途 |
|---|---|---|
| `--shadow` | `0 1rem 3rem rgba(0,0,0,0.38)` | 預設面板陰影 |
| `--shadow-soft` | `0 8px 32px -8px rgba(0,0,0,0.4)` | 次要面板、卡片 hover |
| `--shadow-glow-gold` | `0 0 12px rgba(gold,0.6)` | 金色強調（選中、focus glow） |
| `--shadow-glow-vermilion` | `0 0 12px rgba(vermilion,0.6)` | 朱紅強調 |

**規則**：
- 面板陰影統一用 `--shadow`，次要面板用 `--shadow-soft`。
- 禁止散落 `shadow-[0_30px_80px_-20px]`、`shadow-[0_4px_12px_-4px]` 等任意值；若需特殊陰影須提升為 token。
- `<AmbientGlow>` 背景光暈不屬陰影系統，另見 §12。

---

## 6. 邊框系統（Border）

| 語意 | 值 | 用途 |
|---|---|---|
| 淡分隔線 | `1px solid var(--bone/5)` | header 底線、區塊分隔 |
| 面板邊框 | `1px solid var(--bone/10)` | 預設面板邊框（搭配 `ring-1 ring-bone/10`） |
| 強調邊框 | `1px solid var(--gold/40)` | focus、選中 |
| 危險邊框 | `1px solid var(--vermilion/50)` | 錯誤、danger action |

**規則**：
- 面板邊框統一用 `ring-1 ring-bone/10`（取代散落 30 處的 `border: 1px solid var(--line-soft)`）。
- 選中態用 `ring-2 ring-gold`（統一規格，禁止 Board `ring-2 ring-gold shadow-...` 與 DeckEditor `ring-gold/30` 兩種）。
- 禁用 daisyUI `border`、`border-base-300`。

---

## 7. z-index 層級（Z-Index）

**統一 scale，禁止魔法數字**（取代目前 21 種散落值）：

| Token | 值 | 用途 |
|---|---|---|
| `--z-base` | `0` | 預設 |
| `--z-dropdown` | `10` | 下拉選單、tooltip |
| `--z-sticky` | `20` | sticky header |
| `--z-overlay` | `50` | 教學覆蓋層、半透明遮罩 |
| `--z-modal` | `100` | modal、drawer |
| `--z-toast` | `200` | toast 通知 |
| `--z-max` | `9999` | 唯一最高層（如繞過一切的全螢幕 loading） |

**規則**：浮層一律走 scale，禁止 `z-[1000]`、`z-[900]`、`z-180` 等任意值。

---

## 8. 按鈕系統（Button）

統一由 `src/components/ui/` 的 `<Button>` 家族產出，**禁止 inline Tailwind 按鈕字串**。

### 8.1 變體（variant）

| 變體 | 外觀 | 用途 |
|---|---|---|
| `primary` | `bg-gold text-lacquer`（純色，**唯一 primary**） | 主要動作（開始對戰、確認、儲存） |
| `secondary` | `border border-bone/20 text-bone/60 hover:border-vermilion/50 hover:text-vermilion` | 次要動作（取消、返回） |
| `danger` | `bg-vermilion text-bone` 或 `border border-vermilion/50 text-vermilion` | 危險動作（刪除、離開） |
| `ghost` | `text-bone/50 hover:text-bone`（無背景） | 工具列、連結式按鈕 |

### 8.2 尺寸（size）

| 尺寸 | 內距 | 字級 |
|---|---|---|
| `sm` | `px-4 py-1.5` | `text-[10px]` |
| `md` | `px-5 py-2.5` | `text-[10px]` |
| `lg` | `px-8 py-3` | `text-[11px]` |

### 8.3 通用規則

- 所有按鈕文字統一 `uppercase tracking-[0.3em] font-medium`。
- 所有按鈕含 `transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40`。
- 所有按鈕含 `focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-lacquer`。
- **禁用**：`primary-action`/`secondary-action` 自訂 class、daisyUI `btn`、`primaryActionClass()` 函式、`bg-bone`/`bg-gradient-to-b from-bone` 等其他 primary 變體。
- `<BackButton>` 是 `ghost` 變體的語意化封裝，統一返回大廳按鈕。

---

## 9. 卡片系統（Card / Panel）

### 9.1 面板 `<Panel>`

```
rounded-sm bg-lacquer p-4 ring-1 ring-bone/10
```

- 預設 `p-4`；可傳 `size="lg"` → `p-5`、`size="xl"` → `p-6`。
- 半透明變體 `variant="ghost"` → `bg-lacquer/60`（用於浮動資訊卡）。
- **禁止**散落 `rounded-sm bg-lacquer p-4 ring-1 ring-bone/10` 字串。

### 9.2 卡牌 `<Card>` / `<CardBack>`

- 卡牌尺寸 token 保留：`--card-normal/small/tiny/micro`（130/100/75/50 寬，高 = 寬×1.4）。
- 卡背統一 `<CardBack size>` 元件，禁止散落 `<img src="/card-back.jpg" className="h-full w-full object-cover" loading="lazy">`。
- 元素色標由 `cardMetadata.ts` 統一匯出，禁止 `<Card>` 與 `<DeckSelector>` 兩處定義。

### 9.3 卡牌 popover `<PopoverPanel>`

```
pointer-events-none fixed z-50 rounded-sm
bg-gradient-to-br from-lacquer-deep via-lacquer-deep/95 to-lacquer
p-4 shadow-2xl ring-1 ring-gold/30 backdrop-blur
```

- 定位由 `usePopoverPosition` hook 統一計算（取代 Card 與 DeckEditor 兩套平行實作）。

---

## 10. 彈窗系統（Modal / Drawer / ConfirmDialog）

**統一由 `<Modal>` / `<Drawer>` 系列產出，禁止三套並存**。

### 10.1 `<Modal>`（中央彈窗）

- 遮罩：`fixed inset-0 z-[var(--z-modal)] bg-surface-overlay backdrop-blur`。
- 面板：`rounded-md bg-lacquer p-6 ring-1 ring-gold/30 shadow-[--shadow]`。
- 取代：MatchHistory `modal modal-open`、Board `phase-message-overlay`、FeedbackPage `feedback-modal-overlay`。

### 10.2 `<Drawer>`（底部/側邊抽屜）

- 以現有 `AppDrawer` 為基底，成為唯一抽屜實作。
- 按鈕 tone 改用 `<Button>` 家族（取代 `primary-action`/`secondary-action` 自訂 class）。

### 10.3 `<ConfirmDialog>`

- `<Modal>` 的語意化封裝，含 title / body / confirm / cancel。
- **取代** `window.confirm()`（TutorialGamePage）與 OnlineGamePage 自訂 `LeaveConfirmDialog`。

---

## 11. 表單系統（Form）

### 11.1 `<Input>` / `<Select>` / `<Textarea>`

統一樣式：

```
border border-bone/10 bg-lacquer-deep px-3 py-2 text-sm text-bone
placeholder:text-bone/30
transition
focus:border-gold/40 focus:outline-none focus:ring-2 focus:ring-gold/40
disabled:opacity-40
```

- **禁止**：daisyUI `input input-bordered`、AuthSection 的 `bg-gradient-to-b from-lacquer-deep/80` 變體、LanguageSwitcher 的 `text-[9px]` 變體。
- focus 統一 `focus:ring-2 focus:ring-gold/40`（input 用 `focus` 非 `focus-visible`，因 input 不需鍵盤區分）。

### 11.2 `<FieldLabel>`

```
text-[10px] uppercase tracking-[0.3em] text-bone/40
```

- 含 `group-focus-within:text-gold/70`（搭配 `<FormField>` 的 `group`）。

### 11.3 `<FormField>`

`<FieldLabel>` + 控件 + 错误提示的封装，取代 AdminPage `label.label grid gap-1 p-0` 與 FeedbackPage `field-label` 兩套。

### 11.4 `<FormActions>`

按鈕列容器：`flex items-center gap-3 justify-end`。取代散落 `form-actions`、`modal-actions`。

---

## 12. 背景與佈局（Layout）

### 12.1 全螢幕頁面殼層 `<PageShell>`

```
relative h-screen w-screen overflow-hidden bg-lacquer-deep font-sans text-bone
```

- 取代 AIGame/OnlineGame/AILobby/OnlineLobby/LobbyPage 各自重複的外層容器。
- 含 `<AmbientGlow>` 背景光暈插槽。

### 12.2 `<AmbientGlow>` 背景光暈（參數化，取代 5 種變體）

```
pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
rounded-full blur-[120px]
```

- props：`color`（`vermilion` | `gold`，預設 `vermilion`）、`size`（`sm` | `md` | `lg`，對應 50vh / 60vh / 80vh）、`blur`（`120` | `140` | `160`，依 size 自動）。
- **統一參數**，禁止各頁自訂 `h-[80vh] w-[80vh] blur-[140px]`、`h-[60vh] w-[120vh] blur-[120px]`、`h-[50vh] w-[50vh] blur-[140px]`、`bg-gold/8 blur-[140px]`、`h-[90vh] w-[90vh] blur-[160px]` 五種變體。

### 12.3 `<LobbyHeader>`

```
h-12 border-b border-bone/5 bg-lacquer-deep/80 px-4 backdrop-blur md:px-6
```

- 含 `<BackButton>` 插槽與標題插槽。
- 取代 AILobbyPage 與 OnlineLobbyPage 幾乎逐字相同的 header。

### 12.4 響應式斷點（統一）

| 斷點 | Tailwind | 用途 |
|---|---|---|
| 手機 | 預設（無前綴） | <768px |
| 平板 | `md:` | ≥768px |
| 桌面 | `lg:` | ≥1024px |

**規則**：
- 僅使用 768 / 1024 兩個斷點。
- **禁用** `sm:`（640px）、`767px`、`680px`、`480px` 等其他斷點。
- media query 統一 `min-width`（mobile-first），禁止 `max-width: 767px` 與 `max-width: 768px` 並存。

---

## 13. 狀態元件（State）

### 13.1 `<LoadingState>`

```
flex items-center justify-center gap-3
font-mono text-[10px] uppercase tracking-[0.3em] text-bone/50
```

- 含 spinner（`size-4 animate-spin rounded-full border-2 border-bone/20 border-t-gold`）。
- 取代 `alert alert-info`、`feedback-empty`、`text-[10px] text-vermilion/70`、`font-mono text-[10px] uppercase tracking-[0.3em] text-bone/50` 四種變體。

### 13.2 `<ErrorState>`

```
flex items-start gap-2 rounded-sm border-l-2 border-vermilion/50 bg-vermilion/10 px-3 py-2
text-xs text-vermilion/80
```

- 取代 `alert alert-error`、`feedback-error`、`text-[10px] text-vermilion/80` 三種變體。

### 13.3 `<EmptyState>`

```
flex flex-col items-center justify-center gap-2 py-8
font-mono text-[10px] uppercase tracking-[0.3em] text-bone/40
```

- 取代 `alert`、`feedback-empty` 兩種變體。

### 13.4 `<PageShell>` 含 `loading` / `error` / `empty` / `children` 四個 slot，统一状态渲染流程。

---

## 14. 其他共用元件

| 元件 | 用途 | 取代 |
|---|---|---|
| `<Kicker>` | `font-mono text-[10px] uppercase tracking-[0.3em] text-gold/70` | 散落 10+ 處 kicker |
| `<SectionHeader>` | `<Kicker>` + 標題組合 | DeckSelector/Difficulty 標題 |
| `<EyebrowLabel>` | 同 Kicker，用於首頁標籤 | LobbyPage 散落 8+ 處 |
| `<Badge>` | `rounded-xs border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.18em]` | daisyUI `badge` 與 Board Tailwind badge |
| `<HpBar>` | HP/進度條統一（`h-1 bg-bone/10` + `absolute inset-y-0 left-0` + tone） | Board LpBar/內嵌 HP/AuthSection winRate |
| `<ListItemButton>` | 列表項按鈕（`selected` prop） | DeckSelector/Difficulty/EffectOrder/PendingChoice |
| `<Tooltip>` | hover 提示 | OnlineLobby 重複 2 次的 tooltip 區塊 |
| `<DataTable>` | `table` 殼層 | Admin/Leaderboard/I18n 重複 |
| `<Pagination>` | 分頁按鈕 | DeckEditor/MatchHistory 重複 |
| `<CardBack>` | 卡背圖 | 散落 5+ 處 |
| `<GameClientFrame>` | boardgame.io 容器殼層 | AIGame/OnlineGame 重複 |

---

## 15. 動畫與無障礙

### 15.1 動畫

- 過渡統一 `transition` 或 `transition-all duration-300`。
- 動畫 keyframes 集中於 `src/styles/animations.css`，**禁止重複定義**（`battle-zone-glow` ×3、`damage-flash` ×2 須合併）。
- 所有動畫須有 `@media (prefers-reduced-motion: reduce)` 的對應靜態版本（這是現有 `!important` 的**唯一合理用途**）。

### 15.2 無障礙

- 所有可點擊元素（button、role=button 的 div）須含 `focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-lacquer`。
- 彈窗須含 `role="dialog"`、`aria-modal="true"`、`aria-labelledby`。
- Toast/loading/error 須含 `aria-live="polite"`（toast/error 用 `assertive`）。
- icon-only 按鈕（如關閉鈕 `×`）須含 `aria-label`。
- **禁用** `window.confirm` / `window.alert` / `alert()`，改用 `<ConfirmDialog>` / Toast。
- emoji 字元（`📝⚙️🌐▲△✕✓👍❤️`）改用 `lucide-react` icon，保留 `aria-label`。

---

## 16. i18n 與文案

- 所有使用者可見文案須走 `t(...)` i18n，**禁止硬編碼中文**（含 fallback 字串如 `'確定要跳過教學嗎？'`）。
- `CHRONOS_LABELS`（時鐘標籤）須移到 i18n 檔。
- AdminPage 的 `'管理員面板'`、`'儲存中…'`、`'儲存'`、`'已儲存'` 等須 i18n 化。

---

## 17. 檔案組織

```
src/
├── styles/
│   ├── tokens.css          # :root 設計 token（色彩/字體/間距/圓角/陰影/z-index/元素色）
│   ├── tailwind-theme.css  # @theme inline（token → Tailwind 橋接）
│   ├── base.css            # reset + @layer base
│   └── animations.css      # @keyframes 集中
├── components/
│   └── ui/                 # 共用 UI 組件庫（本規範定義的所有 <Element>）
│       ├── Button.tsx
│       ├── Panel.tsx
│       ├── Modal.tsx
│       ├── Form.tsx
│       ├── State.tsx       # LoadingState/ErrorState/EmptyState
│       └── ...
└── data/
    └── cardMetadata.ts     # 元素色、ELEMENT_LABEL、TYPE_LABEL 統一
```

**規則**：
- `App.css` 拆分後，舊檔案僅保留無法用 Tailwind 表達的組件樣式（如 boardgame.io 容器），並以 `@layer components` 包住。
- 共用組件一律放 `src/components/ui/`，業務組件放 `src/components/`。
- 禁止在 `src/pages/` 直接寫樣式字串，頁面層僅組裝共用組件。

---

## 18. 違規檢查清單（PR review 用）

新增 UI 時，PR 須自查以下事項：

- [ ] 未使用 daisyUI class（`btn`、`card`、`modal`、`input-bordered`、`bg-base-200`、`text-primary`…）。
- [ ] 未硬編碼 hex / rgb / oklch（皆走 token 或 Tailwind class）。
- [ ] 未使用 `!important`（除 `prefers-reduced-motion`）。
- [ ] 未散落 `text-[10px] uppercase tracking-[0.3em]` 字串（用 `<Kicker>` 或 `<Button>`）。
- [ ] 未散落 `rounded-sm bg-lacquer p-4 ring-1 ring-bone/10`（用 `<Panel>`）。
- [ ] 未散落 `<img src="/card-back.jpg">`（用 `<CardBack>`）。
- [ ] 按鈕統一用 `<Button>` 家族，無 inline 按鈕 className。
- [ ] input/select/textarea 統一用 `<Input>` 等，focus 規格一致。
- [ ] 彈窗用 `<Modal>` / `<Drawer>` / `<ConfirmDialog>`，無 `window.confirm`/`window.alert`。
- [ ] loading/error/empty 用 `<LoadingState>`/`<ErrorState>`/`<EmptyState>`。
- [ ] z-index 走 scale token，無魔法數字。
- [ ] 斷點僅用 `md:`（768）/ `lg:`（1024）。
- [ ] 背景光暈用 `<AmbientGlow>`，無自訂尺寸/模糊值。
- [ ] 文案走 i18n，無硬編碼中文。
- [ ] emoji 改用 lucide-react icon。
- [ ] 可點擊元素含 `focus-visible` 樣式。
- [ ] 卡牌元素色取自 `cardMetadata.ts`，未重複定義。
