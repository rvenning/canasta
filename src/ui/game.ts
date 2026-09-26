/**
 * The table. It renders from the match state, turns taps and keys into engine
 * commands, and drives the computer players. Game truth lives only in the
 * engine: the DOM is rebuilt from state after every command, and animation and
 * sound react to the engine's events without ever holding play up.
 */
import { cardName, cardShort, isBlackThree, isWild, rankOf, sortHand, sortKey, type CardId } from '../rules/cards.ts';
import { lineOfSeat, scoreLines } from '../rules/config.ts';
import { CANASTA, isCanasta, isNaturalCanasta, meldLabel, wildCount, type Meld } from '../rules/melds.ts';
import { apply, seatName, type Command, type MatchEvent, type MatchState } from '../engine/match.ts';
import { checkGroups, partnerOf, pileBlocked, pileTop, requirementFor, sideHasMelded, sideMelds, sideSeats, sideSlots, type Group } from '../engine/hand.ts';
import { goOutPlan } from '../engine/solver.ts';
import { viewFor } from '../engine/view.ts';
import { requestMove } from '../ai/client.ts';
import { takeOptionsFor, thinkingDelay, type AiMove } from '../ai/policy.ts';
import { personaById } from '../ai/personalities.ts';
import { audio, type Cue } from '../presentation/audio.ts';
import { backEl, backUrl, cardEl, faceUrl } from '../presentation/cards.ts';
import { chooseView, detectCapabilities, type TableView, type ViewChoice } from '../presentation/mode.ts';
import type { Table3D } from '../presentation/table3d.ts';
import type { Flight, Pose } from '../presentation/cardFlights.ts';
import { presentationAllowance } from '../presentation/pacing.ts';
import { prefersReducedMotion } from '../persistence/settings.ts';
import { clearMatch, saveMatch } from '../persistence/saves.ts';
import { recordHand, recordMatch } from '../persistence/stats.ts';
import { flip, finishAll, flourishIn, pop, snapshot, enterSheet, type Snapshot } from './anim.ts';
import type { AppCtx } from './app.ts';
import { announce, confirmDialog, h, toast } from './dom.ts';
import { describeGroup, discardNote, groupFromSelection, hint } from './guide.ts';
import { scoreSheet } from './score.ts';

export interface Coach {
  /** A message (and optionally an element to point at) for the current moment, or null. */
  step(g: GameScreen): { text: string; target?: string } | null;
  /** Hand cards to highlight for the current step. */
  highlight?(): CardId[];
}

export interface GameOpts { resume?: boolean; coach?: Coach; onExit?(): void }

export class GameScreen {
  readonly el: HTMLElement;
  state: MatchState;
  private ctx: AppCtx;
  private opts: GameOpts;
  selection = new Set<CardId>();
  staging: Group[] = [];
  taking = false;
  /** Seat whose point of view the table shows (their side at the bottom). */
  viewer: number;
  /** Seat whose hand is currently shown face up (null while hands are hidden between players). */
  private shown: number | null = null;
  private humans: number[];
  private aiToken = 0;
  private aiBusy = false;
  private destroyed = false;
  private lastEvents: MatchEvent[] = [];
  private error = '';
  private focusIdx = 0;
  private scoreShown = -1;
  private resizeObs: ResizeObserver | null = null;

  constructor(ctx: AppCtx, state: MatchState, opts: GameOpts = {}) {
    this.ctx = ctx;
    this.state = state;
    this.opts = opts;
    this.humans = state.setup.seats.map((s, i) => (s.kind === 'human' ? i : -1)).filter((i) => i >= 0);
    this.viewer = this.humans[0] ?? 0;
    if (this.humans.length <= 1) this.shown = this.viewer;
    this.el = h('div', { class: 'screen table-screen', 'data-table': ctx.settings.table, 'data-players': state.setup.rules.players });
    this.resizeObs = new ResizeObserver(() => { this.layout(); this.t3d?.resize(); this.sync3d(null, [], true); });
    this.resizeObs.observe(this.el);
    this.el.addEventListener('scroll', () => this.sync3d(null, [], true), { capture: true, passive: true });
    this.render(null);
    this.chooseTable();
    if (opts.resume) toast('Match resumed.');
    queueMicrotask(() => this.advance());
  }

  destroy() {
    this.destroyed = true;
    this.aiToken++;
    this.resizeObs?.disconnect();
    this.t3d?.dispose();
    this.t3d = null;
    finishAll();
  }

  // ------------------------------------------------------------------ the 3D table

  private t3d: Table3D | null = null;
  private t3dLoading = false;
  private perfDowngraded = false;
  viewChoice: ViewChoice = { view: '2d', reason: 'not chosen yet' };

  /** 3D where the device can carry it; the flat table otherwise. The DOM table works either way. */
  private chooseTable() {
    const forced = new URLSearchParams(location.search).get('view');
    const setting = (forced === '2d' || forced === '3d' ? forced : this.ctx.settings.tableView) as TableView;
    const reduced = prefersReducedMotion(this.ctx.settings);
    // ?view=3d lets tests use software graphics; reduced motion still always wins.
    const caps = forced === '3d' ? { ...detectCapabilities(reduced), softwareGl: false } : detectCapabilities(reduced);
    this.viewChoice = chooseView(setting, caps, this.perfDowngraded);
    if (this.viewChoice.view === '3d' && !this.t3d && !this.t3dLoading) {
      this.t3dLoading = true;
      void import('../presentation/table3d.ts').then(({ Table3D: T }) => {
        this.t3dLoading = false;
        if (this.destroyed || this.viewChoice.view !== '3d') return;
        this.t3d = new T(this.el, {
          faceUrl, backUrl: backUrl(), surface: this.ctx.settings.table,
          onFallback: (why) => { this.perfDowngraded = true; toast(`Switched to the flat table: ${why}.`); this.chooseTable(); },
        });
        this.el.classList.add('three');
        this.sync3d(null, [], true);
      }).catch(() => { this.t3dLoading = false; this.perfDowngraded = true; this.chooseTable(); });
    } else if (this.viewChoice.view === '2d' && this.t3d) {
      this.t3d.dispose();
      this.t3d = null;
      this.el.classList.remove('three');
    }
  }

  /** Card poses for the 3D table, read from the DOM boxes the layout produced. */
  private sync3d(before: Snapshot | null, events: MatchEvent[], jump = false) {
    const t = this.t3d;
    if (!t) return;
    const host = this.el.getBoundingClientRect();
    const poseOf = (r: DOMRect, z: number, rot = 0, face = 1): Pose => ({ x: r.left - host.left + r.width / 2, y: r.top - host.top + r.height / 2, z, w: r.width, rot, face, tilt: 0, show: 1 });
    const targets = new Map<number, Pose>();
    const pileEl = this.el.querySelector('.pile');
    const pileN = this.state.hand.pile.length;
    for (const e of this.el.querySelectorAll<HTMLElement>('.pile .card[data-card]')) {
      const r = e.getBoundingClientRect();
      const top = e.classList.contains('pile-top');
      targets.set(Number(e.dataset.card), poseOf(r, top ? pileN * 0.35 + 1 : 0.5, top ? 0 : 90));
    }
    for (const fan of this.el.querySelectorAll<HTMLElement>('.meld .fan')) {
      [...fan.querySelectorAll<HTMLElement>('.card[data-card]')].forEach((e, i) => targets.set(Number(e.dataset.card), poseOf(e.getBoundingClientRect(), 0.4 + i * 0.4)));
    }
    const plan = new Map<number, Flight>();
    if (!jump) {
      const actor = events.find((e) => 'seat' in e) as { seat: number } | undefined;
      const chip = actor ? this.el.querySelector(`.seat-chip[data-seat="${actor.seat}"]`)?.getBoundingClientRect() : null;
      const stockR = this.el.querySelector('.stock')?.getBoundingClientRect() ?? null;
      [...targets.keys()].forEach((c, i) => {
        if (t.flights.targets.has(c)) return;
        const from = before?.rects.get(String(c)) ?? chip ?? stockR;
        if (from) plan.set(c, { delay: Math.min(i, 8) * 25, arc: 14, from: { ...poseOf(from, 4), w: Math.min(from.width, targets.get(c)!.w * 1.4) } });
      });
    }
    const stackOf = (sel: string, n: number) => { const e = this.el.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left - host.left + r.width / 2, y: r.top - host.top + r.height / 2, w: r.width, n }; };
    t.sync(targets, plan, { stock: stackOf('.stock .card', this.state.hand.stock.length), pile: pileEl ? stackOf('.pile .pile-top', pileN) : null }, this.ctx.settings.animationSpeed, jump);
  }

  /** For the end-to-end tests. */
  sceneScreenOf(c: number) {
    const p = this.t3d?.screenOf(c);
    if (!p) return null;
    const host = this.el.getBoundingClientRect();
    return { x: p.x + host.left, y: p.y + host.top };
  }
  get sceneInfo() { return this.t3d ? { view: '3d', ...this.t3d.debug() } : { view: '2d', reason: this.viewChoice.reason }; }
  settle3d() { this.t3d?.finish(); }

  // ------------------------------------------------------------------ who acts, who sees

  get rules() { return this.state.setup.rules; }
  private get multiHuman() { return this.humans.length >= 2; }
  actor(): number {
    const hd = this.state.hand;
    return hd.phase === 'ask' ? partnerOf(this.rules, hd, hd.turn)! : hd.turn;
  }
  isHuman(seat: number) { return this.state.setup.seats[seat]?.kind === 'human'; }
  /** The local player may act now: a human's turn whose hand is on show. */
  get myMove(): boolean {
    return this.state.phase === 'play' && this.isHuman(this.actor()) && this.shown === this.actor();
  }

  // ------------------------------------------------------------------ the loop

  /** After every change: hand over the device, run the computer, or show the score. */
  private advance() {
    if (this.destroyed) return;
    const s = this.state;
    if (s.phase !== 'play') { this.showScoreSoon(); return; }
    const a = this.actor();
    if (this.isHuman(a)) {
      if (this.shown !== a) {
        if (this.multiHuman) { this.handoff(a); return; }
        this.shown = a;
      }
      this.viewer = a;
      this.render(null);
      return;
    }
    if (this.multiHuman && this.shown !== null) { this.shown = null; this.render(null); }
    this.runAi(a);
  }

  private runAi(seat: number) {
    if (this.aiBusy) return;
    this.aiBusy = true;
    const token = ++this.aiToken;
    const seq = this.state.seq;
    const cfg = this.state.setup.seats[seat];
    const reduced = prefersReducedMotion(this.ctx.settings);
    const view = viewFor(this.state, seat);
    const allowance = presentationAllowance(this.lastEvents, { reduced, speed: this.ctx.settings.animationSpeed });
    void requestMove(view, cfg.level ?? 'standard', cfg.persona).then((move) => {
      const wait = Math.max(allowance, thinkingDelay(cfg.level ?? 'standard', cfg.persona, move) * this.ctx.settings.aiSpeed);
      window.setTimeout(() => {
        this.aiBusy = false;
        if (token !== this.aiToken || this.destroyed || this.state.seq !== seq) return;
        this.submit(this.aiCommand(seat, move), true);
      }, wait);
    });
  }

  private aiCommand(seat: number, m: AiMove): Command {
    return { ...m, seq: this.state.seq, seat } as Command;
  }

  /** Validate and apply a command; on success save, animate, sound and move on. */
  submit(cmd: Command, fromAi = false): boolean {
    const res = apply(this.state, cmd);
    if (!res.ok) {
      if (fromAi) {
        // Should never happen (tests guard it); keep the game moving with the simplest legal action.
        const hd = this.state.hand;
        const seat = this.actor();
        const fb: Command = hd.phase === 'draw' ? { t: 'draw', seq: this.state.seq, seat } : hd.phase === 'ask' ? { t: 'answer', seq: this.state.seq, seat, yes: false } : { t: 'discard', seq: this.state.seq, seat, card: hd.hands[seat][0] };
        const r2 = apply(this.state, fb);
        if (!r2.ok) return false;
        return this.accept(r2.state, r2.events);
      }
      this.error = res.error;
      audio.play('error', this.ctx.settings.captions);
      announce(res.error, true);
      this.render(null);
      return false;
    }
    return this.accept(res.state, res.events);
  }

  private accept(next: MatchState, events: MatchEvent[]): boolean {
    const before = snapshot(this.el);
    const prev = this.state;
    this.state = next;
    this.lastEvents = events;
    this.error = '';
    this.selection.clear();
    this.staging = [];
    this.taking = false;
    saveMatch(next, this.ctx.build.version);
    if (next.phase === 'matchEnd') { recordHand(next); recordMatch(next); clearMatch(); } else if (next.phase === 'handEnd') recordHand(next);
    this.react(prev, events);
    // A human who has finished their turn hides their hand before the device goes round.
    if (this.multiHuman && this.shown !== null && this.actor() !== this.shown) this.shown = null;
    this.render(before, events);
    this.advance();
    return true;
  }

  /** Sounds, captions, announcements and flourishes for the engine's events. */
  private react(prev: MatchState, events: MatchEvent[]) {
    const cap = this.ctx.settings.captions;
    const pan = (seat: number) => { const rel = (seat - this.viewer + this.rules.players) % this.rules.players; return rel === 0 ? 0 : rel === 1 ? -0.8 : rel === this.rules.players - 1 ? 0.8 : 0; };
    const play = (c: Cue, seat?: number, count?: number) => audio.play(c, cap, { pan: seat === undefined ? 0 : pan(seat), count });
    const name = (seat: number) => (this.isHuman(seat) && this.humans.length === 1 ? 'You' : seatName(this.state, seat));
    for (const e of events) {
      switch (e.e) {
        case 'newHand': play('shuffle'); announce(`Hand ${e.handNo}. ${seatName(this.state, e.dealer)} deals.`); break;
        case 'draw': play('draw', e.seat, e.count); if (!this.isHuman(e.seat) || this.humans.length > 1) announce(`${name(e.seat)} drew ${e.count === 1 ? 'a card' : `${e.count} cards`}.`); break;
        case 'take': play('take', e.seat); announce(`${name(e.seat)} took the pile: ${e.count} cards.`); break;
        case 'meld': play('place', e.seat); announce(`${name(e.seat)} melded ${e.placed.map((p) => `${p.cards.length} ${meldLabel(rankOf(p.cards.find((c) => !isWild(c)) ?? p.cards[0]))}`).join(', ')}.`); break;
        case 'canasta': play('canasta', e.seat); this.flourish(e.natural ? 'Canasta natural' : 'Canasta', e.natural ? '+500' : '+300'); break;
        case 'discard': play('discard', e.seat); if (e.froze) play('freeze'); if (e.stop) play('stop'); announce(`${name(e.seat)} discarded the ${cardName(e.card)}${e.froze ? ', freezing the pile' : ''}.`); break;
        case 'redThree': play('redThree', e.seat); break;
        case 'partnership': toast(`${seatName(this.state, e.lone)} plays alone this hand; ${e.partners.map((p) => seatName(this.state, p)).join(' and ')} are partners.`, 3600); announce(`${seatName(this.state, e.lone)} took the pile first and plays alone.`); break;
        case 'ask': announce(`${name(e.seat)} asks: may I go out?`); break;
        case 'answer': toast(`${seatName(this.state, e.seat)}: “${e.yes ? 'Yes, go out.' : 'No, not yet.'}”`); announce(`${seatName(this.state, e.seat)} says ${e.yes ? 'yes' : 'no'}.`); break;
        case 'out': play('out', e.seat); this.flourish(e.concealed ? '¡Afuera! Concealed' : '¡Afuera!', `${name(e.seat)} ${e.concealed ? 'went out concealed' : 'went out'}`); break;
        case 'stockOut': toast('The stock has run out. The hand is over.'); break;
        case 'matchOver': { const humanWon = this.humans.some((s) => lineOfSeat(this.rules, s) === e.winner); if (humanWon || !this.humans.length) play('win'); break; }
        case 'turn': if (this.isHuman(e.seat) && this.humans.length === 1 && prev.hand.turn !== e.seat) play('turn'); break;
        default: break;
      }
    }
  }

  private flourish(title: string, sub: string) {
    const el = h('div', { class: 'flourish', 'aria-hidden': 'true' }, h('strong', {}, title), h('span', {}, sub));
    this.el.append(el);
    void flourishIn(el, this.ctx.settings.animationSpeed).then(() => el.remove());
  }

  // ------------------------------------------------------------------ pass and play

  private handoff(seat: number) {
    this.shown = null;
    this.render(null);
    const asking = this.state.hand.phase === 'ask';
    const ov = h('div', { class: 'overlay handoff', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ho-t' },
      h('div', { class: 'sheet handoff-sheet' },
        h('div', { class: 'handoff-avatar', 'aria-hidden': 'true' }, seatName(this.state, seat).slice(0, 1)),
        h('h2', { id: 'ho-t' }, `Pass the device to ${seatName(this.state, seat)}`),
        h('p', {}, asking ? `${seatName(this.state, this.state.hand.turn)} is asking whether they may go out. Only ${seatName(this.state, seat)} should look.` : `Everyone else, look away: ${seatName(this.state, seat)}’s cards are about to be shown.`),
        h('button', { class: 'btn primary big', onclick: () => { ov.remove(); this.shown = seat; this.viewer = seat; this.render(null); this.focusHand(); } }, 'Tap when ready')));
    this.el.append(ov);
    enterSheet(ov);
    (ov.querySelector('button') as HTMLButtonElement).focus();
  }

  // ------------------------------------------------------------------ score sheet

  private showScoreSoon() {
    const s = this.state;
    if (this.scoreShown === s.handNo) return;
    this.scoreShown = s.handNo;
    const reduced = prefersReducedMotion(this.ctx.settings);
    const wait = Math.min(2200, presentationAllowance(this.lastEvents, { reduced, speed: this.ctx.settings.animationSpeed }) + 500);
    window.setTimeout(() => {
      if (this.destroyed) return;
      const sheet = scoreSheet(this.ctx, s, {
        onNext: () => { sheet.remove(); this.submit({ t: 'nextHand', seq: this.state.seq }); },
        onRematch: () => { sheet.remove(); this.opts.onExit?.(); this.ctx.go('lobby'); },
        onTitle: () => { sheet.remove(); this.ctx.go('title'); },
        viewer: this.viewer,
      });
      this.el.append(sheet);
    }, wait);
  }

  // ------------------------------------------------------------------ player actions

  private toggle(c: CardId) {
    if (!this.myMove) return;
    if (this.selection.has(c)) this.selection.delete(c); else this.selection.add(c);
    audio.play('select', false);
    this.error = '';
    this.render(null);
  }

  drawAction() {
    if (!this.myMove || this.state.hand.phase !== 'draw') return;
    this.submit({ t: 'draw', seq: this.state.seq, seat: this.actor() });
  }

  /** Enter "take the pile" mode, pre-staging the simplest legal way if there is one. */
  takeAction() {
    if (!this.myMove || this.state.hand.phase !== 'draw') return;
    const seat = this.actor();
    const blocked = pileBlocked(this.state.hand, seat);
    if (blocked) { this.error = blocked; audio.play('error', this.ctx.settings.captions); this.render(null); return; }
    const top = pileTop(this.state.hand)!;
    const opts = takeOptionsFor(viewFor(this.state, seat));
    this.taking = true;
    this.selection.clear();
    if (opts.length) this.staging = opts[0].map((g) => ({ ...g, cards: [...g.cards] }));
    else {
      const m = sideMelds(this.rules, this.state.hand, seat).find((x) => x.rank === rankOf(top));
      this.staging = [m ? { rank: rankOf(top), cards: [top], into: m.id } : { rank: rankOf(top), cards: [top] }];
    }
    this.render(null);
  }

  confirmTake() {
    if (!this.taking) return;
    this.submit({ t: 'take', seq: this.state.seq, seat: this.actor(), groups: this.staging });
  }

  /** Put the selected cards into the staging tray (optionally onto a particular meld). */
  stageSelection(into?: number) {
    if (!this.myMove) return;
    const seat = this.actor();
    const sel = [...this.selection];
    const g = groupFromSelection(this.state, seat, sel, into);
    if (!g.group) { this.error = g.why; audio.play('error', this.ctx.settings.captions); this.render(null); return; }
    const grp = g.group;
    // Same rank as something already staged: join it (one meld per rank).
    const same = this.staging.find((x) => x.rank === grp.rank && (x.into === grp.into || (grp.into === undefined && x.into === undefined) || (x.cards.some((c) => c === pileTop(this.state.hand)))));
    if (same) same.cards.push(...grp.cards.filter((c) => !same.cards.includes(c)));
    else this.staging.push(grp);
    this.selection.clear();
    this.error = '';
    audio.play('select', false);
    this.render(null);
  }

  unstage(i: number) {
    const g = this.staging[i];
    const top = pileTop(this.state.hand);
    if (this.taking && g.cards.includes(top!)) {
      // The group holding the top card stays; only the hand cards come back.
      g.cards = [top!];
    } else this.staging.splice(i, 1);
    this.render(null);
  }

  clearStaging() {
    if (this.taking) { this.taking = false; this.staging = []; }
    else this.staging = [];
    this.selection.clear();
    this.error = '';
    this.render(null);
  }

  layDown() {
    if (!this.staging.length || this.taking) return;
    this.submit({ t: 'meld', seq: this.state.seq, seat: this.actor(), groups: this.staging });
  }

  async discardAction() {
    if (!this.myMove || this.selection.size !== 1 || this.staging.length) return;
    const c = [...this.selection][0];
    const seat = this.actor();
    if (this.ctx.settings.confirmDiscard) {
      const note = discardNote(this.state, seat, c);
      const ok = await confirmDialog(this.el, `Discard the ${cardName(c)}?`, note || 'This ends your turn.', 'Discard');
      if (!ok) return;
    }
    this.submit({ t: 'discard', seq: this.state.seq, seat, card: c });
  }

  /** Stage the solver's way out; the discard (if any) is selected after laying down. */
  goOutAction() {
    if (!this.myMove) return;
    const seat = this.actor();
    const plan = goOutPlan(this.state.hand.hands[seat], sideMelds(this.rules, this.state.hand, seat), this.rules.canastasToGoOut);
    if (!plan) return;
    if (!plan.groups.length && plan.discard !== null) { this.submit({ t: 'discard', seq: this.state.seq, seat, card: plan.discard }); return; }
    this.staging = plan.groups.map((g) => ({ ...g, cards: [...g.cards] }));
    this.selection.clear();
    this.render(null);
  }

  askAction() {
    if (!this.myMove) return;
    this.submit({ t: 'ask', seq: this.state.seq, seat: this.actor() });
  }

  answer(yes: boolean) {
    if (!this.myMove || this.state.hand.phase !== 'ask') return;
    this.submit({ t: 'answer', seq: this.state.seq, seat: this.actor(), yes });
  }

  private meldTapped(m: Meld) {
    const seat = this.actor();
    const mine = this.myMove && sideMelds(this.rules, this.state.hand, seat).some((x) => x.id === m.id);
    if (mine && this.selection.size && this.state.hand.phase === 'play') { this.stageSelection(m.id); return; }
    const wild = wildCount(m.cards);
    const left = Math.max(0, CANASTA - m.cards.length);
    toast(`${meldLabel(m.rank)}: ${m.cards.length} cards${wild ? `, ${wild} wild` : ''}. ${isCanasta(m) ? (isNaturalCanasta(m) ? 'A natural canasta (500).' : 'A mixed canasta (300).') : `${left} more for a canasta.`}`);
  }

  // ------------------------------------------------------------------ keyboard

  onKey(e: KeyboardEvent) {
    if (this.el.querySelector('.overlay')) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    const hand = [...this.el.querySelectorAll<HTMLElement>('.hand .card[data-card]')];
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      if (!hand.length) return;
      this.focusIdx = (this.focusIdx + (e.key === 'ArrowRight' ? 1 : -1) + hand.length) % hand.length;
      hand[this.focusIdx].focus();
      e.preventDefault();
    } else if ((e.key === ' ' || e.key === 'Enter') && t?.dataset?.card && t.closest('.hand')) {
      this.toggle(Number(t.dataset.card));
      e.preventDefault();
    } else if (k === 'd') this.drawAction();
    else if (k === 't') this.takeAction();
    else if (k === 'm') this.stageSelection();
    else if (k === 'l') { if (this.taking) this.confirmTake(); else this.layDown(); }
    else if (k === 'x') void this.discardAction();
    else if (e.key === 'Escape') this.clearStaging();
  }

  private focusHand() {
    requestAnimationFrame(() => this.el.querySelector<HTMLElement>('.hand .card[data-card]')?.focus());
  }

  // ------------------------------------------------------------------ rendering

  /** Size cards to the space available (the element, not the window). */
  /**
   * Card sizes for the space available (the element, not the window). A long hand
   * (after taking a big pile) shrinks, then wraps into overlapping rows, so every
   * card keeps its corner index visible and nothing runs off the screen.
   */
  private geometry(n: number) {
    const r = this.el.getBoundingClientRect();
    const W = Math.max(200, r.width - 24), H = Math.max(300, r.height);
    const large = this.ctx.settings.largeCards ? 1.15 : 1;
    const cwMax = Math.min(96, Math.max(48, Math.min(W / 6.2, H / 9.5))) * large;
    const STRIP = 0.34;
    let rows = 1, cw = cwMax, perRow = Math.max(1, n);
    for (rows = 1; rows <= 3; rows++) {
      perRow = Math.max(1, Math.ceil(n / rows));
      cw = Math.min(cwMax, W / (1 + (perRow - 1) * STRIP));
      if (cw >= Math.min(cwMax, 54)) break;
    }
    rows = Math.min(rows, 3);
    const overlap = perRow <= 1 ? 0 : Math.min(cw * (1 - STRIP), Math.max(0, cw - (W - cw) / (perRow - 1)));
    const meldW = Math.min(W > 900 && H > 700 ? 84 : 64, Math.max(34, Math.min(W / 11, H / (W > 900 ? 12 : 15)))) * large;
    return { cw, rows, perRow, overlap, meldW };
  }

  private layout() {
    if (!this.el.getBoundingClientRect().width) return;
    const g = this.geometry(this.el.querySelectorAll('.hand .card').length);
    const st = this.el.style;
    st.setProperty('--cw', `${g.cw.toFixed(1)}px`);
    st.setProperty('--hand-overlap', `${g.overlap.toFixed(1)}px`);
    st.setProperty('--mw', `${g.meldW.toFixed(1)}px`);
  }

  private sideLabel(seats: number[]): string {
    const me = this.humans.length === 1 && seats.includes(this.viewer);
    const names = seats.map((s) => (me && s === this.viewer ? 'You' : seatName(this.state, s)));
    return names.join(' & ');
  }

  /** Sides to show, the viewer's first. */
  private sides(): number[][] {
    const r = this.rules, hd = this.state.hand;
    const seen = new Set<string>();
    const out: number[][] = [];
    for (let k = 0; k < r.players; k++) {
      const seat = (this.viewer + k) % r.players;
      const ss = sideSeats(r, hd, seat);
      const key = [...ss].sort().join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ss);
    }
    return out;
  }

  render(before: Snapshot | null, events: MatchEvent[] = []) {
    if (this.destroyed) return;
    const s = this.state, r = this.rules, hd = s.hand;
    const focused = document.activeElement as HTMLElement | null;
    const focusKey = focused?.dataset?.card ?? focused?.dataset?.action ?? null;
    this.el.dataset.table = this.ctx.settings.table;
    this.el.classList.toggle('four-colour', this.ctx.settings.fourColour);
    const sides = this.sides();
    const myMove = this.myMove;
    const actorSeat = s.phase === 'play' ? this.actor() : -1;

    // Top bar: menu, scores, rules.
    const lines = Array.from({ length: scoreLines(r) }, (_, l) => l);
    const lineSeats = (l: number) => (r.partnership === 'fixed' ? [l, l + 2] : [l]);
    const top = h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Menu', 'data-action': 'menu', onclick: () => this.menu() }, h('span', { class: 'burger', 'aria-hidden': 'true' })),
      h('div', { class: 'scores', role: 'group', 'aria-label': 'Scores' }, lines.map((l) => {
        const mine = lineSeats(l).includes(this.viewer);
        return h('div', { class: 'score-chip' + (mine ? ' mine' : '') },
          h('span', { class: 'who' }, this.sideLabel(lineSeats(l))),
          h('span', { class: 'pts', 'data-line': l }, String(s.scores[l])),
          h('span', { class: 'need', title: 'Minimum count for this side’s first meld' }, `opens ${requirementFor(r, s.scores, lineSeats(l)[0])}`));
      })),
      h('span', { class: 'target', title: 'Play to' }, `to ${r.target.toLocaleString()}`),
      h('button', { class: 'icon-btn', 'aria-label': 'Rules', 'data-action': 'rules', onclick: () => this.ctx.go('rules', { back: 'game', players: r.players }) }, '?'));

    // Other players around the table, clockwise from the viewer's left.
    const others = Array.from({ length: r.players - 1 }, (_, k) => (this.viewer + 1 + k) % r.players);
    const seatsRow = h('div', { class: 'seats' }, others.map((seat) => this.seatChip(seat, actorSeat)));

    // Meld zones: other sides above the centre, the viewer's side below.
    const zone = (ss: number[], mine: boolean) => {
      const slots = sideSlots(r, hd, ss[0]);
      const melds = slots.flatMap((sl) => hd.melds[sl]).sort((a, b) => (isCanasta(b) ? 1 : 0) - (isCanasta(a) ? 1 : 0) || sortKey(a.cards.find((c) => !isWild(c)) ?? 0) - sortKey(b.cards.find((c) => !isWild(c)) ?? 0));
      const reds = ss.flatMap((x) => hd.redThrees[x]);
      const canastas = melds.filter((m) => m.rank !== 3 && isCanasta(m)).length;
      const targetable = mine && myMove && hd.phase === 'play' && this.selection.size > 0;
      return h('section', { class: 'side' + (mine ? ' mine' : ''), 'aria-label': `${this.sideLabel(ss)} melds` },
        h('div', { class: 'side-head' },
          h('span', { class: 'side-name' }, this.sideLabel(ss)),
          r.partnership === 'threeHanded' && hd.lone !== null ? h('span', { class: 'tag' }, ss.includes(hd.lone) ? 'alone' : 'partners') : null,
          h('span', { class: 'canasta-count' + (canastas >= r.canastasToGoOut ? ' ready' : '') }, `${canastas}/${r.canastasToGoOut} ${r.canastasToGoOut === 1 ? 'canasta' : 'canastas'}`),
          reds.length ? h('span', { class: 'reds', 'aria-label': `${reds.length} red ${reds.length === 1 ? 'three' : 'threes'}` }, reds.map((c) => cardEl(c, 'mini red3'))) : null,
          !sideHasMelded(r, hd, ss[0]) ? h('span', { class: 'unopened' }, `needs ${requirementFor(r, s.scores, ss[0])} to open`) : null),
        h('div', { class: 'melds' + (targetable ? ' targetable' : '') }, melds.length ? melds.map((m) => this.meldEl(m, targetable)) : h('span', { class: 'empty' }, 'No melds yet')));
    };
    const them = h('div', { class: 'zone them' }, sides.slice(1).map((ss) => zone(ss, false)));
    const us = h('div', { class: 'zone us' }, zone(sides[0], true));

    // Centre: stock and pile.
    const pileTopCard = pileTop(hd);
    const frozenBy = hd.pileFrozen ? hd.pile.find((c) => isWild(c) || rankOf(c) === 3) ?? null : null;
    const canDraw = myMove && hd.phase === 'draw';
    const stock = h('button', { class: 'stock' + (canDraw ? ' live' : ''), 'data-action': 'draw', 'aria-label': `Stock, ${hd.stock.length} cards${canDraw ? '. Draw' : ''}`, disabled: !canDraw, onclick: () => this.drawAction() },
      hd.stock.length ? backEl('stock-card', hd.stock[hd.stock.length - 1]) : h('div', { class: 'card empty-slot' }),
      h('span', { class: 'count' }, String(hd.stock.length)));
    const stopped = pileTopCard !== null && isBlackThree(pileTopCard);
    const pile = h('button', { class: 'pile' + (canDraw && pileTopCard !== null ? ' live' : '') + (hd.pileFrozen ? ' frozen' : '') + (this.taking ? ' taking' : ''), 'data-action': 'take', disabled: !(canDraw && pileTopCard !== null), 'aria-label': `Discard pile, ${hd.pile.length} cards${pileTopCard !== null ? `, ${cardName(pileTopCard)} on top` : ''}${hd.pileFrozen ? ', frozen' : ''}`, onclick: () => this.takeAction() },
      frozenBy !== null && frozenBy !== pileTopCard ? cardEl(frozenBy, 'crosswise') : null,
      pileTopCard !== null ? cardEl(pileTopCard, 'pile-top') : h('div', { class: 'card empty-slot' }),
      h('span', { class: 'count' }, String(hd.pile.length)));
    const status = h('div', { class: 'status' },
      h('div', { class: 'turn-line' }, s.phase === 'play' ? (myMove ? (hd.phase === 'ask' ? 'Your answer' : 'Your turn') : `${seatName(s, actorSeat)}${this.isHuman(actorSeat) ? '’s turn' : ' is playing'}`) : 'Hand over'),
      (hd.pileFrozen || stopped) ? h('div', { class: 'pile-state' },
        hd.pileFrozen ? h('span', { class: 'chip frozen-chip', title: 'A wild card is in the pile: only a natural pair can take it' }, h('span', { class: 'ico lock', 'aria-hidden': 'true' }), 'Pile frozen') : null,
        stopped ? h('span', { class: 'chip stop-chip', title: 'A black three is on top: the pile cannot be taken this turn' }, h('span', { class: 'ico stop', 'aria-hidden': 'true' }), 'Stopped') : null) : null,
      h('div', { class: 'sub' }, `Hand ${s.handNo} · draw ${r.drawCount} · ${r.canastasToGoOut === 1 ? '1 canasta' : '2 canastas'} to go out`));
    const centre = h('div', { class: 'centre' }, stock, pile, status);

    // Staging tray.
    const staging = this.staging.length ? h('div', { class: 'staging', role: 'group', 'aria-label': 'Cards ready to lay down' },
      this.staging.map((g, i) => h('div', { class: 'staged' },
        h('div', { class: 'staged-cards' }, g.cards.map((c) => cardEl(c, 'mini-hand' + (c === pileTopCard && this.taking ? ' from-pile' : '')))),
        h('span', { class: 'staged-label' }, describeGroup(s, g)),
        h('button', { class: 'x-btn', 'aria-label': 'Put these back', onclick: () => this.unstage(i) }, '×')))) : null;

    // Guidance.
    const hnt = s.phase === 'play' ? hint(s, this.shown ?? this.viewer, { selection: [...this.selection], staging: this.staging, taking: this.taking, full: this.ctx.settings.guidance }) : { text: '', tone: 'info' as const };
    const coach = this.opts.coach?.step(this) ?? null;
    const guide = h('div', { class: `guide tone-${this.error ? 'warn' : coach ? 'coach' : hnt.tone}`, role: 'status', 'aria-live': 'polite' },
      coach ? h('span', { class: 'coach-tag' }, 'Tutorial') : null,
      this.error || coach?.text || hnt.text);

    const actions = h('div', { class: 'actions' }, this.actionButtons());
    const handEl = this.handEl();

    const screen = h('div', { class: 'table-grid' }, top, seatsRow, them, centre, us, staging, guide, actions, handEl);
    const old = this.el.querySelector(':scope > .table-grid');
    if (old) old.replaceWith(screen); else this.el.append(screen);
    if (coach?.target) this.el.querySelector(coach.target)?.classList.add('coach-target');
    for (const c of this.opts.coach?.highlight?.() ?? []) this.el.querySelector(`.hand .card[data-card="${c}"]`)?.classList.add('coach-card');
    this.layout();
    this.sync3d(before, events);
    if (before) {
      const origin = (id: string) => this.originFor(Number(id), events, before);
      void flip(this.el, before, { reduced: prefersReducedMotion(this.ctx.settings), speed: this.ctx.settings.animationSpeed }, origin);
      if (events.some((e) => e.e === 'handScored')) this.el.querySelectorAll('.score-chip .pts').forEach((p) => pop(p));
    }
    if (focusKey) {
      const again = this.el.querySelector<HTMLElement>(`[data-card="${focusKey}"], [data-action="${focusKey}"]`);
      if (again && !(again as HTMLButtonElement).disabled) again.focus({ preventScroll: true });
    }
  }

  /** Where a card that was not on screen before should appear to come from. */
  private originFor(c: CardId, events: MatchEvent[], before: Snapshot): DOMRect | null {
    const stockR = before.rects.get('stock') ?? this.el.querySelector('.stock')?.getBoundingClientRect() ?? null;
    for (const e of events) {
      if ((e.e === 'discard' && e.card === c) || (e.e === 'meld' && e.placed.some((p) => p.cards.includes(c)))) {
        const chip = this.el.querySelector(`.seat-chip[data-seat="${e.seat}"]`);
        return chip ? chip.getBoundingClientRect() : stockR;
      }
      if (e.e === 'take') { const p = this.el.querySelector('.pile'); return p ? p.getBoundingClientRect() : null; }
    }
    return stockR;
  }

  private seatChip(seat: number, actorSeat: number) {
    const s = this.state, hd = s.hand, cfg = s.setup.seats[seat];
    const persona = cfg.kind === 'ai' ? personaById(cfg.persona) : null;
    const partner = this.rules.partnership === 'fixed' ? seat % 2 === this.viewer % 2 : this.rules.partnership === 'threeHanded' && hd.lone !== null ? sideSeats(this.rules, hd, seat).includes(this.viewer) : false;
    const n = hd.hands[seat].length;
    return h('div', { class: 'seat-chip' + (seat === actorSeat ? ' active' : '') + (partner ? ' partner' : ''), 'data-seat': seat, style: persona ? { '--seat': persona.color } as unknown as Partial<CSSStyleDeclaration> : {} },
      h('span', { class: `avatar pat-${persona?.pattern ?? (seat % 8)}`, 'aria-hidden': 'true' }, persona?.initials ?? cfg.name.slice(0, 1)),
      h('span', { class: 'seat-text' },
        h('span', { class: 'seat-name' }, cfg.name),
        h('span', { class: 'seat-cards', 'aria-label': `${n} cards in hand` }, h('span', { class: 'ico cards', 'aria-hidden': 'true' }), String(n), hd.redThrees[seat].length ? h('span', { class: 'seat-reds', 'aria-label': `${hd.redThrees[seat].length} red threes` }, ` · 3♦×${hd.redThrees[seat].length}`) : null)),
      partner ? h('span', { class: 'tag' }, 'partner') : null,
      seat === s.dealer ? h('span', { class: 'tag dealer', title: 'Dealer' }, 'D') : null,
      seat === actorSeat && cfg.kind === 'ai' ? h('span', { class: 'thinking', 'aria-label': 'thinking' }, h('i'), h('i'), h('i')) : null);
  }

  private meldEl(m: Meld, targetable: boolean) {
    const can = m.rank !== 3 && isCanasta(m);
    const wild = wildCount(m.cards);
    const nat = can && isNaturalCanasta(m);
    // Naturals first, wild cards last, like a real meld.
    const cards = [...m.cards].sort((a, b) => (isWild(a) ? 1 : 0) - (isWild(b) ? 1 : 0) || a - b);
    return h('button', { class: 'meld' + (can ? ` canasta ${nat ? 'natural' : 'mixed'}` : '') + (targetable ? ' target' : ''), 'data-meld': m.id,
      'aria-label': `${meldLabel(m.rank)}: ${m.cards.length} cards${wild ? `, ${wild} wild` : ''}${can ? (nat ? ', natural canasta' : ', mixed canasta') : ''}`,
      onclick: () => this.meldTapped(m) },
      h('div', { class: 'fan', style: { '--n': String(cards.length) } as unknown as Partial<CSSStyleDeclaration> }, cards.map((c) => cardEl(c, 'meld-card'))),
      can ? h('span', { class: 'ribbon' }, h('span', { class: `ico ${nat ? 'sun' : 'half'}`, 'aria-hidden': 'true' }), nat ? 'Natural' : 'Mixed') : h('span', { class: 'progress', 'aria-hidden': 'true' }, `${m.cards.length}/7`));
  }

  private handEl() {
    const s = this.state, seat = this.shown;
    const r = this.rules;
    if (seat === null) {
      const who = this.multiHuman ? 'Cards are hidden until the next player takes the device.' : '';
      return h('div', { class: 'hand hidden-hand', 'aria-label': who }, who ? h('p', { class: 'hidden-note' }, who) : null);
    }
    const hand = this.ctx.settings.sortWildsLast ? sortHand(s.hand.hands[seat]) : [...s.hand.hands[seat]].sort((a, b) => a - b);
    const staged = new Set(this.staging.flatMap((g) => g.cards));
    const live = this.myMove;
    const opened = sideHasMelded(r, s.hand, seat);
    const shownCards = hand.filter((c) => !staged.has(c));
    const geo = this.geometry(shownCards.length);
    const els = shownCards.map((c) => {
        const el = cardEl(c, (this.selection.has(c) ? 'selected' : '') + (opened ? '' : ''));
        el.tabIndex = 0;
        el.setAttribute('role', 'option');
        el.setAttribute('aria-selected', String(this.selection.has(c)));
        el.addEventListener('click', () => this.toggle(c));
        return el;
      });
    const rows: HTMLElement[] = [];
    for (let i = 0; i < els.length; i += geo.perRow) rows.push(h('div', { class: 'hand-row' }, els.slice(i, i + geo.perRow)));
    return h('div', { class: 'hand' + (live ? ' live' : '') + (rows.length > 1 ? ' rows' : ''), role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': `Your hand, ${hand.length} cards` }, rows);
  }

  private actionButtons(): HTMLElement[] {
    const s = this.state, hd = s.hand;
    if (s.phase !== 'play') return [];
    const B = (label: string, action: string, on: () => void, o: { primary?: boolean; disabled?: boolean; title?: string } = {}) =>
      h('button', { class: 'btn' + (o.primary ? ' primary' : ''), 'data-action': action, disabled: !!o.disabled, title: o.title, onclick: on }, label);
    if (!this.myMove) {
      if (this.multiHuman && this.shown === null && this.isHuman(this.actor())) return [B(`Show ${seatName(s, this.actor())}’s cards`, 'reveal', () => this.handoff(this.actor()), { primary: true })];
      return [];
    }
    const seat = this.actor();
    if (hd.phase === 'ask') return [B('Yes, go out', 'yes', () => this.answer(true), { primary: true }), B('No, not yet', 'no', () => this.answer(false))];
    if (hd.phase === 'draw') {
      if (this.taking) {
        const c = checkGroups(this.rules, hd, s.scores, seat, this.staging, pileTop(hd));
        return [
          B('Add selected', 'stage', () => this.stageSelection(), { disabled: this.selection.size === 0 }),
          B('Take the pile', 'confirm-take', () => this.confirmTake(), { primary: true, disabled: !c.ok }),
          B('Cancel', 'cancel', () => this.clearStaging()),
        ];
      }
      const empty = hd.stock.length === 0;
      return [
        B(empty ? 'End the hand' : this.rules.drawCount === 2 ? 'Draw 2' : 'Draw', 'draw', () => this.drawAction(), { primary: true }),
        B('Take the pile', 'take', () => this.takeAction(), { disabled: pileTop(hd) === null }),
      ];
    }
    const out: HTMLElement[] = [];
    if (this.staging.length) {
      const c = checkGroups(this.rules, hd, s.scores, seat, this.staging, null);
      out.push(B(c.ok ? `Lay down · ${c.points}` : 'Lay down', 'lay', () => this.layDown(), { primary: true, disabled: !c.ok }));
      out.push(B('Add selected', 'stage', () => this.stageSelection(), { disabled: this.selection.size === 0 }));
      out.push(B('Clear', 'clear', () => this.clearStaging()));
      return out;
    }
    const plan = goOutPlan(hd.hands[seat], sideMelds(this.rules, hd, seat), this.rules.canastasToGoOut);
    out.push(B(this.selection.size > 1 ? 'Meld these' : 'Meld', 'stage', () => this.stageSelection(), { disabled: this.selection.size === 0 || (this.selection.size === 1 && !this.canAddSingle()) }));
    out.push(B(this.selection.size === 1 ? `Discard ${cardShort([...this.selection][0])}` : 'Discard', 'discard', () => void this.discardAction(), { primary: this.selection.size === 1, disabled: this.selection.size !== 1 }));
    if (plan && hd.askAnswer !== 'no') out.push(B('Go out', 'go-out', () => this.goOutAction(), { primary: this.selection.size === 0 }));
    const partner = partnerOf(this.rules, hd, seat);
    if (plan && partner !== null && !hd.asked && !hd.meldedSinceDraw) out.push(B('Ask partner', 'ask', () => this.askAction()));
    return out;
  }

  private canAddSingle(): boolean {
    const g = groupFromSelection(this.state, this.actor(), [...this.selection]);
    return !!g.group && g.group.into !== undefined;
  }

  // ------------------------------------------------------------------ menu

  private menu() {
    const close = () => { ov.remove(); };
    const ov = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'menu-t', onkeydown: ((e: KeyboardEvent) => { if (e.key === 'Escape') close(); }) as EventListener },
      h('div', { class: 'sheet menu-sheet' },
        h('h2', { id: 'menu-t' }, 'Menu'),
        h('button', { class: 'btn primary', onclick: close }, 'Back to the table'),
        h('button', { class: 'btn', onclick: () => { close(); this.ctx.go('rules', { back: 'game', players: this.rules.players }); } }, 'Rules'),
        h('button', { class: 'btn', onclick: () => { close(); this.ctx.go('settings', { back: 'game' }); } }, 'Settings'),
        h('label', { class: 'toggle' }, (() => { const i = h('input', { type: 'checkbox' }); i.checked = this.ctx.settings.guidance; i.addEventListener('change', () => { this.ctx.settings.guidance = i.checked; this.ctx.saveSettings(); this.render(null); }); return i; })(), ' Move guidance'),
        h('button', { class: 'btn', onclick: async () => { const ok = await confirmDialog(ov, 'Leave this match?', 'It is saved: you can resume it from the title screen.', 'Leave'); if (ok) { close(); this.ctx.go('title'); } } }, 'Leave the table')));
    this.el.append(ov);
    enterSheet(ov);
    (ov.querySelector('button') as HTMLButtonElement).focus();
  }

  applyView() {
    this.render(null);
    this.chooseTable();
    this.t3d?.setSurface(this.ctx.settings.table);
    this.t3d?.setBack(backUrl());
    this.t3d?.refreshFaces();
    this.sync3d(null, [], true);
  }
}
