import type { Metadata, Viewport } from 'next';
import tokens from '../../../packages/ui/tokens/tokens.json';
import { SITE_URL } from '../lib/site';
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

// mobile browser chrome follows the theme; colours from the design tokens (rule 2), not literals
const bg = tokens.color.tokens.find((t) => t.name === 'bg')!.value;
export const viewport: Viewport = {
  colorScheme: 'dark light',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: bg.dark },
    { media: '(prefers-color-scheme: light)', color: bg.light },
  ],
};

export const metadata: Metadata = {
  // absolute Open Graph image URLs need a base; without one Next falls back to localhost
  ...(SITE_URL && { metadataBase: new URL(SITE_URL) }),
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
