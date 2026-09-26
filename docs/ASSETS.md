# Assets and licensing

Everything is bundled and cached for offline play; nothing is hotlinked.

## Card faces

| Files | Source | Licence | Modifications | Retrieved |
|---|---|---|---|---|
| `public/cards/{C,D,H,S}{A,2…10,J,Q,K}.svg` (52 faces) and `*-4c.svg` (Diamonds and Clubs, four-colour) | Adrian Kennard's SVG playing cards (<https://www.me.uk/cards/>), as packaged by letele/playing-cards (<https://github.com/letele/playing-cards>, `assets/*.svg`); sources kept in `art/source/kennard/` | CC0 1.0 (licence text: `art/source/kennard/LICENSE.txt`) | `tools/build-cards.ts`: removed his card background and small corner indices, scaled his centre art (pips, court figures) to 80 %, drew a new cream paper ground and much larger corner indices from his own rank glyphs and suit symbols (for tightly fanned melds); reds deepened to #c42a2a; four-colour variant recolours only the Diamonds and Clubs index and pip symbols | 2026-09-27 |

Checked: all 52 standard faces present; the source's two jokers and two backs
were not used (replaced by the originals below). Readability was checked at the
smallest meld size in the game (34 px wide): the enlarged indices stay legible.
The Ace of Spades keeps Kennard's small "www.me.uk/cards" credit line.

## Original artwork (this project, MIT)

- Jokers `public/cards/J1.svg`, `J2.svg`: the "El Sol" comodín, after the Sol de
  Mayo (sun face with straight and wavy rays), drawn in `tools/build-cards.ts`.
- Card backs `back-canasta.svg` (woven basket), `back-rio.svg` (Río de la Plata
  stripes with a sun medallion), `back-baldosa.svg` (Montevideo hydraulic floor
  tiles), drawn in `tools/build-cards.ts`.
- App icons `public/icons/*` (`tools/make-icons.ts`).
- Table cloths: CSS patterns (2D) and a canvas-painted weave and tile texture
  (3D, `src/presentation/table3d.ts`).

## Recorded sounds

Built by `tools/build-audio.ts` (ffmpeg-static): decoded, trimmed, levelled per
category, short fades, packed into one Howler sprite (`public/audio/sprite.webm`
Opus 64 kb/s, `sprite.mp3` 96 kb/s; map in `src/presentation/soundSprite.json`).

| Clips | Purpose | Source | Licence | Modifications | Retrieved |
|---|---|---|---|---|---|
| `place1–4`, `slide1–4`, `shove1–4`, `select`, `shuffle` | Melding and discarding, drawing, taking the pile, selecting, the deal | Kenney "Casino Audio" (<https://kenney.nl/assets/casino-audio>): `card-place-1..4`, `card-slide-1,2,3,5`, `card-shove-1..4`, `card-fan-1`, `card-shuffle` (licence: `art/source/audio/casino/License.txt`) | CC0 1.0 | Trimmed, levelled (−20 to −27 dBFS RMS), 25 ms fade-out; shuffle cut to 2.2 s | 2026-09-27 |
| Percussion inside `turn`, `stop`, `freeze`, `redThree`, `canasta`, `out`, `win`, and the `rhythm` loop | Candombe-style cues | Sam Gossner, VSCO 2 Community Edition, on Freesound: Conga HitN (<https://freesound.org/people/sgossner/sounds/373406/>, 373407–373411), Conga Tap (373412, 373413), Claves (373400, 373402, 373404), Cowbell (373416, 373418); menegass, Bongo1–3 (<https://freesound.org/people/menegass/sounds/99751/>, 99752, 99753) | CC0 1.0 (each page checked: "creativecommons.org/publicdomain/zero/1.0") | Freesound HQ previews (kept in `art/source/audio/vsco/`), trimmed and levelled, then **sequenced** into phrases at 112 bpm in the manner of Uruguayan candombe: the madera (stick) pattern on claves, the chico's off-beat taps and low accents; `rhythm` is a 4-bar seamless loop folded at the bar line, levelled to −30 dBFS | 2026-09-27 |

Interface cues fall back to the WebAudio synthesiser from Scopa (`src/presentation/synth.ts`, original) until the recordings have loaded or if they cannot load.

Credits are not required for CC0 but are shown in the game (Credits screen).

## Fonts

Fraunces (display) and Figtree (interface), SIL Open Font License 1.1, bundled
through `@fontsource-variable/*`; licence texts in `licenses/`.

## Libraries

three.js, Motion and Howler.js: MIT.
