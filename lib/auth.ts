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

  // Link Google to the pre-provisioned row on first sign-in.
  account: {
    accountLinking: { enabled: true, trustedProviders: ['google'] },
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
