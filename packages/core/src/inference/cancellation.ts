import type { InferenceCancellation } from './types.js';

/** Internal disposal also drops adapter listeners when an operation has finished. */
export function cancellation(): InferenceCancellation & { dispose(): void } {
  let cancelled = false;
  let disposed = false;
  const listeners = new Set<() => void>();
  function notify(listener: () => void): void {
    try { listener(); } catch { /* One consumer cannot stop cancellation of the others. */ }
  }
  return {
    token: Object.freeze({
      get cancelled() { return cancelled; },
      subscribe(listener: () => void) {
        if (cancelled) { notify(listener); return () => undefined; }
        if (disposed) return () => undefined;
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
    }),
    cancel() {
      if (cancelled || disposed) return;
      cancelled = true;
      const pending = [...listeners];
      listeners.clear();
      for (const listener of pending) notify(listener);
    },
    dispose() { disposed = true; listeners.clear(); },
  };
}
export function createInferenceCancellation(): InferenceCancellation {
  const { token, cancel } = cancellation();
  return { token, cancel };
}
