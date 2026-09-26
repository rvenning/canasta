/**
 * The match: a sequence of hands until someone reaches the target. `apply` is
 * the single entry point: it validates a command against the current state and
 * returns a NEW state plus the events that happened, or a plain-language error.
 * Commands carry a sequence number, so double taps and stale computer replies
 * are rejected. Every accepted command is logged and `replay(setup, log)`
 * rebuilds the match exactly.
 */
import type { CardId } from '../rules/cards.ts';
import { migrateRules, scoreLines, type RulesConfig } from '../rules/config.ts';
import { rngFor } from '../rules/rng.ts';
import {
  checkGroups, cloneHand, discardMut, drawMut, meldMut, mustTakePile, nextSeat, partnerOf, pileTop, sideMelds, startHand, takeMut,
  type Group, type HandEvent, type HandState,
} from './hand.ts';
import { matchWinner, scoreHand, type HandScore } from './scoring.ts';
import { goOutPlan } from './solver.ts';

export const SCHEMA_VERSION = 1;

export type AiLevel = 'relaxed' | 'standard' | 'expert';
export interface SeatConfig { name: string; kind: 'human' | 'ai'; level?: AiLevel; persona?: string }
export interface MatchSetup { rules: RulesConfig; seats: SeatConfig[]; seed: number }

export type Command =
  | { t: 'draw'; seq: number; seat: number }
  | { t: 'take'; seq: number; seat: number; groups: Group[] }
  | { t: 'meld'; seq: number; seat: number; groups: Group[] }
  | { t: 'discard'; seq: number; seat: number; card: CardId }
  | { t: 'ask'; seq: number; seat: number }
  | { t: 'answer'; seq: number; seat: number; yes: boolean }
  | { t: 'nextHand'; seq: number };

export interface HandRecord { handNo: number; dealer: number; totals: number[]; scoresAfter: number[] }

export interface MatchState {
  schema: number;
  setup: MatchSetup;
  scores: number[];
  handNo: number;
  dealer: number;
  phase: 'play' | 'handEnd' | 'matchEnd';
  hand: HandState;
  lastScore: HandScore | null;
  history: HandRecord[];
  winner: number | null;
  log: Command[];
  seq: number;
}

export type MatchEvent = HandEvent | { e: 'handScored'; score: HandScore } | { e: 'matchOver'; winner: number } | { e: 'newHand'; handNo: number; dealer: number };
export type Result = { ok: true; state: MatchState; events: MatchEvent[] } | { ok: false; error: string };

export function cloneMatch(s: MatchState): MatchState {
  return {
    ...s,
    setup: JSON.parse(JSON.stringify(s.setup)),
    scores: [...s.scores],
    hand: cloneHand(s.hand),
    lastScore: s.lastScore ? JSON.parse(JSON.stringify(s.lastScore)) : null,
    history: s.history.map((x) => ({ ...x, totals: [...x.totals], scoresAfter: [...x.scoresAfter] })),
    log: [...s.log],
  };
}

export function newMatch(setup: MatchSetup): { state: MatchState; events: MatchEvent[] } {
  const rules = setup.rules;
  if (setup.seats.length !== rules.players) throw new Error('Seat count does not match the number of players');
  const dealer = Math.floor(rngFor(setup.seed, 'firstDealer')() * rules.players);
  const events: MatchEvent[] = [{ e: 'newHand', handNo: 1, dealer }];
  const evs: HandEvent[] = [];
  const hand = startHand(rules, setup.seed, 1, dealer, evs);
  events.push(...evs);
  const state: MatchState = {
    schema: SCHEMA_VERSION, setup: JSON.parse(JSON.stringify(setup)), scores: Array(scoreLines(rules)).fill(0),
    handNo: 1, dealer, phase: 'play', hand, lastScore: null, history: [], winner: null, log: [], seq: 0,
  };
  return { state, events };
}

const err = (error: string): Result => ({ ok: false, error });

/** Validate and apply one command. Never mutates the input. */
export function apply(s: MatchState, cmd: Command): Result {
  if (!cmd || typeof cmd !== 'object') return err('Unknown command');
  if (cmd.seq !== s.seq) return err(`Stale or duplicate command (expected #${s.seq}, got #${cmd.seq})`);
  const r = s.setup.rules;
  const h = s.hand;
  if (cmd.t === 'nextHand') {
    if (s.phase !== 'handEnd') return err('The hand is not over yet.');
    const next = cloneMatch(s);
    const events: MatchEvent[] = [];
    next.handNo++;
    next.dealer = nextSeat(r, next.dealer);
    events.push({ e: 'newHand', handNo: next.handNo, dealer: next.dealer });
    const evs: HandEvent[] = [];
    next.hand = startHand(r, next.setup.seed, next.handNo, next.dealer, evs);
    events.push(...evs);
    next.phase = 'play';
    next.lastScore = null;
    return commit(next, cmd, events);
  }
  if (s.phase !== 'play') return err('The hand is over.');
  const seat = cmd.seat;
  if (cmd.t === 'answer') {
    if (h.phase !== 'ask') return err('Nobody has asked to go out.');
    if (seat !== partnerOf(r, h, h.turn)) return err('Only the partner who was asked can answer.');
  } else if (seat !== h.turn) return err('It is not your turn.');

  const next = cloneMatch(s);
  const nh = next.hand;
  const events: MatchEvent[] = [];
  const evs: HandEvent[] = [];
  switch (cmd.t) {
    case 'draw': {
      if (h.phase !== 'draw') return err('You have already drawn this turn.');
      if (mustTakePile(r, h, seat)) return err('The stock is empty and the top discard fits one of your melds, so you must take the pile.');
      drawMut(r, nh, seat, evs);
      break;
    }
    case 'take': {
      if (h.phase !== 'draw') return err('You can only take the pile instead of drawing, at the start of your turn.');
      const top = pileTop(h);
      if (top === null) return err('The discard pile is empty.');
      const c = checkGroups(r, h, s.scores, seat, cmd.groups, top);
      if (!c.ok) return err(c.error);
      takeMut(r, nh, seat, c.groups.map((g) => ({ ...g, target: g.target ? findIn(nh, g.target.id) : null })), evs);
      break;
    }
    case 'meld': {
      if (h.phase !== 'play') return err(h.phase === 'draw' ? 'Draw from the stock or take the pile first.' : 'Wait for your partner’s answer.');
      const c = checkGroups(r, h, s.scores, seat, cmd.groups, null);
      if (!c.ok) return err(c.error);
      meldMut(r, nh, seat, c.groups.map((g) => ({ ...g, target: g.target ? findIn(nh, g.target.id) : null })), evs);
      break;
    }
    case 'discard': {
      if (h.phase !== 'play') return err(h.phase === 'draw' ? 'Draw from the stock or take the pile first.' : 'Wait for your partner’s answer.');
      if (!h.hands[seat].includes(cmd.card)) return err('That card is not in your hand.');
      const last = h.hands[seat].length === 1;
      if (last) {
        const need = r.canastasToGoOut;
        if (sideMelds(r, h, seat).filter((m) => m.rank !== 3 && m.cards.length >= 7).length < need) return err(`Discarding your last card would go out, and your side needs ${need === 1 ? 'a canasta' : `${need} canastas`} first.`);
        if (h.askAnswer === 'no') return err('Your partner said no to going out this turn.');
      } else if (h.askAnswer === 'yes') return err('Your partner said yes, so you must go out this turn: meld your cards before the last discard.');
      discardMut(r, nh, seat, cmd.card, evs);
      break;
    }
    case 'ask': {
      if (h.phase !== 'play') return err('You can ask your partner only after drawing.');
      const partner = partnerOf(r, h, seat);
      if (partner === null) return err('You have no partner to ask.');
      if (h.asked || h.meldedSinceDraw) return err('You can only ask straight after drawing, before melding anything else.');
      // A "no" must leave a legal turn (keep a card after discarding), so with one card there is nothing to ask.
      if (h.hands[seat].length < 2) return err('With one card left you can only go out, so there is nothing to ask.');
      if (!goOutPlan(h.hands[seat], sideMelds(r, h, seat), r.canastasToGoOut)) return err('You cannot go out with these cards yet, so there is nothing to ask.');
      nh.phase = 'ask';
      nh.asked = true;
      evs.push({ e: 'ask', seat, partner });
      break;
    }
    case 'answer': {
      nh.phase = 'play';
      nh.askAnswer = cmd.yes ? 'yes' : 'no';
      evs.push({ e: 'answer', seat, yes: !!cmd.yes });
      break;
    }
    default: return err('Unknown command');
  }
  events.push(...evs);
  if (nh.phase === 'over') finishHand(next, events);
  return commit(next, cmd, events);
}

function findIn(h: HandState, id: number) {
  for (const slot of h.melds) for (const m of slot) if (m.id === id) return m;
  return null;
}

function commit(next: MatchState, cmd: Command, events: MatchEvent[]): Result {
  next.log.push(JSON.parse(JSON.stringify(cmd)));
  next.seq++;
  return { ok: true, state: next, events };
}

function finishHand(s: MatchState, events: MatchEvent[]) {
  const r = s.setup.rules;
  const score = scoreHand(r, s.hand);
  const totals = score.lines.map((l) => l.total);
  s.scores = s.scores.map((v, i) => v + totals[i]);
  s.lastScore = score;
  s.history.push({ handNo: s.handNo, dealer: s.dealer, totals, scoresAfter: [...s.scores] });
  events.push({ e: 'handScored', score });
  const w = matchWinner(s.scores, r.target);
  if (w !== null) {
    s.winner = w;
    s.phase = 'matchEnd';
    events.push({ e: 'matchOver', winner: w });
  } else s.phase = 'handEnd';
}

/** Rebuild a match from its setup and command log. Throws on the first invalid command. */
export function replay(setup: MatchSetup, log: readonly Command[], upTo = log.length): MatchState {
  let s = newMatch(setup).state;
  for (let i = 0; i < upTo; i++) {
    const res = apply(s, log[i]);
    if (!res.ok) throw new Error(`Replay failed at command ${i}: ${res.error}`);
    s = res.state;
  }
  return s;
}

/** Accept a saved match of any known schema. */
export function migrateMatch(raw: unknown): MatchState {
  const m = raw as MatchState;
  if (!m || typeof m !== 'object' || typeof m.schema !== 'number') throw new Error('Not a saved match');
  if (m.schema > SCHEMA_VERSION) throw new Error('This save is from a newer version of Canasta');
  m.setup.rules = migrateRules(m.setup.rules);
  return m;
}

export const seatName = (s: MatchState, seat: number) => s.setup.seats[seat]?.name ?? `Player ${seat + 1}`;

