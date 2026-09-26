import type { AiLevel } from '../engine/match.ts';
import type { PublicView } from '../engine/view.ts';
import { decide, type AiMove } from './policy.ts';

/**
 * Asks the AI worker for a move. Falls back to the main thread if workers are
 * unavailable. The worker receives only a PublicView — the same object a human
 * seat's UI renders from.
 */
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (r: { move?: AiMove; error?: string; ms?: number }) => void>();
export const aiStats = { decisions: 0, msTotal: 0, msMax: 0 };

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const cb = pending.get(e.data.id); if (cb) { pending.delete(e.data.id); cb(e.data); } };
    worker.onerror = () => { worker = null; for (const [, cb] of pending) cb({ error: 'worker failed' }); pending.clear(); };
  } catch { worker = null; }
  return worker;
}

export function requestMove(view: PublicView, level: AiLevel, persona?: string): Promise<AiMove> {
  const w = getWorker();
  const local = () => { const t0 = performance.now(); const m = decide(view, level, persona); record(performance.now() - t0); return m; };
  if (!w) return Promise.resolve(local());
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, (r) => { if (r.move) { record(r.ms ?? 0); resolve(r.move); } else resolve(local()); });
    w.postMessage({ id, view, level, persona });
  });
}

function record(ms: number) {
  aiStats.decisions++; aiStats.msTotal += ms; aiStats.msMax = Math.max(aiStats.msMax, ms);
}
