"use client";

import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { cn } from "@/lib/utils";

export type PricingPlan = {
  id: string;
  name: string;
  description: string;
  /** Rupees a month; null = custom pricing. */
  monthlyPrice: number | null;
  /** Rupees a year after the annual discount; null = custom pricing. */
  annualPrice: number | null;
  /** Short "what you get" lines: limits first, then features. */
  highlights: string[];
  cta: { label: string; href: string };
  recommended?: boolean;
};

type Props = {
  title: React.ReactNode;
  subtitle: React.ReactNode;
  plans: PricingPlan[];
  annualDiscountPercent: number;
  /** Shown under the CTA of paid plans while payments aren't switched on. */
  paidNote?: string;
  footnote?: React.ReactNode;
};

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/** Plan cards with a monthly/annual switch. Prices and limits come in as props (one config, many pages). */
export function PricingSection({ title, subtitle, plans, annualDiscountPercent, paidNote, footnote }: Props) {
  const [annual, setAnnual] = useState(false);

  return (
    <section className="relative w-full py-16 sm:py-24">
      <div className="mx-auto w-full max-w-[1480px] px-[clamp(16px,4vw,48px)]">
        <div className="mb-12 flex flex-col items-center text-center">
          <h1 className="mb-4 max-w-3xl text-balance font-display text-[clamp(34px,5vw,60px)] font-semibold leading-[1.05] tracking-tight text-text">
            {title}
          </h1>
          <p className="max-w-xl text-balance text-[16.5px] leading-relaxed text-muted">{subtitle}</p>

          <div className="mt-9 flex items-center gap-3" role="group" aria-label="Billing period">
            <span className={cn("text-sm font-medium", annual ? "text-faint" : "text-text")}>Monthly</span>
            <button
              type="button"
              role="switch"
              aria-checked={annual}
              aria-label="Bill annually"
              onClick={() => setAnnual((a) => !a)}
              className="relative flex h-6 w-11 cursor-pointer items-center rounded-full bg-surface-2 ring-1 ring-line transition-colors hover:bg-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlight"
            >
              <span
                className={cn(
                  "absolute size-4 rounded-full bg-text transition-transform duration-200 ease-out motion-reduce:transition-none",
                  annual ? "translate-x-6" : "translate-x-1",
                )}
              />
            </button>
            <span className={cn("flex items-center gap-2 text-sm font-medium", annual ? "text-text" : "text-faint")}>
              Annually
              <span className="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-highlight">
                Save {annualDiscountPercent}%
              </span>
            </span>
          </div>
        </div>

        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} annual={annual} paidNote={paidNote} />
          ))}
        </div>

        {footnote && <div className="mt-10 text-center text-sm text-faint">{footnote}</div>}
      </div>
    </section>
  );
}

function PlanCard({ plan, annual, paidNote }: { plan: PricingPlan; annual: boolean; paidNote?: string }) {
  const custom = plan.monthlyPrice === null;
  const free = plan.monthlyPrice === 0;
  const shown = custom ? null : annual && plan.annualPrice !== null ? Math.round(plan.annualPrice / 12) : plan.monthlyPrice;
  const savings = !custom && !free && plan.annualPrice !== null ? plan.monthlyPrice! * 12 - plan.annualPrice : 0;

  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col rounded-xl border bg-surface p-7 transition-colors",
        plan.recommended ? "border-primary/60 shadow-[0_20px_60px_-30px_rgba(240,122,43,0.45)]" : "border-line hover:border-line-strong",
      )}
    >
      {plan.recommended && <div className="absolute inset-x-6 top-0 h-px bg-primary" aria-hidden />}

      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-text">{plan.name}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{plan.description}</p>
        </div>
        {plan.recommended && (
          <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary-foreground">
            Recommended
          </span>
        )}
      </div>

      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="font-display text-4xl font-semibold tracking-tight text-text">{shown === null ? "Custom" : inr(shown)}</span>
        {shown !== null && <span className="text-sm font-medium text-faint">{free ? "/ forever" : "/ month"}</span>}
      </div>
      <p className="mb-6 min-h-[1.25rem] text-[12.5px] text-faint">
        {custom
          ? "Priced for your organization"
          : free
            ? "No card needed"
            : annual
              ? `${inr(plan.annualPrice!)} billed yearly · save ${inr(savings)}`
              : `Billed monthly · ${inr(plan.annualPrice!)} a year on annual`}
      </p>

      <Link
        href={plan.cta.href}
        className={cn(
          "flex h-10 w-full items-center justify-center gap-2 rounded-md text-sm font-medium transition-all active:scale-[0.98] motion-reduce:active:scale-100",
          plan.recommended
            ? "bg-primary text-primary-foreground hover:bg-primary/85"
            : "border border-line-strong text-text hover:bg-surface-2",
        )}
      >
        {plan.cta.label}
        {plan.recommended && <ArrowRight className="size-4" aria-hidden />}
      </Link>
      <p className="mt-2 min-h-[1rem] text-center text-[11.5px] text-faint">{!free && !custom ? paidNote : null}</p>

      <div className="my-5 h-px w-full bg-line" />

      <ul className="flex flex-col gap-3 text-sm text-muted">
        {plan.highlights.map((h) => (
          <li key={h} className="flex items-start gap-2.5">
            <Check className={cn("mt-0.5 size-4 shrink-0", plan.recommended ? "text-highlight" : "text-faint")} aria-hidden />
            <span className="min-w-0">{h}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
