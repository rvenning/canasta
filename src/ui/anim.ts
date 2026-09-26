/**
 * DOM motion, coordinated by Motion (motion.dev).
 *
 * The DOM is rebuilt from game state first, so correctness never waits on
 * animation; then each card springs from where it was to where it now is
 * (FLIP). Interrupting is free: a re-render measures cards where they currently
 * appear, so a card caught mid-flight continues from there. Reduced motion
 * swaps travel for short fades. In the 3D view only the player's own hand is
 * animated here; table cards are painted by the 3D table.
 */
import { animate, stagger, type AnimationPlaybackControls } from 'motion';

export interface Snapshot { rects: Map<string, DOMRect>; }

export function snapshot(root: HTMLElement): Snapshot {
  const rects = new Map<string, DOMRect>();
  root.querySelectorAll<HTMLElement>('[data-card]').forEach((el) => rects.set(el.dataset.card as string, el.getBoundingClientRect()));
  return { rects };
}

/**
 * Motion interpolates transform lists function by function; a keyframe of 'none' is read as a
 * zero matrix, which collapsed the handoff sheet to nothing. Always animate to an explicit identity
 * written with the same functions as the other keyframe.
 */
const IDENTITY = 'translate(0px, 0px) scale(1) rotate(0deg)';

export interface AnimCtx { reduced: boolean; speed: number }

const running = new Set<AnimationPlaybackControls>();
const track = (c: AnimationPlaybackControls, cleanup?: () => void) => {
  running.add(c);
  return c.finished.catch(() => undefined).finally(() => { running.delete(c); cleanup?.(); });
};

/** Springs used across the table, so every card moves with the same weight. */
export const SPRING = { card: { type: 'spring', visualDuration: 0.42, bounce: 0.16 }, ui: { type: 'spring', visualDuration: 0.32, bounce: 0.22 } } as const;

export function flip(root: HTMLElement, before: Snapshot, ctx: AnimCtx, origin?: (id: string) => DOMRect | null, scope = '[data-card]'): Promise<void> {
  const anims: Promise<unknown>[] = [];
  const els = [...root.querySelectorAll<HTMLElement>(scope)];
  let newcomer = 0;
  for (const el of els) {
    const id = el.dataset.card as string;
    const now = el.getBoundingClientRect();
    const known = before.rects.has(id);
    const was = before.rects.get(id) ?? origin?.(id) ?? null;
    if (!was || now.width === 0) continue;
    const dx = was.left - now.left, dy = was.top - now.top;
    const s = was.width / Math.max(1, now.width);
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(s - 1) < 0.01) continue;
    let c: AnimationPlaybackControls;
    if (ctx.reduced) c = animate(el, { opacity: [0.35, 1] }, { duration: 0.14 / ctx.speed, ease: 'easeOut' });
    else {
      // Newly dealt cards leave the deck one after another; moved cards go together.
      const delay = known ? 0 : Math.min(newcomer++ * 0.055, 0.4) / ctx.speed;
      const angle = Math.max(-7, Math.min(7, dx / 35));
      c = animate(el, { transform: [`translate(${dx}px, ${dy}px) scale(${s}) rotate(${angle}deg)`, IDENTITY] }, { ...SPRING.card, visualDuration: SPRING.card.visualDuration / ctx.speed, delay });
    }
    // Motion leaves the last keyframe inline; clear it so class-based lifts (.selected, .take) apply again.
    anims.push(track(c, () => { if (!ctx.reduced) el.style.removeProperty('transform'); }));
  }
  return Promise.all(anims).then(() => undefined);
}

/** Fly copies of captured cards (from their last rects) in a shallow arc to the capturing seat. */
export function gather(images: { src: string; rect: DOMRect }[], target: DOMRect | null, ctx: AnimCtx, delay = 0): Promise<void> {
  if (!target || images.length === 0) return Promise.resolve();
  const anims: Promise<unknown>[] = [];
  images.forEach(({ src, rect }, i) => {
    const g = document.createElement('div');
    g.className = 'fly';
    Object.assign(g.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    const img = document.createElement('img');
    img.src = src;
    g.appendChild(img);
    document.body.appendChild(g);
    const tx = target.left + target.width / 2 - (rect.left + rect.width / 2);
    const ty = target.top + target.height / 2 - (rect.top + rect.height / 2);
    const arc = Math.max(12, Math.min(34, Math.abs(tx) * 0.08 + Math.abs(ty) * 0.04));
    const twist = (i % 2 ? -1 : 1) * (4 + i * 1.4);
    const c = ctx.reduced
      ? animate(g, { opacity: [1, 0] }, { duration: 0.22 / ctx.speed, delay: delay / 1000 / ctx.speed })
      : animate(g, {
        transform: [IDENTITY, `translate(${tx * 0.18}px, ${ty * 0.16 - arc}px) scale(1.065) rotate(${twist}deg)`, `translate(${tx * 0.72}px, ${ty * 0.68 - arc * 0.35}px) scale(.72) rotate(${twist * 0.35}deg)`, `translate(${tx}px, ${ty}px) scale(.28) rotate(0deg)`],
        opacity: [1, 1, 0.92, 0.08],
      }, { duration: 0.58 / ctx.speed, times: [0, 0.28, 0.72, 1], ease: [0.35, 0.02, 0.24, 1], delay: (delay / 1000 + i * 0.034) / ctx.speed });
    anims.push(track(c, () => g.remove()));
  });
  return Promise.all(anims).then(() => undefined);
}

/** Finish every running animation now (e.g. when the app is backgrounded). */
export function finishAll() {
  for (const c of running) { try { c.complete(); } catch { /* */ } }
  document.querySelectorAll('.fly').forEach((n) => n.remove());
}

/** How many DOM animations are running; the e2e suite waits for zero. */
export const runningCount = () => running.size;

// ------------------------------------------------------------------ UI transitions

const reducedNow = () => document.documentElement.classList.contains('reduced');

/** A dialog sheet rising into place over a fading veil. */
export function enterSheet(overlay: HTMLElement, sheet: HTMLElement | null = overlay.querySelector('.sheet')) {
  if (reducedNow()) { void track(animate(overlay, { opacity: [0, 1] }, { duration: 0.12 })); return; }
  void track(animate(overlay, { opacity: [0, 1] }, { duration: 0.2, ease: 'easeOut' }));
  if (sheet) void track(animate(sheet, { opacity: [0, 1], transform: ['translate(0px, 18px) scale(.965) rotate(0deg)', IDENTITY] }, SPRING.ui));
}

/** Rows of a score sheet arriving one after another. */
export function staggerIn(els: Element[], gap = 0.07) {
  if (!els.length) return;
  if (reducedNow()) { void track(animate(els, { opacity: [0, 1] }, { duration: 0.12 })); return; }
  void track(animate(els, { opacity: [0, 1], transform: ['translate(0px, 8px) scale(1) rotate(0deg)', IDENTITY] }, { ...SPRING.ui, delay: stagger(gap) }));
}

/** A small emphasis for a number that just changed. */
export function pop(el: Element) {
  if (reducedNow()) return;
  void track(animate(el, { transform: ['scale(1)', 'scale(1.18)', 'scale(1)'] }, { duration: 0.36, ease: 'easeOut' }));
}

/** The "Canasta!" flourish: the word springs in, rings widen, and it lifts away. */
export function flourishIn(el: HTMLElement, speed: number): Promise<void> {
  if (reducedNow()) return track(animate(el, { opacity: [0, 1, 1, 0] }, { duration: 1.1 / speed, times: [0, 0.15, 0.8, 1] })).then(() => undefined);
  return track(animate(el, {
    opacity: [0, 1, 1, 0],
    transform: ['translate(-50%, -40%) scale(.85)', 'translate(-50%, -50%) scale(1)', 'translate(-50%, -52%) scale(1)', 'translate(-50%, -60%) scale(1.03)'],
  }, { duration: 1.3 / speed, times: [0, 0.2, 0.75, 1], ease: 'easeOut' })).then(() => undefined);
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
