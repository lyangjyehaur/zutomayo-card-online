# Responsive Audit — ZUTOMAYO CARD Online

Date: 2026-07-02

Scope: 全專案頁面與主要共用/遊戲 UI 的 responsive 風險盤點。本輪只做 audit，不修改 UI 程式碼。

Method:
- 靜態檢查 `src/App.tsx` 路由、`src/pages/**`、`src/components/**`、`src/App.css` 的 layout、breakpoint、overflow、fixed/absolute、hover、drawer/table/form patterns。
- 目標 viewport：`1366x768`、`1280x720`、`1024x768`、`768x1024`、`390x844`、`430x932`、`360x740`。
- 因本輪沒有可用的 in-app browser automation 入口，本文件不是 screenshot-based visual QA。所有項目需在後續修復前後以實機或 Playwright 截圖再驗證。

## Executive Summary

Highest-risk pages:
1. `Board` / online & AI game: 遊戲桌面資訊密度最高，小手機與平板豎屏需要獨立 mobile layout。
2. `DeckEditor`: 卡池 + active deck 的雙欄編輯器在平板豎屏/手機會變長且操作密集，active deck 應改 Drawer。
3. `AdminPage`: desktop data-grid 管理工具，不適合直接縮到手機；需要獨立 mobile/admin compact layout。
4. `FeedbackPage`: toolbar、modal、reaction picker、tag/admin controls 在手機上容易過密；部分 hover-only controls 不適合觸屏。
5. `LobbyPage` / `OnlineLobbyPage`: 主要是 header/footer 固定區域與小高度桌機問題，屬 breakpoint/layout tuning。

Global themes:
- `h-screen/w-screen/overflow-hidden` shell 很多，低分屏桌機與手機瀏覽器動態 toolbar 都容易產生內容裁切。
- `text-[9px]`、`text-[10px]`、`tracking-[0.3em]` 在手機與管理表格中可讀性偏低。
- 桌面 hover pattern 很多：card preview、reaction picker、tooltip、hover lift、hover-only visual affordance。觸屏上需要 click/tap fallback。
- 桌面側欄在 `Board`、`DeckEditor`、`OnlineLobbyPage`、Admin filters/detail panel 應在小螢幕改 Drawer 或 bottom sheet。
- 目前仍有 CSS media query 使用 `max-width: 680/767/768/480/640`，與 style guide 的 `md/lg` 規則不一致。這是 responsive system 層面的後續整理。

## Viewport-Level Findings

### 1366x768 / 1280x720

Primary risks:
- Fixed full-screen pages with 12-16px headers plus large panels leave little vertical room.
- `LobbyPage` entry cards use `md:h-[460px]`; combined with `pt-20/pb-12` can feel cramped at `720px` height.
- `Board` has top header, battle rows, hand area, sidebar, overlays; `720px` height is likely the first desktop failure point.
- `DeckEditor` card pool uses `min-h-[32rem]` and active deck `min-h-[24rem]`; at `720px` height the editor may require scrolling before all controls are visible.
- `AdminPage` header + stats + filters can consume too much height before card grid/table.

Recommended posture:
- Audit low-height desktop separately from wide desktop. Use compact vertical spacing at `height <= 768px`.
- Prefer `min-h-0` plus internal scroll regions over fixed panel minimums.
- Move secondary controls into collapsible filter sections on low-height desktop.

### 1024x768 tablet landscape

Primary risks:
- `lg:` starts at 1024, so tablet landscape receives desktop layouts in `Board`, `DeckEditor`, and Admin.
- `Board` switches to `lg:grid-cols-[minmax(0,1fr)_280px]`; 1024px leaves limited playfield width after sidebar.
- `DeckEditor` switches to `lg:grid-cols-[minmax(0,1fr)_320px]`; card pool plus 320px active deck is tight.
- Admin stats switch to 5 columns at `lg`, producing dense metric cards.

Recommended posture:
- Treat 1024 landscape as "wide tablet", not full desktop, for game/editor/admin.
- Delay some desktop sidebars to a larger custom container breakpoint or use `lg` only when width and height are sufficient.

### 768x1024 tablet portrait

Primary risks:
- Multi-column pages generally collapse, but headers and controls remain desktop-like.
- `OnlineLobbyPage` uses single-column content at portrait, but quick match panel, deck selector, and custom room stack into a long page.
- `DeckEditor` active deck stacks below card pool; with `PAGE_SIZE = 30` and card grid, active deck is far from save/header context.
- `AdminPage` remains a desktop management surface with wide filters/tables; tables require horizontal scrolling.

Recommended posture:
- Drawers/bottom sheets for secondary panels: active deck, online profile/rank summary, admin filters.
- Sticky action bars for save/start actions.
- Collapse status/metrics blocks.

### 390x844 / 430x932 phones

Primary risks:
- Kicker/button text with `tracking-[0.3em]` and 10px font consumes width quickly.
- Full-width tables require horizontal scroll; `AdminPage`, `LeaderboardPage`, `MatchHistory`, `I18nManager` need card/list mobile variants.
- Hover previews and hover-only menus are not reachable.
- Header rows with left/back, centered title, right identity can overlap or force truncation.
- Fixed overlays/dialogs with `p-6` and large forms may require better mobile sizing.

Recommended posture:
- Mobile-first page variants for game, editor, admin, feedback detail.
- Replace hover preview with tap-to-preview dialog/sheet.
- Use larger body/action type on phones: avoid `text-[9px]`, reserve `text-[10px]` for metadata only.

### 360x740 small phones

Primary risks:
- Highest failure risk: header + bottom action + keyboard + dialogs.
- `LobbyPage` footer and cards compete for vertical space.
- `Board` likely requires a dedicated compact game HUD; current game table is too dense.
- `FeedbackPage` toolbar, tag filters, and forms become crowded.
- Admin/I18n are not usable without dedicated compact views.

Recommended posture:
- Create explicit small-phone modes for top-priority flows: lobby, online lobby, game, deck editor.
- Hide/collapse noncritical stats, subtitles, metadata, and decorative layers.
- Increase tap targets to 40px+ and avoid 2+ adjacent tiny icon controls.

## Global Components

### `PageShell`

Findings:
- Uses `h-screen w-screen overflow-hidden`. This is good for game-like full-screen pages but risky for normal content pages and mobile browser chrome.
- Pages often add their own inner `overflow-y-auto`; if any child misses `min-h-0`, content may be clipped.

Actions:
- Keep `PageShell` for game/lobby shells, but add an `overflow="auto"` or `variant="scroll"` option for document-like pages.
- Consider `min-h-dvh h-dvh` for mobile browser toolbar correctness.

### `Button`

Findings:
- `tracking-[0.3em]` on all buttons can create wide labels on phone.
- `size="sm"` still uses uppercase mono 10px; dense admin/tool surfaces can become hard to read.

Actions:
- Add responsive compact variant: icon-only where possible, or `tracking-[0.18em]` under mobile.
- For mobile, prefer short labels and hide secondary action text behind menus.

### `Dialog`

Findings:
- Central modal with `p-6`, `max-w-*`, and top-right close works on desktop.
- On 360px width, content-heavy dialogs such as Admin card edit, Feedback detail, and Match detail may feel cramped and tall.

Actions:
- Add mobile `sheet` behavior: full-height or bottom-sheet style with sticky header/actions.
- Use `max-h-[calc(100dvh-2rem)] overflow-y-auto` on dialog body rather than only body subcontainers.

### `AppDrawer` / PWA prompts

Findings:
- Drawer is appropriate for install/update prompts.
- Need verify bottom safe-area/inset on iOS-style phones and small phones.

Actions:
- Ensure drawer panel uses `max-height: calc(100dvh - safe-area)` and internal scroll.
- Keep action buttons stacked on narrow widths.

## Page-by-Page Audit

### `/` — `LobbyPage`

Overflow:
- `md:h-[460px]` entry cards plus `pt-20/pb-12` can exceed visible height on `1280x720`.
- Fixed footer overlays bottom content; on `360x740`, the tutorial CTA and copyright can compete with the scrollable card area.
- Header has app title, subtitle, language switcher, and auth section; `AuthSection` can expand horizontally.

Text too small:
- Footer, card numbering, CTA labels use `text-[10px]` with wide tracking.
- Copyright line is very small and likely hard to read on phones.

Dense operations:
- Header right cluster (`LanguageSwitcher` + `AuthSection`) is dense on mobile.
- Footer has tutorial CTA plus feedback/copyright in one area.

Unreasonable heights:
- Desktop card height is large for low-height screens.
- Intro banner at top can cover header and first card on small phones.

Should collapse:
- App subtitle in header already hidden until `md`, good.
- Footer copyright/feedback should collapse into a compact menu on phones.
- Intro banner should become a dismissible bottom sheet or modal on phones.

Drawer candidates:
- `AuthSection` should become account drawer on mobile instead of expanding inline.

Multi-column to single-column:
- Already single-column before `md`; OK.
- At 768px portrait, consider staying single-column; at 1024 landscape, 3 cards may be OK but height is still tight.

Hover unavailable:
- Entry cards rely on hover ring, lift, gradient, icon color, arrow movement.
- This is decorative but should have active/focus/tap feedback.

Needs independent mobile layout:
- Not fully independent, but needs a mobile-specific header/footer composition.

Breakpoint-only fixes:
- Reduce `md:h-[460px]` on low-height screens.
- Lower footer visual priority under `md`.

### `/online` — `OnlineLobbyPage`

Overflow:
- Header has back button, centered title, identity/ELO cluster. On 390px width, these can overlap or force horizontal overflow.
- Quick match aside becomes top panel on portrait/mobile; combined with deck selector and custom room form yields long vertical scroll.
- Created room panel includes room code/share link/copy hint; can overflow horizontally if URL input is not constrained.

Text too small:
- Identity/rank labels and status messages use 9-10px.
- Room code/share helper text uses 10px.

Dense operations:
- Anonymous name edit row has input + save + cancel in tight row.
- Create/join room controls are side-by-side; on small phone join button can squeeze input.
- Quick match CTA plus tooltip/cancel state can crowd.

Unreasonable heights:
- Quick match panel with identity, current deck, rank, CTA, matchmaking, errors is tall for first viewport.
- Deck selector can be large if server deck list grows.

Should collapse:
- Rank card and current deck summary should be collapsible/secondary on mobile.
- Custom room panel should default collapsed under the primary quick match flow.
- Created room details should be a compact expandable section after room creation.

Drawer candidates:
- Anonymous identity editor can be a small dialog/sheet.
- Custom room creation/join can be a drawer under mobile.

Multi-column to single-column:
- Already single column below `md`; OK.
- At `1024x768`, `md:grid-cols-[340px_minmax(0,1fr)]` is usable but tight; verify deck selector width.

Hover unavailable:
- Disabled state tooltips are `group-hover` only. On touch, users cannot discover why start/create is disabled.

Needs independent mobile layout:
- Yes, for matchmaking-first flow. Mobile should prioritize: deck select, quick match, then collapsible custom room.

Breakpoint-only fixes:
- Header identity should hide/truncate under `md`.
- Join room row should stack below 390px.

### `/ai` — `AILobbyPage`

Overflow:
- Header centered title can overlap `BackButton` on 360px.
- Two-column layout at `md:grid-cols-[minmax(0,1fr)_24rem]`; 768px portrait triggers two columns, leaving a 24rem right column and narrow left content.

Text too small:
- Header title and deck labels are OK; metadata/errors use 10px.

Dense operations:
- DeckSelector + opponent DeckSelector + DifficultyButtons can create a long/tall form.

Unreasonable heights:
- At 768x1024, two-column layout may be inefficient; right column consumes too much width.

Should collapse:
- Opponent deck selector could collapse under "advanced" on phone/tablet portrait.
- DifficultyButtons can become a segmented control or sticky bottom action after deck selection.

Drawer candidates:
- Opponent deck selector as drawer/advanced sheet on mobile.

Multi-column to single-column:
- Should remain single-column until at least `lg` or until container width can support 24rem side panel.

Hover unavailable:
- Depends on DeckSelector/DifficultyButtons hover styling; needs selected/pressed states to be visible.

Needs independent mobile layout:
- Not full independent, but the AI setup flow should be step-based on phones.

Breakpoint-only fixes:
- Change side layout from `md` to `lg`.

### `/play/ai` and `/play/online/:matchID` — `AIGame`, `OnlineGame`, `OnlineGamePage`, `Board`

Overflow:
- `Board` is the highest-risk layout. It uses full-screen fixed game shell, absolute header, dense battlefield rows, hand drawer, overlays, and right sidebar.
- At `1024x768`, `lg:grid-cols-[minmax(0,1fr)_280px]` activates, reducing board area.
- At mobile widths, board becomes one column with vertical scroll, but game interactions may be distributed too far apart.
- Hand drawer uses fixed bottom positioning and can overlap battlefield/action areas.
- Right sidebar becomes stacked below/within scroll on non-`lg`, but still has min heights and logs/details that can dominate vertical space.

Text too small:
- Many game labels are `text-[8px]`, `text-[9px]`, `text-[10px]`.
- Card zone counters and metadata are especially small on phones.
- Header status and connection state are small and may be missed.

Dense operations:
- Janken/mulligan/setup overlays, pending choice grid, effect order, hand cards, board zones, and action buttons create very high tap density.
- Zone tiles are 88px, but nested cards/counters are smaller and may be hard to tap/read.
- Pending choice selection and submit button are close to list content.

Unreasonable heights:
- Opponent area `min-h-[13rem]`, player area `min-h-[18rem]`, battle stage `min-h-[10rem]`, sidebar `min-h-[18rem]` can exceed mobile viewport.
- Game over screen uses very large glyph `text-[6rem]`/`md:text-[10rem]`.

Should collapse:
- Action log should collapse by default on tablet/mobile.
- Focus card/detail panel should become drawer/sheet.
- Secondary counters/metadata should be hidden behind details.
- Opponent hand/deck metadata can collapse in compact mode.

Drawer candidates:
- Right sidebar should become Drawer/bottom sheet below `lg`, not stacked in main scroll.
- Hand drawer already behaves like drawer, but needs mobile-specific safe-area and overlap rules.
- Focus card details and action log should be separate tabs within a bottom sheet.

Multi-column to single-column:
- Desktop two-column board should not activate at `1024x768`; use a larger desktop breakpoint or container query.
- On phones, board should be a purpose-built single-column game HUD, not just a stacked desktop layout.

Hover unavailable:
- Hand card hover lift and preview.
- Card/DeckEditor popover-style previews.
- Zone hover rings and group-hover effects.
- These need tap-to-preview or long-press alternatives.

Needs independent mobile layout:
- Yes. This is the clearest case. Mobile game needs:
  - top compact opponent summary
  - central battle zone with horizontally scrollable zones
  - bottom hand/action tray
  - sheet tabs for logs/details/effects

Breakpoint-only fixes:
- Move `lg` desktop sidebar activation later.
- Reduce min heights under 768px height.
- Use `dvh` and safe-area for fixed overlays.

### `/tutorial`

Overflow:
- Tutorial overlay is fixed and masks the board; tooltip positioning can collide with highlighted holes on small phones.
- CSS includes `@media (max-width: 640px)`, outside the desired breakpoint scale.
- Tutorial text panel can cover the target it describes on 360px phones.

Text too small:
- Tutorial controls use 10px uppercase; body copy is more readable but should be checked in long locales.

Dense operations:
- Overlay next/skip/complete controls can be crowded with tooltip text.

Unreasonable heights:
- Tooltip `p-5` and full instructional text may exceed small phone height.

Should collapse:
- Long tutorial body should scroll inside tooltip/sheet.
- Secondary skip control should be visually less dominant but accessible.

Drawer candidates:
- On phones, tutorial explanation should become bottom sheet with highlight retained above.

Multi-column to single-column:
- Not applicable, but overlay should switch from floating tooltip to bottom sheet.

Hover unavailable:
- Not primary; tutorial is click-driven.

Needs independent mobile layout:
- Yes, for tooltip/sheet behavior.

Breakpoint-only fixes:
- Replace `max-width:640px` CSS with tokenized `md` strategy.

### `/deck-builder` — `DeckEditorPage` / `DeckEditor`

Overflow:
- Header wraps and includes back, title, optional deck name input, sync label, save. On 360px, this can become two rows and reduce content height.
- Main layout becomes two columns at `lg`; at 1024 landscape, `320px` active deck leaves limited card pool width.
- Card pool has `min-h-[32rem]`; active deck has `min-h-[24rem]`; on low-height screens these force long scrolling.
- Search input `w-56` can overflow beside headings on narrow card pool header.

Text too small:
- Filter buttons and pagination labels use `text-[10px] tracking-[0.3em]`.
- Card count chips use `text-[9px]`.
- Active deck rules use 10px.

Dense operations:
- Filters, search, pagination, card grid, deck list, remove buttons are all visible at once.
- On phones, 3-column card grid creates small cards and dense tap zones.

Unreasonable heights:
- `min-h-[32rem]` card pool is too tall for 720px desktop once header and active deck are included.
- Active deck below card pool on mobile makes save context distant from selected cards.

Should collapse:
- Filters should collapse into a filter drawer/sheet.
- Active deck rules can collapse.
- Card preview popover should not render on touch; use tap detail.

Drawer candidates:
- Active deck should be a right drawer on tablet/desktop and bottom drawer on mobile.
- Filters should be drawer or collapsible panel.

Multi-column to single-column:
- Current single-column below `lg` is good, but 1024 landscape still likely too tight for desktop two-column. Consider delaying two-column until wider than 1180 or using container query.

Hover unavailable:
- Card preview popover uses mouse/focus enter; on touch, no reliable preview.
- Card hover lift and ring are not enough feedback for touch.

Needs independent mobile layout:
- Yes. Mobile should be a two-mode editor: Browse Cards / Active Deck, with sticky save/status.

Breakpoint-only fixes:
- Change two-column activation from `lg` to a wider breakpoint/container condition.
- Stack search below heading under `md`.

### `/history` — `MatchHistoryPage` / `MatchHistory`

Overflow:
- Header has title and two actions; on 360px it may need wrapping.
- Stats use `md:grid-cols-4`; at 768 portrait four columns may be tight depending localization.
- Detail dialog has stat grid `md:grid-cols-4`; usable at 768 but tight for long labels.
- Trace entries can contain long IDs/effect payloads.

Text too small:
- Pagination and metadata use 10px uppercase.
- Trace context uses small text.

Dense operations:
- Pagination row with prev/page/next can be tight.
- Record action buttons `view trace/download trace` sit side-by-side.

Unreasonable heights:
- Dialog body with long trace list can exceed viewport; current `Dialog` wrapper scrolls overlay, but footer/header may not be sticky.

Should collapse:
- Stats can collapse to two columns on tablet portrait.
- Record details could hide less critical metadata behind expand.
- Trace filters/search may be needed if logs grow.

Drawer candidates:
- Match detail can be full-screen sheet on mobile.

Multi-column to single-column:
- Record metadata grid should become single column on phones; currently `md:grid-cols-3`, so OK below `md`.

Hover unavailable:
- Minimal risk; mostly buttons.

Needs independent mobile layout:
- Not full independent; mobile dialog/sheet would be enough.

Breakpoint-only fixes:
- Stats grid should use 2 columns at `md`, 4 at `lg`.

### `/leaderboard`

Overflow:
- Table has six columns and uses horizontal overflow only through panel; on phones, user must scroll horizontally.
- Header uses `grid-cols-[1fr_auto_1fr]`; title can squeeze with long translations.

Text too small:
- Table header uses `text-[10px] tracking-[0.3em]`; too small/dense on phones.

Dense operations:
- Not many operations; mostly read-only.

Unreasonable heights:
- No major height issue.

Should collapse:
- On phones, table should become ranking cards: rank, nickname, ELO, win rate, match count.

Drawer candidates:
- None.

Multi-column to single-column:
- Table should become single-column card list on phones.

Hover unavailable:
- Minimal.

Needs independent mobile layout:
- A small mobile card-list variant is recommended.

Breakpoint-only fixes:
- Header title/back layout can be adjusted without independent page redesign.

### `/feedback`

Overflow:
- Toolbar combines sort tabs, status select, tag select, search input, submit button, admin tag button. This can overflow or wrap into a tall control block on phones.
- Stats section includes total/votes plus all status counts; many small cells.
- Detail modal `max-width:640px` is OK for desktop but dense on phones.
- Reaction picker uses `position:absolute` and `width:max-content`; can overflow viewport.

Text too small:
- Post metadata, tags, voters, reaction chips, upload hints are 0.6-0.75rem.
- Sort tabs and toolbar labels may be small.

Dense operations:
- Vote column + clickable card body + tags inside card create nested interactive zones.
- Detail modal includes vote, voters, admin moderation, duplicate search, comments, reactions, upload, official toggle.
- Tag manage panel row has name, color, create action in one row.

Unreasonable heights:
- Detail modal can become very tall with comments/admin panel; overlay scrolls, but actions are not sticky.
- Stats block can consume vertical space before list.

Should collapse:
- Stats should collapse into summary row or hide behind "Stats".
- Admin tag panel should be Drawer.
- Moderation controls inside detail should collapse by default.
- Voters list and duplicate search should be collapsible.

Drawer candidates:
- Submit form as drawer/sheet on mobile.
- Post detail as full-screen sheet on mobile.
- Admin tag management as drawer.

Multi-column to single-column:
- Cards are already list-style; toolbar should become single-column/segmented controls.

Hover unavailable:
- Reaction picker appears on `.reaction-group:hover`; on touch this is not accessible.
- Hover states on vote/reaction chips need tap feedback.

Needs independent mobile layout:
- Yes for post detail and toolbar. List itself can remain responsive.

Breakpoint-only fixes:
- Toolbar wrapping and stats collapse can be breakpoint-level.

### `/admin`

Overflow:
- Header has back/title/count, tablist, logout in a single row. On 768px and phones this will overflow or squeeze.
- Cards tab filters have many chip buttons and inputs; very tall.
- Card grid `minmax(160px,1fr)` is OK for phones but card overlay text can be too dense.
- Users/matches tables are wide and no explicit horizontal wrapper after replacement.
- Card modal contains tabs and full edit forms; at 360px it needs full-screen sheet behavior.

Text too small:
- Table headers 10px uppercase with tracking.
- Filter chips use compact button style.
- Card overlay metadata is 12px.

Dense operations:
- Filter sections contain many adjacent buttons.
- ELO edit row includes current value + input + update action in a table cell.
- Card edit modal has many fields and save actions.

Unreasonable heights:
- Stats + filters take significant height before card grid.
- Modal body uses `max-h-[60vh]`; on 720px desktop this leaves limited editing area.

Should collapse:
- Filters should collapse into a panel/drawer.
- Stats should collapse to horizontal scroll or summary.
- Users/matches should switch to card rows.
- Card edit tabs should become segmented sticky header; form sections should be accordion.

Drawer candidates:
- Filter controls as drawer.
- Card edit modal as full-screen drawer/sheet on tablet/mobile.

Multi-column to single-column:
- Card edit form already uses `md:grid`; fine.
- Stats `lg:grid-cols-5` should be okay desktop but not mobile.
- Tables need mobile card list.

Hover unavailable:
- Card grid uses hover lift/opacity; touch still opens on tap but lacks preview/affordance.

Needs independent mobile layout:
- Yes. Admin is desktop-first; phones need a compact management layout or "desktop recommended" fallback.

Breakpoint-only fixes:
- Header tablist wrap/scroll.
- Add horizontal overflow wrapper to tables as immediate mitigation.

### `/i18n`

Overflow:
- Header is simple but table has multiple wide columns: key, base, selected locale, status.
- `.i18n-key`, `.i18n-base`, `.i18n-translated` CSS max width is 250px; on phones table still becomes wide.
- Locale tabs and filters can wrap/take height.

Text too small:
- Table contents and status badges can be small.
- Key column is dense and hard to read on phones.

Dense operations:
- Inline edit mode places input + save + cancel inside table cell.

Unreasonable heights:
- Long translation strings can make rows tall.

Should collapse:
- Locale tabs into select/segmented scroller on mobile.
- Missing/search filters into collapsible toolbar.

Drawer candidates:
- Edit translation should open a dialog/sheet instead of inline table editing on phones.

Multi-column to single-column:
- Mobile should use key cards: key, base text, translation text, status/action.

Hover unavailable:
- Not hover-dependent.

Needs independent mobile layout:
- Recommended for serious use; at minimum table horizontal scroll.

Breakpoint-only fixes:
- Locale tabs and filters can be adjusted with breakpoints.

### `/deck-builder`, `/admin`, `/feedback` Shared Data/Form Pattern

Common issue:
- These pages are operational tools. They currently try to keep desktop density visible on smaller screens.

Common recommendation:
- Introduce `ToolbarCollapse`, `FilterDrawer`, `MobileDataList`, and `MobileSheetDialog` patterns.

### Global `NavBar`

Overflow:
- Five left nav buttons plus tutorial on right can overflow at tablet/phone widths.
- NavBar appears on non-fullscreen routes like admin, feedback, history, leaderboard, i18n/deck pages depending route shell.

Text too small:
- 10px uppercase labels, high letter spacing.

Should collapse:
- Under `md`, use menu/drawer or bottom nav with 3-4 primary destinations.

Drawer candidates:
- Full nav should become drawer/hamburger on phone.

Breakpoint-only fixes:
- Hide lower priority links under `md`; move to menu.

## Hover / Touch Audit

Needs tap fallback:
- `LobbyPage` entry card hover decoration.
- `DeckSelector` and `DifficultyButtons` hover affordance.
- `DeckEditor` card preview popover.
- `Board` hand card hover lift and card focus details.
- `FeedbackPage` reaction picker hover menu.
- `AdminPage` card grid hover opacity/lift.
- Any tooltip implemented as `group-hover`, especially disabled start/create room tooltips in `OnlineLobbyPage`.

Recommended touch model:
- Use `onClick`/tap to open preview sheet.
- Use visible disabled helper text instead of hover-only tooltip.
- Use `aria-expanded` and explicit buttons for reaction picker.
- Keep hover styles decorative only, never required for information.

## Pages Needing Independent Mobile Layout

Required:
- `Board` / game table
- `DeckEditor`
- `AdminPage`
- `FeedbackPage` detail/modal + toolbar
- `TutorialGamePage` overlay

Recommended:
- `I18nManager`
- `OnlineLobbyPage`
- `LeaderboardPage` table-to-card list

Not necessary; breakpoint tuning enough:
- `LobbyPage`
- `AILobbyPage`
- `AIGamePage`
- `OnlineGamePage` status panel
- `MatchHistory` list, except detail dialog sheet behavior

## Sidebar / Drawer Candidates

Convert to Drawer / bottom sheet below tablet:
- `Board` right sidebar: focus card, logs, action panels.
- `DeckEditor` active deck panel.
- `DeckEditor` filters.
- `OnlineLobbyPage` custom rooms and anonymous identity editor.
- `AdminPage` card filters and card edit modal.
- `FeedbackPage` submit form, tag manager, post detail.
- `I18nManager` translation edit.
- `AppDrawer` already exists; can be generalized for these flows.

## Multi-Column Layouts To Revisit

Should delay desktop layout until wider than current breakpoint:
- `AILobbyPage`: `md:grid-cols-[minmax(0,1fr)_24rem]` should likely be `lg`.
- `OnlineLobbyPage`: `md:grid-cols-[340px_minmax(0,1fr)]` may be tight at 768 portrait; use `lg` or container query.
- `DeckEditor`: `lg:grid-cols-[minmax(0,1fr)_320px]` activates at 1024 and is tight; consider a larger breakpoint/container query.
- `Board`: `lg:grid-cols-[minmax(0,1fr)_280px]` at 1024x768 is too aggressive for game content.

Should become card/list on mobile:
- `LeaderboardPage` table.
- `AdminPage` users/matches table.
- `I18nManager` table.
- `MatchHistory` detail stats and trace list can remain list but dialog should become sheet.

## Text Size Audit

Problematic categories:
- `text-[8px]`, `text-[9px]` counters/badges in `Board`, `DeckEditor`, Feedback metadata.
- `text-[10px] uppercase tracking-[0.3em]` buttons and labels on phones.
- Table headers with mono uppercase and high tracking in Admin/Leaderboard/I18n.

Recommendations:
- Mobile body/action floor: 12px for metadata, 14px for controls.
- Keep 9-10px only for decorative IDs/counters that are not required for decisions.
- Reduce letter spacing for mobile controls.

## Height Audit

High-risk fixed/min heights:
- `LobbyPage` desktop cards: `md:h-[460px]`.
- `DeckEditor`: card pool `min-h-[32rem]`, active deck `min-h-[24rem]`.
- `Board`: multiple battle rows and sidebar min heights.
- `AdminPage` card modal: `max-h-[60vh]` edit area.
- `FeedbackPage` modal with comments/admin panels.

Recommendations:
- Add compact mode for low viewport height (`<= 768px`).
- Prefer content sections with `min-h-0` and internal scroll over large panel min heights.
- Use `dvh` for full-screen pages and dialogs.

## Suggested Fix Plan

Phase 1: Low-risk breakpoint fixes
- `AILobbyPage`: move side column from `md` to `lg`.
- `OnlineLobbyPage`: simplify mobile header; stack join room controls under small width.
- `LobbyPage`: reduce desktop card height for low-height screens; collapse footer.
- `LeaderboardPage`, `MatchHistory`: table/stat mobile card variants or simpler breakpoints.

Phase 2: Touch fallbacks
- Replace hover-only tooltips in `OnlineLobbyPage` with visible disabled helper text.
- Add tap-to-preview for `DeckEditor` and `Board` cards.
- Replace Feedback reaction hover picker with explicit toggle.

Phase 3: Drawer/sheet infrastructure
- Extend `Dialog`/`AppDrawer` into `Sheet`.
- Move `DeckEditor` active deck and filters to sheet on mobile.
- Move `Board` sidebar to sheet below desktop.
- Make Feedback detail mobile full-screen sheet.

Phase 4: Independent mobile layouts
- `Board` compact game HUD.
- `DeckEditor` Browse/Deck two-mode mobile editor.
- `AdminPage` mobile cards and filter drawer.
- `I18nManager` mobile translation cards.

Phase 5: CSS breakpoint cleanup
- Remove `max-width: 480/640/680/767/768` media queries.
- Normalize to style-guide breakpoints or explicit component/container variants.
- Replace remaining legacy full-screen assumptions with `dvh`/`svh` where appropriate.
