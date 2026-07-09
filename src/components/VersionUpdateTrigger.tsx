import { useState } from 'react';
import { applyPwaUpdateOrRecover, fetchServerVersion, requestPwaUpdateCheck } from '../clientVersion';
import { useToast } from './ToastProvider';
import { t } from '../i18n';
import { APP_BUILT_AT, APP_VERSION_INFO, isSameAppVersion } from '../version';
import { Button } from '../ui';

function formatBuildStamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${String(date.getFullYear()).slice(-2)}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}`;
}

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

      if (updateReady || hasServerUpdate) {
        showToast({
          title: t('pwa.updateTitle'),
          body: t('pwa.updateBody'),
          kind: 'success',
          durationMs: null,
          actionLabel: t('pwa.updateAction'),
          onAction: () => {
            void applyPwaUpdateOrRecover(updateReady);
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

  const versionLabel = `v${APP_VERSION_INFO.appVersion} · ${APP_VERSION_INFO.buildId.slice(0, 7)} · ${formatBuildStamp(APP_BUILT_AT)}`;

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
