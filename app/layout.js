import { Roboto_Mono } from 'next/font/google';
import './globals.css';
import AuthProvider from '@/components/AuthProvider';
import AlertToastProvider from '@/components/AlertToastProvider';
import { ThemeProvider, themeInitScript } from '@/components/ThemeProvider';

const robotoMono = Roboto_Mono({ subsets: ['latin'], variable: '--font-roboto-mono', weight: ['300', '400', '500', '600', '700'] });

export const metadata = {
  title: 'Realzentic Dubai — Real Estate CRM',
  description: 'AI-powered CRM for Dubai real-estate sales, rentals, off-plan projects, property viewings, and client relationships.',
};

// viewport-fit=cover is required for env(safe-area-inset-*) to report real
// values on mobile (notches + Android/iOS navigation bars). Without it those
// insets are always 0 and bottom sheets collide with the device nav bar.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          This script runs before hydration to prevent a theme flash. It is
          intentionally inline, so suppress an attribute mismatch if a
          browser is finishing hydration with a cached pre-deployment client
          bundle; the rendered application tree remains fully hydrated.
        */}
        <script
          id="realzentic-theme-init"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body suppressHydrationWarning className={`${robotoMono.variable} font-sans antialiased`}>
        <ThemeProvider>
          <AuthProvider>
            <AlertToastProvider>
              {children}
            </AlertToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
