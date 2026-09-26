/**
 * The balance report: seeded all-computer matches between every pair of levels in
 * every mode, with legality and stall counts and decision times.
 *
 *   node tools/simulate.ts [matchesPerPairing]
 *
 * Seats alternate between the two levels so neither gets the better seat; in
 * three-player games the stronger level holds one seat of three (parity 33%).
 */
import { simulateMatch } from '../src/ai/simulate.ts';
import type { AiLevel } from '../src/engine/match.ts';

const N = Number(process.argv[2] ?? 100);
const pairs: [AiLevel, AiLevel][] = [['standard', 'relaxed'], ['expert', 'relaxed'], ['expert', 'standard']];
let illegal = 0, stalled = 0, msMax = 0, matches = 0, hands = 0;
for (const players of (process.env.MODES ?? '2,3,4').split(',').map(Number) as (2 | 3 | 4)[]) {
  for (const [a, b] of pairs) {
    let wins = 0, n = 0;
    for (let seed = 1; seed <= N; seed++) {
      const swap = seed % 2 === 0;
      const lv: AiLevel[] = players === 4 ? (swap ? [b, a, b, a] : [a, b, a, b]) : players === 2 ? (swap ? [b, a] : [a, b]) : [[a, b, b], [b, a, b], [b, b, a]][seed % 3];
      const r = simulateMatch(players, lv, 150000 + seed * 13 + players);
      matches++; hands += r.hands; illegal += r.illegal.length; stalled += r.stalled ? 1 : 0; msMax = Math.max(msMax, r.msMax);
      if (r.winner === null) continue;
      n++;
      if (players === 3 ? lv[r.winner] === a : r.winner === (swap ? 1 : 0)) wins++;
    }
    const p = wins / n, se = Math.sqrt(p * (1 - p) / n);
    console.log(`${players} players  ${a.padEnd(8)} vs ${b.padEnd(8)}  ${a} wins ${(100 * p).toFixed(1)}% ± ${(196 * se).toFixed(1)} of ${n}  (parity ${players === 3 ? 33 : 50}%)`);
  }
}
console.log(`\n${matches} matches, ${hands} hands: ${illegal} illegal moves, ${stalled} stalls, slowest decision ${msMax.toFixed(0)} ms`);
