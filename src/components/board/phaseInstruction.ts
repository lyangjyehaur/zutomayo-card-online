import { t } from '../../i18n';
import type { GameState, GameStep, PlayerIndex } from '../../game/types';

export type PhaseInstruction = {
  title: string;
  body: string;
  meta: { text: string; done: boolean }[];
};

type PlayerName = (index: PlayerIndex) => string;

export type PhaseInstructionState = {
  step: GameStep;
  players: [{ cardsSetThisTurn: number }, { cardsSetThisTurn: number }];
  ready: GameState['ready'];
  pendingChoice: GameState['pendingChoice'];
  pendingEffectPlayer: GameState['pendingEffectPlayer'];
  pendingEffects: GameState['pendingEffects'];
};

export function getChoiceInstruction(type: string): string {
  if (type === 'handToDeckBottomThenDraw') return t('board.choiceHintDeckBottomDraw');
  if (type === 'reorderOpponentDeckTop') return t('board.choiceHintReorder');
  if (type === 'opponentPowerCharacterSwap') return t('board.choiceHintSwap');
  if (type === 'abyssToDeckBottomOrLose') return t('board.choiceHintAbyss');
  if (type === 'handAbyssSwap') return t('board.choiceHintHandAbyssSwap');
  if (type.includes('Hand') || type.includes('hand')) return t('board.choiceHintHand');
  return t('board.choiceHintDefault');
}

function unhandledPhaseInstruction(step: never): PhaseInstruction {
  // Keep incompatible server payloads playable while making new typed phases fail compilation here.
  void step;
  return { title: t('board.turn'), body: '', meta: [] };
}

export function getPhaseInstruction(
  G: PhaseInstructionState,
  meIndex: PlayerIndex,
  required: number,
  minimum: number,
  playerName: PlayerName,
): PhaseInstruction {
  const me = G.players[meIndex];
  if (G.pendingChoice) {
    const mine = G.pendingChoice.player === meIndex;
    return {
      title: mine ? t('board.phaseChoiceTitle') : t('board.phaseChoiceWaitingTitle'),
      body: mine
        ? getChoiceInstruction(G.pendingChoice.type)
        : `${playerName(G.pendingChoice.player)} ${t('board.phaseChoosing')}`,
      meta: [
        {
          text: `${t('board.choiceRequired')} ${G.pendingChoice.min}–${G.pendingChoice.max}`,
          done: false,
        },
      ],
    };
  }

  switch (G.step) {
    case 'janken':
      return { title: t('board.janken'), body: t('board.jankenHint'), meta: [] };
    case 'mulligan':
      return { title: t('board.mulligan'), body: t('board.mulliganHint'), meta: [] };
    case 'effectOrder': {
      const player = G.pendingEffectPlayer;
      const pendingCount = player === null ? 0 : G.pendingEffects[player].length;
      return {
        title: player === meIndex ? t('board.phaseEffectTitle') : t('board.phaseEffectWaitingTitle'),
        body:
          player === meIndex
            ? t('board.phaseEffectBody')
            : player === null
              ? t('board.phaseEffectResolving')
              : `${playerName(player)} ${t('board.phaseResolvingEffects')}`,
        meta: [{ text: `${t('board.phasePendingEffects')} ${pendingCount}`, done: false }],
      };
    }
    case 'initialSet':
      return {
        title: t('board.phaseInitialSetTitle'),
        body: G.ready[meIndex] ? t('board.phaseWaitingOpponentReady') : t('board.phaseInitialSetBody'),
        meta: [
          {
            text: `${t('board.phaseSetCount')} ${me.cardsSetThisTurn}/1`,
            done: me.cardsSetThisTurn >= 1,
          },
        ],
      };
    case 'turnSet':
      return {
        title: G.ready[meIndex] ? t('board.phaseWaitingTitle') : t('board.phaseTurnSetTitle'),
        body: G.ready[meIndex] ? t('board.phaseWaitingOpponentReady') : t('board.phaseTurnSetBody'),
        meta: [
          {
            text: `${t('board.phaseSetCount')} ${me.cardsSetThisTurn} ${t('board.cardsUnit')}`,
            done: me.cardsSetThisTurn >= minimum,
          },
          { text: `${t('board.phaseMinimum')} ${minimum}`, done: me.cardsSetThisTurn >= minimum },
          ...(required > minimum
            ? [{ text: `${t('board.phaseMaximum')} ${required}`, done: me.cardsSetThisTurn <= required }]
            : []),
        ],
      };
    case 'gameOver':
      return { title: t('board.gameOver'), body: t('online.gameOverHelper'), meta: [] };
    default:
      return unhandledPhaseInstruction(G.step);
  }
}
