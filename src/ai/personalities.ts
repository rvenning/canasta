/**
 * Computer characters from the Río de la Plata. Personality only flavours
 * thinking time and small tendencies inside the difficulty's band; it never
 * changes the rules or what the computer can see.
 */
export interface Persona {
  id: string;
  name: string;
  initials: string;
  color: string;
  /** Pattern index, so colour is never the only way to tell seats apart. */
  pattern: number;
  blurb: string;
  pace: number;
  /** Appetite for taking the discard pile (0.8 cautious … 1.2 greedy). */
  greed: number;
  /** Tendency to keep pairs back rather than meld them (0.8 … 1.2). */
  patience: number;
}

export const PERSONAS: Persona[] = [
  { id: 'marta', name: 'Abuela Marta', initials: 'AM', color: '#b5452e', pattern: 0, blurb: 'Learned canasta in Montevideo in 1950. Never wastes a joker.', pace: 1.3, greed: 1.0, patience: 1.2 },
  { id: 'nacho', name: 'Tío Nacho', initials: 'TN', color: '#2f6f9f', pattern: 1, blurb: 'Grabs every pile he can reach.', pace: 0.8, greed: 1.2, patience: 0.85 },
  { id: 'lucia', name: 'Lucía', initials: 'L', color: '#7d3c8c', pattern: 2, blurb: 'Quick, cheerful and fond of red canastas.', pace: 0.9, greed: 1.05, patience: 1.05 },
  { id: 'mateo', name: 'Mateo', initials: 'M', color: '#3d7a4a', pattern: 3, blurb: 'Sips his mate and watches every discard.', pace: 1.15, greed: 0.95, patience: 1.15 },
  { id: 'vale', name: 'Valentina', initials: 'V', color: '#c07a12', pattern: 4, blurb: 'Plays to go out, and goes out early.', pace: 0.85, greed: 1.0, patience: 0.9 },
  { id: 'julio', name: 'Don Julio', initials: 'DJ', color: '#5b4a3a', pattern: 5, blurb: 'Freezes the pile the moment it gets big.', pace: 1.2, greed: 0.9, patience: 1.1 },
  { id: 'cami', name: 'Camila', initials: 'C', color: '#c23b6e', pattern: 6, blurb: 'Bold with wild cards, bolder with the pile.', pace: 0.9, greed: 1.15, patience: 0.9 },
  { id: 'santi', name: 'Santiago', initials: 'S', color: '#26707a', pattern: 7, blurb: 'Quiet, patient, precise.', pace: 1.1, greed: 1.0, patience: 1.1 },
];

export const personaById = (id: string | undefined): Persona => PERSONAS.find((p) => p.id === id) ?? PERSONAS[0];
