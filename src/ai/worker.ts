/// <reference lib="webworker" />
import { decide } from './policy.ts';
import type { PublicView } from '../engine/view.ts';
import type { AiLevel } from '../engine/match.ts';

/** Runs computer decisions off the main thread so the table never stalls. */
self.onmessage = (e: MessageEvent<{ id: number; view: PublicView; level: AiLevel; persona?: string }>) => {
  const { id, view, level, persona } = e.data;
  const t0 = performance.now();
  try {
    const move = decide(view, level, persona);
    (self as unknown as Worker).postMessage({ id, move, ms: performance.now() - t0 });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
