# UI/UX 深度審查報告

審查日期：2026-07-03  
範圍：全路由、共用 layout、共用 components、modal/drawer/toast、loading/empty/error 狀態。  
驗證方式：靜態掃描 `src`/`docs`、現有 `npm run smoke:responsive`、補充 DOM 探針覆蓋指定 12 種尺寸。

## 整體評分

| 面向 | 評分 | 判斷 |
| --- | --- | --- |
| Product clarity | 7/10 | 主要入口和對戰流程清楚，但 Feedback/Admin/Deck Builder 工具頁操作密度高。 |
| UI consistency | 5/10 | 已有 `src/components/ui` 基礎層，但頁面仍大量直接寫按鈕、表單、modal、CSS。 |
| UX comprehension | 6/10 | 新玩家能開始 AI/Online，但 Deck/Room/Rank/Custom room 的資訊排序仍偏重。 |
| Frontend maintainability | 4/10 | `src/App.css` 過大且有多段 legacy/重複 board 規則，頁面樣式孤島明顯。 |
| Responsive quality | 7/10 | 現有 smoke 全 PASS；核心剩餘風險集中在 Battle 手機貼邊、Feedback 工具列、低高度桌面密度。 |
| Accessibility | 6/10 | 多數 icon button 有 label，但 modal focus trap、44px target、role/button 語意仍不完整。 |

整體：6/10。項目已從「大面積破版」進入「可用但不一致、難維護、核心手機體驗需 polish」階段。優先級應放在 Battle、Feedback/Modal、Design token 落地，而不是重新美化。

## 自動化證據

- `npm run smoke:responsive`：Admin、Battle、Online Lobby、Feedback/History/Leaderboard/I18n 全部 PASS。
- 補充探針覆蓋尺寸：1920x1080、1536x864、1366x768、1280x720、1024x768、768x1024、820x1180、1180x820、430x932、390x844、375x812、360x740。
- 補充探針重點發現：Landing 手機歡迎卡按鈕高度 27-29px；Feedback 手機工具列按鈕 40px；Battle 360/390px 有左右 stack zone 可視越界；Deck Builder 低高度桌面 offscreen 主要是裝飾光暈，非阻斷。

## 問題列表

| 頁面/組件 | 問題 | 嚴重程度 | 影響 | 建議修復 | 涉及文件 |
| ----- | -- | ---- | -- | ---- | ---- |
| Battle / Board | 360/390px 手機下左右 `battle-stack-zone` 貼邊並可視越界；操作可用但空間壓迫 | High | 核心對戰區的 zone 意義不易辨識，觸控精準度下降 | 調整 compact layout 的 stage/zone spacing；把 side stack 改為更窄 variant 或水平收納。組件: 是；布局: 是；DS: 否 | `src/components/Board.tsx:2584`, `src/components/Board.tsx:2591`, `src/components/Board.tsx:2671`, `src/App.css:9274` |
| Battle / Board | 手機與平板豎屏仍混用桌面空間模型：戰場、手牌、操作、側面 panel 同時競爭首屏 | High | 玩家第一眼可理解，但操作效率低；新玩家容易不知道該看手牌還是場地 | 保留同一業務邏輯，抽 `BoardLayout variant="table|compact"`；手機使用 top HUD + battlefield + bottom action tray + side sheet tabs。組件: 是；布局: 是；DS: 需 responsive rule | `src/components/Board.tsx:2157`, `src/components/Board.tsx:2425`, `src/components/Board.tsx:2680`, `src/App.css:8911` |
| Battle / Action buttons | 手機/低高度下主要操作按鈕多處為 35-40px，高於舊 smoke 門檻但低於 44px 要求 | High | 核心確認動作點擊容錯不足，容易誤觸或點不到 | 將 `.battle-action-stack button` 與 pending choice footer 統一 `min-height: 44px`，並降低 tracking 避免文字擠壓。組件: 是；布局: 小；DS: 需 touch target rule | `src/components/Board.tsx:2727`, `src/components/Board.tsx:2729`, `src/App.css:9362`, `src/App.css:9477` |
| Battle / Hover preview | 多個卡牌/zone focus 仍依賴 hover 或 mouse enter；雖有部分 pointer fallback，但行為分散 | Medium | 觸控端學習成本高，focus card 何時出現不穩定 | 抽 `CardPreviewTrigger`，統一 hover+focus+tap；手機一律 sheet。組件: 是；布局: 否；DS: 需 interaction state | `src/components/Board.tsx:1087`, `src/components/Board.tsx:1538`, `src/components/Board.tsx:2707`, `src/components/Card.tsx:332` |
| Battle / Overlays | `phase-message-overlay`、`board-effect-overlay`、`BattleSideSheet`、`AppDrawer` 多套浮層同時存在 | High | z-index、focus、scroll lock、手機 sheet 行為難維護 | 統一到 `Dialog/Sheet/AppDrawer` 之一；推薦用 `Sheet` 承擔 mobile battle panels，`Dialog` 承擔確認。組件: 是；布局: 是；DS: 需 z-index/focus rule | `src/components/Board.tsx:440`, `src/components/Board.tsx:2772`, `src/components/Board.tsx:2904`, `src/App.css:8522` |
| Landing | 首次訪問歡迎 Panel 手機按鈕高度 27-29px，close 也是文字小按鈕 | High | 首次進入路徑的主要 CTA 不符合 44px touch target | 將 intro footer actions 設為 mobile `size="md" min-h-11 fullWidth`；close 改 icon-only 44px 或文字按鈕 min-h-11。組件: 否；布局: 小；DS: 否 | `src/pages/LobbyPage.tsx:255`, `src/pages/LobbyPage.tsx:264`, `src/pages/LobbyPage.tsx:277` |
| Landing | 首頁入口卡片依賴 hover 動效傳達 enter/可點擊感；手機只剩大片卡片，CTA 弱 | Medium | 新玩家能點，但第一眼不一定知道卡片是主操作 | 手機卡片加明確 icon button/arrow affordance，保留同內容，不做獨立 mobile page。組件: 可抽 `LandingCard`；布局: 小；DS: 否 | `src/pages/LobbyPage.tsx:160`, `src/pages/LobbyPage.tsx:168`, `src/pages/LobbyPage.tsx:194` |
| Landing | 大型 glow 在平板/手機 DOM 量測越界，雖被 overflow hidden 裁切但增加誤報與維護噪音 | Low | 不阻斷，但讓 QA 難判斷真溢出 | 改用 `PageShell` 的 `AmbientGlow` size token 或 container-relative max size。組件: 是；布局: 否；DS: 需 decoration rule | `src/pages/LobbyPage.tsx:98`, `src/pages/LobbyPage.tsx:110`, `src/components/ui/PageShell.tsx:17` |
| Online Lobby | 1024x768 與手機雖不溢出，但 quick/deck/custom room 垂直堆疊長；custom room 在新玩家流程中過早曝光 | Medium | 玩家要滾動才能看到所有房間操作，心智負擔偏高 | 手機排序維持 quick -> deck -> primary action；custom room 進 collapsible/Sheet。組件: 是；布局: 是；DS: 需 disclosure rule | `src/pages/OnlineLobbyPage.tsx:351`, `src/pages/OnlineLobbyPage.tsx:482`, `src/pages/OnlineLobbyPage.tsx:494` |
| Online Lobby | Quick match 使用自訂 gradient primary，和 `<Button variant="primary">` 規格不同 | Medium | Primary action 風格不一致，後續難判斷唯一主要動作 | 為 Button 增加 `emphasis="hero"` 或讓 quick match 回歸 token primary。組件: 是；布局: 否；DS: 需 component variant | `src/pages/OnlineLobbyPage.tsx:451`, `src/components/ui/Button.tsx:8` |
| AI Lobby | `/ai` 在 `lg` 即啟用兩欄，1024x768 接近 desktop 但高度不寬裕 | Medium | 低高度平板/小筆電容易出現兩欄壓縮，難比較牌組 | 改為 `xl` 或 container query 才常駐右欄；1024x768 維持 stacked。組件: 否；布局: 是；DS: 需 breakpoint rule | `src/pages/AILobbyPage.tsx:88`, `docs/responsive-strategy.md:27` |
| Deck Builder | 低高度桌面/平板仍有大量同時顯示的 filter、grid、deck 狀態；搜尋框高度 36px | Medium | 不阻斷，但長時間編輯效率下降，且不滿足 touch rule | 搜尋區用 `Input` min-h-11；filter toolbar 抽 `ResponsiveToolbar/FilterSheet`；低高度 compact mode 降低 panel padding。組件: 是；布局: 是；DS: 需 toolbar variant | `src/components/DeckEditor.tsx:517`, `src/components/DeckEditor.tsx:523`, `src/components/DeckEditor.tsx:586` |
| Deck Builder | 卡牌 detail popover 在 `DeckEditor` 自己計算定位，與 `CardBrowser`/`Card` 平行實作 | Medium | 維護成本高，手機/桌面 preview 行為容易分裂 | 抽 `usePopoverPosition` + `CardDetailSurface`；桌面 popover，手機 sheet。組件: 是；布局: 否；DS: 需 popover rule | `src/components/DeckEditor.tsx:109`, `src/components/DeckEditor.tsx:673`, `src/components/CardBrowser.tsx:144` |
| Deck Builder | Active deck 內刪除按鈕只有文字 `✕` 且未設 44px | High | 觸控移除牌容易點錯，且視覺弱於 preview icon button | 改成 icon button，`size-11`，加入 tooltip/aria-label。組件: 是；布局: 否；DS: 需 icon button variant | `src/components/DeckEditor.tsx:398` |
| Feedback | 手機 toolbar 中 sort tabs/filter/actions 同屏堆疊，按鈕多為 40px | High | 反饋中心首屏操作密度高，觸控目標低於要求 | 手機改為 `ResponsiveToolbar` 的 filter sheet：排序 segmented control + filter drawer + sticky submit。組件: 是；布局: 是；DS: 需 toolbar/sheet rule | `src/pages/FeedbackPage.tsx:305`, `src/App.css:9735`, `src/App.css:9785`, `src/App.css:10458` |
| Feedback | `feedback-modal-overlay` 自建 dialog，沒有明確 focus trap/初始焦點管理，和 `Dialog`/`Sheet` 並存 | High | 鍵盤與螢幕閱讀器使用者可能離開 modal；維護兩套 dialog | 改用 `Dialog` desktop + `Sheet` mobile；保留內容組件。組件: 是；布局: 是；DS: 需 modal a11y rule | `src/pages/FeedbackPage.tsx:1062`, `src/App.css:9925`, `src/components/ui/Dialog.tsx:57` |
| Feedback | 整張 feedback card 用 `li role="button"`，內含 vote button/tag click 等互動 | High | 巢狀互動元素可造成鍵盤焦點與點擊歧義 | 將 card body 的開啟動作改為明確 button/link，vote/tag 保持獨立。組件: 是；布局: 小；DS: 需 interactive-card rule | `src/pages/FeedbackPage.tsx:436`, `src/pages/FeedbackPage.tsx:451`, `src/pages/FeedbackPage.tsx:472` |
| Admin | Admin 已通過手機 smoke，但 page-specific CSS 大量覆寫共用元件 | Medium | 後續新增 Admin 表格/卡片容易再長出一套樣式 | 把 `admin-responsive-table` 收斂到 `DataList` variants；filter row 抽共用 `FilterPanel`。組件: 是；布局: 是；DS: 需 data-list variant | `src/pages/AdminPage.tsx:743`, `src/pages/AdminPage.tsx:816`, `src/components/AdminPanel.css:54` |
| Admin | Card edit modal 使用 `Dialog`，但 modal body 自行 `max-h-[60vh]`，footer/header sticky 規格靠 CSS 補 | Medium | 低高度桌面可用但編輯區滾動層級多 | 在 `Dialog` 增加 `bodyClassName`/sticky footer variant，避免每頁硬寫。組件: 是；布局: 小；DS: 需 dialog variant | `src/pages/AdminPage.tsx:725`, `src/components/ui/Dialog.tsx:69` |
| I18n Manager | `I18nManager.css` 仍使用硬編碼 hex 與獨立 responsive table 規則 | Medium | 和目前 lacquer token 不一致，工具頁看起來像舊系統 | 將顏色換 token；表格 mobile card 化收斂到 `DataList`。組件: 是；布局: 小；DS: 需 migration rule | `src/components/I18nManager.css:38`, `src/components/I18nManager.css:223`, `src/pages/I18nManager.tsx:223` |
| Auth / Login | `AuthSection` 直接寫 input/button/gradient/shadow，未使用 `Input/FormField/Button` | Medium | Login/register 與其他表單 focus/disabled/loading 不一致 | 改用 `FormField`, `Input`, `Button`，登入 loading 作為 Button variant。組件: 是；布局: 否；DS: 需 loading state | `src/components/lobby/AuthSection.tsx:203`, `src/components/lobby/AuthSection.tsx:270`, `src/components/lobby/AuthSection.tsx:317` |
| Toast | Toast 使用 CSS class 與原生 button，未使用 Button/ActionBar，沒有 pause-on-hover/focus 策略 | Medium | 通知視覺與互動不完全跟 DS；鍵盤操作狀態弱 | 抽 `Toast` UI primitive，使用 token、44px close/action、reduced motion。組件: 是；布局: 否；DS: 需 toast variant | `src/components/ToastProvider.tsx:36`, `src/App.css:1019` |
| Global CSS | `src/App.css` 超過 10k 行，Board 規則多段重複，包含 legacy class 和舊變數 | High | 修改 responsive 容易互相覆蓋，設計系統無法可靠落地 | 分階段把 page-specific CSS 搬到組件/頁面 module 或 Tailwind variants；先凍結新增 legacy class。組件: 是；布局: 是；DS: 是 | `src/App.css:246`, `src/App.css:1431`, `src/App.css:7479`, `src/App.css:9569` |
| Shared Dialog/Sheet | `Dialog`/`Sheet` 支援 Escape/overlay close，但未做 focus trap、restore focus、body scroll lock | High | modal a11y 未完整；多 modal 同時存在時風險更高 | 在共用層加 focus trap/restore/scroll lock，所有 modal 遷移後一次收益。組件: 是；布局: 否；DS: 需 accessibility rule | `src/components/ui/Dialog.tsx:24`, `src/components/ui/Sheet.tsx:21` |
| Typography | 多頁大量 `text-[8px]`/`text-[9px]`/`text-[10px] uppercase tracking-[0.3em]` | Medium | 小屏可讀性降低，長中文/日文容易擠壓 | 增加 `Kicker`, `MetaText`, `ControlLabel` 組件；手機降低 tracking 或隱藏非必要 meta。組件: 是；布局: 小；DS: 需 typography responsive rule | `src/components/Board.tsx:325`, `src/components/DeckEditor.tsx:577`, `src/pages/OnlineLobbyPage.tsx:445` |
| Color/token | 多個文件硬編碼 hex/rgba/oklch，尤其 CSS 與 SVG/canvas | Medium | 視覺不一致，暗色對比和主題調整困難 | 將允許的 canvas/SVG 裝飾也登記 token；I18n/Admin/Chronos 遷移。組件: 是；布局: 否；DS: 是 | `src/App.css:271`, `src/components/I18nManager.css:38`, `src/components/Chronos.tsx:60`, `src/components/Board.tsx:411` |

## 需要設計決策的問題

Battle 手機布局：
1. 推薦：同一 `BoardLayout`，用 compact slots 重排為 top HUD / field / bottom tray / side sheet。
2. 備選：只調 CSS media query，保留現 DOM。
3. 備選：完全獨立 mobile board composition。

建議選 1，因為能改善 IA 且不分叉遊戲邏輯。

Feedback 手機 toolbar：
1. 推薦：排序 segmented control 常駐，篩選進 Sheet，新增反饋 sticky action。
2. 備選：所有 controls 橫向 scroll。
3. 備選：保持堆疊但加大 touch target。

建議選 1，因為目前不是純尺寸問題，而是操作優先級過多。

Online custom room：
1. 推薦：手機折疊/Sheet，桌面保留 inline。
2. 備選：改成 tabs。
3. 備選：保留全部展開。

建議選 1，避免把次要流程壓到 quick match 前後。
