import { useMemo, useState } from 'react';
import { Client } from 'boardgame.io/react';
import { Local } from 'boardgame.io/multiplayer';
import type { BoardProps } from 'boardgame.io/react';
import { createZutomayoCard } from '../game/Game';
import { Board } from './Board';
import { useAIMoves, type ZutomayoMoveDispatchers } from '../game/useAIMoves';
import type { AIDifficulty } from '../game/ai';
import type { GameState } from '../game/types';
import { t } from '../i18n';

interface AIGameProps {
  difficulty: AIDifficulty;
  onBack: () => void;
  deck0Name?: string;
  deck1Name?: string;
}

function difficultyLabel(difficulty: AIDifficulty): string {
  if (difficulty === 'easy') return t('difficulty.easy');
  if (difficulty === 'hard') return t('difficulty.hard');
  return t('difficulty.normal');
}

function AIBoard(props: BoardProps<GameState> & { difficulty: AIDifficulty }) {
  const { difficulty, ...boardProps } = props;
  const aiMoves = useMemo<ZutomayoMoveDispatchers>(() => ({
    janken: boardProps.moves.janken,
    keepHand: boardProps.moves.keepHand,
    setInitialCard: boardProps.moves.setInitialCard,
    setTurnCard: boardProps.moves.setTurnCard,
    confirmReady: boardProps.moves.confirmReady,
    resolvePendingEffect: boardProps.moves.resolvePendingEffect,
  }), [boardProps.moves]);

  useAIMoves(boardProps.G, boardProps.ctx, aiMoves, boardProps.playerID || '0', difficulty);
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
    <div className="app game-app">
      <header className="game-header">
        <button className="back-btn" type="button" onClick={onBack}>{t('common.backToLobby')}</button>
        <div>
          <strong>{t('game.aiMode')}</strong>
          <span>{difficultyLabel(difficulty)}</span>
        </div>
      </header>
      <div className="game-container single">
        <AIClient playerID="0" />
        <div className="hidden-client">
          <AIClient playerID="1" />
        </div>
      </div>
    </div>
  );
}
