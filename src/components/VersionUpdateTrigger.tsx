import { useRef, useState } from 'react';
import { checkForPwaUpdate } from '../clientVersion';
import { t } from '../i18n';
import { APP_VERSION_INFO } from '../version';

const REQUIRED_TAPS = 5;
const TAP_WINDOW_MS = 1800;

type UpdateCheckStatus = 'idle' | 'checking' | 'update-ready' | 'up-to-date' | 'unsupported' | 'failed';

function statusText(status: UpdateCheckStatus): string {
  if (status === 'checking') return t('pwa.manualChecking');
  if (status === 'update-ready') return t('pwa.manualUpdateReady');
  if (status === 'up-to-date') return t('pwa.manualUpToDate');
  if (status === 'unsupported') return t('pwa.manualUnsupported');
  if (status === 'failed') return t('pwa.manualFailed');
  return '';
}

export function VersionUpdateTrigger() {
  const [tapCount, setTapCount] = useState(0);
  const [status, setStatus] = useState<UpdateCheckStatus>('idle');
  const firstTapAtRef = useRef(0);
  const resetTimerRef = useRef<number | null>(null);

  const resetTapsSoon = () => {
    if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => setTapCount(0), TAP_WINDOW_MS);
  };

  const checkUpdate = async () => {
    setStatus('checking');
    try {
      setStatus(await checkForPwaUpdate());
    } catch {
      setStatus('failed');
    } finally {
      window.setTimeout(() => setStatus('idle'), 4200);
    }
  };

  const handleClick = () => {
    const now = Date.now();
    const isFreshSequence = now - firstTapAtRef.current > TAP_WINDOW_MS;
    const nextTapCount = isFreshSequence ? 1 : tapCount + 1;

    if (isFreshSequence) firstTapAtRef.current = now;
    setTapCount(nextTapCount);

    if (nextTapCount >= REQUIRED_TAPS) {
      setTapCount(0);
      firstTapAtRef.current = 0;
      void checkUpdate();
      return;
    }

    resetTapsSoon();
  };

  const versionLabel = `v${APP_VERSION_INFO.appVersion} · ${APP_VERSION_INFO.buildId.slice(0, 7)}`;

  return (
    <button
      className="version-update-trigger"
      type="button"
      onClick={handleClick}
      aria-label={t('pwa.manualCheckLabel')}
      data-umami-event="C_PWA_Manual_Check_Tap"
    >
      <span>{status === 'idle' ? versionLabel : statusText(status)}</span>
    </button>
  );
}
