import { describe, expect, it } from 'vitest';
import { rulesBook } from '../../src/content/rulesbook.ts';
import { tutorialMatch } from '../../src/ui/tutorial.ts';
import { hint, groupFromSelection, discardNote } from '../../src/ui/guide.ts';
import { openingSuggestion } from '../../src/ai/policy.ts';
import { replay } from '../../src/engine/match.ts';
import { rulesFor } from '../../src/rules/config.ts';
import { pick, scenario, step } from '../helpers.ts';

describe('rules reference', () => {
  it('describes each mode with its own numbers', () => {
    const text = (n: 2 | 3 | 4) => rulesBook(n).flatMap((s) => [s.title, ...s.body]).join(' ');
    expect(text(2)).toMatch(/15 cards/);
    expect(text(2)).toMatch(/two canastas/);
    expect(text(3)).toMatch(/13 cards/);
    expect(text(3)).toMatch(/plays alone/);
    expect(text(3)).toMatch(/7,500/);
    expect(text(4)).toMatch(/11 cards/);
    expect(text(4)).toMatch(/May I go out/);
    expect(rulesFor(4).target).toBe(5000);
  });
});

describe('the tutorial deal', () => {
  it('lets the player move first and open on the first turn, on the real engine', () => {
    const m = tutorialMatch();
    expect(m.hand.turn).toBe(0);
    const drawn = step(m, { t: 'draw', seat: 0 });
    const sug = openingSuggestion(drawn.hand.hands[0], 50)!;
    expect(sug).toHaveLength(1);
    const opened = step(drawn, { t: 'meld', seat: 0, groups: sug });
    expect(opened.hand.melds[0]).toHaveLength(1);
  });
});

describe('move guidance', () => {
  it('explains the opening requirement and a frozen pile', () => {
    const { s } = scenario({ pile: ['6C', '2D', '9H'], frozen: true, hands: [['9S', 'KD', 'KH', 'KS', '5H'], ['4D'], ['4C'], ['4S']] });
    const g = hint(s, 0, { selection: [], staging: [], taking: false, full: true });
    expect(g.text).toMatch(/frozen/);
    expect(g.text).toMatch(/two natural Nines/);
    const off = hint(s, 0, { selection: [], staging: [], taking: false, full: false });
    expect(off.text).toMatch(/^Your turn: draw a card or take the pile/);
  });

  it('turns a selection into a meld, or says why not', () => {
    const { s } = scenario({ phase: 'play', hands: [['9S', '9D', '2H', 'KD', '3S', 'Jk'], ['4D'], ['4C'], ['4S']] });
    const h = s.hand.hands[0];
    expect(groupFromSelection(s, 0, pick(h, '9S', '9D', '2H')).group?.rank).toBe(9);
    expect(groupFromSelection(s, 0, pick(h, '9S', 'KD')).why).toMatch(/one rank/);
    expect(groupFromSelection(s, 0, pick(h, '2H', 'Jk')).why).toMatch(/tap one of your side’s melds/);
    expect(groupFromSelection(s, 0, pick(h, '3S', '9S')).why).toMatch(/Threes/);
  });

  it('warns about discards that freeze, stop, or hand over the pile', () => {
    const { s } = scenario({ phase: 'play', melds: [{ slot: 1, owner: 1, rank: 8, cards: ['8H', '8S', '8D'] }], pile: ['6C'], hands: [['2H', '3S', '8C', 'KD'], ['4D'], ['4C'], ['4S']] });
    const h = s.hand.hands[0];
    expect(discardNote(s, 0, pick(h, '2H')[0])).toMatch(/freezes/);
    expect(discardNote(s, 0, pick(h, '3S')[0])).toMatch(/stops/);
    expect(discardNote(s, 0, pick(h, '8C')[0])).toMatch(/Careful/);
    expect(discardNote(s, 0, pick(h, 'KD')[0])).toBe('');
  });
});

describe('saved matches', () => {
  it('replay from the command log reproduces a saved state', () => {
    let m = tutorialMatch();
    m = step(m, { t: 'draw', seat: 0 });
    m = step(m, { t: 'discard', seat: 0, card: m.hand.hands[0][0] });
    const again = replay(m.setup, m.log);
    expect(again.hand).toEqual(m.hand);
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
});
