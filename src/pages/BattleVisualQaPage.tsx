import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Board } from '../components/Board';
import { TUTORIAL_DECK0_IDS, TUTORIAL_DECK1_IDS } from '../data/tutorialScenario';
import {
  confirmReady,
  finishMulligan,
  resolveJanken,
  setInitialCard,
  setTurnCard,
  setupGame,
} from '../game/GameLogic';
import { parseAllEffects, type ParsedEffect } from '../game/effects';
import {
  getAllCardDefs,
  getCardDef,
  initCards,
  isCardsInitialized,
  refreshCards,
  resetInstanceCounter,
} from '../game/cards/loader';
import type { CardDef, CardInstance, GameState, PendingChoice, PendingEffect, PlayerIndex, SetSlot } from '../game/types';
import { t } from '../i18n';

type BoardComponentProps = ComponentProps<typeof Board>;

const BATTLE_QA_STATES = [
  { id: 'janken', label: 'Janken' },
  { id: 'mulligan', label: 'Mulligan' },
  { id: 'initial-set', label: 'Initial Set' },
  { id: 'turn-set', label: 'Turn Set' },
  { id: 'effect-order', label: 'Effect Order' },
  { id: 'pending-choice', label: 'Pending Choice' },
  { id: 'game-over', label: 'Game Over' },
] as const;

type BattleQaStateId = (typeof BATTLE_QA_STATES)[number]['id'];

const REQUIRED_QA_CARD_IDS = [...new Set([...TUTORIAL_DECK0_IDS, ...TUTORIAL_DECK1_IDS])];

const BATTLE_QA_FALLBACK_CARDS: CardDef[] = [
  {
    id: '1st_2',
    name: 'QA High Cost Character',
    pack: 'QA',
    song: 'Fixture',
    illustrator: 'QA',
    rarity: 'N',
    element: '闇',
    type: 'Character',
    clock: 1,
    attack: { night: 90, day: 60 },
    powerCost: 7,
    sendToPower: 2,
    effect: '',
    image: '/card-back.jpg',
    errata: '',
  },
  {
    id: '1st_34',
    name: 'QA Night Attacker',
    pack: 'QA',
    song: 'Fixture',
    illustrator: 'QA',
    rarity: 'R',
    element: '炎',
    type: 'Character',
    clock: 1,
    attack: { night: 70, day: 40 },
    powerCost: 1,
    sendToPower: 1,
    effect: '',
    image: '/card-back.jpg',
    errata: '',
  },
  {
    id: '1st_35',
    name: 'QA Reserve Character',
    pack: 'QA',
    song: 'Fixture',
    illustrator: 'QA',
    rarity: 'N',
    element: '炎',
    type: 'Character',
    clock: 1,
    attack: { night: 45, day: 45 },
    powerCost: 0,
    sendToPower: 1,
    effect: '',
    image: '/card-back.jpg',
    errata: '',
  },
  {
    id: '1st_66',
    name: 'QA Filler Character',
    pack: 'QA',
    song: 'Fixture',
    illustrator: 'QA',
    rarity: 'N',
    element: '風',
    type: 'Character',
    clock: 1,
    attack: { night: 40, day: 40 },
    powerCost: 0,
    sendToPower: 1,
    effect: '',
    image: '/card-back.jpg',
    errata: '',
  },
  {
    id: '1st_67',
    name: 'QA Opponent Attacker',
    pack: 'QA',
    song: 'Fixture',
    illustrator: 'QA',
    rarity: 'N',
    element: '風',
    type: 'Character',
    clock: 1,
    attack: { night: 50, day: 30 },
    powerCost: 0,
    sendToPower: 1,
    effect: '',
    image: '/card-back.jpg',
    errata: '',
  },
  {
    id: '1st_68',
    name: 'QA Reserve Wind',
    pack: 'QA',
    song: 'Fixture',
    illustrator: 'QA',
    rarity: 'N',
    element: '風',
    type: 'Character',
    clock: 2,
    attack: { night: 35, day: 55 },
    powerCost: 0,
    sendToPower: 1,
    effect: '',
    image: '/card-back.jpg',
    errata: '',
  },
  {
    id: '1st_70',
    name: 'QA Opening Character',
    pack: 'QA',
    song: 'Fixture',
    illustrator: 'QA',
    rarity: 'R',
    element: '電気',
    type: 'Character',
    clock: 2,
    attack: { night: 30, day: 60 },
    powerCost: 0,
    sendToPower: 2,
    effect: '',
    image: '/card-back.jpg',
    errata: '',
  },
  {
    id: '1st_98',
    name: 'QA Attack Enchant',
    pack: 'QA',
    song: 'Fixture',
    illustrator: 'QA',
    rarity: 'R',
    element: 'カオス',
    type: 'Enchant',
    clock: 4,
    attack: null,
    powerCost: 0,
    sendToPower: 0,
    effect: '相手のキャラクターカードが1コスト以下なら攻撃力+30',
    image: '/card-back.jpg',
    errata: '',
  },
  {
    id: '2nd_86',
    name: 'QA Night Area Enchant',
    pack: 'QA',
    song: 'Fixture',
    illustrator: 'QA',
    rarity: 'SR',
    element: '闇',
    type: 'Area Enchant',
    clock: 2,
    attack: null,
    powerCost: 0,
    sendToPower: 0,
    effect: '夜なら攻撃力+20',
    image: '/card-back.jpg',
    errata: '',
  },
  {
    id: '2nd_92',
    name: 'QA Reserve Enchant',
    pack: 'QA',
    song: 'Fixture',
    illustrator: 'QA',
    rarity: 'N',
    element: '電気',
    type: 'Enchant',
    clock: 1,
    attack: null,
    powerCost: 0,
    sendToPower: 0,
    effect: '',
    image: '/card-back.jpg',
    errata: '',
  },
];

function hasRequiredQaCards(): boolean {
  return REQUIRED_QA_CARD_IDS.every((id) => Boolean(getCardDef(id)));
}

async function ensureBattleQaCards(): Promise<void> {
  if (!isCardsInitialized()) {
    await refreshCards();
  }
  if (!isCardsInitialized() || !hasRequiredQaCards()) {
    initCards(BATTLE_QA_FALLBACK_CARDS);
  }
}

function createParsedEffects(): Map<string, ParsedEffect[]> {
  return parseAllEffects(getAllCardDefs().map((card) => ({ id: card.id, effect: card.effect })));
}

function createTutorialGame(): GameState {
  resetInstanceCounter();
  return setupGame(
    {
      deck0Ids: TUTORIAL_DECK0_IDS,
      deck1Ids: TUTORIAL_DECK1_IDS,
      skipShuffle: true,
    },
    { allowBrowserCustomDeckName: true },
  );
}

function setCardFromHand(
  G: GameState,
  player: PlayerIndex,
  defId: string,
  setCard: (G: GameState, player: PlayerIndex, handIndex: number) => boolean,
): void {
  const handIndex = G.players[player].hand.findIndex((card) => card.defId === defId);
  if (handIndex === -1 || !setCard(G, player, handIndex)) {
    throw new Error(`Unable to set ${defId} for player ${player}`);
  }
}

function setTurnCardFromHand(G: GameState, player: PlayerIndex, defId: string, slot: SetSlot): void {
  const handIndex = G.players[player].hand.findIndex((card) => card.defId === defId);
  if (handIndex === -1 || !setTurnCard(G, player, handIndex, slot)) {
    throw new Error(`Unable to set ${defId} into slot ${slot} for player ${player}`);
  }
}

function createMulliganState(): GameState {
  const G = createTutorialGame();
  resolveJanken(G, 'rock', 'scissors');
  return G;
}

function createInitialSetBase(): GameState {
  const G = createMulliganState();
  finishMulligan(G, 0, [0]);
  finishMulligan(G, 1, []);
  return G;
}

function createInitialSetState(): GameState {
  const G = createInitialSetBase();
  setCardFromHand(G, 0, '1st_70', setInitialCard);
  return G;
}

function createTurnOneResolvedState(parsedEffects: Map<string, ParsedEffect[]>): GameState {
  const G = createInitialSetBase();
  setCardFromHand(G, 0, '1st_70', setInitialCard);
  setCardFromHand(G, 1, '1st_67', setInitialCard);
  confirmReady(G, 0, parsedEffects);
  confirmReady(G, 1, parsedEffects);
  if (G.step !== 'turnSet') {
    throw new Error(`Expected turnSet after turn one, got ${G.step}`);
  }
  return G;
}

function createTurnSetState(parsedEffects: Map<string, ParsedEffect[]>): GameState {
  const G = createTurnOneResolvedState(parsedEffects);
  clearTransientQaOverlays(G);
  setTurnCardFromHand(G, 0, '1st_34', 'A');
  setTurnCardFromHand(G, 0, '2nd_86', 'B');
  setTurnCardFromHand(G, 1, '1st_98', 'A');
  return G;
}

function faceUp(card: CardInstance | null): void {
  if (card) card.faceUp = true;
}

function clearTransientQaOverlays(G: GameState): void {
  G.recentGameNotices = [];
  G.recentHpChanges = [];
}

function prepareEffectField(G: GameState): GameState {
  clearTransientQaOverlays(G);
  for (const card of G.setCardsThisTurn.flat()) faceUp(card);
  faceUp(G.players[0].battleZone);
  faceUp(G.players[1].battleZone);
  faceUp(G.players[1].setZoneA);

  const previousPlayerCharacter = G.players[0].battleZone;
  const nextPlayerCharacter = G.players[0].setZoneA;
  const nextAreaEnchant = G.players[0].setZoneB;
  if (previousPlayerCharacter) {
    G.players[0].powerCharger.push(previousPlayerCharacter);
  }
  if (nextPlayerCharacter) {
    nextPlayerCharacter.faceUp = true;
    G.players[0].battleZone = nextPlayerCharacter;
    G.players[0].setZoneA = null;
  }
  if (nextAreaEnchant) {
    nextAreaEnchant.faceUp = true;
    G.players[0].setZoneC = nextAreaEnchant;
    G.players[0].setZoneB = null;
  }

  G.step = 'effectOrder';
  G.ready = [true, true];
  G.chronosAtTurnStart = 3;
  G.chronos.position = 10;
  G.log.push('QA fixture: cards revealed for effect-order visual state.');
  return G;
}

function createQaEffect(
  player: PlayerIndex,
  card: CardInstance,
  actionValue: number,
  rawText: string,
  source: PendingEffect['source'],
): PendingEffect {
  return {
    id: `qa-effect-${player}-${card.instanceId}`,
    player,
    cardInstanceId: card.instanceId,
    cardDefId: card.defId,
    rawText,
    effect: {
      trigger: 'onUse',
      conditions: [],
      action: { type: 'boostAttack', params: { value: actionValue } },
      rawText,
    },
    source,
  };
}

function createEffectOrderState(parsedEffects: Map<string, ParsedEffect[]>): GameState {
  const G = prepareEffectField(createTurnSetState(parsedEffects));
  const playerArea = G.players[0].setZoneC;
  const opponentEnchant = G.players[1].setZoneA;
  if (!playerArea || !opponentEnchant) throw new Error('Unable to prepare QA pending effects');
  G.pendingEffects = [
    [createQaEffect(0, playerArea, 20, '夜なら攻撃力+20', 'setZoneC')],
    [createQaEffect(1, opponentEnchant, 30, '相手のキャラクターカードが1コスト以下なら攻撃力+30', 'played')],
  ];
  G.pendingEffectPlayer = 0;
  return G;
}

function createPendingChoiceState(parsedEffects: Map<string, ParsedEffect[]>): GameState {
  const G = createEffectOrderState(parsedEffects);
  const options = G.players[0].hand.slice(0, 3).map((card) => ({
    id: card.instanceId,
    label: getCardDef(card.defId)?.name ?? card.defId,
    cardInstanceId: card.instanceId,
    cardDefId: card.defId,
  }));
  const choice: PendingChoice = {
    id: 'qa-choice-hand-to-power',
    type: 'cardMove',
    player: 0,
    options,
    min: 1,
    max: Math.min(2, Math.max(1, options.length)),
    prompt: 'QA fixture: choose cards to move for responsive inspection.',
    sourceCardDefId: G.players[0].setZoneC?.defId,
    payload: {
      sourcePlayer: 0,
      sourceZone: 'hand',
      destinationPlayer: 0,
      destinationZone: 'abyss',
    },
  };
  G.pendingChoice = choice;
  return G;
}

function createGameOverState(parsedEffects: Map<string, ParsedEffect[]>): GameState {
  const G = prepareEffectField(createTurnSetState(parsedEffects));
  G.step = 'gameOver';
  G.ready = [true, true];
  G.winner = 0;
  G.players[0].hp = 40;
  G.players[1].hp = 0;
  G.gameoverReason = 'Player 1 loses at 0 HP.';
  G.pendingEffects = [[], []];
  G.pendingEffectPlayer = null;
  G.pendingChoice = null;
  G.log.push(G.gameoverReason);
  return G;
}

function normalizeStateId(value: string | null): BattleQaStateId {
  return BATTLE_QA_STATES.some((state) => state.id === value) ? (value as BattleQaStateId) : 'turn-set';
}

function createBattleQaState(id: BattleQaStateId): GameState {
  const parsedEffects = createParsedEffects();
  if (id === 'janken') return createTutorialGame();
  if (id === 'mulligan') return createMulliganState();
  if (id === 'initial-set') return createInitialSetState();
  if (id === 'turn-set') return createTurnSetState(parsedEffects);
  if (id === 'effect-order') return createEffectOrderState(parsedEffects);
  if (id === 'pending-choice') return createPendingChoiceState(parsedEffects);
  return createGameOverState(parsedEffects);
}

const noopMoves: BoardComponentProps['moves'] = {
  janken: () => undefined,
  mulligan: () => undefined,
  keepHand: () => undefined,
  setInitialCard: () => undefined,
  setTurnCard: () => undefined,
  undoSetCard: () => undefined,
  confirmReady: () => undefined,
  timeoutSkip: () => undefined,
  resolvePendingEffect: () => undefined,
  submitPendingChoice: () => undefined,
};

function createQaCtx(G: GameState): BoardComponentProps['ctx'] {
  return {
    numPlayers: 2,
    playOrder: ['0', '1'],
    playOrderPos: 0,
    activePlayers: { '0': 'simultaneous', '1': 'simultaneous' },
    currentPlayer: '0',
    turn: G.turnNumber,
    phase: 'default',
    gameover:
      G.step === 'gameOver'
        ? G.winner === null
          ? { draw: true }
          : { winner: String(G.winner) }
        : undefined,
  } as BoardComponentProps['ctx'];
}

function QaControls({ selectedState }: { selectedState: BattleQaStateId }) {
  return (
    <aside className="fixed bottom-3 left-3 z-[--z-modal] max-w-[calc(100vw-1.5rem)] rounded-sm border border-bone/10 bg-lacquer-deep/90 p-2 font-mono text-[10px] uppercase tracking-[0.18em] text-bone/55 shadow-[--shadow] backdrop-blur">
      <div className="mb-1 text-gold/70">Battle QA</div>
      <div className="flex flex-wrap gap-1">
        {BATTLE_QA_STATES.map((state) => (
          <Link
            key={state.id}
            className={`rounded-xs px-2 py-1 transition ${
              selectedState === state.id ? 'bg-gold text-lacquer' : 'bg-bone/5 text-bone/55 hover:text-bone'
            }`}
            to={`/qa/battle?state=${state.id}`}
          >
            {state.label}
          </Link>
        ))}
      </div>
    </aside>
  );
}

export function BattleVisualQaPage() {
  const [searchParams] = useSearchParams();
  const selectedState = normalizeStateId(searchParams.get('state'));
  const showControls = searchParams.get('controls') !== '0';
  const [cardsReady, setCardsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void ensureBattleQaCards()
      .then(() => {
        if (!cancelled) setCardsReady(true);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fixture = useMemo(() => {
    if (!cardsReady) return { G: null, error: null };
    try {
      return { G: createBattleQaState(selectedState), error: null };
    } catch (error) {
      return { G: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [cardsReady, selectedState]);

  useEffect(() => {
    document.documentElement.dataset.battleQaState = fixture.G ? selectedState : '';
    return () => {
      delete document.documentElement.dataset.battleQaState;
    };
  }, [fixture.G, selectedState]);

  if (loadError || fixture.error) {
    return (
      <main className="grid h-full w-full place-items-center bg-lacquer-deep px-6 text-center text-bone">
        <section className="max-w-xl rounded-sm border border-vermilion/30 bg-lacquer p-5 shadow-[--shadow]">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-vermilion">Battle QA</div>
          <h1 className="mt-3 font-display text-2xl italic">Fixture Error</h1>
          <p className="mt-3 text-sm leading-relaxed text-bone/60">{loadError ?? fixture.error}</p>
        </section>
      </main>
    );
  }

  if (!cardsReady || !fixture.G) {
    return (
      <main className="grid h-full w-full place-items-center bg-lacquer-deep font-mono text-[10px] uppercase tracking-[0.3em] text-bone/50">
        {t('game.loading')}
      </main>
    );
  }

  return (
    <main className="relative h-full min-h-0 w-full overflow-hidden bg-lacquer-deep" data-battle-qa-state={selectedState}>
      <Board
        G={fixture.G}
        ctx={createQaCtx(fixture.G)}
        moves={noopMoves}
        events={{} as BoardComponentProps['events']}
        plugins={{}}
        _undo={[]}
        _redo={[]}
        _stateID={0}
        log={[]}
        reset={() => undefined}
        undo={() => undefined}
        redo={() => undefined}
        matchData={undefined}
        sendChatMessage={() => undefined}
        chatMessages={[]}
        playerID="0"
        matchID={`qa-${selectedState}`}
        isActive
        isConnected
        isMultiplayer={false}
      />
      {showControls && <QaControls selectedState={selectedState} />}
    </main>
  );
}
