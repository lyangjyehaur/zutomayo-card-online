import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { Button, IconButton } from '../ui';

type ToastKind = 'info' | 'success' | 'warning' | 'error';

interface ToastInput {
  title: string;
  body?: string;
  kind?: ToastKind;
  durationMs?: number | null;
  actionLabel?: string;
  onAction?: () => void;
}

interface Toast extends ToastInput {
  id: number;
  kind: ToastKind;
}

interface ToastContextValue {
  dismissToast: (id: number) => void;
  showToast: (toast: ToastInput) => number;
}

const ToastContext = createContext<ToastContextValue | null>(null);
let nextToastId = 1;

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [exiting, setExiting] = useState(false);

  const dismiss = useCallback(() => {
    if (exiting) return;
    setExiting(true);
    window.setTimeout(() => onDismiss(toast.id), 180);
  }, [exiting, onDismiss, toast.id]);

  useEffect(() => {
    if (toast.durationMs === null) return;
    const timeout = window.setTimeout(dismiss, toast.durationMs ?? 4200);
    return () => window.clearTimeout(timeout);
  }, [dismiss, toast.durationMs]);

  return (
    <article
      className={`toast-item ${toast.kind}${exiting ? ' exiting' : ''}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
    >
      <div>
        <strong>{toast.title}</strong>
        {toast.body && <p>{toast.body}</p>}
      </div>
      <div className="toast-actions">
        {toast.actionLabel && toast.onAction && (
          <Button
            size="md"
            variant="secondary"
            type="button"
            onClick={() => {
              toast.onAction?.();
              dismiss();
            }}
          >
            {toast.actionLabel}
          </Button>
        )}
        <IconButton
          label={t('common.close')}
          icon={<X className="size-4" aria-hidden="true" />}
          size="md"
          onClick={dismiss}
        />
      </div>
    </article>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((toast: ToastInput) => {
    const id = nextToastId++;
    setToasts((current) => [...current.slice(-3), { ...toast, id, kind: toast.kind ?? 'info' }]);
    return id;
  }, []);

  const value = useMemo(() => ({ dismissToast, showToast }), [dismissToast, showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-relevant="additions removals">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}

export function useOptionalToast(): ToastContextValue | null {
  return useContext(ToastContext);
}
