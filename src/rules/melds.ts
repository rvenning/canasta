/**
 * What makes a meld legal in Classic Canasta (Pagat, "Melds in Classic Canasta"):
 *
 * - three or more cards of one natural rank (Ace, Four … King);
 * - at least two natural cards and never more than three wild cards;
 * - a meld of seven or more cards is a canasta: natural (red) if it has no wild
 *   card, mixed (black) otherwise;
 * - melds of only wild cards are not allowed;
 * - black threes may be melded (three or four, no wild cards) only by a player
 *   who is going out on that turn.
 *
 * These functions only look at cards; whose turn it is and what a side may do
 * is the engine's business (engine/turns.ts).
 */
import { isBlackThree, isNatural, isWild, rankName, rankOf, type CardId, type Rank } from './cards.ts';

export interface Meld {
  id: number;
  rank: Rank;
  cards: CardId[];
  /** Seat that started the meld. */
  owner: number;
  /** Meld area it lives in (see config.meldSlots). */
  slot: number;
}

export const MAX_WILDS = 3;
export const CANASTA = 7;

export const wildCount = (cards: readonly CardId[]) => cards.filter(isWild).length;
export const naturalCount = (cards: readonly CardId[]) => cards.filter((c) => !isWild(c)).length;
export const isCanasta = (m: { cards: readonly CardId[] }) => m.cards.length >= CANASTA;
export const isNaturalCanasta = (m: { cards: readonly CardId[] }) => isCanasta(m) && wildCount(m.cards) === 0;
export const canastaCount = (melds: readonly { cards: readonly CardId[] }[]) => melds.filter(isCanasta).length;

/** Does this card belong in a meld of `rank` (as itself or as a wild card)? */
export function fitsRank(c: CardId, rank: Rank): boolean {
  if (rank === 3) return isBlackThree(c);
  if (isWild(c)) return true;
  return isNatural(c) && rankOf(c) === rank;
}

/** Plain-language reason a set of cards cannot start a new meld of `rank`, or null if it can. */
export function newMeldProblem(rank: Rank, cards: readonly CardId[]): string | null {
  const name = rankName(rank, true);
  if (rank === 3) {
    if (!cards.every(isBlackThree)) return 'A meld of black threes can only contain black threes — no wild cards.';
    if (cards.length < 3) return 'Black threes can only be melded three or four at a time.';
    return null;
  }
  const bad = cards.find((c) => !fitsRank(c, rank));
  if (bad !== undefined) return isBlackThree(bad) || rankOf(bad) === 3 ? 'Threes cannot go into an ordinary meld.' : `Only ${name} and wild cards can go in a meld of ${name}.`;
  const nat = naturalCount(cards), wild = wildCount(cards);
  if (nat < 2) return `A new meld needs at least two natural ${name}.`;
  if (wild > MAX_WILDS) return 'A meld can never hold more than three wild cards.';
  if (cards.length < 3) return `A new meld needs at least three cards — you have ${cards.length} ${cards.length === 1 ? 'card' : 'cards'} of ${name}.`;
  return null;
}

/** Plain-language reason `cards` cannot be added to `meld`, or null if they can. */
export function additionProblem(meld: Meld, cards: readonly CardId[]): string | null {
  const name = rankName(meld.rank, true);
  if (meld.rank === 3) return 'Nothing can be added to a meld of black threes.';
  const bad = cards.find((c) => !fitsRank(c, meld.rank));
  if (bad !== undefined) return `Only ${name} and wild cards can be added to the ${name}.`;
  const add = wildCount(cards);
  if (add > 0 && wildCount(meld.cards) + add > MAX_WILDS) {
    const left = Math.max(0, MAX_WILDS - wildCount(meld.cards));
    return left === 0 ? `The ${name} already hold three wild cards, the most a meld can have.` : `The ${name} can take only ${left} more wild ${left === 1 ? 'card' : 'cards'}.`;
  }
  return null;
}

/** The meld's rank label, e.g. "Kings" or "black threes". */
export const meldLabel = (rank: Rank) => (rank === 3 ? 'black threes' : rankName(rank, true));
