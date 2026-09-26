import { rankOf, suitOf, isJoker, type CardId } from '../src/rules/cards.ts';
import { rulesFor, type PlayerCount } from '../src/rules/config.ts';
import { apply, newMatch, type Command, type MatchState, type SeatConfig } from '../src/engine/match.ts';
import type { Meld } from '../src/rules/melds.ts';

/**
 * Card ids by name: 'KH', '10S', '2C', 'AD', 'Jk' (joker). Each call hands out a
 * different physical copy of that card (there are two of each, four jokers), so a
 * scenario never accidentally uses the same card twice.
 */
export function cards() {
  const used = new Set<CardId>();
  const RANKS: Record<string, number> = { A: 1, J: 11, Q: 12, K: 13 };
  return (spec: string): CardId => {
    for (let id = 0; id < 108; id++) {
      if (used.has(id)) continue;
      let ok: boolean;
      if (spec === 'Jk') ok = isJoker(id);
      else {
        const suit = spec.slice(-1), r = spec.slice(0, -1);
        const rank = RANKS[r] ?? Number(r);
        ok = !isJoker(id) && rankOf(id) === rank && suitOf(id) === suit;
      }
      if (ok) { used.add(id); return id; }
    }
    throw new Error('No copy left of ' + spec);
  };
}

export const seats = (n: number, kind: 'human' | 'ai' = 'human'): SeatConfig[] => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, kind, level: 'standard' }));

export function fresh(players: PlayerCount, seed = 1): MatchState {
  return newMatch({ rules: rulesFor(players), seats: seats(players), seed }).state;
}

export interface Scenario {
  players?: PlayerCount;
  hands: string[][];
  pile?: string[];
  stock?: string[];
  melds?: { slot: number; owner: number; rank: number; cards: string[] }[];
  redThrees?: string[][];
  scores?: number[];
  turn?: number;
  phase?: 'draw' | 'play';
  frozen?: boolean;
  lone?: number | null;
  playerMelded?: boolean[];
}

/**
 * A match positioned at an exact table. Unlisted cards are simply out of play,
 * which the engine never needs to know.
 */
export function scenario(sc: Scenario): { s: MatchState; c: (spec: string) => CardId } {
  const players = sc.players ?? 4;
  const s = fresh(players);
  const c = cards();
  const h = s.hand;
  h.hands = sc.hands.map((hs) => hs.map(c));
  h.pile = (sc.pile ?? []).map(c);
  h.stock = (sc.stock ?? ['4C', '4D', '4H', '4S', '5C', '5D', '5H', '5S', '6C', '6D']).map(c);
  h.pileFrozen = sc.frozen ?? false;
  h.melds = Array.from({ length: players === 4 ? 2 : players }, () => [] as Meld[]);
  let id = 1;
  for (const m of sc.melds ?? []) h.melds[m.slot].push({ id: id++, rank: m.rank, cards: m.cards.map(c), owner: m.owner, slot: m.slot });
  h.nextMeldId = id;
  h.redThrees = (sc.redThrees ?? Array.from({ length: players }, () => [])).map((x) => x.map(c));
  h.turn = sc.turn ?? 0;
  h.phase = sc.phase ?? 'draw';
  h.drew = h.phase === 'play' ? 'stock' : null;
  h.playerMelded = sc.playerMelded ?? Array.from({ length: players }, (_, i) => (sc.melds ?? []).some((m) => m.owner === i));
  h.meldedBeforeTurn = h.playerMelded[h.turn];
  h.lone = sc.lone ?? null;
  h.log = [];
  if (sc.scores) s.scores = [...sc.scores];
  return { s, c };
}

type NoSeq<T> = T extends unknown ? Omit<T, 'seq'> : never;
/** Apply a command (seq filled in) and return the new state, or throw with the engine's message. */
export function step(s: MatchState, cmd: NoSeq<Command>): MatchState {
  const r = apply(s, { ...cmd, seq: s.seq } as Command);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}
export function tryStep(s: MatchState, cmd: NoSeq<Command>) {
  return apply(s, { ...cmd, seq: s.seq } as Command);
}

/** Ids in `hand` matching the given names ('KH', 'Jk', …), each id used once. */
export function pick(hand: readonly CardId[], ...specs: string[]): CardId[] {
  const RANKS: Record<string, number> = { A: 1, J: 11, Q: 12, K: 13 };
  const left = [...hand];
  return specs.map((spec) => {
    const i = left.findIndex((id) => {
      if (spec === 'Jk') return isJoker(id);
      const suit = spec.slice(-1), r = spec.slice(0, -1);
      return !isJoker(id) && rankOf(id) === (RANKS[r] ?? Number(r)) && suitOf(id) === suit;
    });
    if (i < 0) throw new Error(`${spec} not in hand`);
    return left.splice(i, 1)[0];
  });
}
