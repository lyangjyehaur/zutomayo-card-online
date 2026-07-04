# UI Refactor Roadmap

審查日期：2026-07-03  
原則：先修阻斷與高風險，再補 Design System，再重構主要頁面布局。每個 phase 都應保持小 commit，避免一次重寫 UI。

## Phase 0：立即修復阻斷問題

| 項目 | 內容 |
| --- | --- |
| 目標 | 修掉核心手機/觸控風險，不改業務邏輯。 |
| 涉及頁面 | Battle、Landing intro、Feedback toolbar、Deck Builder active deck。 |
| 涉及組件 | `Board`, `PendingChoicePanel`, `LobbyPage` intro Panel, `FeedbackPage` toolbar, `DeckEditor` active deck list。 |
| 風險 | Battle CSS 規則重複，改一處可能被後段 CSS 覆蓋；需用 smoke 驗證。 |
| 驗收標準 | 360x740、390x844、430x932 下核心可點擊元素 >=44px；Battle 左右 stack zone 不可視越界；`npm run smoke:responsive` PASS。 |
| 建議 commit 粒度 | 1. Battle mobile zone/action target；2. Landing intro touch target；3. Feedback toolbar 44px；4. Deck remove icon button。 |

具體任務：

| 優先 | 任務 | 涉及文件 | 驗收 |
| --- | --- | --- | --- |
| P0 | Battle 360/390px 左右 stack zone 不越界 | `src/components/Board.tsx`, `src/App.css` | `/qa/battle?state=turn-set` 360x740 無可視 `battle-stack-zone` offscreenX。 |
| P0 | Battle pending choice options/footer >=44px | `src/components/Board.tsx`, `src/App.css` | pending choice 360x740 選項與送出按鈕高度 >=44px。 |
| P0 | Landing intro 手機 actions >=44px | `src/pages/LobbyPage.tsx` | 360x740 初訪 Panel 的 close/primary/secondary 全 >=44px。 |
| P0 | Feedback toolbar 手機 controls >=44px | `src/pages/FeedbackPage.tsx`, `src/App.css` | 360/390/430 下 sort/filter/action 控件 >=44px。 |
| P0 | Deck active deck remove button 44px | `src/components/DeckEditor.tsx` | Active deck sheet/list 移除操作可觸控且有 aria-label。 |

## Phase 1：統一 Design Token

狀態：Complete（2026-07-04）。已建立 semantic token foundation，完成 shared primitives 與 TSX usage migration；legacy `src/App.css` raw values 已隔離為 Phase 3/4 page-specific refactor debt。

| 項目 | 內容 |
| --- | --- |
| 目標 | 補齊 token/rule，避免後續修復繼續硬寫樣式。 |
| 涉及頁面 | 全站，優先 I18n/Admin/Feedback/Battle。 |
| 涉及組件 | `Button`, `Panel`, `Dialog`, `Sheet`, `PageShell`, `PageHeader`。 |
| 風險 | Token migration 可能改變舊頁視覺；需分段替換而非一次刪舊變數。 |
| 驗收標準 | 新增 DS gap 中的 touch target、breakpoint、z-index、shadow、motion、a11y rules；不新增硬編碼 color/shadow/z-index。 |
| 建議 commit 粒度 | 1. token/rule docs；2. z-index/shadow tokens；3. typography/touch utilities；4. deprecated token mapping。 |

具體任務：

| 優先 | 任務 | 涉及文件 | 驗收 |
| --- | --- | --- | --- |
| P1 | 補 `--shadow-popover`, `--shadow-sheet`, selected/focus token | `src/App.css`, `docs/ui-style-guide.md` | 任意 shadow 新用法減少，popover/sheet 使用 token。 |
| P1 | 補產品 breakpoint rule | `docs/ui-style-guide.md`, `docs/responsive-strategy.md` | 明確 `desktopSidebar >=1180`, `lowHeight <=780`, `touch <=820`。 |
| P1 | 補 a11y/touch target rule | `docs/ui-style-guide.md` | 所有互動元件最小 44px 寫入 DS。 |
| P1 | 建立 deprecated token 清單 | `docs/design-system-gaps.md`, `src/App.css` | 舊 token 不再用於新增 UI。 |

## Phase 2：統一基礎組件

狀態：Complete for low-risk standardization（2026-07-04）。已建立並落地 `IconButton`, `SearchInput`, `Tag`, `TagButton`, `Alert`, `EmptyState`, `LoadingState`, `SegmentedControl`，並將通用 command/tabs/filter/close/form/status controls 遷移到 shared UI primitives。保留的 raw buttons 均為 domain-specific interactive surfaces（Battle 卡牌/格子/選擇、Feedback vote/card、Admin/Deck card tile），後續需以專用 wrapper 處理，不應硬套 generic `Button`。

| 項目 | 內容 |
| --- | --- |
| 目標 | 讓頁面不用再手寫 button/input/dialog/toolbar/table/card detail。 |
| 涉及頁面 | Feedback、Deck Builder、Admin、I18n、Lobby/Auth。 |
| 涉及組件 | `Button`, `IconButton`, `Dialog`, `Sheet`, `ResponsiveToolbar`, `DataList`, `Alert`, `Toast`, `CardDetailSurface`。 |
| 風險 | 遷移過多頁面會造成大 diff；先建 primitive，再逐頁替換。 |
| 驗收標準 | 新 primitive 已加入 shared UI export；Feedback/Auth/Admin/I18n/Deck/Lobby/Tutorial/Battle safe CTAs 已遷移；`npm run build` PASS。 |
| 建議 commit 粒度 | 1. IconButton + Button variants；2. Dialog/Sheet a11y；3. Alert/Loading/Empty/Toast；4. ResponsiveToolbar/DataList；5. CardDetailSurface。 |

具體任務：

| 優先 | 任務 | 涉及文件 | 驗收 |
| --- | --- | --- | --- |
| P2 | 新增 `IconButton` | `src/components/ui` | Done：label 必填，size 預設 44px；Dialog/Sheet/Toast/AppDrawer/App/Lobby/Deck/Feedback/Battle safe icon actions 已替換。 |
| P2 | 新增 `SegmentedControl` | `src/components/ui/SegmentedControl.tsx` | Done：Auth/Admin/I18n/Feedback/Deck/Battle side sheet tabs/filters 已遷移。 |
| P2 | 新增 `SearchInput` / `TagButton` / state primitives | `src/components/ui/Input.tsx`, `Badge.tsx`, `State.tsx` | Done：Deck search、Feedback tags/reactions、Feedback/Auth loading/error/empty 已遷移。 |
| P2 deferred to P5 | `Dialog`/`Sheet` 加 focus trap/restore/scroll lock | `src/components/ui/Dialog.tsx`, `src/components/ui/Sheet.tsx` | 鍵盤 Tab 不離開 modal；Esc/close 後焦點回原按鈕。 |
| P2 deferred to P3/4 | `ResponsiveToolbar` 支援 phone filter sheet | `src/components/ui/ResponsiveToolbar.tsx` | Feedback/Deck/Admin 可共用 actions/filter slots。 |
| P2 deferred to P3/4 | `DataList` 支援 mobile card mode | `src/components/ui/DataList.tsx` | Admin/I18n 不再各自維護 table-to-card CSS。 |
| P2 deferred to P3 | `CardDetailSurface` + popover hook | `src/components/CardBrowser.tsx`, `src/components/Card.tsx`, `src/components/DeckEditor.tsx` | 桌面 popover、手機 sheet 一致。 |

## Phase 3：重構主要頁面布局

狀態：Complete for layout architecture consolidation（2026-07-04）。已新增 `src/components/ui/Layout.tsx` 並落地 `WorkspaceLayout`, `ScrollPageLayout`, `PageSectionHeader`, `StatusPageLayout`, `ToolHeader`, `FilterToolbar`, `StatsGrid`, `StatCard`。主要 scroll/workspace/data shell 已遷移；Battle 已完成 named slot extraction。未處理的深層 modal/data-list/focus trap 屬於 Phase 4/5，不再視為 Phase 3 尾巴。

| 項目 | 內容 |
| --- | --- |
| 目標 | 用共用 primitives 重排主要頁面，不重寫業務流程。 |
| 涉及頁面 | Battle、Deck Builder、Feedback、Online Lobby、AI Lobby。 |
| 涉及組件 | `WorkspaceLayout`, `ScrollPageLayout`, `PageSectionHeader`, `ToolHeader`, `FilterToolbar`, `StatsGrid`, Battle layout slots。 |
| 風險 | Battle 是核心高風險；需先用 `/qa/battle` fixture 驗證每個 state。 |
| 驗收標準 | `npm run smoke:responsive` PASS；`npm run build` PASS；主要頁面 layout shell 不新增 page-specific hardcoded style。 |
| 建議 commit 粒度 | 1. Battle layout slots；2. Deck workspace variants；3. Feedback toolbar/modal；4. Lobby collapsible room; 5. AI Lobby breakpoint。 |

具體任務：

| 優先 | 任務 | 涉及文件 | 驗收 |
| --- | --- | --- | --- |
| Done | Battle layout slots | `src/components/Board.tsx` | 已抽出 Battle-only topbar/content/sidebar/overlay structural slots；不分叉 game logic。 |
| Done | Deck Builder workspace variants | `src/components/DeckEditor.tsx`, `src/components/ui/Layout.tsx` | active deck desktop aside 交給 `WorkspaceLayout`；手機/平板既有 Sheet 行為保留。 |
| Done | Feedback shell/toolbar 遷移 | `src/pages/FeedbackPage.tsx`, `src/components/ui/Layout.tsx` | header/stats/toolbar 使用 shared layout primitives；detail modal 留到 P5。 |
| Done | Online Lobby workspace shell | `src/pages/OnlineLobbyPage.tsx`, `src/components/ui/Layout.tsx` | quick/deck/custom room 內容保留，sidebar/content shell 統一。 |
| Done | AI Lobby workspace shell | `src/pages/AILobbyPage.tsx`, `src/components/ui/Layout.tsx` | difficulty side column 交給 `WorkspaceLayout`；選擇流程不變。 |
| Deferred to P4 | Responsive data list/card mode | `src/components/ui/DataList.tsx`, `src/pages/AdminPage.tsx`, `src/pages/I18nManager.tsx` | 需要專門處理 table-to-card 資訊密度，不屬於 shell 抽象。 |
| Deferred to P5 | Dialog/Sheet focus architecture | `src/components/ui/Dialog.tsx`, `src/components/ui/Sheet.tsx`, `src/pages/FeedbackPage.tsx` | 需要 focus trap/restore/scroll lock 驗收。 |

## Phase 4：響應式細節調整

| 項目 | 內容 |
| --- | --- |
| 目標 | 修低高度桌面、平板橫豎屏、手機密度與內容遮擋。 |
| 涉及頁面 | 全部頁面，重點 Battle/Deck/Admin/Feedback/Landing。 |
| 涉及組件 | `PageShell`, `PageHeader`, `ResponsiveToolbar`, `Panel`, `ActionBar`。 |
| 風險 | 細節變多，容易引入視覺回歸；需建立正式 smoke 矩陣。 |
| 驗收標準 | 12 必測尺寸正式 smoke；無 document overflowX；touch target 無 <44px；低高度桌面無主要操作被遮。 |
| 建議 commit 粒度 | 1. low-height desktop；2. tablet portrait/landscape；3. mobile spacing/type; 4. smoke script。 |

具體任務：

| 優先 | 任務 | 涉及文件 | 驗收 |
| --- | --- | --- | --- |
| P4 | 將補充探針正式化 | `scripts/ui-responsive-smoke.mjs`, `package.json` | 覆蓋 12 尺寸與主要路由，輸出 JSON + 截圖。 |
| P4 | Low-height compact density | `src/components/ui/PageShell.tsx`, `src/App.css` | 1280x720/1366x768 Battle/Deck/Feedback 首屏主要操作可見。 |
| P4 | 手機 typography/tracking 收斂 | `src/components/ui`, page components | 控件文字不因 0.3em tracking 擠壓或換行難讀。 |
| P4 | 裝飾層不造成 QA 誤報 | `LobbyPage`, `DeckEditor`, `PageShell` | Glow 使用 constrained token，DOM 探針不報 offscreen decorative layer。 |

## Phase 5：可訪問性與 polish

| 項目 | 內容 |
| --- | --- |
| 目標 | 補齊 keyboard、focus、screen reader、reduced motion、contrast 與最後視覺一致性。 |
| 涉及頁面 | 全站。 |
| 涉及組件 | `Dialog`, `Sheet`, `Tabs`, `Toast`, `InteractiveCard`, `DataList`, `Tooltip`。 |
| 風險 | a11y 改動可能暴露舊 DOM 語意問題，需要逐頁修。 |
| 驗收標準 | 主要流程可鍵盤完成；modal focus trap；icon-only 全有 label；custom tag color 有 contrast policy；reduced motion 可用。 |
| 建議 commit 粒度 | 1. keyboard/focus；2. modal a11y；3. contrast and reduced motion；4. visual polish pass。 |

具體任務：

| 優先 | 任務 | 涉及文件 | 驗收 |
| --- | --- | --- | --- |
| P5 | Tabs/SegmentedControl roving focus | `src/components/ui` | Admin/I18n/Feedback/Battle tabs 可箭頭鍵操作。 |
| P5 | 移除 `role=button` card 巢狀互動 | `src/pages/FeedbackPage.tsx` | Card body/button 語意清楚，Tab order 合理。 |
| P5 | Toast a11y polish | `src/components/ToastProvider.tsx`, `src/App.css` | Toast action/close 44px，aria-live 策略清楚，可手動關閉。 |
| P5 | Contrast/custom color policy | `src/pages/FeedbackPage.tsx`, `src/components/ui/Badge.tsx` | Tag swatch 在深色背景對比可驗證。 |
| P5 | Reduced motion pass | `src/App.css`, `src/components/GameTutorialOverlay.css` | `prefers-reduced-motion` 下 Battle/Landing/Auth/Tutorial 不使用大幅動畫。 |

## 可分派給後續 agent 的批次

| 批次 | 內容 | 建議 agent prompt |
| --- | --- | --- |
| A | Phase 0 Battle mobile touch/zone | 修 `/qa/battle` 360/390px zone 越界與 action target，禁止改 game logic，跑 `npm run smoke:battle-responsive`。 |
| B | Phase 0 Landing/Feedback/Deck touch target | 修首頁 intro、Feedback toolbar、Deck active deck remove，跑 responsive smoke 與補充手測。 |
| C | Phase 2 Dialog/Sheet a11y | 在 shared Dialog/Sheet 加 focus trap/restore/scroll lock，遷移一個 Feedback modal 用例。 |
| D | Phase 2 ResponsiveToolbar/DataList | 擴充 primitives，先遷移 Feedback toolbar 或 Admin/I18n table。 |
| E | Phase 4 Battle compact visual tuning | 在既有 Battle layout slots 上調整 low-height/mobile visual density，不改 moves/state，覆蓋 QA battle states。 |
