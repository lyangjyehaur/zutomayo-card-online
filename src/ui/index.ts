/**
 * Design System v2 — 唯一入口。
 * 分層：tokens（CSS）/ primitives / forms / layout / feedback / game。
 * 頁面一律 `import { ... } from '../ui'`（或子路徑），
 * 禁止再從 src/components/ui（已移除）匯入。
 * 規範：docs/uiux/design-system.md、docs/uiux/how-to-add-new-feature.md
 */
export * from './primitives';
export * from './forms';
export * from './layout';
export * from './feedback';
export * from './game';
