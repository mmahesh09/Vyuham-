"use client";

import { Eye, Loader2, Plus, ScanSearch, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMe } from "@/features/auth/hooks";
import { useDatasets } from "@/features/datasets/api";
import {
  errorText, previewAs, useAccessReview, useAudit, useClassifications, useGovMutations, useGovOverview, usePolicies,
  type Classification, type GovLabel, type MaskMethod, type PiiType, type Policy,
} from "@/features/platform/api";
import { Chip, ErrorLine, RowsTable, SectionTitle, Stat, ago } from "@/features/platform/ui";

const LABELS: GovLabel[] = ["public", "internal", "confidential", "restricted"];
const TYPES: PiiType[] = ["email", "phone", "person_name", "address", "financial", "government_id", "sensitive"];
const TYPE_LABEL: Record<PiiType, string> = {
  email: "Email", phone: "Phone", person_name: "Person name", address: "Address", financial: "Financial", government_id: "Government ID", sensitive: "Sensitive personal",
};
const METHOD_LABEL: Record<MaskMethod, string> = {
  partial: "Partial (a***@domain, ****1234)", hash: "Hash (consistent, unreadable)", redact: "Redact ([REDACTED])", full: "Full mask (••••••)", hide: "Hide the column",
};
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function GovernanceScreen() {
  const me = useMe();
  const owner = me.data?.role === "owner";
  const overview = useGovOverview();
  const m = useGovMutations();
  return (
    <PageContainer width="wide">
      <PageHeader
        title="Governance"
        description="Find sensitive data, label it, and decide who sees what. Rules are enforced by the query engine for every query, preview, export, dashboard, shared link and AI request."
        actions={<Button onClick={() => m.scan.mutate()} disabled={m.scan.isPending}>{m.scan.isPending ? <Loader2 className="animate-spin" /> : <ScanSearch />} Scan for sensitive data</Button>}
      />
      {m.scan.data && (
        <p className="text-[13px] text-muted">
          Scanned {m.scan.data.datasets} datasets: {m.scan.data.new} new findings, {m.scan.data.updated} updated.
          {m.scan.data.default_policies_created && " Two recommended masking policies were added; review them under Policies."}
        </p>
      )}
      <ErrorLine error={m.scan.error ?? overview.error} />
      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Security overview</TabsTrigger>
          <TabsTrigger value="findings">Sensitive data</TabsTrigger>
          <TabsTrigger value="policies">Policies</TabsTrigger>
          <TabsTrigger value="access">Access control</TabsTrigger>
          {owner && <TabsTrigger value="audit">Audit log</TabsTrigger>}
        </TabsList>
        <TabsContent value="overview" className="flex flex-col gap-4 pt-4"><Overview /></TabsContent>
        <TabsContent value="findings" className="pt-4"><Findings owner={owner} /></TabsContent>
        <TabsContent value="policies" className="pt-4"><Policies owner={owner} /></TabsContent>
        <TabsContent value="access" className="pt-4"><Access owner={owner} /></TabsContent>
        {owner && <TabsContent value="audit" className="pt-4"><Audit /></TabsContent>}
      </Tabs>
    </PageContainer>
  );
}

function Overview() {
  const o = useGovOverview().data;
  if (!o) return <p className="text-sm text-faint">Loading…</p>;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Datasets with sensitive data" value={`${o.datasets_with_sensitive_data} of ${o.datasets}`} hint={o.never_scanned.length ? `${o.never_scanned.length} never scanned` : "All scanned"} />
        <Stat label="Classified columns" value={o.classified_columns} hint={`${o.by_label.restricted} restricted · ${o.by_label.confidential} confidential`} />
        <Stat label="Masking policies" value={o.policies.masking} hint={`${o.grants} explicit permission${o.grants === 1 ? "" : "s"}`} />
        <Stat label="Audit events (7 days)" value={o.audit_events_7d} hint={`${o.exports_7d} export${o.exports_7d === 1 ? "" : "s"}`} />
      </div>
      <p className="flex items-start gap-2 rounded-xl border border-line bg-surface p-4 text-[13px] text-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" />{o.enforcement}</p>
      <Panel className="flex flex-col gap-3">
        <SectionTitle>{o.unprotected.length ? "Sensitive columns without masking" : "Protection"}</SectionTitle>
        {o.unprotected.length === 0 ? (
          <p className="text-[13px] text-muted">Every confidential or restricted column is masked for viewers and shared links.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-[13px]">
            {o.unprotected.map((u) => (
              <li key={`${u.dataset_id}:${u.column}`} className="flex flex-wrap items-center gap-2">
                <ShieldAlert className="size-4 text-destructive" /><b className="text-text">{u.dataset}.{u.column}</b><Chip tone={u.label} />
                <span className="text-muted">visible in full to {u.visible_to.join(", ")}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="flex flex-col gap-2">
          <SectionTitle>By data type</SectionTitle>
          {TYPES.filter((t) => o.by_type[t]).length === 0 ? <p className="text-[13px] text-faint">Run a scan to find sensitive data.</p> : (
            <ul className="text-[13px] text-muted">{TYPES.filter((t) => o.by_type[t]).map((t) => <li key={t} className="flex justify-between"><span>{TYPE_LABEL[t]}</span><b className="tabular-nums text-text">{o.by_type[t]}</b></li>)}</ul>
          )}
        </Panel>
        <Panel className="flex flex-col gap-2">
          <SectionTitle>Members by role</SectionTitle>
          <ul className="text-[13px] text-muted">{Object.entries(o.members_by_role).map(([r, n]) => <li key={r} className="flex justify-between"><span>{cap(r)}</span><b className="tabular-nums text-text">{n}</b></li>)}</ul>
        </Panel>
      </div>
    </>
  );
}

function Findings({ owner }: { owner: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  const [filter, setFilter] = useState<"all" | GovLabel>("all");
  const q = useClassifications(dismissed);
  const m = useGovMutations();
  const rows = (q.data ?? []).filter((c) => filter === "all" || c.label === filter);
  const update = (c: Classification, patch: Partial<Pick<Classification, "label" | "pii_type" | "status">>) =>
    m.classify.mutate({ dataset_id: c.dataset_id, column: c.column, label: patch.label ?? c.label, pii_type: patch.pii_type !== undefined ? patch.pii_type : c.pii_type, status: patch.status ?? c.status });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <NativeSelect value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter by label">
          <option value="all">All labels</option>{LABELS.map((l) => <option key={l} value={l}>{cap(l)}</option>)}
        </NativeSelect>
        <label className="flex items-center gap-2 text-[13px] text-muted"><input type="checkbox" className="size-4" checked={dismissed} onChange={(e) => setDismissed(e.target.checked)} /> Show dismissed</label>
        <span className="text-[12px] text-faint">The scanner stores how many sampled values matched, never the values.</span>
      </div>
      <ErrorLine error={q.error ?? m.classify.error} />
      {!rows.length ? <p className="text-[13px] text-faint">{q.isPending ? "Loading…" : "No findings. Run a scan, or label columns yourself under Access control."}</p> : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-surface text-muted"><tr>{["Dataset", "Column", "Type", "Label", "Found by", "Viewers see", "Shared links see", ""].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((c) => (
                <tr key={c.id} className={c.status === "dismissed" ? "opacity-60" : undefined}>
                  <td className="px-3 py-2 text-text">{c.dataset}</td>
                  <td className="px-3 py-2 font-mono text-text">{c.column}</td>
                  <td className="px-3 py-2">
                    {owner ? (
                      <NativeSelect value={c.pii_type ?? ""} onChange={(e) => update(c, { pii_type: (e.target.value || null) as PiiType | null })} aria-label={`Type of ${c.column}`}>
                        <option value="">None</option>{TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                      </NativeSelect>
                    ) : c.pii_type ? TYPE_LABEL[c.pii_type] : "–"}
                  </td>
                  <td className="px-3 py-2">
                    {owner ? (
                      <NativeSelect value={c.label} onChange={(e) => update(c, { label: e.target.value as GovLabel })} aria-label={`Label of ${c.column}`}>
                        {LABELS.map((l) => <option key={l} value={l}>{cap(l)}</option>)}
                      </NativeSelect>
                    ) : <Chip tone={c.label}>{cap(c.label)}</Chip>}
                  </td>
                  <td className="px-3 py-2 text-muted">{c.source === "manual" ? "A person" : `Scanner${c.confidence != null ? ` · ${Math.round(c.confidence * 100)}%` : ""}${c.sampled ? ` · ${c.matched}/${c.sampled} sampled` : ""}`}</td>
                  <td className="px-3 py-2 text-muted">{c.masked_for.viewer ? cap(c.masked_for.viewer) : <span className="text-destructive">Full value</span>}</td>
                  <td className="px-3 py-2 text-muted">{c.masked_for.public ? cap(c.masked_for.public) : <span className="text-destructive">Full value</span>}</td>
                  <td className="px-3 py-2">{owner && <Button variant="ghost" size="xs" onClick={() => update(c, { status: c.status === "active" ? "dismissed" : "active" })}>{c.status === "active" ? "Dismiss" : "Restore"}</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type Draft = { id?: string; kind: Policy["kind"]; name: string; enabled: boolean; labels: GovLabel[]; pii_types: PiiType[]; method: MaskMethod; exempt_roles: string[];
  patterns: { pattern: string; label: GovLabel; pii_type: PiiType | "" }[]; audit_days: string; query_history_days: string; run_history_days: string; ai_history_days: string };
const blank = (kind: Policy["kind"]): Draft => ({ kind, name: "", enabled: true, labels: kind === "masking" ? ["restricted"] : [], pii_types: [], method: "full", exempt_roles: [],
  patterns: [{ pattern: "", label: "confidential", pii_type: "" }], audit_days: "365", query_history_days: "", run_history_days: "", ai_history_days: "" });
const fromPolicy = (p: Policy): Draft => {
  const r = p.rules as Record<string, unknown>;
  return { ...blank(p.kind), id: p.id, name: p.name, enabled: p.enabled, labels: (r.labels as GovLabel[]) ?? [], pii_types: (r.pii_types as PiiType[]) ?? [],
    method: (r.method as MaskMethod) ?? "full", exempt_roles: (r.exempt_roles as string[]) ?? [],
    patterns: ((r.patterns as Draft["patterns"]) ?? []).map((x) => ({ ...x, pii_type: x.pii_type ?? "" })),
    audit_days: String(r.audit_days ?? ""), query_history_days: String(r.query_history_days ?? ""), run_history_days: String(r.run_history_days ?? ""), ai_history_days: String(r.ai_history_days ?? "") };
};

function describePolicy(p: Policy) {
  const r = p.rules as Record<string, unknown>;
  if (p.kind === "masking") {
    const what = [...((r.labels as string[]) ?? []).map(cap), ...((r.pii_types as PiiType[]) ?? []).map((t) => TYPE_LABEL[t])].join(", ");
    const exempt = (r.exempt_roles as string[]) ?? [];
    return `${what}: ${METHOD_LABEL[(r.method as MaskMethod) ?? "full"]} for ${["editor", "viewer", "shared links"].filter((x) => !exempt.includes(x)).join(", ")}. Owners always see full values.`;
  }
  if (p.kind === "classification") return ((r.patterns as Draft["patterns"]) ?? []).map((x) => `columns matching /${x.pattern}/ → ${cap(x.label)}`).join("; ");
  return Object.entries(r).map(([k, v]) => `${k.replace(/_days$/, "").replace(/_/g, " ")}: ${v} days`).join(" · ");
}

function Policies({ owner }: { owner: boolean }) {
  const q = usePolicies();
  const m = useGovMutations();
  const [draft, setDraft] = useState<Draft | null>(null);
  const save = () => {
    if (!draft) return;
    const rules = draft.kind === "masking" ? { labels: draft.labels, pii_types: draft.pii_types, method: draft.method, exempt_roles: draft.exempt_roles }
      : draft.kind === "classification" ? { patterns: draft.patterns.filter((p) => p.pattern.trim()).map((p) => ({ ...p, pii_type: p.pii_type || null })) }
      : Object.fromEntries((["audit_days", "query_history_days", "run_history_days", "ai_history_days"] as const).filter((k) => draft[k].trim()).map((k) => [k, Number(draft[k])]));
    m.savePolicy.mutate({ id: draft.id, kind: draft.kind, name: draft.name.trim() || "Policy", rules, enabled: draft.enabled }, { onSuccess: () => setDraft(null) });
  };
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <div className="flex flex-col gap-4">
      {owner && !draft && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setDraft(blank("masking"))}><Plus /> Masking policy</Button>
          <Button variant="outline" size="sm" onClick={() => setDraft(blank("classification"))}><Plus /> Classification rule</Button>
          <Button variant="outline" size="sm" onClick={() => setDraft(blank("retention"))}><Plus /> Retention policy</Button>
        </div>
      )}
      {draft && (
        <Panel className="flex flex-col gap-4">
          <SectionTitle>{draft.id ? "Edit" : "New"} {draft.kind} policy</SectionTitle>
          <label className="flex max-w-md flex-col gap-1 text-[12px] text-faint">Name<Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          {draft.kind === "masking" && (
            <>
              <fieldset className="flex flex-wrap gap-3 text-[13px] text-muted"><legend className="mb-1 text-[12px] text-faint">Applies to columns labelled</legend>
                {LABELS.map((l) => <label key={l} className="flex items-center gap-1.5"><input type="checkbox" checked={draft.labels.includes(l)} onChange={() => setDraft({ ...draft, labels: toggle(draft.labels, l) })} />{cap(l)}</label>)}
              </fieldset>
              <fieldset className="flex flex-wrap gap-3 text-[13px] text-muted"><legend className="mb-1 text-[12px] text-faint">…or holding</legend>
                {TYPES.map((t) => <label key={t} className="flex items-center gap-1.5"><input type="checkbox" checked={draft.pii_types.includes(t)} onChange={() => setDraft({ ...draft, pii_types: toggle(draft.pii_types, t) })} />{TYPE_LABEL[t]}</label>)}
              </fieldset>
              <label className="flex max-w-md flex-col gap-1 text-[12px] text-faint">Masking
                <NativeSelect value={draft.method} onChange={(e) => setDraft({ ...draft, method: e.target.value as MaskMethod })}>
                  {(Object.keys(METHOD_LABEL) as MaskMethod[]).map((k) => <option key={k} value={k}>{METHOD_LABEL[k]}</option>)}
                </NativeSelect>
              </label>
              <fieldset className="flex flex-wrap gap-3 text-[13px] text-muted"><legend className="mb-1 text-[12px] text-faint">Roles that see full values (owners always do)</legend>
                {["editor", "viewer"].map((r) => <label key={r} className="flex items-center gap-1.5"><input type="checkbox" checked={draft.exempt_roles.includes(r)} onChange={() => setDraft({ ...draft, exempt_roles: toggle(draft.exempt_roles, r) })} />{cap(r)}s</label>)}
              </fieldset>
            </>
          )}
          {draft.kind === "classification" && (
            <div className="flex flex-col gap-2">
              <p className="text-[12px] text-faint">Columns whose names match a pattern get that label on the next scan.</p>
              {draft.patterns.map((p, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_160px_180px_auto]">
                  <Input value={p.pattern} placeholder="salary|bonus" className="font-mono" onChange={(e) => setDraft({ ...draft, patterns: draft.patterns.map((x, j) => (j === i ? { ...x, pattern: e.target.value } : x)) })} aria-label="Pattern" />
                  <NativeSelect value={p.label} onChange={(e) => setDraft({ ...draft, patterns: draft.patterns.map((x, j) => (j === i ? { ...x, label: e.target.value as GovLabel } : x)) })} aria-label="Label">{LABELS.map((l) => <option key={l} value={l}>{cap(l)}</option>)}</NativeSelect>
                  <NativeSelect value={p.pii_type} onChange={(e) => setDraft({ ...draft, patterns: draft.patterns.map((x, j) => (j === i ? { ...x, pii_type: e.target.value as PiiType | "" } : x)) })} aria-label="Type"><option value="">No type</option>{TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</NativeSelect>
                  <Button variant="ghost" size="icon-sm" aria-label="Remove pattern" onClick={() => setDraft({ ...draft, patterns: draft.patterns.filter((_, j) => j !== i) })}><Trash2 /></Button>
                </div>
              ))}
              <div><Button variant="outline" size="sm" onClick={() => setDraft({ ...draft, patterns: [...draft.patterns, { pattern: "", label: "confidential", pii_type: "" }] })}>Add pattern</Button></div>
            </div>
          )}
          {draft.kind === "retention" && (
            <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
              {([["audit_days", "Audit log"], ["query_history_days", "Query history (and access log)"], ["run_history_days", "Pipeline and refresh runs"], ["ai_history_days", "AI action log"]] as const).map(([k, label]) => (
                <label key={k} className="flex flex-col gap-1 text-[12px] text-faint">{label}, days (7–3650; blank keeps the default)
                  <Input type="number" min={7} max={3650} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
                </label>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2 text-[13px] text-muted"><input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> Enabled</label>
          <ErrorLine error={m.savePolicy.error} />
          <div className="flex gap-2"><Button onClick={save} disabled={m.savePolicy.isPending}>Save policy</Button><Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button></div>
        </Panel>
      )}
      {!q.data?.length ? <p className="text-[13px] text-faint">{q.isPending ? "Loading…" : "No policies yet. A scan adds two recommended masking policies."}</p> : (
        <ul className="flex flex-col gap-2">
          {q.data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line bg-surface p-4">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">{p.name}<Chip tone="pending">{p.kind}</Chip>{!p.enabled && <Chip tone="paused">Off</Chip>}</p>
                <p className="text-[13px] text-muted">{describePolicy(p)}</p>
                <p className="text-[12px] text-faint">Changed {ago(p.updated_at)}</p>
              </div>
              {owner && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setDraft(fromPolicy(p))}>Edit</Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => confirm(`Delete “${p.name}”?`) && m.deletePolicy.mutate(p.id)}>Delete</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Access({ owner }: { owner: boolean }) {
  const q = useAccessReview();
  const datasets = useDatasets();
  const m = useGovMutations();
  const [ds, setDs] = useState("");
  const [role, setRole] = useState<"editor" | "viewer" | "public">("viewer");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewAs>> | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const dataset = datasets.data?.find((d) => d.id === ds);
  const grants = useMemo(() => (q.data?.grants ?? []).filter((g) => g.dataset_id === ds && g.role === role), [q.data, ds, role]);
  const current = (column: string) => grants.find((g) => g.column === column)?.access ?? "default";
  const setGrant = (column: string, access: "none" | "masked" | "read" | "default") => m.grant.mutate({ dataset_id: ds, column, role, access });
  const runPreview = async () => {
    setPreviewError(null);
    try { setPreview(await previewAs(ds, role)); } catch (e) { setPreviewError(errorText(e)); }
  };
  if (!q.data) return <p className="text-sm text-faint">{q.error ? errorText(q.error) : "Loading…"}</p>;
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <SectionTitle>Permission review</SectionTitle>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-surface text-muted"><tr><th className="px-3 py-2 font-medium">Dataset</th>{["owner", "editor", "viewer", "public"].map((r) => <th key={r} className="px-3 py-2 font-medium" title={q.data!.roles[r]}>{r === "public" ? "Shared links" : cap(r) + "s"}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {q.data.matrix.map((row) => (
                <tr key={row.dataset_id}>
                  <td className="px-3 py-2 text-text">{row.dataset}</td>
                  {["owner", "editor", "viewer", "public"].map((r) => {
                    const a = row.roles[r];
                    return <td key={r} className="px-3 py-2">{a.access === "none" ? <Chip tone="failed">No access</Chip> : a.access === "partial" ? <Chip tone="warn">{[a.masked_columns && `${a.masked_columns} masked`, a.hidden_columns && `${a.hidden_columns} hidden`].filter(Boolean).join(", ")}</Chip> : <Chip tone="success">Full</Chip>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>Dataset, table and column permissions</SectionTitle>
        <div className="flex flex-wrap gap-3">
          <NativeSelect value={ds} onChange={(e) => { setDs(e.target.value); setPreview(null); }} aria-label="Dataset">
            <option value="">Choose a dataset</option>{datasets.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </NativeSelect>
          <NativeSelect value={role} onChange={(e) => { setRole(e.target.value as typeof role); setPreview(null); }} aria-label="Role">
            <option value="editor">Editors</option><option value="viewer">Viewers</option><option value="public">Shared links</option>
          </NativeSelect>
          {owner && ds && <Button variant="outline" size="sm" onClick={runPreview}><Eye /> Preview as {role === "public" ? "a shared link" : `a ${role}`}</Button>}
        </div>
        <ErrorLine error={m.grant.error ?? previewError} />
        {dataset && (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-surface text-muted"><tr><th className="px-3 py-2 font-medium">Column</th><th className="px-3 py-2 font-medium">Access</th></tr></thead>
              <tbody className="divide-y divide-line">
                <tr className="bg-surface/50">
                  <td className="px-3 py-2 font-medium text-text">Whole dataset</td>
                  <td className="px-3 py-2">
                    <NativeSelect value={current("")} disabled={!owner} onChange={(e) => setGrant("", e.target.value as "none" | "masked" | "default")} aria-label="Dataset access">
                      <option value="default">Default (can read; masking policies apply)</option><option value="masked">Every column masked</option><option value="none">No access</option>
                    </NativeSelect>
                  </td>
                </tr>
                {dataset.columns.map((c) => (
                  <tr key={c.name}>
                    <td className="px-3 py-2 font-mono text-text">{c.name}</td>
                    <td className="px-3 py-2">
                      <NativeSelect value={current(c.name)} disabled={!owner} onChange={(e) => setGrant(c.name, e.target.value as "none" | "masked" | "read" | "default")} aria-label={`Access to ${c.name}`}>
                        <option value="default">Default (masking policies apply)</option><option value="read">Full value (overrides masking)</option><option value="masked">Masked</option><option value="none">Hidden</option>
                      </NativeSelect>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {preview && (preview.hidden ? <p className="text-[13px] text-muted">This role can’t see this dataset at all.</p> : (
          <div className="flex flex-col gap-2">
            <p className="text-[12px] text-faint">The first rows exactly as this role gets them from the query engine{preview.masked && Object.keys(preview.masked).length ? ` (masked: ${Object.entries(preview.masked).map(([k, v]) => `${k} → ${v}`).join(", ")})` : ""}.</p>
            <RowsTable columns={preview.columns} rows={preview.rows} />
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>Workspace roles</SectionTitle>
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
          {q.data.members.map((mem) => (
            <li key={mem.user_id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
              <span className="flex flex-col"><span className="text-text">{mem.name}</span>{mem.email && <span className="text-[12px] text-faint">{mem.email}</span>}</span>
              <Chip tone="pending">{cap(mem.role)}</Chip>
            </li>
          ))}
        </ul>
        <p className="text-[12px] text-faint">Change roles on the Team page; every change is recorded in the audit log.</p>
      </section>
    </div>
  );
}

function Audit() {
  const [group, setGroup] = useState("all");
  const [days, setDays] = useState(30);
  const q = useAudit(group, days, true);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <NativeSelect value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Events">
          <option value="all">Everything</option><option value="access">Data access</option><option value="permissions">Permission changes</option><option value="policies">Policy changes</option><option value="exports">Exports</option>
        </NativeSelect>
        <NativeSelect value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period"><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option></NativeSelect>
      </div>
      <ErrorLine error={q.error} />
      {!q.data?.events.length ? <p className="text-[13px] text-faint">{q.isPending ? "Loading…" : "No events in this period."}</p> : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-surface text-muted"><tr>{["When", "Who", "What", "On", "Details"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {q.data.events.map((e, i) => (
                <tr key={i} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-text" title={e.at}>{ago(e.at)}</td>
                  <td className="px-3 py-2 text-text">{e.user}</td>
                  <td className="px-3 py-2"><Chip tone={e.type === "access" ? "pending" : e.type === "export" ? "warn" : "internal"}>{e.action}</Chip></td>
                  <td className="px-3 py-2 text-muted">{e.target ?? e.target_type}</td>
                  <td className="max-w-[420px] px-3 py-2 font-mono text-[11px] text-faint">{JSON.stringify(e.detail)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
