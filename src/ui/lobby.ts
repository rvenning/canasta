/**
 * New match: choose two, three or four players, make each seat a person at this
 * device or a computer player (Relaxed, Standard or Expert), and see who plays
 * with whom before dealing.
 */
import { rulesFor, type PlayerCount } from '../rules/config.ts';
import { randomSeed } from '../rules/rng.ts';
import { newMatch, type AiLevel, type SeatConfig } from '../engine/match.ts';
import { PERSONAS, personaById } from '../ai/personalities.ts';
import { clearMatch, loadLastSetup, saveLastSetup, saveMatch } from '../persistence/saves.ts';
import type { AppCtx, Screen } from './app.ts';
import { h } from './dom.ts';

export const LEVELS: [AiLevel, string, string][] = [
  ['relaxed', 'Relaxed', 'Melds what it can and takes easy piles. Good for learning.'],
  ['standard', 'Standard', 'Keeps pairs for frozen piles, completes canastas, discards with care.'],
  ['expert', 'Expert', 'Remembers every card it has seen and judges each discard’s risk.'],
];

export function startMatch(ctx: AppCtx, players: PlayerCount, seats: SeatConfig[]) {
  const setup = { rules: rulesFor(players), seats: seats.map((s) => ({ ...s })), seed: randomSeed() };
  const m = newMatch(setup).state;
  saveLastSetup({ players, seats: setup.seats });
  clearMatch();
  saveMatch(m, ctx.build.version);
  ctx.go('game', { match: m });
}

function defaultSeats(players: PlayerCount): SeatConfig[] {
  const ais = [...PERSONAS];
  return Array.from({ length: players }, (_, i) => {
    if (i === 0) return { name: 'You', kind: 'human' as const };
    const p = ais.splice((i * 3) % ais.length, 1)[0];
    return { name: p.name, kind: 'ai' as const, level: 'standard' as AiLevel, persona: p.id };
  });
}

export function lobbyScreen(ctx: AppCtx): Screen {
  const el = h('div', { class: 'screen paper' });
  const last = loadLastSetup();
  let players = (last?.players ?? 4) as PlayerCount;
  const bySize = new Map<PlayerCount, SeatConfig[]>();
  if (last) bySize.set(players, last.seats.map((s) => ({ ...s })));
  const seatsFor = (n: PlayerCount) => { if (!bySize.has(n)) bySize.set(n, defaultSeats(n)); return bySize.get(n)!; };
  const page = h('div', { class: 'page lobby' });
  el.append(page);

  const draw = () => {
    const seats = seatsFor(players);
    const r = rulesFor(players);
    const usedPersonas = new Set(seats.filter((s) => s.kind === 'ai').map((s) => s.persona));
    const seatRow = (i: number) => {
      const s = seats[i];
      const name = h('input', { type: 'text', value: s.name, maxlength: 16, 'aria-label': `Seat ${i + 1} name` }) as HTMLInputElement;
      name.addEventListener('input', () => { s.name = name.value.trim() || `Player ${i + 1}`; drawPreview(); });
      const kind = h('div', { class: 'seg small', role: 'radiogroup', 'aria-label': `Seat ${i + 1}` },
        (['human', 'ai'] as const).map((k) => h('button', { class: 'seg-btn' + (s.kind === k ? ' on' : ''), role: 'radio', 'aria-checked': String(s.kind === k), onclick: () => {
          if (s.kind === k) return;
          s.kind = k;
          if (k === 'ai') {
            const p = PERSONAS.find((x) => !usedPersonas.has(x.id)) ?? PERSONAS[i % PERSONAS.length];
            s.persona = p.id; s.name = p.name; s.level = s.level ?? 'standard';
          } else { s.name = `Player ${i + 1}`; delete s.persona; }
          draw();
        } }, k === 'human' ? 'Person' : 'Computer')));
      const level = s.kind === 'ai' ? h('select', { 'aria-label': `Seat ${i + 1} difficulty` }, LEVELS.map(([v, t]) => h('option', { value: v }, t))) as HTMLSelectElement : null;
      if (level) { level.value = s.level ?? 'standard'; level.addEventListener('change', () => { s.level = level.value as AiLevel; drawPreview(); }); }
      const persona = s.kind === 'ai' ? personaById(s.persona) : null;
      return h('div', { class: 'seat-row' },
        h('span', { class: `avatar pat-${persona?.pattern ?? i}`, style: persona ? { background: persona.color } : {}, 'aria-hidden': 'true' }, persona?.initials ?? String(i + 1)),
        h('div', { class: 'seat-fields' }, name, h('div', { class: 'row' }, kind, level), persona ? h('p', { class: 'small muted' }, persona.blurb) : null));
    };
    const preview = h('div', { class: 'preview', 'aria-live': 'polite' });
    const drawPreview = () => {
      const n = (i: number) => seats[i].name;
      let text: HTMLElement;
      if (players === 4) text = h('div', {}, h('p', {}, h('strong', {}, `${n(0)} & ${n(2)}`), ' play against ', h('strong', {}, `${n(1)} & ${n(3)}`), '. Partners sit opposite and share their melds.'));
      else if (players === 3) text = h('div', {}, h('p', {}, 'Everyone starts alone. The first player to take the discard pile plays alone for that hand; the other two become partners until the hand ends.'), h('p', { class: 'small muted' }, 'Each player keeps their own score.'));
      else text = h('div', {}, h('p', {}, h('strong', {}, n(0)), ' against ', h('strong', {}, n(1)), '. Two canastas to go out.'));
      const tbl = h('div', { class: `mini-table p${players}`, 'aria-hidden': 'true' }, seats.map((s, i) => h('span', { class: `mini-seat s${i}` + (players === 4 ? ` team${i % 2}` : ''), title: s.name }, s.name.slice(0, 1))));
      preview.replaceChildren(tbl, text, h('p', { class: 'small' }, `Deal ${r.dealSize} each · draw ${r.drawCount} · ${r.canastasToGoOut === 1 ? 'one canasta' : 'two canastas'} to go out · play to ${r.target.toLocaleString()}.`));
    };
    drawPreview();
    const humans = seats.filter((s) => s.kind === 'human').length;
    page.replaceChildren(h('div', { class: 'lobby-inner' },
      h('div', { class: 'row between' }, h('h1', {}, 'New match'), h('button', { class: 'btn small', onclick: () => ctx.go('title') }, '← Back')),
      h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Number of players' }, ([2, 3, 4] as PlayerCount[]).map((k) =>
        h('button', { class: 'seg-btn' + (k === players ? ' on' : ''), role: 'radio', 'aria-checked': String(k === players), onclick: () => { players = k; draw(); } }, `${k} players`))),
      h('div', { class: 'seats-list' }, seats.map((_, i) => seatRow(i))),
      preview,
      h('div', { class: 'panel' }, h('h3', {}, 'Computer players'), LEVELS.map(([, t, d]) => h('p', { class: 'small' }, h('strong', {}, t), ' — ', d))),
      humans > 1 ? h('p', { class: 'small' }, 'Pass and play: the device is handed round, and each person’s cards are hidden until they tap to see them.') : null,
      humans === 0 ? h('p', { class: 'small' }, 'Every seat is a computer player: you will watch the match.') : null,
      h('div', { class: 'row end sticky-actions' }, h('button', { class: 'btn primary big', onclick: () => startMatch(ctx, players, seats) }, humans === 0 ? 'Watch the match' : 'Deal'))));
  };
  draw();
  return { el, onKey: (e) => { if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) ctx.go('title'); } };
}
