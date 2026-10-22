/** @type {import('next').NextConfig} */
const config = {
  poweredByHeader: false,
  reactStrictMode: true,
  cleanDistDir: process.platform !== 'win32',
  serverExternalPackages: ['postgres'],
  // Keep build filesystem work in one process on restricted Windows hosts.
  experimental: { cpus: 1, webpackBuildWorker: false, serverActions: { bodySizeLimit: '20mb' } },
  webpack(config) { config.parallelism = 1; return config; },
  async headers() {
    return [{ source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'private, no-store' }, { key: 'X-Content-Type-Options', value: 'nosniff' }] }];
  },
};
export default config;
