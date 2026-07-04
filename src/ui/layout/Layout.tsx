import type { HTMLAttributes, ReactNode } from 'react';
import { PageHeader, type PageHeaderProps } from './PageHeader';
import { PageShell, type PageShellProps } from './PageShell';
import { Panel, type PanelProps } from '../primitives/Panel';
import { ResponsiveToolbar, type ResponsiveToolbarProps } from '../primitives/ResponsiveToolbar';
import { cn } from '../primitives/utils';

type LayoutGap = 'compact' | 'regular' | 'spacious';
type ScrollMaxWidth = 'sm' | 'md' | 'lg' | 'xl' | 'full';
type WorkspaceSidebarWidth = 'sm' | 'md' | 'lg' | 'deck';

const gapClass: Record<LayoutGap, string> = {
  compact: 'gap-3',
  regular: 'gap-4',
  spacious: 'gap-5 md:gap-6',
};

const scrollMaxWidthClass: Record<ScrollMaxWidth, string> = {
  sm: 'max-w-3xl',
  md: 'max-w-5xl',
  lg: 'max-w-6xl',
  xl: 'max-w-7xl',
  full: 'max-w-none',
};

const workspaceLeftGridClass: Record<WorkspaceSidebarWidth, string> = {
  sm: 'lg:grid-cols-[280px_minmax(0,1fr)]',
  md: 'lg:grid-cols-[340px_minmax(0,1fr)]',
  lg: 'lg:grid-cols-[24rem_minmax(0,1fr)]',
  deck: 'xl:grid-cols-[320px_minmax(0,1fr)]',
};

const workspaceRightGridClass: Record<WorkspaceSidebarWidth, string> = {
  sm: 'lg:grid-cols-[minmax(0,1fr)_280px]',
  md: 'lg:grid-cols-[minmax(0,1fr)_340px]',
  lg: 'lg:grid-cols-[minmax(0,1fr)_24rem]',
  deck: 'xl:grid-cols-[minmax(0,1fr)_320px]',
};

export interface ScrollPageLayoutProps extends Omit<PageShellProps, 'variant'> {
  containerClassName?: string;
  gap?: LayoutGap;
  maxWidth?: ScrollMaxWidth;
}

export function ScrollPageLayout({
  children,
  className,
  containerClassName,
  gap = 'regular',
  maxWidth = 'md',
  ...props
}: ScrollPageLayoutProps) {
  return (
    <PageShell variant="scroll" className={cn('px-4 py-4 md:px-6', className)} {...props}>
      <div className={cn('mx-auto flex w-full flex-col', scrollMaxWidthClass[maxWidth], gapClass[gap], containerClassName)}>
        {children}
      </div>
    </PageShell>
  );
}

export interface PageSectionHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  actions?: ReactNode;
  kicker?: ReactNode;
  leading?: ReactNode;
  subtitle?: ReactNode;
  title: ReactNode;
  variant?: 'stack' | 'centered';
}

export function PageSectionHeader({
  actions,
  className,
  kicker,
  leading,
  subtitle,
  title,
  variant = 'stack',
  ...props
}: PageSectionHeaderProps) {
  if (variant === 'centered') {
    return (
      <header
        className={cn('flex flex-col gap-3 border-b border-border-soft pb-4 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center', className)}
        {...props}
      >
        <div>{leading}</div>
        <div className="min-w-0 text-center">
          {kicker && <span className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary/70">{kicker}</span>}
          <h1 className="truncate font-display text-2xl italic text-accent-primary sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-body-sm text-content-dim">{subtitle}</p>}
        </div>
        <div className="flex min-w-0 items-center justify-end gap-2">{actions}</div>
      </header>
    );
  }

  return (
    <header
      className={cn('flex flex-col gap-3 border-b border-border-soft pb-4 sm:flex-row sm:items-center sm:justify-between', className)}
      {...props}
    >
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="min-w-0 flex-1">
        {kicker && <span className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary/70">{kicker}</span>}
        <h1 className="font-display text-2xl italic text-accent-primary sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-body-sm text-content-dim">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export interface WorkspaceLayoutProps extends Omit<PageShellProps, 'variant'> {
  contentClassName?: string;
  header?: ReactNode;
  mainClassName?: string;
  sidebar?: ReactNode;
  sidebarClassName?: string;
  sidebarSide?: 'left' | 'right';
  sidebarWidth?: WorkspaceSidebarWidth;
}

export function WorkspaceLayout({
  children,
  className,
  contentClassName,
  header,
  mainClassName,
  sidebar,
  sidebarClassName,
  sidebarSide = 'left',
  sidebarWidth = 'md',
  ...props
}: WorkspaceLayoutProps) {
  const hasSidebar = Boolean(sidebar);
  const main = <div className={cn('min-h-0', mainClassName)}>{children}</div>;
  const side = sidebar ? <aside className={cn('min-h-0', sidebarClassName)}>{sidebar}</aside> : null;

  return (
    <PageShell variant="workspace" className={cn('flex flex-col', className)} {...props}>
      {header}
      <div
        className={cn(
          'relative z-[var(--z-dropdown)] grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto px-4 py-4 lg:overflow-hidden lg:px-6',
          hasSidebar && (sidebarSide === 'left' ? workspaceLeftGridClass[sidebarWidth] : workspaceRightGridClass[sidebarWidth]),
          contentClassName,
        )}
      >
        {sidebarSide === 'left' ? (
          <>
            {side}
            {main}
          </>
        ) : (
          <>
            {main}
            {side}
          </>
        )}
      </div>
    </PageShell>
  );
}

export interface StatusPageLayoutProps extends Omit<PageShellProps, 'variant'> {
  panelClassName?: string;
  panelProps?: PanelProps;
}

export function StatusPageLayout({
  children,
  className,
  panelClassName,
  panelProps,
  ...props
}: StatusPageLayoutProps) {
  return (
    <PageShell variant="status" className={cn('flex items-center justify-center px-4', className)} {...props}>
      <Panel {...panelProps} className={cn('relative z-[var(--z-dropdown)] w-full max-w-xl', panelProps?.className, panelClassName)}>
        {children}
      </Panel>
    </PageShell>
  );
}

export interface ToolHeaderProps extends PageHeaderProps {
  density?: 'compact' | 'regular';
}

export function ToolHeader({ className, density = 'compact', ...props }: ToolHeaderProps) {
  return (
    <PageHeader
      className={cn(
        density === 'compact' ? 'min-h-12 px-3 py-2 md:px-6' : 'min-h-14',
        className,
      )}
      {...props}
    />
  );
}

export type FilterToolbarProps = ResponsiveToolbarProps;

export function FilterToolbar({ className, ...props }: FilterToolbarProps) {
  return <ResponsiveToolbar className={cn('rounded-sm border border-border-soft bg-surface-panel/60 p-3', className)} {...props} />;
}

export interface StatsGridProps extends HTMLAttributes<HTMLDivElement> {
  columns?: 2 | 3 | 4 | 5 | 6;
}

const statsColumnsClass: Record<NonNullable<StatsGridProps['columns']>, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-2 md:grid-cols-4',
  5: 'sm:grid-cols-2 lg:grid-cols-5',
  6: 'sm:grid-cols-2 lg:grid-cols-6',
};

export function StatsGrid({ className, columns = 4, ...props }: StatsGridProps) {
  return <section className={cn('grid gap-3', statsColumnsClass[columns], className)} {...props} />;
}

export interface StatCardProps extends PanelProps {
  label: ReactNode;
  value: ReactNode;
}

export function StatCard({ className, label, value, ...props }: StatCardProps) {
  return (
    <Panel className={cn('font-mono', className)} {...props}>
      <span className="text-caption uppercase tracking-[var(--tracking-control)] text-content-primary/50">{label}</span>
      <strong className="mt-1 block text-2xl text-accent-primary">{value}</strong>
    </Panel>
  );
}
