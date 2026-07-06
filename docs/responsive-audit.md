# Responsive 審查報告

審查日期：2026-07-03  
測試尺寸：1920x1080、1536x864、1366x768、1280x720、1024x768、768x1024、820x1180、1180x820、430x932、390x844、375x812、360x740。  
驗證：`npm run smoke:responsive` 全 PASS；補充探針輸出 `/private/tmp/zutomayo-ui-audit-probe-report.json`。

## 總結

- 沒有發現全站級 Critical 水平溢出。
- 低分屏桌面 1366x768 / 1280x720 基本可用，但 Battle 與 Deck Builder 需要 compact density。
- 手機端最大風險是 Battle 左右 zone 貼邊/越界、Feedback toolbar 觸控低於 44px、Landing 首次訪問 CTA 過矮。
- Online Lobby、Admin、Leaderboard、History 已可用；主要問題是資訊密度與次要流程展開方式。

| 頁面                           | 尺寸                                  | 問題                                                               | 嚴重程度 | 建議                                                                            |
| ------------------------------ | ------------------------------------- | ------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------- |
| Landing `/`                    | 1920x1080                             | 三入口卡與 footer 表現穩定                                         | Low      | 保持現布局，後續只抽 `LandingCard` 統一 hover/focus。                           |
| Landing `/`                    | 1536x864                              | 無阻斷；入口卡高度仍偏展示型                                       | Low      | 低高度桌面可降低 `md:h-[60dvh]` 上限。                                          |
| Landing `/`                    | 1366x768                              | 可用；首屏資訊剛好，footer 佔底部空間                              | Medium   | 啟用 low-height compact：縮入口卡 padding/高度，避免 footer 壓迫。              |
| Landing `/`                    | 1280x720                              | 可用；展示卡高度與 header/footer 接近滿屏                          | Medium   | 使用 `max-height` 或 compact density。                                          |
| Landing `/`                    | 1024x768                              | 可用；三欄不啟用，單欄滾動合理                                     | Low      | 無需獨立 mobile layout。                                                        |
| Landing `/`                    | 768x1024 / 820x1180                   | 裝飾 glow DOM 越界但被裁切；歡迎 Panel 小按鈕低於 44px             | High     | Glow 改 token size；intro actions 設 `min-h-11`。                               |
| Landing `/`                    | 430x932 / 390x844 / 375x812 / 360x740 | 首次訪問 Panel `關閉`、`前往牌組編輯器`、`稍後探索` 高度 27-29px   | High     | Intro Panel 手機 footer 改 full-width 44px buttons；close 改 44px icon button。 |
| AI Lobby `/ai`                 | 1920x1080 / 1536x864                  | 雙欄合理                                                           | Low      | 保持。                                                                          |
| AI Lobby `/ai`                 | 1366x768 / 1280x720                   | 可用，但 deck/opponent/difficulty 同時展示密度高                   | Medium   | 低高度桌面壓縮 panel padding；難度區 sticky action。                            |
| AI Lobby `/ai`                 | 1024x768                              | `lg` 可能太早進雙欄；探針未阻斷                                    | Medium   | 推遲常駐側欄到 `xl` 或 container width >= 1180。                                |
| AI Lobby `/ai`                 | 768x1024 / 820x1180                   | stacked 合理                                                       | Low      | 無需單獨 mobile layout。                                                        |
| AI Lobby `/ai`                 | 430x932 / 390x844 / 375x812 / 360x740 | 無溢出；牌組選擇較長                                               | Low      | 保持 single column，將 opponent 設為 collapsible 可降低滾動。                   |
| Online Lobby `/online`         | 1920x1080 / 1536x864                  | 雙欄/房間區穩定                                                    | Low      | 保持。                                                                          |
| Online Lobby `/online`         | 1366x768 / 1280x720                   | 可用；quick panel + deck/custom 需要內部滾動                       | Medium   | 低高度桌面 compact panel，quick action 保持可見。                               |
| Online Lobby `/online`         | 1024x768                              | 單欄可用但 custom room 在下方，任務流程長                          | Medium   | custom room 折疊或 Sheet；quick/deck action 優先。                              |
| Online Lobby `/online`         | 768x1024 / 820x1180                   | 無溢出，仍需滾動查看 deck/custom                                   | Medium   | 使用 collapsible sections，不需要獨立 mobile route。                            |
| Online Lobby `/online`         | 430x932 / 390x844 / 375x812 / 360x740 | smoke PASS；觸控 OK；內容長                                        | Medium   | Quick match sticky action；custom room 預設收合。                               |
| Room / Custom room             | Mobile all                            | 自訂房間與 quick match 同級展開                                    | Medium   | Room details 改 compact；custom create/join 放 Drawer/Accordion。               |
| Battle `/play/*`, `/qa/battle` | 1920x1080 / 1536x864                  | 桌面 table layout 可用                                             | Low      | 保持 persistent sidebar。                                                       |
| Battle `/play/*`, `/qa/battle` | 1366x768                              | 可用；垂直密度高                                                   | Medium   | low-height compact：topbar/phase hint/hand/action 降高度。                      |
| Battle `/play/*`, `/qa/battle` | 1280x720                              | smoke PASS；手牌和操作貼底，容錯低                                 | High     | 優先修：action buttons 44px、hand tray compact、phase instruction 可折疊。      |
| Battle `/play/*`, `/qa/battle` | 1024x768                              | smoke PASS；不應視為完整 desktop                                   | High     | 常駐 sidebar 轉 sheet；延後 desktop layout 到 >=1180。                          |
| Battle `/play/*`, `/qa/battle` | 768x1024 / 820x1180                   | 可玩但大型 field glow/背景越界；side panel button 40px             | High     | 使用 compact board composition；side panel actions 44px。                       |
| Battle `/play/*`, `/qa/battle` | 430x932                               | 可玩；左右裝飾/zone 有貼邊風險                                     | High     | stage container 增加 padding 或縮 stack zone；action tray sticky。              |
| Battle `/play/*`, `/qa/battle` | 390x844 / 360x740                     | 左右 `battle-stack-zone` 實際可視越界；pending choice 選項 33-37px | High     | 壓縮 stage row；pending options/buttons `min-h-11`；禁止核心操作低於 44px。     |
| Battle pending choice          | 360x740                               | modal/sheet 內容可讀，但選項和送出偏矮                             | High     | Pending choice 使用 mobile Sheet variant，sticky footer 44px。                  |
| Deck Builder `/deck-builder`   | 1920x1080                             | 可用；卡池 + active deck 清楚                                      | Low      | 保持。                                                                          |
| Deck Builder `/deck-builder`   | 1536x864                              | 探針 offscreen 來自裝飾 glow；搜尋框 36px                          | Medium   | 搜尋框 `min-h-11`；glow 走 `AmbientGlow`。                                      |
| Deck Builder `/deck-builder`   | 1366x768                              | 無阻斷；工具密度高                                                 | Medium   | low-height compact toolbar/filter。                                             |
| Deck Builder `/deck-builder`   | 1280x720 / 1024x768                   | 裝飾 offscreen；頁面可用但需要滾動                                 | Medium   | 常駐 filter 降級為 Sheet；active deck 只在 >=1280 且高度足夠時常駐。            |
| Deck Builder `/deck-builder`   | 768x1024 / 820x1180                   | 可用；卡池 single workspace 合理                                   | Low      | 不需要單獨 mobile layout。                                                      |
| Deck Builder `/deck-builder`   | 430x932 / 390x844 / 375x812 / 360x740 | 探針 PASS；preview icon 44px，但 active deck 刪除按鈕偏小          | High     | Active deck sheet 內的 remove button 改 44px icon button。                      |
| Card Browser / Detail          | Mobile all                            | 卡牌 detail 有 Sheet，但 desktop popover/手機 sheet 邏輯分散       | Medium   | 抽 `CardDetailSurface`，統一 popover/sheet breakpoint。                         |
| Feedback `/feedback`           | 1920x1080 / 1536x864                  | 桌面資訊清楚                                                       | Low      | 保持。                                                                          |
| Feedback `/feedback`           | 1366x768 / 1280x720                   | 工具列仍佔較多垂直空間                                             | Medium   | toolbar compact mode。                                                          |
| Feedback `/feedback`           | 1024x768 / 768x1024                   | 無溢出；filter/action 密度偏高                                     | Medium   | 排序與 filter 分層。                                                            |
| Feedback `/feedback`           | 430x932 / 390x844 / 375x812 / 360x740 | Sort tabs 與返回按鈕 40px，低於 44px；首屏 controls 過多           | High     | 手機改 filter Sheet + segmented sort；所有 controls `min-h-11`。                |
| Feedback detail modal          | Mobile all                            | 自建 modal 可滾動，但 focus 管理未確認                             | High     | 改用 shared `Dialog`/`Sheet`，加 focus trap。                                   |
| Leaderboard `/leaderboard`     | Desktop/tablet/mobile                 | smoke/探針 PASS；手機 card list 清楚                               | Low      | 可作為 DataList mobile pattern 參考。                                           |
| Match History `/history`       | Desktop/tablet/mobile                 | smoke/探針 PASS；若紀錄很多需觀察虛擬化                            | Low      | 保持，後續統一 card/list spacing。                                              |
| Admin `/admin`                 | All required sizes                    | smoke/探針 PASS；手機 card grid/filter 可用                        | Medium   | 不需單獨 mobile layout；將 page-specific responsive CSS 收斂。                  |
| I18n `/admin/i18n`             | All required sizes                    | smoke/探針 PASS；手機 table card 化可用                            | Medium   | 將 `I18nManager.css` 顏色/表格規則遷移到 DS/DataList。                          |
| Shared Nav                     | Mobile non-fullscreen pages           | Header menu 44px，基本可用                                         | Low      | 後續 PageHeader/NavBar 統一 title/action collapse。                             |
| Modal/Dialog/Sheet             | Mobile all                            | 多套 modal 存在；視覺可用但 focus/scroll-lock 未完整               | High     | 共用 `Dialog`/`Sheet` 加 focus trap、restore focus、body lock。                 |
| Toast                          | Mobile all                            | 未在 smoke 中專門測；CSS viewport fixed                            | Medium   | 增加 toast responsive/a11y smoke；close/action 44px。                           |

## 是否需要單獨 mobile layout

| 頁面         | 判斷                                       | 原因                                                                                     |
| ------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Battle       | 需要 layout composition 級 mobile variant  | 手機 IA 應從桌面 table/sidebar 改為任務導向 HUD + tray + sheets，但不可分叉 game logic。 |
| Deck Builder | 不需要獨立頁；需要 workspace variant       | 手機可用，問題是 filter/deck side panel 的呈現方式。                                     |
| Feedback     | 不需要獨立頁；需要 toolbar/sheet variant   | 主要是 controls 分層，不是資訊架構重寫。                                                 |
| Online Lobby | 不需要獨立頁；需要 collapsible custom room | Quick/deck/custom 可用同 sections 重排。                                                 |
| Admin/I18n   | 不需要                                     | 既有 responsive table/card 已可用。                                                      |
