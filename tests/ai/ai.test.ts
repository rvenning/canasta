import { describe, expect, it } from 'vitest';
import { simulateMatch } from '../../src/ai/simulate.ts';
import { decide } from '../../src/ai/policy.ts';
import { knownHands, sampleWorld } from '../../src/ai/expert.ts';
import { newMatch, apply, type AiLevel, type Command } from '../../src/engine/match.ts';
import { viewFor, HIDDEN } from '../../src/engine/view.ts';
import { rulesFor, type PlayerCount } from '../../src/rules/config.ts';
import { isRedThree } from '../../src/rules/cards.ts';
import { makeRng } from '../../src/rules/rng.ts';
import { seats } from '../helpers.ts';

const LEVELS: AiLevel[] = ['relaxed', 'standard', 'expert'];

describe('computer players never break the rules and never stall', () => {
  for (const players of [2, 3, 4] as PlayerCount[]) {
    for (const level of LEVELS) {
      it(`${players} players, ${level}: seeded full matches finish with no illegal move`, () => {
        const n = level === 'expert' ? 2 : 12;
        for (let seed = 1; seed <= n; seed++) {
          const r = simulateMatch(players, Array(players).fill(level), seed * 7919 + players);
          expect(r.illegal, JSON.stringify(r.illegal.slice(0, 2))).toEqual([]);
          expect(r.stalled).toBe(false);
          expect(r.winner).not.toBeNull();
        }
      });
    }
    it(`${players} players, mixed levels: finishes`, () => {
      const lv = Array.from({ length: players }, (_, i) => LEVELS[i % 3]);
      const r = simulateMatch(players, lv, 4242 + players);
      expect(r.illegal).toEqual([]);
      expect(r.winner).not.toBeNull();
    });
  }
});

describe('the information boundary', () => {
  it('the view has no other hands and no stock order', () => {
    const s = newMatch({ rules: rulesFor(4), seats: seats(4, 'ai'), seed: 5 }).state;
    const v = viewFor(s, 1);
    const text = JSON.stringify(v);
    for (const seat of [0, 2, 3]) for (const c of s.hand.hands[seat]) {
      // A card may be visible elsewhere (pile, melds); hidden ones must not appear in the view at all.
      if (!v.pile.includes(c)) expect(v.hand.includes(c)).toBe(false);
    }
    expect('stock' in v).toBe(false);
    expect(text.includes('"hands"')).toBe(false);
  });

  it('a decision does not change when the hidden cards are shuffled', () => {
    for (const level of ['relaxed', 'standard', 'expert'] as AiLevel[]) {
      for (let seed = 1; seed <= 6; seed++) {
        const s = newMatch({ rules: rulesFor(4), seats: seats(4, 'ai'), seed }).state;
        const seat = s.hand.turn;
        const a = decide(viewFor(s, seat), level);
        // Swap two opponents' hands and reverse the stock: nothing the AI may see has changed.
        const t = structuredClone(s);
        const o1 = (seat + 1) % 4, o2 = (seat + 3) % 4;
        [t.hand.hands[o1], t.hand.hands[o2]] = [t.hand.hands[o2].slice(0, t.hand.hands[o1].length), t.hand.hands[o1].slice(0, t.hand.hands[o2].length)];
        t.hand.stock.reverse();
        const b = decide(viewFor(t, seat), level);
        expect(b).toEqual(a);
      }
    }
  });

  it('Expert samples hidden cards only from what it has not seen, and never deals red threes into hands', () => {
    const s = newMatch({ rules: rulesFor(3), seats: seats(3, 'ai'), seed: 11 }).state;
    const v = viewFor(s, 0);
    const w = sampleWorld(v, knownHands(v), makeRng(3))!;
    expect(w.hands[0]).toEqual(v.hand);
    for (const seat of [1, 2]) {
      expect(w.hands[seat]).toHaveLength(v.handSizes[seat]);
      expect(w.hands[seat].some(isRedThree)).toBe(false);
      for (const c of w.hands[seat]) expect(v.hand.includes(c) || v.pile.includes(c)).toBe(false);
    }
    expect(w.stock).toHaveLength(v.stockCount);
    const all = new Set([...w.hands.flat(), ...w.stock, ...v.pile, ...v.redThrees.flat()]);
    expect(all.size).toBe(108);
    expect(HIDDEN).toBe(-1);
  });

  it('is reproducible: the same view gives the same move', () => {
    const s = newMatch({ rules: rulesFor(2), seats: seats(2, 'ai'), seed: 21 }).state;
    const v = viewFor(s, s.hand.turn);
    expect(decide(v, 'expert')).toEqual(decide(v, 'expert'));
  });

  it('a computer partner answers “may I go out?” with a legal command', () => {
    let s = newMatch({ rules: rulesFor(4), seats: seats(4, 'ai'), seed: 1 }).state;
    // Force an ask state and check the answer applies.
    s = structuredClone(s);
    s.hand.phase = 'ask';
    const partner = (s.hand.turn + 2) % 4;
    const m = decide(viewFor(s, partner), 'standard');
    expect(m.t).toBe('answer');
    const r = apply(s, { ...m, seq: s.seq, seat: partner } as Command);
    expect(r.ok).toBe(true);
  });
});
