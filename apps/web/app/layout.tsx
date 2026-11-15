import type { Metadata } from 'next';
import { Martian_Mono, Sora } from 'next/font/google';
import type { ReactNode } from 'react';
import { prefsScript } from '../lib/prefs';
import './globals.css';

const sora = Sora({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
});
const mono = Martian_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: { template: '%s · Kafka Inspector', default: 'Kafka Inspector' },
  description: 'A real-time UI for Apache Kafka.',
  icons: {
    icon: [
      { url: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/brand/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    shortcut: '/brand/favicon.ico',
    apple: '/brand/favicon-180.png',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-theme / data-motion are set by prefsScript before hydration, hence suppressHydrationWarning.
    <html lang="en" className={`${sora.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: prefsScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
