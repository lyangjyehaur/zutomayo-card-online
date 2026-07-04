import type { ChronosState, ChronosTime, PlayerIndex } from '../../game/types';
import { Chronos } from '../Chronos';

/**
 * ChronosPanel — Chronos 時鐘的佈局容器。
 * 錶盤 SVG 本體沿用 Chronos 元件；尺寸由 battle.css 依斷點以 clamp 控制
 * （桌面完整錶盤 → 行動端緊湊錶盤），保證位置/晝夜/夜側玩家永遠可讀。
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
      <Chronos
        chronos={chronos}
        currentTime={currentTime}
        nightSidePlayer={chronos.nightSidePlayer}
        currentPlayer={currentPlayer}
      />
    </div>
  );
}
