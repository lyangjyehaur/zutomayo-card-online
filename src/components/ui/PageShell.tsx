import type { HTMLAttributes } from 'react';
import { cn } from './utils';

export type AmbientGlowColor = 'vermilion' | 'gold';
export type AmbientGlowSize = 'sm' | 'md' | 'lg';

export interface AmbientGlowProps extends HTMLAttributes<HTMLDivElement> {
  color?: AmbientGlowColor;
  size?: AmbientGlowSize;
}

const glowColorClass: Record<AmbientGlowColor, string> = {
  vermilion: 'bg-vermilion/8',
  gold: 'bg-gold/8',
};

const glowSizeClass: Record<AmbientGlowSize, string> = {
  sm: 'h-[50vh] w-[50vh] blur-[120px]',
  md: 'h-[60vh] w-[60vh] blur-[140px]',
  lg: 'h-[80vh] w-[80vh] blur-[160px]',
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
}

function renderGlow(glow: PageShellProps['glow']) {
  if (!glow) return null;
  if (glow === true) return <AmbientGlow />;
  if (Array.isArray(glow)) {
    return glow.map((props, index) => <AmbientGlow key={index} {...props} />);
  }
  return <AmbientGlow {...glow} />;
}

export function PageShell({ glow = false, className, children, ...props }: PageShellProps) {
  return (
    <main
      className={cn('relative h-screen w-screen overflow-hidden bg-lacquer-deep font-sans text-bone', className)}
      {...props}
    >
      {renderGlow(glow)}
      {children}
    </main>
  );
}
