import { MutationCache, QueryClient } from "@tanstack/react-query";

import { usePlanPrompt } from "@/features/billing/plans";
import { ApiError } from "@/lib/api/client";

export function makeQueryClient() {
  return new QueryClient({
    // A plan limit (402) anywhere opens one dialog that says which plan allows it.
    mutationCache: new MutationCache({ onError: (error) => usePlanPrompt.getState().show(error) }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Client errors (bad input, signed out) won't fix themselves on retry.
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      },
      mutations: { retry: false },
    },
  });
}
