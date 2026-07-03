import { useEffect, useLayoutEffect, useState } from 'react';
import type { GameState } from '../game/types';
import { t } from '../i18n';

/** 進入某教學步驟時的遊戲狀態快照，供 completeWhen 比對變化 */
export interface TutorialEntrySnapshot {
  step: string;
  turnNumber: number;
}

export interface TutorialStep {
  phase: string;
  /** css selector(s) of element(s) to highlight; null => centered modal. 陣列可挖多個洞（如戰鬥區+時鐘） */
  target: string | string[] | null;
  title: string;
  body: string;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  padding?: number;
  /** 操作步驟：條件達成時自動推進（取代手動 Next）。未定義即為導覽步驟。 */
  completeWhen?: (G: GameState, entry: TutorialEntrySnapshot | null) => boolean;
  /** 條件式步驟：進入時若回傳 true 則自動跳過（例如該回合無效果卡） */
  skipWhen?: (G: GameState) => boolean;
  /** 動態文案分支：根據遊戲狀態回傳 title/body 的 i18n key，覆蓋靜態 title/body。 */
  resolveKeys?: (G: GameState) => { title: string; body: string };
  /** 導覽步驟但隱藏 Next/Prev：只能透過特定操作（如點擊彈窗確認按鈕）推進 */
  hideNext?: boolean;
  /** 標記此步驟可由 GameNotice 彈窗的確認按鈕推進（如時鐘推進、HP 計算彈窗）。
   *  解決多回合場景中同類步驟（clock-advance/hp-calc）重複出現時的 findIndex 問題。 */
  advanceOnNoticeDismiss?: boolean;
}

type Rect = { x: number; y: number; w: number; h: number };

function useTargetRects(selector: string | string[] | null, pad: number, stepKey: number): Rect[] {
  const [rects, setRects] = useState<Rect[]>([]);

  useLayoutEffect(() => {
    const selectors = selector ? (Array.isArray(selector) ? selector : [selector]) : [];

    if (selectors.length === 0) {
      setRects([]);
      return;
    }

    let raf = 0;
    const measure = () => {
      const next: Rect[] = [];
      for (const sel of selectors) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) continue;
        const r = el.getBoundingClientRect();
        next.push({
          x: r.left - pad,
          y: r.top - pad,
          w: r.width + pad * 2,
          h: r.height + pad * 2,
        });
      }
      setRects(next);
    };

    measure();
    const tick = () => {
      measure();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, [selector, pad, stepKey]);

  return rects;
}

interface GameTutorialOverlayProps {
  steps: TutorialStep[];
  currentStep: number;
  gameState: GameState | null;
  onNext: () => void;
  onComplete: () => void;
  onSkip: () => void;
}

export function GameTutorialOverlay({
  steps,
  currentStep,
  gameState,
  onNext,
  onComplete,
  onSkip,
}: GameTutorialOverlayProps) {
  const current = steps[currentStep];
  const resolved = current.resolveKeys && gameState ? current.resolveKeys(gameState) : null;
  const titleKey = resolved?.title ?? current.title;
  const bodyKey = resolved?.body ?? current.body;
  const rects = useTargetRects(current.target, current.padding ?? 12, currentStep);
  const [vp, setVp] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const update = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const isLast = currentStep === steps.length - 1;
  // 操作步驟：有 completeWhen，需用戶在遊戲中實際操作才會推進，故隱藏 Next/Prev
  const isActionStep = Boolean(current.completeWhen);
  const hasRects = rects.length > 0;
  const isMobileViewport = vp.w > 0 && vp.w <= 768;

  // Tooltip placement calculation
  const tipW = 380;
  const tipH = 220;
  const gap = 20;
  // 無 target 或明確 center 且無 rect：置中；有 rect 時一律避開高亮區
  const placement = current.placement ?? (hasRects ? 'bottom' : 'center');

  // 計算所有 rects 的聯集 bounding box，tooltip 避開此區域
  const union = hasRects
    ? rects.reduce(
        (acc, r) => ({
          minX: Math.min(acc.minX, r.x),
          minY: Math.min(acc.minY, r.y),
          maxX: Math.max(acc.maxX, r.x + r.w),
          maxY: Math.max(acc.maxY, r.y + r.h),
        }),
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
      )
    : null;

  let tipX: number;
  let tipY: number;

  if (union) {
    const ux = union.minX;
    const uy = union.minY;
    const uw = union.maxX - union.minX;
    const uh = union.maxY - union.minY;
    const clampX = (x: number) => Math.min(Math.max(x, 8), Math.max(8, vp.w - tipW - 8));
    const clampY = (y: number) => Math.min(Math.max(y, 8), Math.max(8, vp.h - tipH - 8));

    const tryVertical = (dir: 'bottom' | 'top') => {
      const x = clampX(ux + uw / 2 - tipW / 2);
      const y = dir === 'bottom' ? uy + uh + gap : uy - tipH - gap;
      const overlaps = y < uy + uh && y + tipH > uy;
      const inBounds = y >= 8 && y + tipH <= vp.h - 8;
      if (inBounds && !overlaps) return { x, y };
      const fy = dir === 'bottom' ? uy - tipH - gap : uy + uh + gap;
      const foverlaps = fy < uy + uh && fy + tipH > uy;
      const finBounds = fy >= 8 && fy + tipH <= vp.h - 8;
      if (finBounds && !foverlaps) return { x, y: fy };
      return null;
    };
    const tryHorizontal = (dir: 'right' | 'left') => {
      const y = clampY(uy + uh / 2 - tipH / 2);
      const x = dir === 'right' ? ux + uw + gap : ux - tipW - gap;
      const overlaps = x < ux + uw && x + tipW > ux;
      const inBounds = x >= 8 && x + tipW <= vp.w - 8;
      if (inBounds && !overlaps) return { x, y };
      const fx = dir === 'right' ? ux - tipW - gap : ux + uw + gap;
      const foverlaps = fx < ux + uw && fx + tipW > ux;
      const finBounds = fx >= 8 && fx + tipW <= vp.w - 8;
      if (finBounds && !foverlaps) return { x: fx, y };
      return null;
    };

    const order: ('top' | 'bottom' | 'left' | 'right')[] =
      placement === 'top'
        ? ['top', 'bottom', 'right', 'left']
        : placement === 'left'
          ? ['left', 'right', 'top', 'bottom']
          : placement === 'right'
            ? ['right', 'left', 'top', 'bottom']
            : ['bottom', 'top', 'right', 'left'];

    let pos: { x: number; y: number } | null = null;
    for (const dir of order) {
      pos = dir === 'top' || dir === 'bottom' ? tryVertical(dir) : tryHorizontal(dir);
      if (pos) break;
    }

    if (pos) {
      tipX = pos.x;
      tipY = pos.y;
    } else {
      const below = uy + uh + gap;
      tipX = clampX(ux + uw / 2 - tipW / 2);
      tipY = below + tipH <= vp.h - 8 ? clampY(below) : clampY(uy - tipH - gap);
    }
  } else {
    tipX = vp.w / 2 - tipW / 2;
    tipY = vp.h / 2 - tipH / 2;
  }

  tipX = Math.min(Math.max(tipX, 8), Math.max(8, vp.w - tipW - 8));
  tipY = Math.min(Math.max(tipY, 8), Math.max(8, vp.h - tipH - 8));

  const mobileSheetAtTop = Boolean(isMobileViewport && union && union.maxY > vp.h * 0.55);
  const tooltipStyle = isMobileViewport
    ? {
        left: '12px',
        right: '12px',
        width: 'auto',
        top: mobileSheetAtTop ? 'calc(env(safe-area-inset-top) + 10px)' : 'auto',
        bottom: mobileSheetAtTop ? 'auto' : 'calc(env(safe-area-inset-bottom) + 10px)',
        transition: 'transform 250ms ease',
      }
    : {
        width: `${tipW}px`,
        left: `${tipX}px`,
        top: `${tipY}px`,
        transition: 'left 250ms ease, top 250ms ease',
      };

  // 點擊攔截：有 rects 時用 4-div 包圍法包圍所有 rects 的聯集 bbox
  // 聯集 bbox 外的四個區域各放一個攔截 div，聯集 bbox 內部（含所有高亮區）可點擊穿透到下方遊戲
  // 無 rects 時用單一全屏 blocker 攔截所有點擊
  const renderClickBlockers = () => {
    if (!hasRects || !union) {
      return <div className="tutorial-click-blocker" style={{ left: 0, top: 0, width: vp.w, height: vp.h }} />;
    }
    const ux = union.minX;
    const uy = union.minY;
    const uw = union.maxX - union.minX;
    const uh = union.maxY - union.minY;
    return (
      <>
        {/* 上方帶狀 */}
        <div className="tutorial-click-blocker" style={{ left: 0, top: 0, width: vp.w, height: Math.max(0, uy) }} />
        {/* 下方帶狀 */}
        <div
          className="tutorial-click-blocker"
          style={{ left: 0, top: uy + uh, width: vp.w, height: Math.max(0, vp.h - (uy + uh)) }}
        />
        {/* 左方帶狀（聯集 bbox 高度範圍內） */}
        <div className="tutorial-click-blocker" style={{ left: 0, top: uy, width: Math.max(0, ux), height: uh }} />
        {/* 右方帶狀（聯集 bbox 高度範圍內） */}
        <div
          className="tutorial-click-blocker"
          style={{ left: ux + uw, top: uy, width: Math.max(0, vp.w - (ux + uw)), height: uh }}
        />
      </>
    );
  };

  return (
    <div className="tutorial-game-overlay fixed inset-0 z-[1000]">
      {/* 視覺遮罩：SVG mask 挖洞，pointer-events: none 不攔截點擊 */}
      <svg
        className="absolute inset-0 h-full w-full"
        width={vp.w}
        height={vp.h}
        aria-hidden="true"
        style={{ pointerEvents: 'none' }}
      >
        <defs>
          <mask id="tutorial-game-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {rects.map((r, i) => (
              <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx="6" ry="6" fill="black" />
            ))}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(8,8,12,0.82)"
          mask="url(#tutorial-game-mask)"
          style={{ transition: 'all 250ms ease' }}
        />
        {rects.map((r, i) => (
          <rect
            key={i}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            rx="6"
            ry="6"
            fill="none"
            stroke="oklch(0.74 0.09 80)"
            strokeWidth="2"
            style={{ transition: 'all 250ms ease' }}
          />
        ))}
      </svg>

      {renderClickBlockers()}

      {/* Tutorial tooltip card */}
      <div
        className={`tutorial-tooltip absolute rounded-sm bg-gradient-to-br from-lacquer-deep via-lacquer-deep to-lacquer p-5 text-bone shadow-[0_30px_80px_-20px] shadow-black/90 ring-1 ring-gold/40 backdrop-blur ${
          mobileSheetAtTop ? 'tutorial-tooltip--mobile-top' : ''
        }`}
        style={tooltipStyle}
      >
        {/* Header */}
        <div className="tutorial-tooltip-header mb-3 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold/70">
            {String(currentStep + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}
          </span>
          <button
            onClick={onSkip}
            className="tutorial-tooltip-action tutorial-tooltip-close text-[10px] uppercase tracking-[0.3em] text-bone/40 transition hover:text-vermilion"
            type="button"
          >
            {t('common.close')}
          </button>
        </div>

        {/* Content */}
        <div className="tutorial-tooltip-body">
          <h3 className="font-display text-2xl italic leading-tight text-bone">{t(titleKey as never)}</h3>
          <p className="mt-3 text-[13px] leading-relaxed text-bone/75">{t(bodyKey as never)}</p>
        </div>

        {/* Footer：操作按鈕與提示 */}
        <div className="tutorial-tooltip-footer mt-5 flex flex-col gap-3">
          {/* Navigation / action hint */}
          {isActionStep || current.hideNext ? (
            <div className="flex justify-center">
              <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold/60">
                {t('common.continue')}
              </span>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <button
                onClick={isLast ? onComplete : onNext}
                className="tutorial-tooltip-action bg-gold px-4 py-1.5 text-[10px] font-medium uppercase tracking-[0.3em] text-lacquer transition hover:bg-bone active:scale-95"
                type="button"
              >
                {isLast ? t('common.confirm') : t('common.next')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
