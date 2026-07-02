# Responsive Visual QA

Date: 2026-07-02

Scope: 補充 `docs/responsive-audit.md` 的 screenshot-based QA。本輪只新增 QA 文件與截圖，不修改 UI 程式碼。

## Method

- Local dev server: `http://127.0.0.1:5173`
- Browser: local Google Chrome in headless mode through Chrome DevTools Protocol.
- Viewports:
  - `1366x768`
  - `1280x720`
  - `1024x768`
  - `768x1024`
  - `430x932`
  - `390x844`
  - `360x740`
- Routes captured:
  - `/`
  - `/online`
  - `/ai`
  - `/tutorial`
  - `/deck-builder`
  - `/history`
  - `/leaderboard`
  - `/feedback`
  - `/admin`
  - `/i18n`
  - `/play/ai`
  - `/play/online/visual-qa`

Artifacts:

- Raw metrics: `docs/responsive-visual-qa-data.json`
- Screenshots: `docs/responsive-visual-qa-screenshots/`
- Chrome stderr log, if present: `docs/responsive-visual-qa-chrome-stderr.log`

## Coverage Notes

- 84 screenshots were generated.
- `/admin` was only tested in the unauthenticated login state. Authenticated admin tables/forms still need a separate pass.
- `/tutorial` and `/play/ai` stayed in loading state during this QA, so the real `Board` game layout was not validated visually.
- `/play/online/visual-qa` stayed in reconnect state, so online game table layout was not validated visually.
- `/i18n` rendered the Not Found page at `/i18n`; verify whether the route still exists or has moved.
- Several horizontal overflow detections come from decorative absolute background elements. These still create scroll-width risk, but they are lower severity than visible text/control clipping.

## Automated Summary

Pages with horizontal overflow detected:

| Page | Viewports |
| --- | --- |
| `/deck-builder` | `1366x768`, `1280x720`, `1024x768`, `768x1024`, `430x932`, `390x844`, `360x740` |
| `/` | `768x1024`, `430x932`, `390x844`, `360x740` |
| `/online` | `768x1024`, `430x932`, `390x844`, `360x740` |
| `/ai` | `430x932`, `390x844`, `360x740` |
| `/play/online/visual-qa` | `430x932`, `390x844`, `360x740` |

Highest small text counts:

| Page | Max count |
| --- | ---: |
| `/deck-builder` | 65 |
| `/online` | 34 |
| `/` | 25 |
| `/ai` | 24 |
| `/feedback` | 14 |

Highest small tap target counts:

| Page | Max count |
| --- | ---: |
| `/deck-builder` | 25 |
| `/feedback` | 15 |
| `/history` | 10 |
| `/admin` | 9 |
| `/` | 8 |

## Visual Findings

### Global NavBar

Screenshots:

- `docs/responsive-visual-qa-screenshots/360x740__feedback.png`
- `docs/responsive-visual-qa-screenshots/360x740__history.png`
- `docs/responsive-visual-qa-screenshots/360x740__leaderboard.png`

Findings:

- Mobile nav renders five text links in one fixed row; labels wrap into two vertical-looking columns per item.
- The fixed nav overlaps the top of page content on pages such as `/history`, where the page title is partially hidden under the nav.
- This is visually broken even when DOM metrics do not report horizontal overflow.

Recommendation:

- Convert mobile nav to Drawer or bottom navigation with fewer primary items.
- Add top offset/safe spacing for pages under fixed nav.

### `/` Lobby

Screenshots:

- `docs/responsive-visual-qa-screenshots/360x740__lobby.png`
- `docs/responsive-visual-qa-screenshots/390x844__lobby.png`
- `docs/responsive-visual-qa-screenshots/768x1024__lobby.png`

Findings:

- On `360x740`, the `ZUTOMAYO CARD` header, language selector, and login action are too dense.
- Large card titles are clipped on the right edge; the third card title is also cut by the bottom viewport.
- The desktop-scale card typography does not fit small phone width.

Recommendation:

- Needs mobile-specific header composition and smaller card display type.
- Collapse account/language controls into a compact menu.
- Reduce card title scale and fixed card height under mobile.

### `/online`

Screenshots:

- `docs/responsive-visual-qa-screenshots/360x740__online.png`
- `docs/responsive-visual-qa-screenshots/390x844__online.png`
- `docs/responsive-visual-qa-screenshots/768x1024__online.png`

Findings:

- Header is too dense on phone. Back label wraps, centered title uses two lines, and player ID sits in the same row.
- Main quick-match panel is readable, but it consumes most of the first viewport.
- The detected overflow is mostly decorative background, but the visible header density is a real issue.

Recommendation:

- Keep mobile header to back icon + short title; move player identity into the content panel or Drawer.
- Collapse secondary rank/deck details below the primary matching action.

### `/ai`

Screenshots:

- `docs/responsive-visual-qa-screenshots/390x844__ai-lobby.png`
- `docs/responsive-visual-qa-screenshots/360x740__ai-lobby.png`

Findings:

- On phone, `與電腦對戰`, opponent deck selection, and difficulty controls visually collide.
- Difficulty labels sit too close to deck cards and read as overlapping content.
- The setup flow is too long and too dense for one continuous mobile page.

Recommendation:

- Mobile AI setup should become step-based or grouped into collapsible sections.
- Delay the side/secondary deck selection layout and simplify difficulty controls on phone.

### `/deck-builder`

Screenshots:

- `docs/responsive-visual-qa-screenshots/1024x768__deck-builder.png`
- `docs/responsive-visual-qa-screenshots/360x740__deck-builder.png`

Findings:

- Horizontal overflow was detected at every viewport, but the primary sample is a decorative `absolute -left-40` layer.
- At `1024x768`, the two-column editor is visually usable but tight; active deck consumes a large right column.
- At `360x740`, the search field and filter groups are cramped, many labels are small, and the active deck is pushed below the card pool.
- The automated pass detected the highest small text and small tap target counts on this page.

Recommendation:

- Treat decorative overflow as a quick cleanup item.
- Mobile editor still needs a real Browse/Active Deck mode split or active deck drawer.
- Filters should collapse into a Drawer/sheet on phone.

### `/feedback`

Screenshots:

- `docs/responsive-visual-qa-screenshots/360x740__feedback.png`
- `docs/responsive-visual-qa-screenshots/390x844__feedback.png`

Findings:

- Mobile toolbar is visibly broken: sort labels render as untranslated keys like `FEEDBACK.SORT.TRENDING`, and the tab group is overly dense.
- Combined with global nav, the first viewport has too much navigation/control chrome before content.
- Small tap target count is high, especially on phone.

Recommendation:

- Fix missing/overflowing sort labels.
- Convert sort/status/search/create controls into a compact mobile toolbar or filter sheet.
- Move detail/post creation into mobile sheet behavior.

### `/history`

Screenshots:

- `docs/responsive-visual-qa-screenshots/360x740__history.png`

Findings:

- No horizontal overflow was detected, but the fixed nav overlaps the page title.
- Stats cards stack correctly, but the first content block starts too high under the nav.

Recommendation:

- Fix global nav spacing before making page-specific changes.
- Pagination controls are acceptable but should keep 40px tap targets.

### `/leaderboard`

Screenshots:

- `docs/responsive-visual-qa-screenshots/360x740__leaderboard.png`

Findings:

- In loading state, the main page is not overflowing.
- Global nav remains too dense on phone.
- Table/list state with actual data still needs validation.

Recommendation:

- Add a mobile card-list variant before relying on table behavior.

### `/admin`

Screenshots:

- `docs/responsive-visual-qa-screenshots/360x740__admin.png`

Findings:

- Login form itself is usable on phone.
- Global nav remains visually broken.
- Authenticated admin content was not covered.

Recommendation:

- Run a second QA pass with admin authentication.
- Expect authenticated tables, filters, and edit modal to need mobile-specific layout or desktop-only fallback.

### `/tutorial` and Game Routes

Screenshots:

- `docs/responsive-visual-qa-screenshots/360x740__tutorial.png`
- `docs/responsive-visual-qa-screenshots/360x740__ai-game-direct.png`
- `docs/responsive-visual-qa-screenshots/360x740__online-game-direct.png`

Findings:

- These routes did not reach the actual board/tutorial state in this QA run.
- `/play/online/visual-qa` reconnect card is readable on phone, but detected decorative overflow persists.

Recommendation:

- Do not treat game layout as visually verified.
- Create a deterministic visual QA entry state or fixture for `Board`, then rerun all target viewports.

## Priority Fix Order From Visual QA

1. Global mobile NavBar: Drawer/bottom nav plus fixed-header spacing.
2. Mobile Lobby: header compression and card title scaling.
3. Feedback mobile toolbar: sort labels, compact controls, filter sheet.
4. AI lobby mobile setup: prevent section collision; use step/collapse behavior.
5. Deck builder: remove decorative overflow; introduce mobile active deck/filter sheet.
6. Online lobby header: simplify mobile header and move identity secondary.
7. Add authenticated admin visual QA.
8. Add deterministic Board/tutorial visual QA state.

## Delta Versus Static Audit

Confirmed:

- Mobile/global navigation is a concrete blocker, stronger than the static audit implied.
- Lobby, Online lobby, AI lobby, Deck builder, and Feedback are the first mobile fixes to prioritize.
- Deck builder has substantial small text/tap target density.

Adjusted:

- Some automated horizontal overflow is decorative absolute background rather than direct content overflow.
- Admin and game pages remain high risk, but this pass did not cover their real operational states.
