export async function verifyLocalInterface(address, { fetcher = fetch, timeout = 5000 } = {}) {
  async function get(path) {
    const response = await fetcher(new URL(path, address), { signal: AbortSignal.timeout(timeout), cache: 'no-store', redirect: 'error' });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response;
  }
  const health = await (await get('/api/health')).json();
  if (health.application !== 'SOEICAM ERP' || !health.configured) throw new Error('The local ERP is not configured.');
  // /api/health skips the authentication proxy; it cannot prove pages render.
  const html = await (await get('/login')).text();
  const assets = [...new Set([...html.matchAll(/(?:src|href)=["'](\/_next\/static\/[^"']+)["']/g)].map(match => match[1].replaceAll('&amp;', '&')))];
  if (!assets.length) throw new Error('The login page has no Next.js assets.');
  await Promise.all(assets.map(async asset => { await (await get(asset)).arrayBuffer(); }));
  return { health, assets: assets.length };
}
