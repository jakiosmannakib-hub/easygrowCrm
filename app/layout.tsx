import { ToastProvider } from '@/components/providers/toast-provider';
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
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ToastProvider />
      </body>
    </html>
  );
}
