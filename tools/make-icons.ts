/**
 * App icons from one original SVG: three fanned cards on a woven terracotta
 * ground, the front one the "El Sol" joker.
 *   node tools/make-icons.ts
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';

function rays(n: number, r0: number, r1: number) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, w = 0.13;
    const p = (ang: number, r: number) => `${(Math.cos(ang) * r).toFixed(1)},${(Math.sin(ang) * r).toFixed(1)}`;
    s += `<polygon points="${p(a - w, r0)} ${p(a, r1)} ${p(a + w, r0)}" fill="#f2b92a"/>`;
  }
  return s;
}
const card = (rot: number, inner: string) => `<g transform="rotate(${rot} 256 420)"><rect x="166" y="120" width="180" height="252" rx="18" fill="#fffaf0" stroke="#c9b99a" stroke-width="4"/>${inner}</g>`;
export function iconSvg(maskable = false) {
  const pad = maskable ? 60 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${512 + pad * 2} ${512 + pad * 2}">
<defs><pattern id="w" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="24" height="24" fill="#9c3b25"/><rect x="1" y="1" width="10" height="22" rx="3" fill="#b24a2c"/><rect x="13" y="1" width="10" height="10" rx="3" fill="#c25a33"/></pattern></defs>
<rect x="${-pad}" y="${-pad}" width="${512 + pad * 2}" height="${512 + pad * 2}" rx="${maskable ? 0 : 112}" fill="url(#w)"/>
<rect x="${-pad}" y="${440}" width="${512 + pad * 2}" height="10" fill="#e9a441"/><rect x="${-pad}" y="${452}" width="${512 + pad * 2}" height="6" fill="#2f78c4"/>
${card(-22, '<text x="186" y="178" font-family="Georgia, serif" font-size="56" font-weight="700" fill="#1c1a26">K</text>')}
${card(22, '<text x="186" y="178" font-family="Georgia, serif" font-size="56" font-weight="700" fill="#c42a2a">K</text>')}
${card(0, `<g transform="translate(256 250)">${rays(16, 40, 72)}<circle r="40" fill="#f6c343" stroke="#b86f0e" stroke-width="4"/><circle cx="-13" cy="-6" r="5" fill="#7a4309"/><circle cx="13" cy="-6" r="5" fill="#7a4309"/><path d="M-15 14 q15 12 30 0" fill="none" stroke="#7a4309" stroke-width="5" stroke-linecap="round"/></g>`)}
</svg>`;
}
mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon.svg', iconSvg());
const out: [string, number, boolean][] = [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true]];
for (const [f, size, mask] of out) await sharp(Buffer.from(iconSvg(mask)), { density: 300 }).resize(size, size).png({ compressionLevel: 9, palette: true }).toFile(`public/icons/${f}`);
console.log('icons written');
