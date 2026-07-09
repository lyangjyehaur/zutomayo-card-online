import { useEffect, useMemo, useState } from 'react';
import { copyText } from '../clipboard';
import { t } from '../i18n';
import { useToast } from './ToastProvider';
import { Button, FieldLabel, Input, Panel, cn } from '../ui';

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

export function buildOnlineSpectatorUrl(matchID: string): string {
  const path = `/play/online/${encodeURIComponent(matchID)}?spectate=1`;
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

export function OnlineRoomInfo({ matchID, helperText, className = '' }: OnlineRoomInfoProps) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const shareLink = useMemo(() => buildOnlineRoomUrl(matchID), [matchID]);

  useEffect(() => {
    setCopied(false);
  }, [shareLink]);

  const copyShareLink = async () => {
    await copyText(shareLink);
    setCopied(true);
    showToast({
      title: t('online.copied'),
      body: t('online.copySuccessHelp'),
      kind: 'success',
    });
  };

  return (
    <Panel className={cn('flex flex-col items-stretch gap-3', className)} role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-content-primary/70">{t('online.roomCode')}</span>
        <strong className="font-mono text-lg">{matchID}</strong>
      </div>
      {helperText && <p className="text-sm text-content-primary/70">{helperText}</p>}
      <label className="flex flex-col gap-2">
        <FieldLabel>{t('online.shareLink')}</FieldLabel>
        <Input value={shareLink} readOnly aria-label={t('online.shareLink')} />
      </label>
      <div className="flex items-center gap-3">
        <Button size="sm" type="button" onClick={copyShareLink}>
          {copied ? t('online.copied') : t('online.copyLink')}
        </Button>
        <small className="text-xs text-content-primary/50">
          {copied ? t('online.copySuccessHelp') : t('online.shareReconnectHint')}
        </small>
      </div>
    </Panel>
  );
}
