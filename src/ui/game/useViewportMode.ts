import { useEffect, useState } from 'react';

/**
 * 對戰頁佈局模式（見 docs/uiux/responsive-layout-system.md）：
 * - desktop:        >=1024px 寬的橫向視口（含平板橫屏、低高度桌面）
 * - tabletPortrait: 768–1023px 直屏（直向戰場，佈局同 mobile 但尺寸放大）
 * - mobile:         <768px（手機直/橫屏，專用 UI）
 *
 * isTouch 與 mode 正交：平板橫屏是 desktop 佈局 + 觸控互動。
 */
export type BattleViewportMode = 'desktop' | 'tabletPortrait' | 'mobile';

export type BattleViewport = {
  mode: BattleViewportMode;
  /** coarse pointer：不依賴 hover，詳情改用 bottom sheet / side sheet */
  isTouch: boolean;
  /** 低高度桌面（<=780px 高的 desktop）：壓縮裝飾與間距 */
  isShort: boolean;
};

const QUERIES = {
  desktop: '(min-width: 64rem)',
  tablet: '(min-width: 48rem)',
  touch: '(hover: none), (pointer: coarse)',
  short: '(max-height: 48.75rem)',
} as const;

function readViewport(): BattleViewport {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return { mode: 'desktop', isTouch: false, isShort: false };
  }
  const desktop = window.matchMedia(QUERIES.desktop).matches;
  const tablet = window.matchMedia(QUERIES.tablet).matches;
  const isTouch = window.matchMedia(QUERIES.touch).matches;
  const isShort = window.matchMedia(QUERIES.short).matches;
  const mode: BattleViewportMode = desktop ? 'desktop' : tablet ? 'tabletPortrait' : 'mobile';
  return { mode, isTouch, isShort };
}

export function useViewportMode(): BattleViewport {
  const [viewport, setViewport] = useState<BattleViewport>(readViewport);

  useEffect(() => {
    const lists = Object.values(QUERIES).map((query) => window.matchMedia(query));
    const update = () => setViewport(readViewport());
    for (const list of lists) list.addEventListener('change', update);
    return () => {
      for (const list of lists) list.removeEventListener('change', update);
    };
  }, []);

  return viewport;
}
