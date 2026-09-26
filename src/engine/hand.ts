/**
 * One hand of Classic Canasta: the deal, turns, melds, the discard pile and the
 * end of play. Pure functions over plain data: the state is JSON-serialisable,
 * nothing here knows about animation, and every random choice is derived from
 * the match seed and hand number (rules/rng.ts), so a hand replays exactly.
 *
 * Functions ending in `Mut` change the state they are given; the match layer
 * (match.ts) always passes them a fresh clone, so callers never see mutation.
 */
import { allCards, isBlackThree, isNatural, isRedThree, isWild, rankName, rankOf, sumPoints, type CardId, type Rank } from '../rules/cards.ts';
import { initialRequirement, lineOfSeat, meldSlots, slotOfSeat, type RulesConfig } from '../rules/config.ts';
import { additionProblem, canastaCount, CANASTA, isCanasta, isNaturalCanasta, meldLabel, newMeldProblem, type Meld } from '../rules/melds.ts';
import { rngFor, shuffle } from '../rules/rng.ts';

export type Phase = 'draw' | 'play' | 'ask' | 'over';

/** A request to meld some cards: a rank, the cards, and optionally which existing meld they join. */
export interface Group { rank: Rank; cards: CardId[]; into?: number }

/** Public record of the hand, in order. Everything here was seen face up (or, for draws, only counted). */
export type PublicAct =
  | { t: 'draw'; seat: number; n: number }
  | { t: 'redThree'; seat: number; card: CardId }
  | { t: 'take'; seat: number; cards: CardId[] }
  | { t: 'meld'; seat: number; cards: CardId[] }
  | { t: 'discard'; seat: number; card: CardId };

export interface HandState {
  hands: CardId[][];
  /** Face-down stock; the top card is the last element. */
  stock: CardId[];
  /** Discard pile; the top card is the last element. */
  pile: CardId[];
  /** The pile holds a wild card or the turned-up red three, so it is frozen against everyone. */
  pileFrozen: boolean;
  /** Meld areas (see config.meldSlots). */
  melds: Meld[][];
  /** Red threes laid out, per seat. */
  redThrees: CardId[][];
  turn: number;
  phase: Phase;
  /** How the player on turn started it. */
  drew: 'stock' | 'pile' | null;
  /** Answer to "may I go out?" this turn, if asked. */
  askAnswer: 'yes' | 'no' | null;
  asked: boolean;
  /** Something has been melded this turn apart from the pile's top card (ends the chance to ask). */
  meldedSinceDraw: boolean;
  /** Seat has melded any card this hand (for going out concealed). */
  playerMelded: boolean[];
  /** The player on turn had melded before this turn began. */
  meldedBeforeTurn: boolean;
  /** This turn the player added cards to a meld their partner started. */
  addedToPartner: boolean;
  /** Three players: who plays alone this hand (the first to take the pile), or null. */
  lone: number | null;
  wentOut: number | null;
  concealed: boolean;
  endReason: 'out' | 'stock' | null;
  nextMeldId: number;
  /** Seat whose turn it is first after the deal. */
  firstPlayer: number;
  log: PublicAct[];
}

export type HandEvent =
  | { e: 'deal'; dealer: number; counts: number[] }
  | { e: 'upcard'; cards: CardId[]; frozen: boolean }
  | { e: 'redThree'; seat: number; card: CardId; replaced: boolean }
  | { e: 'draw'; seat: number; count: number }
  | { e: 'take'; seat: number; top: CardId; count: number }
  | { e: 'meld'; seat: number; placed: { meld: number; cards: CardId[]; created: boolean }[] }
  | { e: 'canasta'; seat: number; meld: number; natural: boolean }
  | { e: 'discard'; seat: number; card: CardId; froze: boolean; stop: boolean }
  | { e: 'partnership'; lone: number; partners: number[] }
  | { e: 'ask'; seat: number; partner: number }
  | { e: 'answer'; seat: number; yes: boolean }
  | { e: 'turn'; seat: number }
  | { e: 'out'; seat: number; concealed: boolean }
  | { e: 'stockOut'; seat: number };

// ------------------------------------------------------------------ sides

const n = (r: RulesConfig) => r.players;
export const nextSeat = (r: RulesConfig, s: number) => (s + 1) % n(r);

/** Seats playing together with `seat` for melding right now. */
export function sideSeats(r: RulesConfig, h: HandState, seat: number): number[] {
  if (r.partnership === 'fixed') return [seat % 2, (seat % 2) + 2];
  if (r.partnership === 'threeHanded' && h.lone !== null && seat !== h.lone) return [0, 1, 2].filter((s) => s !== h.lone);
  return [seat];
}

/** The partner who may be asked "may I go out?", if any. */
export function partnerOf(r: RulesConfig, h: HandState, seat: number): number | null {
  const s = sideSeats(r, h, seat).filter((x) => x !== seat);
  return s.length ? s[0] : null;
}

/** Meld areas pooled by `seat`'s side. */
export function sideSlots(r: RulesConfig, h: HandState, seat: number): number[] {
  return [...new Set(sideSeats(r, h, seat).map((s) => slotOfSeat(r, s)))];
}

export const sideMelds = (r: RulesConfig, h: HandState, seat: number): Meld[] => sideSlots(r, h, seat).flatMap((s) => h.melds[s]);
export const sideHasMelded = (r: RulesConfig, h: HandState, seat: number) => sideMelds(r, h, seat).length > 0;
export const sideCanastas = (r: RulesConfig, h: HandState, seat: number) => canastaCount(sideMelds(r, h, seat));

/** Minimum count for this seat's side's first meld, from the relevant cumulative score. */
export function requirementFor(r: RulesConfig, scores: readonly number[], seat: number): number {
  return initialRequirement(scores[lineOfSeat(r, seat)] ?? 0);
}

export function findMeld(h: HandState, id: number): Meld | null {
  for (const slot of h.melds) for (const m of slot) if (m.id === id) return m;
  return null;
}

// ------------------------------------------------------------------ the deal

export function startHand(r: RulesConfig, seed: number, handNo: number, dealer: number, events: HandEvent[]): HandState {
  const deck = shuffle(allCards(), rngFor(seed, 'deal', handNo));
  const hands: CardId[][] = Array.from({ length: n(r) }, () => []);
  const first = nextSeat(r, dealer);
  for (let round = 0; round < r.dealSize; round++) for (let k = 0; k < n(r); k++) hands[(first + k) % n(r)].push(deck.pop()!);
  events.push({ e: 'deal', dealer, counts: hands.map((x) => x.length) });
  const h: HandState = {
    hands, stock: deck, pile: [], pileFrozen: false,
    melds: Array.from({ length: meldSlots(r) }, () => []),
    redThrees: Array.from({ length: n(r) }, () => []),
    turn: first, phase: 'draw', drew: null, askAnswer: null, asked: false, meldedSinceDraw: false,
    playerMelded: Array(n(r)).fill(false), meldedBeforeTurn: false, addedToPartner: false,
    lone: null, wentOut: null, concealed: false, endReason: null, nextMeldId: 1, firstPlayer: first, log: [],
  };
  // The upcard: a wild card or red three is covered by the next card and freezes the pile.
  const up: CardId[] = [];
  for (;;) {
    const c = h.stock.pop()!;
    h.pile.push(c);
    up.push(c);
    if (isWild(c) || isRedThree(c)) h.pileFrozen = true;
    else break;
  }
  events.push({ e: 'upcard', cards: up, frozen: h.pileFrozen });
  // Red threes in the deal are laid out and replaced, starting left of the dealer.
  for (let k = 0; k < n(r); k++) {
    const seat = (first + k) % n(r);
    for (;;) {
      const i = h.hands[seat].findIndex(isRedThree);
      if (i < 0) break;
      const [c] = h.hands[seat].splice(i, 1);
      h.redThrees[seat].push(c);
      h.log.push({ t: 'redThree', seat, card: c });
      const rep = h.stock.pop();
      if (rep !== undefined) h.hands[seat].push(rep);
      events.push({ e: 'redThree', seat, card: c, replaced: rep !== undefined });
    }
  }
  h.meldedBeforeTurn = false;
  events.push({ e: 'turn', seat: first });
  return h;
}

export function cloneHand(h: HandState): HandState {
  return {
    ...h,
    hands: h.hands.map((x) => [...x]),
    stock: [...h.stock],
    pile: [...h.pile],
    melds: h.melds.map((slot) => slot.map((m) => ({ ...m, cards: [...m.cards] }))),
    redThrees: h.redThrees.map((x) => [...x]),
    playerMelded: [...h.playerMelded],
    log: h.log.map((a) => ('cards' in a ? { ...a, cards: [...a.cards] } : { ...a })) as PublicAct[],
  };
}

// ------------------------------------------------------------------ the discard pile

export const pileTop = (h: HandState): CardId | null => (h.pile.length ? h.pile[h.pile.length - 1] : null);

/** Why the pile cannot be taken at all right now (before looking at the player's cards), or null. */
export function pileBlocked(h: HandState, seat: number): string | null {
  const top = pileTop(h);
  if (top === null) return 'The discard pile is empty.';
  if (isBlackThree(top)) return 'A black three on top stops the pile: nobody can take it this turn.';
  if (isWild(top)) return 'You can never take the pile when a wild card is on top.';
  if (h.hands[seat].length === 1 && h.pile.length === 1) return 'With only one card in your hand you may not take a pile of just one card.';
  return null;
}

/** Is the pile frozen against this seat's side? */
export function frozenFor(r: RulesConfig, h: HandState, seat: number): boolean {
  return h.pileFrozen || !sideHasMelded(r, h, seat);
}

// ------------------------------------------------------------------ checking a meld request

export interface Resolved { rank: Rank; cards: CardId[]; target: Meld | null }
export type Check = { ok: true; groups: Resolved[]; points: number; handAfter: number; canastasAfter: number; goingOut: boolean } | { ok: false; error: string };

/**
 * Validate a set of groups melded together by `seat`, from hand (plus the pile's top card when taking).
 * Returns the resolved placement or a plain-language reason.
 */
export function checkGroups(r: RulesConfig, h: HandState, scores: readonly number[], seat: number, groups: readonly Group[], take: CardId | null): Check {
  if (!Array.isArray(groups) || groups.length === 0) return { ok: false, error: 'Choose some cards to meld first.' };
  if (take !== null) {
    const blocked = pileBlocked(h, seat);
    if (blocked) return { ok: false, error: blocked };
  }
  const hand = h.hands[seat];
  const seen = new Set<CardId>();
  let usedFromHand = 0;
  for (const g of groups) {
    if (!g || !Array.isArray(g.cards) || g.cards.length === 0) return { ok: false, error: 'An empty meld cannot be laid down.' };
    for (const c of g.cards) {
      if (seen.has(c)) return { ok: false, error: 'The same card cannot be used twice.' };
      seen.add(c);
      if (c === take) continue;
      if (!hand.includes(c)) return { ok: false, error: 'That card is not in your hand.' };
      usedFromHand++;
    }
  }
  if (take !== null && !seen.has(take)) return { ok: false, error: 'To take the pile you must meld its top card.' };

  const mine = sideMelds(r, h, seat);
  // Merge requests for the same rank that do not name a meld: a side keeps one meld per rank.
  const merged: Group[] = [];
  for (const g of groups) {
    const same = g.into === undefined ? merged.find((m) => m.into === undefined && m.rank === g.rank) : undefined;
    if (same) same.cards = [...same.cards, ...g.cards];
    else merged.push({ rank: g.rank, cards: [...g.cards], into: g.into });
  }
  const resolved: Resolved[] = [];
  let points = 0;
  for (const g of merged) {
    if (g.rank === 3) {
      const p = newMeldProblem(3, g.cards);
      if (p) return { ok: false, error: p };
      resolved.push({ rank: 3, cards: g.cards, target: null });
      points += sumPoints(g.cards);
      continue;
    }
    if (!(g.rank === 1 || (g.rank >= 4 && g.rank <= 13))) return { ok: false, error: rankOf(g.cards[0]) === 3 ? 'Threes cannot be melded like that.' : 'Wild cards cannot be melded on their own — they need natural cards of a rank.' };
    let target: Meld | null = null;
    if (g.into !== undefined) {
      target = mine.find((m) => m.id === g.into) ?? null;
      if (!target) return { ok: false, error: 'You can only add to your own side’s melds.' };
      if (target.rank !== g.rank) return { ok: false, error: `Those cards do not belong with the ${meldLabel(target.rank)}.` };
    } else {
      const cands = mine.filter((m) => m.rank === g.rank);
      target = cands.find((m) => !additionProblem(m, g.cards)) ?? cands[0] ?? null;
    }
    const p = target ? additionProblem(target, g.cards) : newMeldProblem(g.rank, g.cards);
    if (p) return { ok: false, error: p };
    resolved.push({ rank: g.rank, cards: g.cards, target });
    points += sumPoints(g.cards);
  }

  // Taking the pile: the top card has to be melded, with the frozen / unfrozen conditions.
  let pileRest = 0;
  if (take !== null) {
    const g0 = resolved.find((g) => g.cards.includes(take))!;
    const topRank = rankOf(take);
    if (g0.rank !== topRank) return { ok: false, error: `The top card is a ${rankName(topRank)}; it can only go with ${rankName(topRank, true)}.` };
    const naturalsFromHand = g0.cards.filter((c) => c !== take && isNatural(c) && rankOf(c) === topRank).length;
    if (frozenFor(r, h, seat) && naturalsFromHand < 2) {
      const why = h.pileFrozen ? 'The pile is frozen' : 'The pile is frozen for your side until you have melded';
      return { ok: false, error: `${why}: to take it you need two natural ${rankName(topRank, true)} from your hand to go with the top card.` };
    }
    pileRest = h.pile.length - 1;
  }

  const hasBlack3 = resolved.some((g) => g.rank === 3);
  const handAfter = hand.length - usedFromHand + pileRest;
  // Canastas the side will have once these cards are down.
  const sizes = new Map<number, number>(mine.map((m) => [m.id, m.cards.length]));
  let fresh = 0;
  for (const g of resolved) {
    if (g.rank === 3) continue;
    if (g.target) sizes.set(g.target.id, (sizes.get(g.target.id) ?? 0) + g.cards.length);
    else if (g.cards.length >= CANASTA) fresh++;
  }
  const canastasAfter = [...sizes.values()].filter((s) => s >= CANASTA).length + fresh;
  const mayGoOut = canastasAfter >= r.canastasToGoOut && h.askAnswer !== 'no';

  // The first meld of a hand must reach the side's minimum count (red threes and bonuses never count).
  if (!sideHasMelded(r, h, seat)) {
    const need = requirementFor(r, scores, seat);
    const concealedOut = take === null && h.drew === 'stock' && handAfter <= 1 && mayGoOut && resolved.some((g) => !g.target && g.cards.length >= CANASTA);
    if (points < need && !concealedOut) {
      return { ok: false, error: `Your side’s first meld must be worth at least ${need} points; these cards are worth ${points}.${take !== null ? ' Only the top card counts from the pile, not the cards under it.' : ''}` };
    }
  }

  if (handAfter <= 1 && !mayGoOut) {
    if (h.askAnswer === 'no') return { ok: false, error: 'Your partner said no to going out, so you must keep at least one card after your discard.' };
    const need = r.canastasToGoOut;
    return { ok: false, error: `You must keep at least two cards: you cannot go out until your side has ${need === 1 ? 'a canasta' : `${need} canastas`}.` };
  }
  if (hasBlack3 && handAfter > 1) return { ok: false, error: 'Black threes can only be melded as part of going out.' };

  return { ok: true, groups: resolved, points, handAfter, canastasAfter, goingOut: handAfter === 0 };
}

// ------------------------------------------------------------------ applying moves (mutating a clone)

function placeMut(r: RulesConfig, h: HandState, seat: number, groups: Resolved[], take: CardId | null, events: HandEvent[]) {
  const placed: { meld: number; cards: CardId[]; created: boolean }[] = [];
  const hand = h.hands[seat];
  for (const g of groups) {
    for (const c of g.cards) { if (c === take) continue; hand.splice(hand.indexOf(c), 1); }
    let m = g.target;
    const before = m ? m.cards.length : 0;
    const wasNatural = m ? isNaturalCanasta(m) : false;
    if (m) {
      m.cards.push(...g.cards);
      if (m.owner !== seat) h.addedToPartner = true;
      placed.push({ meld: m.id, cards: [...g.cards], created: false });
    } else {
      m = { id: h.nextMeldId++, rank: g.rank, cards: [...g.cards], owner: seat, slot: slotOfSeat(r, seat) };
      h.melds[m.slot].push(m);
      placed.push({ meld: m.id, cards: [...g.cards], created: true });
    }
    if (m.rank !== 3 && isCanasta(m) && (before < CANASTA || (wasNatural && !isNaturalCanasta(m)))) {
      if (before < CANASTA) events.push({ e: 'canasta', seat, meld: m.id, natural: isNaturalCanasta(m) });
    }
    h.log.push({ t: 'meld', seat, cards: g.cards.filter((c) => c !== take) });
  }
  h.playerMelded[seat] = true;
  events.push({ e: 'meld', seat, placed });
}

/** Draw from the stock (two cards with two or three players), laying out and replacing red threes. */
export function drawMut(r: RulesConfig, h: HandState, seat: number, events: HandEvent[]): void {
  if (h.stock.length === 0) {
    events.push({ e: 'stockOut', seat });
    endHandMut(h, 'stock');
    return;
  }
  let kept = 0;
  let want = r.drawCount;
  while (want > 0 && h.stock.length > 0) {
    const c = h.stock.pop()!;
    want--;
    if (isRedThree(c)) {
      h.redThrees[seat].push(c);
      h.log.push({ t: 'redThree', seat, card: c });
      events.push({ e: 'redThree', seat, card: c, replaced: h.stock.length > 0 });
      want++; // a replacement is due
    } else {
      h.hands[seat].push(c);
      kept++;
    }
  }
  h.log.push({ t: 'draw', seat, n: kept });
  events.push({ e: 'draw', seat, count: kept });
  h.drew = 'stock';
  h.phase = 'play';
  // A red three drawn as the last card of the stock ends play: nothing to replace it with.
  if (kept === 0) {
    events.push({ e: 'stockOut', seat });
    endHandMut(h, 'stock');
  }
}

export function takeMut(r: RulesConfig, h: HandState, seat: number, groups: Resolved[], events: HandEvent[]): void {
  const top = h.pile.pop()!;
  const rest = h.pile.splice(0);
  h.log.push({ t: 'take', seat, cards: [...rest, top] });
  events.push({ e: 'take', seat, top, count: rest.length + 1 });
  // The first player to take the pile in a three-player hand plays alone.
  if (r.partnership === 'threeHanded' && h.lone === null) {
    h.lone = seat;
    events.push({ e: 'partnership', lone: seat, partners: [0, 1, 2].filter((s) => s !== seat) });
  }
  placeMut(r, h, seat, groups, top, events);
  for (const c of rest) {
    if (isRedThree(c)) { h.redThrees[seat].push(c); events.push({ e: 'redThree', seat, card: c, replaced: false }); }
    else h.hands[seat].push(c);
  }
  h.pileFrozen = false;
  h.drew = 'pile';
  h.phase = 'play';
  if (h.hands[seat].length === 0) goOutMut(r, h, seat, events);
}

export function meldMut(r: RulesConfig, h: HandState, seat: number, groups: Resolved[], events: HandEvent[]): void {
  placeMut(r, h, seat, groups, null, events);
  h.meldedSinceDraw = true;
  if (h.hands[seat].length === 0) goOutMut(r, h, seat, events);
}

export function discardMut(r: RulesConfig, h: HandState, seat: number, card: CardId, events: HandEvent[]): void {
  const hand = h.hands[seat];
  hand.splice(hand.indexOf(card), 1);
  h.pile.push(card);
  const froze = isWild(card) && !h.pileFrozen;
  if (isWild(card)) h.pileFrozen = true;
  h.log.push({ t: 'discard', seat, card });
  events.push({ e: 'discard', seat, card, froze, stop: isBlackThree(card) });
  if (hand.length === 0) { goOutMut(r, h, seat, events); return; }
  beginTurnMut(r, h, nextSeat(r, seat), events);
}

function goOutMut(r: RulesConfig, h: HandState, seat: number, events: HandEvent[]) {
  h.wentOut = seat;
  const ownCanasta = h.melds.flat().some((m) => m.owner === seat && m.rank !== 3 && isCanasta(m));
  h.concealed = !h.meldedBeforeTurn && !h.addedToPartner && ownCanasta;
  // Going out before anyone took the pile makes that player the lone hand for scoring.
  if (r.partnership === 'threeHanded' && h.lone === null) {
    h.lone = seat;
    events.push({ e: 'partnership', lone: seat, partners: [0, 1, 2].filter((s) => s !== seat) });
  }
  events.push({ e: 'out', seat, concealed: h.concealed });
  endHandMut(h, 'out');
}

function endHandMut(h: HandState, why: 'out' | 'stock') {
  h.phase = 'over';
  h.endReason = why;
}

export function beginTurnMut(_r: RulesConfig, h: HandState, seat: number, events: HandEvent[]) {
  h.turn = seat;
  h.phase = 'draw';
  h.drew = null;
  h.askAnswer = null;
  h.asked = false;
  h.meldedSinceDraw = false;
  h.addedToPartner = false;
  h.meldedBeforeTurn = h.playerMelded[seat];
  events.push({ e: 'turn', seat });
}

// ------------------------------------------------------------------ rules questions the UI and AI share

/**
 * With the stock gone, a player must take the pile if it is not frozen for their side
 * and its top card matches one of their side's melds.
 */
export function mustTakePile(r: RulesConfig, h: HandState, seat: number): Meld | null {
  if (h.stock.length > 0 || h.phase !== 'draw') return null;
  if (pileBlocked(h, seat) || frozenFor(r, h, seat)) return null;
  const top = pileTop(h)!;
  return sideMelds(r, h, seat).find((m) => m.rank === rankOf(top) && !additionProblem(m, [top])) ?? null;
}

export const cardsInHandValue = (h: HandState, seat: number) => sumPoints(h.hands[seat]);
