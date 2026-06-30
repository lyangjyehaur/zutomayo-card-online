import { useEffect, useRef } from 'react';
import { t } from '../i18n';
import { useToast } from './ToastProvider';

type NetworkConnection = EventTarget & {
  effectiveType?: string;
  saveData?: boolean;
  type?: string;
};

function connectionInfo(): NetworkConnection | null {
  const nav = navigator as Navigator & {
    connection?: NetworkConnection;
    mozConnection?: NetworkConnection;
    webkitConnection?: NetworkConnection;
  };
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection ?? null;
}

export function NetworkStatusNotifier() {
  const { dismissToast, showToast } = useToast();
  const offlineToastRef = useRef<number | null>(null);
  const previousTypeRef = useRef<string | undefined>(connectionInfo()?.type);

  useEffect(() => {
    const connection = connectionInfo();

    const updateStatus = () => {
      if (!navigator.onLine) {
        if (offlineToastRef.current === null) {
          offlineToastRef.current = showToast({
            title: t('network.offlineTitle'),
            body: t('network.offlineBody'),
            kind: 'error',
            durationMs: null,
          });
        }
        return;
      }

      if (offlineToastRef.current !== null) {
        dismissToast(offlineToastRef.current);
        offlineToastRef.current = null;
        showToast({
          title: t('network.onlineTitle'),
          body: t('network.onlineBody'),
          kind: 'success',
          durationMs: 3200,
        });
      }

      const nextType = connection?.type;
      if (nextType === 'cellular' && previousTypeRef.current !== 'cellular') {
        showToast({
          title: t('network.cellularTitle'),
          body: t('network.cellularBody'),
          kind: 'warning',
          durationMs: 6200,
        });
      }
      previousTypeRef.current = nextType;
    };

    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    connection?.addEventListener('change', updateStatus);

    updateStatus();

    return () => {
      window.removeEventListener('online', updateStatus);
      window.removeEventListener('offline', updateStatus);
      connection?.removeEventListener('change', updateStatus);
    };
  }, [dismissToast, showToast]);

  return null;
}
