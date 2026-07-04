# Design System

狀態：Phase 1 foundation  
來源：`src/App.css` 的 `:root` token 與 `@theme inline` 是唯一 Design Token 來源。

## Design Principle

- 以 token 表達語意，不以視覺值命名。使用 `surface.panel`、`content.muted`、`accent.primary`，不要使用 `dark-blue`、`small-shadow` 這類外觀描述。
- 新 UI 必須先查現有 token；缺 token 時補到 `src/App.css` 和本文件，不在頁面中臨時寫 magic value。
- 舊 token 保留為 deprecated alias，只為避免一次性視覺回歸。新增 UI 不使用 `--bg-*`、`--panel`、`--line`、`--muted`、`--danger` 等舊名。
- Mobile/touch 優先保證可用性：互動目標最小 `44px`，hover 只能是增強，不是唯一入口。
- Motion 必須可預測、可降級；大型動畫需支援 `prefers-reduced-motion`。

## Color System

Primitive color 只允許在 `:root` 定義：

| Token | 用途 |
| --- | --- |
| `--ds-lacquer-950` | 全站最深背景 |
| `--ds-lacquer-900` | 基礎表面 |
| `--ds-lacquer-850` | 提升表面 |
| `--ds-bone-50` | 主文字 |
| `--ds-gold-400` | 主要強調 |
| `--ds-gold-500` | 次級金色 |
| `--ds-vermilion-500` | 行動/警示強調 |
| `--ds-danger-500` | 錯誤/破壞性 |
| `--ds-jade-400` | 成功 |
| `--ds-teal-400` | 資訊/治療 |
| `--ds-element-*` | 卡牌元素色 |

Semantic color 是 UI 唯一應使用的色彩入口：

| Token | Tailwind | 用途 |
| --- | --- | --- |
| `--surface-canvas` | `bg-surface-canvas` | app/background canvas |
| `--surface-base` | `bg-surface-base` | page base surface |
| `--surface-panel` | `bg-surface-panel` | card/panel |
| `--surface-panel-strong` | `bg-surface-panel-strong` | modal/dialog |
| `--surface-overlay` | `bg-surface-overlay` | overlay backdrop |
| `--content-primary` | `text-content-primary` | main text |
| `--content-muted` | `text-content-muted` | secondary text |
| `--content-dim` | `text-content-dim` | helper/disabled text |
| `--content-inverse` | `text-content-inverse` | text on light/action fill |
| `--accent-primary` | `text-accent-primary` | primary accent |
| `--accent-primary-soft` | `text-accent-primary-soft` | subdued accent |
| `--accent-danger` | `text-accent-danger` | error/destructive |
| `--accent-success` | `text-accent-success` | success/positive |
| `--accent-info` | `text-accent-info` | info/heal |
| `--border-default` | `border-border-default` | normal border |
| `--border-soft` | `border-border-soft` | subtle divider |
| `--border-strong` | `border-border-strong` | selected/focused border |
| `--battle-field-*` | CSS/Canvas token | Battle canvas field gradient and glow |
| `--pattern-dot`, `--pattern-dot-size` | arbitrary property token | subtle dotted decorative texture |

## Typography

| Token | Tailwind | 用途 |
| --- | --- | --- |
| `--type-micro` | `text-micro` | ultra-compact Battle counters only |
| `--type-minutia` | `text-minutia` | compact table/card metadata |
| `--type-caption` | `text-caption` | metadata, badges |
| `--type-control` | `text-control` | buttons, compact controls |
| `--type-body-sm` | `text-body-sm` | helper text |
| `--type-body` | `text-body` | default body text |
| `--type-body-lg` | `text-body-lg` | emphasized body |
| `--type-title-sm` | `text-title-sm` | panel title |
| `--type-title-md` | `text-title-md` | page section title |
| `--type-title-lg` | `text-title-lg` | page title |
| `--type-lobby-card-title` | `text-lobby-card-title` | Landing entry card title |
| `--type-battle-result-title` | `text-battle-result-title` | Battle result display text |
| `--type-battle-result-title-lg` | `text-battle-result-title-lg` | Battle result display text on desktop |

Tracking tokens:

| Token | 用途 |
| --- | --- |
| `--tracking-tight` | body/default text |
| `--tracking-fine` | numeric emphasis, small deltas |
| `--tracking-compact` | compact metadata in constrained panels |
| `--tracking-control` | buttons and tabs |
| `--tracking-meta` | small Battle/status labels |
| `--tracking-label` | nav labels and compact current-page markers |
| `--tracking-kicker` | uppercase kicker/metadata |
| `--tracking-hero` | rare hero/result kicker text |

## Spacing

Spacing scale is `--space-0`, `--space-1`, `--space-2`, `--space-3`, `--space-4`, `--space-5`, `--space-6`, `--space-8`, `--space-10`, `--space-12`.

Semantic spacing:

| Token | Tailwind | 用途 |
| --- | --- | --- |
| `--size-touch-min` | `min-h-touch`, `size-touch` | touch target minimum, 44px |
| `--control-height-sm` | `min-h-control-sm` | compact desktop control |
| `--control-height-md` | `min-h-control-md` | default control |
| `--control-height-lg` | `min-h-control-lg` | prominent action |
| `--space-page-x` | `px-page-x` | page horizontal padding |
| `--space-page-y` | `py-page-y` | page vertical padding |
| `--space-panel` | `p-panel` | panel/card padding |
| `--space-section` | `gap-section` | page section gap |
| `--space-toolbar` | `gap-toolbar` | toolbar gap |

Component sizing tokens:

| Token | 用途 |
| --- | --- |
| `--ambient-glow-size-sm/md/lg` | `PageShell` decorative glow size |
| `--ambient-glow-blur-sm/md/lg` | `PageShell` decorative glow blur |

## Radius

| Token | Tailwind | 用途 |
| --- | --- | --- |
| `--radius-xs` | `rounded-xs` | dense badges, tiny slots |
| `--radius-sm` | `rounded-sm` | cards and controls default |
| `--radius-control` | deprecated alias `--radius` | legacy control radius |
| `--radius-md` | `rounded-md` | dialog/sheet |
| `--radius-lg` | `rounded-lg` | large surfaces only |
| `--radius-xl` | `rounded-xl` | reserved, avoid page cards |
| `--radius-pill` | `rounded-pill` | circular/pill controls |

## Shadow

| Token | Tailwind | 用途 |
| --- | --- | --- |
| `--shadow-raised` | `shadow-raised` | default raised panel |
| `--shadow-floating` | `shadow-floating` | hover/elevated card |
| `--shadow-popover` | `shadow-popover` | popover/tooltip |
| `--shadow-sheet` | `shadow-sheet` | sheet/dialog |
| `--shadow-focus` | `shadow-focus` | focus ring shadow |
| `--shadow-selected` | `shadow-selected` | selected card/item |
| `--shadow-glow-primary` | `shadow-glow-primary` | gold hover glow |
| `--shadow-glow-action` | `shadow-glow-action` | action/accent hover glow |
| `--shadow-status-dot` | `shadow-status-dot` | tiny status indicator glow |
| `--shadow-inset-slot` | `shadow-inset-slot` | Battle slots and inset controls |
| `--shadow-card-thumbnail` | `shadow-card-thumbnail` | tiny card thumbnail elevation |
| `--shadow-instruction` | `shadow-instruction` | Battle instruction banner |

## Motion

| Token | 用途 |
| --- | --- |
| `--motion-duration-fast` | small feedback, 120ms |
| `--motion-duration-base` | common hover/focus, 160ms |
| `--motion-duration-slow` | sheet/content transitions, 300ms |
| `--motion-duration-page` | page/hero transitions, 500ms |
| `--motion-ease-standard` | ordinary transitions |
| `--motion-ease-out` | enter transitions |
| `--motion-ease-emphasized` | selected/drag/important motion |

## Breakpoint

| Token | Value | 用途 |
| --- | ---: | --- |
| `--breakpoint-phone` | `360px` | narrow mobile baseline |
| `--breakpoint-phone-lg` | `430px` | large phone |
| `--breakpoint-tablet` | `768px` | tablet portrait |
| `--breakpoint-touch` | `820px` | touch-first layout cutoff |
| `--breakpoint-desktop-sidebar` | `1180px` | desktop side panel/sidebar |
| `--breakpoint-low-height` | `780px` | low-height desktop compact mode |

## Naming Convention

- Primitive: `--ds-{family}-{step}`，例如 `--ds-lacquer-950`。
- Semantic color: `--surface-*`, `--content-*`, `--accent-*`, `--border-*`。
- Component sizing: `--control-*`, `--space-*`, `--size-*`。
- Elevation: `--shadow-*`。
- Layer: `--z-*`。
- Motion: `--motion-duration-*`, `--motion-ease-*`。
- Deprecated aliases may remain for migration, but new code must use semantic names.

## 禁止事項

- 禁止新增 `bg-[#...]`、`text-[#...]`、`from-[#...]`、`to-[#...]`。
- 禁止新增 `rounded-[...]`、`shadow-[...]`、`z-[100]` 這類裸 magic value；如確實需要，先補 token。
- 禁止在 TSX usage 使用 deprecated color aliases：`bone/gold/vermilion/jade/teal/lacquer`。改用 `content-*`, `accent-*`, `surface-*`。
- 禁止新增 `text-[10px]`、`tracking-[0.3em]` 這類任意 typography；使用 `text-caption` 與 tracking token。
- 禁止在頁面組件直接定義新的色票、陰影、z-index scale。
- 禁止將 hover 作為手機唯一互動入口。
- 禁止新增低於 `44px` 的可點擊主要操作。
- 禁止新增無 `aria-label` 的 icon-only button。
