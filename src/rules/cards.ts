/**
 * The 108-card Canasta pack: two 52-card packs plus four jokers.
 *
 * A CardId is 0..107. Within each half (0..53, 54..107) ids 0..51 are the
 * standard cards, suit-major (clubs, diamonds, hearts, spades) and rank-minor
 * (A, 2, 3 … K), and 52, 53 are that pack's two jokers. Two cards with the same
 * rank and suit are distinct ids, so every card can be tracked by identity.
 */
export type CardId = number;

export const DECK_SIZE = 108;
export const SUITS = ['C', 'D', 'H', 'S'] as const;
export type Suit = (typeof SUITS)[number];

/** Rank numbers: 1 = Ace, 2..10, 11 = Jack, 12 = Queen, 13 = King, 0 = Joker. */
export type Rank = number;
export const JOKER = 0;
export const ACE = 1;

const local = (c: CardId) => c % 54;

export const isJoker = (c: CardId) => local(c) >= 52;
export const rankOf = (c: CardId): Rank => (isJoker(c) ? JOKER : (local(c) % 13) + 1);
export const suitOf = (c: CardId): Suit | null => (isJoker(c) ? null : SUITS[Math.floor(local(c) / 13)]);
export const isRed = (c: CardId) => { const s = suitOf(c); return s === 'D' || s === 'H' || (isJoker(c) && local(c) === 52); };

/** Jokers and twos are wild. */
export const isWild = (c: CardId) => isJoker(c) || rankOf(c) === 2;
export const isRedThree = (c: CardId) => rankOf(c) === 3 && (suitOf(c) === 'D' || suitOf(c) === 'H');
export const isBlackThree = (c: CardId) => rankOf(c) === 3 && (suitOf(c) === 'C' || suitOf(c) === 'S');
/** Natural cards are Aces and Fours up to Kings: the ranks that can be melded. */
export const isNatural = (c: CardId) => { const r = rankOf(c); return r === ACE || r >= 4; };
export const isNaturalRank = (r: Rank) => r === ACE || (r >= 4 && r <= 13);
/** Ranks a meld can be made of: the natural ranks, plus black threes when going out. */
export const isMeldRank = (r: Rank) => isNaturalRank(r) || r === 3;

/** Standard card values for melds, the initial-meld count and the cards left in hand. */
export function pointValue(c: CardId): number {
  if (isJoker(c)) return 50;
  const r = rankOf(c);
  if (r === ACE || r === 2) return 20;
  if (r >= 8) return 10;
  if (r >= 4) return 5;
  // Threes: a black three is worth 5. A red three is a bonus card and never counted as a card value.
  return isBlackThree(c) ? 5 : 0;
}

export const RANK_SHORT: Record<number, string> = { 0: 'Joker', 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
export const rankShort = (r: Rank) => RANK_SHORT[r] ?? String(r);
const RANK_NAME: Record<number, [string, string]> = {
  0: ['Joker', 'Jokers'], 1: ['Ace', 'Aces'], 2: ['Two', 'Twos'], 3: ['Three', 'Threes'], 4: ['Four', 'Fours'], 5: ['Five', 'Fives'], 6: ['Six', 'Sixes'],
  7: ['Seven', 'Sevens'], 8: ['Eight', 'Eights'], 9: ['Nine', 'Nines'], 10: ['Ten', 'Tens'], 11: ['Jack', 'Jacks'], 12: ['Queen', 'Queens'], 13: ['King', 'Kings'],
};
export const rankName = (r: Rank, plural = false) => RANK_NAME[r]?.[plural ? 1 : 0] ?? String(r);
export const SUIT_NAME: Record<Suit, string> = { C: 'Clubs', D: 'Diamonds', H: 'Hearts', S: 'Spades' };
export const SUIT_SYMBOL: Record<Suit, string> = { C: '♣', D: '♦', H: '♥', S: '♠' };

export function cardName(c: CardId): string {
  if (isJoker(c)) return 'Joker';
  return `${rankName(rankOf(c))} of ${SUIT_NAME[suitOf(c)!]}`;
}
export function cardShort(c: CardId): string {
  if (isJoker(c)) return 'Jkr';
  return rankShort(rankOf(c)) + SUIT_SYMBOL[suitOf(c)!];
}

/** Image key shared by both packs: 'HK', 'S10', 'J1' (red joker), 'J2' (black joker). */
export function faceKey(c: CardId): string {
  if (isJoker(c)) return local(c) === 52 ? 'J1' : 'J2';
  return suitOf(c)! + rankShort(rankOf(c));
}

/** Which of the two packs a card came from (they can have different backs). */
export const packOf = (c: CardId) => (c < 54 ? 0 : 1);

export const allCards = (): CardId[] => Array.from({ length: DECK_SIZE }, (_, i) => i);

/** Hand order: by rank (Aces high), wild cards and threes at the end. */
export function sortKey(c: CardId): number {
  if (isJoker(c)) return 1000;
  const r = rankOf(c);
  const s = SUITS.indexOf(suitOf(c)!);
  if (r === 2) return 900 + s;
  if (r === 3) return 800 + (isBlackThree(c) ? 0 : 10) + s;
  const order = r === ACE ? 14 : r;
  return order * 10 + s;
}
export const sortHand = (cards: readonly CardId[]) => [...cards].sort((a, b) => sortKey(a) - sortKey(b) || a - b);

export const sumPoints = (cards: readonly CardId[]) => cards.reduce((t, c) => t + pointValue(c), 0);
