// app/page.tsx — PUL-110.6
//
// The root has no content of its own; it sends signed-in users to their dashboard. A signed-out
// visitor is bounced to /sign-in by middleware before this renders, and by the (app) layout if
// middleware is bypassed.

import { redirect } from 'next/navigation';

export default function RootPage() {
  redirect('/dashboard');
}
