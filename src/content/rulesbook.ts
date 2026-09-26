/**
 * The in-game rules reference. Plain language, one section per topic, with the
 * differences for two, three and four players. It describes exactly what the
 * engine enforces; docs/RULES.md records the sources and every choice made
 * where tables differ.
 */
import { rulesFor, type PlayerCount } from '../rules/config.ts';

export interface Section { id: string; title: string; body: string[] }

export function rulesBook(players: PlayerCount): Section[] {
  const r = rulesFor(players);
  const mode: Record<PlayerCount, string[]> = {
    2: [
      'Two players, each for themselves. Each is dealt 15 cards.',
      'You draw two cards from the stock each turn and discard one.',
      'You need two canastas before you may go out.',
      'The first to 5,000 points wins (the higher score if both pass it in the same hand).',
      'If only one card is left in the stock, drawing it counts as your full draw.',
    ],
    3: [
      'Three players. Each is dealt 13 cards, draws two from the stock and discards one.',
      'Everyone starts on their own. The first player to take the discard pile plays alone for the rest of that hand, and the other two become partners: from then on they share their melds, and either may add to the other’s.',
      'If someone goes out before anyone has taken the pile, that player is the lone hand. If the stock runs out and nobody took the pile, everyone scores alone.',
      'Partners’ melds, canastas, going-out bonus and cards left in hand are added together, and that amount goes onto BOTH partners’ scores. Red threes stay personal: each player scores their own.',
      'Each player keeps their own score, so partners may need different amounts to open. Whichever partner melds first must reach their own minimum; after that both meld freely.',
      'You need one canasta to go out. The first to 7,500 points wins.',
    ],
    4: [
      'Four players in two partnerships; partners sit opposite each other. Each is dealt 11 cards.',
      'You draw one card from the stock each turn and discard one.',
      'Melds belong to the partnership: you can add to your partner’s melds. You need one canasta (between you) to go out.',
      'Before going out you may ask your partner “May I go out?” straight after drawing. The answer binds you: yes means you must go out this turn, no means you may not.',
      'The first partnership to 5,000 points wins.',
    ],
  };
  return [
    { id: 'aim', title: 'The aim', body: [
      'Canasta comes from Uruguay (Montevideo, 1939) and its name means “basket”. You score by laying down melds — sets of three or more cards of the same rank — and above all by building canastas: melds of seven or more cards.',
      `This table: ${players} players, play to ${r.target.toLocaleString()}.`,
    ] },
    { id: 'mode', title: `${players} players`, body: mode[players] },
    { id: 'cards', title: 'The cards', body: [
      'Two ordinary packs and four jokers: 108 cards.',
      'Jokers and twos are wild: they can stand in for a natural card in a meld.',
      'Card values: Joker 50 · Ace and Two 20 · King to Eight 10 · Seven to Four 5 · black Three 5.',
      'Red threes are bonus cards: the moment you get one it goes face up in front of you and you draw a replacement.',
    ] },
    { id: 'turn', title: 'Your turn', body: [
      `Start by drawing ${r.drawCount === 1 ? 'the top card' : 'the top two cards'} of the stock — or take the whole discard pile (see below).`,
      'Then lay down any melds you want to.',
      'End your turn by discarding one card onto the pile.',
    ] },
    { id: 'melds', title: 'Melds', body: [
      'A meld is three or more cards of the same rank, Aces and Fours up to Kings. It must hold at least two natural cards and never more than three wild cards. Wild cards cannot make a meld on their own.',
      'A side has one meld of each rank: more cards of that rank join it. You may add to your own side’s melds, never to an opponent’s.',
      'Seven or more cards make a canasta. With no wild card it is a natural (red) canasta, worth 500; with any wild card it is mixed (black), worth 300. You can keep adding to a canasta.',
    ] },
    { id: 'opening', title: 'The first meld', body: [
      'Each hand, a side’s first meld must be worth a minimum number of points, counted from the card values (bonuses and red threes do not count). Several melds laid down together count together.',
      'Minimum by the side’s score so far: below 0 → 15 · 0 to 1,495 → 50 · 1,500 to 2,995 → 90 · 3,000 or more → 120.',
      'When you open by taking the pile, only the top card of the pile counts toward the minimum, not the cards underneath.',
      'The one exception: if you have not melded at all and, after drawing, can meld your whole hand including a canasta and go out, no minimum applies.',
    ] },
    { id: 'pile', title: 'Taking the discard pile', body: [
      'Instead of drawing you may take the whole pile, if you can meld its top card at once: with two natural cards of that rank from your hand, or one natural card and one wild card, or by adding it to one of your side’s melds. Then you take the rest of the pile into your hand.',
      'The pile is frozen against everyone once a wild card has been discarded onto it (it is shown crosswise), and against your side until your side has melded. A frozen pile can only be taken with two natural cards of the top card’s rank from your hand.',
      'You can never take the pile when its top card is a wild card or a black three.',
      'If you hold only one card, you may not take a pile of just one card.',
    ] },
    { id: 'threes', title: 'Threes', body: [
      'Red threes: 100 points each, 800 for all four — but minus that amount if your side has not melded anything by the end of the hand.',
      'Black threes: discarding one stops the next player from taking the pile. They cannot be melded, except three or four of them (no wild cards) by a player who is going out.',
    ] },
    { id: 'out', title: 'Going out', body: [
      `You go out by getting rid of your last card — melding everything, or melding all but one and discarding it. Your side must have ${r.canastasToGoOut === 1 ? 'a canasta' : 'two canastas'} first (you may complete it on the same turn).`,
      'Until then you must always keep at least one card after your discard, so you may not meld down to a single card.',
      'Going out scores 100. Going out concealed — melding your whole hand in one turn, including a canasta of your own, having not melded before and without adding to a partner’s melds — scores 200.',
    ] },
    { id: 'stock', title: 'When the stock runs out', body: [
      'Once the stock is empty, play goes on only while each player takes the discard pile. You must take it if the top card fits one of your side’s melds and the pile is not frozen for you. When a player cannot (or, if allowed, does not) take it, the hand ends.',
      'If the last card of the stock is a red three, the hand ends at once: that player may not meld or discard.',
    ] },
    { id: 'scoring', title: 'Scoring a hand', body: [
      'Each side adds up: canasta bonuses (500 natural, 300 mixed), red threes, 100 or 200 for going out, and the value of every card it melded — then subtracts the value of the cards left in its hands.',
      `The match ends when someone reaches ${r.target.toLocaleString()}; the highest score wins. If the top scores are tied, play another hand.`,
    ] },
  ];
}
