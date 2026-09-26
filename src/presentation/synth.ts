/**
 * The synthesised voice (kept from Scopa): every cue made with WebAudio from filtered noise and
 * oscillators, no files at all. It is the fallback whenever the recorded sounds
 * (recorded.ts) are not loaded yet or cannot play, and it always makes the small
 * interface cues. The context is created only after a user gesture.
 */
export type SynthCue = 'place' | 'gather' | 'shuffle' | 'deal' | 'flourish' | 'tick' | 'win' | 'turn' | 'error' | 'select';

export class SynthVoice {
  ctx: AudioContext | null = null;
  private sfx: GainNode | null = null;
  private ui: GainNode | null = null;
  private amb: GainNode | null = null;
  private ambNodes: AudioNode[] = [];
  private ambTimer: number | null = null;
  private target: GainNode | null = null;
  private vol = { sfx: 0.7, ui: 0.6, amb: 0 };
  private noiseBuf: AudioBuffer | null = null;
  private variant = 0;

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      // Respect the iOS silent switch where supported.
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'ambient';
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.sfx = this.ctx.createGain();
      this.sfx.connect(this.ctx.destination);
      this.ui = this.ctx.createGain();
      this.ui.connect(this.ctx.destination);
      this.amb = this.ctx.createGain();
      this.amb.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      let seed = 12345;
      for (let i = 0; i < len; i++) { seed = (seed * 1103515245 + 12345) >>> 0; d[i] = (seed / 2 ** 31) - 1; }
      this.apply();
    } catch { this.ctx = null; }
  }

  /** Bus volumes, already combined with the player's on/off switches (0 = silent). */
  setVolumes(v: { sfx: number; ui: number; amb: number }) {
    this.vol = v;
    this.apply();
  }

  private apply() {
    if (!this.ctx || !this.sfx || !this.ui || !this.amb) return;
    const t = this.ctx.currentTime;
    this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.02);
    this.ui.gain.setTargetAtTime(this.vol.ui, t, 0.02);
    this.amb.gain.setTargetAtTime(this.vol.amb * 0.5, t, 0.4);
    if (this.vol.amb > 0 && !this.ambNodes.length) this.startAmbience();
    if (this.vol.amb === 0 && this.ambNodes.length) this.stopAmbience();
  }

  suspendIfIdle() {
    if (this.ctx && this.vol.amb === 0 && this.ctx.state === 'running') void this.ctx.suspend();
  }

  get ready() { return !!this.ctx; }

  play(cue: SynthCue, bus: 'sfx' | 'ui' = 'sfx') {
    if (!this.ctx || !this.sfx || !this.ui) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.target = bus === 'ui' ? this.ui : this.sfx;
    try { this[cue](); } catch { /* audio must never break play */ }
  }

  // ---------------------------------------------------------------- primitives

  private noise(at: number, dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass') {
    const c = this.ctx as AudioContext;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect((this.target ?? this.sfx) as GainNode);
    src.start(at, Math.random() * 0.5, dur + 0.05);
    src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
  }

  private tone(at: number, freq: number, dur: number, gain: number, type: OscillatorType = 'triangle') {
    const c = this.ctx as AudioContext;
    const o = c.createOscillator();
    o.type = type; o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect((this.target ?? this.sfx) as GainNode);
    o.start(at); o.stop(at + dur + 0.05);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }

  private get now() { return (this.ctx as AudioContext).currentTime + 0.01; }

  // ---------------------------------------------------------------- cues

  /** Several varied card-on-table sounds: a paper slap with a soft body. */
  private place() {
    const t = this.now;
    const v = this.variant++ % 4;
    const freqs = [2350, 2850, 2050, 3200];
    this.noise(t, 0.065 + v * 0.008, freqs[v], 0.85, 0.34);
    this.noise(t + .004, 0.055, 340 + v * 42, 1.1, 0.24, 'lowpass');
    this.tone(t + .006, 118 + v * 7, .09, .018, 'sine');
  }
  private select() {
    const t = this.now;
    this.noise(t, 0.032, 3900, 1.3, 0.12);
    this.tone(t, 720, .055, .022, 'sine');
  }
  private deal() {
    const t = this.now;
    // Three quick paper flicks make a deal read as cards rather than a UI click.
    for (let i = 0; i < 3; i++) {
      this.noise(t + i * .055, 0.045, 3150 + i * 260, 1.05, 0.15);
      this.noise(t + i * .055 + .005, .035, 430, .8, .08, 'lowpass');
    }
  }
  private gather() {
    const t = this.now;
    for (let i = 0; i < 4; i++) this.noise(t + i * 0.038, 0.075, 1650 + i * 230, 0.75, 0.19);
    this.noise(t + 0.17, 0.085, 285, .9, 0.22, 'lowpass');
    this.tone(t + .18, 145, .12, .016, 'sine');
  }
  private shuffle() {
    const t = this.now;
    for (let i = 0; i < 26; i++) this.noise(t + i * 0.022 + Math.random() * 0.006, 0.03, 3000 + Math.random() * 1600, 1.4, 0.16);
    for (let i = 0; i < 20; i++) this.noise(t + 0.7 + i * 0.02, 0.03, 2600 + Math.random() * 1600, 1.4, 0.14);
  }
  /** A soft plucked arpeggio, like a mandolin in the next room. */
  private flourish() {
    const t = this.now;
    const notes = [392, 493.9, 587.3, 784];
    notes.forEach((f, i) => {
      const at = t + i * .075;
      this.tone(at, f, .78, .075, 'triangle');
      this.tone(at + .012, f * 2, .28, .018, 'sine');
      this.noise(at, .038, 2700 + i * 260, 2.2, .035);
    });
    this.tone(t + .34, 1174.7, .7, .035, 'sine');
  }
  private tick() {
    const t = this.now;
    this.tone(t, 1320, 0.06, 0.07, 'sine');
    this.noise(t, 0.03, 5000, 2, 0.06);
  }
  private turn() {
    const t = this.now;
    this.tone(t, 659.3, 0.22, 0.033, 'sine');
    this.tone(t + 0.085, 880, 0.28, 0.032, 'sine');
  }
  private error() {
    const t = this.now;
    this.tone(t, 220, 0.18, 0.06, 'triangle');
  }
  private win() {
    const t = this.now;
    const seq = [[261.6, 329.6, 392], [349.2, 440, 523.3], [392, 493.9, 587.3], [523.3, 659.3, 784]];
    seq.forEach((ch, i) => ch.forEach((f, j) => this.tone(t + i * 0.26 + j * 0.045, f, 1.05, 0.045, j === 0 ? 'triangle' : 'sine')));
  }

  // ---------------------------------------------------------------- ambience

  private startAmbience() {
    const c = this.ctx as AudioContext;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const lp2 = c.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 900;
    const g = c.createGain(); g.gain.value = 0.25;
    src.connect(lp).connect(lp2).connect(g).connect(this.amb as GainNode);
    src.start();
    this.ambNodes = [src, lp, lp2, g];
    const clink = () => {
      if (!this.ctx || this.vol.amb === 0) return;
      const t = this.ctx.currentTime + 0.05;
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 2200 + Math.random() * 1400;
      const gg = c.createGain(); gg.gain.setValueAtTime(0, t); gg.gain.linearRampToValueAtTime(0.02, t + 0.004); gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(gg).connect(this.amb as GainNode); o.start(t); o.stop(t + 0.4);
      o.onended = () => { o.disconnect(); gg.disconnect(); };
      this.ambTimer = window.setTimeout(clink, 2500 + Math.random() * 7000);
    };
    this.ambTimer = window.setTimeout(clink, 3000);
  }

  private stopAmbience() {
    for (const n of this.ambNodes) { try { (n as AudioBufferSourceNode).stop?.(); } catch { /* */ } n.disconnect(); }
    this.ambNodes = [];
    if (this.ambTimer) clearTimeout(this.ambTimer);
    this.ambTimer = null;
  }
}

