/**
 * Which table the player sees: the enhanced 3D table or the flat 2D one.
 *
 * The DOM table is always built and is always what is tapped, focused and read
 * by screen readers; the 3D view only paints underneath it. So falling back is
 * never a loss of function, only of depth, and it happens whenever the device
 * cannot carry the 3D table comfortably: no WebGL 2, a reduced-motion
 * preference, a low-powered device, or frames that turn out to be too slow.
 */
export type TableView = 'auto' | '3d' | '2d';

export interface Capabilities {
  webgl2: boolean;
  /** WebGL is drawn on the CPU (SwiftShader, llvmpipe…). */
  softwareGl: boolean;
  reducedMotion: boolean;
  /** navigator.hardwareConcurrency, or 0 when unknown. */
  cores: number;
  /** navigator.deviceMemory in GB, or null when the browser does not say. */
  memoryGb: number | null;
  /** The user asked for reduced data use (Save-Data / prefers-reduced-data). */
  saveData: boolean;
}

export interface ViewChoice { view: '3d' | '2d'; reason: string }

export function chooseView(setting: TableView, caps: Capabilities, perfDowngraded = false): ViewChoice {
  if (!caps.webgl2) return { view: '2d', reason: 'WebGL 2 is not available' };
  if (caps.reducedMotion) return { view: '2d', reason: 'reduced motion is on' };
  if (setting === '2d') return { view: '2d', reason: 'the flat table was chosen' };
  if (setting === '3d') return { view: '3d', reason: 'the 3D table was chosen' };
  if (perfDowngraded) return { view: '2d', reason: 'frames were too slow on this device' };
  if (caps.softwareGl) return { view: '2d', reason: 'graphics are drawn in software' };
  if (caps.saveData) return { view: '2d', reason: 'data saving is on' };
  if (caps.cores > 0 && caps.cores < 4) return { view: '2d', reason: 'a low-powered processor' };
  if (caps.memoryGb !== null && caps.memoryGb < 3) return { view: '2d', reason: 'limited memory' };
  return { view: '3d', reason: 'this device can carry the 3D table' };
}

let gpu: { webgl2: boolean; software: boolean } | null = null;

/** Renderers that draw WebGL on the CPU: usable, but too slow for the 3D table unless chosen. */
const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

/** Probe the browser once. Tests override with ?view=2d|3d or a stubbed getContext. */
export function detectCapabilities(reducedMotion: boolean): Capabilities {
  if (!gpu) {
    gpu = { webgl2: false, software: false };
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') as WebGL2RenderingContext | null;
      if (gl) {
        gpu.webgl2 = true;
        const hw = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true }) as WebGL2RenderingContext | null;
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
        gpu.software = !hw || SOFTWARE_GL.test(name);
        hw?.getExtension('WEBGL_lose_context')?.loseContext();
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    } catch { /* no WebGL */ }
  }
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  let saveData = !!nav.connection?.saveData;
  try { saveData ||= matchMedia('(prefers-reduced-data: reduce)').matches; } catch { /* */ }
  return { webgl2: gpu.webgl2, softwareGl: gpu.software, reducedMotion, cores: nav.hardwareConcurrency ?? 0, memoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null, saveData };
}

/**
 * Watches frame times while the 3D table is animating. The table only renders
 * while something moves, so idle time is never counted. If the typical frame is
 * slower than the budget over a fair sample, the table asks to fall back to 2D.
 */
export class FrameGuard {
  private samples: number[] = [];
  private last = 0;
  tripped = false;
  private readonly budgetMs: number;
  private readonly sample: number;
  private readonly warmup: number;

  constructor(budgetMs = 34, sample = 90, warmup = 10) {
    this.budgetMs = budgetMs; this.sample = sample; this.warmup = warmup;
  }

  /** Call once per rendered frame with its timestamp; `continuous` is false for the first frame after idle. */
  frame(t: number, continuous: boolean): boolean {
    if (this.tripped) return true;
    if (continuous && this.last) this.samples.push(t - this.last);
    this.last = t;
    if (this.samples.length >= this.sample + this.warmup) {
      const s = this.samples.slice(this.warmup).sort((a, b) => a - b);
      const p75 = s[Math.floor(s.length * 0.75)];
      if (p75 > this.budgetMs) this.tripped = true;
      this.samples = [];
    }
    return this.tripped;
  }
}
