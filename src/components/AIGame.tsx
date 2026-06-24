import { useState } from 'react';
import { Client } from 'boardgame.io/react';
import { Local } from 'boardgame.io/multiplayer';
import { BoardProps } from 'boardgame.io/react';
import { ZutomayoCard } from '../game/Game';
import { Board } from './Board';
import { useAIMoves } from '../game/useAIMoves';
import type { AIDifficulty } from '../game/ai';
import type { GameState } from '../game/types';

interface AIGameProps {
  difficulty: AIDifficulty;
  onBack: () => void;
}

// Board wrapper that runs AI for player 1
function AIBoard(props: BoardProps<GameState> & { difficulty: AIDifficulty }) {
  const { difficulty, ...boardProps } = props;
  useAIMoves(boardProps.G, boardProps.ctx, boardProps.moves, boardProps.playerID || '0', difficulty);
  return <Board {...boardProps} />;
}

export function AIGame({ difficulty, onBack }: AIGameProps) {
  // Fresh client on each mount — unmounting (going back to lobby) destroys it
  const [AIClient] = useState(() => Client({
    game: ZutomayoCard,
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
        <AIClient playerID="0" />
      </div>
    </div>
  );
}
