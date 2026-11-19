"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import type { Dataset } from "@/features/datasets/api";

import { checkFormula, previewFormula, useFormulaFunctions, useMetrics, type FormulaInput } from "./api";
import type { FormulaNames } from "./formula-editor";

function useDebounced<T>(value: T, ms = 350) {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setCurrent(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return current;
}

/** Validates as the person types, and previews once the formula is valid. */
export function useFormula(input: FormulaInput | null, canPreview: boolean) {
  const settled = useDebounced(input);
  const active = !!settled?.dataset_id && !!settled.formula.trim();
  const check = useQuery({
    queryKey: ["formula-check", settled],
    queryFn: ({ signal }) => checkFormula(settled!, signal),
    enabled: active,
    retry: false,
  });
  const preview = useQuery({
    queryKey: ["formula-preview", settled],
    queryFn: ({ signal }) => previewFormula(settled!, signal),
    enabled: active && canPreview && check.data?.ok === true,
    retry: false,
  });
  const fresh = !!input && input.formula === settled?.formula && input.dataset_id === settled?.dataset_id;
  return { check: active && fresh ? check.data : undefined, checking: !fresh || check.isFetching, preview };
}

/** Everything the formula editor can suggest for a dataset. */
export function useFormulaNames(dataset: Dataset | undefined, kind: "measure" | "column", skipMetric?: string): FormulaNames {
  const { data: functions } = useFormulaFunctions();
  const { data: metrics } = useMetrics();
  return useMemo(
    () => ({
      columns: (dataset?.columns ?? []).map((c) => ({ name: c.name, type: c.type })),
      metrics: kind === "measure" ? (metrics ?? []).filter((m) => m.dataset_id === dataset?.id && m.id !== skipMetric).map((m) => m.name) : [],
      functions: (functions ?? []).filter((f) => (kind === "measure" ? f.group !== "Window" : f.group !== "Aggregate")),
    }),
    [dataset, kind, skipMetric, functions, metrics],
  );
}
