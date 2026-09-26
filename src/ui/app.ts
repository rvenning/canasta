import type { MatchState } from '../engine/match.ts';
import type { Settings } from '../persistence/settings.ts';

export type ScreenName = 'title' | 'lobby' | 'game' | 'rules' | 'settings' | 'stats' | 'tutorial' | 'credits';

export interface GoArg {
  match?: MatchState;
  /** Where to return to from rules/settings. */
  back?: ScreenName;
  resume?: boolean;
  /** Rules page for this many players. */
  players?: number;
}

export interface Screen { el: HTMLElement; destroy?(): void; onKey?(e: KeyboardEvent): void }

export interface AppCtx {
  settings: Settings;
  saveSettings(): void;
  applySettings(): void;
  go(screen: ScreenName, arg?: GoArg): void;
  build: { version: string; sha: string; built: string };
  /** Present a modal layer over the current screen (e.g. settings from the table). */
  overlay(el: HTMLElement): void;
  dev: boolean;
}
