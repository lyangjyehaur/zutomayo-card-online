import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { AppDrawer } from './AppDrawer';
import { useToast } from './ToastProvider';

type InstallOutcome = 'accepted' | 'dismissed';
type InstallPromptState = {
  dismissedUntil?: number;
  installedAt?: string;
  lastNotifiedAt?: number;
};

const INSTALL_PROMPT_STATE_KEY = 'zutomayo_pwa_install_prompt';
const INSTALL_NOTICE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const INSTALL_DISMISS_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const INSTALL_SYSTEM_DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: InstallOutcome; platform: string }>;
}

function isStandaloneMode(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function readInstallPromptState(): InstallPromptState {
  try {
    const value = localStorage.getItem(INSTALL_PROMPT_STATE_KEY);
    return value ? (JSON.parse(value) as InstallPromptState) : {};
  } catch {
    return {};
  }
}

function writeInstallPromptState(state: InstallPromptState): void {
  try {
    localStorage.setItem(INSTALL_PROMPT_STATE_KEY, JSON.stringify(state));
  } catch {
    // Storage can fail in private mode; the install prompt should still work.
  }
}

function shouldNotifyInstallReady(now = Date.now()): boolean {
  if (isStandaloneMode()) return false;
  const state = readInstallPromptState();
  if (state.installedAt) return false;
  if (state.dismissedUntil && state.dismissedUntil > now) return false;
  if (state.lastNotifiedAt && now - state.lastNotifiedAt < INSTALL_NOTICE_COOLDOWN_MS) return false;
  return true;
}

function markInstallPromptNotified(now = Date.now()): void {
  writeInstallPromptState({ ...readInstallPromptState(), lastNotifiedAt: now });
}

function dismissInstallPromptFor(durationMs: number): void {
  writeInstallPromptState({
    ...readInstallPromptState(),
    dismissedUntil: Date.now() + durationMs,
  });
}

export function PwaInstallPrompt() {
  const { showToast } = useToast();
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallDrawerOpen, setIsInstallDrawerOpen] = useState(false);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      const promptEvent = event as BeforeInstallPromptEvent;
      setInstallPrompt(promptEvent);
      if (!shouldNotifyInstallReady()) return;
      markInstallPromptNotified();
      showToast({
        title: t('pwa.installReadyTitle'),
        body: t('pwa.installReadyBody'),
        kind: 'info',
        durationMs: 9000,
        actionLabel: t('pwa.installAction'),
        onAction: () => setIsInstallDrawerOpen(true),
      });
    };
    const onInstalled = () => {
      writeInstallPromptState({ installedAt: new Date().toISOString() });
      setInstallPrompt(null);
      setIsInstallDrawerOpen(false);
      showToast({
        title: t('pwa.installSuccessTitle'),
        body: t('pwa.installSuccessBody'),
        kind: 'success',
      });
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [showToast]);

  const install = async () => {
    if (!installPrompt) {
      dismissInstallPromptFor(INSTALL_DISMISS_COOLDOWN_MS);
      showToast({
        title: isStandaloneMode() ? t('pwa.installAlreadyTitle') : t('pwa.installUnavailableTitle'),
        body: isStandaloneMode() ? t('pwa.installAlreadyBody') : t('pwa.installUnavailableBody'),
        kind: isStandaloneMode() ? 'success' : 'warning',
      });
      setIsInstallDrawerOpen(false);
      return;
    }

    setIsInstallDrawerOpen(false);
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      window.umami?.track('C_PWA_Install_Accepted');
      writeInstallPromptState({ installedAt: new Date().toISOString() });
      setInstallPrompt(null);
    } else {
      window.umami?.track('C_PWA_Install_Dismissed');
      dismissInstallPromptFor(INSTALL_SYSTEM_DISMISS_COOLDOWN_MS);
    }
  };

  const dismissInstallDrawer = () => {
    dismissInstallPromptFor(INSTALL_DISMISS_COOLDOWN_MS);
    setIsInstallDrawerOpen(false);
  };

  return (
    <AppDrawer
      open={isInstallDrawerOpen}
      kicker={t('pwa.kicker')}
      title={t('pwa.installTitle')}
      description={t('pwa.installBody')}
      onClose={dismissInstallDrawer}
      actions={[
        {
          label: t('pwa.installAction'),
          onClick: () => void install(),
          eventName: 'C_PWA_Install_Open_System_Prompt',
        },
        {
          label: t('pwa.installLaterAction'),
          onClick: dismissInstallDrawer,
          tone: 'secondary',
          eventName: 'C_PWA_Install_Later',
        },
      ]}
    >
      <ul className="app-drawer-list">
        <li>{t('pwa.installFeatureFullscreen')}</li>
        <li>{t('pwa.installFeatureReconnect')}</li>
        <li>{t('pwa.installFeatureUpdate')}</li>
        <li>{t('pwa.installFeatureNative')}</li>
      </ul>
    </AppDrawer>
  );
}
