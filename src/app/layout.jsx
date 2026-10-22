import '@/index.css';
import Providers from './providers';

// ERP pages belong to the current session; render them per request.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: { default: 'SOEICAM · YOLA ERP', template: '%s · SOEICAM ERP' },
  description: 'SOEICAM operations, production and field sales workspace.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }) {
  return <html lang="en"><body><Providers>{children}</Providers></body></html>;
}
