/**
 * The computer players. They receive only a PublicView (engine/view.ts), build
 * candidate moves from their own hand and the table, and check every candidate
 * with the real rules engine (checkGroups) before choosing it, so they cannot
 * make an illegal move.
 *
 * The three levels match Scopa's labels:
 * - Relaxed: melds whatever it can as soon as it can, takes the pile when it is
 *   easy, discards its least useful card with some randomness and no sense of
 *   danger. Never asks partner.
 * - Standard: keeps pairs for taking frozen piles, completes canastas with wild
 *   cards, avoids discarding cards that let the next opponent add to a meld and
 *   take a live pile, uses black threes as stoppers, times going out.
 * - Expert: remembers every card it has seen (melds, discards, and the piles
 *   opponents picked up) and from that estimates, for each possible discard, the
 *   chance the next opponent can take the pile with it; weighs pile value against
 *   the cost of taking; freezes a big pile with a wild card; asks partner before
 *   going out. Its weights were tuned by self-play against Standard (tools/tune.ts,
 *   docs/AI_REPORT.md).
 */
import { isBlackThree, isNatural, isWild, pointValue, rankOf, sumPoints, type CardId, type Rank } from '../rules/cards.ts';
import { CANASTA, MAX_WILDS, wildCount, type Meld } from '../rules/melds.ts';
import { hashSeed, makeRng, type Rng } from '../rules/rng.ts';
import { checkGroups, frozenFor, mustTakePile, partnerOf, pileBlocked, requirementFor, sideHasMelded, sideMelds, sideSeats, type Group, type HandState } from '../engine/hand.ts';
import { goOutPlan } from '../engine/solver.ts';
import { handStateFromView, type PublicView } from '../engine/view.ts';
import type { AiLevel } from '../engine/match.ts';
import { personaById, type Persona } from './personalities.ts';
import { expertDiscard, expertStart } from './expert.ts';

export type AiMove =
  | { t: 'draw' }
  | { t: 'take'; groups: Group[] }
  | { t: 'meld'; groups: Group[] }
  | { t: 'discard'; card: CardId }
  | { t: 'ask' }
  | { t: 'answer'; yes: boolean };

/** The judgement a level plays with. */
export interface Weights {
  /** Take the pile when its value reaches cost × this. */
  takeFactor: number;
  /** Extra cost of spending a wild card to take the pile. */
  wildTakeCost: number;
  /** Keep natural pairs back (for frozen piles) while the stock has at least this many cards. */
  holdPairsUntil: number;
  /** Go out when partner holds at most this many cards… */
  goOutPartnerCards: number;
  /** …or the stock is below this. */
  goOutStock: number;
  /** Keep bonus, per pile card, for a card that lets the next opponent add to a meld and take the pile. */
  meldDanger: number;
  /** Keep bonus, per pile card, times the estimated chance the next opponent can take the pile with it (0 = not estimated). */
  pairDanger: number;
  /** Freeze a live pile of at least this many cards with a wild card (99 = never). */
  freezeAt: number;
  /** A black three becomes the preferred discard once the pile has this many cards. */
  blackThreeAt: number;
  /** How strongly to shed high cards when the stock runs low. */
  shedLate: number;
  /** Ask partner before going out while partner holds at least this many cards (99 = never ask). */
  askAt: number;
  /** Randomness in discards (Relaxed). */
  noise: number;
}

export const WEIGHTS: Record<AiLevel, Weights> = {
  relaxed: { takeFactor: 0.4, wildTakeCost: 0, holdPairsUntil: 0, goOutPartnerCards: 99, goOutStock: 200, meldDanger: 0, pairDanger: 0, freezeAt: 99, blackThreeAt: 99, shedLate: 0, askAt: 99, noise: 10 },
  standard: { takeFactor: 2.5, wildTakeCost: 1.5, holdPairsUntil: 20, goOutPartnerCards: 5, goOutStock: 12, meldDanger: 1, pairDanger: 0, freezeAt: 99, blackThreeAt: 5, shedLate: 0.35, askAt: 99, noise: 0 },
  expert: { takeFactor: 2.5, wildTakeCost: 1.5, holdPairsUntil: 20, goOutPartnerCards: 5, goOutStock: 12, meldDanger: 1, pairDanger: 1, freezeAt: 12, blackThreeAt: 5, shedLate: 0.35, askAt: 6, noise: 0 },
};

interface Ctx { v: PublicView; hs: HandState; level: AiLevel; w: Weights; p: Persona; rng: Rng; melds: Meld[] }

const legal = (x: Ctx, groups: Group[], take: CardId | null) => checkGroups(x.v.rules, x.hs, x.v.scores, x.v.seat, groups, take);

/** Natural cards by rank and wild cards (twos before jokers) in a hand. */
function buckets(hand: readonly CardId[]) {
  const nat = new Map<Rank, CardId[]>();
  for (const c of hand) if (isNatural(c)) nat.set(rankOf(c), [...(nat.get(rankOf(c)) ?? []), c]);
  const wild = hand.filter(isWild).sort((a, b) => pointValue(a) - pointValue(b));
  return { nat, wild };
}

export function decide(v: PublicView, level: AiLevel, personaId?: string, weights?: Weights): AiMove {
  const x: Ctx = { v, hs: handStateFromView(v), level, w: weights ?? WEIGHTS[level], p: personaById(personaId), rng: makeRng(hashSeed(v.matchSeed, v.handNo, v.log.length, v.seat, v.hand.length, 'ai')), melds: [] };
  x.melds = sideMelds(v.rules, x.hs, v.seat);
  if (v.phase === 'ask') return { t: 'answer', yes: answerAsk(x) };
  const monteCarlo = level === 'expert' && !weights;
  const standard = (w: PublicView) => decide(w, 'standard');
  if (v.phase === 'draw') {
    const m = drawOrTake(x);
    if (!monteCarlo || mustTakePile(v.rules, x.hs, v.seat)) return m;
    return expertStart(v, takeOptions(x).map((o) => ({ t: 'take', groups: o.groups })), m, standard);
  }
  const m = playPhase(x);
  if (monteCarlo && m.t === 'discard' && v.hand.length > 1) return expertDiscard(v, m.card, standard);
  return m;
}

// ------------------------------------------------------------------ start of turn

/** Candidate ways to take the pile, cheapest first, each already checked by the engine. */
function takeOptions(x: Ctx): { groups: Group[]; cost: number }[] {
  const { v, hs } = x;
  if (pileBlocked(hs, v.seat)) return [];
  const top = v.pile[v.pile.length - 1];
  const r = rankOf(top);
  const { nat, wild } = buckets(v.hand);
  const mine = nat.get(r) ?? [];
  const frozen = frozenFor(v.rules, hs, v.seat);
  const seeds: { g: Group; cost: number }[] = [];
  const existing = x.melds.find((m) => m.rank === r);
  if (existing && !frozen) seeds.push({ g: { rank: r, cards: [top], into: existing.id }, cost: 0 });
  if (mine.length >= 2) seeds.push({ g: existing ? { rank: r, cards: [top, ...mine], into: existing.id } : { rank: r, cards: [top, ...mine] }, cost: existing ? 0.5 : 1 });
  if (!frozen && mine.length === 1 && wild.length) seeds.push({ g: { rank: r, cards: [top, mine[0], wild[0]] }, cost: 1 + x.w.wildTakeCost * (pointValue(wild[0]) / 20) });
  const out: { groups: Group[]; cost: number }[] = [];
  const opening = !sideHasMelded(v.rules, hs, v.seat);
  for (const s of seeds) {
    let groups = [s.g];
    let cost = s.cost;
    if (opening) {
      const extra = openingFrom(v.hand.filter((c) => !s.g.cards.includes(c)), requirementFor(v.rules, v.scores, v.seat) - sumPoints(s.g.cards), [r]);
      if (!extra) continue;
      groups = [...groups, ...extra];
      cost += extra.reduce((t, g) => t + g.cards.length, 0) * 0.3;
    }
    if (legal(x, groups, top).ok) out.push({ groups, cost });
  }
  return out.sort((a, b) => a.cost - b.cost);
}

function drawOrTake(x: Ctx): AiMove {
  const { v } = x;
  const opts = takeOptions(x);
  if (mustTakePile(v.rules, x.hs, v.seat) && opts.length) return { t: 'take', groups: opts[0].groups };
  if (!opts.length) return { t: 'draw' };
  if (v.stockCount === 0) return { t: 'take', groups: opts[0].groups };
  const best = opts[0];
  // What the pile is worth: natural cards that fit our melds or pairs most, wild cards a lot, the rest a little.
  const { nat } = buckets(v.hand);
  let value = 1;
  for (const c of v.pile.slice(0, -1)) {
    if (isWild(c)) value += 2.5;
    else if (isNatural(c)) value += x.melds.some((m) => m.rank === rankOf(c)) || (nat.get(rankOf(c))?.length ?? 0) >= 1 ? 1.5 : 0.7;
    else value += 0.2;
  }
  if (x.level === 'relaxed') return x.rng() < 0.85 ? { t: 'take', groups: best.groups } : { t: 'draw' };
  return value * x.p.greed >= best.cost * x.w.takeFactor ? { t: 'take', groups: best.groups } : { t: 'draw' };
}

/**
 * Melds from `hand` worth at least `need` points (for a side's first meld), using as few
 * cards as it can. `avoid` ranks are already being melded in the same move.
 */
function openingFrom(hand: readonly CardId[], need: number, avoid: Rank[] = []): Group[] | null {
  if (need <= 0) return [];
  const { nat, wild } = buckets(hand);
  const ranks = [...nat.keys()].filter((r) => !avoid.includes(r) && nat.get(r)!.length >= 2);
  let best: { groups: Group[]; cards: number } | null = null;
  const k = Math.min(ranks.length, 9);
  for (let mask = 1; mask < 1 << k; mask++) {
    const chosen = ranks.slice(0, k).filter((_, i) => mask & (1 << i));
    const wilds = [...wild];
    const groups: Group[] = [];
    let ok = true;
    for (const r of chosen) {
      const cs = [...nat.get(r)!];
      if (cs.length === 2) { if (!wilds.length) { ok = false; break; } cs.push(wilds.shift()!); }
      groups.push({ rank: r, cards: cs });
    }
    if (!ok) continue;
    let pts = groups.reduce((t, g) => t + sumPoints(g.cards), 0);
    for (const g of groups) {
      while (pts < need && wilds.length && wildCount(g.cards) < MAX_WILDS) { const w = wilds.shift()!; g.cards.push(w); pts += pointValue(w); }
    }
    if (pts < need) continue;
    const used = groups.reduce((t, g) => t + g.cards.length, 0);
    if (!best || used < best.cards) best = { groups, cards: used };
  }
  return best?.groups ?? null;
}

// ------------------------------------------------------------------ melding and discarding

function playPhase(x: Ctx): AiMove {
  const { v } = x;
  const plan = goOutPlan(v.hand, x.melds, v.rules.canastasToGoOut);
  if (plan && v.askAnswer !== 'no' && (v.askAnswer === 'yes' || wantsToGoOut(x))) {
    const partner = partnerOf(v.rules, x.hs, v.seat);
    if (v.askAnswer === null && partner !== null && !v.asked && !v.meldedSinceDraw && v.handSizes[partner] >= x.w.askAt) return { t: 'ask' };
    if (plan.groups.length && legal(x, plan.groups, null).ok) return { t: 'meld', groups: plan.groups };
    if (plan.discard !== null && v.hand.length === 1) return { t: 'discard', card: plan.discard };
  }
  const m = meldMove(x);
  if (m) return m;
  return { t: 'discard', card: chooseDiscard(x) };
}

function wantsToGoOut(x: Ctx): boolean {
  const { v } = x;
  if (x.level === 'relaxed') return true;
  const mine = new Set(sideSeats(v.rules, x.hs, v.seat));
  const partnerCards = [...mine].filter((s) => s !== v.seat).reduce((t, s) => t + v.handSizes[s], 0);
  const theirCards = v.handSizes.reduce((t, n, s) => (mine.has(s) ? t : t + n), 0);
  if (partnerCards === 0 || v.stockCount < x.w.goOutStock) return true;
  if (theirCards >= partnerCards + 4) return true;
  const oppMelds = v.melds.flat().filter((m) => !x.melds.includes(m));
  if (oppMelds.filter((m) => m.cards.length >= CANASTA).length >= v.rules.canastasToGoOut) return true;
  return partnerCards <= x.w.goOutPartnerCards * x.p.patience;
}

function answerAsk(x: Ctx): boolean {
  const { v } = x;
  if (x.level === 'relaxed') return x.rng() < 0.75;
  return sumPoints(v.hand) <= 70 || v.hand.length <= 4 || v.stockCount < x.w.goOutStock;
}

function meldMove(x: Ctx): AiMove | null {
  const { v } = x;
  const { nat, wild } = buckets(v.hand);
  if (!sideHasMelded(v.rules, x.hs, v.seat)) {
    const g = openingFrom(v.hand, requirementFor(v.rules, v.scores, v.seat));
    if (g && g.length && legal(x, g, null).ok) return { t: 'meld', groups: g };
    return null;
  }
  const groups: Group[] = [];
  let wildLeft = [...wild];
  const holdPairs = v.stockCount >= x.w.holdPairsUntil * x.p.patience;
  for (const [r, cs] of nat) {
    const target = x.melds.find((m) => m.rank === r);
    if (target) { groups.push({ rank: r, cards: [...cs], into: target.id }); continue; }
    if (cs.length >= 3) groups.push({ rank: r, cards: [...cs] });
    else if (cs.length === 2 && !holdPairs && wildLeft.length) groups.push({ rank: r, cards: [...cs, wildLeft.shift()!] });
  }
  // Wild cards: complete canastas (Relaxed also scatters them wherever there is room).
  const meldOf = (g: Group) => (g.into !== undefined ? x.melds.find((m) => m.id === g.into)! : null);
  const sized = (g: Group) => (meldOf(g)?.cards.length ?? 0) + g.cards.length;
  const wildsIn = (g: Group) => wildCount(meldOf(g)?.cards ?? []) + wildCount(g.cards);
  for (const m of x.melds) if (!groups.some((g) => g.into === m.id)) groups.push({ rank: m.rank, cards: [], into: m.id });
  for (const g of [...groups].sort((a, b) => sized(b) - sized(a))) {
    if (!wildLeft.length) break;
    const size = sized(g), room = MAX_WILDS - wildsIn(g);
    if (size < CANASTA && CANASTA - size <= Math.min(room, wildLeft.length)) {
      const k = CANASTA - size;
      g.cards.push(...wildLeft.slice(0, k));
      wildLeft = wildLeft.slice(k);
    } else if (x.level === 'relaxed' && room > 0 && size >= 3 && x.rng() < 0.5) g.cards.push(wildLeft.shift()!);
  }
  let chosen = groups.filter((g) => g.cards.length > 0);
  // The engine refuses to leave fewer than two cards unless going out: trim until it agrees.
  for (let tries = 0; tries < 16 && chosen.length; tries++) {
    const res = legal(x, chosen, null);
    if (res.ok && (res.handAfter >= 2 || res.goingOut)) return { t: 'meld', groups: chosen };
    chosen = chosen.slice(0, -1);
  }
  return null;
}

/** Cards the player knows an opponent holds: picked up with a pile and not since melded or discarded. */
function knownHands(v: PublicView): CardId[][] {
  const known: CardId[][] = v.handSizes.map(() => []);
  for (const a of v.log) {
    if (a.seat === v.seat) continue;
    if (a.t === 'take') known[a.seat].push(...a.cards.filter((c) => !isBlackThree(c) && !(rankOf(c) === 3)));
    else if (a.t === 'meld') for (const c of a.cards) { const i = known[a.seat].indexOf(c); if (i >= 0) known[a.seat].splice(i, 1); }
    else if (a.t === 'discard') { const i = known[a.seat].indexOf(a.card); if (i >= 0) known[a.seat].splice(i, 1); }
  }
  return known;
}

const LOGF: number[] = [0];
for (let i = 1; i <= 120; i++) LOGF[i] = LOGF[i - 1] + Math.log(i);
const logC = (n: number, k: number) => (k < 0 || k > n ? -Infinity : LOGF[n] - LOGF[k] - LOGF[n - k]);
/** P(X ≥ k) when m cards are drawn from a pool of U holding u of the kind wanted. */
function atLeast(k: number, U: number, u: number, m: number): number {
  if (k <= 0) return 1;
  if (u < k || m < k || U <= 0) return 0;
  let below = 0;
  for (let i = 0; i < k; i++) below += Math.exp(logC(u, i) + logC(U - u, m - i) - logC(U, m));
  return Math.max(0, Math.min(1, 1 - below));
}

/** How much the player wants to keep each card; the lowest is discarded. */
function chooseDiscard(x: Ctx): CardId {
  const { v, w } = x;
  const hand = v.hand;
  if (hand.length === 1) return hand[0];
  const next = (v.seat + 1) % v.rules.players;
  const mySide = new Set(sideSeats(v.rules, x.hs, v.seat));
  const nextIsOpp = !mySide.has(next);
  const nextMelds = sideMelds(v.rules, x.hs, next);
  const frozenForNext = v.pileFrozen || nextMelds.length === 0;
  const pileSize = v.pile.length;
  const counts = new Map<Rank, number>();
  for (const c of hand) if (isNatural(c)) counts.set(rankOf(c), (counts.get(rankOf(c)) ?? 0) + 1);

  // Expert's estimate of the next opponent's cards, from everything seen.
  let pTake: ((r: Rank) => number) | null = null;
  if (w.pairDanger > 0 && nextIsOpp) {
    const known = knownHands(v);
    const visible = new Map<Rank, number>();
    const see = (c: CardId) => { if (isNatural(c)) visible.set(rankOf(c), (visible.get(rankOf(c)) ?? 0) + 1); };
    v.melds.flat().forEach((m) => m.cards.forEach(see));
    v.pile.forEach(see);
    hand.forEach(see);
    known.forEach((k) => k.forEach(see));
    const wildsVisible = [...v.melds.flat().flatMap((m) => m.cards), ...v.pile, ...hand, ...known.flat()].filter(isWild).length;
    const unknownOthers = v.handSizes.reduce((t, n, s) => (s === v.seat ? t : t + n - known[s].length), 0);
    const U = v.stockCount + unknownOthers;
    const m = Math.max(0, v.handSizes[next] - known[next].length);
    const pWild = atLeast(1, U, Math.max(0, 12 - wildsVisible), m);
    pTake = (r: Rank) => {
      const have = known[next].filter((c) => isNatural(c) && rankOf(c) === r).length;
      const u = Math.max(0, 8 - (visible.get(r) ?? 0));
      const pair = atLeast(2 - have, U, u, m);
      if (frozenForNext) return pair;
      return Math.min(1, pair + atLeast(1 - have, U, u, m) * pWild * 0.7);
    };
  }

  let best = hand[0], bestScore = Infinity;
  for (const c of hand) {
    let keep: number;
    if (isWild(c)) {
      keep = 60;
      if (nextIsOpp && !frozenForNext && pileSize >= w.freezeAt) keep = 6 - pileSize * 0.2;
    } else if (isBlackThree(c)) {
      keep = nextIsOpp && pileSize >= w.blackThreeAt ? -4 : 3;
    } else {
      const r = rankOf(c);
      const k = counts.get(r) ?? 0;
      keep = k >= 3 ? 30 : k === 2 ? 18 : 5;
      if (x.melds.some((m) => m.rank === r)) keep += 12;
      keep += pointValue(c) * (v.stockCount < 20 ? -w.shedLate : 0.05);
      if (nextIsOpp) {
        const addsToMeld = !frozenForNext && nextMelds.some((m) => m.rank === r);
        // What handing over the pile costs grows with its size.
        if (addsToMeld) keep += w.meldDanger * pileSize * 3;
        else if (pTake) keep += w.pairDanger * pTake(r) * pileSize * 3;
      }
    }
    keep += x.rng() * (0.5 + w.noise);
    if (keep < bestScore) { bestScore = keep; best = c; }
  }
  return best;
}

/** Pause before a computer move, so play can be followed. */
export function thinkingDelay(level: AiLevel, personaId: string | undefined, move: AiMove): number {
  const base = level === 'relaxed' ? 650 : level === 'standard' ? 800 : 900;
  const kind = move.t === 'draw' ? 0.8 : move.t === 'meld' || move.t === 'take' ? 1.2 : 1;
  return Math.round(base * kind * personaById(personaId).pace);
}

// ------------------------------------------------------------------ shared with the move guidance

/** Ways this seat could take the pile right now, cheapest first (all engine-checked). */
export function takeOptionsFor(v: PublicView): Group[][] {
  const x: Ctx = { v, hs: handStateFromView(v), level: 'standard', w: WEIGHTS.standard, p: personaById(undefined), rng: makeRng(1), melds: [] };
  x.melds = sideMelds(v.rules, x.hs, v.seat);
  return takeOptions(x).map((o) => o.groups);
}

/** Melds from the hand that would reach `need` points, fewest cards first. */
export const openingSuggestion = (hand: readonly CardId[], need: number) => openingFrom(hand, need);
