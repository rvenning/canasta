import { rulesBook } from '../content/rulesbook.ts';
import type { PlayerCount } from '../rules/config.ts';
import { backUrlFor, faceUrl } from '../presentation/cards.ts';
import { audio } from '../presentation/audio.ts';
import { clearAll } from '../persistence/storage.ts';
import { hasSavedMatch, loadLastSetup, loadMatch } from '../persistence/saves.ts';
import { loadStats, resetStats } from '../persistence/stats.ts';
import { DEFAULT_SETTINGS, type BackId, type Settings, type TableTheme } from '../persistence/settings.ts';
import type { AppCtx, Screen, ScreenName } from './app.ts';
import { confirmDialog, h, toast } from './dom.ts';
import { startMatch } from './lobby.ts';
import { checkForUpdate, offlineStatus } from '../pwa.ts';

export function titleScreen(ctx: AppCtx): Screen {
  const el = h('div', { class: 'screen paper title-screen' });
  const saved = hasSavedMatch();
  const last = loadLastSetup();
  const menu = h('nav', { class: 'menu', 'aria-label': 'Main menu' },
    saved ? h('button', { class: 'btn primary block', onclick: () => { const m = loadMatch(); if (m) ctx.go('game', { match: m, resume: true }); else toast('That saved match could not be read.'); } }, 'Continue match') : null,
    h('button', { class: `btn block${saved ? '' : ' primary'}`, onclick: () => ctx.go('lobby') }, 'New match'),
    last ? h('button', { class: 'btn block', onclick: () => startMatch(ctx, last.players as PlayerCount, last.seats) }, 'Play again', h('span', { class: 'small muted' }, ` — ${last.seats.map((s) => s.name).join(', ')}`)) : null,
    h('button', { class: 'btn block', onclick: () => ctx.go('tutorial') }, 'How to play'),
    h('div', { class: 'row center' },
      h('button', { class: 'btn small', onclick: () => ctx.go('rules', { back: 'title' }) }, 'Rules'),
      h('button', { class: 'btn small', onclick: () => ctx.go('settings', { back: 'title' }) }, 'Settings'),
      h('button', { class: 'btn small', onclick: () => ctx.go('stats') }, 'Statistics'),
      h('button', { class: 'btn small', onclick: () => ctx.go('credits') }, 'Credits')));
  // Seven cards fanned into a basket shape: a canasta.
  const fan = [12, 25, 38, 51, 66, 92, 52].map((c, i) => h('img', { src: faceUrl(c), alt: '', style: { '--i': String(i) } as unknown as Partial<CSSStyleDeclaration> }));
  el.append(h('div', { class: 'page title-wrap' },
    h('div', { class: 'title-fan', 'aria-hidden': 'true' }, fan),
    h('h1', { class: 'wordmark' }, 'Canasta'),
    h('p', { class: 'subtitle' }, 'The card game from Montevideo, for two, three or four.'),
    menu,
    h('p', { class: 'version small muted' }, `Version ${ctx.build.version} (${ctx.build.sha})`)));
  return { el };
}

export function rulesScreen(ctx: AppCtx, players: number | undefined, back: ScreenName = 'title'): Screen {
  const el = h('div', { class: 'screen paper' });
  const page = h('div', { class: 'page rules-page' });
  let n = (players ?? loadMatch()?.setup.rules.players ?? loadLastSetup()?.players ?? 4) as PlayerCount;
  const body = h('div');
  const tabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Rules for' });
  const draw = () => {
    tabs.replaceChildren(...([2, 3, 4] as PlayerCount[]).map((k) => h('button', { class: 'seg-btn' + (k === n ? ' on' : ''), role: 'tab', 'aria-selected': String(k === n), onclick: () => { n = k; draw(); } }, `${k} players`)));
    body.replaceChildren(...rulesBook(n).map((s) => h('section', { class: 'rule-section', id: `r-${s.id}` }, h('h2', {}, s.title), s.body.map((p) => h('p', {}, p)))));
  };
  draw();
  page.append(h('div', { class: 'row between' }, h('h1', {}, 'Rules'), h('button', { class: 'btn small', onclick: () => ctx.go(back) }, '← Back')), tabs, body,
    h('p', { class: 'small muted' }, 'Classic Canasta as standardised around 1950, following Pagat.com (John McLeod) and checked against the Bicycle rules. Where tables differ, the choices are listed in the project’s docs/RULES.md.'),
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => ctx.go(back) }, 'Done')));
  el.append(page);
  return { el, onKey: (e) => { if (e.key === 'Escape') ctx.go(back); } };
}

function toggle(ctx: AppCtx, key: keyof Settings, label: string, note?: string) {
  const i = h('input', { type: 'checkbox' }) as HTMLInputElement;
  i.checked = !!ctx.settings[key];
  i.addEventListener('change', () => { (ctx.settings as unknown as Record<string, unknown>)[key] = i.checked; ctx.saveSettings(); ctx.applySettings(); });
  return h('label', { class: 'toggle' }, i, h('span', {}, label, note ? h('span', { class: 'small muted block-note' }, note) : null));
}

function slider(ctx: AppCtx, key: 'sfxVolume' | 'uiVolume' | 'ambienceVolume' | 'aiSpeed', label: string, min = 0, max = 1, step = 0.05) {
  const i = h('input', { type: 'range', min, max, step, 'aria-label': label }) as HTMLInputElement;
  i.value = String(ctx.settings[key]);
  i.addEventListener('input', () => { ctx.settings[key] = Number(i.value); ctx.saveSettings(); ctx.applySettings(); });
  i.addEventListener('change', () => { if (key !== 'aiSpeed') audio.play(key === 'uiVolume' ? 'turn' : key === 'ambienceVolume' ? 'redThree' : 'place', false); });
  return h('label', { class: 'field' }, h('span', {}, label), i);
}

function choice<T extends string>(ctx: AppCtx, key: keyof Settings, label: string, options: [T, string][]) {
  const s = h('select', { 'aria-label': label }, options.map(([v, t]) => h('option', { value: v }, t))) as HTMLSelectElement;
  s.value = String(ctx.settings[key]);
  s.addEventListener('change', () => { (ctx.settings as unknown as Record<string, unknown>)[key] = s.value; ctx.saveSettings(); ctx.applySettings(); });
  return h('label', { class: 'field' }, h('span', {}, label), s);
}

export function settingsPanel(ctx: AppCtx): HTMLElement {
  const backs: [BackId, string][] = [['canasta', 'Woven basket'], ['rio', 'Río stripes'], ['baldosa', 'Montevideo tiles']];
  const backPick = h('div', { class: 'back-pick', role: 'radiogroup', 'aria-label': 'Card back' }, backs.map(([id, name]) => {
    const b = h('button', { class: 'back-opt' + (ctx.settings.cardBack === id ? ' on' : ''), role: 'radio', 'aria-checked': String(ctx.settings.cardBack === id), 'aria-label': name, onclick: () => {
      ctx.settings.cardBack = id; ctx.saveSettings(); ctx.applySettings();
      backPick.querySelectorAll('.back-opt').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
    } }, h('img', { src: backUrlFor(id), alt: '' }), h('span', {}, name));
    return b;
  }));
  return h('div', { class: 'settings' },
    h('h3', {}, 'Help'),
    toggle(ctx, 'guidance', 'Move guidance', 'Explains what you can do each turn and why a move is not allowed.'),
    toggle(ctx, 'confirmDiscard', 'Confirm before discarding'),
    h('h3', {}, 'Cards and table'),
    toggle(ctx, 'fourColour', 'Four-colour suits', 'Diamonds blue and Clubs green, so every suit has its own colour.'),
    toggle(ctx, 'largeCards', 'Larger cards'),
    toggle(ctx, 'sortWildsLast', 'Sort wild cards and threes to the end of my hand'),
    h('div', { class: 'field' }, h('span', {}, 'Card back'), backPick),
    choice<TableTheme>(ctx, 'table', 'Table cloth', [['tejido', 'Woven cloth (terracotta)'], ['noche', 'Night in Montevideo (indigo)'], ['patio', 'Patio (green tiles)']]),
    choice(ctx, 'tableView', 'Table', [['auto', 'Automatic (3D when the device can carry it)'], ['3d', 'Always 3D'], ['2d', 'Always flat']]),
    h('h3', {}, 'Motion'),
    choice(ctx, 'reducedMotion', 'Reduced motion', [['system', 'Follow the device'], ['on', 'On'], ['off', 'Off']]),
    slider(ctx, 'aiSpeed', 'Computer thinking time', 0.25, 2, 0.25),
    h('h3', {}, 'Sound'),
    toggle(ctx, 'sfxOn', 'Sound effects'),
    slider(ctx, 'sfxVolume', 'Effects volume'),
    slider(ctx, 'uiVolume', 'Interface volume'),
    toggle(ctx, 'ambienceOn', 'Table music', 'Green Salon, a mellow bossa nova by Yubatake.'),
    slider(ctx, 'ambienceVolume', 'Music volume'),
    toggle(ctx, 'captions', 'Captions for sounds'));
}

export function settingsScreen(ctx: AppCtx, back: ScreenName = 'title'): Screen {
  const el = h('div', { class: 'screen paper' });
  const status = h('p', { class: 'small', role: 'status' });
  void offlineStatus().then((t) => { status.textContent = t; });
  const page = h('div', { class: 'page' },
    h('div', { class: 'row between' }, h('h1', {}, 'Settings'), h('button', { class: 'btn small', onclick: () => ctx.go(back) }, '← Back')),
    settingsPanel(ctx),
    h('h3', {}, 'App'),
    h('p', {}, `Canasta version ${ctx.build.version} (${ctx.build.sha}), built ${ctx.build.built.slice(0, 10)}.`),
    status,
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: async () => { status.textContent = await checkForUpdate(); } }, 'Check for update'),
      h('button', { class: 'btn small', onclick: () => { ctx.settings.tutorialSeen = false; ctx.saveSettings(); ctx.go('tutorial'); } }, 'Replay the tutorial'),
      h('button', { class: 'btn small', onclick: async () => {
        if (await confirmDialog(el, 'Reset settings?', 'All preferences go back to their defaults. Your saved match and statistics are kept.', 'Reset settings')) {
          Object.assign(ctx.settings, DEFAULT_SETTINGS, { tutorialSeen: ctx.settings.tutorialSeen });
          ctx.saveSettings(); ctx.applySettings(); ctx.go('settings', { back });
        }
      } }, 'Reset settings')),
    h('div', { class: 'panel danger' },
      h('h3', {}, 'Clear saved data'),
      h('p', { class: 'small' }, 'Deletes the match in progress, your statistics, your last setup and all settings from this device. This cannot be undone.'),
      h('button', { class: 'btn danger', onclick: async () => {
        if (await confirmDialog(el, 'Clear all saved data?', 'The match in progress, statistics and settings will be deleted from this device.', 'Delete everything')) {
          clearAll();
          Object.assign(ctx.settings, DEFAULT_SETTINGS);
          ctx.applySettings();
          toast('Saved data cleared.');
          ctx.go('title');
        }
      } }, 'Clear saved data')));
  el.append(page);
  return { el, onKey: (e) => { if (e.key === 'Escape' && !(e.target instanceof HTMLSelectElement)) ctx.go(back); } };
}

export function statsScreen(ctx: AppCtx): Screen {
  const el = h('div', { class: 'screen paper' });
  const page = h('div', { class: 'page' });
  const draw = () => {
    const s = loadStats();
    const rows: [string, string][] = [
      ['Matches played', String(s.matchesPlayed)],
      ['Matches won by a person here', String(s.humanWins)],
      ['Matches lost', String(s.humanLosses)],
      ['Hands played', String(s.handsPlayed)],
      ['Canastas made', `${s.canastas} (${s.naturalCanastas} natural)`],
      ['Times you went out', String(s.wentOut)],
      ['Best single hand', `${s.bestHand} points`],
      ...(['2', '3', '4'] as const).filter((k) => s.byPlayers[k]).map((k) => [`${k} players`, `${s.byPlayers[k].won} won of ${s.byPlayers[k].played}`] as [string, string]),
    ];
    page.replaceChildren(
      h('div', { class: 'row between' }, h('h1', {}, 'Statistics'), h('button', { class: 'btn small', onclick: () => ctx.go('title') }, '← Back')),
      h('p', { class: 'small muted' }, 'Kept only on this device.'),
      h('table', { class: 'rt' }, h('tbody', {}, ...rows.map(([a, b]) => h('tr', {}, h('th', { scope: 'row' }, a), h('td', {}, b))))),
      h('button', { class: 'btn', onclick: async () => { if (await confirmDialog(el, 'Reset statistics?', 'All statistics on this device will be set back to zero.', 'Reset')) { resetStats(); draw(); } } }, 'Reset statistics'));
  };
  el.append(page);
  draw();
  return { el, onKey: (e) => { if (e.key === 'Escape') ctx.go('title'); } };
}

export function creditsScreen(ctx: AppCtx): Screen {
  const el = h('div', { class: 'screen paper' });
  const item = (t: string, b: string) => h('li', {}, h('strong', {}, t), ' — ', b);
  el.append(h('div', { class: 'page' },
    h('div', { class: 'row between' }, h('h1', {}, 'Credits'), h('button', { class: 'btn small', onclick: () => ctx.go('title') }, '← Back')),
    h('ul', { class: 'credits' },
      item('Card faces', 'Adrian Kennard’s SVG playing cards (me.uk/cards), dedicated to the public domain (CC0), as packaged by letele/playing-cards. Enlarged corner indices, paper and four-colour variant added for this game.'),
      item('Jokers and card backs', 'Original artwork for this game: the “El Sol” comodín, and backs after a woven basket, the Río de la Plata stripes and Montevideo’s hydraulic floor tiles.'),
      item('Card sounds', 'Kenney, “Casino Audio” (kenney.nl), CC0.'),
      item('Short musical cues', 'Sam Gossner, VSCO 2 Community Edition congas, claves and cowbell, and menegass, bongos — both CC0 via Freesound.'),
      h('li', {}, h('strong', {}, 'Table music'), ' — “Green Salon” by Yubatake. ',
        h('a', { href: 'https://opengameart.org/content/green-salon', target: '_blank', rel: 'noopener noreferrer' }, 'Original track'),
        ' · ', h('a', { href: 'https://creativecommons.org/licenses/by/4.0/', target: '_blank', rel: 'noopener noreferrer' }, 'CC BY 4.0 licence'),
        '. Converted to MP3 for this game.'),
      item('Rules', 'Pagat.com (John McLeod), Classic Canasta, cross-checked with Bicycle’s guide.'),
      item('Software', 'three.js, Motion and Howler.js (MIT).')),
    h('p', { class: 'small muted' }, 'Full provenance, licences and modifications: docs/ASSETS.md in the source repository.')));
  return { el, onKey: (e) => { if (e.key === 'Escape') ctx.go('title'); } };
}
