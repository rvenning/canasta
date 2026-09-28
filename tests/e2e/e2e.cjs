// End-to-end walkthrough with trusted touch input in headless Edge.
//   node tests/e2e/e2e.cjs [baseUrl] [--only name]
// Each scenario starts from a fresh browser profile. Exits non-zero on the first failure.
const { driver, wait } = require('./driver.cjs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const BASE = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:8137/';
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const FIX = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'make-fixtures.ts')], { encoding: 'utf8' }));

/** Fresh device that has seen the tutorial, optionally with a saved match and settings. */
async function prime(d, { fixture, settings } = {}) {
  await d.goto(BASE);
  await d.js((fx, st) => {
    localStorage.clear();
    localStorage.setItem('canasta:settings', JSON.stringify({ tutorialSeen: true, aiSpeed: 0.1, animationSpeed: 3, ...(st || {}) }));
    if (fx) localStorage.setItem('canasta:match', JSON.stringify(fx));
  }, fixture || null, settings || null);
  await d.goto(BASE);
}

/** What the human should do next, read from the page (never from hidden state). */
const situation = () => {
  const s = window.__canasta && window.__canasta.state;
  if (!s) return 'none';
  if (document.querySelector('.score-overlay')) return 'score';
  if (document.querySelector('.handoff')) return 'handoff';
  if (document.querySelector('.overlay')) return 'overlay';
  const on = (a) => { const b = document.querySelector(`.actions [data-action="${a}"]`); return !!b && !b.disabled; };
  if (on('yes')) return 'ask';
  if (on('confirm-take')) return 'confirm-take';
  if (on('draw')) return 'draw';
  if (on('lay')) return 'lay';
  if (document.querySelector('.actions [data-action="lay"]')) return 'clear';
  if (on('go-out')) return 'go-out';
  if (document.querySelector('.hand.live .card[data-card]')) return 'discard';
  if (document.querySelector('.actions [data-action="reveal"]')) return 'reveal';
  return 'wait';
};

/** Tap a hand card on its visible strip (cards overlap), checking that point really hits it. */
async function tapCard(d, id) {
  const p = await d.js((id) => {
    const e = document.querySelector('.hand .card[data-card="' + id + '"]');
    if (!e) return null;
    const r = e.getBoundingClientRect();
    const next = e.nextElementSibling ? e.nextElementSibling.getBoundingClientRect().left : r.right;
    const x = r.left + Math.max(4, (Math.min(next, r.right) - r.left) / 2), y = r.top + r.height * 0.18;
    const t = document.elementFromPoint(x, y);
    return t && (t === e || e.contains(t)) ? { x, y } : null;
  }, id);
  if (!p) throw new Error('hand card ' + id + ' cannot be tapped');
  await d.tapAt(p);
}

/** One human action through the interface. Returns the situation it acted on. */
async function humanStep(d) {
  const st = await d.js(situation);
  switch (st) {
    case 'handoff': await d.tapText('Tap when ready'); break;
    case 'reveal': await d.tap('.actions [data-action="reveal"]'); break;
    case 'ask': await d.tap('.actions [data-action="yes"]'); break;
    case 'confirm-take': await d.tap('.actions [data-action="confirm-take"]'); break;
    case 'draw': await d.tap('.actions [data-action="draw"]'); break;
    case 'lay': await d.tap('.actions [data-action="lay"]'); break;
    case 'clear': await d.tap('.actions [data-action="clear"]'); break;
    case 'go-out': await d.tap('.actions [data-action="go-out"]'); break;
    case 'discard': {
      // A plain card: not wild, preferring the first card of the hand.
      const id = await d.js(() => { const c = [...document.querySelectorAll('.hand.live .card[data-card]')]; const pick = c.find((e) => !e.classList.contains('wild')) || c[0]; return pick.dataset.card; });
      await tapCard(d, id);
      await d.tap('.actions [data-action="discard"]');
      break;
    }
    default: await wait(200);
  }
  return st;
}

async function playHand(d, maxSteps = 600) {
  for (let i = 0; i < maxSteps; i++) {
    const st = await humanStep(d);
    if (st === 'score') return true;
  }
  return false;
}

const scenarios = {
  async tutorial(d) {
    await d.goto(BASE);
    await d.js(() => localStorage.clear());
    await d.goto(BASE);
    d.ok('first launch opens the tutorial', await d.waitFor(() => /Welcome to Canasta/.test(document.body.textContent)));
    await d.shot('01-tutorial-slide');
    await d.tapText('Next'); await d.tapText('Next');
    await d.tapText('Deal a practice hand');
    d.ok('practice hand dealt with the coach', await d.waitFor(() => !!document.querySelector('.guide.tone-coach')));
    d.ok('guidance defaults on', await d.js(() => window.__canasta.ctx.settings.guidance === true));
    await d.shot('02-tutorial-draw');
    await d.tap('.actions [data-action="draw"]');
    // The coach names the cards to select and highlights them.
    const ranks = await d.js(() => [...document.querySelectorAll('.hand .card.coach-card')].map((e) => e.dataset.card));
    d.ok('the coach points at an opening meld on the first turn', ranks.length === 3, JSON.stringify(ranks));
    d.ok('and says which cards', await d.js(() => /Tap your /.test(document.querySelector('.guide').textContent)));
    for (const c of ranks) await tapCard(d, c);
    await d.tap('.actions [data-action="stage"]');
    await d.shot('03-tutorial-staged');
    await d.tap('.actions [data-action="lay"]');
    d.ok('the meld is on the table', await d.waitFor(() => window.__canasta.state.hand.melds[0].length === 1));
    await humanStep(d);
    d.ok('turn passed to the computer', await d.waitFor(() => window.__canasta.state.hand.turn === 1 || window.__canasta.state.hand.turn === 0 && window.__canasta.state.seq > 3, 5000));
    await d.shot('04-tutorial-after');
  },

  async fourPlayerMatchEnd(d) {
    await prime(d, { fixture: FIX.nearEnd4 });
    await d.tapText('Continue match');
    d.ok('table shows 11 cards', await d.waitFor(() => document.querySelectorAll('.hand .card').length >= 11));
    await d.shot('10-table-4p');
    d.ok('hand plays to its end through the interface', await playHand(d));
    await d.shot('11-score-4p');
    const s = await d.state();
    d.ok('match over at 5,000', s.phase === 'matchEnd', JSON.stringify(s.scores));
    d.ok('match-over sheet offers a new match', await d.js(() => /New match/.test(document.querySelector('.score-overlay').textContent)));
    await d.tapText('New match');
    d.ok('back to the lobby', await d.waitFor(() => /New match/.test(document.querySelector('h1')?.textContent || '')));
    d.ok('no page errors', d.logs.length === 0, d.logs.join(' | '));
  },

  async twoPlayerMatchEnd(d) {
    await prime(d, { fixture: FIX.nearEnd2 });
    await d.tapText('Continue match');
    d.ok('two-player hand of 15', await d.waitFor(() => document.querySelectorAll('.hand .card').length >= 15));
    d.ok('two-player hand completes', await playHand(d));
    const s = await d.state();
    d.ok('two-player match over', s.phase === 'matchEnd', JSON.stringify(s.scores));
    await d.shot('12-score-2p');
  },

  async threePlayerMatchEnd(d) {
    await prime(d, { fixture: FIX.nearEnd3 });
    await d.tapText('Continue match');
    d.ok('three-player hand of 13', await d.waitFor(() => document.querySelectorAll('.hand .card').length >= 13));
    await d.shot('13-table-3p');
    d.ok('three-player hand completes', await playHand(d));
    const s = await d.state();
    d.ok('three-player match over at 7,500', s.phase === 'matchEnd', JSON.stringify(s.scores));
    d.ok('score sheet explains the lone hand or separate scoring', await d.js(() => /alone|separately|scored alone/.test(document.querySelector('.score-overlay').textContent)));
    await d.shot('14-score-3p');
  },

  async watchAllAi(d) {
    await prime(d, { fixture: FIX.allAi4 });
    await d.tapText('Continue match');
    d.ok('an all-computer match runs to its end', await d.waitFor(() => !!document.querySelector('.score-overlay'), 120000));
    d.ok('no page errors', d.logs.length === 0, d.logs.join(' | '));
  },

  async passAndPlayPrivacy(d) {
    await prime(d, { fixture: FIX.pass2 });
    await d.tapText('Continue match');
    const first = (await d.state()).turn;
    d.ok('handoff screen before any cards show', await d.waitFor(() => !!document.querySelector('.handoff')));
    d.ok('no hand cards in the page behind it', await d.js(() => document.querySelectorAll('.hand .card[data-card]').length === 0));
    await d.shot('20-handoff');
    await d.tapText('Tap when ready');
    const shown = await d.js(() => [...document.querySelectorAll('.hand .card[data-card]')].map((e) => Number(e.dataset.card)));
    const s = await d.state();
    d.ok('the player on turn sees exactly their own hand', JSON.stringify([...shown].sort()) === JSON.stringify([...s.hands[first]].sort()));
    await d.tap('.actions [data-action="draw"]');
    await humanStep(d);
    d.ok('after the turn the hand is hidden and the device goes round', await d.waitFor(() => !!document.querySelector('.handoff')));
    const leak = await d.js((prev) => [...document.querySelectorAll('.card[data-card]')].some((e) => { const s = window.__canasta.state; return s.hand.hands[prev].includes(Number(e.dataset.card)); }), first);
    d.ok('the previous player’s cards are not in the page', !leak);
    await d.tapText('Tap when ready');
    d.ok('second player sees their own hand', await d.waitFor(() => document.querySelectorAll('.hand .card[data-card]').length > 0));
  },

  async partnershipAsk(d) {
    await prime(d, { fixture: FIX.pass4 });
    await d.tapText('Continue match');
    for (let i = 0; i < 40; i++) {
      const st = await humanStep(d);
      if (st === 'score') break;
    }
    d.ok('pass-and-play with computer seats keeps running', (await d.state()).seq > 10);
  },

  async saveAndResume(d) {
    await prime(d, { fixture: FIX.nearEnd4 });
    await d.tapText('Continue match');
    await d.waitFor(() => !!document.querySelector('.actions [data-action="draw"]:not(:disabled)'), 20000);
    await d.tap('.actions [data-action="draw"]');
    const before = await d.state();
    await d.goto(BASE);
    await d.tapText('Continue match');
    await d.waitFor(() => !!window.__canasta.state);
    const after = await d.state();
    d.ok('the match resumes exactly where it was', before.seq === after.seq && JSON.stringify(before.hands) === JSON.stringify(after.hands));
    d.ok('the player can carry on (discard)', (await humanStep(d)) === 'discard');
  },

  async guidanceAndSettings(d) {
    await prime(d, { fixture: FIX.nearEnd4, settings: { guidance: false, sfxOn: false } });
    await d.tapText('Continue match');
    await d.waitFor(() => !!document.querySelector('.actions [data-action="draw"]:not(:disabled)'), 20000);
    d.ok('guidance off: only the essentials', await d.js(() => /^Your turn: draw/.test(document.querySelector('.guide').textContent)));
    await d.tap('.actions [data-action="draw"]');
    d.ok('sound off: cues are muted', await d.js(() => window.__canasta.audio.log.length === 0 || window.__canasta.audio.log.every((e) => e.via === 'muted')));
    await d.tap('.topbar [data-action="menu"]');
    await d.tapText('Settings');
    d.ok('settings open from the table', await d.waitFor(() => /Settings/.test(document.querySelector('h1')?.textContent || '')));
    await d.shot('30-settings');
    await d.tapText('← Back');
    d.ok('back at the same table', await d.waitFor(() => !!document.querySelector('.table-screen')));
  },

  async reducedMotion(d) {
    await prime(d, { fixture: FIX.nearEnd4, settings: { reducedMotion: 'on' } });
    await d.tapText('Continue match');
    d.ok('reduced-motion class applied', await d.js(() => document.documentElement.classList.contains('reduced')));
    await d.waitFor(() => !!document.querySelector('.actions [data-action="draw"]:not(:disabled)'), 20000);
    await d.tap('.actions [data-action="draw"]');
    d.ok('the move lands without long animation', await d.waitFor(() => window.__canasta.domAnimations === 0, 1500));
  },

  async keyboardOnly(d) {
    await prime(d, { fixture: FIX.nearEnd2 });
    await d.tapText('Continue match');
    await d.waitFor(() => !!document.querySelector('.actions [data-action="draw"]:not(:disabled)'), 20000);
    const n0 = await d.js(() => document.querySelectorAll('.hand .card').length);
    await d.key('d');
    d.ok('D draws', await d.waitFor((n) => document.querySelectorAll('.hand .card').length === n + 2, 3000, n0));
    await d.js(() => document.querySelector('.hand .card').focus());
    await d.key('ArrowRight');
    await d.key(' ');
    d.ok('arrow keys and space select a card', await d.js(() => document.querySelectorAll('.hand .card.selected').length === 1));
    await d.key('x');
    d.ok('X discards it', await d.waitFor(() => window.__canasta.state.hand.turn !== window.__canasta.viewer, 3000));
  },

  async table3d(d) {
    await prime(d, { fixture: FIX.nearEnd4 });
    await d.goto(BASE + '?view=3d');
    await d.tapText('Continue match');
    d.ok('the 3D table is chosen', await d.waitFor(() => window.__canasta.scene && window.__canasta.scene.view === '3d', 15000));
    for (let i = 0; i < 12; i++) await humanStep(d);
    await d.js(() => window.__canasta.settle());
    await wait(500);
    const al = await d.js(() => [...document.querySelectorAll('.pile .pile-top, .meld .card[data-card]')].map((e) => { const r = e.getBoundingClientRect(); const p = window.__canasta.sceneScreenOf(Number(e.dataset.card)); return p ? Math.hypot(p.x - (r.left + r.width / 2), p.y - (r.top + r.height / 2)) : 999; }));
    d.ok('every 3D table card sits under its DOM card', al.length > 0 && Math.max(...al) < 4, JSON.stringify(al.map((x) => +x.toFixed(1))));
    d.ok('nothing left in flight or out of place', await d.js(() => window.__canasta.scene.moving === 0 && window.__canasta.scene.mismatches.length === 0));
    await d.shot('70-3d-table');
    d.ok('no page errors', d.logs.length === 0, d.logs.join(' | '));
  },

  async fallback2d(d) {
    await prime(d, { fixture: FIX.nearEnd4, settings: { reducedMotion: 'on' } });
    await d.goto(BASE + '?view=3d');
    await d.tapText('Continue match');
    await wait(800);
    d.ok('reduced motion keeps the flat table even when 3D is asked for', await d.js(() => window.__canasta.scene.view === '2d'));
    await prime(d, { fixture: FIX.nearEnd4 });
    await d.tapText('Continue match');
    await wait(800);
    d.ok('software graphics (headless) choose the flat table automatically', await d.js(() => window.__canasta.scene.view === '2d' && /software|WebGL/.test(window.__canasta.scene.reason)), await d.js(() => JSON.stringify(window.__canasta.scene)));
  },

  async offline(d) {
    if (/:8137/.test(BASE)) { console.log('  (skipped: needs the production preview, e.g. http://localhost:8138/)'); return; }
    await prime(d, { fixture: FIX.nearEnd4 });
    d.ok('the service worker has cached the game', await d.waitFor(async () => { const k = await caches.keys(); if (!k.length) return false; const c = await caches.open(k[0]); return (await c.keys()).length > 50; }, 20000));
    await d.send('Network.enable');
    await d.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await d.goto(BASE);
    await d.tapText('Continue match');
    d.ok('offline: the table loads with cards', await d.waitFor(() => document.querySelectorAll('.hand .card img').length > 5 && [...document.querySelectorAll('.hand .card img')].every((i) => i.complete && i.naturalWidth > 0), 10000));
    await humanStep(d); await humanStep(d);
    d.ok('offline: play continues', (await d.state()).seq > 0);
    await d.shot('80-offline');
  },

  async deviceMatrix(d) {
    const sizes = [['iphone-se', 320, 568], ['iphone-15', 393, 852], ['iphone-land', 852, 393], ['pixel-7', 412, 915], ['ipad-port', 820, 1180], ['ipad-land', 1180, 820], ['laptop', 1366, 768], ['desktop', 1680, 1050], ['wide-desktop', 2560, 1392], ['wide-desktop-2p', 2560, 1392]];
    for (const [name, w, h] of sizes) {
      await d.resize(w, h, 2);
      await prime(d, { fixture: name === 'wide-desktop-2p' ? FIX.nearEnd2 : FIX.nearEnd4 });
      await d.tapText('Continue match');
      await d.waitFor(() => !!document.querySelector('.actions [data-action="draw"]:not(:disabled)'), 20000);
      await d.tap('.actions [data-action="draw"]');
      await wait(600);
      const m = await d.js(() => {
        const vw = innerWidth, vh = innerHeight;
        const inside = (e) => { const r = e.getBoundingClientRect(); return r.left >= -1 && r.right <= vw + 1 && r.top >= -1 && r.bottom <= vh + 1; };
        const hand = [...document.querySelectorAll('.hand .card')];
        const handBox = document.querySelector('.hand').getBoundingClientRect();
        const inHand = hand.every((e) => { const r = e.getBoundingClientRect(); return r.left >= handBox.left - 1 && r.right <= handBox.right + 1; });
        const btns = [...document.querySelectorAll('.actions .btn')];
        return { overflow: document.documentElement.scrollWidth > vw + 1, hand: hand.every(inside), inHand, btns: btns.every(inside) && btns.every((b) => b.getBoundingClientRect().height >= 40), pile: inside(document.querySelector('.pile')), stock: inside(document.querySelector('.stock')), cw: getComputedStyle(document.querySelector('.hand .card')).width };
      });
      d.ok(`${name}: hand inside table, no sideways scroll, controls on screen`, !m.overflow && m.hand && m.inHand && m.btns && m.pile && m.stock, JSON.stringify(m));
      await d.shot(`60-${name}`);
    }
  },

  async wideMeldLayout(d) {
    const fixture = JSON.parse(JSON.stringify(FIX.nearEnd2));
    const cardsOfRank = (rank, count) => Array.from({ length: 108 }, (_, id) => id)
      .filter((id) => id % 54 < 52 && (id % 54) % 13 + 1 === rank).slice(0, count);
    fixture.state.hand.melds[1] = [
      { id: 901, rank: 8, cards: cardsOfRank(8, 7), owner: 1, slot: 1 },
      { id: 902, rank: 11, cards: cardsOfRank(11, 4), owner: 1, slot: 1 },
      { id: 903, rank: 12, cards: cardsOfRank(12, 3), owner: 1, slot: 1 },
    ];
    for (const [width, height] of [[1680, 1050], [1920, 1080], [2560, 1392]]) {
      await d.resize(width, height, 2);
      await prime(d, { fixture });
      await d.tapText('Continue match');
      const m = await d.js(() => {
        const table = document.querySelector('.table-grid').getBoundingClientRect();
        const zone = document.querySelector('.zone.them');
        return { tableWidth: table.width, tableHeight: table.height, meldCount: zone.querySelectorAll('.meld').length, scroll: zone.scrollHeight - zone.clientHeight };
      });
      d.ok(`${width}x${height}: three melds fit without scrolling`, m.tableWidth >= Math.min(width - 32, 1800) - 1 && m.tableHeight >= Math.min(height - 32, 1220) - 1 && m.meldCount === 3 && m.scroll <= 1, JSON.stringify(m));
      await d.shot(`61-wide-melds-${width}`);
    }
  },
};

(async () => {
  let failed = 0;
  for (const [name, fn] of Object.entries(scenarios)) {
    if (only && name !== only) continue;
    const d = await (require('./driver.cjs').driver)({ base: BASE });
    console.log(`\n# ${name}`);
    try { await fn(d); } catch (e) { failed++; console.log('✗', e.message); try { await d.shot('FAIL-' + name); } catch { /* */ } }
    await d.close();
  }
  console.log(failed ? `\n${failed} scenario(s) failed` : '\nall scenarios passed');
  process.exit(failed ? 1 : 0);
})();
