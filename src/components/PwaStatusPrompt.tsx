import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  applyPwaUpdateOrRecover,
  fetchServerVersion,
  getPendingPwaUpdate,
  PWA_RECOVER_REQUESTED_EVENT,
  PWA_UPDATE_PROMPT_REQUESTED_EVENT,
  PWA_UPDATE_READY_EVENT,
  recoverPwaAndReload,
  type PwaUpdateReadyDetail,
} from '../clientVersion';
import { t } from '../i18n';
import { isPwaUpdateSafePath, recordRunningRelease } from '../pwaUpdatePolicy';
import { APP_VERSION_INFO, formatReleaseLabel, type AppVersionInfo } from '../version';
import { AppDrawer } from './AppDrawer';
import { useToast } from './ToastProvider';

export function PwaStatusPrompt() {
  const location = useLocation();
  const { showToast } = useToast();
  const [updateReady, setUpdateReady] = useState<PwaUpdateReadyDetail | null>(() => getPendingPwaUpdate());
  const [latestVersion, setLatestVersion] = useState<AppVersionInfo | null>(null);
  const [isApplyingUpdate, setIsApplyingUpdate] = useState(false);
  const [isUpdatePromptOpen, setIsUpdatePromptOpen] = useState(false);
  const [isRecoverPromptOpen, setIsRecoverPromptOpen] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const deferredUpdateTracked = useRef(false);

  useEffect(() => {
    const transition = recordRunningRelease(window.localStorage, APP_VERSION_INFO);
    if (transition === 'updated') {
      showToast({
        title: t('pwa.updatedTitle'),
        body: `${t('pwa.updatedBody')} ${formatReleaseLabel(APP_VERSION_INFO)}`,
        kind: 'success',
      });
    }

    const bootTelemetry = window.setTimeout(() => {
      try {
        window.umami?.track('C_PWA_App_Boot', {
          app_version: APP_VERSION_INFO.appVersion,
          build_id: APP_VERSION_INFO.buildId,
          built_at: APP_VERSION_INFO.builtAt,
          update_transition: transition,
        });
      } catch {
        // Analytics should never affect startup.
      }
    }, 1500);
    return () => window.clearTimeout(bootTelemetry);
  }, [showToast]);

  useEffect(() => {
    const onUpdateReady = (event: Event) => {
      const updateEvent = event as CustomEvent<PwaUpdateReadyDetail>;
      setUpdateReady(updateEvent.detail);
      setIsApplyingUpdate(false);
    };
    const onUpdatePromptRequested = (event: Event) => {
      const updateEvent = event as CustomEvent<PwaUpdateReadyDetail>;
      setUpdateReady(updateEvent.detail);
      setIsUpdatePromptOpen(true);
      setIsApplyingUpdate(false);
    };
    const onRecoverRequested = () => {
      setIsRecoverPromptOpen(true);
      setIsRecovering(false);
    };

    window.addEventListener(PWA_UPDATE_READY_EVENT, onUpdateReady);
    window.addEventListener(PWA_UPDATE_PROMPT_REQUESTED_EVENT, onUpdatePromptRequested);
    window.addEventListener(PWA_RECOVER_REQUESTED_EVENT, onRecoverRequested);
    return () => {
      window.removeEventListener(PWA_UPDATE_READY_EVENT, onUpdateReady);
      window.removeEventListener(PWA_UPDATE_PROMPT_REQUESTED_EVENT, onUpdatePromptRequested);
      window.removeEventListener(PWA_RECOVER_REQUESTED_EVENT, onRecoverRequested);
    };
  }, []);

  useEffect(() => {
    if (!updateReady) {
      deferredUpdateTracked.current = false;
      setIsUpdatePromptOpen(false);
      return;
    }
    if (isUpdatePromptOpen) return;

    if (!isPwaUpdateSafePath(location.pathname)) {
      if (!deferredUpdateTracked.current) {
        deferredUpdateTracked.current = true;
        try {
          window.umami?.track('C_PWA_Update_Deferred', {
            current_build_id: APP_VERSION_INFO.buildId,
            route: location.pathname,
          });
        } catch {
          // Analytics should never affect updates.
        }
      }
      return;
    }

    const applyTimer = window.setTimeout(() => {
      setIsApplyingUpdate(true);
      try {
        window.umami?.track('C_PWA_Update_Auto_Apply', {
          current_build_id: APP_VERSION_INFO.buildId,
          route: location.pathname,
        });
      } catch {
        // Analytics should never affect updates.
      }
      void applyPwaUpdateOrRecover(updateReady);
    }, 1200);
    return () => window.clearTimeout(applyTimer);
  }, [isUpdatePromptOpen, location.pathname, updateReady]);

  useEffect(() => {
    if (!updateReady) {
      setLatestVersion(null);
      return;
    }

    let cancelled = false;
    void fetchServerVersion()
      .then((version) => {
        if (!cancelled) setLatestVersion(version);
      })
      .catch(() => {
        if (!cancelled) setLatestVersion(null);
      });

    return () => {
      cancelled = true;
    };
  }, [updateReady]);

  if (!updateReady && !isRecoverPromptOpen) return null;

  const applyUpdate = () => {
    try {
      window.umami?.track('C_PWA_Update_Apply', {
        current_build_id: APP_VERSION_INFO.buildId,
        latest_build_id: latestVersion?.buildId,
      });
    } catch {
      // Analytics should never block an update.
    }
    setIsApplyingUpdate(true);
    void applyPwaUpdateOrRecover(updateReady);
  };

  const recover = async () => {
    setIsRecovering(true);
    await recoverPwaAndReload();
  };

  const versionText = (version: AppVersionInfo | null) =>
    version ? formatReleaseLabel(version) : t('common.unavailable');

  return (
    <>
      <AppDrawer
        open={isUpdatePromptOpen && !!updateReady}
        kicker={t('pwa.kicker')}
        title={t('pwa.updateTitle')}
        description={t('pwa.updateBody')}
        actions={[
          {
            label: isApplyingUpdate ? t('pwa.updatingAction') : t('pwa.updateAction'),
            onClick: applyUpdate,
            disabled: isApplyingUpdate,
            eventName: 'C_PWA_Update_Apply',
          },
          {
            label: t('pwa.recoverAction'),
            onClick: () => {
              setIsUpdatePromptOpen(false);
              setIsRecoverPromptOpen(true);
            },
            tone: 'secondary',
            eventName: 'C_PWA_Recover_Open',
          },
          {
            label: t('onlineSession.dismissAction'),
            onClick: () => setIsUpdatePromptOpen(false),
            tone: 'secondary',
            eventName: 'C_PWA_Update_Dismiss',
          },
        ]}
      >
        <dl className="pwa-version-list">
          <div>
            <dt>{t('pwa.currentVersion')}</dt>
            <dd>{versionText(APP_VERSION_INFO)}</dd>
          </div>
          <div>
            <dt>{t('pwa.latestVersion')}</dt>
            <dd>{latestVersion ? versionText(latestVersion) : t('pwa.checkingTitle')}</dd>
          </div>
        </dl>
      </AppDrawer>
      <AppDrawer
        open={isRecoverPromptOpen}
        tone="danger"
        kicker={t('pwa.kicker')}
        title={t('pwa.recoverTitle')}
        description={t('pwa.recoverBody')}
        actions={[
          {
            label: isRecovering ? t('pwa.recoveringAction') : t('pwa.clearCacheAction'),
            onClick: () => void recover(),
            disabled: isRecovering,
            tone: 'danger',
            eventName: 'C_PWA_Recover_ClearCache',
          },
          {
            label: t('common.cancel'),
            onClick: () => setIsRecoverPromptOpen(false),
            disabled: isRecovering,
            tone: 'secondary',
            eventName: 'C_PWA_Recover_Cancel',
          },
        ]}
      >
        <ul className="app-drawer-list">
          <li>{t('pwa.recoverStepServiceWorker')}</li>
          <li>{t('pwa.recoverStepCache')}</li>
          <li>{t('pwa.recoverStepReload')}</li>
        </ul>
      </AppDrawer>
    </>
  );
}
