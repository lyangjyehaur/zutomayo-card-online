import { useState } from 'react';
import { Client } from 'boardgame.io/react';
import { Local } from 'boardgame.io/multiplayer';
import { BoardProps } from 'boardgame.io/react';
import { createZutomayoCard } from '../game/Game';
import { Board } from './Board';
import { useAIMoves } from '../game/useAIMoves';
import type { AIDifficulty } from '../game/ai';
import type { GameState } from '../game/types';

interface AIGameProps {
  difficulty: AIDifficulty;
  onBack: () => void;
  deck0Name?: string;
  deck1Name?: string;
}

// Board wrapper that runs AI for player 1
function AIBoard(props: BoardProps<GameState> & { difficulty: AIDifficulty }) {
  const { difficulty, ...boardProps } = props;
  useAIMoves(boardProps.G, boardProps.ctx, boardProps.moves, boardProps.playerID || '0', difficulty);
  return <Board {...boardProps} />;
}

export function AIGame({ difficulty, onBack, deck0Name, deck1Name }: AIGameProps) {
  const [AIClient] = useState(() => Client({
    game: createZutomayoCard({ deck0Name, deck1Name }),
    board: (props: BoardProps<GameState>) => <AIBoard {...props} difficulty={difficulty} />,
    numPlayers: 2,
    multiplayer: Local(),
    debug: false,
  }));

  return (
    <div className="app">
      <div className="ai-header">
        <button className="back-btn" onClick={onBack}>← Back to Lobby</button>
        <span className="ai-label">🤖 Practice Mode — AI: {difficulty.toUpperCase()}</span>
      </div>
      <div className="game-container single">
        {/* Human plays as player 0 */}
        <AIClient playerID="0" />
        {/* AI plays as player 1 — hidden but active */}
        <div style={{ display: 'none' }}>
          <AIClient playerID="1" />
        </div>
      </div>
    </div>
  );
}
