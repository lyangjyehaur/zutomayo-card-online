import { ArrowLeft } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './utils';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-gold text-lacquer hover:bg-gold-soft',
  secondary: 'border border-bone/20 text-bone/60 hover:border-vermilion/50 hover:text-vermilion',
  danger: 'bg-vermilion text-bone hover:bg-vermilion/90',
  ghost: 'text-bone/50 hover:text-bone',
};

const sizeClass: Record<ButtonSize, string> = {
  sm: 'px-4 py-1.5 text-[10px]',
  md: 'px-5 py-2.5 text-[10px]',
  lg: 'px-8 py-3 text-[11px]',
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
        'inline-flex items-center justify-center gap-2 rounded-sm font-mono font-medium uppercase tracking-[0.3em]',
        'transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-lacquer',
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

export function BackButton({ children, size = 'sm', ...props }: BackButtonProps) {
  return (
    <Button variant="ghost" size={size} leftIcon={<ArrowLeft className="size-4" aria-hidden="true" />} {...props}>
      {children}
    </Button>
  );
}
