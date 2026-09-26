/**
 * Expert: determinized Monte Carlo on the two decisions that matter most in
 * Classic Canasta — whether to take the pile, and what to discard.
 *
 * For each decision it samples several "worlds": the cards it cannot see are
 * dealt at random into the other hands and the stock, except that cards it saw
 * an opponent pick up with the pile (and not play since) stay in that
 * opponent's hand, and red threes only ever go into the stock (nobody can hold
 * one). Each candidate move is played in every world, then the rest of the hand
 * is played out quickly by the Standard policy for everyone, and the candidate
 * with the best average score difference wins. The same worlds are used for
 * every candidate, the budget is fixed and the random streams are seeded from
 * the public view, so a decision is reproducible.
 *
 * It never reads hidden state: its only input is the PublicView.
 */
import { isBlackThree, isRedThree, isWild, pointValue, rankOf, type CardId } from '../rules/cards.ts';
import { lineOfSeat, scoreLines, type RulesConfig } from '../rules/config.ts';
import { hashSeed, makeRng, shuffle, type Rng } from '../rules/rng.ts';
import { checkGroups, discardMut, drawMut, meldMut, mustTakePile, partnerOf, pileTop, sideCanastas, takeMut, type HandEvent, type HandState } from '../engine/hand.ts';
import { scoreHand } from '../engine/scoring.ts';
import { handStateFromView, type PublicView } from '../engine/view.ts';
import type { AiMove } from './policy.ts';

type Decide = (v: PublicView) => AiMove;

/** worlds sampled per decision; horizon = turns played out before judging the position (0 = to the end of the hand). */
export const EXPERT_BUDGET = { worlds: 24, maxCandidates: 7, rolloutSteps: 500, horizon: 8 };

/** Cards an opponent is known to hold: picked up with a pile and not melded or discarded since. */
export function knownHands(v: PublicView): CardId[][] {
  const known: CardId[][] = v.handSizes.map(() => []);
  for (const a of v.log) {
    if (a.seat === v.seat) continue;
    if (a.t === 'take') known[a.seat].push(...a.cards.filter((c) => !isRedThree(c)));
    else if (a.t === 'meld') for (const c of a.cards) { const i = known[a.seat].indexOf(c); if (i >= 0) known[a.seat].splice(i, 1); }
    else if (a.t === 'discard') { const i = known[a.seat].indexOf(a.card); if (i >= 0) known[a.seat].splice(i, 1); }
  }
  // Never claim more than they hold (a take's top card was melded at once).
  return known.map((k, s) => k.slice(0, v.handSizes[s]));
}

interface World { hands: CardId[][]; stock: CardId[] }

export function sampleWorld(v: PublicView, known: CardId[][], rng: Rng): World | null {
  const seen = new Set<CardId>([...v.hand, ...v.pile, ...v.melds.flat().flatMap((m) => m.cards), ...v.redThrees.flat(), ...known.flat()]);
  const pool: CardId[] = [], reds: CardId[] = [];
  for (let c = 0; c < 108; c++) if (!seen.has(c)) (isRedThree(c) ? reds : pool).push(c);
  shuffle(pool, rng);
  const hands = v.handSizes.map((n, s) => {
    if (s === v.seat) return [...v.hand];
    const need = n - known[s].length;
    return [...known[s], ...pool.splice(0, Math.max(0, need))];
  });
  if (hands.some((hh, s) => hh.length !== v.handSizes[s])) return null;
  const stock = shuffle([...pool, ...reds], rng);
  if (stock.length !== v.stockCount) return null;
  return { hands, stock };
}

/** A view onto a rollout's HandState without copying (the policy never mutates it). */
function lightView(v0: PublicView, r: RulesConfig, h: HandState, scores: number[], seat: number, step: number): PublicView {
  return {
    rules: r, seat, handNo: v0.handNo, dealer: v0.dealer, scores, hand: h.hands[seat], handSizes: h.hands.map((x) => x.length), stockCount: h.stock.length,
    pile: h.pile, pileFrozen: h.pileFrozen, melds: h.melds, redThrees: h.redThrees, turn: h.turn, phase: h.phase, drew: h.drew, askAnswer: h.askAnswer,
    asked: h.asked, meldedSinceDraw: h.meldedSinceDraw, playerMelded: h.playerMelded, meldedBeforeTurn: h.meldedBeforeTurn, addedToPartner: h.addedToPartner,
    lone: h.lone, log: [], matchSeed: (v0.matchSeed ^ (step * 2654435761)) >>> 0,
  };
}

/** Apply a move directly to a rollout's state (the rollout owns it). False if the engine would refuse it. */
function fastApply(r: RulesConfig, h: HandState, scores: number[], seat: number, m: AiMove): boolean {
  const ev: HandEvent[] = [];
  switch (m.t) {
    case 'draw':
      if (h.phase !== 'draw' || mustTakePile(r, h, seat)) return false;
      drawMut(r, h, seat, ev);
      return true;
    case 'take': {
      if (h.phase !== 'draw') return false;
      const c = checkGroups(r, h, scores, seat, m.groups, pileTop(h));
      if (!c.ok) return false;
      takeMut(r, h, seat, c.groups, ev);
      return true;
    }
    case 'meld': {
      if (h.phase !== 'play') return false;
      const c = checkGroups(r, h, scores, seat, m.groups, null);
      if (!c.ok) return false;
      meldMut(r, h, seat, c.groups, ev);
      return true;
    }
    case 'discard': {
      if (h.phase !== 'play' || !h.hands[seat].includes(m.card)) return false;
      if (h.hands[seat].length === 1 && (sideCanastas(r, h, seat) < r.canastasToGoOut || h.askAnswer === 'no')) return false;
      if (h.hands[seat].length > 1 && h.askAnswer === 'yes') return false;
      discardMut(r, h, seat, m.card, ev);
      return true;
    }
    case 'ask': h.asked = true; h.askAnswer = 'yes'; return true;
    case 'answer': h.phase = 'play'; h.askAnswer = m.yes ? 'yes' : 'no'; return true;
  }
}

/** Play the rest of the hand from `first`; return this seat's line score minus the others' average. */
function rollout(v: PublicView, world: World, first: AiMove, standard: Decide): number {
  const r = v.rules;
  const h = handStateFromView(v);
  h.hands = world.hands.map((x) => [...x]);
  h.stock = [...world.stock];
  const scores = [...v.scores];
  if (!fastApply(r, h, scores, v.seat, first)) return -1e6;
  let turns = 0;
  for (let step = 0; step < EXPERT_BUDGET.rolloutSteps && h.phase !== 'over'; step++) {
    if (EXPERT_BUDGET.horizon && h.phase === 'draw' && ++turns > EXPERT_BUDGET.horizon) break;
    const seat = h.phase === 'ask' ? partnerOf(r, h, h.turn)! : h.turn;
    const m = standard(lightView(v, r, h, scores, seat, step));
    if (!fastApply(r, h, scores, seat, m)) {
      const fb: AiMove = h.phase === 'draw' ? { t: 'draw' } : h.phase === 'ask' ? { t: 'answer', yes: true } : { t: 'discard', card: h.hands[seat][0] };
      if (!fastApply(r, h, scores, seat, fb)) break;
    }
  }
  // Judge the position: the score if the hand ended now, plus credit for melds close to a canasta.
  const lines = scoreHand(r, h).lines.map((l, i) => l.total + (h.phase === 'over' ? 0 : progress(r, h, i)));
  const mine = lineOfSeat(r, v.seat);
  const n = scoreLines(r);
  let others = 0;
  for (let i = 0; i < n; i++) if (i !== mine) others += lines[i];
  return lines[mine] - others / (n - 1);
}

function progress(r: RulesConfig, h: HandState, line: number): number {
  const slots = r.partnership === 'fixed' ? [line] : sideSlotsOfLine(r, h, line);
  let t = 0;
  for (const sl of slots) for (const m of h.melds[sl]) if (m.cards.length >= 4 && m.cards.length < 7) t += (m.cards.length - 3) * 60;
  return t;
}

function sideSlotsOfLine(r: RulesConfig, h: HandState, line: number): number[] {
  if (r.partnership !== 'threeHanded' || h.lone === null || line === h.lone) return [line];
  return [0, 1, 2].filter((s) => s !== h.lone);
}

function best(v: PublicView, candidates: AiMove[], standard: Decide, salt: string): AiMove | null {
  if (candidates.length <= 1) return candidates[0] ?? null;
  const rng = makeRng(hashSeed(v.matchSeed, v.handNo, v.log.length, v.seat, salt));
  const known = knownHands(v);
  const worlds: World[] = [];
  for (let i = 0; i < EXPERT_BUDGET.worlds * 2 && worlds.length < EXPERT_BUDGET.worlds; i++) {
    const w = sampleWorld(v, known, rng);
    if (w) worlds.push(w);
  }
  if (!worlds.length) return null;
  let bestMove: AiMove | null = null, bestScore = -Infinity;
  for (const m of candidates) {
    let t = 0;
    for (const w of worlds) t += rollout(v, w, m, standard);
    // A small preference for the order given (Standard's own choice first) breaks near-ties.
    const score = t / worlds.length - candidates.indexOf(m) * 0.5;
    if (score > bestScore) { bestScore = score; bestMove = m; }
  }
  return bestMove;
}

/** Take or draw: Standard's cheapest ways to take the pile, against drawing. */
export function expertStart(v: PublicView, takes: AiMove[], fallback: AiMove, standard: Decide): AiMove {
  if (v.stockCount === 0 || !takes.length) return fallback;
  const cands: AiMove[] = [fallback, ...takes.filter((t) => JSON.stringify(t) !== JSON.stringify(fallback)).slice(0, 2)];
  if (fallback.t !== 'draw') cands.push({ t: 'draw' });
  return best(v, cands, standard, 'start') ?? fallback;
}

/** Discard: one candidate per kind of card (rank, wild card, black three), Standard's choice first. */
export function expertDiscard(v: PublicView, fallback: CardId, standard: Decide): AiMove {
  const kinds = new Map<string, CardId>();
  const key = (c: CardId) => (isWild(c) ? `w${pointValue(c)}` : isBlackThree(c) ? 'b3' : `n${rankOf(c)}`);
  kinds.set(key(fallback), fallback);
  const hand = [...v.hand].sort((a, b) => pointValue(a) - pointValue(b));
  for (const c of hand) {
    if (kinds.size >= EXPERT_BUDGET.maxCandidates) break;
    // Wild cards are only worth considering as a freeze of a sizeable pile.
    if (isWild(c) && v.pile.length < 6) continue;
    if (!kinds.has(key(c))) kinds.set(key(c), c);
  }
  const cands: AiMove[] = [...kinds.values()].map((card) => ({ t: 'discard', card }));
  return best(v, cands, standard, 'discard') ?? { t: 'discard', card: fallback };
}

