/**
 * Card images: static SVG files built by tools/build-cards.ts into public/cards/,
 * shown as plain <img> elements so they stay crisp at any size, and cached by the
 * service worker for offline play.
 */
import { cardName, faceKey, isWild, packOf, suitOf, type CardId } from '../rules/cards.ts';
import type { BackId } from '../persistence/settings.ts';

const BASE = import.meta.env.BASE_URL + 'cards/';
let fourColour = false;
let backs: [BackId, BackId] = ['canasta', 'rio'];

export function setCardOptions(o: { fourColour: boolean; back: BackId }) {
  fourColour = o.fourColour;
  // The two packs have different backs, as at a real Canasta table.
  const second: Record<BackId, BackId> = { canasta: 'baldosa', rio: 'canasta', baldosa: 'rio' };
  backs = [o.back, second[o.back]];
}

export function faceUrl(c: CardId): string {
  const s = suitOf(c);
  const four = fourColour && (s === 'D' || s === 'C');
  return BASE + faceKey(c) + (four ? '-4c' : '') + '.svg';
}

export const backUrl = (c: CardId | null = null) => BASE + 'back-' + (c === null ? backs[0] : backs[packOf(c)]) + '.svg';
export const backUrlFor = (b: BackId) => BASE + 'back-' + b + '.svg';

/** A face-up card element. `data-card` is its identity for animation and tests. */
export function cardEl(c: CardId, extra = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'card' + (isWild(c) ? ' wild' : '') + (extra ? ' ' + extra : '');
  d.dataset.card = String(c);
  d.setAttribute('aria-label', cardName(c) + (isWild(c) ? ', wild' : ''));
  const img = document.createElement('img');
  img.src = faceUrl(c);
  img.alt = '';
  img.draggable = false;
  img.decoding = 'async';
  d.append(img);
  return d;
}

export function backEl(extra = '', c: CardId | null = null): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'card back' + (extra ? ' ' + extra : '');
  const img = document.createElement('img');
  img.src = backUrl(c);
  img.alt = '';
  img.draggable = false;
  d.append(img);
  return d;
}

/** Warm the image cache so the first deal does not flicker. */
export function preloadDeck() {
  for (let c = 0; c < 54; c++) { const i = new Image(); i.src = faceUrl(c); }
  for (const b of backs) { const i = new Image(); i.src = backUrlFor(b); }
}
