"use client";

import { Loader2, Plus, Sparkles, Workflow } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { Panel, PanelRow } from "@/components/app/panel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { errorText, planPipeline, useAiStatus, usePipelines, type PGraph, type Plan } from "@/features/platform/api";
import { Chip, ErrorLine, SectionTitle, ago } from "@/features/platform/ui";

import { PipelineEditor } from "./pipeline-editor";

const EXAMPLE =
  "Create a daily pipeline that reads orders, removes duplicates, validates customer IDs, joins customers, calculates revenue by region and writes the result to a Gold table.";

export function PipelinesList() {
  const pipelines = usePipelines();
  return (
    <PageContainer>
      <PageHeader
        title="Pipelines"
        description="Build ETL/ELT pipelines on a canvas: read datasets, transform them in SQL, check quality, and write Bronze, Silver and Gold tables. Runs happen in the background."
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/pipelines/new" />}><Plus /> Blank pipeline</Button>
            <Button nativeButton={false} render={<Link href="/pipelines/new?ai=1" />}><Sparkles /> AI Data Engineer</Button>
          </>
        }
      />
      {pipelines.isPending ? (
        <p className="text-sm text-faint">Loading…</p>
      ) : pipelines.error ? (
        <ErrorLine error={pipelines.error} />
      ) : !pipelines.data?.length ? (
        <Panel className="flex flex-col items-start gap-3">
          <Workflow className="size-6 text-highlight" />
          <p className="text-sm text-text">No pipelines yet.</p>
          <p className="max-w-prose text-[13px] text-muted">Describe what you need and the AI Data Engineer drafts the steps from your real tables, or start from a blank canvas.</p>
        </Panel>
      ) : (
        <Panel variant="list">
          {pipelines.data.map((p) => (
            <PanelRow key={p.id} interactive>
              <Link href={`/pipelines/${p.id}`} className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-text">{p.name}</span>
                  <span className="text-[12px] text-faint">
                    {p.graph.nodes.length} steps · {p.schedule === "manual" ? "manual" : p.schedule === "hourly" ? "every hour" : `daily ${String(p.hour).padStart(2, "0")}:00 UTC`} · last run {ago(p.last_run_at)}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {p.generated_by_ai && <Chip tone="internal"><Sparkles className="size-3" /> AI</Chip>}
                  {p.needs_approval && <Chip tone="warn">Needs approval</Chip>}
                  {p.problems.length > 0 && <Chip tone="failed">{p.problems.length} problem{p.problems.length > 1 ? "s" : ""}</Chip>}
                  {p.last_status && <Chip tone={p.last_status} />}
                </span>
              </Link>
            </PanelRow>
          ))}
        </Panel>
      )}
    </PageContainer>
  );
}

const BLANK: PGraph = {
  nodes: [{ id: "start", type: "blueprint", position: { x: 30, y: 80 }, data: { label: "Start", detail: "Where each run begins.", kind: "trigger", tool: "Trigger", config: { type: "schedule" } } }],
  edges: [],
};

export function NewPipeline({ ai }: { ai: boolean }) {
  const status = useAiStatus();
  const [request, setRequest] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const design = async () => {
    setPending(true);
    setError(null);
    try {
      setPlan(await planPipeline(request.trim()));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <PageContainer width="wide">
      <PageHeader title={ai ? "AI Data Engineer" : "New pipeline"} back={{ href: "/pipelines", label: "Pipelines" }}
        description={ai ? "Describe the pipeline. The AI reads your workspace's real tables and columns, drafts the steps, checks them against the data, and explains the design. Nothing runs until you approve it." : undefined} />
      {ai && (
        <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
          <label className="flex flex-col gap-2 text-[13px] text-muted">
            What should the pipeline do?
            <Textarea value={request} onChange={(e) => setRequest(e.target.value)} rows={3} maxLength={3000} placeholder={EXAMPLE} />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={design} disabled={pending || request.trim().length < 5 || status.data?.enabled === false}>
              {pending ? <Loader2 className="animate-spin" /> : <Sparkles />} {pending ? "Designing… (this can take a minute)" : "Design pipeline"}
            </Button>
            {!request && <Button variant="ghost" size="sm" onClick={() => setRequest(EXAMPLE)}>Use the example</Button>}
          </div>
          {status.data?.enabled === false && <p className="text-[13px] text-faint">AI isn’t set up on this server (ANTHROPIC_API_KEY). You can still build pipelines on a blank canvas.</p>}
          <ErrorLine error={error} />
        </section>
      )}
      {ai && plan && <PlanSummary plan={plan} />}
      {(!ai || plan) && (
        <PipelineEditor
          key={plan?.action_id ?? "blank"}
          draft={plan ? { name: plan.name, graph: plan.graph, schedule: plan.schedule, hour: plan.hour, actionId: plan.action_id } : { name: "", graph: BLANK, schedule: "manual", hour: 6, actionId: null }}
        />
      )}
    </PageContainer>
  );
}

function PlanSummary({ plan }: { plan: Plan }) {
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
        <SectionTitle action={<Chip tone={plan.feasible ? "success" : "warn"}>{plan.feasible ? "Checked against your data" : "Needs attention"}</Chip>}>What the AI understood</SectionTitle>
        <p className="text-[13px] text-muted">{plan.understanding}</p>
        {plan.used_tables.length > 0 && <p className="text-[12px] text-faint">Reads: {plan.used_tables.join(", ")}</p>}
        {plan.missing.length > 0 && (
          <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-3 text-[13px]">
            <p className="font-medium text-text">Not in your workspace</p>
            <ul className="list-disc pl-5 text-muted">{plan.missing.map((m) => <li key={m}>{m}</li>)}</ul>
          </div>
        )}
        {(plan.problems.length > 0 || Object.keys(plan.step_problems).length > 0) && (
          <ul className="list-disc pl-5 text-[13px] text-destructive">
            {plan.problems.map((p) => <li key={p}>{p}</li>)}
            {Object.entries(plan.step_problems).map(([k, v]) => <li key={k}>{plan.graph.nodes.find((n) => n.id === k)?.data.label ?? k}: {v}</li>)}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
        <SectionTitle>Design</SectionTitle>
        <p className="text-[13px] text-muted">{plan.design}</p>
        <p className="text-[13px] text-muted"><b className="text-text">Incremental loading:</b> {plan.incremental}</p>
        <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted">
          {plan.graph.nodes.map((n) => <li key={n.id}><b className="text-text">{n.data.label}</b> — {n.data.explanation || n.data.detail}</li>)}
        </ol>
        <p className="text-[12px] text-faint">Next: preview steps below, save the draft, then approve it to run.</p>
      </div>
    </section>
  );
}
