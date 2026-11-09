"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

import type { ChartSpec, ResultRow } from "@/features/charts/chart-spec";
import type { Insight } from "@/features/dashboards/api";
import { api } from "@/lib/api/client";

/** Mirrors backend/app/routers/ask.py AskOut. */
export type AskAnswer = {
  answered: boolean;
  question: string;
  spec: ChartSpec | null;
  rows: ResultRow[];
  insight: Insight | null;
  dataset_id: string | null;
  dataset_name: string | null;
  understood: string[];
  date_from: string | null;
  date_to: string | null;
  message: string | null;
  suggestions: string[];
};

export function useAsk() {
  return useMutation({ mutationFn: (question: string) => api<AskAnswer>("/ask", { method: "POST", body: JSON.stringify({ question }) }) });
}

export function useAskSuggestions() {
  return useQuery({ queryKey: ["ask", "suggestions"], queryFn: () => api<string[]>("/ask/suggestions"), staleTime: 60_000 });
}
