# Release Candidate Design Review

> 歷史快照：此文件早於 `codex/p0-p5-production` 的 auth、Feedback semantics、modal focus 與 E2E 修補，不能直接代表 2026-07-13 的當前狀態。保留問題清單作回歸範圍；public beta 決策必須以當前分支的 service-backed E2E、axe、360/390px 視覺 QA 與真實 mobile 操作重跑後更新。

## Executive Summary

目前版本已具備可玩的核心內容，但以「明天公開 Beta」標準看仍 **NOT READY**：新玩家的線上配對入口存在登入死路，Battle 行動/資訊層級仍偏高負荷，且可訪問性與 legacy UI 債務尚不足以支撐公開玩家流量。

## Review Scope

- 頁面：Landing、Lobby、Online Lobby、AI Lobby、Room/Online Game、Battle、Deck Builder、Card Browser、Card Detail、Feedback、Replay/Match History、Settings/Auth Drawer、Admin、Debug/Battle QA、Shared Layout。
- 元件：Button、Card、Panel、Dialog、Sheet/Drawer、Toast、Tooltip/Popover、Input、Select、Tabs、Table、Loading、Empty、Error、Network/Reconnect、Animation、Focus、Responsive。
- 依據：靜態掃描與代碼審查，重點檔案包含 `src/App.tsx`、`src/pages/LobbyPage.tsx`、`src/pages/OnlineLobbyPage.tsx`、`src/pages/OnlineGamePage.tsx`、`src/components/Board.tsx`、`src/components/DeckEditor.tsx`、`src/pages/FeedbackPage.tsx`、`src/pages/AdminPage.tsx`、`src/App.css`、`src/components/ui/*`。

## Role Review

### Product Designer

首次使用路徑仍不夠自然。Landing 三個入口很清楚，但線上對戰主 CTA 是 Quick Match，實際上新玩家無法登入使用；Custom Room 又支援匿名，造成「哪個模式需要帳號」的認知落差。Deck selection 是合理前置，但沒有把「先選牌組，再選配對方式」做成明確流程。

### Senior UI Designer

主視覺已統一到暗色 lacquer/card game 方向，但 Battle、Feedback、Admin、NotFound/ErrorBoundary 仍有明顯 legacy CSS 和硬編碼風格。Shared primitives 存在，但核心頁仍混用 Tailwind token、舊 CSS class、inline style 和 bespoke button。

### UX Expert

玩家流程：Landing → Online Lobby → Select Deck → Quick Match 會在未登入時阻塞；Login 入口在 mobile settings drawer 中且目前 public entrypoint disabled。Create/Join Room 可走匿名，但錯誤訊息與 CTA 優先級不會自然引導玩家改走這條路。Battle 結束前有延遲展示 GameOver 的設計，玩家可能誤以為卡住。

### Game UX Designer

Battle 已比早期穩定，但 TCG 玩家仍會在手機上承受高資訊密度：Chronos、Energy、Abyss、Deck、Power、Ready 狀態分散在多個小標籤與側面板。手牌可點，但 hover/focus 預覽和 side panel 的行為不一致，手機讀卡仍需要猜測。

### Responsive Reviewer

P4 後主要 overflow 風險降低，但「可放下」不等於「舒服」。360/390px Battle 仍依賴壓縮、隱藏和 `!important` mobile override；Feedback toolbar、Admin filter、Battle side sheet 可用但密度偏高。低分屏桌面 Battle 有足夠畫面，但右側資訊欄與中央場地競爭注意力。

### Accessibility Reviewer

基本 aria-label 覆蓋比早期好，但 Dialog/Sheet/Battle side sheet/AppDrawer 只有 focus entry/restore，未完整 trap focus，也沒有背景 inert。Feedback card 使用 `li role="button"` 包 nested button，螢幕閱讀器與鍵盤語義不乾淨。Battle 中大量 emoji/符號狀態沒有穩定文字等價。

### Frontend Architect

Phase 1/2 已建立 primitives，但尚未完成「唯一 component library」。`src/App.css` 仍接近 11k 行，包含 `.legacy-*`、大量 `!important`、硬編碼 px/rem/color/z-index，以及 Battle responsive override。`src/components/Board.tsx` 約 3k 行，同時承擔 layout、interaction、state presentation、animation 與 panel UI。

### QA Tester

最可能出現的 Beta 回報集中在：無法快速配對、手機看不清 Battle、彈窗焦點/返回異常、Feedback 點擊誤觸、PWA/重連狀態重疊、Admin/debug polish 外露。

### Release Manager

- Ready for Beta: **No for public Beta; yes only for controlled Beta with known limitations.**
- Ready for Public: **No.**
- Ready for Production: **No.**
- Grade: **C+**。

## Scores

| Area                 | Score | 扣分原因                                                                                            |
| -------------------- | ----: | --------------------------------------------------------------------------------------------------- |
| Visual Design        |    78 | 主要風格成立，但 Battle/Admin/Feedback/legacy state 視覺語言不完全一致。                            |
| UI Consistency       |    72 | Shared primitives 存在，但核心頁仍有自製 Button/Dialog/Panel/Popover 樣式。                         |
| UX                   |    66 | Quick Match 新玩家死路、Deck-first 流程不夠明確、等待/結束狀態焦慮。                                |
| Game UX              |    70 | Battle 可操作，但手機讀卡、Chronos、Energy、Abyss、現在可做什麼仍需更強層級。                       |
| Responsive           |    76 | 已通過主要適配，但 360/390 Battle 是高密度壓縮方案，不是理想 mobile UX。                            |
| Accessibility        |    58 | Focus trap、nested interactive semantics、battle symbol text equivalents、screen reader flow 不足。 |
| Performance (UI)     |    74 | 大量圖片與動畫可用，但 Battle 動畫/blur/shadow/large CSS 對低端手機有風險。                         |
| Maintainability      |    55 | `App.css` 與 `Board.tsx` 過大，legacy/important/hardcoded override 仍多。                           |
| Professionalism      |    72 | 主體有完成度，但錯誤/空/重連/Admin/debug polish 會降低公開感。                                      |
| Production Readiness |    61 | 公開 Beta 前仍有主流程阻塞與 a11y/維護性高風險。                                                    |

## Top 20 Issues

|   # | Severity | Area                        | Issue                                                                                       | Impact                                                                | Evidence                                                                                                                                                        | Recommendation                                                                                |
| --: | -------- | --------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
|   1 | Critical | Online Lobby/Auth           | Quick Match 要求登入，但 public login/register entrypoint 被關閉。                          | 新玩家點主要線上配對 CTA 會直接失敗，公開 Beta 第一印象很差。         | `src/components/lobby/AuthSection.tsx` `PUBLIC_AUTH_ENTRYPOINTS_ENABLED = false`; `src/pages/OnlineLobbyPage.tsx` `handleQuickMatch()` checks `!isLoggedIn()`。 | Beta 前二選一：開放登入/註冊，或讓 Quick Match 支援匿名；推薦後者作為 Beta 低摩擦方案。       |
|   2 | High     | Battle Mobile               | Battle 手機資訊密度仍過高，讀卡/操作/狀態理解競爭同一小螢幕。                               | 新 TCG 玩家容易不知道現在該點手牌、Confirm、效果選擇還是側面板。      | `src/components/Board.tsx` mobile layout 仍同時渲染 topbar、phase banner、field、hand、actions、overlay。                                                       | Beta 前加強「現在可做什麼」主提示與唯一 primary action；不需重寫頁面。                        |
|   3 | High     | Product Flow                | Online Lobby 的 Quick Match、Custom Room、Anonymous Name、Deck selection 流程優先級不一致。 | 玩家需要自行推理帳號、牌組、房間、配對的關係。                        | `src/pages/OnlineLobbyPage.tsx` Quick Match sidebar 與 Custom Room main panel 行為不同。                                                                        | 把 deck missing、login required、anonymous naming 的原因靠近 CTA；推薦統一為 step status。    |
|   4 | High     | Accessibility               | Dialog/Sheet/Battle side sheet/AppDrawer 無完整 focus trap/background inert。               | 鍵盤和讀屏使用者可 tab 到背景內容，modal 語義不完整。                 | `src/components/ui/Dialog.tsx`、`src/components/ui/Sheet.tsx`、`src/components/AppDrawer.tsx`、`src/components/Board.tsx` `BattleSideSheet`。                   | 使用同一 dialog foundation，加入 focus trap、initial focus、return focus、background inert。  |
|   5 | High     | Battle Component            | Battle 仍直接寫 action button/style，繞過 Button primitive。                                | 狀態、focus、disabled、touch target 和 tokens 容易再次分叉。          | `src/components/Board.tsx` `battle-action-stack` uses raw `<button>` and custom classes。                                                                       | 將 Battle action buttons 改用 Button/IconButton variant，不改 game logic。                    |
|   6 | High     | Maintainability             | `src/App.css` 仍有大量 legacy、hardcoded、`!important` responsive override。                | 後續改一個 breakpoint 容易破壞 Battle/Feedback/Admin。                | `src/App.css` 10,987 lines; `.legacy-*`; many `!important`; hardcoded colors/z-index/radius。                                                                   | Beta 前至少凍結新增規則，建立 CSS debt ledger；後續分頁拆分。                                 |
|   7 | High     | Battle End UX               | GameOverScreen 被強制延遲 4.5-6.5 秒。                                                      | 玩家在致命傷害後可能以為遊戲無反應，尤其網路對戰。                    | `src/components/Board.tsx` `gameOverDelayed` timeout。                                                                                                          | 顯示明確 resolving/result pending 狀態，或縮短延遲並提供 skip。                               |
|   8 | High     | Feedback A11y               | Feedback list item 是 `role="button"`，內部又包含 vote/tag buttons。                        | Nested interactive controls 會造成鍵盤/讀屏歧義與誤觸。               | `src/pages/FeedbackPage.tsx` feedback `<li role="button" tabIndex={0}>` with child buttons。                                                                    | 改為 article + explicit detail button/link，vote/tag 獨立操作。                               |
|   9 | High     | Card Preview                | Card detail 在 Deck/Battle 使用 hover/focus/popover/sheet 混合模式。                        | 手機玩家不一定知道怎麼看完整卡，桌面與手機肌肉記憶不同。              | `src/components/DeckEditor.tsx` popover + detail sheet; `src/components/Board.tsx` card popover + focus side panel。                                            | 定義唯一 card inspection pattern：tap opens detail sheet on touch, hover only supplementary。 |
|  10 | High     | Error/Loading States        | RouteFallback、NotFound、ErrorBoundary 仍是 legacy state UI。                               | Crash/loading/404 看起來不像同一產品，公開 Beta 時不專業。            | `src/App.tsx` `RouteFallback`, `NotFoundPage`; `src/components/ErrorBoundary.tsx` uses `empty-route-panel`。                                                    | 用 `LoadingState`、`EmptyState`、`Alert`/`Panel` 統一。                                       |
|  11 | Medium   | Online Reconnect            | Resume/reconnect/waiting overlays 有多套 presentation。                                     | 玩家可能分不清 waiting、reconnecting、resume、leave prompt 的優先級。 | `src/App.tsx` `OnlineResumePrompt`; `src/pages/OnlineGamePage.tsx` waiting overlay; `NetworkStatusNotifier`。                                                   | 建立 OnlineStatus component，統一 title/body/action/tone。                                    |
|  12 | Medium   | Toast                       | Toast 最多顯示 4 個且 mobile 與 sticky/bottom sheet 疊層未完全保證。                        | 重要錯誤可能被 drawer/action bar 遮擋或快速消失。                     | `src/components/ToastProvider.tsx` viewport global; App/Battle/Feedback 多個 fixed layers。                                                                     | 對 mobile safe area 和 active sheet 增加 offset rule。                                        |
|  13 | Medium   | Admin/Debug                 | Admin 和 Battle QA 仍有明顯工具感與生硬文案。                                               | 若被公開玩家打開會破壞 release polish。                               | `src/pages/AdminPage.tsx`, `src/pages/BattleVisualQaPage.tsx`, `src/components/AdminPanel.css`。                                                                | Beta 確認 route guard/hidden nav；Admin polish 可 Beta 後。                                   |
|  14 | Medium   | Typography                  | Battle/Admin/Feedback 有 8-12px 級別文字與 clamp/important 規則。                           | 小屏和低視力玩家讀取壓力大。                                          | `src/App.css` mobile battle rules include `font-size: 8px/9px/10px !important`。                                                                                | 將最小 readable token 設為硬規則，低優先資訊改收合。                                          |
|  15 | Medium   | Icon Semantics              | Battle 使用 emoji 表示 Energy/Abyss/Chronos/Day/Night。                                     | 色盲/讀屏/跨平台字型下可讀性不穩。                                    | `src/components/Board.tsx` uses `⚡`, `🕳️`, `🌙`, `☀️`, `🃏` in key labels。                                                                                    | 補充 visible text 或 aria-label，不只依靠 emoji。                                             |
|  16 | Medium   | Motion                      | Reduced motion 有處理，但動畫規則分散。                                                     | 某些 overlay/card transition 仍可能不一致。                           | `src/App.css` multiple `prefers-reduced-motion` blocks; Board phase timers.                                                                                     | 建立 motion utility/tokens，確保 Battle/Toast/Dialog 一致。                                   |
|  17 | Medium   | Feedback Security/Rendering | Feedback Markdown 使用自製 parser + `dangerouslySetInnerHTML`。                             | 雖有 escape，仍是長期安全/渲染維護風險。                              | `src/pages/FeedbackPage.tsx` `renderMarkdown`, `Markdown` component。                                                                                           | 改用可信 markdown sanitizer/library，或限制語法。                                             |
|  18 | Medium   | Tables/Data Density         | Admin users/matches table 在手機上可用但資訊密度高。                                        | 管理員在手機修正資料容易誤觸。                                        | `src/pages/AdminPage.tsx`, `src/components/AdminPanel.css` responsive table overrides。                                                                         | Mobile admin 使用 detail rows/action sheet，不需公開前完成。                                  |
|  19 | Low      | Landing Affordance          | Landing card CTA 仍用 `Enter` 和 hover arrow。                                              | 手機玩家知道可點，但 CTA 語氣偏抽象。                                 | `src/pages/LobbyPage.tsx` entry cards.                                                                                                                          | Beta 後把 CTA 改成具體動作：Online Duel/VS CPU/Edit Deck。                                    |
|  20 | Low      | Light Theme                 | 專案實際是 dark-only，沒有 light theme policy。                                             | Checklist 容易誤判；未來 token 會被濫用。                             | Global CSS and tokens are dark-first.                                                                                                                           | 在 design system 明確標註 dark-only beta，light theme 不在 scope。                            |

## Player Flow Walkthrough

| Step         | Natural? | Risk                                                                           |
| ------------ | -------- | ------------------------------------------------------------------------------ |
| Landing      | Mostly   | 三大入口清楚，但登入/設定在 mobile drawer，首次玩家可能不看。                  |
| Login        | No       | Public auth entrypoints disabled，與 Beta 新玩家預期衝突。                     |
| Lobby        | Partial  | Online/AI/Deck 分離清楚，但「先選牌組」不是視覺上的第一步。                    |
| Create Room  | Partial  | 匿名可用，但首次命名提示出現在嘗試開始後，略打斷。                             |
| Join Room    | Mostly   | Room code input 清楚；缺少更強的 copy/paste/state guidance。                   |
| Select Deck  | Mostly   | Deck selector 明確，但 server/local deck error 與 start CTA 距離可更近。       |
| Ready        | Partial  | Battle ready/confirm 可用，但新玩家需要理解 set count/minimum。                |
| Battle       | Partial  | 核心可玩；手機需要更多主行動提示與讀卡支援。                                   |
| Game End     | Risk     | 強制延遲可能造成等待焦慮。                                                     |
| Return Lobby | Mostly   | Actions 存在，但 online leave/return 和 browser unload confirmation 可能交疊。 |

## Likely Beta Bug Reports

1. 「按 Quick Match 說要登入，但找不到登入/註冊。」
2. 「手機 Battle 不知道現在要按哪裡。」
3. 「手牌太小，看不清效果。」
4. 「點卡牌有時是出牌，有時是預覽，行為不一致。」
5. 「結束時畫面等很久才出結果。」
6. 「等待對手加入時返回/離開提示看不懂。」
7. 「重連提示和房間狀態同時出現，不知道按哪個。」
8. 「手機 Feedback 點投票時打開了詳情。」
9. 「Feedback tag 點擊和卡片點擊互相干擾。」
10. 「Toast 被底部面板或 Battle controls 擋住。」
11. 「彈窗開啟時按 Tab 會跳到背景。」
12. 「按 Escape 關閉彈窗後焦點位置奇怪。」
13. 「Battle 側面板關閉後不知道回到哪個操作。」
14. 「小螢幕看不到 Abyss/Power 的含義，只看到符號。」
15. 「Chronos 目前日夜/輪到誰不夠醒目。」
16. 「Admin/Debug 頁看起來像半成品。」
17. 「卡牌圖片載入慢時 layout 跳動或空白。」
18. 「網路斷線後不知道遊戲是否還在進行。」
19. 「手機瀏覽器地址列變化時 Battle 高度抖動。」
20. 「Deck Builder 預覽在平板觸控上偶爾不符合預期。」
21. 「404/Crash 頁跟其他頁風格不一致。」
22. 「低端手機 Battle 動畫掉幀。」

## What Should Be Fixed Before Beta

1. 修正 Quick Match 登入死路：開放 public auth，或支援匿名 Quick Match；推薦匿名 Quick Match。
2. Online Lobby CTA 狀態重排：把 deck missing/login/name prompt 直接放在對應 CTA 下。
3. Battle 增強當前主行動提示：只突出一個 primary next action。
4. Battle card inspection 在 touch 裝置統一為 tap/detail sheet。
5. Dialog/Sheet/AppDrawer/BattleSideSheet 加 focus trap 與 background inert。
6. Feedback list 移除 nested interactive `role="button"` 結構。
7. GameOver 延遲加入明確 resolving state 或縮短。
8. RouteFallback/NotFound/ErrorBoundary 改用統一 State primitives。
9. 為 Battle Energy/Abyss/Chronos emoji 補文字或 aria equivalent。
10. Beta route guard：確認 Admin/Battle QA 不會被一般玩家誤入或被公開導覽露出。

## Nice To Have

- 將 `src/components/Board.tsx` 拆成 Battle layout、zones、panels、overlays、setup screens。
- 將 `src/App.css` 按 feature 拆分，移除 `.legacy-*` 與 `!important` mobile patch。
- Feedback Markdown 改用正式 sanitizer/parser。
- Admin mobile 改為 detail sheet/data cards。
- Toast viewport 根據 active drawer/sheet 自動避讓。
- 建立 light theme 或正式標註 dark-only scope。
- 為 Battle 提供新手模式/簡化資訊密度。
- 對低端手機加入 animation/performance budget。

## Overall Score

**70 / 100**

核心遊戲已可玩，UI consolidation 有明顯進步；但公開 Beta 不是只看 smoke test。新玩家線上主流程阻塞、Battle 手機心智負擔、modal accessibility、legacy CSS/Board 巨型元件仍是明確 release risk。

## Release Recommendation

**NOT READY**

理由：目前可以做 controlled Beta 或內部測試，但不建議直接公開 Beta。公開前至少要修掉 Quick Match/auth 死路、Battle 主行動提示、modal focus trap、Feedback nested interaction、GameOver 等待焦慮這幾個高影響問題。若這些完成，下一版可重新評估為 **READY WITH MINOR ISSUES**。
