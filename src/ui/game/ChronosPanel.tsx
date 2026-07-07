import type { ChronosState, ChronosTime, PlayerIndex } from '../../game/types';
import { ChronosDial } from './ChronosDial';

/**
 * ChronosPanel — Chronos 儀表的佈局容器。
 * 呈現為 ChronosDial（素材底圖 + 規則讀數）；尺寸由 game.css 依斷點以 clamp 控制。
 */
export interface ChronosPanelProps {
  chronos: ChronosState;
  currentTime: ChronosTime;
  currentPlayer: PlayerIndex;
  size?: 'md' | 'sm';
}

export function ChronosPanel({ chronos, currentTime, currentPlayer, size = 'md' }: ChronosPanelProps) {
  return (
    <div className={`chronospanel chronospanel-${size}`} data-tut="chronos-clock">
      <ChronosDial chronos={chronos} currentTime={currentTime} currentPlayer={currentPlayer} />
    </div>
  );
}
