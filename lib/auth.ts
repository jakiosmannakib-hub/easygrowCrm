// lib/auth.ts
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '../db';
import { guardActive, guardProvisioned } from './auth-guards';

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),

  emailAndPassword: { enabled: false },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // Re-sync the profile on every sign-in, not just the first link, so a changed Google
      // photo propagates. Scoped to `image` alone by the user.update.before hook (PUL-113).
      overrideUserInfoOnSignIn: true,
    },
  },

  // Link Google to the pre-provisioned "user" row on first sign-in.
  //
  // A provisioned row has no `account` yet, so the first Google sign-in matches it BY EMAIL
  // and Better Auth must decide whether to link. Before linking, 1.7 checks
  // `requireLocalEmailVerified` (default true): the LOCAL row's `email_verified` must be true.
  // `createEmployee` inserts `emailVerified: false` by design (PUL-202 — provisioning does not
  // claim Google has verified anything), so with the default every employee added through the
  // UI was refused with ACCOUNT_NOT_LINKED and could never sign in. Only the SQL-seeded super
  // admin (email_verified = true) got through.
  //
  // Turning it off is safe here, because the local flag protects nothing in this system:
  //   - the flag guards against someone pre-registering an address they don't own and waiting
  //     for its real owner to link. There is no self sign-up (§9.2): a row exists only because
  //     SA/HR provisioned it, and that provisioning is what vouches for the address;
  //   - Google is the only provider and verifies the email itself (it is `trustedProviders`);
  //     Better Auth flips `email_verified` to true on the successful link;
  //   - the flag is only consulted when a user row ALREADY matches the email, i.e. someone SA/HR
  //     provisioned. It plays no part in refusing unknown emails; that branch is unchanged, and
  //     `guardActive` (session.create.before) still blocks deactivated users.
  //
  // Note on unknown emails (1.7.2): Better Auth parses `additionalFields` before
  // user.create.before, so a stranger is refused by "role is required" (role is required with no
  // default) before `guardProvisioned` runs. Still fail-closed; pinned by the regression test.
  // Regression test: features/auth/oauth-link-provisioned.test.ts.
  // Profile-picture sync (PUL-113). Two separate switches, because Better Auth treats the
  // first link and every later sign-in as different code paths in `handleOAuthUserInfo`:
  //
  //   - `updateUserInfoOnLink` drives `applyUpdateUserInfoOnLink`, which runs ONLY on the
  //     branch that attaches a Google identity to an existing row. Without it that branch
  //     writes the `account` row and flips `email_verified` and touches nothing else — which
  //     is why every provisioned user had `image = NULL` forever. Our users are ALWAYS created
  //     before Google (seed-admin.sql / createEmployee), so this is the only branch we ever
  //     take; the create-a-user-from-the-profile branch that does copy `image` is dead code
  //     here. Same family as the `requireLocalEmailVerified` bug above: provision-first flows
  //     skip what Better Auth does on user creation.
  //   - `overrideUserInfoOnSignIn` (a Google provider option, read by the callback route and
  //     passed down as `overrideUserInfo`) drives the re-sync on EVERY later sign-in, so a
  //     person who changes their Google photo sees it update rather than keeping the picture
  //     they had on their first day.
  //
  // Neither option is image-only — both call `updateUser({ name, image, ... })`. `name` is
  // narrowed back out in the `user.update.before` hook below; see the comment there.
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['google'],
      requireLocalEmailVerified: false,
      updateUserInfoOnLink: true,
    },
  },

  user: {
    additionalFields: {
      role: { type: 'string', required: true, input: false },
      title: { type: 'string', required: false, input: false },
      department: { type: 'string', required: false, input: false },
      active: { type: 'boolean', defaultValue: true, input: false },
      joinDate: { type: 'date', required: false, input: false },
    },
  },

  databaseHooks: {
    user: {
      // HR owns `name`; Google never does (PUL-113).
      //
      // The two options above are what make the profile sync happen at all, but neither is
      // image-only — both hand `updateUser` a `{ name, image }` pair. Letting Google's `name`
      // through would silently revert an HR correction made through `updateEmployee` (PUL-203)
      // on that person's very next sign-in: HR fixes a misspelled name, the employee signs in,
      // Google's spelling wins, and nothing in the audit log explains it. Worse, the callback
      // route coerces a missing provider name to `''` (`name: userInfo.name || ""`), so a
      // Google account with no name set would blank the column outright — verified against
      // 1.7.2's dist/api/routes/callback.mjs, and an empty string DOES get written.
      //
      // Forcing `name: undefined` here strips it from the update instead: `updateUser` drops
      // undefined fields, leaving the existing column untouched (verified empirically against
      // the drizzle adapter — `undefined` preserves, `''` overwrites). `image` and the
      // `email_verified` flip pass through untouched.
      //
      // Safe to apply to EVERY Better Auth user update, because Better Auth is never allowed
      // to author a name in this system: `createEmployee` and `updateEmployee` both write the
      // `user` table through Drizzle directly and so never reach this hook.
      //
      // No audit row: this is profile plumbing carrying no accountability, not a user action
      // (§16.4's carve-out is about actions, and an image sync is not one).
      update: {
        before: async (data) => {
          if (!('name' in data)) return;
          return { data: { ...data, name: undefined } };
        },
      },
      create: {
        // Fires only for NEW emails → anyone not pre-provisioned is rejected.
        before: async (newUser) => {
          await guardProvisioned(newUser.email);
          return false; // never create; link to the existing provisioned row
        },
      },
    },
    session: {
      create: {
        // Fires at sign-in (existing users too) → deactivated accounts blocked.
        before: async (session) => {
          await guardActive(session.userId);
        },
      },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
});
