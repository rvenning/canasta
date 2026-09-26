/**
 * Coordinate search over the AI weights by self-play.
 *
 *   node tools/tune.ts <candidate-level> <opponent-level> [matches]
 *
 * Starting from the candidate level's weights, tries each value of each weight
 * against a fixed opponent (seats alternate, the same seeds for every trial) in
 * two- and four-player matches, keeps any change that wins clearly more, and
 * prints the best weights found. The result is copied into WEIGHTS by hand and
 * recorded in docs/AI_REPORT.md.
 */
import { simulateMatch } from '../src/ai/simulate.ts';
import { WEIGHTS, type Weights } from '../src/ai/policy.ts';
import type { AiLevel } from '../src/engine/match.ts';

const cand = (process.argv[2] ?? 'expert') as AiLevel;
const opp = (process.argv[3] ?? 'standard') as AiLevel;
const N = Number(process.argv[4] ?? 200);
const ME: AiLevel = cand === opp ? 'expert' : cand;
const THEM: AiLevel = cand === opp ? 'standard' : opp;
/** Player counts to optimise over, e.g. MODES=3. */
const MODES = (process.env.MODES ?? '2,4').split(',').map(Number) as (2 | 3 | 4)[];

const GRID: Partial<Record<keyof Weights, number[]>> = {
  takeFactor: [0, 0.6, 1, 1.6, 2.5],
  wildTakeCost: [0, 0.5, 1.5, 3],
  holdPairsUntil: [0, 10, 20, 40],
  goOutPartnerCards: [2, 5, 8, 99],
  goOutStock: [0, 12, 30],
  meldDanger: [0, 0.5, 1, 2, 4],
  pairDanger: [0, 0.5, 1, 2, 4],
  freezeAt: [6, 10, 16, 99],
  blackThreeAt: [0, 5, 99],
  shedLate: [0, 0.35, 1],
  askAt: [3, 6, 99],
};

function score(w: Weights): number {
  let wins = 0, n = 0;
  for (const p of MODES) {
    for (let seed = 1; seed <= N; seed++) {
      const swap = seed % 2 === 0;
      const lv: AiLevel[] = p === 4 ? (swap ? [THEM, ME, THEM, ME] : [ME, THEM, ME, THEM]) : p === 3 ? [[ME, THEM, THEM], [THEM, ME, THEM], [THEM, THEM, ME]][seed % 3] : swap ? [THEM, ME] : [ME, THEM];
      const r = simulateMatch(p, lv, 90000 + seed, 60, { [ME]: w, [THEM]: WEIGHTS[opp] });
      if (r.winner === null) continue;
      n++;
      if (p === 3 ? lv[r.winner] === ME : r.winner === (swap ? 1 : 0)) wins++;
    }
  }
  return wins / n;
}

let best: Weights = { ...WEIGHTS[cand] };
let bestScore = score(best);
console.log(`start ${cand} vs ${opp}: ${(bestScore * 100).toFixed(1)}%`);
for (let pass = 0; pass < 2; pass++) {
  let improved = false;
  for (const [k, values] of Object.entries(GRID) as [keyof Weights, number[]][]) {
    for (const val of values) {
      if (best[k] === val) continue;
      const trial = { ...best, [k]: val };
      const s = score(trial);
      if (s > bestScore + 0.015) { best = trial; bestScore = s; improved = true; console.log(`  ${k} = ${val}: ${(s * 100).toFixed(1)}%  ✓`); }
    }
  }
  if (!improved) break;
}
console.log(`best ${(bestScore * 100).toFixed(1)}%`, JSON.stringify(best));
