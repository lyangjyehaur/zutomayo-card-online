import { ArrowLeft } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './utils';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type IconButtonSize = 'sm' | 'md';

const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-accent-primary text-content-inverse hover:bg-accent-primary-soft disabled:hover:bg-accent-primary',
  secondary:
    'border border-border-soft text-content-muted hover:border-accent-action/50 hover:text-accent-action disabled:hover:border-border-soft disabled:hover:text-content-muted',
  danger: 'bg-accent-danger text-content-primary hover:bg-accent-danger/90 disabled:hover:bg-accent-danger',
  ghost: 'text-content-dim hover:text-content-primary disabled:hover:text-content-dim',
};

const sizeClass: Record<ButtonSize, string> = {
  sm: 'min-h-touch px-4 py-2 text-control',
  md: 'min-h-control-md px-5 py-2.5 text-control',
  lg: 'min-h-control-lg px-8 py-3 text-control',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  leftIcon,
  rightIcon,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-sm font-mono font-medium uppercase tracking-[var(--tracking-kicker)]',
        'transition will-change-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100',
        'focus-visible:outline-none focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-[--focus-ring-color] focus-visible:ring-offset-[length:var(--focus-ring-offset)] focus-visible:ring-offset-surface-base',
        variantClass[variant],
        sizeClass[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {leftIcon}
      {children}
      {rightIcon}
    </button>
  );
}

export interface BackButtonProps extends Omit<ButtonProps, 'children' | 'leftIcon' | 'variant'> {
  children?: ReactNode;
}

export function BackButton({ children, size = 'md', ...props }: BackButtonProps) {
  return (
    <Button variant="ghost" size={size} leftIcon={<ArrowLeft className="size-4" aria-hidden="true" />} {...props}>
      {children}
    </Button>
  );
}

const iconSizeClass: Record<IconButtonSize, string> = {
  sm: 'size-touch',
  md: 'size-touch',
};

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  label: string;
  icon: ReactNode;
  variant?: Extract<ButtonVariant, 'secondary' | 'ghost' | 'danger'>;
  size?: IconButtonSize;
}

export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'md',
  className,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm p-0 tracking-normal',
        'transition will-change-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100',
        'focus-visible:outline-none focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-[--focus-ring-color] focus-visible:ring-offset-[length:var(--focus-ring-offset)] focus-visible:ring-offset-surface-base',
        variantClass[variant],
        iconSizeClass[size],
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
}
