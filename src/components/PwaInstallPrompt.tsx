import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { AppDrawer } from './AppDrawer';
import { useToast } from './ToastProvider';

type InstallOutcome = 'accepted' | 'dismissed';

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

export function PwaInstallPrompt() {
  const { showToast } = useToast();
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallDrawerOpen, setIsInstallDrawerOpen] = useState(false);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      const promptEvent = event as BeforeInstallPromptEvent;
      setInstallPrompt(promptEvent);
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
      setInstallPrompt(null);
    } else {
      window.umami?.track('C_PWA_Install_Dismissed');
    }
  };

  return (
    <AppDrawer
      open={isInstallDrawerOpen}
      kicker={t('pwa.kicker')}
      title={t('pwa.installTitle')}
      description={t('pwa.installBody')}
      onClose={() => setIsInstallDrawerOpen(false)}
      actions={[
        {
          label: t('pwa.installAction'),
          onClick: () => void install(),
          eventName: 'C_PWA_Install_Open_System_Prompt',
        },
        {
          label: t('pwa.installLaterAction'),
          onClick: () => setIsInstallDrawerOpen(false),
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
