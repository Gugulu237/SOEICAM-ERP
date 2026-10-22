// Every opening/refresh requests current recorded balances; no result cache.
// Passing the editor's AbortSignal prevents obsolete requests outliving it.
export async function fetchItemStockSummary(productId, { signal } = {}) {
  if (typeof productId !== 'string' || !productId.trim() || productId.length > 200) throw new Error('Choose an item to view stock');
  const response = await fetch('/api/items/' + encodeURIComponent(productId) + '/stock', { credentials: 'same-origin', cache: 'no-store', signal });
  const data = await response.json().catch(error => {
    if (error.name === 'AbortError') throw error;
    return { error: 'The server returned an invalid stock response.' };
  });
  if (!response.ok || data?.error) throw Object.assign(new Error(data.error || 'Could not load the current stock.'), { status: response.status });
  return data;
}
