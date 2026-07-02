# Responsive Strategy — ZUTOMAYO CARD Online

Date: 2026-07-02

Scope: 根據 `docs/responsive-audit.md` 與 `docs/responsive-visual-qa.md` 制定全項目 responsive 策略。本文件是實作準則，不修改程式碼。

## Strategy Summary

本項目不採用「每頁一套手機版」。主要策略是建立一套 responsive UI primitives，讓頁面透過 layout variant、breakpoint、container query、Drawer/Sheet 與內容折疊適配不同螢幕。

只在資訊架構真的不同時才允許獨立 mobile composition。現階段只有 `Battle` 與 `Deck Builder` 的小螢幕互動模型接近這個門檻；即使如此，也應復用同一批 `BoardZone`、`Card`、`Panel`、`Button`、`Dialog/Sheet`、`DeckList` 組件，而不是複製業務邏輯或重寫頁面流程。

Primary goals:

- 保持同一套業務流程與狀態模型。
- 讓共用 UI 組件承擔 responsive 行為。
- 避免桌面 sidebar 在手機直接堆到頁面底部。
- 避免 hover-only 操作成為觸屏上的唯一入口。
- 修正低高度桌機與手機瀏覽器 toolbar 對 `h-screen` 的裁切問題。

## Responsive Foundations

### Breakpoint Model

Use these mental tiers:

| Tier | Viewports | Meaning |
| --- | --- | --- |
| Small phone | `360x740`, `390x844` | 最嚴苛互動密度；只保留主任務與必要狀態。 |
| Phone | `430x932` | 仍是單手觸控；避免雙欄與 hover-only。 |
| Tablet portrait | `768x1024` | 可展示更多內容，但 secondary panel 不應常駐。 |
| Tablet landscape | `1024x768` | 不等於 desktop；遊戲/編輯器/sidebar 不應過早啟用 desktop layout。 |
| Low-height desktop | `1280x720`, `1366x768` | 寬度夠但高度不足；需要 compact vertical rhythm。 |
| Desktop | `>= 1180px` 且高度足夠 | 可使用雙欄、常駐 sidebar、完整 toolbar。 |

Rules:

- `md` 適合微調間距、字級、局部 grid，不適合直接啟用高密度 desktop layout。
- `lg` 在 Tailwind 預設是 `1024px`，對本項目太早。`Battle`、`Deck Builder`、Admin 類工具應以 container query 或 `min-width >= 1180px` 的 custom condition 啟用 desktop sidebar。
- 加入 low-height 條件：`height <= 768px` 時降低 panel padding、card height、header/footer佔比。

### Container First

頁面級 breakpoint 只能處理大框架；密集工具需要 container query。

Recommended container roles:

- `page`: 決定 header/nav、整頁 scroll mode。
- `workspace`: 決定主內容是 single column、split panel、或 sidebar。
- `toolbar`: 決定 controls 是 inline、wrap、還是 collapsed menu。
- `card-grid`: 決定卡牌/資料卡 columns。

Container query preferred cases:

- Card browser grid columns.
- Deck builder card pool + active deck split.
- Battle board + side detail split.
- Feedback/Admin toolbars.
- Data table to card-list switch.

### Shared Layout Primitives

Responsive work should converge on these shared primitives:

| Primitive | Responsive responsibility |
| --- | --- |
| `PageShell` | `screen` / `scroll` / `workspace` variants; use `dvh`; safe top/bottom inset; optional global nav offset. |
| `PageHeader` | back/title/right-actions layout; collapse right actions to menu on phone; avoid centered title overlap. |
| `ResponsiveToolbar` | inline on desktop, wrapped on tablet, Drawer/Popover/Sheet on phone. |
| `Panel` | size variants `compact/default/roomy`; lower padding on small phone and low-height desktop. |
| `Dialog` / `Sheet` | desktop modal, mobile full-height or bottom sheet; sticky header/actions; internal scroll body. |
| `Drawer` | secondary panels: filters, active deck, logs, account/profile, room details. |
| `DataList` | table on desktop, card/list rows on phone. |
| `ActionBar` | sticky primary action on phone; inline action group on desktop. |
| `SegmentedControl` | replaces dense tab/button rows; horizontal scroll only as fallback. |

### Typography And Tap Targets

Rules:

- Mobile action text floor: 12px for metadata, 14px for primary controls where possible.
- `text-[9px]` may remain only for non-decision badges/counters.
- `text-[10px] uppercase tracking-[0.3em]` must reduce tracking on small screens or be hidden behind icons/menus.
- Interactive targets should be at least 40px high/wide on touch layouts.
- Hover effects are decorative only. Any preview, tooltip, reaction picker, card details, or disabled explanation needs tap/click fallback.

### Overflow And Height

Rules:

- Replace broad `h-screen` assumptions with `min-h-dvh`, `h-dvh`, or `PageShell` variants.
- On normal document pages, prefer `PageShell variant="scroll"` instead of `overflow-hidden`.
- On workspace pages, use `min-h-0` and internal scroll regions.
- Decorative absolute glow/background layers must not expand scroll width.
- Low-height desktop needs compact mode, not mobile mode.

## Scenario Strategies

### 1. Landing

Pages/components:

- `/` `LobbyPage` first screen as landing-like entry.
- Intro banner, global entry cards, auth/language controls.

Information architecture:

- Same IA across devices: brand/header, primary mode cards, secondary footer/help.
- No independent mobile page.

Responsive strategy:

- Use `PageShell variant="landing"` with `dvh` and internal scroll.
- Use `PageHeader variant="landing"`:
  - Desktop: brand left, subtitle, language/auth right.
  - Phone: brand compact, language/account inside menu or sheet.
- Entry cards use same component with `density` variant:
  - Desktop: 3-column cards, expressive height.
  - Tablet portrait/phone: single-column cards with reduced display type.
  - Low-height desktop: reduce `md:h-[460px]` style card height.
- Footer/help should collapse under phone into a compact secondary menu or bottom row.
- Intro banner should be modal/sheet on phone, not a full-width floating block competing with cards.

Allowed variants:

- `LandingCard density="hero|compact"`.
- `PageHeader actions="inline|menu"`.
- `PageShell chrome="floating|stacked"`.

Not allowed:

- Separate mobile-only landing route.
- Duplicating card content for phone.

### 2. Lobby

Pages/components:

- `/online` `OnlineLobbyPage`.
- `/ai` `AILobbyPage`.
- Deck selection panels, quick match, AI difficulty, player identity.

Information architecture:

- Same IA, but priority changes by device.
- Phone order should be task-first: choose deck -> start/match -> optional settings/details.

Responsive strategy:

- Use one lobby composition with `LobbyWorkspace` variants:
  - Desktop: main content + secondary side panel.
  - Tablet portrait/phone: single-column with collapsible sections.
  - Low-height desktop: compact panels and sticky primary action.
- Keep player identity/rank/profile out of the header on phone; move into a collapsible panel or account Drawer.
- AI opponent deck and difficulty should be grouped:
  - Desktop/tablet landscape: visible side panel.
  - Phone/tablet portrait: collapsible "Opponent" section or setup step.
- Disabled action explanations must be visible inline, not hover-only tooltips.

Allowed variants:

- `LobbyWorkspace variant="split|stacked|step"`.
- `DeckSelector density="comfortable|compact"`.
- `ActionBar stickyOnMobile`.

Independent mobile layout:

- Not needed. Phone can use the same sections with ordering, collapse, and sticky action variants.

### 3. Room

Pages/components:

- Online room creation/joining inside `/online`.
- Created room info, room code/share link, anonymous identity editor.
- Online reconnect/waiting status panels in `/play/online/:matchID`.

Information architecture:

- Same IA across devices: identity, deck, match action, custom room, room status.
- Phone should hide custom-room complexity until requested.

Responsive strategy:

- Treat quick match as primary room flow; custom room is secondary.
- Desktop:
  - Quick match/status panel can live in aside.
  - Custom room creation/join can be visible below or beside deck selection.
- Phone/tablet portrait:
  - Custom room becomes a collapsed section or Drawer.
  - Created room details become compact `RoomSummary` with copy/share actions stacked.
  - Anonymous identity edit opens a small sheet/dialog instead of inline crowded row.
- Waiting/reconnect panels should use `PageShell variant="status"` and stay centered with max width; actions stack on phone.

Allowed variants:

- `RoomPanel mode="quick|custom|status"`.
- `RoomDetails density="full|compact"`.
- `IdentityEditor presentation="inline|sheet"`.

Independent mobile layout:

- Not needed. Use collapsible secondary room controls and sheet presentation.

### 4. Battle

Pages/components:

- `/play/ai`, `/play/online/:matchID`, `/tutorial`.
- `Board`, hand drawer, battlefield zones, focus card, action log, choice/effect overlays.

Information architecture:

- This is the only core flow where phone IA meaningfully differs. Desktop is spatial: table + sidebar + logs. Phone should be task/timeline-based: opponent summary -> battle zone -> player hand/action tray -> detail sheets.
- Still do not duplicate game logic. Build a responsive `BoardLayout` that renders the same state through different layout slots.

Responsive strategy:

- Desktop:
  - Main board plus persistent right sidebar.
  - Logs/details/effects can be visible in sidebar tabs.
  - Hand can use bottom tray/drawer.
- Tablet landscape:
  - Delay persistent sidebar unless container is wide enough.
  - Prefer sidebar as collapsible drawer if width or height is tight.
- Tablet portrait/phone:
  - Use compact battle HUD:
    - top opponent summary
    - central battlefield with horizontally scrollable or compressed zones
    - bottom hand/action tray
    - logs/details/effects in bottom sheet tabs
  - Overlay choices should become mobile sheets with sticky submit/cancel actions.
  - Card preview must be tap-to-preview, not hover.
- Tutorial:
  - Floating tooltip on desktop.
  - Bottom sheet on phone with highlight retained above.

Allowed variants:

- `BoardLayout variant="table|compact"`.
- `BoardSidebar presentation="aside|sheet"`.
- `HandTray presentation="dock|sheet"`.
- `CardPreview trigger="hover+focus|tap"`.

Independent mobile layout:

- Allowed only at layout-composition level for `BoardLayout variant="compact"`.
- Not allowed to fork rules, actions, validation, or board state handling.

### 5. Card Browser

Pages/components:

- Deck selection card lists in `/online`, `/ai`.
- Card pool inside `/deck-builder`.
- Admin card grid where applicable.
- Future reusable card browsing/search/filter surfaces.

Information architecture:

- Same IA: search, filter, sort, result grid/list, selected card/details.
- Phone should prioritize search + results, with filters hidden until requested.

Responsive strategy:

- Build a reusable `CardBrowser` shell:
  - `CardBrowserToolbar`: search + primary filters.
  - `FilterDrawer`: advanced filters and sort on phone.
  - `CardGrid`: container-query columns.
  - `CardDetail`: side panel on desktop, sheet on phone.
- Desktop:
  - Search/filter inline.
  - Grid uses available width.
  - Preview/details can be aside/popover.
- Phone:
  - Search stays visible.
  - Filters collapse behind one button with active filter count.
  - Grid becomes 2-column or compact list depending card size and tap target.
  - Card preview uses tap sheet.
- Low-height desktop:
  - Toolbar should wrap less; move secondary filters into collapsed panel.

Allowed variants:

- `CardBrowser density="browse|select|admin"`.
- `FilterControls presentation="inline|drawer"`.
- `CardGrid size="normal|small|compact"`.

Independent mobile layout:

- Not needed. Use CardBrowser variants and filter drawer.

### 6. Deck Builder

Pages/components:

- `/deck-builder` `DeckEditorPage` / `DeckEditor`.
- Card pool, filters, active deck, save/status action.

Information architecture:

- Desktop IA: browse card pool and active deck side-by-side.
- Phone IA: two-mode workspace is acceptable because simultaneous side-by-side editing is not viable. This is a composition variant, not a separate business flow.

Responsive strategy:

- Reuse `CardBrowser` for card pool.
- Active deck should be a responsive panel:
  - Desktop wide: persistent right sidebar.
  - Tablet portrait/phone: Drawer/bottom sheet or tab mode.
  - Low-height desktop: persistent but compact, with internal scroll.
- Save/status should be sticky on phone and low-height desktop.
- Rules/validation summary should collapse into a compact status row on phone.
- Filters must not occupy the first viewport on phone; use filter sheet.
- Decorative absolute background overflow should be removed or clipped in shared shell.

Allowed variants:

- `DeckBuilderWorkspace variant="split|tabs|drawer"`.
- `ActiveDeckPanel presentation="aside|drawer|tab"`.
- `DeckValidation density="full|summary"`.
- `DeckSaveBar sticky`.

Independent mobile layout:

- Allowed as `variant="tabs"` or `variant="drawer"` because the working model changes from simultaneous editing to mode switching.
- Not allowed to duplicate deck mutation logic, validation, or save behavior.

### 7. Settings

Pages/components:

- Auth/account controls.
- Language switcher.
- PWA install/update drawers.
- Feedback/admin/i18n management surfaces where they behave like settings/tooling.
- `/admin/i18n` should be used for i18n manager, not `/i18n`.

Information architecture:

- Settings are mostly secondary actions. They should not consume top-level mobile header width.
- Dense management settings may use compact list/card variants, but should still use shared form/table/dialog primitives.

Responsive strategy:

- Header settings actions:
  - Desktop: inline where space allows.
  - Phone: account/language/settings inside one menu or Drawer.
- Forms:
  - Desktop: modal or inline panel.
  - Phone: sheet with sticky title/actions.
- Tables:
  - Desktop: table/grid.
  - Phone: `DataList` card rows with key fields and explicit edit action.
- Admin/i18n:
  - Authenticated admin needs separate visual QA.
  - Do not promise full dense desktop admin on phone. Provide compact management layout or "desktop recommended" fallback for high-risk operations.
- Feedback:
  - Treat toolbar as settings/filter controls. On phone, collapse sort/status/tags/search into `ResponsiveToolbar`.

Allowed variants:

- `SettingsMenu presentation="inline|drawer"`.
- `DataList variant="table|cards"`.
- `FormDialog presentation="modal|sheet"`.
- `ResponsiveToolbar presentation="inline|collapsed"`.

Independent mobile layout:

- Usually not needed.
- Admin-only high-density tools may use a compact mobile management composition if table/form IA changes. Keep same data APIs and form components.

## Cross-Scenario Decisions

### Mobile Navigation

Visual QA confirms current mobile nav is a blocker.

Strategy:

- Under `md`, replace the five-link top row with Drawer or bottom nav.
- Keep at most 3 primary destinations visible if bottom nav is used.
- Move secondary destinations into Drawer.
- Ensure all non-fullscreen pages receive safe top offset when nav is fixed.

### Sidebar To Drawer Rules

Convert sidebars to Drawer/Sheet when:

- Sidebar width leaves primary area below usable width.
- User needs primary content and sidebar only intermittently.
- Sidebar contains logs/details/filters/metadata rather than the main task.

Affected surfaces:

- Battle right sidebar.
- Deck Builder active deck and filters.
- Online custom room/profile panels.
- Feedback tag/detail panels.
- Admin filters/edit dialogs.
- I18n translation edit.

### Multi-Column Rules

Use multi-column layout only when:

- Container is wide enough, not just viewport.
- Both columns remain usable at 40px tap targets.
- The page height still allows primary actions without excessive scroll.

Delay or gate these:

- `AILobbyPage` side column from `md` to `lg`/container.
- `OnlineLobbyPage` split from `md` to wider condition.
- `DeckEditor` persistent active deck from `lg=1024` to wider condition.
- `Board` persistent sidebar from `lg=1024` to wider condition.

### Hover And Touch

Required touch alternatives:

- Card preview: tap-to-preview sheet.
- Disabled tooltip: inline helper text or explicit info button.
- Feedback reaction picker: explicit toggle button with `aria-expanded`.
- Board/card hover lift: active/focus state plus tap detail.

### Data Tables

Desktop tables are acceptable for:

- Leaderboard.
- Match history detail.
- Admin users/matches.
- I18n translations.

Phone strategy:

- Use card-list rows for decision-making views.
- Horizontal scroll is acceptable only as temporary mitigation, not final UX.
- Inline table editing should become sheet editing on phone.

## Implementation Phases

### Phase 1: Responsive Infrastructure

- Add `PageShell` variants: `screen`, `scroll`, `workspace`, `status`.
- Add `PageHeader`, `ResponsiveToolbar`, `Sheet`, `ActionBar`, `DataList`.
- Add mobile nav Drawer/bottom nav.
- Normalize `dvh` and safe-area handling.

### Phase 2: Low-Risk Layout Fixes

- Landing header/card scaling.
- Lobby header and secondary section collapse.
- Feedback toolbar collapse and missing sort labels.
- Low-height desktop compact spacing.
- Decorative overflow clipping.

### Phase 3: Reusable Browser/Drawer Patterns

- Introduce `CardBrowser`.
- Move Deck Builder filters to drawer.
- Move active deck to drawer/tab variant.
- Add tap-to-preview card detail sheet.

### Phase 4: Battle Compact Layout

- Add deterministic visual QA state for `Board`.
- Implement `BoardLayout variant="table|compact"`.
- Move logs/details/effects into sheet tabs below desktop width.
- Convert tutorial tooltip to mobile bottom sheet.

### Phase 5: Operational Tools

- Add authenticated Admin visual QA.
- Add `DataList` card variants for Admin/I18n/Leaderboard where needed.
- Add sheet editing for mobile forms.

## Implementation Status

Completed in the current responsive pass:

- `TutorialGamePage`: tutorial tooltip uses a mobile sheet at `<=768px`; when the highlighted target is in the lower half of the viewport, the sheet moves to the top so the target remains visible and tappable.
- `DeckEditor`: filters collapse into a sheet below `lg`; active deck moves into a sheet below `xl`; desktop keeps the original inline filters and right-side active deck panel.
- `Sheet`: shared sheet surface now uses a stable modal layer and opaque panel sections so sheet content remains visually separated from the underlying page.
- `LobbyPage`: low-height desktop uses compact entry cards and footer spacing so the first screen no longer crowds the primary entry cards.
- `OnlineLobbyPage`: disabled quick-match/create-room guidance is visible on touch layouts instead of relying on hover-only tooltips.
- `AILobbyPage`: stacked tablet/phone layout uses tighter vertical rhythm before the desktop split activates.
- `FeedbackPage`: mobile toolbar uses a compact sort rail and full-width primary action; comment reactions now have an explicit tap target instead of hover-only access.
- `LeaderboardPage`: desktop keeps the full rank table, while phone/tablet portrait layouts switch to rank cards so leaderboard stats no longer require horizontal scrolling.
- `MatchHistory`: phone headers, pagination, and record actions now wrap into compact two-column controls instead of crowding one row.
- `AdminPage`: card-management filters now collapse behind a phone/tablet filter toggle below desktop width while wider desktop keeps the full filter panel visible.
- `FeedbackPage`: post detail uses a phone sheet with sticky close affordance and internal scrolling instead of a tall page-scrolling modal.
- `Board`: below desktop width, the secondary side surface is now a tabbed sheet with Focus, Status, and Log panels instead of separate one-off drawers.

## Acceptance Criteria

For each changed surface:

- Test `1366x768`, `1280x720`, `1024x768`, `768x1024`, `430x932`, `390x844`, `360x740`.
- No visible horizontal content overflow.
- Decorative layers do not increase document scroll width.
- Primary action is visible or reachable without hunting.
- Touch layouts have no hover-only required action.
- Dialog/sheet content fits `100dvh` with sticky action/header when needed.
- Interactive targets are at least 40px on touch layouts.
- No page-specific mobile duplication unless listed as allowed above.
