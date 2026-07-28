export function compareCardIds(left: string, right: string): number;

export function compareCardsById<T extends { id: string }>(left: T, right: T): number;

export function sortCardsById<T extends { id: string }>(cards: readonly T[]): T[];
