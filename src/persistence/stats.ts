import type { MatchState } from '../engine/match.ts';
import { lineOfSeat } from '../rules/config.ts';
import { readJson, remove, writeJson } from './storage.ts';

export interface Stats {
  version: 1;
  matchesPlayed: number;
  humanWins: number;
  humanLosses: number;
  handsPlayed: number;
  canastas: number;
  naturalCanastas: number;
  wentOut: number;
  bestHand: number;
  byPlayers: Record<string, { played: number; won: number }>;
  recorded: string[];
}

const blank = (): Stats => ({ version: 1, matchesPlayed: 0, humanWins: 0, humanLosses: 0, handsPlayed: 0, canastas: 0, naturalCanastas: 0, wentOut: 0, bestHand: 0, byPlayers: {}, recorded: [] });

export const loadStats = (): Stats => ({ ...blank(), ...(readJson<Stats>('stats') ?? {}) });
export const resetStats = () => remove('stats');

const humanLines = (s: MatchState) => new Set(s.setup.seats.map((x, i) => (x.kind === 'human' ? lineOfSeat(s.setup.rules, i) : -1)).filter((x) => x >= 0));

/** Count a finished hand once, for the human seats. */
export function recordHand(s: MatchState) {
  const sc = s.lastScore;
  if (!sc) return;
  const st = loadStats();
  const id = `h-${s.setup.seed}-${s.handNo}`;
  if (st.recorded.includes(id)) return;
  st.recorded = [...st.recorded.slice(-80), id];
  st.handsPlayed++;
  for (const line of humanLines(s)) {
    const l = sc.lines[line];
    st.canastas += l.naturalCanastas + l.mixedCanastas;
    st.naturalCanastas += l.naturalCanastas;
    st.bestHand = Math.max(st.bestHand, l.total);
  }
  if (sc.wentOut !== null && s.setup.seats[sc.wentOut].kind === 'human') st.wentOut++;
  writeJson('stats', st);
}

export function recordMatch(s: MatchState) {
  const st = loadStats();
  const id = `m-${s.setup.seed}-${s.log.length}`;
  if (st.recorded.includes(id)) return;
  st.recorded = [...st.recorded.slice(-80), id];
  st.matchesPlayed++;
  const lines = humanLines(s);
  const key = String(s.setup.rules.players);
  const bucket = (st.byPlayers[key] ??= { played: 0, won: 0 });
  bucket.played++;
  if (lines.size) {
    if (s.winner !== null && lines.has(s.winner)) { st.humanWins++; bucket.won++; } else st.humanLosses++;
  }
  writeJson('stats', st);
}
