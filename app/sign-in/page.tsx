'use client';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { GoogleIcon } from '@/components/icons/google-icon';
import { authClient } from '../../lib/auth-client';

function SignInCard() {
  const params = useSearchParams();
  const error = params.get('error');

  return (
    <div className="bg-card text-card-foreground relative w-full max-w-sm rounded-xl border p-8 shadow-sm">
      {/* The wordmark is white on transparent: invert it on the light theme. */}
      <Image
        src="/easygrow.webp"
        alt="EasyGrow"
        width={146}
        height={24}
        priority
        className="mx-auto mb-4 h-6 w-auto invert dark:invert-0"
      />
      <h1 className="mb-8 text-center text-2xl font-semibold">EasyGrowCrm</h1>
      <button
        onClick={() =>
          authClient.signIn.social({
            provider: 'google',
            callbackURL: '/',
            errorCallbackURL: '/sign-in',
          })
        }
        className="hover:bg-muted flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium"
      >
        <GoogleIcon className="size-4" />
        Sign in with Google
      </button>
      {error && (
        <p className="mt-4 text-center text-sm text-red-600">{decodeURIComponent(error)}</p>
      )}
    </div>
  );
}

export default function SignInPage() {
  return (
    <main className="bg-background bg-grid-fade flex min-h-screen items-center justify-center p-4">
      <Suspense>
        <SignInCard />
      </Suspense>
    </main>
  );
}
