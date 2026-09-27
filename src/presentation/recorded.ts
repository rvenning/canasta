/**
 * Recorded card sounds through Howler.js. Loaded on demand (dynamic import)
 * after the first user gesture, so it never delays the first screen.
 *
 * One audio sprite holds every short sound (webm/Opus with an MP3 fallback);
 * The optional table music is a separate licensed recording listed in docs/ASSETS.md.
 */
import { Howl, Howler } from 'howler';
import map from './soundSprite.json';

export type Sample = keyof typeof map.sprite;

export interface RecordedEngine {
  readonly loaded: boolean;
  play(name: Sample, volume: number, pan: number, rate?: number): void;
  ambience(volume: number): void;
  suspend(): void;
}

const BASE = import.meta.env.BASE_URL + 'audio/';

export function createRecorded(onReady: () => void, onError: (why: string) => void): RecordedEngine {
  let loaded = false;
  let failed = false;
  const sprite = new Howl({
    src: [BASE + 'sprite.webm', BASE + 'sprite.mp3'],
    sprite: map.sprite as unknown as Record<string, [number, number]>,
    preload: true,
    onload: () => { loaded = true; onReady(); },
    onloaderror: (_id, e) => { failed = true; onError(String(e)); },
    onplayerror: () => { sprite.once('unlock', () => undefined); },
  });
  let amb: Howl | null = null;
  let ambId: number | null = null;
  return {
    get loaded() { return loaded && !failed; },
    play(name, volume, pan, rate = 1) {
      if (!loaded || volume <= 0) return;
      const id = sprite.play(name);
      sprite.volume(Math.min(1, volume), id);
      sprite.stereo(Math.max(-1, Math.min(1, pan)), id);
      if (rate !== 1) sprite.rate(rate, id);
    },
    ambience(volume) {
      if (volume <= 0) {
        if (amb && ambId !== null) { const a = amb, id = ambId; a.fade(a.volume(id) as number, 0, 600, id); a.once('fade', () => a.pause(id), id); }
        return;
      }
      if (!amb) amb = new Howl({ src: [BASE + 'green-salon.mp3'], loop: true, volume: 0, preload: true });
      if (ambId === null || !amb.playing(ambId)) { ambId = ambId !== null ? (amb.play(ambId), ambId) : amb.play(); amb.volume(0, ambId); }
      amb.fade(amb.volume(ambId) as number, Math.min(1, volume), 900, ambId);
    },
    suspend() { if (Howler.ctx && Howler.ctx.state === 'running' && !(amb && ambId !== null && amb.playing(ambId))) void Howler.ctx.suspend(); },
  };
}
