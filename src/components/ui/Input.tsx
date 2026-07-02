import {
  forwardRef,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from './utils';

const controlClass =
  'w-full rounded-sm border border-bone/10 bg-lacquer-deep px-3 py-2 text-sm text-bone placeholder:text-bone/30 transition disabled:opacity-40 focus:border-gold/40 focus:outline-none focus:ring-2 focus:ring-gold/40';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(controlClass, className)} {...props} />;
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(controlClass, 'min-h-24 resize-y', className)} {...props} />;
});

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, ...props }, ref) {
  return <select ref={ref} className={cn(controlClass, className)} {...props} />;
});

export type FieldLabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export function FieldLabel({ className, ...props }: FieldLabelProps) {
  return (
    <label
      className={cn(
        'font-mono text-[10px] uppercase tracking-[0.3em] text-bone/40 group-focus-within:text-gold/70',
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
        <p className="text-xs text-vermilion" aria-live="assertive">
          {error}
        </p>
      )}
      {!error && hint && <p className="text-xs text-bone/50">{hint}</p>}
    </div>
  );
}

export function FormActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-end gap-3', className)} {...props} />;
}
