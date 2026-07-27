export const WEB_FONT_STYLESHEET =
  'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Kaisei+Tokumin:wght@400;500;700;800&family=Noto+Sans:wght@400;500;600;700;800;900&family=Noto+Sans+HK:wght@400;500;600;700;800;900&family=Noto+Sans+JP:wght@400;500;600;700;800;900&family=Noto+Sans+KR:wght@400;500;600;700;800;900&family=Noto+Sans+SC:wght@400;500;600;700;800;900&family=Noto+Sans+TC:wght@400;500;600;700;800;900&display=swap';

const WEB_FONT_LINK_ID = 'zutomayo-web-fonts';

function waitForLoadedFonts(): Promise<void> {
  if (!('fonts' in document)) return Promise.resolve();
  return document.fonts.ready.then(() => undefined);
}

function loadWebFonts(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();

  const existing = document.getElementById(WEB_FONT_LINK_ID) as HTMLLinkElement | null;
  if (existing?.sheet) return waitForLoadedFonts();

  return new Promise<void>((resolve) => {
    const link = existing ?? document.createElement('link');
    link.addEventListener('load', () => void waitForLoadedFonts().then(resolve), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });

    if (existing) return;
    link.id = WEB_FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href = WEB_FONT_STYLESHEET;
    document.head.append(link);
  });
}

/** Start loading before React renders so the boot gate can prevent a late font swap. */
export const webFontsReady = loadWebFonts();
