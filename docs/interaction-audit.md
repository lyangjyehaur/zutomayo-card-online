# Phase 5 Interaction & UX Polish Audit

更新日期：2026-07-04

## 範圍與限制

本輪只處理 interaction、motion、feedback、transition、loading、empty、error、toast、micro interaction。未修改 Layout、Component API、Design System、API、資料流或遊戲邏輯。

## 全站 Interaction Inventory

| 類型                      | 檢查位置                                                                                | Hover            | Pressed                         | Loading                       | Disabled                         | Focus                            | Motion / Feedback                             | 結論                                                           |
| ------------------------- | --------------------------------------------------------------------------------------- | ---------------- | ------------------------------- | ----------------------------- | -------------------------------- | -------------------------------- | --------------------------------------------- | -------------------------------------------------------------- |
| Button                    | `src/components/ui/Button.tsx`, page actions                                            | 有               | 有 `active:scale-95`            | 由呼叫方文字/`aria-busy` 表示 | 已補 disabled hover/active reset | 統一 focus ring                  | transition + will-change                      | 已統一                                                         |
| IconButton                | `src/components/ui/Button.tsx`                                                          | 有               | 有                              | N/A                           | 已補 disabled active reset       | 統一 focus ring                  | transition + will-change                      | 已統一                                                         |
| Input / Select / Textarea | `src/components/ui/Input.tsx`                                                           | N/A              | N/A                             | N/A                           | 已補 cursor/opacity              | focus ring + border              | transition                                    | 已統一                                                         |
| Checkbox                  | `src/components/ui/Input.tsx`                                                           | N/A              | N/A                             | N/A                           | 已補 disabled state              | focus-visible ring               | transition                                    | 已統一                                                         |
| Dialog                    | `src/components/ui/Dialog.tsx`                                                          | N/A              | N/A                             | footer action handling        | dismissible via Escape/backdrop  | 已補 open focus + restore focus  | 已補 enter motion                             | 已統一                                                         |
| Sheet / Drawer-like panel | `src/components/ui/Sheet.tsx`, `AppDrawer`                                              | N/A              | N/A                             | footer action handling        | dismissible via Escape/backdrop  | 已補 open focus + restore focus  | 已補 enter motion                             | 已統一 shared Sheet；legacy AppDrawer 保持現有樣式             |
| Toast                     | `src/components/ToastProvider.tsx`, `src/App.css`                                       | Action button 有 | Action button 有                | N/A                           | N/A                              | 使用 shared Button/IconButton    | 已補 enter motion；error 使用 assertive alert | 已統一                                                         |
| Card                      | `src/components/ui/Card.tsx`, landing/deck/admin card buttons                           | 有               | 視具體 button                   | N/A                           | 呼叫方負責                       | 已補 `focus-within:shadow-focus` | transition + transform                        | 已統一 shared Card                                             |
| Badge / TagButton         | `src/components/ui/Badge.tsx`                                                           | TagButton 有     | N/A                             | N/A                           | 已補 disabled state              | focus ring                       | transition                                    | 已統一                                                         |
| Popover / Card detail     | `src/components/CardBrowser.tsx`, `src/components/Card.tsx`, `src/components/Board.tsx` | 有               | touch 使用 sheet/focus fallback | N/A                           | N/A                              | focus/focus-within 可打開        | popover shadow/transition                     | 可用；P5 後續可再把 battle/card browser preview trigger 抽共用 |
| Tooltip / Tutorial        | `src/components/GameTutorialOverlay.tsx`, `.css`                                        | 有               | 有                              | N/A                           | N/A                              | 既有 button focus                | 既有 tooltip enter motion                     | 可用                                                           |
| Battle interaction        | `src/components/Board.tsx`, `src/App.css`                                               | 有               | actions 有                      | pending/effect panels 有狀態  | disabled actions reset           | zone/card focus 可見             | damage/phase feedback 已存在                  | 核心可用；未改遊戲邏輯                                         |

## 狀態呈現 Inventory

| 狀態                | 當前統一元件                                   | 已覆蓋位置                                                                                                | 結論                                       |
| ------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Loading             | `LoadingState`                                 | Tutorial card loading、Admin i18n/users/matches、Feedback existing loading                                | 已統一主要頁面                             |
| Error               | `Alert tone="danger"`                          | AI Lobby、Online Lobby、Online Game action error、Deck Editor、Admin、I18n login、Feedback existing error | 已統一主要頁面                             |
| Empty               | `EmptyState` / existing empty panels           | Feedback、Leaderboard、Deck empty slots、Route empty panels                                               | 可用；部分 legacy empty route CSS 保留     |
| Offline / Reconnect | Online status panel + `Alert` for action error | Online Game reconnect/waiting/retry/version mismatch panels                                               | 可用；未修改 reconnect data flow           |
| Network Error       | Toast + Alert                                  | Deck save/load、Online matchmaking/create room、Auth/Admin errors                                         | 已收斂為 Toast + Alert                     |
| Toast               | `ToastProvider`                                | Deck save, lobby deck selected, online copy/matchmaking                                                   | 已補 assertive error、motion、44px actions |

## 本輪修正

| 編號  | 類型           | 問題                                                               | 修正                                                                           | 涉及文件                                                                                                                                                                              |
| ----- | -------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P5-01 | Button         | disabled button 仍可能呈現 hover/active 視覺                       | 補 disabled hover reset 與 disabled active reset                               | `src/components/ui/Button.tsx`                                                                                                                                                        |
| P5-02 | Input          | disabled input 缺少一致 cursor/opacity                             | 補 disabled cursor/opacity；SearchInput 補 transition                          | `src/components/ui/Input.tsx`                                                                                                                                                         |
| P5-03 | Dialog         | 開啟後焦點沒有穩定落點，關閉後不還原                               | 補 initial focus + restore focus；補 enter motion                              | `src/components/ui/Dialog.tsx`                                                                                                                                                        |
| P5-04 | Sheet          | 與 Dialog 的焦點/motion 行為不一致                                 | 補 initial focus + restore focus；補 enter motion                              | `src/components/ui/Sheet.tsx`                                                                                                                                                         |
| P5-05 | Toast          | Toast action/close 被 legacy CSS 壓到 32px；error toast 語義不夠強 | action/close 回到 44px；error 使用 `role="alert"` + assertive；補 enter motion | `src/components/ToastProvider.tsx`, `src/App.css`                                                                                                                                     |
| P5-06 | Card           | interactive card focus feedback 弱於 hover                         | 補 `focus-within:shadow-focus`                                                 | `src/components/ui/Card.tsx`                                                                                                                                                          |
| P5-07 | TagButton      | disabled/focus state 與 Button 不一致                              | 補 disabled state 與 focus ring consistency                                    | `src/components/ui/Badge.tsx`                                                                                                                                                         |
| P5-08 | Loading        | Tutorial/Admin loading 使用裸文字或 Panel                          | 改用 shared `LoadingState`                                                     | `src/pages/TutorialGamePage.tsx`, `src/pages/AdminPage.tsx`                                                                                                                           |
| P5-09 | Error          | AI/Online/Deck/Admin/I18n 錯誤訊息樣式分散                         | 改用 shared `Alert tone="danger"`                                              | `src/pages/AILobbyPage.tsx`, `src/pages/OnlineLobbyPage.tsx`, `src/pages/OnlineGamePage.tsx`, `src/components/DeckEditor.tsx`, `src/pages/AdminPage.tsx`, `src/pages/I18nManager.tsx` |
| P5-10 | Async feedback | Online create room loading 只有文字，缺少 busy 語義                | 加上 `aria-busy`                                                               | `src/pages/OnlineGamePage.tsx`                                                                                                                                                        |

## 全站 Review 結論

| 項目            | 結論                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------- |
| Hover / Pressed | Shared Button、IconButton、Card、TagButton 已統一；Battle 特殊操作保留既有行為。                    |
| Disabled        | Shared Button/Input/Checkbox/TagButton 已有一致 disabled cursor/opacity/reset。                     |
| Focus           | Button/Input/Dialog/Sheet/Card/TagButton 已有一致 focus feedback；Dialog/Sheet 已補焦點落點與還原。 |
| Loading         | 主要頁面 loading 已使用 `LoadingState`；少量業務內文中的「儲存中」保留在按鈕文字中。                |
| Error           | 主要頁面錯誤已使用 `Alert`；ErrorBoundary 仍使用 legacy route panel，因其是全局 crash fallback。    |
| Toast           | 已統一 motion、role、touch target。                                                                 |
| Motion          | Shared interactive elements 使用 token duration/transition；Dialog/Sheet/Toast 有 enter motion。    |
| Battle          | 未改 game logic；互動可用性維持 Phase 4 PASS 狀態。                                                 |

## 後續非阻斷 Polish

| 項目                   | 建議                                                                                   | 優先級 |
| ---------------------- | -------------------------------------------------------------------------------------- | ------ |
| Tooltip / Popover      | 將 Card、Battle log chip、Deck browser preview trigger 抽成共用 interaction helper。   | Medium |
| ErrorBoundary          | 後續可改成 shared `StatusPageLayout` + `Alert`，但需小心 crash fallback 依賴最少元件。 | Low    |
| Button loading variant | 如 P6 允許 API，可為 Button 增加 `loading` prop，統一 spinner/aria-busy。              | Medium |
| Reduced motion         | 可補 `prefers-reduced-motion` 規則統一關閉 transform motion。                          | Low    |
