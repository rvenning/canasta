/**
 * Move guidance: one short, plain-language line about what the player can do
 * now, and why something is not allowed. Everything comes from the rules engine
 * (checkGroups, pileBlocked, the go-out solver), so the guidance can never
 * disagree with what the table will accept. With guidance switched off only the
 * essentials remain (whose turn, what to do next, and errors).
 */
import { cardShort, isBlackThree, isNatural, isWild, rankName, rankOf, sumPoints, type CardId } from '../rules/cards.ts';
import { meldLabel } from '../rules/melds.ts';
import { checkGroups, frozenFor, mustTakePile, partnerOf, pileBlocked, pileTop, requirementFor, sideHasMelded, sideMelds, sideSeats, type Group } from '../engine/hand.ts';
import { goOutPlan } from '../engine/solver.ts';
import { seatName, type MatchState } from '../engine/match.ts';
import { viewFor } from '../engine/view.ts';
import { openingSuggestion, takeOptionsFor } from '../ai/policy.ts';

export type Tone = 'info' | 'good' | 'warn';
export interface Hint { text: string; tone: Tone }

/** Turn a selection of hand cards into the meld group it most plausibly means, or say why it cannot. */
export function groupFromSelection(s: MatchState, seat: number, sel: readonly CardId[], into?: number): { group: Group | null; why: string } {
  if (!sel.length) return { group: null, why: 'Select cards from your hand first.' };
  const r = s.setup.rules, h = s.hand;
  if (into !== undefined) {
    const m = sideMelds(r, h, seat).find((x) => x.id === into);
    if (!m) return { group: null, why: 'You can only add to your own side’s melds.' };
    return { group: { rank: m.rank, cards: [...sel], into }, why: '' };
  }
  if (sel.every(isBlackThree)) return { group: { rank: 3, cards: [...sel] }, why: '' };
  const ranks = [...new Set(sel.filter((c) => isNatural(c)).map(rankOf))];
  if (sel.some((c) => rankOf(c) === 3)) return { group: null, why: 'Threes cannot go into an ordinary meld.' };
  if (ranks.length === 0) return { group: null, why: 'Wild cards need a meld: tap one of your side’s melds to add them to it.' };
  if (ranks.length > 1) return { group: null, why: 'A meld is one rank: select cards of one rank, plus any wild cards.' };
  const rank = ranks[0];
  const existing = sideMelds(r, h, seat).find((m) => m.rank === rank);
  return { group: existing ? { rank, cards: [...sel], into: existing.id } : { rank, cards: [...sel] }, why: '' };
}

export function describeGroup(s: MatchState, g: Group): string {
  const n = g.cards.length;
  if (g.rank === 3) return `${n} black threes`;
  const target = g.into !== undefined ? sideMeldsAll(s).find((m) => m.id === g.into) : null;
  const wild = g.cards.filter(isWild).length;
  const what = `${n} ${n === 1 ? 'card' : 'cards'}${wild ? ` (${wild} wild)` : ''}`;
  return target ? `add ${what} to the ${meldLabel(target.rank)}` : `new meld of ${meldLabel(g.rank)}: ${what}`;
}
const sideMeldsAll = (s: MatchState) => s.hand.melds.flat();

/** What a discard of `c` would do, in words (for the confirmation and the hint). */
export function discardNote(s: MatchState, seat: number, c: CardId): string {
  const r = s.setup.rules, h = s.hand;
  if (h.hands[seat].length === 1) return 'This is your last card: discarding it goes out.';
  if (isWild(c)) return 'Discarding a wild card freezes the pile for everyone.';
  if (isBlackThree(c)) return 'A black three stops the next player from taking the pile.';
  const next = (seat + 1) % r.players;
  if (sideSeats(r, h, next).includes(seat)) return '';
  const theirs = sideMelds(r, h, next);
  if (!h.pileFrozen && theirs.length && theirs.some((m) => m.rank === rankOf(c))) return `Careful: ${seatName(s, next)} can add this to their ${meldLabel(rankOf(c))} and take the pile (${h.pile.length + 1} cards).`;
  return '';
}

export function hint(s: MatchState, seat: number, o: { selection: readonly CardId[]; staging: readonly Group[]; taking: boolean; full: boolean }): Hint {
  const r = s.setup.rules, h = s.hand;
  if (s.phase !== 'play') return { text: '', tone: 'info' };
  const actor = h.phase === 'ask' ? partnerOf(r, h, h.turn) : h.turn;
  if (actor !== seat) {
    if (h.phase === 'ask') return { text: `${seatName(s, h.turn)} asked ${seatName(s, actor!)}: “May I go out?”`, tone: 'info' };
    return { text: `${seatName(s, h.turn)} is playing…`, tone: 'info' };
  }
  if (h.phase === 'ask') return { text: `${seatName(s, h.turn)} asks: “Partner, may I go out?” Your answer binds them.`, tone: 'info' };
  const view = viewFor(s, seat);
  const need = requirementFor(r, s.scores, seat);
  const opened = sideHasMelded(r, h, seat);

  if (h.phase === 'draw') {
    const top = pileTop(h);
    if (o.taking) {
      if (o.staging.length) {
        const c = checkGroups(r, h, s.scores, seat, [...o.staging], top);
        return c.ok ? { text: `Take the pile: ${c.points} points laid down${opened ? '' : ` (you need ${need})`}.`, tone: 'good' } : { text: c.error, tone: 'warn' };
      }
      return { text: `Choose cards from your hand to meld with the ${cardShort(top!)}, then take the pile.`, tone: 'info' };
    }
    const forced = mustTakePile(r, h, seat);
    if (forced) return { text: `The stock is empty and the ${cardShort(top!)} fits your ${meldLabel(forced.rank)}: you must take the pile.`, tone: 'warn' };
    const takes = takeOptionsFor(view);
    if (h.stock.length === 0) return takes.length ? { text: 'The stock is empty: take the pile, or end the hand.', tone: 'warn' } : { text: 'The stock is empty and you cannot take the pile: the hand ends when you tap the stock.', tone: 'warn' };
    const draw = r.drawCount === 2 ? 'Draw two cards' : 'Draw a card';
    if (!o.full) return { text: `Your turn: ${draw.toLowerCase()} or take the pile.`, tone: 'info' };
    if (takes.length) {
      const g0 = takes[0][0];
      const using = g0.cards.filter((c) => c !== top);
      const how = using.length === 0 ? `adding the ${cardShort(top!)} to your ${meldLabel(g0.rank)}` : `with your ${using.map(cardShort).join(' ')}`;
      return { text: `You can take the pile (${h.pile.length} ${h.pile.length === 1 ? 'card' : 'cards'}) ${how}${takes[0].length > 1 ? ', opening with another meld' : ''}. Or ${draw.toLowerCase()}.`, tone: 'good' };
    }
    const blocked = top !== null ? pileBlocked(h, seat) : 'The pile is empty.';
    if (blocked && top !== null) return { text: `${blocked} ${draw} from the stock.`, tone: 'info' };
    if (top !== null && frozenFor(r, h, seat)) return { text: `${h.pileFrozen ? 'The pile is frozen' : 'The pile is frozen until your side melds'}: taking it needs two natural ${rankName(rankOf(top), true)} from your hand. ${draw}.`, tone: 'info' };
    return { text: `${draw} from the stock.${opened ? '' : ` Your side needs ${need} points to open.`}`, tone: 'info' };
  }

  // Play phase.
  if (h.askAnswer === 'yes') return { text: 'Your partner said yes: you must go out this turn.', tone: 'warn' };
  if (o.staging.length) {
    const c = checkGroups(r, h, s.scores, seat, [...o.staging], null);
    if (!c.ok) return { text: c.error, tone: 'warn' };
    return { text: `Lay down ${c.points} points${opened ? '' : ` — your side needs ${need} to open`}${c.goingOut ? ', and go out' : ''}.`, tone: 'good' };
  }
  if (o.selection.length === 1) {
    const note = discardNote(s, seat, o.selection[0]);
    return { text: note || `Discard the ${cardShort(o.selection[0])} to end your turn, or add more cards to meld.`, tone: note.startsWith('Careful') ? 'warn' : 'info' };
  }
  if (o.selection.length > 1) {
    const g = groupFromSelection(s, seat, o.selection);
    if (!g.group) return { text: g.why, tone: 'warn' };
    return { text: `Stage this: ${describeGroup(s, g.group)}.`, tone: 'info' };
  }
  if (!o.full) return { text: 'Meld if you like, then discard one card to end your turn.', tone: 'info' };
  const plan = goOutPlan(h.hands[seat], sideMelds(r, h, seat), r.canastasToGoOut);
  if (plan && h.askAnswer !== 'no') {
    const partner = partnerOf(r, h, seat);
    return { text: `You can go out now${partner !== null && !h.asked && !h.meldedSinceDraw && h.hands[seat].length >= 2 ? ' — or first ask your partner' : ''}.`, tone: 'good' };
  }
  if (!opened) {
    const sug = openingSuggestion(h.hands[seat], need);
    if (sug && sug.length && checkGroups(r, h, s.scores, seat, sug, null).ok) {
      return { text: `Your side needs ${need} to open: ${sug.map((g) => meldLabel(g.rank)).join(' and ')} would make ${sug.reduce((t, g) => t + sumPoints(g.cards), 0)}.`, tone: 'good' };
    }
    return { text: `Your side needs ${need} points to open. Discard one card to end your turn.`, tone: 'info' };
  }
  const adds = sideMelds(r, h, seat).filter((m) => h.hands[seat].some((c) => isNatural(c) && rankOf(c) === m.rank));
  if (adds.length) return { text: `You can add to your ${adds.map((m) => meldLabel(m.rank)).join(', ')}. Then discard to end your turn.`, tone: 'good' };
  return { text: 'Meld if you can, then discard one card to end your turn.', tone: 'info' };
}
