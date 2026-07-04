# Component Inventory

Phase: Phase 2 Component Standardization  
Status: Implementation complete for low-risk Phase 2 scope  
Scan date: 2026-07-04  
Scope: `src/components`, `src/pages`, `src/App.tsx` excluding tests.

## Summary

- Shared library source: `src/components/ui`.
- Current shared primitives: `Button`, `IconButton`, `Input`, `SearchInput`, `Select`, `Textarea`, `Checkbox`, `Panel`, `Card`, `Dialog`, `Sheet`, `Badge`, `Tag`, `TagButton`, `Alert`, `EmptyState`, `LoadingState`, `SegmentedControl`, `DataListTable`, `DataListCell`, `ResponsiveToolbar`, `PageHeader`, `PageShell`, `ActionBar`.
- Command/action migration after this pass: generic navigation, tabs, filters, modal actions, toolbar actions, close buttons, icon-only controls, inline alerts/loading/empty states now use shared primitives.
- Remaining raw `<button>` outside `src/components/ui` is intentionally limited to domain-specific interactive surfaces: Feedback vote column, Admin card tile, DeckEditor card tile, Battle card/log/choice/slot controls. These require `InteractiveCard`, `VoteButton`, or Battle-specific primitives and should not be forced into generic `Button`.
- Phase 2 low-risk replacements completed: shared close buttons, toast action/close, drawer close, App/Lobby navigation, Feedback back/loading/error/empty/close/tags/reactions/detail actions, Auth inputs/errors/tabs/logout/submit, Admin/I18n tabs, I18n/Feedback checkbox, DeckEditor filters/search/pagination/remove/preview, Battle side sheet tabs/close and safe CTA buttons.

| Component | Instances | Location | 建議 |
|------------|-----------|----------|------|
| Button | 1 shared command implementation plus domain-specific raw interactive surfaces | Shared: `src/components/ui/Button.tsx`. Migrated: App/Lobby nav, Auth, Admin/I18n actions, Feedback modal actions, Deck pagination/actions, Tutorial, Version trigger, safe Battle CTAs | Keep shared `Button` as only generic command button. Do not use it for card tiles, board slots, or vote controls without a domain wrapper. |
| IconButton | 1 shared implementation | Shared: `src/components/ui/Button.tsx`. Migrated: `Dialog`, `Sheet`, `AppDrawer`, `ToastProvider`, `App`, `LobbyPage`, `DeckEditor`, `FeedbackPage`, Battle side panel/sheet controls | Use `IconButton` for all icon-only controls. Remaining icon-like game controls should become Battle-specific wrappers only if repeated. |
| BackButton | 1 shared wrapper | Shared: `src/components/ui/Button.tsx`. Used by AI/I18n/Admin/Online/Feedback pages | Keep. Non-nav back actions should use `BackButton`; nav tabs should become `NavButton` or `Tabs`. |
| Input | 1 visible shared implementation plus special hidden file inputs | Shared: `src/components/ui/Input.tsx`. Migrated: Auth, Admin, Feedback, Online, I18n, Deck search via `SearchInput`. Legacy: hidden upload inputs created imperatively | Keep shared `Input`/`SearchInput`. Hidden file input remains internal helper unless it becomes visible UI. |
| Select | 1 shared implementation | Shared: `src/components/ui/Input.tsx`. Used by Feedback/Admin/I18n/LanguageSwitcher | Keep. Add `FilterSelect` or `ToolbarControl` wrapper for toolbar sizing/labels. |
| Textarea | 1 shared implementation | Shared: `src/components/ui/Input.tsx`. Used by Feedback/Admin/I18n | Keep. Add `autoGrow` only if needed later. |
| Checkbox | 1 shared implementation plus legacy native checkbox removed in I18n/Feedback | Shared: `src/components/ui/Input.tsx`. Used by I18n and Feedback after this pass | Keep. Future switch/radio should follow same label and 44px rules. |
| Switch | 0 formal implementations | None; boolean filters currently use checkbox/buttons | Do not invent per-page switches. Add only when a true on/off setting needs switch semantics. |
| Radio | 0 formal implementations | Choices are currently buttons/tabs | Use `SegmentedControl` for visual choice sets; add `RadioGroup` only for form semantics. |
| Card | 2 formal implementations: shared `Card`; game card `src/components/Card.tsx`; several domain interactive card buttons remain | Shared surface: `src/components/ui/Card.tsx`. Game card: `src/components/Card.tsx`. Domain surfaces: Admin card tile, DeckEditor card tile, Battle card/slot buttons, Feedback post card | Keep both formal implementations. Add `InteractiveCard` later for non-game list/card buttons; keep Battle/game card controls domain-specific. |
| Panel | 1 shared primitive plus legacy CSS panels | Shared: `src/components/ui/Panel.tsx`. Used by Admin/I18n/Leaderboard/Online/RoomPanel. Legacy: `empty-route-panel`, Feedback CSS panels, App.css legacy panels | Keep. Add `tone` variants (`info`, `danger`, `success`) or use `Alert` for status panels. |
| Modal | Alias of Dialog plus page legacy modal | Shared alias: `Dialog as Modal`. Legacy: `FeedbackPage` detail modal | Use `Dialog` naming. Migrate Feedback detail modal when focus trap/scroll behavior is added. |
| Dialog | 1 shared implementation plus legacy modal shells | Shared: `src/components/ui/Dialog.tsx`. Used by Auth, MatchHistory, Tutorial, Online, Admin, I18n. Legacy shells: Feedback detail modal, AppDrawer, Online waiting overlay, Battle side sheet | Keep. Focus trap/restore is the remaining hardening item; Feedback/Battle shell migrations belong to Phase 3 layout work. |
| Drawer | 2 implementations: `AppDrawer`; `Sheet side=right` can cover same role | `src/components/AppDrawer.tsx`, `src/components/ui/Sheet.tsx` | Keep `AppDrawer` as semantic wrapper now; later reimplement with `Sheet` slots and remove drawer-specific CSS. |
| Sheet | 1 shared implementation plus Battle side sheet | Shared: `src/components/ui/Sheet.tsx`. Used by DeckBuilder/CardBrowser/Feedback/I18n. Legacy: Battle side sheet | Keep. Add focus trap/restore and side variants; migrate Battle side sheet only in Battle layout phase. |
| Tooltip | 0 formal implementation | Browser `title`, card popovers, tutorial overlay | Add `Tooltip` primitive later. Tooltips must be enhancement only; touch fallback required. |
| Popover | 3 implementations | `src/components/Card.tsx`, `src/components/CardBrowser.tsx`, `src/components/DeckEditor.tsx` | Merge into `Popover` + `CardDetailSurface` + `usePopoverPosition`. This is high value but needs careful visual QA. |
| Dropdown | 0 formal implementation | Nav mobile menu, filters, language select native select | Add `DropdownMenu` only when menus become non-native. Current selects can stay native. |
| Badge | 1 shared implementation plus page-specific metadata classes | Shared: `src/components/ui/Badge.tsx`. Used by Admin/I18n/Leaderboard/Feedback/MatchHistory | Keep. Future work: semantic tone names and custom color contrast policy. |
| Tag | 1 shared display implementation plus `TagButton` | Shared: `src/components/ui/Badge.tsx`. Migrated: Feedback active tag, tag list, detail tag, voter chips, clickable feedback tag filters, reaction chips | Keep shared `Tag`/`TagButton`. Custom swatch remains visual only until contrast policy exists. |
| Toast | 1 provider with custom CSS | `src/components/ToastProvider.tsx`, styles in `src/App.css` | Keep provider. Toast actions now use `Button`/`IconButton`. Later move item styling into a formal `Toast` component and add tone icons. |
| Avatar | Legacy inline implementation | AuthSection initial avatar | Add `Avatar` primitive if reused elsewhere. Current single use can remain documented. |
| Tabs | 1 shared `SegmentedControl` implementation; advanced roving focus still pending | `src/components/ui/SegmentedControl.tsx`. Migrated: Auth login/register, Admin tabs, I18n locale tabs, Feedback sort tabs, Deck filters/sort, Battle side sheet tabs | Keep `SegmentedControl` for simple tabs/filters. Add arrow-key roving focus in accessibility hardening. |
| Accordion | 0 formal implementation | Some mobile disclosures are ad hoc or absent | Add later for Online custom room / mobile filters only if needed in Phase 3. |
| Table | 1 shared wrapper plus page CSS | `DataListTable`, `DataListCell`; Admin/I18n/Leaderboard table usages | Keep. Expand into `DataList` with mobile card mode and column metadata to remove page-specific responsive table CSS. |
| Pagination | 0 formal implementation | Not present | Add only when API/page UX requires it. |
| Skeleton | 0 formal implementation | Loading is text/panel based | Add later if data-heavy pages need progressive loading. |
| Spinner | 0 formal implementation | Loading uses text states | Add `Spinner` only as part of `LoadingState` if needed. |
| Empty State | 1 shared implementation plus page-specific empty panels | Shared: `src/components/ui/State.tsx`. Migrated: Feedback list empty | Use `EmptyState` for new page/panel empty content; add compact density if needed. |
| Error State | 1 shared `Alert` plus some status panels | Shared: `src/components/ui/State.tsx`. Migrated: Feedback/Auth | Use `Alert tone="danger"` for inline errors; reserve `Dialog` for blocking errors. |
| Loading State | 1 shared implementation plus route/status loading panels | Shared: `src/components/ui/State.tsx`. Migrated: Feedback list/detail loading | Use `LoadingState` for page/panel loading; later add `Skeleton` for tables/cards. |
| Alert / Inline Status | 1 shared implementation plus legacy panels | Shared: `src/components/ui/State.tsx`. Legacy: Admin/I18n/Online/Feedback custom alert panels | Use `Alert` for all `role=alert/status` inline messages. |
| PageShell | 1 shared implementation plus legacy `.app-screen` CSS | `src/components/ui/PageShell.tsx`, legacy App.css screen classes | Keep. Page-level migration should happen in Phase 3/4. |
| PageHeader | 1 shared implementation plus page headers | `src/components/ui/PageHeader.tsx`, custom headers in Lobby/Feedback/Admin/I18n/Battle | Keep. Add action collapse/menu behavior before forcing all pages to migrate. |
| ResponsiveToolbar | 1 shared implementation plus page toolbars | `src/components/ui/ResponsiveToolbar.tsx`, Feedback uses it; Deck/Admin have custom toolbars | Keep. Deck/Admin toolbar consolidation belongs to Phase 3/4 because layout density changes are involved. |
| ActionBar | 1 shared implementation | `src/components/ui/ActionBar.tsx`; limited usage | Keep for sticky/bottom action groups; align with Dialog/Sheet footer actions. |

## Completed Replacements This Pass

| Area | Completed |
| --- | --- |
| Shared Dialog/Sheet | Close buttons now use `IconButton`. |
| AppDrawer | Close action now uses `IconButton`. |
| ToastProvider | Action button uses `Button`; close uses `IconButton`. |
| App/Nav/Lobby | Desktop/mobile nav and footer actions use `Button`; mobile menu/settings use `IconButton`; version trigger uses `Button`. |
| Lobby child controls | `DeckSelector` and `DifficultyButtons` command surfaces use `Button`. |
| FeedbackPage | Back button uses `BackButton`; sort tabs use `SegmentedControl`; loading/error/empty use `LoadingState`/`Alert`/`EmptyState`; detail close uses `IconButton`; official checkbox uses `Checkbox`; detail actions use `Button`; reaction add/picker uses `IconButton`. |
| Feedback tags/reactions | Passive tags/voter chips use `Tag`; clickable filters and reaction chips use `TagButton`. |
| AuthSection | Logout/entry/submit use `Button`; email/nickname/password use `Input`; errors use `Alert`; login/register tabs use `SegmentedControl`. |
| Admin/I18n | Main tabs and locale tabs use `SegmentedControl`; I18n missing-filter uses `Checkbox`. |
| DeckEditor | Filters/sort use `SegmentedControl`; search uses `SearchInput`; pagination/save/filter/deck actions use `Button`; remove/preview/clear use `IconButton`. |
| Tutorial/Battle safe actions | Tutorial tooltip actions use `Button`; Battle notice/gameover/mulligan/setup CTAs use `Button`; Battle side sheet tabs/close and side-panel icon toggles use `SegmentedControl`/`IconButton`. |

## Legacy Component Backlog

| Remaining Domain Area | Why Not Replaced Now | Recommended Component |
| --- | --- | --- |
| Battle card, slot, janken, and pending-choice raw buttons | They are game-domain interaction surfaces with tutorial selectors, selection state, and board layout coupling. Forcing generic `Button` would change interaction density and semantics. | `BattleChoiceButton`, `BattleSlotButton`, `BattleCardButton` in Phase 3 Battle layout pass |
| Feedback vote column and post card click surface | Vote column is a custom voting control; post card is currently a `role=button` card with nested controls and needs semantic cleanup as a unit. | `VoteButton`, `InteractiveCard` in Phase 5 accessibility pass |
| Admin/DeckEditor card tiles | Whole-card media tiles need card-selection behavior, image aspect ratio, hover/focus preview, and selected state; generic command `Button` is not enough. | `InteractiveCard` or `CardTileButton` |
| Feedback detail modal shell | Actions inside are migrated, but the shell is still page-specific to avoid changing scroll/focus behavior mid-phase. | `Dialog` detail surface in Phase 3 Feedback modal pass |
| AppDrawer / Online waiting overlay / Battle side sheet shells | They expose `role="dialog"` but are existing layout shells. Full migration needs focus trap/scroll lock and responsive layout decisions. | `Sheet`/`Dialog` hardening in Phase 3/5 |
| Card popovers | Three positioning implementations; needs shared geometry and visual QA | `Popover`, `CardDetailSurface` |
| Page-specific responsive table CSS | Needs DataList mobile card abstraction | `DataList` v2 |
