// components/providers/toast-provider.tsx — PUL-106.2b
//
// Mounted once in the root layout. sonner is the toast library shadcn/ui itself now ships
// (its `toast` component is a sonner wrapper), so this is the shadcn-sanctioned choice.

'use client';

import { Toaster } from 'sonner';

export function ToastProvider() {
  return <Toaster position="top-right" richColors closeButton />;
}
