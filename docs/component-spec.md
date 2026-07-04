# Component Spec

Phase: Phase 2 Component Standardization  
Source of truth: shared components under `src/components/ui`.

## Global Rules

- Business pages must not hand-write command button, card, dialog, badge, alert, empty, loading, or form-control styling when a shared component exists.
- Icon-only controls must use `IconButton` and provide `label`.
- Interactive controls must keep a minimum touch target of 44px unless they are non-interactive decorative content.
- Component styling must use semantic tokens from `docs/design-system.md`; no raw hex, arbitrary shadow, arbitrary z-index, or page-only design tokens.
- Hover is enhancement only. Touch/click/focus must expose the same operation.
- Page-specific className is allowed only for layout positioning, width, grid/flex placement, or legacy migration shims.

## Button

用途: command actions, submit, cancel, destructive actions, navigation-like actions outside tab/nav groups.

Props:
- `variant`: `primary | secondary | danger | ghost`
- `size`: `sm | md | lg`
- `fullWidth?: boolean`
- `leftIcon?: ReactNode`
- `rightIcon?: ReactNode`

State:
- `hover`, `active`, `disabled`, `focus-visible`
- Loading state: use `aria-busy` and keep text stable. A dedicated `isLoading` prop may be added later.

Responsive:
- `sm` may be used in dense desktop panels, but mobile primary actions should remain at least 44px high.

禁止:
- Do not hand-write primary/secondary/danger button classes in pages.
- Do not use `Button` for tabs or segmented filters; use `Tabs`/`SegmentedControl` once available.

## IconButton

用途: close, menu, preview, copy, delete icon-only controls.

Props:
- `label: string` required
- `icon: ReactNode`
- `variant`: `secondary | ghost | danger`
- `size`: `sm | md`

State:
- Same focus/hover/disabled behavior as `Button`.

Responsive:
- Default `md` is 44px. Use `sm` only when grouped with visible text or inside dense desktop-only surfaces.

禁止:
- No icon-only raw `<button>`.
- No icon-only control without accessible label.

## Input / Textarea / Select

用途: visible text entry and native selection controls.

Props:
- Native input/select/textarea props.
- Use `FormField` for label + hint + error.

Variant:
- Default only for now.
- `SearchInput` for search fields with a leading icon and shared focus ring.
- Future: `toolbar`, `compact`.

State:
- `disabled`, `focus`, `invalid` via native attrs and FormField error.

Responsive:
- Mobile controls should be 44px minimum height when directly actionable.

禁止:
- Do not hand-write visible text input/select/textarea styling.
- Do not hand-write search-with-icon wrappers in pages; use `SearchInput`.

## Checkbox

用途: binary form setting.

Props:
- Native checkbox props.
- `label?: ReactNode`

State:
- `checked`, `disabled`, `focus-visible`.

Responsive:
- Label wrapper is 44px minimum height.

禁止:
- Do not hand-write checkbox label/input pairs in pages.

## Card

用途: generic repeated content surface, article/list cards, lightweight interactive card surface.

Props:
- `as?: ElementType`
- `size`: `md | lg`
- `interactive?: boolean`
- `selected?: boolean`

Variant:
- Default surface only.
- Future: `interactive`, `danger`, `compact`, `media`.

禁止:
- Do not use `ui/Card` for rendered game cards; game cards stay in `src/components/Card.tsx`.
- Do not create page-specific rounded/ring panel cards when `Card` or `Panel` is enough.

## Panel

用途: framed page/panel section, room panels, tool panels, status blocks when not alert-specific.

Props:
- `variant`: existing `PanelVariant`
- `size`: existing `PanelSize`

Future variants:
- `tone`: `default | info | success | warning | danger`
- `density`: `compact | default`

禁止:
- Do not hand-write panel shells with border/background/shadow in pages.
- Use `Alert` for error/status messages instead of one-off danger panels.

## Dialog

用途: blocking modal, confirm dialogs, detail modals.

Props:
- `open`
- `onOpenChange`
- `title`
- `description`
- `footer`
- `closeLabel`
- `dismissible`
- `size`: `sm | md | lg`
- `mobilePresentation`: `modal | sheet`

State:
- Escape and backdrop dismiss when `dismissible`.
- Focus trap/restore is required in the Phase 5 accessibility hardening pass.

Responsive:
- Default mobile presentation is bottom sheet.

禁止:
- No new page-level `role="dialog"` overlays.
- Existing Feedback/Battle legacy dialogs must migrate in dedicated passes.

## Sheet / Drawer

用途: non-blocking or mobile detail/filter/action panels.

Props:
- `open`
- `onOpenChange`
- `title`
- `description`
- `footer`
- `side`: `bottom | right`

Responsive:
- Bottom sheet for mobile details and filters.
- Right sheet for desktop side drawers.

禁止:
- Do not create new drawer CSS. Use `Sheet` or a semantic wrapper over `Sheet`.

## Badge

用途: compact metadata, status, rank, inline labels.

Props:
- `tone`: `neutral | gold | jade | vermilion`

Future:
- Rename tones to semantic aliases: `neutral | warning | success | danger | info`.
- Add `Tag` for user tags and optional swatches.

禁止:
- Do not use Badge for clickable filters. Use Button/SegmentedControl/TagButton.

## Tag

用途: user/admin-defined labels such as Feedback tags.

Props:
- `children: ReactNode`
- `swatch?: string`

禁止:
- Do not use arbitrary custom text color without contrast validation.
- Do not use display `Tag` as a button. Add `TagButton`/`InteractiveTag` for clickable filters.

## TagButton

用途: clickable tag filters and compact reaction chips where tag-like visual treatment is also an action.

Props:
- Native button props.
- `children: ReactNode`
- `swatch?: string`

State:
- `hover`, `active`, `disabled`, `focus-visible`
- `aria-pressed` for toggle/reaction state.

Responsive:
- Compact by default, but must remain reachable inside a parent touch target or be upgraded to 44px when used as a standalone mobile action.

禁止:
- Do not use `TagButton` for primary commands.
- Do not use arbitrary swatch colors for meaning without a contrast fallback.

## Alert

用途: inline status, error, warning, success, info.

Props:
- `tone`: `info | success | warning | danger`
- `title?: ReactNode`
- `role?: string`

State:
- Use `role="alert"` for errors that require immediate attention.
- Use `role="status"` for passive updates.

禁止:
- Do not create one-off `<p className="error">` or danger panels for new UI.

## Toast

用途: transient global notifications.

Current implementation:
- `ToastProvider` with `showToast`.

State:
- `info | success | warning | error`
- Optional action and close.

Responsive:
- Actions must remain touchable; close uses `IconButton`.

禁止:
- Do not add page-specific toast stacks.

## Tooltip

用途: optional explanatory hints for icon controls or dense metadata.

Status:
- Not implemented.

Rules:
- Must not be the only way to discover an action on touch devices.
- Should be focus-triggerable.

## Popover

用途: anchored non-modal content, especially card details.

Status:
- Legacy implementations exist in `Card`, `CardBrowser`, `DeckEditor`.

Future props:
- `anchorRect`
- `placement`
- `fallbackPlacement`
- `onDismiss`

禁止:
- Do not add a fourth popover positioning implementation.

## Tabs / SegmentedControl

用途: mutually exclusive views/filters/modes.

Props:
- `options: { value, label, disabled? }[]`
- `value`
- `onChange`
- `ariaLabel`
- `behavior`: `segmented | tabs`
- `size`: `sm | md`

Behavior:
- `role="tablist"` for tabs.
- `aria-selected` for tabs.
- `aria-pressed` for segmented filters.
- Mobile horizontal scroll or wrapping based on context.
- Roving focus with arrow keys is still required as an accessibility hardening follow-up.

禁止:
- Do not use generic `Button` as tabs once primitive exists.
- Do not create page-specific tab button loops for new UI.

## Accordion

用途: disclosure of secondary content on mobile.

Status:
- Not implemented.

Rules:
- Use native button for header.
- `aria-expanded` required.

## DataList / Table

用途: responsive tabular or record-list data.

Current:
- `DataListTable`
- `DataListCell`

Future:
- `DataList` with columns metadata and `mobile="table | cards"`.

禁止:
- Do not add new page-specific table-to-card CSS.

## Pagination

Status:
- Not implemented.

Rules:
- Add only when actual paginated data exists.
- Must include current page, total pages when known, previous/next labels.

## Skeleton / Spinner / LoadingState

Current:
- `LoadingState`

Future:
- `Spinner` can be added as an internal visual inside `LoadingState`.
- `Skeleton` only for card/table surfaces that benefit from preserving layout.

禁止:
- Do not add arbitrary animated loaders without reduced-motion support.

## EmptyState

用途: empty lists, no search results, empty panels.

Props:
- `title`
- `description`
- `actions`

Responsive:
- Use compact className or future density prop inside small panels.

## ErrorState

Current:
- Use `Alert tone="danger"` for inline errors.
- Use `Dialog` for blocking/recoverable app-level errors.
- Existing `ErrorBoundary` can remain as app-level special case.

禁止:
- Do not create new standalone error visual classes.

## Avatar

Status:
- Not implemented.

Current legacy:
- AuthSection initial avatar.

Future props:
- `name`
- `imageUrl?`
- `size`
- `tone`

## Dropdown

Status:
- Not implemented.

Rules:
- Prefer native `Select` for simple option lists.
- Add `DropdownMenu` only for command menus.

## Component Deletion Candidates

- Page-specific close button styles after `IconButton` migration: `modal-close`, Battle side sheet close, drawer close CSS.
- Feedback modal CSS after `Dialog` migration.
- Admin/I18n responsive table CSS after `DataList` v2.
- Duplicate card detail popover code after `Popover`/`CardDetailSurface`.
