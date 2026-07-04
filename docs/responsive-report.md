# Phase 4 Responsive Report

更新日期：2026-07-04

## 驗證範圍

本輪覆蓋 Desktop、Laptop、Tablet、Mobile 共 12 個基準尺寸：

- Desktop/Laptop：1920x1080、1536x864、1366x768、1280x720
- Tablet：1180x820、1024x768、820x1180、768x1024
- Mobile：430x932、390x844、375x812、360x740

自動驗證：

- `npm run smoke:ui-responsive`：8 個頁面組 x 12 尺寸，共 96 cases。
- `npm run smoke:responsive`：包含 full matrix、Admin、Battle、Online Lobby、Tools responsive smokes。
- `npm run build`：typecheck、script typecheck、production build。

## 修改總覽

| 頁面/範圍 | Desktop | Tablet | Mobile | 存在問題 | 修改方案 | 風險 |
| --- | --- | --- | --- | --- | --- | --- |
| Landing | 1920/1536/1366/1280 PASS | 1180/1024/820/768 PASS | 430/390/375/360 PASS | 裝飾 glow 被 responsive smoke 量測為 offscreen；桌面 auth entrypoint 使用 36px sm control。 | 將 Landing 裝飾層標記 `aria-hidden`；登入/註冊入口升為 `Button size="md"`，符合 44px touch floor。 | 低。只影響裝飾層可訪問性與控制尺寸，不改流程。 |
| AI Lobby | PASS | PASS | PASS | Back navigation 在 touch 尺寸仍使用 36px sm 預設。 | `BackButton` 預設改為 `size="md"`，所有返回導覽至少 44px。 | 低。返回按鈕略高，header layout 已通過所有尺寸。 |
| Online Lobby / Room entry | PASS | PASS | PASS | smoke surface selector 未覆蓋 room panel 類頁面，容易誤報。 | full matrix smoke 增加 shared shell/surface selector，並修正 page id 與 viewport id 覆蓋問題。 | 低。測試腳本變更，不改 UI 行為。 |
| Deck Builder / Card Browser | PASS | PASS | PASS | Header 返回、保存、filter、active deck toggle、pagination 在部分 touch 尺寸接近或低於 44px；CardBrowser 無穩定 surface class。 | Deck toolbar/pagination controls 升到 `size="md"`；`CardBrowser` 加穩定 class；shared `BackButton` 預設 44px。 | 中低。按鈕佔用高度增加，但 360x740 已通過。 |
| Card Detail / Card Browser sheet | PASS | PASS | PASS | 主要風險是 preview hover 與 mobile sheet 共存。 | 本輪未改交互邏輯；透過 existing detail sheet 驗證 mobile 不 overflow。 | 低。後續可在 P5 強化 focus/tap affordance。 |
| Battle | PASS | PASS | PASS | Tablet/mobile 量測到大型 decorative glow offscreen；820px action/pause controls 低於 44px；compact field 外層允許 visible overflow。 | Battle decorative glow 標記 `aria-hidden`；`max-width:1279px` field 改為 overflow containment；`max-width:820px` action/pause controls 44px。 | 中。核心頁 CSS 變更，但未碰 game state、moves、Board props；battle 專項 smoke 全 PASS。 |
| Feedback | PASS | PASS | PASS | P0 已修 toolbar；本輪 full matrix 補覆蓋。 | 無新增 UI 改動；納入 `smoke:ui-responsive` 矩陣。 | 低。 |
| Settings / Language | PASS | PASS | PASS | Landing drawer / language controls 需在 mobile 保持 44px。 | 已由 shared Button/Select 與 full matrix 覆蓋。 | 低。 |
| Admin | PASS | PASS | PASS | 需要確認 low-height desktop 與 mobile table/filter 不 overflow。 | 無新增 UI 改動；full matrix + existing admin responsive smoke 覆蓋。 | 低。 |
| I18n Manager | PASS | PASS | PASS | 768/820 tablet portrait 仍使用 desktop table，長翻譯內容可能水平擠壓；locale tabs 低於 touch floor。 | compact i18n editing/table layout breakpoint 從 767px 擴到 820px；tabs/header/search 延用 44px compact 規則。 | 中低。820px tablet 會看到 card/table compact layout，但資料與編輯行為不變。 |
| Leaderboard / Match History / Tools | PASS via tools smoke | PASS via tools smoke | PASS via tools smoke | 不在 full matrix 8 頁中，但屬 Phase 4 範圍內工具頁。 | 保留既有 `smoke:tools-responsive`，驗證 feedback、leaderboard、history、i18n。 | 低。 |

## Battle 特別檢查

| 項目 | 結果 | 備註 |
| --- | --- | --- |
| 卡牌可讀性 | PASS | 360/390/430px 保持手牌水平滾動，未被 sticky dock 遮擋。 |
| 手牌可點擊 | PASS | Battle 專項 smoke 覆蓋 360x740 turn-set/focus-sheet。 |
| 棋盤壓縮 | PASS | compact zone 尺寸和 overflow containment 通過 360x740、390x844、430x932。 |
| 聊天影響操作 | N/A | 當前 smoke route 未顯示聊天 panel；側欄改由 sheet/panel actions 存取。 |
| Action 誤觸 | PASS | action stack、pending choice footer、pause 在 touch 尺寸達 44px。 |
| 動畫/FPS | 未發現阻斷 | 本輪未改動畫邏輯；只隱藏裝飾層量測與 containment。 |
| Mobile Battle Layout | 暫不新增 | 現有 single Board layout 已通過 Phase 4 必測尺寸；獨立 MobileBattleLayout 可作後續體驗優化，不是阻斷。 |

## 本輪新增/更新

| 類型 | 文件 | 說明 |
| --- | --- | --- |
| Smoke script | `scripts/ui-responsive-smoke.mjs` | 新增 96-case full matrix；修正 pageId/viewportId；增加精確路由等待與空白量測重試。 |
| npm script | `package.json` | `smoke:responsive` 納入 `smoke:ui-responsive`。 |
| Shared layout | `src/components/ui/PageShell.tsx` | 增加穩定 `data-page-shell` selector。 |
| Shared controls | `src/components/ui/Button.tsx` | `BackButton` 預設改為 44px touch-friendly md size。 |
| Card browser | `src/components/CardBrowser.tsx` | 增加穩定 responsive surface class。 |
| Landing | `src/pages/LobbyPage.tsx`, `src/components/lobby/AuthSection.tsx` | 裝飾層 aria-hidden；auth entrypoint 44px。 |
| Deck Builder | `src/components/DeckEditor.tsx` | toolbar/pagination/save controls 升至 44px。 |
| Battle | `src/components/Board.tsx`, `src/App.css` | compact overflow containment、decorative aria-hidden、820px action/pause touch target。 |
| I18n | `src/pages/I18nManager.tsx`, `src/components/I18nManager.css` | compact table/edit breakpoint 延伸到 820px。 |

## 驗收結果

| Command | Result |
| --- | --- |
| `npm run smoke:ui-responsive` | PASS：96/96 cases |
| `npm run smoke:responsive` | PASS：full matrix + admin + battle + online lobby + tools |
| `npm run build` | PASS |

## 後續非阻斷優化

| 頁面 | 建議 | 優先級 |
| --- | --- | --- |
| Battle | 若後續要提升手機操作效率，可評估獨立 `MobileBattleLayout`，但必須共用同一 Board state/moves。 | Medium |
| Online Lobby | 自訂房間區在 mobile 可考慮 collapsible，降低首屏資訊密度。 | Medium |
| Landing | 手機入口卡可增加更明確的 tap affordance，降低 hover-only 感。 | Low |
| Card Browser | 手機 preview/tap/focus 行為可在 P5 accessibility polish 中統一。 | Low |
| Admin/I18n | 大資料量下可補虛擬列表或 pagination，但屬性能/資訊架構，不是 Phase 4 阻斷。 | Low |
