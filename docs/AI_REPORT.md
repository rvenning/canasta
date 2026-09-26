# Computer players: design and measured strength

Three levels, named as in Scopa: **Relaxed**, **Standard**, **Expert**. All
three receive only a `PublicView` (no other hands, no stock order) and check
every candidate move with the rules engine before playing it.

| Level | How it plays |
|---|---|
| Relaxed | Opens as soon as it can, melds pairs with wild cards, scatters wild cards, takes the pile whenever it legally can (85 %), discards with noise and no sense of danger, never asks partner. |
| Standard | Takes the pile only when it is worth the cards it must expose and rarely spends a wild card on a small pile; keeps natural pairs back while the stock is long (for frozen piles); completes canastas with wild cards; won't hand the next opponent a live pile by discarding a card that fits their meld (weighted by pile size); black threes as stoppers; goes out when partner is nearly empty, the stock is short or the opponents are close. With three players it instead estimates, from every card seen (melds, the pile, piles opponents picked up), the chance the next player can take the pile with each discard. |
| Expert | Standard's tuned judgement, plus: with two or three players a **determinized Monte Carlo** look-ahead for the two decisions that matter most — take or draw, and which card to discard. For each it samples 24 deals of the unseen cards consistent with what it has seen (cards seen going into an opponent's hand stay there; red threes only in the stock), plays each candidate out for 8 turns with Standard's policy for everyone, and judges the position (hand score if it ended now plus credit for melds near a canasta). With four players the look-ahead measured slightly worse than Standard, so there Expert uses partnership-tuned heuristics (it takes the pile far more readily) and asks its partner before going out when the partner holds six or more cards. |

Weights were tuned by coordinate search in self-play (`tools/tune.ts`; three
players tuned separately with `MODES=3`). Personalities (`src/ai/personalities.ts`)
only vary thinking time and small appetites (pile greed, patience with pairs).

## Measured strength

`npm run sim` (`tools/simulate.ts`), 200 matches per pairing on seeds never used
for tuning; seats alternate; ± is a 95 % interval. With three players the level
named first holds one seat of three, so parity is 33 %.

| Players | Standard vs Relaxed | Expert vs Relaxed | Expert vs Standard |
|---|---|---|---|
| 2 | 61.0 % ± 6.8 | 60.0 % ± 6.8 | 56.0 % ± 6.9 |
| 3 | 49.0 % ± 6.9 (parity 33) | 96.5 % ± 2.5 (parity 33) | 92.5 % ± 3.7 (parity 33) |
| 4 | 62.5 % ± 6.7 | 67.5 % ± 6.5 | 51.5 % ± 6.9 |

2,400 simulated matches in total (the full report plus the four-player rerun
after the fix below): **0 illegal moves, 0 stalls**. Slowest single decision
131 ms (Expert, two players) in Node; Expert runs in a Web Worker in the game.

Honest reading: every level beats the one below it in every mode, but Expert's
edge over Standard is large with three players, moderate with two, and small
with four (within the noise of 200 matches). Canasta has a lot of luck in a
single match to 5,000.

## A rules bug the simulations found

The first full report showed 6 stalls, all with four players: a player took the
pile down to one card, asked "May I go out?", heard "no" — and then had no legal
move (the last card cannot be discarded without going out, and cannot be
melded). The engine now allows asking only while holding at least two cards
(`docs/RULES.md` §9); the interface and the AI follow the same rule, and a test
covers it.

## What was tried and dropped

- Hand-picked "expert extras" (freezing big piles with a wild card, avoiding
  ranks the next player discarded, asking partner more): each measured neutral or
  harmful against tuned Standard.
- Monte Carlo rollouts to the end of the hand (noisier, no better) and with fewer
  worlds (14); 24 worlds and an 8-turn horizon were the best trade-off.
- Monte Carlo in four-player partnerships: 45.6 % of 480 against Standard.
