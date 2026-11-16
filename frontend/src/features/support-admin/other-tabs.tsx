"use client";

import { FilePlus2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { useAiSuggestions, useAudit, useDraftFromSession, useFeedback, useTickets, type AiSession } from "./api";
import { AuditList } from "./errors-tab";
import { Empty, MODULE_LABEL, Panel, ScopeBadge, StatusBadge, num, pct, when } from "./ui";

const STEP_LABEL: Record<string, string> = { verified_fix: "Verified fix", suggestion: "Suggestion", check: "Check" };

function SuggestionCard({ s }: { s: AiSession }) {
  const draft = useDraftFromSession();
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line p-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2 text-faint">
        <span>{when(s.created_at)}</span>·<span>{s.workspace ?? s.workspace_id}</span>·<span>{MODULE_LABEL[s.module] ?? s.module}</span>
        <Badge variant={s.grounded ? "success-light" : "warning-light"}>{s.grounded ? "Backed by verified articles" : "No verified article"}</Badge>
        {s.feedback && <Badge variant={s.feedback === "resolved" ? "success-light" : "destructive-light"}>{s.feedback === "resolved" ? "Customer: solved" : "Customer: not solved"}</Badge>}
        {s.escalated_conversation_id && <Badge variant="primary-light">Ticket #{s.escalated_conversation_id}</Badge>}
      </div>
      <p className="text-muted">Q: {s.question}</p>
      <p className="text-sm">{s.summary}</p>
      {s.steps.length > 0 && (
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          {s.steps.map((st, i) => <li key={i}><span className="text-faint">[{STEP_LABEL[st.kind] ?? st.kind}]</span> {st.text}</li>)}
        </ol>
      )}
      {s.feedback_comment && <p className="text-muted">Customer comment: “{s.feedback_comment}”</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => draft.mutate(s.id)} disabled={draft.isPending || draft.isSuccess}>
          <FilePlus2 /> {draft.isSuccess ? "Draft created" : "Draft knowledge article"}
        </Button>
        <span className="text-[12px] text-faint">Creates a pending article private to this workspace for review.</span>
      </div>
      {draft.isError && <p className="text-accent">{draft.error.message}</p>}
    </li>
  );
}

export function SuggestionsTab() {
  const [feedback, setFeedback] = useState("");
  const { data, isPending, isError, error } = useAiSuggestions(feedback);
  return (
    <Panel
      title="AI-suggested solutions"
      description="Recent assistant answers. Answers customers said worked are also queued as pending articles in the Knowledge tab."
      action={
        <NativeSelect value={feedback} onChange={(e) => setFeedback(e.target.value)} aria-label="Feedback filter">
          <NativeSelectOption value="">All answers</NativeSelectOption>
          <NativeSelectOption value="resolved">Customer said solved</NativeSelectOption>
          <NativeSelectOption value="unresolved">Customer said not solved</NativeSelectOption>
          <NativeSelectOption value="none">No feedback</NativeSelectOption>
        </NativeSelect>
      }
    >
      {isPending ? <p className="text-sm text-muted">Loading…</p> : isError ? <p className="text-sm text-accent">{error.message}</p> : !data.length ? <Empty>No answers yet.</Empty> : <ul className="flex flex-col gap-3">{data.map((s) => <SuggestionCard key={s.id} s={s} />)}</ul>}
    </Panel>
  );
}

export function FeedbackTab({ days }: { days: number }) {
  const { data, isPending, isError, error } = useFeedback(days);
  if (isPending) return <p className="text-sm text-muted">Loading…</p>;
  if (isError) return <p className="text-sm text-accent">{error.message}</p>;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Did the assistant solve it?" description={`By module, last ${days} days`}>
        {data.by_module.length ? (
          <Table>
            <TableHeader><TableRow><TableHead>Module</TableHead><TableHead className="text-right">Solved</TableHead><TableHead className="text-right">Not solved</TableHead><TableHead className="text-right">Rate</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.by_module.map((m) => (
                <TableRow key={m.module}>
                  <TableCell>{MODULE_LABEL[m.module] ?? m.module}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(m.resolved)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(m.unresolved)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(m.resolved / Math.max(1, m.resolved + m.unresolved))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : <Empty>No feedback yet.</Empty>}
      </Panel>
      <Panel title="Articles by feedback" description="Helpful / not helpful votes on answers that cited them">
        {data.articles.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {data.articles.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 py-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{a.title}</span><ScopeBadge scope={a.scope} /><StatusBadge status={a.status} />
                <span className="tabular-nums text-muted">👍 {a.helpful_count} · 👎 {a.unhelpful_count}</span>
              </li>
            ))}
          </ul>
        ) : <Empty>No votes yet.</Empty>}
      </Panel>
      <Panel title="Recent feedback" className="lg:col-span-2">
        {data.recent.length ? <ul className="flex flex-col gap-3">{data.recent.map((s) => <SuggestionCard key={s.id} s={s} />)}</ul> : <Empty>No feedback yet.</Empty>}
      </Panel>
    </div>
  );
}

export function TicketsTab() {
  const { data, isPending, isError, error } = useTickets();
  if (isPending) return <p className="text-sm text-muted">Loading…</p>;
  if (isError) return <p className="text-sm text-accent">{error.message}</p>;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Open support tickets" description="Open conversations in the Vyuham Support inbox (Chatwoot)">
        {!data.configured ? <Empty>Chatwoot isn&apos;t connected.</Empty> : data.error ? <p className="text-sm text-accent">{data.error}</p> : data.open && data.open.conversations.length ? (
          <>
            <p className="text-sm"><span className="font-display text-[28px] font-semibold tabular-nums">{num(data.open.count)}</span> open</p>
            <ul className="flex flex-col divide-y divide-line">
              {data.open.conversations.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-[13px]">
                  <span className="font-medium">#{c.id}</span><span className="text-muted">{c.workspace ?? "unknown workspace"}</span>
                  {c.labels.map((l) => <Badge key={l} variant="secondary">{l}</Badge>)}
                  <span className="ml-auto text-faint">{c.last_activity_at ? when(new Date(c.last_activity_at * 1000).toISOString()) : ""}</span>
                </li>
              ))}
            </ul>
          </>
        ) : <Empty>No open tickets.</Empty>}
      </Panel>
      <Panel title="Errors linked to tickets">
        {data.linked_errors.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {data.linked_errors.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 py-2 text-[13px]">
                <Badge variant="primary-light">#{e.chatwoot_conversation_id}</Badge><span className="min-w-0 flex-1 truncate font-mono text-[12px]">{e.message}</span><StatusBadge status={e.status} />
              </li>
            ))}
          </ul>
        ) : <Empty>No links yet. Link an error to a ticket from its details.</Empty>}
      </Panel>
    </div>
  );
}

export function AuditTab() {
  const { data, isPending, isError, error } = useAudit();
  return (
    <Panel title="Audit log" description="Every knowledge and error change by Vyuham staff. Entries can't be edited or deleted.">
      {isPending ? <p className="text-sm text-muted">Loading…</p> : isError ? <p className="text-sm text-accent">{error.message}</p> : <AuditList entries={data} />}
    </Panel>
  );
}
