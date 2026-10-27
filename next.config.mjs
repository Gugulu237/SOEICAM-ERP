/** @type {import('next').NextConfig} */
const config = {
  poweredByHeader: false,
  images: {minimumCacheTTL:86400,remotePatterns:[{protocol:'https',hostname:'raw.githubusercontent.com',pathname:'/Gugulu237/SOEICAM/33d6fb5964f26ed01764f35f538bb2a90cdeded5/public/brand/logos/yola.png',search:''}]},
  reactStrictMode: true,
  cleanDistDir: process.platform !== 'win32',
  serverExternalPackages: ['postgres'],
  // Keep build filesystem work in one process on restricted Windows hosts.
  experimental: { cpus: 1, webpackBuildWorker: false, serverActions: { bodySizeLimit: '20mb' } },
  webpack(config) { config.parallelism = 1; return config; },
  async headers() {
    return [
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'private, no-store' }, { key: 'X-Content-Type-Options', value: 'nosniff' }] },
      { source: '/products/optimized/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    ];
  },
};
export default config;
