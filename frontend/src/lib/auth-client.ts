"use client";

import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Same origin as the app; Better Auth's handler lives at /api/auth/*.
export const authClient = createAuthClient({
  // Mirrors `user.additionalFields` in src/lib/auth.ts.
  plugins: [inferAdditionalFields({
      user: { company: { type: "string", required: false }, privacyConsentVersion: { type: "string", required: false } },
    })],
});
