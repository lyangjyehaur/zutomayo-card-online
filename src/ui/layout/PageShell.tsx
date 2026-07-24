import type { HTMLAttributes } from 'react';
import { cn } from '../primitives/utils';

export type AmbientGlowColor = 'vermilion' | 'gold';
export type AmbientGlowSize = 'sm' | 'md' | 'lg';

export interface AmbientGlowProps extends HTMLAttributes<HTMLDivElement> {
  color?: AmbientGlowColor;
  size?: AmbientGlowSize;
}

const glowColorClass: Record<AmbientGlowColor, string> = {
  vermilion: 'bg-accent-action/8',
  gold: 'bg-accent-primary/8',
};

const glowSizeClass: Record<AmbientGlowSize, string> = {
  sm: 'h-[var(--ambient-glow-size-sm)] w-[var(--ambient-glow-size-sm)] blur-[var(--ambient-glow-blur-sm)]',
  md: 'h-[var(--ambient-glow-size-md)] w-[var(--ambient-glow-size-md)] blur-[var(--ambient-glow-blur-md)]',
  lg: 'h-[var(--ambient-glow-size-lg)] w-[var(--ambient-glow-size-lg)] blur-[var(--ambient-glow-blur-lg)]',
};

export function AmbientGlow({ color = 'vermilion', size = 'md', className, ...props }: AmbientGlowProps) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full',
        glowColorClass[color],
        glowSizeClass[size],
        className,
      )}
      aria-hidden="true"
      {...props}
    />
  );
}

export interface PageShellProps extends HTMLAttributes<HTMLDivElement> {
  glow?: boolean | AmbientGlowProps | AmbientGlowProps[];
  variant?: 'screen' | 'scroll' | 'workspace' | 'status';
}

function renderGlow(glow: PageShellProps['glow']) {
  if (!glow) return null;
  const content =
    glow === true ? (
      <AmbientGlow />
    ) : Array.isArray(glow) ? (
      glow.map((props, index) => <AmbientGlow key={index} {...props} />)
    ) : (
      <AmbientGlow {...glow} />
    );

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {content}
    </div>
  );
}

const shellVariantClass: Record<NonNullable<PageShellProps['variant']>, string> = {
  screen: 'h-dvh min-h-dvh overflow-hidden',
  scroll: 'h-full min-h-0 overflow-y-auto overflow-x-hidden',
  workspace: 'h-dvh min-h-dvh overflow-hidden',
  status: 'min-h-dvh overflow-y-auto overflow-x-hidden',
};

export function PageShell({ glow = false, variant = 'screen', className, children, ...props }: PageShellProps) {
  return (
    <main
      className={cn(
        'page-transition-enter relative w-full bg-surface-canvas font-sans text-content-primary',
        shellVariantClass[variant],
        className,
      )}
      data-page-shell={variant}
      {...props}
    >
      {renderGlow(glow)}
      {children}
    </main>
  );
}
