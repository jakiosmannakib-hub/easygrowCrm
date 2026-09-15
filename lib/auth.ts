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
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['google'],
      requireLocalEmailVerified: false,
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
          return;
        },
      },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
});
