import { describe, expect, it } from 'vitest';
import { isRedThree, isWild, pointValue } from '../../src/rules/cards.ts';
import { initialRequirement, rulesFor } from '../../src/rules/config.ts';
import { newMeldProblem, additionProblem } from '../../src/rules/melds.ts';
import { newMatch } from '../../src/engine/match.ts';
import { seats, cards } from '../helpers.ts';

const K = 13, Q = 12, A = 1;

describe('the pack and card values', () => {
  it('has 108 cards with the classic values', () => {
    const c = cards();
    expect(pointValue(c('Jk'))).toBe(50);
    expect(pointValue(c('2H'))).toBe(20);
    expect(pointValue(c('AS'))).toBe(20);
    expect(pointValue(c('KD'))).toBe(10);
    expect(pointValue(c('8C'))).toBe(10);
    expect(pointValue(c('7C'))).toBe(5);
    expect(pointValue(c('4H'))).toBe(5);
    expect(pointValue(c('3S'))).toBe(5);
    expect(pointValue(c('3H'))).toBe(0); // bonus card, never a card value
  });

  it('sets the initial meld requirement from the cumulative score', () => {
    expect(initialRequirement(-5)).toBe(15);
    expect(initialRequirement(0)).toBe(50);
    expect(initialRequirement(1495)).toBe(50);
    expect(initialRequirement(1500)).toBe(90);
    expect(initialRequirement(2995)).toBe(90);
    expect(initialRequirement(3000)).toBe(120);
  });
});

describe('the deal in each mode', () => {
  for (const [players, deal, draw, target] of [[2, 15, 2, 5000], [3, 13, 2, 7500], [4, 11, 1, 5000]] as const) {
    it(`${players} players: ${deal} cards each, draw ${draw}, play to ${target}`, () => {
      const r = rulesFor(players);
      expect([r.dealSize, r.drawCount, r.target]).toEqual([deal, draw, target]);
      for (let seed = 1; seed <= 60; seed++) {
        const s = newMatch({ rules: r, seats: seats(players), seed }).state;
        const h = s.hand;
        expect(h.hands.every((x) => x.length === deal)).toBe(true);
        const all = [...h.hands.flat(), ...h.stock, ...h.pile, ...h.redThrees.flat()];
        expect(new Set(all).size).toBe(108);
        expect(h.hands.flat().some(isRedThree)).toBe(false);
        const top = h.pile[h.pile.length - 1];
        expect(isWild(top) || isRedThree(top)).toBe(false);
        expect(h.pileFrozen).toBe(h.pile.length > 1);
        expect(h.turn).toBe((s.dealer + 1) % players);
      }
    });
  }
});

describe('melds', () => {
  it('needs three cards, two naturals and at most three wild cards', () => {
    const c = cards();
    expect(newMeldProblem(K, [c('KH'), c('KS'), c('KD')])).toBeNull();
    expect(newMeldProblem(K, [c('KC'), c('KH'), c('2H')])).toBeNull();
    expect(newMeldProblem(Q, [c('QH'), c('QS')])).toMatch(/three cards/);
    expect(newMeldProblem(Q, [c('QD'), c('2S'), c('Jk')])).toMatch(/two natural/);
    expect(newMeldProblem(A, [c('AH'), c('AS'), c('2C'), c('2D'), c('Jk'), c('Jk')])).toMatch(/three wild/);
    expect(newMeldProblem(A, [c('AD'), c('AC'), c('2C'), c('2D'), c('Jk')])).toBeNull(); // Classic allows 2 naturals + 3 wilds
    expect(newMeldProblem(Q, [c('QC'), c('QD'), c('JH')])).toMatch(/Only Queens/);
  });
  it('limits wild cards when adding', () => {
    const c = cards();
    const m = { id: 1, rank: 9, cards: [c('9H'), c('9S'), c('2S'), c('Jk'), c('2H')], owner: 0, slot: 0 };
    expect(additionProblem(m, [c('9D')])).toBeNull();
    expect(additionProblem(m, [c('2D')])).toMatch(/already hold three/);
  });
});

