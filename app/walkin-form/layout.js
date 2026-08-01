import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], weight: ['300', '400', '500', '600', '700'] });

export const metadata = {
  title: 'Welcome — Register Your Visit',
  description: 'Register your Dubai property enquiry. Our team will assist you shortly.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function WalkinFormLayout({ children }) {
  return (
    <div className={inter.className}>
      {children}
    </div>
  );
}
