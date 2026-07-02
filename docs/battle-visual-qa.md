# Battle Visual QA

日期：2026-07-02

## 範圍

本輪只針對 Battle 對戰畫面做 visual QA，不修改正式對戰流程。

新增 hidden QA fixture route：

- `/qa/battle?state=janken`
- `/qa/battle?state=mulligan`
- `/qa/battle?state=initial-set`
- `/qa/battle?state=turn-set`
- `/qa/battle?state=effect-order`
- `/qa/battle?state=pending-choice`
- `/qa/battle?state=game-over`

截圖時使用 `controls=0` 隱藏 QA selector，例如 `/qa/battle?state=turn-set&controls=0`。

## 測試矩陣

Viewport：

- 1366x768
- 1280x720
- 1024x768
- 768x1024
- 430x932
- 390x844
- 360x740

產物：

- 截圖：`docs/battle-visual-qa-screenshots/`
- 度量資料：`docs/battle-visual-qa-data.json`

## 總結

Battle 沒有 document-level 水平溢出，主問題不是整頁撐寬，而是「單屏戰場」在低高度與觸屏尺寸下過度擁擠。

最需要優先處理的是：

1. 1280x720 / 1366x768 這類低分屏桌面：玩家手牌與操作列貼到 viewport 底部，部分內容被裁切。
2. 1024x768 / 768x1024：側欄變成下方區塊後仍承載 Focus + Log，資訊高度遠超可視區，需要 Drawer / Sheet 化。
3. 360x740 / 390x844：戰場可用但密度極高，pending-choice 面板內容高度超出自身可視區，且多個操作目標低於 44px。
4. Battle 的 card focus 主要依賴 hover，觸屏上不可作為主要資訊入口。

## 發現

### P1：低高度桌面底部操作區被裁切

影響：

- `1280x720`：`battle-player-area`、`battle-hand-row`、`battle-action-stack` 量測為 offscreen。
- `1366x768` 也接近臨界，只是裁切較輕。
- 代表截圖：`docs/battle-visual-qa-screenshots/1280x720__turn-set.png`

現象：

- 手牌卡片只露出上半部。
- `確認出牌` 按鈕貼住底部，視覺上不像穩定操作區。
- 右側 sidebar 仍佔 280px，壓縮主戰場高度。

建議：

- 對 Battle 增加 height-aware compact variant，例如 `max-height: 760px`。
- compact variant 下縮短 topbar + phase banner 垂直佔用。
- 降低 opponent/player area 的固定高度與手牌卡尺寸。
- 操作列改成固定在 Battle viewport 內的 compact action bar，而不是跟手牌一起被下推。

### P1：1024 / 平板側欄不應再常駐於內容流

影響：

- `1024x768`：sidebar 可視高度約 288px，但內容 scrollHeight 約 1381px。
- `768x1024`：sidebar 可視高度約 288px，但內容 scrollHeight 約 1042px。
- 代表截圖：`docs/battle-visual-qa-screenshots/1024x768__turn-set.png`

現象：

- Focus / Log 被壓在戰場下方，只能看到一部分。
- 在 1024x768，sidebar 與下半部戰場視覺上互相競爭高度。

建議：

- `<= 1024px` 或容器寬度不足時，sidebar 改成 Drawer / bottom Sheet。
- 主畫面只保留 Log/Focus 的入口按鈕與狀態摘要。
- Drawer 內再放完整 Focus、Log、Battle breakdown。

### P1：手機 pending-choice 面板高度不足

影響：

- `390x844 pending-choice`：effect panel 約 304px，但 scrollHeight 約 345px。
- `360x740 pending-choice`：effect panel 約 266px，但 scrollHeight 約 345px。
- 代表截圖：`docs/battle-visual-qa-screenshots/360x740__pending-choice.png`

現象：

- 選項區與 footer 壓縮，選項按鈕高度約 37px。
- 背景戰場仍很密，modal 可讀性被環境噪音拖低。

建議：

- effect / choice panel 改成 mobile bottom sheet 或 centered sheet with `max-height: min(72dvh, ...)`。
- 內容區內滾，footer 固定。
- 選項 row 最小高度提高到 44px。

### P2：觸控目標偏小

度量：

- pause button 約 `40x30` 或 `52x29`。
- effect option 約 `286-382 x 37`。
- game-over CTA 約 `121x41`。
- turn action buttons on mobile 約 `40px` 高。

建議：

- 所有觸屏可點擊目標最小高度 44px。
- pause 在手機改 icon button，尺寸固定 `44x44`。
- effect / pending choice option row 設 `min-height: 44px`。

### P2：手機戰場區塊過密

影響：

- `360x740`：grid 需要約 27px 內部縱向滾動。
- `390x844` / `360x740`：battle-zone-strip 內有 2 組水平 overflow，stack zone 有 offscreen。
- 代表截圖：`docs/battle-visual-qa-screenshots/360x740__turn-set.png`

現象：

- 區域標籤、HP、牌組/深淵資訊都在同一屏競爭。
- 場地可用，但辨識成本高。

建議：

- 手機 Battle 使用同一套 components，但套 `compact` layout variant。
- 場地 peripheral zones 改成橫向 rail，明確提供 scroll affordance。
- 牌組、深淵、充能區可以合併為 compact zone summary，點擊展開詳細。

### P2：文字過小

度量：

- 主 Battle 狀態在多數 viewport 有約 33-50 個 `< 11px` 的 direct text 節點。

判斷：

- 裝飾性 meta label 可以保留 9-10px。
- 但操作提示、log、effect 選項、zone label 不應全部落在 9-10px。

建議：

- 操作相關文字至少 11-12px。
- Log 在 mobile Drawer 內可使用 11px，主戰場只顯示最近一條摘要。
- phase banner body 在手機維持 12px 以上。

### P2：mulligan 手牌橫列缺少滑動暗示

影響：

- `360x740 mulligan`：第五張卡只露出一部分，表示需要橫向滑動。
- 代表截圖：`docs/battle-visual-qa-screenshots/360x740__mulligan.png`

建議：

- 加左右 fade / scroll hint。
- 或在 mobile mulligan 改成 2-row card grid，避免關鍵選牌操作靠隱性水平滑動。

### P3：game-over 基本穩定

影響：

- `360x740 game-over`、`390x844 game-over` 均無溢出。
- CTA 高度約 41px，略低於 44px，但不阻塞。

建議：

- 後續一起納入 touch target 調整即可。

## Hover / Touch 風險

目前 Battle 的 Focus panel 很依賴 hover/focus 來更新卡片詳情。觸屏上不能假設 hover 可用。

建議：

- 卡片 tap 後更新 Focus panel。
- 手機上 Focus panel 放到 bottom Sheet。
- 長按/二次 tap 可作為 popover 補充，但不能是唯一資訊入口。

## 建議實作順序

1. Battle compact layout baseline：處理 `max-height: 760px` 與 `max-width: 430px` 的場地高度、手牌尺寸、action bar。
2. Sidebar Drawer / bottom Sheet：`<= 1024px` 將 Focus / Log 移出常駐內容流。
3. Effect / choice mobile sheet：選項 row 44px、內容內滾、footer 固定。
4. Touch target pass：pause、game-over CTA、effect option、mulligan actions。
5. Hover-to-tap pass：所有卡片詳情入口在 touch 裝置可用。

## 結論

Battle 不需要完全獨立 mobile layout，但需要一套明確的 responsive workspace variant：

- desktop normal
- low-height desktop compact
- tablet/mobile with field-first layout + sidebar drawer
- mobile choice/effect sheet

這符合 `docs/responsive-strategy.md` 的方向：共用組件，透過 layout variant / breakpoint / container query 適配，只有資訊架構差異很大時才拆獨立 mobile layout。
