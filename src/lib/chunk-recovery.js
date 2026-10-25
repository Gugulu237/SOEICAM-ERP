export function isChunkLoadFailure(error) {
  return error?.name === 'ChunkLoadError' || /Loading (?:CSS )?chunk .+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(error?.message || '');
}
export function recoverChunkLoad(error, browser, now = Date.now()) {
  if (!isChunkLoadFailure(error) || !browser?.location) return false;
  try {
    const key = 'soeicam:chunk-reload:' + browser.location.pathname;
    const previous = Number(browser.sessionStorage.getItem(key));
    if (previous > 0 && now - previous < 60000) return false;
    browser.sessionStorage.setItem(key, String(now));
    browser.location.reload();
    return true;
  } catch { return false; } // With storage blocked, offer manual reload rather than a loop.
}
