# Art Direction v2 —「深夜訊號 Midnight Signal」×「Chronos Projection」

> Token 落地：`src/ui/tokens/`（colors / typography / radius / shadow〔切角・括角〕…）
> 結構落地：`src/ui/game/game.css`（浮動 HUD、錶盤戰場、計分板、鎖定框）
> 取代：v1「漆器塔羅」（暖黑＋金＋朱紫＋襯線斜體＋梯形桌面＋通欄頂欄）— 已全面退役。

## 概念

ZUTOMAYO 的世界是**深夜的電波**：夜裡收到的訊號、霓虹儀表、時鐘的刻度。
本作規則核心是 Chronos 晝夜循環 — 因此新視覺把**官方晝夜雙色（夜=青、晝=紅）**
提升為整套 UI 的敘事色，再以**電光黃**作為玩家行動的訊號色。

### 結構語言：Chronos Projection（戰場即時鐘）

戰場不再模擬實體桌（v1 的梯形透視桌面），而是**從中央 Chronos 投影出來的巨大錶盤**：

1. **放射狀戰場底**（ChronosFieldCanvas）：同心圓刻度環＋12 刻度輻射線從中央錶盤展開；
   上下半場以晝夜色微染（對手側/己方側），中線為虛線晝夜分界。
2. **浮動 HUD**（無通欄）：回合/晝夜/倒數是左上懸浮切角膠囊，工具按鈕是右上膠囊，
   階段軌以菱形節點掛在膠囊下緣 — 戰場四角是儀表，不是網頁 header。
3. **攻擊力計分板**：BattleZone 讀數放大為 clamp(1.8–2.6rem) 霓虹數字＋光暈，
   對手讀數朝下、己方朝上，隔著 Chronos 形成 VS 對峙 — 傷害=攻擊力差的規則成為畫面主角。
4. **鎖定框（corner brackets）**：卡槽以四角 L 形括角取代整圈邊框——場上位置是「目標鎖定框」
   而非「牌墊」；undoable/targetable 改變括角顏色與底色。
5. **切角膠囊（chamfer）**：HUD、階段提示、主按鈕、側欄面板一律 `--chamfer-sm` 斜切角
   ＋半透明 blur — 全站形狀語言從「圓角卡片」換成「儀表切角」。

## 與 v1 的決裂點（為什麼看起來是另一套產品）

| 維度 | v1 漆器塔羅 | v2 深夜訊號 |
|------|------------|------------|
| 畫布 | 暖漆黑（近棕黑，無彩度） | **深夜靛墨**（藍相 oklch h265 c0.03） |
| 主色 | 消光金（低彩度） | **電光黃 volt**（高彩度 neon） |
| 對手/戰鬥色 | 朱「紫」（h295，偏紫非紅） | **緋紅 daybreak**（h32，＝官方晝色） |
| 敘事色 | 無 | **晝夜雙色系統** `--time-night` 青 / `--time-day` 紅（官方 Chronos 配色） |
| 標題字 | 襯線斜體（Kaisei Tokumin italic，塔羅儀式感） | **粗體幾何無襯線**（Inter/PingFang，直立、加寬字距，儀表感） |
| 中文標題 | 手寫/宋體裝飾字型 | 系統粗黑體（裝飾字型退役） |
| 圓角 | 4–16px 柔和 | **2–8px 銳利**（`radius.css` 全面下修） |
| 選中色 | 琥珀 | **冷白訊號**（selected = signal-50） |
| 裝飾 | 金框、金光暈 | 中性冷灰 hairline；光暈只保留晝夜氛圍偏移 |

## 色彩系統（`src/ui/tokens/colors.css`）

- **畫布**：`--ink-950/900/850` 深夜靛墨三階。
- **文字**：`--signal-50` 冷白。
- **行動**：`--volt-400` 電光黃 — 只屬於「玩家現在可以做的事」（主按鈕、playable 呼吸框、己方 HP、Power 總值）。
- **晝夜**：`--time-night` 青 / `--time-day` 紅 — Chronos 錶盤雙弧、攻擊力讀數著色、全場背景微偏移（`chrono-night/day`）、對手側佔用晝紅作為張力色（`--accent-action`）。
- **訊息**：danger 玫紅 / success 玉綠 / info 青 — 只用於 toast、提示、log tone。
- **互動四態**：playable=volt 呼吸、selected=冷白實框＋光暈、targetable=青虛框、disabled=降飽和 25%。

## 字體系統（`typography.css`）

- Display：Inter 650 直立、+3.5% 字距（`.font-display` 全域校正層中和舊頁殘留的 `italic`）。
- 正文：Inter / PingFang；數值與 meta 一律 JetBrains Mono。
- `--type-micro/minutia`（8/9px）deprecated，新功能禁止。

## 形狀 / 材質

- 邊框 1px 中性 hairline（`--border-default` 為冷白 14% 透明），強調框才用 volt。
- 卡牌唯一陰影 `--shadow-card`；面板 `--shadow-panel`；不疊多重光暈。
- 圖樣僅 dot pattern（opacity ≤0.04）與戰場梯形透視（桌面限定）。

## 使用邊界

- volt 黃不作裝飾底色，只表達「可行動」；晝夜色不用於非時間語義的元素。
- 深色畫布不得被大面積亮色面板打破（卡圖是唯一高彩度主角）。
- 動效規範沿用 motion tokens：狀態驅動、無 idle 動畫、respect `prefers-reduced-motion`。
