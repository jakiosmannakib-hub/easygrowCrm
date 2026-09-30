import { ToastProvider } from '@/components/providers/toast-provider';
import { SIDEBAR_INIT_SCRIPT } from '@/components/shell/sidebar-pref';
import { cn } from '@/lib/utils';
import type { Metadata } from 'next';
import { Geist, Geist_Mono, Noto_Sans, Outfit } from 'next/font/google';
import { ReactNode } from 'react';
import './globals.css';

const outfitHeading = Outfit({
  subsets: ['latin'],
  variable: '--font-heading',
});

const notoSans = Noto_Sans({ subsets: ['latin'], variable: '--font-sans' });

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'EGD CRM',
  description: 'EasyGrow digital CRM Platform',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={cn(
        'h-full',
        'antialiased',
        geistSans.variable,
        geistMono.variable,
        'font-sans',
        notoSans.variable,
        outfitHeading.variable,
      )}
      // SIDEBAR_INIT_SCRIPT sets `data-sidebar` on this element before hydration (PUL-422).
      // This suppresses the mismatch warning for <html>'s own attributes only, not its subtree.
      suppressHydrationWarning
    >
      <head>
        {/*
          Runs before the body is parsed, so a saved sidebar choice is on <html> before first
          paint and the CSS draws the right width with no flash. See sidebar-pref.ts.
        */}
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <ToastProvider />
      </body>
    </html>
  );
}
