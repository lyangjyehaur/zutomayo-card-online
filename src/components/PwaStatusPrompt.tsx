import { useEffect, useState } from 'react';
import { PWA_UPDATE_READY_EVENT, recoverPwaAndReload, type PwaUpdateReadyDetail } from '../clientVersion';
import { t } from '../i18n';

export function PwaStatusPrompt() {
  const [updateReady, setUpdateReady] = useState<PwaUpdateReadyDetail | null>(null);
  const [isApplyingUpdate, setIsApplyingUpdate] = useState(false);
  const [isConfirmingRecover, setIsConfirmingRecover] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);

  useEffect(() => {
    const onUpdateReady = (event: Event) => {
      const updateEvent = event as CustomEvent<PwaUpdateReadyDetail>;
      setUpdateReady(updateEvent.detail);
      setIsApplyingUpdate(false);
      setIsConfirmingRecover(false);
    };

    window.addEventListener(PWA_UPDATE_READY_EVENT, onUpdateReady);
    return () => window.removeEventListener(PWA_UPDATE_READY_EVENT, onUpdateReady);
  }, []);

  if (!updateReady) return null;

  const applyUpdate = () => {
    setIsApplyingUpdate(true);
    updateReady.applyUpdate();
  };

  const recover = async () => {
    setIsRecovering(true);
    await recoverPwaAndReload();
  };

  return (
    <aside
      className={`online-resume-prompt pwa-status-prompt ${isConfirmingRecover ? 'recover' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div>
        <span>{t('pwa.kicker')}</span>
        <strong>{isConfirmingRecover ? t('pwa.recoverTitle') : t('pwa.updateTitle')}</strong>
        <p>{isConfirmingRecover ? t('pwa.recoverBody') : t('pwa.updateBody')}</p>
      </div>
      <div className="online-resume-actions">
        {isConfirmingRecover ? (
          <>
            <button
              className="danger-action"
              type="button"
              disabled={isRecovering}
              onClick={() => void recover()}
              data-umami-event="C_PWA_Recover_ClearCache"
              data-umami-event-source="pwa_prompt"
            >
              {isRecovering ? t('pwa.recoveringAction') : t('pwa.clearCacheAction')}
            </button>
            <button
              className="secondary-action"
              type="button"
              disabled={isRecovering}
              onClick={() => setIsConfirmingRecover(false)}
              data-umami-event="C_PWA_Recover_Cancel"
            >
              {t('common.cancel')}
            </button>
          </>
        ) : (
          <>
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
              onClick={() => setIsConfirmingRecover(true)}
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
          </>
        )}
      </div>
    </aside>
  );
}
