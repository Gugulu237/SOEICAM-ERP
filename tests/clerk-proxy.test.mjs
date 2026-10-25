import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resumeClerkRequest } from '../src/server/clerk-response.js';
import { verifyLocalInterface } from '../scripts/local-readiness.mjs';

// Offline fixtures in this test worker only. No local credential file is read.
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_' + Buffer.from('offline-fixture.clerk.accounts.dev$').toString('base64');
process.env.CLERK_SECRET_KEY = 'sk_test_offline_fixture_not_a_real_key';
process.env.CLERK_TELEMETRY_DISABLED = '1';
const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require('next/server');
const { clerkMiddleware } = require('@clerk/nextjs/server');
const { getRelativeURL } = require('next/dist/shared/lib/router/utils/relativize-url');

test('installed Clerk/Next loopback rewrites resume routing and retain verified authentication headers', async () => {
  const middleware = clerkMiddleware();
  for (const path of ['/login', '/', '/api/auth/me']) {
    const originalUrl = 'http://127.0.0.1:5174' + path;
    const request = new NextRequest(originalUrl, { headers: {
      host: '127.0.0.1:5174',
      'x-forwarded-host': '127.0.0.1:5174',
      'x-forwarded-proto': 'http',
    } });
    const response = await middleware(request, { waitUntil() {} });
    assert.equal(request.url, 'http://localhost:5174' + path);
    const rewrite = response.headers.get('x-middleware-rewrite');
    assert.equal(rewrite, request.url);
    assert.match(getRelativeURL(rewrite, originalUrl), /^http:/, 'the uncorrected rewrite is treated as an external proxy');
    const originalHeaders = [...response.headers].filter(([key]) => key !== 'x-middleware-rewrite');
    const result = resumeClerkRequest(request, response);
    assert.equal(result.headers.get('x-middleware-rewrite'), null);
    assert.equal(result.headers.get('x-middleware-next'), '1');
    assert.equal(result.headers.get('x-middleware-request-x-clerk-auth-status'), 'signed-out');
    for (const [key, value] of originalHeaders) assert.equal(result.headers.get(key), value, key);
  }
});

test('Clerk redirects, errors and rewrites to different destinations are preserved', () => {
  const request = new NextRequest('http://localhost:5174/login');
  for (const response of [
    NextResponse.redirect('https://example.test/sign-in'),
    NextResponse.rewrite('https://example.test/login'),
    NextResponse.rewrite('http://localhost:5174/register'),
    NextResponse.rewrite('http://localhost:5174/login?handshake=required'),
    new NextResponse(null, { status: 401, headers: { 'x-middleware-rewrite': request.url } }),
  ]) {
    const before = [...response.headers];
    assert.equal(resumeClerkRequest(request, response), response);
    assert.deepEqual([...response.headers], before);
  }
});

function interfaceFetcher({ loginStatus = 200, assetStatus = 200, loginHangs = false } = {}) {
  const requests = [];
  const fetcher = async (url, { signal }) => {
    requests.push(url.pathname);
    if (url.pathname === '/api/health') return Response.json({ application: 'SOEICAM ERP', configured: true });
    if (url.pathname === '/login') {
      if (loginHangs) return new Promise((resolve, reject) => {
        const hold = setTimeout(resolve, 1000);
        signal.addEventListener('abort', () => { clearTimeout(hold); reject(signal.reason); }, { once: true });
      });
      return new Response('<link href="/_next/static/app.css"><script src="/_next/static/app.js"></script>', { status: loginStatus });
    }
    return new Response('asset', { status: assetStatus, headers:{'content-type':url.pathname.endsWith('.js')?'application/javascript':'text/css'} });
  };
  return { fetcher, requests };
}

test('local readiness checks the actual login and its CSS/JavaScript', async () => {
  const { fetcher, requests } = interfaceFetcher();
  const result = await verifyLocalInterface('http://localhost:5174', { fetcher });
  assert.equal(result.assets, 2);
  assert.deepEqual(requests, ['/api/health', '/login', '/_next/static/app.css', '/_next/static/app.js']);
});

test('a successful health endpoint cannot hide a broken login or missing build assets', async () => {
  for (const options of [{ loginStatus: 500 }, { assetStatus: 404 }, { loginHangs: true }]) {
    const { fetcher } = interfaceFetcher(options);
    await assert.rejects(verifyLocalInterface('http://localhost:5174', { fetcher, timeout: 30 }));
  }
});
