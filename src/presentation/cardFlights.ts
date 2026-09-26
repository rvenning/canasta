/* Adapted from Scopa (src/presentation/cardFlights.ts). */
/** A card's pose on the table, in screen terms (CSS px), from which the 3D view places it. */
export interface Pose {
  x: number; y: number;
  /** Height above the table in CSS px (stacking and lift). */
  z: number;
  /** Card width on screen; height is 1.4 times this. */
  w: number;
  /** Rotation about the table's normal, degrees. */
  rot: number;
  /** 1 = face up, 0 = face down. */
  face: number;
  /** Tilt out of the table plane while travelling, degrees. */
  tilt: number;
  /** 0 = hidden, 1 = on the table. */
  show: number;
}

export interface Flight {
  delay: number;
  via?: { x: number; y: number; z: number; hold: number; face?: number; w?: number };
  /** Where to start from instead of the current pose (a card leaving the player's hand). */
  from?: Pose;
  arc: number;
}

/**
 * Moves the 3D cards between the poses the scene model asks for.
 *
 * Every card has exactly one current pose. A flight eases a progress value from
 * 0 to 1 (a Motion spring in the app, a stepped fake in tests) and the pose is
 * read off a shallow arc between where the card was and where it is going.
 * Retargeting a card in the middle of a flight starts the new flight from the
 * pose it has reached, so an interrupted animation never jumps; `finish()`
 * snaps every card to its target, which is exactly the engine's picture.
 */

export interface TweenOpts { delay: number; duration: number; bounce: number; onUpdate(p: number): void; onComplete(): void }
export type Tween = (o: TweenOpts) => { stop(): void };

interface Active {
  from: Pose;
  to: Pose;
  via?: Flight['via'];
  arc: number;
  p: number;
  handle: { stop(): void } | null;
  stage: 0 | 1;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Shortest turn between two angles, so a card never spins the long way round. */
function lerpAngle(a: number, b: number, t: number) {
  let d = ((b - a) % 360 + 540) % 360 - 180;
  if (Math.abs(d) === 180) d = 180;
  return a + d * t;
}

export function poseAlong(from: Pose, to: Pose, p: number, arc: number): Pose {
  const t = Math.max(0, p);
  const u = Math.min(1, t);
  const lift = arc * Math.sin(Math.PI * u);
  const dx = to.x - from.x;
  return {
    x: lerp(from.x, to.x, t),
    y: lerp(from.y, to.y, t),
    z: lerp(from.z, to.z, u) + lift,
    w: lerp(from.w, to.w, u),
    rot: lerpAngle(from.rot, to.rot, t),
    // Turn over in the middle third of the flight, while the card is highest.
    face: from.face === to.face ? to.face : lerp(from.face, to.face, Math.min(1, Math.max(0, (u - 0.3) / 0.4))),
    // A slight tilt into the direction of travel, gone by the time it lands.
    tilt: Math.max(-9, Math.min(9, dx * 0.03)) * Math.sin(Math.PI * u),
    show: to.show === from.show ? to.show : u < 0.85 ? Math.max(from.show, 0.999) : to.show,
  };
}

export class CardFlights {
  readonly poses = new Map<number, Pose>();
  readonly targets = new Map<number, Pose>();
  private active = new Map<number, Active>();
  onChange: () => void = () => {};

  private tween: Tween;
  private flightMs: number;
  private bounce: number;

  constructor(tween: Tween, flightMs = 430, bounce = 0.16) {
    this.tween = tween; this.flightMs = flightMs; this.bounce = bounce;
  }

  get moving() { return this.active.size; }

  /** Place every card without animation (first frame, resize, or a fallback). */
  jump(targets: Map<number, Pose>) {
    for (const a of this.active.values()) a.handle?.stop();
    this.active.clear();
    this.targets.clear();
    this.poses.clear();
    for (const [c, p] of targets) { this.targets.set(c, { ...p }); this.poses.set(c, { ...p }); }
    this.onChange();
  }

  /**
   * Send cards to new targets. Cards with a planned flight follow it; any other card
   * whose target moved glides there directly (a table re-flow, a resize).
   */
  retarget(targets: Map<number, Pose>, plan: Map<number, Flight> = new Map(), speed = 1) {
    for (const [c, to] of targets) {
      const was = this.targets.get(c);
      this.targets.set(c, { ...to });
      const f = plan.get(c);
      if (!f && was && samePose(was, to)) continue;
      // New cards, and cards going into a hand without a planned flight, are simply placed.
      if (!f && (!was || to.show === 0)) { this.active.get(c)?.handle?.stop(); this.active.delete(c); this.poses.set(c, { ...to }); continue; }
      this.fly(c, to, f, speed);
    }
    this.onChange();
  }

  private fly(c: number, to: Pose, f: Flight | undefined, speed: number) {
    const prev = this.active.get(c);
    prev?.handle?.stop();
    // Interrupted or not, the new flight starts from the pose the card has actually reached.
    const start = f?.from ? { ...f.from } : { ...(this.poses.get(c) ?? to) };
    if (f?.from) this.poses.set(c, start);
    const dur = (this.flightMs / 1000) / Math.max(0.25, speed);
    const a: Active = { from: start, to: { ...to }, via: f?.via, arc: f?.arc ?? 10, p: 0, handle: null, stage: 0 };
    this.active.set(c, a);
    const leg = (from: Pose, dest: Pose, delay: number, done: () => void) => {
      a.from = from;
      a.p = 0;
      a.handle = this.tween({
        delay, duration: dur, bounce: this.bounce,
        onUpdate: (p) => { if (this.active.get(c) !== a) return; a.p = p; this.poses.set(c, poseAlong(from, dest, p, a.arc)); this.onChange(); },
        onComplete: () => { if (this.active.get(c) !== a) return; done(); },
      });
    };
    const land = () => { this.poses.set(c, { ...a.to }); this.active.delete(c); this.onChange(); };
    const delay = (f?.delay ?? 0) / 1000;
    if (a.via) {
      const v = a.via;
      const mid: Pose = { ...to, x: v.x, y: v.y, z: v.z, w: v.w ?? to.w, face: v.face ?? to.face, rot: start.rot, tilt: 0, show: 1 };
      leg(start, mid, delay, () => { a.stage = 1; this.poses.set(c, mid); leg(mid, a.to, v.hold / 1000, land); });
    } else leg(start, a.to, delay, land);
  }

  /** Snap everything to its target now: used when the app is backgrounded and by tests. */
  finish() {
    for (const a of this.active.values()) a.handle?.stop();
    this.active.clear();
    for (const [c, p] of this.targets) this.poses.set(c, { ...p });
    this.onChange();
  }

  /** Cards at rest somewhere other than their target. Always empty once nothing is moving. */
  mismatches(): number[] {
    const out: number[] = [];
    for (const [c, t] of this.targets) {
      if (this.active.has(c)) continue;
      const p = this.poses.get(c);
      if (!p || !samePose(p, t)) out.push(c);
    }
    return out;
  }
}

export function samePose(a: Pose, b: Pose, eps = 0.5) {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps && Math.abs(a.w - b.w) < eps
    && Math.abs(a.rot - b.rot) < 0.5 && Math.abs(a.face - b.face) < 0.01 && Math.abs(a.show - b.show) < 0.01;
}
