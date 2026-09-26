/**
 * Builds the card faces and backs in public/cards/.
 *
 *   node tools/build-cards.ts
 *
 * Faces: Adrian Kennard's public-domain (CC0) SVG cards, as packaged by
 * letele/playing-cards (art/source/kennard/, licence alongside). For each card we
 * keep his centre artwork (pips and court figures), scale it to 80% and drop his
 * small corner indices; we draw a new paper ground and much larger corner indices
 * (his own rank glyphs and suit symbols, enlarged), because Canasta melds are fanned
 * tightly and only the corner of most cards is ever visible. A four-colour variant
 * (Diamonds blue, Clubs green, only the index and pip symbols) is written as *-4c.svg.
 *
 * Jokers and the three backs are original artwork drawn here. Details and licences:
 * docs/ASSETS.md.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

const SRC = 'art/source/kennard';
const OUT = 'public/cards';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const RED = '#c42a2a';
const INK = '#1c1a26';
const PAPER = '#fffaf0';
const EDGE = '#c9b99a';
const FOUR = { D: '#1f5fbf', C: '#1f7a3a' } as const;

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['C', 'D', 'H', 'S'] as const;

function frame(inner: string, defs = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="-120 -168 240 336" width="240" height="336">
<defs>${defs}</defs>
<rect x="-119" y="-167" width="238" height="334" rx="14" ry="14" fill="${PAPER}" stroke="${EDGE}" stroke-width="2"/>
${inner}
</svg>
`;
}

function face(suit: string, rank: string, fourColour: boolean): string {
  let svg = readFileSync(`${SRC}/${suit}-${rank}.svg`, 'utf8');
  svg = svg.replace(/<\?xml[^>]*>/, '');
  const defs = /<defs>([\s\S]*?)<\/defs>/.exec(svg)?.[1] ?? '';
  let body = svg.replace(/^[\s\S]*?<\/defs>/, '').replace(/<\/svg>\s*$/, '');
  // Drop Kennard's card background and his small corner indices (rank glyph and small suit).
  body = body.replace(/<rect width="239" height="335"[^>]*>(<\/rect>)?/, '');
  body = body.replace(/<use xlink:href="#V[^"]*" height="32" width="32" x="-114.4" y="-156"(\/>|><\/use>)/g, '');
  body = body.replace(/<use xlink:href="#S[^"]*" height="26.769" width="26.769" x="-111.784" y="-119"(\/>|><\/use>)/g, '');
  // Court-card corner pips sit beside the figure; keep them out of the enlarged index's way.
  body = body.replace(/<use xlink:href="#S[^"]*" height="55.68" width="55.68" x="36.088" y="-132.16"(\/>|><\/use>)/g, '');
  let d = defs.replace(/"red"/g, `"${RED}"`).replace(/"black"/g, `"${INK}"`);
  if (fourColour && (suit === 'D' || suit === 'C')) {
    const col = FOUR[suit];
    d = d.replace(/<symbol id="([SV])([CDHS])[^"]*"[\s\S]*?<\/symbol>/g, (m) => m.replace(new RegExp(`"(${RED}|${INK})"`, 'g'), `"${col}"`));
  }
  // Kennard symbol ids: "VHK" rank glyph, "SHK" suit symbol (tens are "T").
  const vId = /<symbol id="(V[^"]+)"/.exec(defs)![1];
  const sId = /<symbol id="(S[^"]+)"/.exec(defs)?.[1];
  const index = `<use xlink:href="#${vId}" x="-117" y="-163" width="48" height="48"/>` + (sId ? `<use xlink:href="#${sId}" x="-113" y="-113" width="40" height="40"/>` : '');
  const inner = `<g transform="scale(0.8)">${body}</g>\n<g>${index}</g>\n<g transform="rotate(180)">${index}</g>`;
  return frame(inner, d);
}

// ---------------------------------------------------------------- jokers: "El Sol"

function sunRays(n: number, r0: number, r1: number, col: string, wavy: string): string {
  let out = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    if (i % 2 === 0) {
      const w = 0.12;
      const p = (ang: number, r: number) => `${(Math.cos(ang) * r).toFixed(1)},${(Math.sin(ang) * r).toFixed(1)}`;
      out += `<polygon points="${p(a - w, r0)} ${p(a, r1)} ${p(a + w, r0)}" fill="${col}"/>`;
    } else {
      // A wavy ray, as on the Sol de Mayo.
      const pts: string[] = [];
      for (let k = 0; k <= 12; k++) {
        const t = k / 12;
        const r = r0 + (r1 - 8 - r0) * t;
        const off = Math.sin(t * Math.PI * 3) * 5 * (1 - t * 0.5);
        pts.push(`${(ca * r - sa * off).toFixed(1)},${(sa * r + ca * off).toFixed(1)}`);
      }
      out += `<polyline points="${pts.join(' ')}" fill="none" stroke="${wavy}" stroke-width="5" stroke-linecap="round"/>`;
    }
  }
  return out;
}

function joker(red: boolean): string {
  const ray = red ? '#e0a21a' : '#e0a21a';
  const wavy = red ? '#c8561b' : '#3b4f9a';
  const ink = red ? RED : '#2c3a7a';
  const ground = red ? '#fff3dc' : '#eef1fb';
  const defs = `<radialGradient id="sun" cx="0" cy="0" r="1" gradientUnits="objectBoundingBox" fx="0.4" fy="0.35"><stop offset="0" stop-color="#ffe89a"/><stop offset="0.7" stop-color="#f2b92a"/><stop offset="1" stop-color="#d98b12"/></radialGradient>`;
  const letters = 'JOKER'.split('').map((ch, i) => `<text x="-100" y="${-138 + i * 24}" font-family="Georgia, 'Times New Roman', serif" font-size="24" font-weight="700" text-anchor="middle" fill="${ink}">${ch}</text>`).join('');
  const face = `
<rect x="-86" y="-120" width="172" height="240" rx="10" fill="${ground}" stroke="${ink}" stroke-opacity=".35" stroke-width="2"/>
<g transform="translate(0,0)">
  ${sunRays(16, 44, 82, ray, wavy)}
  <circle r="44" fill="url(#sun)" stroke="#b86f0e" stroke-width="2.5"/>
  <path d="M-20 -10 q6 -7 12 0 M8 -10 q6 -7 12 0" fill="none" stroke="#7a4309" stroke-width="3.2" stroke-linecap="round"/>
  <circle cx="-14" cy="-3" r="3.6" fill="#7a4309"/><circle cx="14" cy="-3" r="3.6" fill="#7a4309"/>
  <path d="M0 -2 q-4 10 0 14 q3 1 5 -1" fill="none" stroke="#9b5a10" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M-15 19 q15 12 30 0" fill="none" stroke="#7a4309" stroke-width="3.4" stroke-linecap="round"/>
</g>
<text x="0" y="112" font-family="Georgia, 'Times New Roman', serif" font-size="17" font-style="italic" text-anchor="middle" fill="${ink}" fill-opacity=".8">comodín</text>`;
  const corner = `<g>${letters}</g>`;
  return frame(`${face}\n${corner}\n<g transform="rotate(180)">${corner}</g>`, defs);
}

// ---------------------------------------------------------------- backs

function back(kind: 'canasta' | 'rio' | 'baldosa'): string {
  let defs = '', fill = '';
  if (kind === 'canasta') {
    // Woven basket: interlaced strips, as the game's name ("basket") suggests.
    defs = `<pattern id="p" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
<rect width="24" height="24" fill="#8f3b1e"/>
<rect x="1" y="1" width="10" height="22" rx="3" fill="#d9822b"/><rect x="13" y="1" width="10" height="22" rx="3" fill="#b8581f"/>
<rect x="1" y="13" width="22" height="10" rx="3" fill="#e9a441"/><rect x="1" y="1" width="10" height="10" rx="3" fill="#d9822b"/>
<rect x="13" y="1" width="10" height="10" rx="3" fill="#c96a24"/>
</pattern>`;
    fill = '#f3e3c3';
  } else if (kind === 'rio') {
    defs = `<pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="#fdfdfb"/><rect y="0" width="40" height="20" fill="#2f78c4"/></pattern>`;
    fill = '#eaf2fb';
  } else {
    // Montevideo hydraulic floor tiles (baldosas): a quatrefoil repeat.
    defs = `<pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse">
<rect width="40" height="40" fill="#1f5f63"/>
<circle cx="20" cy="20" r="12" fill="#f2e6cc"/><circle cx="20" cy="20" r="6" fill="#d9573b"/>
<path d="M0 0 h8 a12 12 0 0 1 -8 8 z M40 0 v8 a12 12 0 0 1 -8 -8 z M0 40 v-8 a12 12 0 0 1 8 8 z M40 40 h-8 a12 12 0 0 1 8 -8 z" fill="#e2a33b"/>
<path d="M20 2 l3 6 h-6 z M20 38 l3 -6 h-6 z M2 20 l6 3 v-6 z M38 20 l-6 3 v-6 z" fill="#f2e6cc"/>
</pattern>`;
    fill = '#efe4cd';
  }
  const sun = `<g>${sunRays(16, 22, 40, '#f2b92a', '#f2b92a')}<circle r="22" fill="#f6c343" stroke="#b86f0e" stroke-width="2"/><circle r="15" fill="none" stroke="#b86f0e" stroke-width="1.5" stroke-opacity=".6"/></g>`;
  const medal = kind === 'baldosa' ? `<circle r="46" fill="#f2e6cc" stroke="#1f5f63" stroke-width="4"/>${sun}` : `<circle r="48" fill="${fill}" stroke="#7a3a1a" stroke-width="3" stroke-opacity=".5"/>${sun}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-120 -168 240 336" width="240" height="336">
<defs>${defs}</defs>
<rect x="-119" y="-167" width="238" height="334" rx="14" fill="${fill}" stroke="${EDGE}" stroke-width="2"/>
<rect x="-104" y="-152" width="208" height="304" rx="8" fill="url(#p)"/>
<rect x="-104" y="-152" width="208" height="304" rx="8" fill="none" stroke="${fill}" stroke-width="3"/>
${medal}
</svg>
`;
}

let count = 0;
for (const s of SUITS) for (const r of RANKS) {
  writeFileSync(`${OUT}/${s}${r}.svg`, face(s, r, false));
  if (s === 'D' || s === 'C') writeFileSync(`${OUT}/${s}${r}-4c.svg`, face(s, r, true));
  count++;
}
writeFileSync(`${OUT}/J1.svg`, joker(true));
writeFileSync(`${OUT}/J2.svg`, joker(false));
for (const k of ['canasta', 'rio', 'baldosa'] as const) writeFileSync(`${OUT}/back-${k}.svg`, back(k));
console.log(`${count} faces, 2 jokers, 3 backs → ${OUT} (${readdirSync(OUT).length} files)`);
