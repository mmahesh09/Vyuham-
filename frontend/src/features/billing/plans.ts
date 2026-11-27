import { create } from "zustand";

import config from "@/config/plans.generated.json";
import { ApiError } from "@/lib/api/client";

/** Plans as the backend defines them (backend/app/plans.json, copied by `npm run plans:sync`). */
export type PlanConfig = (typeof config)["plans"][number];
export const PLAN_CONFIG = config;
export const PLANS: PlanConfig[] = config.plans;

export function planName(id: string | null | undefined): string {
  return PLANS.find((p) => p.id === id)?.name ?? "Enterprise";
}

/** The yearly amount: twelve months less the annual discount (the backend computes it the same way). */
export function annualPrice(monthly: number | null): number | null {
  return monthly === null ? null : Math.round((monthly * 12 * (100 - config.annual_discount_percent)) / 100);
}

export function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${+(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/** A plan limit or locked feature the server refused (402); shown once by <PlanLimitDialog />. */
export const usePlanPrompt = create<{
  prompt: { message: string; requiredPlan: string | null } | null;
  show: (error: unknown) => void;
  close: () => void;
}>()((set) => ({
  prompt: null,
  show: (error) => {
    if (error instanceof ApiError && error.status === 402 && error.code?.startsWith("plan_")) {
      set({ prompt: { message: error.message, requiredPlan: error.requiredPlan ?? null } });
    }
  },
  close: () => set({ prompt: null }),
}));
