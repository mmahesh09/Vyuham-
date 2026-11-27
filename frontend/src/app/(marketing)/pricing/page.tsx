import type { Metadata } from "next";

import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { PricingSection, type PricingPlan } from "@/components/ui/pricing-section";
import { annualPrice, formatBytes, PLAN_CONFIG, PLANS, type PlanConfig } from "@/features/billing/plans";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Vyuham plans for analytics, data engineering and AI in one workspace. Start free; see what each plan includes in users, storage, AI credits and pipeline runs.",
  alternates: { canonical: "/pricing" },
};

const n = (v: number) => v.toLocaleString("en-IN");

function highlights(p: PlanConfig): string[] {
  if (p.monthly_price === null) {
    return ["Custom users, storage and usage", "Every feature on Business", "Custom support agreement", "Invoice billing"];
  }
  const perWs = p.ai_credit_scope === "workspace" ? " per workspace" : "";
  return [
    `${p.seats} ${p.seats === 1 ? "user" : "users"} · ${p.workspaces} ${p.workspaces === 1 ? "workspace" : "workspaces"}`,
    `${formatBytes(p.storage_bytes!)} storage`,
    `${n(p.ai_credits_per_month!)} AI credits a month${perWs}`,
    `${n(p.pipeline_runs_per_day!)} pipeline runs a day`,
    `${p.datasets} datasets · ${p.dashboards === null ? "dashboards without a set cap" : `${p.dashboards} dashboards`}`,
    ...p.features.filter((f) => f !== "analytics.ai_analyst").map((f) => PLAN_CONFIG.features[f as keyof typeof PLAN_CONFIG.features]),
    `${p.support} support`,
  ];
}

const plans: PricingPlan[] = PLANS.map((p) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  monthlyPrice: p.monthly_price,
  annualPrice: annualPrice(p.monthly_price),
  highlights: highlights(p),
  cta: p.cta,
  recommended: p.highlight,
}));

const TONE: Record<string, string> = {
  Included: "text-text",
  "Not included": "text-faint",
  Limited: "text-muted",
  Custom: "text-highlight",
};

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <main className="flex-1">
        <PricingSection
          title="Power your data. Not your overhead."
          subtitle="Analytics, data engineering and AI in one platform. Start free and scale when your team is ready."
          plans={plans}
          annualDiscountPercent={PLAN_CONFIG.annual_discount_percent}
          paidNote="Paid plans open soon. You start on Free."
          footnote={
            <>
              Prices in Indian rupees, before applicable taxes. Vyuham is free during the beta: no card is taken and nothing
              is charged until paid plans open.
            </>
          }
        />

        <section aria-labelledby="compare" className="mx-auto w-full max-w-[1200px] px-[clamp(16px,4vw,48px)] pb-20">
          <h2 id="compare" className="mb-6 font-display text-[clamp(24px,3vw,32px)] font-semibold tracking-tight text-text">
            Compare plans
          </h2>
          {/* The table scrolls inside its own box on small screens; the page never does. */}
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead className="bg-surface">
                <tr>
                  <th scope="col" className="sticky left-0 z-10 w-[32%] bg-surface px-4 py-3 font-medium text-faint">
                    Feature
                  </th>
                  {PLANS.map((p) => (
                    <th key={p.id} scope="col" className={cn("px-4 py-3 font-semibold", p.highlight ? "text-highlight" : "text-text")}>
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              {PLAN_CONFIG.comparison.map((group) => (
                <tbody key={group.group}>
                  <tr>
                    <th colSpan={PLANS.length + 1} scope="colgroup" className="border-t border-line bg-bg px-4 pb-2 pt-5 text-[12px] font-semibold uppercase tracking-[0.12em] text-faint">
                      {group.group}
                    </th>
                  </tr>
                  {group.rows.map((row) => (
                    <tr key={row.label} className="border-t border-line">
                      <th scope="row" className="sticky left-0 bg-bg px-4 py-3 font-normal text-muted">
                        {row.label}
                      </th>
                      {row.values.map((v, i) => (
                        <td key={PLANS[i].id} className={cn("px-4 py-3", TONE[v] ?? "text-text")}>
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </section>

        <section aria-labelledby="credits" className="mx-auto w-full max-w-[1200px] px-[clamp(16px,4vw,48px)] pb-24">
          <div className="grid gap-8 rounded-xl border border-line bg-surface p-[clamp(20px,3vw,36px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div className="flex flex-col gap-3">
              <h2 id="credits" className="font-display text-[clamp(22px,2.6vw,28px)] font-semibold tracking-tight text-text">
                How AI credits work
              </h2>
              <p className="max-w-[56ch] text-[15.5px] leading-relaxed text-muted">
                AI credits measure your use of Vyuham&apos;s AI features. Bigger jobs cost more: designing a whole pipeline takes
                more work than explaining one query. Credits reset at the start of each month.
              </p>
              <p className="max-w-[56ch] text-[15.5px] leading-relaxed text-muted">
                You&apos;re only charged when the AI returns an answer. Failed or declined requests cost nothing. Asking questions
                on the home page and running SQL yourself don&apos;t use credits.
              </p>
            </div>
            <ul className="flex flex-col">
              {PLAN_CONFIG.ai_credit_tasks.map((t) => {
                const cost = PLAN_CONFIG.ai_credit_costs[t.kind as keyof typeof PLAN_CONFIG.ai_credit_costs];
                return (
                  <li key={t.kind} className="flex items-center justify-between gap-4 border-t border-line py-3 first:border-t-0">
                    <span className="text-[15px] text-text">{t.label}</span>
                    <span className="shrink-0 font-mono text-[13px] text-muted">
                      {cost} {cost === 1 ? "credit" : "credits"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
