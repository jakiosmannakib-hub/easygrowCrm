// proxy.ts — PUL-110.5
//
// CONVENIENCE ONLY. This is NOT the security boundary (§9.5).
//
// (Next 16 renamed the "middleware" file convention to "proxy"; same hook, same caveats.)
//
// It exists so a signed-out visitor lands on /sign-in instead of watching a shell flash and
// then redirect. It checks only that a session COOKIE IS PRESENT — it never calls getSession
// and never trusts the cookie's contents. Middleware-only protection is defeated by header
// spoofing (CVE-2025-29927), and a cookie can be forged; the real check is
// `requireRouteAccess` running on the server inside every page.

import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';

export default function proxy(request: NextRequest) {
  // Presence check only — no verification, deliberately.
  if (getSessionCookie(request)) return NextResponse.next();

  const signIn = new URL('/sign-in', request.url);
  return NextResponse.redirect(signIn);
}

export const config = {
  // Everything except /sign-in, the auth API, Next internals and static assets.
  matcher: [
    '/((?!sign-in|api|_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
