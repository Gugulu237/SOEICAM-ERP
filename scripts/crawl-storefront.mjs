// Public storefront discovery only. Writes public source files, never ERP data.
import fs from 'node:fs/promises';
const directory = 'logs/storefront-crawl';
await fs.mkdir(directory, { recursive: true });
for (const [index, url] of ['https://www.soeicam.com', 'https://soeicam.com', 'http://www.soeicam.com', 'https://soeicam.com/products', 'https://soeicam.com/robots.txt', 'https://soeicam.com/sitemap.xml'].entries()) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const body = await response.text();
    await fs.writeFile(directory + '/page-' + index + '.html', body);
    const assets = [...body.matchAll(/<script[^>]+src=["']([^"']+)/g)].map(match => new URL(match[1], response.url).href);
    await fs.writeFile(directory + '/page-' + index + '-assets.json', JSON.stringify(assets, null, 2));
    console.log(JSON.stringify({ url, status: response.status, final_url: response.url, type: response.headers.get('content-type'), bytes: body.length, title: body.match(/<title[^>]*>([^<]*)/i)?.[1], assets }));
  } catch (error) { console.log(JSON.stringify({ url, error: error.message, cause: error.cause?.code })); }
}
