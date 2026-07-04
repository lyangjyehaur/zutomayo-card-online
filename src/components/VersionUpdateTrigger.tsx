import { useRef } from 'react';
import { requestPwaRecoveryPrompt } from '../clientVersion';
import { t } from '../i18n';
import { APP_BUILT_AT, APP_VERSION_INFO } from '../version';
import { Button } from './ui';

const REQUIRED_TAPS = 7;
const TAP_WINDOW_MS = 1500;

function formatBuildStamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${String(date.getFullYear()).slice(-2)}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}`;
}

export function VersionUpdateTrigger() {
  const tapCountRef = useRef(0);
  const resetTimerRef = useRef<number | null>(null);

  const resetTapCounter = () => {
    tapCountRef.current = 0;
    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  };

  const handleClick = () => {
    tapCountRef.current += 1;
    if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(resetTapCounter, TAP_WINDOW_MS);

    if (tapCountRef.current >= REQUIRED_TAPS) {
      resetTapCounter();
      requestPwaRecoveryPrompt();
      return;
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
      aria-label={t('pwa.manualCheckLabel')}
      title={t('pwa.recoverTitle')}
      data-umami-event="C_PWA_Recover_Version_Tap"
    >
      <span>{versionLabel}</span>
    </Button>
  );
}
