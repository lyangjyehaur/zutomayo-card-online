# 頁面重設計計畫（Page Redesign Plan）

> Art Direction v2 透過 token 層已完成全站換皮（色彩/字體/形狀即時生效）。
> 本文件追蹤各頁面「結構層」遷移到 `src/ui` 體系的狀態與後續工作。

## 狀態總覽

| 頁面 | 換皮（token） | 結構遷移（src/ui） | 待辦 |
|------|:---:|:---:|------|
| 對戰頁（Board） | ✅ | ✅ 全語義元件（game/） | 移除殘留 Tailwind 即席 class（低優先） |
| 首頁 LobbyPage | ✅ | ✅ **v2 從零重寫**（AppHeader＋wordmark×ChronosDial hero＋頻道列） | — |
| AI 大廳 | ✅ | ✅ **v2 從零重寫**（三步設定台） | — |
| 線上大廳 | ✅ | ✅ v2 殼層重排（AppHeader＋雙欄玻璃面板） | RoomPanel 內部樣式細修 |
| 全域 NavBar | ✅ | ✅ v2 浮動膠囊列（服務 deck-builder/feedback/tutorial/404） | — |
| Leaderboard / 對戰紀錄 | ✅ | ✅ v2 殼層（AppHeader） | — |
| 房間等待（OnlineRoomInfo） | ✅ | ✅ | — |
| DeckEditor / CardBrowser | ✅ | ⚠️ 舊 `Card`（components/Card.tsx）+ `.game-card` CSS | **遷移到 `CardView` grid**，退役 `.card-*` 樣式家族 |
| Mulligan / Janken / GameOver（Board 內浮層） | ✅ | ⚠️ 沿用 Tailwind 即席佈局 + 舊 `Card` | Mulligan 手牌改 `CardView`；GameOver 抽 StatusPageLayout |
| FeedbackPage | ✅ | ⚠️ 大量頁面孤島 CSS（App.css） | 表單改 `src/ui/forms`；孤島 CSS 收斂 |
| AdminPage / I18nManager | ✅ | ⚠️ 專用 CSS 檔 | 低優先（內部工具），僅要求 token 化 |
| 教學（TutorialGamePage） | ✅ | ✅（對戰頁同源） | overlay 樣式 token 化 |

## 遷移優先序

1. **P1**：DeckEditor/CardBrowser 換 `CardView`（消滅最後的舊 Card 元件與 `.game-card/.card-*` CSS ~600 行）。
2. **P1**：Mulligan 手牌改 `CardView`；隨後刪除 `components/Card.tsx`（CardPopover 由 log chip 改用 CardDetailSheet 取代）。
3. **P2**：全站 className 掃除殘留 `italic` display 組合，之後移除 `typography.css` 的 `.font-display` 全域校正層。
4. **P2**:FeedbackPage 表單遷移 `src/ui/forms`；App.css 頁面孤島段逐段搬遷或刪除（目標：App.css 只剩 @theme + 過渡樣式 <2000 行）。
5. **P3**：Admin/I18n 工具頁 token 化收尾。

## 完成定義

- 頁面 import 只來自 `src/ui`＋業務模組；
- App.css 對該頁無專屬規則；
- `ui-review-checklist.md` 全項通過。
