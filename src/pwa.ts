/**
 * Registrace service workeru (jen v produkčním buildu).
 * Nová verze čeká, dokud hráč není na úvodní obrazovce – nikdy se nepřepne uprostřed levelu.
 */
let waiting: ServiceWorker | null = null;
let reloading = false;

export function registerServiceWorker(): void {
  const env = (import.meta as unknown as { env?: { PROD?: boolean } }).env;
  if (!env?.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        if (reg.waiting) waiting = reg.waiting;
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          sw?.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) waiting = sw;
          });
        });
      })
      .catch(() => undefined);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  });
}

/** Zavolej, když je bezpečné přepnout na novou verzi (hráč je na úvodní obrazovce). */
export function applyPendingUpdate(): void {
  if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
}
