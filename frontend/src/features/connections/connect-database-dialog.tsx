"use client";

import { Check, CircleAlert, Database, Eye, LoaderCircle, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { InlineAlert } from "@/components/app/inline-alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { Dataset } from "@/features/datasets/api";
import { cn } from "@/lib/utils";

import {
  DEFAULT_PORT,
  KIND_LABEL,
  parseConnectionUrl,
  useConnectionSettings,
  useConnectionTables,
  useCreateConnection,
  useCreateSyncedDatasets,
  useTablePreview,
  useTestConnection,
  type ConnectionKind,
  type Refresh,
  type SslMode,
} from "./api";

const nf = new Intl.NumberFormat("en-US");
const MAX_TABLES = 10;
const STEPS = ["Connect", "Choose data", "Done"] as const;

type Form = {
  kind: ConnectionKind;
  name: string;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  ssl_mode: SslMode;
};

const EMPTY: Form = { kind: "postgres", name: "", host: "", port: "5432", database: "", username: "", password: "", ssl_mode: "require" };

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className="text-[13px] font-medium text-muted">
      {children}
    </label>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2 text-[12.5px]" aria-label="Steps">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2" aria-current={i === step ? "step" : undefined}>
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-full border text-[11.5px] font-semibold",
              i < step ? "border-primary bg-primary text-primary-foreground" : i === step ? "border-primary text-highlight" : "border-line text-faint",
            )}
          >
            {i < step ? <Check className="size-3.5" aria-hidden /> : i + 1}
          </span>
          <span className={cn(i === step ? "font-medium text-text" : "text-faint", "max-sm:hidden")}>{s}</span>
          {i < STEPS.length - 1 && <span className="h-px w-6 bg-line sm:w-10" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

/**
 * Connect a PostgreSQL or MySQL database and pick tables (or write a query) to sync as datasets.
 * Pass `connectionId` to skip straight to choosing data from a saved connection.
 */
export function ConnectDatabaseDialog({
  open,
  onOpenChange,
  connectionId: savedId = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId?: string | null;
}) {
  const [step, setStep] = useState(savedId ? 1 : 0);
  const [form, setForm] = useState<Form>(EMPTY);
  const [urlText, setUrlText] = useState("");
  const [connectionId, setConnectionId] = useState<string | null>(savedId);
  const [mode, setMode] = useState<"tables" | "query">("tables");
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [queryName, setQueryName] = useState("");
  const [refresh, setRefresh] = useState<Refresh>("daily");
  const [result, setResult] = useState<{ datasets: Dataset[]; errors: Record<string, string> } | null>(null);

  const settings = useConnectionSettings();
  const test = useTestConnection();
  const create = useCreateConnection();
  const tables = useConnectionTables(step === 1 ? connectionId : null);
  const preview = useTablePreview(connectionId, previewKey);
  const sync = useCreateSyncedDatasets(connectionId ?? "");

  // Start fresh each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setStep(savedId ? 1 : 0);
    setConnectionId(savedId);
    setForm(EMPTY);
    setUrlText("");
    setPicked([]);
    setSearch("");
    setPreviewKey(null);
    setQuery("");
    setQueryName("");
    setRefresh("daily");
    setResult(null);
    test.reset();
    create.reset();
    sync.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, savedId]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    test.reset();
  };

  const fields = {
    kind: form.kind,
    host: form.host.trim(),
    port: Number(form.port) || DEFAULT_PORT[form.kind],
    database: form.database.trim(),
    username: form.username.trim(),
    ssl_mode: form.ssl_mode,
  };
  const detailsComplete = Boolean(fields.host && fields.database && fields.username && form.password);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (tables.data ?? []).filter((t) => !q || t.key.toLowerCase().includes(q));
  }, [tables.data, search]);

  function pasteUrl(text: string) {
    setUrlText(text);
    const parsed = parseConnectionUrl(text);
    if (!parsed) return;
    setForm((f) => ({
      ...f,
      ...parsed,
      port: String(parsed.port ?? f.port),
      password: parsed.password || f.password,
      name: f.name || parsed.database || "",
    }));
    test.reset();
  }

  function connect() {
    create.mutate(
      { ...fields, name: form.name.trim() || `${KIND_LABEL[form.kind]} · ${fields.database}`, password: form.password },
      {
        onSuccess: (c) => {
          setConnectionId(c.id);
          setStep(1);
        },
      },
    );
  }

  function togglePick(key: string, on: boolean) {
    setPicked((p) => (on ? (p.includes(key) || p.length >= MAX_TABLES ? p : [...p, key]) : p.filter((k) => k !== key)));
  }

  function startSync() {
    const body = mode === "tables" ? { tables: picked, refresh } : { query, name: queryName.trim() || "Query", refresh };
    sync.mutate(body, {
      onSuccess: (r) => {
        setResult(r);
        setStep(2);
      },
    });
  }

  const canSync = mode === "tables" ? picked.length > 0 : query.trim().length > 0 && queryName.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] gap-5 overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="gap-3">
          <Stepper step={step} />
          <DialogTitle>{step === 0 ? "Connect a database" : step === 1 ? "Choose what to sync" : "Your data is ready"}</DialogTitle>
          <DialogDescription>
            {step === 0
              ? "Vyuham copies the tables you pick and keeps them up to date. It only ever reads; it never changes your database."
              : step === 1
                ? "Each table becomes a dataset you can chart, ask about and join with your files."
                : "Open a dataset to start asking questions about it."}
          </DialogDescription>
        </DialogHeader>

        {step === 0 && (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Database type">
              {(["postgres", "mysql"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={form.kind === k}
                  onClick={() => {
                    setForm((f) => ({ ...f, kind: k, port: f.port === String(DEFAULT_PORT[f.kind]) ? String(DEFAULT_PORT[k]) : f.port }));
                    test.reset();
                  }}
                  className={cn(
                    "flex min-h-14 items-center gap-3 rounded-xl border px-4 text-left transition-colors",
                    form.kind === k ? "border-primary bg-primary/10" : "border-line hover:border-line-strong",
                  )}
                >
                  <span className={cn("flex size-9 items-center justify-center rounded-lg", k === "postgres" ? "bg-sky-500/15 text-sky-400" : "bg-amber-500/15 text-amber-400")}>
                    <Database className="size-[18px]" aria-hidden />
                  </span>
                  <span className="flex flex-col">
                    <span className="text-[14.5px] font-medium text-text">{KIND_LABEL[k]}</span>
                    <span className="text-[12px] text-faint">{k === "postgres" ? "Supabase, Neon, RDS…" : "MariaDB, PlanetScale…"}</span>
                  </span>
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="db-url">Connection URL (optional)</Label>
              <Input
                id="db-url"
                type="password"
                value={urlText}
                onChange={(e) => pasteUrl(e.target.value)}
                placeholder={form.kind === "postgres" ? "postgres://user:password@host:5432/database" : "mysql://user:password@host:3306/database"}
                autoComplete="new-password"
                spellCheck={false}
              />
              <p className="text-[12px] text-faint">Paste one to fill in the fields below. It&apos;s hidden because it can contain your password.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="db-host">Host</Label>
                <Input id="db-host" value={form.host} onChange={(e) => set("host", e.target.value)} placeholder="db.example.com" autoComplete="off" spellCheck={false} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="db-port">Port</Label>
                <Input id="db-port" inputMode="numeric" value={form.port} onChange={(e) => set("port", e.target.value.replace(/\D/g, ""))} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="db-name">Database</Label>
                <Input id="db-name" value={form.database} onChange={(e) => set("database", e.target.value)} autoComplete="off" spellCheck={false} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="db-ssl">SSL</Label>
                <NativeSelect id="db-ssl" value={form.ssl_mode} onChange={(e) => set("ssl_mode", e.target.value as SslMode)}>
                  <option value="require">Require (recommended)</option>
                  <option value="verify-full">Verify certificate</option>
                  <option value="disable">Off</option>
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="db-user">Username</Label>
                <Input id="db-user" value={form.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" spellCheck={false} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="db-pass">Password</Label>
                <Input id="db-pass" type="password" value={form.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" />
              </div>
            </div>
            {form.ssl_mode === "disable" && (
              <p className="text-[13px] text-accent">With SSL off, your password and data travel unencrypted.</p>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="db-label">Name in Vyuham (optional)</Label>
              <Input id="db-label" value={form.name} maxLength={120} onChange={(e) => set("name", e.target.value)} placeholder={`${KIND_LABEL[form.kind]} · ${form.database || "shop"}`} />
            </div>

            <div className="flex gap-3 rounded-xl border border-line bg-surface-2/50 p-3.5 text-[13px] leading-relaxed text-muted">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-highlight" aria-hidden />
              <p>
                Use a <strong className="font-medium text-text">read-only user</strong> that can only SELECT the tables you want to share. Your password
                is stored encrypted and is never shown again.
                {settings.data?.egress_ip && (
                  <>
                    {" "}If your database has a firewall, allow connections from <code className="rounded bg-line px-1 py-0.5 text-text">{settings.data.egress_ip}</code>.
                  </>
                )}
              </p>
            </div>

            <div aria-live="polite" className="empty:hidden">
              {test.data && <InlineAlert tone={test.data.ok ? "info" : undefined}>{test.data.message}</InlineAlert>}
              {test.isError && <InlineAlert>{test.error.message}</InlineAlert>}
              {create.isError && <InlineAlert>{create.error.message}</InlineAlert>}
            </div>
          </div>
        )}

        {step === 1 && (
          <Tabs value={mode} onValueChange={(v) => setMode(v as "tables" | "query")} className="gap-4">
            <TabsList>
              <TabsTrigger value="tables">Tables</TabsTrigger>
              <TabsTrigger value="query">Write a query</TabsTrigger>
            </TabsList>

            <TabsContent value="tables" className="flex flex-col gap-3">
              <label className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 focus-within:border-highlight">
                <Search className="size-4 text-faint" aria-hidden />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search tables"
                  aria-label="Search tables"
                  className="h-10 w-full bg-transparent text-[14px] text-text outline-none placeholder:text-faint"
                />
              </label>
              {tables.isPending && (
                <p className="flex items-center gap-2 py-6 text-[14px] text-muted">
                  <LoaderCircle className="size-4 animate-spin text-highlight" aria-hidden /> Reading the list of tables…
                </p>
              )}
              {tables.isError && <InlineAlert>{tables.error.message}</InlineAlert>}
              {tables.data && filtered.length === 0 && <p className="py-6 text-center text-[14px] text-muted">No tables match.</p>}
              {filtered.length > 0 && (
                <ul className="max-h-[38dvh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
                  {filtered.map((t) => {
                    const on = picked.includes(t.key);
                    return (
                      <li key={t.key} className={cn("flex items-center gap-3 px-3 py-2", on && "bg-primary/[0.06]")}>
                        <label className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-3">
                          <Checkbox
                            checked={on}
                            disabled={!on && picked.length >= MAX_TABLES}
                            onCheckedChange={(v) => togglePick(t.key, !!v)}
                            aria-label={`Sync ${t.key}`}
                          />
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate text-[14px] text-text">
                              {t.schema && t.schema !== "public" && <span className="text-faint">{t.schema}.</span>}
                              {t.name}
                            </span>
                            <span className="text-[12px] text-faint">
                              {t.kind === "view" ? "View" : "Table"}
                              {t.rows != null && ` · about ${nf.format(t.rows)} rows`}
                            </span>
                          </span>
                        </label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setPreviewKey(previewKey === t.key ? null : t.key)}
                          aria-pressed={previewKey === t.key}
                        >
                          <Eye aria-hidden /> <span className="max-sm:sr-only">Preview</span>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="text-[12.5px] text-faint">
                {picked.length} of up to {MAX_TABLES} picked. You can add more later.
              </p>
              {previewKey && (
                <div className="flex flex-col gap-2">
                  <p className="text-[13px] font-medium text-muted">Preview of {previewKey}</p>
                  {preview.isPending && <p className="text-[13px] text-faint">Loading…</p>}
                  {preview.isError && <InlineAlert>{preview.error.message}</InlineAlert>}
                  {preview.data && (
                    <div className="max-h-56 overflow-auto rounded-lg border border-line" data-lenis-prevent>
                      <table className="w-full text-left text-[12.5px]">
                        <thead className="sticky top-0 bg-surface-2">
                          <tr>
                            {preview.data.columns.map((c) => (
                              <th key={c} className="whitespace-nowrap px-3 py-2 font-medium text-muted">
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.data.rows.slice(0, 20).map((row, i) => (
                            <tr key={i} className="border-t border-line">
                              {row.map((v, j) => (
                                <td key={j} className="max-w-[16rem] truncate whitespace-nowrap px-3 py-1.5 text-text">
                                  {v === null ? <span className="text-faint">—</span> : String(v)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="query" className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="q-name">Dataset name</Label>
                <Input id="q-name" value={queryName} maxLength={200} onChange={(e) => setQueryName(e.target.value)} placeholder="Paid orders" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="q-sql">SELECT query</Label>
                <Textarea
                  id="q-sql"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  rows={7}
                  spellCheck={false}
                  placeholder={"SELECT order_id, customer, amount, created_at\nFROM orders\nWHERE status = 'paid'"}
                  className="font-mono text-[13px]"
                />
                <p className="text-[12px] text-faint">One SELECT statement. It runs read-only on every refresh and can&apos;t use system tables or functions that wait, lock or read files.</p>
              </div>
            </TabsContent>

            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <label htmlFor="db-refresh" className="text-[13px] font-medium text-muted">
                Keep it up to date
              </label>
              <NativeSelect id="db-refresh" value={refresh} onChange={(e) => setRefresh(e.target.value as Refresh)} className="w-auto">
                <option value="hourly">Every hour</option>
                <option value="daily">Every day</option>
                <option value="manual">Only when I refresh</option>
              </NativeSelect>
            </div>
            {sync.isError && <InlineAlert>{sync.error.message}</InlineAlert>}
          </Tabs>
        )}

        {step === 2 && result && (
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-2">
              {result.datasets.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/data/${d.id}`}
                    onClick={() => onOpenChange(false)}
                    className="flex items-center gap-3 rounded-xl border border-line p-3 transition-colors hover:border-primary/40"
                  >
                    <span className="flex size-8 items-center justify-center rounded-lg bg-success/15 text-success">
                      <Check className="size-4" aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium text-text">{d.name}</span>
                      <span className="text-[12.5px] text-faint">
                        {nf.format(d.row_count)} rows · {d.columns.length} columns
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {Object.entries(result.errors).map(([table, msg]) => (
              <p key={table} className="flex items-start gap-2 text-[13px] text-accent">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  <strong className="font-medium">{table}</strong>: {msg}
                </span>
              </p>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {step === 0 && (
            <>
              <Button variant="outline" onClick={() => test.mutate({ ...fields, password: form.password })} disabled={!detailsComplete || test.isPending}>
                {test.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                {test.isPending ? "Testing…" : "Test connection"}
              </Button>
              <Button onClick={connect} disabled={!detailsComplete || create.isPending}>
                {create.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                {create.isPending ? "Connecting…" : "Connect and continue"}
              </Button>
            </>
          )}
          {step === 1 && (
            <>
              {!savedId ? <span /> : <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>}
              <Button onClick={startSync} disabled={!canSync || sync.isPending || !connectionId}>
                {sync.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                {sync.isPending
                  ? "Copying data…"
                  : mode === "tables"
                    ? `Sync ${picked.length || ""} ${picked.length === 1 ? "table" : "tables"}`.replace("  ", " ")
                    : "Sync query"}
              </Button>
            </>
          )}
          {step === 2 && (
            <Button className="sm:ml-auto" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
