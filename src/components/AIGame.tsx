import { useMemo, useState, useEffect } from 'react';
import { Client } from 'boardgame.io/react';
import { Local } from 'boardgame.io/multiplayer';
import type { BoardProps } from 'boardgame.io/react';
import { createZutomayoCard } from '../game/Game';
import { Board, type BoardGameOverActions, type TutorialBoardAction } from './Board';
import { useAIMoves, type ZutomayoMoveDispatchers, type TutorialAIScript } from '../game/useAIMoves';
import type { AIDifficulty } from '../game/ai';
import type { GameState } from '../game/types';
import { Sentry } from '../sentry';
import { t } from '../i18n';
import { PageShell } from '../ui';

interface AIGameProps {
  difficulty: AIDifficulty;
  onBack: () => void;
  onRematch?: () => void;
  onChooseSetup?: () => void;
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
  onTutorialAction?: (action: TutorialBoardAction, cardDefId: string) => void;
  /** 教學模式：限制目前步驟可從手牌打出的卡，避免偏離固定劇本。 */
  tutorialAllowedSetCardDefIds?: string[];
  /** 教學模式：確認前必須已放置的卡，支援敗者回合的兩張卡引導。 */
  tutorialRequiredSetCardDefIds?: string[];
  /** 教學模式：僅在實作出牌的步驟開放手牌與確認操作。 */
  tutorialSetInteractionEnabled?: boolean;
  /** 從安全檢查點重建教學對局，重放至指定階段。 */
  tutorialAutoReplay?: 'flow' | 'turn2' | 'effects';
  /** 重建檢查點期間不顯示已快速重放的歷史通知。 */
  tutorialSuppressNotices?: boolean;
  /** 教學控制效果／指定選擇覆蓋層何時出現。 */
  tutorialEffectOverlayVisible?: boolean;
  /** 教學敘事用顯示快照；只套用到玩家可見的 Board，不參與規則與 AI。 */
  tutorialPresentationState?: GameState;
}

type AIBoardProps = BoardProps<GameState> & {
  difficulty: AIDifficulty;
  onGameStateChange?: (state: GameState) => void;
  tutorialMode?: boolean;
  hideSetupOverlay?: boolean;
  aiPaused?: boolean;
  aiScript?: TutorialAIScript;
  onSetupFeedbackDismiss?: () => void;
  onNoticeDismiss?: () => void;
  onTutorialAction?: (action: TutorialBoardAction, cardDefId: string) => void;
  tutorialAllowedSetCardDefIds?: string[];
  tutorialRequiredSetCardDefIds?: string[];
  tutorialSetInteractionEnabled?: boolean;
  tutorialAutoReplay?: 'flow' | 'turn2' | 'effects';
  tutorialSuppressNotices?: boolean;
  tutorialEffectOverlayVisible?: boolean;
  tutorialPresentationState?: GameState;
  gameOverActions?: BoardGameOverActions;
};

function AIBoard(props: AIBoardProps) {
  const {
    difficulty,
    onGameStateChange,
    tutorialMode,
    hideSetupOverlay,
    aiPaused,
    aiScript,
    onSetupFeedbackDismiss,
    onNoticeDismiss,
    onTutorialAction,
    tutorialAllowedSetCardDefIds,
    tutorialRequiredSetCardDefIds,
    tutorialSetInteractionEnabled,
    tutorialAutoReplay,
    tutorialSuppressNotices,
    tutorialEffectOverlayVisible,
    tutorialPresentationState,
    gameOverActions,
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
    Boolean(tutorialAutoReplay),
  );

  useEffect(() => {
    if (!tutorialAutoReplay || boardProps.playerID !== '0' || boardProps.ctx.gameover) return;
    const timer = setTimeout(() => {
      const G = boardProps.G;
      const player = G.players[0];
      if (G.step === 'janken' && !G.jankenChoices[0]) {
        boardProps.moves.janken('rock');
        return;
      }
      if (G.step === 'mulligan' && !G.mulliganUsed[0]) {
        const redrawIndex = player.hand.findIndex((card) => card.defId === '1st_2');
        boardProps.moves.mulligan(redrawIndex >= 0 ? [redrawIndex] : []);
        return;
      }
      if (G.step === 'initialSet' && !G.ready[0]) {
        if (player.cardsSetThisTurn === 0) {
          const initialCardIndex = player.hand.findIndex((card) => card.defId === '1st_70');
          if (initialCardIndex >= 0) boardProps.moves.setInitialCard(initialCardIndex);
          return;
        }
        boardProps.moves.confirmReady();
        return;
      }
      if (tutorialAutoReplay !== 'effects' || G.step !== 'turnSet' || G.ready[0]) return;
      if (player.cardsSetThisTurn === 0) {
        const characterIndex = player.hand.findIndex((card) => card.defId === '1st_46');
        if (characterIndex >= 0) boardProps.moves.setTurnCard(characterIndex, 'A');
        return;
      }
      if (player.cardsSetThisTurn === 1) {
        const areaIndex = player.hand.findIndex((card) => card.defId === '2nd_98');
        if (areaIndex >= 0) boardProps.moves.setTurnCard(areaIndex, 'B');
        return;
      }
      boardProps.moves.confirmReady();
    }, 50);
    return () => clearTimeout(timer);
  }, [boardProps.G, boardProps.ctx.gameover, boardProps.moves, boardProps.playerID, tutorialAutoReplay]);

  // Notify parent of game state changes (for tutorial)
  useEffect(() => {
    if (onGameStateChange && boardProps.playerID === '0') {
      onGameStateChange(boardProps.G);
    }
  }, [boardProps.G, boardProps.playerID, onGameStateChange]);

  // AI 對戰時我方顯示為「玩家」、對手顯示為「電腦」。
  return (
    <Board
      {...boardProps}
      G={boardProps.playerID === '0' && tutorialPresentationState ? tutorialPresentationState : boardProps.G}
      selfLabel={t('player.self' as never)}
      opponentLabel={t('player.ai' as never)}
      tutorialMode={tutorialMode}
      hideSetupOverlay={hideSetupOverlay}
      onSetupFeedbackDismiss={onSetupFeedbackDismiss}
      onNoticeDismiss={onNoticeDismiss}
      onTutorialAction={onTutorialAction}
      tutorialAllowedSetCardDefIds={tutorialAllowedSetCardDefIds}
      tutorialRequiredSetCardDefIds={tutorialRequiredSetCardDefIds}
      tutorialSetInteractionEnabled={tutorialSetInteractionEnabled}
      tutorialAutoReplay={tutorialAutoReplay}
      tutorialSuppressNotices={tutorialSuppressNotices}
      tutorialEffectOverlayVisible={tutorialEffectOverlayVisible}
      gameOverActions={gameOverActions}
    />
  );
}

export function AIGame({
  difficulty,
  onBack,
  onRematch,
  onChooseSetup,
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
  onTutorialAction,
  tutorialAllowedSetCardDefIds,
  tutorialRequiredSetCardDefIds,
  tutorialSetInteractionEnabled,
  tutorialAutoReplay,
  tutorialSuppressNotices,
  tutorialEffectOverlayVisible,
  tutorialPresentationState,
}: AIGameProps) {
  // 標記對戰模式（AI / tutorial），便於 Sentry 後台區分錯誤來源。
  useEffect(() => {
    Sentry.setTag('match_mode', tutorialMode ? 'tutorial' : 'ai');
    return () => {
      Sentry.setTag('match_mode', undefined);
    };
  }, [tutorialMode]);

  const [AIClient] = useState(() =>
    Client<GameState, AIBoardProps>({
      game: createZutomayoCard({ deck0Name, deck1Name, deck0Ids, deck1Ids, skipShuffle }),
      board: AIBoard,
      numPlayers: 2,
      multiplayer: Local(),
      debug: false,
    }),
  );

  const gameOverActions: BoardGameOverActions | undefined =
    !tutorialMode && onRematch && onChooseSetup
      ? {
          primary: { label: t('board.playAgain'), onClick: onRematch },
          secondary: {
            label: t('board.result.changeSetup'),
            onClick: onChooseSetup,
            variant: 'secondary',
          },
          tertiary: { label: t('common.backToLobby'), onClick: onBack, variant: 'secondary' },
        }
      : undefined;
  const dynamicBoardProps = {
    difficulty,
    onGameStateChange,
    tutorialMode,
    hideSetupOverlay,
    aiPaused,
    aiScript,
    onSetupFeedbackDismiss,
    onNoticeDismiss,
    onTutorialAction,
    tutorialAllowedSetCardDefIds,
    tutorialRequiredSetCardDefIds,
    tutorialSetInteractionEnabled,
    tutorialAutoReplay,
    tutorialSuppressNotices,
    tutorialEffectOverlayVisible,
    tutorialPresentationState,
    gameOverActions,
  };

  return (
    <PageShell>
      <div className="board-client-frame h-full w-full">
        <AIClient playerID="0" {...dynamicBoardProps} />
        <div className="hidden-client">
          <AIClient playerID="1" {...dynamicBoardProps} />
        </div>
      </div>
    </PageShell>
  );
}
