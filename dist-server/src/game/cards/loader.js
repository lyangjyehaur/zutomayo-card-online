"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCardDef = getCardDef;
exports.getAllCardDefs = getAllCardDefs;
exports.getCardsByPack = getCardsByPack;
exports.createInstance = createInstance;
exports.resetInstanceCounter = resetInstanceCounter;
const cards_json_1 = __importDefault(require("../../../cards.json"));
// Build lookup map from cards.json
const cardMap = new Map();
for (const card of cards_json_1.default) {
    cardMap.set(card.id, card);
}
function getCardDef(id) {
    return cardMap.get(id);
}
function getAllCardDefs() {
    return Array.from(cardMap.values());
}
function getCardsByPack(pack) {
    return cards_json_1.default.filter(c => c.pack === pack);
}
// Create a CardInstance from a CardDef
let instanceCounter = 0;
function createInstance(defId, faceUp = false) {
    return {
        instanceId: `inst_${defId}_${++instanceCounter}`,
        defId,
        faceUp,
    };
}
// Reset counter (for testing)
function resetInstanceCounter() {
    instanceCounter = 0;
}
