// Clerk uses a rewrite to the current URL to forward its authentication headers.
// Next.js normalizes loopback IPs to localhost. Against an IP-bound server that
// rewrite becomes an external request back into the same proxy and never renders.
// Resume routing directly, keeping every Clerk request/header override intact.
export function resumeClerkRequest(request, response) {
  const rewrite = response?.headers.get('x-middleware-rewrite');
  if (!rewrite || response.status !== 200 || response.headers.has('location')) return response;
  if (new URL(rewrite).href === new URL(request.url).href) {
    response.headers.delete('x-middleware-rewrite');
    response.headers.set('x-middleware-next', '1');
  }
  return response;
}
