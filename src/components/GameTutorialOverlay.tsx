import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';
import type { GameState } from '../game/types';
import { t } from '../i18n';

export type TutorialPhase =
  | 'intro'
  | 'janken-intro'
  | 'janken-action'
  | 'janken-result'
  | 'mulligan-intro'
  | 'mulligan-action'
  | 'initial-set-intro'
  | 'initial-set-action'
  | 'zones-explain'
  | 'chronos-explain'
  | 'resources-explain'
  | 'turn-set-intro'
  | 'turn-set-action'
  | 'effect-order-intro'
  | 'effect-order-action'
  | 'battle-intro'
  | 'battle-result'
  | 'catchup-explain'
  | 'victory-explain'
  | 'complete';

export interface TutorialStep {
  phase: TutorialPhase;
  target: string | null;
  title: string;
  body: string;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  padding?: number;
  waitForGamePhase?: string;
  waitForUserAction?: boolean;
  allowedInteractions?: string[];
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
  gameState: GameState | null; // eslint-disable-line @typescript-eslint/no-unused-vars
  onNext: () => void;
  onPrev: () => void;
  onComplete: () => void;
  onSkip: () => void;
}

export function GameTutorialOverlay({
  steps,
  currentStep,
  onNext,
  onPrev,
  onComplete,
  onSkip,
}: GameTutorialOverlayProps) {
  const current = steps[currentStep];
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

  // Click interception handler
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (!current.waitForUserAction) return;

    const target = e.target as HTMLElement;
    const allowed = current.allowedInteractions?.some((selector) => target.closest(selector));

    if (!allowed) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <div
      className="tutorial-game-overlay fixed inset-0 z-[1000]"
    >
      {/* SVG mask: dark overlay with rounded cutout around target */}
      <svg
        className="absolute inset-0 h-full w-full pointer-events-auto"
        width={vp.w}
        height={vp.h}
        aria-hidden="true"
        onClick={handleOverlayClick}
        onMouseDown={handleOverlayClick}
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
          fill="rgba(8,8,12,0.85)"
          mask="url(#tutorial-game-mask)"
          style={{ transition: 'all 250ms ease' } as CSSProperties}
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
            style={{ transition: 'all 250ms ease' } as CSSProperties}
          />
        )}
      </svg>

      {/* Tutorial tooltip card */}
      <div
        className="absolute rounded-sm bg-gradient-to-br from-lacquer-deep via-lacquer-deep to-lacquer p-5 text-bone shadow-[0_30px_80px_-20px] shadow-black/90 ring-1 ring-gold/40 backdrop-blur"
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
            Step {String(currentStep + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}
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
        <h3 className="font-display text-2xl italic leading-tight text-bone">{t(current.title as any)}</h3>
        <p className="mt-3 text-[13px] leading-relaxed text-bone/75">{t(current.body as any)}</p>

        {/* Footer */}
        <div className="mt-5 flex items-center justify-between">
          {/* Progress dots */}
          <div className="flex gap-1">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1 w-4 transition ${
                  i === currentStep ? 'bg-gold' : i < currentStep ? 'bg-bone/30' : 'bg-bone/10'
                }`}
              />
            ))}
          </div>

          {/* Navigation buttons */}
          <div className="flex gap-2">
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
              className="bg-bone px-4 py-1.5 text-[10px] font-medium uppercase tracking-[0.3em] text-lacquer transition active:scale-95"
              type="button"
            >
              {isLast ? t('tutorial.complete') : t('common.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
