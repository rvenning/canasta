import { enterSheet } from './anim.ts';
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener | Partial<CSSStyleDeclaration>>;
type Child = Node | string | null | undefined | false | Child[];

/** Tiny hyperscript helper: h('button', { class: 'btn', onclick }, 'Play'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'style' && typeof v === 'object') { for (const [p, val] of Object.entries(v)) { if (p.startsWith('--')) el.style.setProperty(p, String(val)); else (el.style as unknown as Record<string, unknown>)[p] = val; } }
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
}

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null;

let liveTimer = 0;
/** Announce to screen readers. */
export function announce(text: string, assertive = false) {
  const el = document.getElementById(assertive ? 'live-assertive' : 'live');
  if (!el) return;
  el.textContent = '';
  window.clearTimeout(liveTimer);
  liveTimer = window.setTimeout(() => { el.textContent = text; }, 30);
}

let toastTimer = 0;
export function toast(text: string, ms = 2400) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('on');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('on'), ms);
}

let capTimer = 0;
export function caption(text: string) {
  const el = document.getElementById('caption');
  if (!el) return;
  el.textContent = text;
  el.classList.add('on');
  window.clearTimeout(capTimer);
  capTimer = window.setTimeout(() => el.classList.remove('on'), 1800);
}

/** A modal confirm built from our own sheet, keyboard and screen-reader friendly. */
export function confirmDialog(root: HTMLElement, title: string, body: string, okLabel: string, cancelLabel = 'Cancel'): Promise<boolean> {
  return new Promise((resolve) => {
    const prev = document.activeElement as HTMLElement | null;
    const close = (v: boolean) => { ov.remove(); prev?.focus?.(); resolve(v); };
    const ok = h('button', { class: 'btn primary', onclick: () => close(true) }, okLabel);
    const ov = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-t', onkeydown: ((e: KeyboardEvent) => { if (e.key === 'Escape') close(false); }) as EventListener },
      h('div', { class: 'sheet' }, h('h2', { id: 'dlg-t' }, title), h('p', {}, body), h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => close(false) }, cancelLabel), ok)));
    root.appendChild(ov);
    enterSheet(ov);
    ok.focus();
  });
}
