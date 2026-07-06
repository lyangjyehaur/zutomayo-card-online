import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../primitives/utils';

/**
 * AppHeader — 全站浮動頁首（與對戰頁 HUD 同一設計語言）。
 * 不是通欄 header：左右兩枚懸浮膠囊（brand/返回＋動作），下方內容全幅延伸。
 *
 * - 首頁：brand 模式（狀態點＋wordmark＋副標）
 * - 子頁：back 模式（返回鍵＋頁面標題）
 * - actions：語言切換、登入、選單按鈕等，由頁面注入
 */
export interface AppHeaderProps {
  /** 子頁標題；不傳＝首頁 brand 模式 */
  title?: string;
  /** brand 模式副標（僅桌面顯示） */
  subtitle?: string;
  /** 返回目的地（傳入即顯示返回鍵） */
  backTo?: string;
  actions?: ReactNode;
  className?: string;
}

export function AppHeader({ title, subtitle, backTo, actions, className }: AppHeaderProps) {
  const navigate = useNavigate();
  return (
    <header
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 z-[var(--z-header)] flex items-start justify-between gap-2 p-3 md:p-4',
        className,
      )}
    >
      <div className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-md border border-border-soft bg-surface-base/80 px-3 py-2 backdrop-blur-md">
        {backTo ? (
          <button
            type="button"
            className="flex min-h-8 min-w-8 items-center justify-center rounded-sm text-content-muted transition hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
            aria-label="back"
            onClick={() => navigate(backTo)}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </button>
        ) : (
          <span className="size-2 shrink-0 rounded-full bg-accent-primary shadow-status-dot" aria-hidden="true" />
        )}
        <span className="truncate font-display text-body-lg font-bold leading-none tracking-wide">
          {title ?? 'ZUTOMAYO CARD ONLINE'}
        </span>
        {subtitle && (
          <span className="ml-2 hidden truncate font-mono text-caption uppercase tracking-[var(--tracking-meta)] text-content-dim lg:inline">
            {subtitle}
          </span>
        )}
      </div>
      {actions && (
        <div className="pointer-events-auto flex shrink-0 items-center gap-2 rounded-md border border-border-soft bg-surface-base/80 px-2 py-1.5 backdrop-blur-md">
          {actions}
        </div>
      )}
    </header>
  );
}
