import { useEffect, useState } from 'react';
import {
  fetchServerVersion,
  PWA_RECOVER_REQUESTED_EVENT,
  PWA_UPDATE_READY_EVENT,
  recoverPwaAndReload,
  type PwaUpdateReadyDetail,
} from '../clientVersion';
import { t } from '../i18n';
import { APP_VERSION_INFO, type AppVersionInfo } from '../version';

export function PwaStatusPrompt() {
  const [updateReady, setUpdateReady] = useState<PwaUpdateReadyDetail | null>(null);
  const [latestVersion, setLatestVersion] = useState<AppVersionInfo | null>(null);
  const [isApplyingUpdate, setIsApplyingUpdate] = useState(false);
  const [isRecoverPromptOpen, setIsRecoverPromptOpen] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);

  useEffect(() => {
    const onUpdateReady = (event: Event) => {
      const updateEvent = event as CustomEvent<PwaUpdateReadyDetail>;
      setUpdateReady(updateEvent.detail);
      setIsApplyingUpdate(false);
    };
    const onRecoverRequested = () => {
      setIsRecoverPromptOpen(true);
      setIsRecovering(false);
    };

    window.addEventListener(PWA_UPDATE_READY_EVENT, onUpdateReady);
    window.addEventListener(PWA_RECOVER_REQUESTED_EVENT, onRecoverRequested);
    return () => {
      window.removeEventListener(PWA_UPDATE_READY_EVENT, onUpdateReady);
      window.removeEventListener(PWA_RECOVER_REQUESTED_EVENT, onRecoverRequested);
    };
  }, []);

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
    updateReady?.applyUpdate();
  };

  const recover = async () => {
    setIsRecovering(true);
    await recoverPwaAndReload();
  };

  const versionText = (version: AppVersionInfo | null) =>
    version ? `v${version.appVersion} · ${version.buildId}` : t('common.unavailable');

  return (
    <>
      {updateReady && (
        <aside className="online-resume-prompt pwa-status-prompt" role="status" aria-live="polite">
          <div>
            <span>{t('pwa.kicker')}</span>
            <strong>{t('pwa.updateTitle')}</strong>
            <p>{t('pwa.updateBody')}</p>
            <dl className="pwa-version-list">
              <div>
                <dt>{t('pwa.currentVersion')}</dt>
                <dd>{versionText(APP_VERSION_INFO)}</dd>
              </div>
              <div>
                <dt>{t('pwa.latestVersion')}</dt>
                <dd>{versionText(latestVersion)}</dd>
              </div>
            </dl>
          </div>
          <div className="online-resume-actions">
            <button
              className="primary-action"
              type="button"
              disabled={isApplyingUpdate}
              onClick={applyUpdate}
              data-umami-event="C_PWA_Update_Apply"
            >
              {isApplyingUpdate ? t('pwa.updatingAction') : t('pwa.updateAction')}
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => setIsRecoverPromptOpen(true)}
              data-umami-event="C_PWA_Recover_Open"
            >
              {t('pwa.recoverAction')}
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => setUpdateReady(null)}
              data-umami-event="C_PWA_Update_Dismiss"
            >
              {t('onlineSession.dismissAction')}
            </button>
          </div>
        </aside>
      )}
      {isRecoverPromptOpen && (
        <div className="pwa-recover-overlay" role="presentation">
          <section className="pwa-recover-panel" role="dialog" aria-modal="true" aria-labelledby="pwa-recover-title">
            <div>
              <span>{t('pwa.kicker')}</span>
              <h2 id="pwa-recover-title">{t('pwa.recoverTitle')}</h2>
              <p>{t('pwa.recoverBody')}</p>
            </div>
            <ul>
              <li>{t('pwa.recoverStepServiceWorker')}</li>
              <li>{t('pwa.recoverStepCache')}</li>
              <li>{t('pwa.recoverStepReload')}</li>
            </ul>
            <div className="pwa-recover-actions">
              <button
                className="danger-action"
                type="button"
                disabled={isRecovering}
                onClick={() => void recover()}
                data-umami-event="C_PWA_Recover_ClearCache"
                data-umami-event-source="recover_dialog"
              >
                {isRecovering ? t('pwa.recoveringAction') : t('pwa.clearCacheAction')}
              </button>
              <button
                className="secondary-action"
                type="button"
                disabled={isRecovering}
                onClick={() => setIsRecoverPromptOpen(false)}
                data-umami-event="C_PWA_Recover_Cancel"
              >
                {t('common.cancel')}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
