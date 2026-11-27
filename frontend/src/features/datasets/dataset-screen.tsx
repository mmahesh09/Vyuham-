"use client";

import { formatDistanceToNow } from "date-fns";
import { ArrowRight, Check, Code2, Database, FileSpreadsheet, LayoutDashboard, Link2, ListTodo, Pencil, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/app/empty-state";
import { InlineAlert } from "@/components/app/inline-alert";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMe } from "@/features/auth/hooks";
import { useSyncDataset } from "@/features/connections/api";
import { TaskDialog } from "@/features/team/task-dialog";

import { isRebuilt, isSynced, useDataset, useDeleteDataset, useReplaceDatasetFile, useUpdateDataset, type Dataset, type Layer } from "./api";
import { TypeBadge } from "./column-summary";
import { DatasetGrid } from "./dataset-grid";
import { LayerBadge } from "./layer-badge";
import { LAYERS, useLineage } from "./platform-api";
import { ProfilePanel } from "./profile-panel";
import { QualityPanel } from "./quality-panel";
import { ACCEPTED, MAX_FILE_BYTES, type ColumnType } from "./types";

const nf = new Intl.NumberFormat("en-US");
const TYPES: { value: ColumnType; label: string; hint: string }[] = [
  { value: "number", label: "Number", hint: "Can be summed and averaged" },
  { value: "date", label: "Date", hint: "Used for trends over time" },
  { value: "category", label: "Category", hint: "Groups, like region or product" },
  { value: "text", label: "Text", hint: "Free text, like notes or names" },
];

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function DatasetScreen({ id }: { id: string }) {
  const { data: dataset, isPending, isError, error } = useDataset(id);
  if (isPending) return <DatasetSkeleton />;
  if (isError)
    return (
      <PageContainer className="items-start gap-4 pt-6">
        <EmptyState
          icon={<FileSpreadsheet />}
          title={error.message === "Dataset not found" ? "This dataset doesn't exist" : "We couldn't open this dataset"}
          description={error.message === "Dataset not found" ? "It may have been deleted by someone in your workspace." : error.message}
          action={
            <Button variant="outline" nativeButton={false} render={<Link href="/data" />}>
              Back to data
            </Button>
          }
        />
      </PageContainer>
    );
  return <DatasetView dataset={dataset} />;
}

function DatasetView({ dataset }: { dataset: Dataset }) {
  const router = useRouter();
  const { data: me } = useMe();
  const canEdit = me?.role !== "viewer";
  const update = useUpdateDataset(dataset.id);
  const replace = useReplaceDatasetFile(dataset.id);
  const sync = useSyncDataset(dataset.id);
  const synced = isSynced(dataset);
  const rebuilt = isRebuilt(dataset);
  const refreshable = (synced && !!dataset.connection_id) || rebuilt;
  const tabParam = useSearchParams().get("tab");
  const [tab, setTab] = useState(["rows", "columns", "profile", "quality"].includes(tabParam ?? "") ? tabParam! : "rows");
  const remove = useDeleteDataset();
  const fileRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(dataset.name);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [taskOpen, setTaskOpen] = useState(false);

  const saveName = () => {
    const next = name.trim();
    if (!next || next === dataset.name) return setRenaming(false);
    update.mutate({ name: next }, { onSuccess: () => setRenaming(false) });
  };

  const onReplace = (file: File | undefined) => {
    if (!file) return;
    setReplaceError(null);
    if (file.size > MAX_FILE_BYTES) return setReplaceError("This file is over 10 MB, the beta limit.");
    replace.mutate({ file, sheet: dataset.sheet }, { onError: (e) => setReplaceError(e.message) });
  };

  return (
    <PageContainer width="wide" className="gap-7">
      <PageHeader
        back={{ href: "/data", label: "All data" }}
        crumb={dataset.name}
        title={
          <div className="flex min-w-0 flex-col gap-1">
      {renaming ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            saveName();
          }}
        >
          <Input
            autoFocus
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (setName(dataset.name), setRenaming(false))}
            aria-label="Dataset name"
            className="h-10 max-w-md text-lg font-semibold"
          />
          <Button type="submit" size="icon" aria-label="Save name" disabled={update.isPending}>
            <Check />
          </Button>
          <Button type="button" size="icon" variant="ghost" aria-label="Cancel" onClick={() => (setName(dataset.name), setRenaming(false))}>
            <X />
          </Button>
        </form>
      ) : (
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="type-page-title truncate text-text">{dataset.name}</h1>
          {dataset.layer && <LayerBadge layer={dataset.layer} />}
          {canEdit && (
            <Button variant="ghost" size="icon-sm" aria-label="Rename dataset" onClick={() => setRenaming(true)}>
              <Pencil />
            </Button>
          )}
        </div>
      )}
          {update.isError && <p className="text-[13px] text-accent">{update.error.message}</p>}
          </div>
        }
        description={
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
            <span className="flex items-center gap-1.5">
              {dataset.origin?.kind === "sql" ? (
                <>
                  <Code2 className="size-4 text-highlight" aria-hidden />
                  Built from a SQL query
                </>
              ) : dataset.origin?.kind === "url" ? (
                <>
                  <Link2 className="size-4 text-highlight" aria-hidden />
                  <span className="max-w-[280px] truncate" title={dataset.origin.url}>
                    {(() => {
                      try {
                        return new URL(dataset.origin.url).hostname;
                      } catch {
                        return "a link";
                      }
                    })()}
                  </span>
                </>
              ) : synced ? (
                <>
                  <Database className="size-4 text-highlight" aria-hidden />
                  {dataset.source_kind === "postgres" ? "PostgreSQL" : "MySQL"} · {dataset.source_table ?? "custom query"}
                  {!dataset.connection_id && <span className="text-faint">(connection removed)</span>}
                </>
              ) : (
                <>
                  <FileSpreadsheet className="size-4 text-faint" aria-hidden />
                  {dataset.source_filename}
                  {dataset.sheet ? ` (${dataset.sheet})` : ""}
                </>
              )}
            </span>
            <span>{nf.format(dataset.row_count)} rows</span>
            <span>{dataset.columns.length} columns</span>
            <span>{formatBytes(dataset.file_size)}</span>
            <span className="text-faint">
              {refreshable && dataset.last_synced_at ? (rebuilt ? "rebuilt" : "synced") : "updated"}{" "}
              {formatDistanceToNow(new Date((refreshable && dataset.last_synced_at) || dataset.updated_at || dataset.created_at), { addSuffix: true })}
            </span>
          </p>
        }
        actions={
          <>
          <Button nativeButton={false} render={<Link href={`/dashboards/new?dataset=${dataset.id}`} />}>
            <LayoutDashboard /> Build a dashboard
          </Button>
          {canEdit && (
            <>
              <Button variant="outline" onClick={() => setTaskOpen(true)}>
                <ListTodo /> Assign a task
              </Button>
              <TaskDialog
                open={taskOpen}
                onOpenChange={setTaskOpen}
                canEdit
                defaults={{ title: `Update ${dataset.name}`, dataset_id: dataset.id }}
              />
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED.join(",")}
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(e) => {
                  onReplace(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <NativeSelect
                aria-label="Data layer"
                value={dataset.layer ?? ""}
                onChange={(e) => update.mutate({ layer: e.target.value as Layer | "" })}
                className="w-auto"
                title="Bronze: raw. Silver: cleaned and checked. Gold: ready for dashboards."
              >
                <option value="">No layer</option>
                {LAYERS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label} layer
                  </option>
                ))}
              </NativeSelect>
              {refreshable ? (
                (
                  <>
                    <NativeSelect
                      aria-label="Refresh schedule"
                      value={dataset.refresh ?? "manual"}
                      onChange={(e) => update.mutate({ refresh: e.target.value as "manual" | "hourly" | "daily" })}
                      className="w-auto"
                    >
                      <option value="hourly">Refresh hourly</option>
                      <option value="daily">Refresh daily</option>
                      <option value="manual">Manual refresh</option>
                    </NativeSelect>
                    <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
                      <RefreshCw className={sync.isPending ? "animate-spin" : ""} /> {sync.isPending ? "Refreshing…" : "Refresh now"}
                    </Button>
                  </>
                )
              ) : synced ? null : (
                <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={replace.isPending}>
                  <RefreshCw className={replace.isPending ? "animate-spin" : ""} /> {replace.isPending ? "Replacing…" : "Replace file"}
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger render={<Button variant="outline" aria-label="Delete dataset" />}>
                  <Trash2 />
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete “{dataset.name}”?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The file and its {nf.format(dataset.row_count)} rows are removed for everyone in your workspace. Charts built on it will stop
                      working. This can&apos;t be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  {remove.isError && <p className="text-[13px] text-accent">{remove.error.message}</p>}
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep it</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(dataset.id, { onSuccess: () => router.replace("/data") })}
                    >
                      {remove.isPending ? "Deleting…" : "Delete dataset"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          </>
        }
      />

      {(replaceError || replace.isSuccess) && (
        <InlineAlert tone={replaceError ? "error" : "info"}>
          {replaceError ?? `Replaced with ${dataset.source_filename}. Dashboards using this dataset now show the new data.`}
        </InlineAlert>
      )}
      {refreshable && dataset.sync_error && !sync.isPending && (
        <InlineAlert tone="error">
          The last refresh failed: {dataset.sync_error} You&apos;re seeing the data from the last successful refresh.
        </InlineAlert>
      )}
      {sync.isError && <InlineAlert tone="error">{sync.error.message}</InlineAlert>}
      {sync.isSuccess && !dataset.sync_error && (
        <InlineAlert tone="info">Refreshed: {nf.format(dataset.row_count)} rows. Dashboards using this dataset now show the new data.</InlineAlert>
      )}

      <LineageStrip dataset={dataset} />

      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList>
          <TabsTrigger value="rows">Rows</TabsTrigger>
          <TabsTrigger value="columns">Columns</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="quality">Quality</TabsTrigger>
        </TabsList>
        <TabsContent value="rows" className="pt-4">
          <DatasetGrid dataset={dataset} />
        </TabsContent>
        <TabsContent value="columns" className="pt-4">
          <ColumnsPanel dataset={dataset} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="profile" className="pt-4">
          {tab === "profile" && <ProfilePanel dataset={dataset} />}
        </TabsContent>
        <TabsContent value="quality" className="pt-4">
          {tab === "quality" && <QualityPanel dataset={dataset} canEdit={canEdit} />}
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

/** Where this dataset comes from and what is built on it (one step each way). */
function LineageStrip({ dataset }: { dataset: Dataset }) {
  const { data } = useLineage(dataset.id);
  if (!data || (!data.upstream.length && !data.downstream.length)) return null;
  const chip = (d: { id: string; name: string; layer: Layer | null }) => (
    <Link key={d.id} href={`/data/${d.id}`} className="flex items-center gap-1.5 rounded-[6px] border border-line bg-surface px-2.5 py-1 text-[13px] text-text hover:border-line-strong">
      {d.layer && <LayerBadge layer={d.layer} compact />}
      <span className="max-w-[200px] truncate">{d.name}</span>
    </Link>
  );
  return (
    <nav aria-label="Lineage" className="-mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-faint">
      {data.upstream.length > 0 && (
        <>
          <span>Built from</span>
          {data.upstream.map(chip)}
          <ArrowRight className="size-3.5" aria-hidden />
          <span className="rounded-[6px] border border-highlight/50 bg-highlight/10 px-2.5 py-1 text-[13px] text-text">{dataset.name}</span>
        </>
      )}
      {data.downstream.length > 0 && (
        <>
          <span className={data.upstream.length ? "ml-2" : ""}>Used by</span>
          {data.downstream.map(chip)}
        </>
      )}
    </nav>
  );
}

/** Detected column types, with an override when we guessed wrong. */
function ColumnsPanel({ dataset, canEdit }: { dataset: Dataset; canEdit: boolean }) {
  const update = useUpdateDataset(dataset.id);
  const cleaned = dataset.columns.reduce((n, c) => n + (c.notes?.length ?? 0), 0);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        We guessed each column&apos;s type from its values. If one is wrong, change it here; charts use the new type straight away.
      </p>
      {cleaned > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-line bg-surface-2/60 px-3.5 py-2.5 text-[13px] text-muted">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-highlight" aria-hidden />
          We tidied {cleaned === 1 ? "one thing" : `${cleaned} things`} while reading this data, so totals come out right. Each note is on its
          column below. Your original file isn&apos;t changed.
        </p>
      )}
      {update.isError && <p className="text-[13px] text-accent">{update.error.message}</p>}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {dataset.columns.map((c) => (
          <li key={c.name} className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <code className="truncate font-mono text-[13px] text-text" title={c.name}>
                {c.name}
              </code>
              <TypeBadge type={c.type} />
            </div>
            <p className="truncate text-[13px] text-muted">{c.examples.length ? c.examples.join(" · ") : "No values"}</p>
            {c.empty_ratio > 0.2 && <p className="text-xs text-accent">{Math.round(c.empty_ratio * 100)}% of cells are empty</p>}
            {!!c.notes?.length && (
              <ul className="flex flex-col gap-1" aria-label={`What we tidied in ${c.name}`}>
                {c.notes.map((n) => (
                  <li key={n} className="flex items-start gap-1.5 text-xs leading-relaxed text-muted">
                    <Sparkles className="mt-0.5 size-3 shrink-0 text-highlight" aria-hidden />
                    {n}
                  </li>
                ))}
              </ul>
            )}
            {!!c.unreadable && (
              <p className="text-xs leading-relaxed text-accent">
                {c.unreadable === 1 ? "1 value isn’t" : `${c.unreadable.toLocaleString()} values aren’t`} a {c.type === "date" ? "date" : "number"}
                {c.unreadable_examples?.length ? ` (${c.unreadable_examples.map((v) => `“${v}”`).join(", ")})` : ""}, so{" "}
                {c.unreadable === 1 ? "it’s" : "they’re"} left out of totals and charts. Fix {c.unreadable === 1 ? "it" : "them"} in your file and
                replace it, or treat the column as text.
              </p>
            )}
            {canEdit && (
              <label className="flex items-center gap-2 text-xs text-faint">
                Treat as
                <NativeSelect
                  size="sm"
                  className="flex-1"
                  value={c.type}
                  disabled={update.isPending}
                  onChange={(e) => update.mutate({ column_types: { [c.name]: e.target.value as ColumnType } })}
                  aria-label={`Type of ${c.name}`}
                >
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value} className="bg-surface">
                      {t.label}: {t.hint}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DatasetSkeleton() {
  return (
    <PageContainer width="wide" className="gap-6" aria-busy>
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-9 w-72 rounded-lg" />
      <Skeleton className="h-5 w-full max-w-md" />
      <Skeleton className="h-[420px] rounded-xl" />
    </PageContainer>
  );
}
