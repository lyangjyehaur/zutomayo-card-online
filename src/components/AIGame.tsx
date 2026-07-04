import { useMemo, useState, useEffect, useRef } from 'react';
import { Client } from 'boardgame.io/react';
import { Local } from 'boardgame.io/multiplayer';
import type { BoardProps } from 'boardgame.io/react';
import { createZutomayoCard } from '../game/Game';
import { Board } from './Board';
import { useAIMoves, type ZutomayoMoveDispatchers, type TutorialAIScript } from '../game/useAIMoves';
import type { AIDifficulty } from '../game/ai';
import type { GameState } from '../game/types';
import { t } from '../i18n';
import { PageShell } from '../ui';

interface AIGameProps {
  difficulty: AIDifficulty;
  onBack: () => void;
  deck0Name?: string;
  deck1Name?: string;
  /** 固定牌組（教學模式）：優先於 deck0Name/deck1Name */
  deck0Ids?: string[];
  deck1Ids?: string[];
  /** 教學模式：跳過洗牌，讓固定牌組依陣列順序進入牌庫 */
  skipShuffle?: boolean;
  /** 教學模式：AI 腳本，覆寫 AI 隨機決策確保劇本可預測 */
  aiScript?: TutorialAIScript;
  onGameStateChange?: (state: GameState) => void;
  tutorialMode?: boolean;
  hideSetupOverlay?: boolean;
  aiPaused?: boolean;
  onSetupFeedbackDismiss?: () => void;
  onNoticeDismiss?: () => void;
}

function AIBoard(
  props: BoardProps<GameState> & {
    difficulty: AIDifficulty;
    onGameStateChange?: (state: GameState) => void;
    tutorialMode?: boolean;
    hideSetupOverlay?: boolean;
    aiPaused?: boolean;
    aiScript?: TutorialAIScript;
    onSetupFeedbackDismiss?: () => void;
    onNoticeDismiss?: () => void;
  },
) {
  const {
    difficulty,
    onGameStateChange,
    tutorialMode,
    hideSetupOverlay,
    aiPaused,
    aiScript,
    onSetupFeedbackDismiss,
    onNoticeDismiss,
    ...boardProps
  } = props;
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

  useAIMoves(
    boardProps.G,
    boardProps.ctx,
    aiMoves,
    boardProps.playerID || '0',
    difficulty,
    tutorialMode,
    aiPaused,
    aiScript,
  );

  // Notify parent of game state changes (for tutorial)
  useEffect(() => {
    if (onGameStateChange) {
      onGameStateChange(boardProps.G);
    }
  }, [boardProps.G, onGameStateChange]);

  // AI 對戰時我方顯示為「玩家」、對手顯示為「電腦」。
  return (
    <Board
      {...boardProps}
      selfLabel={t('player.self' as never)}
      opponentLabel={t('player.ai' as never)}
      hideSetupOverlay={hideSetupOverlay}
      onSetupFeedbackDismiss={onSetupFeedbackDismiss}
      onNoticeDismiss={onNoticeDismiss}
    />
  );
}

export function AIGame({
  difficulty,
  deck0Name,
  deck1Name,
  deck0Ids,
  deck1Ids,
  skipShuffle,
  aiScript,
  onGameStateChange,
  tutorialMode,
  hideSetupOverlay,
  aiPaused,
  onSetupFeedbackDismiss,
  onNoticeDismiss,
}: AIGameProps) {
  // 動態 props 用 ref 持有，board 回調從 ref 讀取最新值。
  // Client 只建立一次（useState 初始化），若直接在 board 回調閉包中捕獲 props，
  // 會永遠拿到初始值（如 hideSetupOverlay=true），prop 變化後不會更新。
  const dynamicPropsRef = useRef({
    difficulty,
    onGameStateChange,
    tutorialMode,
    hideSetupOverlay,
    aiPaused,
    aiScript,
    onSetupFeedbackDismiss,
    onNoticeDismiss,
  });
  dynamicPropsRef.current = {
    difficulty,
    onGameStateChange,
    tutorialMode,
    hideSetupOverlay,
    aiPaused,
    aiScript,
    onSetupFeedbackDismiss,
    onNoticeDismiss,
  };

  const [AIClient] = useState(() =>
    Client({
      game: createZutomayoCard({ deck0Name, deck1Name, deck0Ids, deck1Ids, skipShuffle }),
      board: (props: BoardProps<GameState>) => {
        const dp = dynamicPropsRef.current;
        return (
          <AIBoard
            {...props}
            difficulty={dp.difficulty}
            onGameStateChange={dp.onGameStateChange}
            tutorialMode={dp.tutorialMode}
            hideSetupOverlay={dp.hideSetupOverlay}
            aiPaused={dp.aiPaused}
            aiScript={dp.aiScript}
            onSetupFeedbackDismiss={dp.onSetupFeedbackDismiss}
            onNoticeDismiss={dp.onNoticeDismiss}
          />
        );
      },
      numPlayers: 2,
      multiplayer: Local(),
      debug: false,
    }),
  );

  return (
    <PageShell>
      <div className="board-client-frame h-full w-full">
        <AIClient playerID="0" />
        <div className="hidden-client">
          <AIClient playerID="1" />
        </div>
      </div>
    </PageShell>
  );
}
