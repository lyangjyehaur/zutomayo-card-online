"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDeck = buildDeck;
exports.getPresetDeck = getPresetDeck;
exports.getPresetDeckNames = getPresetDeckNames;
exports.randomDeck = randomDeck;
exports.shuffleDeck = shuffleDeck;
const loader_1 = require("./loader");
const presetDecks_1 = require("./presetDecks");
// Fisher-Yates shuffle
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
// Build a deck from a list of card def IDs (must be 20 cards)
function buildDeck(defIds) {
    if (defIds.length !== 20) {
        throw new Error(`Deck must have exactly 20 cards, got ${defIds.length}`);
    }
    return defIds.map(id => (0, loader_1.createInstance)(id));
}
// Get a preset deck by name
function getPresetDeck(name) {
    const preset = presetDecks_1.PRESET_DECKS[name];
    if (!preset)
        throw new Error(`Unknown preset deck: ${name}`);
    return buildDeck(preset.ids);
}
// Get all preset deck names
function getPresetDeckNames() {
    return Object.keys(presetDecks_1.PRESET_DECKS);
}
// Generate a random deck from all available cards
function randomDeck() {
    const allCards = (0, loader_1.getAllCardDefs)();
    const characters = allCards.filter(c => c.type === 'Character');
    const enchants = allCards.filter(c => c.type === 'Enchant');
    const areaEnchants = allCards.filter(c => c.type === 'Area Enchant');
    const deckChars = shuffle(characters).slice(0, 12);
    const deckEnchants = shuffle(enchants).slice(0, 6);
    const deckAE = shuffle(areaEnchants).slice(0, 2);
    const deck = shuffle([...deckChars, ...deckEnchants, ...deckAE]);
    return deck.map(c => (0, loader_1.createInstance)(c.id));
}
// Shuffle a deck
function shuffleDeck(deck) {
    return shuffle(deck);
}
