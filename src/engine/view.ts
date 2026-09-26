/**
 * Everything one seat is entitled to know. This is the ONLY input the computer
 * players get: it has no field for other hands or the order of the stock, so an
 * AI cannot read hidden cards even by accident. The discard pile is included in
 * full because every card in it was seen face up when it was discarded.
 *
 * `handStateFromView` rebuilds a HandState with hidden cards replaced by blanks
 * (-1), so the AI can ask the real rules engine whether a move is legal.
 */
import type { CardId } from '../rules/cards.ts';
import type { RulesConfig } from '../rules/config.ts';
import type { Meld } from '../rules/melds.ts';
import type { HandState, Phase, PublicAct } from './hand.ts';
import type { MatchState } from './match.ts';

export interface PublicView {
  readonly rules: RulesConfig;
  readonly seat: number;
  readonly handNo: number;
  readonly dealer: number;
  readonly scores: readonly number[];
  readonly hand: readonly CardId[];
  readonly handSizes: readonly number[];
  readonly stockCount: number;
  readonly pile: readonly CardId[];
  readonly pileFrozen: boolean;
  readonly melds: readonly (readonly Meld[])[];
  readonly redThrees: readonly (readonly CardId[])[];
  readonly turn: number;
  readonly phase: Phase;
  readonly drew: HandState['drew'];
  readonly askAnswer: HandState['askAnswer'];
  readonly asked: boolean;
  readonly meldedSinceDraw: boolean;
  readonly playerMelded: readonly boolean[];
  readonly meldedBeforeTurn: boolean;
  readonly addedToPartner: boolean;
  readonly lone: number | null;
  readonly log: readonly PublicAct[];
  readonly matchSeed: number;
}

export const HIDDEN = -1;

export function viewFor(s: MatchState, seat: number): PublicView {
  const h = s.hand;
  return {
    rules: s.setup.rules,
    seat,
    handNo: s.handNo,
    dealer: s.dealer,
    scores: [...s.scores],
    hand: [...h.hands[seat]],
    handSizes: h.hands.map((x) => x.length),
    stockCount: h.stock.length,
    pile: [...h.pile],
    pileFrozen: h.pileFrozen,
    melds: h.melds.map((slot) => slot.map((m) => ({ ...m, cards: [...m.cards] }))),
    redThrees: h.redThrees.map((x) => [...x]),
    turn: h.turn,
    phase: h.phase,
    drew: h.drew,
    askAnswer: h.askAnswer,
    asked: h.asked,
    meldedSinceDraw: h.meldedSinceDraw,
    playerMelded: [...h.playerMelded],
    meldedBeforeTurn: h.meldedBeforeTurn,
    addedToPartner: h.addedToPartner,
    lone: h.lone,
    log: h.log.map((a) => ('cards' in a ? { ...a, cards: [...a.cards] } : { ...a })) as PublicAct[],
    matchSeed: s.setup.seed,
  };
}

/** A HandState the rules engine can check moves against, with every hidden card blank. */
export function handStateFromView(v: PublicView): HandState {
  return {
    hands: v.handSizes.map((n, i) => (i === v.seat ? [...v.hand] : Array(n).fill(HIDDEN))),
    stock: Array(v.stockCount).fill(HIDDEN),
    pile: [...v.pile],
    pileFrozen: v.pileFrozen,
    melds: v.melds.map((slot) => slot.map((m) => ({ ...m, cards: [...m.cards] }))),
    redThrees: v.redThrees.map((x) => [...x]),
    turn: v.turn,
    phase: v.phase,
    drew: v.drew,
    askAnswer: v.askAnswer,
    asked: v.asked,
    meldedSinceDraw: v.meldedSinceDraw,
    playerMelded: [...v.playerMelded],
    meldedBeforeTurn: v.meldedBeforeTurn,
    addedToPartner: v.addedToPartner,
    lone: v.lone,
    wentOut: null,
    concealed: false,
    endReason: null,
    nextMeldId: 1 + Math.max(0, ...v.melds.flat().map((m) => m.id)),
    firstPlayer: 0,
    log: [],
  };
}
