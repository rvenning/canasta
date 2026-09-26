/**
 * How long the table lets a move be seen before the next computer move or the
 * score sheet. A pure function of the engine's events and the player's
 * settings, never of whether an animation has actually finished: the same match
 * paces identically in the 3D view, the flat view, a slow phone or a test.
 */
import type { MatchEvent } from '../engine/match.ts';

export interface PaceOpts { reduced: boolean; speed: number }

export function presentationAllowance(events: readonly MatchEvent[], o: PaceOpts): number {
  if (o.reduced) return events.some((e) => e.e === 'take' || e.e === 'canasta' || e.e === 'out') ? 380 : 200;
  let ms = 0;
  for (const e of events) {
    switch (e.e) {
      case 'newHand': ms += 500; break;
      case 'deal': ms += 700; break;
      case 'draw': ms += 320; break;
      case 'take': ms += 650; break;
      case 'meld': ms += 380 + 90 * e.placed.length; break;
      case 'discard': ms += 380; break;
      case 'redThree': ms += 450; break;
      case 'canasta': ms += 1100; break;
      case 'out': ms += 1400; break;
      case 'partnership': ms += 900; break;
      default: break;
    }
  }
  return Math.round(Math.min(ms, 3600) / Math.max(0.25, o.speed));
}
