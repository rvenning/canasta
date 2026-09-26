# Canasta

Classic Canasta — the card game from Montevideo — for two, three or four
players, in the browser. Pass one device around the table, play the computer at
three levels, or mix the two. Works offline once opened, and installs on a phone.

**Play it:** <https://rvenning.github.io/canasta/>

- **Classic Canasta** as standardised around 1950 (Pagat), with the proper rules
  for each player count: 2 players (15 cards, draw two, two canastas to go out,
  to 5,000), 3 players (13 cards, draw two; the first to take the pile plays
  alone against a temporary partnership; own scores, to 7,500) and 4 players
  (two partnerships, 11 cards, to 5,000). Every choice where tables differ is in
  [`docs/RULES.md`](docs/RULES.md).
- Initial meld minimums, natural and mixed canastas, the wild-card limits, red
  and black threes, frozen and stopped piles, taking the whole pile, going out
  (and concealed), “may I go out?”, the end of the stock and full scoring — all
  enforced, and every refused move is explained in plain words.
- Each seat is a person at this device or a computer player: **Relaxed**,
  **Standard** or **Expert** (the same levels as Scopa). Pass-and-play hides each
  hand behind a “pass the device” screen.
- A short first-game tutorial on the real engine, and move guidance that says
  what you can do and why something is not allowed — on by default, switchable
  off, with a rules reference for each player count.
- A colourful Río de la Plata table: a woven cloth (or Montevideo night, or a
  tiled patio), card backs after a woven basket, the river's stripes and
  hydraulic floor tiles, and a sun-faced joker. A lamp-lit **3D table**
  (three.js) paints under the ordinary table where the device can carry it;
  **Motion** springs the cards; **Howler.js** plays recorded card sounds and
  short candombe phrases (congas and claves) for canastas and going out, plus an
  optional quiet table rhythm.
- Readable large card indices (the melds are fanned tightly), an optional
  four-colour deck, larger cards, keyboard play, screen-reader announcements,
  captions for sounds, reduced motion, separate volumes.
- No accounts, servers, tracking, ads or purchases.

## Development

Requires Node 22.6+ (24 recommended).

```bash
npm install
npm run dev          # http://localhost:8137
npm test             # rules, engine, AI, presentation and integration tests (Vitest)
npm run typecheck
npm run sim          # the AI balance report: every level pairing in every mode
npm run e2e          # trusted-touch walkthrough in headless Edge against the dev server
npm run build && npm run preview                          # http://localhost:8138
npm run e2e -- http://localhost:8138/ --only offline      # offline play from the service worker
```

Asset tools: `npm run cards` (card faces and backs), `npm run audio` (sprite and
rhythm loop), `npm run icons`. `node tools/tune.ts <level> <opponent>` searches
AI weights by self-play.

Pushing to `master` runs the tests and deploys `dist/` to GitHub Pages.

## Architecture

```text
src/
  rules/        the 108-card pack, card values, per-mode configuration, meld legality, seeded RNG
  engine/       hand state machine (deal, draw, take, meld, discard, go out, stock end), match,
                scoring, the go-out solver, PublicView (what one seat may know), replay
  ai/           Relaxed / Standard heuristics, Expert (determinized Monte Carlo), personas,
                simulation, Web Worker client
  ui/           title, lobby, table, staging tray, guidance, tutorial, score sheet, settings
  presentation/ card images, 3D table and flights, view choice and fallback, pacing, audio
  persistence/  versioned saves (state + command log), settings, statistics
  content/      the rules reference
tests/          engine, ai, presentation, integration, e2e
tools/          build-cards, build-audio, make-icons, simulate, tune, shot (headless screenshots)
docs/           RULES.md, ASSETS.md, AI_REPORT.md
```

- **The engine is pure and serialisable.** `apply(state, command)` validates and
  returns a new state and events, or a plain-language error. Commands carry a
  sequence number; the command log replays the match exactly.
- **One set of rules checks** (`checkGroups`, `pileBlocked`, `mustTakePile`,
  `goOutPlan`) serves the table, the guidance, the tutorial, the computer players
  and the tests.
- **The computer sees only a PublicView**, which has no field for other hands or
  the stock. Every AI move is checked by the engine before it is played.
- **Presentation only reacts**: pacing is computed from events, the 3D table
  places each card under its DOM box, and the DOM remains what you tap.

## Licensing

Code, jokers, card backs, icons and sequencing: MIT. Card faces: Adrian
Kennard's cards, CC0. Card sounds: Kenney, CC0. Percussion: Sam Gossner (VSCO 2
CE) and menegass, CC0 via Freesound. Fonts: Fraunces and Figtree, OFL 1.1.
three.js, Motion, Howler.js: MIT. Full provenance: [`docs/ASSETS.md`](docs/ASSETS.md).
