/**
 * Offline support: registers the build's service worker and offers updates
 * without ever interrupting a match. A new worker waits until the player chooses
 * to reload (or the app is next opened), and the saved match survives either way.
 */
let reg: ServiceWorkerRegistration | null = null;
export let updateReady = false;
type Listener = () => void;
const listeners: Listener[] = [];
export const onUpdateReady = (f: Listener) => listeners.push(f);

export function registerSW() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  navigator.serviceWorker.register('./sw.js').then((r) => {
    reg = r;
    const watch = (w: ServiceWorker | null) => {
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) { updateReady = true; listeners.forEach((f) => f()); }
      });
    };
    if (r.waiting && navigator.serviceWorker.controller) { updateReady = true; listeners.forEach((f) => f()); }
    watch(r.installing);
    r.addEventListener('updatefound', () => watch(r.installing));
  }).catch(() => undefined);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading && pendingReload) { reloading = true; location.reload(); } });
}

let pendingReload = false;
/** Activate a waiting update and reload. The match is already saved after every action. */
export function applyUpdate() {
  if (!reg?.waiting) { location.reload(); return; }
  pendingReload = true;
  reg.waiting.postMessage('skipWaiting');
}

export async function checkForUpdate(): Promise<string> {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return 'Updates are handled by the development server.';
  try {
    const res = await fetch('./version.json', { cache: 'no-store' });
    const remote = await res.json();
    await reg?.update();
    if (remote.sha && remote.sha !== __BUILD__.sha) return `Version ${remote.version} (${remote.sha}) is available. It installs in the background; reopen the app to use it.`;
    return 'You have the latest version.';
  } catch {
    return 'Could not check for updates (offline?). The game works offline as installed.';
  }
}

export async function offlineStatus(): Promise<string> {
  if (!('serviceWorker' in navigator)) return 'This browser cannot install Canasta for offline play.';
  if (import.meta.env.DEV) return 'Development build: offline caching is off.';
  try {
    const keys = await caches.keys();
    const mine = keys.filter((k) => k.startsWith('canasta-'));
    if (!mine.length) return 'Preparing offline copy…';
    const c = await caches.open(mine[mine.length - 1]);
    const n = (await c.keys()).length;
    return `Ready for offline play: ${n} files cached (${mine.join(', ')}).${navigator.onLine ? '' : ' You are offline.'}`;
  } catch {
    return 'Offline status unavailable.';
  }
}
