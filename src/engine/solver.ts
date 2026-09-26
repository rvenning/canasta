/**
 * "Can this hand go out now, and how?" Used to allow asking a partner, to show
 * the "Go out" hint, and by the computer players. It only looks at the player's
 * own hand and their side's melds, both of which the player can see.
 *
 * It searches the choice of final discard (or none) and then places every other
 * card: black threes as their own meld, natural cards on the side's meld of that
 * rank or as a new meld, and wild cards where they are needed first, then where
 * they complete a canasta, then wherever there is room. The plan it returns is
 * always checked again by the engine before it is played.
 */
import { isBlackThree, isWild, pointValue, rankOf, type CardId, type Rank } from '../rules/cards.ts';
import { CANASTA, MAX_WILDS, wildCount } from '../rules/melds.ts';
import type { Group } from './hand.ts';

export interface MeldLike { id: number; rank: Rank; cards: readonly CardId[] }
export interface GoOutPlan { groups: Group[]; discard: CardId | null }

interface Target { rank: Rank; into?: number; size: number; room: number; cards: CardId[]; needs: number }

function place(cards: CardId[], melds: readonly MeldLike[], need: number): Group[] | null {
  const black = cards.filter(isBlackThree);
  if (black.length !== 0 && black.length < 3) return null;
  const wild = cards.filter(isWild);
  const byRank = new Map<Rank, CardId[]>();
  for (const c of cards) if (!isWild(c) && !isBlackThree(c)) byRank.set(rankOf(c), [...(byRank.get(rankOf(c)) ?? []), c]);
  const targets: Target[] = [];
  const touched = new Set<number>();
  for (const [rank, cs] of byRank) {
    const existing = melds.filter((m) => m.rank === rank).sort((a, b) => (MAX_WILDS - wildCount(b.cards)) - (MAX_WILDS - wildCount(a.cards)))[0];
    if (existing) {
      touched.add(existing.id);
      targets.push({ rank, into: existing.id, size: existing.cards.length + cs.length, room: Math.max(0, MAX_WILDS - wildCount(existing.cards)), cards: [...cs], needs: 0 });
    } else if (cs.length >= 2) {
      targets.push({ rank, size: cs.length, room: MAX_WILDS, cards: [...cs], needs: cs.length === 2 ? 1 : 0 });
    } else return null;
  }
  // Wild cards may also go onto side melds this hand does not otherwise touch.
  for (const m of melds) {
    if (touched.has(m.id) || m.rank === 3) continue;
    targets.push({ rank: m.rank, into: m.id, size: m.cards.length, room: Math.max(0, MAX_WILDS - wildCount(m.cards)), cards: [], needs: 0 });
  }
  let left = [...wild].sort((a, b) => pointValue(a) - pointValue(b));
  const give = (t: Target, k: number) => { const w = left.slice(0, k); left = left.slice(k); t.cards.push(...w); t.size += k; t.room -= k; };
  for (const t of targets) { if (t.needs) { if (!left.length) return null; give(t, 1); } }
  // Complete canastas with the fewest wild cards first.
  const existingCanastas = () => targets.filter((t) => t.size >= CANASTA).length + melds.filter((m) => !targets.some((t) => t.into === m.id) && m.cards.length >= CANASTA).length;
  for (;;) {
    if (!left.length || existingCanastas() >= need) break;
    const t = targets.filter((x) => x.size < CANASTA && CANASTA - x.size <= Math.min(x.room, left.length)).sort((a, b) => (CANASTA - a.size) - (CANASTA - b.size))[0];
    if (!t) break;
    give(t, CANASTA - t.size);
  }
  for (const t of targets.sort((a, b) => b.size - a.size)) { const k = Math.min(t.room, left.length); if (k > 0) give(t, k); }
  if (left.length) return null;
  if (existingCanastas() < need) return null;
  const groups: Group[] = targets.filter((t) => t.cards.length).map((t) => (t.into !== undefined ? { rank: t.rank, cards: t.cards, into: t.into } : { rank: t.rank, cards: t.cards }));
  if (black.length) groups.push({ rank: 3, cards: black });
  return groups;
}

/**
 * A way to meld the whole hand (or all but one card, then discard it) such that the side
 * ends with at least `canastasNeeded` canastas. Prefers melding everything, then discarding
 * the least valuable card.
 */
export function goOutPlan(hand: readonly CardId[], melds: readonly MeldLike[], canastasNeeded: number, mayDiscard = true): GoOutPlan | null {
  if (hand.length === 0) return null;
  const all = place([...hand], melds, canastasNeeded);
  if (all && all.length) return { groups: all, discard: null };
  if (!mayDiscard) return null;
  const tried = new Set<string>();
  const order = [...hand].sort((a, b) => pointValue(a) - pointValue(b));
  for (const d of order) {
    const key = isWild(d) ? `w${pointValue(d)}` : isBlackThree(d) ? 'b3' : `n${rankOf(d)}`;
    if (tried.has(key)) continue;
    tried.add(key);
    const rest = hand.filter((c) => c !== d);
    if (rest.length === 0) {
      if (melds.filter((m) => m.cards.length >= CANASTA).length >= canastasNeeded) return { groups: [], discard: d };
      continue;
    }
    const g = place(rest, melds, canastasNeeded);
    if (g) return { groups: g, discard: d };
  }
  return null;
}
