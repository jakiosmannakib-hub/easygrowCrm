'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { authClient } from '../../lib/auth-client';

function SignInCard() {
  const params = useSearchParams();
  const error = params.get('error');

  return (
    <div className="w-full max-w-sm rounded-xl border bg-white p-8 shadow-sm">
      <h1 className="mb-8 text-center text-2xl font-semibold">EasyGrowCrm</h1>
      <button
        onClick={() =>
          authClient.signIn.social({
            provider: 'google',
            callbackURL: '/',
            errorCallbackURL: '/sign-in',
          })
        }
        className="w-full rounded-md border px-4 py-2 text-sm font-medium hover:bg-neutral-50"
      >
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
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
      <Suspense>
        <SignInCard />
      </Suspense>
    </main>
  );
}
