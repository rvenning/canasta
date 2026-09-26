/**
 * Scoring a finished hand (Pagat, "Classic Canasta Scoring"):
 *
 *   bonuses (canastas 500 natural / 300 mixed, going out 100 or 200 concealed,
 *   red threes 100 each or 800 for all four — negative if the side never melded)
 *   + the value of every card melded − the value of cards left in hand.
 *
 * Four players score per partnership, two players each for themselves. With three
 * players the lone hand scores alone; the temporary partners pool everything except
 * red threes, and the pooled amount is added to BOTH partners' own totals, each of
 * whom also scores their own red threes. If nobody took the pile or went out, all
 * three score separately.
 */
import { sumPoints } from '../rules/cards.ts';
import { scoreLines, type RulesConfig } from '../rules/config.ts';
import { isCanasta, isNaturalCanasta } from '../rules/melds.ts';
import { sideSeats, sideSlots, type HandState } from './hand.ts';

export interface LineScore {
  /** Seats whose melds and hands make up this line's shared part. */
  seats: number[];
  naturalCanastas: number;
  mixedCanastas: number;
  canastaBonus: number;
  redThrees: number;
  redThreeScore: number;
  goingOut: number;
  melded: number;
  inHand: number;
  total: number;
}

export interface HandScore { lines: LineScore[]; wentOut: number | null; concealed: boolean; endReason: 'out' | 'stock' | null; lone: number | null }

export function scoreHand(r: RulesConfig, h: HandState): HandScore {
  const lines: LineScore[] = [];
  for (let line = 0; line < scoreLines(r); line++) {
    // The seat that represents this line: the partnership's first seat, or the player.
    const seat = line;
    const seats = sideSeats(r, h, seat);
    const melds = sideSlots(r, h, seat).flatMap((s) => h.melds[s]);
    const canastas = melds.filter((m) => m.rank !== 3 && isCanasta(m));
    const naturalCanastas = canastas.filter(isNaturalCanasta).length;
    const mixedCanastas = canastas.length - naturalCanastas;
    // Red threes belong to the partnership with four players, otherwise to the player.
    const own = r.partnership === 'fixed' ? seats : [seat];
    const reds = own.reduce((t, s) => t + h.redThrees[s].length, 0);
    const redValue = reds === 4 ? 800 : reds * 100;
    const redThreeScore = melds.length > 0 ? redValue : -redValue;
    const goingOut = h.wentOut !== null && seats.includes(h.wentOut) ? (h.concealed ? 200 : 100) : 0;
    const melded = melds.reduce((t, m) => t + sumPoints(m.cards), 0);
    const inHand = seats.reduce((t, s) => t + sumPoints(h.hands[s]), 0);
    const canastaBonus = naturalCanastas * 500 + mixedCanastas * 300;
    lines.push({ seats, naturalCanastas, mixedCanastas, canastaBonus, redThrees: reds, redThreeScore, goingOut, melded, inHand, total: canastaBonus + redThreeScore + goingOut + melded - inHand });
  }
  return { lines, wentOut: h.wentOut, concealed: h.concealed, endReason: h.endReason, lone: h.lone };
}

/** The winning line once someone has reached the target, or null (also null on a tie for first: play on). */
export function matchWinner(scores: readonly number[], target: number): number | null {
  const top = Math.max(...scores);
  if (top < target) return null;
  const leaders = scores.map((s, i) => (s === top ? i : -1)).filter((i) => i >= 0);
  return leaders.length === 1 ? leaders[0] : null;
}
