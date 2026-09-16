// features/auth/oauth-link-provisioned.test.ts
//
// Regression test for ACCOUNT_NOT_LINKED: an employee provisioned through the UI could never
// sign in with Google (PUL-202's "new employee can immediately Google-sign-in" was never true).
//
// WHAT THIS DRIVES
//   - The provisioned row is created by the real `createEmployee` action, so it has exactly the
//     shape production writes: `email_verified = false`, no `account` row.
//   - The sign-in decision is Better Auth's own `handleOAuthUserInfo` (public export
//     `better-auth/oauth2`) — the function the Google callback hands the verified profile to,
//     and the one that returned "account not linked". It runs against the REAL `auth` instance
//     from lib/auth.ts (its `$context`: our accountLinking options, trustedProviders, drizzle
//     adapter and databaseHooks) and the real test database. Nothing in that path is mocked.
//   - So every case below goes through: account-owner lookup → user-by-email lookup → the
//     link decision (`requireLocalEmailVerified` etc.) → account insert → user.create.before /
//     session.create.before hooks → session insert.
//
// WHAT THIS DOES NOT PROVE
//   - The HTTP half of OAuth: the redirect to Google, state/PKCE cookie checks, the code-for-
//     token exchange, and ID-token verification. Those need Google and a browser; the profile
//     Google would return is supplied here as `userInfo` instead. A misconfigured client id or
//     callback URL would still only show up in a real sign-in.
//   - That the callback route calls it with these exact options. In 1.7.2
//     (dist/api/routes/callback.mjs) it passes userInfo, account, callbackURL, source,
//     `disableSignUp` and `overrideUserInfo` — the last two come from provider options this app
//     does not set, and it passes none of `selectedUser` / `isTrustedProvider` /
//     `requireExactAccountBinding`, the options that alter the link decision. Re-check on upgrade.
//
// The only stub is `auth.api.getSession`, for the `createEmployee` call that provisions the
// row (a vitest run has no request cookie) — the same stub every action test uses.

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleOAuthUserInfo } from 'better-auth/oauth2';
import { db } from '../../db';
import { account as accountTable, session as sessionTable, user as userTable } from '../../db/schema';
import { auth } from '../../lib/auth';
import { expectOk } from '../../tests/expect-result';
import { assertTestDb, seedMinimal, type MinimalSeed } from '../../tests/seed';

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

const { createEmployee } = await import('../employees/actions');

const GOOGLE_ISSUER = 'https://accounts.google.com';
const NEW_HIRE_EMAIL = 'new.hire@test.local';
const GOOGLE_SUB = '100000000000000000001';

let seed: MinimalSeed;

const GOOGLE_IMAGE = 'https://lh3.googleusercontent.com/a/test-avatar=s96-c';
/**
 * Deliberately NOT the name the row is provisioned with ('New Hire'). Google carrying a
 * different spelling is the whole point of the `name`-is-untouched assertions below.
 */
const GOOGLE_NAME = 'Nu Hyre (Google spelling)';

/** The profile Google's callback would hand Better Auth for `email`. */
function googleProfile(email: string, sub = GOOGLE_SUB, image: string | null = GOOGLE_IMAGE) {
  return {
    userInfo: {
      id: sub,
      email,
      emailVerified: true, // Google verifies the address it returns
      name: GOOGLE_NAME,
      image,
    },
    account: {
      providerId: 'google',
      issuer: GOOGLE_ISSUER,
      accountId: sub,
      accessToken: 'test-access-token',
      idToken: 'test-id-token',
      scope: 'openid,email,profile',
    },
  };
}

/**
 * The endpoint context type, taken from the function itself — `@better-auth/core` is not a
 * direct dependency of this app, so its type is not imported by name.
 */
type EndpointContext = Parameters<typeof handleOAuthUserInfo>[0];

/**
 * Run Better Auth's OAuth user-info handler with the real configured context.
 *
 * Only `context` is supplied. That is everything `handleOAuthUserInfo` reads on this path in
 * 1.7.2 (internalAdapter, options, trustedProviders, logger, socialProviders); the request-
 * bound parts of a real endpoint context (headers, cookies) are what the callback route uses
 * AFTER this returns, to set the session cookie — outside what this test claims to cover.
 */
async function signInWithGoogle(email: string, sub?: string, image?: string | null) {
  const context = await auth.$context;
  return handleOAuthUserInfo({ context } as unknown as EndpointContext, {
    ...googleProfile(email, sub, image),
    // READ from the configured provider rather than hardcoded, exactly as the callback route
    // does in 1.7.2 (`overrideUserInfo: provider.options?.overrideUserInfoOnSignIn`). This is
    // load-bearing: hardcoding `true` here makes the override path run no matter what
    // lib/auth.ts says, so the image assertions would pass even with the fix backed out — the
    // test would be pinning Better Auth's behaviour instead of our configuration. Verified by
    // removing the options and watching these cases go red.
    overrideUserInfo: (
      context.socialProviders.find((p) => p.id === 'google') as
        | { options?: { overrideUserInfoOnSignIn?: boolean } }
        | undefined
    )?.options?.overrideUserInfoOnSignIn,
  });
}

/** Provision through the real action, as SA — the row shape production writes. */
async function provision(email: string) {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    user: { id: seed.superAdmin.id },
  } as Awaited<ReturnType<typeof auth.api.getSession>>);
  const row = expectOk(
    await createEmployee({ email, name: 'New Hire', role: 'admin_hr' }),
  );
  vi.restoreAllMocks();
  return row;
}

async function userByEmail(email: string) {
  return db.select().from(userTable).where(eq(userTable.email, email));
}

beforeEach(async () => {
  seed = await seedMinimal(); // asserts the test DB and wipes user/account/session
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Google sign-in links a provisioned, unverified row (ACCOUNT_NOT_LINKED regression)', () => {
  it('links the account, verifies the email, and opens a session for the provisioned user', async () => {
    const provisioned = await provision(NEW_HIRE_EMAIL);
    // The precondition the bug needs — asserted, not assumed.
    expect(provisioned.emailVerified).toBe(false);
    expect(await db.select().from(accountTable).where(eq(accountTable.userId, provisioned.id))).toHaveLength(0);

    const result = await signInWithGoogle(NEW_HIRE_EMAIL);

    // With the default `requireLocalEmailVerified: true` this is { error: 'account not linked' }.
    expect(result.error).toBeNull();
    expect(result.isRegister).toBe(false);
    expect(result.data?.user.id).toBe(provisioned.id);
    expect(result.data?.session.userId).toBe(provisioned.id);

    // Linked to the EXISTING row — no second user was created.
    const users = await userByEmail(NEW_HIRE_EMAIL);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id: provisioned.id, role: 'admin_hr', emailVerified: true });

    const accounts = await db.select().from(accountTable).where(eq(accountTable.userId, provisioned.id));
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ providerId: 'google', issuer: GOOGLE_ISSUER, accountId: GOOGLE_SUB });

    expect(await db.select().from(sessionTable).where(eq(sessionTable.userId, provisioned.id))).toHaveLength(1);
  });

  it('a second sign-in reuses the linked account (the already-linked branch)', async () => {
    const provisioned = await provision(NEW_HIRE_EMAIL);
    expect((await signInWithGoogle(NEW_HIRE_EMAIL)).error).toBeNull();

    const again = await signInWithGoogle(NEW_HIRE_EMAIL);

    expect(again.error).toBeNull();
    expect(again.data?.user.id).toBe(provisioned.id);
    expect(await db.select().from(accountTable).where(eq(accountTable.userId, provisioned.id))).toHaveLength(1);
  });
});

describe('Google profile-picture sync (PUL-113)', () => {
  it('backfills image on the first link, and leaves the HR-owned name alone', async () => {
    const provisioned = await provision(NEW_HIRE_EMAIL);
    // Preconditions the bug needs: no picture yet, and HR's spelling is on the row.
    expect(provisioned.image).toBeNull();
    expect(provisioned.name).toBe('New Hire');

    expect((await signInWithGoogle(NEW_HIRE_EMAIL)).error).toBeNull();

    const [row] = await userByEmail(NEW_HIRE_EMAIL);
    expect(row?.image).toBe(GOOGLE_IMAGE);
    // THE load-bearing assertion. Google offered 'Nu Hyre (Google spelling)' and was ignored:
    // `name` belongs to HR via updateEmployee (PUL-203). If this ever fails, a sign-in is
    // silently reverting HR's corrections.
    expect(row?.name).toBe('New Hire');
  });

  it('a later sign-in updates a changed photo, still without touching the name', async () => {
    const provisioned = await provision(NEW_HIRE_EMAIL);
    await signInWithGoogle(NEW_HIRE_EMAIL);
    // HR corrects the spelling AFTER the link — the case that makes this rule matter.
    assertTestDb();
    await db.update(userTable).set({ name: 'Corrected Name' }).where(eq(userTable.id, provisioned.id));

    const changed = `${GOOGLE_IMAGE}&v=2`;
    expect((await signInWithGoogle(NEW_HIRE_EMAIL, undefined, changed)).error).toBeNull();

    const [row] = await userByEmail(NEW_HIRE_EMAIL);
    expect(row?.image).toBe(changed); // a new Google photo propagates
    expect(row?.name).toBe('Corrected Name'); // HR's correction survives the sign-in
  });

  it('a user who has never signed in keeps image NULL (the initials-fallback case)', async () => {
    // Not a bug to paper over: the header renders initials() for exactly this row, and it is
    // the normal state for everyone SA/HR has provisioned but who has not yet signed in.
    const provisioned = await provision(NEW_HIRE_EMAIL);
    expect(provisioned.image).toBeNull();

    const [row] = await userByEmail(NEW_HIRE_EMAIL);
    expect(row?.image).toBeNull();
  });
});

describe('the gates the fix must NOT open', () => {
  it('an unprovisioned email is still refused, and nothing is written', async () => {
    const usersBefore = await db.select().from(userTable);

    // The load-bearing assertion is that it REJECTS and writes nothing. `requireLocalEmailVerified`
    // is only consulted when a user already matches, so this register branch is untouched by the fix.
    //
    // Pinned to the CURRENT refusal on purpose, because it is not the one you would expect: in
    // Better Auth 1.7.2 the register branch parses our additionalFields first, and `role`
    // (required, input: false, no default) throws "role is required" BEFORE user.create.before —
    // so `guardProvisioned` never runs for a stranger. Fail-closed, but by a schema check rather
    // than our gate, and with the wrong message. If an upgrade changes this, this line fails and
    // the change gets looked at instead of silently shifting who refuses strangers.
    await expect(signInWithGoogle('stranger@example.com', '100000000000000000999')).rejects.toMatchObject({
      message: 'role is required',
    });

    assertTestDb();
    expect(await db.select().from(userTable)).toHaveLength(usersBefore.length);
    expect(await db.select().from(accountTable)).toHaveLength(0);
    expect(await db.select().from(sessionTable)).toHaveLength(0);
  });

  it('a provisioned but deactivated user still gets no session (guardActive)', async () => {
    const provisioned = await provision(NEW_HIRE_EMAIL);
    assertTestDb();
    await db.update(userTable).set({ active: false }).where(eq(userTable.id, provisioned.id));

    await expect(signInWithGoogle(NEW_HIRE_EMAIL)).rejects.toMatchObject({
      message: 'This account has been deactivated.',
    });

    expect(await db.select().from(sessionTable).where(eq(sessionTable.userId, provisioned.id))).toHaveLength(0);
  });
});
