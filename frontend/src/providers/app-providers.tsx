"use client";

import * as Sentry from "@sentry/nextjs";
import { useQueryClient } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { useEffect, useState } from "react";

import { authKeys } from "@/features/auth/hooks";
import { CommandMenu } from "@/features/command/command-menu";
import { AssistantPanel } from "@/features/assistant/assistant-panel";
import { SupportWidget } from "@/features/support/widget";
import { GuidedTour } from "@/features/tour/guided-tour";
import type { User } from "@/lib/api/client";

/** Providers for the signed-in app: the signed-in user, URL state (filters) and the command menu. */
export function AppProviders({ user, children }: { user: User; children: React.ReactNode }) {
  const queryClient = useQueryClient();
  // Seed the cache once with the user the server already loaded, so useMe() never refetches on mount.
  useState(() => queryClient.setQueryData(authKeys.me, user));
  // Error reports carry only the opaque user id, never email or name, so GlitchTip can count affected users.
  useEffect(() => {
    Sentry.setUser({ id: user.id });
    return () => Sentry.setUser(null);
  }, [user.id]);

  return (
    <NuqsAdapter>
      {children}
      <CommandMenu />
      <GuidedTour />
      <SupportWidget />
      <AssistantPanel />
    </NuqsAdapter>
  );
}
