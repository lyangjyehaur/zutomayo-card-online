/* global module */

const CARD_ID_COLLATOR = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
});

function compareCardIds(left, right) {
  const leftId = String(left || '');
  const rightId = String(right || '');
  return CARD_ID_COLLATOR.compare(leftId, rightId) || (leftId < rightId ? -1 : leftId > rightId ? 1 : 0);
}

function compareCardsById(left, right) {
  return compareCardIds(left?.id, right?.id);
}

function sortCardsById(cards) {
  return [...cards].sort(compareCardsById);
}

module.exports = {
  compareCardIds,
  compareCardsById,
  sortCardsById,
};
