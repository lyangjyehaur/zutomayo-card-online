"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZutomayoCard = void 0;
const core_1 = require("boardgame.io/core");
const loader_1 = require("./cards/loader");
const effects_1 = require("./effects");
const GameLogic_1 = require("./GameLogic");
const executor_1 = require("./effects/executor");
const allCards = (0, loader_1.getAllCardDefs)();
const parsedEffects = (0, effects_1.parseAllEffects)(allCards.map(c => ({ id: c.id, effect: c.effect })));
exports.ZutomayoCard = {
    name: 'zutomayo-card',
    setup: () => (0, GameLogic_1.setupGame)(),
    moves: {
        // Janken (rock-paper-scissors)
        janken: ({ G, playerID }, choice) => {
            const idx = parseInt(playerID);
            if (!G.jankenChoices)
                G.jankenChoices = [null, null];
            G.jankenChoices[idx] = choice;
            // If both chose, resolve
            if (G.jankenChoices[0] && G.jankenChoices[1]) {
                const result = (0, GameLogic_1.resolveJanken)(G, G.jankenChoices[0], G.jankenChoices[1]);
                if (result.winner === null) {
                    // Draw — reset and try again
                    G.jankenChoices = [null, null];
                    G.log.push('Janken draw! Try again.');
                }
            }
        },
        // Mulligan
        mulligan: ({ G, playerID }, indicesToRedraw) => {
            const idx = parseInt(playerID);
            if (G.mulliganUsed?.[idx])
                return core_1.INVALID_MOVE;
            (0, GameLogic_1.mulligan)(G, idx, indicesToRedraw);
            // If both done, move to game
            if (G.mulliganUsed?.[0] && G.mulliganUsed?.[1]) {
                G.setupPhase = 'done';
                G.log.push('Both players ready. Game begins!');
            }
        },
        // Skip mulligan
        keepHand: ({ G, playerID }) => {
            const idx = parseInt(playerID);
            if (G.mulliganUsed?.[idx])
                return core_1.INVALID_MOVE;
            (0, GameLogic_1.mulligan)(G, idx, []);
            if (G.mulliganUsed?.[0] && G.mulliganUsed?.[1]) {
                G.setupPhase = 'done';
                G.log.push('Both players ready. Game begins!');
            }
        },
        // Select card during gameplay
        selectCard: ({ G, playerID }, handIndex, slot) => {
            const idx = parseInt(playerID);
            if (!(0, GameLogic_1.selectCard)(G, idx, handIndex, slot))
                return core_1.INVALID_MOVE;
        },
        // Confirm set
        confirmSet: ({ G, playerID }) => {
            const idx = parseInt(playerID);
            if (G.players[idx].cardsSetThisTurn === 0)
                return core_1.INVALID_MOVE;
        },
    },
    turn: {
        minMoves: 1,
        maxMoves: 2,
        onBegin: ({ G }) => {
            if (G.setupPhase === 'done') {
                G.players[0].cardsSetThisTurn = 0;
                G.players[1].cardsSetThisTurn = 0;
                G.setCardsThisTurn = { player0: [], player1: [] };
            }
        },
        onEnd: ({ G }) => {
            if (G.setupPhase !== 'done')
                return;
            // Phase pipeline: reveal → time → swap → effects → battle → end
            (0, GameLogic_1.revealCards)(G);
            (0, GameLogic_1.advanceChronos)(G);
            (0, GameLogic_1.swapCards)(G);
            (0, executor_1.processTurnEffects)(G, parsedEffects);
            (0, GameLogic_1.resolveBattle)(G);
            (0, GameLogic_1.endTurn)(G);
        },
    },
    endIf: ({ G }) => {
        if (G.setupPhase !== 'done')
            return;
        const result = (0, GameLogic_1.checkGameEnd)(G);
        if (result)
            return { winner: result };
    },
};
