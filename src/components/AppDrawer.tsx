import { useId, type ReactNode } from 'react';
import { t } from '../i18n';

interface AppDrawerAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'secondary' | 'danger';
  eventName?: string;
}

interface AppDrawerProps {
  actions: AppDrawerAction[];
  children?: ReactNode;
  description?: string;
  kicker?: string;
  onClose?: () => void;
  open: boolean;
  title: string;
  tone?: 'default' | 'danger';
}

function actionClass(tone: AppDrawerAction['tone']): string {
  if (tone === 'danger') return 'danger-action';
  if (tone === 'secondary') return 'secondary-action';
  return 'primary-action';
}

export function AppDrawer({
  actions,
  children,
  description,
  kicker,
  onClose,
  open,
  title,
  tone = 'default',
}: AppDrawerProps) {
  const titleId = useId();

  if (!open) return null;

  return (
    <div className={`app-drawer-overlay ${tone}`} role="presentation">
      <section className="app-drawer-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div>
          {kicker && <span>{kicker}</span>}
          <h2 id={titleId}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {children}
        <div className="app-drawer-actions">
          {actions.map((action) => (
            <button
              key={action.label}
              className={actionClass(action.tone)}
              type="button"
              disabled={action.disabled}
              onClick={action.onClick}
              data-umami-event={action.eventName}
            >
              {action.label}
            </button>
          ))}
          {onClose && (
            <button
              className="secondary-action app-drawer-close"
              type="button"
              aria-label={t('common.close')}
              onClick={onClose}
            >
              ×
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
