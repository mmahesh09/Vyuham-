"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

import type { ChartSpec, ResultRow } from "@/features/charts/chart-spec";
import type { Insight } from "@/features/dashboards/api";
import type { RowFilter } from "@/features/datasets/api";
import { api } from "@/lib/api/client";

/** Mirrors backend/app/routers/ask.py AnswerWork: how an answer was worked out, so it can be checked. */
export type AnswerWork = {
  steps: string[];
  rows_used: number;
  rows_total: number;
  left_out: string[];
  check: { metric: string; shown: number; total: number; groups_shown: number; limited: boolean } | null;
  row_filters: RowFilter[];
};

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
  work: AnswerWork | null;
};

export function useAsk() {
  return useMutation({ mutationFn: (question: string) => api<AskAnswer>("/ask", { method: "POST", body: JSON.stringify({ question }) }) });
}

export function useAskSuggestions() {
  return useQuery({ queryKey: ["ask", "suggestions"], queryFn: () => api<string[]>("/ask/suggestions"), staleTime: 60_000 });
}
