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
  /** css selector of element to highlight; null => centered modal */
  target: string | null;
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
}

type Rect = { x: number; y: number; w: number; h: number };

function useTargetRect(selector: string | null, pad: number, stepKey: number): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    if (!selector) {
      setRect(null);
      return;
    }

    let raf = 0;
    const measure = () => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({
        x: r.left - pad,
        y: r.top - pad,
        w: r.width + pad * 2,
        h: r.height + pad * 2,
      });
    };

    measure();
    const tick = () => {
      measure();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, [selector, pad, stepKey]);

  return rect;
}

interface GameTutorialOverlayProps {
  steps: TutorialStep[];
  currentStep: number;
  gameState: GameState | null;
  onNext: () => void;
  onPrev: () => void;
  onComplete: () => void;
  onSkip: () => void;
}

export function GameTutorialOverlay({
  steps,
  currentStep,
  gameState,
  onNext,
  onPrev,
  onComplete,
  onSkip,
}: GameTutorialOverlayProps) {
  const current = steps[currentStep];
  const resolved = current.resolveKeys && gameState ? current.resolveKeys(gameState) : null;
  const titleKey = resolved?.title ?? current.title;
  const bodyKey = resolved?.body ?? current.body;
  const rect = useTargetRect(current.target, current.padding ?? 12, currentStep);
  const [vp, setVp] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const update = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const isLast = currentStep === steps.length - 1;
  const isFirst = currentStep === 0;
  // 操作步驟：有 completeWhen，需用戶在遊戲中實際操作才會推進，故隱藏 Next/Prev
  const isActionStep = Boolean(current.completeWhen);

  // Tooltip placement calculation
  const tipW = 380;
  const tipH = 220;
  let tipX = vp.w / 2 - tipW / 2;
  let tipY = vp.h / 2 - tipH / 2;
  const placement = current.placement ?? (rect ? 'bottom' : 'center');

  if (rect && placement !== 'center') {
    const gap = 20;
    if (placement === 'bottom') {
      tipX = Math.min(Math.max(rect.x + rect.w / 2 - tipW / 2, 16), vp.w - tipW - 16);
      tipY = rect.y + rect.h + gap;
      if (tipY + tipH > vp.h - 16) tipY = rect.y - tipH - gap;
    } else if (placement === 'top') {
      tipX = Math.min(Math.max(rect.x + rect.w / 2 - tipW / 2, 16), vp.w - tipW - 16);
      tipY = rect.y - tipH - gap;
      if (tipY < 16) tipY = rect.y + rect.h + gap;
    } else if (placement === 'right') {
      tipX = rect.x + rect.w + gap;
      tipY = Math.min(Math.max(rect.y + rect.h / 2 - tipH / 2, 16), vp.h - tipH - 16);
      if (tipX + tipW > vp.w - 16) tipX = rect.x - tipW - gap;
    } else if (placement === 'left') {
      tipX = rect.x - tipW - gap;
      tipY = Math.min(Math.max(rect.y + rect.h / 2 - tipH / 2, 16), vp.h - tipH - 16);
      if (tipX < 16) tipX = rect.x + rect.w + gap;
    }
  }

  // 邊界防呆：tooltip 不得超出視窗
  tipX = Math.min(Math.max(tipX, 8), Math.max(8, vp.w - tipW - 8));
  tipY = Math.min(Math.max(tipY, 8), Math.max(8, vp.h - tipH - 8));

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
            {rect && <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx="6" ry="6" fill="black" />}
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
        {rect && (
          <rect
            x={rect.x}
            y={rect.y}
            width={rect.w}
            height={rect.h}
            rx="6"
            ry="6"
            fill="none"
            stroke="oklch(0.74 0.09 80)"
            strokeWidth="2"
            style={{ transition: 'all 250ms ease' }}
          />
        )}
      </svg>

      {/* 點擊攔截層：
          - 操作步驟（有 completeWhen）：用 4 個 div 包圍高亮區域，外部被攔截、高亮區可點擊穿透到下方遊戲
          - 導覽步驟：單一全屏 div 攔截所有點擊，僅 tooltip 可互動 */}
      {isActionStep && rect ? (
        <>
          <div
            className="tutorial-click-blocker"
            style={{ left: 0, top: 0, width: vp.w, height: Math.max(0, rect.y) }}
          />
          <div
            className="tutorial-click-blocker"
            style={{ left: 0, top: rect.y + rect.h, width: vp.w, height: Math.max(0, vp.h - (rect.y + rect.h)) }}
          />
          <div
            className="tutorial-click-blocker"
            style={{ left: 0, top: rect.y, width: Math.max(0, rect.x), height: rect.h }}
          />
          <div
            className="tutorial-click-blocker"
            style={{ left: rect.x + rect.w, top: rect.y, width: Math.max(0, vp.w - (rect.x + rect.w)), height: rect.h }}
          />
        </>
      ) : (
        <div className="tutorial-click-blocker" style={{ left: 0, top: 0, width: vp.w, height: vp.h }} />
      )}

      {/* Tutorial tooltip card */}
      <div
        className="tutorial-tooltip absolute rounded-sm bg-gradient-to-br from-lacquer-deep via-lacquer-deep to-lacquer p-5 text-bone shadow-[0_30px_80px_-20px] shadow-black/90 ring-1 ring-gold/40 backdrop-blur"
        style={{
          width: `${tipW}px`,
          left: `${tipX}px`,
          top: `${tipY}px`,
          transition: 'left 250ms ease, top 250ms ease',
        }}
      >
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold/70">
            {String(currentStep + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}
          </span>
          <button
            onClick={onSkip}
            className="text-[10px] uppercase tracking-[0.3em] text-bone/40 transition hover:text-vermilion"
            type="button"
          >
            {t('tutorial.skip')}
          </button>
        </div>

        {/* Content */}
        <h3 className="font-display text-2xl italic leading-tight text-bone">{t(titleKey as never)}</h3>
        <p className="mt-3 text-[13px] leading-relaxed text-bone/75">{t(bodyKey as never)}</p>

        {/* Footer：操作按鈕與提示 */}
        <div className="mt-5 flex flex-col gap-3">
          {/* Navigation / action hint */}
          {isActionStep ? (
            <div className="flex justify-center">
              <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold/60">
                {t('tutorial.actionHint')}
              </span>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              {!isFirst && (
                <button
                  onClick={onPrev}
                  className="border border-bone/20 px-3 py-1.5 text-[10px] uppercase tracking-[0.3em] text-bone/60 transition hover:bg-bone/5"
                  type="button"
                >
                  {t('common.prev')}
                </button>
              )}
              <button
                onClick={isLast ? onComplete : onNext}
                className="bg-gold px-4 py-1.5 text-[10px] font-medium uppercase tracking-[0.3em] text-lacquer transition hover:bg-bone active:scale-95"
                type="button"
              >
                {isLast ? t('tutorial.complete') : t('common.next')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
