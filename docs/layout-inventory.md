# Layout Inventory

Phase: Phase 3 Layout Architecture  
Status: Complete for layout architecture consolidation; no business logic changes  
Scan date: 2026-07-04  
Scope: `src/App.tsx`, `src/pages`, `src/components`, shared UI primitives.

## Summary

- Existing shared layout primitives: `PageShell`, `PageHeader`, `Panel`, `Card`, `ActionBar`, `ResponsiveToolbar`, `Sheet`, `Dialog`.
- Phase 3 primitives added in `src/components/ui/Layout.tsx`: `WorkspaceLayout`, `ScrollPageLayout`, `PageSectionHeader`, `StatusPageLayout`, `ToolHeader`, `FilterToolbar`, `StatsGrid`, `StatCard`.
- Main layout families found: app shell with global nav, landing full-screen layout, workspace split layout, scroll-list layout, status-centered layout, battle board layout, admin/data workspace layout.
- Phase 3 migration completed for low-risk layout shells: `LeaderboardPage`, `MatchHistory`, `AIGamePage`, `AILobbyPage`, `OnlineLobbyPage`, `DeckEditor`, `FeedbackPage`, `AdminPage`, `I18nManager`, and Battle structural slots in `Board`.
- Highest-risk remaining areas are intentionally deferred to Phase 4/5: deep Battle compact visual tuning, Feedback detail modal architecture, DataList mobile card mode, Dialog/Sheet focus trap.

## Implementation Status

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Scroll page shell | Complete | `src/pages/LeaderboardPage.tsx`, `src/components/MatchHistory.tsx`, `src/pages/AIGamePage.tsx` | Migrated to `ScrollPageLayout` and `PageSectionHeader`; existing data/status logic unchanged. |
| Workspace split shell | Complete | `src/pages/AILobbyPage.tsx`, `src/pages/OnlineLobbyPage.tsx`, `src/components/DeckEditor.tsx` | Migrated sidebar/content ownership to `WorkspaceLayout`; deck, room, and AI selection handlers unchanged. |
| Tool/data headers | Complete | `src/pages/AdminPage.tsx`, `src/pages/I18nManager.tsx`, `src/components/DeckEditor.tsx` | Replaced repeated compact headers with `ToolHeader` while preserving page-specific class hooks. |
| Stats/filter layout | Complete | `src/pages/AdminPage.tsx`, `src/pages/FeedbackPage.tsx`, `src/components/MatchHistory.tsx` | Reused `StatsGrid`, `StatCard`, and `FilterToolbar`; toolbar controls remain the same components. |
| Battle layout slots | Complete for structural extraction | `src/components/Board.tsx` | Added named Battle-only topbar/content/sidebar/overlay slots without changing moves, state, card geometry, or tutorial selectors. |
| Global nav touch targets | Complete | `src/App.tsx` | Maintained app shell behavior; aligned mobile nav controls with responsive smoke requirements. |
| Deferred modal architecture | Deferred to P5 | `src/pages/FeedbackPage.tsx`, `src/components/ui/Dialog.tsx`, `src/components/ui/Sheet.tsx` | Detail modal still needs a focused a11y/focus-management pass. |
| Deferred data list architecture | Deferred to P4 | `src/components/ui/DataList.tsx`, `src/pages/AdminPage.tsx`, `src/pages/I18nManager.tsx` | Table-to-card responsive mode should be handled as a dedicated data-layout pass. |

## Layout Type Counts

| Layout Type | Count | Current Locations | Notes |
| --- | ---: | --- | --- |
| Header | 9 | `App.tsx`, `LobbyPage`, `DeckEditor`, `AdminPage`, `I18nManager`, `FeedbackPage`, `AIGamePage`, `LeaderboardPage`, `MatchHistory`, `Board` | Same back/title/actions pattern appears under several names and spacing rules. |
| Footer | 3 | `LobbyPage`, `Dialog`, `Sheet` | Landing footer is page-specific; modal/sheet footer is already standardized. |
| Sidebar / Side Panel | 6 | `OnlineLobbyPage`, `AILobbyPage`, `DeckEditor`, `Board`, `BattleSideSheet`, `AppDrawer` | Most are split-layout sidebars; Battle and drawer are special shells. |
| Toolbar | 7 | `ResponsiveToolbar`, `CardBrowserToolbar`, `FeedbackPage`, `MatchHistory`, `AdminPage`, `DeckEditor`, `Board` top controls | Same filter/action/status pattern exists in Feedback/Admin/Deck/History. |
| Panel | 8 | `Panel`, `RoomPanel`, `CardBrowser`, `ActiveDeckPanel`, `Battle*SidebarPanel`, Feedback panels, Admin stats/errors, status panels | Many differ only by spacing, title treatment, or overflow. |
| Main Content | 7 | landing card grid, two-column workspace, scroll list, data table workspace, status center, battle board, game full-screen | Can be reduced to 4 shared layout primitives plus Battle-specific layout. |
| Floating Action / Overlay | 9 | `ToastProvider`, `Pwa*Prompt`, `online-resume-prompt`, Lobby intro, Feedback detail modal, Battle overlays, Tutorial overlay, Card popovers, pause button | Needs z-index/focus policy before full unification. |

## Page Layout Inventory

| Page / Component | Current Layout | Header | Main Content | Sidebar / Footer / Floating | Abstraction Candidate |
| --- | --- | --- | --- | --- | --- |
| `App.tsx` | Root `app-shell` with optional global nav and `route-content` | `NavBar` for non-fullscreen routes | Route outlet | `online-resume-prompt` floating status | `AppShell`, `GlobalNav`, `ResumePrompt` |
| `LobbyPage.tsx` | Fullscreen landing hero/app surface | Absolute landing header with brand/settings/auth | Centered 3-card action grid | Absolute footer, mobile drawer, intro floating panel | `LandingShell`, `LandingHeader`, `LandingFooter`, `FloatingPanel` |
| `OnlineLobbyPage.tsx` | Workspace split layout | `PageHeader` | `grid lg:grid-cols-[340px_minmax(0,1fr)]` | Left `RoomPanel as aside`; right deck/custom panels | `WorkspaceLayout` with `sidebar` and `content` slots |
| `AILobbyPage.tsx` | Workspace split layout | `PageHeader` | `grid lg:grid-cols-[minmax(0,1fr)_24rem]` | Right difficulty column | Same `WorkspaceLayout`; only column width/order differs |
| `DeckEditor.tsx` | Workspace split layout with tool header | Custom compact header | Card browser grid | Active deck desktop aside; mobile sheets; popover | `WorkspaceLayout`, `ToolHeader`, `FilterToolbar`, `ResponsiveSidePanel` |
| `FeedbackPage.tsx` | Scroll page with stats, toolbar, list, modal | Custom `.feedback-header` | Stats strip + toolbar + list | Submit/tag panels as inline or sheet; custom detail modal | `ScrollPageLayout`, `StatsGrid`, `FilterToolbar`, `DetailModalLayout` |
| `AdminPage.tsx` | Data workspace with sticky-ish header and tabbed content | Custom `admin-header` | Stats + filters + card grid OR tables | Card edit dialog | `DataWorkspaceLayout`, `FilterToolbar`, `DataGridLayout` |
| `I18nManager.tsx` | Workspace/scroll data tool | Custom `i18n-header` | Locale tabs + filters + table | Edit sheet/dialog | `DataWorkspaceLayout`, `PageHeader`, `FilterToolbar` |
| `LeaderboardPage.tsx` | Scroll list/data page | Custom centered back/title header | Status panels + desktop table + mobile cards | None | `ScrollPageLayout`, `PageSectionHeader`, `DataListLayout` |
| `MatchHistory.tsx` | Scroll list/data page | Custom title/action header | Stats grid + toolbar + cards | Match detail dialog | `ScrollPageLayout`, `StatsGrid`, `FilterToolbar`, `ActionBar` |
| `AIGamePage.tsx` | Status/instructions page or game shell handoff | Simple custom header | Single `Panel` with instructions | None | `StatusPageLayout` + `PageHeader` |
| `OnlineGamePage.tsx` | Status-centered shell or `OnlineGame` full-screen | None in status shell | Centered `Panel`; `OnlineGame` wraps `Board` | Waiting overlay dialog, leave dialog | `StatusPageLayout`, `BlockingOverlay` |
| `TutorialGamePage.tsx` | Status-centered shell then full-screen game | None in loading state | `Board` tutorial shell | Tutorial overlay/dialog | `StatusPageLayout`, Battle overlay slots |
| `BattleVisualQaPage.tsx` | QA full-screen board with fixed debug aside | None standard | Full-screen battle fixture | Fixed QA panel | Dev-only `QaOverlay` |
| `Board.tsx` | Custom full-screen battle board architecture | Absolute battle topbar | Battle field grid + command dock | Desktop sidebar, mobile side sheet, overlays, pause button | `BattleLayout` slots; do not merge with generic page layouts |

## Header Inventory

| Header Type | Current Implementations | Difference | Should Unify? | Recommended Layout |
| --- | --- | --- | --- | --- |
| Global nav header | `App.tsx` `NavBar` | Route navigation, desktop horizontal + mobile overlay menu | Keep separate | `GlobalNav` |
| Landing header | `LobbyPage.tsx` absolute top header | Brand + settings/auth, no border, overlays hero | Keep page-specific wrapper, share slots | `LandingHeader` |
| Standard page header | `PageHeader` used by `AILobbyPage`, `OnlineLobbyPage` | Back/title/subtitle/actions | Yes | Use `PageHeader` broadly |
| Compact tool header | `DeckEditor`, `AdminPage`, `I18nManager` custom headers | Same back/title/actions but tighter height and embedded tabs/input | Yes | Add `ToolHeader` or `PageHeader density="compact"` |
| Scroll page header | `LeaderboardPage`, `MatchHistory`, `AIGamePage` | Same back/title/actions but max-width container and bottom border | Yes | `ScrollPageLayout.Header` using `PageHeader` styles |
| Feedback header | `FeedbackPage` `.feedback-header` | Back/title/anon notice, CSS-only layout | Yes | Migrate to `PageHeader` or `ScrollPageHeader` |
| Battle topbar | `Board.tsx` `.battle-topbar` | Turn/time/phase/action icons; absolute and scrollable | Keep Battle-specific | `BattleTopBar` |
| Modal/sheet headers | `Dialog`, `Sheet`, Feedback custom modal | Mostly title/close/body separation | Yes, except Feedback until modal migration | Shared `Dialog`/`Sheet` |
| Dev QA header/panel | `BattleVisualQaPage` fixed aside | Debug-only | Keep dev-only | `QaOverlay` |

## Footer Inventory

| Footer Type | Current Implementations | Difference | Should Unify? | Recommended Layout |
| --- | --- | --- | --- | --- |
| Landing footer | `LobbyPage.tsx` `.lobby-home-footer` | Absolute bottom, tutorial CTA + version + legal link | Keep page-specific | `LandingFooter` |
| Dialog footer | `Dialog.tsx` | Button row, mobile stack | Already unified | Keep |
| Sheet footer | `Sheet.tsx`, `ActiveDeckSheet`, `CardBrowserFilterSheet` | Sticky bottom actions | Already mostly unified | Add `SheetFooterActions` only if repeated actions grow |
| Action footer / sticky bottom bar | `ActionBar sticky`, Lobby intro actions, Battle command dock | Different contexts | Partially unify | `ActionBar` variants plus Battle-specific dock |

## Sidebar Inventory

| Sidebar Type | Current Implementations | Difference | Should Unify? | Recommended Layout |
| --- | --- | --- | --- | --- |
| Workspace left sidebar | `OnlineLobbyPage` `RoomPanel as aside` | Fixed 340px quick-match column | Yes | `WorkspaceLayout sidebarWidth="sm"` |
| Workspace right sidebar | `AILobbyPage` difficulty column, `DeckEditor` active deck | Same split layout, different side/width | Yes | `WorkspaceLayout side="left|right"` + `ResponsiveSidePanel` |
| Desktop contextual sidebar | `Board.tsx` `.battle-sidebar` | Focus/log/status, tightly coupled to board | Battle-specific | `BattleSidebar` |
| Mobile contextual side sheet | `BattleSideSheet`, `ActiveDeckSheet`, Feedback submit/tag sheets | Same sheet behavior, different content | Yes for non-Battle; Battle later | `Sheet` + `SidePanelTabs` |
| Drawer | `AppDrawer` | Mobile settings/action drawer with custom CSS | Yes, later | Reimplement as `Sheet` wrapper |
| Popover side surface | `CardPopover`, `CardBrowserDetailPopover`, `DeckEditor` portal popover | Anchored side detail surfaces | Yes | `Popover` + `CardDetailSurface` |

## Toolbar Inventory

| Toolbar Type | Current Implementations | Difference | Should Unify? | Recommended Layout |
| --- | --- | --- | --- | --- |
| Generic responsive toolbar | `ResponsiveToolbar` | Flexible content/actions row | Already available | Use as base |
| Filter/search toolbar | `FeedbackPage`, `DeckEditor`, `AdminPage`, `MatchHistory` | Same search/filter/action/status pattern, different CSS and breakpoints | Yes | `FilterToolbar` built on `ResponsiveToolbar` |
| Card browser toolbar | `CardBrowserToolbar` | Kicker/title/search/actions/summary | Yes, with `FilterToolbar` slots | Rename or wrap as `SectionToolbar` |
| Admin advanced filters | `AdminPage` `admin-filter-panel` | Expand/collapse filter group on mobile | Yes | `CollapsibleFilterPanel` |
| Battle top controls | `Board.tsx` topbar side-panel actions | Game state controls | Battle-specific | `BattleTopBar` |
| Action groups | `ActionBar` in history/dialog/card rows | Mobile stack/grid/pagination | Already available | Keep; add `align`/`density` if needed |
| Pagination toolbar | `DeckEditor`, `MatchHistory` | Prev/page/next layout | Yes | `PaginationBar` using `ActionBar mobileLayout="pagination"` |

## Panel Inventory

| Panel Type | Current Implementations | Difference | Should Unify? | Recommended Layout |
| --- | --- | --- | --- | --- |
| Generic panel | `Panel` | `solid/ghost`, `md/lg/xl` | Already unified | Keep |
| Room panel | `RoomPanel` | Domain wrapper over `Panel`; quick/deck/custom/status modes | Keep as domain wrapper | Could become `Panel variant/density` later |
| Card browser panel | `CardBrowser` | Section shell with fixed min-height and inner scroll grid | Yes | `SectionPanel` or `WorkspacePanel` |
| Active deck panel | `ActiveDeckPanel` | Desktop-only aside panel | Yes | `ResponsiveSidePanel` |
| Stats cards/grid | Admin stats, Feedback stats, MatchHistory stats | Same metric grid but different components/classes | Yes | `StatsGrid` + `StatCard` |
| Error/loading/status panel | Admin/I18n/Leaderboard/Online status panels | Same status content but inconsistent `Panel` vs `Alert` | Yes | `StatusPanel` using `Alert`/`LoadingState` |
| Battle panels | `BattleFocusSidebarPanel`, `BattleLogSidebarPanel`, `PendingChoicePanel`, `EffectOrderPanel` | Game-specific content and overlays | Battle-specific | `BattlePanelShell` |
| Auth/account panel | `AuthSection` | Compact account/login card, appears in landing header/drawer | Keep component-specific | Could use `Panel` slots later |

## Main Content Inventory

| Main Content Type | Current Implementations | Difference | Should Unify? | Recommended Layout |
| --- | --- | --- | --- | --- |
| Full-screen landing content | `LobbyPage` card grid | Hero background, absolute header/footer, center cards | Keep as landing-specific | `LandingShell` |
| Workspace split | `OnlineLobbyPage`, `AILobbyPage`, `DeckEditor` | Same `PageShell workspace + flex header + grid flex-1`; widths/order differ | Yes | `WorkspaceLayout` |
| Scroll data/list page | `LeaderboardPage`, `MatchHistory`, `FeedbackPage`, I18n login/status | Same max-width or full-width scroll container | Yes | `ScrollPageLayout` |
| Data workspace | `AdminPage`, `I18nManager` | Header + tabs/filters + table/grid | Yes | `DataWorkspaceLayout` |
| Centered status page | `OnlineGamePage`, Admin login, I18n login, route fallback, Tutorial loading | Same centered panel/message | Yes | `StatusPageLayout` |
| Game full-screen shell | `AIGame`, `OnlineGame`, `Board`, Tutorial game | Fullscreen app with no global nav | Keep specialized | `GameShell` wrapper |
| Battle board layout | `Board.tsx` | Complex absolute/fixed/overlay geometry | Battle-specific | `BattleLayout` with slots |

## Floating Action / Overlay Inventory

| Floating Type | Current Implementations | Difference | Should Unify? | Recommended Layout |
| --- | --- | --- | --- | --- |
| Toast stack | `ToastProvider` | Global bottom/right notifications | Already componentized | Keep |
| PWA/install/status prompts | `PwaInstallPrompt`, `PwaStatusPrompt`, `VersionUpdateTrigger` | Prompt-specific panels/actions | Partially | `PromptPanel` later |
| Resume prompt | `App.tsx` `online-resume-prompt` | Global status aside | Yes | `FloatingStatusPrompt` |
| Landing intro | `LobbyPage` fixed bottom/top panel | One-off onboarding prompt | Yes | `FloatingPanel` |
| Feedback modal | `FeedbackPage` custom overlay | Detail modal with scroll/comments/admin | Yes, but dedicated pass | `Dialog` + `DetailLayout` |
| Feedback submit/tag sheets | `Sheet` + inline panel fallback | Same panel moves to sheet by breakpoint | Yes | `ResponsivePanel` |
| Battle overlays | phase message, notice, effect order, pending choice, pause button, side sheet | Game-specific z-index and tutorial behavior | Battle-specific | `BattleOverlayLayer` |
| Tutorial overlay | `GameTutorialOverlay` | Spotlight overlay with tooltip | Keep specialized | `TutorialOverlay` |
| Card popover | `Card`, `CardBrowser`, `DeckEditor` | Anchored detail surfaces | Yes | `Popover` + `CardDetailSurface` |

## Duplicate Layouts

| Duplicate Pattern | Locations | Difference | Recommendation |
| --- | --- | --- | --- |
| Back/title/actions header | `PageHeader`, `DeckEditor`, `AdminPage`, `I18nManager`, `LeaderboardPage`, `MatchHistory`, `AIGamePage`, `FeedbackPage` | Mostly height, max-width, center/start alignment, optional tabs/actions | Add `PageHeader density="compact|regular"` and `contained`/`sticky` options; migrate non-Battle headers. |
| Workspace split grid | `OnlineLobbyPage`, `AILobbyPage`, `DeckEditor` | Sidebar side/width and overflow rules | Add `WorkspaceLayout` with `header`, `sidebar`, `main`, `side`, `sidebarWidth`, `collapseToSheet` options. |
| Filter/search/action toolbar | `FeedbackPage`, `AdminPage`, `DeckEditor`, `MatchHistory` | Same controls arranged with different class names | Add `FilterToolbar` slots: `search`, `filters`, `sort`, `summary`, `actions`, `mobileMode`. |
| Stats metric grid | `AdminPage`, `FeedbackPage`, `MatchHistory` | One uses `Panel`, one CSS cells, one custom section | Add `StatsGrid` and `StatCard`; keep content custom. |
| Status/error/loading panels | `LeaderboardPage`, `AdminPage`, `I18nManager`, `OnlineGamePage`, `FeedbackPage` | Some use `Panel`, some use `Alert/LoadingState`, some custom text | Add `StatusPanel` wrapper or standardize on `Alert`, `EmptyState`, `LoadingState`. |
| Responsive table/card fallback | `LeaderboardPage`, `AdminPage`, `I18nManager` | Each page owns responsive table CSS or card fallback | Finish `DataList` v2 with mobile card mode. |
| Side panel to sheet behavior | `DeckEditor`, `FeedbackPage`, `BattleSideSheet`, `AppDrawer` | Same responsive intent with different shell code | Add `ResponsiveSidePanel` for non-Battle; migrate Battle separately. |
| Card detail popover/sheet | `Card`, `CardBrowser`, `DeckEditor` | Same card details with three positioning/rendering systems | Add `CardDetailSurface` and `Popover` hook. |

## Spacing-Only Differences

| Pattern | Locations | Current Difference | Suggested Token / Prop |
| --- | --- | --- | --- |
| Page padding | `px-3`, `px-4`, `px-6`, `p-4`, `py-4`, `py-6` across pages | Most pages manually set responsive padding | `PageShell contentPadding="none|page|workspace|compact"` |
| Header height | 48px, 56px, `min-h-12`, `min-h-14`, `min-h-16` | Same structure with different density | `PageHeader density="compact|regular|landing|battle"` |
| Panel padding | `p-3`, `p-4`, `p-5`, `p-6`, sheet `p-panel` | Mostly density differences | `Panel size` plus `density`; avoid page CSS for simple padding |
| Grid gap | `gap-3`, `gap-4`, `gap-5`, `gap-6` | Similar workspace/list rhythm | `LayoutGap` tokens or props: `compact|regular|spacious` |
| Max width | `max-w-5xl`, `max-w-6xl`, `max-w-xl`, `max-w-md` | Page content containers vary per page | `ScrollPageLayout maxWidth` |
| Overflow ownership | `PageShell overflow-y-auto`, inner `flex-1 overflow-y-auto`, page CSS | Hard to reason about low-height desktop | `WorkspaceLayout` should own primary scroll region |

## Abstraction Candidates

| Candidate | Purpose | Replace / Wrap | Priority | Risk |
| --- | --- | --- | --- | --- |
| `WorkspaceLayout` | Shared header + one/two-column workspace with controlled scroll regions | `OnlineLobbyPage`, `AILobbyPage`, `DeckEditor`, parts of `AdminPage` | High | Medium |
| `ScrollPageLayout` | Max-width scroll page with header and vertical sections | `LeaderboardPage`, `MatchHistory`, `FeedbackPage`, `AIGamePage` | High | Low |
| `ToolHeader` / `PageHeader density` | Compact back/title/actions/tabs header | `DeckEditor`, `AdminPage`, `I18nManager`, scroll page headers | High | Low |
| `FilterToolbar` | Search/sort/filter/action responsive toolbar | `FeedbackPage`, `AdminPage`, `DeckEditor`, `MatchHistory` | High | Medium |
| `StatsGrid` / `StatCard` | Repeated metrics layout | `FeedbackPage`, `AdminPage`, `MatchHistory` | Medium | Low |
| `ResponsiveSidePanel` | Desktop aside + mobile sheet wrapper | `DeckEditor`, `FeedbackPage`, eventually `AppDrawer` | Medium | Medium |
| `DataWorkspaceLayout` | Header/tabs/filter/data table or card grid page | `AdminPage`, `I18nManager` | Medium | Medium |
| `StatusPageLayout` | Centered status/login/recovery panel | `OnlineGamePage`, Admin login, I18n login, route fallback | Medium | Low |
| `FloatingPanel` | Fixed bottom/top prompt shell | Lobby intro, resume prompt, PWA prompts | Medium | Low |
| `BattleLayout` | Named slots for topbar, field, command dock, sidebar, overlay layer | `Board.tsx` only | High | High |
| `Popover` + `CardDetailSurface` | Anchored detail + mobile sheet detail | `Card`, `CardBrowser`, `DeckEditor` | Medium | Medium |

## Phase 3 Recommendations

| Order | Task | Scope | Acceptance |
| ---: | --- | --- | --- |
| 1 | Add layout spec before code changes | Docs only | Agree on `WorkspaceLayout`, `ScrollPageLayout`, `ToolHeader`, `FilterToolbar` APIs. |
| 2 | Migrate low-risk scroll headers | `LeaderboardPage`, `MatchHistory`, `AIGamePage` | Same visuals, fewer custom header classes, build passes. |
| 3 | Extract `WorkspaceLayout` | `OnlineLobbyPage`, `AILobbyPage` first | No route/handler changes; low-height desktop still scrolls correctly. |
| 4 | Extract Deck workspace slots | `DeckEditor`, `CardBrowser`, `ActiveDeckPanel` | Keep card add/remove/filter logic untouched; desktop aside and mobile sheets unchanged. |
| 5 | Normalize Feedback layout shell | `FeedbackPage` header/stats/toolbar only | Do not migrate detail modal yet; toolbar keeps mobile behavior. |
| 6 | Normalize Admin/I18n data workspace | `AdminPage`, `I18nManager` | Header/tabs/filter shells unified; table behavior unchanged. |
| 7 | Battle layout slot extraction | `Board.tsx` | Create named structural slots/components only; no moves/state/game geometry change in the same commit. |

## Do Not Abstract Yet

| Area | Reason |
| --- | --- |
| Battle card/slot/hand geometry | Layout is gameplay-critical and tutorial selectors depend on DOM/data attributes. Extract slots first; avoid resizing behavior changes. |
| Feedback detail modal | It combines detail, edit form, admin tools, comments, reactions, duplicate search, and image upload. Needs dedicated modal architecture pass. |
| Card popover positioning | Three implementations need visual QA; do not fold into generic layout while changing page grids. |
| Landing hero composition | First-screen brand experience is intentionally different from data/workspace pages. Share header/footer slots only. |
| Dev QA pages | Keep separate unless they block responsive smoke maintenance. |
