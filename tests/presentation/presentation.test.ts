import { describe, expect, it } from 'vitest';
import { chooseView, FrameGuard, type Capabilities } from '../../src/presentation/mode.ts';
import { presentationAllowance } from '../../src/presentation/pacing.ts';
import { AudioDirector, CATEGORY, MAX_PAN, type Cue } from '../../src/presentation/audio.ts';
import { CardFlights, type Pose, type Tween } from '../../src/presentation/cardFlights.ts';
import type { SynthVoice } from '../../src/presentation/synth.ts';
import sprite from '../../src/presentation/soundSprite.json';

const caps = (o: Partial<Capabilities> = {}): Capabilities => ({ webgl2: true, softwareGl: false, reducedMotion: false, cores: 8, memoryGb: 8, saveData: false, ...o });

describe('choosing the 3D or flat table', () => {
  it('uses 3D only where the device can carry it', () => {
    expect(chooseView('auto', caps()).view).toBe('3d');
    expect(chooseView('auto', caps({ webgl2: false })).view).toBe('2d');
    expect(chooseView('3d', caps({ reducedMotion: true })).view).toBe('2d');
    expect(chooseView('auto', caps({ softwareGl: true })).view).toBe('2d');
    expect(chooseView('auto', caps({ cores: 2 })).view).toBe('2d');
    expect(chooseView('2d', caps()).view).toBe('2d');
    expect(chooseView('auto', caps(), true).view).toBe('2d');
  });
  it('falls back when frames are slow', () => {
    const g = new FrameGuard(34, 20, 2);
    let t = 0, tripped = false;
    for (let i = 0; i < 30; i++) { t += 60; tripped = g.frame(t, true); }
    expect(tripped).toBe(true);
  });
});

describe('pacing comes from events, not animations', () => {
  it('is deterministic, longer for big moments, shorter with reduced motion', () => {
    const disc = [{ e: 'discard', seat: 0, card: 5, froze: false, stop: false }] as never[];
    const can = [{ e: 'canasta', seat: 0, meld: 1, natural: true }] as never[];
    const a = presentationAllowance(disc, { reduced: false, speed: 1 });
    expect(presentationAllowance(disc, { reduced: false, speed: 1 })).toBe(a);
    expect(presentationAllowance(can, { reduced: false, speed: 1 })).toBeGreaterThan(a);
    expect(presentationAllowance(can, { reduced: true, speed: 1 })).toBeLessThan(500);
    expect(presentationAllowance(disc, { reduced: false, speed: 2 })).toBeLessThan(a);
  });
});

describe('audio', () => {
  const fakeSynth = () => { const played: string[] = []; return { played, synth: { unlock() {}, setVolumes() {}, suspendIfIdle() {}, play(c: string) { played.push(c); } } as unknown as SynthVoice }; };
  it('mutes everything when effects are off, but still captions', () => {
    const { synth, played } = fakeSynth();
    const a = new AudioDirector(() => new Promise(() => undefined), synth);
    const caps: string[] = [];
    a.onCaption = (t) => caps.push(t);
    a.configure({ sfxOn: false, sfxVolume: 1, uiVolume: 1, ambOn: false, ambVolume: 0 });
    a.play('canasta', true);
    expect(played).toEqual([]);
    expect(a.log.at(-1)!.via).toBe('muted');
    expect(caps).toEqual(['Canasta!']);
  });
  it('falls back to the synthesised voice before recordings load, with separate volumes and subtle stereo', () => {
    const { synth, played } = fakeSynth();
    const a = new AudioDirector(() => new Promise(() => undefined), synth);
    a.configure({ sfxOn: true, sfxVolume: 0.5, uiVolume: 0.2, ambOn: false, ambVolume: 0 });
    a.play('discard', false, { pan: 1 });
    expect(played).toEqual(['place']);
    expect(a.log.at(-1)!.pan).toBeCloseTo(MAX_PAN);
    expect(a.volumeFor('ui')).toBeLessThan(a.volumeFor('cards'));
  });
  it('every recorded cue exists in the built sprite', () => {
    const recorded: Cue[] = (Object.keys(CATEGORY) as Cue[]).filter((c) => !['place', 'discard', 'take', 'draw', 'error'].includes(c));
    for (const c of recorded) expect(Object.keys(sprite.sprite)).toContain(c);
    for (const k of ['place1', 'place4', 'slide1', 'shove1', 'shuffle', 'select']) expect(Object.keys(sprite.sprite)).toContain(k);
  });
});

describe('3D card flights', () => {
  // A stepped tween: progresses when told to, so interruptions can be tested exactly.
  const steps: ((p: number) => void)[] = [];
  const done: (() => void)[] = [];
  const tween: Tween = (o) => { steps.push(o.onUpdate); done.push(o.onComplete); return { stop() {} }; };
  const pose = (x: number): Pose => ({ x, y: 0, z: 0, w: 50, rot: 0, face: 1, tilt: 0, show: 1 });
  it('an interrupted flight continues from where the card is and comes to rest on its target', () => {
    const f = new CardFlights(tween);
    f.jump(new Map([[1, pose(0)]]));
    f.retarget(new Map([[1, pose(100)]]));
    steps.at(-1)!(0.5);
    const mid = f.poses.get(1)!.x;
    expect(mid).toBeGreaterThan(10);
    f.retarget(new Map([[1, pose(200)]]));
    steps.at(-1)!(0);
    expect(f.poses.get(1)!.x).toBeCloseTo(mid, 0);
    f.finish();
    expect(f.poses.get(1)!.x).toBe(200);
    expect(f.mismatches()).toEqual([]);
  });
});
