import '@fontsource-variable/fraunces';
import '@fontsource-variable/figtree';
import './ui/style.css';
import { loadSettings, saveSettings, prefersReducedMotion } from './persistence/settings.ts';
import { audio } from './presentation/audio.ts';
import { preloadDeck, setCardOptions } from './presentation/cards.ts';
import type { AppCtx, GoArg, Screen, ScreenName } from './ui/app.ts';
import { caption, h, toast } from './ui/dom.ts';
import { GameScreen } from './ui/game.ts';
import { runningCount } from './ui/anim.ts';
import { creditsScreen, rulesScreen, settingsScreen, statsScreen, titleScreen } from './ui/screens.ts';
import { lobbyScreen } from './ui/lobby.ts';
import { tutorialScreen } from './ui/tutorial.ts';
import { loadMatch } from './persistence/saves.ts';
import { applyUpdate, onUpdateReady, registerSW } from './pwa.ts';

declare global { const __BUILD__: { version: string; sha: string; built: string } }

const root = document.getElementById('app') as HTMLElement;
const settings = loadSettings();
let current: Screen | null = null;
let game: GameScreen | null = null;
/** The table stays alive under Rules and Settings opened from it, so play resumes exactly. */
let parked: { screen: Screen; game: GameScreen } | null = null;
const dev = import.meta.env.DEV || new URLSearchParams(location.search).has('dev');

const ctx: AppCtx = {
  settings,
  build: __BUILD__,
  dev,
  saveSettings: () => saveSettings(settings),
  applySettings,
  go,
  overlay: (el) => root.append(el),
};

function applySettings() {
  setCardOptions({ fourColour: settings.fourColour, back: settings.cardBack });
  const reduced = prefersReducedMotion(settings);
  document.documentElement.classList.toggle('reduced', reduced);
  document.documentElement.dataset.table = settings.table;
  document.documentElement.style.setProperty('--anim', reduced ? '0.01' : String(1 / settings.animationSpeed));
  audio.configure({ sfxOn: settings.sfxOn, sfxVolume: settings.sfxVolume, uiVolume: settings.uiVolume, ambOn: settings.ambienceOn, ambVolume: settings.ambienceVolume });
  game?.applyView();
}

function go(name: ScreenName, arg: GoArg = {}) {
  // Leaving the table for Rules or Settings keeps it; coming back restores it.
  if (current && game && (name === 'rules' || name === 'settings') && arg.back === 'game') {
    parked = { screen: current, game };
  } else if (name === 'game' && !arg.match && parked) {
    current = parked.screen; game = parked.game; parked = null;
    root.replaceChildren(current.el);
    game.applyView();
    return;
  } else {
    current?.destroy?.();
    if (parked && name !== 'rules' && name !== 'settings') { parked.screen.destroy?.(); parked = null; }
  }
  game = null;
  let next: Screen;
  switch (name) {
    case 'title': next = titleScreen(ctx); break;
    case 'lobby': next = lobbyScreen(ctx); break;
    case 'rules': next = rulesScreen(ctx, arg.players, arg.back); break;
    case 'settings': next = settingsScreen(ctx, arg.back); break;
    case 'stats': next = statsScreen(ctx); break;
    case 'credits': next = creditsScreen(ctx); break;
    case 'tutorial': { const t = tutorialScreen(ctx); next = t; Object.defineProperty(ctx, '_tut', { value: t, configurable: true }); break; }
    case 'game': {
      const m = arg.match ?? loadMatch();
      if (!m) { go('title'); return; }
      game = new GameScreen(ctx, m, { resume: arg.resume });
      next = { el: game.el, destroy: () => game?.destroy(), onKey: (e) => game?.onKey(e) };
      break;
    }
  }
  current = next;
  root.replaceChildren(next.el);
  window.scrollTo(0, 0);
}

document.addEventListener('keydown', (e) => current?.onKey?.(e));
// Audio may only start after a user gesture (mobile browsers).
const unlock = () => { audio.unlock(); applySettings(); };
window.addEventListener('pointerdown', unlock, { once: true, capture: true });
window.addEventListener('keydown', unlock, { once: true, capture: true });
audio.onCaption = (t) => caption(t);
document.addEventListener('visibilitychange', () => { if (document.hidden) audio.suspendIfIdle(); });
document.addEventListener('gesturestart', (e) => { if ((e.target as HTMLElement).closest?.('.table-screen')) e.preventDefault(); });

applySettings();
preloadDeck();
registerSW();
onUpdateReady(() => {
  const b = h('button', { class: 'btn small update-btn', onclick: () => applyUpdate() }, 'Update ready — tap to restart (your match is saved)');
  document.body.append(b);
  toast('A new version is ready.');
});

/** Read-only hooks for the end-to-end tests. */
const currentGame = () => game ?? ((ctx as unknown as { _tut?: { game: GameScreen | null } })._tut?.game ?? null);
(window as unknown as { __canasta: unknown }).__canasta = {
  get state() { return currentGame()?.state ?? null; },
  get viewer() { return currentGame()?.viewer ?? null; },
  ctx,
  get domAnimations() { return runningCount(); },
  get scene() { return currentGame()?.sceneInfo ?? null; },
  sceneScreenOf: (c: number) => currentGame()?.sceneScreenOf(c) ?? null,
  settle: () => currentGame()?.settle3d(),
  audio: { get log() { return audio.log; }, get recorded() { return !audio.recordedFailed; }, volumeFor: (c: 'cards' | 'phrase' | 'ui') => audio.volumeFor(c) },
};

if (!settings.tutorialSeen && !loadMatch()) go('tutorial');
else go('title');
