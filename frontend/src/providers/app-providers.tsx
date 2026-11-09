"use client";

import { useQueryClient } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { useState } from "react";

import { authKeys } from "@/features/auth/hooks";
import { CommandMenu } from "@/features/command/command-menu";
import { GuidedTour } from "@/features/tour/guided-tour";
import type { User } from "@/lib/api/client";

/** Providers for the signed-in app: the signed-in user, URL state (filters) and the command menu. */
export function AppProviders({ user, children }: { user: User; children: React.ReactNode }) {
  const queryClient = useQueryClient();
  // Seed the cache once with the user the server already loaded, so useMe() never refetches on mount.
  useState(() => queryClient.setQueryData(authKeys.me, user));

  return (
    <NuqsAdapter>
      {children}
      <CommandMenu />
      <GuidedTour />
    </NuqsAdapter>
  );
}
