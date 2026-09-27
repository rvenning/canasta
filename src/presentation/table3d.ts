/**
 * The 3D tabletop (three.js), adapted from Scopa's. Loaded on demand and only
 * when mode.ts chooses the 3D view.
 *
 * It paints; it never decides. The DOM table above it is still what is tapped,
 * focused and read aloud: every table card here is placed exactly under its DOM
 * box (screen positions are mapped onto the cloth by ray casting), so the layout
 * code stays the single source of where things are. The camera is fixed and only
 * slightly tilted. Frames are drawn only while something moves, and a FrameGuard
 * asks for the flat table if the device cannot keep up.
 */
import * as THREE from 'three';
import { animate } from 'motion';
import { CardFlights, type Tween, type Flight, type Pose } from './cardFlights.ts';
import { FrameGuard } from './mode.ts';

export type Surface = 'tejido' | 'noche' | 'patio';

export interface Stack { x: number; y: number; w: number; n: number; rot?: number }

export interface Table3DOpts {
  faceUrl(c: number): string;
  backUrl: string;
  surface: Surface;
  onFallback(reason: string): void;
}

const TILT = THREE.MathUtils.degToRad(9);
const FOV = 24;
const ASPECT = 1.4;
const FACE_W = 250, FACE_H = 350;
const MAX_FACES = 60;
const THICK = 0.35; // CSS px per card in a stack

const motionTween: Tween = (o) => {
  const c = animate(0, 1, { type: 'spring', visualDuration: o.duration, bounce: o.bounce, delay: o.delay, onUpdate: o.onUpdate, onComplete: o.onComplete });
  return { stop: () => c.stop() };
};

/** A woven cloth, painted once into a repeating texture. */
function clothCanvas(s: Surface): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const pal = { tejido: ['#19504a', '#25675c', '#123a38', '#e9b976'], noche: ['#273b55', '#354d69', '#17283d', '#a9bad1'], patio: ['#246653', '#377f63', '#184739', '#f2e6cc'] }[s];
  g.fillStyle = pal[0];
  g.fillRect(0, 0, 256, 256);
  if (s === 'patio') {
    // Hydraulic tiles: a quatrefoil every 64 px.
    for (let y = 0; y < 256; y += 64) for (let x = 0; x < 256; x += 64) {
      g.fillStyle = pal[1]; g.fillRect(x + 2, y + 2, 60, 60);
      g.fillStyle = pal[3]; g.globalAlpha = 0.18;
      g.beginPath(); g.arc(x + 32, y + 32, 16, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 0.12; for (const [dx, dy] of [[0, 0], [64, 0], [0, 64], [64, 64]]) { g.beginPath(); g.arc(x + dx, y + dy, 12, 0, Math.PI * 2); g.fill(); }
      g.globalAlpha = 1;
    }
  } else {
    // Over-and-under weave.
    for (let y = 0; y < 256; y += 4) for (let x = 0; x < 256; x += 4) {
      const over = ((x >> 2) + (y >> 2)) % 2 === 0;
      g.fillStyle = over ? pal[1] : pal[2];
      g.globalAlpha = 0.35 + ((x * 7 + y * 13) % 11) / 60;
      g.fillRect(x, y, over ? 4 : 3, over ? 3 : 4);
    }
    g.globalAlpha = 1;
  }
  return c;
}

function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function planeUv(g: THREE.BufferGeometry, w: number, h: number, mirror = false) {
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / w + 0.5;
    uv[2 * i] = mirror ? 1 - u : u;
    uv[2 * i + 1] = pos.getY(i) / h + 0.5;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

export class Table3D {
  readonly canvas: HTMLCanvasElement;
  readonly flights: CardFlights;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 10, 20000);
  private cloth: THREE.Mesh;
  private clothMat: THREE.MeshStandardMaterial;
  private lamp: THREE.SpotLight;
  private cards = new Map<number, { g: THREE.Group; faceMat: THREE.MeshStandardMaterial }>();
  private stacks: { stock: THREE.Mesh; pile: THREE.Mesh };
  private stackData: { stock: Stack | null; pile: Stack | null } = { stock: null, pile: null };
  private shared: { body: THREE.BufferGeometry; faceGeo: THREE.BufferGeometry; backGeo: THREE.BufferGeometry; bodyMat: THREE.MeshStandardMaterial; backMat: THREE.MeshStandardMaterial };
  private faces = new Map<number, { tex: THREE.Texture | null; used: number; loading: boolean }>();
  private w = 1; private h = 1;
  private raf = 0;
  private lastFrameAt = 0;
  private guard = new FrameGuard();
  private disposed = false;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  frames = 0;
  private host: HTMLElement;
  private opts: Table3DOpts;

  constructor(host: HTMLElement, opts: Table3DOpts) {
    this.host = host;
    this.opts = opts;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'table3d';
    this.canvas.setAttribute('aria-hidden', 'true');
    const dpr = window.devicePixelRatio || 1;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: dpr < 2, alpha: false, powerPreference: 'default' });
    this.renderer.setPixelRatio(Math.min(dpr, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.fail('the graphics context was lost'); });

    this.scene.background = new THREE.Color(0x142c2d);
    this.scene.add(new THREE.HemisphereLight(0xfff4e6, 0x173a37, 1.15));
    this.lamp = new THREE.SpotLight(0xffe0b0, 3.0, 0, THREE.MathUtils.degToRad(48), 0.85, 0);
    this.lamp.castShadow = true;
    const small = Math.min(innerWidth, innerHeight) < 600;
    this.lamp.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    this.lamp.shadow.bias = -0.0004;
    this.lamp.shadow.normalBias = 0.6;
    this.scene.add(this.lamp, this.lamp.target);
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.3);
    fill.position.set(-600, -400, 900);
    this.scene.add(fill);

    this.clothMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    this.cloth = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.clothMat);
    this.cloth.receiveShadow = true;
    this.scene.add(this.cloth);
    this.setSurface(opts.surface);

    const cw = 1, ch = ASPECT, r = 0.07;
    const shape = roundedRect(cw, ch, r);
    const body = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 5 });
    body.translate(0, 0, -0.5);
    const faceGeo = planeUv(new THREE.ShapeGeometry(shape, 5), cw, ch).translate(0, 0, 0.51);
    const backGeo = planeUv(new THREE.ShapeGeometry(shape, 5), cw, ch, true);
    backGeo.rotateY(Math.PI).translate(0, 0, -0.51);
    this.shared = {
      body, faceGeo, backGeo,
      bodyMat: new THREE.MeshStandardMaterial({ color: 0xefe3c8, roughness: 0.9 }),
      backMat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }),
    };
    // Stacks: a paper block topped with the card back (the stock) or plain paper (the pile's depth).
    const stackGeo = new THREE.BoxGeometry(1, ASPECT, 1).translate(0, 0, 0.5);
    const paper = new THREE.MeshStandardMaterial({ color: 0xe9dcc0, roughness: 0.95 });
    this.stacks = {
      stock: new THREE.Mesh(stackGeo, [paper, paper, paper, paper, this.shared.backMat, paper]),
      pile: new THREE.Mesh(stackGeo, paper),
    };
    for (const m of Object.values(this.stacks)) { m.castShadow = true; m.receiveShadow = true; m.visible = false; this.scene.add(m); }
    this.setBack(opts.backUrl);

    this.flights = new CardFlights(motionTween, 430, 0.14);
    this.flights.onChange = () => this.requestFrame();
    host.prepend(this.canvas);
    this.resize();
  }

  private loadCanvasTexture(url: string, w: number, h: number): Promise<THREE.Texture> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d')!;
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, w, h);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
        resolve(t);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  setSurface(s: Surface) {
    const t = new THREE.CanvasTexture(clothCanvas(s));
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.clothMat.map?.dispose();
    this.clothMat.map = t;
    this.clothMat.needsUpdate = true;
    this.opts.surface = s;
    this.fitCloth();
    this.requestFrame();
  }

  setBack(url: string) {
    void this.loadCanvasTexture(url, FACE_W, FACE_H).then((t) => {
      if (this.disposed) { t.dispose(); return; }
      this.shared.backMat.map?.dispose();
      this.shared.backMat.map = t;
      this.shared.backMat.needsUpdate = true;
      this.requestFrame();
    }).catch(() => undefined);
  }

  private faceFor(c: number, mat: THREE.MeshStandardMaterial) {
    let f = this.faces.get(c);
    if (!f) { f = { tex: null, used: 0, loading: false }; this.faces.set(c, f); }
    f.used = performance.now();
    if (f.tex) { if (mat.map !== f.tex) { mat.map = f.tex; mat.emissiveMap = f.tex; mat.emissiveIntensity = 0.28; mat.color.set(0xffffff); mat.needsUpdate = true; } return; }
    if (f.loading) return;
    f.loading = true;
    const entry = f;
    void this.loadCanvasTexture(this.opts.faceUrl(c), FACE_W, FACE_H).then((t) => {
      if (this.disposed) { t.dispose(); return; }
      entry.tex = t; entry.loading = false;
      this.evictFaces();
      this.requestFrame();
    }).catch(() => { entry.loading = false; });
  }

  private evictFaces() {
    const loaded = [...this.faces.entries()].filter(([, f]) => f.tex);
    if (loaded.length <= MAX_FACES) return;
    loaded.sort((a, b) => a[1].used - b[1].used);
    for (const [c, f] of loaded.slice(0, loaded.length - MAX_FACES)) {
      const card = this.cards.get(c);
      if (card && card.faceMat.map === f.tex) { card.faceMat.map = null; card.faceMat.emissiveMap = null; card.faceMat.emissiveIntensity = 0; card.faceMat.needsUpdate = true; }
      f.tex!.dispose();
      this.faces.delete(c);
    }
  }

  /** Card faces changed (four-colour suits): reload them. */
  refreshFaces() {
    for (const [c, f] of this.faces) {
      f.tex?.dispose();
      const card = this.cards.get(c);
      if (card) { card.faceMat.map = null; card.faceMat.emissiveMap = null; card.faceMat.emissiveIntensity = 0; card.faceMat.needsUpdate = true; }
    }
    this.faces.clear();
    this.requestFrame();
  }

  private meshFor(c: number) {
    let m = this.cards.get(c);
    if (m) return m;
    const g = new THREE.Group();
    g.rotation.order = 'ZXY';
    const body = new THREE.Mesh(this.shared.body, this.shared.bodyMat);
    body.castShadow = true;
    // A little self-light keeps the printed faces as bright as paper under the lamp.
    const faceMat = new THREE.MeshStandardMaterial({ color: 0xf6efdf, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0 });
    const face = new THREE.Mesh(this.shared.faceGeo, faceMat);
    const back = new THREE.Mesh(this.shared.backGeo, this.shared.backMat);
    g.add(body, face, back);
    this.scene.add(g);
    m = { g, faceMat };
    this.cards.set(c, m);
    return m;
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.renderer.setSize(this.w, this.h, false);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    const cam = this.camera;
    cam.aspect = this.w / this.h;
    const d = (this.h / 2) / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    cam.position.set(0, -Math.sin(TILT) * d, Math.cos(TILT) * d);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    cam.near = d * 0.2; cam.far = d * 3;
    cam.updateProjectionMatrix();
    const reach = Math.max(this.w, this.h);
    this.lamp.position.set(-reach * 0.1, reach * 0.14, reach * 1.2);
    this.lamp.target.position.set(0, -this.h * 0.02, 0);
    const sc = this.lamp.shadow.camera as THREE.PerspectiveCamera;
    sc.near = reach * 0.4; sc.far = reach * 2.2;
    this.fitCloth();
    this.requestFrame();
  }

  private fitCloth() {
    const size = Math.max(this.w, this.h) * 2.4;
    this.cloth.scale.set(size, size, 1);
    const t = this.clothMat.map;
    if (t) t.repeat.set(size / 256, size / 256);
  }

  /** The point on the table (at height z, CSS px) that appears at screen position (sx, sy). */
  toTable(sx: number, sy: number, z: number, out = new THREE.Vector3()) {
    const ndc = new THREE.Vector2((sx / this.w) * 2 - 1, -(sy / this.h) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    this.plane.constant = -z;
    return this.ray.ray.intersectPlane(this.plane, out) ?? out.set(sx - this.w / 2, this.h / 2 - sy, z);
  }

  /**
   * Move to a new table: `targets` are the cards on the table now (screen poses from the DOM);
   * any other card leaves the scene. `plan` routes cards that just arrived.
   */
  sync(targets: Map<number, Pose>, plan: Map<number, Flight>, stacks: { stock: Stack | null; pile: Stack | null }, speed: number, jump = false) {
    for (const [c, m] of this.cards) if (!targets.has(c)) { m.g.visible = false; this.flights.poses.delete(c); this.flights.targets.delete(c); }
    this.stackData = stacks;
    if (jump) this.flights.jump(targets); else this.flights.retarget(targets, plan, speed);
    this.requestFrame();
  }

  finish() { this.flights.finish(); }

  requestFrame() {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(t: number) {
    this.raf = 0;
    if (this.disposed) return;
    const continuous = t - this.lastFrameAt < 50;
    this.lastFrameAt = t;
    this.applyStacks();
    this.applyPoses();
    this.renderer.render(this.scene, this.camera);
    this.frames++;
    if (this.flights.moving > 0) {
      if (!this.guard.tripped && this.guard.frame(t, continuous)) this.fail('frames were too slow on this device');
      this.requestFrame();
    }
  }

  private place(obj: THREE.Object3D, x: number, y: number, z: number, w: number) {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    const centre = this.toTable(x, y, z, new THREE.Vector3());
    const ww = this.toTable(x - w / 2, y, z, a).distanceTo(this.toTable(x + w / 2, y, z, b));
    obj.position.copy(centre);
    return ww;
  }

  private applyStacks() {
    for (const key of ['stock', 'pile'] as const) {
      const s = this.stackData[key], m = this.stacks[key];
      if (!s || s.n <= (key === 'pile' ? 1 : 0)) { m.visible = false; continue; }
      const depth = Math.max(1, s.n * THICK);
      const ww = this.place(m, s.x, s.y, 0, s.w);
      m.position.z = 0;
      m.scale.set(ww, ww, depth);
      m.rotation.set(0, 0, THREE.MathUtils.degToRad(-(s.rot ?? 0)));
      m.visible = true;
    }
  }

  private applyPoses() {
    for (const [c, p] of this.flights.poses) {
      const m = this.meshFor(c);
      const z = p.z + 0.6;
      const ww = this.place(m.g, p.x, p.y, z, p.w);
      m.g.scale.set(ww, ww, 0.55);
      m.g.rotation.set(THREE.MathUtils.degToRad(p.tilt), Math.PI * (1 - p.face), THREE.MathUtils.degToRad(-p.rot));
      m.g.visible = p.show > 0.01;
      if (p.face > 0.01) this.faceFor(c, m.faceMat);
    }
  }

  debug() {
    return { moving: this.flights.moving, mismatches: this.flights.mismatches(), cards: [...this.cards.values()].filter((m) => m.g.visible).length, frames: this.frames };
  }

  /** Where the 3D card is on screen (projected centre), for alignment checks. */
  screenOf(c: number): { x: number; y: number } | null {
    const m = this.cards.get(c);
    if (!m || !m.g.visible) return null;
    const v = m.g.position.clone().project(this.camera);
    return { x: (v.x + 1) / 2 * this.w, y: (1 - v.y) / 2 * this.h };
  }

  private fail(reason: string) {
    if (this.disposed) return;
    this.opts.onFallback(reason);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.flights.finish();
    for (const f of this.faces.values()) f.tex?.dispose();
    for (const m of this.cards.values()) m.faceMat.dispose();
    const sh = this.shared;
    [sh.body, sh.faceGeo, sh.backGeo].forEach((g) => g.dispose());
    [sh.bodyMat, sh.backMat].forEach((m) => { m.map?.dispose(); m.dispose(); });
    this.clothMat.map?.dispose(); this.clothMat.dispose(); this.cloth.geometry.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
