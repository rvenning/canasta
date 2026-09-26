/**
 * Classic Canasta for two, three or four players. Every difference between the
 * three modes is a named field here, so the engine never branches on "if three
 * players" except through these values. The choices and their sources are in
 * docs/RULES.md.
 */
export type PlayerCount = 2 | 3 | 4;

/**
 * How seats are grouped for melding and scoring.
 * - individual: every player for themselves (two players).
 * - fixed: two partnerships, partners opposite (seats 0+2 and 1+3).
 * - threeHanded: individual until someone first takes the discard pile; that player then
 *   plays alone and the other two form a temporary partnership for the rest of the hand.
 */
export type Partnership = 'individual' | 'fixed' | 'threeHanded';

export interface RulesConfig {
  version: 1;
  players: PlayerCount;
  dealSize: number;
  /** Cards drawn from the stock at the start of a turn (one is discarded at the end). */
  drawCount: number;
  /** Canastas a side needs before any of its players may go out. */
  canastasToGoOut: number;
  target: number;
  partnership: Partnership;
}

export const RULES_VERSION = 1;

export function rulesFor(players: PlayerCount): RulesConfig {
  switch (players) {
    case 2: return { version: 1, players: 2, dealSize: 15, drawCount: 2, canastasToGoOut: 2, target: 5000, partnership: 'individual' };
    case 3: return { version: 1, players: 3, dealSize: 13, drawCount: 2, canastasToGoOut: 1, target: 7500, partnership: 'threeHanded' };
    case 4: return { version: 1, players: 4, dealSize: 11, drawCount: 1, canastasToGoOut: 1, target: 5000, partnership: 'fixed' };
  }
}

/** Cumulative score → minimum count for a side's first meld of a hand. */
export function initialRequirement(score: number): number {
  if (score < 0) return 15;
  if (score < 1500) return 50;
  if (score < 3000) return 90;
  return 120;
}

/** The scoreboard has one line per partnership (four players) or per player (two or three). */
export const scoreLines = (r: RulesConfig) => (r.partnership === 'fixed' ? 2 : r.players);
export const lineOfSeat = (r: RulesConfig, seat: number) => (r.partnership === 'fixed' ? seat % 2 : seat);

/** Meld areas on the table: one per fixed partnership, otherwise one per player (pooled when three-handed partners form). */
export const meldSlots = (r: RulesConfig) => (r.partnership === 'fixed' ? 2 : r.players);
export const slotOfSeat = (r: RulesConfig, seat: number) => (r.partnership === 'fixed' ? seat % 2 : seat);

export function migrateRules(raw: unknown): RulesConfig {
  const r = raw as Partial<RulesConfig>;
  if (!r || (r.players !== 2 && r.players !== 3 && r.players !== 4)) throw new Error('Unknown rules');
  return rulesFor(r.players);
}
