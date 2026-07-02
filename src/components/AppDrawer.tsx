import { useId, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { t } from '../i18n';
import { Button, type ButtonVariant } from './ui';

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

function actionVariant(tone: AppDrawerAction['tone']): ButtonVariant {
  if (tone === 'danger') return 'danger';
  if (tone === 'secondary') return 'secondary';
  return 'primary';
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
            <Button
              key={action.label}
              variant={actionVariant(action.tone)}
              type="button"
              disabled={action.disabled}
              onClick={action.onClick}
              data-umami-event={action.eventName}
            >
              {action.label}
            </Button>
          ))}
          {onClose && (
            <Button
              className="app-drawer-close size-9 p-0 tracking-normal"
              variant="secondary"
              type="button"
              aria-label={t('common.close')}
              onClick={onClose}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
