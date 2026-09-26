/**
 * Seeded all-computer matches: the deadlock and legality check (tests/ai) and
 * the balance report (npm run sim). Every AI move goes through the real engine;
 * an illegal one is counted, and a safe fallback keeps the match moving so one
 * bad decision cannot hide others.
 */
import { rulesFor, type PlayerCount } from '../rules/config.ts';
import { apply, newMatch, type AiLevel, type Command, type MatchState } from '../engine/match.ts';
import { partnerOf } from '../engine/hand.ts';
import { viewFor } from '../engine/view.ts';
import { decide, type AiMove, type Weights } from './policy.ts';
import { PERSONAS } from './personalities.ts';

export interface SimResult {
  seed: number;
  players: PlayerCount;
  levels: AiLevel[];
  winner: number | null;
  scores: number[];
  hands: number;
  commands: number;
  illegal: { move: AiMove; error: string; handNo: number }[];
  stalled: boolean;
  wentOut: number;
  stockOut: number;
  concealed: number;
  takes: number;
  canastas: number;
  msMax: number;
}

const toCommand = (s: MatchState, seat: number, m: AiMove): Command => ({ ...m, seq: s.seq, seat } as Command);

export function simulateMatch(players: PlayerCount, levels: AiLevel[], seed: number, maxHands = 60, weights: Partial<Record<AiLevel, Weights>> = {}): SimResult {
  const seats = levels.map((level, i) => ({ name: `AI ${i}`, kind: 'ai' as const, level, persona: PERSONAS[(seed + i) % PERSONAS.length].id }));
  let s = newMatch({ rules: rulesFor(players), seats, seed }).state;
  const res: SimResult = { seed, players, levels, winner: null, scores: [], hands: 0, commands: 0, illegal: [], stalled: false, wentOut: 0, stockOut: 0, concealed: 0, takes: 0, canastas: 0, msMax: 0 };
  let stepsThisHand = 0;
  while (s.phase !== 'matchEnd') {
    if (s.phase === 'handEnd') {
      res.hands++;
      if (res.hands >= maxHands) break;
      const r = apply(s, { t: 'nextHand', seq: s.seq });
      if (!r.ok) throw new Error(r.error);
      s = r.state; stepsThisHand = 0;
      continue;
    }
    if (++stepsThisHand > 3000) { res.stalled = true; break; }
    const h = s.hand;
    const seat = h.phase === 'ask' ? partnerOf(s.setup.rules, h, h.turn)! : h.turn;
    const t0 = performance.now();
    const level = s.setup.seats[seat].level ?? 'standard';
    const move = decide(viewFor(s, seat), level, s.setup.seats[seat].persona, weights[level]);
    res.msMax = Math.max(res.msMax, performance.now() - t0);
    let r = apply(s, toCommand(s, seat, move));
    if (!r.ok) {
      res.illegal.push({ move, error: r.error, handNo: s.handNo });
      const fallback: AiMove = h.phase === 'draw' ? { t: 'draw' } : h.phase === 'ask' ? { t: 'answer', yes: false } : { t: 'discard', card: h.hands[seat][0] };
      r = apply(s, toCommand(s, seat, fallback));
      if (!r.ok) { res.stalled = true; break; }
    }
    res.commands++;
    for (const e of r.events) {
      if (e.e === 'take') res.takes++;
      if (e.e === 'canasta') res.canastas++;
      if (e.e === 'out') { res.wentOut++; if (e.concealed) res.concealed++; }
      if (e.e === 'stockOut') res.stockOut++;
    }
    s = r.state;
  }
  if (s.phase === 'matchEnd') res.hands++;
  res.winner = s.winner;
  res.scores = [...s.scores];
  return res;
}
