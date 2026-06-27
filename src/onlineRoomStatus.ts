import type { TranslationKey } from './i18n';

export type OnlineRoomStatus =
  | 'reconnecting'
  | 'retrying'
  | 'waiting'
  | 'ready'
  | 'roomNotFound'
  | 'roomFull'
  | 'connectionFailed';

export type OnlineRoomErrorKey = 'online.roomFull' | 'online.roomNotFound' | 'online.connectionFailed';

export type OnlineStatusPanelCopy = {
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  canRetry: boolean;
  canCreateNewRoom: boolean;
  tone: 'neutral' | 'waiting' | 'success' | 'error';
};

export function isOnlineRoomErrorKey(value: string): value is OnlineRoomErrorKey {
  return value === 'online.roomFull' || value === 'online.roomNotFound' || value === 'online.connectionFailed';
}

export function onlineErrorStatus(error: unknown): OnlineRoomStatus {
  if (error instanceof Error && isOnlineRoomErrorKey(error.message)) {
    if (error.message === 'online.roomFull') return 'roomFull';
    if (error.message === 'online.roomNotFound') return 'roomNotFound';
  }
  return 'connectionFailed';
}

export function isOnlineFailureStatus(status: OnlineRoomStatus): boolean {
  return status === 'roomNotFound' || status === 'roomFull' || status === 'connectionFailed';
}

export function onlineStatusPanelCopy(status: OnlineRoomStatus): OnlineStatusPanelCopy {
  if (status === 'roomNotFound') {
    return {
      titleKey: 'online.roomNotFound',
      bodyKey: 'online.roomNotFoundBody',
      canRetry: false,
      canCreateNewRoom: true,
      tone: 'error',
    };
  }

  if (status === 'roomFull') {
    return {
      titleKey: 'online.roomFull',
      bodyKey: 'online.roomFullBody',
      canRetry: false,
      canCreateNewRoom: true,
      tone: 'error',
    };
  }

  if (status === 'connectionFailed') {
    return {
      titleKey: 'online.connectionFailed',
      bodyKey: 'online.connectionFailedBody',
      canRetry: true,
      canCreateNewRoom: true,
      tone: 'error',
    };
  }

  if (status === 'retrying') {
    return {
      titleKey: 'online.retryingTitle',
      bodyKey: 'online.retryingBody',
      canRetry: true,
      canCreateNewRoom: false,
      tone: 'neutral',
    };
  }

  if (status === 'waiting') {
    return {
      titleKey: 'online.waitingForOpponent',
      bodyKey: 'online.waitingBody',
      canRetry: false,
      canCreateNewRoom: false,
      tone: 'waiting',
    };
  }

  if (status === 'ready') {
    return {
      titleKey: 'online.readyTitle',
      bodyKey: 'online.readyBody',
      canRetry: false,
      canCreateNewRoom: false,
      tone: 'success',
    };
  }

  return {
    titleKey: 'online.reconnectingTitle',
    bodyKey: 'online.reconnectingBody',
    canRetry: false,
    canCreateNewRoom: false,
    tone: 'neutral',
  };
}
