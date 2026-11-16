"use client";

import { Archive, Check, Pencil, Plus, X } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

import {
  useApproveArticle,
  useArchiveArticle,
  useArticle,
  useArticles,
  useAudit,
  useCreateArticle,
  useEditArticle,
  useRejectArticle,
  type Article,
  type ArticleFields,
  type SupportRole,
} from "./api";
import { AuditList } from "./errors-tab";
import { Empty, MODULE_LABEL, Panel, ScopeBadge, StatusBadge, when } from "./ui";

const SOURCE: Record<string, string> = { staff: "Written by staff", customer_feedback: "AI answer a customer said worked", ai_session: "Drafted from an AI answer", promotion: "Promoted from a workspace article" };

function ArticleForm({ initial, submitLabel, onSubmit, pending }: { initial?: Partial<ArticleFields>; submitLabel: string; onSubmit: (f: ArticleFields) => void; pending: boolean }) {
  const [f, setF] = useState<ArticleFields>({ title: initial?.title ?? "", symptoms: initial?.symptoms ?? "", root_cause: initial?.root_cause ?? "", resolution: initial?.resolution ?? "", modules: initial?.modules ?? [], categories: initial?.categories ?? [], fingerprints: initial?.fingerprints ?? [] });
  const set = (k: keyof ArticleFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const ok = f.title.trim().length >= 3 && f.symptoms.trim().length >= 3 && f.root_cause.trim().length >= 3 && f.resolution.trim().length >= 3;
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => (e.preventDefault(), onSubmit(f))}>
      <label className="flex flex-col gap-1 text-[13px]">Title<Input value={f.title} onChange={set("title")} maxLength={200} /></label>
      <label className="flex flex-col gap-1 text-[13px]">Symptoms<Textarea value={f.symptoms} onChange={set("symptoms")} rows={2} maxLength={4000} /></label>
      <label className="flex flex-col gap-1 text-[13px]">Root cause<Textarea value={f.root_cause} onChange={set("root_cause")} rows={2} maxLength={4000} /></label>
      <label className="flex flex-col gap-1 text-[13px]">Resolution<Textarea value={f.resolution} onChange={set("resolution")} rows={4} maxLength={6000} /></label>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-2 text-[13px]">
        <legend className="mb-1">Modules</legend>
        {Object.entries(MODULE_LABEL).map(([m, label]) => (
          <label key={m} className="flex items-center gap-1.5">
            <Checkbox checked={f.modules?.includes(m)} onCheckedChange={(v) => setF({ ...f, modules: v ? [...(f.modules ?? []), m] : (f.modules ?? []).filter((x) => x !== m) })} />
            {label}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1 text-[13px]">
        Categories and fingerprints (comma-separated; a fingerprint gives an exact match)
        <Input value={[...(f.categories ?? []), ...(f.fingerprints ?? [])].join(", ")} onChange={(e) => {
          const parts = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
          setF({ ...f, fingerprints: parts.filter((p) => /^[0-9a-f]{64}$/.test(p)), categories: parts.filter((p) => !/^[0-9a-f]{64}$/.test(p)) });
        }} />
      </label>
      <p className="text-[12px] text-faint">Saving sends the article back to “Pending review”. Don&apos;t include customer names, data or credentials.</p>
      <Button type="submit" className="self-start" disabled={!ok || pending}>{pending ? "Saving…" : submitLabel}</Button>
    </form>
  );
}

function ApproveForm({ a }: { a: Article }) {
  const [tested, setTested] = useState(false);
  const [notes, setNotes] = useState("");
  const [confirm, setConfirm] = useState(false);
  const approve = useApproveArticle(a.id);
  const global = a.scope === "global";
  return (
    <form className="flex flex-col gap-2 rounded-xl border border-line p-3" onSubmit={(e) => (e.preventDefault(), approve.mutate({ tested, test_notes: notes.trim(), confirm_no_customer_data: confirm }))}>
      <p className="text-sm font-medium">Approve as verified knowledge</p>
      <label className="flex items-start gap-2 text-[13px]"><Checkbox checked={tested} onCheckedChange={(v) => setTested(Boolean(v))} className="mt-0.5" />I tested this solution and it fixes the problem.</label>
      <Textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 2000))} rows={2} placeholder="How was it tested? (required)" aria-label="Test notes" />
      {global && (
        <label className="flex items-start gap-2 text-[13px]"><Checkbox checked={confirm} onCheckedChange={(v) => setConfirm(Boolean(v))} className="mt-0.5" />It contains no customer-specific information. Every customer will be able to see it.</label>
      )}
      {approve.isError && <p className="text-[13px] text-accent">{approve.error.message}</p>}
      <Button type="submit" size="sm" className="self-start" disabled={!tested || notes.trim().length < 10 || (global && !confirm) || approve.isPending}><Check /> Approve</Button>
    </form>
  );
}

function RejectForm({ a }: { a: Article }) {
  const [note, setNote] = useState("");
  const reject = useRejectArticle(a.id);
  return (
    <form className="flex flex-col gap-2 rounded-xl border border-line p-3" onSubmit={(e) => (e.preventDefault(), reject.mutate(note.trim()))}>
      <p className="text-sm font-medium">Reject</p>
      <Textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} rows={2} placeholder="Why? (kept in the audit log)" aria-label="Rejection reason" />
      {reject.isError && <p className="text-[13px] text-accent">{reject.error.message}</p>}
      <Button type="submit" size="sm" variant="outline" className="self-start" disabled={note.trim().length < 3 || reject.isPending}><X /> Reject</Button>
    </form>
  );
}

function ArticleSheet({ id, role, onClose }: { id: string | null; role: SupportRole; onClose: () => void }) {
  const { data: a, isPending } = useArticle(id);
  const audit = useAudit(id ?? undefined);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const edit = useEditArticle(id ?? "");
  const archive = useArchiveArticle(id ?? "");
  const locked = a?.scope === "global" && role !== "admin"; // UI hint only: the server enforces this

  return (
    <Sheet open={Boolean(id)} onOpenChange={(o) => !o && (setMode("view"), onClose())}>
      <SheetContent side="right" className="flex flex-col gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b border-line">
          <SheetTitle>{a?.title ?? "Knowledge article"}</SheetTitle>
          <SheetDescription>{a ? `${SOURCE[a.source] ?? a.source} · created ${when(a.created_at)}` : " "}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 p-4">
          {isPending && <p className="text-sm text-muted">Loading…</p>}
          {a && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={a.status} />
                <ScopeBadge scope={a.scope} workspace={a.workspace ?? a.workspace_id} />
                <span className="text-[12px] text-faint">👍 {a.helpful_count} · 👎 {a.unhelpful_count}</span>
              </div>
              {locked && <p className="rounded-lg bg-info/10 p-2.5 text-[13px]">Only Vyuham administrators can approve, reject, edit or archive global articles, because every customer sees them.</p>}
              {mode === "edit" ? (
                <ArticleForm initial={a} submitLabel="Save changes" pending={edit.isPending} onSubmit={(f) => edit.mutate(f, { onSuccess: () => setMode("view") })} />
              ) : (
                <div className="flex flex-col gap-3 text-sm">
                  {[["Symptoms", a.symptoms], ["Root cause", a.root_cause], ["Resolution", a.resolution]].map(([label, text]) => (
                    <div key={label} className="flex flex-col gap-1">
                      <p className="text-[12px] font-medium uppercase tracking-wide text-faint">{label}</p>
                      <p className="whitespace-pre-wrap break-words">{text}</p>
                    </div>
                  ))}
                  {a.test_notes && <p className="text-[13px] text-muted">Tested: {a.test_notes}</p>}
                  {a.review_note && <p className="text-[13px] text-muted">Review note: {a.review_note}</p>}
                  <p className="text-[12px] text-faint">Modules: {a.modules.map((m) => MODULE_LABEL[m] ?? m).join(", ") || "–"} · Categories: {a.categories.join(", ") || "–"} · {a.fingerprints.length} fingerprint(s)</p>
                </div>
              )}
              {edit.isError && <p className="text-[13px] text-accent">{edit.error.message}</p>}
              {!locked && mode === "view" && (
                <div className="flex flex-wrap gap-2">
                  {a.status !== "archived" && <Button size="sm" variant="outline" onClick={() => setMode("edit")}><Pencil /> Edit</Button>}
                  {a.status === "approved" && <Button size="sm" variant="ghost" onClick={() => archive.mutate()} disabled={archive.isPending}><Archive /> Archive</Button>}
                </div>
              )}
              {/* After a decision the panel stays open: the new status and its audit entry show right here. */}
              {!locked && mode === "view" && (a.status === "pending" || a.status === "rejected") && <ApproveForm a={a} />}
              {!locked && mode === "view" && a.status === "pending" && <RejectForm a={a} />}
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">Audit history</h3>
                {audit.data ? <AuditList entries={audit.data} /> : <p className="text-sm text-muted">Loading…</p>}
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function NewArticleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [scope, setScope] = useState<"global" | "tenant">("global");
  const [workspace, setWorkspace] = useState("");
  const create = useCreateArticle();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New knowledge article</DialogTitle>
          <DialogDescription>It starts as pending and isn&apos;t used by the assistant until it is approved as tested.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <NativeSelect value={scope} onChange={(e) => setScope(e.target.value as "global" | "tenant")} aria-label="Who can see it">
            <NativeSelectOption value="global">All customers</NativeSelectOption>
            <NativeSelectOption value="tenant">One workspace</NativeSelectOption>
          </NativeSelect>
          {scope === "tenant" && <Input value={workspace} onChange={(e) => setWorkspace(e.target.value.trim())} placeholder="Workspace id" aria-label="Workspace id" className="h-9 w-72" />}
        </div>
        <ArticleForm submitLabel="Create draft" pending={create.isPending} onSubmit={(f) => create.mutate({ ...f, scope, ...(scope === "tenant" ? { workspace_id: workspace } : {}) }, { onSuccess: () => onOpenChange(false) })} />
        {create.isError && <p className="text-[13px] text-accent">{create.error.message}</p>}
      </DialogContent>
    </Dialog>
  );
}

const STATUSES = [
  ["pending", "Pending review"],
  ["approved", "Verified"],
  ["rejected", "Rejected"],
  ["archived", "Archived"],
] as const;

export function KnowledgeTab({ role }: { role: SupportRole }) {
  const [status, setStatus] = useState<string>("pending");
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { data, isPending, isError, error } = useArticles(status);

  return (
    <Panel
      title="Knowledge"
      description="AI-suggested and staff-written solutions. Only verified (approved and tested) articles are used by the assistant."
      action={<Button size="sm" onClick={() => setCreating(true)}><Plus /> New article</Button>}
    >
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Article status">
        {STATUSES.map(([v, l]) => (
          <button key={v} type="button" role="tab" aria-selected={status === v} onClick={() => setStatus(v)} className={`rounded-full border px-3 py-1 text-[13px] ${status === v ? "border-primary bg-primary/15 text-text" : "border-line text-muted hover:text-text"}`}>{l}</button>
        ))}
      </div>
      {isPending ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : isError ? (
        <p className="text-sm text-accent">{error.message}</p>
      ) : !data.length ? (
        <Empty>Nothing here.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Visible to</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Helpful</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((a) => (
                <TableRow key={a.id} className="cursor-pointer" onClick={() => setOpen(a.id)}>
                  <TableCell className="max-w-[360px]"><span className="block truncate">{a.title}</span></TableCell>
                  <TableCell><ScopeBadge scope={a.scope} workspace={a.workspace ?? a.workspace_id} /></TableCell>
                  <TableCell className="text-[13px] text-muted">{a.source === "customer_feedback" || a.source === "ai_session" ? <Badge variant="primary-light">AI-suggested</Badge> : SOURCE[a.source] ?? a.source}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.helpful_count}/{a.helpful_count + a.unhelpful_count}</TableCell>
                  <TableCell className="whitespace-nowrap text-[13px] text-muted">{when(a.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <ArticleSheet id={open} role={role} onClose={() => setOpen(null)} />
      <NewArticleDialog open={creating} onOpenChange={setCreating} />
    </Panel>
  );
}
