/**
 * The end-of-hand score sheet: every line's canasta bonuses, red threes, going
 * out, melded cards and cards left in hand, then the running totals, and the
 * match result when someone has reached the target.
 */
import { scoreLines } from '../rules/config.ts';
import { seatName, type MatchState } from '../engine/match.ts';
import type { LineScore } from '../engine/scoring.ts';
import type { AppCtx } from './app.ts';
import { enterSheet, staggerIn } from './anim.ts';
import { h } from './dom.ts';

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

export function lineName(s: MatchState, line: number, viewer: number | null = null): string {
  const r = s.setup.rules;
  const seats = r.partnership === 'fixed' ? [line, line + 2] : [line];
  const humans = s.setup.seats.filter((x) => x.kind === 'human').length;
  return seats.map((x) => (humans === 1 && x === viewer ? 'You' : seatName(s, x))).join(' & ');
}

export function scoreSheet(ctx: AppCtx, s: MatchState, o: { onNext(): void; onRematch(): void; onTitle(): void; viewer: number }): HTMLElement {
  const r = s.setup.rules;
  const sc = s.lastScore!;
  const lines = Array.from({ length: scoreLines(r) }, (_, l) => l);
  const over = s.phase === 'matchEnd';
  const why = sc.endReason === 'out'
    ? `${seatName(s, sc.wentOut!)} went out${sc.concealed ? ' concealed' : ''}.`
    : 'The stock ran out.';
  const three = r.partnership === 'threeHanded'
    ? (sc.lone !== null ? ` ${seatName(s, sc.lone)} played alone; the partners each score their shared melds plus their own red threes.` : ' Nobody took the pile, so everyone scored alone.')
    : '';
  const row = (label: string, pick: (l: LineScore) => number, cls = '') =>
    h('tr', { class: 'score-row ' + cls }, h('th', { scope: 'row' }, label), lines.map((l) => { const v = pick(sc.lines[l]); return h('td', { class: v < 0 ? 'neg' : '' }, signed(v)); }));
  const table = h('table', { class: 'score-table' },
    h('thead', {}, h('tr', {}, h('th', {}, ''), lines.map((l) => h('th', { scope: 'col' }, lineName(s, l, o.viewer))))),
    h('tbody', {},
      row('Canastas', (l) => l.canastaBonus),
      h('tr', { class: 'score-row detail' }, h('th', { scope: 'row' }, ''), lines.map((l) => h('td', {}, `${sc.lines[l].naturalCanastas} natural · ${sc.lines[l].mixedCanastas} mixed`))),
      row('Red threes', (l) => l.redThreeScore),
      row('Going out', (l) => l.goingOut),
      row('Cards melded', (l) => l.melded),
      row('Cards in hand', (l) => -l.inHand),
      row('This hand', (l) => l.total, 'total')),
    h('tfoot', {}, h('tr', { class: 'score-total' }, h('th', { scope: 'row' }, 'Match'), lines.map((l) => h('td', { class: s.winner === l ? 'winner' : '' }, s.scores[l].toLocaleString())))));
  const title = over ? `${lineName(s, s.winner!, o.viewer)} ${lineName(s, s.winner!, o.viewer) === 'You' ? 'win' : 'wins'} the match!` : `Hand ${s.handNo}`;
  const ov = h('div', { class: 'overlay score-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'score-t' },
    h('div', { class: 'sheet score-sheet' + (over ? ' match-over' : '') },
      h('h2', { id: 'score-t' }, title),
      h('p', { class: 'score-why' }, why + three),
      h('div', { class: 'table-wrap' }, table),
      over ? h('p', { class: 'score-why' }, `Played to ${r.target.toLocaleString()} over ${s.history.length} ${s.history.length === 1 ? 'hand' : 'hands'}.`) : h('p', { class: 'score-why' }, `Playing to ${r.target.toLocaleString()}.`),
      h('div', { class: 'row end' },
        over ? [h('button', { class: 'btn', onclick: o.onTitle }, 'Title screen'), h('button', { class: 'btn primary', onclick: o.onRematch }, 'New match')]
          : [h('button', { class: 'btn primary', onclick: o.onNext }, 'Next hand')])));
  enterSheet(ov);
  staggerIn([...ov.querySelectorAll('.score-row, .score-total')]);
  queueMicrotask(() => (ov.querySelector('.btn.primary') as HTMLButtonElement | null)?.focus());
  void ctx;
  return ov;
}
