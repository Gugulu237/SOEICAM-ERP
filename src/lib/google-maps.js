export function loadGoogleMaps(apiKey) {
  if (!apiKey) return Promise.reject(new Error('The customer map is not configured yet. GPS capture and Google Maps directions are still available.'));
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  if (window.__soeicamMapsPromise) return window.__soeicamMapsPromise;
  window.__soeicamMapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let done = false;
    const fail = () => {
      if (done) return;
      done = true; clearTimeout(timeout); script.remove(); delete window.__soeicamMapsReady; window.__soeicamMapsPromise = null;
      reject(new Error('Google Maps could not load. Check the map key, enabled Maps JavaScript API, billing and website restrictions. GPS capture still works.'));
    };
    const timeout = setTimeout(fail, 20000);
    window.gm_authFailure = () => { window.dispatchEvent(new Event('soeicam:maps-auth-error')); fail(); };
    window.__soeicamMapsReady = () => {
      if (done) return;
      done = true; clearTimeout(timeout); delete window.__soeicamMapsReady; resolve(window.google.maps);
    };
    const query = new URLSearchParams({ key: apiKey, loading: 'async', callback: '__soeicamMapsReady', v: 'quarterly', region: 'CM' });
    script.src = 'https://maps.googleapis.com/maps/api/js?' + query;
    script.async = true; script.onerror = fail;
    document.head.append(script);
  });
  return window.__soeicamMapsPromise;
}
