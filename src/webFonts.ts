export const WEB_FONT_STYLESHEET =
  'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Kaisei+Tokumin:wght@400;500;700;800&family=Noto+Sans:wght@400;500;600;700;800;900&family=Noto+Sans+HK:wght@400;500;600;700;800;900&family=Noto+Sans+JP:wght@400;500;600;700;800;900&family=Noto+Sans+KR:wght@400;500;600;700;800;900&family=Noto+Sans+SC:wght@400;500;600;700;800;900&family=Noto+Sans+TC:wght@400;500;600;700;800;900&display=swap';

const WEB_FONT_LINK_ID = 'zutomayo-web-fonts';

function appendWebFontStylesheet(): void {
  if (document.getElementById(WEB_FONT_LINK_ID)) return;
  const link = document.createElement('link');
  link.id = WEB_FONT_LINK_ID;
  link.rel = 'stylesheet';
  link.href = WEB_FONT_STYLESHEET;
  document.head.append(link);
}

/** Keep the remote multi-locale font catalog off the critical rendering path. */
export function scheduleWebFonts(): void {
  const appendWhenIdle = () => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(appendWebFontStylesheet, { timeout: 3_000 });
      return;
    }
    globalThis.setTimeout(appendWebFontStylesheet, 0);
  };
  const schedule = () => globalThis.setTimeout(appendWhenIdle, 5_000);

  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
}
