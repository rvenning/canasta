import { readJson, writeJson } from './storage.ts';

export type BackId = 'canasta' | 'rio' | 'baldosa';
export type TableTheme = 'tejido' | 'noche' | 'patio';

export interface Settings {
  version: 1;
  /** Tutorial on first launch and move guidance during play. On by default. */
  guidance: boolean;
  tutorialSeen: boolean;
  /** Ask before laying down or discarding. */
  confirmDiscard: boolean;
  fourColour: boolean;
  largeCards: boolean;
  reducedMotion: 'system' | 'on' | 'off';
  animationSpeed: number;
  sfxOn: boolean;
  sfxVolume: number;
  uiVolume: number;
  /** The quiet candombe rhythm under play. */
  ambienceOn: boolean;
  ambienceVolume: number;
  captions: boolean;
  cardBack: BackId;
  table: TableTheme;
  tableView: 'auto' | '3d' | '2d';
  aiSpeed: number;
  sortWildsLast: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  guidance: true,
  tutorialSeen: false,
  confirmDiscard: false,
  fourColour: false,
  largeCards: false,
  reducedMotion: 'system',
  animationSpeed: 1,
  sfxOn: true,
  sfxVolume: 0.7,
  uiVolume: 0.6,
  ambienceOn: false,
  ambienceVolume: 0.3,
  captions: false,
  cardBack: 'canasta',
  table: 'tejido',
  tableView: 'auto',
  aiSpeed: 1,
  sortWildsLast: true,
};

export function loadSettings(): Settings {
  const s = readJson<Partial<Settings>>('settings');
  return { ...DEFAULT_SETTINGS, ...(s ?? {}), version: 1 };
}

export function saveSettings(s: Settings) {
  writeJson('settings', s);
}

export function prefersReducedMotion(s: Settings): boolean {
  if (s.reducedMotion === 'on') return true;
  if (s.reducedMotion === 'off') return false;
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
