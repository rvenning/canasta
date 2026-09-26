// Trusted-input driver for headless Edge. Every tap is Input.dispatchTouchEvent
// (or a real mouse event), so a control that cannot be hit fails here exactly as
// it would under a finger. No button handlers are ever called directly.
const { launch, wait } = require('../../tools/lib/cdp.cjs');
const fs = require('node:fs');
const path = require('node:path');

async function driver({ width = 390, height = 844, dpr = 2, base = 'http://localhost:8137/', outDir = path.join(__dirname, 'out') } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const b = await launch({ width, height, dpr });
  const { send, evaluate } = b;
  const steps = [];
  const ok = (name, cond, extra) => {
    steps.push(`${cond ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`);
    console.log(steps[steps.length - 1]);
    if (!cond) throw new Error('FAILED: ' + name + (extra ? ' ' + extra : ''));
  };
  const js = (fn, ...args) => evaluate(`(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`);
  const rectOf = (sel) => js((sel) => {
    const e = typeof sel === 'string' ? document.querySelector(sel) : null;
    if (!e) return null;
    e.scrollIntoView({ block: 'nearest' });
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }, sel);
  const touch = (pts, type) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 6, radiusY: 6, force: 1 })) });
  const tapAt = async (p, hold = 60) => { await touch([p], 'touchStart'); await wait(hold); await touch([], 'touchEnd'); await wait(200); };
  /** Tap the centre of an element; verifies the element is actually what gets hit. */
  const tap = async (sel, opts = {}) => {
    let r = null;
    for (let i = 0; i < (opts.tries ?? 40) && !r; i++) { r = await rectOf(sel); if (!r) await wait(150); }
    if (!r) throw new Error('no element ' + sel);
    const hit = await js((sel, x, y) => { const e = document.querySelector(sel); const t = document.elementFromPoint(x, y); return !!(e && t && (e === t || e.contains(t))); }, sel, r.x, r.y);
    if (!hit) throw new Error(`element ${sel} is covered at its centre`);
    await tapAt(r, opts.hold);
    return r;
  };
  /** Tap a button by its visible text. */
  const tapText = async (text, scope = 'button', tries = 40) => {
    for (let i = 0; i < tries; i++) {
      const id = await js((text, scope) => {
        const b = [...document.querySelectorAll(scope)].find((e) => e.textContent.trim().startsWith(text) && e.getClientRects().length > 0);
        if (!b) return null;
        if (!b.id) b.id = 'e2e-' + Math.random().toString(36).slice(2);
        return b.id;
      }, text, scope);
      if (id) return tap('#' + id);
      await wait(150);
    }
    throw new Error('no button with text ' + text);
  };
  const click = async (sel) => { const r = await rectOf(sel); if (!r) throw new Error('no ' + sel); for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 }); await wait(200); };
  const key = async (k, code = k) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: { Enter: 13, Escape: 27, Tab: 9, ' ': 32, ArrowRight: 39, ArrowLeft: 37 }[k] ?? k.charCodeAt(0), text: k.length === 1 ? k : k === 'Enter' ? '\r' : undefined }); await wait(80); };
  const waitFor = async (fn, ms = 15000, ...args) => {
    const t0 = Date.now();
    for (;;) {
      const v = await js(fn, ...args);
      if (v) return v;
      if (Date.now() - t0 > ms) return v;
      await wait(120);
    }
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  const goto = async (url = base) => { await send('Page.navigate', { url }); await wait(300); await waitFor(() => document.readyState === 'complete' && !!document.querySelector('.screen')); await wait(300); };
  const resize = async (w, h, d = dpr) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: d, mobile: true }); await wait(400); };
  const state = () => js(() => { const s = window.__canasta && window.__canasta.state; return s ? { phase: s.phase, hphase: s.hand.phase, turn: s.hand.turn, handNo: s.handNo, scores: s.scores, hands: s.hand.hands, seq: s.seq, stock: s.hand.stock.length, pile: s.hand.pile.length, seats: s.setup.seats, lone: s.hand.lone } : null; });
  const noOverflow = () => js(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1);
  return { ...b, ok, tap, tapAt, tapText, click, key, waitFor, shot, goto, resize, state, js, wait, steps, noOverflow };
}

module.exports = { driver, wait };
