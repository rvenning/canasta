/**
 * Sound for the table: one place that decides what is heard, how loudly and where.
 *
 * - Card sounds and the candombe phrases are recordings played through Howler
 *   (recorded.ts, loaded after the first gesture). Until they have loaded, or if
 *   they cannot, a synthesised voice (synth.ts) plays a stand-in.
 * - Volume categories: card sounds and phrases follow "Effects volume", interface
 *   cues "Interface volume", the table rhythm "Rhythm volume". Turning effects off
 *   silences every cue; the rhythm has its own switch and is off by default.
 * - Card sounds can sit a little left or right, following the seat that played.
 * - Sounds react to engine events only and never hold up play; every meaningful
 *   cue also has a caption for players who cannot hear it.
 */
import type { RecordedEngine, Sample } from './recorded.ts';
import { SynthVoice, type SynthCue } from './synth.ts';

export type Cue = 'shuffle' | 'draw' | 'place' | 'discard' | 'take' | 'select' | 'canasta' | 'out' | 'win' | 'turn' | 'error' | 'freeze' | 'stop' | 'redThree';
export type Category = 'cards' | 'phrase' | 'ui';

export const CATEGORY: Record<Cue, Category> = {
  shuffle: 'cards', draw: 'cards', place: 'cards', discard: 'cards', take: 'cards', select: 'cards',
  canasta: 'phrase', out: 'phrase', win: 'phrase', freeze: 'phrase', redThree: 'phrase',
  turn: 'ui', error: 'ui', stop: 'ui',
};

const SYNTH: Record<Cue, SynthCue> = {
  shuffle: 'shuffle', draw: 'deal', place: 'place', discard: 'place', take: 'gather', select: 'select',
  canasta: 'flourish', out: 'win', win: 'win', freeze: 'tick', redThree: 'tick', turn: 'turn', error: 'error', stop: 'tick',
};

/** Level of each category relative to its slider, so a full slider is still a quiet table. */
const BASE_LEVEL: Record<Category, number> = { cards: 0.9, phrase: 0.6, ui: 0.75 };
export const MAX_PAN = 0.45;

const CAPTIONS: Partial<Record<Cue, string>> = {
  shuffle: 'Cards shuffled',
  take: 'Pile taken',
  canasta: 'Canasta!',
  out: 'Going out',
  win: 'Match won',
  turn: 'Your turn',
  error: 'Not allowed',
  freeze: 'Pile frozen',
  stop: 'Black three: pile stopped',
  redThree: 'Red three',
};

export interface AudioSettings { sfxOn: boolean; sfxVolume: number; uiVolume: number; ambOn: boolean; ambVolume: number }
export interface PlayOpts { pan?: number; count?: number }
export interface LogEntry { cue: Cue; via: 'recorded' | 'synth' | 'muted'; volume: number; pan: number }

type Loader = () => Promise<{ createRecorded(onReady: () => void, onError: (why: string) => void): RecordedEngine }>;

export class AudioDirector {
  private synth: SynthVoice;
  private rec: RecordedEngine | null = null;
  private loading = false;
  private variant = 0;
  private s: AudioSettings = { sfxOn: true, sfxVolume: 0.7, uiVolume: 0.6, ambOn: false, ambVolume: 0.3 };
  onCaption: ((text: string) => void) | null = null;
  readonly log: LogEntry[] = [];
  recordedFailed = false;
  private loader: Loader;

  constructor(loader: Loader = () => import('./recorded.ts'), synth?: SynthVoice) {
    this.loader = loader;
    this.synth = synth ?? new SynthVoice();
  }

  /** Call from a user gesture (mobile browsers only allow audio after one). */
  unlock() {
    this.synth.unlock();
    if (!this.rec && !this.loading && !this.recordedFailed) {
      this.loading = true;
      this.loader().then((m) => {
        this.rec = m.createRecorded(() => this.apply(), () => { this.recordedFailed = true; this.rec = null; this.apply(); });
      }).catch(() => { this.recordedFailed = true; }).finally(() => { this.loading = false; });
    }
    this.apply();
  }

  configure(s: AudioSettings) {
    this.s = { ...s };
    this.apply();
  }

  get settings(): Readonly<AudioSettings> { return this.s; }

  volumeFor(cat: Category): number {
    if (!this.s.sfxOn) return 0;
    return (cat === 'ui' ? this.s.uiVolume : this.s.sfxVolume) * BASE_LEVEL[cat];
  }

  private recordedReady() { return !!this.rec && this.rec.loaded; }

  private apply() {
    // The rhythm exists only as a recording; the synthesised voice has no ambience.
    this.synth.setVolumes({ sfx: this.volumeFor('cards'), ui: this.volumeFor('ui'), amb: 0 });
    if (this.recordedReady()) this.rec!.ambience(this.s.ambOn ? this.s.ambVolume * 0.7 : 0);
  }

  suspendIfIdle() {
    this.synth.suspendIfIdle();
    this.rec?.suspend();
  }

  play(cue: Cue, captionsOn: boolean, o: PlayOpts = {}) {
    if (captionsOn && CAPTIONS[cue]) this.onCaption?.(CAPTIONS[cue] as string);
    const cat = CATEGORY[cue];
    const volume = this.volumeFor(cat);
    const pan = Math.max(-MAX_PAN, Math.min(MAX_PAN, (o.pan ?? 0) * MAX_PAN));
    if (volume <= 0) { this.note({ cue, via: 'muted', volume: 0, pan }); return; }
    if (this.recordedReady()) {
      try {
        if (cue === 'draw') {
          const n = Math.max(1, Math.min(4, o.count ?? 1));
          for (let i = 0; i < n; i++) setTimeout(() => this.rec?.play(`slide${1 + ((this.variant + i) % 4)}` as Sample, volume * 0.85, pan, 0.96 + (i % 3) * 0.04), i * 80);
          this.variant += n;
        } else if (cue === 'shuffle') {
          this.rec!.play('shuffle', volume, 0);
        } else {
          const s = this.sampleFor(cue);
          this.rec!.play(s, volume, pan, cue === 'place' || cue === 'discard' ? 0.97 + (this.variant % 3) * 0.03 : 1);
        }
        this.note({ cue, via: 'recorded', volume, pan });
        return;
      } catch { /* fall through to the synthesised voice */ }
    }
    this.synth.play(SYNTH[cue], cat === 'ui' ? 'ui' : 'sfx');
    this.note({ cue, via: 'synth', volume, pan });
  }

  private sampleFor(cue: Cue): Sample {
    const v = this.variant++;
    switch (cue) {
      case 'place': return `place${1 + (v % 4)}` as Sample;
      case 'discard': return `place${1 + ((v + 2) % 4)}` as Sample;
      case 'take': return `shove${1 + (v % 4)}` as Sample;
      case 'select': return 'select';
      default: return cue as Sample;
    }
  }

  private note(e: LogEntry) {
    this.log.push(e);
    if (this.log.length > 60) this.log.shift();
  }
}

export const audio = new AudioDirector();
