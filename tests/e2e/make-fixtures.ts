// Saved-match fixtures for the end-to-end suite, printed as JSON.
import { rulesFor, type PlayerCount } from '../../src/rules/config.ts';
import { newMatch, SCHEMA_VERSION, type SeatConfig } from '../../src/engine/match.ts';

function fixture(players: PlayerCount, seats: SeatConfig[], seed: number, scores?: number[]) {
  const state = newMatch({ rules: rulesFor(players), seats, seed }).state;
  if (scores) state.scores = scores;
  return { schema: SCHEMA_VERSION, savedAt: 0, appVersion: 'fixture', state, setup: state.setup, log: state.log };
}
const H = (name: string): SeatConfig => ({ name, kind: 'human' });
const A = (name: string, persona: string, level: SeatConfig['level'] = 'relaxed'): SeatConfig => ({ name, kind: 'ai', level, persona });

console.log(JSON.stringify({
  // One hand from the end of the match: whoever scores decently in it wins.
  nearEnd4: fixture(4, [H('Ana'), A('Tío Nacho', 'nacho', 'standard'), A('Lucía', 'lucia'), A('Mateo', 'mateo', 'expert')], 101, [4990, 4990]),
  nearEnd2: fixture(2, [H('Ana'), A('Abuela Marta', 'marta')], 202, [4990, 4990]),
  nearEnd3: fixture(3, [H('Ana'), A('Camila', 'cami', 'standard'), A('Don Julio', 'julio')], 303, [7490, 7490, 7490]),
  allAi4: fixture(4, [A('Tío Nacho', 'nacho', 'expert'), A('Lucía', 'lucia'), A('Mateo', 'mateo', 'standard'), A('Valentina', 'vale')], 404, [4995, 4995]),
  pass2: fixture(2, [H('Ana'), H('Beto')], 505),
  pass4: fixture(4, [H('Ana'), A('Lucía', 'lucia'), H('Carla'), A('Mateo', 'mateo')], 606),
}));
