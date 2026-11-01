export default function manifest() {
  return {
    id: '/',
    name: 'SOEICAM ERP',
    short_name: 'SOEICAM',
    description: 'SOEICAM operations, production and field sales workspace.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f6faf4',
    theme_color: '#347623',
    prefer_related_applications: false,
    icons: [
      {src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any'},
      {src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any'},
      {src: '/pwa/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable'},
    ],
  };
}
