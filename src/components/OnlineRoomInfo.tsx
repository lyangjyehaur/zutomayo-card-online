import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n';

interface OnlineRoomInfoProps {
  matchID: string;
  helperText?: string;
  className?: string;
}

export function buildOnlineRoomUrl(matchID: string): string {
  const path = `/play/online/${encodeURIComponent(matchID)}`;
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

export function OnlineRoomInfo({ matchID, helperText, className = '' }: OnlineRoomInfoProps) {
  const [copied, setCopied] = useState(false);
  const shareLink = useMemo(() => buildOnlineRoomUrl(matchID), [matchID]);

  useEffect(() => {
    setCopied(false);
  }, [shareLink]);

  const copyShareLink = async () => {
    await copyText(shareLink);
    setCopied(true);
  };

  return (
    <div className={`alert alert-info flex-col items-stretch gap-3 ${className}`} role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <span>{t('online.roomCode')}</span>
        <strong className="font-mono text-lg">{matchID}</strong>
      </div>
      {helperText && <p className="online-room-helper">{helperText}</p>}
      <label className="flex flex-col gap-2">
        <span>{t('online.shareLink')}</span>
        <input className="input input-bordered w-full" value={shareLink} readOnly aria-label={t('online.shareLink')} />
      </label>
      <div className="flex items-center gap-3">
        <button className="btn btn-sm" type="button" onClick={copyShareLink}>
          {copied ? t('online.copied') : t('online.copyLink')}
        </button>
        <small>{copied ? t('online.copySuccessHelp') : t('online.shareReconnectHint')}</small>
      </div>
    </div>
  );
}
