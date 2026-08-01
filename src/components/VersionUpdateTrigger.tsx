import { useState } from 'react';
import {
  applyPwaUpdateOrRecover,
  fetchServerVersion,
  requestPwaUpdateCheck,
  requestPwaUpdatePrompt,
} from '../clientVersion';
import { useToast } from './ToastProvider';
import { t } from '../i18n';
import { APP_VERSION_INFO, formatReleaseLabel, isSameAppVersion } from '../version';
import { Button } from '../ui';

export function VersionUpdateTrigger() {
  const { showToast } = useToast();
  const [isChecking, setIsChecking] = useState(false);

  const handleClick = async () => {
    if (isChecking) return;
    setIsChecking(true);
    showToast({
      title: t('pwa.checkingTitle'),
      body: t('pwa.checkingBody'),
      kind: 'info',
      durationMs: 1800,
    });

    try {
      const updateReady = await requestPwaUpdateCheck();
      const serverVersion = await fetchServerVersion();
      const hasServerUpdate = Boolean(serverVersion && !isSameAppVersion(APP_VERSION_INFO, serverVersion));

      if (updateReady) {
        requestPwaUpdatePrompt(updateReady);
        return;
      }

      if (hasServerUpdate) {
        showToast({
          title: t('pwa.updateTitle'),
          body: t('pwa.updateBody'),
          kind: 'success',
          durationMs: null,
          actionLabel: t('pwa.updateAction'),
          onAction: () => {
            void applyPwaUpdateOrRecover(null);
          },
        });
        return;
      }

      showToast({
        title: t('pwa.upToDateTitle'),
        body: t('pwa.upToDateBody'),
        kind: 'success',
      });
    } catch {
      showToast({
        title: t('pwa.checkFailedTitle'),
        body: t('pwa.checkFailedBody'),
        kind: 'error',
      });
    } finally {
      setIsChecking(false);
    }
  };

  const versionLabel = formatReleaseLabel(APP_VERSION_INFO);

  return (
    <Button
      className="version-update-trigger"
      variant="ghost"
      size="sm"
      type="button"
      onClick={handleClick}
      disabled={isChecking}
      aria-label={t('pwa.manualCheckLabel')}
      title={t('pwa.manualCheckLabel')}
      data-umami-event="C_PWA_Check_Version_Tap"
    >
      <span>{versionLabel}</span>
    </Button>
  );
}
