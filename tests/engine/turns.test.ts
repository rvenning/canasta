import { describe, expect, it } from 'vitest';
import { rankOf } from '../../src/rules/cards.ts';
import { rulesFor } from '../../src/rules/config.ts';
import { apply, newMatch, replay } from '../../src/engine/match.ts';
import { scoreHand } from '../../src/engine/scoring.ts';
import { goOutPlan } from '../../src/engine/solver.ts';
import { pick, scenario, seats, step, tryStep } from '../helpers.ts';

const K = 13, Q = 12, A = 1, SEVEN = 7;
const canasta = (r: string, n = 7) => Array.from({ length: n }, (_, i) => r + 'CDHS'[i % 4]);

describe('initial meld requirement', () => {
  it('needs 50 at zero, and several melds laid together count', () => {
    const { s } = scenario({ phase: 'play', hands: [['KH', 'KS', 'KD', '5H', '5S', '5D', 'AC', 'AD', 'AH', '9C', '10C'], ['4H'], ['4S'], ['4D']] });
    const h = s.hand.hands[0];
    const kings = pick(h, 'KH', 'KS', 'KD'), fives = pick(h, '5H', '5S', '5D'), aces = pick(h, 'AC', 'AD', 'AH');
    expect(tryStep(s, { t: 'meld', seat: 0, groups: [{ rank: 5, cards: fives }] })).toMatchObject({ ok: false, error: expect.stringMatching(/at least 50.*worth 15/) });
    expect(tryStep(s, { t: 'meld', seat: 0, groups: [{ rank: K, cards: kings }, { rank: 5, cards: fives }] }).ok).toBe(false); // 45
    const after = step(s, { t: 'meld', seat: 0, groups: [{ rank: K, cards: kings }, { rank: A, cards: aces }] }); // 90
    expect(after.hand.melds[0].length).toBe(2);
    // Once the side has melded, anything goes — for the partner too.
    expect(tryStep(after, { t: 'meld', seat: 0, groups: [{ rank: 5, cards: fives }] }).ok).toBe(true);
  });

  for (const [score, need] of [[-200, 15], [1500, 90], [3000, 120]] as const) {
    it(`needs ${need} at ${score}`, () => {
      const { s } = scenario({ phase: 'play', scores: [score, 0], hands: [['AH', 'AS', 'AD', 'KC', 'KD', 'KH', 'QH', 'QS', 'QC', 'Jk', '4H', '4S'], ['4D'], ['4C'], ['9D']] });
      const h = s.hand.hands[0];
      const aces = pick(h, 'AH', 'AS', 'AD'); // 60
      const kings = pick(h, 'KC', 'KD', 'KH'); // 30
      const queens = pick(h, 'QH', 'QS', 'QC', 'Jk'); // 80
      expect(tryStep(s, { t: 'meld', seat: 0, groups: [{ rank: 4, cards: pick(h, '4H', '4S', 'Jk') }] }).ok).toBe(need <= 60);
      expect(tryStep(s, { t: 'meld', seat: 0, groups: [{ rank: A, cards: aces }] }).ok).toBe(need <= 60);
      expect(tryStep(s, { t: 'meld', seat: 0, groups: [{ rank: A, cards: aces }, { rank: K, cards: kings }] }).ok).toBe(need <= 90);
      expect(tryStep(s, { t: 'meld', seat: 0, groups: [{ rank: A, cards: aces }, { rank: Q, cards: queens }] }).ok).toBe(true);
    });
  }

  it('counts only the top card from the pile, not the cards underneath (Pagat example)', () => {
    // King on top; a king and queen buried. Hand: K K Q Q 2. Needs 50 → K K K + Q Q 2 = 70 works; at 90 it does not.
    for (const [score, ok] of [[0, true], [1600, false]] as const) {
      const { s } = scenario({ scores: [score, 0], pile: ['KC', 'QD', '9H', 'KS'], hands: [['KH', 'KD', 'QH', 'QS', '2C', '6H'], ['4D'], ['4C'], ['9D']] });
      const h = s.hand.hands[0], top = s.hand.pile[3];
      const res = tryStep(s, { t: 'take', seat: 0, groups: [{ rank: K, cards: [top, ...pick(h, 'KH', 'KD')] }, { rank: Q, cards: pick(h, 'QH', 'QS', '2C') }] });
      expect(res.ok).toBe(ok);
      if (res.ok) {
        const st = res.state.hand;
        expect(st.pile).toEqual([]);
        expect(st.hands[0].length).toBe(1 + 3); // 6H plus the three buried cards
        expect(st.lone).toBeNull();
      } else expect(res.error).toMatch(/Only the top card counts/);
    }
  });

  it('bonus cards never count toward the minimum', () => {
    const { s } = scenario({ phase: 'play', redThrees: [['3H', '3D'], [], [], []], hands: [['5H', '5S', '5D', '6H', '6S', '6D', '9C'], ['4D'], ['4C'], ['9D']] });
    const h = s.hand.hands[0];
    expect(tryStep(s, { t: 'meld', seat: 0, groups: [{ rank: 5, cards: pick(h, '5H', '5S', '5D') }, { rank: 6, cards: pick(h, '6H', '6S', '6D') }] }).ok).toBe(false);
  });

  it('a concealed hand with a canasta goes out without meeting the minimum', () => {
    const { s } = scenario({ phase: 'play', scores: [3200, 0], stock: ['KC', 'KD'], hands: [[...canasta('4'), '5H', '5S', '5D', '9C'], ['8D'], ['8C'], ['9D']] });
    // Draw happened from the stock (scenario sets drew = 'stock'). 4s ×7 = 35 + 5s ×3 = 15 → 50 < 120.
    const h = s.hand.hands[0];
    const fours = h.filter((c) => rankOf(c) === 4), fives = h.filter((c) => rankOf(c) === 5);
    const after = step(s, { t: 'meld', seat: 0, groups: [{ rank: 4, cards: fours }, { rank: 5, cards: fives }] });
    const done = step(after, { t: 'discard', seat: 0, card: pick(after.hand.hands[0], '9C')[0] });
    expect(done.phase).toBe('handEnd');
    expect(done.lastScore!.concealed).toBe(true);
    expect(done.lastScore!.lines[0].goingOut).toBe(200);
    // Without going out, the same canasta is not enough.
    expect(tryStep(s, { t: 'meld', seat: 0, groups: [{ rank: 4, cards: fours }] }).ok).toBe(false);
  });
});

describe('taking the discard pile', () => {
  const base = (over: Partial<Parameters<typeof scenario>[0]> = {}) => scenario({
    melds: [{ slot: 0, owner: 2, rank: 9, cards: ['9H', '9S', '9D'] }], pile: ['6C', 'QH'],
    hands: [['QS', 'QD', 'Jk', 'QC', '8H', '8S', '9C'], ['4D'], ['4C'], ['4S']], ...over,
  });

  it('unfrozen: with a natural pair', () => {
    const { s } = base();
    const h = s.hand.hands[0], top = s.hand.pile[1];
    const next = step(s, { t: 'take', seat: 0, groups: [{ rank: Q, cards: [top, ...pick(h, 'QS', 'QD')] }] });
    expect(next.hand.melds[0].find((m) => m.rank === Q)!.cards).toHaveLength(3);
    expect(next.hand.phase).toBe('play');
    expect(next.hand.drew).toBe('pile');
  });

  it('unfrozen: with one natural and one wild card', () => {
    const { s } = base();
    const h = s.hand.hands[0], top = s.hand.pile[1];
    expect(tryStep(s, { t: 'take', seat: 0, groups: [{ rank: Q, cards: [top, ...pick(h, 'QS', 'Jk')] }] }).ok).toBe(true);
  });

  it('unfrozen: by adding the top card to an existing meld', () => {
    const { s } = base({ pile: ['6C', '9D'] });
    const top = s.hand.pile[1];
    const m = s.hand.melds[0][0];
    const next = step(s, { t: 'take', seat: 0, groups: [{ rank: 9, cards: [top], into: m.id }] });
    expect(next.hand.melds[0][0].cards).toHaveLength(4);
    expect(next.hand.addedToPartner).toBe(true);
  });

  it('frozen by a wild card: only a natural pair will do', () => {
    const { s } = base({ pile: ['2C', 'QH'], frozen: true });
    const h = s.hand.hands[0], top = s.hand.pile[1];
    expect(tryStep(s, { t: 'take', seat: 0, groups: [{ rank: Q, cards: [top, ...pick(h, 'QS', 'Jk')] }] })).toMatchObject({ ok: false, error: expect.stringMatching(/frozen: .*two natural Queens/) });
    expect(tryStep(s, { t: 'take', seat: 0, groups: [{ rank: Q, cards: [top, ...pick(h, 'QS', 'QD')] }] }).ok).toBe(true);
  });

  it('frozen against a side that has not melded', () => {
    const { s } = base({ melds: [], pile: ['6C', '9D'], hands: [['9S', 'Jk', 'AH', 'AS', 'AD', 'KD'], ['4D'], ['4C'], ['4S']] });
    const h = s.hand.hands[0], top = s.hand.pile[1];
    expect(tryStep(s, { t: 'take', seat: 0, groups: [{ rank: 9, cards: [top, ...pick(h, '9S', 'Jk')] }, { rank: A, cards: pick(h, 'AH', 'AS', 'AD') }] })).toMatchObject({ ok: false, error: expect.stringMatching(/until you have melded/) });
  });

  it('a black three or a wild card on top cannot be taken', () => {
    for (const top of ['3S', '2D', 'Jk']) {
      const { s } = base({ pile: ['6C', top] });
      const res = tryStep(s, { t: 'take', seat: 0, groups: [{ rank: 9, cards: [s.hand.pile[1]], into: 1 }] });
      expect(res.ok).toBe(false);
    }
  });

  it('a player holding one card may not take a one-card pile', () => {
    const { s } = base({ pile: ['9D'], hands: [['8H'], ['4D'], ['4C'], ['4S']] });
    expect(tryStep(s, { t: 'take', seat: 0, groups: [{ rank: 9, cards: [s.hand.pile[0]], into: 1 }] })).toMatchObject({ ok: false, error: expect.stringMatching(/one card/) });
  });

  it('a red three turned up at the deal goes to whoever takes the pile, without replacement', () => {
    const { s } = base({ pile: ['3H', 'QH'], frozen: true });
    const h = s.hand.hands[0], top = s.hand.pile[1];
    const next = step(s, { t: 'take', seat: 0, groups: [{ rank: Q, cards: [top, ...pick(h, 'QS', 'QD')] }] });
    expect(next.hand.redThrees[0]).toHaveLength(1);
    expect(next.hand.hands[0]).toHaveLength(7 - 2);
  });
});

describe('discards', () => {
  it('a discarded wild card freezes the pile; a black three only stops the next player', () => {
    const { s } = scenario({ phase: 'play', melds: [{ slot: 1, owner: 1, rank: 8, cards: ['8H', '8S', '8D'] }], pile: ['6C'], hands: [['2H', '3S', 'KD', 'KC'], ['8C', '9S', '9D', '4D'], ['4C'], ['4S']] });
    const a = step(s, { t: 'discard', seat: 0, card: pick(s.hand.hands[0], '2H')[0] });
    expect(a.hand.pileFrozen).toBe(true);
    const { s: s2 } = scenario({ phase: 'play', melds: [{ slot: 1, owner: 1, rank: 8, cards: ['8H', '8S', '8D'] }], pile: ['8C'], hands: [['3S', 'KD', 'KC'], ['8C', '9S', '9D', '4D'], ['4C'], ['4S']] });
    const b = step(s2, { t: 'discard', seat: 0, card: pick(s2.hand.hands[0], '3S')[0] });
    expect(b.hand.pileFrozen).toBe(false);
    expect(tryStep(b, { t: 'take', seat: 1, groups: [{ rank: 3, cards: [b.hand.pile[1]] }] })).toMatchObject({ ok: false, error: expect.stringMatching(/black three/) });
  });
});

describe('going out', () => {
  it('is not allowed without a canasta: a player must keep a card after discarding', () => {
    const { s } = scenario({ phase: 'play', melds: [{ slot: 0, owner: 0, rank: 9, cards: ['9H', '9S', '9D'] }], hands: [['9C', '4H'], ['4D'], ['4C'], ['4S']] });
    expect(tryStep(s, { t: 'meld', seat: 0, groups: [{ rank: 9, cards: pick(s.hand.hands[0], '9C') }] })).toMatchObject({ ok: false, error: expect.stringMatching(/keep at least two cards/) });
  });

  it('with a canasta: meld and discard the last card, 100 bonus', () => {
    const { s } = scenario({ phase: 'play', melds: [{ slot: 0, owner: 2, rank: 9, cards: canasta('9') }], hands: [['KH', 'KS', 'KD', '4H'], ['4D', 'JD'], ['4C'], ['4S']] });
    const a = step(s, { t: 'meld', seat: 0, groups: [{ rank: K, cards: pick(s.hand.hands[0], 'KH', 'KS', 'KD') }] });
    const b = step(a, { t: 'discard', seat: 0, card: a.hand.hands[0][0] });
    expect(b.phase).toBe('handEnd');
    const line = b.lastScore!.lines[0];
    expect(line.goingOut).toBe(100);
    expect(line.naturalCanastas).toBe(1);
    expect(line.melded).toBe(70 + 30);
    expect(b.lastScore!.lines[1].inHand).toBe(5 + 10 + 5);
    expect(b.lastScore!.lines[1].total).toBe(-20);
  });

  it('two players need two canastas', () => {
    const { s } = scenario({ players: 2, phase: 'play', melds: [{ slot: 0, owner: 0, rank: 9, cards: canasta('9') }], hands: [['KH', 'KS', 'KD', '4H'], ['4D', 'JD']] });
    expect(tryStep(s, { t: 'meld', seat: 0, groups: [{ rank: K, cards: pick(s.hand.hands[0], 'KH', 'KS', 'KD') }] })).toMatchObject({ ok: false, error: expect.stringMatching(/2 canastas/) });
  });

  it('melding every card goes out without a discard; black threes may be melded then', () => {
    const { s } = scenario({ phase: 'play', melds: [{ slot: 0, owner: 0, rank: 9, cards: canasta('9') }], hands: [['KH', 'KS', 'KD', '3S', '3C', '3S'], ['4D'], ['4C'], ['4S']] });
    const h = s.hand.hands[0];
    const b = step(s, { t: 'meld', seat: 0, groups: [{ rank: K, cards: pick(h, 'KH', 'KS', 'KD') }, { rank: 3, cards: pick(h, '3S', '3C', '3S') }] });
    expect(b.phase).toBe('handEnd');
    expect(b.lastScore!.lines[0].melded).toBe(70 + 30 + 15);
  });

  it('black threes cannot be melded otherwise', () => {
    const { s } = scenario({ phase: 'play', melds: [{ slot: 0, owner: 0, rank: 9, cards: canasta('9') }], hands: [['3S', '3C', '3S', 'KD', 'QD', '8H'], ['4D'], ['4C'], ['4S']] });
    expect(tryStep(s, { t: 'meld', seat: 0, groups: [{ rank: 3, cards: pick(s.hand.hands[0], '3S', '3C', '3S') }] })).toMatchObject({ ok: false, error: expect.stringMatching(/only be melded as part of going out/) });
  });

  it('asking partner: yes binds the player to go out, no forbids it', () => {
    const sc = () => scenario({ phase: 'play', melds: [{ slot: 0, owner: 2, rank: 9, cards: canasta('9') }], hands: [['KH', 'KS', 'KD', '4H'], ['4D'], ['4C', 'AS'], ['4S']] });
    const { s } = sc();
    const asked = step(s, { t: 'ask', seat: 0 });
    expect(asked.hand.phase).toBe('ask');
    expect(tryStep(asked, { t: 'answer', seat: 1, yes: true }).ok).toBe(false);
    const yes = step(asked, { t: 'answer', seat: 2, yes: true });
    expect(tryStep(yes, { t: 'discard', seat: 0, card: pick(yes.hand.hands[0], '4H')[0] })).toMatchObject({ ok: false, error: expect.stringMatching(/must go out/) });
    const no = step(step(sc().s, { t: 'ask', seat: 0 }), { t: 'answer', seat: 2, yes: false });
    expect(tryStep(no, { t: 'meld', seat: 0, groups: [{ rank: K, cards: pick(no.hand.hands[0], 'KH', 'KS', 'KD') }] })).toMatchObject({ ok: false, error: expect.stringMatching(/partner said no/) });
    // Two players have nobody to ask.
    const { s: two } = scenario({ players: 2, phase: 'play', hands: [['KH', 'KS', 'KD', '4H'], ['4D']] });
    expect(tryStep(two, { t: 'ask', seat: 0 }).ok).toBe(false);
  });

  it('concealed only if the player had not melded before and added nothing to partner’s melds', () => {
    const { s } = scenario({ phase: 'play', melds: [{ slot: 0, owner: 2, rank: 9, cards: ['9H', '9S', '9D'] }], hands: [[...canasta('K'), '9C', '4H'], ['4D'], ['4C'], ['4S']] });
    const h = s.hand.hands[0];
    const a = step(s, { t: 'meld', seat: 0, groups: [{ rank: K, cards: h.filter((c) => rankOf(c) === K) }, { rank: 9, cards: pick(h, '9C') }] });
    const b = step(a, { t: 'discard', seat: 0, card: a.hand.hands[0][0] });
    expect(b.lastScore!.concealed).toBe(false);
    expect(b.lastScore!.lines[0].goingOut).toBe(100);
  });
});

describe('the end of the stock', () => {
  it('drawing from an empty stock ends the hand', () => {
    const { s } = scenario({ stock: [], pile: ['6C', 'QH'], hands: [['4H', '5H'], ['4D'], ['4C'], ['4S']] });
    const b = step(s, { t: 'draw', seat: 0 });
    expect(b.phase).toBe('handEnd');
    expect(b.lastScore!.endReason).toBe('stock');
  });

  it('a player must take a pile whose top card fits their meld', () => {
    const { s } = scenario({ stock: [], melds: [{ slot: 0, owner: 0, rank: Q, cards: ['QS', 'QD', 'QC'] }], pile: ['6C', 'QH'], hands: [['4H', '5H'], ['4D'], ['4C'], ['4S']] });
    expect(tryStep(s, { t: 'draw', seat: 0 })).toMatchObject({ ok: false, error: expect.stringMatching(/must take the pile/) });
  });

  it('a red three drawn as the last card ends play at once', () => {
    const { s } = scenario({ stock: ['3D'], hands: [['4H', '5H'], ['4D'], ['4C'], ['4S']] });
    const b = step(s, { t: 'draw', seat: 0 });
    expect(b.phase).toBe('handEnd');
    expect(b.hand.redThrees[0]).toHaveLength(1);
  });

  it('two players draw two, and a lone last card is a complete draw', () => {
    const { s } = scenario({ players: 2, stock: ['9C'], hands: [['4H', '5H'], ['4D']] });
    const b = step(s, { t: 'draw', seat: 0 });
    expect(b.hand.hands[0]).toHaveLength(3);
    expect(b.hand.phase).toBe('play');
    const { s: s2 } = scenario({ players: 2, stock: ['9C', '3H'], hands: [['4H', '5H'], ['4D']] });
    const c = step(s2, { t: 'draw', seat: 0 });
    expect(c.hand.hands[0]).toHaveLength(3); // the red three had no replacement: one-card draw
    expect(c.hand.redThrees[0]).toHaveLength(1);
  });

  it('red threes drawn are laid out and replaced', () => {
    const { s } = scenario({ stock: ['9C', '8D', '3H'], hands: [['4H', '5H'], ['4D'], ['4C'], ['4S']] });
    const b = step(s, { t: 'draw', seat: 0 });
    expect(b.hand.redThrees[0]).toHaveLength(1);
    expect(b.hand.hands[0]).toHaveLength(3);
    expect(b.hand.stock).toHaveLength(1);
  });
});

describe('scoring', () => {
  it('red threes: 100 each, 800 for four, negative for a side that never melded', () => {
    const { s } = scenario({ stock: [], melds: [{ slot: 1, owner: 1, rank: 8, cards: ['8H', '8S', '8D'] }], redThrees: [['3H', '3D'], ['3H'], ['3D'], []], pile: ['6C'], hands: [['4H'], ['4D'], ['4C'], ['4S']] });
    const b = step(s, { t: 'draw', seat: 0 });
    const [us, them] = b.lastScore!.lines;
    expect(us.redThrees).toBe(3);
    expect(us.redThreeScore).toBe(-300);
    expect(them.redThreeScore).toBe(100);
    const all = scoreHand(s.setup.rules, { ...s.hand, redThrees: [[1, 2], [], [3, 4], []] });
    expect(all.lines[0].redThreeScore).toBe(-800);
  });

  it('natural 500, mixed 300, plus card values', () => {
    const { s } = scenario({ stock: [], melds: [{ slot: 0, owner: 0, rank: K, cards: canasta('K') }, { slot: 0, owner: 2, rank: 5, cards: [...canasta('5', 6), 'Jk'] }], pile: ['6C'], hands: [['4H'], ['4D'], ['4C'], ['4S']] });
    const b = step(s, { t: 'draw', seat: 0 });
    const us = b.lastScore!.lines[0];
    expect([us.naturalCanastas, us.mixedCanastas, us.canastaBonus]).toEqual([1, 1, 800]);
    expect(us.melded).toBe(70 + 30 + 50);
    expect(us.inHand).toBe(10);
  });
});

describe('three players', () => {
  it('the first to take the pile plays alone; the other two pool their melds', () => {
    const { s } = scenario({
      players: 3,
      melds: [{ slot: 1, owner: 1, rank: 8, cards: ['8H', '8S', '8D'] }, { slot: 2, owner: 2, rank: 8, cards: ['8C', '8H', 'Jk'] }, { slot: 0, owner: 0, rank: 9, cards: ['9H', '9S', '9D'] }],
      pile: ['6C', '9C'], hands: [['4H', '5H', 'KD'], ['4D', 'QD'], ['4C', '7D']],
    });
    const b = step(s, { t: 'take', seat: 0, groups: [{ rank: 9, cards: [s.hand.pile[1]] }] });
    expect(b.hand.lone).toBe(0);
    // Seat 1 now sees seat 2's melds as its own side's: two eights melds, pooled.
    const add = tryStep({ ...b, hand: { ...b.hand, turn: 1, phase: 'play', drew: 'stock' } }, { t: 'meld', seat: 1, groups: [{ rank: 8, cards: [b.hand.hands[1][1]], into: 2 }] });
    expect(add.ok).toBe(false); // QD is not an eight
  });

  it('scores the partnership to both partners, red threes to each player', () => {
    const { s } = scenario({
      players: 3, stock: [], lone: 0,
      melds: [{ slot: 1, owner: 1, rank: K, cards: canasta('K') }, { slot: 2, owner: 2, rank: 5, cards: ['5H', '5S', '5D'] }, { slot: 0, owner: 0, rank: 9, cards: ['9H', '9S', '9D'] }],
      redThrees: [[], ['3H'], []], pile: ['6C'], hands: [['4H'], ['4D'], ['4C', 'QD']],
    });
    const b = step(s, { t: 'draw', seat: 0 });
    const [lone, p1, p2] = b.lastScore!.lines;
    const shared = 500 + 70 + 15 - (5 + 5 + 10);
    expect(p1.total).toBe(shared + 100);
    expect(p2.total).toBe(shared);
    expect(lone.total).toBe(30 - 5);
    expect(b.scores).toEqual([25, shared + 100, shared]);
  });

  it('when nobody took the pile, everyone scores alone', () => {
    const { s } = scenario({ players: 3, stock: [], melds: [{ slot: 1, owner: 1, rank: K, cards: ['KH', 'KS', 'KD'] }], pile: ['6C'], hands: [['4H'], ['4D'], ['4C']] });
    const b = step(s, { t: 'draw', seat: 0 });
    expect(b.lastScore!.lines.map((l) => l.total)).toEqual([-5, 30 - 5, -5]);
  });

  it('each partner meets their own opening requirement', () => {
    const { s } = scenario({ players: 3, phase: 'play', lone: 0, turn: 1, scores: [0, 1600, 0], hands: [['4H'], ['AH', 'AS', 'AD', '9C'], ['4C']] });
    const h = s.hand.hands[1];
    expect(tryStep(s, { t: 'meld', seat: 1, groups: [{ rank: A, cards: pick(h, 'AH', 'AS', 'AD') }] })).toMatchObject({ ok: false, error: expect.stringMatching(/90/) });
  });

  it('plays to 7,500', () => {
    expect(rulesFor(3).target).toBe(7500);
  });
});

describe('commands and replay', () => {
  it('rejects stale or duplicate commands and out-of-turn play', () => {
    const s = newMatch({ rules: rulesFor(4), seats: seats(4), seed: 9 }).state;
    expect(apply(s, { t: 'draw', seq: 5, seat: s.hand.turn }).ok).toBe(false);
    expect(apply(s, { t: 'draw', seq: 0, seat: (s.hand.turn + 1) % 4 })).toMatchObject({ ok: false, error: expect.stringMatching(/not your turn/) });
    const a = step(s, { t: 'draw', seat: s.hand.turn });
    expect(apply(a, { t: 'draw', seq: 0, seat: s.hand.turn }).ok).toBe(false);
    expect(tryStep(a, { t: 'draw', seat: s.hand.turn })).toMatchObject({ ok: false, error: expect.stringMatching(/already drawn/) });
  });

  it('replays a logged match exactly', () => {
    let s = newMatch({ rules: rulesFor(2), seats: seats(2), seed: 77 }).state;
    for (let i = 0; i < 30 && s.phase === 'play'; i++) {
      const seat = s.hand.turn;
      s = step(s, { t: 'draw', seat });
      if (s.phase !== 'play') break;
      s = step(s, { t: 'discard', seat, card: s.hand.hands[seat][0] });
    }
    const again = replay(s.setup, s.log);
    expect(again).toEqual(s);
  });

  it('the solver finds a way out and the engine accepts it', () => {
    const { s } = scenario({ phase: 'play', melds: [{ slot: 0, owner: 2, rank: 9, cards: ['9H', '9S', '9D', '9C', 'Jk'] }], hands: [['9H', '2C', 'KS', 'KD', 'Jk', '6C'], ['4D'], ['4C'], ['4S']] });
    const plan = goOutPlan(s.hand.hands[0], s.hand.melds[0], 1)!;
    expect(plan).not.toBeNull();
    let t = step(s, { t: 'meld', seat: 0, groups: plan.groups });
    if (plan.discard !== null) t = step(t, { t: 'discard', seat: 0, card: plan.discard });
    expect(t.phase).toBe('handEnd');
    expect(t.lastScore!.wentOut).toBe(0);
    void SEVEN;
  });
});
