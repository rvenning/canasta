# Rules: sources and interpretations

Canasta here is **Classic Canasta** as standardised around 1950. The primary
source is [Pagat — Canasta](https://www.pagat.com/rummy/canasta.html) (John
McLeod; the "Classic Canasta", "Canasta for two players" and "Canasta for three
players" sections, page last updated 21 September 2026). It was cross-checked
against [Bicycle — How to play Canasta](https://bicyclecards.com/how-to-play/canasta).
No Modern American rules and no house rules are mixed in. Every rule below is
enforced by the engine (`src/engine/hand.ts`, `src/rules/melds.ts`,
`src/engine/scoring.ts`) and covered by tests in `tests/engine/`.

## The three modes

| | 2 players | 3 players | 4 players |
|---|---|---|---|
| Sides | each for themselves | alone until someone first takes the pile, then that player alone against a temporary partnership of the other two | two fixed partnerships, partners opposite |
| Deal | 15 | 13 | 11 |
| Draw from stock | 2 | 2 | 1 |
| Discard | 1 | 1 | 1 |
| Canastas to go out | 2 | 1 | 1 |
| Target | 5,000 | 7,500 | 5,000 |

All in `src/rules/config.ts` (`rulesFor`).

## Choices where sources differ or are silent

1. **Upcard.** If the card turned up to start the pile is wild or a red three,
   another is turned on top until a natural card or black three shows, and the
   pile is frozen (Pagat). Bicycle also lists a black-three upcard as freezing;
   we follow Pagat: a black three only stops the next player.
2. **Taking an unfrozen pile.** With a natural pair, with one natural card and
   one wild card, or by adding the top card to one of the side's melds —
   including a completed canasta (Pagat's base rule; its "restrictions on taking
   the discard pile" variations are not used).
3. **Frozen pile.** Frozen for everyone once it holds a wild card or the turned
   red three; frozen for a side that has not melded. Then only two natural cards
   of the top rank from hand take it; they may join the side's existing meld of
   that rank.
4. **One-card rule.** A player with exactly one card may not take a pile of
   exactly one card. Stated by Bicycle; Pagat implies it (its Viennese variant
   lists the opposite as a difference). Adopted.
5. **One meld per rank.** Cards of a rank the side already has always join that
   meld (Pagat). Wild cards: at least two naturals and at most three wild cards
   in every meld, canastas included; no melds of only wild cards.
6. **Initial meld.** Count only card values; several melds laid together count
   together; when taking the pile only the top card counts, not the rest of the
   pile. Minimums by the side's cumulative score: below 0 → 15, 0–1,495 → 50,
   1,500–2,995 → 90, 3,000+ → 120. The exception (Pagat): a player whose side has
   not melded may meld their whole hand including a canasta after drawing from
   the stock and go out with no minimum. In the game this is one "Lay down" of
   several groups — the interface stages melds before committing them, so a
   first meld can be split across ranks.
7. **Going out.** Requires the side's canasta(s) after the melds of that turn.
   Until then a player must keep a card after discarding, so melding down to a
   single card is refused. Going out by melding every card (no discard) is
   allowed.
8. **Concealed.** 200 instead of 100 when the player had not melded before this
   turn, added nothing to a partner's melds, and put down a canasta of their own;
   taking the pile on that turn is allowed (Pagat's note).
9. **"May I go out?"** Partnerships only (four players, and the temporary
   three-player partnership). It may be asked only straight after drawing or
   taking the pile, before any other meld; the answer binds. To avoid a player
   being bound to something impossible, asking is allowed only when the hand can
   actually go out (checked by `engine/solver.ts`). Computer players answer from
   their own hand; the Expert asks when its partner holds six or more cards.
10. **Red threes.** Laid out at once and replaced; the dealt ones in turn from
   the player left of the dealer. 100 each, 800 for all four (per partnership
   with four players, per player otherwise); negative if the side has not melded
   at all by the end of the hand. A red three turned up at the deal goes to
   whoever takes the pile, without replacement.
11. **Black threes.** Melded only by a player going out: three or four, no wild
   cards. Worth 5 in hand or melded.
12. **End of the stock.** A player who draws from an empty stock ends the hand.
   While the stock is empty, a player must take the pile if its top card fits
   one of the side's melds and it is not frozen for them. A red three as the
   last card ends play at once; that player may not meld or discard. With two
   cards drawn per turn, a lone last card is a complete draw, and a red three
   among the last two cards is not replaced (Pagat, two players); the same
   general rule is applied with three players.
13. **Match end and ties.** When anyone reaches the target the highest total
   wins; if the highest totals are tied, another hand is played (the sources are
   silent on ties).

## Three players in detail

Pagat's three-hand rules (which the brief asked for particular care with):

- Everyone starts on their own, with their own meld area and their own
  requirement. The **first player to take the discard pile** plays alone for the
  rest of the hand; the other two become partners at that moment. Their melds
  are pooled from then on: either may add to either's melds, and the pile is
  frozen against them only if neither has melded.
- If the two partners each already had a meld of the same rank when the
  partnership forms, both melds are kept (combining them could exceed the wild
  card limit or merge two canastas into one); new cards of that rank join the one
  the player chooses (by default the first with room for them).
- If someone goes out before anyone took the pile, that player becomes the lone
  hand for scoring. If the stock runs out and nobody took the pile, all three
  score separately.
- Scoring: the partnership's canasta bonuses, going-out bonus, melded cards and
  both partners' cards in hand make one amount, **added to each partner's own
  total**. Red threes are personal: each partner scores their own (positive if
  the partnership melded). The lone player scores alone.
- Each partner's opening requirement comes from **their own** score; whichever
  partner melds first must reach it, after which both meld freely.
- One canasta is needed to go out; the target is 7,500.

## Not included

Modern American Canasta (bonus cards, special hands, seven/ace rules), wild-card
melds, Samba/Bolivia variants, and online play are out of scope.
