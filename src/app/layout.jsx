import '@/index.css';
import '@/mobile-sleek.css';
import Providers from './providers';

// ERP pages belong to the current session; render them per request.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: { default: 'SOEICAM · YOLA ERP', template: '%s · SOEICAM ERP' },
  description: 'SOEICAM operations, production and field sales workspace.',
  applicationName: 'SOEICAM ERP',
  appleWebApp: {capable: true, title: 'SOEICAM', statusBarStyle: 'default'},
  icons: {icon: '/pwa/icon-192.png', apple: '/pwa/apple-touch-icon.png'},
  robots: { index: false, follow: false },
};
export const viewport = {width: 'device-width', initialScale: 1, themeColor: '#347623'};
export default function RootLayout({ children }) {
  return <html lang="en"><body><Providers>{children}</Providers></body></html>;
}
