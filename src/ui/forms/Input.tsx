import {
  forwardRef,
  type ChangeEvent,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '../primitives/utils';

const controlClass =
  'w-full rounded-sm border border-border-soft bg-surface-canvas px-3 py-2 text-body text-content-primary placeholder:text-content-dim transition disabled:cursor-not-allowed disabled:opacity-40 focus:border-border-strong focus:outline-none focus:ring-[length:var(--focus-ring-width)] focus:ring-[--focus-ring-color]';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(controlClass, className)} {...props} />;
});

export interface SearchInputProps extends InputProps {
  icon?: ReactNode;
  containerClassName?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { icon, containerClassName, className, type = 'search', ...props },
  ref,
) {
  return (
    <div
      className={cn(
        'flex min-h-touch w-full items-center gap-2 rounded-sm border border-border-soft bg-surface-canvas px-3',
        'transition focus-within:border-border-strong focus-within:ring-[length:var(--focus-ring-width)] focus-within:ring-[--focus-ring-color]',
        containerClassName,
      )}
    >
      {icon}
      <input
        ref={ref}
        type={type}
        className={cn(
          'min-h-0 w-full bg-transparent py-2 text-body text-content-primary placeholder:text-content-dim focus:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-40',
          className,
        )}
        {...props}
      />
    </div>
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(controlClass, 'min-h-24 resize-y', className)} {...props} />;
});

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, ...props }, ref) {
  return <select ref={ref} className={cn(controlClass, className)} {...props} />;
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  label?: ReactNode;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, label, children, ...props },
  ref,
) {
  const content = label ?? children;

  return (
    <label className={cn('inline-flex min-h-touch items-center gap-2 text-body-sm text-content-muted', className)}>
      <input
        ref={ref}
        type="checkbox"
        className="size-4 rounded-xs border-border-soft accent-accent-primary transition disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-[--focus-ring-color]"
        {...props}
      />
      {content && <span>{content}</span>}
    </label>
  );
});

export type FieldLabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export function FieldLabel({ className, ...props }: FieldLabelProps) {
  return (
    <label
      className={cn(
        'font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-dim group-focus-within:text-accent-primary',
        className,
      )}
      {...props}
    />
  );
}

export interface FormFieldProps extends HTMLAttributes<HTMLDivElement> {
  label?: ReactNode;
  htmlFor?: string;
  error?: ReactNode;
  hint?: ReactNode;
}

export function FormField({ label, htmlFor, error, hint, className, children, ...props }: FormFieldProps) {
  return (
    <div className={cn('group grid gap-2', className)} {...props}>
      {label && <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>}
      {children}
      {error && (
        <p className="text-body-sm text-accent-danger" aria-live="assertive">
          {error}
        </p>
      )}
      {!error && hint && <p className="text-body-sm text-content-dim">{hint}</p>}
    </div>
  );
}

export function FormActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-end gap-3', className)} {...props} />;
}
