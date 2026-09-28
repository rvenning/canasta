# Canasta design pass — 2026-09-27

## The player’s question

On each turn, the player needs to know: **which card action is legal and valuable now?**
The table therefore keeps the draw stack and discard pile together, shows meld
progress beside each team, leaves the player’s whole hand visible, and places
contextual guidance directly above the action buttons.

## Legibility budget

- Card indices, suits, wild markers, and the top discard must remain readable.
- The current player, canasta requirement, score, and pile state must be visible
  without opening a menu.
- Cards must never be obscured by texture, decoration, or the 3D layer.
- On compact screens, meld zones may scroll; the hand, stacks, and actions stay
  on screen.
- Color reinforces words and shapes. It is not the sole cue.

## Reference observations

- [LITE Games' table guide](https://info.lite.games/en/support/solutions/articles/60000695462-canasta-how-is-the-playing-field-set-up-) puts stock, discard, meld space, and score bars into clearly named zones. We added visible stack names and kept team melds separate.
- [Canasta Palace](https://www.canasta-palace.com/) and [GoodSoft's gameplay guide](https://www.goodsoft.biz/card/game_guide/canasta/canasta.html) show the value of a stable hand at the bottom, central stacks, and compact melds with counts. We retained those conventions while using a distinct Río de la Plata palette and calmer chrome.

## Changes

The wide desktop layout spread the game into a left meld column and distant
right-hand controls, leaving a large unused centre. The new layout forms one
bounded table: opponents above, stock and discard in the middle, the player's
melds below, then guidance, actions, and hand. The desktop board is capped at
1800 × 1220 CSS pixels on roomy displays. Phone and short landscape layouts use
the whole screen and let meld zones scroll. On large screens the player and
opponent meld panels fill their table rows, keeping several melds visible without
scrollbars.

The default uses the crisp flat table because it keeps card faces maximally
legible. Three.js remains an optional table setting, with its cloth palette
matched to the new design. All game rules and AI are unchanged.

The short generated rhythm was replaced by [“Green Salon” by Yubatake](https://opengameart.org/content/green-salon),
a mellow bossa nova recording under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Music remains independently switchable and volume controlled. Provenance is in
`docs/ASSETS.md`.

## Verification

- Vitest: 75 tests passed.
- TypeScript typecheck and production Vite build passed.
- Existing end-to-end device matrix passed at 320 × 568, 393 × 852,
  852 × 393, 412 × 915, 820 × 1180, 1180 × 820, 1366 × 768, and
  1680 × 1050. It checks hand cards, action buttons, stock, discard, and
  sideways overflow.
- Desktop gameplay and 390 × 844 phone gameplay were visually inspected in
  both the flat and optional 3D views. The replacement MP3 served with HTTP 200
  and `audio/mpeg`.
