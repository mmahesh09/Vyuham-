import "server-only";

import path from "node:path";

import { betterAuth } from "better-auth";

import { renderEmail, sendEmail } from "@/lib/email";
import { nextCookies } from "better-auth/next-js";

/**
 * Better Auth owns sign-up, log-in, social sign-in and password reset.
 * It writes the "user", "session", "account" and "verification" tables in the same
 * database as the FastAPI backend, which reads the session cookie to know who is calling
 * (backend/app/security.py). The schema is created by Alembic (backend/app/auth_tables.py),
 * so keep `user.additionalFields` in sync with it.
 */

export type SocialProvider = "google" | "apple";

const env = process.env;

/** Which social buttons can actually work, based on configured credentials. */
export const enabledProviders: Record<SocialProvider, boolean> = {
  google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  apple: Boolean(env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET),
};

async function database() {
  const url = env.DATABASE_URL;
  if (url?.startsWith("postgres")) {
    const { Pool } = await import("pg");
    // Accept the backend's SQLAlchemy form (postgresql+psycopg://…) as well.
    return new Pool({ connectionString: url.replace(/^postgresql\+\w+:/, "postgresql:") });
  }
  // Local dev: share the backend's SQLite file. Run `alembic upgrade head` first.
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(env.SQLITE_PATH ?? path.resolve(process.cwd(), "../backend/dev.db"), { fileMustExist: true });
  db.pragma("busy_timeout = 5000"); // the backend writes to the same file
  db.pragma("foreign_keys = ON");
  return db;
}

async function createAuth() {
  return betterAuth({
    appName: "Vyuham",
    database: await database(),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 72,
      autoSignIn: true,
      sendResetPassword: async ({ user, url }) => {
        const text = "Someone asked to reset the password for your Vyuham account. The link works for 1 hour.";
        await sendEmail(user.email, "Reset your Vyuham password", renderEmail("Reset your password", [text], { label: "Choose a new password", url }), `${text}\n\n${url}`);
      },
    },
    // Confirm the address at sign-up. People can sign in before confirming; inviting teammates and
    // emailing alerts need a confirmed address (enforced by the backend in production).
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        const text = `Hi ${user.name.split(" ")[0] || "there"}, confirm this is your email so we can send you invites, alerts and password resets.`;
        await sendEmail(user.email, "Confirm your email for Vyuham", renderEmail("Confirm your email", [text], { label: "Confirm email", url }), `${text}\n\n${url}`);
      },
    },
    // Slow down password guessing and sign-up spam (Better Auth's built-in limiter).
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
        "/request-password-reset": { window: 60, max: 3 },
        "/send-verification-email": { window: 60, max: 3 },
      },
    },
    socialProviders: {
      ...(enabledProviders.google && {
        google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! },
      }),
      ...(enabledProviders.apple && {
        apple: { clientId: env.APPLE_CLIENT_ID!, clientSecret: env.APPLE_CLIENT_SECRET! },
      }),
    },
    // Apple posts its callback from its own origin.
    trustedOrigins: enabledProviders.apple ? ["https://appleid.apple.com"] : [],
    user: {
      additionalFields: {
        // Names the workspace the backend creates on first sign-in.
        company: { type: "string", required: false, input: true },
        // Which privacy policy version the user consented to at sign-up (DPDP Act s.6(10): consent must be provable).
        privacyConsentVersion: { type: "string", required: false, input: true },
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    plugins: [nextCookies()],
  });
}

type Auth = Awaited<ReturnType<typeof createAuth>>;
let authPromise: Promise<Auth> | undefined;

/** Created on first request, so `next build` never opens the database. */
export function getAuth(): Promise<Auth> {
  authPromise ??= createAuth();
  return authPromise;
}
