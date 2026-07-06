# Design Token Migration

掃描日期：2026-07-04  
掃描範圍：`src/**/*.css`, `src/**/*.tsx`, `src/**/*.ts`，排除測試檔。  
目標：記錄 Phase 1 後仍需逐步遷移到 `docs/design-system.md` token 的 magic values。

## Phase 1 Closure Snapshot

本次 Phase 1 usage migration 已完成下列範圍：

- `src/components`, `src/pages`, `src/App.tsx` 的 TSX usage 不再出現裸 `text-[8px/9px/10px...]`、`tracking-[0.xem]`、`shadow-[...]`、裸 `z-10/z-30/z-50`、hex/rgba 顏色。
- 舊 Tailwind alias（`bone/gold/vermilion/jade/teal/lacquer`）已在 TSX usage 遷移到 semantic token classes（`content-*`, `accent-*`, `surface-*`, `border-*`）。
- Shared primitives、Lobby/Auth、Deck/Browser、Feedback/Admin/I18n、Online/AI lobby、Battle low-risk visual usage 已完成 token 化。
- Battle canvas palette 已改為 `--battle-field-*` token，未改動 board layout、turn state、move handling。
- `src/components/I18nManager.css` 與 `src/components/AdminPanel.css` 已改用 semantic CSS variables。

Phase 1 邊界：

- `src/App.css` 仍保留 legacy page/game CSS 中的 raw rgba/hex/shadow。這些區段包含舊 Battle/Chronos/Card/Feedback/online-resume 等大面積選擇器，直接清除會變成 Phase 3 page/layout refactor。Phase 1 已建立 semantic token 與 deprecated alias，後續頁面重構時必須逐段移除 legacy raw values。
- 新增或修改 TSX UI 不允許回到 legacy alias 或 raw values；如缺 token，先補 `src/App.css` 與 `docs/design-system.md`。

## Baseline

下表是 Phase 1 實作前的初始掃描，用於估算既有 UI debt。Phase 1 新增 token 後再次掃描，raw color count 會變成 783，原因是 `:root` token 定義本身也被掃描器計入；這不代表新增了頁面層 magic value。

| 類型                   | 偵測數 | 說明                                                                           |
| ---------------------- | -----: | ------------------------------------------------------------------------------ |
| Color                  |    777 | 包含 `rgba()`, `oklch()`, `color-mix()`, hex；其中 token 定義本身也被計入。    |
| Spacing/size arbitrary |     56 | 主要是 Battle fixed card/zone size、decorative blur layer、layout grid width。 |
| Radius                 |    174 | 多數已使用 `var(--radius)`；仍需把 legacy alias 遷到 semantic radius。         |
| Shadow                 |     94 | `App.css` 舊陰影和 `shadow-[...]` scattered usage。                            |
| Typography             |    678 | `text-[10px]`, `text-[9px]`, `tracking-[0.3em]` 是最大宗。                     |
| Z-index                |     94 | `z-30`, `z-40`, `z-[100]`, `z-index: 90` 混用。                                |
| Motion                 |     97 | duration/easing/animation value 分散。                                         |

## Migration Map

| 類型       | 原值                                                                    | 建議 Token                                                        | 出現位置                                                                                                 |
| ---------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Color      | `oklch(0.16 0.005 270)`                                                 | `--surface-base` / `bg-surface-base`                              | `src/App.css:42`, legacy aliases, panel surfaces                                                         |
| Color      | `oklch(0.11 0.005 270)`                                                 | `--surface-canvas` / `bg-surface-canvas`                          | `src/App.css:43`, app/body background                                                                    |
| Color      | `oklch(0.965 0.012 90)`                                                 | `--content-primary` / `text-content-primary`                      | `src/App.css:44`, body text aliases                                                                      |
| Color      | `oklch(0.74 0.09 80)`                                                   | `--accent-primary` / `text-accent-primary`                        | `src/App.css:45`, gold text/ring/border                                                                  |
| Color      | `oklch(0.62 0.07 80)`                                                   | `--accent-primary-soft`                                           | `src/App.css:46`, subdued gold                                                                           |
| Color      | `oklch(0.6 0.19 295)`                                                   | `--accent-action`                                                 | `src/App.css:47`, vermilion action/accent                                                                |
| Color      | `oklch(0.58 0.19 25)`                                                   | `--accent-danger`                                                 | `src/App.css:68`, danger/error                                                                           |
| Color      | `rgba(245, 211, 104, *)`                                                | `oklch(from var(--accent-primary) l c h / *)` 或 `--border-*`     | `src/App.css:213`, `:236`, `:270`, `:296`, many legacy selectors                                         |
| Color      | `rgba(255, 255, 255, *)`                                                | `oklch(from var(--content-primary) l c h / *)` 或 `--border-soft` | `src/App.css:257`, `:505`, `:655`, overlays and dividers                                                 |
| Color      | `rgba(5, 7, 18, *)`, `rgba(6, 9, 23, *)`, `#050712`                     | `--surface-canvas` / `--surface-overlay`                          | `src/App.css:214`, `:313`, `:1140`, page backgrounds                                                     |
| Color      | `#130d21`, `#120d20`                                                    | `--content-inverse`                                               | `src/App.css:272`, `:1772`, `:1930`, action text on light fills                                          |
| Color      | `#ffd7df`, `rgba(255, 92, 122, *)`                                      | `--accent-danger` with alpha                                      | `src/App.css:283`, `:864`, `:910`, error/danger UI                                                       |
| Color      | `#7771a8`, `#aaa4e8`                                                    | `--element-dark`                                                  | `src/App.css:1979`, `src/components/lobby/DeckSelector.tsx:6`                                            |
| Color      | `#ff6a6f`, `#ff8a8e`, `#e2624a`, `#7a2a1c`                              | `--element-flame` plus controlled gradient tokens                 | `src/App.css:1983`, `src/components/lobby/DeckSelector.tsx:7`                                            |
| Color      | `#f5d368`, `#d8c44a`, `#7a6818`                                         | `--element-electric` / `--accent-primary`                         | `src/App.css:1987`, `src/components/lobby/DeckSelector.tsx:8`                                            |
| Color      | `#42d7c6`, `#5fb58a`, `#2a5e44`                                         | `--element-wind` / `--accent-info`                                | `src/App.css:1991`, `src/components/lobby/DeckSelector.tsx:9`                                            |
| Color      | `#c889ff`, `#d8a5ff`                                                    | `--element-chaos`                                                 | `src/App.css:1995`, element styles                                                                       |
| Color      | SVG `stopColor="#242839"`, `#111827`, `#07090f`                         | SVG should use CSS vars from `--surface-*`                        | `src/components/Chronos.tsx:60-62`                                                                       |
| Color      | Canvas `rgba(38, 29, 54, 0.20)` and related field colors                | Board canvas palette tokens, e.g. `--battle-field-*`              | `src/components/Board.tsx:411-421`                                                                       |
| Spacing    | `min-w-[240px]`, `max-w-[340px]`, `max-w-[220px]`                       | `--popover-width-*` or component sizing token                     | `src/components/Board.tsx:502`, `:513`                                                                   |
| Spacing    | `h-[60vh] w-[120vh]`, `h-[90vh] w-[90vh]`                               | decorative aura size tokens                                       | `src/components/Board.tsx:756`, `:822`, `:972`, `:2368`                                                  |
| Spacing    | `size-[88px]`, `h-[80px] w-[56px]`                                      | battle slot/card size tokens                                      | `src/components/Board.tsx:1084`, `:1091`, `:1101`                                                        |
| Spacing    | `grid-cols-[minmax(0,1fr)_280px]`, `lg:grid-cols-[340px_minmax(0,1fr)]` | layout shell/sidebar width token                                  | `src/components/Board.tsx:2420`, `src/pages/OnlineLobbyPage.tsx:352`                                     |
| Spacing    | `max-h-[calc(100dvh-1.5rem)]`, `max-h-[calc(100dvh-2rem)]`              | sheet/dialog viewport inset token                                 | migrated in shared `Sheet`/`Dialog`; still appears in `src/pages/LobbyPage.tsx:259`                      |
| Radius     | `var(--radius)` legacy alias                                            | `--radius-control`, `--radius-sm`, `--radius-md` by component     | `src/App.css` broad legacy CSS                                                                           |
| Radius     | `calc(var(--radius) - 0.2rem)`                                          | `--radius-xs`                                                     | `src/App.css:511`                                                                                        |
| Shadow     | `0 1rem 3rem rgba(0, 0, 0, 0.38)`                                       | `--shadow-raised`                                                 | `src/App.css` token alias and legacy panels                                                              |
| Shadow     | `0 8px 32px -8px rgba(0, 0, 0, 0.4)`                                    | `--shadow-floating`                                               | migrated in shared `Card`; legacy App/Auth usages remain.                                                |
| Shadow     | `0 32px 96px -32px rgba(0,0,0,0.95)`                                    | `--shadow-sheet`                                                  | migrated in shared `Sheet`/`Dialog`; still appears in tutorial/Auth variants                             |
| Shadow     | `0 20px 40px -10px` selected card shadow                                | `--shadow-selected`                                               | `src/components/Board.tsx:836`, `:2707`                                                                  |
| Shadow     | `inset_0_2px_6px_rgba(0,0,0,0.5)`                                       | battle inset shadow token                                         | `src/components/Board.tsx:1084`, `:1157`                                                                 |
| Typography | `text-[10px]`                                                           | `text-caption` or `text-control` depending role                   | migrated in shared `Button`/`Input`; remains in `src/App.tsx`, `src/pages/*`, `src/components/Board.tsx` |
| Typography | `text-[9px]`, `text-[8px]`                                              | `text-caption`; avoid for decision-critical text                  | `src/components/Board.tsx:325`, `:503`, `src/pages/LeaderboardPage.tsx:122`                              |
| Typography | `text-[11px]`, `text-[13px]`                                            | `text-control` / `text-body-sm`                                   | migrated in shared `Button`; remains in `src/components/GameTutorialOverlay.tsx:317`                     |
| Typography | `tracking-[0.3em]`                                                      | `tracking-[var(--tracking-kicker)]` or component class            | Most headers/kickers across pages                                                                        |
| Typography | `tracking-[0.18em]`, `tracking-[0.24em]`                                | `tracking-[var(--tracking-control)]`                              | Toolbar/control labels in `LobbyPage`, `DeckEditor`, `App.tsx`                                           |
| Z-index    | `z-[100]`                                                               | `z-[var(--z-modal)]`                                              | migrated in shared `Sheet`; shared `Dialog`, `PageHeader`, `ActionBar` now use layer tokens.             |
| Z-index    | `z-[1000]`                                                              | `z-[var(--z-tour)]`                                               | `src/components/GameTutorialOverlay.tsx:248`                                                             |
| Z-index    | `z-20`, `z-30`, `z-40`, `z-50`                                          | `--z-sticky`, `--z-header`, `--z-overlay`, component layer token  | `src/pages/LobbyPage.tsx`, `src/components/Board.tsx`, `src/App.css`                                     |
| Z-index    | `z-index: 60`, `80`, `90`                                               | `--z-overlay`, `--z-modal`, `--z-toast` by role                   | `src/App.css:872`, `:946`, `:1023`, `:3788`                                                              |
| Motion     | `160ms ease`                                                            | `--motion-duration-base` + `--motion-ease-standard`               | `src/App.css:228`, `:260`, global controls                                                               |
| Motion     | `180ms ease-out`                                                        | `--motion-duration-base` + `--motion-ease-out`                    | `src/App.css:966`, drawer                                                                                |
| Motion     | `duration-300`, `duration-500`                                          | Tailwind duration should map to motion token or component variant | `src/pages/LobbyPage.tsx`, `src/components/lobby/AuthSection.tsx`                                        |
| Motion     | `3.8s ease-in-out infinite`, `2.6s ease-in-out infinite`                | named animation token and reduced-motion rule                     | `src/App.css:363`, `:1633`, `:3339`                                                                      |

## Added Phase 1 Tokens

| 類型         | Token                                                                                                                                            | 用途                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Typography   | `--type-micro`, `--type-minutia`                                                                                                                 | Battle/meta ultra-compact labels，替代 `text-[8px]`, `text-[9px]`。 |
| Typography   | `--type-lobby-card-title`                                                                                                                        | Landing entry card title responsive size。                          |
| Typography   | `--type-battle-result-title`, `--type-battle-result-title-lg`                                                                                    | Battle result page display size。                                   |
| Tracking     | `--tracking-fine`, `--tracking-compact`, `--tracking-meta`, `--tracking-label`, `--tracking-hero`                                                | 替代散落 `tracking-[0.1em]` 到 `tracking-[0.6em]`。                 |
| Shadow       | `--shadow-glow-primary`, `--shadow-glow-action`, `--shadow-status-dot`, `--shadow-inset-slot`, `--shadow-card-thumbnail`, `--shadow-instruction` | 替代 arbitrary shadow 與 Battle/Auth/Lobby 常見 elevation。         |
| Pattern      | `--pattern-dot`, `--pattern-dot-size`                                                                                                            | 替代 Landing/Battle 點陣背景 raw radial-gradient。                  |
| Battle color | `--battle-field-start`, `--battle-field-mid`, `--battle-field-end`, `--battle-field-glow`, `--battle-field-glow-transparent`                     | Battle canvas field palette。                                       |

## Priority Order

| Priority | Area                               | Reason                                                                                               |
| -------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| P1       | Shared UI primitives               | Prevents new debt: `Button`, `Input`, `Panel`, `Card`, `Dialog`, `Sheet`, `ActionBar`, `PageHeader`. |
| P1       | Layer/shadow tokens                | High risk for modal/sheet/toast overlap and inconsistent elevation.                                  |
| P1       | Typography kicker/control tokens   | Largest repeated pattern; reduces mobile readability issues.                                         |
| P2       | Battle board hardcoded size/shadow | Core page, but should be migrated with QA fixtures because it is layout-sensitive.                   |
| P2       | Element color gradients            | Repeated in CSS and Deck selector; should become controlled element swatches.                        |
| P3       | Decorative aura/blur sizes         | Mostly visual; migrate after core controls.                                                          |
| P3       | Legacy `App.css` page sections     | Large surface area; migrate opportunistically with page refactors.                                   |

## Completion Status

| 項目                      | 狀態                                                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Token foundation          | Complete: semantic color/type/spacing/radius/shadow/motion/layer/breakpoint tokens added.                                                                                                                                                  |
| Deprecated alias mapping  | Complete: old public variables now map to new semantic tokens.                                                                                                                                                                             |
| Tailwind theme mapping    | Complete for new semantic names.                                                                                                                                                                                                           |
| Component migration       | Complete: `Button`, `Input`, `Panel`, `Card`, `Sheet`, `Dialog`, `PageHeader`, `ActionBar`, `Badge`, `PageShell`, `LanguageSwitcher`, `CardBrowser`, `DeckSelector`, `AuthSection`, Admin/I18n responsive CSS migrated to semantic tokens. |
| TSX usage migration       | Complete for P1 scan target: no remaining raw hex/rgba, arbitrary typography/tracking/shadow, or bare numeric z-index in `src/components`, `src/pages`, `src/App.tsx` excluding tests.                                                     |
| Full CSS legacy migration | Deferred by design: raw values remain inside legacy `src/App.css` page/game selectors and should be removed only with Phase 3/4 page-specific refactors.                                                                                   |
