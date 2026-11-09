"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";

import { makeQueryClient } from "@/lib/query-client";
import { SmoothScroll } from "@/providers/smooth-scroll";

/** Providers for every page: theme (dark only for now), server state and smooth scrolling. */
export function RootProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark" enableSystem={false} disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <SmoothScroll>{children}</SmoothScroll>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
