import { migrateMatch, replay, SCHEMA_VERSION, type MatchSetup, type MatchState } from '../engine/match.ts';
import { readJson, remove, writeJson } from './storage.ts';

/**
 * The saved match. We store the full state (fast, exact restore) AND the setup
 * plus command log (the replay contract). On load, if the stored state cannot be
 * migrated, the log is replayed instead, so an update never destroys a match.
 */
interface SaveFile { schema: number; savedAt: number; appVersion: string; state: MatchState; setup: MatchSetup; log: MatchState['log'] }

export function saveMatch(state: MatchState, appVersion: string): boolean {
  const f: SaveFile = { schema: SCHEMA_VERSION, savedAt: Date.now(), appVersion, state, setup: state.setup, log: state.log };
  return writeJson('match', f);
}

export function loadMatch(): MatchState | null {
  const f = readJson<SaveFile>('match');
  if (!f) return null;
  try {
    return migrateMatch(f.state);
  } catch {
    try {
      return replay(f.setup, f.log);
    } catch {
      return null;
    }
  }
}

export function hasSavedMatch(): boolean {
  const f = readJson<SaveFile>('match');
  return !!f && !!f.state && f.state.phase !== 'matchEnd';
}

export function clearMatch() {
  remove('match');
}

/** The last New Game configuration, so it can be offered again and edited. */
export interface LastSetup { players: number; seats: MatchSetup['seats'] }
export const loadLastSetup = () => readJson<LastSetup>('lastSetup');
export const saveLastSetup = (s: LastSetup) => writeJson('lastSetup', s);
