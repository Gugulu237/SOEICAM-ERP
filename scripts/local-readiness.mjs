export async function verifyLocalInterface(address, { fetcher = fetch, timeout = 5000, pages = ['/login'] } = {}) {
  async function get(path) {
    const response = await fetcher(new URL(path,address),{signal:AbortSignal.timeout(timeout),cache:'no-store',redirect:'error'});
    if(!response.ok)throw new Error(path+': HTTP '+response.status);
    return response;
  }
  const health=await (await get('/api/health')).json();
  if(health.application!=='SOEICAM ERP'||!health.configured)throw new Error('The local ERP is not configured.');
  const assets=new Set();
  for(const page of pages){
    const html=await (await get(page)).text();
    const matches=[...html.matchAll(/(?:src|href)=["'](\/_next\/static\/[^"']+)["']/g)];
    if(!matches.length)throw new Error(page+': no Next.js assets were found.');
    matches.forEach(match=>assets.add(match[1].replaceAll('&amp;','&')));
  }
  // A successful health endpoint cannot prove the browser can download its layout.
  for(const asset of assets){
    const response=await get(asset),type=response.headers.get('content-type')||'';
    if(/\.js(?:\?|$)/.test(asset)&&!/(?:javascript|ecmascript)/i.test(type))throw new Error('The server did not return JavaScript for '+asset);
    await response.arrayBuffer();
  }
  return {health,assets:assets.size,pages:pages.length};
}
