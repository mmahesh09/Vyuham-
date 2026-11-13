"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";

import { makeQueryClient } from "@/lib/query-client";
import { SmoothScroll } from "@/providers/smooth-scroll";

/** Providers for every page: theme (dark by default; light and system on request), server state and smooth scrolling. */
export function RootProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <SmoothScroll>{children}</SmoothScroll>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
