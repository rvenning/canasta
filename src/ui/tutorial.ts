/**
 * First-game tutorial: three short cards about the idea of the game, then a
 * practice match against a Relaxed computer player on the real engine, with a
 * coach pointing at the next thing to do. The deal is chosen (by searching
 * seeds, not by rigging the engine) so that you move first and can open on your
 * first turn. After the first few moves the coach steps back and the ordinary
 * move guidance carries on.
 */
import { faceUrl } from '../presentation/cards.ts';
import { cardShort, isBlackThree, isWild, rankName, rankOf, type CardId } from '../rules/cards.ts';
import type { Group } from '../engine/hand.ts';
import { rulesFor } from '../rules/config.ts';
import { newMatch, type MatchState } from '../engine/match.ts';
import { openingSuggestion } from '../ai/policy.ts';
import { saveMatch, clearMatch } from '../persistence/saves.ts';
import type { AppCtx, Screen } from './app.ts';
import { h } from './dom.ts';
import { GameScreen, type Coach } from './game.ts';
import { enterSheet } from './anim.ts';

/** A seed where seat 0 plays first and can open after the first draw. */
export function tutorialSeed(): number {
  for (let seed = 1; seed < 5000; seed++) {
    const m = newMatch({ rules: rulesFor(2), seats: [{ name: 'You', kind: 'human' }, { name: 'Abuela Marta', kind: 'ai', level: 'relaxed', persona: 'marta' }], seed }).state;
    if (m.hand.turn !== 0 || m.hand.pile.length !== 1) continue;
    const top = m.hand.pile[0];
    if (isBlackThree(top)) continue;
    const next2 = m.hand.stock.slice(-2);
    if (next2.some((c) => isWild(c) || rankOf(c) === 3)) continue; // keep the first draw plain
    const sug = openingSuggestion([...m.hand.hands[0], ...next2], 50);
    if (sug && sug.length === 1 && sug[0].cards.length === 3) return seed;
  }
  return 1;
}

export function tutorialMatch(): MatchState {
  return newMatch({ rules: rulesFor(2), seats: [{ name: 'You', kind: 'human' }, { name: 'Abuela Marta', kind: 'ai', level: 'relaxed', persona: 'marta' }], seed: tutorialSeed() }).state;
}

function describe(g: Group): string {
  const wild = g.cards.filter(isWild);
  const nat = g.cards.filter((c) => !isWild(c));
  return `your ${nat.map(cardShort).join(' ')}${wild.length ? ` and the wild ${wild.map(cardShort).join(' ')}` : ''} (${rankName(rankOf(nat[0]), true)})`;
}

class TutorialCoach implements Coach {
  /** Cards the coach is pointing at, highlighted in the hand. */
  suggested: Group | null = null;
  highlight(): CardId[] { return this.suggested?.cards ?? []; }
  private seen = new Set<string>();
  private turns = 0;
  private lastSeq = -1;
  step(g: GameScreen): { text: string; target?: string } | null {
    const s = g.state, hd = s.hand;
    this.suggested = null;
    if (s.phase !== 'play' || !g.myMove) return null;
    if (hd.phase === 'draw' && this.lastSeq !== s.seq && hd.drew === null) { this.lastSeq = s.seq; this.turns++; }
    const opened = hd.melds[0].length > 0;
    if (this.turns <= 1) {
      if (hd.phase === 'draw') return { text: 'Your turn starts with a draw. Tap “Draw 2” (or the stock) to take the top two cards.', target: '[data-action="draw"]' };
      const sug = !opened ? openingSuggestion(hd.hands[0], 50) : null;
      if (!opened && sug && sug.length && g.staging.length === 0 && !sug[0].cards.every((c) => g.selection.has(c))) { this.suggested = sug[0]; return { text: `You can open! Your first meld must be worth at least 50. Tap ${describe(sug[0])} to select them.`, target: '.hand' }; }
      if (!opened && g.staging.length === 0) return { text: 'Now tap “Meld” to put them in the tray. Nothing is played until you lay it down.', target: '[data-action="stage"]' };
      if (!opened) return { text: 'The tray shows what you are about to play and its points. Tap “Lay down”, or × to take cards back.', target: '[data-action="lay"]' };
      if (g.selection.size !== 1) return { text: 'Finish your turn with a discard. Tap one card you don’t need — a single, not part of a pair.', target: '.hand' };
      return { text: 'Tap “Discard”. The next player may take the whole pile if they can use your card, so single low cards are safest.', target: '[data-action="discard"]' };
    }
    if (this.turns === 2 && hd.phase === 'draw' && !this.seen.has('pile')) {
      return { text: 'Instead of drawing you may take the whole discard pile — if you can meld its top card, for example with a pair from your hand. The hint tells you when you can.', target: '.pile' };
    }
    if (this.turns === 2) this.seen.add('pile');
    if (!this.seen.has('free') && this.turns >= 3) { this.seen.add('free'); return { text: 'You have the basics. Build canastas (seven of a kind) — you need two to go out. The hints stay on; you can switch them off in Settings.' }; }
    return null;
  }
}

const SLIDES = [
  { title: 'Welcome to Canasta', cards: [12, 25, 38, 51, 66], body: 'Canasta means “basket”. You collect cards of the same rank into melds — at least three Kings, say — and a meld of seven is a canasta, the big prize: 500 points if it is all natural cards, 300 with wild cards in it.' },
  { title: 'Wild cards and threes', cards: [52, 14, 28, 41], body: 'Jokers and twos are wild: they can join any meld, up to three per meld. A red three is a bonus (100 points) and goes straight onto the table. A black three is a stopper: discard one and the next player cannot take the pile.' },
  { title: 'The discard pile', cards: [18, 44, 5, 41], body: 'Each turn: draw, meld if you can, then discard. Rather than draw, you may take the whole discard pile if you can meld its top card — often a great haul. A wild card discarded onto the pile freezes it: then you need a natural pair to take it.' },
];

export function tutorialScreen(ctx: AppCtx): Screen & { game: GameScreen | null } {
  const el = h('div', { class: 'screen paper tutorial' });
  const result: Screen & { game: GameScreen | null } = { el, game: null };
  let i = 0;
  const start = () => {
    ctx.settings.guidance = true;
    ctx.settings.tutorialSeen = true;
    ctx.saveSettings();
    clearMatch();
    const m = tutorialMatch();
    saveMatch(m, ctx.build.version);
    const g = new GameScreen(ctx, m, { coach: new TutorialCoach() });
    result.game = g;
    el.replaceChildren(g.el);
    el.classList.remove('paper');
    result.destroy = () => g.destroy();
    result.onKey = (e) => g.onKey(e);
  };
  const draw = () => {
    const s = SLIDES[i];
    const sheet = h('div', { class: 'page slide' },
      h('div', { class: 'slide-cards', 'aria-hidden': 'true' }, s.cards.map((c, k) => h('img', { src: faceUrl(c), alt: '', style: { '--i': String(k), '--n': String(s.cards.length) } as unknown as Partial<CSSStyleDeclaration> }))),
      h('h1', {}, s.title),
      h('p', { class: 'lead' }, s.body),
      h('div', { class: 'dots', 'aria-label': `Step ${i + 1} of ${SLIDES.length}` }, SLIDES.map((_, k) => h('span', { class: 'dot' + (k === i ? ' on' : '') }))),
      h('div', { class: 'row between' },
        h('button', { class: 'btn', onclick: () => { ctx.settings.tutorialSeen = true; ctx.saveSettings(); ctx.go('title'); } }, 'Skip'),
        h('div', { class: 'row' },
          i > 0 ? h('button', { class: 'btn', onclick: () => { i--; draw(); } }, 'Back') : null,
          h('button', { class: 'btn primary', onclick: () => { if (i < SLIDES.length - 1) { i++; draw(); } else start(); } }, i < SLIDES.length - 1 ? 'Next' : 'Deal a practice hand'))));
    el.replaceChildren(sheet);
    enterSheet(el, sheet);
    (sheet.querySelector('.btn.primary') as HTMLButtonElement).focus();
  };
  draw();
  result.onKey = (e) => { if (e.key === 'ArrowRight' && i < SLIDES.length - 1) { i++; draw(); } else if (e.key === 'ArrowLeft' && i > 0) { i--; draw(); } };
  return result;
}
