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


function AIBoard(props: BoardProps<GameState> & { difficulty: AIDifficulty }) {
  const { difficulty, ...boardProps } = props;
  const aiMoves = useMemo<ZutomayoMoveDispatchers>(
    () => ({
      janken: boardProps.moves.janken,
      keepHand: boardProps.moves.keepHand,
      setInitialCard: boardProps.moves.setInitialCard,
      setTurnCard: boardProps.moves.setTurnCard,
      confirmReady: boardProps.moves.confirmReady,
      resolvePendingEffect: boardProps.moves.resolvePendingEffect,
      submitPendingChoice: boardProps.moves.submitPendingChoice,
    }),
    [boardProps.moves],
  );

  useAIMoves(boardProps.G, boardProps.ctx, aiMoves, boardProps.playerID || '0', difficulty);
  // AI 對戰時我方顯示為「玩家」、對手顯示為「電腦」。
  return <Board {...boardProps} selfLabel={t('player.self' as never)} opponentLabel={t('player.ai' as never)} />;
}

export function AIGame({ difficulty, deck0Name, deck1Name }: AIGameProps) {
  const [AIClient] = useState(() =>
    Client({
      game: createZutomayoCard({ deck0Name, deck1Name }),
      board: (props: BoardProps<GameState>) => <AIBoard {...props} difficulty={difficulty} />,
      numPlayers: 2,
      multiplayer: Local(),
      debug: false,
    }),
  );

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-lacquer-deep font-sans text-bone">
      <div className="board-client-frame h-full w-full">
        <AIClient playerID="0" />
        <div className="hidden-client">
          <AIClient playerID="1" />
        </div>
      </div>
    </div>
  );
}
