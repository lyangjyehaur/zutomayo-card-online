import type { ElementType, HTMLAttributes } from 'react';
import { cn } from './utils';

export type PanelSize = 'md' | 'lg' | 'xl';
export type PanelVariant = 'solid' | 'ghost';

const sizeClass: Record<PanelSize, string> = {
  md: 'p-4',
  lg: 'p-5',
  xl: 'p-6',
};

const variantClass: Record<PanelVariant, string> = {
  solid: 'bg-surface-panel',
  ghost: 'bg-surface-panel/60',
};

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  as?: ElementType;
  size?: PanelSize;
  variant?: PanelVariant;
}

export function Panel({ as: Component = 'div', size = 'md', variant = 'solid', className, ...props }: PanelProps) {
  return (
    <Component
      data-ui-panel
      className={cn('rounded-sm ring-1 ring-border-soft', variantClass[variant], sizeClass[size], className)}
      {...props}
    />
  );
}
