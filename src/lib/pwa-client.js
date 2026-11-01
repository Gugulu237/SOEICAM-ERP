// Browser lifecycle kept independent of React so installation and update races are testable.
export function createPwaClient(browser, onChange, {enableWorker = false} = {}) {
  const nav = browser.navigator, display = browser.matchMedia('(display-mode: standalone)');
  let disposed = false, prompt = null, installing = false, lastUpdateCheck = 0;
  const cleanup = [];
  let state = {
    ready: true, installed: display.matches || nav.standalone === true,
    secure: Boolean(browser.isSecureContext), canPrompt: false, installing: false,
    offline: nav.onLine === false, updateReady: false, workerError: false,
  };
  const publish = patch => {state = {...state, ...patch}; if (!disposed) onChange(state);};
  const listen = (target, name, callback) => {
    target.addEventListener(name, callback);
    cleanup.push(() => target.removeEventListener(name, callback));
  };
  listen(browser, 'beforeinstallprompt', event => {
    if (!state.secure || state.installed) return;
    event.preventDefault(); prompt = event; publish({canPrompt: true});
  });
  listen(browser, 'appinstalled', () => {prompt = null; publish({installed: true, canPrompt: false});});
  listen(display, 'change', () => publish({installed: display.matches || nav.standalone === true}));
  listen(browser, 'online', () => publish({offline: false}));
  listen(browser, 'offline', () => publish({offline: true}));
  publish({});

  // Production only: development/HMR chunks must never enter persistent caches.
  if (enableWorker && state.secure && nav.serviceWorker && browser.top === browser.self) {
    nav.serviceWorker.register('/sw.js', {scope: '/', updateViaCache: 'none'}).then(registration => {
      if (disposed) return;
      const inspect = () => {
        if (registration.waiting && nav.serviceWorker.controller) publish({updateReady: true});
      };
      const watch = () => {
        const worker = registration.installing;
        if (worker) listen(worker, 'statechange', inspect);
        inspect();
      };
      listen(registration, 'updatefound', watch); watch();
      // No forced reload or skipWaiting; open forms and other tabs remain untouched.
      listen(browser.document, 'visibilitychange', () => {
        if (browser.document.visibilityState !== 'visible' || nav.onLine === false || Date.now() - lastUpdateCheck < 3600000) return;
        lastUpdateCheck = Date.now(); registration.update().catch(() => {});
      });
    }).catch(() => publish({workerError: true}));
  }
  return {
    async install() {
      if (installing || state.installed) return 'unavailable';
      if (!prompt) return 'instructions';
      const event = prompt; prompt = null; installing = true; publish({installing: true, canPrompt: false});
      try {
        // Call prompt synchronously in the user's click gesture, only once per event.
        const choice = await event.prompt();
        const result = choice || await event.userChoice;
        return result?.outcome === 'accepted' ? 'accepted' : 'dismissed';
      } catch {return 'instructions';}
      finally {installing = false; publish({installing: false});}
    },
    dispose() {disposed = true; prompt = null; cleanup.forEach(fn => fn());},
  };
}
